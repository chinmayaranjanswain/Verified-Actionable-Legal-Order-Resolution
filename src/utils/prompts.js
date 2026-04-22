// V.A.L.O.R. — Optimized LLM Prompts for Legal Document Analysis

// ── Text Preprocessor: Extract ORDER section for higher accuracy ──
export function preprocessJudgmentText(text) {
  // 1. Try to isolate the ORDER / final ruling section
  const orderMarkers = [
    'ORDER', 'O R D E R', 'ORDER:', 'ORDER :-',
    'JUDGMENT AND ORDER', 'FINAL ORDER',
    'OPERATIVE ORDER', 'DIRECTIONS',
    'IT IS ORDERED', 'WE DIRECT', 'THE COURT ORDERS'
  ];

  let orderText = null;
  for (const marker of orderMarkers) {
    const idx = text.toUpperCase().lastIndexOf(marker);
    if (idx !== -1 && idx > text.length * 0.3) {
      // Found ORDER section in the latter part of the document
      orderText = text.substring(idx);
      break;
    }
  }

  // 2. If ORDER section found, use it + last chunk for context
  if (orderText && orderText.length > 200) {
    // Also grab some context from before the ORDER (case details usually at top)
    const headerContext = text.substring(0, Math.min(2000, text.length));
    const combined = headerContext + '\n\n--- ORDER SECTION ---\n\n' + orderText;
    return combined.substring(0, 8000);
  }

  // 3. Fallback: Use first 2000 chars (metadata) + last 3000 chars (ORDER usually at end)
  if (text.length > 5000) {
    const header = text.substring(0, 2000);
    const tail = text.substring(text.length - 3000);
    return header + '\n\n--- END OF JUDGMENT ---\n\n' + tail;
  }

  return text;
}

// ── Main Extraction Prompt (with few-shot example) ──
export const EXTRACTION_PROMPT = `You are V.A.L.O.R., an expert legal AI assistant helping Indian government officers understand court judgments.

Your task: Extract structured information and generate an actionable compliance plan.

IMPORTANT INSTRUCTIONS:
- Focus ONLY on actionable content, especially the ORDER or final ruling section
- Ignore arguments, background, and legal reasoning unless needed for context
- Be precise and confident in your extraction
- If information is genuinely missing, write "Not Found" — do NOT guess
- Always return VALID JSON only. No explanation, no markdown.

--- FEW-SHOT EXAMPLE ---

Input:
"WP(C) No. 5678/2023 — High Court of Orissa, decided on 12-01-2024.
Ramesh Kumar vs State of Odisha. Before Hon'ble Justice A.K. Mishra.
ORDER: The respondent Education Department is directed to release all pending salary arrears of the petitioner within 30 days from the date of this order. A compliance report shall be filed before this Court within 45 days. The department may also consider revising its policy. Failure to comply may result in contempt proceedings."

Output:
{
  "caseDetails": {
    "caseNumber": "WP(C) No. 5678/2023",
    "courtName": "High Court of Orissa",
    "dateOfOrder": "12-01-2024",
    "partiesInvolved": "Ramesh Kumar vs State of Odisha",
    "judgeName": "Hon'ble Justice A.K. Mishra",
    "confidence": 0.95
  },
  "keyDirections": [
    {
      "text": "Release all pending salary arrears of the petitioner within 30 days",
      "type": "mandatory",
      "deadline": "30 days",
      "confidence": 0.95
    },
    {
      "text": "File compliance report before this Court within 45 days",
      "type": "mandatory",
      "deadline": "45 days",
      "confidence": 0.92
    },
    {
      "text": "Consider revising the existing policy framework",
      "type": "recommended",
      "deadline": "N/A",
      "confidence": 0.70
    }
  ],
  "actionPlan": {
    "decision": "Comply",
    "actionRequired": "Release pending salary arrears and submit compliance report to court registry",
    "responsibleDepartment": "Education Department",
    "deadline": "30 days from order date",
    "priority": "High",
    "financialImplication": "Salary arrears as per service records",
    "riskIfNotComplied": "Contempt proceedings",
    "confidence": 0.93
  }
}

--- END EXAMPLE ---

Now extract from the following judgment. Return ONLY valid JSON matching the exact schema above.

JUDGMENT TEXT:
`;

export const FALLBACK_RESPONSE = {
  caseDetails: {
    caseNumber: 'Not Found',
    courtName: 'Not Found',
    dateOfOrder: 'Not Found',
    partiesInvolved: 'Not Found',
    judgeName: 'Not Found',
    confidence: 0.3
  },
  keyDirections: [
    {
      text: 'Could not extract directions — review source text manually',
      type: 'mandatory',
      deadline: 'N/A',
      confidence: 0.2
    }
  ],
  actionPlan: {
    decision: 'Seek Clarification',
    actionRequired: 'Manual review required — AI could not confidently extract action items',
    responsibleDepartment: 'To be determined',
    deadline: 'Immediate review recommended',
    priority: 'High',
    financialImplication: 'N/A',
    riskIfNotComplied: 'Unknown — manual assessment needed',
    confidence: 0.2
  }
};
