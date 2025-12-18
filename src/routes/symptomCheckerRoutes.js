const express = require('express');
const {
  startSession,
  listSymptoms,
  listCommonSymptoms,
  updateSessionSymptoms,
  matchConditions,
  getCondition,
  getTreatment,
  createReportSnapshot,
} = require('../controllers/symptomCheckerController');

const router = express.Router();

router.post('/sessions', startSession);
router.post('/sessions/:sessionId/symptoms', updateSessionSymptoms);
router.get('/symptoms', listSymptoms);
router.get('/symptoms/common', listCommonSymptoms);
router.post('/sessions/:sessionId/match', matchConditions);
router.get('/conditions/:slug', getCondition);
router.get('/treatments/:conditionId', getTreatment);
router.post('/reports', createReportSnapshot);

module.exports = router;
