const {
  createSession,
  saveSessionSymptoms,
  fetchSymptoms,
  fetchCommonSymptoms,
  matchConditionsForSession,
  getConditionDetails,
  getTreatmentByCondition,
  generateReport,
} = require('../services/symptomCheckerService');

const parseSymptomIds = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
};

const startSession = async (req, res, next) => {
  try {
    const { age, sex } = req.body;

    if (!sex || !['male', 'female'].includes(sex)) {
      return res.status(400).json({ message: 'Sex must be either male or female' });
    }

    const session = await createSession({ age, sex });
    return res.status(201).json({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return next(error);
  }
};

const listSymptoms = async (req, res, next) => {
  try {
    const { age, sex, category, bodyPartId, regionId, search } = req.query;

    const symptoms = await fetchSymptoms({
      age,
      sex,
      category,
      bodyPartId,
      regionId,
      search,
    });

    return res.json({ symptoms });
  } catch (error) {
    return next(error);
  }
};

const listCommonSymptoms = async (req, res, next) => {
  try {
    const { age, sex, selected } = req.query;
    const selectedSymptomIds = parseSymptomIds(selected);

    const symptoms = await fetchCommonSymptoms({ selectedSymptomIds, age, sex });
    return res.json({ symptoms });
  } catch (error) {
    return next(error);
  }
};

const updateSessionSymptoms = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const selectedSymptoms = parseSymptomIds(req.body.selectedSymptoms);

    const session = await saveSessionSymptoms(sessionId, selectedSymptoms);
    return res.json({
      sessionId: session.sessionId,
      selectedSymptoms: session.selectedSymptoms,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404);
    }
    return next(error);
  }
};

const matchConditions = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const selectedSymptoms = parseSymptomIds(req.body.selectedSymptoms);
    const { age, sex } = req.body;

    const conditions = await matchConditionsForSession({
      sessionId,
      selectedSymptomIds: selectedSymptoms,
      age,
      sex,
    });

    return res.json({ conditions });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404);
    }
    return next(error);
  }
};

const getCondition = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const condition = await getConditionDetails(slug);

    if (!condition) {
      return res.status(404).json({ message: 'Condition not found' });
    }

    return res.json({ condition });
  } catch (error) {
    return next(error);
  }
};

const getTreatment = async (req, res, next) => {
  try {
    const { conditionId } = req.params;
    const treatment = await getTreatmentByCondition(conditionId);

    if (!treatment) {
      return res.status(404).json({ message: 'Treatment not found' });
    }

    return res.json({ treatment });
  } catch (error) {
    return next(error);
  }
};

const createReportSnapshot = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    const report = await generateReport(sessionId);
    return res.status(201).json({ report });
  } catch (error) {
    if (error.statusCode === 404) {
      res.status(404);
    }
    return next(error);
  }
};

module.exports = {
  startSession,
  listSymptoms,
  listCommonSymptoms,
  updateSessionSymptoms,
  matchConditions,
  getCondition,
  getTreatment,
  createReportSnapshot,
};
