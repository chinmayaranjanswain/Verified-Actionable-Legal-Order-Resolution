// V.A.L.O.R. — Main Application (Colab Architecture)

import { saveRecord, getRecords, getStats, getColabUrl, setColabUrl } from './modules/storage.js';
import { extractTextFromPDF } from './modules/pdfProcessor.js';
import { performOCR } from './modules/ocrEngine.js';
import { analyzeWithAI, checkColabHealth } from './modules/aiEngine.js';
import { formatFileSize, getConfidenceClass, getConfidenceLabel, showToast, ICONS, truncate, escapeHtml } from './utils/helpers.js';

// ── State ──────────────────
let currentFile = null;
let currentResults = null;
let batchFiles = [];
let batchResults = [];
let isBatchMode = false;

// ── Navigation ─────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  const tabEl = document.getElementById(`tab-${page}`);
  if (pageEl) pageEl.classList.add('active');
  if (tabEl) tabEl.classList.add('active');
  if (page === 'dashboard') renderDashboard();
  if (page === 'settings') renderSettings();
}

// ── Upload ─────────────────
function initUploadZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  });
  dropZone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length > 0) handleFiles(files);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    if (files.length > 0) handleFiles(files);
  });
  document.getElementById('file-remove')?.addEventListener('click', e => {
    e.stopPropagation(); clearFiles();
  });
  document.getElementById('btn-analyze')?.addEventListener('click', () => {
    if (isBatchMode) runBatchPipeline();
    else runPipeline();
  });
}

function handleFiles(files) {
  if (files.length === 1) {
    // Single file mode
    isBatchMode = false;
    currentFile = files[0];
    document.getElementById('file-name').textContent = files[0].name;
    document.getElementById('file-meta').textContent = formatFileSize(files[0].size);
    document.getElementById('file-info').classList.add('visible');
    document.getElementById('batch-queue').classList.remove('visible');
    document.getElementById('btn-analyze').disabled = false;
    document.getElementById('btn-analyze').innerHTML = `${ICONS.search} Analyze Document`;
  } else {
    // Batch mode
    isBatchMode = true;
    batchFiles = files;
    batchResults = [];
    document.getElementById('file-name').textContent = `${files.length} files selected`;
    document.getElementById('file-meta').textContent = files.map(f => formatFileSize(f.size)).join(', ');
    document.getElementById('file-info').classList.add('visible');
    document.getElementById('btn-analyze').disabled = false;
    document.getElementById('btn-analyze').innerHTML = `${ICONS.search} Analyze ${files.length} Documents`;

    // Show batch queue
    renderBatchQueue(files);
  }
  document.getElementById('pipeline-container').classList.remove('visible');
}

function renderBatchQueue(files) {
  const queue = document.getElementById('batch-queue');
  const list = document.getElementById('batch-list');
  const count = document.getElementById('batch-count');

  queue.classList.add('visible');
  count.textContent = `0/${files.length}`;

  list.innerHTML = files.map((f, i) => `
    <div class="batch-item" id="batch-item-${i}" data-index="${i}">
      <div class="batch-item-icon">${i + 1}</div>
      <div class="batch-item-name">${escapeHtml(f.name)}</div>
      <div class="batch-item-status">Queued</div>
    </div>
  `).join('');
}

function clearFiles() {
  currentFile = null;
  batchFiles = [];
  batchResults = [];
  isBatchMode = false;
  document.getElementById('file-info').classList.remove('visible');
  document.getElementById('batch-queue').classList.remove('visible');
  document.getElementById('btn-analyze').disabled = true;
  document.getElementById('btn-analyze').innerHTML = `${ICONS.search} Analyze Document`;
  document.getElementById('file-input').value = '';
  document.getElementById('pipeline-container').classList.remove('visible');
}

// ── Single Pipeline ────────
async function runPipeline() {
  if (!currentFile) return;
  const pipeline = document.getElementById('pipeline-container');
  const btn = document.getElementById('btn-analyze');
  pipeline.classList.add('visible');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Analyzing...`;

  const steps = ['step-load', 'step-extract', 'step-clean', 'step-ai', 'step-validate'];
  function setStep(idx, state, pct) {
    const el = document.getElementById(steps[idx]);
    if (!el) return;
    el.className = `pipeline-step ${state}`;
    const fill = el.querySelector('.step-progress-fill');
    const pctEl = el.querySelector('.step-percentage');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    const ind = el.querySelector('.step-indicator');
    if (state === 'done' && ind) ind.innerHTML = ICONS.check;
    if (state === 'error' && ind) ind.innerHTML = ICONS.x;
  }

  try {
    // Step 1: Load
    setStep(0, 'active', 50);
    await new Promise(r => setTimeout(r, 400));
    setStep(0, 'done', 100);

    // Step 2: Extract text
    setStep(1, 'active', 0);
    let result = await extractTextFromPDF(currentFile, pct => setStep(1, 'active', pct));
    if (result.isScanned) {
      setStep(1, 'active', 0);
      document.querySelector('#step-extract .step-label').textContent = 'Running OCR...';
      result = await performOCR(currentFile, pct => setStep(1, 'active', pct));
    }
    setStep(1, 'done', 100);

    // Step 3: Rule-Based Extraction (PRIMARY)
    setStep(2, 'active', 0);
    // This triggers cleanOCRText + extractOrderSection + extractWithRules inside analyzeWithAI
    // We run the full hybrid pipeline in step 3+4 combined
    const aiResult = await analyzeWithAI(result.text, pct => {
      // Map 0-50% to step 3, 50-90% to step 4, 90-100% to step 5
      if (pct <= 50) {
        setStep(2, 'active', pct * 2);
      } else if (pct <= 90) {
        setStep(2, 'done', 100);
        setStep(3, 'active', (pct - 50) * 2.5);
      } else {
        setStep(3, 'done', 100);
        setStep(4, 'active', (pct - 90) * 10);
      }
    });
    setStep(2, 'done', 100);

    // Step 4: LLM Refinement (mark done — it ran inside analyzeWithAI)
    setStep(3, aiResult.llmUsed ? 'done' : 'done', 100);
    // Update label if LLM was skipped
    if (!aiResult.llmUsed) {
      const llmLabel = document.querySelector('#step-ai .step-desc');
      if (llmLabel) llmLabel.textContent = 'Skipped — no Colab URL configured';
    }

    // Step 5: Validate
    setStep(4, 'active', 50);
    await new Promise(r => setTimeout(r, 400));
    setStep(4, 'done', 100);

    currentResults = aiResult;

    const conf = Math.round((aiResult.data?.caseDetails?.confidence || 0) * 100);
    const method = aiResult.method || 'rule-based';
    if (!aiResult.valid) {
      showToast(`Analysis complete (${method}) — ${conf}% confidence, ${aiResult.errors?.length || 0} warnings`, 'warning');
    } else {
      showToast(`Analysis complete (${method}) — ${conf}% confidence`, 'success');
    }

    await new Promise(r => setTimeout(r, 600));
    renderResults(aiResult);
    navigate('results');
  } catch (err) {
    console.error('Pipeline error:', err);
    showToast('Pipeline failed: ' + err.message, 'error');
    const failIdx = steps.findIndex(s => document.getElementById(s)?.classList.contains('active'));
    if (failIdx >= 0) setStep(failIdx, 'error', 0);
  }

  btn.disabled = false;
  btn.innerHTML = `${ICONS.search} Analyze Document`;
}

// ── Batch Pipeline ─────────
async function runBatchPipeline() {
  if (batchFiles.length === 0) return;
  const btn = document.getElementById('btn-analyze');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Processing batch...`;

  batchResults = [];
  let completed = 0;

  for (let i = 0; i < batchFiles.length; i++) {
    const file = batchFiles[i];
    const item = document.getElementById(`batch-item-${i}`);
    const statusEl = item?.querySelector('.batch-item-status');

    try {
      // Mark active
      item?.classList.remove('done', 'error');
      item?.classList.add('active');
      if (statusEl) statusEl.textContent = 'Extracting...';

      // Extract text
      let result = await extractTextFromPDF(file, () => {});
      if (result.isScanned) {
        if (statusEl) statusEl.textContent = 'OCR...';
        result = await performOCR(file, () => {});
      }

      // Analyze
      if (statusEl) statusEl.textContent = 'Analyzing...';
      const aiResult = await analyzeWithAI(result.text, () => {});

      batchResults.push({ file: file.name, success: true, result: aiResult });

      // Mark done
      item?.classList.remove('active');
      item?.classList.add('done');
      const conf = Math.round((aiResult.data?.caseDetails?.confidence || 0) * 100);
      if (statusEl) statusEl.textContent = `${conf}%`;

    } catch (err) {
      batchResults.push({ file: file.name, success: false, error: err.message });
      item?.classList.remove('active');
      item?.classList.add('error');
      if (statusEl) statusEl.textContent = 'Failed';
    }

    completed++;
    document.getElementById('batch-count').textContent = `${completed}/${batchFiles.length}`;
  }

  // Summary
  const passed = batchResults.filter(r => r.success).length;
  const failed = batchResults.filter(r => !r.success).length;
  showToast(`Batch complete: ${passed} passed, ${failed} failed`, passed === batchFiles.length ? 'success' : 'warning');

  // Auto-save all successful results
  for (const br of batchResults) {
    if (br.success && br.result?.data) {
      const record = { ...br.result.data, status: 'pending', fileName: br.file };
      saveRecord(record);
    }
  }

  btn.disabled = false;
  btn.innerHTML = `${ICONS.search} Analyze ${batchFiles.length} Documents`;
}

// ── Results ────────────────
function renderResults(result) {
  const page = document.getElementById('page-results');
  if (!page) return;
  const d = result.data;
  const dirAvg = d.keyDirections.reduce((s, x) => s + x.confidence, 0) / d.keyDirections.length;

  page.innerHTML = `
    <div class="app-container results-page">
      <div class="results-header">
        <h1>Analysis <span class="highlight">Complete</span></h1>
        <p>Review extracted data. Edit fields as needed, then approve or reject.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <div class="pill ${result.llmUsed ? 'pill-blue' : 'pill-yellow'}">${result.method ? result.method.toUpperCase() : 'RULE-BASED'}</div>
          ${result.ruleConfidence ? `<div class="pill pill-green">RULES: ${Math.round(result.ruleConfidence * 100)}%</div>` : ''}
          ${result.llmUsed ? `<div class="pill pill-blue">LLM BOOST: +${Math.round((result.llmConfidence || 0) * 100)}%</div>` : ''}
          ${result.errors?.length ? `<div class="pill pill-red">${result.errors.length} WARNINGS</div>` : ''}
        </div>
      </div>

      <div class="results-grid">
        <div class="result-section" id="section-case">
          <div class="section-header">
            <div class="section-title">${ICONS.scale} Case Details</div>
            <div class="pill ${getConfidenceClass(d.caseDetails.confidence)}">${getConfidenceLabel(d.caseDetails.confidence)}</div>
          </div>
          <div class="section-body">
            ${rf('Case No.', 'caseNumber', d.caseDetails.caseNumber)}
            ${rf('Court', 'courtName', d.caseDetails.courtName)}
            ${rf('Date', 'dateOfOrder', d.caseDetails.dateOfOrder)}
            ${rf('Parties', 'partiesInvolved', d.caseDetails.partiesInvolved)}
            ${rf('Judge', 'judgeName', d.caseDetails.judgeName)}
          </div>
        </div>

        <div class="result-section" id="section-action">
          <div class="section-header">
            <div class="section-title">${ICONS.target} Action Plan</div>
            <div class="pill ${getConfidenceClass(d.actionPlan.confidence)}">${getConfidenceLabel(d.actionPlan.confidence)}</div>
          </div>
          <div class="section-body">
            ${rf('Decision', 'decision', d.actionPlan.decision)}
            ${rf('Action', 'actionRequired', d.actionPlan.actionRequired, true)}
            ${rf('Department', 'responsibleDepartment', d.actionPlan.responsibleDepartment)}
            ${rf('Deadline', 'deadline', d.actionPlan.deadline)}
            ${rf('Priority', 'priority', d.actionPlan.priority)}
            ${rf('Financial', 'financialImplication', d.actionPlan.financialImplication)}
            ${rf('Risk', 'riskIfNotComplied', d.actionPlan.riskIfNotComplied)}
          </div>
        </div>

        <div class="result-section" id="section-directions">
          <div class="section-header">
            <div class="section-title">${ICONS.fileText} Key Directions</div>
            <div class="pill ${getConfidenceClass(dirAvg)}">${getConfidenceLabel(dirAvg)}</div>
          </div>
          <div class="section-body">
            <ul class="directive-list">${d.keyDirections.map((dir, i) => rd(dir, i)).join('')}</ul>
            <button class="add-directive-btn" onclick="window.addDirective()">${ICONS.plus} Add Direction</button>
          </div>
        </div>

        <div class="result-section" id="section-source">
          <div class="section-header">
            <div class="section-title">${ICONS.file} Source Text</div>
            <div class="pill pill-blue">${d.caseDetails.caseNumber !== 'Not Found' ? 'EXTRACTED' : 'RAW'}</div>
          </div>
          <div class="section-body">
            <div class="source-text-box">${escapeHtml(result.sourceText || 'No source text available')}</div>
          </div>
        </div>
      </div>

      <div class="action-bar">
        <button class="btn btn-primary btn-lg" onclick="window.approveResults()">${ICONS.check} Approve & Save</button>
        <button class="btn btn-secondary btn-lg" onclick="window.saveEdits()">${ICONS.edit} Save Edits</button>
        <button class="btn btn-danger btn-lg" onclick="window.rejectResults()">${ICONS.x} Reject</button>
      </div>
    </div>`;
}

function rf(label, key, value, isTextarea = false) {
  const v = escapeHtml(value || '');
  if (isTextarea) return `<div class="field-row"><span class="field-label">${label}</span><div class="field-value"><textarea class="input-field" data-field="${key}">${v}</textarea></div></div>`;
  return `<div class="field-row"><span class="field-label">${label}</span><div class="field-value"><input class="input-field" data-field="${key}" type="text" value="${v}" /></div></div>`;
}

function rd(dir, idx) {
  return `<li class="directive-item">
    <span class="directive-number">${idx + 1}</span>
    <div class="directive-text">
      <textarea class="input-field" data-directive="${idx}">${escapeHtml(dir.text)}</textarea>
      <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
        <span class="pill ${getConfidenceClass(dir.confidence)}" style="font-size:0.625rem">${getConfidenceLabel(dir.confidence)}</span>
        <span style="font-size:0.6875rem;color:var(--ink-muted)">${dir.type} / ${dir.deadline}</span>
      </div>
    </div>
    <div class="directive-actions"><button class="btn-icon" onclick="window.removeDirective(${idx})" title="Remove">${ICONS.trash}</button></div>
  </li>`;
}

// ── Actions ────────────────
window.approveResults = function() {
  const edited = collectEdits(); edited.status = 'approved'; edited.approvedAt = new Date().toISOString();
  saveRecord(edited); showToast('Record approved and saved', 'success');
  clearFiles(); currentResults = null; navigate('dashboard');
};
window.saveEdits = function() { collectEdits(); showToast('Edits saved locally', 'success'); };
window.rejectResults = function() {
  const edited = collectEdits(); edited.status = 'rejected';
  saveRecord(edited); showToast('Record rejected', 'error');
  clearFiles(); currentResults = null; navigate('upload');
};
window.addDirective = function() {
  if (!currentResults) return;
  currentResults.data.keyDirections.push({ text: '', type: 'mandatory', deadline: 'N/A', confidence: 0.5 });
  renderResults(currentResults);
};
window.removeDirective = function(idx) {
  if (!currentResults) return;
  currentResults.data.keyDirections.splice(idx, 1);
  renderResults(currentResults);
};

function collectEdits() {
  const data = JSON.parse(JSON.stringify(currentResults.data));
  document.querySelectorAll('#section-case .input-field').forEach(el => { if (el.dataset.field) data.caseDetails[el.dataset.field] = el.value; });
  document.querySelectorAll('#section-action .input-field').forEach(el => { if (el.dataset.field) data.actionPlan[el.dataset.field] = el.value; });
  document.querySelectorAll('[data-directive]').forEach(el => { const i = parseInt(el.dataset.directive); if (data.keyDirections[i]) data.keyDirections[i].text = el.value; });
  currentResults.data = data;
  return data;
}

// ── Settings ───────────────
function renderSettings() {
  const page = document.getElementById('page-settings');
  if (!page) return;
  const currentUrl = getColabUrl();

  page.innerHTML = `
    <div class="app-container settings-page">
      <div class="settings-header">
        <h1>Settings</h1>
        <p>Configure your Colab LLM connection</p>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">${ICONS.shield} Colab LLM Connection</div>
          <div class="connection-status disconnected" id="conn-status">
            <span class="status-dot"></span>
            Disconnected
          </div>
        </div>
        <div class="settings-card-body">
          <div class="url-input-group">
            <input class="input-field" id="colab-url-input" type="url" placeholder="https://xxxx-xx-xxx.ngrok-free.app" value="${escapeHtml(currentUrl)}" />
            <button class="btn btn-primary" id="btn-save-url">${ICONS.check} Save</button>
            <button class="btn btn-secondary" id="btn-test-url">${ICONS.search} Test</button>
          </div>
          <div class="settings-help">
            <strong>How to get the URL:</strong><br>
            1. Open <a href="https://colab.research.google.com" target="_blank">Google Colab</a><br>
            2. Upload and run the V.A.L.O.R. Colab Engine notebook<br>
            3. Copy the ngrok URL printed in the output<br>
            4. Paste it above and click Save
          </div>
          <div class="model-info" id="model-info" style="display:none">
            <div class="model-info-item"><div class="model-info-label">Model</div><div class="model-info-value" id="info-model">—</div></div>
            <div class="model-info-item"><div class="model-info-label">GPU</div><div class="model-info-value" id="info-gpu">—</div></div>
          </div>
        </div>
      </div>
    </div>`;

  // Bind events
  document.getElementById('btn-save-url').addEventListener('click', () => {
    const url = document.getElementById('colab-url-input').value.trim();
    setColabUrl(url);
    showToast(url ? 'Colab URL saved' : 'Colab URL cleared', 'success');
    if (url) testConnection(url);
  });

  document.getElementById('btn-test-url').addEventListener('click', () => {
    const url = document.getElementById('colab-url-input').value.trim();
    if (!url) { showToast('Enter a URL first', 'warning'); return; }
    testConnection(url);
  });

  // Auto-test if URL exists
  if (currentUrl) testConnection(currentUrl);
}

async function testConnection(url) {
  const statusEl = document.getElementById('conn-status');
  const infoEl = document.getElementById('model-info');

  statusEl.className = 'connection-status checking';
  statusEl.innerHTML = '<span class="status-dot"></span> Testing...';

  const health = await checkColabHealth(url);

  if (health.ok) {
    statusEl.className = 'connection-status connected';
    statusEl.innerHTML = '<span class="status-dot"></span> Connected';
    showToast('Colab engine is live!', 'success');

    if (infoEl) {
      infoEl.style.display = 'grid';
      document.getElementById('info-model').textContent = health.model || '—';
      document.getElementById('info-gpu').textContent = health.gpu || '—';
    }
  } else {
    statusEl.className = 'connection-status disconnected';
    statusEl.innerHTML = '<span class="status-dot"></span> Disconnected';
    showToast('Cannot reach Colab: ' + health.error, 'error');
    if (infoEl) infoEl.style.display = 'none';
  }
}

// ── Dashboard ──────────────
function renderDashboard() {
  const page = document.getElementById('page-dashboard');
  if (!page) return;
  const stats = getStats();
  const records = getRecords();

  page.innerHTML = `
    <div class="app-container">
      <div class="dashboard-header">
        <h1>Dashboard</h1>
        <p>Verified records and compliance tracking</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon blue">${ICONS.file}</div>
          <div><div class="stat-value">${stats.total}</div><div class="stat-label">Total Cases</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">${ICONS.check}</div>
          <div><div class="stat-value">${stats.approved}</div><div class="stat-label">Approved</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon yellow">${ICONS.clock}</div>
          <div><div class="stat-value">${stats.pending}</div><div class="stat-label">Pending</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red">${ICONS.alertCircle}</div>
          <div><div class="stat-value">${stats.rejected}</div><div class="stat-label">Rejected</div></div>
        </div>
      </div>

      <div style="margin-top:var(--sp-xl)">
        <div class="filters-row">
          <div class="filter-group">
            <span class="filter-label">Status:</span>
            <select class="select-field" id="filter-status" onchange="window.filterDashboard()">
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div class="filters-right">
            <button class="btn btn-secondary btn-sm" onclick="window.exportRecords()">${ICONS.download} Export</button>
          </div>
        </div>

        <div class="table-container">
          ${records.length === 0 ? `
            <div class="table-empty">
              ${ICONS.file}
              <p>No records yet. Upload and analyze a PDF to get started.</p>
            </div>` : `
            <table class="data-table">
              <thead><tr><th>Case No.</th><th>Court</th><th>Department</th><th>Decision</th><th>Deadline</th><th>Status</th></tr></thead>
              <tbody>${records.map(r => `<tr>
                <td><span class="case-number">${escapeHtml(r.caseDetails?.caseNumber || 'N/A')}</span></td>
                <td>${escapeHtml(truncate(r.caseDetails?.courtName || 'N/A', 25))}</td>
                <td><span class="dept-name">${ICONS.building} ${escapeHtml(r.actionPlan?.responsibleDepartment || 'N/A')}</span></td>
                <td>${escapeHtml(r.actionPlan?.decision || 'N/A')}</td>
                <td>${escapeHtml(r.actionPlan?.deadline || 'N/A')}</td>
                <td><span class="status-badge ${r.status || 'pending'}">${r.status || 'pending'}</span></td>
              </tr>`).join('')}</tbody>
            </table>`}
        </div>
      </div>
    </div>`;
}

window.filterDashboard = function() { renderDashboard(); };
window.exportRecords = function() {
  const records = getRecords();
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `valor-records-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(url);
  showToast('Records exported', 'success');
};

// ── Init ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  initUploadZone();
  document.getElementById('tab-upload')?.addEventListener('click', () => navigate('upload'));
  document.getElementById('tab-dashboard')?.addEventListener('click', () => navigate('dashboard'));
  document.getElementById('tab-settings')?.addEventListener('click', () => navigate('settings'));
  navigate('upload');
});
