const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Ebook = require('../models/Ebook');
const EbookUpload = require('../models/EbookUpload');
const blobStorage = require('./ebookBlobService');
const { EbookError, getEbookConfig, EBOOK_STATUSES } = require('../config/ebookConfig');

const PUBLIC_FIELDS = '_id title author description category tags coverBlobPathname pdfSizeBytes mimeType status isPublished allowDownload publicationDate publishedAt createdAt updatedAt';
const METADATA_FIELDS = new Set(['title', 'author', 'description', 'category', 'tags', 'publicationDate', 'allowDownload']);
const ACTIVE_UPLOAD_STATUSES = ['UPLOADING', 'PROCESSING'];
const pointerField = kind => kind === 'pdf' ? 'pendingPdfUpload' : 'pendingCoverUpload';
const pathField = kind => kind === 'pdf' ? 'pdfBlobPathname' : 'coverBlobPathname';
const notFound = () => new EbookError(404, 'Ebook not found.', 'EBOOK_NOT_FOUND');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const equalId = (left, right) => Boolean(left && right && String(left) === String(right));

function assertId(id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) throw notFound();
}

function textField(value, field, maxLength, required = false) {
  if (typeof value !== 'string' || value.trim().length > maxLength || (required && !value.trim())) {
    throw new EbookError(400, required ? `${field} is required and must be ${maxLength} characters or fewer.` :
      `${field} must be ${maxLength} characters or fewer.`, 'INVALID_METADATA');
  }
  return value.trim();
}

function parseMetadata(body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EbookError(400, 'Provide valid ebook details.', 'INVALID_METADATA');
  if (Object.keys(body).some(key => !METADATA_FIELDS.has(key))) {
    throw new EbookError(400, 'Only ebook metadata can be edited here. Use the upload or publish action for files and status.', 'INVALID_METADATA');
  }
  const result = {};
  if (creating || body.title !== undefined) result.title = textField(body.title, 'Title', 200, true);
  for (const [field, maxLength] of Object.entries({ author: 160, description: 10000, category: 100 })) {
    if (body[field] !== undefined) result[field] = textField(body[field], field[0].toUpperCase() + field.slice(1), maxLength);
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 20) throw new EbookError(400, 'Use at most 20 tags.', 'INVALID_METADATA');
    result.tags = [...new Set(body.tags.map(tag => textField(tag, 'Tag', 60, true)))];
  }
  if (body.publicationDate !== undefined) {
    const date = body.publicationDate === '' || body.publicationDate === null ? null : new Date(body.publicationDate);
    if (date && (typeof body.publicationDate !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(body.publicationDate) || !Number.isFinite(date.getTime()))) {
      throw new EbookError(400, 'Choose a valid publication date.', 'INVALID_METADATA');
    }
    result.publicationDate = date;
  }
  if (body.allowDownload !== undefined) {
    if (typeof body.allowDownload !== 'boolean') throw new EbookError(400, 'Download permission must be true or false.', 'INVALID_METADATA');
    result.allowDownload = body.allowDownload;
  }
  return result;
}

function parseUpload(body) {
  const config = getEbookConfig();
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['kind', 'filename', 'size', 'contentType'].includes(key)) ||
      !['pdf', 'cover'].includes(body.kind)) throw new EbookError(400, 'Provide valid upload details.', 'INVALID_UPLOAD');
  const { kind, filename, size, contentType } = body;
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(filename)) {
    throw new EbookError(400, 'Choose a file with a valid filename.', 'INVALID_FILENAME');
  }
  const maxSize = kind === 'pdf' ? config.maxPdfSizeBytes : config.maxCoverSizeBytes;
  if (!Number.isSafeInteger(size) || size <= 0) throw new EbookError(400, 'The selected file is empty or has an invalid size.', 'INVALID_FILE_SIZE');
  if (size > maxSize) throw new EbookError(400, kind === 'pdf' ? `Ebook PDF must be ${config.maxPdfSizeLabel} or smaller.` :
    `Cover image must be ${config.maxCoverSizeLabel} or smaller.`, 'FILE_TOO_LARGE');
  const extension = filename.split('.').pop().toLowerCase();
  const imageExtensions = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
  if (kind === 'pdf' ? contentType !== 'application/pdf' || extension !== 'pdf' :
    !config.allowedCoverTypes.includes(contentType) || !imageExtensions[contentType]?.includes(extension)) {
    throw new EbookError(400, kind === 'pdf' ? 'Choose a PDF file (.pdf).' : 'Choose a JPEG, PNG, or WebP cover image.', 'INVALID_FILE_TYPE');
  }
  return { kind, filename: filename.trim(), size, contentType, extension: kind === 'pdf' ? 'pdf' : contentType === 'image/jpeg' ? 'jpg' : extension };
}

async function getRecord(id, { admin = false, includeDeleted = false } = {}) {
  assertId(id);
  const filter = { _id: id, ...(includeDeleted ? {} : { deletedAt: null }),
    ...(admin ? {} : { isPublished: true, status: 'PUBLISHED' }) };
  const ebook = await Ebook.findOne(filter);
  if (!ebook) throw notFound();
  return ebook;
}

async function serializeEbook(record, { details = true, admin = false, validUntil = 0 } = {}) {
  const source = typeof record.toObject === 'function' ? record.toObject() : record;
  const output = {};
  for (const field of PUBLIC_FIELDS.split(' ').filter(field => field !== 'coverBlobPathname')) output[field] = source[field];
  const expiry = validUntil || Date.now() + getEbookConfig().readUrlLifetimeMs;
  output.coverBlobUrl = '';
  output.assetUrlsExpireAt = new Date(expiry).toISOString();
  if (source.coverBlobPathname) output.coverBlobUrl = (await blobStorage.signReadUrl(source.coverBlobPathname, expiry)).url;
  if (details && source.pdfBlobPathname) {
    const signed = await blobStorage.signReadUrl(source.pdfBlobPathname, expiry);
    output.pdfBlobUrl = signed.url;
    if (source.allowDownload || admin) output.pdfDownloadUrl = signed.downloadUrl;
  }
  if (admin) {
    output.createdBy = source.createdBy;
    output.cleanupPending = Boolean(source.cleanupBlobPathnames?.length);
    output.hasPdf = Boolean(source.pdfBlobPathname);
    output.pendingPdfUpload = source.pendingPdfUpload;
    output.pendingCoverUpload = source.pendingCoverUpload;
  }
  return output;
}

async function getEbook(id, admin = false) {
  const ebook = await getRecord(id, { admin });
  const output = await serializeEbook(ebook, { admin });
  if (admin) {
    output.pendingUploads = await EbookUpload.find({ ebook: id, status: { $in: ACTIVE_UPLOAD_STATUSES } })
      .select('_id kind status filename size expiresAt error').sort({ createdAt: -1 }).lean();
  }
  // Signing can involve network IO. Do not return fresh URLs after an unpublish/delete raced it.
  if (!await Ebook.exists({ _id: id, deletedAt: null, ...(admin ? {} : { isPublished: true, status: 'PUBLISHED' }) })) throw notFound();
  return output;
}

async function listEbooks(query, admin = false) {
  const integer = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
      throw new EbookError(400, 'Invalid pagination parameters.', 'INVALID_QUERY');
    }
    return Number(value);
  };
  const page = integer(query.page, 1, 10000);
  const limit = integer(query.limit, 12, 50);
  const baseFilter = { deletedAt: null, ...(admin ? {} : { isPublished: true, status: 'PUBLISHED' }) };
  /** @type {Record<string, unknown>} */
  const filter = { ...baseFilter };
  if (query.q !== undefined) {
    const q = textField(query.q, 'Search', 120);
    if (q) {
      const search = new RegExp(escapeRegex(q), 'i');
      filter.$or = ['title', 'author', 'description', 'category', 'tags'].map(field => ({ [field]: search }));
    }
  }
  if (query.category !== undefined && query.category !== '') filter.category = textField(query.category, 'Category', 100);
  if (admin && query.status) {
    if (typeof query.status !== 'string' || !EBOOK_STATUSES.includes(query.status)) throw new EbookError(400, 'Invalid ebook status.', 'INVALID_QUERY');
    filter.status = query.status;
  }
  const [records, total, categories] = await Promise.all([
    Ebook.find(filter).select(admin ? `${PUBLIC_FIELDS} createdBy pdfBlobPathname pendingPdfUpload pendingCoverUpload cleanupBlobPathnames` : PUBLIC_FIELDS)
      .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Ebook.countDocuments(filter),
    Ebook.distinct('category', baseFilter),
  ]);
  const validUntil = Date.now() + getEbookConfig().readUrlLifetimeMs;
  const data = await Promise.all(records.map(record => serializeEbook(record, { details: false, admin, validUntil })));
  return { data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    categories: categories.filter(Boolean).sort(), assetUrlsExpireAt: new Date(validUntil).toISOString() };
}

async function createEbook(body, userId) {
  const ebook = await Ebook.create({ ...parseMetadata(body, true), createdBy: userId });
  return serializeEbook(ebook, { admin: true });
}

async function updateEbook(id, body) {
  assertId(id);
  const metadata = parseMetadata(body);
  const ebook = await Ebook.findOneAndUpdate({ _id: id, deletedAt: null }, { $set: metadata, $inc: { __v: 1 } }, { new: true, runValidators: true });
  if (!ebook) throw notFound();
  return serializeEbook(ebook, { admin: true });
}

async function publishEbook(id, publish) {
  const ebook = await getRecord(id, { admin: true });
  if (publish && (!ebook.pdfBlobPathname || !ebook.pdfSizeBytes || !['READY', 'PUBLISHED'].includes(ebook.status) || ebook.pendingPdfUpload)) {
    throw new EbookError(409, 'Finish uploading and verifying the PDF before publishing.', 'PDF_NOT_READY');
  }
  const updated = await Ebook.findOneAndUpdate({ _id: id, deletedAt: null, __v: ebook.__v }, {
    $set: {
      isPublished: publish,
      status: publish ? 'PUBLISHED' : ebook.pdfBlobPathname ? 'READY' : ebook.status,
      ...(publish ? { publishedAt: ebook.publishedAt || new Date() } : {}),
    }, $inc: { __v: 1 },
  }, { new: true });
  if (!updated) throw new EbookError(409, 'The ebook changed. Refresh and try again.', 'EBOOK_CHANGED');
  return serializeEbook(updated, { admin: true });
}

async function pathIsActive(pathname) {
  return Boolean(await Ebook.exists({ deletedAt: null, $or: [{ pdfBlobPathname: pathname }, { coverBlobPathname: pathname }] }));
}

async function cleanupEbookPaths(ebookId) {
  const ebook = await Ebook.findById(ebookId);
  if (!ebook) return;
  for (const pathname of ebook.cleanupBlobPathnames) {
    if (await pathIsActive(pathname)) continue;
    try {
      await blobStorage.deleteBlob(pathname);
      await Ebook.updateOne({ _id: ebookId }, { $pull: { cleanupBlobPathnames: pathname } });
    } catch {
      // The path stays in the durable outbox for the next cleanup run.
    }
  }
}

async function cleanupUpload(upload) {
  if (await pathIsActive(upload.pathname)) {
    await EbookUpload.updateOne({ _id: upload._id }, { $set: { cleanupPending: false } });
    return;
  }
  try {
    await blobStorage.deleteBlob(upload.pathname);
    // Keep the tombstone until its scoped token expires. A late multipart completion
    // can still create an object; the signed callback/cleanup run will remove it again.
    await EbookUpload.updateOne({ _id: upload._id }, { $set: { cleanupPending: new Date(upload.expiresAt).getTime() > Date.now() } });
  } catch {
    await EbookUpload.updateOne({ _id: upload._id }, { $set: { cleanupPending: true } });
  }
}

async function cancelUpload(id, uploadId, failed = false, message = '') {
  assertId(id); assertId(uploadId);
  const upload = await EbookUpload.findOne({ _id: uploadId, ebook: id });
  if (!upload) throw new EbookError(404, 'Upload not found.', 'UPLOAD_NOT_FOUND');
  const ebook = await Ebook.findById(id);
  if (ebook && !ebook.deletedAt && ebook[pathField(upload.kind)] === upload.pathname) {
    // Recover if the asset was committed but the separate session update failed.
    await EbookUpload.updateOne({ _id: uploadId }, { $set: {
      status: 'COMPLETE', completedAt: upload.completedAt || new Date(), cleanupPending: false, error: '',
    } });
    return { message: 'The upload is already complete.', alreadyComplete: true };
  }
  await EbookUpload.updateOne({ _id: uploadId }, { $set: { status: failed ? 'FAILED' : 'CANCELLED', cleanupPending: true, error: message } });
  if (ebook && equalId(ebook[pointerField(upload.kind)], uploadId)) {
    const set = { [pointerField(upload.kind)]: null };
    if (upload.kind === 'pdf' && !ebook.pdfBlobPathname) set.status = failed ? 'FAILED' : 'DRAFT';
    await Ebook.updateOne({ _id: id, [pointerField(upload.kind)]: uploadId }, { $set: set, $inc: { __v: 1 } });
  }
  await cleanupUpload(upload);
  return { message: failed ? message : 'Upload cancelled.' };
}

async function prepareUpload(id, body, userId) {
  const file = parseUpload(body);
  blobStorage.storageToken();
  const ebook = await getRecord(id, { admin: true });
  const config = getEbookConfig();
  const uploadId = new mongoose.Types.ObjectId();
  const pathname = `ebooks/${ebook._id}/${file.kind}/${randomUUID()}.${file.extension}`;
  const upload = await EbookUpload.create({ _id: uploadId, ebook: id, createdBy: userId,
    kind: file.kind, filename: file.filename, contentType: file.contentType, size: file.size,
    pathname, expiresAt: new Date(Date.now() + config.uploadTokenLifetimeMs) });
  const field = pointerField(file.kind);
  const previousUpload = ebook[field];
  const updated = await Ebook.findOneAndUpdate({ _id: id, deletedAt: null, __v: ebook.__v }, {
    $set: { [field]: uploadId, ...(file.kind === 'pdf' && !ebook.pdfBlobPathname ? { status: 'UPLOADING' } : {}) },
    $inc: { __v: 1 },
  }, { new: true });
  if (!updated) {
    await EbookUpload.updateOne({ _id: uploadId }, { $set: { status: 'CANCELLED', cleanupPending: true } });
    throw new EbookError(409, 'The ebook changed. Retry the upload.', 'EBOOK_CHANGED');
  }
  if (previousUpload) await cancelUpload(id, String(previousUpload));
  try {
    const clientToken = await blobStorage.createClientUploadToken(upload);
    return { uploadId: String(uploadId), pathname, clientToken, access: config.access, expiresAt: upload.expiresAt };
  } catch (error) {
    await cancelUpload(id, String(uploadId), true, 'Upload authorization failed. Please retry.');
    throw error;
  }
}

async function finishUpload(id, uploadId) {
  assertId(id); assertId(uploadId);
  const upload = await EbookUpload.findOne({ _id: uploadId, ebook: id });
  if (!upload) throw new EbookError(404, 'Upload not found.', 'UPLOAD_NOT_FOUND');
  let ebook = await Ebook.findById(id);
  if (!ebook || ebook.deletedAt || ['CANCELLED', 'FAILED'].includes(upload.status)) {
    await cleanupUpload(upload);
    throw new EbookError(409, 'This upload was cancelled or replaced. Start a new upload.', 'UPLOAD_CANCELLED');
  }
  const field = pointerField(upload.kind);
  const assetPath = pathField(upload.kind);
  if (ebook[assetPath] === upload.pathname || upload.status === 'COMPLETE') {
    await EbookUpload.updateOne({ _id: uploadId }, { $set: { status: 'COMPLETE', completedAt: upload.completedAt || new Date(), error: '' } });
    await cleanupEbookPaths(id);
    return ebook;
  }
  if (!equalId(ebook[field], uploadId) || upload.expiresAt.getTime() < Date.now()) {
    await cancelUpload(id, uploadId);
    throw new EbookError(409, 'This upload configuration expired or was replaced. Start a new upload.', 'UPLOAD_EXPIRED');
  }
  await EbookUpload.updateOne({ _id: uploadId, status: { $in: ACTIVE_UPLOAD_STATUSES } }, { $set: { status: 'PROCESSING', error: '' } });
  if (upload.kind === 'pdf' && !ebook.pdfBlobPathname) {
    await Ebook.updateOne({ _id: id, deletedAt: null, pendingPdfUpload: uploadId, pdfBlobPathname: '' }, { $set: { status: 'PROCESSING' }, $inc: { __v: 1 } });
  }
  let verified;
  try {
    verified = await blobStorage.verifyUpload(upload);
  } catch (error) {
    if (error instanceof EbookError && error.statusCode === 400) {
      await cancelUpload(id, uploadId, true, error.message);
    } else {
      await EbookUpload.updateOne({ _id: uploadId, status: 'PROCESSING' }, { $set: { status: 'UPLOADING', error: 'Verification could not finish. Please retry.' } });
    }
    throw error;
  }
  // Compare-and-swap against the pending upload AND document revision. This protects
  // newer uploads, concurrent publish/unpublish, and deletion while validation ran.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    ebook = await Ebook.findById(id);
    if (ebook && !ebook.deletedAt && ebook[assetPath] === upload.pathname) break;
    if (!ebook || ebook.deletedAt || !equalId(ebook[field], uploadId)) {
      await cancelUpload(id, uploadId);
      throw new EbookError(409, 'This upload was cancelled or replaced.', 'UPLOAD_CANCELLED');
    }
    const previousPath = ebook[assetPath];
    const set = upload.kind === 'pdf' ? {
      pdfBlobUrl: verified.url, pdfBlobPathname: verified.pathname, pdfSizeBytes: verified.size,
      mimeType: 'application/pdf', pendingPdfUpload: null, status: ebook.isPublished ? 'PUBLISHED' : 'READY',
    } : { coverBlobUrl: verified.url, coverBlobPathname: verified.pathname, pendingCoverUpload: null };
    const saved = await Ebook.findOneAndUpdate({ _id: id, deletedAt: null, [field]: uploadId, __v: ebook.__v }, {
      $set: set, $inc: { __v: 1 }, ...(previousPath ? { $addToSet: { cleanupBlobPathnames: previousPath } } : {}),
    }, { new: true, runValidators: true });
    if (saved) { ebook = saved; break; }
    if (attempt === 3) throw new EbookError(409, 'The ebook changed. Retry verification.', 'EBOOK_CHANGED');
  }
  await EbookUpload.updateOne({ _id: uploadId }, { $set: { status: 'COMPLETE', completedAt: new Date(), error: '', cleanupPending: false } });
  await cleanupEbookPaths(id);
  return ebook;
}

async function completeUpload(id, uploadId) {
  return serializeEbook(await finishUpload(id, uploadId), { admin: true });
}

async function deleteEbook(id) {
  const ebook = await getRecord(id, { admin: true, includeDeleted: true });
  const paths = [ebook.pdfBlobPathname, ebook.coverBlobPathname].filter(Boolean);
  await Ebook.updateOne({ _id: id }, {
    $set: { deletedAt: ebook.deletedAt || new Date(), isPublished: false, pendingPdfUpload: null, pendingCoverUpload: null },
    $inc: { __v: 1 }, ...(paths.length ? { $addToSet: { cleanupBlobPathnames: { $each: paths } } } : {}),
  });
  await EbookUpload.updateMany({ ebook: id }, { $set: { status: 'CANCELLED', cleanupPending: true } });
  await cleanupEbookPaths(id);
  const uploads = await EbookUpload.find({ ebook: id });
  for (const upload of uploads) await cleanupUpload(upload);
  const pending = await Ebook.findById(id).select('cleanupBlobPathnames');
  const needsCleanup = Boolean(pending?.cleanupBlobPathnames.length) || Boolean(await EbookUpload.exists({ ebook: id, cleanupPending: true }));
  if (!needsCleanup) {
    await EbookUpload.deleteMany({ ebook: id });
    await Ebook.deleteOne({ _id: id, deletedAt: { $ne: null } });
  }
  return { message: needsCleanup ? 'Ebook deleted. Remaining storage cleanup will be retried automatically.' : 'Ebook deleted.', cleanupPending: needsCleanup };
}

async function processBlobCallback({ blob, tokenPayload }) {
  let payload;
  try { payload = JSON.parse(tokenPayload); } catch { throw new EbookError(400, 'Invalid upload callback.', 'INVALID_CALLBACK'); }
  assertId(payload.ebookId); assertId(payload.uploadId);
  const upload = await EbookUpload.findOne({ _id: payload.uploadId, ebook: payload.ebookId });
  if (!upload) return;
  if (payload.pathname !== upload.pathname || blob?.pathname !== upload.pathname) throw new EbookError(400, 'Invalid upload callback.', 'INVALID_CALLBACK');
  try { await finishUpload(payload.ebookId, payload.uploadId); }
  catch (error) {
    // Permanent validation/cancellation failures are acknowledged after recording
    // cleanup. Transient infrastructure failures return 5xx for Blob to retry.
    if (!(error instanceof EbookError) || !['UPLOAD_CANCELLED', 'UPLOAD_EXPIRED', 'INVALID_PDF', 'INVALID_COVER', 'INVALID_BLOB', 'FILE_TOO_LARGE', 'SIZE_MISMATCH', 'INVALID_FILE'].includes(error.code)) throw error;
  }
}

async function runCleanup(limit = 50) {
  const now = new Date();
  const expired = await EbookUpload.find({ status: { $in: ACTIVE_UPLOAD_STATUSES }, expiresAt: { $lt: now } }).limit(limit);
  for (const upload of expired) await cancelUpload(String(upload.ebook), String(upload._id));
  const uploads = await EbookUpload.find({ cleanupPending: true }).sort({ updatedAt: 1 }).limit(limit);
  for (const upload of uploads) await cleanupUpload(upload);
  const ebooks = await Ebook.find({ $or: [{ 'cleanupBlobPathnames.0': { $exists: true } }, { deletedAt: { $ne: null } }] }).limit(limit);
  for (const ebook of ebooks) {
    if (ebook.deletedAt) await deleteEbook(String(ebook._id));
    else await cleanupEbookPaths(ebook._id);
  }
  // Retain cancelled tokens for one day beyond expiry for delayed callbacks. Never
  // remove work with cleanupPending=true. Completed sessions need no binary data.
  await EbookUpload.deleteMany({ status: { $in: ['COMPLETE', 'CANCELLED', 'FAILED'] }, cleanupPending: false,
    expiresAt: { $lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } });
  return { expiredUploads: expired.length, checkedUploads: uploads.length, checkedEbooks: ebooks.length };
}

module.exports = { parseMetadata, parseUpload, assertId, getEbook, listEbooks, createEbook, updateEbook,
  publishEbook, prepareUpload, completeUpload, finishUpload, cancelUpload, deleteEbook,
  processBlobCallback, runCleanup, serializeEbook, cleanupEbookPaths, cleanupUpload };
