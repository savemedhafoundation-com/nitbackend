const { timingSafeEqual } = require('node:crypto');
const service = require('../services/ebookService');
const blobStorage = require('../services/ebookBlobService');
const { getEbookConfig, EbookError } = require('../config/ebookConfig');

const listPublic = async (req, res) => res.json(await service.listEbooks(req.query));
const getPublic = async (req, res) => res.json(await service.getEbook(req.params.id));
const listAdmin = async (req, res) => res.json(await service.listEbooks(req.query, true));
const getAdmin = async (req, res) => res.json(await service.getEbook(req.params.id, true));
const config = (_req, res) => {
  const { maxPdfSizeBytes, maxPdfSizeLabel, maxCoverSizeBytes, maxCoverSizeLabel, allowedCoverTypes, storageConfigured, access } = getEbookConfig();
  return res.json({ maxPdfSizeBytes, maxPdfSizeLabel, maxCoverSizeBytes, maxCoverSizeLabel, allowedCoverTypes, storageConfigured, access });
};
const create = async (req, res) => res.status(201).json(await service.createEbook(req.body, req.user._id));
const update = async (req, res) => res.json(await service.updateEbook(req.params.id, req.body));
const publish = async (req, res) => res.json(await service.publishEbook(req.params.id, true));
const unpublish = async (req, res) => res.json(await service.publishEbook(req.params.id, false));
const remove = async (req, res) => res.json(await service.deleteEbook(req.params.id));
const prepareUpload = async (req, res) => res.status(201).json(await service.prepareUpload(req.params.id, req.body, req.user._id));
const completeUpload = async (req, res) => res.json(await service.completeUpload(req.params.id, req.params.uploadId));
const cancelUpload = async (req, res) => res.json(await service.cancelUpload(req.params.id, req.params.uploadId));

async function callback(req, res) {
  try {
    return res.json(await blobStorage.handleBlobCallback(req, service.processBlobCallback));
  } catch (error) {
    if (error instanceof EbookError) throw error;
    if (/callback signature/i.test(error?.message || '')) throw new EbookError(403, 'Invalid upload callback.', 'INVALID_CALLBACK');
    throw error;
  }
}

function protectCleanup(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const value = req.headers.authorization;
  if (!secret || typeof value !== 'string') return res.status(401).json({ message: 'Not authorized.', code: 'UNAUTHORIZED' });
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ message: 'Not authorized.', code: 'UNAUTHORIZED' });
  return next();
}

const cleanup = async (_req, res) => res.json(await service.runCleanup());

// Feature-specific error boundary: never return raw MongoDB, JWT, Blob errors,
// request URLs containing signatures, or stack traces to the client.
function errorHandler(error, req, res, _next) {
  if (res.headersSent) return _next(error);
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Provide valid JSON ebook details.', code: 'INVALID_JSON' });
  if (error?.type === 'entity.too.large') return res.status(413).json({ message: 'Ebook metadata is too large. Upload files directly to storage.', code: 'REQUEST_TOO_LARGE' });
  if (error instanceof EbookError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
  if (res.statusCode === 404) return res.status(404).json({ message: 'Ebook resource not found.', code: 'EBOOK_NOT_FOUND' });
  if (res.statusCode === 401 || error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Please sign in with an administrator account.', code: 'UNAUTHORIZED' });
  }
  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    return res.status(400).json({ message: 'Some ebook details are invalid. Review the form and try again.', code: 'INVALID_METADATA' });
  }
  return res.status(503).json({ message: 'The ebook service is temporarily unavailable. Please retry.', code: 'SERVICE_UNAVAILABLE' });
}

module.exports = { listPublic, getPublic, listAdmin, getAdmin, config, create, update, publish, unpublish, remove,
  prepareUpload, completeUpload, cancelUpload, callback, protectCleanup, cleanup, errorHandler };
