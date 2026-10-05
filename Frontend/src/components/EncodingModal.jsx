import React, { useState, useEffect, useRef } from "react";
import CustomSelect from "./CustomSelect";

const EncodingModal = ({ cols, catInfo, onConfirm, onCancel, initialConfig = {}, isForgeEncoding = false }) => {
  const [index, setIndex] = useState(0);
  const [config, setConfig] = useState({});
  const [history, setHistory] = useState([]);
  const [draggedIdx, setDraggedIdx] = useState(null);

  // Capture initialConfig on mount only; the default {} prop changes identity
  // every render and would re-trigger this effect, wiping out user changes
  // (e.g. switching to Ordinal Encoding) right after they are made.
  const initialConfigRef = useRef(initialConfig);

  useEffect(() => {
    const initial = {};
    cols.forEach((c) => {
      if (initialConfigRef.current[c]) {
        initial[c] = { ...initialConfigRef.current[c] };
      } else {
        initial[c] = {
          type: "onehot",
          order: catInfo[c] ? [...catInfo[c]] : [],
        };
      }
    });
    setConfig(initial);
  }, [cols, catInfo]);

  const undoModal = () => {
    if (history.length === 0) return;
    const prevConfig = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setConfig(prevConfig);
  };

  const currCol = cols[index];
  if (!currCol) return null;

  const handleSelect = (type) => {
    setHistory((prev) => [...prev, config]);
    setConfig((prev) => ({
      ...prev,
      [currCol]: {
        ...prev[currCol],
        type,
        // Ensure order array exists if switched to ordinal
        order: prev[currCol]?.order?.length
          ? prev[currCol].order
          : [...(catInfo[currCol] || [])],
      },
    }));
  };

  // Drag and Drop Handlers for Ordinal Reordering
  const handleDragStart = (e, i) => {
    setDraggedIdx(i);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, i) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === i) return;

    const currentOrder = [...(config[currCol]?.order || [])];
    const draggedItem = currentOrder[draggedIdx];

    // Swap items in state array
    currentOrder.splice(draggedIdx, 1);
    currentOrder.splice(i, 0, draggedItem);

    setDraggedIdx(i);
    setHistory((prev) => [...prev, config]);
    setConfig((prev) => ({
      ...prev,
      [currCol]: { ...prev[currCol], order: currentOrder },
    }));
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
  };

  // Manual Arrow Button Move Handlers (as fallback/accessible alternative)
  const moveItem = (fromIdx, toIdx) => {
    const currentOrder = [...(config[currCol]?.order || [])];
    const item = currentOrder.splice(fromIdx, 1)[0];
    currentOrder.splice(toIdx, 0, item);
    setHistory((prev) => [...prev, config]);
    setConfig((prev) => ({
      ...prev,
      [currCol]: { ...prev[currCol], order: currentOrder },
    }));
  };

  const encodingOptions = [
    { value: "onehot", label: "N-1 Hot Encoding" },
    { value: "ordinal", label: "Ordinal Encoding" },
    { value: "target", label: "Target Encoding" },
  ];

  const isOrdinal = config[currCol]?.type === "ordinal";
  const currentCategoryOrder = config[currCol]?.order || catInfo[currCol] || [];

  return (
    <div className="proc-overlay" id="encoding-modal">
      <div className="encoding-modal-content">
        <div className="encoding-modal-header">
          <h2>Configure Encoding</h2>
          <div className="encoding-progress-track">
            <div
              className="encoding-progress-fill"
              style={{ width: `${((index + 1) / cols.length) * 100}%` }}
            ></div>
          </div>
        </div>

        <div className="encoding-modal-body">
          <div className="cat-col-card">
            <div
              style={{
                fontWeight: 700,
                fontSize: "1.1rem",
                marginBottom: "8px",
              }}
            >
              {currCol}
            </div>

            {/* Default Tag Preview List (Shown when not in Ordinal Mode) */}
            {/* Fixed preview list structure */}
            {!isOrdinal && (
              <div className="cat-values-list">
                {(catInfo[currCol] || []).map((v, i) => (
                  <span key={`${v}-${i}`} className="cat-value-tag">
                    {v}
                  </span>
                ))}
              </div>
            )}

            <label
              style={{
                fontSize: "0.75rem",
                color: "var(--text-tertiary)",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Encoding Method
            </label>

            <CustomSelect
              value={config[currCol]?.type || "onehot"}
              options={encodingOptions}
              onChange={handleSelect}
            />

            {/* --- Drag & Drop Reorder Section for Ordinal Encoding --- */}
            {isOrdinal && (
              <div className="ordinal-order-section">
                <div className="ordinal-hint">
                  Drag items or use arrows to set priority order (Top = Lowest,
                  Bottom = Highest):
                </div>

                <div className="ordinal-drag-list">
                  {currentCategoryOrder.map((cat, idx) => (
                    <div
                      key={cat}
                      className={`ordinal-drag-item ${draggedIdx === idx ? "is-dragging" : ""}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="drag-handle">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <circle cx="9" cy="5" r="1" />
                          <circle cx="9" cy="12" r="1" />
                          <circle cx="9" cy="19" r="1" />
                          <circle cx="15" cy="5" r="1" />
                          <circle cx="15" cy="12" r="1" />
                          <circle cx="15" cy="19" r="1" />
                        </svg>
                        <span className="ordinal-rank-badge">{idx + 1}</span>
                        <span className="ordinal-cat-name">{cat}</span>
                      </div>

                      <div className="ordinal-actions">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveItem(idx, idx - 1)}
                          className="btn-order-step"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          disabled={idx === currentCategoryOrder.length - 1}
                          onClick={() => moveItem(idx, idx + 1)}
                          className="btn-order-step"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="encoding-modal-footer">
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            {history.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={undoModal}
                style={{ color: "var(--accent-1)", borderColor: "rgba(0, 255, 128, 0.3)" }}
                title="Undo last change in this step"
              >
                ↶ Undo
              </button>
            )}
          </div>
          <div>
            {index > 0 && (
              <button
                className="btn btn-ghost"
                onClick={() => setIndex((i) => i - 1)}
                style={{ marginRight: "8px" }}
              >
                Previous
              </button>
            )}
            {index < cols.length - 1 ? (
              <button
                className="btn btn-accent"
                onClick={() => setIndex((i) => i + 1)}
              >
                Continue
              </button>
            ) : (
              <button
                className="btn btn-teal"
                onClick={() => onConfirm(config)}
              >
                {isForgeEncoding ? 'Apply Encoding' : 'Start Processing'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EncodingModal;
