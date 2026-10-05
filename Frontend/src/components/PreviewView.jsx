import React from "react";
import CustomSelect from "./CustomSelect";

const PreviewView = ({
  uploadData,
  mode,
  setMode,
  onDeleteCol,
  onDtypeChange,
  onRunPipeline,
  onChangeFile,
  onForwardToEda,
  hasEdaResults,
}) => {
  if (!uploadData) return null;

  return (
    <section className="view is-active">
      <div className="card preview-wrap">
        <div className="section-label">Dataset Summary</div>
        <div className="kpi-row">
          <div className="kpi">
            <div className="kpi-label">Filename</div>
            <div className="kpi-value sm">{uploadData.filename}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Rows</div>
            <div className="kpi-value">{uploadData.rows.toLocaleString()}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Columns</div>
            <div className="kpi-value">{uploadData.columns}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Target</div>
            <div className="kpi-value sm">{uploadData.target_column}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Memory</div>
            <div className="kpi-value">{uploadData.memory_usage_kb} KB</div>
          </div>
        </div>

        <div className="section-label" style={{ marginTop: "20px" }}>
          Column Details
        </div>
        <div className="tbl-wrap" style={{ maxHeight: "240px" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Column</th>
                <th>Type</th>
                <th>Nulls</th>
                <th>Unique</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {uploadData.column_info.map((c, i) => {
                const isTarget = c.name === uploadData.target_column;
                return (
                  <tr key={c.name}>
                    <td>{i + 1}</td>
                    <td
                      style={{ color: "var(--text-primary)", fontWeight: 500 }}
                    >
                      {c.name}{" "}
                      {isTarget && <span className="target-tag">target</span>}
                    </td>
                    <td>
                      <CustomSelect
                        value={c.overrideDtype || "auto"} // Fallback to "auto" if no override is set
                        options={[
                          { value: "auto", label: `Auto (${c.dtype})` },
                          { value: "numeric", label: "Numeric" },
                          { value: "string", label: "String" },
                        ]}
                        onChange={(val) => onDtypeChange(c.name, val)}
                      />
                    </td>
                    <td className={c.null_count ? "null-warn" : ""}>
                      {c.null_count}
                    </td>
                    <td>{c.unique_count}</td>
                    <td>
                      {!isTarget && (
                        <button
                          className="btn-del"
                          title="Delete Column"
                          onClick={() => onDeleteCol(c.name)}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Data Head Preview (first 5 rows) */}
        {uploadData.preview_rows && uploadData.preview_rows.length > 0 && (
          <>
            <div className="section-label" style={{ marginTop: "20px" }}>
              Data Preview (Head)
            </div>
            <div className="tbl-wrap" style={{ maxHeight: "280px", overflowY: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    {Object.keys(uploadData.preview_rows[0]).map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uploadData.preview_rows.map((row, idx) => (
                    <tr key={idx}>
                      {Object.values(row).map((val, i) => (
                        <td key={i}>
                          {val !== null && val !== undefined
                            ? val.toString()
                            : "NaN"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="section-label" style={{ marginTop: "20px" }}>
          Execution Mode
        </div>
        <div className="mode-selector">
          <div className="mode-toggle-wrap">
            <div
              className={`mode-slider ${mode === "exhaustive" ? "right" : ""}`}
            ></div>
            <div
              className={`mode-opt ${mode === "standard" ? "is-active" : ""}`}
              onClick={() => setMode("standard")}
            >
              <span className="mode-opt-title">
                Standard <span className="mode-badge badge-fast">FAST</span>
              </span>
              <span className="mode-opt-desc">
                Smart CV degradation for speed
              </span>
            </div>
            <div
              className={`mode-opt ${mode === "exhaustive" ? "is-active" : ""}`}
              onClick={() => setMode("exhaustive")}
            >
              <span className="mode-opt-title">
                Exhaustive{" "}
                <span className="mode-badge badge-precise">PRECISE</span>
              </span>
              <span className="mode-opt-desc">Full 5-Fold CV on all data</span>
            </div>
          </div>
        </div>

        <div className="action-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <button className="btn btn-ghost" onClick={onChangeFile}>
            Change File
          </button>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {hasEdaResults && onForwardToEda && (
              <button className="btn btn-ghost" onClick={onForwardToEda} style={{ borderColor: "rgba(0, 240, 255, 0.4)", color: "var(--accent-2)" }}>
                View Data Insights →
              </button>
            )}
            <button className="btn btn-accent" onClick={onRunPipeline}>
              Run Pipeline
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PreviewView;
