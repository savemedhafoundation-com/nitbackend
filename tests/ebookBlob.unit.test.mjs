import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBlobMock, tinyPdf, MAX_PDF_BYTES, TEST_BLOB_TOKEN, TEST_BLOB_ORIGIN } from './helpers/backendHarness.mjs';

const require = createRequire(import.meta.url);
const PDF_PATH = 'ebooks/507f1f77bcf86cd799439011/pdf/7255ea6c-e48b-4278-a854-adc46d8ac381.pdf';
const COVER_PATH = 'ebooks/507f1f77bcf86cd799439011/cover/3c887e07-944a-4277-a60e-8db890b2f662.png';

describe('Blob verification without full-file downloads', () => {
  let storage;
  let service;
  const upload = overrides => ({
    _id: '507f191e810c19729de860ea', ebook: '507f1f77bcf86cd799439011', kind: 'pdf',
    pathname: PDF_PATH, filename: 'ebook.pdf', contentType: 'application/pdf', size: tinyPdf().length,
    expiresAt: new Date(Date.now() + 60_000), ...overrides,
  });

  beforeAll(() => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', TEST_BLOB_TOKEN);
    vi.stubEnv('EBOOK_MAX_SIZE_BYTES', String(MAX_PDF_BYTES));
    storage = installBlobMock();
    service = require('../src/services/ebookBlobService');
  });
  beforeEach(() => { storage.reset(); });
  afterAll(() => { storage?.restore(); vi.unstubAllEnvs(); });

  it('authorizes one generated path, exact file type and declared size, without overwrite', async () => {
    const session = upload();
    const token = await service.createClientUploadToken(session);
    expect(token).toMatch(/^vercel_blob_client_/);
    expect(token).not.toContain(TEST_BLOB_TOKEN);
    expect(storage.client.generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(expect.objectContaining({
      pathname: PDF_PATH, maximumSizeInBytes: session.size, allowedContentTypes: ['application/pdf'],
      allowOverwrite: false, addRandomSuffix: false,
    }));
  });

  it('produces a valid official SDK token with the authenticated completion callback embedded', async () => {
    vi.stubEnv('EBOOK_UPLOAD_CALLBACK_URL', 'https://api.example.test/api/ebooks/blob-callback');
    storage.client.generateClientTokenFromReadWriteToken.mockImplementationOnce(storage.realClient.generateClientTokenFromReadWriteToken);
    const session = upload({ size: MAX_PDF_BYTES });
    const token = await service.createClientUploadToken(session);
    const payload = storage.realClient.getPayloadFromClientToken(token);
    expect(payload).toMatchObject({
      pathname: PDF_PATH,
      maximumSizeInBytes: MAX_PDF_BYTES,
      allowedContentTypes: ['application/pdf'],
      validUntil: session.expiresAt.getTime(),
      allowOverwrite: false,
      onUploadCompleted: { callbackUrl: 'https://api.example.test/api/ebooks/blob-callback' },
    });
    expect(JSON.parse(payload.onUploadCompleted.tokenPayload)).toMatchObject({ uploadId: session._id, ebookId: session.ebook, pathname: PDF_PATH });
    expect(JSON.stringify(payload)).not.toContain(TEST_BLOB_TOKEN);
    expect(storage.fetch).not.toHaveBeenCalled();
  });

  it('verifies a valid PDF through bounded ranges', async () => {
    storage.put(PDF_PATH);
    await expect(service.verifyUpload(upload())).resolves.toMatchObject({ pathname: PDF_PATH, contentType: 'application/pdf' });
    expect(storage.fetch).toHaveBeenCalled();
    for (const [, options] of storage.fetch.mock.calls) {
      expect(new Headers(options.headers).get('range')).toMatch(/^bytes=\d+-\d+$/);
      expect(options.redirect).toBe('error');
    }
  });

  it.each([
    ['preview', 'https://backend-preview.example.test/api/ebooks/blob-callback'],
    ['production', 'https://backend.example.test/api/ebooks/blob-callback'],
  ])('keeps %s callbacks in the correct deployment environment', async (environment, target) => {
    vi.stubEnv('EBOOK_UPLOAD_CALLBACK_URL', '');
    vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('VERCEL_URL', 'backend-preview.example.test');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'backend.example.test');
    await service.createClientUploadToken(upload());
    expect(storage.client.generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(expect.objectContaining({
      onUploadCompleted: expect.objectContaining({ callbackUrl: target }),
    }));
  });

  it('accepts exactly 500 MiB while reading less than 72 KiB', async () => {
    storage.put(PDF_PATH, { size: MAX_PDF_BYTES });
    await expect(service.verifyUpload(upload({ size: MAX_PDF_BYTES }))).resolves.toMatchObject({ size: MAX_PDF_BYTES });
    const transferred = storage.fetch.mock.calls.reduce((total, [, options]) => {
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get('range'));
      return total + Number(end) - Number(start) + 1;
    }, 0);
    expect(transferred).toBeLessThan(72 * 1024);
  });

  it('rejects a stored PDF over 500 MiB even when the client claims a smaller file', async () => {
    storage.put(PDF_PATH, { size: MAX_PDF_BYTES + 1 });
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ message: 'Ebook PDF must be 500 MB or smaller.' });
    expect(storage.fetch).not.toHaveBeenCalled();
  });

  it('rejects a different stored file size', async () => {
    storage.put(PDF_PATH, { size: tinyPdf().length + 10 });
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ code: 'SIZE_MISMATCH' });
    expect(storage.fetch).not.toHaveBeenCalled();
  });

  it('rejects MIME spoofing before downloading any bytes', async () => {
    storage.put(PDF_PATH, { contentType: 'text/html' });
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ code: 'INVALID_BLOB' });
    expect(storage.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unrelated Blob pathname returned by storage', async () => {
    storage.put(PDF_PATH, { metadata: { pathname: COVER_PATH } });
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ code: 'INVALID_BLOB' });
    expect(storage.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'https://untrusted.example/ebook.pdf',
    `${TEST_BLOB_ORIGIN}.attacker.example/${PDF_PATH}`,
    `${TEST_BLOB_ORIGIN}/${PDF_PATH}?redirect=https://untrusted.example`,
    `http://ebooktest.private.blob.vercel-storage.com/${PDF_PATH}`,
    `https://ebooktest.public.blob.vercel-storage.com/${PDF_PATH}`,
    `https://otherstore.private.blob.vercel-storage.com/${PDF_PATH}`,
  ])('does not forward credentials to an untrusted Blob URL (%s)', async url => {
    storage.put(PDF_PATH, { metadata: { url } });
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ code: 'INVALID_BLOB' });
    expect(storage.fetch).not.toHaveBeenCalled();
  });

  it.each([
    Buffer.from('<!doctype html><html>not a PDF</html>'),
    Buffer.from('%PDF-1.7\nthis file is truncated'),
    Buffer.from('%PDF-1.7\ntrailer\nstartxref\n999999999999\n%%EOF\n'),
    Buffer.from('%PDF-1.7\nnot-an-xref\nstartxref\n9\n%%EOF\n'),
  ])('rejects invalid PDF structure instead of trusting its extension', async bytes => {
    storage.put(PDF_PATH, { bytes });
    await expect(service.verifyUpload(upload({ size: bytes.length }))).rejects.toMatchObject({ code: 'INVALID_PDF' });
  });

  it('reports an unfinished upload without accepting arbitrary client results', async () => {
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ code: 'UPLOAD_NOT_FOUND', statusCode: 409 });
  });

  it('fails safely when storage ignores a requested range on a large object', async () => {
    storage.put(PDF_PATH, {
      size: MAX_PDF_BYTES,
      response: () => new Response(tinyPdf(), { status: 200, headers: { 'content-length': String(MAX_PDF_BYTES) } }),
    });
    await expect(service.verifyUpload(upload({ size: MAX_PDF_BYTES }))).rejects.toMatchObject({ code: 'BLOB_RANGE_UNAVAILABLE' });
    expect(storage.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched Content-Range instead of validating unrelated bytes', async () => {
    storage.put(PDF_PATH, {
      response: () => new Response(tinyPdf(), { status: 206, headers: { 'content-range': 'bytes 5-10/500' } }),
    });
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ code: 'BLOB_RANGE_UNAVAILABLE' });
  });

  it('rejects truncated range bodies', async () => {
    const size = tinyPdf().length;
    storage.put(PDF_PATH, {
      response: () => new Response(tinyPdf().subarray(0, 20), { status: 206, headers: { 'content-range': `bytes 0-${size - 1}/${size}` } }),
    });
    await expect(service.verifyUpload(upload())).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });

  it('checks cover magic bytes independently from the claimed MIME type', async () => {
    const bytes = Buffer.from('not a PNG image but with enough bytes');
    storage.put(COVER_PATH, { bytes, contentType: 'image/png' });
    await expect(service.verifyUpload(upload({ kind: 'cover', pathname: COVER_PATH, contentType: 'image/png', size: bytes.length })))
      .rejects.toMatchObject({ code: 'INVALID_COVER' });
  });

  it('accepts a PNG cover using a small header read', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW9kAAAAASUVORK5CYII=', 'base64');
    storage.put(COVER_PATH, { bytes, contentType: 'image/png' });
    await expect(service.verifyUpload(upload({ kind: 'cover', pathname: COVER_PATH, contentType: 'image/png', size: bytes.length })))
      .resolves.toMatchObject({ pathname: COVER_PATH });
    expect(storage.fetch).toHaveBeenCalledTimes(1);
    expect(new Headers(storage.fetch.mock.calls[0][1].headers).get('range')).toBe('bytes=0-31');
  });

  it('emits a GET signed URL and direct download URL without exposing signing material', async () => {
    const validUntil = Date.now() + 60_000;
    const result = await service.signReadUrl(PDF_PATH, validUntil);
    expect(result.url).toContain('vercel-blob-signature=');
    expect(result.downloadUrl).toContain('download=1');
    expect(JSON.stringify(result)).not.toContain(TEST_BLOB_TOKEN);
    expect(JSON.stringify(result)).not.toContain('test-signing-material');
    expect(storage.sdk.presignUrl).toHaveBeenCalledWith(expect.any(Object), {
      pathname: PDF_PATH, operation: 'get', access: 'private', validUntil,
    });
  });

  it('rejects callback requests that try to mint an upload token anonymously', async () => {
    await expect(service.handleBlobCallback({ body: { type: 'blob.generate-client-token' }, headers: {} }, vi.fn()))
      .rejects.toMatchObject({ code: 'INVALID_CALLBACK' });
  });

  it('uses the real SDK to reject forged completion callback signatures', async () => {
    const callback = vi.fn();
    const body = { type: 'blob.upload-completed', payload: { blob: {}, tokenPayload: '{}' } };
    await expect(service.handleBlobCallback({ body, headers: { 'x-vercel-signature': '0'.repeat(64) } }, callback)).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it('accepts a correctly authenticated SDK callback', async () => {
    const callback = vi.fn();
    const body = { type: 'blob.upload-completed', payload: { blob: { pathname: PDF_PATH }, tokenPayload: '{"uploadId":"test"}' } };
    await expect(service.handleBlobCallback({ body, headers: { 'x-vercel-signature': storage.callbackSignature(body) } }, callback))
      .resolves.toMatchObject({ response: 'ok' });
    expect(callback).toHaveBeenCalledWith(body.payload);
  });
});
