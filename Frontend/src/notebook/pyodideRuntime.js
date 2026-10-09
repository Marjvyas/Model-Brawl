// ─────────────────────────────────────────────────────────────────────────────
//  pyodideRuntime.js  -  the bridge between React and the Python "kernel"
//
//  Pyodide = the real Python interpreter compiled to WebAssembly, so Python can
//  run inside the browser tab. We load it ONCE (it is big) and keep it for the
//  whole session; re-opening the notebook is then instant.
//
//  The Python side of the bridge is nb_runtime.py (next to this file).
// ─────────────────────────────────────────────────────────────────────────────
import RUNTIME_PY from "./nb_runtime.py?raw"; // "?raw" = import the file's text

// Change this ONE line to upgrade Pyodide (newer versions ship newer pandas).
const PYODIDE_VERSION = "0.23.4";
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let runtimePromise = null; // the one shared loading job
let pyodide = null; //        the Python engine, once loaded

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.loadPyodide) return resolve();
    const tag = document.createElement("script");
    tag.src = src;
    tag.onload = resolve;
    tag.onerror = () =>
      reject(new Error("Could not download the Python engine. Check your internet connection."));
    document.head.appendChild(tag);
  });
}

/** Download + start Python (only the first call does real work). */
export function loadRuntime(onStatus = () => {}) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      onStatus("Downloading the Python engine…");
      await loadScript(PYODIDE_URL + "pyodide.js");
      pyodide = await window.loadPyodide({ indexURL: PYODIDE_URL });
      onStatus("Loading pandas & matplotlib…");
      await pyodide.loadPackage(["pandas", "matplotlib"]);
      pyodide.runPython(RUNTIME_PY); // defines nb_reset, nb_run_cell, ... inside Python
      return pyodide;
    })().catch((error) => {
      runtimePromise = null; // allow a retry after a failure
      throw error;
    });
  }
  return runtimePromise;
}

/** Call a Python function from nb_runtime.py and parse the JSON it returns. */
function callPython(name, ...args) {
  if (!pyodide) throw new Error("The Python engine is not loaded yet.");
  const fn = pyodide.globals.get(name);
  try {
    return JSON.parse(fn(...args));
  } finally {
    fn.destroy(); // free the JS<->Python proxy
  }
}

/** Python blocks the page while it runs, so let React paint first (e.g. a spinner). */
export const nextPaint = () =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * Throw the kernel away and rebuild it:  fresh `df` from baseCsv,
 * then re-run every earlier step's code in order ("replay").
 * Returns { ok, info } or { ok:false, failedIndex, error }.
 */
export async function rebuildKernel({ baseCsv, codes }) {
  callPython("nb_reset", baseCsv);
  for (let i = 0; i < codes.length; i++) {
    const result = callPython("nb_run_cell", codes[i], false); // false = don't collect output
    if (!result.ok) {
      return { ok: false, failedIndex: i, error: `${result.error.name}: ${result.error.message}` };
    }
    await nextPaint();
  }
  return { ok: true, info: callPython("nb_df_info") };
}

/** Run ONE cell in the current kernel. Returns { ok, stdout, stderr, result, images, error ... } */
export function runCell(code) {
  return callPython("nb_run_cell", code, true);
}

/** The kernel's current `df` as CSV. Returns { ok, csv } or { ok:false, error } */
export function exportDataFrame() {
  return callPython("nb_export_df");
}

/** Update the kernel's `df` from CSV text, preserving other variables. */
export function updateDataFrame(csv_text) {
  return callPython("nb_update_df", csv_text);
}
