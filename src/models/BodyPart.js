const mongoose = require('mongoose');

const bodyPartSchema = new mongoose.Schema(
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
    regionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BodyRegion',
      required: true,
      index: true,
    },
    synonyms: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

bodyPartSchema.index({ regionId: 1, name: 1 });

const BodyPart = mongoose.model('BodyPart', bodyPartSchema);

module.exports = BodyPart;
