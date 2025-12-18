const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    sessionRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserSession',
    },
    user: {
      age: Number,
      sex: String,
    },
    symptoms: [
      {
        symptomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Symptom' },
        name: String,
        category: String,
      },
    ],
    conditions: [
      {
        conditionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Condition' },
        name: String,
        slug: String,
        score: Number,
        matchLevel: String,
      },
    ],
    treatments: [
      {
        conditionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Condition' },
        name: String,
        overview: String,
        lifestyle: [String],
        diet: [String],
        nitApproach: {
          rootCauses: [String],
          focusAreas: [String],
        },
        precautions: [String],
        whenToSeekHelp: String,
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

const Report = mongoose.model('Report', reportSchema);

module.exports = Report;
