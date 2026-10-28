import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBackendHarness } from './helpers/backendHarness.mjs';

const require = createRequire(import.meta.url);
const firebaseAuth = require('../src/services/firebaseAuth');
const bcrypt = require('bcryptjs');

describe('Google patient sign-in account and ownership boundaries', () => {
  let harness;
  let Patient;
  let verify;
  const identity = (patch = {}) => ({ uid: 'google-patient-a', sub: 'google-patient-a', email: 'google@example.test', email_verified: true, name: 'Google Patient', firebase: { sign_in_provider: 'google.com' }, ...patch });
  beforeAll(async () => {
    harness = await createBackendHarness({ patients: true });
    Patient = require('../src/models/Patient');
  });
  beforeEach(async () => {
    await harness.reset();
    verify = vi.spyOn(firebaseAuth, 'verifyGoogleToken').mockResolvedValue(identity());
  });
  afterAll(async () => { verify?.mockRestore(); await harness?.close(); });
  const google = (body = {}) => request(harness.app).post('/api/auth/google').send({ idToken: 'synthetic-provider-token', ...body });
  const register = email => request(harness.app).post('/api/auth/register').send({ name: 'Existing Patient', email, password: 'Existing patient password 2026!' });
  const profile = token => request(harness.app).get('/api/patient/profile').set('Authorization', `Bearer ${token}`);

  it('creates a patient and private profile, ignores request privilege claims and reuses the same subject', async () => {
    const first = await google({ role: 'admin', user: String(harness.admin._id), firebaseUid: 'attacker', patientCode: 'ATTACKER' });
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body.role).toBe('patient');
    expect(first.body.patientCode).toMatch(/^NIT-[A-F0-9]{24}$/);
    for (const key of ['password', 'firebaseUid', 'tokenVersion']) expect(first.body).not.toHaveProperty(key);
    expect((await google()).body._id).toBe(first.body._id);
    expect((await profile(first.body.token)).body.patient.patientCode).toBe(first.body.patientCode);
    expect(await Patient.countDocuments()).toBe(1);
    expect(await harness.User.countDocuments({ firebaseUid: 'google-patient-a' })).toBe(1);
    expect((await request(harness.app).post('/api/auth/login').send({ email: first.body.email, password: 'arbitrary-long-password' })).status).toBe(401);
  });

  it('requires the existing password before linking a matching email without replacing the Patient record', async () => {
    const existing = await register('google@example.test');
    expect(existing.status).toBe(201);
    expect((await google()).body.code).toBe('PASSWORD_REQUIRED');
    expect((await google({ password: 'incorrect-password' })).status).toBe(409);
    expect((await harness.User.findById(existing.body._id).select('+firebaseUid')).firebaseUid).toBeUndefined();
    const linked = await google({ password: 'Existing patient password 2026!' });
    expect(linked.status).toBe(200);
    expect(linked.body._id).toBe(existing.body._id);
    expect(linked.body.patientCode).toBe(existing.body.patientCode);
    expect(await Patient.countDocuments()).toBe(1);
    expect((await google()).status).toBe(200);
  });

  it('rejects staff accounts by email or linked subject and rejects malformed identity results before database lookup', async () => {
    verify.mockResolvedValueOnce(identity({ email: harness.admin.email }));
    expect((await google({ password: 'anything' })).status).toBe(403);
    await harness.User.updateOne({ _id: harness.admin._id }, { $set: { firebaseUid: 'staff-google-subject' } });
    verify.mockResolvedValueOnce(identity({ uid: 'staff-google-subject', sub: 'staff-google-subject' }));
    expect((await google()).status).toBe(403);
    for (const result of [null, identity({ uid: undefined }), identity({ uid: '' }), identity({ sub: 'other-subject' }), identity({ email: { $ne: null } }), identity({ email_verified: 'true' }), identity({ firebase: { sign_in_provider: 'password' } })]) {
      verify.mockResolvedValueOnce(result);
      expect((await google()).status).toBe(401);
    }
    for (const idToken of [null, '', {}, [], 'x'.repeat(10001)]) expect((await google({ idToken })).status).toBe(400);
    expect(await Patient.countDocuments()).toBe(0);
  });

  it('rolls account creation back when creating its patient identity fails', async () => {
    const fail = vi.spyOn(Patient, 'create').mockRejectedValueOnce(new Error('synthetic-patient-write-failure'));
    try { expect((await google()).status).toBe(500); }
    finally { fail.mockRestore(); }
    expect(await harness.User.exists({ email: 'google@example.test' })).toBeNull();
    expect(await Patient.countDocuments()).toBe(0);
  });

  it('converges concurrent creation for one subject to one account and one Patient', async () => {
    const results = await Promise.all([google(), google(), google()]);
    expect(results.every(item => [200, 409].includes(item.status))).toBe(true);
    expect(results.some(item => item.status === 200)).toBe(true);
    const successful = results.find(item => item.status === 200).body;
    expect(await harness.User.countDocuments({ firebaseUid: 'google-patient-a' })).toBe(1);
    expect(await Patient.countDocuments()).toBe(1);
    expect((await google()).body._id).toBe(successful._id);
  });

  it('does not merge competing subjects with one email even when their first registrations race', async () => {
    verify.mockImplementation(async token => identity({ uid: token, sub: token }));
    const responses = await Promise.all([google({ idToken: 'subject-a' }), google({ idToken: 'subject-b' })]);
    expect(responses.filter(item => item.status === 200)).toHaveLength(1);
    expect(responses.every(item => [200, 403, 409].includes(item.status))).toBe(true);
    const saved = await harness.User.findOne({ email: 'google@example.test' }).select('+firebaseUid');
    const losingSubject = saved.firebaseUid === 'subject-a' ? 'subject-b' : 'subject-a';
    expect((await google({ idToken: losingSubject })).status).toBe(403);
    expect(await Patient.countDocuments()).toBe(1);
  });

  it('does not link after concurrent role, password or UID changes invalidate the checked account state', async () => {
    const realMatch = harness.User.prototype.matchPassword;
    const replacementHash = await bcrypt.hash('Replacement password for race test!', 4);
    for (const [index, patch] of [{ role: 'admin' }, { password: replacementHash }, { firebaseUid: 'another-bound-subject' }].entries()) {
      const email = `race-${index}@example.test`;
      const account = await register(email);
      verify.mockResolvedValueOnce(identity({ email, uid: `race-subject-${index}`, sub: `race-subject-${index}` }));
      const race = vi.spyOn(harness.User.prototype, 'matchPassword').mockImplementationOnce(async function (password) {
        const matched = await realMatch.call(this, password);
        await harness.User.updateOne({ _id: this._id }, { $set: patch });
        return matched;
      });
      try { expect((await google({ password: 'Existing patient password 2026!' })).status).toBe(409); }
      finally { race.mockRestore(); }
      const saved = await harness.User.findById(account.body._id).select('+firebaseUid');
      expect(saved.firebaseUid).toBe(patch.firebaseUid);
    }
  });

  it('keeps an established subject bound to its original account when its verified email changes', async () => {
    const original = (await google()).body;
    const other = await register('changed@example.test');
    verify.mockResolvedValueOnce(identity({ email: 'changed@example.test', name: 'Changed Google Name' }));
    const again = await google();
    expect(again.status).toBe(200);
    expect(again.body._id).toBe(original._id);
    expect(again.body.email).toBe('google@example.test');
    expect(again.body.patientCode).toBe(original.patientCode);
    expect((await harness.User.findById(other.body._id).select('+firebaseUid')).firebaseUid).toBeUndefined();
    expect((await profile(again.body.token)).body.patient.email).toBe('google@example.test');
    verify.mockResolvedValueOnce(identity({ uid: 'new-subject', sub: 'new-subject' }));
    expect((await google()).status).toBe(403);
    expect(await Patient.countDocuments()).toBe(2);
  });

  it('enforces subject uniqueness when concurrent password-confirmed links target different existing accounts', async () => {
    await register('link-a@example.test');
    await register('link-b@example.test');
    verify.mockImplementation(async token => identity({ email: `${token}@example.test` }));
    const responses = await Promise.all([
      google({ idToken: 'link-a', password: 'Existing patient password 2026!' }),
      google({ idToken: 'link-b', password: 'Existing patient password 2026!' }),
    ]);
    expect(responses.some(item => item.status === 200)).toBe(true);
    expect(responses.every(item => [200, 409].includes(item.status))).toBe(true);
    expect(await harness.User.countDocuments({ firebaseUid: 'google-patient-a' })).toBe(1);
    expect(await Patient.countDocuments()).toBe(2);
  });

  it('limits password confirmation by verified subject and retains NIT session revocation', async () => {
    await register('google@example.test');
    for (let index = 0; index < 5; index += 1) expect((await google({ password: 'incorrect-password' })).status).toBe(409);
    const blocked = await google({ password: 'incorrect-password' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    verify.mockResolvedValue(identity({ uid: 'fresh-subject', sub: 'fresh-subject', email: 'fresh@example.test' }));
    const signedIn = await google();
    expect(signedIn.status).toBe(200);
    expect((await request(harness.app).post('/api/auth/logout').set('Authorization', `Bearer ${signedIn.body.token}`)).status).toBe(200);
    expect((await profile(signedIn.body.token)).status).toBe(401);
    const fresh = await google();
    expect((await profile(fresh.body.token)).status).toBe(200);
    expect(fresh.body._id).toBe(signedIn.body._id);
  });

  it('limits successful sign-in per verified subject without globally locking other patients behind a shared proxy', async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      // No platform IP is available in this synthetic proxy path: valid users
      // remain independently limited by their verified subject, not proxy IP.
      for (let index = 0; index < 30; index += 1) expect((await google()).status).toBe(200);
      expect((await google()).status).toBe(429);
      verify.mockResolvedValue(identity({ uid: 'independent-subject', sub: 'independent-subject', email: 'independent@example.test' }));
      expect((await google()).status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });

  it('buckets failed Vercel requests by validated client IP rather than a shared internal proxy', async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      verify.mockRejectedValue(new Error('synthetic-invalid-provider-token'));
      for (let index = 0; index < 60; index += 1) {
        expect((await request(harness.app).post('/api/auth/google').set('x-vercel-forwarded-for', '203.0.113.10').send({ idToken: 'invalid-token' })).status).toBe(401);
      }
      const blocked = await request(harness.app).post('/api/auth/google').set('x-vercel-forwarded-for', '203.0.113.10').send({ idToken: 'invalid-token' });
      expect(blocked.status).toBe(429);
      verify.mockResolvedValue(identity());
      const otherClient = await request(harness.app).post('/api/auth/google').set('x-vercel-forwarded-for', '203.0.113.11').send({ idToken: 'valid-token' });
      expect(otherClient.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });
});
