const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    comment: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: [String],
      default: [],
    },
    videoLinks: {
      type: [String],
      default: [],
    },
    spotlight: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
    },
    imagePublicId: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    cancerStage: {
      type: String,
      required: false,
      enum: ['ANY', 'IN TREATMENT', 'NEWLY TREATMENT', 'POST TREATMENT'],
      default: 'ANY',
    },
    writtenBy: {
      type: String,
      required: true,
      trim: true,
    },
    comments: [commentSchema],
    faqs: [
      {
        question: {
          type: String,
          trim: true,
        },
        answer: {
          type: String,
          trim: true,
        },
      },
    ],
    viewsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    likesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    sharesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    blogImage: {
      type: [
        {
          imageUrl: {
            type: String,
            required: true,
            trim: true,
          },
          imagePublicId: {
            type: String,
            required: true,
            trim: true,
          },
        },
      ],
      validate: {
        validator: value => Array.isArray(value) && value.length === 2,
        message: 'Exactly two blog images are required.',
      },
      default: [],
    },
    adminStatement: {
      photoUrl: {
        type: String,
        trim: true,
      },
      photoPublicId: {
        type: String,
        trim: true,
      },
      quotation: {
        type: String,
        trim: true,
      },
      name: {
        type: String,
        trim: true,
      },
      designation: {
        type: String,
        trim: true,
      },
    },
  },
  { timestamps: true }
);

blogSchema.index({ title: 'text', metadata: 'text' });

module.exports = mongoose.model('Blog', blogSchema);
