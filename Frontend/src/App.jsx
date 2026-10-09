import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import Header from "./components/Header";
import UploadView from "./components/UploadView";
import PreviewView from "./components/PreviewView";
import ProcView from "./components/ProcView";
import EncodingModal from "./components/EncodingModal";
import ChatAssistant from "./components/ChatAssistant";
import ElectricBorder from "./components/ElectricBorder";
import UndoRedoButton from "./components/UndoRedoButton";
import NotebookSandbox from "./components/NotebookSandbox";
import { ActionHistoryProvider, useActionHistory } from "./context/ActionHistoryContext";
import "./App.css";
import { loadRuntime, updateDataFrame } from "./notebook/pyodideRuntime";

// These two pages pull in Chart.js / Plotly (several MB). Loading them only when the
// user actually reaches the page makes the first screen load much faster.
const EdaView = lazy(() => import("./components/EdaView"));
const ResultsView = lazy(() => import("./components/ResultsView"));

function AppContent() {
  const [view, setView] = useState("v-upload");
  const [uploadData, setUploadData] = useState(null);
  const [mode, setMode] = useState("standard");
  const [taskId, setTaskId] = useState(null);
  const [procProgress, setProcProgress] = useState(0);
  const [procStep, setProcStep] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState(null);
  // Results-page model selection: null = show tournament champion;
  // otherwise holds the /api/model_details payload for the selected model
  const [selectedModelData, setSelectedModelData] = useState(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  const [encodingModalData, setEncodingModalData] = useState(null);
  const [encodingConfig, setEncodingConfig] = useState({});
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [syncLastModified, setSyncLastModified] = useState(0);
  const { recordAction } = useActionHistory();

  const handleFileUpload = async (file) => {
    if (!file.name.endsWith(".csv")) return alert("Only CSV files allowed.");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      setUploadData(data);
      setView("v-preview");
    } catch (e) {
      alert("Upload failed.");
    }
  };

  // ── Reversible Delete Column Handler ──
  const handleDeleteCol = async (colName) => {
    if (!uploadData) return;
    try {
      const res = await fetch("/api/delete_column", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stored_as: uploadData.stored_as,
          column_name: colName,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Failed to delete column.");
        return;
      }
      const data = await res.json();
      setUploadData(data);

      // Register reversible action into unified action history
      recordAction({
        type: "DATASET_DELETE_COL",
        description: `Deleted column "${colName}"`,
        page: "Dataset Preview",
        undo: async () => {
          const undoRes = await fetch("/api/undo_dataset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stored_as: uploadData.stored_as }),
          });
          if (undoRes.ok) {
            const restored = await undoRes.json();
            setUploadData(restored);
            setView("v-preview");
          }
        },
        redo: async () => {
          const redoRes = await fetch("/api/redo_dataset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stored_as: uploadData.stored_as }),
          });
          if (redoRes.ok) {
            const redone = await redoRes.json();
            setUploadData(redone);
            setView("v-preview");
          }
        },
      });
    } catch (e) {
      alert("Failed to delete column.");
    }
  };

  // ── Reversible Dtype Change Handler ──
  const handleDtypeChange = async (colName, newType) => {
    if (!uploadData || newType === "auto") return;
    try {
      const res = await fetch("/api/update_dtypes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stored_as: uploadData.stored_as,
          dtypes: { [colName]: newType },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Failed to update dtype.");
        return;
      }
      const data = await res.json();
      setUploadData(data);

      // Register reversible action into unified action history
      recordAction({
        type: "DATASET_UPDATE_DTYPE",
        description: `Changed column "${colName}" dtype to ${newType}`,
        page: "Dataset Preview",
        undo: async () => {
          const undoRes = await fetch("/api/undo_dataset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stored_as: uploadData.stored_as }),
          });
          if (undoRes.ok) {
            const restored = await undoRes.json();
            setUploadData(restored);
            setView("v-preview");
          }
        },
        redo: async () => {
          const redoRes = await fetch("/api/redo_dataset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stored_as: uploadData.stored_as }),
          });
          if (redoRes.ok) {
            const redone = await redoRes.json();
            setUploadData(redone);
            setView("v-preview");
          }
        },
      });
    } catch (e) {
      alert("Failed to update dtype.");
    }
  };

  // ── Reversible Dataset Reset Handler ──
  const handleResetDataset = async () => {
    if (!uploadData) return;
    try {
      const res = await fetch("/api/reset_dataset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stored_as: uploadData.stored_as }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Failed to reset dataset.");
        return;
      }
      const data = await res.json();
      setUploadData(data);

      recordAction({
        type: "DATASET_RESET",
        description: "Reset dataset back to original upload",
        page: "Dataset Preview",
        undo: async () => {
          const undoRes = await fetch("/api/undo_dataset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stored_as: uploadData.stored_as }),
          });
          if (undoRes.ok) {
            const restored = await undoRes.json();
            setUploadData(restored);
            setView("v-preview");
          }
        },
      });
    } catch (e) {
      alert("Failed to reset dataset.");
    }
  };

  // ── Reversible Mode Switch Handler ──
  const handleModeChange = (newMode) => {
    if (newMode === mode) return;
    const prevMode = mode;
    setMode(newMode);
    recordAction({
      type: "MODE_CHANGE",
      description: `Switched execution mode to ${newMode}`,
      page: "Dataset Preview",
      undo: () => setMode(prevMode),
      redo: () => setMode(newMode),
    });
  };

  const handleRunPipeline = async () => {
    try {
      const res = await fetch("/api/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stored_as: uploadData.stored_as }),
      });
      const data = await res.json();

      if (data.categorical_cols?.length > 0) {
        setEncodingModalData(data);
      } else {
        startExecution({});
      }
    } catch (e) {
      alert("Pipeline preparation failed.");
    }
  };

  const startExecution = async (encodingConfig) => {
    setEncodingModalData(null);
    setEncodingConfig(encodingConfig);
    
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stored_as: uploadData.stored_as,
          mode,
          encoding_config: encodingConfig,
        }),
      });
      
      if (!res.ok) throw new Error("Execution request failed");
      
      const data = await res.json();
      setTaskId(data.task_id);
      
      setElapsed(0); 
      setProcProgress(0);
      setProcStep("Initializing...");
      setView("v-proc");
      
    } catch (e) {
      alert("Execution failed.");
      setView("v-preview");
    }
  };

  // Handle Feature Forge update from EDA page
  const handleFeatureForgeUpdate = async (data) => {
    // Update results with new EDA payload and processed preview
    setResults((prev) => ({
      ...prev,
      dataset_analysis: data.dataset_analysis,
      processed_preview: data.processed_preview,
      eda_payload: data.eda_payload,
    }));
    // Update encoding config for future use
    if (data.dataset_analysis?.encoding_config) {
      setEncodingConfig(data.dataset_analysis.encoding_config);
    }
  };

  // Handle EDA recalculation from EDA page (after feature exclusions)
  const handleUpdateEda = (newEdaPayload) => {
    setResults((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        eda_payload: newEdaPayload,
        dataset_analysis: prev.dataset_analysis
          ? { ...prev.dataset_analysis, eda_payload: newEdaPayload }
          : { eda_payload: newEdaPayload },
      };
    });
  };

  // Select a model from the tournament leaderboard (results page).
  // Fetches that model's full result payload and swaps it into the page.
  const handleSelectModel = async (modelName) => {
    if (!modelName || isLoadingModel) return;
    if (selectedModelData && selectedModelData.name === modelName) return; // already showing
    const championName = results?.leaderboard?.[0]?.model;
    if (modelName === championName) {
      // Champion row — restore the default view
      setSelectedModelData(null);
      return;
    }
    setIsLoadingModel(true);
    try {
      const res = await fetch(`/api/model_details/${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to load model results");
      setSelectedModelData(data);
    } catch (e) {
      alert("Could not load this model: " + e.message);
    } finally {
      setIsLoadingModel(false);
    }
  };

  // Results shown on the results page: champion by default, selected model otherwise
  const displayResults =
    results && selectedModelData ? { ...results, best_model: selectedModelData } : results;

  // ── Python Notebook ──
  const handleOpenSandbox = () => {
    if (!uploadData) {
      alert("Please upload a dataset first before opening the notebook.");
      return;
    }
    setSandboxOpen(true);
  };

  const handleCloseSandbox = () => setSandboxOpen(false);

  // Called by the notebook after the backend accepted a commit.
  const handleNotebookCommit = (data) => {
    setUploadData(data.dataset); // the whole app now uses the committed dataset
    if (data.pipeline) {
      // The pipeline had already run: show the recomputed preprocessing + EDA.
      setResults((prev) => ({ ...prev, ...data.pipeline }));
    }

    // Same undo/redo mechanism as "Delete column": the backend keeps snapshots.
    const stored_as = data.dataset.stored_as;
    const callBackend = async (endpoint) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stored_as }),
      });
      if (res.ok) setUploadData(await res.json());
    };
    recordAction({
      type: "NOTEBOOK_COMMIT",
      description: data.dataset.last_action || "Notebook commit",
      page: "Dataset Preview",
      undo: () => callBackend("/api/undo_dataset"),
      redo: () => callBackend("/api/redo_dataset"),
    });
  };

  useEffect(() => {
    if (!taskId || view !== "v-proc") return;
    
    const interval = setInterval(async () => {
      setElapsed((prev) => prev + 2);
      
      try {
        const res = await fetch("/api/status/" + taskId);
        
        // Handle Server Restarts / Lost Tasks
        if (res.status === 404) {
          clearInterval(interval);
          alert("Session lost or server restarted. Please upload your file again.");
          setView("v-upload");
          return;
        }

        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        
        const data = await res.json();
        
        setProcProgress(data.progress || 0);
        setProcStep(data.step || "Processing...");

        if (data.status === "eda_complete") {
          clearInterval(interval);
          const resRes = await fetch("/api/results/" + taskId);
          const fullRes = await resRes.json();
          setResults(fullRes);
          setSelectedModelData(null);
          setView("v-eda");
        } else if (data.status === "complete") {
          clearInterval(interval);
          const resRes = await fetch("/api/results/" + taskId);
          const fullRes = await resRes.json();
          setResults(fullRes);
          setSelectedModelData(null);
          setView("v-results");
        } else if (data.status === "error" || data.status === "failed") {
          clearInterval(interval);
          alert(`Pipeline failed: ${data.message || data.error || "Check backend terminal for traceback"}`);
          setView("v-upload");
        }
      } catch (e) {
        console.error(e);
        clearInterval(interval);
        alert("Failed to connect to the server while checking status.");
        setView("v-upload");
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [taskId, view]);

  // ── Real-time sync: poll backend for dataset updates while sandbox is open ──
  useEffect(() => {
    if (!sandboxOpen || !uploadData?.stored_as) return;
    const stored_as = uploadData.stored_as;
    let lastKnown = syncLastModified;

    const poll = async () => {
      try {
        const res = await fetch(`/api/notebook/${stored_as}/sync`);
        const data = await res.json();
        if (data.last_modified && data.last_modified !== lastKnown) {
          setSyncLastModified(data.last_modified);
          // Update the Pyodide kernel's `df` in-place; user cells are preserved.
          // Note: pyodide may not be loaded yet on the first poll; the error is caught below.
          updateDataFrame(data.csv)
            .then((result) => {
              if (!result.ok) {
                console.warn("Failed to update df in Pyodide:", result.error);
              }
            })
            .catch((e) => {
              // pyodide not loaded yet or other error — will retry on next interval
              console.debug("Sync update deferred (pyodide not ready yet):", e.message);
            });
        }
      } catch (e) {
        console.error("Sync poll error:", e);
      }
    };

    poll(); // initial fetch
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [sandboxOpen, uploadData, syncLastModified]);

  const canNavigateTo = (stepId) => {
    if (stepId === "v-upload") return true;
    if (stepId === "v-preview") return Boolean(uploadData);
    if (stepId === "v-eda") return Boolean(results?.dataset_analysis || results?.eda_payload);
    if (stepId === "v-proc") return Boolean(taskId && procProgress > 0 && procProgress < 100);
    if (stepId === "v-results") return Boolean(results?.best_model);
    return false;
  };

  return (
    <>
      <div className="bg-mesh"></div>
      <div className="grid-overlay"></div>

      {!encodingModalData && <UndoRedoButton currentView={view} />}

      <div className="shell">
        {view === "v-upload" ? (
          <ElectricBorder>
            <Header onBack={() => setView("v-upload")} onOpenSandbox={handleOpenSandbox} uploadData={uploadData} sandboxOpen={sandboxOpen} />
            <UploadView onFileUpload={handleFileUpload} />
          </ElectricBorder>
        ) : (
          <Header onBack={() => setView("v-upload")} onOpenSandbox={handleOpenSandbox} uploadData={uploadData} sandboxOpen={sandboxOpen} />
        )}

        {view === "v-preview" && (
          <PreviewView
            uploadData={uploadData}
            mode={mode}
            setMode={handleModeChange}
            onDeleteCol={handleDeleteCol}
            onDtypeChange={handleDtypeChange}
            onRunPipeline={handleRunPipeline}
            onChangeFile={() => setView("v-upload")}
            onForwardToEda={() => setView("v-eda")}
            hasEdaResults={Boolean(results?.dataset_analysis || results?.eda_payload)}
          />
        )}

        <Suspense fallback={<div className="page-loading">Loading…</div>}>
        {view === "v-eda" && (
          <EdaView
            results={results}
            taskId={taskId}
            onBackToPreview={() => setView("v-preview")}
            onStartTournament={async (deletedFeatures = [], recipes = []) => {
              try {
                const res = await fetch("/api/train", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    task_id: taskId,
                    mode,
                    deleted_features: deletedFeatures,
                  }),
                });
                
                if (!res.ok) throw new Error();                                
                setElapsed(0);
                setProcProgress(0);
                setProcStep("Starting tournament...");
                setView("v-proc");
              } catch(e) {
                alert("Tournament failed to start.");
              }
            }}
            onFeatureForgeUpdate={handleFeatureForgeUpdate}
            encodingConfig={encodingConfig}
            onUpdateEda={handleUpdateEda}
          />
        )}

        {view === "v-proc" && (
          <ProcView
            progress={procProgress}
            step={procStep}
            elapsedTime={elapsed}
          />
        )}

        {view === "v-results" && (
          <ResultsView
            results={displayResults}
            onNewAnalysis={() => {
              setSelectedModelData(null);
              setView("v-upload");
            }}
            onBackToEda={() => setView("v-eda")}
            onBackToPreview={() => setView("v-preview")}
            onSelectModel={handleSelectModel}
            isLoadingModel={isLoadingModel}
            onDownload={() => {
              const blob = new Blob([JSON.stringify(results, null, 2)], {
                type: "application/json",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `report_${taskId}.json`;
              a.click();
            }}
          />
        )}
        </Suspense>

        {encodingModalData && (
          <EncodingModal
            cols={encodingModalData.categorical_cols}
            catInfo={encodingModalData.cat_info}
            initialConfig={encodingModalData.encoding_config}
            onConfirm={(newConfig) => startExecution(newConfig)}
            onCancel={() => setEncodingModalData(null)}
          />
        )}

        <NotebookSandbox
          isOpen={sandboxOpen}
          onClose={handleCloseSandbox}
          uploadData={uploadData}
          taskId={taskId}
          onCommitted={handleNotebookCommit}
        />
      </div>

      <ChatAssistant
        upload={uploadData}
        results={view === "v-results" ? displayResults : results}
        currentView={view}
      />
    </>
  );
}

export default function App() {
  return (
    <ActionHistoryProvider>
      <AppContent />
    </ActionHistoryProvider>
  );
}