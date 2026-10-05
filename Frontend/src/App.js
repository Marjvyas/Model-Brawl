
(()=>{
    'use strict';

    /* ── State ── */
    const views = ['v-upload','v-preview','v-eda','v-proc','v-results','v-error'];
    let upload = null, taskId = null, pollTimer = null, tickTimer = null, t0 = null, results = null;

    const show = (id, pushState = true) => {
        views.forEach(v => document.getElementById(v).classList.toggle('is-active', v === id));
        
        const btn = document.getElementById('global-back');
        if (btn) {
            btn.style.display = (id === 'v-upload' || id === 'v-proc') ? 'none' : 'flex';
        }

        if (pushState && id !== 'v-proc') {
            history.pushState({ view: id }, '', '#' + id);
        }
    };

    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.view) {
            show(e.state.view, false);
        } else {
            show('v-upload', false);
        }
    });
    
    document.getElementById('global-back').addEventListener('click', () => {
        history.back();
    });

    history.replaceState({ view: 'v-upload' }, '', '#v-upload');

    const toast = (msg, ok=false) => {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.className = 'toast ' + (ok?'toast-ok':'toast-err') + ' show';
        setTimeout(()=>el.classList.remove('show'), 3500);
    };
    
    const toastUndo = (msg) => {
        const el = document.getElementById('toast');
        el.innerHTML = `${msg} <button onclick="undoDelete()" style="margin-left:12px;background:#fff;border:none;color:#06060a;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:800;font-size:.75rem;box-shadow:0 2px 8px rgba(0,0,0,0.2)">UNDO</button>`;
        el.className = 'toast toast-ok show';
        setTimeout(()=>{
            if(el.classList.contains('show') && el.innerHTML.includes('UNDO')) el.classList.remove('show');
        }, 8000);
    };

    const esc = s => { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; };

    /* ── Upload ── */
    const dz = document.getElementById('dropzone');
    const fi = document.getElementById('csv-input');

    // Handle clicks on the dropzone
    dz.addEventListener('click', (e) => {
        if (e.target === fi || e.target.closest('.btn-browse')) return;
        fi.click();
    });
    dz.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' ') fi.click(); });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-active'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-active'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-active'); if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
    fi.addEventListener('change', () => { if(fi.files.length) handleFile(fi.files[0]); });


    async function handleFile(file) {
        try {
            if (!file.name.toLowerCase().endsWith('.csv')) { 
                alert('Error: Only .csv files accepted.'); 
                return; 
            }
            const fd = new FormData(); fd.append('file', file);
            dz.style.opacity = '0.5'; dz.style.pointerEvents = 'none';
            
            const r = await fetch('/api/upload', {method:'POST', body:fd});
            if (!r.ok) { 
                let errStr = 'Upload failed with HTTP ' + r.status;
                try { const e = await r.json(); errStr = e.detail || errStr; } catch(e2) {}
                throw new Error(errStr); 
            }
            upload = await r.json();
            renderPreview();
            show('v-preview');
        } catch(e) { 
            alert('Upload Error: ' + e.message + '\n\nMake sure you are accessing the site via http://localhost:8000 and not file:///'); 
            toast(e.message); 
        }
        finally { dz.style.opacity=''; dz.style.pointerEvents=''; fi.value=''; }
    }
    window.handleFile = handleFile;

    /* ── Preview ── */
    function renderPreview() {
        const d = upload;
        document.getElementById('preview-kpis').innerHTML = [
            kpi('Filename', d.filename, true),
            kpi('Rows', d.rows.toLocaleString()),
            kpi('Columns', d.columns),
            kpi('Target', d.target_column, true),
            kpi('Memory', d.memory_usage_kb+' KB'),
        ].join('');

        document.getElementById('col-tbl-body').innerHTML = d.column_info.map((c,i) => {
            const isTarget = c.name === d.target_column;
            const delBtn = isTarget ? '' : `<button class="btn-del" title="Delete Column" onclick="deleteCol('${esc(c.name)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
            
            const selectType = `<select onchange="window.handleDtypeChange(this, '${esc(c.name)}')" style="background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;padding:2px;font-size:0.75rem;"><option value="auto">Auto (${c.dtype})</option><option value="numeric">Numeric</option><option value="string">String</option></select>`;
            return `<tr><td>${i+1}</td><td style="font-family:var(--font-sans);color:var(--text-primary);font-weight:500">${esc(c.name)}${isTarget?'<span class="target-tag">target</span>':''}</td><td>${selectType}</td><td class="${c.null_count?'null-warn':''}">${c.null_count}</td><td>${c.unique_count}</td><td>${delBtn}</td></tr>`;
        }).join('');

        if (d.preview_rows && d.preview_rows.length) {
            const cols = Object.keys(d.preview_rows[0]);
            document.getElementById('data-tbl-head').innerHTML = '<tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr>';
            document.getElementById('data-tbl-body').innerHTML = d.preview_rows.map(row =>
                '<tr>'+cols.map(c=>'<td>'+(row[c]!=null?esc(String(row[c])):'<span style="color:var(--text-tertiary)">null</span>')+'</td>').join('')+'</tr>'
            ).join('');
        }
    }
    function kpi(label, val, small) {
        const sv = esc(String(val));
        return `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value${small?' sm':''} tip tip-wrap" data-tip="${sv}">${sv}</div></div>`;
    }

    
    window.userDtypeChanges = {};
    window.handleDtypeChange = function(select, colName) {
        const val = select.value;
        if(val === 'numeric') {
            toast('Warning: Converting strings to numeric will set non-number entries to null/missing.', false);
            window.userDtypeChanges[colName] = 'numeric';
        } else if (val === 'string') {
            window.userDtypeChanges[colName] = 'string';
        } else {
            delete window.userDtypeChanges[colName];
        }
    };

    window.deleteCol = async function(colName) {
        if(!upload || !upload.stored_as) return;
        
        try {
            const r = await fetch('/api/delete_column', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({stored_as: upload.stored_as, column_name: colName})
            });
            if(!r.ok) { const e = await r.json(); throw new Error(e.detail||'Failed to delete'); }
            upload = await r.json();
            renderPreview();
            toastUndo(`Column "${colName}" deleted.`);
        } catch (e) {
            toast(e.message);
        }
    };

    window.undoDelete = async function() {
        if(!upload || !upload.stored_as) return;
        try {
            const r = await fetch('/api/undo_delete', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({stored_as: upload.stored_as})
            });
            if(!r.ok) { const e = await r.json(); throw new Error(e.detail||'Failed to undo'); }
            upload = await r.json();
            renderPreview();
            toast('Column restored!', true);
        } catch (e) {
            toast(e.message);
        }
    };

    /* ── Navigation ── */
    document.getElementById('btn-back').addEventListener('click', ()=>{ upload=null; show('v-upload'); });
    document.getElementById('btn-retry').addEventListener('click', ()=>{ upload=null; show('v-upload'); });
    document.getElementById('btn-new').addEventListener('click', ()=>{ upload=null; results=null; show('v-upload'); });

    /* ── Mode toggle ── */
    let selectedMode = 'standard';
    window.setMode = function(mode) {
        selectedMode = mode;
        const slider = document.getElementById('mode-slider');
        const optStd = document.getElementById('mode-standard');
        const optExh = document.getElementById('mode-exhaustive');
        if (mode === 'exhaustive') {
            slider.classList.add('right');
            optStd.classList.remove('is-active');
            optExh.classList.add('is-active');
        } else {
            slider.classList.remove('right');
            optStd.classList.add('is-active');
            optExh.classList.remove('is-active');
        }
    };

    async function safeFetchJson(url, options) {
        const r = await fetch(url, options);
        const text = await r.text();
        let data = {};
        try {
            data = JSON.parse(text);
        } catch(e) {
            if (!r.ok) throw new Error(text || `Server Error (${r.status})`);
        }
        if (!r.ok) {
            throw new Error(data.detail || data.error || `Error (${r.status})`);
        }
        return data;
    }

    /* ── Run pipeline (with Interactive Encoding) ── */
    document.getElementById('btn-run').addEventListener('click', async()=>{
        if(!upload) {
            alert("Please upload a file first.");
            return;
        }
        
        const btn = document.getElementById('btn-run');
        const origText = btn.innerHTML;
        btn.innerHTML = 'Preparing...';
        btn.disabled = true;

        try {
            
            if(Object.keys(window.userDtypeChanges || {}).length > 0) {
                await fetch('/api/update_dtypes', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ stored_as: upload.stored_as, dtypes: window.userDtypeChanges })
                });
            }
            const res = await fetch('/api/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stored_as: upload.stored_as })
            });
            const data = await res.json();
            
            if (data.categorical_cols && data.categorical_cols.length > 0) {
                renderEncodingModal(data.categorical_cols, data.cat_info);
                document.getElementById('encoding-modal').style.display = 'flex';
                btn.innerHTML = origText;
                btn.disabled = false;
            } else {
                btn.innerHTML = origText;
                btn.disabled = false;
                startPipelineWithConfig({});
            }
        } catch (e) {
            console.error(e);
            alert("Error during preparation.");
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    });

    let encodingState = null;

    function renderEncodingModal(cols, catInfo) {
        encodingState = {
            cols: cols,
            catInfo: catInfo,
            currentIndex: 0,
            config: {}
        };

        cols.forEach(col => {
            encodingState.config[col] = { type: 'onehot', order: (catInfo[col] || []).slice() };
        });

        const wrap = document.getElementById('encoding-card-wrap');
        wrap.innerHTML = '';
        wrap.style.minHeight = '320px';
        document.getElementById('btn-prev-encode').style.display = 'none';
        document.getElementById('btn-next-encode').style.display = 'none';
        document.getElementById('btn-confirm-encode').style.display = 'none';

        renderEncodingColumnCard(cols[0], catInfo, 1);
        updateEncodingProgress(0, cols.length);
    }

    function renderEncodingColumnCard(col, catInfo, direction) {
        const cfg = encodingState.config[col] || { type: 'onehot', order: (catInfo[col] || []).slice() };
        if (!cfg.order) cfg.order = (catInfo[col] || []).slice();
        const values = catInfo[col] || [];
        const cardWrap = document.getElementById('encoding-card-wrap');
        const existing = cardWrap.querySelector('.encoding-card');

        const exitClass = direction > 0 ? 'exit-left' : 'exit-right';
        const enterClass = direction > 0 ? 'enter-right' : 'enter-left';

        if (existing) {
            existing.classList.remove('enter-left', 'enter-right');
            existing.classList.add(exitClass);
            setTimeout(() => existing.remove(), 500);
        }

        const valuesHtml = values.length
            ? values.map(v => `<span class="cat-value-tag tip tip-wrap" data-tip="${esc(v)}">${esc(v)}</span>`).join('')
            : '<span class="cat-value-tag" style="color:var(--text-tertiary)">No values</span>';

        const ordinalOrder = cfg.order && cfg.order.length ? cfg.order : values.slice();
        const ordinalHtml = ordinalOrder.map(v => `<li draggable="true" data-val="${esc(v)}" class="sortable-item"><span class="sortable-handle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>${esc(v)}</li>`).join('');

        const card = document.createElement('div');
        card.className = 'cat-col-card encoding-card ' + enterClass;
        card.innerHTML = `
            <div class="cat-col-glow"></div>
            <div class="cat-col-header">
                <span class="cat-col-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10z"/><line x1="7" y1="7" x2="8.5" y2="7.5"/></svg> ${esc(col)}</span>
                <span class="cat-col-badge">${values.length} unique</span>
            </div>
            <div class="cat-values-list">${valuesHtml}</div>
            <div class="cat-enc-select-wrap">
                <label for="enc-type-${col}">Encoding Method</label>
                <select id="enc-type-${col}" class="cat-enc-select" data-col="${col}">
                    <option value="onehot" ${cfg.type === 'onehot' ? 'selected' : ''}>N-1 Hot Encoding</option>
                    <option value="ordinal" ${cfg.type === 'ordinal' ? 'selected' : ''}>Ordinal Encoding</option>
                    <option value="target" ${cfg.type === 'target' ? 'selected' : ''}>Target Encoding</option>
                </select>
            </div>
            <div id="ordinal-config-${col}" class="ordinal-config" style="display: ${cfg.type === 'ordinal' ? 'block' : 'none'};">
                <div class="ordinal-config-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 7 12 3 16 7"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Drag to reorder (lowest to highest)
                </div>
                <ul id="sortable-${col}" class="sortable-list">${ordinalHtml}</ul>
            </div>
        `;

        cardWrap.appendChild(card);

        const glowEl = card.querySelector('.cat-col-glow');
        card.addEventListener('mouseenter', () => glowEl.classList.add('visible'));
        card.addEventListener('mouseleave', () => glowEl.classList.remove('visible'));

        if (cfg.type === 'ordinal') {
            setupSortable(`sortable-${col}`);
        }

        const select = card.querySelector(`#enc-type-${col}`);
        const ordinalDiv = card.querySelector(`#ordinal-config-${col}`);

        select.addEventListener('change', (e) => {
            const newVal = e.target.value;
            const prev = encodingState.config[col] || { type: 'onehot', order: (catInfo[col] || []).slice() };
            encodingState.config[col] = { type: newVal, order: prev.order || (catInfo[col] || []).slice() };
            if (newVal === 'ordinal') {
                ordinalDiv.style.display = 'block';
                ordinalDiv.style.animation = 'none';
                void ordinalDiv.offsetWidth;
                ordinalDiv.style.animation = 'cardEnter .45s var(--ease-out)';
                setupSortable(`sortable-${col}`);
            } else {
                ordinalDiv.style.display = 'none';
            }
            updateWizardButtons();
        });

        setTimeout(() => {
            const cardH = card.getBoundingClientRect().height;
            const wrapEl = document.getElementById('encoding-card-wrap');
            if (wrapEl) wrapEl.style.minHeight = Math.max(320, cardH + 24) + 'px';
        }, 50);

        updateWizardButtons();

        updateWizardButtons();
    }

    function updateWizardButtons() {
        const col = encodingState.cols[encodingState.currentIndex];
        const cfg = encodingState.config[col];
        const nextBtn = document.getElementById('btn-next-encode');
        const confirmBtn = document.getElementById('btn-confirm-encode');
        const prevBtn = document.getElementById('btn-prev-encode');

        if (encodingState.currentIndex > 0) {
            prevBtn.style.display = 'inline-flex';
        }

        if (cfg && cfg.type) {
            nextBtn.style.display = 'inline-flex';
            if (encodingState.currentIndex === encodingState.cols.length - 1) {
                confirmBtn.style.display = 'inline-flex';
                nextBtn.textContent = ''; // hide text, keep for safety
                nextBtn.style.display = 'none';
                confirmBtn.style.display = 'inline-flex';
            } else {
                confirmBtn.style.display = 'none';
                nextBtn.style.display = 'inline-flex';
            }
        } else {
            nextBtn.style.display = 'none';
            confirmBtn.style.display = 'none';
        }
    }

    function advanceEncodingStep() {
        const col = encodingState.cols[encodingState.currentIndex];
        const select = document.querySelector(`#enc-type-${col}`);
        if (select) {
            encodingState.config[col] = encodingState.config[col] || { type: 'onehot', order: [] };
            encodingState.config[col].type = select.value;
            if (select.value === 'ordinal') {
                const listItems = document.querySelectorAll(`#sortable-${col} li`);
                encodingState.config[col].order = Array.from(listItems).map(li => li.getAttribute('data-val'));
            }
        }

        if (encodingState.currentIndex < encodingState.cols.length - 1) {
            encodingState.currentIndex++;
            updateEncodingProgress(encodingState.currentIndex, encodingState.cols.length);
            renderEncodingColumnCard(encodingState.cols[encodingState.currentIndex], encodingState.catInfo, 1);
        } else {
            document.getElementById('btn-next-encode').style.display = 'none';
            document.getElementById('btn-confirm-encode').style.display = 'inline-flex';
        }
    }

    function retreatEncodingStep() {
        if (encodingState.currentIndex > 0) {
            encodingState.currentIndex--;
            updateEncodingProgress(encodingState.currentIndex, encodingState.cols.length);
            renderEncodingColumnCard(encodingState.cols[encodingState.currentIndex], encodingState.catInfo, -1);
        }
    }

    function updateEncodingProgress(current, total) {
        const pct = ((current) / total) * 100;
        const fill = document.getElementById('encoding-progress-fill');
        if (fill) fill.style.width = pct + '%';
        const stepText = document.getElementById('encoding-step-text');
        if (stepText) stepText.textContent = `Column ${current + 1} of ${total}`;
    }

    function getFinalEncodingConfig() {
        const config = {};
        encodingState.cols.forEach(col => {
            const select = document.querySelector(`#enc-type-${col}`);
            const type = select ? select.value : (encodingState.config[col]?.type || 'onehot');
            if (type === 'ordinal') {
                const listItems = document.querySelectorAll(`#sortable-${col} li`);
                config[col] = { type: 'ordinal', order: Array.from(listItems).map(li => li.getAttribute('data-val')) };
            } else {
                config[col] = { type: type };
            }
        });
        return config;
    }

    function setupSortable(listId) {
        const list = document.getElementById(listId);
        if (!list || list.dataset.sortableInit === '1') return;
        list.dataset.sortableInit = '1';
        let draggedItem = null;

        list.addEventListener('dragstart', (e) => {
            const target = e.target.closest('.sortable-item');
            if (!target) return;
            draggedItem = target;
            target.classList.add('is-dragging');
            try { e.dataTransfer.effectAllowed = 'move'; } catch(_) {}
        });

        list.addEventListener('dragend', () => {
            if (draggedItem) draggedItem.classList.remove('is-dragging');
            draggedItem = null;
        });

        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedItem) return;
            const afterElement = getDragAfterElement(list, e.clientY, draggedItem);
            if (afterElement == null) {
                list.appendChild(draggedItem);
            } else {
                list.insertBefore(draggedItem, afterElement);
            }
        });
    }

    function getDragAfterElement(container, y, dragging) {
        const draggableElements = [...container.querySelectorAll('.sortable-item:not(.is-dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    document.getElementById('btn-next-encode').addEventListener('click', () => {
        advanceEncodingStep();
    });

    document.getElementById('btn-prev-encode').addEventListener('click', () => {
        retreatEncodingStep();
    });

    document.getElementById('btn-confirm-encode').addEventListener('click', () => {
        const config = getFinalEncodingConfig();
        document.getElementById('encoding-modal').style.display = 'none';

        // Check if this was triggered by a Feature Forge update
        if (window.forgeEncodingPending) {
            // Merge new encoding config into the temporary state from the forge
            const mergedConfig = { ...window.forgeEncodingPending.temporaryState, ...config };
            const pendingRecipes = window.forgeEncodingPending.recipeBook;
            window.forgeEncodingPending = null;
            window.config = mergedConfig;
            
            // Re-fire the forge update with merged config
            executeForgeUpdate(pendingRecipes, mergedConfig);
        } else {
            // Normal initial pipeline flow
            window.config = config;
            startPipelineWithConfig(config);
        }
    });

    document.getElementById('btn-cancel-encode').addEventListener('click', () => {
        document.getElementById('encoding-modal').style.display = 'none';
        // Clear any pending forge state if cancelled
        window.forgeEncodingPending = null;
    });

    async function startPipelineWithConfig(config) {
        if (!upload) return alert("Please upload a file first.");
        
        try {
            const data = await safeFetchJson('/api/run', {
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({stored_as: upload.stored_as, mode: selectedMode, encoding_config: config, recipe_book: window.forgeRecipes || []})
            });
            taskId = data.task_id;
            t0 = Date.now();
            show('v-proc');
            startPoll();
            startTick();
        } catch(e){ toast(e.message); }
    }


    /* ── Polling ── */
    function startPoll(){ stopPoll(); pollTimer=setInterval(poll,2000); }
    function stopPoll(){ if(pollTimer){clearInterval(pollTimer);pollTimer=null;} if(tickTimer){clearInterval(tickTimer);tickTimer=null;} }
    function startTick(){ tickTimer=setInterval(()=>{ document.getElementById('proc-time').textContent=Math.floor((Date.now()-t0)/1000)+'s elapsed'; },1000); }

    async function poll(){
        if(!taskId) return;
        try{
            const r=await fetch('/api/status/'+taskId);
            if(!r.ok) return;
            const d=await r.json();
            setRing(d.progress);
            document.getElementById('proc-step').textContent=d.step||'Processing...';
            if(d.status==='eda_complete'){ stopPoll(); await loadEda(); }
            else if(d.status==='complete'){ stopPoll(); await loadResults(); }
            else if(d.status==='error'){ stopPoll(); showErr(d.error||'Unexpected error.'); }
        }catch(e){}
    }

    function setRing(pct){
        const c=2*Math.PI*65, off=c-(pct/100)*c;
        const fg=document.getElementById('ring-fg');
        fg.style.strokeDasharray=c; fg.style.strokeDashoffset=off;
        document.getElementById('ring-pct').textContent=pct+'%';
    }
    
    let chartImpInst = null;
    let chartSkewInst = null;


    function renderEdaVisuals(eda) {
        try {
            // 1. Feature Importance (Chart.js Horizontal Bar)
            const impCtx = document.getElementById('chart-importance').getContext('2d');
            if (chartImpInst) chartImpInst.destroy();
            const impEntries = Object.entries(eda.importance_scores);
            const top20Entries = impEntries.slice(0, 20);
            const impLabels = top20Entries.map(e => e[0]);
            const impData = top20Entries.map(e => e[1]);
            
            document.getElementById('importance-note').textContent = `Showing Top ${impLabels.length} features out of ${eda.total_features} total columns in chart. Full list in table below.`;
            
            chartImpInst = new Chart(impCtx, {
                type: 'bar',
                data: {
                    labels: impLabels,
                    datasets: [{
                        label: 'Mutual Information',
                        data: impData,
                        backgroundColor: '#a855f7',
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a1a1aa' } },
                        y: { grid: { display: false }, ticks: { color: '#a1a1aa' } }
                    }
                }
            });

            // 1.8 Target Correlation Lookup Setup
            targetCorrelations = eda.target_correlations || {};

            // 1.5 Render Feature Selection Table
            featureList = impEntries.map(([name, score]) => ({ name, score }));
            deletedFeatures.clear();
            renderMiTable();

            // 2. Skewness Tracker (Chart.js Grouped Bar)
            const skewCtx = document.getElementById('chart-skewness').getContext('2d');
            if (chartSkewInst) chartSkewInst.destroy();
            const skewFeatures = Object.keys(eda.skewness_tracker);
            
            if (skewFeatures.length === 0) {
                document.getElementById('skew-fallback').style.display = 'block';
                document.getElementById('skew-canvas-wrap').style.display = 'none';
            } else {
                document.getElementById('skew-fallback').style.display = 'none';
                document.getElementById('skew-canvas-wrap').style.display = 'block';
                
                const skewBefore = skewFeatures.map(f => eda.skewness_tracker[f].before);
                const skewAfter = skewFeatures.map(f => eda.skewness_tracker[f].after);
                
                chartSkewInst = new Chart(skewCtx, {
                    type: 'bar',
                    data: {
                        labels: skewFeatures,
                        datasets: [
                            { label: 'Before', data: skewBefore, backgroundColor: '#f43f5e' },
                            { label: 'After', data: skewAfter, backgroundColor: '#34d399' }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { labels: { color: '#e4e4e7' } } },
                        scales: {
                            x: { grid: { display: false }, ticks: { color: '#a1a1aa' } },
                            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a1a1aa' } }
                        }
                    }
                });
            }

            // 3. Correlation Heatmap (Plotly.js)
            if (Object.keys(eda.correlation_matrix).length > 0) {
                const cols = Object.keys(eda.correlation_matrix);
                const shortCols = cols.map(c => c.length > 15 ? c.substring(0, 12) + '...' : c);
                const zData = cols.map(c1 => cols.map(c2 => eda.correlation_matrix[c1][c2]));
                
                const hoverText = cols.map((c1, i) => cols.map((c2, j) => {
                    const val = zData[i][j];
                    const valStr = (val !== null && val !== undefined && !isNaN(val)) ? Number(val).toFixed(3) : 'N/A';
                    if (c1 === c2) {
                        return `<b>${c1}</b><br>Correlation: 1.000`;
                    }
                    return `<b>${c1}</b><br><b>${c2}</b><br>Correlation: ${valStr}`;
                }));
                
                const trace = {
                    z: zData,
                    x: cols,
                    y: cols,
                    type: 'heatmap',
                    colorscale: 'RdBu',
                    zmin: -1, zmax: 1,
                    hovertext: hoverText,
                    hovertemplate: '%{hovertext}<extra></extra>',
                    hoverongaps: false
                };
                
                const layout = {
                    margin: { t: 20, l: 200, r: 20, b: 200 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                    font: { color: '#a1a1aa', family: 'Inter' },
                    xaxis: { tickmode: 'array', tickvals: cols, ticktext: shortCols, tickangle: 45 },
                    yaxis: { tickmode: 'array', tickvals: cols, ticktext: shortCols, autorange: 'reversed', scaleanchor: 'x', scaleratio: 1 }
                };
                
                Plotly.newPlot('chart-correlation', [trace], layout, {displayModeBar: false});
            }
        } catch(e) { console.error(e); }
    }

    async function loadEda() {
        try {
            const r = await fetch('/api/results/' + taskId);
            if (!r.ok) throw new Error('Failed to load EDA payload.');
            const data = await r.json();
            results = data; // store globally for chat injection
            const eda = data.dataset_analysis.eda_payload;
            const processedPreview = data.processed_preview;
            
            show('v-eda');
            
            // Reset Feature Forge after successful pipeline run
            window.forgeRecipes = [];
            document.getElementById('forge-recipe-list').innerHTML = '';

            // 0. Render Processed Preview Table
            if (processedPreview && processedPreview.rows && processedPreview.columns) {
                const targetCol = data.dataset_analysis.target_column;
                document.getElementById('processed-preview-info').textContent = `${processedPreview.total_rows.toLocaleString()} rows × ${processedPreview.total_cols} columns`;
                
                const thead = document.getElementById('processed-tbl-head');
                const tbody = document.getElementById('processed-tbl-body');
                
                let headHtml = '<tr><th>#</th>';
                processedPreview.columns.forEach(col => {
                    const isTarget = col === targetCol;
                    headHtml += `<th>${col}${isTarget ? ' <span class="target-tag">Target</span>' : ''}</th>`;
                });
                headHtml += '</tr>';
                thead.innerHTML = headHtml;
                
                let bodyHtml = '';
                processedPreview.rows.forEach((row, i) => {
                    bodyHtml += `<tr><td>${i+1}</td>`;
                    processedPreview.columns.forEach(col => {
                        let val = row[col];
                        if (val === null) val = '<span style="color:var(--danger)">NaN</span>';
                        bodyHtml += `<td>${val}</td>`;
                    });
                    bodyHtml += '</tr>';
                });
                tbody.innerHTML = bodyHtml;
            }
            
            renderEdaVisuals(eda);
        } catch(e) { showErr(e.message); }
    }

    /* ── Feature Table Logic ── */
    let deletedFeatures = new Set();
    let committedDeletedFeatures = new Set();
    let featureList = [];
    let currentSortCol = 'score';
    let currentSortDir = 'asc';
    let targetCorrelations = {};

    function renderMiTable() {
        const tbody = document.getElementById('mi-tbl-body');
        const countEl = document.getElementById('deleted-features-count');
        const resetBtn = document.getElementById('btn-reset-features');
        const updateBtn = document.getElementById('btn-update-analysis');
        if (!tbody) return;
        
        featureList.sort((a, b) => {
            let valA = a[currentSortCol];
            let valB = b[currentSortCol];
            
            if (currentSortCol === 'corr') {
                valA = targetCorrelations[a.name] !== undefined ? Number(targetCorrelations[a.name]) : 0;
                valB = targetCorrelations[b.name] !== undefined ? Number(targetCorrelations[b.name]) : 0;
                if (isNaN(valA)) valA = 0;
                if (isNaN(valB)) valB = 0;
            }
            
            if (typeof valA === 'string') {
                return currentSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return currentSortDir === 'asc' ? valA - valB : valB - valA;
            }
        });

        const sortNameIcon = document.getElementById('sort-icon-name');
        const sortScoreIcon = document.getElementById('sort-icon-score');
        if (sortNameIcon) {
            sortNameIcon.textContent = currentSortCol === 'name' ? (currentSortDir === 'asc' ? '▲' : '▼') : '↕';
            sortNameIcon.style.color = currentSortCol === 'name' ? 'var(--accent-3)' : 'inherit';
        }
        if (sortScoreIcon) {
            sortScoreIcon.textContent = currentSortCol === 'score' ? (currentSortDir === 'asc' ? '▲' : '▼') : '↕';
            sortScoreIcon.style.color = currentSortCol === 'score' ? 'var(--accent-3)' : 'inherit';
        }
        const sortCorrIcon = document.getElementById('sort-icon-corr');
        if (sortCorrIcon) {
            sortCorrIcon.textContent = currentSortCol === 'corr' ? (currentSortDir === 'asc' ? '▲' : '▼') : '↕';
            sortCorrIcon.style.color = currentSortCol === 'corr' ? 'var(--accent-3)' : 'inherit';
        }

        let html = '';
        featureList.forEach((feat, idx) => {
            const isDeleted = deletedFeatures.has(feat.name);
            const scoreFormatted = Number(feat.score).toFixed(4);
            const safeName = feat.name.replace(/'/g, "\\'");
            
            const corr = targetCorrelations[feat.name];
            let corrHtml = '<span style="color: var(--text-tertiary)">N/A</span>';
            if (corr !== undefined && corr !== null && !isNaN(corr)) {
                const r = Number(corr);
                const sign = r > 0 ? '+' : '';
                let color = '#a1a1aa';
                if (r >= 0.7) color = '#34d399';
                else if (r >= 0.3) color = '#38bdf8';
                else if (r > 0) color = '#a855f7';
                else if (r === 0) color = '#a1a1aa';
                else if (r > -0.3) color = '#fbbf24';
                else if (r > -0.7) color = '#fb923c';
                else color = '#f43f5e';
                corrHtml = `<span style="color: ${color}; font-weight: 600; font-family: var(--font-mono);">${sign}${r.toFixed(3)}</span>`;
            }

            html += `<tr style="${isDeleted ? 'opacity: 0.45; background: rgba(244,63,94,0.06);' : ''}">
                <td>${idx + 1}</td>
                <td style="font-weight: 600; ${isDeleted ? 'text-decoration: line-through; color: var(--danger);' : ''}">${feat.name}</td>
                <td style="font-family: var(--font-mono); color: var(--accent-3);">${scoreFormatted}</td>
                <td>${corrHtml}</td>
                <td style="text-align: center;">
                    ${isDeleted ? 
                        `<button class="btn btn-ghost" style="padding: 4px 10px; font-size: 0.75rem; color: var(--success);" onclick="toggleKeepFeature('${safeName}')">✓ Restore</button>` : 
                        `<button class="btn btn-ghost" style="padding: 4px 10px; font-size: 0.75rem; color: var(--danger);" onclick="toggleKeepFeature('${safeName}')">✕ Delete</button>`
                    }
                </td>
            </tr>`;
        });
        
        tbody.innerHTML = html;

        const numDeleted = deletedFeatures.size + committedDeletedFeatures.size;
        if (countEl) {
            if (numDeleted > 0) {
                countEl.textContent = `${numDeleted} feature${numDeleted > 1 ? 's' : ''} excluded`;
                countEl.style.color = 'var(--danger)';
            } else {
                countEl.textContent = `0 features excluded`;
                countEl.style.color = 'var(--text-tertiary)';
            }
        }
        if (resetBtn) {
            resetBtn.style.display = deletedFeatures.size > 0 ? 'inline-block' : 'none';
        }
        if (updateBtn) {
            updateBtn.style.display = deletedFeatures.size > 0 ? 'inline-block' : 'none';
        }
        const resetAnalysisBtn = document.getElementById('btn-reset-analysis');
        if (resetAnalysisBtn) {
            resetAnalysisBtn.style.display = committedDeletedFeatures.size > 0 ? 'inline-block' : 'none';
        }
    }

    window.toggleKeepFeature = function(featName) {
        if (deletedFeatures.has(featName)) {
            deletedFeatures.delete(featName);
        } else {
            deletedFeatures.add(featName);
        }
        renderMiTable();
    };

    const thName = document.getElementById('th-mi-name');
    if (thName) {
        thName.addEventListener('click', () => {
            if (currentSortCol === 'name') {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = 'name';
                currentSortDir = 'asc';
            }
            renderMiTable();
        });
    }

    const thScore = document.getElementById('th-mi-score');
    if (thScore) {
        thScore.addEventListener('click', () => {
            if (currentSortCol === 'score') {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = 'score';
                currentSortDir = 'desc';
            }
            renderMiTable();
        });
    }

    const thCorr = document.getElementById('th-mi-corr');
    if (thCorr) {
        thCorr.addEventListener('click', () => {
            if (currentSortCol === 'corr') {
                currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortCol = 'corr';
                currentSortDir = 'desc';
            }
            renderMiTable();
        });
    }

    const btnResetFeat = document.getElementById('btn-reset-features');
    if (btnResetFeat) {
        btnResetFeat.addEventListener('click', () => {
            deletedFeatures.clear();
            renderMiTable();
        });
    }



    const btnResetAnalysis = document.getElementById('btn-reset-analysis');
    if (btnResetAnalysis) {
        btnResetAnalysis.addEventListener('click', async () => {
            if(!taskId) return;
            const origText = btnResetAnalysis.textContent;
            btnResetAnalysis.textContent = 'Resetting...';
            btnResetAnalysis.disabled = true;
            
            committedDeletedFeatures.clear();
            deletedFeatures.clear();
            
            try {
                const r = await fetch('/api/recalculate_eda/' + taskId, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ deleted_features: [] })
                });
                if(!r.ok){ const e = await r.json(); throw new Error(e.detail||'Failed.'); }
                const newEda = await r.json();
                renderEdaVisuals(newEda);
            } catch(e) {
                toast(e.message);
            } finally {
                btnResetAnalysis.textContent = origText;
                btnResetAnalysis.disabled = false;
            }
        });
    }

    const btnUpdateAnalysis = document.getElementById('btn-update-analysis');
    if (btnUpdateAnalysis) {
        btnUpdateAnalysis.addEventListener('click', async () => {
            if(!taskId) return;
            const origText = btnUpdateAnalysis.textContent;
            btnUpdateAnalysis.textContent = 'Updating...';
            btnUpdateAnalysis.disabled = true;
            
            deletedFeatures.forEach(f => committedDeletedFeatures.add(f));
            
            try {
                const r = await fetch('/api/recalculate_eda/' + taskId, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ deleted_features: Array.from(committedDeletedFeatures) })
                });
                if(!r.ok){ const e = await r.json(); throw new Error(e.detail||'Failed.'); }
                const newEda = await r.json();
                
                // The old features were dropped on backend, so clear our UI tracking
                // deletedFeatures.clear(); // This is done inside renderEdaVisuals
                
                renderEdaVisuals(newEda);
            } catch(e) {
                toast(e.message);
            } finally {
                btnUpdateAnalysis.textContent = origText;
                btnUpdateAnalysis.disabled = false;
            }
        });
    }

    /* ── Start Tournament ── */
    document.getElementById('btn-train').addEventListener('click', async()=>{
        if(!taskId) return;
        try {
            const r = await fetch('/api/train', {
                method:'POST', 
                headers:{'Content-Type':'application/json'}, 
                body:JSON.stringify({
                    task_id: taskId, 
                    mode: selectedMode,
                    deleted_features: Array.from(new Set([...deletedFeatures, ...committedDeletedFeatures]))
                })
            });
            if(!r.ok){ const e=await r.json(); throw new Error(e.detail||'Failed.'); }
            t0 = Date.now();
            show('v-proc');
            startPoll();
            startTick();
        } catch(e){ toast(e.message); }
    });

    async function loadResults(){
        try{
            const r=await fetch('/api/results/'+taskId);
            if(!r.ok){
                const e=await r.json();
                if(r.status===422){ showErr(e.error||'Pipeline failed.'); return; }
                throw new Error('Failed to load results.');
            }
            results=await r.json();
            renderResults();
            show('v-results');
        }catch(e){ showErr(e.message); }
    }
    function showErr(msg){ document.getElementById('err-msg').textContent=msg; show('v-error'); }

    /* ── Render results ── */
    function renderResults(){
        const r=results, ds=r.dataset_analysis, bm=r.best_model;

        // Metric tiles
        const tiles=[
            {icon:svgIcon('grid'),  label:'Original Size', val:ds.original_shape[0]+' × '+ds.original_shape[1]},
            {icon:svgIcon('target'),label:'Target Column', val:ds.target_column, sm:true},
            {icon:svgIcon('layers'),label:'Categorical',   val:ds.num_categorical_features},
            {icon:svgIcon('trend'), label:'Continuous',     val:ds.num_continuous_features},
            {icon:svgIcon('trash'), label:'Duplicates Removed', val:ds.duplicates_removed},
            {icon:svgIcon('wave'),  label:'Target Skewness', val:ds.target_skewness.toFixed(2)},
            {icon:svgIcon('zap'),   label:'Transform',     val:ds.target_transform_applied||'None', sm:true},
            {icon:svgIcon('split'), label:'Train / Test',  val:ds.train_size+' / '+ds.test_size},
        ];
        document.getElementById('metric-grid').innerHTML=tiles.map((t,i)=>{
            const sv=esc(String(t.val));
            return `<div class="metric-tile" style="animation-delay:${i*.05}s"><div class="m-icon">${t.icon}</div><div class="m-label">${t.label}</div><div class="m-val${t.sm?' sm':''} tip tip-wrap" data-tip="${sv}">${sv}</div></div>`;
        }).join('');

        // Champion
        const r2=bm.final_r2, cls=r2>.7?'ck-good':'ck-warn', arc=Math.PI*65, gOff=arc*(1-Math.max(0,Math.min(1,r2)));
        const vCls=bm.verdict.startsWith('SUCCESS')?'verdict-ok':'verdict-bad';
        const vIco=bm.verdict.startsWith('SUCCESS')?svgIcon('check'):svgIcon('alert');
        document.getElementById('champ-card').innerHTML=`
            <div class="champ-icon">${svgIcon('trophy')}</div>
            <div class="champ-name">${esc(bm.name)}</div>
            <div class="gauge-box"><svg viewBox="0 0 180 100"><path class="gauge-bg-path" d="M 15 90 A 65 65 0 0 1 165 90"/><path class="gauge-fg-path" d="M 15 90 A 65 65 0 0 1 165 90" stroke="${r2>.7?'var(--success)':'var(--warning)'}" stroke-dasharray="${arc}" stroke-dashoffset="${gOff}"/></svg><div class="gauge-num" style="color:${r2>.7?'var(--success)':'var(--warning)'}">${r2.toFixed(4)}</div></div>
            <div class="champ-kpis">
                <div class="champ-kpi"><div class="ck-label">Cross-Val R²</div><div class="ck-val ${cls}">${bm.cv_r2.toFixed(4)}</div></div>
                <div class="champ-kpi"><div class="ck-label">Final R²</div><div class="ck-val ${cls}">${bm.final_r2.toFixed(4)}</div></div>
                <div class="champ-kpi"><div class="ck-label">Final RMSE</div><div class="ck-val" style="color:var(--text-primary)">${bm.final_rmse.toFixed(4)}</div></div>
            </div>
            <div class="rec-box"><div class="rec-label">Why This Model?</div><div class="rec-text">${esc(bm.recommendation)}</div></div>
            <div class="verdict-pill ${vCls}">${vIco} ${esc(bm.verdict)}</div>`;

        // Leaderboard
        document.getElementById('lb-body').innerHTML=r.leaderboard.map((m,i)=>{
            const rc=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-n';
            const bw=Math.max(0,m.cv_r2_mean*100), bc=m.cv_r2_mean>.8?'good':m.cv_r2_mean>.5?'ok':'bad';
            return `<tr class="${i===0?'is-winner':''}" style="animation-delay:${i*.04}s"><td><span class="rank-pip ${rc}">${m.rank}</span></td><td><span class="model-name tip" data-tip="${esc(m.model)}">${esc(m.model)}</span></td><td class="bar-cell"><div class="bar-wrap"><div class="bar-track"><div class="bar-fill ${bc}" style="width:${bw}%;animation-delay:${i*.08}s"></div></div><div class="bar-num">${m.cv_r2_mean.toFixed(4)}</div></div></td><td class="std-num">±${m.cv_r2_std.toFixed(4)}</td></tr>`;
        }).join('');

        document.getElementById('term-pre').textContent=r.pipeline_log||'';
        
        // Final Exam Visuals
        if(bm.visuals && bm.visuals.scatter_actual) {
            document.getElementById('visuals-card').style.display = 'block';
            const vis = bm.visuals;

            // Clear old canvases
            document.getElementById('chart-actual-vs-predicted').outerHTML = '<canvas id="chart-actual-vs-predicted"></canvas>';
            document.getElementById('chart-residuals').outerHTML = '<canvas id="chart-residuals"></canvas>';
            document.getElementById('chart-feature-importance-final').outerHTML = '<canvas id="chart-feature-importance-final"></canvas>';

            // 1. Predicted vs Actual
            new Chart(document.getElementById('chart-actual-vs-predicted').getContext('2d'), {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Predicted vs Actual',
                        data: vis.scatter_predicted.map((p, i) => ({x: p, y: vis.scatter_actual[i]})),
                        backgroundColor: 'rgba(56, 189, 248, 0.5)',
                        borderColor: 'rgba(56, 189, 248, 0.8)',
                    }, {
                        label: 'Ideal Fit',
                        data: [
                            {x: Math.min(...vis.scatter_predicted), y: Math.min(...vis.scatter_actual)},
                            {x: Math.max(...vis.scatter_predicted), y: Math.max(...vis.scatter_actual)}
                        ],
                        type: 'line',
                        borderColor: 'rgba(239, 68, 68, 0.8)',
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: { display: true, text: 'Predicted vs. Actual', color: '#fff', font: {size: 14} },
                        legend: { display: false }
                    },
                    scales: {
                        x: { title: {display: true, text: 'Predicted Values', color: '#9ca3af'}, grid: {color: 'rgba(255,255,255,0.05)'}, ticks: {color: '#9ca3af'} },
                        y: { title: {display: true, text: 'Actual Values', color: '#9ca3af'}, grid: {color: 'rgba(255,255,255,0.05)'}, ticks: {color: '#9ca3af'} }
                    }
                }
            });

            // 2. Residual Plot
            new Chart(document.getElementById('chart-residuals').getContext('2d'), {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Residuals',
                        data: vis.scatter_predicted.map((p, i) => ({x: p, y: vis.scatter_residuals[i]})),
                        backgroundColor: 'rgba(168, 85, 247, 0.5)',
                        borderColor: 'rgba(168, 85, 247, 0.8)'
                    }, {
                        label: 'Zero Error Baseline',
                        data: [
                            {x: Math.min(...vis.scatter_predicted), y: 0},
                            {x: Math.max(...vis.scatter_predicted), y: 0}
                        ],
                        type: 'line',
                        borderColor: 'rgba(239, 68, 68, 0.8)',
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: { display: true, text: 'Residual Plot', color: '#fff', font: {size: 14} },
                        legend: { display: false }
                    },
                    scales: {
                        x: { title: {display: true, text: 'Predicted Values', color: '#9ca3af'}, grid: {color: 'rgba(255,255,255,0.05)'}, ticks: {color: '#9ca3af'} },
                        y: { title: {display: true, text: 'Errors (Residuals)', color: '#9ca3af'}, grid: {color: 'rgba(255,255,255,0.05)'}, ticks: {color: '#9ca3af'} }
                    }
                }
            });

            // 3. Feature Importance
            const fiCtx = document.getElementById('chart-feature-importance-final').getContext('2d');
            if(vis.fi_labels && vis.fi_labels.length > 0) {
                new Chart(fiCtx, {
                    type: 'bar',
                    data: {
                        labels: vis.fi_labels,
                        datasets: [{
                            label: 'Importance / Coefficient',
                            data: vis.fi_values,
                            backgroundColor: 'rgba(20, 184, 166, 0.7)',
                            borderColor: 'rgba(20, 184, 166, 1)',
                            borderWidth: 1,
                            borderRadius: 4
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            title: { display: true, text: 'Top 15 Feature Importances', color: '#fff', font: {size: 14} },
                            legend: { display: false }
                        },
                        scales: {
                            x: { grid: {color: 'rgba(255,255,255,0.05)'}, ticks: {color: '#9ca3af'} },
                            y: { grid: {display: false}, ticks: {color: '#9ca3af'} }
                        }
                    }
                });
            } else {
                // Draw fallback text
                fiCtx.font = "14px Inter";
                fiCtx.fillStyle = "#9ca3af";
                fiCtx.textAlign = "center";
                fiCtx.fillText("Feature importance unavailable", fiCtx.canvas.width/2, fiCtx.canvas.height/2);
            }
        }

        toast('Pipeline completed in '+r.execution_time_seconds+'s', true);
    }

    /* ── SVG Icons ── */
    function svgIcon(name){
        const icons={
            grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
            target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
            layers:'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
            trend:'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>',
            trash:'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
            wave:'<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0 4 4 6 0"/>',
            zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
            split:'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 012 2v7"/><path d="M6 9v12"/>',
            trophy:'<path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 19.24 7 20v2"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 19.24 17 20v2"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/>',
            check:'<polyline points="20 6 9 17 4 12"/>',
            alert:'<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        };
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icons[name]||''}</svg>`;
    }

    /* ── Click-to-expand truncated values ── */
    document.addEventListener('click', (e) => {
        const tip = e.target.closest('.tip');
        if (tip) {
            tip.classList.toggle('is-expanded');
            e.stopPropagation();
        }
    });

    /* ── Log toggle ── */
    document.getElementById('term-bar').addEventListener('click',()=>{
        const b=document.getElementById('term-body'), t=document.getElementById('term-toggle');
        const open=b.classList.toggle('open');
        t.innerHTML=open?'&#9650; Hide':'&#9660; Show';
    });

    /* ═══════════════════════════════════════════════════
        FEATURE FORGE — Client Logic (EDA Page)
        ═══════════════════════════════════════════════════ */
    window.forgeRecipes = [];
    window.forgeEncodingPending = null; // tracks pending forge request during encoding modal

    document.getElementById('btn-forge-add').addEventListener('click', () => {
        const formula = document.getElementById('forge-formula').value.trim();
        const colName = document.getElementById('forge-col-name').value.trim();
        if (!formula || !colName) return toast('Enter both a formula and a column name.');
        
        // Prevent duplicate names
        if (window.forgeRecipes.some(r => r.new_column_name === colName)) {
            return toast(`A recipe for "${colName}" already exists.`);
        }
        
        window.forgeRecipes.push({ new_column_name: colName, formula: formula });
        document.getElementById('forge-formula').value = '';
        document.getElementById('forge-col-name').value = '';
        renderForgeList();
    });

    window.removeForgeRecipe = (idx) => {
        window.forgeRecipes.splice(idx, 1);
        renderForgeList();
    };

    function renderForgeList() {
        const list = document.getElementById('forge-recipe-list');
        const updateBtn = document.getElementById('btn-forge-update');
        
        list.innerHTML = window.forgeRecipes.map((r, i) => `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border-subtle); animation: fadeIn 0.2s ease-out;">
                <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                    <span style="font-weight: 700; color: var(--accent-3); font-size: 0.88rem; white-space: nowrap;">${r.new_column_name}</span>
                    <span style="color: var(--text-tertiary); font-size: 0.78rem;">=</span>
                    <code style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.formula}</code>
                </div>
                <button class="btn btn-ghost" style="padding: 2px 8px; color: var(--danger); font-size: 0.75rem; flex-shrink: 0;" onclick="removeForgeRecipe(${i})">&#x2715;</button>
            </div>
        `).join('');

        // Show/hide "Update Dataset" button based on whether there are recipes
        if (updateBtn) {
            updateBtn.style.display = window.forgeRecipes.length > 0 ? 'inline-flex' : 'none';
        }
    }

    /* ── Feature Forge: Update Dataset ── */
    document.getElementById('btn-forge-update').addEventListener('click', async () => {
        if (!taskId) return toast('No active pipeline. Please run the pipeline first.');
        if (window.forgeRecipes.length === 0) return toast('Add at least one recipe first.');

        await executeForgeUpdate(window.forgeRecipes, window.config || {});
    });

    async function executeForgeUpdate(recipeBook, encodingConfig) {
        const btn = document.getElementById('btn-forge-update');
        const origText = btn.innerHTML;
        btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:6px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Updating...';
        btn.disabled = true;

        try {
            const r = await fetch('/api/feature_forge/' + taskId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    recipe_book: recipeBook,
                    encoding_config: encodingConfig
                })
            });

            if (!r.ok) {
                const e = await r.json();
                throw new Error(e.detail || 'Feature Forge update failed.');
            }

            const data = await r.json();

            if (data.status === 'needs_encoding') {
                // HALT: New categorical features need encoding config
                // Save the pending forge state so we can resume after the modal
                window.forgeEncodingPending = {
                    recipeBook: recipeBook,
                    temporaryState: data.temporary_state || {}
                };
                
                // Open encoding modal for ONLY the unmapped columns
                renderEncodingModal(data.unmapped_columns, data.cat_info);
                document.getElementById('encoding-modal').style.display = 'flex';
                toast('New categorical features detected. Please configure their encoding.');
                
            } else if (data.status === 'success') {
                // SUCCESS: Refresh all EDA charts instantly
                toast('Feature Forge applied successfully!', true);
                
                // Update the stored encoding config
                window.config = encodingConfig;
                
                // Update stored results for chat context
                if (results) {
                    results.dataset_analysis = data.dataset_analysis;
                    results.processed_preview = data.processed_preview;
                }
                
                // Refresh EDA visuals
                renderEdaVisuals(data.eda_payload);
                
                // Refresh processed preview table
                if (data.processed_preview && data.processed_preview.rows && data.processed_preview.columns) {
                    const targetCol = data.dataset_analysis.target_column;
                    document.getElementById('processed-preview-info').textContent = `${data.processed_preview.total_rows.toLocaleString()} rows × ${data.processed_preview.total_cols} columns`;
                    
                    const thead = document.getElementById('processed-tbl-head');
                    const tbody = document.getElementById('processed-tbl-body');
                    
                    let headHtml = '<tr><th>#</th>';
                    data.processed_preview.columns.forEach(col => {
                        const isTarget = col === targetCol;
                        headHtml += `<th>${col}${isTarget ? ' <span class="target-tag">Target</span>' : ''}</th>`;
                    });
                    headHtml += '</tr>';
                    thead.innerHTML = headHtml;
                    
                    let bodyHtml = '';
                    data.processed_preview.rows.forEach((row, i) => {
                        bodyHtml += `<tr><td>${i+1}</td>`;
                        data.processed_preview.columns.forEach(col => {
                            let val = row[col];
                            if (val === null) val = '<span style="color:var(--danger)">NaN</span>';
                            bodyHtml += `<td>${val}</td>`;
                        });
                        bodyHtml += '</tr>';
                    });
                    tbody.innerHTML = bodyHtml;
                }
                
                // Clear the recipe queue
                window.forgeRecipes = [];
                renderForgeList();
            }
        } catch(e) {
            toast(e.message);
        } finally {
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }


    /* ── Download ── */
    document.getElementById('btn-dl').addEventListener('click',()=>{
        if(!results) return;
        const blob=new Blob([JSON.stringify(results,null,2)],{type:'application/json'});
        const a=document.createElement('a');
        a.href=URL.createObjectURL(blob);
        a.download='modelmachine_report_'+results.task_id.substring(0,8)+'.json';
        a.click(); URL.revokeObjectURL(a.href);
    });

    /* ── Chatbot Logic ── */
    const fabBtn = document.getElementById('fab-btn');
    const chatModal = document.getElementById('chat-modal');
    const chatClose = document.getElementById('chat-close');
    const chatInput = document.getElementById('chat-input');
    const chatSend = document.getElementById('chat-send');
    const chatBody = document.getElementById('chat-body');
    const chatTyping = document.getElementById('chat-typing');
    const chatApiKey = document.getElementById('chat-api-key');
    let chatHistory = [];

    if (localStorage.getItem('groq_api_key')) {
        chatApiKey.value = localStorage.getItem('groq_api_key');
    }
    chatApiKey.addEventListener('input', () => {
        localStorage.setItem('groq_api_key', chatApiKey.value);
    });

    fabBtn.addEventListener('click', () => {
        chatModal.classList.add('is-open');
        chatInput.focus();
    });
    chatClose.addEventListener('click', () => chatModal.classList.remove('is-open'));

    const appendMsg = (text, type) => {
        const div = document.createElement('div');
        div.className = `chat-msg ${type}`;
        if (type === 'bot' && typeof marked !== 'undefined') {
            div.innerHTML = marked.parse(text);
        } else {
            div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        }
        chatBody.appendChild(div);
        if (type === 'bot') {
            div.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            chatBody.scrollTop = chatBody.scrollHeight;
        }
    };

    const sendChat = async () => {
        const msg = chatInput.value.trim();
        if(!msg) return;
        chatInput.value = '';
        appendMsg(msg, 'user');
        
        chatHistory.push({"role": "user", "content": msg});
        
        chatTyping.style.display = 'block';
        try {
            const r = await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    stored_as: upload ? upload.stored_as : null, 
                    message: msg, 
                    api_key: chatApiKey.value, 
                    history: chatHistory,
                    results: typeof results !== 'undefined' ? results : null
                })
            });
            const data = await r.json();
            chatTyping.style.display = 'none';
            
            let botResp = data.response || "Sorry, I couldn't process that.";
            chatHistory.push({"role": "assistant", "content": botResp});
            appendMsg(botResp, 'bot');
        } catch(e) {
            chatTyping.style.display = 'none';
            appendMsg("Connection error.", 'bot');
        }
    };

    chatSend.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', e => { if(e.key==='Enter') sendChat(); });

    /* ═══════════════════════════════════════════════════
        INTERACTIVE DATA SANDBOX (PYODIDE + MONACO)
        ═══════════════════════════════════════════════════ */
    let pyodideInstance = null;
    let sandboxEditor = null;
    let sandboxReady = false;

    // Initialize Monaco Editor
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.0/min/vs' }});
    require(['vs/editor/editor.main'], function() {
        sandboxEditor = monaco.editor.create(document.getElementById('monaco-editor-container'), {
            value: "# Write custom Python code here.\n# The dataset is pre-loaded as 'df'.\n# e.g., print(df.head())\n# e.g., df['NewCol'] = df['ColA'] * 2\n",
            language: 'python',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13
        });
    });

    // Initialize Pyodide
    async function initPyodideSandbox() {
        if (pyodideInstance) return;
        const statusEl = document.getElementById('sandbox-status');
        statusEl.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;margin-right:4px;"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Loading Pyodide...';
        
        try {
            pyodideInstance = await loadPyodide();
            statusEl.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;margin-right:4px;"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Loading Pandas...';
            await pyodideInstance.loadPackage(['pandas', 'matplotlib']);
            
            // Fetch current dataset
            statusEl.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;margin-right:4px;"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Fetching Dataset...';
            const r = await fetch('/api/dataset/' + taskId);
            if (!r.ok) throw new Error("Failed to fetch dataset");
            const csvData = await r.text();
            
            // Mount CSV into Pyodide filesystem
            pyodideInstance.FS.writeFile('/dataset.csv', csvData);
            
            // Load into df
            await pyodideInstance.runPythonAsync(`
                import pandas as pd
                import matplotlib.pyplot as plt
                import matplotlib
                
                df = pd.read_csv('/dataset.csv')
            `);
            
            sandboxReady = true;
            statusEl.innerHTML = '<span class="status-dot" style="width:8px; height:8px; border-radius:50%; background:var(--success);"></span> Ready';
            document.getElementById('btn-sandbox-commit').style.display = 'inline-flex';
        } catch(e) {
            console.error(e);
            statusEl.innerHTML = '<span class="status-dot" style="width:8px; height:8px; border-radius:50%; background:var(--danger);"></span> Failed';
            toast("Failed to initialize Sandbox: " + e.message);
        }
    }

    // Run Python Code
    document.getElementById('btn-sandbox-run').addEventListener('click', async () => {
        if (!sandboxReady) {
            toast("Please wait for sandbox to initialize.");
            return;
        }
        if (!sandboxEditor) return;
        
        const code = sandboxEditor.getValue();
        const stdoutEl = document.getElementById('sandbox-stdout');
        const mplTarget = document.getElementById('sandbox-mpl-target');
        const outputWrap = document.getElementById('sandbox-output-wrap');
        
        stdoutEl.textContent = '';
        mplTarget.innerHTML = '';
        outputWrap.style.display = 'block';
        
        // Set up matplotlib to render to our target div
        document.pyodideMplTarget = mplTarget;
        
        // Redirect stdout to our pre element
        pyodideInstance.setStdout({ batched: (msg) => {
            stdoutEl.textContent += msg + '\\n';
        }});
        
        try {
            // Ensure matplotlib uses the browser backend and targets our div
            const setupCode = `
import matplotlib.pyplot as plt
import js
plt.close('all')
from js import document
document.pyodideMplTarget = document.getElementById('sandbox-mpl-target')
`;
            await pyodideInstance.runPythonAsync(setupCode);
            await pyodideInstance.runPythonAsync(code);
            
            // if there are any open figures, show them
            await pyodideInstance.runPythonAsync(`
if plt.get_fignums():
plt.show()
`);
        } catch(e) {
            stdoutEl.textContent += '\\nERROR: ' + e.message;
        } finally {
            // Reset stdout
            pyodideInstance.setStdout({ batched: (msg) => { console.log(msg); }});
        }
    });

    // Commit to Dataset
    document.getElementById('btn-sandbox-commit').addEventListener('click', async () => {
        if (!sandboxReady) return toast("Sandbox not ready.");
        
        const btn = document.getElementById('btn-sandbox-commit');
        const origText = btn.innerHTML;
        btn.innerHTML = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:6px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Syncing...';
        btn.disabled = true;
        
        try {
            // Serialize df to CSV
            await pyodideInstance.runPythonAsync(`
                csv_str = df.to_csv(index=False)
            `);
            const csvStr = pyodideInstance.globals.get('csv_str');
            
            // Send as file
            const blob = new Blob([csvStr], { type: 'text/csv' });
            const formData = new FormData();
            formData.append('file', blob, 'dataset.csv');
            
            const r = await fetch('/api/sync_notebook_dataset/' + taskId, {
                method: 'POST',
                body: formData
            });
            
            if (!r.ok) {
                const e = await r.json();
                throw new Error(e.detail || 'Sync failed.');
            }
            
            const data = await r.json();
            
            if (data.status === 'needs_encoding') {
                // HALT: New categoricals
                // Use Feature Forge's pending logic so modal handles it
                window.forgeEncodingPending = {
                    recipeBook: [], // no recipes, data is already mutated
                    temporaryState: data.temporary_state || {},
                    isSandboxCommit: true
                };
                renderEncodingModal(data.unmapped_columns, data.cat_info);
                document.getElementById('encoding-modal').style.display = 'flex';
                toast('New categorical features detected. Please configure their encoding.');
            } else if (data.status === 'success') {
                // SUCCESS
                toast('Dataset synced successfully!', true);
                window.config = window.config || {};
                if (results) {
                    results.dataset_analysis = data.dataset_analysis;
                    results.processed_preview = data.processed_preview;
                }
                renderEdaVisuals(data.eda_payload);
                refreshProcessedPreview(data.dataset_analysis, data.processed_preview);
            }
        } catch (e) {
            toast(e.message);
        } finally {
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    });
    
    function refreshProcessedPreview(dataset_analysis, processed_preview) {
        if (processed_preview && processed_preview.rows && processed_preview.columns) {
            const targetCol = dataset_analysis.target_column;
            document.getElementById('processed-preview-info').textContent = `${processed_preview.total_rows.toLocaleString()} rows × ${processed_preview.total_cols} columns`;
            
            const thead = document.getElementById('processed-tbl-head');
            const tbody = document.getElementById('processed-tbl-body');
            
            let headHtml = '<tr><th>#</th>';
            processed_preview.columns.forEach(col => {
                const isTarget = col === targetCol;
                headHtml += `<th>${col}${isTarget ? ' <span class="target-tag">Target</span>' : ''}</th>`;
            });
            headHtml += '</tr>';
            thead.innerHTML = headHtml;
            
            let bodyHtml = '';
            processed_preview.rows.forEach((row, i) => {
                bodyHtml += `<tr><td>${i+1}</td>`;
                processed_preview.columns.forEach(col => {
                    let val = row[col];
                    if (val === null) val = '<span style="color:var(--danger)">NaN</span>';
                    bodyHtml += `<td>${val}</td>`;
                });
                bodyHtml += '</tr>';
            });
            tbody.innerHTML = bodyHtml;
        }
    }

})();