// V.A.L.O.R. — Text Processing: OCR Cleaning + ORDER Extraction
// No LLM prompt here — prompt lives on Colab backend

// ── Context-Aware OCR Text Cleaning ──────────────────────────────
export function cleanOCRText(text) {
  if (!text) return '';

  let cleaned = text;

  // 1. Remove PDF page markers
  cleaned = cleaned.replace(/---\s*Page\s*\d+\s*(?:\(OCR\))?\s*---\n?/gi, '\n');

  // 2. Fix common ligature issues from OCR
  cleaned = cleaned.replace(/ﬁ/g, 'fi');
  cleaned = cleaned.replace(/ﬂ/g, 'fl');
  cleaned = cleaned.replace(/ﬀ/g, 'ff');
  cleaned = cleaned.replace(/ﬃ/g, 'ffi');
  cleaned = cleaned.replace(/ﬄ/g, 'ffl');

  // 3. Fix common OCR misreads — CONTEXT-AWARE (only in word context, not numbers)
  // Only replace 0→O when surrounded by letters (not digits)
  cleaned = cleaned.replace(/(?<=[A-Za-z])0(?=[A-Za-z])/g, 'O');
  // Only replace l→I when it appears as standalone "l" meaning "I" (pronoun)
  cleaned = cleaned.replace(/\bl\b(?=\s+(?:am|was|have|had|will|shall|would|could|should|may|can|do|did))/gi, 'I');

  // 4. Fix broken words from line wrapping
  cleaned = cleaned.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');

  // 5. Normalize whitespace
  cleaned = cleaned.replace(/[ \t]+/g, ' ');             // Multiple spaces → single
  cleaned = cleaned.replace(/(\n\s*){3,}/g, '\n\n');      // 3+ newlines → 2
  cleaned = cleaned.replace(/^\s+$/gm, '');               // Blank lines with spaces

  // 6. Fix common OCR artifacts
  cleaned = cleaned.replace(/[|]/g, 'I');                  // Pipe → I (common OCR error in text)
  cleaned = cleaned.replace(/\u00A0/g, ' ');               // Non-breaking space → space
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Zero-width chars

  // 7. Strip repeated page headers/footers (common in judgments)
  // Remove lines that repeat frequently (likely headers)
  const lines = cleaned.split('\n');
  const lineCounts = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 80) {
      lineCounts[trimmed] = (lineCounts[trimmed] || 0) + 1;
    }
  }
  // Remove lines that appear 3+ times (likely headers/footers)
  const repeatedLines = new Set(
    Object.entries(lineCounts)
      .filter(([, count]) => count >= 3)
      .map(([line]) => line)
  );
  if (repeatedLines.size > 0) {
    cleaned = lines.filter(l => !repeatedLines.has(l.trim())).join('\n');
  }

  // 8. Normalize common date separators
  // Don't change the dates, just normalize odd OCR artifacts in date areas
  cleaned = cleaned.replace(/(\d{1,2})\s*[.]\s*(\d{1,2})\s*[.]\s*(\d{4})/g, '$1.$2.$3');

  return cleaned.trim();
}

// ── ORDER Section Extractor ──────────────────────────────────────
export function extractOrderSection(text) {
  if (!text) return '';

  const textUpper = text.toUpperCase();

  // Prioritized markers — most specific first
  const markers = [
    'O R D E R', 'ORDER :-', 'ORDER:',
    'OPERATIVE ORDER', 'FINAL ORDER',
    'JUDGMENT AND ORDER', 'IT IS HEREBY ORDERED',
    'IT IS ORDERED', 'WE DIRECT', 'THE COURT ORDERS',
    'OPERATIVE PART', 'DIRECTIONS:',
    'ORDER', 'JUDGMENT:', 'J U D G M E N T',
    'DISPOSED OF', 'WRIT PETITION IS ALLOWED',
    'PETITION IS ALLOWED', 'APPEAL IS ALLOWED',
    'APPEAL IS DISMISSED', 'ACCORDINGLY'
  ];

  let orderText = null;
  let markerUsed = null;

  for (const marker of markers) {
    const idx = textUpper.lastIndexOf(marker);
    // Only use if found in the latter 60% of document
    if (idx !== -1 && idx > text.length * 0.25) {
      orderText = text.substring(idx);
      markerUsed = marker;
      break;
    }
  }

  // Build output: header context + order section
  // Always include the first part for case metadata
  const headerSize = Math.min(4000, text.length);
  const headerContext = text.substring(0, headerSize);

  if (orderText && orderText.length > 80) {
    console.log(`[VALOR] ORDER section found via marker: "${markerUsed}" (${orderText.length} chars)`);
    const combined = headerContext + '\n\n--- ORDER / RULING SECTION ---\n\n' + orderText;
    // Limit to ~12000 chars to stay within Phi-3's 4K token window
    return combined.substring(0, 12000);
  }

  // Fallback: header + last part of document (ORDER is usually at the end)
  console.log('[VALOR] No ORDER marker found — using header + tail fallback');
  if (text.length > 8000) {
    const tail = text.substring(text.length - 5000);
    return headerContext + '\n\n--- DOCUMENT END ---\n\n' + tail;
  }

  return text.substring(0, 12000);
}

// ── Full Preprocessing Pipeline ──────────────────────────────────
export function preprocessForLLM(rawText) {
  const cleaned = cleanOCRText(rawText);
  const focused = extractOrderSection(cleaned);

  console.log(`[VALOR] Preprocessing: ${rawText.length} → ${cleaned.length} (cleaned) → ${focused.length} (focused)`);

  return focused;
}

// ── Fallback Response (when Colab is unreachable) ────────────────
export const FALLBACK_RESPONSE = {
  caseDetails: {
    caseNumber: 'Not Found',
    courtName: 'Not Found',
    dateOfOrder: 'Not Found',
    partiesInvolved: 'Not Found',
    judgeName: 'Not Found',
    confidence: 0.0
  },
  keyDirections: [
    {
      text: 'Could not connect to Colab LLM — check Settings and ensure Colab notebook is running',
      type: 'mandatory',
      deadline: 'N/A',
      confidence: 0.0
    }
  ],
  actionPlan: {
    decision: 'Seek Clarification',
    actionRequired: 'Connect to Colab LLM engine — paste ngrok URL in Settings',
    responsibleDepartment: 'To be determined',
    deadline: 'Immediate',
    priority: 'High',
    financialImplication: 'N/A',
    riskIfNotComplied: 'Unknown — LLM analysis required',
    confidence: 0.0
  }
};
