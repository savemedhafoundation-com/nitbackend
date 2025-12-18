const mongoose = require('mongoose');

const conditionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      default: '',
    },
    overview: {
      type: String,
      default: '',
    },
    allowedSex: {
      type: String,
      enum: ['any', 'male', 'female'],
      default: 'any',
    },
    ageRange: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 120 },
    },
    symptoms: [
      {
        symptomId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Symptom',
          required: true,
        },
        weight: {
          type: Number,
          default: 1,
          min: 0,
        },
      },
    ],
    prevalence: {
      type: String,
      default: '',
    },
    riskFactors: {
      type: [String],
      default: [],
    },
    whenToSeekHelp: {
      type: String,
      default: '',
    },
    nitPerspective: {
      type: String,
      default: '',
    },
    commonSymptoms: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

conditionSchema.index({ 'symptoms.symptomId': 1 });

const Condition = mongoose.model('Condition', conditionSchema);

module.exports = Condition;
