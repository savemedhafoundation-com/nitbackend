const mongoose = require('mongoose');

const symptomSchema = new mongoose.Schema(
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
    category: {
      type: String,
      required: true,
      trim: true,
    },
    bodyPartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BodyPart',
    },
    common: {
      type: Boolean,
      default: false,
    },
    synonyms: {
      type: [String],
      default: [],
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
    redFlag: {
      type: Boolean,
      default: false,
    },
    searchableText: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

symptomSchema.index(
  { searchableText: 'text', name: 'text', synonyms: 'text' },
  { weights: { name: 5, synonyms: 3, searchableText: 1 } }
);
symptomSchema.index({ category: 1, allowedSex: 1 });

const Symptom = mongoose.model('Symptom', symptomSchema);

module.exports = Symptom;
