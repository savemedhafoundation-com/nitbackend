const express = require('express');
const { rateLimit } = require('express-rate-limit');
const AuthRateLimitStore = require('../utils/authRateLimitStore');
const { requireCentreCapability } = require('../middleware/centreAccess');
const { auditMutation } = require('../middleware/auditMutation');
const { assignedPatient, ownPatient } = require('../services/patientService');
const service = require('../services/treatmentPlanService');

const action = handler => async (req, res, next) => {
  try { return await handler(req, res); } catch (error) { return next(error); }
};
const signLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
  store: new AuthRateLimitStore(), keyGenerator: req => `treatment-sign:${req.user._id}`,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { message: 'Too many unsuccessful sign-off attempts. Please try again later.' },
});
const clinical = express.Router({ mergeParams: true });
clinical.use(requireCentreCapability('treatment.read'));
clinical.use(async (req, _res, next) => {
  try { req.treatmentPatient = await assignedPatient(req.params.patientId, req.params.centreId); return next(); }
  catch (error) { return next(error); }
});
clinical.get('/', action(async (req, res) => res.json(await service.list(req.treatmentPatient, req.params.centreId, req.query))));
clinical.post('/', requireCentreCapability('treatment.write'), auditMutation('treatment-plan.create.requested'), action(async (req, res) => res.status(201).json(await service.staffView(await service.createDraft(req.treatmentPatient, req.params.centreId, req.user, req.body)))));
clinical.patch('/:planId/draft', requireCentreCapability('treatment.write'), auditMutation('treatment-plan.draft.save.requested'), action(async (req, res) => res.json(await service.staffView(await service.saveDraft(req.treatmentPatient, req.params.centreId, req.user, req.params.planId, req.body)))));
clinical.post('/:planId/amend', requireCentreCapability('treatment.write'), auditMutation('treatment-plan.amend.requested'), action(async (req, res) => res.json(await service.staffView(await service.amend(req.treatmentPatient, req.params.centreId, req.user, req.params.planId, req.body)))));
clinical.post('/:planId/sign', requireCentreCapability('treatment.sign'), signLimit, auditMutation('treatment-plan.sign.requested'), action(async (req, res) => res.json(await service.staffView(await service.sign(req.treatmentPatient, req.params.centreId, req.user, req.params.planId, req.body)))));
clinical.get('/:planId/versions', action(async (req, res) => res.json(await service.versionList(req.treatmentPatient, req.params.centreId, req.params.planId, req.query))));

const patient = express.Router({ mergeParams: true });
patient.get('/', action(async (req, res) => res.json(await service.list(await ownPatient(req.user), null, req.query))));
patient.get('/:planId/versions', action(async (req, res) => res.json(await service.versionList(await ownPatient(req.user), null, req.params.planId, req.query))));
module.exports = { clinicalTreatmentRouter: clinical, patientTreatmentRouter: patient };
