import React, { createContext, useContext } from 'react';

const SandboxContext = createContext(null);

export function useSandbox() {
  return useContext(SandboxContext);
}

export function SandboxProvider({ 
  children, 
  taskId, 
  uploadData,
  currentResults,
  encodingConfig,
  onDatasetUpdate,
  onEncodingRequired
}) {
  const value = {
    taskId,
    uploadData,
    currentResults,
    encodingConfig,
    onDatasetUpdate,
    onEncodingRequired,
  };

  return (
    <SandboxContext.Provider value={value}>
      {children}
    </SandboxContext.Provider>
  );
}

export default SandboxContext;