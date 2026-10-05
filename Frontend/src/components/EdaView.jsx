import React, { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import Plotly from 'plotly.js-dist-min';
import { useActionHistory } from '../context/ActionHistoryContext';
import EncodingModal from './EncodingModal';

const EdaView = ({ results, taskId, onStartTournament, onBackToPreview, onFeatureForgeUpdate, encodingConfig, onUpdateEda }) => {
  const { recordAction } = useActionHistory();
  const [recipes, setRecipes] = useState([]);
  const [formula, setFormula] = useState('');
  const [colName, setColName] = useState('');
  const [deletedFeatures, setDeletedFeatures] = useState([]);
  // Exclusion set last committed to the backend via /api/recalculate_eda
  const [committedDeletedFeatures, setCommittedDeletedFeatures] = useState([]);
  // Last-known stats for excluded features (so they stay visible/restorable in the table
  // even after the refreshed EDA payload no longer contains them)
  const [excludedStats, setExcludedStats] = useState({});
  const [isRecalculatingEda, setIsRecalculatingEda] = useState(false);
  
  // Feature Forge encoding state
  const [forgeEncodingData, setForgeEncodingData] = useState(null);
  const [isForgeEncoding, setIsForgeEncoding] = useState(false);

  // Sorting and filtering state for Feature Selection table
  const [sortField, setSortField] = useState('score'); // 'score', 'name', 'corr', 'abs_corr', 'status', 'default'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc', 'desc'
  const [searchTerm, setSearchTerm] = useState('');

  // DOM Canvas and Container References
  const impCanvasRef = useRef(null);
  const skewCanvasRef = useRef(null);
  const corrContainerRef = useRef(null);

  // 1. Robust Data Resolution across possible API payload wrappings
  const eda =
    results?.eda_payload ||
    results?.dataset_analysis?.eda_payload ||
    results?.dataset_analysis ||
    results?.data ||
    results ||
    {};

  // 2. Processed Preview — lives separately from the EDA payload
  const processedPreview =
    results?.processed_preview ||
    results?.dataset_analysis?.processed_preview ||
    null;

  const sampleData = processedPreview?.rows || eda.sample_data || eda.head || eda.preview || [];

  // 3. Skewness Tracker — backend sends {colName: {before, after}} objects
  //    We need to extract flat values for the chart
  const rawSkewnessTracker = eda.skewness_tracker || eda.skewness || eda.skew_scores || {};
  const skewnessLabels = Object.keys(rawSkewnessTracker);
  // Determine if data is {before, after} format or flat
  const isTrackerFormat =
    skewnessLabels.length > 0 &&
    typeof rawSkewnessTracker[skewnessLabels[0]] === 'object' &&
    rawSkewnessTracker[skewnessLabels[0]] !== null &&
    'before' in rawSkewnessTracker[skewnessLabels[0]];

  const skewBeforeValues = isTrackerFormat
    ? skewnessLabels.map((k) => rawSkewnessTracker[k].before)
    : [];
  const skewAfterValues = isTrackerFormat
    ? skewnessLabels.map((k) => rawSkewnessTracker[k].after)
    : skewnessLabels.map((k) => rawSkewnessTracker[k]);

  // 4. Feature Importance & Correlation
  const importanceData =
    eda.importance_scores || eda.feature_importance || eda.mutual_info || {};
  const corrMatrix = eda.correlation_matrix || eda.correlations || {};
  const targetCorrelations = eda.target_correlations || {};

  // EDA charts/table are "dirty" when the exclusion set differs from the set
  // last committed to the backend (via /api/recalculate_eda)
  const edaDirty =
    [...deletedFeatures].sort().join('|') !== [...committedDeletedFeatures].sort().join('|');

  // Sort & filter logic for Feature Selection Table
  const sortedAndFilteredFeatures = useMemo(() => {
    let entries = Object.entries(importanceData).map(([feature, score], originalIndex) => ({
      feature,
      score: Number(score) || 0,
      corr: targetCorrelations[feature] !== undefined && targetCorrelations[feature] !== null && !isNaN(targetCorrelations[feature])
        ? Number(targetCorrelations[feature])
        : null,
      isExcluded: deletedFeatures.includes(feature),
      originalIndex,
    }));

    // Re-attach excluded features missing from the refreshed payload, using their
    // last-known stats, so they remain visible (strikethrough) and restorable
    for (const f of deletedFeatures) {
      if (importanceData[f] === undefined && excludedStats[f]) {
        entries.push({
          feature: f,
          score: Number(excludedStats[f].score) || 0,
          corr: excludedStats[f].corr !== undefined && excludedStats[f].corr !== null ? Number(excludedStats[f].corr) : null,
          isExcluded: true,
          originalIndex: entries.length,
        });
      }
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      entries = entries.filter((item) => item.feature.toLowerCase().includes(term));
    }

    entries.sort((a, b) => {
      let comp = 0;
      if (sortField === 'name') {
        comp = a.feature.localeCompare(b.feature);
      } else if (sortField === 'score') {
        comp = a.score - b.score;
      } else if (sortField === 'corr') {
        if (a.corr === null && b.corr === null) comp = 0;
        else if (a.corr === null) comp = -1;
        else if (b.corr === null) comp = 1;
        else comp = a.corr - b.corr;
      } else if (sortField === 'abs_corr') {
        const absA = a.corr === null ? -1 : Math.abs(a.corr);
        const absB = b.corr === null ? -1 : Math.abs(b.corr);
        comp = absA - absB;
      } else if (sortField === 'status') {
        comp = (a.isExcluded ? 1 : 0) - (b.isExcluded ? 1 : 0);
      } else {
        comp = a.originalIndex - b.originalIndex;
      }

      return sortOrder === 'asc' ? comp : -comp;
    });

    return entries;
  }, [importanceData, targetCorrelations, deletedFeatures, excludedStats, sortField, sortOrder, searchTerm]);

  const handleHeaderSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      // Default directions: numbers & scores desc, text asc
      setSortOrder(field === 'name' ? 'asc' : 'desc');
    }
  };

  const renderSortIndicator = (field) => {
    if (sortField !== field) {
      return <span style={{ opacity: 0.3, marginLeft: '6px', fontSize: '0.75rem' }}>⇅</span>;
    }
    return (
      <span style={{ color: 'var(--accent-1)', marginLeft: '6px', fontWeight: 'bold', fontSize: '0.8rem' }}>
        {sortOrder === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  useEffect(() => {
    let impChart = null;
    let skewChart = null;
    let resizeHandler = null;

    // --- 1. Feature Importance Chart ---
    if (Object.keys(importanceData).length > 0 && impCanvasRef.current) {
      const existingImp = Chart.getChart(impCanvasRef.current);
      if (existingImp) existingImp.destroy();

      impChart = new Chart(impCanvasRef.current, {
        type: 'bar',
        data: {
          labels: Object.keys(importanceData).slice(0, 20),
          datasets: [
            {
              label: 'Mutual Information',
              data: Object.values(importanceData).slice(0, 20),
              backgroundColor: '#a855f7',
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
        },
      });
    }

    // --- 2. Skewness Chart (Before & After comparison) ---
    if (skewnessLabels.length > 0 && skewCanvasRef.current) {
      const existingSkew = Chart.getChart(skewCanvasRef.current);
      if (existingSkew) existingSkew.destroy();

      const datasets = isTrackerFormat
        ? [
            {
              label: 'Before',
              data: skewBeforeValues,
              backgroundColor: 'rgba(248, 113, 113, 0.7)',
            },
            {
              label: 'After',
              data: skewAfterValues,
              backgroundColor: 'rgba(56, 189, 248, 0.7)',
            },
          ]
        : [
            {
              label: 'Skewness',
              data: skewAfterValues,
              backgroundColor: '#38bdf8',
            },
          ];

      skewChart = new Chart(skewCanvasRef.current, {
        type: 'bar',
        data: {
          labels: skewnessLabels,
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
        },
      });
    }

    // --- 3. Correlation Heatmap via Plotly ---
    if (Object.keys(corrMatrix).length > 0 && corrContainerRef.current) {
      const cols = Object.keys(corrMatrix);
      const zData = cols.map((c1) =>
        cols.map((c2) => (corrMatrix[c1] && corrMatrix[c1][c2] !== undefined ? corrMatrix[c1][c2] : 0))
      );

      // Calculate max length of column names to ensure labels are never clipped
      const maxColLength = Math.max(...cols.map((c) => (c ? c.toString().length : 0)), 4);
      const dynamicMargin = Math.min(240, Math.max(120, maxColLength * 8 + 30));

      Plotly.newPlot(
        corrContainerRef.current,
        [
          {
            z: zData,
            x: cols,
            y: cols,
            type: 'heatmap',
            colorscale: 'RdBu',
            zmin: -1,
            zmax: 1,
            hoverongaps: false,
            hovertemplate: '<b>%{y}</b> × <b>%{x}</b><br>Correlation: %{z:.3f}<extra></extra>',
            colorbar: {
              title: { text: 'Correlation (r)', font: { color: '#e4e4e7', size: 12 } },
              tickfont: { color: '#a1a1aa' },
              len: 0.85,
              thickness: 16,
            },
          },
        ],
        {
          margin: { t: 40, l: dynamicMargin, r: 60, b: dynamicMargin, pad: 8 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { color: '#a1a1aa', family: 'Inter, system-ui, sans-serif', size: 11 },
          yaxis: {
            scaleanchor: 'x',
            scaleratio: 1,
            autorange: 'reversed',
            automargin: true,
            tickfont: { size: 11, color: '#e4e4e7' },
          },
          xaxis: {
            tickangle: -45,
            automargin: true,
            tickfont: { size: 11, color: '#e4e4e7' },
          },
        },
        {
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        }
      );

      resizeHandler = () => {
        if (corrContainerRef.current) {
          Plotly.Plots.resize(corrContainerRef.current);
        }
      };
      window.addEventListener('resize', resizeHandler);
    }

    return () => {
      if (impChart) impChart.destroy();
      if (skewChart) skewChart.destroy();
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    };
  }, [results]);

  const addRecipe = () => {
    if (!formula || !colName) return;
    const newRecipe = { new_column_name: colName, formula };
    setRecipes((prev) => [...prev, newRecipe]);
    setFormula('');
    setColName('');
    recordAction({
      type: 'EDA_ADD_RECIPE',
      description: `Added recipe "${colName} = ${formula}"`,
      page: 'Feature Forge',
      undo: () => setRecipes((prev) => prev.filter((r) => r.new_column_name !== newRecipe.new_column_name || r.formula !== newRecipe.formula)),
      redo: () => setRecipes((prev) => [...prev, newRecipe]),
    });
  };

  const removeRecipe = (idx) => {
    const target = recipes[idx];
    if (!target) return;
    setRecipes((prev) => prev.filter((_, i) => i !== idx));
    recordAction({
      type: 'EDA_DELETE_RECIPE',
      description: `Removed recipe "${target.new_column_name}"`,
      page: 'Feature Forge',
      undo: () => setRecipes((prev) => {
        const copy = [...prev];
        copy.splice(idx, 0, target);
        return copy;
      }),
      redo: () => setRecipes((prev) => prev.filter((_, i) => i !== idx)),
    });
  };

  const toggleFeature = (featureName) => {
    const isExcluded = deletedFeatures.includes(featureName);
    setDeletedFeatures((prev) =>
      isExcluded
        ? prev.filter((f) => f !== featureName)
        : [...prev, featureName]
    );
    recordAction({
      type: 'EDA_TOGGLE_FEATURE',
      description: isExcluded
        ? `Restored feature "${featureName}"`
        : `Excluded feature "${featureName}"`,
      page: 'Data Insights',
      undo: () => {
        setDeletedFeatures((prev) =>
          isExcluded
            ? [...prev, featureName]
            : prev.filter((f) => f !== featureName)
        );
      },
      redo: () => {
        setDeletedFeatures((prev) =>
          isExcluded
            ? prev.filter((f) => f !== featureName)
            : [...prev, featureName]
        );
      },
    });
  };

  const resetAllFeatures = () => {
    if (deletedFeatures.length === 0) return;
    const prevExcluded = [...deletedFeatures];
    setDeletedFeatures([]);
    recordAction({
      type: 'EDA_RESET_FEATURES',
      description: `Reset all ${prevExcluded.length} excluded features`,
      page: 'Data Insights',
      undo: () => setDeletedFeatures(prevExcluded),
      redo: () => setDeletedFeatures([]),
    });
  };

  // ═══════════════════════════════════════════════════════════════════
  // Unified "Update EDA" flow (used by the buttons in BOTH the Feature
  // Forge section and the Feature Selection header):
  //   1. Pending recipes → apply the Feature Forge. The backend re-runs
  //      Phase 1 + Phase 2 from the RAW CSV: the formula is evaluated on
  //      the ORIGINAL values (before any clipping/encoding/scaling), the
  //      new column replaces the consumed input columns in-place at the
  //      first input's position (never appended last, so it cannot become
  //      the target), and only then is preprocessing applied to it.
  //   2. Then, if feature exclusions are not yet baked into the displayed
  //      EDA, recompute the EDA from the freshly cached matrices.
  // ═══════════════════════════════════════════════════════════════════

  const isEdaBusy = isRecalculatingEda || isForgeEncoding;

  // Fast recalc of the EDA (heatmap / importance / table) from the cached
  // processed matrix. `baseline` is the exclusion set currently baked into
  // the displayed EDA; if it equals `exclusions`, nothing needs to change.
  const runRecalculate = async (exclusions, baseline) => {
    if ([...exclusions].sort().join('|') === [...baseline].sort().join('|')) {
      return;
    }

    // Capture last-known stats for the excluded features BEFORE the payload refreshes
    const captured = {};
    for (const f of exclusions) {
      if (importanceData[f] !== undefined || targetCorrelations[f] !== undefined) {
        captured[f] = {
          score: importanceData[f] !== undefined ? importanceData[f] : 0,
          corr: targetCorrelations[f] !== undefined ? targetCorrelations[f] : null,
        };
      }
    }

    try {
      const response = await fetch(`/api/recalculate_eda/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted_features: exclusions }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Failed to recalculate EDA');

      if (Object.keys(captured).length > 0) {
        setExcludedStats((prev) => ({ ...prev, ...captured }));
      }
      if (onUpdateEda) onUpdateEda(data);
      setCommittedDeletedFeatures([...exclusions]);
    } catch (e) {
      alert('Failed to update EDA: ' + e.message);
    }
  };

  // Completes a successful Feature Forge update: refreshes all EDA visuals,
  // drops consumed input features from the exclusion list, and re-bakes
  // any surviving exclusions into the new EDA.
  const finishForgeUpdate = async (data, recipeBook) => {
    const newFeatures = Object.keys(data.eda_payload?.importance_scores || {});
    const survivingExclusions = deletedFeatures.filter((f) => newFeatures.includes(f));

    // Update EDA visuals, processed preview, and the model cache
    onFeatureForgeUpdate(data);
    // Input features consumed by the formula no longer exist in the dataset
    setDeletedFeatures(survivingExclusions);
    setRecipes([]);
    setIsForgeEncoding(false);
    setForgeEncodingData(null);
    recordAction({
      type: 'EDA_FEATURE_FORGE_UPDATE',
      description: `Applied ${recipeBook.length} recipe(s) via Feature Forge`,
      page: 'Data Insights',
      undo: () => {},
      redo: () => {},
    });

    // The forge payload contains NO exclusions (it re-ran from the raw CSV),
    // so compare surviving exclusions against an empty baseline
    await runRecalculate(survivingExclusions, []);
  };

  // Step 1 of the unified update: fire the recipe book. On success the flow
  // continues in finishForgeUpdate; if new categorical columns need encoding,
  // the modal takes over and the flow resumes via handleFeatureForgeUpdateWithConfig.
  const runForgeUpdate = async (recipeBook, encConfig) => {
    setIsRecalculatingEda(true);
    try {
      const response = await fetch(`/api/feature_forge/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe_book: recipeBook,
          encoding_config: encConfig,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Feature Forge update failed');

      if (data.status === 'needs_encoding') {
        // Halt: let the user configure the new categorical columns
        setForgeEncodingData({
          unmapped_columns: data.unmapped_columns,
          cat_info: data.cat_info,
          temporary_state: data.temporary_state,
        });
        setIsForgeEncoding(true);
        return;
      }

      await finishForgeUpdate(data, recipeBook);
    } catch (e) {
      alert('Feature Forge update failed: ' + e.message);
    } finally {
      setIsRecalculatingEda(false);
    }
  };

  // Re-fires the forge update after the encoding modal confirms the new
  // categorical columns (Feature Forge flow only).
  const handleFeatureForgeUpdateWithConfig = async (mergedEncodingConfig) => {
    const recipeBook = [...recipes];
    if (recipeBook.length === 0) return;

    setIsRecalculatingEda(true);
    try {
      const response = await fetch(`/api/feature_forge/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipe_book: recipeBook,
          encoding_config: mergedEncodingConfig,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Feature Forge update failed');

      if (data.status === 'success') {
        await finishForgeUpdate(data, recipeBook);
      } else if (data.status === 'needs_encoding') {
        // Shouldn't happen — the modal covered every unmapped column — but re-open it
        setForgeEncodingData({
          unmapped_columns: data.unmapped_columns,
          cat_info: data.cat_info,
          temporary_state: data.temporary_state,
        });
        setIsForgeEncoding(true);
      }
    } catch (e) {
      alert('Feature Forge update failed: ' + e.message);
      setIsForgeEncoding(false);
      setForgeEncodingData(null);
    } finally {
      setIsRecalculatingEda(false);
    }
  };

  // Unified entry point — both "Update EDA" buttons call this:
  // apply pending recipes first (full re-derivation from the raw CSV),
  // then bake in the current feature exclusions.
  const handleUpdateEda = async () => {
    if (isEdaBusy) return;
    if (recipes.length > 0) {
      await runForgeUpdate(recipes, encodingConfig || {});
    } else if (edaDirty) {
      setIsRecalculatingEda(true);
      try {
        await runRecalculate(deletedFeatures, committedDeletedFeatures);
      } finally {
        setIsRecalculatingEda(false);
      }
    }
  };

  const numCols = Object.keys(corrMatrix).length;
  const heatmapHeight = Math.max(680, Math.min(1050, numCols * 40 + 200));

  return (
    <section id="v-eda" className="view is-active">
      <div className="card preview-wrap">
        <div className="section-label">
          <div className="icon-box">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          Data Insights
        </div>

        {/* Processed Dataset Preview */}
        <div
          style={{
            background: 'var(--bg-base)',
            padding: '16px',
            borderRadius: 'var(--radius-m)',
            border: '1px solid var(--border-subtle)',
            marginTop: '20px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Processed Dataset Preview
            {processedPreview && (
              <span style={{ fontWeight: 400, fontSize: '.78rem', color: 'var(--text-tertiary)', marginLeft: '12px' }}>
                ({processedPreview.total_rows?.toLocaleString()} rows × {processedPreview.total_cols} cols)
              </span>
            )}
          </div>
          <div className="tbl-wrap" style={{ maxHeight: '340px', overflowY: 'auto' }}>
            {sampleData.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    {Object.keys(sampleData[0]).map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sampleData.map((row, idx) => (
                    <tr key={idx}>
                      {Object.values(row).map((val, i) => (
                        <td key={i}>{val !== null && val !== undefined ? val.toString() : 'NaN'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                No preview data available from backend.
              </div>
            )}
          </div>
        </div>

        {/* Feature Importance Chart */}
        <div
          style={{
            background: 'var(--bg-base)',
            padding: '16px',
            borderRadius: 'var(--radius-m)',
            border: '1px solid var(--border-subtle)',
            marginTop: '20px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>
            Feature Importance (Mutual Info)
          </div>
          {Object.keys(importanceData).length > 0 ? (
            <div style={{ position: 'relative', height: '400px' }}>
              <canvas ref={impCanvasRef} />
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No feature importance scores computed.
            </div>
          )}
        </div>

        {/* Skewness Tracker */}
        <div
          style={{
            background: 'var(--bg-base)',
            padding: '16px',
            borderRadius: 'var(--radius-m)',
            border: '1px solid var(--border-subtle)',
            marginTop: '20px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>
            Skewness Correction
          </div>
          {skewnessLabels.length > 0 ? (
            <div style={{ position: 'relative', height: '350px' }}>
              <canvas ref={skewCanvasRef} />
            </div>
          ) : (
            <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', fontStyle: 'italic', padding: '4px 0' }}>
              No highly skewed features required transformation.
            </div>
          )}
        </div>

        {/* Feature Selection Table */}
        <div
          style={{
            background: 'var(--bg-base)',
            padding: '18px',
            borderRadius: 'var(--radius-m)',
            border: '1px solid var(--border-subtle)',
            marginTop: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--text-primary)' }}>
                Feature Selection & Target Correlations
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                Click table headers or use ordering controls to sort by Importance, Correlation, or Name. Toggle "Keep" / "Exclude" to customize feature inputs.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                {deletedFeatures.length} features excluded
              </div>
              {deletedFeatures.length > 0 && (
                <button
                  className="btn btn-ghost"
                  onClick={resetAllFeatures}
                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                >
                  Reset All
                </button>
              )}
              {edaDirty && (
                <button
                  className="btn btn-teal"
                  onClick={handleUpdateEda}
                  disabled={isEdaBusy}
                  title="Recompute EDA charts with the current feature exclusions (and pending recipes)"
                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                >
                  {isEdaBusy ? 'Updating EDA…' : 'Update EDA'}
                </button>
              )}
            </div>
          </div>

          {/* Ordering and Filter Controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px',
              background: 'var(--bg-surface)',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              marginBottom: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                Order By:
              </span>
              <select
                value={`${sortField}-${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split('-');
                  setSortField(field);
                  setSortOrder(order);
                }}
                style={{
                  background: 'var(--bg-base)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="score-desc">Mutual Information (Highest First)</option>
                <option value="score-asc">Mutual Information (Lowest First)</option>
                <option value="corr-desc">Correlation (r) (Highest First)</option>
                <option value="corr-asc">Correlation (r) (Lowest First)</option>
                <option value="abs_corr-desc">Correlation Strength (|r| Strongest)</option>
                <option value="name-asc">Feature Name (A → Z)</option>
                <option value="name-desc">Feature Name (Z → A)</option>
                <option value="status-desc">Excluded Features First</option>
                <option value="default-asc">Default Dataset Order</option>
              </select>

              <button
                className="btn btn-ghost"
                onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                title="Toggle sort direction"
                style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <span>{sortOrder === 'asc' ? '▲ Ascending' : '▼ Descending'}</span>
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="text"
                placeholder="Filter features..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '5px 10px',
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                  width: '160px',
                  outline: 'none',
                }}
              />
              {searchTerm && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setSearchTerm('')}
                  style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: '380px', overflowY: 'auto' }}>
            {sortedAndFilteredFeatures.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th
                      style={{ width: '50px', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleHeaderSort('default')}
                      title="Click to sort by default index"
                    >
                      #{renderSortIndicator('default')}
                    </th>
                    <th
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleHeaderSort('name')}
                      title="Click to sort by Feature Name"
                    >
                      Feature Name {renderSortIndicator('name')}
                    </th>
                    <th
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleHeaderSort('score')}
                      title="Click to sort by Mutual Information Score"
                    >
                      Mutual Information Score {renderSortIndicator('score')}
                    </th>
                    <th
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleHeaderSort('corr')}
                      title="Click to sort by Correlation (r)"
                    >
                      Correlation (r) {renderSortIndicator('corr')}
                    </th>
                    <th
                      style={{ width: '140px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => handleHeaderSort('status')}
                      title="Click to sort by Excluded Status"
                    >
                      Action {renderSortIndicator('status')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAndFilteredFeatures.map(({ feature, score, corr, isExcluded, originalIndex }, idx) => {
                    let corrHtml = <span style={{ color: 'var(--text-tertiary)' }}>N/A</span>;
                    if (corr !== null) {
                      const r = corr;
                      const sign = r > 0 ? '+' : '';
                      let color = '#a1a1aa';
                      if (r >= 0.7) color = '#34d399';
                      else if (r >= 0.3) color = '#38bdf8';
                      else if (r > 0) color = '#a855f7';
                      else if (r === 0) color = '#a1a1aa';
                      else if (r > -0.3) color = '#fbbf24';
                      else if (r > -0.7) color = '#fb923c';
                      else color = '#f43f5e';
                      corrHtml = (
                        <span style={{ color, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          {sign}{r.toFixed(3)}
                        </span>
                      );
                    }

                    return (
                      <tr key={feature} style={{ opacity: isExcluded ? 0.4 : 1 }}>
                        <td style={{ color: 'var(--text-tertiary)' }}>{idx + 1}</td>
                        <td
                          style={{
                            fontWeight: 600,
                            textDecoration: isExcluded ? 'line-through' : 'none',
                            color: isExcluded ? 'var(--danger)' : 'inherit',
                          }}
                        >
                          {feature}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-3)' }}>
                          {Number(score).toFixed(4)}
                        </td>
                        <td>{corrHtml}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className={`btn ${isExcluded ? 'btn-ghost' : 'btn-del'}`}
                            style={{
                              padding: '4px 8px',
                              fontSize: '0.75rem',
                              color: isExcluded ? 'var(--success)' : 'inherit',
                            }}
                            onClick={() => toggleFeature(feature)}
                          >
                            {isExcluded ? 'Restore' : 'Exclude'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                {searchTerm ? 'No features match your search filter.' : 'No features available for selection.'}
              </div>
            )}
          </div>
        </div>

        {/* Correlation Heatmap */}
        <div
          style={{
            background: 'var(--bg-base)',
            padding: '20px',
            borderRadius: '12px',
            border: '1px solid var(--border-subtle)',
            marginTop: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '14px',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--text-primary)' }}>
                Correlation Heatmap
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                Pairwise Pearson correlation matrix. Hover over any cell to see the exact relationship score.
              </div>
            </div>
            {numCols > 0 && (
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-surface)',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {numCols} × {numCols} Features
              </div>
            )}
          </div>

          {numCols > 0 ? (
            <div
              style={{
                width: '100%',
                overflowX: 'auto',
                overflowY: 'hidden',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                background: 'rgba(0, 0, 0, 0.2)',
                padding: '10px 0',
              }}
            >
              <div
                id="eda-heatmap"
                ref={corrContainerRef}
                style={{
                  width: '100%',
                  minWidth: `${Math.max(700, numCols * 44 + 180)}px`,
                  height: `${heatmapHeight}px`,
                }}
              />
            </div>
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No correlation matrix calculated.
            </div>
          )}
        </div>

        {/* Feature Forge */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(108,92,231,0.06), rgba(56,189,248,0.04))',
            padding: '20px',
            borderRadius: '12px',
            border: '1px solid rgba(108,92,231,0.2)',
            marginTop: '20px',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '.95rem' }}>Feature Forge</div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
            <input
              className="forge-input"
              style={{ flex: 2 }}
              placeholder="e.g. Income - Expenses"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
            />
            <input
              className="forge-input"
              style={{ flex: 1 }}
              placeholder="New Name"
              value={colName}
              onChange={(e) => setColName(e.target.value)}
            />
            <button className="btn btn-ghost" onClick={addRecipe}>
              Add Recipe
            </button>
            {recipes.length > 0 && (
              <button
                className="btn btn-teal"
                onClick={handleUpdateEda}
                disabled={isEdaBusy}
                title="Apply the recipe(s) on the raw values, then refresh all EDA charts"
              >
                {isEdaBusy ? 'Updating EDA…' : 'Update EDA'}
              </button>
            )}
          </div>
          <div style={{ marginTop: '12px' }}>
            {recipes.map((r, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  marginTop: '4px',
                }}
              >
                <span>
                  <strong>{r.new_column_name}</strong> = <code>{r.formula}</code>
                </span>
                <button
                  className="btn-del"
                  title="Remove recipe"
                  onClick={() => removeRecipe(idx)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Forge Encoding Modal */}
        {isForgeEncoding && forgeEncodingData && (
          <EncodingModal
            cols={forgeEncodingData.unmapped_columns}
            catInfo={forgeEncodingData.cat_info}
            initialConfig={forgeEncodingData.temporary_state}
            isForgeEncoding={true}
            onConfirm={(newEncodingConfig) => {
              // Merge with temporary state and re-fire the feature forge update
              const mergedConfig = { ...forgeEncodingData.temporary_state, ...newEncodingConfig };
              handleFeatureForgeUpdateWithConfig(mergedConfig);
            }}
            onCancel={() => {
              setIsForgeEncoding(false);
              setForgeEncodingData(null);
            }}
          />
        )}

        <div className="action-bar" style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          {onBackToPreview && (
            <button className="btn btn-ghost" onClick={onBackToPreview}>
              ← Back to Dataset Preview
            </button>
          )}
          <button
            className="btn btn-accent"
            style={{ flex: 1, minWidth: '220px', justifyContent: 'center', padding: '16px' }}
            onClick={() => onStartTournament(deletedFeatures, recipes)}
          >
            Start Model Tournament
          </button>
        </div>
      </div>
    </section>
  );
};

export default EdaView;