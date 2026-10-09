// ─────────────────────────────────────────────────────────────────────────────
//  NotebookSandbox  -  a Jupyter-style notebook that edits the app's dataset
//
//  How it fits together (read this first!):
//
//   1. The app's dataset is the result of an ordered list of STEPS
//      (upload → delete column → change dtype → committed notebook cells …).
//      The backend stores every step together with the Python code behind it.
//   2. When you open the notebook we start a fresh Python kernel in the browser
//      and REPLAY those steps, so `df` is exactly the dataset you see in the app.
//      Everything you write now is "the next lines of code" after those steps.
//   3. You can run cells one by one (Shift+Enter), add as many as you like.
//   4. "Commit" re-runs your new cells top-to-bottom (to prove they are
//      reproducible), sends the resulting `df` to the backend, and the backend
//      appends your code to the step list and replaces the app's dataset.
//
//  The Python itself lives in ../notebook/nb_runtime.py, the browser/Python
//  bridge in ../notebook/pyodideRuntime.js.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import EncodingModal from "./EncodingModal";
import {
  loadRuntime,
  rebuildKernel,
  runCell as runPythonCell,
  exportDataFrame,
  nextPaint,
  updateDataFrame,
} from "../notebook/pyodideRuntime";
import "./NotebookSandbox.css";

// ───────────────────────────── small helpers ─────────────────────────────

let idCounter = 1;
const uid = () => `nb-${idCounter++}`;

/** An editable cell. `committed` cells are locked: their code is already part of the history. */
const newCell = (code = "") => ({
  kind: "cell",
  id: uid(),
  code,
  output: null,
  status: "idle", // idle | running | done | error
  execCount: null,
  ranCode: null, // the code that produced `output` (to detect later edits)
  committed: false,
  commitLabel: "",
});

/** A read-only block describing one step that happened BEFORE this session. */
const stepToItem = (step, filename) => {
  let code = step.code;
  if (step.step_id === 0) code = `# The dataset exactly as you uploaded it\ndf = pd.read_csv("${filename || "your_file.csv"}")`;
  else if (step.cells && step.cells.length) code = step.cells.join("\n\n");
  return {
    kind: "step",
    id: `step-${step.step_id}`,
    stepId: step.step_id,
    action: step.step_id === 0 ? "Original upload" : step.action,
    origin: step.step_id === 0 ? "base" : step.origin,
    code: code || "# (no code was recorded for this step)",
  };
};

/** Identifies "this exact state of the dataset". When it changes, the kernel must be rebuilt. */
const datasetKey = (u) => `${u.stored_as}|${(u.history || []).length}|${u.last_action || ""}`;

const isPending = (item) => item.kind === "cell" && !item.committed;
const hasCode = (item) => item.code.trim().length > 0;

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the dataset (${res.status}).`);
  return res.text();
}

const sameShape = (info, expected) =>
  info.rows === expected.rows &&
  info.columns.length === expected.columns.length &&
  info.columns.every((name, i) => name === expected.columns[i]);

// ───────────────────────────── output view ─────────────────────────────

function CellOutput({ output, execCount }) {
  if (!output) return null;
  const { stdout, stderr, result, displays = [], images = [], error } = output;
  const blocks = [...displays, ...(result ? [result] : [])];
  if (!stdout && !stderr && !blocks.length && !images.length && !error) return null;

  return (
    <div className="nb-row">
      <div className="nb-prompt nb-prompt-out">{result ? `Out [${execCount}]:` : ""}</div>
      <div className="nb-output">
        {stdout && <pre className="nb-stdout">{stdout}</pre>}
        {stderr && <pre className="nb-stderr">{stderr}</pre>}
        {blocks.map((block, i) =>
          block.kind === "html" ? (
            // The HTML comes from pandas .to_html(escape=True): cell values are escaped.
            <div key={i} className="nb-html" dangerouslySetInnerHTML={{ __html: block.data }} />
          ) : (
            <pre key={i} className="nb-result-text">{block.data}</pre>
          )
        )}
        {images.map((b64, i) => (
          <img key={i} className="nb-plot" alt={`Plot ${i + 1}`} src={`data:image/png;base64,${b64}`} />
        ))}
        {error && <pre className="nb-error">{error.traceback}</pre>}
      </div>
    </div>
  );
}

// ───────────────────────────── one history step (read-only) ─────────────────────────────

function StepBlock({ item }) {
  const tag = item.origin === "notebook" ? "notebook" : item.origin === "base" ? "start" : "app action";
  return (
    <div className="nb-row nb-step">
      <div className="nb-prompt">Step {item.stepId}</div>
      <div className="nb-step-body">
        <div className="nb-step-head">
          <span className="nb-step-action">{item.action}</span>
          <span className={`nb-tag nb-tag-${item.origin}`}>{tag}</span>
        </div>
        <pre className="nb-step-code">{item.code}</pre>
      </div>
    </div>
  );
}

// ───────────────────────────── one code cell ─────────────────────────────

function CodeCell({ cell, busy, registerRef, onChange, onRun, onDelete, onAddBelow }) {
  const textareaRef = useRef(null);
  const caretRef = useRef(null); // where to put the cursor after our own edits (Tab / auto-indent)
  const locked = cell.committed;

  // Runs right after React updates the textarea: fit its height to the text, and
  // restore the cursor. (Doing this synchronously, not in a timer, keeps fast typing safe.)
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
    if (caretRef.current !== null) {
      el.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  }, [cell.code]);

  const handleKeyDown = (e) => {
    const el = e.target;
    const isMod = e.ctrlKey || e.metaKey;

    if (e.key === "Enter" && (e.shiftKey || isMod)) {
      e.preventDefault();
      onRun(cell.id, { advance: e.shiftKey }); // Shift+Enter → run and jump to the next cell
      return;
    }
    if (locked) return;

    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault(); // insert 4 spaces instead of leaving the box
      const { selectionStart: s, selectionEnd: t } = el;
      caretRef.current = s + 4;
      onChange(cell.id, cell.code.slice(0, s) + "    " + cell.code.slice(t));
    } else if (e.key === "Enter" && !e.shiftKey && !isMod) {
      e.preventDefault(); // keep the indentation of the current line (+4 after a ':')
      const { selectionStart: s, selectionEnd: t } = el;
      const lineStart = cell.code.lastIndexOf("\n", s - 1) + 1;
      const line = cell.code.slice(lineStart, s);
      const indent = line.match(/^\s*/)[0] + (line.trimEnd().endsWith(":") ? "    " : "");
      caretRef.current = s + 1 + indent.length;
      onChange(cell.id, cell.code.slice(0, s) + "\n" + indent + cell.code.slice(t));
    }
  };

  const running = cell.status === "running";
  const stale = cell.output && cell.ranCode !== cell.code && !locked;
  const label = running ? "[*]" : cell.execCount ? `[${cell.execCount}]` : "[ ]";

  return (
    <div className={`nb-cell ${locked ? "is-committed" : ""} ${cell.status === "error" ? "has-error" : ""}`}>
      <div className="nb-row">
        <div className="nb-prompt nb-prompt-in">
          In {label}:
          {!locked && (
            <button
              className="nb-run"
              onClick={() => onRun(cell.id)}
              disabled={busy}
              title="Run this cell (Ctrl+Enter)"
            >
              {running ? "…" : "▶"}
            </button>
          )}
        </div>
        <div className="nb-editor">
          <textarea
            ref={(el) => {
              textareaRef.current = el;
              registerRef(cell.id, el);
            }}
            className="nb-textarea"
            value={cell.code}
            readOnly={locked}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder={locked ? "" : "# Write Python here. `df` is your dataset.  Shift+Enter to run."}
            onChange={(e) => onChange(cell.id, e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="nb-cell-meta">
            {locked && <span className="nb-committed-badge">✓ committed · {cell.commitLabel}</span>}
            {stale && <span className="nb-stale-badge">edited since last run</span>}
            {!locked && (
              <button className="nb-icon-btn" onClick={() => onDelete(cell.id)} title="Delete this cell" disabled={busy}>
                🗑
              </button>
            )}
          </div>
        </div>
      </div>

      <CellOutput output={cell.output} execCount={cell.execCount} />

      {!locked && (
        <div className="nb-add-between">
          <button onClick={() => onAddBelow(cell.id)} disabled={busy} title="Insert a new cell below">
            ＋ Code
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── the notebook ─────────────────────────────

export default function NotebookSandbox({ isOpen, onClose, uploadData, taskId, onCommitted }) {
  const [phase, setPhase] = useState("idle"); // idle | loading | ready | error
  const [loadingMsg, setLoadingMsg] = useState("");
  const [fatalError, setFatalError] = useState("");
  const [notice, setNotice] = useState(null); // { type: info|ok|warn|error, text }
  const [items, setItems] = useState([]); //     steps (read-only) followed by cells
  const [busy, setBusy] = useState(false);
  const [encodingData, setEncodingData] = useState(null);

  const itemsRef = useRef(items); //          always the latest items (for async handlers)
  itemsRef.current = items;
  const busyRef = useRef(false);
  const execCounter = useRef(0); //           the "In [n]" counter
  const initKeyRef = useRef(null); //         which dataset state the kernel was built for
  const lastStoredRef = useRef(null); //      which file the cells belong to
  const kernelRef = useRef({ baseCsv: "", codes: [], fallback: false }); // what a restart replays
  const textareaRefs = useRef({});
  const focusRequest = useRef(null);
  const retryCommitRef = useRef(null); //     remembers the commit while the encoding dialog is open

  const lock = (value) => {
    busyRef.current = value;
    setBusy(value);
  };

  const patchCell = useCallback((id, patch) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const registerRef = useCallback((id, el) => {
    if (el) textareaRefs.current[id] = el;
    else delete textareaRefs.current[id];
  }, []);

  // After a render, move the cursor to the cell we asked to focus.
  useEffect(() => {
    const id = focusRequest.current;
    if (id && textareaRefs.current[id]) {
      textareaRefs.current[id].focus();
      textareaRefs.current[id].scrollIntoView({ block: "nearest" });
      focusRequest.current = null;
    }
  }, [items]);

  // ── 1. Build the kernel when the notebook opens (or the dataset changed) ──
  const init = useCallback(async (storedAs, filename, carryOver) => {
    const enc = encodeURIComponent(storedAs);
    setPhase("loading");
    setFatalError("");
    setNotice(null);
    setEncodingData(null);
    try {
      setLoadingMsg("Starting Python…");
      const [, state] = await Promise.all([loadRuntime(setLoadingMsg), fetchJson(`/api/notebook/${enc}/state`)]);

      setLoadingMsg("Rebuilding your dataset from the earlier steps…");
      await nextPaint();
      const baseCsv = await fetchText(state.has_history ? `/api/notebook/${enc}/base` : `/api/raw_dataset/${enc}`);

      // Try to replay history. If anything is off, fall back to the current dataset file.
      let kernel = null;
      let problem = "";
      if (state.replayable) {
        const codes = state.steps.slice(1).map((s) => s.code);
        const result = await rebuildKernel({ baseCsv, codes });
        if (result.ok && sameShape(result.info, state.expected)) kernel = { baseCsv, codes, fallback: false };
        else problem = result.ok ? "the rebuilt dataset differs from the saved one" : `step ${result.failedIndex + 1} failed (${result.error})`;
      } else {
        problem = "the history was saved by an older version of the app";
      }
      if (!kernel) {
        const currentCsv = await fetchText(`/api/raw_dataset/${enc}`);
        const result = await rebuildKernel({ baseCsv: currentCsv, codes: [] });
        if (!result.ok) throw new Error(result.error);
        kernel = { baseCsv: currentCsv, codes: [], fallback: true, problem };
      }
      kernelRef.current = kernel;
      execCounter.current = 0;

      const steps = state.has_history
        ? state.steps
        : [{ step_id: 0, action: "Original upload", origin: "base", code: null, cells: null }];
      const cells = carryOver.length ? carryOver.map((code) => newCell(code)) : [newCell()];
      focusRequest.current = cells[0].id;
      setItems([...steps.map((s) => stepToItem(s, filename)), ...cells]);

      if (kernel.fallback) {
        setNotice({
          type: "warn",
          text: `Loaded the current dataset directly because ${kernel.problem}. Variables from earlier cells are not available, but your data is.`,
        });
      } else if (carryOver.length) {
        setNotice({ type: "info", text: "The dataset changed since you last had the notebook open. Your unsaved cells were kept but not re-run." });
      }
      setPhase("ready");
    } catch (e) {
      initKeyRef.current = null; // so the next open tries again
      setFatalError(e.message || String(e));
      setPhase("error");
    }
  }, []);

  const startInit = useCallback(() => {
    if (!uploadData?.stored_as) return;
    const sameFile = lastStoredRef.current === uploadData.stored_as;
    const carry = sameFile ? itemsRef.current.filter((i) => isPending(i) && hasCode(i)).map((i) => i.code) : [];
    lastStoredRef.current = uploadData.stored_as;
    initKeyRef.current = datasetKey(uploadData);
    init(uploadData.stored_as, uploadData.filename, carry);
  }, [uploadData, init]);

  useEffect(() => {
    if (isOpen && uploadData?.stored_as && initKeyRef.current !== datasetKey(uploadData)) startInit();
  }, [isOpen, uploadData, startInit]);

  // ── 2. Editing cells ──
  const addCellBelow = useCallback((id) => {
    const cell = newCell();
    focusRequest.current = cell.id;
    setItems((prev) => {
      const at = prev.findIndex((i) => i.id === id);
      return [...prev.slice(0, at + 1), cell, ...prev.slice(at + 1)];
    });
  }, []);

  const addCellAtEnd = useCallback(() => {
    const cell = newCell();
    focusRequest.current = cell.id;
    setItems((prev) => [...prev, cell]);
  }, []);

  const deleteCell = useCallback((id) => {
    setItems((prev) => {
      const rest = prev.filter((i) => i.id !== id);
      return rest.some(isPending) ? rest : [...rest, newCell()]; // always keep one empty cell
    });
  }, []);

  const changeCode = useCallback((id, code) => patchCell(id, { code }), [patchCell]);

  // ── 3. Running ONE cell (Shift+Enter / ▶) ──
  const runOneCell = useCallback(
    async (id, { advance = false } = {}) => {
      if (busyRef.current) return;
      const cell = itemsRef.current.find((i) => i.id === id);
      if (!cell || cell.kind !== "cell" || cell.committed) return;

      if (hasCode(cell)) {
        lock(true);
        patchCell(id, { status: "running" });
        await nextPaint(); // let the browser show the "running" state before Python blocks it
        let output;
        try {
          output = runPythonCell(cell.code);
        } catch (e) {
          output = { ok: false, error: { traceback: `Internal error: ${e.message}` } };
        }
        execCounter.current += 1;
        patchCell(id, {
          status: output.ok ? "done" : "error",
          output,
          execCount: execCounter.current,
          ranCode: cell.code,
        });
        lock(false);
      }

      if (advance) {
        // jump to the next editable cell, creating one if this was the last
        const list = itemsRef.current;
        const next = list.slice(list.findIndex((i) => i.id === id) + 1).find(isPending);
        if (next) {
          focusRequest.current = next.id;
          setItems((prev) => [...prev]); // trigger the focus effect
        } else addCellAtEnd();
      }
    },
    [patchCell, addCellAtEnd]
  );

  // ── 4. Restart: forget all variables, replay the history ──
  const restart = useCallback(async () => {
    if (busyRef.current) return;
    lock(true);
    setNotice({ type: "info", text: "Restarting the kernel…" });
    await nextPaint();
    try {
      const result = await rebuildKernel(kernelRef.current);
      if (!result.ok) throw new Error(result.error);
      execCounter.current = 0;
      setItems((prev) =>
        prev.map((i) => (isPending(i) ? { ...i, output: null, status: "idle", execCount: null, ranCode: null } : i))
      );
      setNotice({ type: "ok", text: "Kernel restarted. Earlier steps were replayed; your cells are kept but need to be run again." });
    } catch (e) {
      setNotice({ type: "error", text: `Restart failed: ${e.message}` });
    } finally {
      lock(false);
    }
  }, []);

  // ── 5. Commit: re-run top-to-bottom, then make it the app's dataset ──
  const commit = useCallback(
    async (encodingConfig) => {
      if (busyRef.current || !uploadData?.stored_as) return;
      const pending = itemsRef.current.filter((i) => isPending(i) && hasCode(i));
      if (!pending.length) {
        setNotice({ type: "info", text: "Nothing to commit yet. Write and run some code first." });
        return;
      }

      lock(true);
      try {
        let payload = retryCommitRef.current; // set when we come back from the encoding dialog
        if (!(payload && encodingConfig)) {
          // (a) "Restart & run all": proves your cells give the same result from a clean start.
          setNotice({ type: "info", text: "Checking that your cells run cleanly from top to bottom…" });
          await nextPaint();
          const rebuilt = await rebuildKernel(kernelRef.current);
          if (!rebuilt.ok) throw new Error(`Could not rebuild the earlier steps: ${rebuilt.error}`);

          execCounter.current = 0;
          for (const cell of pending) {
            patchCell(cell.id, { status: "running" });
            await nextPaint();
            const output = runPythonCell(cell.code);
            execCounter.current += 1;
            patchCell(cell.id, { status: output.ok ? "done" : "error", output, execCount: execCounter.current, ranCode: cell.code });
            if (!output.ok) {
              setNotice({ type: "error", text: "Commit cancelled: a cell failed when re-run from the top. Fix the red error and commit again." });
              return;
            }
          }
          const exported = exportDataFrame();
          if (!exported.ok) throw new Error(exported.error);
          payload = { csv: exported.csv, codes: pending.map((c) => c.code) };
        }
        retryCommitRef.current = payload;

        // (b) send to the backend
        setNotice({ type: "info", text: taskId ? "Committing and re-running preprocessing…" : "Committing…" });
        const data = await fetchJson(`/api/notebook/${encodeURIComponent(uploadData.stored_as)}/commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            csv_data: payload.csv,
            cells: payload.codes,
            encoding_config: encodingConfig || {},
            task_id: taskId || null,
          }),
        });

        if (data.status === "needs_encoding") {
          setEncodingData(data); // the dialog calls commit(config) again
          setNotice(null);
          return;
        }

        // (c) success → keep the kernel in sync with the saved history
        retryCommitRef.current = null;
        const state = await fetchJson(`/api/notebook/${encodeURIComponent(uploadData.stored_as)}/state`);
        const kernel = kernelRef.current;
        kernelRef.current = {
          ...kernel,
          codes: kernel.fallback
            ? [...kernel.codes, state.steps[state.steps.length - 1].code]
            : state.steps.slice(1).map((s) => s.code),
        };
        const resync = await rebuildKernel(kernelRef.current);
        const stepNo = state.steps.length - 1;
        const committedIds = new Set(pending.map((c) => c.id));
        setItems((prev) => {
          const marked = prev.map((i) =>
            committedIds.has(i.id) ? { ...i, committed: true, commitLabel: `Step ${stepNo}` } : i
          );
          return marked.some(isPending) ? marked : [...marked, newCell()];
        });
        initKeyRef.current = datasetKey(data.dataset); // don't rebuild when the parent passes the new dataset
        onCommitted?.(data);

        const extra = data.warnings?.length ? ` ${data.warnings.join(" ")}` : "";
        const mismatch = resync.ok && !sameShape(resync.info, state.expected) ? " (Warning: the rebuilt state differs slightly from the saved one.)" : "";
        setNotice({
          type: data.warnings?.length || mismatch ? "warn" : "ok",
          text: `Committed as Step ${stepNo}. The whole app now uses this dataset.${data.pipeline ? " Preprocessing and EDA were recomputed." : ""}${extra}${mismatch}`,
        });
      } catch (e) {
        retryCommitRef.current = null;
        setNotice({ type: "error", text: `Commit failed: ${e.message}` });
      } finally {
        lock(false);
      }
    },
    [uploadData, taskId, patchCell, onCommitted]
  );

  // ───────────── render ─────────────
  if (!isOpen) return null; // stays mounted while closed, so your cells are kept

  const pendingCount = items.filter((i) => isPending(i) && hasCode(i)).length;
  const ready = phase === "ready";
  const badge = { idle: "Idle", loading: "Loading…", ready: busy ? "Working…" : "Ready", error: "Error" }[phase];

  return (
    <div className="nb-root" onClick={(e) => e.stopPropagation()}>
      <header className="nb-topbar">
        <div className="nb-title">
          <span>🐍</span>
          <h3>Python Notebook</h3>
          <span className={`nb-badge nb-badge-${phase}`}>{badge}</span>
        </div>
        <div className="nb-toolbar">
          <button className="nb-btn" onClick={addCellAtEnd} disabled={!ready || busy}>＋ Code</button>
          <button className="nb-btn" onClick={restart} disabled={!ready || busy} title="Forget all variables and replay the earlier steps">
            ↻ Restart
          </button>
          <button
            className="nb-btn nb-btn-primary"
            onClick={() => commit()}
            disabled={!ready || busy || pendingCount === 0}
            title="Apply your new cells to the app's dataset"
          >
            ✓ Commit{pendingCount ? ` (${pendingCount})` : ""}
          </button>
          <button className="nb-close" onClick={onClose} title="Close (your cells are kept while the page stays open)">×</button>
        </div>
      </header>

      {notice && (
        <div className={`nb-notice nb-notice-${notice.type}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <main className="nb-scroll">
        <div className="nb-column">
          {ready && (
            <p className="nb-intro">
              The steps below already happened to your dataset. Your new cells continue from there.
              Press <b>Commit</b> to apply them to the whole app.
            </p>
          )}
          {items.map((item) =>
            item.kind === "step" ? (
              <StepBlock key={item.id} item={item} />
            ) : (
              <CodeCell
                key={item.id}
                cell={item}
                busy={busy}
                registerRef={registerRef}
                onChange={changeCode}
                onRun={runOneCell}
                onDelete={deleteCell}
                onAddBelow={addCellBelow}
              />
            )
          )}
          {ready && (
            <div className="nb-add-end">
              <button className="nb-btn" onClick={addCellAtEnd} disabled={busy}>＋ Add code cell</button>
            </div>
          )}
        </div>
      </main>

      <footer className="nb-footer">
        <span><kbd>Shift</kbd>+<kbd>Enter</kbd> run &amp; next</span>
        <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> run</span>
        <span><kbd>Tab</kbd> indent</span>
        <span>Your dataset's <b>last column is the target</b>; the app keeps it last.</span>
      </footer>

      {phase === "loading" && (
        <div className="nb-overlay">
          <div className="nb-spinner" />
          <div className="nb-overlay-title">{loadingMsg}</div>
          <div className="nb-overlay-sub">The first time takes a little while. After that it is instant.</div>
        </div>
      )}

      {phase === "error" && (
        <div className="nb-overlay">
          <div className="nb-overlay-title">Could not start the notebook</div>
          <pre className="nb-error nb-error-box">{fatalError}</pre>
          <div className="nb-toolbar">
            <button className="nb-btn nb-btn-primary" onClick={startInit}>Try again</button>
            <button className="nb-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      )}

      {encodingData && (
        <div className="proc-overlay" style={{ zIndex: 10003 }}>
          <div className="encoding-modal-content">
            <div className="encoding-modal-header">
              <h2>Configure Categorical Encoding</h2>
              <div className="encoding-progress-track">
                <div className="encoding-progress-fill" style={{ width: "100%" }} />
              </div>
            </div>
            <div className="encoding-modal-body">
              <EncodingModal
                cols={encodingData.unmapped_columns}
                catInfo={encodingData.cat_info}
                initialConfig={encodingData.temporary_state}
                isForgeEncoding={false}
                onConfirm={(newConfig) => {
                  const merged = { ...encodingData.temporary_state, ...newConfig };
                  setEncodingData(null);
                  commit(merged);
                }}
                onCancel={() => {
                  setEncodingData(null);
                  retryCommitRef.current = null;
                  setNotice({ type: "info", text: "Commit cancelled. Nothing was changed." });
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
