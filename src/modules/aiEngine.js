// V.A.L.O.R. — Gemini AI Engine

import { EXTRACTION_PROMPT, FALLBACK_RESPONSE } from '../utils/prompts.js';
import { parseAIResponse, validateExtraction } from './validator.js';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function analyzeWithAI(text, onProgress) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.warn('No Gemini API key found. Using demo mode with simulated response.');
    return simulateAIResponse(text, onProgress);
  }

  if (onProgress) onProgress(10);

  // Truncate text if too long (Gemini has context limits)
  const maxChars = 30000;
  const truncatedText = text.length > maxChars
    ? text.substring(0, maxChars) + '\n\n[Text truncated due to length...]'
    : text;

  const prompt = EXTRACTION_PROMPT + truncatedText;

  if (onProgress) onProgress(20);

  try {
    const response = await fetch(`${API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      })
    });

    if (onProgress) onProgress(70);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error('Empty response from Gemini');
    }

    if (onProgress) onProgress(85);

    const parsed = parseAIResponse(rawText);
    const validated = validateExtraction(parsed);

    if (onProgress) onProgress(100);

    return {
      ...validated,
      sourceText: text,
      rawResponse: rawText
    };

  } catch (error) {
    console.error('AI analysis failed:', error);

    // Return fallback with error info
    if (onProgress) onProgress(100);

    return {
      valid: false,
      errors: [error.message],
      data: FALLBACK_RESPONSE,
      sourceText: text,
      rawResponse: null
    };
  }
}

// Demo mode when no API key
async function simulateAIResponse(text, onProgress) {
  // Simulate processing delay
  for (let i = 0; i <= 100; i += 10) {
    await new Promise(r => setTimeout(r, 200));
    if (onProgress) onProgress(i);
  }

  // Extract some basic info from text using regex
  const caseNumberMatch = text.match(/(?:W\.?P\.?\s*\(?C\)?\s*(?:No\.?)?\s*\d+\/\d{4})|(?:Case\s*No\.?\s*[\w\/\-]+)/i);
  const dateMatch = text.match(/\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4}/);
  const courtMatch = text.match(/(?:High\s+Court|Supreme\s+Court|District\s+Court|Tribunal)[\w\s,]*/i);

  const demoData = {
    caseDetails: {
      caseNumber: caseNumberMatch ? caseNumberMatch[0] : 'WP(C) No. 2847/2024',
      courtName: courtMatch ? courtMatch[0].trim() : 'High Court of Delhi',
      dateOfOrder: dateMatch ? dateMatch[0] : '15-03-2024',
      partiesInvolved: 'State Government vs. Petitioner',
      judgeName: 'Hon\'ble Justice Demo',
      confidence: 0.72
    },
    keyDirections: [
      {
        text: 'The respondent department shall release all pending salary arrears within 30 days from the date of this order.',
        type: 'mandatory',
        deadline: '30 days',
        confidence: 0.88
      },
      {
        text: 'A compliance report shall be submitted to the Registry within 45 days.',
        type: 'mandatory',
        deadline: '45 days',
        confidence: 0.82
      },
      {
        text: 'The department may consider revising the existing policy framework to prevent future occurrences.',
        type: 'recommended',
        deadline: 'N/A',
        confidence: 0.65
      }
    ],
    actionPlan: {
      decision: 'Comply',
      actionRequired: 'Release pending salary arrears and submit compliance report to court registry',
      responsibleDepartment: 'Education Department',
      deadline: '30 days from order date',
      priority: 'High',
      financialImplication: 'Salary arrears amount as per service records',
      confidence: 0.80
    }
  };

  const validated = validateExtraction(demoData);

  return {
    ...validated,
    sourceText: text,
    rawResponse: JSON.stringify(demoData, null, 2),
    isDemo: true
  };
}
