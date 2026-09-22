import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { getEbookConfig } = require('../src/config/ebookConfig');

describe('ebook storage configuration', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('defaults to a private store and a 500 MiB maximum', () => {
    vi.stubEnv('EBOOK_MAX_SIZE_BYTES', '');
    const config = getEbookConfig();
    expect(config.maxPdfSizeBytes).toBe(524_288_000);
    expect(config.maxPdfSizeLabel).toBe('500 MB');
    expect(config.access).toBe('private');
  });

  it('uses a configured lower limit consistently in bytes and displayed label', () => {
    vi.stubEnv('EBOOK_MAX_SIZE_BYTES', String(32 * 1_048_576));
    expect(getEbookConfig()).toMatchObject({ maxPdfSizeBytes: 33_554_432, maxPdfSizeLabel: '32 MB' });
  });

  it.each(['0', '-1', '4.5', 'NaN', 'Infinity', '524288001', '9007199254740992'])(
    'fails closed for an invalid or over-limit configuration (%s)', value => {
      vi.stubEnv('EBOOK_MAX_SIZE_BYTES', value);
      expect(() => getEbookConfig()).toThrow(/configuration is invalid/i);
    },
  );

  it('does not return the storage token in client configuration', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'server-only-secret');
    const config = getEbookConfig();
    expect(config.storageConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain('server-only-secret');
  });
});
