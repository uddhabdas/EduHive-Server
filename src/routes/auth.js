const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const User = require('../models/User');
const { getOtpTemplate, getWelcomeTemplate } = require('../utils/emailTemplates');
const { createTransporter, getEmailFrom, isSmtpConfigured, sendEmail } = require('../utils/emailService');

const { auth } = require('../middleware/auth');
const router = express.Router();

// Verify SMTP on startup
(async () => {
  try {
    if (await isSmtpConfigured()) {
      const transporter = await createTransporter();
      if (transporter) {
        transporter.verify().then(() => {
          console.log('SMTP ready');
        }).catch((e) => {
          console.error('SMTP verify failed:', e && e.message ? e.message : e);
        });
      }
    }
  } catch (_) {}
})();

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function sendOtpEmail(email, otp) {
  try {
    const textBody = `Your EduHive verification code is ${otp}. It is valid for 10 minutes.`;
    const htmlBody = getOtpTemplate({
      otp,
      title: 'Verification Code',
      message: 'Please use the verification code below to verify your email address.',
      expiryMin: 10
    });

    const result = await sendEmail({
      to: email,
      subject: 'EduHive - Email Verification OTP',
      text: textBody,
      html: htmlBody,
    });

    if (!result.success) {
      console.error('Failed to send OTP email:', result.error);
      // Don't throw - allow registration to continue even if email fails
    } else {
      console.log('OTP email sent successfully to:', email);
    }
  } catch (error) {
    console.error('Failed to send OTP email:', error.message || error);
    // Don't throw - allow registration to continue even if email fails
  }
}

async function sendLogoutOtpEmail(email, otp) {
  try {
    const textBody = `Your EduHive login unlock code is ${otp}. Use this to logout from all devices and unlock sign-in.`;
    const htmlBody = getOtpTemplate({
      otp,
      title: 'Unlock Login',
      message: 'Use the code below to logout from all devices and unlock sign-in.',
      expiryMin: 10
    });

    const result = await sendEmail({
      to: email,
      subject: 'EduHive - Login Unlock OTP',
      text: textBody,
      html: htmlBody,
    });

    if (!result.success) {
      console.error('Failed to send logout OTP email:', result.error);
      throw new Error(result.error || 'Failed to send email');
    } else {
      console.log('Logout OTP email sent successfully to:', email);
    }
  } catch (error) {
    console.error('Failed to send logout OTP email:', error.message || error);
    throw error;
  }
}

async function sendWelcomeEmail(email, name) {
  try {
    const subject = 'Welcome to EduHive';
    const displayName = name && name.trim() ? name.trim() : '';
    const textBody = `Welcome to EduHive${displayName ? ", " + displayName : ''}! Your account has been verified successfully. You can now explore courses, watch lectures, and track your progress.`;
    const htmlBody = getWelcomeTemplate({
      name: displayName,
      dashboardUrl: 'https://eduhive.com/dashboard'
    });

    const result = await sendEmail({
      to: email,
      subject,
      text: textBody,
      html: htmlBody,
    });

    if (!result.success) {
      console.error('Failed to send welcome email:', result.error);
      // Don't throw - welcome email is non-critical
    } else {
      console.log('Welcome email sent successfully to:', email);
    }
  } catch (error) {
    console.error('Failed to send welcome email:', error.message || error);
    // Don't throw - welcome email is non-critical
  }
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

    let user = await User.findOne({ email });

    const hash = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    if (user) {
      if (user.isVerified) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      user.name = name.trim();
      user.password = hash;
      user.otpCode = otp;
      user.otpExpiresAt = expiry;
      await user.save();
    } else {
      user = await User.create({
        name: name.trim(),
        email,
        password: hash,
        isVerified: false,
        otpCode: otp,
        otpExpiresAt: expiry,
      });
    }

    try {
      await sendOtpEmail(email, otp);
    } catch (e) {
      console.error('Failed to send OTP email:', e);
    }

    return res.status(200).json({
      message: 'OTP sent to email. Please verify to complete registration.',
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, client } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid email or OTP' });

    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({ error: 'No OTP pending for this user' });
    }

    if (user.otpCode !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    if (user.otpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    user.isVerified = true;
    user.otpCode = null;
    user.otpExpiresAt = null;
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    user.currentSessionId = crypto.randomBytes(16).toString('hex');
    await user.save();

    try {
      await sendWelcomeEmail(user.email, user.name);
    } catch (e) {
      console.error('Welcome email failed:', e && e.message ? e.message : e);
    }

    // Token expiry based on client and role
    let expiresIn = '7d';
    const isAdmin = user.role === 'admin' || user.role === 'teacher';
    if (isAdmin && client === 'admin') expiresIn = '30m';
    else if (user.role === 'user' && client === 'web') expiresIn = '60m';
    const token = jwt.sign({ _id: user._id, email: user.email, sessionVersion: user.sessionVersion }, process.env.JWT_SECRET, { expiresIn });

    return res.json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, client } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.role === 'user' && !user.isVerified) {
      return res.status(403).json({ error: 'Email not verified. Please verify OTP to activate your account.' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Enforce single active session for student accounts
    if (user.role === 'user' && user.currentSessionId) {
      return res.status(409).json({ error: 'You are already logged in on another device. Please logout there first.' });
    }

    // Create a session ID without invalidating existing tokens
    if (user.role === 'user') {
      user.currentSessionId = crypto.randomBytes(16).toString('hex');
    }
    await user.save();

    let expiresIn = '7d';
    const isAdmin = user.role === 'admin' || user.role === 'teacher';
    if (isAdmin && client === 'admin') expiresIn = '30m';
    else if (user.role === 'user' && client === 'web') expiresIn = '60m';
    const token = jwt.sign({ _id: user._id, email: user.email, sessionVersion: user.sessionVersion }, process.env.JWT_SECRET, { expiresIn });
    return res.json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Request an OTP to force logout all devices and unlock sign-in
router.post('/request-unlock-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const otp = generateOtp();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);
    user.otpCode = otp;
    user.otpExpiresAt = expiry;
    await user.save();
    try {
      await sendLogoutOtpEmail(email, otp);
      return res.json({ message: 'Unlock OTP sent to email' });
    } catch (e) {
      console.error('Logout OTP email failed:', e && e.message ? e.message : e);
      if (process.env.NODE_ENV !== 'production') {
        return res.json({ message: 'Unlock OTP generated (dev mode)', devOtp: otp });
      }
      return res.status(500).json({ error: 'Failed to send OTP. Please try again later.' });
    }
  } catch (e) {
    console.error('request-unlock-otp error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Verify OTP to force logout all devices and sign in
router.post('/force-logout', async (req, res) => {
  try {
    const { email, otp, client } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.otpCode || !user.otpExpiresAt) return res.status(400).json({ error: 'No OTP pending' });
    if (user.otpCode !== otp) return res.status(400).json({ error: 'Invalid OTP' });
    if (user.otpExpiresAt.getTime() < Date.now()) return res.status(400).json({ error: 'OTP expired' });

    // Clear all existing sessions and unlock sign-in
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    user.currentSessionId = crypto.randomBytes(16).toString('hex');
    user.otpCode = null;
    user.otpExpiresAt = null;
    await user.save();

    let expiresIn = '7d';
    const isAdmin = user.role === 'admin' || user.role === 'teacher';
    if (isAdmin && client === 'admin') expiresIn = '30m';
    else if (user.role === 'user' && client === 'web') expiresIn = '60m';
    const token = jwt.sign({ _id: user._id, email: user.email, sessionVersion: user.sessionVersion }, process.env.JWT_SECRET, { expiresIn });
    return res.json({
      message: 'All devices logged out. Signed in successfully.',
      token,
      user: { _id: user._id, email: user.email, role: user.role, name: user.name },
    });
  } catch (e) {
    console.error('force-logout error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ message: 'Logged out' });
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    user.currentSessionId = null;
    await user.save();
    return res.json({ message: 'Logged out' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/change-password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new password are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) return res.status(401).json({ error: 'Incorrect old password' });

    const hash = await bcrypt.hash(newPassword, 10);
    user.password = hash;
    // Invalidate other sessions if needed, or keep them. Let's keep them for now or maybe bump session version?
    // Bumping session version logs out all devices including this one unless we handle token refresh.
    // User usually expects to stay logged in on this device.
    // Let's just save the password.
    await user.save();

    return res.json({ message: 'Password updated successfully' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

