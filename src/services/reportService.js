const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const { parameterDefinitions, knowledgeBase } = require('../data/medicalKnowledge');

const allowedMimeTypes = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/jpg': 'image',
};

const openAiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

const getFetch = async () => {
  if (typeof fetch !== 'undefined') return fetch;
  const { default: nodeFetch } = await import('node-fetch');
  return nodeFetch;
};

const cleanText = text =>
  (text || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/Page \d+ of \d+/gi, '')
    .trim();

const normalizeGender = gender => {
  if (!gender) return null;
  const value = String(gender).toLowerCase();
  if (value.startsWith('m')) return 'male';
  if (value.startsWith('f')) return 'female';
  return null;
};

const extractPatientDetails = rawText => {
  const normalizedText = cleanText(rawText);
  const lines = normalizedText.split('\n').map(line => line.trim()).filter(Boolean);

  let name = null;
  let age = null;
  let gender = null;

  const clampAge = value => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    if (num < 0 || num > 120) return null;
    return num;
  };

  for (const line of lines) {
    if (!name) {
      const nameMatch = line.match(/(?:patient\s*name|name|pt\s*name)\s*[:\-]\s*([A-Za-z][A-Za-z\s.'-]{1,60})/i);
      if (nameMatch) {
        name = nameMatch[1].replace(/\s+/g, ' ').trim();
      }
    }

    if (age === null) {
      const ageMatch =
        line.match(/(?:age|years?|yrs?|y\/o)\s*[:\-]?\s*(\d{1,3})/i) ||
        line.match(/(\d{1,3})\s*(?:year|yr)s?\s*old/i);
      if (ageMatch) {
        age = clampAge(ageMatch[1]);
      }
    }

    if (!gender) {
      const genderMatch = line.match(/(?:sex|gender)\s*[:\-]?\s*([A-Za-z]+)/i);
      const normalized =
        normalizeGender(genderMatch ? genderMatch[1] : null) ||
        (/\bfemale\b/i.test(line) ? 'female' : /\bmale\b/i.test(line) ? 'male' : null);
      if (normalized) {
        gender = normalized;
      }
    }

    if (name && age !== null && gender) break;
  }

  return {
    name: name || null,
    age,
    gender,
  };
};

const pickReferenceRange = (definition, gender) => {
  if (!definition.reference) return null;
  if (gender && definition.reference[gender]) {
    return definition.reference[gender];
  }
  if (definition.reference.general) {
    return definition.reference.general;
  }
  const first = Object.values(definition.reference)[0];
  return first || null;
};

const deriveStatus = (value, referenceRange) => {
  if (typeof value !== 'number' || !referenceRange || referenceRange.length !== 2) {
    return 'unknown';
  }

  const [low, high] = referenceRange;
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'normal';
};

const extractValueForDefinition = (text, definition) => {
  const haystack = text.toLowerCase();

  for (const alias of definition.aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const valueRegex = new RegExp(`${escaped}[^0-9a-zA-Z]{0,8}(-?\\s*)?(\\d+(?:\\.\\d+)?)`, 'i');
    const match = haystack.match(valueRegex);

    if (match && match[2]) {
      return Number(match[2]);
    }
  }

  return null;
};

const structureParameters = (rawText, patient) => {
  const gender = normalizeGender(patient?.gender || patient?.sex);
  const age = patient?.age;
  const parsedAge = Number(age);
  const safeAge = Number.isFinite(parsedAge) && `${age}`.trim() !== '' ? parsedAge : null;
  const name = typeof patient?.name === 'string' ? patient.name.trim() || null : null;
  const normalizedText = cleanText(rawText);

  const parameters = parameterDefinitions
    .map(definition => {
      const value = extractValueForDefinition(normalizedText, definition);
      if (value === null) return null;

      const referenceRange = pickReferenceRange(definition, gender);
      const status = deriveStatus(value, referenceRange);
      const referenceRangeLabel = referenceRange
        ? `${referenceRange[0]}-${referenceRange[1]} ${definition.units || ''}`.trim()
        : null;

      return {
        name: definition.name,
        panel: definition.panel,
        value,
        unit: definition.units,
        referenceRange: referenceRangeLabel,
        status,
      };
    })
    .filter(Boolean);

  return {
    patient: {
      name,
      age: safeAge,
      gender,
    },
    parameters,
    rawText: normalizedText,
  };
};

const extractTextFromPdf = async buffer => {
  const { text, info } = await pdfParse(buffer);
  return { text, metadata: { pages: info?.Pages || null, type: 'pdf' } };
};

const extractTextWithTesseract = async buffer => {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker({ logger: null });
  await worker.loadLanguage('eng');
  await worker.initialize('eng');

  const {
    data: { text },
  } = await worker.recognize(buffer);

  await worker.terminate();
  return text;
};

const extractTextFromImage = async buffer => {
  if (process.env.OCR_API_URL) {
    const fetchFn = await getFetch();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.OCR_API_TIMEOUT_MS || 15000));

    try {
      const response = await fetchFn(process.env.OCR_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: process.env.OCR_API_TOKEN ? `Bearer ${process.env.OCR_API_TOKEN}` : undefined,
        },
        body: JSON.stringify({ image: buffer.toString('base64') }),
      });

      if (!response.ok) {
        throw new Error(`External OCR failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (typeof payload.text === 'string' && payload.text.trim()) {
        return { text: payload.text, metadata: { provider: 'external' } };
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const text = await extractTextWithTesseract(buffer);
  return { text, metadata: { provider: 'tesseract' } };
};

const extractReportText = async file => {
  if (!file) {
    const error = new Error('No file uploaded');
    error.statusCode = 400;
    throw error;
  }

  const type = allowedMimeTypes[file.mimetype];
  if (!type) {
    const error = new Error('Unsupported file type');
    error.statusCode = 415;
    throw error;
  }

  if (type === 'pdf') {
    return extractTextFromPdf(file.buffer);
  }

  return extractTextFromImage(file.buffer);
};

const buildKnowledgeSummary = parameters =>
  parameters.map(param => {
    const knowledge = knowledgeBase[param.name] || {};
    return {
      name: param.name,
      status: param.status,
      organ: knowledge.organ || 'System',
      lowMeaning: knowledge.low || '',
      highMeaning: knowledge.high || '',
      nutrition: knowledge.nutrition || [],
      lifestyle: knowledge.lifestyle || [],
    };
  });

const fallbackExplanation = structured => {
  const disclaimer =
    'This explanation is for educational purposes only and does not replace medical diagnosis or treatment.';

  const abnormal = structured.parameters.filter(item => item.status === 'low' || item.status === 'high');

  const summary =
    abnormal.length === 0
      ? 'Most parameters detected are within their general reference ranges. Continue routine healthy habits.'
      : `We observed ${abnormal.length} parameter(s) outside general reference ranges. Review the notes below and consider repeating the test if advised.`;

  const parameterExplanation = abnormal.map(item => {
    const knowledge = knowledgeBase[item.name] || {};
    const direction = item.status === 'low' ? knowledge.low : knowledge.high;
    const support = [
      ...(knowledge.nutrition || []).slice(0, 2),
      ...(knowledge.lifestyle || []).slice(0, 1),
    ];

    return {
      name: item.name,
      value: item.value,
      unit: item.unit,
      referenceRange: item.referenceRange,
      status: item.status,
      explanation:
        direction ||
        'Value is outside the common lab reference window. Factors like hydration, sleep, recent meals, and medications can shift results.',
      guidance: support.join('; '),
      support,
    };
  });

  return {
    summary,
    parameterExplanation,
    rootCauseDirection: [
      'Check recent stress, sleep, and hydration as they commonly influence lab variability.',
      'Review nutrition variety with fiber, colorful plants, lean protein, and healthy fats.',
    ],
    naturalSupportGuidance: [
      'Hydrate with clean water/জল spaced through the day.',
      'Use cruciferous and bitter greens to aid natural detox pathways.',
      'Pair protein with vitamin- and mineral-rich vegetables for recovery.',
    ],
    nextSteps: [
      'Repeat key abnormal parameters in 2-4 weeks or as advised.',
      'Share results with a clinician if symptoms persist or worsen.',
    ],
    disclaimer,
  };
};

const generateAiExplanation = async (structured, rawText) => {
  if (!openAiClient) {
    return fallbackExplanation(structured);
  }

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 18000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const knowledgeSummary = buildKnowledgeSummary(structured.parameters);

//   const systemPrompt = `
// You are a Natural Immunotherapy medical report explainer.
// Your goals: simplify lab reports, flag low/high values, give educational guidance only and describe the report in layman's terms.
// Never diagnose, never prescribe medication, never mention drug names or dosages.
// Use phrases like "may indicate" or "can be related to".
// Tone: calm, reassuring, safety-first, Natural Immunotherapy aligned (nutrition, detox, repair, rest).
// Hydration guidance should include the Bengali word "জল" when giving a hydration tip.
// Always include the exact disclaimer text in the "disclaimer" field: "This explanation is for educational purposes only and does not replace medical diagnosis or treatment."
// Output JSON only. No prose outside JSON. JSON shape:
// {
//   "summary": string,
//   "parameterExplanation": [
//     { "name": string, "status": "low|high|normal|unknown", "explanation": string, "guidance": string }
//   ],
//   "rootCauseDirection": [string],
//   "naturalSupportGuidance": [string],
//   "nextSteps": [string],
//   "disclaimer": string
// }
// `;
const systemPrompt = `
You are a Natural Immunotherapy medical report explainer.

Your role:
- Explain **medical reports** in simple, layman-friendly language.
- You may receive **pathology reports (lab tests)** or **radiology reports (USG, CT, MRI, X-ray, PET, etc.)**.
- First identify the report type: Pathology or Radiology.

Core rules (STRICT):
- Never diagnose.
- Never prescribe medication.
- Never mention drug names, injections, or dosages.
- Never claim cure or certainty.
- Use educational, safety-first language only.
- Always use phrases like "may indicate", "can be related to", "sometimes seen in", "can suggest".
- Tone must be calm, reassuring, respectful, and Natural Immunotherapy aligned.
- Focus on nutrition balance, detox support, cellular repair, rest, hydration, and lifestyle.
- When giving hydration advice, 반드시 include the Bengali word **"জল"**.
- Do NOT add content outside JSON.
- Output JSON ONLY.

If the report is a **PATHOLOGY / LAB REPORT**:
- Flag values as low / high / normal / unknown.
- Explain what each parameter generally represents.
- Give non-medical, educational guidance (nutrition, rest, digestion, hydration).
- Avoid disease labels unless they are already written in the report, and even then describe them cautiously.

If the report is a **RADIOLOGY REPORT**:
- Create two mandatory sections inside the explanation:
  1. **Findings** – simplified explanation of what is seen
  2. **Impression** – simplified meaning of the radiologist’s impression
- Do NOT reinterpret or override the radiologist.
- Do NOT escalate severity.
- Explain structures, size changes, fluid, inflammation, masses, or organ changes in simple terms.

Allowed references:
- You may mention:
  - “as noted in the report”
  - “as described by the radiologist/pathologist”
- Do NOT cite studies, journals, or external medical sources.

Output format (MANDATORY JSON STRUCTURE):
{
  "reportType": "pathology" | "radiology",
  "summary": string,
  "findings": string | null,
  "impression": string | null,
  "parameterExplanation": [
    {
      "name": string,
      "status": "low|high|normal|unknown",
      "explanation": string,
      "guidance": string
    }
  ],
  "rootCauseDirection": [string],
  "naturalSupportGuidance": [string],
  "nextSteps": [string],
  "disclaimer": "This explanation is for educational purposes only and does not replace medical diagnosis or treatment."
}

Important:
- For pathology reports → findings and impression must be null.
- For radiology reports → parameterExplanation can be empty [], but findings and impression must be present.
- Never change the disclaimer text.
`;

  const userPrompt = `
Raw report text (cleaned):
${rawText}

Structured parameters:
${JSON.stringify(structured.parameters, null, 2)}

Knowledge base:
${JSON.stringify(knowledgeSummary, null, 2)}

Patient details (extracted):
${JSON.stringify(structured.patient, null, 2)}

Generate concise, patient-friendly explanations per parameter that is low or high.
For normal parameters, keep remarks brief. Do not suggest medications or doses.
`;

  try {
    const completion = await openAiClient.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        temperature: 0.25,
        max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 700),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      { signal: controller.signal }
    );

    const content = completion?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);

    parsed.disclaimer =
      'This explanation is for educational purposes only and does not replace medical diagnosis or treatment.';

    return parsed;
  } catch (error) {
    const isTimeout =
      error?.name === 'AbortError' || /abort|timeout/i.test(error?.message || '');
    if (!isTimeout) {
      console.error('AI explanation failed:', error?.message);
    }
    return fallbackExplanation(structured);
  } finally {
    clearTimeout(timeoutId);
  }
};

const explainReport = async ({ rawText, patient }) => {
  const extractedPatient = extractPatientDetails(rawText);
  const mergedPatient = { ...extractedPatient, ...(patient || {}) };
  const structured = structureParameters(rawText, mergedPatient);
  const explanation = await generateAiExplanation(structured, rawText);

  return {
    structuredReport: structured,
    explanation,
  };
};

module.exports = {
  extractReportText,
  explainReport,
  cleanText,
  extractPatientDetails,
};
