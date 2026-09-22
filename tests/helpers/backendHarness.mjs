import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { vi } from 'vitest';

const require = createRequire(import.meta.url);

export const MAX_PDF_BYTES = 524_288_000;
export const TEST_BLOB_TOKEN = 'vercel_blob_rw_ebooktest_not_a_real_credential';
export const TEST_BLOB_ORIGIN = 'https://ebooktest.private.blob.vercel-storage.com';

/** A real, tiny one-page PDF. Large upload tests only change mocked HEAD size. */
export function tinyPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let source = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source += 'xref\n0 5\n0000000000 65535 f \n';
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

function pathnameOf(value) {
  const text = String(value);
  return text.startsWith('https://') ? decodeURIComponent(new URL(text).pathname.slice(1)) : text;
}

/** Replace only CommonJS SDK boundaries; routes, middleware, services and Mongo stay real. */
export function installBlobMock() {
  // Vitest isolates ES modules; Node's CommonJS cache needs explicit isolation at these boundaries.
  for (const moduleName of ['ebookBlobService', 'ebookService']) {
    try { delete require.cache[require.resolve(`../../src/services/${moduleName}`)]; } catch { /* The module may not exist in an initial migration test. */ }
  }
  for (const moduleName of ['../../src/controllers/ebookController', '../../src/routes/ebookRoutes']) {
    try { delete require.cache[require.resolve(moduleName)]; } catch { /* Optional for auth-only tests. */ }
  }
  const sdkPath = require.resolve('@vercel/blob');
  const clientPath = require.resolve('@vercel/blob/client');
  const realSdk = require(sdkPath);
  const realClient = require(clientPath);
  const realFetch = globalThis.fetch;
  const objects = new Map();
  let tokenSequence = 0;

  const lookup = value => {
    const object = objects.get(pathnameOf(value));
    if (!object) throw new realSdk.BlobNotFoundError();
    return object;
  };

  const metadata = object => ({
    url: `${TEST_BLOB_ORIGIN}/${object.pathname}`,
    downloadUrl: `${TEST_BLOB_ORIGIN}/${object.pathname}?download=1`,
    pathname: object.pathname,
    size: object.size,
    contentType: object.contentType,
    contentDisposition: 'inline',
    cacheControl: 'public, max-age=60',
    uploadedAt: new Date(),
    etag: 'test-etag',
    ...object.metadata,
  });

  const sdk = {
    ...realSdk,
    head: vi.fn(async value => metadata(lookup(value))),
    del: vi.fn(async values => {
      for (const value of Array.isArray(values) ? values : [values]) {
        objects.delete(pathnameOf(value));
      }
    }),
    list: vi.fn(async ({ prefix = '' } = {}) => ({
      blobs: [...objects.values()].filter(object => object.pathname.startsWith(prefix)).map(metadata),
      cursor: undefined,
      hasMore: false,
    })),
    issueSignedToken: vi.fn(async options => ({
      delegationToken: 'test-delegation',
      clientSigningToken: 'test-signing-material-never-returned',
      validUntil: options.validUntil,
    })),
    presignUrl: vi.fn(async (_token, options) => ({
      presignedUrl: `${TEST_BLOB_ORIGIN}/${options.pathname}?vercel-blob-signature=test-read&expires=${options.validUntil}`,
    })),
  };
  const client = {
    ...realClient,
    generateClientTokenFromReadWriteToken: vi.fn(async () => `vercel_blob_client_test_${++tokenSequence}`),
    // The SDK's real callback verifier is intentionally preserved for forged-callback tests.
  };

  require.cache[sdkPath].exports = sdk;
  require.cache[clientPath].exports = client;

  const fetchMock = vi.fn(async (input, options = {}) => {
    const target = new URL(String(input));
    if (target.origin !== TEST_BLOB_ORIGIN) {
      throw new Error('Unexpected external network request in storage test');
    }
    const object = lookup(target.href);
    const headers = new Headers(options.headers);
    const range = headers.get('range');
    let from = 0;
    let to = object.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response(null, { status: 416 });
      if (match[1]) {
        from = Number(match[1]);
        to = match[2] ? Math.min(Number(match[2]), to) : to;
      } else {
        from = Math.max(0, object.size - Number(match[2]));
      }
    }
    if (object.response) return object.response({ from, to, range, headers });
    if (to - from + 1 > 1_048_576) {
      throw new Error('Validation attempted an unbounded PDF download');
    }
    const bytes = Buffer.alloc(Math.max(0, to - from + 1), 32);
    if (object.size === object.bytes.length) {
      object.bytes.copy(bytes, 0, from, to + 1);
    } else {
      // A sparse virtual PDF supports byte ranges without ever allocating its advertised size.
      if (from < object.bytes.length) object.bytes.copy(bytes, 0, from, Math.min(object.bytes.length, to + 1));
      const xref = /startxref\s+(\d+)/.exec(object.bytes.toString('latin1'))?.[1] || '0';
      const trailer = Buffer.from(`\nstartxref\n${xref}\n%%EOF\n`);
      const trailerStart = object.size - trailer.length;
      if (to >= trailerStart) {
        trailer.copy(bytes, Math.max(0, trailerStart - from), Math.max(0, from - trailerStart));
      }
    }
    return new Response(bytes, {
      status: range ? 206 : 200,
      headers: {
        'content-type': object.contentType,
        'content-length': String(bytes.length),
        'accept-ranges': 'bytes',
        ...(range ? { 'content-range': `bytes ${from}-${to}/${object.size}` } : {}),
      },
    });
  });
  globalThis.fetch = fetchMock;

  return {
    sdk,
    client,
    realClient,
    objects,
    fetch: fetchMock,
    put(pathname, { size, bytes = tinyPdf(), contentType = 'application/pdf', metadata: overrides, response } = {}) {
      const object = { pathname, bytes, size: size ?? bytes.length, contentType, metadata: overrides, response };
      objects.set(pathname, object);
      return metadata(object);
    },
    callbackSignature(body) {
      return createHmac('sha256', TEST_BLOB_TOKEN).update(JSON.stringify(body)).digest('hex');
    },
    reset() {
      objects.clear();
      for (const mock of [...Object.values(sdk), ...Object.values(client), fetchMock]) {
        if (vi.isMockFunction(mock)) mock.mockClear();
      }
    },
    restore() {
      require.cache[sdkPath].exports = realSdk;
      require.cache[clientPath].exports = realClient;
      globalThis.fetch = realFetch;
    },
  };
}

export async function createBackendHarness({ ebooks = false } = {}) {
  const previousEnv = {};
  const testEnv = {
    NODE_ENV: 'test',
    JWT_SECRET: 'ebook-test-jwt-secret-used-only-in-local-tests',
    BLOB_READ_WRITE_TOKEN: TEST_BLOB_TOKEN,
    EBOOK_MAX_SIZE_BYTES: String(MAX_PDF_BYTES),
    EBOOK_BLOB_ACCESS: 'private',
    EBOOK_UPLOAD_CALLBACK_URL: 'https://ebook-test.example/api/ebooks/blob-callback',
    CRON_SECRET: 'ebook-test-cron-secret',
  };
  for (const [key, value] of Object.entries(testEnv)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }

  const server = await MongoMemoryServer.create({
    // Windows/CI hosts may be busy starting the frontend checks at the same time.
    instance: { dbName: 'ebook_feature_tests', ip: '127.0.0.1', launchTimeout: 60_000 },
  });
  await mongoose.connect(server.getUri());
  const storage = installBlobMock();
  const User = require('../../src/models/User');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/auth', require('../../src/routes/authRoutes'));
  let Ebook;
  let EbookUpload;
  if (ebooks) {
    const { ebookRouter, adminEbookRouter, ebookInternalRouter } = require('../../src/routes/ebookRoutes');
    app.use('/api/ebooks', ebookRouter);
    app.use('/api/admin/ebooks', adminEbookRouter);
    app.use('/api/internal/ebooks', ebookInternalRouter);
    Ebook = require('../../src/models/Ebook');
    EbookUpload = require('../../src/models/EbookUpload');
  }
  const { notFound, errorHandler } = require('../../src/middleware/errorHandler');
  app.use(notFound);
  app.use(errorHandler);

  const harness = {
    app,
    storage,
    User,
    Ebook,
    EbookUpload,
    admin: undefined,
    patient: undefined,
    adminAuthorization: undefined,
    patientAuthorization: undefined,
    async reset() {
      await Promise.all(Object.values(mongoose.models).map(model => model.deleteMany({})));
      storage.reset();
      const users = [
        { _id: new mongoose.Types.ObjectId(), name: 'Test Admin', email: 'ebook-admin@example.test', password: 'unused-test-hash', role: 'admin' },
        { _id: new mongoose.Types.ObjectId(), name: 'Test Reader', email: 'ebook-reader@example.test', password: 'unused-test-hash', role: 'patient' },
      ];
      await User.collection.insertMany(users);
      [harness.admin, harness.patient] = users;
      harness.adminAuthorization = `Bearer ${jwt.sign({ id: users[0]._id }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
      harness.patientAuthorization = `Bearer ${jwt.sign({ id: users[1]._id }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
    },
    async close() {
      storage.restore();
      await mongoose.disconnect();
      await server.stop();
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
  return harness;
}
