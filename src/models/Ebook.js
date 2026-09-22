const mongoose = require('mongoose');
const { MAX_PDF_SIZE_BYTES, EBOOK_STATUSES } = require('../config/ebookConfig');

const ebookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  author: { type: String, trim: true, maxlength: 160, default: '' },
  description: { type: String, trim: true, maxlength: 10000, default: '' },
  category: { type: String, trim: true, maxlength: 100, default: '' },
  tags: { type: [String], default: [], validate: value => value.length <= 20 && value.every(tag => tag.length <= 60) },
  coverBlobUrl: { type: String, default: '' },
  coverBlobPathname: { type: String, default: '' },
  pdfBlobUrl: { type: String, default: '' },
  pdfBlobPathname: { type: String, default: '' },
  pdfSizeBytes: { type: Number, min: 0, max: MAX_PDF_SIZE_BYTES, default: 0 },
  mimeType: { type: String, enum: ['', 'application/pdf'], default: '' },
  status: { type: String, enum: EBOOK_STATUSES, default: 'DRAFT', index: true },
  isPublished: { type: Boolean, default: false, index: true },
  allowDownload: { type: Boolean, default: true },
  publicationDate: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pendingPdfUpload: { type: mongoose.Schema.Types.ObjectId, ref: 'EbookUpload', default: null },
  pendingCoverUpload: { type: mongoose.Schema.Types.ObjectId, ref: 'EbookUpload', default: null },
  // Durable outbox: paths are recorded in the same atomic update that replaces an asset.
  // Failed Blob deletions are retried without ever deleting the new active asset.
  cleanupBlobPathnames: { type: [String], default: [] },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

ebookSchema.index({ isPublished: 1, status: 1, deletedAt: 1, createdAt: -1 });
ebookSchema.index({ category: 1, createdAt: -1 });
ebookSchema.index({ createdAt: -1 });
ebookSchema.index({ title: 1 });
ebookSchema.index({ title: 'text', author: 'text', tags: 'text' });
ebookSchema.index({ deletedAt: 1 });

module.exports = mongoose.model('Ebook', ebookSchema);
