const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const APP_NAME = 'patient-auth';

function validateGoogleIdentity(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
    || typeof identity.uid !== 'string' || !identity.uid.trim() || identity.uid.length > 128
    || typeof identity.sub !== 'string' || identity.sub !== identity.uid
    || typeof identity.email !== 'string' || identity.email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email.trim())
    || identity.email_verified !== true
    || identity.firebase?.sign_in_provider !== 'google.com'
    || (identity.name !== undefined && typeof identity.name !== 'string')) {
    throw new Error('A verified Google identity is required.');
  }
  return { ...identity, email: identity.email.trim().toLowerCase() };
}

async function verifyGoogleToken(idToken) {
  // The Admin SDK accepts unsigned emulator tokens when this variable is set.
  // This public authentication endpoint must always require real signatures.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Firebase emulator authentication is not allowed.');
  const projectId = (process.env.FIREBASE_PROJECT_ID || 'nitauth').trim();
  if (!projectId) throw new Error('Firebase project is not configured.');
  let app = getApps().find(item => item.name === APP_NAME);
  if (app && app.options.projectId !== projectId) throw new Error('Firebase project configuration changed.');
  if (!app) app = initializeApp({ projectId }, APP_NAME);

  // This official SDK path verifies the Google RSA signature, issuer, audience,
  // token format and expiry before any identity reaches the account lookup.
  const identity = await getAuth(app).verifyIdToken(idToken);
  const now = Math.floor(Date.now() / 1000);
  if (identity.aud !== projectId || identity.iss !== `https://securetoken.google.com/${projectId}`
    || !Number.isInteger(identity.exp) || identity.exp <= now
    || !Number.isInteger(identity.iat) || identity.iat <= 0 || identity.iat > now
    || !Number.isInteger(identity.auth_time) || identity.auth_time <= 0 || identity.auth_time > now
    || identity.auth_time > identity.iat || identity.iat >= identity.exp) {
    throw new Error('Google token claims are invalid.');
  }
  return validateGoogleIdentity(identity);
}

module.exports = { verifyGoogleToken, validateGoogleIdentity };
