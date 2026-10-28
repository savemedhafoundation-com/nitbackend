const { createHash, randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Plan = require('../models/PatientTreatmentPlan');
const Version = require('../models/TreatmentPlanVersion');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const { fail } = require('./patientService');

function text(value, name, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(`${name} is invalid.`);
  return value.trim();
}
function planDate(value, name) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(`${name} must be YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01') throw fail(`${name} is invalid.`);
  return value;
}
function contentInput(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Plan content is required.');
  const source = body.items === undefined ? [] : body.items;
  if (!Array.isArray(source) || source.length > 50) throw fail('A plan may contain at most 50 boosters and supplements.');
  const items = source.map(item => {
    if (!item || !['booster', 'supplement'].includes(item.kind)) throw fail('Choose booster or supplement for every item.');
    return { kind: item.kind, name: text(item.name, 'Item name', 160, true), dose: text(item.dose, 'Dose', 80), unit: text(item.unit, 'Dose unit', 60), route: text(item.route, 'Route', 80), frequency: text(item.frequency, 'Frequency', 160), duration: text(item.duration, 'Duration', 160), instructions: text(item.instructions, 'Item instructions', 1000) };
  });
  const startsOn = planDate(body.startsOn, 'Start date');
  const endsOn = planDate(body.endsOn, 'End date');
  if (startsOn && endsOn && endsOn < startsOn) throw fail('End date must not precede start date.');
  const status = body.status === undefined ? 'active' : body.status;
  if (!['active', 'discontinued'].includes(status)) throw fail('Plan status is invalid.');
  return { title: text(body.title, 'Plan title', 160, true), nutrition: text(body.nutrition, 'Nutrition guidance', 10000), items, notes: text(body.notes, 'Notes', 5000), concurrentTreatments: text(body.concurrentTreatments, 'Concurrent treatments', 5000), adverseEvents: text(body.adverseEvents, 'Adverse events', 5000), startsOn, endsOn, status, stopReason: status === 'discontinued' ? text(body.stopReason, 'Discontinuation reason', 2000) : '' };
}
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value?._bsontype) return String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const signaturePayload = record => ({ plan: String(record.plan), patient: String(record.patient), centre: String(record.centre), version: record.version, content: contentInput(record.content?.toObject ? record.content.toObject() : record.content), amendmentReason: record.amendmentReason, authoredBy: String(record.authoredBy), authorName: record.authorName, signedBy: String(record.signedBy), signerName: record.signerName, signedAt: new Date(record.signedAt).toISOString(), previousHash: record.previousHash || '', signatureMethod: record.signatureMethod });
function signedView(record) {
  const source = record.toObject ? record.toObject() : record;
  if (digest(signaturePayload(source)) !== source.contentHash) throw fail('The signed record could not be verified. Contact the care team.', 409);
  return { _id: source._id, planId: source.plan, version: source.version, content: contentInput(source.content), amendmentReason: source.amendmentReason, authorName: source.authorName, signerName: source.signerName, signedAt: source.signedAt, contentHash: source.contentHash, previousHash: source.previousHash, signatureMethod: source.signatureMethod };
}
function revisionInput(value) { if (!Number.isSafeInteger(value) || value < 1) throw fail('A valid expectedRevision is required.'); return value; }
function scope(patient, centre, id) {
  if (!mongoose.isValidObjectId(id)) throw fail('Treatment plan not found.', 404);
  return { _id: id, patient: patient._id, ...(centre ? { centre } : {}) };
}
async function prepare() { await Promise.all([Plan.init(), Version.init(), AuditEvent.init()]); }
async function latest(plan, session) {
  if (!plan.signedVersion) return null;
  const query = Version.findOne({ plan: plan._id, version: plan.signedVersion, patient: plan.patient, centre: plan.centre });
  const record = session ? await query.session(session) : await query;
  if (!record) throw fail('Signed treatment record is unavailable.', 409);
  return record;
}
async function staffView(plan) {
  const current = await latest(plan);
  return { _id: plan._id, revision: plan.revision, signedVersion: plan.signedVersion, draft: plan.draft, current: current ? signedView(current) : null, createdAt: plan.createdAt, updatedAt: plan.updatedAt };
}
async function findPlan(patient, centre, id) {
  const plan = await Plan.findOne(scope(patient, centre, id));
  if (!plan) throw fail('Treatment plan not found.', 404);
  return plan;
}
async function createDraft(patient, centre, actor, body = {}) {
  const content = contentInput(body.content);
  if (content.status !== 'active') throw fail('New plans must start as active drafts.');
  const clientRequestId = text(body.clientRequestId, 'Request ID', 80, true);
  await prepare();
  const filter = { patient: patient._id, centre, createdBy: actor._id, clientRequestId };
  const createHash = digest(content);
  try { return await Plan.create({ ...filter, createHash, draft: { content, baseVersion: 0, amendmentReason: '', updatedBy: actor._id } }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await Plan.findOne(filter);
    if (!existing || existing.createHash !== createHash) throw fail('This request ID was already used. Refresh and retry.', 409);
    return existing;
  }
}
async function saveDraft(patient, centre, actor, id, body = {}) {
  const expectedRevision = revisionInput(body.expectedRevision);
  const content = contentInput(body.content);
  const plan = await Plan.findOneAndUpdate({ ...scope(patient, centre, id), revision: expectedRevision, draft: { $ne: null } }, { $set: { 'draft.content': content, 'draft.updatedBy': actor._id }, $inc: { revision: 1 } }, { new: true, runValidators: true });
  if (!plan) { await findPlan(patient, centre, id); throw fail('This plan changed or is signed. Reload before editing.', 409); }
  return plan;
}
async function amend(patient, centre, actor, id, body = {}) {
  const expectedRevision = revisionInput(body.expectedRevision);
  const reason = text(body.reason, 'Amendment reason', 2000, true);
  const current = await findPlan(patient, centre, id);
  if (!current.signedVersion || current.draft || current.revision !== expectedRevision) throw fail('Reload the plan before creating an amendment.', 409);
  const record = await latest(current);
  const content = signedView(record).content;
  const plan = await Plan.findOneAndUpdate({ ...scope(patient, centre, id), revision: expectedRevision, draft: null, signedVersion: current.signedVersion }, { $set: { draft: { content, baseVersion: current.signedVersion, amendmentReason: reason, updatedBy: actor._id } }, $inc: { revision: 1 } }, { new: true, runValidators: true });
  if (!plan) throw fail('This plan changed. Reload before creating an amendment.', 409);
  return plan;
}
async function sign(patient, centre, actor, id, body = {}) {
  const expectedRevision = revisionInput(body.expectedRevision);
  if (body.confirmed !== true) throw fail('Confirm that you reviewed this plan before signing.');
  if (typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw fail('Enter your password to confirm signing.');
  const signer = await User.findById(actor._id);
  if (!signer || !await signer.matchPassword(body.password)) throw fail('Unable to verify sign-off credentials.');
  await prepare();
  try {
    await mongoose.connection.transaction(async session => {
      const plan = await Plan.findOne(scope(patient, centre, id)).session(session);
      if (!plan) throw fail('Treatment plan not found.', 404);
      if (plan.revision !== expectedRevision || !plan.draft || plan.draft.baseVersion !== plan.signedVersion) throw fail('This plan changed or was already signed. Reload before signing.', 409);
      const content = contentInput(plan.draft.content.toObject());
      if (!content.startsOn) throw fail('A start date is required before signing.');
      if (!content.nutrition && !content.items.length) throw fail('Add nutrition guidance or a booster/supplement before signing.');
      if (content.items.some(item => ['dose', 'unit', 'route', 'frequency', 'duration'].some(key => !item[key]))) throw fail('Complete dose, unit, route, frequency and duration for every item before signing.');
      if (content.status === 'discontinued' && (!plan.signedVersion || !content.stopReason)) throw fail('Discontinuation requires a previously signed plan and a reason.');
      const previous = await latest(plan, session);
      if (previous) signedView(previous);
      const author = await User.findById(plan.draft.updatedBy).select('name').session(session);
      const record = { plan: plan._id, patient: plan.patient, centre: plan.centre, version: plan.signedVersion + 1, content, amendmentReason: plan.draft.amendmentReason || 'Initial plan', authoredBy: plan.draft.updatedBy, authorName: author?.name || 'Former staff member', signedBy: signer._id, signerName: signer.name, signedAt: new Date(), previousHash: previous?.contentHash || '', signatureMethod: 'authenticated-password-attestation' };
      await Version.create([{ ...record, contentHash: digest(signaturePayload(record)) }], { session });
      const updated = await Plan.updateOne({ _id: plan._id, revision: expectedRevision, signedVersion: plan.signedVersion }, { $set: { draft: null }, $inc: { revision: 1, signedVersion: 1 } }, { session });
      if (!updated.modifiedCount) throw fail('This plan changed. Reload before signing.', 409);
      await AuditEvent.create([{ actor: signer._id, action: 'treatment-plan.signed', target: String(plan._id), centre, requestId: randomUUID() }], { session });
    });
  } catch (error) { if (error.code === 11000) throw fail('This version was already signed. Reload the plan.', 409); throw error; }
  return findPlan(patient, centre, id);
}
async function versionList(patient, centre, id, query = {}) {
  const plan = await findPlan(patient, centre, id);
  if (!centre && !plan.signedVersion) throw fail('Treatment plan not found.', 404);
  const page = Math.min(100000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const [versions, total] = await Promise.all([Version.find({ plan: plan._id, patient: patient._id, version: { $lte: plan.signedVersion }, ...(centre ? { centre } : {}) }).sort({ version: -1 }).skip((page - 1) * limit).limit(limit), Version.countDocuments({ plan: plan._id, patient: patient._id, version: { $lte: plan.signedVersion }, ...(centre ? { centre } : {}) })]);
  return { data: versions.map(signedView), pagination: { page, limit, total, pages: Math.ceil(total / limit) }, currentVersion: plan.signedVersion };
}
async function list(patient, centre, query = {}) {
  const page = Math.min(100000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const filter = { patient: patient._id, ...(centre ? { centre } : { signedVersion: { $gt: 0 } }) };
  const [plans, total] = await Promise.all([Plan.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Plan.countDocuments(filter)]);
  const data = await Promise.all(plans.map(async plan => centre ? staffView(plan) : { _id: plan._id, signedVersion: plan.signedVersion, current: signedView(await latest(plan)) }));
  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
module.exports = { contentInput, signedView, createDraft, saveDraft, amend, sign, staffView, list, versionList };
