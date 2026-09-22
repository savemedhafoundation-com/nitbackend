require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const { runCleanup } = require('../src/services/ebookService');

async function cleanup() {
  await connectDB();
  const result = await runCleanup();
  console.log('Ebook cleanup completed:', result);
}

cleanup().catch(() => {
  console.error('Ebook cleanup failed. Pending work is retained for retry.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
