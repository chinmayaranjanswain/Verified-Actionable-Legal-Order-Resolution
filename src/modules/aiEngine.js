// V.A.L.O.R. — Hybrid AI Engine
// Pipeline: Rule-Based (primary) → LLM Refinement (optional)
// System MUST work even if LLM/Colab is completely down

import { cleanOCRText, extractOrderSection, preprocessForLLM } from '../utils/prompts.js';
import { extractWithRules } from './ruleEngine.js';
import { mapColabResponse, mapRuleResponse, validateExtraction } from './validator.js';
import { getColabUrl } from './storage.js';

// ── Health Check ─────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════
// MAIN HYBRID ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════════
export async function analyzeWithAI(text, onProgress) {
  if (onProgress) onProgress(5);

  // ━━━ STEP 1: Clean text ━━━
  const cleaned = cleanOCRText(text);
  console.log(`[VALOR] Cleaned: ${text.length} → ${cleaned.length} chars`);
  if (onProgress) onProgress(15);

  // ━━━ STEP 2: Extract ORDER section ━━━
  const orderSection = extractOrderSection(cleaned);
  console.log(`[VALOR] Order section: ${orderSection.length} chars`);
  if (onProgress) onProgress(25);

  // ━━━ STEP 3: RULE-BASED EXTRACTION (PRIMARY) ━━━
  console.log('[VALOR] Running rule-based extraction (primary engine)...');
  const ruleResult = extractWithRules(cleaned, orderSection);
  console.log(`[VALOR] Rule engine: ${ruleResult._confidence * 100}% confidence, method: ${ruleResult._method}`);
  if (onProgress) onProgress(50);

  // Map rule result to V.A.L.O.R. internal schema
  let mappedData = mapRuleResponse(ruleResult);

  // ━━━ STEP 4: LLM REFINEMENT (OPTIONAL) ━━━
  const colabUrl = getColabUrl();
  let llmUsed = false;
  let llmConfidence = 0;

  if (colabUrl) {
    console.log('[VALOR] Colab URL configured — attempting LLM refinement...');
    if (onProgress) onProgress(60);

    try {
      const llmResult = await callColabLLM(colabUrl, orderSection);

      if (llmResult && llmResult.result) {
        console.log(`[VALOR] LLM refinement success: ${llmResult.confidence * 100}% confidence`);
        llmUsed = true;
        llmConfidence = llmResult.confidence;

        // MERGE: LLM refines the rule-based output (doesn't replace it)
        mappedData = mergeResults(mappedData, llmResult.result, llmResult.confidence);
        if (onProgress) onProgress(85);
      }
    } catch (e) {
      console.warn('[VALOR] LLM refinement failed (non-critical):', e.message);
      // System continues with rule-based results — this is fine
    }
  } else {
    console.log('[VALOR] No Colab URL — using rule-based results only (this is fine)');
  }

  if (onProgress) onProgress(90);

  // ━━━ STEP 5: VALIDATE ━━━
  const validated = validateExtraction(mappedData);
  console.log(`[VALOR] Final: valid=${validated.valid}, errors=${validated.errors.length}, method=${llmUsed ? 'hybrid' : 'rule-based'}`);
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

// ═══════════════════════════════════════════════════════════════════
// COLAB LLM CALL (optional refinement only)
// ═══════════════════════════════════════════════════════════════════
async function callColabLLM(colabUrl, text) {
  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`[VALOR] LLM attempt ${attempt + 1}/${MAX_RETRIES}...`);

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

// ═══════════════════════════════════════════════════════════════════
// MERGE: Rule-based + LLM results
// Rule-based is the foundation. LLM can only FILL GAPS or IMPROVE.
// LLM cannot OVERWRITE a non-empty rule-based field with "Not Found".
// ═══════════════════════════════════════════════════════════════════
function mergeResults(ruleData, llmData, llmConfidence) {
  if (!llmData || typeof llmData !== 'object') return ruleData;

  const merged = JSON.parse(JSON.stringify(ruleData));
  const llmMapped = mapColabResponse(llmData, llmConfidence);
  if (!llmMapped) return merged;

  // Case Details: LLM fills gaps only
  const cd = merged.caseDetails;
  const lcd = llmMapped.caseDetails;
  if (isEmpty(cd.caseNumber) && !isEmpty(lcd.caseNumber)) cd.caseNumber = lcd.caseNumber;
  if (isEmpty(cd.courtName) && !isEmpty(lcd.courtName)) cd.courtName = lcd.courtName;
  if (isEmpty(cd.dateOfOrder) && !isEmpty(lcd.dateOfOrder)) cd.dateOfOrder = lcd.dateOfOrder;
  if (isEmpty(cd.partiesInvolved) && !isEmpty(lcd.partiesInvolved)) cd.partiesInvolved = lcd.partiesInvolved;
  if (isEmpty(cd.judgeName) && !isEmpty(lcd.judgeName)) cd.judgeName = lcd.judgeName;

  // Key Directions: LLM can ADD more directions, not replace existing ones
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

  // Action Plan: LLM fills gaps only
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

  // Boost confidence slightly if LLM confirmed rule-based findings
  const boost = llmConfidence > 0.5 ? 0.05 : 0;
  cd.confidence = Math.min(1, (cd.confidence || 0) + boost);
  ap.confidence = Math.min(1, (ap.confidence || 0) + boost);

  return merged;
}

function isEmpty(val) {
  return !val || val === 'Not Found' || val === 'N/A' || val === 'Not determined' || val === 'Not assessed';
}
