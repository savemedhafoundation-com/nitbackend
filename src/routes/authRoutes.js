const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const AuthRateLimitStore = require('../utils/authRateLimitStore');
const { registerUser, loginUser, getProfile, logoutUser } = require('../controllers/authController');
const { googleLogin } = require('../controllers/googleAuthController');
const { googleNetworkLimit } = require('../middleware/googleRateLimit');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30,
  store: new AuthRateLimitStore(),
  // Account limits work across proxies/instances without trusting forwarded IP headers.
  // Missing/invalid email submissions share a normalized network bucket instead.
  keyGenerator: req => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `account:${email}` : `network:${ipKeyGenerator(req.ip || 'unknown')}`;
  },
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please try again later.' },
});

router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.post('/register', authLimit, registerUser);
router.post('/login', authLimit, loginUser);
router.post('/google', googleNetworkLimit, googleLogin);
router.post('/logout', protect, logoutUser);
router.get('/me', protect, getProfile);

module.exports = router;
