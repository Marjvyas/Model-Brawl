import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import SvgIcon from './SvgIcon';

const ResultsView = ({ results, onNewAnalysis, onDownload, onBackToEda, onBackToPreview, onSelectModel, isLoadingModel }) => {
  const [logOpen, setLogOpen] = useState(false);

  // References for final exam charts
  const actualVsPredRef = useRef(null);
  const residualsRef = useRef(null);
  const featImpRef = useRef(null);

  if (!results) return null;

  const ds = results.dataset_analysis || {};
  const bm = results.best_model || {};
  const visuals = bm.visuals || {};
  const championName = results?.leaderboard?.[0]?.model;
  const isShowingChampion = !bm.name || bm.name === championName;

  // Setup visuals charts using Chart.js
  useEffect(() => {
    let actualVsPredChart = null;
    let residualsChart = null;
    let featImpChart = null;

    // 1. Actual vs Predicted Chart
    if (
      visuals.scatter_predicted &&
      visuals.scatter_actual &&
      actualVsPredRef.current
    ) {
      const existing = Chart.getChart(actualVsPredRef.current);
      if (existing) existing.destroy();

      const minVal = Math.min(...visuals.scatter_predicted, ...visuals.scatter_actual);
      const maxVal = Math.max(...visuals.scatter_predicted, ...visuals.scatter_actual);

      actualVsPredChart = new Chart(actualVsPredRef.current, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: 'Predicted vs Actual',
              data: visuals.scatter_predicted.map((p, i) => ({
                x: p,
                y: visuals.scatter_actual[i],
              })),
              backgroundColor: 'rgba(0, 240, 255, 0.55)',
              borderColor: 'rgba(0, 240, 255, 0.85)',
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: 'Ideal Fit (y = x)',
              data: [
                { x: minVal, y: minVal },
                { x: maxVal, y: maxVal },
              ],
              type: 'line',
              borderColor: 'rgba(239, 68, 68, 0.85)',
              borderDash: [5, 5],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a1a1aa', font: { size: 11 } },
            },
          },
          scales: {
            x: {
              title: { display: true, text: 'Predicted Values', color: '#8B949E' },
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8B949E' },
            },
            y: {
              title: { display: true, text: 'Actual Values', color: '#8B949E' },
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8B949E' },
            },
          },
        },
      });
    }

    // 2. Residuals Plot
    if (
      visuals.scatter_predicted &&
      visuals.scatter_residuals &&
      residualsRef.current
    ) {
      const existing = Chart.getChart(residualsRef.current);
      if (existing) existing.destroy();

      const minX = Math.min(...visuals.scatter_predicted);
      const maxX = Math.max(...visuals.scatter_predicted);

      residualsChart = new Chart(residualsRef.current, {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: 'Residuals',
              data: visuals.scatter_predicted.map((p, i) => ({
                x: p,
                y: visuals.scatter_residuals[i],
              })),
              backgroundColor: 'rgba(168, 85, 247, 0.55)',
              borderColor: 'rgba(168, 85, 247, 0.85)',
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: 'Zero Error Line',
              data: [
                { x: minX, y: 0 },
                { x: maxX, y: 0 },
              ],
              type: 'line',
              borderColor: 'rgba(239, 68, 68, 0.8)',
              borderDash: [5, 5],
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#a1a1aa', font: { size: 11 } },
            },
          },
          scales: {
            x: {
              title: { display: true, text: 'Predicted Values', color: '#8B949E' },
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8B949E' },
            },
            y: {
              title: { display: true, text: 'Residuals (Error)', color: '#8B949E' },
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8B949E' },
            },
          },
        },
      });
    }

    // 3. Final Feature Importance Chart
    if (
      visuals.fi_labels &&
      visuals.fi_labels.length > 0 &&
      featImpRef.current
    ) {
      const existing = Chart.getChart(featImpRef.current);
      if (existing) existing.destroy();

      featImpChart = new Chart(featImpRef.current, {
        type: 'bar',
        data: {
          labels: visuals.fi_labels,
          datasets: [
            {
              label: 'Importance / Weight',
              data: visuals.fi_values,
              backgroundColor: 'rgba(0, 255, 128, 0.65)',
              borderColor: 'rgba(0, 255, 128, 0.95)',
              borderWidth: 1,
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { color: '#8B949E' },
            },
            y: {
              grid: { display: false },
              ticks: { color: '#8B949E', font: { size: 11 } },
            },
          },
        },
      });
    }

    return () => {
      if (actualVsPredChart) actualVsPredChart.destroy();
      if (residualsChart) residualsChart.destroy();
      if (featImpChart) featImpChart.destroy();
    };
  }, [visuals]);

  // Compute gauge values
  const r2Score =
    bm.final_r2 != null
      ? Number(bm.final_r2)
      : bm.cv_r2 != null
      ? Number(bm.cv_r2)
      : 0;
  const arcLength = Math.PI * 65; // ~204.2
  const clampedScore = Math.max(0, Math.min(1, r2Score));
  const gaugeOffset = arcLength * (1 - clampedScore);
  const isGoodScore = r2Score >= 0.7;
  const gaugeStrokeColor = isGoodScore ? 'var(--success)' : 'var(--warning)';

  const datasetTiles = [
    {
      icon: 'grid',
      label: 'Original Size',
      val: ds.original_shape ? `${ds.original_shape[0]} × ${ds.original_shape[1]}` : '—',
    },
    {
      icon: 'target',
      label: 'Target Column',
      val: ds.target_column || '—',
      sm: true,
    },
    {
      icon: 'layers',
      label: 'Categorical',
      val: ds.num_categorical_features ?? '—',
    },
    {
      icon: 'trend',
      label: 'Continuous',
      val: ds.num_continuous_features ?? '—',
    },
    {
      icon: 'trash',
      label: 'Duplicates Removed',
      val: ds.duplicates_removed ?? '—',
    },
    {
      icon: 'wave',
      label: 'Target Skewness',
      val: ds.target_skewness != null ? ds.target_skewness.toFixed(2) : '—',
    },
    {
      icon: 'zap',
      label: 'Transform',
      val: ds.target_transform_applied || 'None',
      sm: true,
    },
    {
      icon: 'split',
      label: 'Train / Test',
      val: ds.train_size && ds.test_size ? `${ds.train_size} / ${ds.test_size}` : '—',
    },
  ];

  return (
    <section id="v-results" className="view is-active" style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <div className="results-wrap">
        {/* 1. Champion Model Spotlight */}
        {bm.name && (
          <div className="champ">
            <div className="champ-badge">
              {isShowingChampion ? 'Tournament Champion' : 'Selected Model'}
            </div>
            <div className="champ-icon">
              <SvgIcon name="trophy" />
            </div>
            <div className="champ-name">{bm.name}</div>
            {!isShowingChampion && championName && onSelectModel && (
              <button
                className="btn btn-ghost"
                onClick={() => onSelectModel(championName)}
                style={{ marginTop: '8px', padding: '4px 12px', fontSize: '0.72rem' }}
              >
                ← Back to Champion ({championName})
              </button>
            )}

            {/* Semicircular Gauge Meter */}
            <div className="gauge-box">
              <svg viewBox="0 0 180 100">
                <path className="gauge-bg-path" d="M 15 90 A 65 65 0 0 1 165 90" />
                <path
                  className="gauge-fg-path"
                  d="M 15 90 A 65 65 0 0 1 165 90"
                  stroke={gaugeStrokeColor}
                  strokeDasharray={arcLength}
                  strokeDashoffset={gaugeOffset}
                />
              </svg>
              <div className="gauge-num" style={{ color: gaugeStrokeColor }}>
                {r2Score.toFixed(4)}
              </div>
            </div>

            {/* KPIs */}
            <div className="champ-kpis">
              <div className="champ-kpi">
                <div className="ck-label">Cross-Val R²</div>
                <div className={`ck-val ${bm.cv_r2 > 0.7 ? 'ck-good' : 'ck-warn'}`}>
                  {bm.cv_r2 != null ? bm.cv_r2.toFixed(4) : '—'}
                </div>
              </div>
              <div className="champ-kpi">
                <div className="ck-label">Final R²</div>
                <div className={`ck-val ${bm.final_r2 > 0.7 ? 'ck-good' : 'ck-warn'}`}>
                  {bm.final_r2 != null ? bm.final_r2.toFixed(4) : '—'}
                </div>
              </div>
              <div className="champ-kpi">
                <div className="ck-label">Final RMSE</div>
                <div className="ck-val" style={{ color: 'var(--text-primary)' }}>
                  {bm.final_rmse != null ? bm.final_rmse.toFixed(4) : '—'}
                </div>
              </div>
            </div>

            {/* Verdict Status */}
            {bm.verdict && (
              <div
                className={`verdict-pill ${
                  bm.verdict.toUpperCase().includes('PASS') || bm.verdict.toUpperCase().includes('SUCCESS')
                    ? 'verdict-ok'
                    : 'verdict-bad'
                }`}
              >
                <SvgIcon
                  name={
                    bm.verdict.toUpperCase().includes('PASS') || bm.verdict.toUpperCase().includes('SUCCESS')
                      ? 'check'
                      : 'alert'
                  }
                />
                <span>{bm.verdict}</span>
              </div>
            )}

            {/* Recommendation Box */}
            <div className="rec-box">
              <div className="rec-label">Why This Model?</div>
              <div className="rec-text">{bm.recommendation || 'Selected as the top-performing architecture based on cross-validation and holdout generalization.'}</div>
            </div>
          </div>
        )}

        {/* 2. Dataset Analysis Metrics Card */}
        <div className="card">
          <div className="section-label">
            <div className="icon-box">
              <SvgIcon name="grid" />
            </div>
            Dataset Analysis & Preprocessing
          </div>
          <div className="metric-grid">
            {datasetTiles.map((t, idx) => (
              <div className="metric-tile" key={idx} title={`${t.label}: ${t.val}`}>
                <div className="m-icon">
                  <SvgIcon name={t.icon} />
                </div>
                <div className="m-label">{t.label}</div>
                <div className={`m-val ${t.sm ? 'sm' : ''}`}>{t.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Tournament Leaderboard Card */}
        {results.leaderboard && results.leaderboard.length > 0 && (
          <div className="card">
            <div className="section-label">
              <div className="icon-box">
                <SvgIcon name="trophy" />
              </div>
              Model Tournament Leaderboard
              <span className="lb-hint">click a model to view its results</span>
            </div>
            <div className="lb-tbl-wrap">
              <table className="lb-tbl">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>Rank</th>
                    <th>Model Architecture</th>
                    <th>Cross-Val R² Performance</th>
                    <th style={{ width: '120px' }}>Std Dev</th>
                  </tr>
                </thead>
                <tbody>
                  {results.leaderboard.map((m, i) => {
                    const isDisplayedModel = bm.name && m.model === bm.name;
                    const isViewing = isDisplayedModel && !isShowingChampion;
                    return (
                      <tr
                        key={i}
                        className={[
                          i === 0 ? 'is-winner' : '',
                          isViewing ? 'is-selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={onSelectModel ? () => onSelectModel(m.model) : undefined}
                        style={{ cursor: onSelectModel ? 'pointer' : 'default' }}
                        title={onSelectModel ? "Click to view this model's full results" : undefined}
                      >
                        <td>
                          <span className={`rank-pip rank-${i + 1 <= 3 ? i + 1 : 'n'}`}>
                            {m.rank}
                          </span>
                        </td>
                        <td style={{ fontWeight: i === 0 ? 700 : 500 }}>
                          {m.model}
                          {i === 0 && (
                            <span
                              style={{
                                marginLeft: '8px',
                                fontSize: '0.68rem',
                                color: 'var(--accent-1)',
                                background: 'rgba(0, 255, 128, 0.1)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              WINNER
                            </span>
                          )}
                          {isViewing && (
                            <span
                              style={{
                                marginLeft: '8px',
                                fontSize: '0.68rem',
                                color: 'var(--accent-2)',
                                background: 'rgba(0, 240, 255, 0.1)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              VIEWING
                            </span>
                          )}
                        </td>
                      <td className="bar-cell">
                        <div className="bar-wrap">
                          <div className="bar-track">
                            <div
                              className={`bar-fill ${
                                m.cv_r2_mean > 0.8 ? 'good' : m.cv_r2_mean > 0.5 ? 'ok' : 'bad'
                              }`}
                              style={{ width: `${Math.max(0, m.cv_r2_mean * 100)}%` }}
                            />
                          </div>
                          <div className="bar-num">{m.cv_r2_mean.toFixed(4)}</div>
                        </div>
                      </td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                          ±{m.cv_r2_std.toFixed(4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. Visual Diagnostics Performance Charts */}
        {visuals && visuals.scatter_actual && visuals.scatter_predicted && (
          <div className="card">
            <div className="section-label">
              <div className="icon-box">
                <SvgIcon name="trend" />
              </div>
              {isShowingChampion
                ? 'Model Evaluation & Visual Diagnostics'
                : `Model Evaluation & Visual Diagnostics — ${bm.name}`}
            </div>
            <div className="visuals-grid">
              <div className="visual-card">
                <div className="visual-title">Actual vs. Predicted</div>
                <div className="visual-canvas-wrap">
                  <canvas ref={actualVsPredRef} />
                </div>
              </div>
              <div className="visual-card">
                <div className="visual-title">Residuals Distribution</div>
                <div className="visual-canvas-wrap">
                  <canvas ref={residualsRef} />
                </div>
              </div>
              {visuals.fi_labels && visuals.fi_labels.length > 0 && (
                <div className="visual-card">
                  <div className="visual-title">Top Feature Importances</div>
                  <div className="visual-canvas-wrap">
                    <canvas ref={featImpRef} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. Terminal Logs and Pipeline Execution */}
        <div className="term">
          <div className="term-bar" onClick={() => setLogOpen(!logOpen)}>
            <div className="term-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="term-title">
              pipeline_output.log
              {results.execution_time_seconds && (
                <span style={{ marginLeft: '12px', color: 'var(--accent-1)', fontSize: '0.7rem' }}>
                  ({results.execution_time_seconds}s total)
                </span>
              )}
            </div>
            <div className="term-toggle" style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              {logOpen ? '▲ Hide Log' : '▼ Show Log'}
            </div>
          </div>
          <div className={`term-body ${logOpen ? 'open' : ''}`}>
            <pre className="term-pre">{results.pipeline_log || 'No console log output available.'}</pre>
          </div>
        </div>

        {/* 6. Action Bar */}
        <div className="action-bar" style={{ marginTop: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={onNewAnalysis}>
              Upload New Dataset
            </button>
            {onBackToPreview && (
              <button className="btn btn-ghost" onClick={onBackToPreview}>
                ← Back to Dataset Preview
              </button>
            )}
            {onBackToEda && (
              <button className="btn btn-ghost" onClick={onBackToEda}>
                ← Back to Data Insights
              </button>
            )}
          </div>
          <button className="btn btn-accent" onClick={onDownload}>
            Download Full Report (.json)
          </button>
        </div>
      </div>

      {/* Full-page loading overlay while a leaderboard model is being loaded */}
      {isLoadingModel && (
        <div className="page-loading-overlay">
          <div className="page-loading-box">
            <div className="model-spinner" />
            <span>Loading model results…</span>
          </div>
        </div>
      )}
    </section>
  );
};

export default ResultsView;