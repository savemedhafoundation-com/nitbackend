const mongoose = require('mongoose');
const BodyPart = require('../models/BodyPart');
const Symptom = require('../models/Symptom');
const Condition = require('../models/Condition');
const Treatment = require('../models/Treatment');
const UserSession = require('../models/UserSession');
const Report = require('../models/Report');

const normalizeAge = value => {
  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric < 0) {
    return null;
  }
  return numeric;
};

const deriveMatchLevel = score => {
  if (score >= 75) return 'High';
  if (score >= 55) return 'Moderate';
  if (score >= 35) return 'Fair';
  return 'Low';
};

const buildAgeSexFilters = (age, sex) => {
  const filters = [];

  if (sex) {
    filters.push({
      $or: [{ allowedSex: 'any' }, { allowedSex: { $exists: false } }, { allowedSex: sex }],
    });
  }

  if (typeof age === 'number') {
    filters.push({
      'ageRange.min': { $lte: age },
    });
    filters.push({
      $or: [
        { 'ageRange.max': { $exists: false } },
        { 'ageRange.max': null },
        { 'ageRange.max': { $gte: age } },
      ],
    });
  }

  return filters;
};

const findSessionByPublicId = async sessionId => {
  if (!sessionId) return null;

  const maybeObjectId = mongoose.isValidObjectId(sessionId);

  const session = await UserSession.findOne({
    $or: [{ sessionId }, ...(maybeObjectId ? [{ _id: sessionId }] : [])],
  });

  return session;
};

const createSession = async ({ age, sex }) => {
  const normalizedAge = normalizeAge(age);
  if (normalizedAge === null) {
    throw new Error('Age must be a valid number');
  }

  const session = await UserSession.create({
    age: normalizedAge,
    sex,
    selectedSymptoms: [],
    matchedConditions: [],
  });

  return session;
};

const saveSessionSymptoms = async (sessionId, symptomIds) => {
  const session = await findSessionByPublicId(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }

  session.selectedSymptoms = symptomIds;
  await session.save();

  return session;
};

const fetchSymptoms = async ({ age, sex, category, bodyPartId, regionId, search }) => {
  const ageNumber = normalizeAge(age);
  const filters = [];

  if (category) {
    filters.push({ category });
  }

  if (bodyPartId) {
    filters.push({ bodyPartId });
  } else if (regionId) {
    const bodyPartIds = await BodyPart.find({ regionId }).distinct('_id');
    if (bodyPartIds.length) {
      filters.push({ bodyPartId: { $in: bodyPartIds } });
    }
  }

  filters.push(...buildAgeSexFilters(ageNumber, sex));

  const query = filters.length ? { $and: filters } : {};

  let symptomQuery = Symptom.find(query).lean();

  if (search && search.trim()) {
    symptomQuery = symptomQuery
      .select({ score: { $meta: 'textScore' }, name: 1, category: 1, bodyPartId: 1, common: 1, redFlag: 1 })
      .find({ $text: { $search: search } })
      .sort({ score: { $meta: 'textScore' }, common: -1, name: 1 });
  } else {
    symptomQuery = symptomQuery.sort({ common: -1, name: 1 });
  }

  const symptoms = await symptomQuery;
  return symptoms;
};

const fetchCommonSymptoms = async ({ selectedSymptomIds = [], age, sex }) => {
  const ageNumber = normalizeAge(age);
  const baseFilters = [{ common: true }, ...buildAgeSexFilters(ageNumber, sex)];
  const selected = selectedSymptomIds.length
    ? await Symptom.find({ _id: { $in: selectedSymptomIds } })
        .select('category bodyPartId')
        .lean()
    : [];

  const categories = [...new Set(selected.map(s => s.category).filter(Boolean))];
  const bodyPartIds = selected.map(s => s.bodyPartId).filter(Boolean);

  if (categories.length) {
    baseFilters.push({ category: { $in: categories } });
  }

  if (bodyPartIds.length) {
    baseFilters.push({ bodyPartId: { $in: bodyPartIds } });
  }

  const common = await Symptom.find({ $and: baseFilters }).sort({ name: 1 }).limit(30).lean();

  if (common.length) {
    return common;
  }

  // Fallback to any common symptoms that match age/sex if the contextual list is empty.
  return Symptom.find({ $and: [{ common: true }, ...buildAgeSexFilters(ageNumber, sex)] })
    .sort({ name: 1 })
    .limit(20)
    .lean();
};

const matchConditionsForSession = async ({ sessionId, selectedSymptomIds, age, sex }) => {
  const session = await findSessionByPublicId(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }

  const ageNumber = normalizeAge(age ?? session.age);
  const sexValue = sex || session.sex;
  const selectedIds = selectedSymptomIds?.length ? selectedSymptomIds : session.selectedSymptoms;
  const selectedSet = new Set(selectedIds.map(id => id.toString()));

  const filters = buildAgeSexFilters(ageNumber, sexValue);
  const conditions = await Condition.find({ $and: filters }).lean();

  const scoredConditions = conditions
    .map(condition => {
      const totalWeight = condition.symptoms.reduce((sum, sym) => sum + (sym.weight || 1), 0) || 1;
      const matchedWeight = condition.symptoms.reduce(
        (sum, sym) => (selectedSet.has(sym.symptomId.toString()) ? sum + (sym.weight || 1) : sum),
        0
      );

      const score = Math.round((matchedWeight / totalWeight) * 100);
      const matchLevel = deriveMatchLevel(score);

      return {
        condition: condition._id,
        name: condition.name,
        slug: condition.slug,
        description: condition.description,
        prevalence: condition.prevalence,
        score,
        matchLevel,
      };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  session.selectedSymptoms = selectedIds;
  session.matchedConditions = scoredConditions;
  await session.save();

  return scoredConditions;
};

const getConditionDetails = async slug => {
  const condition = await Condition.findOne({ slug })
    .populate('symptoms.symptomId', 'name category bodyPartId common redFlag')
    .lean();

  return condition;
};

const getTreatmentByCondition = async conditionId => {
  const treatment = await Treatment.findOne({ conditionId }).lean();
  return treatment;
};

const generateReport = async sessionId => {
  const session = await findSessionByPublicId(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }

  await session.populate('selectedSymptoms', 'name category');

  const conditionIds = session.matchedConditions.map(item => item.condition).filter(Boolean);
  const treatments = conditionIds.length
    ? await Treatment.find({ conditionId: { $in: conditionIds } }).lean()
    : [];

  const conditionNameMap = session.matchedConditions.reduce((acc, cond) => {
    acc[cond.condition?.toString()] = cond.name;
    return acc;
  }, {});

  const reportDoc = await Report.create({
    sessionId: session.sessionId,
    sessionRef: session._id,
    user: { age: session.age, sex: session.sex },
    symptoms: session.selectedSymptoms.map(sym => ({
      symptomId: sym._id,
      name: sym.name,
      category: sym.category,
    })),
    conditions: session.matchedConditions.map(cond => ({
      conditionId: cond.condition,
      name: cond.name,
      slug: cond.slug,
      score: cond.score,
      matchLevel: cond.matchLevel,
    })),
    treatments: treatments.map(treatment => ({
      conditionId: treatment.conditionId,
      name: conditionNameMap[treatment.conditionId.toString()] || 'Condition',
      overview: treatment.overview,
      lifestyle: treatment.lifestyle,
      diet: treatment.diet,
      nitApproach: treatment.nitApproach,
      precautions: treatment.precautions,
      whenToSeekHelp: treatment.whenToSeekHelp,
    })),
    createdAt: new Date(),
  });

  return reportDoc;
};

module.exports = {
  createSession,
  saveSessionSymptoms,
  fetchSymptoms,
  fetchCommonSymptoms,
  matchConditionsForSession,
  getConditionDetails,
  getTreatmentByCondition,
  generateReport,
};
