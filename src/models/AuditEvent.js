const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  action: { type: String, required: true, immutable: true },
  target: { type: String, immutable: true },
  centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', immutable: true },
  requestId: { type: String, required: true, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { versionKey: false });
schema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model('AuditEvent', schema);
