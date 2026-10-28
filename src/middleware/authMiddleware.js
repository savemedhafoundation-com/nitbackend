const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  try {
    if (req.headers.authorization && /^Bearer [^\s]+$/i.test(req.headers.authorization)) {
      token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof decoded === 'string' || typeof decoded.id !== 'string') {
        return res.status(401).json({ message: 'Invalid session token.' });
      }

      req.user = await User.findById(decoded.id).select('-password +tokenVersion');

      if (!req.user) {
        res.status(401);
        throw new Error('Not authorized, user not found');
      }

      if ((decoded.v ?? 0) !== (req.user.tokenVersion ?? 0)) {
        return res.status(401).json({ message: 'Session has ended. Please sign in again.' });
      }

      return next();
    }

    res.status(401);
    throw new Error('Not authorized, token missing');
  } catch (error) {
    res.status(res.statusCode === 200 ? 401 : res.statusCode);
    next(error);
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Administrator access is required.', code: 'FORBIDDEN' });
  }
  return next();
};

module.exports = {
  protect,
  requireAdmin,
};
