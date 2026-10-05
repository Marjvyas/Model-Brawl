import React from 'react';

const ProcView = ({ progress, step, elapsedTime }) => (
  <section className="view is-active" id="v-proc">
    <div className="proc-overlay">
      <div className="card proc-box">
        <div className="ring-wrap">
          <svg className="ring-svg" viewBox="0 0 140 140">
            <defs>
              <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6c5ce7" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>
            <circle className="ring-bg" cx="70" cy="70" r="65" />
            <circle
              className="ring-fg"
              cx="70"
              cy="70"
              r="65"
              style={{ strokeDasharray: 408, strokeDashoffset: 408 - (progress / 100) * 408 }}
            />
          </svg>
          <div className="ring-pct">{progress}%</div>
        </div>
        <div className="proc-step">{step}</div>
        <div className="proc-time">{elapsedTime}s elapsed</div>
        <div className="dot-loader">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  </section>
);

export default ProcView;