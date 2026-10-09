"""
Notebook runtime  -  this file runs INSIDE THE BROWSER (Pyodide), not on your server.

It plays the role of the Jupyter "kernel":
  * it keeps ONE shared namespace, so variables survive from cell to cell,
  * it runs a cell and returns what Jupyter would show: printed text, the value
    of the last expression, matplotlib figures and error messages.

Every function takes/returns plain strings (JSON), which keeps the JavaScript
side simple. The JavaScript side lives in pyodideRuntime.js.
"""
import ast
import base64
import contextlib
import io
import json
import linecache
import traceback

import matplotlib
matplotlib.use("Agg")                    # draw into memory, never into a window
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

MAX_TEXT = 20000                         # clip huge outputs so the page stays fast
CELL_NAME = "<cell>"                     # shows up in tracebacks, like Jupyter's <ipython-input>

_state = {"ns": None, "base": None}      # ns = the notebook's variables, base = original upload
_displays = []                           # filled by display() while a cell runs


# ───────────────────────── helpers ─────────────────────────

def _clip(text):
    if len(text) > MAX_TEXT:
        return text[:MAX_TEXT] + f"\n... [{len(text) - MAX_TEXT} more characters hidden]"
    return text


def _render(value):
    """Turn a Python value into something the browser can show."""
    if isinstance(value, pd.DataFrame):
        html = value.to_html(max_rows=30, max_cols=30, show_dimensions=True,
                             classes="nb-df", border=0, escape=True)
        return {"kind": "html", "data": html}
    return {"kind": "text", "data": _clip(repr(value))}


def _display(*objects):
    """Jupyter's display(): show something in the middle of a cell."""
    for obj in objects:
        _displays.append(_render(obj))


def _collect_figures():
    """Convert every open matplotlib figure to a PNG (base64) and close it."""
    images = []
    for number in plt.get_fignums():
        fig = plt.figure(number)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=90, bbox_inches="tight")
        images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    plt.close("all")
    return images


def _new_namespace(base_df):
    return {
        "__name__": "__main__",
        "pd": pd, "np": np, "plt": plt,
        "df": base_df.copy(),            # the working dataset - what the user edits
        "_base_df": base_df.copy(),      # the untouched upload (used by the 'reset' step)
        "display": _display,
    }


def _compile_cell(code):
    """
    Split the cell like Jupyter does: everything is executed, and if the LAST
    statement is a bare expression (e.g.  df.head()  ) its value is returned for display.
    """
    tree = ast.parse(code, filename=CELL_NAME, mode="exec")
    last_expr = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = ast.Expression(tree.body.pop().value)
    body = compile(tree, CELL_NAME, "exec")
    expr = compile(last_expr, CELL_NAME, "eval") if last_expr is not None else None
    return body, expr


def _format_error(exc):
    tb = exc.__traceback__
    # hide our own runner frame so the user only sees their code
    tb = None if isinstance(exc, SyntaxError) else (tb.tb_next if tb is not None else None)
    return {
        "name": type(exc).__name__,
        "message": str(exc),
        "traceback": _clip("".join(traceback.format_exception(type(exc), exc, tb))),
    }


# ───────────────────────── public API (called from JavaScript) ─────────────────────────

def nb_reset(csv_text):
    """Start from a clean kernel whose `df` is the dataset in csv_text."""
    base = pd.read_csv(io.StringIO(csv_text))
    _state["base"] = base
    _state["ns"] = _new_namespace(base)
    plt.close("all")
    return nb_df_info()


def nb_df_info():
    """Column names + row count of the current `df` (used to verify a replay)."""
    df = _state["ns"].get("df")
    if not isinstance(df, pd.DataFrame):
        return json.dumps({"ok": False, "error": f"`df` is a {type(df).__name__}, not a DataFrame."})
    return json.dumps({"ok": True, "columns": [str(c) for c in df.columns], "rows": int(len(df))})


def nb_run_cell(code, capture=True):
    """
    Run one cell. capture=False is used while replaying old steps: we only care
    that the code runs, not about what it prints.
    """
    ns = _state["ns"]
    out, err = io.StringIO(), io.StringIO()
    result, error = None, None
    _displays.clear()
    linecache.cache[CELL_NAME] = (len(code), None, code.splitlines(True), CELL_NAME)

    try:
        body, expr = _compile_cell(code)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(body, ns)
            value = eval(expr, ns) if expr is not None else None
        # a trailing semicolon hides the value, exactly like in Jupyter
        if capture and value is not None and not code.rstrip().endswith(";"):
            result = _render(value)
    except BaseException as exc:         # also catches SystemExit from exit()
        error = _format_error(exc)

    images = _collect_figures() if capture else []
    if not capture:
        plt.close("all")
    return json.dumps({
        "ok": error is None,
        "stdout": _clip(out.getvalue()) if capture else "",
        "stderr": _clip(err.getvalue()) if capture else "",
        "result": result,
        "displays": list(_displays) if capture else [],
        "images": images,
        "error": error,
    })


def nb_export_df():
    """The current `df` as CSV text, ready to be committed."""
    df = _state["ns"].get("df")
    if not isinstance(df, pd.DataFrame):
        return json.dumps({"ok": False,
                           "error": f"`df` must be a pandas DataFrame, but it is a {type(df).__name__}."})
    return json.dumps({"ok": True, "csv": df.to_csv(index=False)})


def nb_update_df(csv_text):
    """Update the current `df` from CSV text, preserving other namespace variables."""
    try:
        base = pd.read_csv(io.StringIO(csv_text))
        _state["ns"]["df"] = base.copy()
        return json.dumps({"ok": True})
    except Exception as e:
        return json.dumps({"ok": False, "error": str(e)})
