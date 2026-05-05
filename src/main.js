import { saveRecord, getRecords, getStats, getColabUrl, setColabUrl, updateRecord, deleteRecord } from './modules/storage.js';
import { extractTextFromPDF } from './modules/pdfProcessor.js';
import { performOCR } from './modules/ocrEngine.js';
import { analyzeWithAI, checkColabHealth } from './modules/aiEngine.js';
import { cleanOCRText } from './utils/prompts.js';
import { formatFileSize, getConfidenceClass, getConfidenceLabel, showToast, ICONS, truncate, escapeHtml } from './utils/helpers.js';

let pdfEntries = []; // {file, text, status, result}
let currentResults = null;
let lastPage = 'upload'; // track where user came from

function navigate(page, fromPage) {
  if (fromPage) lastPage = fromPage;
  else if (page !== 'results') lastPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.getElementById(`tab-${page}`)?.classList.add('active');
  if (page === 'dashboard') renderDashboard();
  if (page === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function initUploadZone() {
  const dz = document.getElementById('drop-zone'), fi = document.getElementById('file-input');
  if (!dz) return;
  ['dragenter','dragover'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('drag-over'); }));
  ['dragleave','drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('drag-over'); }));
  dz.addEventListener('drop', e => { const f = [...e.dataTransfer.files].filter(x => x.type === 'application/pdf'); if (f.length) addFiles(f); });
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', e => { const f = [...e.target.files].filter(x => x.type === 'application/pdf'); if (f.length) addFiles(f); fi.value = ''; });
  document.getElementById('btn-add-more')?.addEventListener('click', () => fi.click());
  document.getElementById('btn-analyze')?.addEventListener('click', runAllAnalysis);
}

async function addFiles(files) {
  for (const file of files) {
    if (pdfEntries.find(e => e.file.name === file.name && e.file.size === file.size)) continue;
    const entry = { file, text: '', status: 'extracting', result: null, id: Date.now() + Math.random() };
    pdfEntries.push(entry);
    renderCards();
    try {
      let res = await extractTextFromPDF(file, () => {});
      if (res.isScanned) { updateCardStatus(entry.id, 'OCR...'); res = await performOCR(file, () => {}); }
      entry.text = res.text || '';
      entry.status = entry.text.length > 50 ? 'ready' : 'error';
    } catch (err) { entry.text = 'Error: ' + err.message; entry.status = 'error'; }
    renderCards();
  }
  document.getElementById('btn-analyze').disabled = pdfEntries.filter(e => e.status === 'ready').length === 0;
  const readyCount = pdfEntries.filter(e => e.status === 'ready').length;
  document.getElementById('btn-analyze').innerHTML = `${ICONS.search} Analyze ${readyCount} Document${readyCount !== 1 ? 's' : ''}`;
  document.getElementById('btn-add-more').style.display = 'flex';
  document.getElementById('pipeline-container').classList.remove('visible');
}

function updateCardStatus(id, label) {
  const el = document.querySelector(`[data-pdf-id="${id}"] .pdf-card-status`);
  if (el) el.textContent = label;
}

function renderCards() {
  const container = document.getElementById('pdf-cards');
  container.innerHTML = pdfEntries.map((entry, i) => {
    const preview = entry.text ? escapeHtml(entry.text.substring(0, 600)) : '';
    let statusClass, statusLabel;
    if (entry.status === 'done') { const c = Math.round((entry.result?.data?.caseDetails?.confidence||0)*100); statusClass = 'ready'; statusLabel = `Done · ${c}%`; }
    else if (entry.status === 'ready') {
      const wordCount = entry.text.split(/\s+/).filter(w => w.length > 0).length;
      statusClass = 'ready';
      statusLabel = `Ready · ${wordCount} words · ${(entry.text.length/1000).toFixed(1)}K chars`;
    }
    else if (entry.status === 'error') { statusClass = 'error'; statusLabel = 'Error'; }
    else { statusClass = 'extracting'; statusLabel = 'Extracting...'; }
    const viewBtn = entry.status === 'done' ? `<button class="pdf-card-toggle" style="background:var(--green-soft);color:var(--green);border-top-color:var(--green)" onclick="window.viewPdfResult(${i})">${ICONS.search} View Analysis Result</button>` : '';
    return `<div class="pdf-card" data-pdf-id="${entry.id}" style="animation-delay:${i*0.05}s">
      <div class="pdf-card-header">
        <div class="pdf-card-number">${i+1}</div>
        <div class="pdf-card-info">
          <div class="pdf-card-name">${escapeHtml(entry.file.name)}</div>
          <div class="pdf-card-meta">${formatFileSize(entry.file.size)}</div>
        </div>
        <div class="pdf-card-status ${statusClass}">${statusLabel}</div>
        <button class="pdf-card-remove" onclick="window.removePdf(${i})" title="Remove">${ICONS.x}</button>
      </div>
      <div class="pdf-card-body" id="pdf-body-${i}" style="display:none">
        ${preview ? `<div class="pdf-card-text">${preview}${entry.text.length > 600 ? '\n...' : ''}</div>` : '<div class="pdf-card-empty">No text extracted</div>'}
      </div>
      <button class="pdf-card-toggle" onclick="window.togglePdfBody(${i})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        Show Extracted Text
      </button>
      ${viewBtn}
    </div>`;
  }).join('');
}

window.viewPdfResult = function(idx) {
  const entry = pdfEntries[idx];
  if (!entry || !entry.result) return;
  currentResults = entry.result;
  renderResults(entry.result);
  navigate('results');
};

window.removePdf = function(idx) {
  pdfEntries.splice(idx, 1);
  renderCards();
  if (pdfEntries.length === 0) { document.getElementById('btn-add-more').style.display = 'none'; document.getElementById('btn-analyze').disabled = true; document.getElementById('btn-analyze').innerHTML = `${ICONS.search} Analyze All Documents`; }
  else { const r = pdfEntries.filter(e => e.status === 'ready').length; document.getElementById('btn-analyze').innerHTML = `${ICONS.search} Analyze ${r} Document${r!==1?'s':''}`; document.getElementById('btn-analyze').disabled = r === 0; }
};

window.togglePdfBody = function(idx) {
  const body = document.getElementById(`pdf-body-${idx}`);
  const btn = body?.parentElement?.querySelector('.pdf-card-toggle');
  if (!body) return;
  const visible = body.style.display !== 'none';
  body.style.display = visible ? 'none' : 'block';
  if (btn) btn.innerHTML = visible ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg> Show Extracted Text` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg> Hide Text`;
};

async function runAllAnalysis() {
  const ready = pdfEntries.filter(e => e.status === 'ready');
  if (ready.length === 0) { showToast('No new PDFs to analyze — all already processed','warning'); return; }
  const btn = document.getElementById('btn-analyze');
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Analyzing...`;

  if (ready.length === 1) {
    await runSinglePipeline(ready[0]);
  } else {
    for (let i = 0; i < pdfEntries.length; i++) {
      const entry = pdfEntries[i];
      if (entry.status !== 'ready') continue;
      const statusEl = document.querySelector(`[data-pdf-id="${entry.id}"] .pdf-card-status`);
      if (statusEl) { statusEl.className = 'pdf-card-status analyzing'; statusEl.textContent = 'Analyzing...'; }
      try {
        const result = await analyzeWithAI(entry.text, () => {});
        entry.result = result; entry.status = 'done';
        if (statusEl) { statusEl.className = 'pdf-card-status ready'; const c = Math.round((result.data?.caseDetails?.confidence||0)*100); statusEl.textContent = `Done · ${c}%`; }
        if (result?.data) saveRecord({ ...result.data, status: 'pending', fileName: entry.file.name });
      } catch (err) {
        entry.status = 'error';
        if (statusEl) { statusEl.className = 'pdf-card-status error'; statusEl.textContent = 'Failed'; }
      }
    }
    const done = pdfEntries.filter(e => e.status === 'done').length;
    showToast(`Batch complete: ${done}/${ready.length} analyzed — click "View Analysis Result" on each card`, done === ready.length ? 'success' : 'warning');
    renderCards(); // Re-render to show View Result buttons
  }
  btn.disabled = false;
  const r = pdfEntries.filter(e => e.status === 'ready').length;
  if (r > 0) btn.innerHTML = `${ICONS.search} Analyze ${r} Document${r!==1?'s':''}`;
  else btn.innerHTML = `${ICONS.check} All Analyzed`;
}

async function runSinglePipeline(entry) {
  const pipe = document.getElementById('pipeline-container');
  pipe.classList.add('visible');
  const steps = ['step-load','step-extract','step-clean','step-ai','step-validate'];
  function setStep(i, state, pct) {
    const el = document.getElementById(steps[i]); if (!el) return;
    el.className = `pipeline-step ${state}`;
    const f = el.querySelector('.step-progress-fill'), p = el.querySelector('.step-percentage');
    if (f) f.style.width = pct+'%'; if (p) p.textContent = pct+'%';
    if (state==='done') { const ind = el.querySelector('.step-indicator'); if (ind) ind.innerHTML = ICONS.check; }
  }
  try {
    setStep(0,'active',50); await new Promise(r=>setTimeout(r,300)); setStep(0,'done',100);
    setStep(1,'done',100); // Already extracted
    setStep(2,'active',0);
    const result = await analyzeWithAI(entry.text, pct => {
      if (pct<=50) setStep(2,'active',pct*2);
      else if (pct<=90) { setStep(2,'done',100); setStep(3,'active',(pct-50)*2.5); }
      else { setStep(3,'done',100); setStep(4,'active',(pct-90)*10); }
    });
    setStep(2,'done',100); setStep(3,'done',100); setStep(4,'done',100);
    if (!result.llmUsed) { const l=document.querySelector('#step-ai .step-desc'); if(l) l.textContent='Skipped — no Colab configured'; }
    entry.result = result; entry.status = 'done'; currentResults = result;
    const conf = Math.round((result.data?.caseDetails?.confidence||0)*100);
    const method = result.method||'rule-based';
    showToast(`Analysis complete (${method}) — ${conf}% confidence`, result.valid?'success':'warning');
    await new Promise(r=>setTimeout(r,500));
    renderResults(result); navigate('results');
  } catch(err) { showToast('Pipeline failed: '+err.message,'error'); }
}

function renderResults(result) {
  const page = document.getElementById('page-results'); if (!page) return;
  const d = result.data;
  const dirAvg = d.keyDirections.reduce((s,x)=>s+x.confidence,0)/d.keyDirections.length;
  const backLabel = lastPage === 'dashboard' ? 'Back to Dashboard' : 'Back to Upload';
  const backIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="m15 18-6-6 6-6"/></svg>`;
  page.innerHTML = `<div class="app-container results-page">
    <button class="back-btn" onclick="window.goBack()">${backIcon} ${backLabel}</button>
    <div class="results-header">
      <h1>Analysis <span class="highlight">Complete</span></h1>
      <p>Review extracted data. Edit fields as needed, then approve or reject.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <div class="pill ${result.llmUsed?'pill-blue':'pill-yellow'}">${(result.method||'RULE-BASED').toUpperCase()}</div>
        ${result.ruleConfidence?`<div class="pill pill-green">RULES: ${Math.round(result.ruleConfidence*100)}%</div>`:''}
        ${result.llmUsed?`<div class="pill pill-blue">LLM BOOST: +${Math.round((result.llmConfidence||0)*100)}%</div>`:''}
        ${result.errors?.length?`<div class="pill pill-red">${result.errors.length} WARNINGS</div>`:''}
      </div>
    </div>
    <div class="results-grid">
      <div class="result-section" id="section-case"><div class="section-header"><div class="section-title">${ICONS.scale} Case Details</div><div class="pill ${getConfidenceClass(d.caseDetails.confidence)}">${getConfidenceLabel(d.caseDetails.confidence)}</div></div><div class="section-body">
        ${rf('Case No.','caseNumber',d.caseDetails.caseNumber)}${rf('Court','courtName',d.caseDetails.courtName)}${rf('Date','dateOfOrder',d.caseDetails.dateOfOrder)}${rf('Parties','partiesInvolved',d.caseDetails.partiesInvolved)}${rf('Judge','judgeName',d.caseDetails.judgeName)}
      </div></div>
      <div class="result-section" id="section-action"><div class="section-header"><div class="section-title">${ICONS.target} Action Plan</div><div class="pill ${getConfidenceClass(d.actionPlan.confidence)}">${getConfidenceLabel(d.actionPlan.confidence)}</div></div><div class="section-body">
        ${rf('Decision','decision',d.actionPlan.decision)}${rf('Action','actionRequired',d.actionPlan.actionRequired,true)}${rf('Department','responsibleDepartment',d.actionPlan.responsibleDepartment)}${rf('Deadline','deadline',d.actionPlan.deadline)}${rf('Priority','priority',d.actionPlan.priority)}${rf('Financial','financialImplication',d.actionPlan.financialImplication)}${rf('Risk','riskIfNotComplied',d.actionPlan.riskIfNotComplied)}
      </div></div>
      <div class="result-section" id="section-directions"><div class="section-header"><div class="section-title">${ICONS.fileText} Key Directions</div><div class="pill ${getConfidenceClass(dirAvg)}">${getConfidenceLabel(dirAvg)}</div></div><div class="section-body">
        <ul class="directive-list">${d.keyDirections.map((dir,i)=>rd(dir,i)).join('')}</ul>
        <button class="add-directive-btn" onclick="window.addDirective()">${ICONS.plus} Add Direction</button>
      </div></div>
      <div class="result-section" id="section-source"><div class="section-header"><div class="section-title">${ICONS.file} Source Text</div><div class="pill pill-blue">EXTRACTED</div></div><div class="section-body">
        <div class="source-text-box">${escapeHtml(truncate(result.sourceText||'',8000))}</div>
        <div style="margin-top:8px;font-size:0.75rem;color:var(--ink-muted)">${(result.sourceText||'').split(/\s+/).filter(w=>w.length>0).length} words · ${(result.sourceText||'').length} chars · Preprocessed: ${result.preprocessedLength||0} chars</div>
      </div></div>
    </div>
    <div class="action-bar">
      <button class="btn btn-primary btn-lg" onclick="window.approveResults()">${ICONS.check} Approve & Save</button>
      <button class="btn btn-secondary btn-lg" onclick="window.saveEdits()">${ICONS.edit} Save Edits</button>
      <button class="btn btn-danger btn-lg" onclick="window.rejectResults()">${ICONS.x} Reject</button>
      <button class="btn btn-lg" onclick="window.goBack()" style="margin-left:auto">${backIcon} ${backLabel}</button>
    </div>
  </div>`;
}

function rf(label,key,value,ta=false) {
  const v=escapeHtml(value||'');
  return ta?`<div class="field-row"><span class="field-label">${label}</span><div class="field-value"><textarea class="input-field" data-field="${key}">${v}</textarea></div></div>`
    :`<div class="field-row"><span class="field-label">${label}</span><div class="field-value"><input class="input-field" data-field="${key}" type="text" value="${v}"/></div></div>`;
}
function rd(dir,i) {
  return `<li class="directive-item"><span class="directive-number">${i+1}</span><div class="directive-text"><textarea class="input-field" data-directive="${i}">${escapeHtml(dir.text)}</textarea><div style="display:flex;gap:6px;margin-top:4px;align-items:center"><span class="pill ${getConfidenceClass(dir.confidence)}" style="font-size:0.625rem">${getConfidenceLabel(dir.confidence)}</span><span style="font-size:0.6875rem;color:var(--ink-muted)">${dir.type} / ${dir.deadline}</span></div></div><div class="directive-actions"><button class="btn-icon" onclick="window.removeDirective(${i})" title="Remove">${ICONS.trash}</button></div></li>`;
}

window.goBack = function() { navigate(lastPage || 'upload'); };
window.approveResults = function() { const e=collectEdits(); e.status='approved'; e.approvedAt=new Date().toISOString(); saveRecord(e); showToast('Record approved','success'); currentResults=null; navigate('dashboard'); };
window.saveEdits = function() { collectEdits(); showToast('Edits saved locally','success'); };
window.rejectResults = function() { const e=collectEdits(); e.status='rejected'; saveRecord(e); showToast('Record rejected','error'); currentResults=null; navigate('upload'); };
window.addDirective = function() { if(!currentResults)return; currentResults.data.keyDirections.push({text:'',type:'mandatory',deadline:'N/A',confidence:0.5}); renderResults(currentResults); };
window.removeDirective = function(i) { if(!currentResults)return; currentResults.data.keyDirections.splice(i,1); renderResults(currentResults); };

function collectEdits() {
  const data=JSON.parse(JSON.stringify(currentResults.data));
  document.querySelectorAll('#section-case .input-field').forEach(el=>{if(el.dataset.field)data.caseDetails[el.dataset.field]=el.value;});
  document.querySelectorAll('#section-action .input-field').forEach(el=>{if(el.dataset.field)data.actionPlan[el.dataset.field]=el.value;});
  document.querySelectorAll('[data-directive]').forEach(el=>{const i=parseInt(el.dataset.directive);if(data.keyDirections[i])data.keyDirections[i].text=el.value;});
  currentResults.data=data; return data;
}

function renderSettings() {
  const page=document.getElementById('page-settings'); if(!page)return;
  const url=getColabUrl();
  page.innerHTML=`<div class="app-container settings-page"><div class="settings-header"><h1>Settings</h1><p>Configure your Colab LLM connection (optional — system works without it)</p></div>
    <div class="settings-card"><div class="settings-card-header"><div class="settings-card-title">${ICONS.shield} Colab LLM Connection</div><div class="connection-status disconnected" id="conn-status"><span class="status-dot"></span>Disconnected</div></div>
    <div class="settings-card-body"><div class="url-input-group"><input class="input-field" id="colab-url-input" type="url" placeholder="https://xxxx-xx-xxx.ngrok-free.app" value="${escapeHtml(url)}"/><button class="btn btn-primary" id="btn-save-url">${ICONS.check} Save</button><button class="btn btn-secondary" id="btn-test-url">${ICONS.search} Test</button></div>
    <div class="settings-help"><strong>How to get the URL:</strong><br>1. Open <a href="https://colab.research.google.com" target="_blank">Google Colab</a><br>2. Run the V.A.L.O.R. Colab Engine notebook<br>3. Copy the ngrok URL<br>4. Paste above and Save</div>
    <div class="model-info" id="model-info" style="display:none"><div class="model-info-item"><div class="model-info-label">Model</div><div class="model-info-value" id="info-model">—</div></div><div class="model-info-item"><div class="model-info-label">GPU</div><div class="model-info-value" id="info-gpu">—</div></div></div>
    </div></div></div>`;
  document.getElementById('btn-save-url').addEventListener('click',()=>{const u=document.getElementById('colab-url-input').value.trim();setColabUrl(u);showToast(u?'URL saved':'URL cleared','success');if(u)testConn(u);});
  document.getElementById('btn-test-url').addEventListener('click',()=>{const u=document.getElementById('colab-url-input').value.trim();if(!u){showToast('Enter URL first','warning');return;}testConn(u);});
  if(url)testConn(url);
}
async function testConn(url) {
  const s=document.getElementById('conn-status'),info=document.getElementById('model-info');
  s.className='connection-status checking'; s.innerHTML='<span class="status-dot"></span>Testing...';
  const h=await checkColabHealth(url);
  if(h.ok){s.className='connection-status connected';s.innerHTML='<span class="status-dot"></span>Connected';showToast('Colab connected!','success');if(info){info.style.display='grid';document.getElementById('info-model').textContent=h.model||'—';document.getElementById('info-gpu').textContent=h.gpu||'—';}}
  else{s.className='connection-status disconnected';s.innerHTML='<span class="status-dot"></span>Disconnected';showToast('Cannot reach Colab: '+h.error,'error');if(info)info.style.display='none';}
}

function renderDashboard() {
  const page=document.getElementById('page-dashboard'); if(!page)return;
  const stats=getStats();
  const filter=document.getElementById('filter-status')?.value||'all';
  let records=getRecords();
  if(filter!=='all') records=records.filter(r=>r.status===filter);
  page.innerHTML=`<div class="app-container"><div class="dashboard-header"><h1>Dashboard</h1><p>Verified records and compliance tracking. Click any row to view or edit.</p></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon blue">${ICONS.file}</div><div><div class="stat-value">${stats.total}</div><div class="stat-label">Total Cases</div></div></div>
      <div class="stat-card"><div class="stat-icon green">${ICONS.check}</div><div><div class="stat-value">${stats.approved}</div><div class="stat-label">Approved</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow">${ICONS.clock}</div><div><div class="stat-value">${stats.pending}</div><div class="stat-label">Pending</div></div></div>
      <div class="stat-card"><div class="stat-icon red">${ICONS.alertCircle}</div><div><div class="stat-value">${stats.rejected}</div><div class="stat-label">Rejected</div></div></div>
    </div>
    <div style="margin-top:var(--sp-xl)"><div class="filters-row"><div class="filter-group"><span class="filter-label">Status:</span><select class="select-field" id="filter-status" onchange="window.filterDashboard()"><option value="all"${filter==='all'?' selected':''}>All</option><option value="approved"${filter==='approved'?' selected':''}>Approved</option><option value="pending"${filter==='pending'?' selected':''}>Pending</option><option value="rejected"${filter==='rejected'?' selected':''}>Rejected</option></select></div><div class="filters-right"><button class="btn btn-secondary btn-sm" onclick="window.exportRecords()">${ICONS.download} Export</button></div></div>
    <div class="table-container">${records.length===0?`<div class="table-empty">${ICONS.file}<p>No records yet. Upload and analyze a PDF to get started.</p></div>`:`<table class="data-table"><thead><tr><th>Case No.</th><th>Court</th><th>Department</th><th>Decision</th><th>Deadline</th><th>Status</th><th>Actions</th></tr></thead><tbody>${records.map((r,i)=>`<tr style="cursor:pointer" onclick="window.viewRecord('${r.id}')">
<td><span class="case-number">${escapeHtml(r.caseDetails?.caseNumber||'N/A')}</span></td>
<td>${escapeHtml(truncate(r.caseDetails?.courtName||'N/A',25))}</td>
<td><span class="dept-name">${ICONS.building} ${escapeHtml(truncate(r.actionPlan?.responsibleDepartment||'N/A',20))}</span></td>
<td>${escapeHtml(r.actionPlan?.decision||'N/A')}</td>
<td>${escapeHtml(r.actionPlan?.deadline||'N/A')}</td>
<td><span class="status-badge ${r.status||'pending'}">${r.status||'pending'}</span></td>
<td style="display:flex;gap:4px">
<button class="btn btn-sm" style="padding:4px 8px;font-size:0.625rem" onclick="event.stopPropagation();window.quickApprove('${r.id}')">${ICONS.check}</button>
<button class="btn btn-sm" style="padding:4px 8px;font-size:0.625rem" onclick="event.stopPropagation();window.quickReject('${r.id}')">${ICONS.x}</button>
<button class="btn btn-sm" style="padding:4px 8px;font-size:0.625rem" onclick="event.stopPropagation();window.deleteRec('${r.id}')">${ICONS.trash}</button>
</td></tr>`).join('')}</tbody></table>`}</div></div></div>`;
}
window.filterDashboard = function() { renderDashboard(); };
window.exportRecords = function() { const r=getRecords(); const b=new Blob([JSON.stringify(r,null,2)],{type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a');a.href=u;a.download=`valor-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(u);showToast('Exported','success'); };
window.quickApprove = function(id) { updateRecord(id, {status:'approved',approvedAt:new Date().toISOString()}); showToast('Record approved','success'); renderDashboard(); };
window.quickReject = function(id) { updateRecord(id, {status:'rejected'}); showToast('Record rejected','error'); renderDashboard(); };
window.deleteRec = function(id) { deleteRecord(id); showToast('Record deleted','warning'); renderDashboard(); };
window.viewRecord = function(id) {
  const records = getRecords();
  const record = records.find(r => r.id === id);
  if (!record) return;
  currentResults = { data: record, valid: true, errors: [], method: 'saved record', ruleConfidence: record.caseDetails?.confidence || 0, llmUsed: false };
  renderResults(currentResults);
  navigate('results');
};

document.addEventListener('DOMContentLoaded', () => {
  initUploadZone();
  document.getElementById('tab-upload')?.addEventListener('click',()=>navigate('upload'));
  document.getElementById('tab-dashboard')?.addEventListener('click',()=>navigate('dashboard'));
  document.getElementById('tab-settings')?.addEventListener('click',()=>navigate('settings'));
  navigate('upload');
});
