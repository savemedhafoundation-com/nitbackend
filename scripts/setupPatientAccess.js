require('dotenv').config();
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const Patient = require('../src/models/Patient');
const Centre = require('../src/models/Centre');
const Membership = require('../src/models/CentreMembership');
const Assignment = require('../src/models/PatientCentreAssignment');

async function setup() {
  const { values } = parseArgs({ options: {
    'centre-code': { type: 'string' }, 'centre-name': { type: 'string' },
    'staff-email': { type: 'string' }, 'patient-code': { type: 'string' },
    'allow-treatment-plans': { type: 'boolean', default: false },
    'allow-treatment-signing': { type: 'boolean', default: false },
  } });
  const code = values['centre-code']?.trim().toUpperCase();
  const name = values['centre-name']?.trim();
  const email = values['staff-email']?.trim().toLowerCase();
  if (!code || !/^[A-Z0-9-]{1,24}$/.test(code) || !name || name.length > 120 || !email) {
    throw new Error('Provide --centre-code, --centre-name and --staff-email for an existing administrator.');
  }
  if (values['allow-treatment-signing'] && !values['allow-treatment-plans']) throw new Error('Provide --allow-treatment-plans when granting signing permissions.');
  const capabilities = ['registry.read', 'registry.write', 'history.read', 'history.write'];
  if (values['allow-treatment-plans']) capabilities.push('treatment.read', 'treatment.write');
  if (values['allow-treatment-signing']) capabilities.push('treatment.sign');
  await connectDB();
  await Promise.all([Centre.init(), Membership.init(), Assignment.init()]);
  const staff = await User.findOne({ email, role: 'admin' });
  if (!staff) throw new Error('An existing administrator account is required.');
  const patient = values['patient-code'] ? await Patient.findOne({ patientCode: values['patient-code'] }) : null;
  if (values['patient-code'] && !patient) throw new Error('Patient ID not found.');
  const centre = await Centre.findOneAndUpdate({ code }, { $setOnInsert: { name, active: true } }, { upsert: true, new: true });
  if (!centre.active) throw new Error('The centre is inactive. Review its status before granting access.');
  await Membership.updateOne({ user: staff._id, centre: centre._id }, {
    $set: { active: true, startsAt: new Date(), endsAt: null },
    $addToSet: { capabilities: { $each: capabilities } },
  }, { upsert: true, runValidators: true });
  if (patient) await Assignment.updateOne({ patient: patient._id, centre: centre._id }, {
    $set: { active: true, startsAt: new Date(), endsAt: null, assignedBy: staff._id },
  }, { upsert: true, runValidators: true });
  console.log(patient ? 'Centre permissions and explicit patient assignment saved.' : 'Centre permissions saved.');
}
setup().catch(error => {
  const safeMessages = ['Provide --', 'An existing', 'Patient ID not found.', 'The centre is inactive.'];
  console.error(safeMessages.some(prefix => error.message.startsWith(prefix)) ? error.message : 'Setup failed. Review arguments and database access.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
