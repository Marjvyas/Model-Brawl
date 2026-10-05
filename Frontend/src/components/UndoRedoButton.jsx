import React, { useEffect } from "react";
import { useActionHistory } from "../context/ActionHistoryContext";
import "./UndoRedoButton.css";

export default function UndoRedoButton({ currentView }) {
  const { canUndo, canRedo, undo, redo, lastAction, nextRedoAction, setCurrentPage } = useActionHistory();

  // Map view state to page name (matches the `page` field in recorded actions)
  useEffect(() => {
    const pageMap = {
      "v-upload": "",
      "v-preview": "Dataset Preview",
      "v-eda": "Data Insights",
      "v-proc": "Processing",
      "v-results": "Results",
    };
    setCurrentPage(pageMap[currentView] || "");
  }, [currentView, setCurrentPage]);

  // Only show if there are page-specific actions
  if (!canUndo && !canRedo) {
    return null;
  }

  // Show undo OR redo (swap), not both
  if (canUndo) {
    return (
      <div className="undo-redo-floating-container">
        <button
          className="undo-redo-btn undo-btn"
          onClick={undo}
          title={lastAction?.description ? `Undo: ${lastAction.description} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          <span>Undo</span>
        </button>
      </div>
    );
  }

  // Only show redo if undo was performed (canUndo is false but canRedo is true)
  return (
    <div className="undo-redo-floating-container">
      <button
        className="undo-redo-btn redo-btn"
        onClick={redo}
        title={nextRedoAction?.description ? `Redo: ${nextRedoAction.description} (Ctrl+Y)` : "Redo (Ctrl+Y)"}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        <span>Redo</span>
      </button>
    </div>
  );
}
