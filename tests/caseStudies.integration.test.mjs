import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createBackendHarness } from './helpers/backendHarness.mjs';
const require = createRequire(import.meta.url);

describe('case-study publication and administration boundary', () => {
  let harness;
  let CaseStudy;
  beforeAll(async () => {
    harness = await createBackendHarness({ caseStudies: true });
    CaseStudy = require('../src/models/CaseStudy');
  });
  beforeEach(async () => { await harness.reset(); });
  afterAll(async () => { await harness?.close(); });

  it('does not disclose drafts through public list, count, filters, search, detail or HEAD', async () => {
    const draft = await CaseStudy.create({ title: 'Private draft', status: 'draft' });
    const published = await CaseStudy.create({ title: 'Public result', status: 'published' });
    for (const query of ['', '?status=draft', '?status[$ne]=published', '?status=published&status=draft']) {
      const response = await request(harness.app).get(`/api/case-studies${query}`);
      expect(response.status).toBe(200);
      expect(response.body.data.map(item => item._id)).toEqual([String(published._id)]);
      expect(response.body.pagination.total).toBe(1);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    const search = await request(harness.app).get('/api/case-studies?q=Private');
    expect(search.body.pagination.total).toBe(0);
    expect((await request(harness.app).get(`/api/case-studies/${draft._id}`)).status).toBe(404);
    expect((await request(harness.app).head(`/api/case-studies/${draft._id}`)).status).toBe(404);
    expect((await request(harness.app).get('/api/case-studies/not-an-id')).status).toBe(404);
    expect((await request(harness.app).get(`/api/case-studies/${published._id}`)).status).toBe(200);
  });

  it('rejects anonymous and patient administration on canonical and legacy routes', async () => {
    const draft = await CaseStudy.create({ title: 'Keep this draft', status: 'draft' });
    for (const prefix of ['/api/case-studies', '/api/admin/case-studies']) {
      for (const [method, path] of [['post', prefix], ['put', `${prefix}/${draft._id}`], ['delete', `${prefix}/${draft._id}`]]) {
        expect((await request(harness.app)[method](path).send({ title: 'Unauthorized' })).status).toBe(401);
        expect((await request(harness.app)[method](path).set('Authorization', harness.patientAuthorization).send({ title: 'Unauthorized' })).status).toBe(403);
      }
    }
    for (const path of ['/api/admin/case-studies', `/api/admin/case-studies/${draft._id}`]) {
      expect((await request(harness.app).get(path)).status).toBe(401);
      expect((await request(harness.app).get(path).set('Authorization', harness.patientAuthorization)).status).toBe(403);
    }
    for (const prefix of ['/api/case-studies', '/api/admin/case-studies']) {
      const multipart = await request(harness.app).post(prefix).attach('resultImages', Buffer.from('invalid'), { filename: 'image.png', contentType: 'image/png' });
      expect(multipart.status).toBe(401);
    }
    expect(await CaseStudy.countDocuments()).toBe(1);
    expect((await CaseStudy.findById(draft._id)).title).toBe('Keep this draft');
  });

  it('preserves admin draft CRUD and publish/unpublish while public visibility follows database status', async () => {
    const create = await request(harness.app).post('/api/admin/case-studies').set('Authorization', harness.adminAuthorization)
      .send({ title: '<p>New <strong>case</strong></p>', methodology: { content: '<p>Method</p>', tables: [{ headers: ['Date'], rows: [['2026-10-23']] }] } });
    expect(create.status).toBe(201);
    const id = create.body._id;
    const adminList = await request(harness.app).get('/api/admin/case-studies?status=draft').set('Authorization', harness.adminAuthorization);
    expect(adminList.body.data.map(item => item._id)).toEqual([id]);
    expect((await request(harness.app).get(`/api/admin/case-studies/${id}`).set('Authorization', harness.adminAuthorization)).status).toBe(200);
    const publish = await request(harness.app).put(`/api/admin/case-studies/${id}`).set('Authorization', harness.adminAuthorization).send({ status: 'published' });
    expect(publish.status).toBe(200);
    expect(publish.body.methodology.tables[0].rows).toEqual([['2026-10-23']]);
    expect((await request(harness.app).get(`/api/case-studies/${id}`)).status).toBe(200);
    expect((await request(harness.app).put(`/api/case-studies/${id}`).set('Authorization', harness.adminAuthorization).send({ status: 'draft' })).status).toBe(200);
    expect((await request(harness.app).get(`/api/case-studies/${id}`)).status).toBe(404);
    expect((await request(harness.app).delete(`/api/admin/case-studies/${id}`).set('Authorization', harness.adminAuthorization)).status).toBe(200);
    const events = await require('../src/models/AuditEvent').find().lean();
    expect(events.map(event => event.action)).toEqual(['case-study.create.requested', 'case-study.update.requested', 'case-study.update.requested', 'case-study.delete.requested']);
    expect(JSON.stringify(events)).not.toContain('New');
  });

  it('sanitizes new and legacy rich content while preserving safe formatting', async () => {
    const payload = { title: '<p>Safe <strong style="font-family: Arial; color: rgb(255, 0, 0); background-color: #ffff00; background-image: url(https://evil.test/track); position: fixed">title</strong><script>alert(1)</script></p>', status: 'published',
      result: { content: '<p onclick="alert(1)">Result <a href="jav&#97;script:alert(1)">bad</a><a href="https://example.test">good</a></p><svg onload="alert(1)"></svg>' } };
    const create = await request(harness.app).post('/api/admin/case-studies').set('Authorization', harness.adminAuthorization).send(payload);
    expect(create.status).toBe(201);
    const saved = await CaseStudy.findById(create.body._id);
    expect(saved.title).toContain('font-family:Arial');
    expect(saved.title).toContain('color:rgb(255, 0, 0)');
    expect(saved.title).toContain('background-color:#ffff00');
    expect(saved.title).not.toMatch(/background-image|evil.test|position/);
    expect(saved.title).not.toContain('<script');
    expect(saved.result.content).not.toMatch(/onclick|javascript|<svg/);
    await CaseStudy.collection.updateOne({ _id: saved._id }, { $set: { abstract: '<img src=x onerror=alert(1)><p>Legacy text</p>', privatePatientLink: 'PRIVATE-PATIENT' } });
    for (const path of [`/api/case-studies/${saved._id}`, '/api/case-studies']) {
      const response = await request(harness.app).get(path);
      expect(JSON.stringify(response.body)).not.toMatch(/onerror|PRIVATE-PATIENT/);
      expect(JSON.stringify(response.body)).toContain('Legacy text');
    }
  });

  it('rejects admin access immediately after role removal and after server logout', async () => {
    await harness.User.updateOne({ _id: harness.admin._id }, { $set: { role: 'patient' } });
    expect((await request(harness.app).get('/api/admin/case-studies').set('Authorization', harness.adminAuthorization)).status).toBe(403);
    await harness.User.updateOne({ _id: harness.admin._id }, { $set: { role: 'admin' } });
    expect((await request(harness.app).post('/api/auth/logout').set('Authorization', harness.adminAuthorization)).status).toBe(200);
    expect((await request(harness.app).get('/api/admin/case-studies').set('Authorization', harness.adminAuthorization)).status).toBe(401);
  });

  it('protects blog and category writes without blocking public reading', async () => {
    for (const [method, path] of [['post', '/api/blogs'], ['put', '/api/blogs/507f1f77bcf86cd799439011'], ['delete', '/api/blogs/507f1f77bcf86cd799439011'], ['post', '/api/blogs/categories'], ['post', '/api/blogs/categories/507f1f77bcf86cd799439011/subcategories']]) {
      expect((await request(harness.app)[method](path).send({})).status).toBe(401);
      expect((await request(harness.app)[method](path).set('Authorization', harness.patientAuthorization).send({})).status).toBe(403);
    }
    expect((await request(harness.app).get('/api/blogs/categories')).status).toBe(200);
  });

  it('classifies legacy missing/null sections as disease-specific without changing stored records on reads', async () => {
    const mongoose = require('mongoose');
    const missingId = new mongoose.Types.ObjectId();
    const nullId = new mongoose.Types.ObjectId();
    const draftId = new mongoose.Types.ObjectId();
    await CaseStudy.collection.insertMany([
      { _id: missingId, title: 'Legacy missing', status: 'published' },
      { _id: nullId, title: 'Legacy null', status: 'published', section: null },
      { _id: draftId, title: 'Private legacy', status: 'draft' },
    ]);
    const disease = await CaseStudy.create({ title: 'New disease', status: 'published' });
    const nutraceutical = await CaseStudy.create({ title: 'New intervention', status: 'published', section: 'nutraceutical-intervention' });

    const diseaseList = await request(harness.app).get('/api/case-studies?section=disease-specific');
    expect(diseaseList.status).toBe(200);
    expect(diseaseList.body.pagination.total).toBe(3);
    expect(new Set(diseaseList.body.data.map(item => item._id))).toEqual(new Set([String(missingId), String(nullId), String(disease._id)]));
    expect(diseaseList.body.data.every(item => item.section === 'disease-specific')).toBe(true);
    const interventionList = await request(harness.app).get('/api/case-studies?section=nutraceutical-intervention');
    expect(interventionList.body.data.map(item => item._id)).toEqual([String(nutraceutical._id)]);
    expect(interventionList.body.pagination.total).toBe(1);
    expect((await request(harness.app).get('/api/case-studies')).body.pagination.total).toBe(4);
    const adminList = await request(harness.app).get('/api/admin/case-studies?section=disease-specific').set('Authorization', harness.adminAuthorization);
    expect(adminList.body.pagination.total).toBe(4);
    expect(adminList.body.data.every(item => item.section === 'disease-specific')).toBe(true);
    expect((await request(harness.app).get(`/api/case-studies/${nullId}`)).body.section).toBe('disease-specific');
    expect((await request(harness.app).get(`/api/case-studies/${draftId}`)).status).toBe(404);
    expect((await CaseStudy.collection.findOne({ _id: missingId })).section).toBeUndefined();
    expect((await CaseStudy.collection.findOne({ _id: nullId })).section).toBeNull();

    const legacyEdit = await request(harness.app).put(`/api/admin/case-studies/${nullId}`).set('Authorization', harness.adminAuthorization).send({ title: 'Edited legacy' });
    expect(legacyEdit.status).toBe(200);
    expect(legacyEdit.body.section).toBe('disease-specific');
  });

  it('creates, edits and moves section classifications without losing study content or publication rules', async () => {
    const defaultCreate = await request(harness.app).post('/api/admin/case-studies').set('Authorization', harness.adminAuthorization).send({ title: 'Default classification' });
    expect(defaultCreate.status).toBe(201);
    expect(defaultCreate.body.section).toBe('disease-specific');
    const created = await request(harness.app).post('/api/admin/case-studies').set('Authorization', harness.adminAuthorization).send({
      title: 'Intervention research', section: 'nutraceutical-intervention', status: 'published',
      methodology: { content: '<p>Observed method</p>', tables: [{ headers: ['Day'], rows: [['1']] }] },
    });
    expect(created.status).toBe(201);
    expect(created.body.section).toBe('nutraceutical-intervention');
    const id = created.body._id;
    expect((await request(harness.app).get(`/api/case-studies/${id}`)).body.section).toBe('nutraceutical-intervention');
    const edit = await request(harness.app).put(`/api/admin/case-studies/${id}`).set('Authorization', harness.adminAuthorization).send({ abstract: '<p>Updated summary</p>' });
    expect(edit.status).toBe(200);
    expect(edit.body.section).toBe('nutraceutical-intervention');
    const move = await request(harness.app).put(`/api/admin/case-studies/${id}`).set('Authorization', harness.adminAuthorization).send({ section: 'disease-specific' });
    expect(move.status).toBe(200);
    expect(move.body.status).toBe('published');
    expect(move.body.abstract).toBe('<p>Updated summary</p>');
    expect(move.body.methodology.tables[0].rows).toEqual([['1']]);
    expect((await request(harness.app).get('/api/case-studies?section=nutraceutical-intervention')).body.pagination.total).toBe(0);
    expect((await request(harness.app).get('/api/case-studies?section=disease-specific')).body.data.map(item => item._id)).toEqual([id]);
    await request(harness.app).put(`/api/admin/case-studies/${id}`).set('Authorization', harness.adminAuthorization).send({ status: 'draft' });
    expect((await request(harness.app).get('/api/case-studies?section=disease-specific&status=draft')).body.pagination.total).toBe(0);
    expect((await request(harness.app).get(`/api/case-studies/${id}`)).status).toBe(404);
    expect((await request(harness.app).get(`/api/admin/case-studies/${id}`).set('Authorization', harness.adminAuthorization)).body.section).toBe('disease-specific');
  });

  it('combines section, search, publication and pagination filters instead of replacing one OR with another', async () => {
    await CaseStudy.create([
      { title: 'Alpha disease one', section: 'disease-specific', status: 'published', createdAt: new Date('2026-01-03') },
      { title: 'Alpha disease two', section: 'disease-specific', status: 'published', createdAt: new Date('2026-01-02') },
      { title: 'Alpha supplement', section: 'nutraceutical-intervention', status: 'published' },
      { title: 'Beta disease', section: 'disease-specific', status: 'published' },
      { title: 'Alpha private disease', section: 'disease-specific', status: 'draft' },
      { title: 'Alpha private supplement', section: 'nutraceutical-intervention', status: 'draft' },
    ]);
    await CaseStudy.collection.insertOne({ title: 'Alpha legacy', status: 'published', createdAt: new Date('2026-01-01') });
    const page = await request(harness.app).get('/api/case-studies?section=disease-specific&q=Alpha&limit=1&page=2');
    expect(page.status).toBe(200);
    expect(page.body.pagination).toEqual({ page: 2, limit: 1, total: 3, pages: 3 });
    expect(page.body.data.map(item => item.title)).toEqual(['Alpha disease two']);
    const nutraceutical = await request(harness.app).get('/api/case-studies?section=nutraceutical-intervention&q=Alpha');
    expect(nutraceutical.body.data.map(item => item.title)).toEqual(['Alpha supplement']);
    const drafts = await request(harness.app).get('/api/admin/case-studies?section=disease-specific&q=Alpha&status=draft').set('Authorization', harness.adminAuthorization);
    expect(drafts.body.pagination.total).toBe(1);
    expect(drafts.body.data.map(item => item.title)).toEqual(['Alpha private disease']);
  });

  it('rejects malformed section query and body values without changing an existing classification', async () => {
    const study = await CaseStudy.create({ title: 'Keep classification', section: 'nutraceutical-intervention', status: 'published' });
    for (const prefix of ['/api/case-studies', '/api/admin/case-studies']) {
      for (const query of ['section=', 'section=unknown', 'section=null', 'section=disease-specific&section=nutraceutical-intervention', 'section[$ne]=disease-specific', 'section.value=disease-specific']) {
        let operation = request(harness.app).get(`${prefix}?${query}`);
        if (prefix.includes('/admin/')) operation = operation.set('Authorization', harness.adminAuthorization);
        const response = await operation;
        expect(response.status, `${prefix}?${query}`).toBe(400);
        expect(response.body.message).toContain('section');
      }
    }
    for (const section of [null, '', 'unknown', 12, true, [], {}, ['disease-specific']]) {
      const create = await request(harness.app).post('/api/admin/case-studies').set('Authorization', harness.adminAuthorization).send({ title: 'Invalid create', section });
      expect(create.status).toBe(400);
      const update = await request(harness.app).put(`/api/admin/case-studies/${study._id}`).set('Authorization', harness.adminAuthorization).send({ title: 'Invalid edit', section });
      expect(update.status).toBe(400);
    }
    expect(await CaseStudy.countDocuments()).toBe(1);
    const unchanged = await CaseStudy.findById(study._id);
    expect(unchanged.title).toBe('Keep classification');
    expect(unchanged.section).toBe('nutraceutical-intervention');
  });

  it('supports multipart section selection and rejects duplicate multipart classifications', async () => {
    const created = await request(harness.app).post('/api/admin/case-studies').set('Authorization', harness.adminAuthorization)
      .field('title', 'Multipart intervention').field('section', 'nutraceutical-intervention').field('status', 'published');
    expect(created.status).toBe(201);
    expect(created.body.section).toBe('nutraceutical-intervention');
    const updated = await request(harness.app).put(`/api/case-studies/${created.body._id}`).set('Authorization', harness.adminAuthorization)
      .field('section', 'disease-specific');
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('Multipart intervention');
    expect(updated.body.section).toBe('disease-specific');
    const duplicate = await request(harness.app).post('/api/admin/case-studies').set('Authorization', harness.adminAuthorization)
      .field('title', 'Duplicate section').field('section', 'disease-specific').field('section', 'nutraceutical-intervention');
    expect(duplicate.status).toBe(400);
    expect(await CaseStudy.countDocuments()).toBe(1);
  });
});
