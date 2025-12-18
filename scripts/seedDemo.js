/* Seed demo data for the Symptom Checker */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('../src/config/db');
const BodyRegion = require('../src/models/BodyRegion');
const BodyPart = require('../src/models/BodyPart');
const Symptom = require('../src/models/Symptom');
const Condition = require('../src/models/Condition');
const Treatment = require('../src/models/Treatment');

dotenv.config();

const run = async () => {
  await connectDB();

  console.log('Clearing demo collections...');
  await Promise.all([
    BodyRegion.deleteMany({}),
    BodyPart.deleteMany({}),
    Symptom.deleteMany({}),
    Condition.deleteMany({}),
    Treatment.deleteMany({}),
  ]);

  console.log('Seeding body regions and parts...');
  const regions = await BodyRegion.insertMany([
    { name: 'Head', slug: 'head', order: 1 },
    { name: 'Chest', slug: 'chest', order: 2 },
    { name: 'Abdomen', slug: 'abdomen', order: 3 },
  ]);

  const head = regions.find(r => r.slug === 'head');
  const chest = regions.find(r => r.slug === 'chest');
  const abdomen = regions.find(r => r.slug === 'abdomen');

  const parts = await BodyPart.insertMany([
    { name: 'Skull', slug: 'skull', regionId: head._id },
    { name: 'Face', slug: 'face', regionId: head._id },
    { name: 'Thorax', slug: 'thorax', regionId: chest._id },
    { name: 'Upper Abdomen', slug: 'upper-abdomen', regionId: abdomen._id },
  ]);

  const partId = slug => parts.find(p => p.slug === slug)?._id;

  console.log('Seeding symptoms...');
  const symptoms = await Symptom.insertMany([
    {
      name: 'Fatigue',
      slug: 'fatigue',
      category: 'general',
      common: true,
      synonyms: ['tiredness', 'low energy'],
      allowedSex: 'any',
      ageRange: { min: 0, max: 120 },
      redFlag: false,
      searchableText: 'fatigue tiredness low energy exhaustion',
    },
    {
      name: 'Headache',
      slug: 'headache',
      category: 'head',
      bodyPartId: partId('skull'),
      common: true,
      synonyms: ['head pain', 'migraine'],
      allowedSex: 'any',
      ageRange: { min: 5, max: 120 },
      redFlag: true,
      searchableText: 'headache migraine head pain',
    },
    {
      name: 'Pale skin',
      slug: 'pale-skin',
      category: 'skin',
      bodyPartId: partId('face'),
      common: false,
      synonyms: ['pallor'],
      allowedSex: 'any',
      ageRange: { min: 0, max: 120 },
      redFlag: false,
      searchableText: 'pale skin pallor',
    },
    {
      name: 'Shortness of breath',
      slug: 'shortness-of-breath',
      category: 'chest',
      bodyPartId: partId('thorax'),
      common: false,
      synonyms: ['breathlessness', 'dyspnea'],
      allowedSex: 'any',
      ageRange: { min: 5, max: 120 },
      redFlag: true,
      searchableText: 'shortness of breath breathless dyspnea',
    },
    {
      name: 'Abdominal pain',
      slug: 'abdominal-pain',
      category: 'abdomen',
      bodyPartId: partId('upper-abdomen'),
      common: true,
      synonyms: ['stomach pain'],
      allowedSex: 'any',
      ageRange: { min: 5, max: 120 },
      redFlag: true,
      searchableText: 'abdominal pain stomach pain',
    },
  ]);

  const symptomId = slug => symptoms.find(s => s.slug === slug)?._id;

  console.log('Seeding conditions...');
  const conditions = await Condition.insertMany([
    {
      name: 'Iron Deficiency',
      slug: 'iron-deficiency',
      description: 'Low iron leading to reduced hemoglobin.',
      overview: 'May present with fatigue, pallor, shortness of breath.',
      allowedSex: 'any',
      ageRange: { min: 0, max: 120 },
      prevalence: 'Common',
      riskFactors: ['Low dietary iron', 'Heavy menstrual bleeding'],
      whenToSeekHelp: 'Dizziness, chest pain, rapid heartbeat',
      nitPerspective: 'Support nutrient absorption and replenish iron with whole foods.',
      commonSymptoms: ['Fatigue', 'Pale skin', 'Shortness of breath'],
      symptoms: [
        { symptomId: symptomId('fatigue'), weight: 3 },
        { symptomId: symptomId('pale-skin'), weight: 2 },
        { symptomId: symptomId('shortness-of-breath'), weight: 2 },
      ],
    },
    {
      name: 'Migraine',
      slug: 'migraine',
      description: 'Neurological condition causing recurrent headaches.',
      overview: 'Often unilateral, pulsating headaches with sensitivity to light or sound.',
      allowedSex: 'any',
      ageRange: { min: 10, max: 120 },
      prevalence: 'Very common',
      riskFactors: ['Family history', 'Hormonal changes'],
      whenToSeekHelp: 'Sudden severe headache or neurological deficits.',
      nitPerspective: 'Focus on triggers, mitochondrial support, and stress modulation.',
      commonSymptoms: ['Headache', 'Nausea', 'Light sensitivity'],
      symptoms: [
        { symptomId: symptomId('headache'), weight: 4 },
        { symptomId: symptomId('fatigue'), weight: 1 },
      ],
    },
    {
      name: 'Gastritis',
      slug: 'gastritis',
      description: 'Inflammation of the stomach lining.',
      overview: 'Burning upper abdominal pain, nausea, early satiety.',
      allowedSex: 'any',
      ageRange: { min: 10, max: 120 },
      prevalence: 'Common',
      riskFactors: ['NSAID use', 'Alcohol', 'H. pylori'],
      whenToSeekHelp: 'Severe pain, vomiting blood, black stools.',
      nitPerspective: 'Reduce irritants, support mucosal healing, and gut balance.',
      commonSymptoms: ['Abdominal pain', 'Nausea', 'Bloating'],
      symptoms: [
        { symptomId: symptomId('abdominal-pain'), weight: 4 },
        { symptomId: symptomId('fatigue'), weight: 1 },
      ],
    },
  ]);

  const conditionId = slug => conditions.find(c => c.slug === slug)?._id;

  console.log('Seeding treatments...');
  await Treatment.insertMany([
    {
      conditionId: conditionId('iron-deficiency'),
      overview: 'Replenish iron stores and support hemoglobin.',
      lifestyle: ['Regular moderate activity', 'Adequate sleep'],
      diet: ['Iron-rich foods', 'Vitamin C with meals', 'Avoid tea/coffee with iron'],
      nitApproach: {
        rootCauses: ['Low intake', 'Poor absorption'],
        focusAreas: ['Gut support', 'Micronutrient balance'],
      },
      precautions: ['Consult clinician before supplements'],
      whenToSeekHelp: 'Worsening fatigue, chest pain, or palpitations',
    },
    {
      conditionId: conditionId('migraine'),
      overview: 'Reduce frequency and intensity, manage triggers.',
      lifestyle: ['Regular sleep schedule', 'Stress reduction', 'Hydration'],
      diet: ['Identify food triggers', 'Magnesium-rich foods'],
      nitApproach: {
        rootCauses: ['Trigger load', 'Mitochondrial stress'],
        focusAreas: ['Magnesium support', 'Trigger avoidance'],
      },
      precautions: ['Seek urgent care for sudden severe headache'],
      whenToSeekHelp: 'Neurological symptoms or severe sudden pain',
    },
    {
      conditionId: conditionId('gastritis'),
      overview: 'Calm gastric irritation and restore mucosa.',
      lifestyle: ['Avoid late meals', 'Limit alcohol', 'Stop smoking'],
      diet: ['Bland anti-inflammatory diet', 'Avoid NSAIDs if possible'],
      nitApproach: {
        rootCauses: ['Irritants', 'Microbiome imbalance'],
        focusAreas: ['Mucosal support', 'Trigger elimination'],
      },
      precautions: ['Seek care for bleeding or severe pain'],
      whenToSeekHelp: 'Vomiting blood or black stools',
    },
  ]);

  console.log('✅ Demo data seeded successfully.');
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
