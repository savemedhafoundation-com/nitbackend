const mongoose = require('mongoose');
const PatientHistory = require('../models/PatientHistory');
const Centre = require('../models/Centre');
const Membership = require('../models/CentreMembership');
const Assignment = require('../models/PatientCentreAssignment');
const service = require('../services/patientService');

const paging = query => ({ page: Math.min(100000, Math.max(1, Number.parseInt(query.page, 10) || 1)), limit: Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20)) });
async function getPatientProfile(req, res, next) {
  try {
    const patient = await service.ownPatient(req.user);
    return res.json({ _id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role, patient: service.publicPatient(patient) });
  } catch (error) { return next(error); }
}
async function historyList(patient, query, centre) {
  const { page, limit } = paging(query);
  const filter = { patient: patient._id, ...(centre ? { $or: [{ centre }, { source: 'patient-reported' }] } : {}) };
  const [items, total] = await Promise.all([
    PatientHistory.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    PatientHistory.countDocuments(filter),
  ]);
  return { data: items.map(service.publicHistory), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
async function getOwnHistory(req, res, next) {
  try { return res.json(await historyList(await service.ownPatient(req.user), req.query)); }
  catch (error) { return next(error); }
}
async function addOwnHistory(req, res, next) {
  try { return res.status(201).json(service.publicHistory(await service.appendHistory(await service.ownPatient(req.user), req.user, req.body))); }
  catch (error) { return next(error); }
}
async function getClinicalCentres(req, res, next) {
  try {
    const now = new Date();
    const memberships = await Membership.find({ user: req.user._id, active: true, startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }], capabilities: 'registry.read' }).populate({ path: 'centre', match: { active: true }, select: 'code name' });
    return res.json({ data: memberships.filter(item => item.centre).map(item => ({ _id: item.centre._id, name: item.centre.name, code: item.centre.code, capabilities: item.capabilities })) });
  } catch (error) { return next(error); }
}
async function listPatients(req, res, next) {
  try {
    const { page, limit } = paging(req.query);
    if (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 80)) throw service.fail('Search must be 80 characters or fewer.');
    const q = req.query.q?.trim();
    const escaped = q?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pipeline = [
      { $match: service.activeAssignment({ $exists: true }, new mongoose.Types.ObjectId(req.params.centreId)) },
      { $lookup: { from: 'patients', localField: 'patient', foreignField: '_id', as: 'patient' } },
      { $unwind: '$patient' },
      ...(q ? [{ $match: { $or: ['name', 'patientCode', 'phone'].map(key => ({ [`patient.${key}`]: { $regex: escaped, $options: 'i' } })) } }] : []),
      { $sort: { createdAt: -1, _id: -1 } },
      { $facet: { data: [{ $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: 'total' }] } },
    ];
    const [result] = await Assignment.aggregate(pipeline);
    const total = result.count[0]?.total || 0;
    return res.json({ data: result.data.map(item => service.publicPatient(item.patient)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { return next(error); }
}
async function registerClinicalPatient(req, res, next) {
  try {
    const fields = service.patientInput(req.body);
    const namePattern = fields.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidates = await Assignment.aggregate([
      { $match: service.activeAssignment({ $exists: true }, new mongoose.Types.ObjectId(req.params.centreId)) },
      { $lookup: { from: 'patients', localField: 'patient', foreignField: '_id', as: 'patient' } },
      { $unwind: '$patient' },
      { $match: { 'patient.name': { $regex: `^${namePattern}$`, $options: 'i' }, ...(fields.phone ? { 'patient.phone': fields.phone } : {}) } },
      { $limit: 5 },
    ]);
    if (candidates.length && req.body.confirmSeparatePatient !== true) {
      return res.status(409).json({ message: 'Possible duplicate patient. Review existing records or confirm this is a separate patient.', duplicateCandidates: candidates.map(item => service.publicPatient(item.patient)) });
    }
    const patient = await service.registryTransaction(async session => {
      // Recheck active centre before registration; no default centre is invented.
      if (!await Centre.exists({ _id: req.params.centreId, active: true }).session(session)) throw service.fail('Centre access is required.', 403);
      const created = await service.createPatient(fields, req.user._id, session);
      await Assignment.create([{ patient: created._id, centre: req.params.centreId, assignedBy: req.user._id }], { session });
      return created;
    });
    return res.status(201).json(service.publicPatient(patient));
  } catch (error) { return next(error); }
}
async function getClinicalPatient(req, res, next) {
  try { return res.json(service.publicPatient(await service.assignedPatient(req.params.patientId, req.params.centreId))); }
  catch (error) { return next(error); }
}
async function getClinicalHistory(req, res, next) {
  try { return res.json(await historyList(await service.assignedPatient(req.params.patientId, req.params.centreId), req.query, req.params.centreId)); }
  catch (error) { return next(error); }
}
async function addClinicalHistory(req, res, next) {
  try {
    const patient = await service.assignedPatient(req.params.patientId, req.params.centreId);
    return res.status(201).json(service.publicHistory(await service.appendHistory(patient, req.user, req.body, req.params.centreId)));
  } catch (error) { return next(error); }
}
function patientError(error, _req, res, _next) {
  const status = error.statusCode || (res.statusCode >= 400 ? res.statusCode : error.name === 'ValidationError' ? 400 : 500);
  return res.status(status).json({ message: status === 500 ? 'Unable to complete the patient request. Please retry.' : error.message });
}
module.exports = { getPatientProfile, getOwnHistory, addOwnHistory, getClinicalCentres, listPatients, registerClinicalPatient, getClinicalPatient, getClinicalHistory, addClinicalHistory, patientError };
