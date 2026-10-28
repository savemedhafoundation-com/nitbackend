import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBackendHarness } from './helpers/backendHarness.mjs';
const require = createRequire(import.meta.url);
const password = 'correct-test-password';
const content = () => ({ title: 'Individual test plan', nutrition: 'Clinician-entered test nutrition guidance', startsOn: '2026-10-23', endsOn: '2026-11-23', items: [
  { kind: 'booster', name: 'Test booster', dose: '1', unit: 'test unit', route: 'test route', frequency: 'test schedule', duration: 'test duration', instructions: 'Synthetic fixture only' },
  { kind: 'supplement', name: 'Test supplement', dose: '2', unit: 'test unit', route: 'test route', frequency: 'test schedule', duration: 'test duration' },
], concurrentTreatments: 'Recorded concurrent therapy', adverseEvents: '', status: 'active' });

describe('individual treatment drafts and signed versions', () => {
  let h, Plan, Version, Membership, Assignment, AuditEvent, base, centre, patient;
  beforeAll(async () => {
    h = await createBackendHarness({ patients: true });
    Plan = require('../src/models/PatientTreatmentPlan'); Version = require('../src/models/TreatmentPlanVersion');
    Membership = require('../src/models/CentreMembership'); Assignment = require('../src/models/PatientCentreAssignment'); AuditEvent = require('../src/models/AuditEvent');
  });
  beforeEach(async () => {
    await h.reset();
    const user = await h.User.findById(h.admin._id); user.password = password; await user.save();
    centre = await require('../src/models/Centre').create({ code: 'A', name: 'Test centre A' });
    await Membership.create({ user: h.admin._id, centre: centre._id, capabilities: ['registry.read', 'treatment.read', 'treatment.write', 'treatment.sign'] });
    const profile = await request(h.app).get('/api/patient/profile').set('Authorization', h.patientAuthorization);
    patient = profile.body.patient;
    await Assignment.create({ patient: patient._id, centre: centre._id, assignedBy: h.admin._id });
    base = `/api/clinical/centres/${centre._id}/patients/${patient._id}/treatment-plans`;
  });
  afterAll(async () => { await h?.close(); });
  const staff = (method, path, body) => request(h.app)[method](path).set('Authorization', h.adminAuthorization).send(body);
  const own = path => request(h.app).get(`/api/patient/treatment-plans${path || ''}`).set('Authorization', h.patientAuthorization);
  const create = async (data = content(), key = 'create-request') => (await staff('post', base, { content: data, clientRequestId: key })).body;
  const sign = plan => staff('post', `${base}/${plan._id}/sign`, { expectedRevision: plan.revision, confirmed: true, password, signedBy: 'spoofed', signerName: 'Spoofed signer' });

  it('creates patient-specific drafts idempotently and hides drafts from patient list/count/history', async () => {
    const draft = await create();
    expect(draft.draft.content.items.map(item => item.kind)).toEqual(['booster', 'supplement']);
    expect(draft.revision).toBe(1); expect(draft.current).toBeNull();
    expect((await create())._id).toBe(draft._id);
    expect((await staff('post', base, { content: { ...content(), title: 'Different' }, clientRequestId: 'create-request' })).status).toBe(409);
    expect((await own()).body.pagination.total).toBe(0);
    expect((await own(`/${draft._id}/versions`)).status).toBe(404);
    expect((await staff('get', base)).body.pagination.total).toBe(1);
    expect(await Plan.countDocuments()).toBe(1);
  });

  it('signs the saved version with real signer identity and password confirmation, without changing signed records', async () => {
    const draft = await create();
    const signed = await sign(draft);
    expect(signed.status).toBe(200); expect(signed.body.draft).toBeNull(); expect(signed.body.signedVersion).toBe(1);
    expect(signed.body.current.signerName).toBe('Test Admin');
    expect(signed.body.current.authorName).toBe('Test Admin');
    expect(signed.body.current.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.body.current.signatureMethod).toBe('authenticated-password-attestation');
    const patientView = await own();
    expect(patientView.headers['cache-control']).toBe('private, no-store');
    expect(patientView.body.data[0].current.content.nutrition).toBe(content().nutrition);
    expect(patientView.body.data[0]).not.toHaveProperty('draft');
    expect(JSON.stringify(patientView.body)).not.toContain(password);
    expect((await staff('patch', `${base}/${draft._id}/draft`, { expectedRevision: signed.body.revision, content: { ...content(), nutrition: 'Overwritten' } })).status).toBe(409);
    const record = await Version.findOne({ plan: draft._id });
    record.content.nutrition = 'Attempted overwrite'; await expect(record.save()).rejects.toThrow('cannot be changed');
    await expect(Version.updateOne({ plan: draft._id }, { $set: { signerName: 'Replacement' } })).rejects.toThrow('cannot be changed');
    await expect(record.deleteOne()).rejects.toThrow('cannot be changed');
    await expect(Version.bulkWrite([{ updateOne: { filter: { plan: draft._id }, update: { $set: { signerName: 'Replacement' } } } }])).rejects.toThrow('cannot be changed');
    const events = await AuditEvent.find({ action: 'treatment-plan.signed' }).lean();
    expect(events).toHaveLength(1); expect(JSON.stringify(events)).not.toContain(password);
  });

  it('preserves the previous patient-visible plan until a reasoned amendment is signed, and supports discontinuation', async () => {
    const initial = (await sign(await create())).body;
    expect((await staff('post', `${base}/${initial._id}/amend`, { expectedRevision: initial.revision, reason: '' })).status).toBe(400);
    let amendment = await staff('post', `${base}/${initial._id}/amend`, { expectedRevision: initial.revision, reason: 'Care team reviewed adverse event' });
    expect(amendment.status).toBe(200);
    amendment = await staff('patch', `${base}/${initial._id}/draft`, { expectedRevision: amendment.body.revision, content: { ...content(), nutrition: 'Revised nutrition', status: 'discontinued', stopReason: 'Recorded adverse event', adverseEvents: 'Patient-reported reaction' } });
    expect((await own()).body.data[0].current.content.nutrition).toBe(content().nutrition);
    expect((await own(`/${initial._id}/versions`)).body.data).toHaveLength(1);
    const next = await sign(amendment.body); expect(next.status).toBe(200);
    const versions = await own(`/${initial._id}/versions`);
    expect(versions.body.data.map(item => item.version)).toEqual([2, 1]);
    expect(versions.body.data[0].previousHash).toBe(initial.current.contentHash);
    expect(versions.body.data[1].contentHash).toBe(initial.current.contentHash);
    expect(versions.body.data[0].content.status).toBe('discontinued');
    expect(versions.body.data[0].amendmentReason).toBe('Care team reviewed adverse event');
  });

  it('rejects stale concurrent edits and duplicate concurrent signing', async () => {
    const draft = await create();
    const edits = await Promise.all(['A', 'B'].map(title => staff('patch', `${base}/${draft._id}/draft`, { expectedRevision: draft.revision, content: { ...content(), title } })));
    expect(edits.map(item => item.status).sort()).toEqual([200, 409]);
    const current = edits.find(item => item.status === 200).body;
    expect((await sign(draft)).status).toBe(409);
    const signed = await Promise.all([sign(current), sign(current)]);
    expect(signed.map(item => item.status).sort()).toEqual([200, 409]);
    expect(await Version.countDocuments({ plan: draft._id })).toBe(1);
  });

  it('requires explicit signing capability, review confirmation, correct password and complete instructions', async () => {
    const draft = await create({ ...content(), startsOn: '', items: [{ kind: 'booster', name: 'Incomplete' }] });
    await Membership.updateOne({ user: h.admin._id }, { $pull: { capabilities: 'treatment.sign' } });
    expect((await sign(draft)).status).toBe(403);
    await Membership.updateOne({ user: h.admin._id }, { $addToSet: { capabilities: 'treatment.sign' } });
    expect((await staff('post', `${base}/${draft._id}/sign`, { expectedRevision: draft.revision, confirmed: false, password })).status).toBe(400);
    expect((await staff('post', `${base}/${draft._id}/sign`, { expectedRevision: draft.revision, confirmed: true, password: 'wrong' })).status).toBe(400);
    expect((await sign(draft)).status).toBe(400);
    const saved = await staff('patch', `${base}/${draft._id}/draft`, { expectedRevision: draft.revision, content: { ...content(), items: [{ kind: 'booster', name: 'Incomplete' }] } });
    expect((await sign(saved.body)).status).toBe(400);
    expect(await Version.countDocuments()).toBe(0);
    for (const body of [{ ...content(), startsOn: '2026-02-31' }, { ...content(), endsOn: '2026-01-01' }, { ...content(), status: 'other' }, { ...content(), items: Array(51).fill({ kind: 'booster', name: 'Too many' }) }]) {
      expect((await staff('post', base, { content: body, clientRequestId: 'invalid' })).status).toBe(400);
    }
  });

  it('enforces patient ownership, current assignment and centre grants on every endpoint', async () => {
    const draft = await create();
    expect((await request(h.app).get(base)).status).toBe(401);
    expect((await request(h.app).post(base).set('Authorization', h.patientAuthorization).send({ content: content(), clientRequestId: 'patient' })).status).toBe(403);
    const otherCentre = await require('../src/models/Centre').create({ code: 'B', name: 'Centre B' });
    await Membership.create({ user: h.admin._id, centre: otherCentre._id, capabilities: ['treatment.read', 'treatment.write', 'treatment.sign'] });
    await Assignment.create({ patient: patient._id, centre: otherCentre._id, assignedBy: h.admin._id });
    const otherBase = base.replace(String(centre._id), String(otherCentre._id));
    expect((await staff('get', otherBase)).body.data).toEqual([]);
    expect((await staff('get', `${otherBase}/${draft._id}/versions`)).status).toBe(404);
    expect((await staff('patch', `${otherBase}/${draft._id}/draft`, { expectedRevision: 1, content: content() })).status).toBe(404);
    expect((await sign(draft)).status).toBe(200);
    const outsider = await request(h.app).post('/api/auth/register').send({ name: 'Other Patient', email: 'outsider@example.test', password });
    expect((await request(h.app).get(`/api/patient/treatment-plans/${draft._id}/versions`).set('Authorization', `Bearer ${outsider.body.token}`)).status).toBe(404);
    expect((await request(h.app).post(`/api/patient/treatment-plans/${draft._id}/sign`).set('Authorization', h.patientAuthorization).send({ password })).status).toBe(404);
    await Assignment.updateOne({ patient: patient._id, centre: centre._id }, { $set: { active: false } });
    expect((await staff('get', base)).status).toBe(404);
    await Membership.updateOne({ user: h.admin._id, centre: otherCentre._id }, { $set: { active: false } });
    expect((await staff('get', otherBase)).status).toBe(403);
  });

  it('supports a separate read/sign reviewer while preserving the draft author and blocking edits without write permission', async () => {
    const draft = await create();
    const reviewer = await h.User.create({ name: 'Review Clinician', email: 'reviewer@example.test', password, role: 'admin' });
    await Membership.create({ user: reviewer._id, centre: centre._id, capabilities: ['treatment.read', 'treatment.sign'] });
    const authorization = `Bearer ${require('../src/utils/generateToken')(reviewer._id)}`;
    expect((await request(h.app).patch(`${base}/${draft._id}/draft`).set('Authorization', authorization).send({ expectedRevision: draft.revision, content: content() })).status).toBe(403);
    const signed = await request(h.app).post(`${base}/${draft._id}/sign`).set('Authorization', authorization).send({ expectedRevision: draft.revision, confirmed: true, password });
    expect(signed.status).toBe(200);
    expect(signed.body.current.authorName).toBe('Test Admin');
    expect(signed.body.current.signerName).toBe('Review Clinician');
    await h.User.updateOne({ _id: h.admin._id }, { $set: { name: 'Renamed author' } });
    expect((await own()).body.data[0].current.authorName).toBe('Test Admin');
  });

  it('rolls back the signed version, pointer and success audit atomically when the transaction fails', async () => {
    const draft = await create();
    const original = AuditEvent.create.bind(AuditEvent);
    const spy = vi.spyOn(AuditEvent, 'create').mockImplementation((docs, options) => {
      if (Array.isArray(docs) && docs[0].action === 'treatment-plan.signed') throw new Error('test-only audit failure');
      return original(docs, options);
    });
    try { expect((await sign(draft)).status).toBe(500); } finally { spy.mockRestore(); }
    expect(await Version.countDocuments()).toBe(0);
    const root = await Plan.findById(draft._id); expect(root.signedVersion).toBe(0); expect(root.draft).not.toBeNull();
    expect((await sign(draft)).status).toBe(200);
  });

  it('detects altered signed content and rate-limits repeated failed password confirmations', async () => {
    const draft = await create(); const signed = await sign(draft); expect(signed.status).toBe(200);
    await Version.collection.updateOne({ plan: new (require('mongoose').Types.ObjectId)(draft._id) }, { $set: { 'content.nutrition': 'Altered outside the app' } });
    expect((await own()).status).toBe(409);
    const another = await create(content(), 'another');
    for (let index = 0; index < 5; index += 1) expect((await staff('post', `${base}/${another._id}/sign`, { expectedRevision: another.revision, confirmed: true, password: 'wrong' })).status).toBe(400);
    expect((await staff('post', `${base}/${another._id}/sign`, { expectedRevision: another.revision, confirmed: true, password: 'wrong' })).status).toBe(429);
  });
});
