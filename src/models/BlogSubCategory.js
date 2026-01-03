const mongoose = require('mongoose');

const blogSubCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BlogCategory',
      required: true,
    },
  },
  { timestamps: true }
);

blogSubCategorySchema.index({ name: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('BlogSubCategory', blogSubCategorySchema);
