const { head, del, issueSignedToken, presignUrl, getDownloadUrl } = require('@vercel/blob');
const { generateClientTokenFromReadWriteToken, handleUpload } = require('@vercel/blob/client');
const { EbookError, getEbookConfig } = require('../config/ebookConfig');

const PATH_PATTERN = /^ebooks\/[a-f0-9]{24}\/(pdf|cover)\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/;
const PDF_TAIL_BYTES = 65536;
const STORAGE_TIMEOUT_MS = 20000;
let signingContext;
let signingPromise;
let signingToken;

function storageToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || !/^vercel_blob_rw_[a-zA-Z0-9]+_/.test(token)) {
    throw new EbookError(503, 'Ebook storage is not configured. Contact an administrator.', 'STORAGE_CONFIGURATION');
  }
  return token;
}

function assertBlobPathname(pathname) {
  if (typeof pathname !== 'string' || !PATH_PATTERN.test(pathname)) {
    throw new EbookError(400, 'Invalid ebook storage path.', 'INVALID_STORAGE_PATH');
  }
}

function assertBlobUrl(urlValue, pathname) {
  assertBlobPathname(pathname);
  const storeId = storageToken().split('_')[3].toLowerCase();
  let url;
  try { url = new URL(urlValue); } catch { throw new EbookError(400, 'The uploaded file could not be verified.', 'INVALID_BLOB'); }
  if (url.protocol !== 'https:' || url.hostname !== `${storeId}.private.blob.vercel-storage.com` ||
      url.port || url.username || url.password || url.search || url.hash || url.pathname !== `/${pathname}`) {
    throw new EbookError(400, 'The uploaded file could not be verified. Use the configured private Blob store.', 'INVALID_BLOB');
  }
  return url.toString();
}

function callbackUrl() {
  const explicit = process.env.EBOOK_UPLOAD_CALLBACK_URL;
  // Preview callbacks must return to the preview database/token environment.
  const host = process.env.VERCEL_ENV === 'production'
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
    : process.env.VERCEL_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!explicit && !host) return undefined;
  const url = new URL(explicit || `https://${host}/api/ebooks/blob-callback`);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new EbookError(503, 'Ebook upload callback configuration is invalid.', 'STORAGE_CONFIGURATION');
  }
  return url.toString();
}

async function createClientUploadToken(upload) {
  assertBlobPathname(upload.pathname);
  const target = callbackUrl();
  return generateClientTokenFromReadWriteToken({
    token: storageToken(),
    pathname: upload.pathname,
    maximumSizeInBytes: upload.size,
    allowedContentTypes: [upload.contentType],
    validUntil: new Date(upload.expiresAt).getTime(),
    allowOverwrite: false,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(target ? { onUploadCompleted: {
      callbackUrl: target,
      tokenPayload: JSON.stringify({ uploadId: String(upload._id), ebookId: String(upload.ebook), pathname: upload.pathname }),
    } } : {}),
  });
}

async function readBoundedRange(url, start, end, totalSize) {
  const requestedSize = end - start + 1;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${storageToken()}`, Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
    redirect: 'error',
    signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
  });
  const fullSmallFile = response.status === 200 && start === 0 && requestedSize === totalSize;
  const contentRange = response.headers.get('content-range');
  if ((!fullSmallFile && (response.status !== 206 || contentRange !== `bytes ${start}-${end}/${totalSize}`)) || !response.body) {
    if (response.body) await response.body.cancel();
    throw new EbookError(503, 'The uploaded file could not be read safely. Retry verification.', 'BLOB_RANGE_UNAVAILABLE');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) !== requestedSize) {
    await response.body.cancel();
    throw new EbookError(400, 'The uploaded file is incomplete.', 'INVALID_FILE');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > requestedSize) {
        throw new EbookError(503, 'The uploaded file could not be read safely. Retry verification.', 'BLOB_RANGE_UNAVAILABLE');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (length !== requestedSize) throw new EbookError(400, 'The uploaded file is incomplete.', 'INVALID_FILE');
  return Buffer.concat(chunks, length);
}

async function validatePdf(url, size) {
  const invalid = () => new EbookError(400, 'The uploaded file is not a valid PDF.', 'INVALID_PDF');
  if (size < 24) throw invalid();
  const header = await readBoundedRange(url, 0, Math.min(1023, size - 1), size);
  if (!/%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(header.toString('latin1'))) throw invalid();
  const tail = size <= header.length ? header : await readBoundedRange(url, Math.max(0, size - PDF_TAIL_BYTES), size - 1, size);
  const trailer = /startxref\s+(\d+)\s+%%EOF[\s\0]*$/.exec(tail.toString('latin1'));
  if (!trailer) throw invalid();
  const xrefOffset = Number(trailer[1]);
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 8 || xrefOffset >= size - 6) throw invalid();
  const xref = await readBoundedRange(url, xrefOffset, Math.min(xrefOffset + 4095, size - 1), size);
  const xrefText = xref.toString('latin1');
  if (!/^xref\s+\d+\s+\d+/.test(xrefText) &&
      !/^\d+\s+\d+\s+obj\b[\s\S]*\/Type\s*\/XRef\b/.test(xrefText)) throw invalid();
}

async function validateCover(url, size, type) {
  const bytes = await readBoundedRange(url, 0, Math.min(31, size - 1), size);
  const valid = type === 'image/jpeg' ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff :
    type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
      type === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new EbookError(400, 'The cover must be a valid JPEG, PNG, or WebP image.', 'INVALID_COVER');
}

async function verifyUpload(upload) {
  const config = getEbookConfig();
  assertBlobPathname(upload.pathname);
  let blob;
  try {
    blob = await head(upload.pathname, { token: storageToken(), abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) });
  } catch (error) {
    if (error?.name === 'BlobNotFoundError' || error?.constructor?.name === 'BlobNotFoundError') {
      throw new EbookError(409, 'The upload has not finished yet. Retry verification once it completes.', 'UPLOAD_NOT_FOUND');
    }
    throw error;
  }
  if (blob.pathname !== upload.pathname || blob.contentType !== upload.contentType) {
    throw new EbookError(400, 'The uploaded file type or storage path does not match the authorized upload.', 'INVALID_BLOB');
  }
  const max = upload.kind === 'pdf' ? config.maxPdfSizeBytes : config.maxCoverSizeBytes;
  if (!Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > max) {
    throw new EbookError(400, upload.kind === 'pdf' ? `Ebook PDF must be ${config.maxPdfSizeLabel} or smaller.` :
      `Cover image must be ${config.maxCoverSizeLabel} or smaller.`, 'FILE_TOO_LARGE');
  }
  if (blob.size !== upload.size) throw new EbookError(400, 'The uploaded file size does not match the selected file.', 'SIZE_MISMATCH');
  const url = assertBlobUrl(blob.url, upload.pathname);
  if (upload.kind === 'pdf') await validatePdf(url, blob.size);
  else await validateCover(url, blob.size, blob.contentType);
  return { url, pathname: blob.pathname, size: blob.size, contentType: blob.contentType };
}

async function deleteBlob(pathname) {
  assertBlobPathname(pathname);
  try { await del(pathname, { token: storageToken(), abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) }); }
  catch (error) {
    if (error?.name !== 'BlobNotFoundError' && error?.constructor?.name !== 'BlobNotFoundError') throw error;
  }
}

async function getSigningContext() {
  const token = storageToken();
  const now = Date.now();
  if (signingContext && signingToken === token && signingContext.validUntil > now + getEbookConfig().readUrlLifetimeMs + 60000) return signingContext;
  if (!signingPromise || signingToken !== token) {
    signingToken = token;
    // Kept only on the server. Each emitted URL has its own pathname signature;
    // neither the read/write token nor clientSigningToken is returned to a reader.
    signingPromise = issueSignedToken({ token, operations: ['get'], validUntil: now + 60 * 60 * 1000,
      abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) })
      .then(context => { signingContext = context; return context; })
      .finally(() => { signingPromise = undefined; });
  }
  return signingPromise;
}

async function signReadUrl(pathname, validUntil) {
  assertBlobPathname(pathname);
  const context = await getSigningContext();
  const { presignedUrl } = await presignUrl(context, { pathname, operation: 'get', access: 'private', validUntil });
  return { url: presignedUrl, downloadUrl: getDownloadUrl(presignedUrl) };
}

async function handleBlobCallback(request, onCompleted) {
  if (request.body?.type !== 'blob.upload-completed') {
    throw new EbookError(400, 'Invalid upload callback.', 'INVALID_CALLBACK');
  }
  return handleUpload({
    token: storageToken(), request, body: request.body,
    onBeforeGenerateToken: async () => { throw new EbookError(403, 'Admin authorization is required.', 'FORBIDDEN'); },
    onUploadCompleted: onCompleted,
  });
}

module.exports = { createClientUploadToken, verifyUpload, deleteBlob, signReadUrl, handleBlobCallback,
  assertBlobPathname, assertBlobUrl, readBoundedRange, validatePdf, validateCover, storageToken };
