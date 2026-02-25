const CaseStudy = require('../models/CaseStudy');
const { saveUploadFile, deleteUploadFile } = require('../utils/fileStorage');

const CASE_STUDY_ROOT_FOLDER = (process.env.CLOUDINARY_CASE_STUDY_FOLDER || 'nit-case-studies').trim();
const CASE_STUDY_RESULT_IMAGE_FOLDER = `${CASE_STUDY_ROOT_FOLDER}/result-images`;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const parseJsonValue = value => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return value;
  }
};

const toRichText = value => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeStringArray = value => {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed.map(item => String(item ?? '').trim()).filter(Boolean);
  }
  if (typeof parsed === 'string') {
    return parsed
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeTables = value => {
  const parsed = parseJsonValue(value);
  const tables = Array.isArray(parsed) ? parsed : isPlainObject(parsed) ? [parsed] : [];

  return tables
    .map(table => {
      const headers = normalizeStringArray(table.headers ?? table.columns ?? []);
      const rawRows = Array.isArray(table.rows) ? table.rows : Array.isArray(table.data) ? table.data : [];
      const rows = rawRows
        .map(row => {
          const cells = Array.isArray(row) ? row : Array.isArray(row?.cells) ? row.cells : [];
          return cells.map(cell => String(cell ?? '').trim());
        })
        .filter(row => row.some(Boolean));

      return {
        title: toRichText(table.title),
        headers,
        rows,
      };
    })
    .filter(table => table.title || table.headers.length > 0 || table.rows.length > 0);
};

const normalizeGraphs = value => {
  const parsed = parseJsonValue(value);
  const graphs = Array.isArray(parsed) ? parsed : isPlainObject(parsed) ? [parsed] : [];
  const allowedTypes = new Set(['bar', 'line', 'pie', 'doughnut', 'radar', 'scatter', 'area']);

  return graphs
    .map(graph => {
      const graphType = String(graph.type || 'bar')
        .trim()
        .toLowerCase();
      const datasets = Array.isArray(graph.datasets)
        ? graph.datasets
            .map(dataset => ({
              label: toRichText(dataset?.label),
              data: Array.isArray(dataset?.data) ? dataset.data : [],
              backgroundColor: toRichText(dataset?.backgroundColor),
              borderColor: toRichText(dataset?.borderColor),
            }))
            .filter(dataset => dataset.label || dataset.data.length > 0)
        : [];

      return {
        title: toRichText(graph.title),
        type: allowedTypes.has(graphType) ? graphType : 'bar',
        labels: normalizeStringArray(graph.labels),
        datasets,
        config: isPlainObject(graph.config) ? graph.config : {},
      };
    })
    .filter(graph => graph.title || graph.labels.length > 0 || graph.datasets.length > 0);
};

const normalizeImages = value => {
  const parsed = parseJsonValue(value);
  const images = Array.isArray(parsed) ? parsed : isPlainObject(parsed) ? [parsed] : [];

  return images
    .map(image => ({
      url: toRichText(image.url),
      publicId: toRichText(image.publicId),
      caption: toRichText(image.caption),
      altText: toRichText(image.altText),
    }))
    .filter(image => image.url);
};

const buildSectionWithTables = (body, key, aliases, options = {}) => {
  const sectionProvided = hasOwn(body, key);
  const contentProvided = aliases.content.some(alias => hasOwn(body, alias));
  const tablesProvided = aliases.tables.some(alias => hasOwn(body, alias));
  const { partial = false } = options;

  if (partial && !sectionProvided && !contentProvided && !tablesProvided) {
    return undefined;
  }

  const sectionPatch = {};
  let sectionValue = {};

  if (sectionProvided) {
    const parsed = parseJsonValue(body[key]);
    if (typeof parsed === 'string') {
      sectionPatch.content = toRichText(parsed);
    } else if (isPlainObject(parsed)) {
      sectionValue = parsed;
    }
  }

  if (contentProvided || hasOwn(sectionValue, 'content')) {
    const alias = aliases.content.find(item => hasOwn(body, item));
    sectionPatch.content = toRichText(alias ? body[alias] : sectionValue.content);
  } else if (!partial && !hasOwn(sectionPatch, 'content')) {
    sectionPatch.content = '';
  }

  if (tablesProvided || hasOwn(sectionValue, 'tables') || hasOwn(sectionValue, 'table')) {
    const alias = aliases.tables.find(item => hasOwn(body, item));
    const source = alias ? body[alias] : sectionValue.tables ?? sectionValue.table;
    sectionPatch.tables = normalizeTables(source);
  } else if (!partial) {
    sectionPatch.tables = [];
  }

  return sectionPatch;
};

const buildSectionWithTablesAndGraphs = (body, key, aliases, options = {}) => {
  const sectionProvided = hasOwn(body, key);
  const contentProvided = aliases.content.some(alias => hasOwn(body, alias));
  const tablesProvided = aliases.tables.some(alias => hasOwn(body, alias));
  const graphsProvided = aliases.graphs.some(alias => hasOwn(body, alias));
  const { partial = false } = options;

  if (partial && !sectionProvided && !contentProvided && !tablesProvided && !graphsProvided) {
    return undefined;
  }

  const sectionPatch = {};
  let sectionValue = {};

  if (sectionProvided) {
    const parsed = parseJsonValue(body[key]);
    if (typeof parsed === 'string') {
      sectionPatch.content = toRichText(parsed);
    } else if (isPlainObject(parsed)) {
      sectionValue = parsed;
    }
  }

  if (contentProvided || hasOwn(sectionValue, 'content')) {
    const alias = aliases.content.find(item => hasOwn(body, item));
    sectionPatch.content = toRichText(alias ? body[alias] : sectionValue.content);
  } else if (!partial && !hasOwn(sectionPatch, 'content')) {
    sectionPatch.content = '';
  }

  if (tablesProvided || hasOwn(sectionValue, 'tables') || hasOwn(sectionValue, 'table')) {
    const alias = aliases.tables.find(item => hasOwn(body, item));
    const source = alias ? body[alias] : sectionValue.tables ?? sectionValue.table;
    sectionPatch.tables = normalizeTables(source);
  } else if (!partial) {
    sectionPatch.tables = [];
  }

  if (graphsProvided || hasOwn(sectionValue, 'graphs') || hasOwn(sectionValue, 'graph')) {
    const alias = aliases.graphs.find(item => hasOwn(body, item));
    const source = alias ? body[alias] : sectionValue.graphs ?? sectionValue.graph;
    sectionPatch.graphs = normalizeGraphs(source);
  } else if (!partial) {
    sectionPatch.graphs = [];
  }

  return sectionPatch;
};

const buildResultSection = (body, options = {}) => {
  const sectionProvided = hasOwn(body, 'result');
  const contentProvided = ['resultContent', 'resultInput'].some(alias => hasOwn(body, alias));
  const tablesProvided = ['resultTables', 'resultTable'].some(alias => hasOwn(body, alias));
  const imagesProvided = ['resultImagesData', 'resultImages'].some(alias => hasOwn(body, alias));
  const { partial = false } = options;

  if (partial && !sectionProvided && !contentProvided && !tablesProvided && !imagesProvided) {
    return undefined;
  }

  const sectionPatch = {};
  let sectionValue = {};

  if (sectionProvided) {
    const parsed = parseJsonValue(body.result);
    if (typeof parsed === 'string') {
      sectionPatch.content = toRichText(parsed);
    } else if (isPlainObject(parsed)) {
      sectionValue = parsed;
    }
  }

  if (contentProvided || hasOwn(sectionValue, 'content')) {
    sectionPatch.content = toRichText(body.resultContent ?? body.resultInput ?? sectionValue.content);
  } else if (!partial && !hasOwn(sectionPatch, 'content')) {
    sectionPatch.content = '';
  }

  if (tablesProvided || hasOwn(sectionValue, 'tables') || hasOwn(sectionValue, 'table')) {
    sectionPatch.tables = normalizeTables(
      body.resultTables ?? body.resultTable ?? sectionValue.tables ?? sectionValue.table
    );
  } else if (!partial) {
    sectionPatch.tables = [];
  }

  if (imagesProvided || hasOwn(sectionValue, 'images')) {
    sectionPatch.images = normalizeImages(body.resultImagesData ?? body.resultImages ?? sectionValue.images);
  } else if (!partial) {
    sectionPatch.images = [];
  }

  return sectionPatch;
};

const normalizeStatus = value => {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized !== 'draft' && normalized !== 'published') {
    const error = new Error('status must be either draft or published');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

const buildCaseStudyPayload = (body, options = {}) => {
  const { partial = false } = options;
  const payload = {};
  const richTextFields = [
    'title',
    'abstract',
    'introduction',
    'keywords',
    'reviewOfLiterature',
    'researchGap',
    'researchObjectives',
    'researchQuestions',
    'researchHypothesis',
    'caseDescription',
    'ethicalConsideration',
    'discussion',
    'expectedOutcomes',
    'scientificSignificance',
    'limitation',
    'placeOfResearch',
    'conclusion',
  ];

  richTextFields.forEach(field => {
    if (!partial || hasOwn(body, field)) {
      payload[field] = toRichText(body[field]);
    }
  });

  const status = normalizeStatus(body.status);
  if (!partial || status !== undefined) {
    payload.status = status || 'draft';
  }

  const methodology = buildSectionWithTables(
    body,
    'methodology',
    {
      content: ['methodologyContent', 'methodologyInput'],
      tables: ['methodologyTables', 'methodologyTable'],
    },
    options
  );
  if (methodology) payload.methodology = methodology;

  const observation = buildSectionWithTables(
    body,
    'observation',
    {
      content: ['observationContent', 'observationInput'],
      tables: ['observationTables', 'observationTable'],
    },
    options
  );
  if (observation) payload.observation = observation;

  const dataAnalysis = buildSectionWithTablesAndGraphs(
    body,
    'dataAnalysis',
    {
      content: ['dataAnalysisContent', 'dataAnalysisInput'],
      tables: ['dataAnalysisTables', 'dataAnalysisTable'],
      graphs: ['dataAnalysisGraphs', 'dataAnalysisGraph'],
    },
    options
  );
  if (dataAnalysis) payload.dataAnalysis = dataAnalysis;

  const result = buildResultSection(body, options);
  if (result) payload.result = result;

  return payload;
};

const toSectionObject = value => {
  if (!value) return {};
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
};

const mergeSection = (currentValue, patchValue) => {
  const current = toSectionObject(currentValue);
  const patch = patchValue || {};
  return {
    ...current,
    ...patch,
  };
};

const applyPayloadToCaseStudy = (caseStudy, payload) => {
  const textFields = [
    'title',
    'abstract',
    'introduction',
    'keywords',
    'reviewOfLiterature',
    'researchGap',
    'researchObjectives',
    'researchQuestions',
    'researchHypothesis',
    'caseDescription',
    'ethicalConsideration',
    'discussion',
    'expectedOutcomes',
    'scientificSignificance',
    'limitation',
    'placeOfResearch',
    'conclusion',
    'status',
  ];

  textFields.forEach(field => {
    if (hasOwn(payload, field)) {
      caseStudy[field] = payload[field];
    }
  });

  if (hasOwn(payload, 'methodology')) {
    caseStudy.methodology = mergeSection(caseStudy.methodology, payload.methodology);
  }
  if (hasOwn(payload, 'observation')) {
    caseStudy.observation = mergeSection(caseStudy.observation, payload.observation);
  }
  if (hasOwn(payload, 'dataAnalysis')) {
    caseStudy.dataAnalysis = mergeSection(caseStudy.dataAnalysis, payload.dataAnalysis);
  }
  if (hasOwn(payload, 'result')) {
    caseStudy.result = mergeSection(caseStudy.result, payload.result);
  }
};

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCaseStudies = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = String(req.query.status).trim().toLowerCase();
    }
    if (req.query.q) {
      const pattern = new RegExp(escapeRegex(String(req.query.q).trim()), 'i');
      filter.$or = [{ title: pattern }, { keywords: pattern }, { abstract: pattern }];
    }

    const [items, total] = await Promise.all([
      CaseStudy.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      CaseStudy.countDocuments(filter),
    ]);

    return res.status(200).json({
      data: items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const getCaseStudyById = async (req, res, next) => {
  try {
    const caseStudy = await CaseStudy.findById(req.params.id);
    if (!caseStudy) {
      return res.status(404).json({ message: 'Case study not found' });
    }
    return res.status(200).json(caseStudy);
  } catch (error) {
    return next(error);
  }
};

const createCaseStudy = async (req, res, next) => {
  try {
    const payload = buildCaseStudyPayload(req.body, { partial: false });
    if (!payload.title) {
      return res.status(400).json({ message: 'title is required' });
    }

    const uploadedResultImages = await Promise.all(
      (req.files?.resultImages || []).map(file =>
        saveUploadFile(file, { folder: CASE_STUDY_RESULT_IMAGE_FOLDER })
      )
    );

    if (uploadedResultImages.length > 0) {
      payload.result = payload.result || {};
      payload.result.images = [
        ...(payload.result.images || []),
        ...uploadedResultImages.map(image => ({
          url: image.url,
          publicId: image.publicId,
          caption: '',
          altText: '',
        })),
      ];
    }

    const caseStudy = await CaseStudy.create(payload);
    return res.status(201).json(caseStudy);
  } catch (error) {
    if (error.statusCode) {
      res.status(error.statusCode);
    }
    return next(error);
  }
};

const updateCaseStudy = async (req, res, next) => {
  try {
    const caseStudy = await CaseStudy.findById(req.params.id);
    if (!caseStudy) {
      return res.status(404).json({ message: 'Case study not found' });
    }

    const payload = buildCaseStudyPayload(req.body, { partial: true });
    applyPayloadToCaseStudy(caseStudy, payload);

    const removeResultImagePublicIds = normalizeStringArray(req.body.removeResultImagePublicIds);
    if (removeResultImagePublicIds.length > 0) {
      const removeSet = new Set(removeResultImagePublicIds);
      const currentImages = Array.isArray(caseStudy.result?.images) ? caseStudy.result.images : [];
      const removed = currentImages.filter(image => image?.publicId && removeSet.has(image.publicId));
      const remaining = currentImages.filter(image => !image?.publicId || !removeSet.has(image.publicId));

      await Promise.all(removed.map(image => deleteUploadFile(image.publicId)));
      caseStudy.result = mergeSection(caseStudy.result, { images: remaining });
    }

    const uploadedResultImages = await Promise.all(
      (req.files?.resultImages || []).map(file =>
        saveUploadFile(file, { folder: CASE_STUDY_RESULT_IMAGE_FOLDER })
      )
    );

    if (uploadedResultImages.length > 0) {
      const currentImages = Array.isArray(caseStudy.result?.images) ? caseStudy.result.images : [];
      caseStudy.result = mergeSection(caseStudy.result, {
        images: [
          ...currentImages,
          ...uploadedResultImages.map(image => ({
            url: image.url,
            publicId: image.publicId,
            caption: '',
            altText: '',
          })),
        ],
      });
    }

    if (!caseStudy.title) {
      return res.status(400).json({ message: 'title is required' });
    }

    await caseStudy.save();
    return res.status(200).json(caseStudy);
  } catch (error) {
    if (error.statusCode) {
      res.status(error.statusCode);
    }
    return next(error);
  }
};

const deleteCaseStudy = async (req, res, next) => {
  try {
    const caseStudy = await CaseStudy.findById(req.params.id);
    if (!caseStudy) {
      return res.status(404).json({ message: 'Case study not found' });
    }

    const images = Array.isArray(caseStudy.result?.images) ? caseStudy.result.images : [];
    await Promise.all(
      images.filter(image => image?.publicId).map(image => deleteUploadFile(image.publicId))
    );

    await caseStudy.deleteOne();
    return res.status(200).json({ message: 'Case study deleted' });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCaseStudies,
  getCaseStudyById,
  createCaseStudy,
  updateCaseStudy,
  deleteCaseStudy,
};
