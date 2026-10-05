import React, { useState, useEffect, useRef } from 'react';

const SandboxCard = ({ taskId }) => {
  const [status, setStatus] = useState('Waiting for execution...');
  const [output, setOutput] = useState('');
  const pyodideRef = useRef(null);
  const editorRef = useRef(null);
  const monacoContainerRef = useRef(null);
  const monacoIdRef = useRef('monaco-container-' + Math.random().toString(36).slice(2, 8));

  useEffect(() => {
    // 1. Dynamically load Pyodide script
    if (!window.loadPyodide) {
      const existingScript = document.querySelector('script[src*="pyodide"]');
      if (!existingScript) {
        const pyScript = document.createElement('script');
        pyScript.src = 'https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js';
        document.body.appendChild(pyScript);
      }
    }

    // 2. Dynamically load RequireJS, then initialize Monaco Editor
    const initMonaco = () => {
      if (!window.require) return;
      window.require.config({
        paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.0/min/vs' },
      });
      window.require(['vs/editor/editor.main'], function () {
        const container = monacoContainerRef.current;
        if (!editorRef.current && container) {
          editorRef.current = window.monaco.editor.create(container, {
            value: "# Write custom Python code here.\n# The dataset is pre-loaded as 'df'.\n# e.g., print(df.head())\n",
            language: 'python',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
          });
        }
      });
    };

    if (!window.require) {
      const existingRq = document.querySelector('script[src*="require"]');
      if (!existingRq) {
        const rqScript = document.createElement('script');
        rqScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.6/require.min.js';
        rqScript.onload = initMonaco;
        document.body.appendChild(rqScript);
      } else {
        // require.js is being loaded but not ready yet
        existingRq.addEventListener('load', initMonaco);
      }
    } else {
      initMonaco();
    }

    // Cleanup to prevent memory leaks
    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  const initPyodide = async () => {
    if (pyodideRef.current) return true;
    if (!window.loadPyodide) {
      setStatus('Failed: Pyodide script not loaded yet. Try again.');
      return false;
    }
    
    try {
      setStatus('Loading Pyodide engine...');
      const pyodide = await window.loadPyodide({
        stdout: (msg) => setOutput((prev) => prev + msg + '\n')
      });
      
      setStatus('Loading Pandas & Matplotlib...');
      await pyodide.loadPackage(['pandas', 'matplotlib']);

      setStatus('Loading dataset...');
      const r = await fetch('/api/dataset/' + taskId);
      if (!r.ok) {
        setStatus('Failed: Could not fetch dataset. Complete EDA first.');
        return false;
      }
      const csvData = await r.text();
      pyodide.FS.writeFile('/dataset.csv', csvData);

      await pyodide.runPythonAsync(`
        import pandas as pd
        import matplotlib.pyplot as plt
        df = pd.read_csv('/dataset.csv')
      `);
      pyodideRef.current = pyodide;
      setStatus('Environment Ready ✓');
      return true;
    } catch (e) {
      setStatus('Failed to initialize Python environment');
      console.error(e);
      return false;
    }
  };

  const handleRunCode = async () => {
    if (!editorRef.current) return;
    
    const code = editorRef.current.getValue();
    setOutput('');
    setStatus('Preparing environment...');

    const isReady = await initPyodide();
    if (!isReady) return;

    try {
      setStatus('Running code...');
      await pyodideRef.current.runPythonAsync(code);
      setStatus('Execution Complete ✓');
    } catch (e) {
      setOutput((prev) => prev + '\nERROR: ' + e.message);
      setStatus('Execution Failed');
    }
  };

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(56,189,248,0.06), rgba(108,92,231,0.04))',
        padding: '20px',
        borderRadius: '12px',
        border: '1px solid rgba(56,189,248,0.2)',
        marginTop: '20px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ fontWeight: 700 }}>Interactive Sandbox</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Status: {status}</div>
      </div>
      <div
        ref={monacoContainerRef}
        style={{
          height: '250px',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid var(--border-subtle)',
        }}
      ></div>
      <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
        <button className="btn btn-ghost" onClick={handleRunCode}>Run Code</button>
      </div>
      {output && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            maxHeight: '300px',
            overflowY: 'auto'
          }}
        >
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{output}</pre>
        </div>
      )}
    </div>
  );
};

export default SandboxCard;