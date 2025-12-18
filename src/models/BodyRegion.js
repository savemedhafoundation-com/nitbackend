const mongoose = require('mongoose');

const bodyRegionSchema = new mongoose.Schema(
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
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const BodyRegion = mongoose.model('BodyRegion', bodyRegionSchema);

module.exports = BodyRegion;
