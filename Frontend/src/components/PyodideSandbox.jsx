import React, { useState, useEffect, useRef } from 'react';
import EncodingModal from './EncodingModal';

const PyodideSandbox = ({ 
  isOpen, 
  onClose, 
  taskId: externalTaskId, 
  uploadData,
  currentResults,
  encodingConfig: contextEncodingConfig,
  onDatasetUpdate,
  onEncodingRequired 
}) => {
  const taskId = externalTaskId;
  const hasProcessedData = Boolean(taskId);
  const isNewSandbox = isOpen && !hasProcessedData && uploadData;
  const encodingConfig = contextEncodingConfig || {};
  
  const [status, setStatus] = useState('Initializing...');
  const [output, setOutput] = useState('');
  const [plots, setPlots] = useState([]);
  const [error, setError] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isCommitted, setIsCommitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [showOutputPanel, setShowOutputPanel] = useState(true);
  const [encodingModalData, setEncodingModalData] = useState(null);
  
  const pyodideRef = useRef(null);
  const editorRef = useRef(null);
  const monacoContainerRef = useRef(null);
  const saveIntervalRef = useRef(null);

  const DEFAULT_CODE = `# Auto-loaded DataFrame
# Type 'print(df.head())' to see data
# Access column info: df.columns, df.dtypes
# Try: df['new_col'] = df['Income'] - df['Expenses']

print("DataFrame loaded:", df.shape)
print("Columns:", list(df.columns))
`;

  useEffect(() => {
    if (isOpen && (taskId || uploadData)) {
      initSandbox();
    }
    
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, [isOpen, taskId, uploadData]);

  const initMonaco = () => {
    if (!window.require) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.6/require.min.js';
      script.onload = () => initMonaco();
      document.head.appendChild(script);
      return;
    }

    window.require.config({
      paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.0/min/vs' }
    });

    window.require(['vs/editor/editor.main'], () => {
      if (monacoContainerRef.current && !editorRef.current) {
        editorRef.current = window.monaco.editor.create(monacoContainerRef.current, {
          value: DEFAULT_CODE,
          language: 'python',
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: 'Fira Code, monospace',
          renderWhitespace: 'all',
          lineNumbers: 'on',
          roundedCursor: true,
          smoothScrolling: true,
        });
      }
    });
  };

  const setSandboxLoading = (step) => {
    setIsLoading(true);
    setLoadingStep(step);
  };

  const setSandboxReady = () => {
    setIsLoading(false);
    setLoadingStep('');
    setStatus('Environment Ready ✓');
  };

  const initSandbox = async () => {
    if (!taskId) {
      setStatus('Error: No task found. Complete EDA first.');
      return;
    }

    try {
      setSandboxLoading('Loading Pyodide engine...');
      
      if (!window.loadPyodide) {
        setStatus('Waiting for Pyodide to load...');
        await new Promise(resolve => {
          const check = () => {
            if (window.loadPyodide) resolve();
            else setTimeout(check, 100);
          };
          check();
        });
      }

      setSandboxLoading('Initializing Python environment...');
      
      const pyodide = await window.loadPyodide({
        stdout: (msg) => setOutput(prev => prev + msg + '\n'),
        stderr: (msg) => setOutput(prev => prev + msg + '\n')
      });
      pyodideRef.current = pyodide;

      setSandboxLoading('Loading pandas & matplotlib...');
      await pyodide.loadPackage(['pandas', 'matplotlib']);

      pyodide.runPython(`
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from io import StringIO
import base64
      `);

      setSandboxLoading('Loading dataset...');
      await loadDataset(pyodide);

      initMonaco();
      
      setSandboxReady();
      setOutput('');
      setError('');
    } catch (e) {
      console.error(e);
      setStatus('Initialization Failed');
      setError(e.message || 'Unknown error');
      setIsLoading(false);
    }
  };

  const loadDataset = async (pyodide) => {
    let response;
    
    if (taskId) {
      response = await fetch(`/api/dataset/${taskId}`);
      if (!response.ok) {
        throw new Error('Could not fetch dataset. Complete EDA first.');
      }
    } else if (uploadData && uploadData.stored_as) {
      response = await fetch(`/api/raw_dataset/${uploadData.stored_as}`);
      if (!response.ok) {
        throw new Error('Could not fetch raw dataset.');
      }
    } else {
      throw new Error('No dataset available. Run pipeline first.');
    }
    
    const csvData = await response.text();
    pyodide.FS.writeFile('/dataset.csv', csvData);

    await pyodide.runPythonAsync(`
import pandas as pd
import numpy as np
df = pd.read_csv('/dataset.csv')

import sys
main = sys.modules['__main__']
main.df = df
main.pd = pd
main.np = np

plt.ioff()
      `);

    await pyodide.runPythonAsync(`
original_dtypes = df.dtypes.to_dict()
print(f"Loaded {len(df)} rows × {len(df.columns)} columns")
      `);
  };

  const handleRunCode = async () => {
    if (!editorRef.current || !pyodideRef.current) return;
    
    const code = editorRef.current.getValue();
    setIsRunning(true);
    setOutput('');
    setError('');
    setPlots([]);

    try {
      setStatus('Executing code...');
      
      await pyodideRef.current.runPythonAsync(code + '\n');

      const plotsResult = await pyodideRef.current.runPythonAsync(`
import json
from io import StringIO
import base64
import matplotlib.pyplot as plt

new_plots = []
for i in plt.get_fignums():
    try {
        fig = plt.get_fig(i)
        buf = StringIO()
        fig.savefig(buf, format='png', dpi=80, bbox_inches='tight')
        buf.seek(0)
        img_str = base64.b64encode(buf.read()).decode('utf-8')
        new_plots.append(img_str)
        plt.close(fig)
    except:
        pass

plt.ioff()
json.dumps(new_plots)
      `);
      
      const plotList = JSON.parse(plotsResult);
      if (plotList.length > 0) {
        setPlots(plotList);
      }

      setStatus('Execution Complete ✓');
    } catch (e) {
      setError(e.message || 'Execution error');
      setOutput(prev => prev + '\n' + (e.message || 'Unknown error'));
      setStatus('Execution Failed');
    } finally {
      setIsRunning(false);
    }
  };

  const extractModifiedDf = async () => {
    if (!pyodideRef.current) return null;
    
    try {
      const csvStr = await pyodideRef.current.runPythonAsync(`df.to_csv(index=False)`);
      return csvStr;
    } catch (e) {
      console.error('Failed to extract dataframe:', e);
      return null;
    }
  };

  const handleCommit = async () => {
    if (!pyodideRef.current || !taskId) return;
    
    setIsRunning(true);
    setStatus('Committing changes...');
    
    try {
      const csvData = await extractModifiedDf();
      if (!csvData) {
        setError('Failed to extract modified dataset');
        return;
      }
      
      const response = await fetch(`/api/sync_notebook_dataset/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csvData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Commit failed');
      }

      const result = await response.json();
      
      if (result.status === 'needs_encoding') {
        setStatus('Encoding Required');
        setEncodingModalData({
          unmapped_columns: result.unmapped_columns,
          cat_info: result.cat_info,
          temporary_state: result.temporary_state,
        });
        return;
      }

      setStatus('Changes Committed ✓');
      setIsCommitted(true);
      
      if (onDatasetUpdate) {
        onDatasetUpdate(result);
      }
      
      if (result.eda_payload) {
        alert('EDA refreshed with your dataset changes.');
      }
    } catch (e) {
      console.error(e);
      setError(e.message);
      setStatus('Commit Failed');
    } finally {
      setIsRunning(false);
    }
  };

  const handleEncodingConfirm = async (newConfig) => {
    const mergedConfig = {
      ...encodingModalData.temporary_state,
      ...newConfig
    };
    
    setEncodingModalData(null);
    setStatus('Finalizing commit...');
    
    try {
      const csvData = await extractModifiedDf();
      if (!csvData) {
        setError('Failed to extract modified dataset');
        return;
      }
      
      const response = await fetch(`/api/sync_notebook_dataset/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          csv_data: csvData,
          encoding_config: mergedConfig 
        })
      });

      const result = await response.json();
      
      if (response.ok && result.status === 'success') {
        setStatus('Changes Committed ✓');
        setIsCommitted(true);
        
        if (onDatasetUpdate) {
          onDatasetUpdate(result);
        }
        alert('Dataset synchronized with encoding applied.');
      } else {
        setError(result.detail || 'Encoding commit failed');
      }
    } catch (e) {
      setError(e.message || 'Encoding commit error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleReset = () => {
    setOutput('');
    setPlots([]);
    setError('');
    setEncodingModalData(null);
    setIsCommitted(false);
    setStatus('Environment Ready ✓');
  };

  const toggleOutputPanel = () => {
    setShowOutputPanel(!showOutputPanel);
  };

  if (!isOpen && !encodingModalData) return null;

  // Loading overlay styles
  const loadingOverlayStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(10, 15, 25, 0.9)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    transition: 'opacity 0.3s ease',
  };

  const loadingContentStyle = {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  };

  const spinnerStyle = {
    width: '56px',
    height: '56px',
    border: '3px solid #374151',
    borderTopColor: '#06b6d4',
    borderRadius: '50%',
    animation: 'sandbox-spin 1s linear infinite',
    boxShadow: '0 0 20px rgba(6, 182, 212, 0.2)',
  };

  const containerStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'linear-gradient(135deg, rgba(10, 15, 25, 0.95), rgba(16, 22, 33, 0.97))',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    background: 'rgba(10, 15, 25, 0.85)',
    borderBottom: '1px solid #374151',
    color: '#f8fafc',
    flexShrink: 0,
    backdropFilter: 'blur(10px)',
  };

  const titleSectionStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  };

  const statusBadgeStyle = {
    background: 'rgba(6, 182, 212, 0.15)',
    border: '1px solid rgba(6, 182, 212, 0.3)',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#06b6d4',
    whiteSpace: 'nowrap',
  };

  const mainStyle = {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
  };

  const editorSectionStyle = {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minWidth: 0,
  };

  const toolbarStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: 'rgba(10, 15, 25, 0.6)',
    borderBottom: '1px solid #374151',
    flexShrink: 0,
  };

  const toolbarInfoStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const botBtnStyle = (primary = false) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    background: primary 
      ? 'linear-gradient(135deg, #059669 0%, #0d9488 100%)'
      : 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
    whiteSpace: 'nowrap',
    opacity: isRunning ? 0.5 : 1,
  });

  const botStyle = {
    flex: 1,
    background: '#1e1e1e',
    overflow: 'hidden',
  };

  const outputSectionStyle = {
    display: 'flex',
    flexDirection: 'column',
    width: '380px',
    minWidth: '320px',
    background: 'rgba(16, 22, 33, 0.7)',
    borderLeft: '1px solid #374151',
    flexShrink: 0,
  };

  const outputHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: 'rgba(10, 15, 25, 0.8)',
    borderBottom: '1px solid #374151',
    flexShrink: 0,
  };

  const toggleBtnStyle = {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '1.2rem',
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  };

  const outputContainerStyle = {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const plotsSectionStyle = {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
  };

  const plotCardStyle = {
    background: '#fff',
    borderRadius: '8px',
    padding: '8px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
  };

  const consoleStyle = {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    background: 'rgba(0, 0, 0, 0.3)',
  };

  const errorSectionStyle = {
    padding: '10px 14px',
    background: 'rgba(245, 158, 116, 0.08)',
    borderTop: '1px solid rgba(245, 158, 116, 0.3)',
    flexShrink: 0,
  };

  return (
    <>
      {/* Add keyframes animation for sandbox spinner */}
      <style>{`
        @keyframes sandbox-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      
      {!isOpen ? (
        <div className="proc-overlay">
          <div className="encoding-modal-content">
            <div className="encoding-modal-header">
              <h2>Configure Categorical Encoding</h2>
              <div className="encoding-progress-track">
                <div
                  className="encoding-progress-fill"
                  style={{ width: '100%' }}
                ></div>
              </div>
            </div>
            <div className="encoding-modal-body">
              <EncodingModal
                cols={encodingModalData?.unmapped_columns}
                catInfo={encodingModalData?.cat_info}
                initialConfig={encodingModalData?.temporary_state}
                onConfirm={handleEncodingConfirm}
                onCancel={() => setEncodingModalData(null)}
                isForgeEncoding={false}
              />
            </div>
          </div>
        </div>
      ) : (
        <div style={containerStyle} onClick={e => e.stopPropagation()}>
          {/* Status Bar */}
          <div style={headerStyle}>
            <div style={titleSectionStyle}>
              <h3 style={{ margin: 0, fontWeight: 600, fontSize: '1.1rem' }}>Interactive Python Sandbox</h3>
              <span style={statusBadgeStyle}>{status}</span>
            </div>
            <button 
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '1.8rem',
                padding: 0,
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                margin: 0,
              }}
              title="Close Sandbox"
            >
              ×
            </button>
          </div>

          {/* Loading Overlay */}
          {isLoading && (
            <div style={loadingOverlayStyle}>
              <div style={loadingContentStyle}>
                <div style={spinnerStyle}></div>
                <div style={{ 
                  color: '#f8fafc', 
                  fontSize: '1.1rem', 
                  fontWeight: 600,
                  fontFamily: 'Inter, system-ui, sans-serif'
                }}>{loadingStep}</div>
                <div style={{ 
                  color: '#94a3b8', 
                  fontSize: '0.85rem',
                  fontFamily: 'JetBrains Mono, Fira Code, monospace'
                }}>
                  Please wait while the Python environment initializes...
                </div>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div style={mainStyle}>
            {/* Left Side - Code Editor */}
            <div style={editorSectionStyle}>
              <div style={toolbarStyle}>
                <div style={toolbarInfoStyle}>
                  <span style={{
                    background: 'rgba(6, 182, 212, 0.15)',
                    color: '#06b6d4',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                  }}>Python</span>
                  <span style={{ 
                    color: '#94a3b8', 
                    fontSize: '0.75rem' 
                  }}>workspace.py</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    style={botBtnStyle(true)}
                    onClick={handleRunCode}
                    disabled={isRunning || !pyodideRef.current || isLoading}
                    title="Run Code (Ctrl+Enter)"
                  >
                    {isRunning ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          background: '#06b6d4',
                          borderRadius: '50%',
                          animation: 'pulse 1.2s ease-in-out infinite',
                        }}></span>
                        Running...
                      </span>
                    ) : (
                      <span>▶ Run</span>
                    )}
                  </button>
                  <button
                    style={botBtnStyle(false)}
                    onClick={handleCommit}
                    disabled={isRunning || !pyodideRef.current || isLoading}
                    title="Commit changes to dataset"
                  >
                    {isCommitted ? '✓ Saved' : '💾 Commit'}
                  </button>
                  <button
                    style={{
                      background: 'transparent',
                      color: '#94a3b8',
                      border: '1px solid #374151',
                      borderRadius: '6px',
                      padding: '8px 14px',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onClick={handleReset}
                    disabled={isRunning}
                    title="Reset output"
                  >
                    🔄 Reset
                  </button>
                </div>
              </div>

              <div
                ref={monacoContainerRef}
                style={bot}
              />
            </div>

            {/* Right Side - Output Panel */}
            {showOutputPanel && (
              <div style={outputSectionStyle}>
                <div style={outputHeaderStyle}>
                  <span>Output</span>
                  <button 
                    onClick={toggleOutputPanel}
                    style={toggleBtnStyle}
                    title="Toggle Output Panel"
                  >
                    {showOutputPanel ? '←' : '→'}
                  </button>
                </div>
                
                <div style={outputContainerStyle}>
                  {plots.length > 0 && (
                    <div style={plotsSectionStyle}>
                      <div style={{ 
                        color: '#94a3b8', 
                        fontSize: '0.7rem', 
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: '10px',
                        paddingBottom: '8px',
                        borderBottom: '1px solid #374151',
                      }}>Matplotlib Plots</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {plots.map((plot, idx) => (
                          <div key={idx} style={plotCardStyle}>
                            <img
                              src={`data:image/png;base64,${plot}`}
                              alt={`Plot ${idx + 1}`}
                              style={{
                                maxWidth: '100%',
                                height: 'auto',
                                borderRadius: '6px',
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div style={consoleStyle}>
                    <pre style={{
                      margin: 0,
                      fontFamily: 'JetBrains Mono, Fira Code, monospace',
                      fontSize: '0.75rem',
                      lineHeight: 1.9,
                      color: '#6ee7b7',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {output || 'Output will appear here...'}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Error Section */}
          {error && !isCommitted && (
            <div style={errorSectionStyle}>
              <div style={{ 
                color: '#f97316', 
                fontWeight: 600,
                fontSize: '0.85rem',
                marginBottom: '4px',
              }}>⚠️ Error</div>
              <div style={{ 
                color: '#f97316',
                fontFamily: 'JetBrains Mono, Fira Code, monospace',
                fontSize: '0.75rem',
                whiteSpace: 'pre-wrap',
              }}>
                {error}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default PyodideSandbox;