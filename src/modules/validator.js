// V.A.L.O.R. — JSON Schema Validator (Optimized)

const REQUIRED_CASE_FIELDS = ['caseNumber', 'courtName', 'dateOfOrder', 'partiesInvolved'];
const REQUIRED_ACTION_FIELDS = ['decision', 'actionRequired', 'responsibleDepartment', 'deadline'];

export function validateExtraction(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Response is not a valid object'], data: null };
  }

  // ── caseDetails ──
  if (!data.caseDetails || typeof data.caseDetails !== 'object') {
    errors.push('Missing caseDetails section');
    data.caseDetails = {};
  }
  for (const field of REQUIRED_CASE_FIELDS) {
    if (!data.caseDetails[field] || data.caseDetails[field] === 'Unable to extract') {
      data.caseDetails[field] = data.caseDetails[field] || 'Not Found';
      errors.push(`Missing caseDetails.${field}`);
    }
  }
  data.caseDetails.judgeName = data.caseDetails.judgeName || 'Not Found';
  data.caseDetails.confidence = normalizeConfidence(data.caseDetails?.confidence);

  // ── keyDirections ──
  if (!Array.isArray(data.keyDirections) || data.keyDirections.length === 0) {
    // Try alternate field names the LLM might use
    if (Array.isArray(data.key_directions)) {
      data.keyDirections = data.key_directions;
    } else if (Array.isArray(data.directions)) {
      data.keyDirections = data.directions;
    } else {
      errors.push('Missing or empty keyDirections');
      data.keyDirections = [{ text: 'No directions extracted', type: 'mandatory', deadline: 'N/A', confidence: 0.3 }];
    }
  }

  data.keyDirections = data.keyDirections.map((d, i) => ({
    text: d.text || d.direction || `Direction ${i + 1}`,
    type: normalizeType(d.type),
    deadline: d.deadline || d.time_limit || 'N/A',
    confidence: normalizeConfidence(d.confidence)
  }));

  // ── actionPlan ──
  if (!data.actionPlan || typeof data.actionPlan !== 'object') {
    // Try alternate field names
    if (data.action_plan) data.actionPlan = data.action_plan;
    else {
      errors.push('Missing actionPlan section');
      data.actionPlan = {};
    }
  }

  // Map snake_case fields the LLM might return
  const ap = data.actionPlan;
  ap.decision = ap.decision || 'Seek Clarification';
  ap.actionRequired = ap.actionRequired || ap.action_required || 'Not determined';
  ap.responsibleDepartment = ap.responsibleDepartment || ap.department_responsible || ap.department || 'Not determined';
  ap.deadline = ap.deadline || 'Not determined';
  ap.priority = normalizePriority(ap.priority);
  ap.financialImplication = ap.financialImplication || ap.financial_implication || 'N/A';
  ap.riskIfNotComplied = ap.riskIfNotComplied || ap.risk_if_not_complied || ap.risk || 'Not assessed';
  ap.confidence = normalizeConfidence(ap.confidence);

  for (const field of REQUIRED_ACTION_FIELDS) {
    if (!ap[field] || ap[field] === 'Not determined') {
      errors.push(`Missing actionPlan.${field}`);
    }
  }

  return { valid: errors.length === 0, errors, data };
}

function normalizeConfidence(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

function normalizeType(t) {
  if (!t) return 'mandatory';
  const lower = String(t).toLowerCase();
  if (lower.includes('recommend') || lower.includes('advisory')) return 'recommended';
  if (lower.includes('condition')) return 'conditional';
  return 'mandatory';
}

function normalizePriority(p) {
  if (!p) return 'Medium';
  const lower = String(p).toLowerCase();
  if (lower.includes('high') || lower.includes('urgent') || lower.includes('critical')) return 'High';
  if (lower.includes('low') || lower.includes('minor')) return 'Low';
  return 'Medium';
}

export function parseAIResponse(rawText) {
  let jsonStr = rawText.trim();

  // Remove markdown code fences
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Find JSON boundaries
  const startIdx = jsonStr.indexOf('{');
  const endIdx = jsonStr.lastIndexOf('}');

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('No JSON object found in response');
  }

  jsonStr = jsonStr.substring(startIdx, endIdx + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Try fixing common JSON issues
    const fixed = jsonStr
      .replace(/,\s*}/g, '}')       // trailing commas
      .replace(/,\s*]/g, ']')       // trailing commas in arrays
      .replace(/'/g, '"')           // single quotes
      .replace(/\n/g, '\\n');       // unescaped newlines

    try {
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`Failed to parse JSON: ${e.message}`);
    }
  }
}
