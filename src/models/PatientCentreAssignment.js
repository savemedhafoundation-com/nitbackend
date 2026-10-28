const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  centre: { type: mongoose.Schema.Types.ObjectId, ref: 'Centre', required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  active: { type: Boolean, default: true },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ patient: 1, centre: 1 }, { unique: true });
schema.index({ centre: 1, active: 1, patient: 1 });
module.exports = mongoose.model('PatientCentreAssignment', schema);
