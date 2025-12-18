const crypto = require('crypto');
const mongoose = require('mongoose');

const userSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      default: () => crypto.randomUUID(),
      unique: true,
      index: true,
    },
    age: {
      type: Number,
      required: true,
      min: 0,
      max: 120,
    },
    sex: {
      type: String,
      enum: ['male', 'female'],
      required: true,
    },
    selectedSymptoms: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Symptom',
      },
    ],
    matchedConditions: [
      {
        condition: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Condition',
        },
        name: String,
        slug: String,
        score: Number,
        matchLevel: {
          type: String,
          enum: ['Low', 'Fair', 'Moderate', 'High'],
        },
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  },
  { timestamps: false }
);

userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const UserSession = mongoose.model('UserSession', userSessionSchema);

module.exports = UserSession;
