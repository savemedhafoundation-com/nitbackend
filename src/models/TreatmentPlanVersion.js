const mongoose = require('mongoose');
const { content } = require('./treatmentSchemas');
const schema = new mongoose.Schema({
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'PatientTreatmentPlan', required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', required: true },
  version: { type: Number, required: true },
  content: { type: content, required: true },
  amendmentReason: { type: String, required: true },
  authoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  signedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  signerName: { type: String, required: true },
  signedAt: { type: Date, required: true },
  previousHash: { type: String, default: '' },
  contentHash: { type: String, required: true },
  signatureMethod: { type: String, default: 'authenticated-password-attestation' },
}, { versionKey: false });
schema.index({ plan: 1, version: 1 }, { unique: true });
schema.index({ patient: 1, signedAt: -1 });
schema.pre('save', function (next) { return next(this.isNew ? undefined : new Error('Signed treatment versions cannot be changed.')); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  schema.pre(operation, function (next) { next(new Error('Signed treatment versions cannot be changed.')); });
}
schema.pre('deleteOne', { document: true, query: false }, function (next) { next(new Error('Signed treatment versions cannot be changed.')); });
schema.pre('bulkWrite', function (next) { next(new Error('Signed treatment versions cannot be changed.')); });
module.exports = mongoose.model('TreatmentPlanVersion', schema);
