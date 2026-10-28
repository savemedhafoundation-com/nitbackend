const { isIP } = require('node:net');
const { ipKeyGenerator } = require('express-rate-limit');
const AuthRateLimitStore = require('../utils/authRateLimitStore');
const AuthAttempt = require('../models/AuthAttempt');

const networkAttempts = new AuthRateLimitStore();
networkAttempts.init({ windowMs: 15 * 60 * 1000 });

function networkLimited(res, resetTime) {
  res.set('Retry-After', String(Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))));
  return res.status(429).json({ message: 'Too many unsuccessful Google sign-in attempts. Please try again later.' });
}

function googleClientNetwork(req) {
  // Vercel overwrites this header with its calculated client IP. Trust it only
  // in Vercel's server environment, never because a request claims to be Vercel.
  // https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
  const address = process.env.VERCEL === '1'
    ? req.headers['x-vercel-forwarded-for']
    : req.socket?.remoteAddress;
  if (typeof address !== 'string' || !isIP(address.trim())) return null;
  return `google-network:${ipKeyGenerator(address.trim())}`;
}

async function googleNetworkLimit(req, res, next) {
  try {
  // Missing platform metadata must not collapse all legitimate patients into a
  // shared internal-proxy bucket. Verified-subject limiting still applies.
    const key = googleClientNetwork(req);
    if (key === null) return next();
    const attempts = await AuthAttempt.findById(networkAttempts.bucket(key).id).lean();
    if (attempts?.count >= 60) return networkLimited(res, attempts.expiresAt);
    res.locals.googleFailureNetwork = key;
    return next();
  } catch (error) { return next(error); }
}

async function recordGoogleVerificationFailure(res) {
  const key = res.locals.googleFailureNetwork;
  if (!key) return false;
  // Await failed-proof accounting before responding. Successful Google users
  // never consume a shared network bucket or trigger post-response DB work.
  const attempts = await networkAttempts.increment(key);
  if (attempts.totalHits > 60) {
    networkLimited(res, attempts.resetTime);
    return true;
  }
  return false;
}

module.exports = { googleClientNetwork, googleNetworkLimit, recordGoogleVerificationFailure };
