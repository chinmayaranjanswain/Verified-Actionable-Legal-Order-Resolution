import { cleanOCRText, extractOrderSection, preprocessForLLM } from '../utils/prompts.js';
import { extractWithRules } from './ruleEngine.js';
import { mapColabResponse, mapRuleResponse, validateExtraction } from './validator.js';
import { getColabUrl } from './storage.js';
export async function checkColabHealth(url) {
  try {
    const resp = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function analyzeWithAI(text, onProgress) {
  if (onProgress) onProgress(5);

  const cleaned = cleanOCRText(text);
  if (onProgress) onProgress(15);

  const orderSection = extractOrderSection(cleaned);
  if (onProgress) onProgress(25);

  const ruleResult = extractWithRules(cleaned, orderSection);
  if (onProgress) onProgress(50);

  let mappedData = mapRuleResponse(ruleResult);

  const colabUrl = getColabUrl();
  let llmUsed = false;
  let llmConfidence = 0;

  if (colabUrl) {
    if (onProgress) onProgress(60);

    try {
      const llmResult = await callColabLLM(colabUrl, orderSection);

      if (llmResult && llmResult.result) {
        llmUsed = true;
        llmConfidence = llmResult.confidence;

        mappedData = mergeResults(mappedData, llmResult.result, llmResult.confidence);
        if (onProgress) onProgress(85);
      }
    } catch (e) {
      console.warn('[VALOR] LLM refinement failed (non-critical):', e.message);
    }
  }

  if (onProgress) onProgress(90);

  const validated = validateExtraction(mappedData);
  if (onProgress) onProgress(100);

  return {
    ...validated,
    sourceText: text,
    rawResponse: JSON.stringify(ruleResult, null, 2),
    preprocessedLength: orderSection.length,
    ruleConfidence: ruleResult._confidence,
    llmUsed,
    llmConfidence,
    method: llmUsed ? 'hybrid (rules + LLM)' : 'rule-based only'
  };
}
async function callColabLLM(colabUrl, text) {
  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {

      const response = await fetch(`${colabUrl}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({ text: text.substring(0, 12000) }),
        signal: AbortSignal.timeout(90000) // 90s timeout
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.error && !result.result) throw new Error(result.error);

      return result;

    } catch (error) {
      lastError = error;
      console.warn(`[VALOR] LLM attempt ${attempt + 1} failed:`, error.message);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  throw lastError || new Error('LLM call failed');
}
function mergeResults(ruleData, llmData, llmConfidence) {
  if (!llmData || typeof llmData !== 'object') return ruleData;

  const merged = JSON.parse(JSON.stringify(ruleData));
  const llmMapped = mapColabResponse(llmData, llmConfidence);
  if (!llmMapped) return merged;
  const cd = merged.caseDetails;
  const lcd = llmMapped.caseDetails;
  if (isEmpty(cd.caseNumber) && !isEmpty(lcd.caseNumber)) cd.caseNumber = lcd.caseNumber;
  if (isEmpty(cd.courtName) && !isEmpty(lcd.courtName)) cd.courtName = lcd.courtName;
  if (isEmpty(cd.dateOfOrder) && !isEmpty(lcd.dateOfOrder)) cd.dateOfOrder = lcd.dateOfOrder;
  if (isEmpty(cd.partiesInvolved) && !isEmpty(lcd.partiesInvolved)) cd.partiesInvolved = lcd.partiesInvolved;
  if (isEmpty(cd.judgeName) && !isEmpty(lcd.judgeName)) cd.judgeName = lcd.judgeName;
  if (llmMapped.keyDirections && llmMapped.keyDirections.length > 0) {
    const existingTexts = new Set(merged.keyDirections.map(d => d.text.substring(0, 50).toLowerCase()));
    for (const llmDir of llmMapped.keyDirections) {
      const prefix = llmDir.text.substring(0, 50).toLowerCase();
      if (!existingTexts.has(prefix)) {
        llmDir.confidence = Math.min(llmDir.confidence || 0.7, 0.85); // Cap LLM-only confidence
        merged.keyDirections.push(llmDir);
      }
    }
  }
  const ap = merged.actionPlan;
  const lap = llmMapped.actionPlan;
  if (isEmpty(ap.decision) || ap.decision === 'Seek Clarification') ap.decision = lap.decision;
  if (isEmpty(ap.actionRequired)) ap.actionRequired = lap.actionRequired;
  if (isEmpty(ap.responsibleDepartment)) ap.responsibleDepartment = lap.responsibleDepartment;
  if (isEmpty(ap.deadline)) ap.deadline = lap.deadline;
  if (isEmpty(ap.financialImplication) || ap.financialImplication === 'N/A') {
    if (!isEmpty(lap.financialImplication) && lap.financialImplication !== 'N/A') ap.financialImplication = lap.financialImplication;
  }
  if (isEmpty(ap.riskIfNotComplied) || ap.riskIfNotComplied === 'Not assessed') {
    if (!isEmpty(lap.riskIfNotComplied) && lap.riskIfNotComplied !== 'Not assessed') ap.riskIfNotComplied = lap.riskIfNotComplied;
  }
  const boost = llmConfidence > 0.5 ? 0.05 : 0;
  cd.confidence = Math.min(1, (cd.confidence || 0) + boost);
  ap.confidence = Math.min(1, (ap.confidence || 0) + boost);

  return merged;
}

function isEmpty(val) {
  return !val || val === 'Not Found' || val === 'N/A' || val === 'Not determined' || val === 'Not assessed';
}
