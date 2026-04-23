// V.A.L.O.R. — Validator + Schema Mappers (Rule + Colab)

const REQUIRED_CASE_FIELDS = ['caseNumber', 'courtName', 'dateOfOrder', 'partiesInvolved'];
const REQUIRED_ACTION_FIELDS = ['decision', 'actionRequired', 'responsibleDepartment', 'deadline'];

// ═══════════════════════════════════════════════════════════════════
// MAP RULE ENGINE OUTPUT → V.A.L.O.R. INTERNAL SCHEMA
// ═══════════════════════════════════════════════════════════════════
export function mapRuleResponse(ruleData) {
  if (!ruleData || typeof ruleData !== 'object') return null;

  const conf = ruleData._confidence || 0;

  const mapped = {
    caseDetails: {
      caseNumber: ruleData.case_no || 'Not Found',
      courtName: ruleData.court || 'Not Found',
      dateOfOrder: ruleData.date_of_order || 'Not Found',
      partiesInvolved: ruleData.parties || 'Not Found',
      judgeName: ruleData.judge || 'Not Found',
      confidence: conf
    },
    keyDirections: [],
    actionPlan: {
      decision: ruleData.decision || 'Seek Clarification',
      actionRequired: ruleData.action_required || 'Not determined',
      responsibleDepartment: ruleData.department_responsible || 'Not determined',
      deadline: 'Not determined',
      priority: 'High',
      financialImplication: ruleData.financial_implication || 'N/A',
      riskIfNotComplied: ruleData.risk_if_not_complied || 'Not assessed',
      confidence: conf
    }
  };

  // Map directions array (rule engine returns plain strings)
  const dirs = ruleData.key_directions || [];
  if (Array.isArray(dirs) && dirs.length > 0) {
    mapped.keyDirections = dirs.map(d => ({
      text: typeof d === 'string' ? d : (d.text || 'Direction'),
      type: classifyDirectiveType(typeof d === 'string' ? d : d.text),
      deadline: extractInlineDeadline(typeof d === 'string' ? d : d.text),
      confidence: conf
    }));
  }

  // Map deadlines
  const deadlines = ruleData.deadlines || [];
  if (deadlines.length > 0) {
    mapped.actionPlan.deadline = deadlines[0];
    mapped.keyDirections.forEach((dir, i) => {
      if (dir.deadline === 'N/A' && deadlines[i]) dir.deadline = deadlines[i];
    });
  }

  // Fallback directive
  if (mapped.keyDirections.length === 0) {
    mapped.keyDirections = [{
      text: mapped.actionPlan.actionRequired !== 'Not determined'
        ? mapped.actionPlan.actionRequired
        : 'No specific directions extracted — review source text manually',
      type: 'mandatory',
      deadline: mapped.actionPlan.deadline || 'N/A',
      confidence: Math.max(conf, 0.3)
    }];
  }

  return mapped;
}

// ═══════════════════════════════════════════════════════════════════
// MAP COLAB LLM OUTPUT → V.A.L.O.R. INTERNAL SCHEMA
// ═══════════════════════════════════════════════════════════════════
export function mapColabResponse(colabData, colabConfidence) {
  if (!colabData || typeof colabData !== 'object') return null;

  const mapped = {
    caseDetails: {
      caseNumber: colabData.case_no || colabData.caseNumber || colabData.case_number || 'Not Found',
      courtName: colabData.court || colabData.courtName || colabData.court_name || 'Not Found',
      dateOfOrder: colabData.date_of_order || colabData.dateOfOrder || colabData.date || 'Not Found',
      partiesInvolved: colabData.parties || colabData.partiesInvolved || 'Not Found',
      judgeName: colabData.judge || colabData.judgeName || colabData.judge_name || 'Not Found',
      confidence: colabConfidence || 0
    },
    keyDirections: [],
    actionPlan: {
      decision: colabData.decision || 'Seek Clarification',
      actionRequired: colabData.action_required || colabData.actionRequired || 'Not determined',
      responsibleDepartment: colabData.department_responsible || colabData.responsibleDepartment || colabData.department || 'Not determined',
      deadline: 'Not determined',
      priority: 'High',
      financialImplication: colabData.financial_implication || colabData.financialImplication || 'N/A',
      riskIfNotComplied: colabData.risk_if_not_complied || colabData.riskIfNotComplied || 'Not assessed',
      confidence: colabConfidence || 0
    }
  };

  const dirs = colabData.key_directions || colabData.keyDirections || colabData.directions || [];
  if (Array.isArray(dirs) && dirs.length > 0) {
    mapped.keyDirections = dirs.map((d, i) => {
      if (typeof d === 'string') return { text: d, type: 'mandatory', deadline: 'N/A', confidence: colabConfidence || 0.7 };
      return { text: d.text || d.direction || `Direction ${i + 1}`, type: normalizeType(d.type), deadline: d.deadline || 'N/A', confidence: d.confidence || colabConfidence || 0.7 };
    });
  }

  const deadlines = colabData.deadlines || [];
  if (deadlines.length > 0) {
    mapped.actionPlan.deadline = deadlines[0];
    mapped.keyDirections.forEach((dir, i) => { if (dir.deadline === 'N/A' && deadlines[i]) dir.deadline = deadlines[i]; });
  }

  if (mapped.keyDirections.length === 0) {
    mapped.keyDirections = [{ text: 'No directions extracted by LLM', type: 'mandatory', deadline: 'N/A', confidence: 0.3 }];
  }

  return mapped;
}

// ═══════════════════════════════════════════════════════════════════
// VALIDATE EXTRACTION (works for both rule + LLM results)
// ═══════════════════════════════════════════════════════════════════
export function validateExtraction(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['Response is not a valid object'], data: null };

  // ── caseDetails ──
  if (!data.caseDetails || typeof data.caseDetails !== 'object') { errors.push('Missing caseDetails'); data.caseDetails = {}; }

  let caseFound = 0;
  for (const f of REQUIRED_CASE_FIELDS) {
    const v = data.caseDetails[f];
    if (!v || v === 'Not Found' || v === 'N/A') { data.caseDetails[f] = data.caseDetails[f] || 'Not Found'; errors.push(`Missing caseDetails.${f}`); }
    else caseFound++;
  }
  data.caseDetails.judgeName = data.caseDetails.judgeName || 'Not Found';
  if (data.caseDetails.judgeName !== 'Not Found') caseFound++;

  const totalCase = REQUIRED_CASE_FIELDS.length + 1;
  const compCaseConf = caseFound / totalCase;
  if (!data.caseDetails.confidence || data.caseDetails.confidence < compCaseConf) {
    data.caseDetails.confidence = Math.round(compCaseConf * 100) / 100;
  }
  data.caseDetails.confidence = clamp(data.caseDetails.confidence, 0, 1);

  // ── keyDirections ──
  if (!Array.isArray(data.keyDirections) || data.keyDirections.length === 0) {
    errors.push('Missing keyDirections');
    data.keyDirections = [{ text: 'No directions extracted', type: 'mandatory', deadline: 'N/A', confidence: 0.3 }];
  }
  data.keyDirections = data.keyDirections.map((d, i) => ({
    text: d.text || `Direction ${i + 1}`,
    type: normalizeType(d.type),
    deadline: d.deadline || 'N/A',
    confidence: clamp(d.confidence || compCaseConf, 0, 1)
  }));

  // ── actionPlan ──
  if (!data.actionPlan || typeof data.actionPlan !== 'object') { errors.push('Missing actionPlan'); data.actionPlan = {}; }
  const ap = data.actionPlan;
  ap.decision = ap.decision || 'Seek Clarification';
  ap.actionRequired = ap.actionRequired || 'Not determined';
  ap.responsibleDepartment = ap.responsibleDepartment || 'Not determined';
  ap.deadline = ap.deadline || 'Not determined';
  ap.priority = normalizePriority(ap.priority);
  ap.financialImplication = ap.financialImplication || 'N/A';
  ap.riskIfNotComplied = ap.riskIfNotComplied || 'Not assessed';

  let actFound = 0;
  for (const f of REQUIRED_ACTION_FIELDS) { if (ap[f] && ap[f] !== 'Not determined' && ap[f] !== 'Seek Clarification') actFound++; }
  const compActConf = actFound / REQUIRED_ACTION_FIELDS.length;
  if (!ap.confidence || ap.confidence < compActConf) ap.confidence = Math.round(compActConf * 100) / 100;
  ap.confidence = clamp(ap.confidence, 0, 1);

  for (const f of REQUIRED_ACTION_FIELDS) { if (!ap[f] || ap[f] === 'Not determined') errors.push(`Missing actionPlan.${f}`); }

  return { valid: errors.length === 0, errors, data };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function clamp(v, min, max) { const n = parseFloat(v); return isNaN(n) ? min : Math.max(min, Math.min(max, n)); }

function normalizeType(t) {
  if (!t) return 'mandatory';
  const l = String(t).toLowerCase();
  if (l.includes('recommend') || l.includes('advisory') || l.includes('suggest') || l.includes('may consider')) return 'recommended';
  if (l.includes('condition')) return 'conditional';
  return 'mandatory';
}

function normalizePriority(p) {
  if (!p) return 'High';
  const l = String(p).toLowerCase();
  if (l.includes('high') || l.includes('urgent') || l.includes('critical') || l.includes('immediate')) return 'High';
  if (l.includes('low') || l.includes('minor')) return 'Low';
  return 'Medium';
}

// Classify directive type based on text content
function classifyDirectiveType(text) {
  if (!text) return 'mandatory';
  const lower = text.toLowerCase();
  if (/\b(?:may\s+consider|may\s+also|optional|advisable|recommended)\b/.test(lower)) return 'recommended';
  if (/\b(?:subject\s+to|provided\s+that|on\s+condition)\b/.test(lower)) return 'conditional';
  return 'mandatory';
}

// Extract deadline from within a directive sentence
function extractInlineDeadline(text) {
  if (!text) return 'N/A';
  const m = text.match(/within\s+(\d+\s+(?:days?|weeks?|months?|years?))/i);
  if (m) return m[1];
  const m2 = text.match(/(?:before|by)\s+(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/i);
  if (m2) return m2[1];
  return 'N/A';
}

export function parseAIResponse(rawText) {
  let s = rawText.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('No JSON found');
  s = s.substring(a, b + 1);
  try { return JSON.parse(s); } catch (e) {
    try { return JSON.parse(s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/'/g, '"')); }
    catch { throw new Error(`JSON parse failed: ${e.message}`); }
  }
}
