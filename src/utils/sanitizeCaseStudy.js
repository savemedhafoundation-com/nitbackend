const sanitizeHtml = require('sanitize-html');

const richFields = new Set([
  'title', 'abstract', 'introduction', 'keywords', 'reviewOfLiterature', 'researchGap',
  'researchObjectives', 'researchQuestions', 'researchHypothesis', 'caseDescription',
  'content', 'ethicalConsideration', 'discussion', 'expectedOutcomes',
  'scientificSignificance', 'limitation', 'placeOfResearch', 'conclusion',
]);
const options = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'span', 'div',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'sup', 'sub'],
  allowedAttributes: {
    a: ['href', 'title'],
    '*': ['class', 'style'],
    th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
  },
  allowedStyles: {
    '*': {
      'font-family': [/^[a-zA-Z0-9\s,'"-]+$/],
      'font-size': [/^\d{1,3}(?:px|pt|em|rem|%)$/],
      'font-weight': [/^(?:normal|bold|[1-9]00)$/],
      'font-style': [/^(?:normal|italic)$/],
      'text-decoration': [/^(?:none|underline|line-through)$/],
      'text-align': [/^(?:left|center|right|justify)$/],
      color: [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],
    },
  },
  allowedSchemes: ['https', 'http', 'mailto'],
  allowProtocolRelative: false,
};

// Sanitize both writes and reads, so pre-existing stored HTML is safe without a migration.
// Only rich fields are HTML; plain chart labels/cells/captions remain plain strings.
function sanitizeCaseStudy(value, key = '') {
  if (typeof value === 'string') {
    if (key === 'url') return /^https:\/\//i.test(value) ? value : '';
    return richFields.has(key) ? sanitizeHtml(value, options) : value;
  }
  if (Array.isArray(value)) return value.map(item => sanitizeCaseStudy(item, key));
  if (!value || typeof value !== 'object' || value instanceof Date || value._bsontype) return value;
  return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, sanitizeCaseStudy(item, field)]));
}

module.exports = { sanitizeCaseStudy };
