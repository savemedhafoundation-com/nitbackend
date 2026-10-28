const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', required: true },
  capabilities: { type: [String], default: [] },
  active: { type: Boolean, default: true },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ user: 1, centre: 1 }, { unique: true });

module.exports = mongoose.model('CentreMembership', schema);
