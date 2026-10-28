const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  patientCode: { type: String, required: true, unique: true, immutable: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, default: '', maxlength: 20 },
  email: { type: String, default: '', lowercase: true, trim: true, maxlength: 254 },
  dateOfBirth: { type: String, default: null },
  sex: { type: String, enum: ['unknown', 'female', 'male', 'intersex'], default: 'unknown' },
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true });
schema.index({ user: 1 }, { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } });
schema.index({ name: 1, phone: 1 });
module.exports = mongoose.model('Patient', schema);
