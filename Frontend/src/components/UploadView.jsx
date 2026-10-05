import React, { useState, useRef } from 'react';
import './FileUpload.css';

function UploadView({ onFileUpload }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const inputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files[0]);
    }
  };

  const handleFiles = (file) => {
    if (!file.name.endsWith('.csv')) {
      alert('Please upload a valid .csv file.');
      return;
    }

    setSelectedFile(file);

    // Call the parent handler to upload to FastAPI and transition views
    if (onFileUpload) {
      onFileUpload(file);
    }
  };

  const onCardClick = () => {
    if (!selectedFile && inputRef.current) {
      inputRef.current.click();
    }
  };

  const removeFile = (e) => {
    e.stopPropagation();
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="upload-container">
      {/* File Upload Zone */}
      <div
        className={`upload-card ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={onCardClick}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="file-input-hidden"
          onChange={handleChange}
        />

        {!selectedFile ? (
          <div className="upload-content">
            <svg
              className="upload-icon"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2L5 9H9.5V15H14.5V9H19L12 2Z" />
              <rect x="4" y="18" width="16" height="3" rx="1.5" />
            </svg>

            <p className="upload-text">Click or drag & drop to upload file</p>
            <p className="upload-hint">Supports CSV files only</p>
          </div>
        ) : (
          <div className="file-info-container">
            <div className="file-details">
              <span className="file-name">{selectedFile.name}</span>
              <span className="file-size">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
              </span>
            </div>
            <button className="remove-btn" onClick={removeFile} type="button">
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Critical Notification Banner */}
      <div className="info-notice-banner">
        <svg
          className="notice-icon"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="15.5" r="1" fill="currentColor" />
        </svg>
        <span className="notice-text">
          The <strong className="highlight-cyan">target variable</strong> must be the <strong className="highlight-cyan">last column</strong> of your CSV file.
        </span>
      </div>
    </div>
  );
}

export default UploadView;