import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createBackendHarness } from './helpers/backendHarness.mjs';
const require = createRequire(import.meta.url);

describe('Google patient sign-in', () => {
  let h, verifier;
  beforeAll(async () => {
    h = await createBackendHarness({ patients: true });
  });
  beforeEach(async () => {
    await h.reset();
    verifier = vi.spyOn(require('../src/services/firebaseAuth'), 'verifyGoogleToken');
    verifier.mockResolvedValue({ uid: 'google-test-user', sub: 'google-test-user', email: 'google@example.test', email_verified: true, name: 'Google Patient', firebase: { sign_in_provider: 'google.com' } });
  });
  afterAll(async () => { verifier?.mockRestore(); await h?.close(); });
  const login = body => request(h.app).post('/api/auth/google').send({ idToken: 'verified-fixture-token', ...body });

  it('creates one patient account and reuses it across sign-ins', async () => {
    const first = await login({ role: 'admin', email: 'spoof@example.test' });
    expect(first.status).toBe(200);
    expect(first.body.role).toBe('patient');
    expect(first.body.email).toBe('google@example.test');
    expect(first.body.patientCode).toMatch(/^NIT-/);
    expect(first.body).not.toHaveProperty('firebaseUid');
    const again = await login();
    expect(again.body._id).toBe(first.body._id);
    expect(again.body.patientCode).toBe(first.body.patientCode);
    const profile = await request(h.app).get('/api/patient/profile').set('Authorization', `Bearer ${first.body.token}`);
    expect(profile.status).toBe(200);
    expect(await h.User.countDocuments({ email: 'google@example.test' })).toBe(1);
    const passwordLogin = await request(h.app).post('/api/auth/login').send({ email: first.body.email, password: 'arbitrary-password' });
    expect(passwordLogin.status).toBe(401);
  });

  it('requires proof of the existing password before linking matching emails', async () => {
    const existing = await request(h.app).post('/api/auth/register').send({ name: 'Existing Patient', email: 'google@example.test', password: 'existing-password' });
    expect((await login()).body.code).toBe('PASSWORD_REQUIRED');
    expect((await login({ password: 'incorrect' })).status).toBe(409);
    expect(await h.User.countDocuments({ firebaseUid: 'google-test-user' })).toBe(0);
    const linked = await login({ password: 'existing-password' });
    expect(linked.status).toBe(200);
    expect(linked.body._id).toBe(existing.body._id);
    expect(linked.body.patientCode).toBe(existing.body.patientCode);
    expect((await login()).status).toBe(200);
  });

  it('rejects invalid tokens and does not link staff accounts', async () => {
    verifier.mockRejectedValueOnce(new Error('bad signature'));
    expect((await login()).status).toBe(401);
    expect((await login({ idToken: {} })).status).toBe(400);
    verifier.mockResolvedValue({ uid: 'staff-uid', sub: 'staff-uid', email: h.admin.email, email_verified: true, name: 'Staff', firebase: { sign_in_provider: 'google.com' } });
    expect((await login()).status).toBe(403);
    expect(await h.User.countDocuments({ firebaseUid: 'staff-uid' })).toBe(0);
  });

  it('revokes the issued application session on logout', async () => {
    const signedIn = await login();
    const token = `Bearer ${signedIn.body.token}`;
    expect((await request(h.app).post('/api/auth/logout').set('Authorization', token)).status).toBe(200);
    expect((await request(h.app).get('/api/auth/me').set('Authorization', token)).status).toBe(401);
  });
});
