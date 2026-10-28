const User = require('../models/User');
const firebaseAuth = require('../services/firebaseAuth');
const { registryTransaction, createPatient, patientInput, ownPatient } = require('../services/patientService');
const AuthRateLimitStore = require('../utils/authRateLimitStore');
const generateToken = require('../utils/generateToken');
const { recordGoogleVerificationFailure } = require('../middleware/googleRateLimit');

const linkAttempts = new AuthRateLimitStore();
linkAttempts.init({ windowMs: 15 * 60 * 1000 });
const signInAttempts = new AuthRateLimitStore();
signInAttempts.init({ windowMs: 15 * 60 * 1000 });

const passwordRequired = res => res.status(409).json({
  code: 'PASSWORD_REQUIRED', message: 'Enter your existing NIT password to connect this Google account.',
});

async function rejectGoogleToken(res, next, status, message) {
  try {
    if (await recordGoogleVerificationFailure(res)) return res;
    return res.status(status).json({ message });
  } catch (error) { return next(error); }
}

async function googleLogin(req, res, next) {
  const { idToken, password } = req.body || {};
  if (typeof idToken !== 'string' || !idToken || idToken.length > 10000) {
    return rejectGoogleToken(res, next, 400, 'A Google sign-in token is required.');
  }
  let identity;
  try {
    identity = firebaseAuth.validateGoogleIdentity(await firebaseAuth.verifyGoogleToken(idToken));
  } catch {
    return rejectGoogleToken(res, next, 401, 'Google sign-in could not be verified. Please try again.');
  }

  try {
    const signInAttempt = await signInAttempts.increment(`google-subject:${identity.uid}`);
    if (signInAttempt.totalHits > 30) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((signInAttempt.resetTime.getTime() - Date.now()) / 1000))));
      return res.status(429).json({ message: 'Too many Google sign-in attempts for this account. Please try again later.' });
    }
    await User.init();
    // The stable Firebase subject owns the binding. Later email changes must
    // never select a different NIT account or overwrite patient contact data.
    let user = await User.findOne({ firebaseUid: identity.uid }).select('+firebaseUid +tokenVersion');
    if (!user) {
      user = await User.findOne({ email: identity.email }).select('+firebaseUid +tokenVersion');
      if (user) {
        if (user.role !== 'patient' || (user.firebaseUid && user.firebaseUid !== identity.uid)) {
          return res.status(403).json({ message: 'Use your existing account sign-in method.' });
        }
        if (user.firebaseUid !== identity.uid) {
          if (typeof password !== 'string' || !password) return passwordRequired(res);
          const attempt = await linkAttempts.increment(`google-link:${identity.uid}`);
          if (attempt.totalHits > 5) {
            res.set('Retry-After', String(Math.max(1, Math.ceil((attempt.resetTime.getTime() - Date.now()) / 1000))));
            return res.status(429).json({ message: 'Too many password confirmation attempts. Please try again later.' });
          }
          if (!await user.matchPassword(password)) return passwordRequired(res);

          // Match the exact role and hash that were checked, so concurrent
          // credential/role/UID changes cannot attach an identity after proof.
          user = await User.findOneAndUpdate({
            _id: user._id, role: 'patient', password: user.password, firebaseUid: null,
          }, { $set: { firebaseUid: identity.uid } }, { new: true, runValidators: true }).select('+firebaseUid +tokenVersion');
          if (!user) return res.status(409).json({ message: 'Account changed. Please sign in again.' });
          await linkAttempts.resetKey(`google-link:${identity.uid}`);
        }
      } else {
        const suggestedName = (identity.name || identity.email.split('@')[0]).trim().slice(0, 60);
        const name = suggestedName.length >= 2 ? suggestedName : 'Patient';
        user = await registryTransaction(async session => {
          const [account] = await User.create([{ name, email: identity.email, firebaseUid: identity.uid, role: 'patient' }], { session });
          await createPatient(patientInput({ name, email: identity.email }), account._id, session, account._id);
          return account;
        });
      }
    }
    if (user.role !== 'patient') return res.status(403).json({ message: 'Google sign-in is available for patient accounts.' });
    const patient = await ownPatient(user);
    return res.json({
      _id: user._id, name: user.name, email: user.email, role: user.role,
      patientCode: patient.patientCode, token: generateToken(user._id, user.tokenVersion),
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Account changed during sign-in. Please try Google sign-in again.' });
    return next(error);
  }
}

module.exports = { googleLogin };
