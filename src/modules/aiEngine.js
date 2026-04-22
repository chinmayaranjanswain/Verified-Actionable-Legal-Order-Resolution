// V.A.L.O.R. — Gemini AI Engine (Optimized)

import { EXTRACTION_PROMPT, FALLBACK_RESPONSE, preprocessJudgmentText } from '../utils/prompts.js';
import { parseAIResponse, validateExtraction } from './validator.js';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function analyzeWithAI(text, onProgress) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.warn('No Gemini API key. Demo mode.');
    return simulateAIResponse(text, onProgress);
  }

  if (onProgress) onProgress(5);

  // ── Step 1: Preprocess — isolate ORDER section ──
  const processedText = preprocessJudgmentText(text);
  console.log(`[VALOR] Original: ${text.length} chars → Processed: ${processedText.length} chars`);

  if (onProgress) onProgress(15);

  const prompt = EXTRACTION_PROMPT + processedText;

  // ── Step 2: Call Gemini with optimized params ──
  const MAX_RETRIES = 2;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (onProgress) onProgress(20 + attempt * 10);

      const response = await fetch(`${API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,        // Low = more accurate, less creative
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 800,    // Enough for structured JSON, prevents rambling
            responseMimeType: 'application/json'  // Force JSON output
          }
        })
      });

      if (onProgress) onProgress(65 + attempt * 5);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API ${response.status}`);
      }

      const result = await response.json();
      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) throw new Error('Empty response from Gemini');

      if (onProgress) onProgress(85);

      // ── Step 3: Parse + Validate ──
      const parsed = parseAIResponse(rawText);
      const validated = validateExtraction(parsed);

      if (onProgress) onProgress(100);

      return {
        ...validated,
        sourceText: text,
        rawResponse: rawText,
        preprocessedLength: processedText.length,
        attempt: attempt + 1
      };

    } catch (error) {
      lastError = error;
      console.warn(`[VALOR] Attempt ${attempt + 1} failed:`, error.message);

      if (attempt < MAX_RETRIES) {
        // Wait before retry (exponential backoff)
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  // All retries exhausted
  console.error('[VALOR] All attempts failed:', lastError);
  if (onProgress) onProgress(100);

  return {
    valid: false,
    errors: [lastError.message],
    data: FALLBACK_RESPONSE,
    sourceText: text,
    rawResponse: null
  };
}

// ── Demo mode ──────────────
async function simulateAIResponse(text, onProgress) {
  for (let i = 0; i <= 100; i += 10) {
    await new Promise(r => setTimeout(r, 200));
    if (onProgress) onProgress(i);
  }

  // Regex extraction from raw text for demo
  const caseMatch = text.match(/(?:W\.?P\.?\s*\(?C\)?\s*(?:No\.?)?\s*\d+\/\d{4})|(?:Case\s*No\.?\s*[\w\/\-]+)/i);
  const dateMatch = text.match(/\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4}/);
  const courtMatch = text.match(/(?:High\s+Court|Supreme\s+Court|District\s+Court|Tribunal)[\w\s,]*/i);

  const demoData = {
    caseDetails: {
      caseNumber: caseMatch ? caseMatch[0] : 'WP(C) No. 2847/2024',
      courtName: courtMatch ? courtMatch[0].trim() : 'High Court of Delhi',
      dateOfOrder: dateMatch ? dateMatch[0] : '15-03-2024',
      partiesInvolved: 'State Government vs. Petitioner',
      judgeName: 'Hon\'ble Justice Demo',
      confidence: 0.72
    },
    keyDirections: [
      { text: 'The respondent department shall release all pending salary arrears within 30 days from the date of this order.', type: 'mandatory', deadline: '30 days', confidence: 0.88 },
      { text: 'A compliance report shall be submitted to the Registry within 45 days.', type: 'mandatory', deadline: '45 days', confidence: 0.82 },
      { text: 'The department may consider revising the existing policy framework to prevent future occurrences.', type: 'recommended', deadline: 'N/A', confidence: 0.65 }
    ],
    actionPlan: {
      decision: 'Comply',
      actionRequired: 'Release pending salary arrears and submit compliance report to court registry',
      responsibleDepartment: 'Education Department',
      deadline: '30 days from order date',
      priority: 'High',
      financialImplication: 'Salary arrears amount as per service records',
      riskIfNotComplied: 'Contempt proceedings may be initiated',
      confidence: 0.80
    }
  };

  const validated = validateExtraction(demoData);
  return { ...validated, sourceText: text, rawResponse: JSON.stringify(demoData, null, 2), isDemo: true };
}
