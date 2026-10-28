import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);
const { getApps, deleteApp } = require('firebase-admin/app');
const sdkRoot = dirname(dirname(require.resolve('firebase-admin/app')));
const { HttpClient } = require(join(sdkRoot, 'utils/api-request.js'));
const service = require('../src/services/firebaseAuth');

describe('real Firebase Admin signature and identity verification', () => {
  let keys;
  let otherKeys;
  let requestSpy;
  const previous = { project: process.env.FIREBASE_PROJECT_ID, emulator: process.env.FIREBASE_AUTH_EMULATOR_HOST };
  beforeAll(() => {
    keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  });
  beforeEach(() => {
    process.env.FIREBASE_PROJECT_ID = 'nitauth';
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    // Only Google's certificate transport is replaced. Actual Admin SDK
    // claims, RSA signature, expiry and audience/issuer verification run.
    requestSpy = vi.spyOn(HttpClient.prototype, 'send').mockImplementation(async request => {
      if (request.url !== 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com') throw new Error('Unexpected external network request');
      return { isJson: () => true, data: { 'qa-google-key': keys.publicKey }, headers: { 'cache-control': 'max-age=3600' } };
    });
  });
  afterEach(async () => {
    requestSpy.mockRestore();
    await Promise.all(getApps().filter(app => app.name === 'patient-auth').map(deleteApp));
  });
  afterAll(() => {
    if (previous.project === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previous.project;
    if (previous.emulator === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous.emulator;
  });
  const token = (patch = {}, key = keys.privateKey, options = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign({ aud: 'nitauth', iss: 'https://securetoken.google.com/nitauth', sub: 'google-verified-subject', email: 'verified@example.test', email_verified: true, name: 'Verified Patient', firebase: { sign_in_provider: 'google.com' }, auth_time: now - 10, iat: now - 5, exp: now + 600, ...patch }, key, { algorithm: 'RS256', keyid: 'qa-google-key', ...options });
  };

  it('accepts a valid RSA-signed Firebase Google token and derives uid from its verified subject', async () => {
    const identity = await service.verifyGoogleToken(token({ uid: 'untrusted-custom-uid' }));
    expect(identity.uid).toBe('google-verified-subject');
    expect(identity.sub).toBe(identity.uid);
    expect(identity.email).toBe('verified@example.test');
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects forged signatures, non-RSA algorithms, unknown keys and malformed tokens', async () => {
    for (const value of [
      token({}, otherKeys.privateKey),
      token({}, 'test-hmac-secret', { algorithm: 'HS256' }),
      token({}, keys.privateKey, { keyid: 'unknown-key' }),
      'not-a-jwt',
    ]) await expect(service.verifyGoogleToken(value)).rejects.toThrow();
  });

  it('rejects wrong project/audience/issuer and invalid token times', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const patch of [
      { aud: 'another-project' }, { iss: 'https://securetoken.google.com/another-project' },
      { exp: now - 1 }, { iat: now + 60 }, { auth_time: now + 60 },
      { auth_time: undefined }, { auth_time: 'not-a-time' },
    ]) await expect(service.verifyGoogleToken(token(patch))).rejects.toThrow();
  });

  it('requires strictly verified email, Google provider and a valid subject and email', async () => {
    for (const patch of [
      { email_verified: false }, { email_verified: 'true' },
      { firebase: { sign_in_provider: 'password' } }, { firebase: undefined },
      { email: undefined }, { email: { address: 'verified@example.test' } }, { email: 'invalid-email' },
      { sub: '' }, { sub: 'x'.repeat(129) }, { name: { text: 'invalid' } },
    ]) await expect(service.verifyGoogleToken(token(patch))).rejects.toThrow();
  });

  it('rejects emulator configuration before any token verification or certificate request', async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    await expect(service.verifyGoogleToken(token())).rejects.toThrow('emulator');
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('fails closed if the configured project changes within a reused process', async () => {
    await service.verifyGoogleToken(token());
    process.env.FIREBASE_PROJECT_ID = 'another-project';
    await expect(service.verifyGoogleToken(token({ aud: 'another-project', iss: 'https://securetoken.google.com/another-project' }))).rejects.toThrow('configuration changed');
  });
});
