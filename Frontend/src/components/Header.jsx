import React from 'react';
import epicCubeFont from '../assets/epiccube.ttf';

const Header = ({ onOpenSandbox, uploadData, sandboxOpen }) => {
  return (
    <>
      <style>{`
        @font-face {
          font-family: 'MyCustomTitleFont';
          src: url('${epicCubeFont}') format('truetype');
          font-weight: normal;
          font-style: normal;
        }

        .header-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .website-title {
          font-family: 'MyCustomTitleFont', sans-serif;
          font-size: 2.5rem;
          margin-bottom: 0;
          font-weight: 800;
          letter-spacing: 2px;
          white-space: nowrap;
          color: #00FF66;
          filter: drop-shadow(0px 0px 12px rgba(0, 255, 102, 0.6));
        }

        .tagline { 
          color: #748b74;
          font-size: 0.88rem; 
          font-weight: 400; 
          letter-spacing: 0.3px; 
        }

        .sandbox-btn {
          position: fixed;
          top: 16px;
          left: 16px;
          z-index: 10001;
          padding: 8px 12px;
          font-size: 0.8rem;
          border-radius: 8px;
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.2s ease;
          backdrop-filter: blur(10px);
          white-space: nowrap;
          align-items: center;
          gap: 6px;
        }

        .sandbox-btn.hidden {
          display: none;
        }
          
          @media (max-width: 768px) {
            .sandbox-btn {
              top: 8px;
              left: 8px;
              font-size: 0.7rem;
              padding: 6px 10px;
            }
          }
      `}</style>

      <header className="header-container">
        <h1 className="website-title">MODEL BRAWL</h1>
        <p className="tagline">Put Your Models In The Ring</p>
        
        {onOpenSandbox && uploadData && (
          <button
            className={`sandbox-btn ${sandboxOpen ? 'hidden' : ''}`}
            onClick={onOpenSandbox}
            title="Open Interactive Python Sandbox"
          >
            🐍 Python Sandbox
          </button>
        )}
      </header>
    </>
  );
};

export default Header;