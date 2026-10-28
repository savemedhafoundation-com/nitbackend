const mongoose = require('mongoose');
const item = new mongoose.Schema({
  kind: { type: String, enum: ['booster', 'supplement'], required: true },
  name: { type: String, required: true, maxlength: 160 },
  dose: { type: String, default: '', maxlength: 80 },
  unit: { type: String, default: '', maxlength: 60 },
  route: { type: String, default: '', maxlength: 80 },
  frequency: { type: String, default: '', maxlength: 160 },
  duration: { type: String, default: '', maxlength: 160 },
  instructions: { type: String, default: '', maxlength: 1000 },
}, { _id: false });
const content = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 160 },
  nutrition: { type: String, default: '', maxlength: 10000 },
  items: { type: [item], default: [] },
  notes: { type: String, default: '', maxlength: 5000 },
  concurrentTreatments: { type: String, default: '', maxlength: 5000 },
  adverseEvents: { type: String, default: '', maxlength: 5000 },
  startsOn: { type: String, default: null }, endsOn: { type: String, default: null },
  status: { type: String, enum: ['active', 'discontinued'], default: 'active' },
  stopReason: { type: String, default: '', maxlength: 2000 },
}, { _id: false });
module.exports = { content };
