import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBackendHarness, tinyPdf, MAX_PDF_BYTES, TEST_BLOB_TOKEN } from './helpers/backendHarness.mjs';

describe('ebook API with MongoDB and mocked Blob storage', () => {
  let harness;
  beforeAll(async () => { harness = await createBackendHarness({ ebooks: true }); });
  beforeEach(async () => { await harness.reset(); });
  afterAll(async () => { await harness?.close(); });

  const admin = (method, path) => request(harness.app)[method](`/api/admin/ebooks${path}`).set('Authorization', harness.adminAuthorization);
  const selectedPdf = overrides => ({ kind: 'pdf', filename: 'Wellness guide.pdf', size: tinyPdf().length, contentType: 'application/pdf', ...overrides });

  async function draft(metadata = {}) {
    const response = await admin('post', '').send({ title: 'Understanding wellness', ...metadata });
    expect(response.status).toBe(201);
    return response.body;
  }

  async function prepare(id, options = {}) {
    const response = await admin('post', `/${id}/uploads`).send(selectedPdf(options));
    expect(response.status).toBe(201);
    return response.body;
  }

  async function ready(metadata = {}) {
    const ebook = await draft(metadata);
    const upload = await prepare(ebook._id);
    harness.storage.put(upload.pathname);
    const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('READY');
    return { ebook: response.body, upload };
  }

  async function published(metadata = {}) {
    const record = await ready(metadata);
    const response = await admin('post', `/${record.ebook._id}/publish`).send({});
    expect(response.status).toBe(200);
    return { ...record, ebook: response.body };
  }

  describe('authorization and metadata', () => {
    it.each([
      ['get', ''], ['get', '/config'], ['post', ''], ['get', '/507f1f77bcf86cd799439011'],
      ['patch', '/507f1f77bcf86cd799439011'], ['delete', '/507f1f77bcf86cd799439011'],
      ['post', '/507f1f77bcf86cd799439011/publish'], ['post', '/507f1f77bcf86cd799439011/unpublish'],
      ['post', '/507f1f77bcf86cd799439011/uploads'],
      ['post', '/507f1f77bcf86cd799439011/uploads/507f191e810c19729de860ea/complete'],
      ['post', '/507f1f77bcf86cd799439011/uploads/507f191e810c19729de860ea/cancel'],
    ])('requires authentication and the admin role for %s %s', async (method, path) => {
      const anonymous = await request(harness.app)[method](`/api/admin/ebooks${path}`).send({});
      expect(anonymous.status).toBe(401);
      const patient = await request(harness.app)[method](`/api/admin/ebooks${path}`)
        .set('Authorization', harness.patientAuthorization).send({});
      expect(patient.status).toBe(403);
      expect(harness.storage.client.generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
    });

    it('returns configured upload limits without any management credential', async () => {
      const response = await admin('get', '/config');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ maxPdfSizeBytes: MAX_PDF_BYTES, maxPdfSizeLabel: '500 MB', access: 'private' });
      expect(JSON.stringify(response.body)).not.toContain(TEST_BLOB_TOKEN);
    });

    it('creates a draft with optional metadata and authenticated ownership', async () => {
      const ebook = await draft({ author: 'NIT Editorial', description: 'A guide to daily wellbeing.', category: 'Wellbeing', tags: ['guide'], publicationDate: '2026-08-01', allowDownload: false });
      expect(ebook).toMatchObject({ status: 'DRAFT', isPublished: false, title: 'Understanding wellness', author: 'NIT Editorial', allowDownload: false });
      const record = await harness.Ebook.findById(ebook._id).lean();
      expect(String(record.createdBy)).toBe(String(harness.admin._id));
      expect(record.pdfSizeBytes).toBe(0);
      expect(record.pdfBlobUrl).toBe('');
      expect(record).not.toHaveProperty('pdfBinary');
    });

    it.each([{ title: '' }, { title: ' ' }, { title: { $ne: null } }, { title: 'a'.repeat(201) }])('rejects invalid titles', async body => {
      const response = await admin('post', '').send(body);
      expect(response.status).toBe(400);
      expect(await harness.Ebook.countDocuments()).toBe(0);
    });

    it.each(['status', 'isPublished', 'createdBy', 'pdfBlobUrl', 'pdfBlobPathname', 'pdfSizeBytes', 'cleanupBlobPathnames'])('rejects direct mutation of %s', async field => {
      const ebook = await draft();
      const response = await admin('patch', `/${ebook._id}`).send({ [field]: 'untrusted-client-value' });
      expect(response.status).toBe(400);
      const record = await harness.Ebook.findById(ebook._id);
      expect(record.status).toBe('DRAFT');
      expect(record.isPublished).toBe(false);
      expect(record.pdfBlobPathname).toBe('');
    });

    it('updates editable metadata without changing publication status', async () => {
      const ebook = await draft();
      const response = await admin('patch', `/${ebook._id}`).send({ title: 'Updated guide', tags: ['care', 'care'], category: 'Lifestyle' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ title: 'Updated guide', tags: ['care'], category: 'Lifestyle', status: 'DRAFT' });
    });

    it('cannot publish a draft that has not received a validated PDF', async () => {
      const ebook = await draft();
      const response = await admin('post', `/${ebook._id}/publish`).send({});
      expect(response.status).toBe(409);
      expect((await harness.Ebook.findById(ebook._id)).isPublished).toBe(false);
    });

    it('does not expose unpublished drafts to readers', async () => {
      const ebook = await draft();
      expect((await request(harness.app).get(`/api/ebooks/${ebook._id}`)).status).toBe(404);
      const response = await request(harness.app).get('/api/ebooks');
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });

    it('uses a safe not-found response for malformed or missing IDs', async () => {
      for (const id of ['invalid', '507f1f77bcf86cd799439011']) {
        const response = await request(harness.app).get(`/api/ebooks/${id}`);
        expect(response.status).toBe(404);
        expect(response.body).not.toHaveProperty('stack');
      }
    });

    it('sanitizes malformed JSON rejected before route-level middleware', async () => {
      const response = await admin('post', '').set('Content-Type', 'application/json')
        .send('{"title":"private-input-marker", broken-json}');
      expect(response.status).toBe(400);
      expect(response.body).not.toHaveProperty('stack');
      expect(JSON.stringify(response.body)).not.toContain('private-input-marker');
      expect(JSON.stringify(response.body)).not.toContain('SyntaxError');
    });

    it('sanitizes request-body limit errors from the global parser', async () => {
      const response = await admin('post', '').send({ title: 'x'.repeat(1024 * 1024) });
      expect(response.status).toBe(413);
      expect(response.body).not.toHaveProperty('stack');
      expect(JSON.stringify(response.body)).not.toContain('PayloadTooLargeError');
    });

    it('does not echo signed URL query values on unmatched ebook routes', async () => {
      const response = await request(harness.app).get('/api/ebooks/missing/path?token=private-query-marker');
      expect(response.status).toBe(404);
      expect(response.body).not.toHaveProperty('stack');
      expect(JSON.stringify(response.body)).not.toContain('private-query-marker');
    });
  });

  describe('upload authorization and completion', () => {
    it('generates an unguessable server path and a scoped direct-upload token', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      expect(upload.pathname).toMatch(new RegExp(`^ebooks/${ebook._id}/pdf/[a-f0-9-]{36}\\.pdf$`));
      expect(upload.pathname).not.toContain('Wellness');
      expect(upload).toMatchObject({ access: 'private' });
      expect(upload.clientToken).toMatch(/^vercel_blob_client_/);
      expect(JSON.stringify(upload)).not.toContain(TEST_BLOB_TOKEN);
      expect((await harness.Ebook.findById(ebook._id)).status).toBe('UPLOADING');
      expect((await harness.EbookUpload.findById(upload.uploadId)).pathname).toBe(upload.pathname);
    });

    it('accepts a declared PDF size of exactly 500 MiB', async () => {
      const ebook = await draft();
      await prepare(ebook._id, { size: MAX_PDF_BYTES });
      expect(harness.storage.client.generateClientTokenFromReadWriteToken).toHaveBeenCalledWith(expect.objectContaining({ maximumSizeInBytes: MAX_PDF_BYTES }));
    });

    it('rejects over-limit files before asking Blob for an upload token', async () => {
      const ebook = await draft();
      const response = await admin('post', `/${ebook._id}/uploads`).send(selectedPdf({ size: MAX_PDF_BYTES + 1 }));
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Ebook PDF must be 500 MB or smaller.');
      expect(harness.storage.client.generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
      expect(await harness.EbookUpload.countDocuments()).toBe(0);
    });

    it.each([
      { size: 0 }, { size: -1 }, { size: 1.5 }, { size: '100' }, { contentType: 'text/html' },
      { filename: 'file.exe' }, { filename: '../file.pdf' }, { filename: 'file.pdf\u0000' },
      { pathname: 'ebooks/client-controlled.pdf' },
    ])('rejects invalid upload requests without starting an upload', async overrides => {
      const ebook = await draft();
      const response = await admin('post', `/${ebook._id}/uploads`).send(selectedPdf(overrides));
      expect(response.status).toBe(400);
      expect(harness.storage.client.generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
    });

    it('marks a validated upload ready and stores only Blob metadata', async () => {
      const { ebook, upload } = await ready();
      expect(ebook.isPublished).toBe(false);
      const stored = await harness.Ebook.findById(ebook._id).lean();
      expect(stored).toMatchObject({ pdfBlobPathname: upload.pathname, pdfSizeBytes: tinyPdf().length, mimeType: 'application/pdf' });
      expect(stored.pdfBlobUrl).not.toContain('vercel-blob-signature');
      expect((await harness.EbookUpload.findById(upload.uploadId)).status).toBe('COMPLETE');
      expect(stored.pendingPdfUpload).toBeNull();
    });

    it('does not trust a submitted completion URL or size', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      harness.storage.put(upload.pathname);
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({
        url: 'https://untrusted.example/injected.pdf', pathname: 'arbitrary/path', size: 1,
      });
      expect(response.status).toBe(200);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.pdfBlobPathname).toBe(upload.pathname);
      expect(stored.pdfSizeBytes).toBe(tinyPdf().length);
    });

    it('is idempotent when browser completion and callback both finalize a file', async () => {
      const { ebook, upload } = await ready();
      harness.storage.sdk.del.mockClear();
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(response.status).toBe(200);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(upload.pathname);
      expect(harness.storage.sdk.del).not.toHaveBeenCalled();
    });

    it('keeps an incomplete upload retryable after a missing Blob', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      const incomplete = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(incomplete.status).toBe(409);
      harness.storage.put(upload.pathname);
      const retry = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(retry.status).toBe(200);
      expect(retry.body.status).toBe('READY');
    });

    it('rejects expired upload configurations and does not publish them', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      harness.storage.put(upload.pathname);
      await harness.EbookUpload.updateOne({ _id: upload.uploadId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(response.status).toBe(409);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.pdfBlobPathname).toBe('');
      expect(stored.isPublished).toBe(false);
      expect(harness.storage.objects.has(upload.pathname)).toBe(false);
    });

    it('rejects malformed PDF data and records failed validation', async () => {
      const ebook = await draft();
      const bytes = Buffer.from('This is text, not a PDF file.');
      const upload = await prepare(ebook._id, { size: bytes.length });
      harness.storage.put(upload.pathname, { bytes });
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(response.status).toBe(400);
      expect((await harness.EbookUpload.findById(upload.uploadId)).status).toBe('FAILED');
      expect((await harness.Ebook.findById(ebook._id)).status).toBe('FAILED');
      expect(harness.storage.objects.has(upload.pathname)).toBe(false);
    });

    it('does not leak raw Blob errors or secrets', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      harness.storage.sdk.head.mockRejectedValueOnce(new Error(`Unexpected storage error with ${TEST_BLOB_TOKEN}`));
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(response.body)).not.toContain(TEST_BLOB_TOKEN);
      expect(response.body).not.toHaveProperty('stack');
      expect(JSON.stringify(response.body)).not.toContain('Unexpected storage error');
    });

    it('does not let an upload from another ebook modify this ebook', async () => {
      const first = await draft();
      const second = await draft({ title: 'Other book' });
      const upload = await prepare(first._id);
      harness.storage.put(upload.pathname);
      const response = await admin('post', `/${second._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(response.status).toBe(404);
      expect((await harness.Ebook.findById(second._id)).pdfBlobPathname).toBe('');
    });

    it('clears an unsuccessful authorization attempt without losing the previous PDF', async () => {
      const { ebook, upload: original } = await ready();
      harness.storage.client.generateClientTokenFromReadWriteToken.mockRejectedValueOnce(new Error('Transient token generation failure'));
      const response = await admin('post', `/${ebook._id}/uploads`).send(selectedPdf());
      expect(response.status).toBeGreaterThanOrEqual(500);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.pdfBlobPathname).toBe(original.pathname);
      expect(stored.pendingPdfUpload).toBeNull();
      expect(harness.storage.objects.has(original.pathname)).toBe(true);
      expect(await harness.EbookUpload.countDocuments({ ebook: ebook._id, status: 'FAILED' })).toBe(1);
    });
  });

  describe('publication, reading, search, and pagination', () => {
    it('publishes and unpublishes a validated ebook', async () => {
      const { ebook } = await published();
      expect(ebook.status).toBe('PUBLISHED');
      const reader = await request(harness.app).get(`/api/ebooks/${ebook._id}`);
      expect(reader.status).toBe(200);
      expect(reader.body.pdfBlobUrl).toContain('vercel-blob-signature');
      expect(reader.body.pdfDownloadUrl).toContain('download=1');
      expect(reader.body).not.toHaveProperty('pdfBlobPathname');
      expect(reader.body).not.toHaveProperty('createdBy');
      const unpublished = await admin('post', `/${ebook._id}/unpublish`).send({});
      expect(unpublished.status).toBe(200);
      expect(unpublished.body.status).toBe('READY');
      expect((await request(harness.app).get(`/api/ebooks/${ebook._id}`)).status).toBe(404);
    });

    it('omits downloads when disabled while retaining PDF reading', async () => {
      const { ebook } = await published({ allowDownload: false });
      const response = await request(harness.app).get(`/api/ebooks/${ebook._id}`);
      expect(response.status).toBe(200);
      expect(response.body.pdfBlobUrl).toContain('vercel-blob-signature');
      expect(response.body).not.toHaveProperty('pdfDownloadUrl');
    });

    it('lists only published books and omits PDF URLs from library cards', async () => {
      await published({ title: 'Published guide' });
      await draft({ title: 'Unpublished guide' });
      const response = await request(harness.app).get('/api/ebooks');
      expect(response.status).toBe(200);
      expect(response.body.pagination.total).toBe(1);
      expect(response.body.data[0].title).toBe('Published guide');
      expect(response.body.data[0]).not.toHaveProperty('pdfBlobUrl');
      expect(response.body.data[0]).not.toHaveProperty('pdfBlobPathname');
      const adminList = await admin('get', '');
      expect(adminList.body.pagination.total).toBe(2);
    });

    it('supports literal search, category filtering, and stable pagination', async () => {
      await published({ title: 'Daily [care]', category: 'Wellbeing' });
      await published({ title: 'Movement guide', category: 'Lifestyle' });
      await published({ title: 'Nutrition guide', category: 'Wellbeing' });
      const search = await request(harness.app).get('/api/ebooks').query({ q: '[care]' });
      expect(search.status).toBe(200);
      expect(search.body.pagination.total).toBe(1);
      expect(search.body.data[0].title).toBe('Daily [care]');
      const category = await request(harness.app).get('/api/ebooks').query({ category: 'Wellbeing', limit: 1, page: 2 });
      expect(category.status).toBe(200);
      expect(category.body.pagination).toMatchObject({ page: 2, limit: 1, total: 2, pages: 2 });
      expect(category.body.data).toHaveLength(1);
      expect(category.body.categories).toEqual(['Lifestyle', 'Wellbeing']);
      const regex = await request(harness.app).get('/api/ebooks').query({ q: '.*' });
      expect(regex.body.data).toEqual([]);
    });

    it.each([{ page: 0 }, { page: -1 }, { limit: 500 }, { limit: 'invalid' }])('rejects invalid pagination', async query => {
      expect((await request(harness.app).get('/api/ebooks').query(query)).status).toBe(400);
    });

    it('does not return a newly signed PDF if unpublication occurs during signing', async () => {
      const { ebook } = await published();
      harness.storage.sdk.presignUrl.mockImplementationOnce(async () => {
        await harness.Ebook.updateOne({ _id: ebook._id }, { $set: { isPublished: false, status: 'READY' } });
        return { presignedUrl: ebook.pdfBlobUrl };
      });
      const response = await request(harness.app).get(`/api/ebooks/${ebook._id}`);
      await expect(harness.storage.sdk.presignUrl.mock.results.at(-1).value).resolves.toHaveProperty('presignedUrl');
      expect(response.status).toBe(404);
      expect(response.body).not.toHaveProperty('pdfBlobUrl');
    });
  });

  describe('replacement, cancellation, and cleanup', () => {
    it('keeps the current PDF during replacement and deletes it only after metadata switches', async () => {
      const { ebook, upload: old } = await published();
      const replacement = await prepare(ebook._id, { filename: 'Replacement.pdf' });
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(old.pathname);
      expect(harness.storage.objects.has(old.pathname)).toBe(true);
      expect((await request(harness.app).get(`/api/ebooks/${ebook._id}`)).status).toBe(200);
      harness.storage.put(replacement.pathname);
      harness.storage.sdk.del.mockImplementationOnce(async pathname => {
        expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(replacement.pathname);
        harness.storage.objects.delete(pathname);
      });
      const response = await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({});
      await expect(harness.storage.sdk.del.mock.results.at(-1).value).resolves.toBeUndefined();
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('PUBLISHED');
      expect(harness.storage.objects.has(replacement.pathname)).toBe(true);
      expect(harness.storage.objects.has(old.pathname)).toBe(false);
    });

    it('preserves the existing PDF when the replacement is invalid', async () => {
      const { ebook, upload: old } = await ready();
      const bytes = Buffer.from('An invalid replacement PDF cannot destroy the old book.');
      const replacement = await prepare(ebook._id, { size: bytes.length });
      harness.storage.put(replacement.pathname, { bytes });
      const response = await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({});
      expect(response.status).toBe(400);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(old.pathname);
      expect(harness.storage.objects.has(old.pathname)).toBe(true);
    });

    it('cancels an uploaded replacement and can start a fresh retry', async () => {
      const { ebook, upload: old } = await ready();
      const replacement = await prepare(ebook._id);
      harness.storage.put(replacement.pathname);
      const cancelled = await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/cancel`).send({});
      expect(cancelled.status).toBe(200);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(old.pathname);
      expect(harness.storage.objects.has(old.pathname)).toBe(true);
      expect(harness.storage.objects.has(replacement.pathname)).toBe(false);
      expect((await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({})).status).toBe(409);
      const retry = await prepare(ebook._id);
      expect(retry.pathname).not.toBe(replacement.pathname);
    });

    it('clears the cancelled upload pointer even when metadata changes concurrently', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      const update = harness.Ebook.updateOne.bind(harness.Ebook);
      let injected = false;
      vi.spyOn(harness.Ebook, 'updateOne').mockImplementation((filter, changes, ...args) => {
        if (!injected && filter.pendingPdfUpload && changes.$set?.pendingPdfUpload === null) {
          injected = true;
          return (async () => {
            await update({ _id: ebook._id }, { $set: { title: 'Concurrent metadata update' }, $inc: { __v: 1 } });
            return update(filter, changes, ...args);
          })();
        }
        return update(filter, changes, ...args);
      });
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/cancel`).send({});
      expect(response.status).toBe(200);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.pendingPdfUpload).toBeNull();
      expect(stored.title).toBe('Concurrent metadata update');
    });

    it('does not let a late superseded upload replace the newest selection', async () => {
      const ebook = await draft();
      const old = await prepare(ebook._id);
      const newest = await prepare(ebook._id);
      harness.storage.put(old.pathname);
      const stale = await admin('post', `/${ebook._id}/uploads/${old.uploadId}/complete`).send({});
      expect(stale.status).toBe(409);
      expect(String((await harness.Ebook.findById(ebook._id)).pendingPdfUpload)).toBe(newest.uploadId);
      expect(harness.storage.objects.has(old.pathname)).toBe(false);
      harness.storage.put(newest.pathname);
      expect((await admin('post', `/${ebook._id}/uploads/${newest.uploadId}/complete`).send({})).status).toBe(200);
    });

    it('retains failed deletion work without losing the successfully replaced PDF', async () => {
      const { ebook, upload: old } = await ready();
      const replacement = await prepare(ebook._id);
      harness.storage.put(replacement.pathname);
      harness.storage.sdk.del.mockRejectedValueOnce(new Error('Temporary storage deletion failure'));
      const response = await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({});
      expect(response.status).toBe(200);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.pdfBlobPathname).toBe(replacement.pathname);
      expect(stored.cleanupBlobPathnames).toContain(old.pathname);
      expect(response.body.cleanupPending).toBe(true);
    });

    it('keeps the previous PDF if the database cannot commit replacement metadata', async () => {
      const { ebook, upload: old } = await ready();
      const replacement = await prepare(ebook._id);
      harness.storage.put(replacement.pathname);
      const update = harness.Ebook.findOneAndUpdate.bind(harness.Ebook);
      vi.spyOn(harness.Ebook, 'findOneAndUpdate').mockImplementation((filter, changes, ...args) => {
        if (changes.$set?.pdfBlobPathname === replacement.pathname) return Promise.reject(new Error('Simulated database outage'));
        return update(filter, changes, ...args);
      });
      const response = await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({});
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(old.pathname);
      expect(harness.storage.objects.has(old.pathname)).toBe(true);
      expect(harness.storage.objects.has(replacement.pathname)).toBe(true);
      expect(response.body.message).not.toContain('Simulated database outage');
    });

    it('deletes PDF, cover and pending uploads, then hides the ebook immediately', async () => {
      const { ebook, upload: pdf } = await published();
      const coverBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW9kAAAAASUVORK5CYII=', 'base64');
      const cover = await prepare(ebook._id, { kind: 'cover', filename: 'Cover.png', contentType: 'image/png', size: coverBytes.length });
      harness.storage.put(cover.pathname, { bytes: coverBytes, contentType: 'image/png' });
      expect((await admin('post', `/${ebook._id}/uploads/${cover.uploadId}/complete`).send({})).status).toBe(200);
      const pending = await prepare(ebook._id);
      harness.storage.put(pending.pathname);
      const response = await admin('delete', `/${ebook._id}`);
      expect(response.status).toBe(200);
      expect((await request(harness.app).get(`/api/ebooks/${ebook._id}`)).status).toBe(404);
      for (const upload of [pdf, cover, pending]) expect(harness.storage.objects.has(upload.pathname)).toBe(false);
      const sessions = await harness.EbookUpload.find({ ebook: ebook._id });
      expect(sessions.every(session => session.status === 'CANCELLED')).toBe(true);
      expect((await admin('post', `/${ebook._id}/publish`).send({})).status).toBe(404);
    });

    it('does not erase an active PDF if cancel arrives after completion', async () => {
      const { ebook, upload } = await ready();
      harness.storage.sdk.del.mockClear();
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/cancel`).send({});
      expect(response.status).toBe(200);
      expect(response.body.alreadyComplete).toBe(true);
      expect(harness.storage.objects.has(upload.pathname)).toBe(true);
      expect(harness.storage.sdk.del).not.toHaveBeenCalled();
    });

    it('does not attach a replacement cancelled after validation but before its database commit', async () => {
      const { ebook, upload: original } = await ready();
      const replacement = await prepare(ebook._id);
      harness.storage.put(replacement.pathname);
      const update = harness.Ebook.findOneAndUpdate.bind(harness.Ebook);
      let raced = false;
      vi.spyOn(harness.Ebook, 'findOneAndUpdate').mockImplementation((filter, changes, ...args) => {
        if (!raced && changes.$set?.pdfBlobPathname === replacement.pathname) {
          raced = true;
          return (async () => {
            expect((await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/cancel`).send({})).status).toBe(200);
            return update(filter, changes, ...args);
          })();
        }
        return update(filter, changes, ...args);
      });
      const response = await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({});
      expect(response.status).toBe(409);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(original.pathname);
      expect(harness.storage.objects.has(original.pathname)).toBe(true);
      expect(harness.storage.objects.has(replacement.pathname)).toBe(false);
    });

    it('does not attach a PDF after deletion wins the final database commit race', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      harness.storage.put(upload.pathname);
      const update = harness.Ebook.findOneAndUpdate.bind(harness.Ebook);
      let raced = false;
      vi.spyOn(harness.Ebook, 'findOneAndUpdate').mockImplementation((filter, changes, ...args) => {
        if (!raced && changes.$set?.pdfBlobPathname === upload.pathname) {
          raced = true;
          return (async () => {
            expect((await admin('delete', `/${ebook._id}`)).status).toBe(200);
            return update(filter, changes, ...args);
          })();
        }
        return update(filter, changes, ...args);
      });
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(response.status).toBe(409);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.pdfBlobPathname).toBe('');
      expect(stored.deletedAt).not.toBeNull();
      expect(harness.storage.objects.has(upload.pathname)).toBe(false);
    });

    it('preserves an unpublish action that races PDF replacement completion', async () => {
      const { ebook } = await published();
      const replacement = await prepare(ebook._id);
      harness.storage.put(replacement.pathname);
      const update = harness.Ebook.findOneAndUpdate.bind(harness.Ebook);
      let raced = false;
      vi.spyOn(harness.Ebook, 'findOneAndUpdate').mockImplementation((filter, changes, ...args) => {
        if (!raced && changes.$set?.pdfBlobPathname === replacement.pathname) {
          raced = true;
          return (async () => {
            expect((await admin('post', `/${ebook._id}/unpublish`).send({})).status).toBe(200);
            return update(filter, changes, ...args);
          })();
        }
        return update(filter, changes, ...args);
      });
      const response = await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({});
      expect(response.status).toBe(200);
      expect(response.body.isPublished).toBe(false);
      expect(response.body.status).toBe('READY');
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(replacement.pathname);
      expect((await request(harness.app).get(`/api/ebooks/${ebook._id}`)).status).toBe(404);
    });
  });

  describe('signed callbacks and cleanup recovery', () => {
    const callbackBody = (ebookId, upload, blob) => ({
      type: 'blob.upload-completed',
      payload: { blob, tokenPayload: JSON.stringify({ ebookId, uploadId: upload.uploadId, pathname: upload.pathname }) },
    });
    const sendCallback = body => request(harness.app).post('/api/ebooks/blob-callback')
      .set('x-vercel-signature', harness.storage.callbackSignature(body)).send(body);
    const cleanup = () => request(harness.app).get('/api/internal/ebooks/cleanup')
      .set('Authorization', `Bearer ${process.env.CRON_SECRET}`);

    it('rejects forged callbacks before finalizing any upload', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      const blob = harness.storage.put(upload.pathname);
      const response = await request(harness.app).post('/api/ebooks/blob-callback')
        .set('x-vercel-signature', '0'.repeat(64)).send(callbackBody(ebook._id, upload, blob));
      expect(response.status).toBe(403);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe('');
      expect(harness.storage.sdk.head).not.toHaveBeenCalled();
    });

    it('finalizes a signed callback when the browser closes after uploading', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      const blob = harness.storage.put(upload.pathname);
      const body = callbackBody(ebook._id, upload, blob);
      expect((await sendCallback(body)).status).toBe(200);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.status).toBe('READY');
      expect(stored.pdfBlobPathname).toBe(upload.pathname);
      expect((await sendCallback(body)).status).toBe(200);
      expect(harness.storage.objects.has(upload.pathname)).toBe(true);
    });

    it('does not trust a callback pathname that differs from the server session', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      const blob = harness.storage.put(upload.pathname);
      const response = await sendCallback(callbackBody(ebook._id, upload, { ...blob, pathname: 'arbitrary/client-path.pdf' }));
      expect(response.status).toBe(400);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe('');
    });

    it('removes an object recreated by a late multipart completion after cancellation', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      expect((await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/cancel`).send({})).status).toBe(200);
      // Cancellation cannot revoke bytes already in flight to Blob. The authenticated callback cleans them.
      const blob = harness.storage.put(upload.pathname);
      expect((await sendCallback(callbackBody(ebook._id, upload, blob))).status).toBe(200);
      expect(harness.storage.objects.has(upload.pathname)).toBe(false);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe('');
      expect((await harness.EbookUpload.findById(upload.uploadId)).cleanupPending).toBe(true);
    });

    it('requires the cleanup secret even for an authenticated admin', async () => {
      const anonymous = await request(harness.app).get('/api/internal/ebooks/cleanup');
      const ordinaryAdmin = await request(harness.app).get('/api/internal/ebooks/cleanup')
        .set('Authorization', harness.adminAuthorization);
      expect(anonymous.status).toBe(401);
      expect(ordinaryAdmin.status).toBe(401);
      expect(harness.storage.sdk.del).not.toHaveBeenCalled();
    });

    it('retries the durable cleanup outbox after a failed old-PDF deletion', async () => {
      const { ebook, upload: old } = await ready();
      const replacement = await prepare(ebook._id);
      harness.storage.put(replacement.pathname);
      harness.storage.sdk.del.mockRejectedValueOnce(new Error('Transient storage deletion error'));
      expect((await admin('post', `/${ebook._id}/uploads/${replacement.uploadId}/complete`).send({})).status).toBe(200);
      expect((await harness.Ebook.findById(ebook._id)).cleanupBlobPathnames).toContain(old.pathname);
      expect((await cleanup()).status).toBe(200);
      expect((await harness.Ebook.findById(ebook._id)).cleanupBlobPathnames).toEqual([]);
      expect(harness.storage.objects.has(old.pathname)).toBe(false);
      expect(harness.storage.objects.has(replacement.pathname)).toBe(true);
    });

    it('cancels expired uploads, deletes their Blobs, and restores an empty draft', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      harness.storage.put(upload.pathname);
      await harness.EbookUpload.updateOne({ _id: upload.uploadId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const response = await cleanup();
      expect(response.status).toBe(200);
      expect(response.body.expiredUploads).toBe(1);
      const stored = await harness.Ebook.findById(ebook._id);
      expect(stored.status).toBe('DRAFT');
      expect(stored.pendingPdfUpload).toBeNull();
      expect(harness.storage.objects.has(upload.pathname)).toBe(false);
    });

    it('removes deleted ebook and upload metadata after scoped tokens have expired', async () => {
      const { ebook, upload } = await ready();
      expect((await admin('delete', `/${ebook._id}`)).status).toBe(200);
      expect(await harness.Ebook.findById(ebook._id)).not.toBeNull();
      await harness.EbookUpload.updateMany({ ebook: ebook._id }, { $set: { expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
      expect((await cleanup()).status).toBe(200);
      expect(await harness.Ebook.findById(ebook._id)).toBeNull();
      expect(await harness.EbookUpload.countDocuments({ ebook: ebook._id })).toBe(0);
      expect(harness.storage.objects.has(upload.pathname)).toBe(false);
    });

    it('cannot republish or recreate a deleted ebook through a late completion callback', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      expect((await admin('delete', `/${ebook._id}`)).status).toBe(200);
      const blob = harness.storage.put(upload.pathname);
      expect((await sendCallback(callbackBody(ebook._id, upload, blob))).status).toBe(200);
      expect((await request(harness.app).get(`/api/ebooks/${ebook._id}`)).status).toBe(404);
      expect(harness.storage.objects.has(upload.pathname)).toBe(false);
    });

    it('reconciles upload status after the PDF attaches but the final session update fails', async () => {
      const ebook = await draft();
      const upload = await prepare(ebook._id);
      harness.storage.put(upload.pathname);
      const update = harness.EbookUpload.updateOne.bind(harness.EbookUpload);
      let failed = false;
      vi.spyOn(harness.EbookUpload, 'updateOne').mockImplementation((filter, changes, ...args) => {
        if (!failed && changes.$set?.status === 'COMPLETE') {
          failed = true;
          return Promise.reject(new Error('Session update failed after asset commit'));
        }
        return update(filter, changes, ...args);
      });
      const response = await admin('post', `/${ebook._id}/uploads/${upload.uploadId}/complete`).send({});
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(upload.pathname);
      await harness.EbookUpload.updateOne({ _id: upload.uploadId }, { $set: { expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
      expect((await cleanup()).status).toBe(200);
      const unresolved = await harness.EbookUpload.countDocuments({ _id: upload.uploadId, status: { $in: ['UPLOADING', 'PROCESSING'] } });
      expect(unresolved).toBe(0);
      expect((await harness.Ebook.findById(ebook._id)).pdfBlobPathname).toBe(upload.pathname);
      expect(harness.storage.objects.has(upload.pathname)).toBe(true);
    });

    it('cleans an abandoned session if draft attachment fails before a token is returned', async () => {
      const ebook = await draft();
      vi.spyOn(harness.Ebook, 'findOneAndUpdate').mockRejectedValueOnce(new Error('Database update failed before upload authorization'));
      const response = await admin('post', `/${ebook._id}/uploads`).send(selectedPdf());
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(harness.storage.client.generateClientTokenFromReadWriteToken).not.toHaveBeenCalled();
      expect((await harness.Ebook.findById(ebook._id)).status).toBe('DRAFT');
      await harness.EbookUpload.updateMany({ ebook: ebook._id }, { $set: { expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
      expect((await cleanup()).status).toBe(200);
      expect(await harness.EbookUpload.countDocuments({ ebook: ebook._id })).toBe(0);
      expect((await harness.Ebook.findById(ebook._id)).pendingPdfUpload).toBeNull();
    });
  });
});
