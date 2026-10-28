const mongoose = require('mongoose');
const { content } = require('./treatmentSchemas');
const draft = new mongoose.Schema({
  content: { type: content, required: true },
  baseVersion: { type: Number, required: true },
  amendmentReason: { type: String, default: '', maxlength: 2000 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });
const schema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, immutable: true },
  centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  clientRequestId: { type: String, required: true, immutable: true },
  createHash: { type: String, required: true, immutable: true },
  draft: { type: draft, default: null },
  revision: { type: Number, default: 1 },
  signedVersion: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ patient: 1, centre: 1, createdAt: -1, _id: -1 });
schema.index({ patient: 1, centre: 1, createdBy: 1, clientRequestId: 1 }, { unique: true });
module.exports = mongoose.model('PatientTreatmentPlan', schema);
