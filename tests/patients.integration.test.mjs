import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBackendHarness } from './helpers/backendHarness.mjs';
const require = createRequire(import.meta.url);

describe('patient registry, history and centre boundaries', () => {
  let harness, Patient, History, Centre, Membership, Assignment;
  beforeAll(async () => {
    harness = await createBackendHarness({ patients: true });
    Patient = require('../src/models/Patient'); History = require('../src/models/PatientHistory');
    Centre = require('../src/models/Centre'); Membership = require('../src/models/CentreMembership'); Assignment = require('../src/models/PatientCentreAssignment');
  });
  beforeEach(async () => { await harness.reset(); });
  afterAll(async () => { await harness?.close(); });
  const register = (email, extra = {}) => request(harness.app).post('/api/auth/register').send({ name: 'Test Patient', email, password: 'local-test-password', ...extra });
  const own = token => request(harness.app).get('/api/patient/profile').set('Authorization', `Bearer ${token}`);
  const append = (token, body) => request(harness.app).post('/api/patient/history').set('Authorization', `Bearer ${token}`).send(body);
  const history = token => request(harness.app).get('/api/patient/history').set('Authorization', `Bearer ${token}`);
  async function setupCentre(code) {
    const centre = await Centre.create({ code, name: `Centre ${code}` });
    await Membership.create({ user: harness.admin._id, centre: centre._id, capabilities: ['registry.read', 'registry.write', 'history.read', 'history.write'] });
    return `/api/clinical/centres/${centre._id}/patients`;
  }
  const staff = (method, path, body) => request(harness.app)[method](path).set('Authorization', harness.adminAuthorization).send(body);

  it('creates one linked patient with validated demographics and a server-issued immutable ID', async () => {
    const response = await register('new@example.test', { phone: '+91 98765 43210', dateOfBirth: '1990-02-03', sex: 'female', patientCode: 'ATTACKER-ID', user: harness.admin._id, role: 'admin' });
    expect(response.status).toBe(201);
    expect(response.body.role).toBe('patient');
    expect(response.body.patientCode).toMatch(/^NIT-[A-F0-9]{24}$/);
    const profile = await own(response.body.token);
    expect(profile.status).toBe(200);
    expect(profile.headers['cache-control']).toBe('private, no-store');
    expect(profile.body.patient).toMatchObject({ patientCode: response.body.patientCode, phone: '919876543210', dateOfBirth: '1990-02-03', sex: 'female' });
    expect(profile.body.patient).not.toHaveProperty('user');
    expect((await own(response.body.token)).body.patient.patientCode).toBe(response.body.patientCode);
    expect(await Patient.countDocuments()).toBe(1);
  });

  it('handles simultaneous registrations and simultaneous legacy profile provisioning without duplicate IDs', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => register(`concurrent-${index}@example.test`)));
    expect(responses.map(item => item.status)).toEqual(Array(8).fill(201));
    expect(new Set(responses.map(item => item.body.patientCode)).size).toBe(8);
    const legacy = await Promise.all(Array.from({ length: 8 }, () => request(harness.app).get('/api/patient/profile').set('Authorization', harness.patientAuthorization)));
    expect(legacy.map(item => item.status)).toEqual(Array(8).fill(200));
    expect(new Set(legacy.map(item => item.body.patient.patientCode)).size).toBe(1);
    expect(await Patient.countDocuments({ user: harness.patient._id })).toBe(1);
    expect((await request(harness.app).get('/api/patient/profile').set('Authorization', harness.adminAuthorization)).status).toBe(403);
  });

  it('retries an ID collision while keeping account creation transactional', async () => {
    const existing = await register('first@example.test');
    const original = Patient.create.bind(Patient);
    const spy = vi.spyOn(Patient, 'create').mockImplementationOnce((documents, options) => original(documents.map(item => ({ ...item, patientCode: existing.body.patientCode })), options));
    try {
      const second = await register('second@example.test');
      expect(second.status).toBe(201);
      expect(second.body.patientCode).not.toBe(existing.body.patientCode);
      expect(await harness.User.countDocuments({ email: 'second@example.test' })).toBe(1);
    } finally { spy.mockRestore(); }
  });

  it('rolls back the account when patient creation fails and rejects invalid demographics before creation', async () => {
    const spy = vi.spyOn(Patient, 'create').mockRejectedValueOnce(new Error('test-only storage failure'));
    try { expect((await register('rollback@example.test')).status).toBe(500); }
    finally { spy.mockRestore(); }
    expect(await harness.User.exists({ email: 'rollback@example.test' })).toBeNull();
    for (const fields of [{ dateOfBirth: '2020-02-31' }, { dateOfBirth: '2999-01-01' }, { phone: 'abc' }, { name: 'x' }, { sex: { $ne: '' } }]) {
      expect((await register('invalid@example.test', fields)).status).toBe(400);
    }
    expect(await harness.User.exists({ email: 'invalid@example.test' })).toBeNull();
  });

  it('rolls back staff registration if centre assignment fails and handles concurrent duplicate account signup', async () => {
    const base = await setupCentre('A');
    const spy = vi.spyOn(Assignment, 'create').mockRejectedValueOnce(new Error('test-only assignment failure'));
    try { expect((await staff('post', base, { name: 'Failed staff record' })).status).toBe(500); }
    finally { spy.mockRestore(); }
    expect(await Patient.countDocuments()).toBe(0);
    expect(await Assignment.countDocuments()).toBe(0);
    const results = await Promise.all([register('same@example.test'), register('same@example.test')]);
    expect(results.map(item => item.status).sort()).toEqual([201, 409]);
    expect(await Patient.countDocuments()).toBe(1);
  });

  it('keeps self-reported history private, append-only and idempotent with safe corrections', async () => {
    const a = (await register('a@example.test')).body;
    const b = (await register('b@example.test')).body;
    const entry = { type: 'allergy', title: 'Reported allergy', details: 'First note', occurredOn: '2020-03-01', clientRequestId: 'stable-request', patient: 'other', source: 'staff-recorded' };
    const created = await append(a.token, entry);
    expect(created.status).toBe(201);
    expect(created.body.source).toBe('patient-reported');
    expect((await append(a.token, entry)).body._id).toBe(created.body._id);
    expect((await append(a.token, { ...entry, details: 'Different same request' })).status).toBe(409);
    expect((await history(b.token)).body.data).toEqual([]);
    expect((await append(b.token, { ...entry, clientRequestId: 'other', amends: created.body._id })).status).toBe(404);
    const corrected = await append(a.token, { ...entry, clientRequestId: 'correction', details: 'Corrected note', amends: created.body._id });
    expect(corrected.status).toBe(201);
    const saved = await history(a.token);
    expect(saved.body.pagination.total).toBe(2);
    expect(saved.body.data.some(item => item.details === 'First note')).toBe(true);
    expect(saved.body.data.some(item => item.amends === created.body._id)).toBe(true);
    expect(await History.countDocuments()).toBe(2);
    expect((await request(harness.app).put(`/api/patient/history/${created.body._id}`).set('Authorization', `Bearer ${a.token}`).send({ details: 'overwrite' })).status).toBe(404);
    expect((await request(harness.app).get('/api/patient/history')).status).toBe(401);
    expect((await append(a.token, { ...entry, occurredOn: '2020-02-31' })).status).toBe(400);
  });

  it('registers staff-created patients without accounts and warns about centre-scoped duplicates', async () => {
    const base = await setupCentre('A');
    const fields = { name: 'No Email Patient', phone: '9876543210' };
    const created = await staff('post', base, fields);
    expect(created.status).toBe(201);
    expect(created.body.patientCode).toMatch(/^NIT-/);
    expect((await Patient.findById(created.body._id)).user).toBeUndefined();
    expect(await harness.User.countDocuments()).toBe(2);
    const duplicate = await staff('post', base, fields);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.duplicateCandidates[0]._id).toBe(created.body._id);
    expect((await staff('post', base, { ...fields, confirmSeparatePatient: true })).status).toBe(201);
    const listed = await staff('get', `${base}?q=${created.body.patientCode}`);
    expect(listed.body.data.map(item => item._id)).toEqual([created.body._id]);
    expect((await staff('get', `${base}?q=%5B`)).status).toBe(200);
    expect((await staff('get', `${base}?q[$ne]=x`)).status).toBe(200);
  });

  it('blocks cross-centre IDs, history, account linking and revoked memberships on every route', async () => {
    const a = await setupCentre('A');
    const b = await setupCentre('B');
    const created = await staff('post', a, { name: 'Centre A patient' });
    const id = created.body._id;
    for (const [method, path, body] of [['get', `${b}/${id}`], ['get', `${b}/${id}/history`], ['post', `${b}/${id}/history`, { type: 'baseline', title: 'No', details: 'No' }]]) {
      expect((await staff(method, path, body)).status).toBe(404);
    }
    const centreId = a.split('/')[4];
    await Membership.updateOne({ user: harness.admin._id, centre: centreId }, { $set: { active: false } });
    expect((await staff('get', a)).status).toBe(403);
    expect((await staff('post', a, { name: 'Denied' })).status).toBe(403);
    expect((await request(harness.app).post(b).set('Authorization', harness.patientAuthorization).send({ name: 'Denied' })).status).toBe(403);
    expect((await request(harness.app).get(b)).status).toBe(401);
  });

  it('exposes patient-reported baseline to assigned care teams and preserves clinician history on patient reads', async () => {
    const user = (await register('baseline@example.test')).body;
    const profile = await own(user.token);
    const base = await setupCentre('A');
    await Assignment.create({ patient: profile.body.patient._id, centre: base.split('/')[4], assignedBy: harness.admin._id });
    await append(user.token, { type: 'baseline', title: 'Initial report summary', details: 'Patient report' });
    const path = `${base}/${profile.body.patient._id}/history`;
    expect((await staff('get', path)).body.pagination.total).toBe(1);
    const staffNote = await staff('post', path, { type: 'diagnosis', title: 'Recorded condition', details: 'Care team note' });
    expect(staffNote.status).toBe(201);
    expect(staffNote.body.source).toBe('staff-recorded');
    expect((await history(user.token)).body.pagination.total).toBe(2);
    const other = await setupCentre('B');
    await Assignment.create({ patient: profile.body.patient._id, centre: other.split('/')[4], assignedBy: harness.admin._id });
    const sharedHistory = await staff('get', `${other}/${profile.body.patient._id}/history`);
    expect(sharedHistory.body.data.map(item => item.title)).toEqual(['Initial report summary']);
    expect((await append(user.token, { type: 'other', title: 'No overwrite', details: 'No', amends: staffNote.body._id })).status).toBe(404);
    expect((await staff('get', '/api/clinical/centres')).body.data).toHaveLength(2);
  });
});
