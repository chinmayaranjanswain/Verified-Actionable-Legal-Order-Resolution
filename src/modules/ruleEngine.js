export function extractWithRules(fullText, orderText) {
  const t = fullText || '';
  const o = orderText || t;

  const result = {
    case_no: extractCaseNumber(t),
    court: extractCourt(t),
    date_of_order: extractDate(t),
    judge: extractJudge(t),
    parties: extractParties(t),
    key_directions: extractDirections(o),
    decision: extractDecision(o),
    action_required: '',
    department_responsible: extractDepartment(o, t),
    deadlines: extractDeadlines(o),
    financial_implication: extractFinancial(o),
    risk_if_not_complied: extractRisk(o)
  };
  if (result.key_directions.length > 0) {
    result.action_required = result.key_directions[0];
  }
  const fields = Object.keys(result);
  let filled = 0;
  for (const f of fields) {
    const v = result[f];
    if (Array.isArray(v)) { if (v.length > 0) filled++; }
    else if (v && v !== 'Not Found' && v !== 'N/A') filled++;
  }
  result._confidence = Math.round((filled / fields.length) * 100) / 100;
  result._method = 'rule-based';
  return result;
}
function extractCaseNumber(text) {
  const patterns = [
    /W\.?P\.?\s*\(?C\)?\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /SLP\s*\(?C(?:ivil)?\)?\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /Crl\.?\s*A\.?\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /Civil\s*Appeal\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /Criminal\s*Appeal\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /CMP\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /O\.?A\.?\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /R\.?P\.?\s*(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /(?:Writ|Original|Regular)\s*(?:Petition|Application|Appeal)\s*(?:\((?:Civil|Criminal|C|Crl)\)\s*)?(?:No\.?)?\s*\d+\s*\/\s*\d{4}/i,
    /(?:Case|Suit|Petition)\s*No\.?\s*[\w.\-\/]+\d{4}/i,
    /\b\d{2,5}\s*\/\s*\d{4}\b/  // Generic fallback: 1234/2024
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return 'Not Found';
}
function extractCourt(text) {
  const patterns = [
    /(?:(?:Hon'?ble|Honourable)\s+)?Supreme\s+Court\s+of\s+India/i,
    /(?:(?:Hon'?ble|Honourable)\s+)?High\s+Court\s+(?:of\s+)?[\w\s]+?(?:at\s+[\w\s]+)?/i,
    /(?:National|State)\s+(?:Green\s+)?Tribunal[\w\s,]*/i,
    /(?:Central|State)\s+Administrative\s+Tribunal[\w\s,]*/i,
    /District\s+(?:and\s+Sessions\s+)?Court[\w\s,]*/i,
    /(?:Family|Labour|Consumer)\s+Court[\w\s,]*/i,
    /(?:Sessions|Magistrate['']?s?)\s+Court[\w\s,]*/i,
    /NCLT[\w\s,]*/i,
    /NCLAT[\w\s,]*/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let court = m[0].trim();
      court = court.replace(/\s+(IN|THE|BEFORE|CORAM|DATE).*/i, '').trim();
      if (court.length > 100) court = court.substring(0, 100);
      return court;
    }
  }
  return 'Not Found';
}
function extractDate(text) {
  const dateContextPatterns = [
    /(?:dated?|decided\s+on|pronounced\s+on|delivered\s+on|order\s+dated?)\s*[:.]?\s*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/i,
    /(?:dated?|decided\s+on|pronounced\s+on)\s*[:.]?\s*(\d{1,2}\s*(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*\d{4})/i,
    /(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{4})/,
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*\d{4})/i,
  ];

  for (const p of dateContextPatterns) {
    const m = text.match(p);
    if (m) return (m[1] || m[0]).trim();
  }
  return 'Not Found';
}
function extractJudge(text) {
  const patterns = [
    /(?:CORAM|BEFORE)\s*:?\s*((?:(?:Hon'?ble|Honourable)\s+)?(?:(?:Chief\s+)?Justice|J\.?J?\.?)\s+[A-Z][\w.\s\-,']+)/i,
    /(?:Hon'?ble|Honourable)\s+(?:(?:Chief\s+)?Justice|Mr\.?\s+Justice|Mrs\.?\s+Justice)\s+[A-Z][\w.\s\-,']+/i,
    /(?:Chief\s+)?Justice\s+[A-Z][\w.\s\-,']+/i,
    /(?:Presiding\s+Officer|Chairman|Chairperson|Member\s*\(J\))\s*:?\s*[A-Z][\w.\s\-,']+/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let judge = m[0].trim();
      judge = judge.replace(/^(?:CORAM|BEFORE)\s*:?\s*/i, '').trim();
      if (judge.length > 80) judge = judge.substring(0, 80);
      judge = judge.replace(/\s+(?:AND|&)\s*$/i, '').trim();
      return judge;
    }
  }
  return 'Not Found';
}
function extractParties(text) {
  const patterns = [
    /([\w\s.,&]+?)\s+(?:vs\.?|v\/s\.?|versus)\s+([\w\s.,&]+?)(?:\n|$|\.{2,})/i,
    /([\w\s.,]+?)\s*\.{2,}\s*(?:Petitioner|Appellant|Complainant)/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      let parties = m[0].trim();
      parties = parties.replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim();
      if (parties.length > 150) parties = parties.substring(0, 150);
      return parties;
    }
  }
  const petitioner = text.match(/(?:Petitioner|Appellant|Complainant)\s*[:\-]\s*([\w\s.,]+)/i);
  const respondent = text.match(/(?:Respondent|Opposite\s+Party)\s*[:\-]\s*([\w\s.,]+)/i);
  if (petitioner && respondent) {
    return `${petitioner[1].trim()} vs ${respondent[1].trim()}`.substring(0, 150);
  }

  return 'Not Found';
}
function extractDirections(orderText) {
  const directions = [];
  const sentences = orderText.split(/(?<=[.;])\s+/);

  const directivePatterns = [
    /\b(?:shall|must|directed\s+to|is\s+directed|are\s+directed|ordered\s+to|is\s+ordered|is\s+hereby\s+directed|is\s+hereby\s+ordered|mandated\s+to|required\s+to|obligated\s+to)\b/i,
    /\b(?:let\s+the|the\s+(?:respondent|petitioner|department|government|authority|state)\s+(?:shall|is|are|may)\s+)/i,
    /\b(?:we\s+direct|this\s+court\s+directs|it\s+is\s+(?:hereby\s+)?directed|it\s+is\s+(?:hereby\s+)?ordered)\b/i,
    /\b(?:compliance\s+(?:report|affidavit)\s+(?:shall|must|to\s+be))\b/i,
    /\b(?:within\s+\d+\s+(?:days|weeks|months))\b/i,
  ];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 15 || trimmed.length > 500) continue;

    for (const p of directivePatterns) {
      if (p.test(trimmed)) {
        let clean = trimmed.replace(/\s+/g, ' ').trim();
        clean = clean.replace(/^\d+[.)]\s*/, '').replace(/^[a-z][.)]\s*/i, '');
        if (clean.length > 20 && !directions.includes(clean)) {
          directions.push(clean);
        }
        break;
      }
    }
  }
  return directions.slice(0, 10);
}
function extractDecision(orderText) {
  const t = orderText.toUpperCase();

  if (/PETITION\s+IS\s+(?:HEREBY\s+)?ALLOWED/i.test(orderText)) return 'Allowed';
  if (/APPEAL\s+IS\s+(?:HEREBY\s+)?ALLOWED/i.test(orderText)) return 'Allowed';
  if (/PETITION\s+IS\s+(?:HEREBY\s+)?DISMISSED/i.test(orderText)) return 'Dismissed';
  if (/APPEAL\s+IS\s+(?:HEREBY\s+)?DISMISSED/i.test(orderText)) return 'Dismissed';
  if (/DISPOSED\s+OF/i.test(orderText)) return 'Disposed';
  if (/PARTLY\s+ALLOWED/i.test(orderText)) return 'Partly Allowed';
  if (t.includes('COMPLY')) return 'Comply';
  if (t.includes('GRANTED')) return 'Granted';
  if (t.includes('QUASHED')) return 'Quashed';
  if (t.includes('REMANDED')) return 'Remanded';
  if (t.includes('ALLOWED')) return 'Allowed';
  if (t.includes('DISMISSED')) return 'Dismissed';

  return 'Not Found';
}
function extractDepartment(orderText, fullText) {
  const combined = orderText + '\n' + (fullText || '').substring(0, 3000);

  const patterns = [
    /(?:respondent|opposite\s+party)\s*(?:no\.?\s*\d+\s*)?\s*[-–]\s*([\w\s,]+?(?:Department|Ministry|Board|Authority|Corporation|Commission|Committee|Council|Bureau|Office|Directorate|Agency|Government)[\w\s,]*)/i,
    /((?:Education|Revenue|Health|Finance|Home|Labour|Agriculture|PWD|Public\s+Works|Urban\s+Development|Social\s+Welfare|Transport|Forest|Environment|Police|Housing|Municipal|Panchayat|Electricity|Water|Tax|Immigration|Defence|IT|Telecom)\s*(?:Department|Ministry|Board|Authority|Division)?)/i,
    /(?:State\s+(?:of\s+)?[\w\s]+?Government)/i,
    /((?:BBMP|BDA|BMRCL|BWSSB|BESCOM|KSRTC|KPTCL|KSPCB|KSHRC|KSFC|KHB)\b)/i,
    /(?:Union|Central|State)\s+Government/i,
  ];

  for (const p of patterns) {
    const m = combined.match(p);
    if (m) {
      let dept = (m[1] || m[0]).trim();
      dept = dept.replace(/\s+/g, ' ');
      if (dept.length > 100) dept = dept.substring(0, 100);
      return dept;
    }
  }
  return 'Not Found';
}
function extractDeadlines(orderText) {
  const deadlines = [];
  const patterns = [
    /within\s+(\d+\s+(?:days?|weeks?|months?|years?))/gi,
    /(\d+\s+(?:days?|weeks?|months?)\s+(?:from|of|after)\s+[\w\s]+?(?:order|judgment|date|receipt))/gi,
    /(?:before|by)\s+(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/gi,
    /(?:on\s+or\s+before)\s+(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/gi,
    /(?:not\s+later\s+than|no\s+later\s+than)\s+([\w\s,]+)/gi,
    /(\d+\s+(?:days?|weeks?|months?))\s+(?:time|period)/gi,
  ];

  for (const p of patterns) {
    let m;
    while ((m = p.exec(orderText)) !== null) {
      const d = m[1].trim().replace(/\s+/g, ' ');
      if (d.length < 60 && !deadlines.includes(d)) {
        deadlines.push(d);
      }
    }
  }

  return deadlines.slice(0, 8);
}
function extractFinancial(orderText) {
  const patterns = [
    /(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d{1,2})?(?:\s*(?:lakhs?|crores?|thousand|lacs?))?/gi,
    /(?:compensation|damages?|penalty|fine|interest|arrears?|amount)\s+(?:of\s+)?(?:₹|Rs\.?|INR)\s*[\d,]+/gi,
    /(?:salary|pay|allowance|pension|gratuity)\s+arrears?/gi,
    /interest\s+(?:at\s+)?(?:the\s+rate\s+of\s+)?\d+\s*%/gi,
    /costs?\s+(?:of\s+)?(?:₹|Rs\.?)\s*[\d,]+/gi,
  ];

  const matches = [];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(orderText)) !== null) {
      const val = m[0].trim();
      if (!matches.includes(val)) matches.push(val);
    }
  }

  if (matches.length > 0) return matches.join('; ').substring(0, 200);
  return 'N/A';
}
function extractRisk(orderText) {
  const patterns = [
    /(?:contempt|contempt\s+(?:of\s+court\s+)?proceedings?)/i,
    /(?:penalty|fine)\s+(?:of|upto|up\s+to)\s+(?:₹|Rs\.?)\s*[\d,]+/i,
    /(?:failure|non[\-\s]?compliance|default)\s+[\w\s]*?(?:will|shall|may)\s+[\w\s]*?(?:result|lead|attract|invite)/i,
    /(?:interest|penalty)\s+(?:at\s+)?(?:the\s+rate\s+of\s+)?\d+\s*%\s*(?:per\s+(?:annum|month|day))?/i,
    /(?:departmental|disciplinary)\s+(?:action|proceedings?)/i,
    /(?:personal\s+liability|personal\s+responsibility)/i,
    /(?:suspension|termination|removal)\s+(?:from\s+service)?/i,
  ];

  const risks = [];
  for (const p of patterns) {
    const m = orderText.match(p);
    if (m) risks.push(m[0].trim());
  }

  if (risks.length > 0) return risks.join('; ').substring(0, 200);
  if (/contempt/i.test(orderText)) return 'Contempt proceedings';
  if (/penalty|fine/i.test(orderText)) return 'Penalty/fine may be imposed';

  return 'Not assessed';
}
