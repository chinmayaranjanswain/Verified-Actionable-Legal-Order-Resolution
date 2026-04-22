// V.A.L.O.R. — Main Application (Dark Premium)

import { saveRecord, getRecords, getStats } from './modules/storage.js';
import { extractTextFromPDF } from './modules/pdfProcessor.js';
import { performOCR } from './modules/ocrEngine.js';
import { analyzeWithAI } from './modules/aiEngine.js';
import { formatFileSize, getConfidenceClass, getConfidenceLabel, showToast, ICONS, truncate, escapeHtml } from './utils/helpers.js';

// ── State ──────────────────
let currentFile = null;
let currentResults = null;
let currentPage = 'upload';

// ── Spotlight Cursor ───────
function initSpotlight() {
  const overlay = document.getElementById('spotlight-overlay');
  if (!overlay) return;

  document.addEventListener('pointermove', (e) => {
    overlay.style.background = `radial-gradient(600px circle at ${e.clientX}px ${e.clientY}px, rgba(0, 212, 170, 0.04), transparent 40%)`;

    // Update card glow positions
    document.querySelectorAll('.card, .result-section, .stat-card').forEach(card => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
      card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });
  });
}

// ── Navigation ─────────────
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  const tabEl = document.getElementById(`tab-${page}`);
  if (pageEl) pageEl.classList.add('active');
  if (tabEl) tabEl.classList.add('active');

  if (page === 'dashboard') renderDashboard();
}

// ── Upload Zone ────────────
function initUploadZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const analyzeBtn = document.getElementById('btn-analyze');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  });

  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  document.getElementById('file-remove')?.addEventListener('click', e => {
    e.stopPropagation();
    clearFile();
  });

  analyzeBtn?.addEventListener('click', () => runPipeline());
}

function handleFile(file) {
  if (file.type !== 'application/pdf') {
    showToast('Please upload a PDF file', 'error');
    return;
  }
  currentFile = file;
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-meta').textContent = formatFileSize(file.size);
  document.getElementById('file-info').classList.add('visible');
  document.getElementById('btn-analyze').disabled = false;
  document.getElementById('pipeline-container').classList.remove('visible');
}

function clearFile() {
  currentFile = null;
  document.getElementById('file-info').classList.remove('visible');
  document.getElementById('btn-analyze').disabled = true;
  document.getElementById('file-input').value = '';
  document.getElementById('pipeline-container').classList.remove('visible');
}

// ── Pipeline ───────────────
async function runPipeline() {
  if (!currentFile) return;

  const pipeline = document.getElementById('pipeline-container');
  const analyzeBtn = document.getElementById('btn-analyze');
  pipeline.classList.add('visible');
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = `<span class="spinner"></span> Analyzing...`;

  const steps = ['step-load', 'step-extract', 'step-ai', 'step-validate'];

  function setStep(idx, state, pct) {
    const el = document.getElementById(steps[idx]);
    if (!el) return;
    el.className = `pipeline-step ${state}`;
    const fill = el.querySelector('.step-progress-fill');
    const pctEl = el.querySelector('.step-percentage');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';

    const indicator = el.querySelector('.step-indicator');
    if (state === 'done' && indicator) indicator.innerHTML = ICONS.check;
    if (state === 'error' && indicator) indicator.innerHTML = ICONS.x;
  }

  try {
    setStep(0, 'active', 50);
    await new Promise(r => setTimeout(r, 400));
    setStep(0, 'done', 100);

    setStep(1, 'active', 0);
    let result = await extractTextFromPDF(currentFile, pct => setStep(1, 'active', pct));

    if (result.isScanned) {
      setStep(1, 'active', 0);
      document.querySelector('#step-extract .step-label').textContent = 'Running OCR...';
      result = await performOCR(currentFile, pct => setStep(1, 'active', pct));
    }
    setStep(1, 'done', 100);

    setStep(2, 'active', 0);
    const aiResult = await analyzeWithAI(result.text, pct => setStep(2, 'active', pct));
    setStep(2, 'done', 100);

    setStep(3, 'active', 50);
    await new Promise(r => setTimeout(r, 500));
    setStep(3, 'done', 100);

    currentResults = aiResult;

    if (aiResult.isDemo) {
      showToast('Demo mode — add API key to .env for real analysis', 'warning');
    }

    await new Promise(r => setTimeout(r, 600));
    renderResults(aiResult);
    navigate('results');

  } catch (err) {
    console.error('Pipeline error:', err);
    showToast('Analysis failed: ' + err.message, 'error');
    const failIdx = steps.findIndex(s => document.getElementById(s)?.classList.contains('active'));
    if (failIdx >= 0) setStep(failIdx, 'error', 0);
  }

  analyzeBtn.disabled = false;
  analyzeBtn.innerHTML = `${ICONS.search} Analyze Document`;
}

// ── Results ────────────────
function renderResults(result) {
  const page = document.getElementById('page-results');
  if (!page) return;
  const d = result.data;

  const dirAvgConf = d.keyDirections.reduce((s, x) => s + x.confidence, 0) / d.keyDirections.length;

  page.innerHTML = `
    <div class="app-container results-page">
      <div class="results-header">
        <h1>Analysis Complete</h1>
        <p>Review extracted data below. Edit fields as needed, then approve or reject.</p>
        ${result.isDemo ? '<div class="pill pill-yellow" style="margin-top:10px">Demo Mode — simulated data</div>' : ''}
        ${result.errors?.length ? `<div class="pill pill-red" style="margin-top:10px">${result.errors.length} validation warning(s)</div>` : ''}
      </div>

      <div class="results-grid">
        <div class="result-section" id="section-case">
          <div class="section-header">
            <div class="section-title">${ICONS.scale} Case Details</div>
            <div class="pill ${getConfidenceClass(d.caseDetails.confidence)}">${getConfidenceLabel(d.caseDetails.confidence)}</div>
          </div>
          <div class="section-body">
            ${renderField('Case No.', 'caseNumber', d.caseDetails.caseNumber)}
            ${renderField('Court', 'courtName', d.caseDetails.courtName)}
            ${renderField('Date', 'dateOfOrder', d.caseDetails.dateOfOrder)}
            ${renderField('Parties', 'partiesInvolved', d.caseDetails.partiesInvolved)}
            ${renderField('Judge', 'judgeName', d.caseDetails.judgeName)}
          </div>
        </div>

        <div class="result-section" id="section-action">
          <div class="section-header">
            <div class="section-title">${ICONS.target} Action Plan</div>
            <div class="pill ${getConfidenceClass(d.actionPlan.confidence)}">${getConfidenceLabel(d.actionPlan.confidence)}</div>
          </div>
          <div class="section-body">
            ${renderField('Decision', 'decision', d.actionPlan.decision)}
            ${renderField('Action', 'actionRequired', d.actionPlan.actionRequired, true)}
            ${renderField('Department', 'responsibleDepartment', d.actionPlan.responsibleDepartment)}
            ${renderField('Deadline', 'deadline', d.actionPlan.deadline)}
            ${renderField('Priority', 'priority', d.actionPlan.priority)}
            ${renderField('Financial', 'financialImplication', d.actionPlan.financialImplication)}
          </div>
        </div>

        <div class="result-section" id="section-directions">
          <div class="section-header">
            <div class="section-title">${ICONS.fileText} Key Directions</div>
            <div class="pill ${getConfidenceClass(dirAvgConf)}">${getConfidenceLabel(dirAvgConf)}</div>
          </div>
          <div class="section-body">
            <ul class="directive-list" id="directive-list">
              ${d.keyDirections.map((dir, i) => renderDirective(dir, i)).join('')}
            </ul>
            <button class="add-directive-btn" onclick="window.addDirective()">${ICONS.plus} Add Direction</button>
          </div>
        </div>

        <div class="result-section" id="section-source">
          <div class="section-header">
            <div class="section-title">${ICONS.file} Source Text</div>
            <div class="pill pill-accent">${d.caseDetails.caseNumber !== 'Unable to extract' ? 'Extracted' : 'Raw'}</div>
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

function renderField(label, key, value, isTextarea = false) {
  const v = escapeHtml(value || '');
  if (isTextarea) {
    return `<div class="field-row"><span class="field-label">${label}</span><div class="field-value"><textarea class="input-field" data-field="${key}">${v}</textarea></div></div>`;
  }
  return `<div class="field-row"><span class="field-label">${label}</span><div class="field-value"><input class="input-field" data-field="${key}" type="text" value="${v}" /></div></div>`;
}

function renderDirective(dir, idx) {
  return `<li class="directive-item" data-idx="${idx}">
    <span class="directive-number">${idx + 1}</span>
    <div class="directive-text">
      <textarea class="input-field" data-directive="${idx}">${escapeHtml(dir.text)}</textarea>
      <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
        <span class="pill ${getConfidenceClass(dir.confidence)}" style="font-size:0.625rem">${getConfidenceLabel(dir.confidence)}</span>
        <span style="font-size:0.6875rem;color:var(--text-tertiary)">${dir.type} / ${dir.deadline}</span>
      </div>
    </div>
    <div class="directive-actions">
      <button class="btn-icon" onclick="window.removeDirective(${idx})" title="Remove">${ICONS.trash}</button>
    </div>
  </li>`;
}

// ── Actions ────────────────
window.approveResults = function() {
  const edited = collectEdits();
  edited.status = 'approved';
  edited.approvedAt = new Date().toISOString();
  saveRecord(edited);
  showToast('Record approved and saved', 'success');
  clearFile(); currentResults = null;
  navigate('dashboard');
};

window.saveEdits = function() {
  collectEdits();
  showToast('Edits saved locally', 'success');
};

window.rejectResults = function() {
  const edited = collectEdits();
  edited.status = 'rejected';
  saveRecord(edited);
  showToast('Record rejected', 'error');
  clearFile(); currentResults = null;
  navigate('upload');
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
  document.querySelectorAll('#section-case .input-field').forEach(el => {
    if (el.dataset.field) data.caseDetails[el.dataset.field] = el.value;
  });
  document.querySelectorAll('#section-action .input-field').forEach(el => {
    if (el.dataset.field) data.actionPlan[el.dataset.field] = el.value;
  });
  document.querySelectorAll('[data-directive]').forEach(el => {
    const idx = parseInt(el.dataset.directive);
    if (data.keyDirections[idx]) data.keyDirections[idx].text = el.value;
  });
  currentResults.data = data;
  return data;
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
            </div>
          ` : `
            <table class="data-table">
              <thead><tr><th>Case No.</th><th>Court</th><th>Department</th><th>Decision</th><th>Deadline</th><th>Status</th></tr></thead>
              <tbody>
                ${records.map(r => `<tr>
                  <td><span class="case-number">${escapeHtml(r.caseDetails?.caseNumber || 'N/A')}</span></td>
                  <td>${escapeHtml(truncate(r.caseDetails?.courtName || 'N/A', 25))}</td>
                  <td><span class="dept-name">${ICONS.building} ${escapeHtml(r.actionPlan?.responsibleDepartment || 'N/A')}</span></td>
                  <td>${escapeHtml(r.actionPlan?.decision || 'N/A')}</td>
                  <td>${escapeHtml(r.actionPlan?.deadline || 'N/A')}</td>
                  <td><span class="status-badge ${r.status || 'pending'}">${r.status || 'pending'}</span></td>
                </tr>`).join('')}
              </tbody>
            </table>
          `}
        </div>
      </div>
    </div>`;
}

window.filterDashboard = function() { renderDashboard(); };

window.exportRecords = function() {
  const records = getRecords();
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `valor-records-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Records exported', 'success');
};

// ── Init ───────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSpotlight();
  initUploadZone();
  document.getElementById('tab-upload')?.addEventListener('click', () => navigate('upload'));
  document.getElementById('tab-dashboard')?.addEventListener('click', () => navigate('dashboard'));
  navigate('upload');
});
