const MAX_PDF_SIZE_BYTES = 524288000;
const DEFAULT_COVER_SIZE_BYTES = 5242880;
const COVER_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const EBOOK_STATUSES = Object.freeze(['DRAFT', 'UPLOADING', 'PROCESSING', 'READY', 'PUBLISHED', 'FAILED']);

class EbookError extends Error {
  constructor(statusCode, message, code = 'EBOOK_ERROR') {
    super(message);
    this.name = 'EbookError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const sizeLabel = bytes => `${Number((bytes / 1048576).toFixed(2))} MB`;

function configuredInteger(name, fallback, maximum) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new EbookError(503, 'Ebook storage configuration is invalid. Contact an administrator.', 'STORAGE_CONFIGURATION');
  }
  return value;
}

function getEbookConfig() {
  const maxPdfSizeBytes = configuredInteger('EBOOK_MAX_SIZE_BYTES', MAX_PDF_SIZE_BYTES, MAX_PDF_SIZE_BYTES);
  const maxCoverSizeBytes = configuredInteger('EBOOK_COVER_MAX_SIZE_BYTES', DEFAULT_COVER_SIZE_BYTES, 10485760);
  return {
    maxPdfSizeBytes,
    maxPdfSizeLabel: sizeLabel(maxPdfSizeBytes),
    maxCoverSizeBytes,
    maxCoverSizeLabel: sizeLabel(maxCoverSizeBytes),
    allowedCoverTypes: [...COVER_TYPES],
    // A private store is intentional: drafts must never have publicly readable URLs.
    access: 'private',
    storageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    uploadTokenLifetimeMs: 12 * 60 * 60 * 1000,
    readUrlLifetimeMs: 15 * 60 * 1000,
  };
}

module.exports = { MAX_PDF_SIZE_BYTES, COVER_TYPES, EBOOK_STATUSES, EbookError, sizeLabel, getEbookConfig };
