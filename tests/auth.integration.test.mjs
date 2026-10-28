import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createBackendHarness } from './helpers/backendHarness.mjs';

describe('ebook authorization foundation', () => {
  let harness;
  beforeAll(async () => { harness = await createBackendHarness(); });
  beforeEach(async () => { await harness.reset(); });
  afterAll(async () => { await harness?.close(); });

  it('does not allow public registration to create an administrator', async () => {
    const response = await request(harness.app).post('/api/auth/register').send({
      name: 'Public Registrant',
      email: 'public-registration@example.test',
      password: 'local-test-password',
      role: 'admin',
    });
    expect(response.status).toBe(201);
    expect(response.body.role).toBe('patient');
    const saved = await harness.User.findOne({ email: 'public-registration@example.test' });
    expect(saved.role).toBe('patient');
  });

  it('normalizes login email and rejects structured credentials', async () => {
    const register = await request(harness.app).post('/api/auth/register').send({ name: 'Normalize User', email: '  NORMALIZED@example.test  ', password: 'local-test-password' });
    expect(register.status).toBe(201);
    const login = await request(harness.app).post('/api/auth/login').send({ email: ' NORMALIZED@example.test ', password: 'local-test-password' });
    expect(login.status).toBe(200);
    expect(login.body.email).toBe('normalized@example.test');
    expect((await request(harness.app).post('/api/auth/logout').set('Authorization', `Bearer ${login.body.token}`)).status).toBe(200);
    expect((await request(harness.app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`)).status).toBe(401);
    const fresh = await request(harness.app).post('/api/auth/login').send({ email: 'normalized@example.test', password: 'local-test-password' });
    expect(fresh.status).toBe(200);
    expect((await request(harness.app).get('/api/auth/me').set('Authorization', `Bearer ${fresh.body.token}`)).status).toBe(200);
    expect((await request(harness.app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } })).status).toBe(400);
    expect((await request(harness.app).get('/api/auth/me').set('Authorization', `BearerX ${login.body.token}`)).status).toBe(401);
  });

  it('shares login throttling through MongoDB and returns a retry response', async () => {
    for (let index = 0; index < 30; index += 1) {
      expect((await request(harness.app).post('/api/auth/login').send({ email: 'absent@example.test', password: 'bad' })).status).toBe(401);
    }
    const limited = await request(harness.app).post('/api/auth/login').send({ email: ' ABSENT@example.test ', password: 'bad' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    const other = await request(harness.app).post('/api/auth/login').send({ email: 'other@example.test', password: 'bad' });
    expect(other.status).toBe(401);
  });

  it('requires 15 Unicode characters for new passwords without composition rules and bounds UTF-8 bytes before hashing', async () => {
    const register = (email, password) => request(harness.app).post('/api/auth/register').send({ name: 'Password Policy Test', email, password });
    const Patient = harness.User.db.model('Patient');
    for (const [email, password, message] of [
      ['short-ascii@example.test', 'a'.repeat(14), 'at least 15'],
      ['short-unicode@example.test', '😀'.repeat(14), 'at least 15'],
      ['long-ascii@example.test', 'a'.repeat(73), '72 UTF-8 bytes'],
      ['long-unicode@example.test', '😀'.repeat(19), '72 UTF-8 bytes'],
    ]) {
      const response = await register(email, password);
      expect(response.status).toBe(400);
      expect(response.body.message).toContain(message);
      expect(await harness.User.exists({ email })).toBeNull();
      expect(await Patient.exists({ email })).toBeNull();
    }
    for (const [email, password] of [
      ['minimum@example.test', 'a'.repeat(15)],
      ['maximum-ascii@example.test', 'a'.repeat(72)],
      ['minimum-unicode@example.test', '😀'.repeat(15)],
      ['maximum-unicode@example.test', '😀'.repeat(18)],
    ]) {
      expect((await register(email, password)).status).toBe(201);
      expect((await request(harness.app).post('/api/auth/login').send({ email, password })).status).toBe(200);
    }
  });

  it('preserves login compatibility for existing shorter and historically oversized bcrypt passwords', async () => {
    for (const [email, password] of [
      ['legacy-short@example.test', 'old-pass'],
      ['legacy-oversized@example.test', 'x'.repeat(80)],
    ]) {
      await harness.User.create({ name: 'Legacy Account', email, password, role: 'patient' });
      const login = await request(harness.app).post('/api/auth/login').send({ email, password });
      expect(login.status).toBe(200);
      expect((await request(harness.app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`)).status).toBe(200);
    }
  });

  it('requires an authenticated user for protected routes', async () => {
    const response = await request(harness.app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('rejects expired authentication', async () => {
    const token = jwt.sign({ id: harness.admin._id }, process.env.JWT_SECRET, { expiresIn: -60 });
    const response = await request(harness.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('rejects tokens for deleted users', async () => {
    await harness.User.deleteOne({ _id: harness.admin._id });
    const response = await request(harness.app).get('/api/auth/me').set('Authorization', harness.adminAuthorization);
    expect(response.status).toBe(401);
  });

  it('resolves current authorization from the database, not a JWT role claim', async () => {
    const forgedRoleClaim = jwt.sign({ id: harness.patient._id, role: 'admin' }, process.env.JWT_SECRET);
    const response = await request(harness.app).get('/api/auth/me').set('Authorization', `Bearer ${forgedRoleClaim}`);
    expect(response.status).toBe(200);
    expect(response.body.role).toBe('patient');
    expect(response.body).not.toHaveProperty('password');
  });
});
