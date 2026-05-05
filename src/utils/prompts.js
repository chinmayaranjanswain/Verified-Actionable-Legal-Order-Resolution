export function cleanOCRText(text) {
  if (!text) return '';

  let cleaned = text;
  cleaned = cleaned.replace(/---\s*Page\s*\d+\s*(?:\(OCR\))?\s*---\n?/gi, '\n');
  cleaned = cleaned.replace(/ﬁ/g, 'fi');
  cleaned = cleaned.replace(/ﬂ/g, 'fl');
  cleaned = cleaned.replace(/ﬀ/g, 'ff');
  cleaned = cleaned.replace(/ﬃ/g, 'ffi');
  cleaned = cleaned.replace(/ﬄ/g, 'ffl');
  cleaned = cleaned.replace(/(?<=[A-Za-z])0(?=[A-Za-z])/g, 'O');
  cleaned = cleaned.replace(/\bl\b(?=\s+(?:am|was|have|had|will|shall|would|could|should|may|can|do|did))/gi, 'I');
  cleaned = cleaned.replace(/(\w)-\s*\n\s*(\w)/g, '$1$2');
  cleaned = cleaned.replace(/[ \t]+/g, ' ');             // Multiple spaces → single
  cleaned = cleaned.replace(/(\n\s*){3,}/g, '\n\n');      // 3+ newlines → 2
  cleaned = cleaned.replace(/^\s+$/gm, '');               // Blank lines with spaces
  cleaned = cleaned.replace(/(?<=[A-Za-z])\|(?=[A-Za-z])/g, 'I');
  cleaned = cleaned.replace(/\u00A0/g, ' ');               // Non-breaking space → space
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Zero-width chars
  const lines = cleaned.split('\n');
  const lineCounts = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length >= 15 && trimmed.length < 80) {
      lineCounts[trimmed] = (lineCounts[trimmed] || 0) + 1;
    }
  }
  const repeatedLines = new Set(
    Object.entries(lineCounts)
      .filter(([, count]) => count >= 5)
      .map(([line]) => line)
  );
  if (repeatedLines.size > 0) {
    const filtered = lines.filter(l => !repeatedLines.has(l.trim()));
    const removedCount = lines.length - filtered.length;
    if (removedCount <= lines.length * 0.2) {
      cleaned = filtered.join('\n');
    } else {
      console.warn(`[VALOR] Skipped header stripping — would remove ${removedCount}/${lines.length} lines (>20%)`);
    }
  }
  cleaned = cleaned.replace(/(\d{1,2})\s*[.]\s*(\d{1,2})\s*[.]\s*(\d{4})/g, '$1.$2.$3');

  return cleaned.trim();
}
export function extractOrderSection(text) {
  if (!text) return '';

  const textUpper = text.toUpperCase();
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
    if (idx !== -1 && idx > text.length * 0.25) {
      orderText = text.substring(idx);
      markerUsed = marker;
      break;
    }
  }
  const headerSize = Math.min(4000, text.length);
  const headerContext = text.substring(0, headerSize);

  if (orderText && orderText.length > 80) {
    const combined = headerContext + '\n\n--- ORDER / RULING SECTION ---\n\n' + orderText;
    return combined.substring(0, 12000);
  }
  if (text.length > 8000) {
    const tail = text.substring(text.length - 5000);
    return headerContext + '\n\n--- DOCUMENT END ---\n\n' + tail;
  }

  return text.substring(0, 12000);
}
export function preprocessForLLM(rawText) {
  const cleaned = cleanOCRText(rawText);
  const focused = extractOrderSection(cleaned);

  return focused;
}
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
