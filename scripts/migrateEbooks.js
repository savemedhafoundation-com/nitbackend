require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Ebook = require('../src/models/Ebook');
const EbookUpload = require('../src/models/EbookUpload');

async function migrate() {
  await connectDB();
  // Additive and idempotent. Never drop existing application indexes or data.
  await Ebook.createIndexes();
  await EbookUpload.createIndexes();
  console.log('Ebook metadata collections and indexes are ready. No PDF binary data is stored.');
}

migrate().catch(() => {
  console.error('Ebook migration failed. Check database access and configuration.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
