require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const User = require('../src/models/User');

async function grantAdmin() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) throw new Error('Provide an existing account email.');
  await connectDB();
  const result = await User.updateOne({ email }, { $set: { role: 'admin' } });
  if (result.matchedCount !== 1) throw new Error('Account not found. Register it before assigning the role.');
  console.log('Administrator role assigned to the existing account.');
}

grantAdmin().catch(error => {
  console.error(error.message === 'Provide an existing account email.' || error.message.startsWith('Account not found.') ? error.message :
    'Role assignment failed. Check database access and configuration.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
