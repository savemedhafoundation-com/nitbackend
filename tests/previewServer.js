/* Local browser-test fixture only. Never imported by the application or deployed.
 * Uses a disposable MongoDB and virtual byte-range PDFs, including 500 MiB metadata.
 * No real Blob credentials, cloud writes, or large files are used.
 */
const { randomUUID } = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const express = require('express');

function readerFixture() {
  const streams = [
    'BT /F1 26 Tf 50 720 Td (NIT Ebook Reader) Tj 0 -48 Td /F1 14 Tf (A local browser verification fixture.) Tj 0 -28 Td (This page contains no clinical advice.) Tj ET',
    'BT /F1 26 Tf 50 720 Td (Page two) Tj 0 -48 Td /F1 14 Tf (Page navigation and range requests are working.) Tj ET',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map(stream => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
  ];
  let text = '%PDF-1.7\n';
  const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { prefix: Buffer.from(text), tail: Buffer.from(`\nstartxref\n${xref}\n%%EOF\n`) };
}

async function start() {
  if (process.env.NODE_ENV === 'production') throw new Error('Browser fixtures are only for local tests.');
  const mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  process.env.MONGO_URI = mongo.getUri();
  process.env.JWT_SECRET = randomUUID();
  process.env.CLIENT_URL = 'http://127.0.0.1:5173';
  process.env.ADMIN_URL = 'http://127.0.0.1:5174';
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_preview_not_a_real_credential';
  process.env.EBOOK_MAX_SIZE_BYTES = '524288000';
  await mongoose.connect(mongo.getUri());
  global.mongoose = { conn: mongoose.connection, promise: Promise.resolve(mongoose.connection) };
  const User = require('../src/models/User');
  const Ebook = require('../src/models/Ebook');
  const { prefix, tail } = readerFixture();
  const objects = new Map();
  const blob = require('../src/services/ebookBlobService');
  blob.signReadUrl = async pathname => {
    const object = objects.get(pathname);
    if (!object) throw new Error('Unknown browser fixture');
    return { url: `http://127.0.0.1:5000/fixtures/${object.id}.pdf`, downloadUrl: `http://127.0.0.1:5000/fixtures/${object.id}.pdf?download=1` };
  };
  const admin = await User.create({ name: 'Local Preview Admin', email: 'preview@example.test', password: 'EbookPreviewOnly!', role: 'admin' });
  const items = [
    ['Understanding Natural Immunotherapy', 'NIT Editorial Team', 'Getting started', 'An introduction to the ideas behind natural immunotherapy and the questions you can explore with your care team.', prefix.length],
    ['The Complete Wellness Library', 'NIT Care', 'Wellbeing', 'A virtual 500 MiB PDF fixture for checking that the reader requests only the pages it needs.', 524288000],
    ['A Guide to Reading Health Information', 'NIT Editorial Team', 'Learning resources', 'A reference collection for curious readers. This local preview contains sample metadata and a two-page test document.', prefix.length],
  ];
  for (const [title, author, category, description, size] of items) {
    const id = new mongoose.Types.ObjectId();
    const pathname = `ebooks/${id}/pdf/${randomUUID()}.pdf`;
    objects.set(pathname, { id: String(id), size });
    await Ebook.create({ _id: id, title, author, category, description, createdBy: admin._id, tags: ['Local preview'],
      pdfBlobPathname: pathname, pdfBlobUrl: `https://preview.private.blob.vercel-storage.com/${pathname}`, pdfSizeBytes: size,
      mimeType: 'application/pdf', status: 'PUBLISHED', isPublished: true, publishedAt: new Date('2026-08-24T00:00:00Z') });
  }
  await Ebook.create({ title: 'An upcoming ebook', author: 'NIT Care', createdBy: admin._id });
  const app = express();
  const stats = [];
  app.get('/fixtures/:id.pdf', (req, res) => {
    const object = [...objects.values()].find(item => item.id === req.params.id);
    if (!object) return res.sendStatus(404);
    const size = object.size;
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const from = range ? Number(range[1]) : 0;
    const to = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (from > to || from >= size) return res.sendStatus(416);
    const entry = { size, range: req.headers.range || 'initial GET', bytesSent: 0 };
    stats.push(entry);
    res.status(range ? 206 : 200).set({
      'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range',
      'Content-Type': 'application/pdf', 'Accept-Ranges': 'bytes', 'Content-Length': String(to - from + 1),
      ...(range ? { 'Content-Range': `bytes ${from}-${to}/${size}` } : {}),
      ...(req.query.download ? { 'Content-Disposition': 'attachment; filename="reader-fixture.pdf"' } : {}),
    });
    let position = from;
    function pump() {
      if (res.destroyed || res.writableEnded) return;
      while (position <= to) {
        const count = Math.min(16384, to - position + 1);
        const bytes = Buffer.alloc(count, 32);
        if (position < prefix.length) prefix.copy(bytes, 0, position, Math.min(prefix.length, position + count));
        if (size > prefix.length && position + count > size - tail.length) {
          tail.copy(bytes, Math.max(0, size - tail.length - position), Math.max(0, position - (size - tail.length)));
        }
        position += count;
        entry.bytesSent += count;
        if (!res.write(bytes)) { res.once('drain', pump); return; }
      }
      res.end();
    }
    pump();
  });
  app.get('/fixtures/stats', (_req, res) => res.json(stats));
  app.use((req, res, next) => {
    if (req.path.includes('/uploads')) return res.status(503).json({ message: 'Direct storage uploads are disabled in this local fixture server.' });
    return next();
  });
  app.use(require('../src/app'));
  const server = app.listen(5000, '127.0.0.1', () => console.log('Disposable ebook browser fixture running at http://127.0.0.1:5000 (no real Blob writes).'));
  async function stop() { server.close(); await mongoose.disconnect(); await mongo.stop(); process.exit(0); }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

start().catch(error => { console.error(error.message); process.exitCode = 1; });
