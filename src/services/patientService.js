const { randomBytes, randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const PatientHistory = require('../models/PatientHistory');
const Assignment = require('../models/PatientCentreAssignment');

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const patientCode = () => `NIT-${randomBytes(12).toString('hex').toUpperCase()}`;

function text(value, field, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(`${field} is invalid.`);
  return value.trim();
}
function clinicalDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(`${field} must be YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > new Date().toISOString().slice(0, 10) || value < '1900-01-01') throw fail(`${field} must be a valid past or present date.`);
  return value;
}
function patientInput(body = {}) {
  const phone = text(body.phone, 'Phone', 30).replace(/[\s()+-]/g, '');
  if (phone && !/^\d{7,15}$/.test(phone)) throw fail('Phone must contain 7 to 15 digits.');
  const email = text(body.email, 'Email', 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Email is invalid.');
  const sex = body.sex === undefined || body.sex === '' ? 'unknown' : body.sex;
  if (!['unknown', 'female', 'male', 'intersex'].includes(sex)) throw fail('Sex is invalid.');
  return { name: text(body.name, 'Name', 120, true), phone, email, dateOfBirth: clinicalDate(body.dateOfBirth, 'Date of birth'), sex };
}
async function prepareRegistry() {
  await Promise.all([Patient.init(), Assignment.init(), PatientHistory.init()]);
}
// Retry only ID collisions; duplicate accounts must not be silently reinterpreted.
async function registryTransaction(work) {
  await prepareRegistry();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { return await mongoose.connection.transaction(work); }
    catch (error) { if (error.code !== 11000 || !error.keyPattern?.patientCode || attempt === 4) throw error; }
  }
}
async function createPatient(fields, actor, session, user) {
  const [patient] = await Patient.create([{ ...fields, patientCode: patientCode(), registeredBy: actor, ...(user ? { user } : {}) }], { session });
  return patient;
}
async function ownPatient(user) {
  if (user.role !== 'patient') throw fail('A patient account is required.', 403);
  await Patient.init();
  const found = await Patient.findOne({ user: user._id });
  if (found) return found;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await Patient.findOneAndUpdate({ user: user._id }, { $setOnInsert: {
        patientCode: patientCode(), name: user.name, email: user.email, registeredBy: user._id,
      } }, { upsert: true, new: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await Patient.findOne({ user: user._id });
      if (existing) return existing;
      if (attempt === 4) throw error;
    }
  }
}
const activeAssignment = (patient, centre) => ({ patient, centre, active: true, startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gt: new Date() } }] });
async function assignedPatient(patientId, centre) {
  if (!mongoose.isValidObjectId(patientId)) throw fail('Patient not found.', 404);
  if (!await Assignment.exists(activeAssignment(patientId, centre))) throw fail('Patient not found.', 404);
  const patient = await Patient.findById(patientId);
  if (!patient) throw fail('Patient not found.', 404);
  return patient;
}
async function appendHistory(patient, actor, body = {}, centre) {
  const type = body.type;
  if (!['diagnosis', 'previous-treatment', 'allergy', 'medication', 'baseline', 'other'].includes(type)) throw fail('History type is invalid.');
  const entry = {
    patient: patient._id, authoredBy: actor._id, ...(centre ? { centre } : {}),
    source: centre ? 'staff-recorded' : 'patient-reported', type,
    title: text(body.title, 'Title', 160, true), details: text(body.details, 'Details', 5000, true),
    occurredOn: clinicalDate(body.occurredOn, 'History date'),
    clientRequestId: text(body.clientRequestId || randomUUID(), 'Request ID', 80, true), amends: null,
  };
  if (body.amends) {
    if (!mongoose.isValidObjectId(body.amends)) throw fail('Original history entry not found.', 404);
    const filter = { _id: body.amends, patient: patient._id, ...(centre ? { centre } : { authoredBy: actor._id, source: 'patient-reported' }) };
    if (!await PatientHistory.exists(filter)) throw fail('Original history entry not found.', 404);
    entry.amends = body.amends;
  }
  await PatientHistory.init();
  try { return await PatientHistory.create(entry); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await PatientHistory.findOne({ patient: patient._id, authoredBy: actor._id, clientRequestId: entry.clientRequestId });
    const same = existing && ['type', 'title', 'details', 'occurredOn', 'source'].every(key => existing[key] === entry[key]) && String(existing.amends || '') === String(entry.amends || '') && String(existing.centre || '') === String(centre || '');
    if (!same) throw fail('Request ID was already used for different history. Refresh and retry.', 409);
    return existing;
  }
}
function publicPatient(patient) {
  return { _id: patient._id, patientCode: patient.patientCode, name: patient.name, phone: patient.phone, email: patient.email, dateOfBirth: patient.dateOfBirth, sex: patient.sex, createdAt: patient.createdAt };
}
function publicHistory(entry) {
  return { _id: entry._id, type: entry.type, title: entry.title, details: entry.details, occurredOn: entry.occurredOn, source: entry.source, amends: entry.amends, createdAt: entry.createdAt };
}
module.exports = { fail, patientInput, clinicalDate, prepareRegistry, registryTransaction, createPatient, ownPatient, activeAssignment, assignedPatient, appendHistory, publicPatient, publicHistory };
