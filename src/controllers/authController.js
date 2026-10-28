const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { patientInput, registryTransaction, createPatient } = require('../services/patientService');

const registerUser = async (req, res, next) => {
  try {
    const { name, password } = req.body || {};
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (typeof name !== 'string' || !name.trim() || !email || typeof password !== 'string' || !password) {
      res.status(400);
      throw new Error('Please provide name, email, and password');
    }

    const userExists = await User.findOne({ email }).select('+tokenVersion');

    if (userExists) {
      res.status(409);
      throw new Error('User already exists');
    }

    const fields = patientInput({ ...req.body, email });
    if (name.trim().length < 2 || name.trim().length > 60) {
      return res.status(400).json({ message: 'Name must be 2–60 characters.' });
    }
    if (Array.from(password).length < 15) {
      return res.status(400).json({ message: 'Use a password with at least 15 characters.' });
    }
    // bcrypt truncates inputs beyond 72 UTF-8 bytes. Bound new passwords before
    // hashing while keeping existing account login verification compatible.
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ message: 'Password must be 72 UTF-8 bytes or fewer. Some characters use more than one byte.' });
    }
    await User.init();
    const { user, patient } = await registryTransaction(async session => {
      const [user] = await User.create([{ name: fields.name, email, password, role: 'patient' }], { session });
      const patient = await createPatient(fields, user._id, session, user._id);
      return { user, patient };
    });

    res.status(201).json({
      patientCode: patient.patientCode,
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id, user.tokenVersion),
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'An account with this email already exists.' });
    if (error.statusCode || error.name === 'ValidationError') res.status(error.statusCode || 400);
    next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (!email || typeof password !== 'string' || !password) {
      res.status(400);
      throw new Error('Please provide email and password');
    }

    const user = await User.findOne({ email }).select('+tokenVersion');

    if (!user) {
      res.status(401);
      throw new Error('Invalid credentials');
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      res.status(401);
      throw new Error('Invalid credentials');
    }

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id, user.tokenVersion),
    });
  } catch (error) {
    next(error);
  }
};

const getProfile = (req, res) => {
  res.status(200).json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  });
};

// Revoke all tokens for this account, including tokens in other tabs.
const logoutUser = async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    return res.status(200).json({ message: 'All sessions signed out.' });
  } catch (error) { return next(error); }
};

module.exports = {
  logoutUser,
  registerUser,
  loginUser,
  getProfile,
};
