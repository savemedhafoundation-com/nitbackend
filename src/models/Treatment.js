const mongoose = require('mongoose');

const treatmentSchema = new mongoose.Schema(
  {
    conditionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Condition',
      required: true,
      index: true,
    },
    overview: {
      type: String,
      default: '',
    },
    lifestyle: {
      type: [String],
      default: [],
    },
    diet: {
      type: [String],
      default: [],
    },
    nitApproach: {
      rootCauses: { type: [String], default: [] },
      focusAreas: { type: [String], default: [] },
    },
    precautions: {
      type: [String],
      default: [],
    },
    whenToSeekHelp: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

treatmentSchema.index({ conditionId: 1 }, { unique: true });

const Treatment = mongoose.model('Treatment', treatmentSchema);

module.exports = Treatment;
