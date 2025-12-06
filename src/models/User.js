const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    role: { type: String, enum: ['user', 'teacher', 'admin'], default: 'user' },
    name: { type: String, default: '' },
    walletBalance: { type: Number, default: 0, min: 0 },
    isVerified: { type: Boolean, default: false },
    otpCode: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    sessionVersion: { type: Number, default: 0 },
    currentSessionId: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
