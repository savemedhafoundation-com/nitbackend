import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { googleClientNetwork } = require('../src/middleware/googleRateLimit');
const previous = process.env.VERCEL;
afterEach(() => {
  if (previous === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = previous;
});

describe('Google client-network trust boundary', () => {
  it('ignores all forwarded headers outside the Vercel runtime', () => {
    delete process.env.VERCEL;
    const a = googleClientNetwork({ socket: { remoteAddress: '192.0.2.10' }, headers: { 'x-vercel-forwarded-for': '203.0.113.1', 'x-forwarded-for': '203.0.113.2', 'x-real-ip': '203.0.113.3' } });
    const b = googleClientNetwork({ socket: { remoteAddress: '192.0.2.10' }, headers: { 'x-vercel-forwarded-for': '198.51.100.1' } });
    expect(a).toBe(b);
    expect(a).toContain('192.0.2.10');
  });

  it('separates platform client IPs sharing an internal Vercel proxy', () => {
    process.env.VERCEL = '1';
    const request = address => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-vercel-forwarded-for': address } });
    expect(googleClientNetwork(request('203.0.113.1'))).not.toBe(googleClientNetwork(request('203.0.113.2')));
    expect(googleClientNetwork(request('2001:db8:1234:5600::1'))).toBe(googleClientNetwork(request('2001:db8:1234:56ff::2')));
  });

  it('does not use shared proxy or arbitrary forwarded fallback when platform metadata is absent or malformed', () => {
    process.env.VERCEL = '1';
    for (const value of [undefined, ['203.0.113.1'], '203.0.113.1, 127.0.0.1', 'not-an-ip']) {
      expect(googleClientNetwork({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-vercel-forwarded-for': value, 'x-forwarded-for': '203.0.113.99', 'x-real-ip': '203.0.113.99' } })).toBeNull();
    }
  });
});
