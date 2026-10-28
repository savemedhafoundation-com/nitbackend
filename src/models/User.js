const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/.+@.+\..+/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: function () { return !this.firebaseUid; },
      minlength: 6,
    },
    firebaseUid: { type: String, unique: true, sparse: true, select: false },
    tokenVersion: { type: Number, default: 0, select: false },
    role: {
      type: String,
      enum: ['patient', 'admin'],
      default: 'patient',
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (error) {
    return next(error);
  }
});

userSchema.methods.matchPassword = async function matchPassword(enteredPassword) {
  return this.password ? bcrypt.compare(enteredPassword, this.password) : false;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
