const DEFAULT_CASE_STUDY_SECTION = 'disease-specific';
const CASE_STUDY_SECTIONS = Object.freeze([
  DEFAULT_CASE_STUDY_SECTION,
  'nutraceutical-intervention',
]);

const normalizeCaseStudySection = value => {
  if (typeof value !== 'string' || !CASE_STUDY_SECTIONS.includes(value.trim())) {
    const error = new Error('section must be either disease-specific or nutraceutical-intervention');
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
};

module.exports = {
  CASE_STUDY_SECTIONS,
  DEFAULT_CASE_STUDY_SECTION,
  normalizeCaseStudySection,
};
