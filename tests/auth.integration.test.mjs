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
