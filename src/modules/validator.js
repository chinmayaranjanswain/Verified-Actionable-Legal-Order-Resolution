// V.A.L.O.R. — JSON Schema Validator

const REQUIRED_CASE_FIELDS = ['caseNumber', 'courtName', 'dateOfOrder', 'partiesInvolved'];
const REQUIRED_ACTION_FIELDS = ['decision', 'actionRequired', 'responsibleDepartment', 'deadline'];

export function validateExtraction(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Response is not a valid object'], data: null };
  }

  // Validate caseDetails
  if (!data.caseDetails || typeof data.caseDetails !== 'object') {
    errors.push('Missing caseDetails section');
    data.caseDetails = {};
  }
  for (const field of REQUIRED_CASE_FIELDS) {
    if (!data.caseDetails[field]) {
      data.caseDetails[field] = 'Not found';
      errors.push(`Missing caseDetails.${field}`);
    }
  }
  data.caseDetails.confidence = normalizeConfidence(data.caseDetails?.confidence);

  // Validate keyDirections
  if (!Array.isArray(data.keyDirections) || data.keyDirections.length === 0) {
    errors.push('Missing or empty keyDirections');
    data.keyDirections = [{ text: 'No directions extracted', type: 'mandatory', deadline: 'N/A', confidence: 0.3 }];
  } else {
    data.keyDirections = data.keyDirections.map((d, i) => ({
      text: d.text || `Direction ${i + 1}`,
      type: d.type || 'mandatory',
      deadline: d.deadline || 'N/A',
      confidence: normalizeConfidence(d.confidence)
    }));
  }

  // Validate actionPlan
  if (!data.actionPlan || typeof data.actionPlan !== 'object') {
    errors.push('Missing actionPlan section');
    data.actionPlan = {};
  }
  for (const field of REQUIRED_ACTION_FIELDS) {
    if (!data.actionPlan[field]) {
      data.actionPlan[field] = 'Not determined';
      errors.push(`Missing actionPlan.${field}`);
    }
  }
  data.actionPlan.priority = data.actionPlan.priority || 'Medium';
  data.actionPlan.financialImplication = data.actionPlan.financialImplication || 'N/A';
  data.actionPlan.confidence = normalizeConfidence(data.actionPlan?.confidence);

  return {
    valid: errors.length === 0,
    errors,
    data
  };
}

function normalizeConfidence(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

export function parseAIResponse(rawText) {
  // Try to extract JSON from response
  let jsonStr = rawText.trim();

  // Remove markdown code fences if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Find JSON object boundaries
  const startIdx = jsonStr.indexOf('{');
  const endIdx = jsonStr.lastIndexOf('}');

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('No JSON object found in response');
  }

  jsonStr = jsonStr.substring(startIdx, endIdx + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${e.message}`);
  }
}
