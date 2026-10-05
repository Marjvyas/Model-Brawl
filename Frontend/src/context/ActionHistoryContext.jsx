import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const ActionHistoryContext = createContext(null);

export const ActionHistoryProvider = ({ children }) => {
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [currentPage, setCurrentPage] = useState("");

  const recordAction = useCallback((action) => {
    // action: { type, description, page, undo: async () => void, redo?: async () => void }
    const actionWithMeta = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ...action,
    };

    setUndoStack((prev) => [...prev, actionWithMeta]);
    setRedoStack([]); // Clear redo branch on new action
  }, []);

  const undo = useCallback(async () => {
    const pageUndoStack = undoStack.filter((a) => a.page === currentPage);
    if (pageUndoStack.length === 0) return;

    const actionToUndo = pageUndoStack[pageUndoStack.length - 1];
    setUndoStack((prev) => prev.filter((a) => a.id !== actionToUndo.id));

    try {
      if (typeof actionToUndo.undo === "function") {
        await actionToUndo.undo();
      }
      setRedoStack((prev) => [...prev, actionToUndo]);
    } catch (err) {
      console.error("Undo failed:", err);
    }
  }, [undoStack, currentPage]);

  const redo = useCallback(async () => {
    const pageRedoStack = redoStack.filter((a) => a.page === currentPage);
    if (pageRedoStack.length === 0) return;

    const actionToRedo = pageRedoStack[pageRedoStack.length - 1];
    setRedoStack((prev) => prev.filter((a) => a.id !== actionToRedo.id));

    try {
      if (typeof actionToRedo.redo === "function") {
        await actionToRedo.redo();
      }
      setUndoStack((prev) => [...prev, actionToRedo]);
    } catch (err) {
      console.error("Redo failed:", err);
    }
  }, [redoStack, currentPage]);

  // Filter stacks by current page
  const pageUndoStack = undoStack.filter((a) => a.page === currentPage);
  const pageRedoStack = redoStack.filter((a) => a.page === currentPage);

  // Global Keyboard Shortcuts (Ctrl+Z / Cmd+Z for undo, Ctrl+Y / Shift+Ctrl+Z for redo)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable)
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  const value = {
    canUndo: pageUndoStack.length > 0,
    canRedo: pageRedoStack.length > 0,
    undoStack: pageUndoStack,
    redoStack: pageRedoStack,
    lastAction: pageUndoStack.length > 0 ? pageUndoStack[pageUndoStack.length - 1] : null,
    nextRedoAction: pageRedoStack.length > 0 ? pageRedoStack[pageRedoStack.length - 1] : null,
    recordAction,
    undo,
    redo,
    currentPage,
    setCurrentPage,
  };

  return (
    <ActionHistoryContext.Provider value={value}>
      {children}
    </ActionHistoryContext.Provider>
  );
};

export const useActionHistory = () => {
  const context = useContext(ActionHistoryContext);
  if (!context) {
    throw new Error("useActionHistory must be used within an ActionHistoryProvider");
  }
  return context;
};
