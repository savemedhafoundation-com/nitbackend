const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, immutable: true },
  centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', immutable: true },
  type: { type: String, enum: ['diagnosis', 'previous-treatment', 'allergy', 'medication', 'baseline', 'other'], required: true, immutable: true },
  title: { type: String, required: true, maxlength: 160, immutable: true },
  details: { type: String, required: true, maxlength: 5000, immutable: true },
  occurredOn: { type: String, default: null, immutable: true },
  source: { type: String, enum: ['patient-reported', 'staff-recorded'], required: true, immutable: true },
  authoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  amends: { type: mongoose.Schema.Types.ObjectId, ref: 'PatientHistory', default: null, immutable: true },
  clientRequestId: { type: String, required: true, maxlength: 80, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false });
schema.index({ patient: 1, createdAt: -1, _id: -1 });
schema.index({ patient: 1, authoredBy: 1, clientRequestId: 1 }, { unique: true });
module.exports = mongoose.model('PatientHistory', schema);
