const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      default: '',
    },
    headers: {
      type: [String],
      default: [],
    },
    rows: {
      type: [[String]],
      default: [],
    },
  },
  { _id: false }
);

const graphDatasetSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      trim: true,
      default: '',
    },
    data: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    backgroundColor: {
      type: String,
      trim: true,
      default: '',
    },
    borderColor: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const graphSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      trim: true,
      enum: ['bar', 'line', 'pie', 'doughnut', 'radar', 'scatter', 'area'],
      default: 'bar',
    },
    labels: {
      type: [String],
      default: [],
    },
    datasets: {
      type: [graphDatasetSchema],
      default: [],
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

const resultImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      trim: true,
      required: true,
    },
    publicId: {
      type: String,
      trim: true,
    },
    caption: {
      type: String,
      trim: true,
      default: '',
    },
    altText: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const sectionWithTablesSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      default: '',
    },
    tables: {
      type: [tableSchema],
      default: [],
    },
  },
  { _id: false }
);

const dataAnalysisSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      default: '',
    },
    tables: {
      type: [tableSchema],
      default: [],
    },
    graphs: {
      type: [graphSchema],
      default: [],
    },
  },
  { _id: false }
);

const resultSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      default: '',
    },
    tables: {
      type: [tableSchema],
      default: [],
    },
    images: {
      type: [resultImageSchema],
      default: [],
    },
  },
  { _id: false }
);

const caseStudySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    abstract: {
      type: String,
      default: '',
    },
    introduction: {
      type: String,
      default: '',
    },
    keywords: {
      type: String,
      default: '',
    },
    reviewOfLiterature: {
      type: String,
      default: '',
    },
    researchGap: {
      type: String,
      default: '',
    },
    researchObjectives: {
      type: String,
      default: '',
    },
    researchQuestions: {
      type: String,
      default: '',
    },
    researchHypothesis: {
      type: String,
      default: '',
    },
    caseDescription: {
      type: String,
      default: '',
    },
    methodology: {
      type: sectionWithTablesSchema,
      default: () => ({}),
    },
    observation: {
      type: sectionWithTablesSchema,
      default: () => ({}),
    },
    dataAnalysis: {
      type: dataAnalysisSchema,
      default: () => ({}),
    },
    result: {
      type: resultSchema,
      default: () => ({}),
    },
    ethicalConsideration: {
      type: String,
      default: '',
    },
    discussion: {
      type: String,
      default: '',
    },
    expectedOutcomes: {
      type: String,
      default: '',
    },
    scientificSignificance: {
      type: String,
      default: '',
    },
    limitation: {
      type: String,
      default: '',
    },
    placeOfResearch: {
      type: String,
      default: '',
    },
    conclusion: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
  },
  { timestamps: true }
);

caseStudySchema.index({ title: 'text', abstract: 'text', keywords: 'text' });

module.exports = mongoose.model('CaseStudy', caseStudySchema);
