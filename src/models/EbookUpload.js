const mongoose = require('mongoose');
const { MAX_PDF_SIZE_BYTES } = require('../config/ebookConfig');

const ebookUploadSchema = new mongoose.Schema({
  ebook: { type: mongoose.Schema.Types.ObjectId, ref: 'Ebook', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['pdf', 'cover'], required: true },
  pathname: { type: String, required: true, unique: true },
  filename: { type: String, required: true, maxlength: 255 },
  size: { type: Number, required: true, min: 1, max: MAX_PDF_SIZE_BYTES },
  contentType: { type: String, enum: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], required: true },
  status: { type: String, enum: ['UPLOADING', 'PROCESSING', 'COMPLETE', 'FAILED', 'CANCELLED'], default: 'UPLOADING' },
  expiresAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  error: { type: String, default: '' },
  cleanupPending: { type: Boolean, default: false },
}, { timestamps: true });

// No TTL index: removing a session before its Blob is deleted loses the cleanup work.
ebookUploadSchema.index({ status: 1, expiresAt: 1 });
ebookUploadSchema.index({ cleanupPending: 1, updatedAt: 1 });

module.exports = mongoose.model('EbookUpload', ebookUploadSchema);
