const express = require('express');
const multer = require('multer');
const { adminAuth } = require('../middleware/adminAuth');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const UserCourseAccess = require('../models/UserCourseAccess');
const CoursePurchase = require('../models/CoursePurchase');
const bcrypt = require('bcrypt');
const { uploadVideo, deleteVideo } = require('../services/s3Service');
const Settings = require('../models/Settings');
const { getPremiumEmailTemplate } = require('../utils/emailTemplates');
const { sendEmail } = require('../utils/emailService');

function generateOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function sendDeleteOtpEmail(email, otp, subject, details) {
  try {
    const textBody = `Your deletion confirmation code is ${otp}. It is valid for 10 minutes.`;
    const htmlBody = getPremiumEmailTemplate({
      title: 'Action Confirmation',
      message: 'Please use the verification code below to confirm your action.',
      otp: otp,
      details: details
    });

    const result = await sendEmail({
      to: email || 'mr.uddhabcharandas@gmail.com',
      subject: subject || 'EduHive - Deletion OTP',
      text: textBody,
      html: htmlBody,
    });

    if (!result.success) {
      console.error('Failed to send delete OTP email:', result.error);
      // Don't throw - allow operation to continue even if email fails
    } else {
      console.log('Delete OTP email sent successfully to:', email || 'mr.uddhabcharandas@gmail.com');
    }
  } catch (error) {
    console.error('Failed to send delete OTP email:', error.message || error);
    // Don't throw - allow operation to continue even if email fails
  }
}

const router = express.Router();

// Configure multer for memory storage (we'll upload directly to S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept video files
    const allowedMimes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
      'video/x-matroska',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only video files are allowed.'), false);
    }
  },
});

// ========== COURSE MANAGEMENT ==========

// Get all courses (admin view - includes inactive)
router.get('/courses', adminAuth, async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.json(courses);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single course
router.get('/courses/:id', adminAuth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    res.json(course);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/courses/:id/students', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const accessDocs = await UserCourseAccess.find({ courseId: id, status: 'active' })
      .populate('userId')
      .sort({ createdAt: -1 });

    const lectures = await Lecture.find({ courseId: id }).select('_id');
    const totalLectures = lectures.length;
    const UserProgress = require('../models/UserProgress');

    const students = await Promise.all(accessDocs.map(async (doc) => {
      const completedCount = await UserProgress.countDocuments({ userId: doc.userId?._id || doc.userId, courseId: id, completed: true });
      const percent = totalLectures > 0 ? Math.round((completedCount / totalLectures) * 100) : 0;
      return {
        accessId: doc._id,
        grantedAt: doc.createdAt,
        user: doc.userId || null,
        progress: {
          completedCount,
          totalLectures,
          percent,
        },
      };
    }));

    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/delete-otp/send', adminAuth, async (req, res) => {
  try {
    const { scope, id } = req.body || {};
    if (!scope || !id || !['course', 'user'].includes(scope)) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    if (scope === 'course') {
      const exists = await Course.findById(id);
      if (!exists) return res.status(404).json({ error: 'Course not found' });
      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const key = `delete_otp:${scope}:${id}`;
      await Settings.updateOne(
        { key },
        { $set: { value: JSON.stringify({ otp, expiresAt }), updatedBy: req.user.id } },
        { upsert: true }
      );
      try {
        const subject = `Confirm deleting Course: ${exists.title || exists._id}`;
        const details = `Course: ${exists.title || 'Untitled'} (ID: ${exists._id})`;
        await sendDeleteOtpEmail('mr.uddhabcharandas@gmail.com', otp, subject, details);
      } catch (e) {
        console.error('Delete OTP email failed:', e && e.message ? e.message : e);
        if (process.env.NODE_ENV !== 'production') {
          return res.json({ message: 'Delete OTP generated (dev mode)', devOtp: otp });
        }
      }
      return res.json({ message: 'Delete OTP sent to admin email' });
    } else {
      const exists = await User.findById(id);
      if (!exists) return res.status(404).json({ error: 'User not found' });
      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const key = `delete_otp:${scope}:${id}`;
      await Settings.updateOne(
        { key },
        { $set: { value: JSON.stringify({ otp, expiresAt }), updatedBy: req.user.id } },
        { upsert: true }
      );
      try {
        const subject = `Confirm deleting User: ${exists.name || exists.email || exists._id}`;
        const details = `User: ${exists.name || 'Unnamed'} (${exists.email}) (ID: ${exists._id})`;
        await sendDeleteOtpEmail('mr.uddhabcharandas@gmail.com', otp, subject, details);
      } catch (e) {
        console.error('Delete OTP email failed:', e && e.message ? e.message : e);
        if (process.env.NODE_ENV !== 'production') {
          return res.json({ message: 'Delete OTP generated (dev mode)', devOtp: otp });
        }
      }
      return res.json({ message: 'Delete OTP sent to admin email' });
    }
  } catch (e) {
    console.error('delete-otp/send error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Create course
router.post('/courses', adminAuth, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      about,
      highlights,
      thumbnailUrl, 
      price,
      isPaid,
      notes,
      videoUrl,
    } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const course = await Course.create({
      title,
      description: description || '',
      about: about || '',
      highlights: Array.isArray(highlights) ? highlights : [],
      thumbnailUrl: thumbnailUrl || '',
      // All courses are now treated as locally managed (no external YouTube playlist).
      source: 'local',
      sourcePlaylistId: '',
      isActive: true,
      lectureCount: 0,
      price: price || 0,
      isPaid: isPaid || false,
      createdBy: req.user.id,
      notes: notes || '',
      videoUrl: videoUrl || '',
    });

    res.status(201).json(course);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update course
router.put('/courses/:id', adminAuth, async (req, res) => {
  try {
    const { 
      title, 
      description, 
      about,
      highlights,
      thumbnailUrl, 
      isActive,
      price,
      isPaid,
      notes,
      videoUrl,
    } = req.body;
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    if (title) course.title = title;
    if (description !== undefined) course.description = description;
    if (about !== undefined) course.about = about;
    if (highlights !== undefined) course.highlights = Array.isArray(highlights) ? highlights : [];
    if (thumbnailUrl !== undefined) course.thumbnailUrl = thumbnailUrl;
    if (isActive !== undefined) course.isActive = isActive;
    if (price !== undefined) course.price = price;
    if (isPaid !== undefined) course.isPaid = isPaid;
    if (notes !== undefined) course.notes = notes;
    if (videoUrl !== undefined) course.videoUrl = videoUrl;

    await course.save();
    res.json(course);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete course
router.delete('/courses/:id', adminAuth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const providedOtp = (req.body && req.body.otp) || '';
    const key = `delete_otp:course:${course._id.toString()}`;
    const otpDoc = await Settings.findOne({ key });
    if (!providedOtp) return res.status(400).json({ error: 'OTP required' });
    if (!otpDoc || !otpDoc.value) return res.status(400).json({ error: 'OTP not found. Request OTP first.' });
    let payload;
    try {
      payload = JSON.parse(otpDoc.value);
    } catch {
      return res.status(400).json({ error: 'Invalid OTP record' });
    }
    if (payload.otp !== providedOtp) return res.status(401).json({ error: 'Invalid OTP' });
    if (new Date(payload.expiresAt).getTime() < Date.now()) return res.status(401).json({ error: 'OTP expired' });

    // Delete all lectures
    await Lecture.deleteMany({ courseId: course._id });
    await Course.findByIdAndDelete(course._id);
    await Settings.deleteOne({ key });

    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== LECTURE MANAGEMENT ==========

// Get all lectures for a course
router.get('/courses/:courseId/lectures', adminAuth, async (req, res) => {
  try {
    const lectures = await Lecture.find({ courseId: req.params.courseId }).sort({ orderIndex: 1 });
    res.json(lectures);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single lecture
router.get('/lectures/:id', adminAuth, async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ error: 'Lecture not found' });
    res.json(lecture);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create lecture
router.post('/courses/:courseId/lectures', adminAuth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const { title, videoUrl, orderIndex, isLocked, duration, notes, notesFileUrl } = req.body;
    if (!title || !videoUrl) {
      return res.status(400).json({ error: 'Title and videoUrl are required' });
    }

    const lecture = await Lecture.create({
      courseId: course._id,
      title,
      videoId: '',
      videoUrl: videoUrl,
      orderIndex: orderIndex || 1,
      isLocked: isLocked || false,
      duration: duration || 0,
      thumbnailUrl: '',
      notes: notes || '',
      notesFileUrl: notesFileUrl || '',
    });

    // Update course lecture count
    const lectureCount = await Lecture.countDocuments({ courseId: course._id });
    await Course.findByIdAndUpdate(course._id, { lectureCount });

    res.status(201).json(lecture);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update lecture
router.put('/lectures/:id', adminAuth, async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ error: 'Lecture not found' });

    const { title, videoUrl, orderIndex, isLocked, duration, notes, notesFileUrl } = req.body;

    if (title) lecture.title = title;
    if (videoUrl !== undefined) lecture.videoUrl = videoUrl;
    if (orderIndex !== undefined) lecture.orderIndex = orderIndex;
    if (isLocked !== undefined) lecture.isLocked = isLocked;
    if (duration !== undefined) lecture.duration = duration;
    // Always clear thumbnail on lectures (course-only thumbnails)
    lecture.thumbnailUrl = '';
    if (notes !== undefined) lecture.notes = notes;
    if (notesFileUrl !== undefined) lecture.notesFileUrl = notesFileUrl;

    await lecture.save();
    res.json(lecture);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete lecture
router.delete('/lectures/:id', adminAuth, async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ error: 'Lecture not found' });

    const courseId = lecture.courseId;
    await Lecture.findByIdAndDelete(lecture._id);

    // Update course lecture count
    const lectureCount = await Lecture.countDocuments({ courseId });
    await Course.findByIdAndUpdate(courseId, { lectureCount });

    res.json({ message: 'Lecture deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== USER MANAGEMENT ==========

// Get all users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single user
router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// User overview: wallet + course access for a single user
router.get('/users/:id/overview', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const walletHistory = await WalletTransaction.find({ userId: id })
      .sort({ createdAt: -1 })
      .limit(20);

    const accessDocs = await UserCourseAccess.find({ userId: id })
      .populate('courseId')
      .sort({ createdAt: -1 });

    const courses = accessDocs.map((doc) => ({
      accessId: doc._id,
      grantedAt: doc.createdAt,
      course: doc.courseId,
    }));

    res.json({
      user,
      wallet: walletHistory,
      courses,
    });
  } catch (error) {
    console.error('User overview error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/backfill-access', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const purchases = await CoursePurchase.find({ userId: id, status: 'completed' }).select('courseId');
    let created = 0;
    for (const p of purchases) {
      const result = await UserCourseAccess.findOneAndUpdate(
        { userId: id, courseId: p.courseId },
        { $setOnInsert: { userId: id, courseId: p.courseId, status: 'active' } },
        { upsert: true, new: true }
      );
      if (result) created += 1;
    }
    res.json({ ok: true, created });
  } catch (error) {
    console.error('Backfill access error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user (admin/teacher)
router.post('/users', adminAuth, async (req, res) => {
  try {
    const { email, password, role, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      password: hash,
      role: role || 'user',
      name: name || '',
    });

    const userObj = user.toObject();
    delete userObj.password;
    res.status(201).json(userObj);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user
router.put('/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { email, password, role, name } = req.body;

    if (email && email !== user.email) {
      const existing = await User.findOne({ email });
      if (existing) return res.status(409).json({ error: 'Email already exists' });
      user.email = email;
    }

    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }

    if (role) user.role = role;
    if (name !== undefined) user.name = name;

    await user.save();
    const userObj = user.toObject();
    delete userObj.password;
    res.json(userObj);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent deleting yourself
    if (user._id.toString() === req.user.id.toString()) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const providedOtp = (req.body && req.body.otp) || '';
    const key = `delete_otp:user:${user._id.toString()}`;
    const otpDoc = await Settings.findOne({ key });
    if (!providedOtp) return res.status(400).json({ error: 'OTP required' });
    if (!otpDoc || !otpDoc.value) return res.status(400).json({ error: 'OTP not found. Request OTP first.' });
    let payload;
    try {
      payload = JSON.parse(otpDoc.value);
    } catch {
      return res.status(400).json({ error: 'Invalid OTP record' });
    }
    if (payload.otp !== providedOtp) return res.status(401).json({ error: 'Invalid OTP' });
    if (new Date(payload.expiresAt).getTime() < Date.now()) return res.status(401).json({ error: 'OTP expired' });

    await User.findByIdAndDelete(user._id);
    await Settings.deleteOne({ key });
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Revoke a user's access to a specific course
router.delete('/users/:userId/courses/:courseId/access', adminAuth, async (req, res) => {
  try {
    const { userId, courseId } = req.params;
    const UserProgress = require('../models/UserProgress');
    const CoursePurchase = require('../models/CoursePurchase');

    const accessDel = await UserCourseAccess.deleteMany({ userId, courseId });
    const progressDel = await UserProgress.deleteMany({ userId, courseId });
    const purchaseDel = await CoursePurchase.deleteMany({ userId, courseId });

    if ((accessDel.deletedCount || 0) === 0 && (purchaseDel.deletedCount || 0) === 0) {
      return res.status(404).json({ error: 'Access not found' });
    }

    return res.json({
      message: 'Course access revoked and related data removed',
      deleted: {
        access: accessDel.deletedCount || 0,
        progress: progressDel.deletedCount || 0,
        purchases: purchaseDel.deletedCount || 0,
      },
    });
  } catch (error) {
    console.error('Revoke access error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ======= SETTINGS (AI) =======
router.get('/settings/ai', adminAuth, async (req, res) => {
  try {
    const Settings = require('../models/Settings');
    const keyDoc = await Settings.findOne({ key: 'gemini.apiKey' });
    const modelDoc = await Settings.findOne({ key: 'gemini.model' });
    const apiKey = keyDoc?.value || '';
    const masked = apiKey ? `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}` : '';
    return res.json({
      hasKey: !!apiKey,
      apiKeyMasked: masked,
      model: modelDoc?.value || 'gemini-2.0-flash',
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings/ai', adminAuth, async (req, res) => {
  try {
    const { apiKey, model, otp } = req.body || {};
    const otpKey = 'otp:settings:ai';
    if (!otp) return res.status(400).json({ error: 'OTP required' });
    const otpDoc = await Settings.findOne({ key: otpKey });
    if (!otpDoc || !otpDoc.value) return res.status(400).json({ error: 'OTP not found. Request OTP first.' });
    let payload;
    try { payload = JSON.parse(otpDoc.value); } catch { return res.status(400).json({ error: 'Invalid OTP record' }); }
    if (payload.otp !== otp) return res.status(401).json({ error: 'Invalid OTP' });
    if (new Date(payload.expiresAt).getTime() < Date.now()) return res.status(401).json({ error: 'OTP expired' });
    const Settings = require('../models/Settings');
    if (typeof apiKey === 'string') {
      await Settings.updateOne(
        { key: 'gemini.apiKey' },
        { $set: { value: apiKey, updatedBy: req.user.id } },
        { upsert: true }
      );
    }
    if (typeof model === 'string' && model.trim()) {
      await Settings.updateOne(
        { key: 'gemini.model' },
        { $set: { value: model.trim(), updatedBy: req.user.id } },
        { upsert: true }
      );
    }
    await Settings.deleteOne({ key: otpKey });
    const keyDoc = await Settings.findOne({ key: 'gemini.apiKey' });
    const apiKeyVal = keyDoc?.value || '';
    const masked = apiKeyVal ? `${apiKeyVal.slice(0, 4)}***${apiKeyVal.slice(-4)}` : '';
    return res.json({ ok: true, apiKeyMasked: masked, model: model || undefined });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/settings/ai/otp', adminAuth, async (req, res) => {
  try {
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const key = 'otp:settings:ai';
    await Settings.updateOne(
      { key },
      { $set: { value: JSON.stringify({ otp, expiresAt }), updatedBy: req.user.id } },
      { upsert: true }
    );
    await sendDeleteOtpEmail('mr.uddhabcharandas@gmail.com', otp, 'Confirm AI settings change');
    return res.json({ message: 'OTP sent to admin email' });
  } catch (e) {
    console.error('settings/ai/otp error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Payments settings (UPI)
router.get('/settings/payments', adminAuth, async (req, res) => {
  try {
    const upiIdDoc = await Settings.findOne({ key: 'payments.upiId' });
    const qrDoc = await Settings.findOne({ key: 'payments.qrUrl' });
    return res.json({ upiId: upiIdDoc?.value || 'eduhive@ybl', qrUrl: qrDoc?.value || '' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/settings/payments', adminAuth, async (req, res) => {
  try {
    const { upiId, qrUrl, otp } = req.body || {};
    const otpKey = 'otp:settings:payments';
    if (!otp) return res.status(400).json({ error: 'OTP required' });
    const otpDoc = await Settings.findOne({ key: otpKey });
    if (!otpDoc || !otpDoc.value) return res.status(400).json({ error: 'OTP not found. Request OTP first.' });
    let payload; try { payload = JSON.parse(otpDoc.value); } catch { return res.status(400).json({ error: 'Invalid OTP record' }); }
    if (payload.otp !== otp) return res.status(401).json({ error: 'Invalid OTP' });
    if (new Date(payload.expiresAt).getTime() < Date.now()) return res.status(401).json({ error: 'OTP expired' });
    if (typeof upiId === 'string') {
      await Settings.updateOne(
        { key: 'payments.upiId' },
        { $set: { value: upiId.trim(), updatedBy: req.user.id } },
        { upsert: true }
      );
    }
    if (typeof qrUrl === 'string') {
      await Settings.updateOne(
        { key: 'payments.qrUrl' },
        { $set: { value: qrUrl.trim(), updatedBy: req.user.id } },
        { upsert: true }
      );
    }
    await Settings.deleteOne({ key: otpKey });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/settings/payments/otp', adminAuth, async (_req, res) => {
  try {
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const key = 'otp:settings:payments';
    await Settings.updateOne(
      { key },
      { $set: { value: JSON.stringify({ otp, expiresAt }) } },
      { upsert: true }
    );
    await sendDeleteOtpEmail('mr.uddhabcharandas@gmail.com', otp, 'Confirm Payments settings change');
    return res.json({ message: 'OTP sent to admin email' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ========== SMTP SETTINGS ==========

// Get SMTP settings (read-only from .env)
router.get('/settings/smtp', adminAuth, async (req, res) => {
  try {
    const { getSmtpSettings } = require('../utils/emailService');
    const settings = await getSmtpSettings();
    
    // Mask password for display
    const passMasked = settings.pass ? `${settings.pass.slice(0, 2)}***${settings.pass.slice(-2)}` : '';
    
    return res.json({
      host: settings.host,
      port: settings.port,
      user: settings.user,
      passMasked: passMasked,
      from: settings.from,
      fromName: settings.fromName,
      secure: settings.secure,
      configured: !!(settings.host && settings.user && settings.pass),
      readOnly: true, // Indicate these settings are read-only
      message: 'SMTP settings are configured via .env file. Update SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME, and SMTP_SECURE in your .env file.',
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// Update SMTP settings - DISABLED (use .env file instead)
router.put('/settings/smtp', adminAuth, async (req, res) => {
  return res.status(403).json({ 
    error: 'SMTP settings can only be configured via .env file. Please update SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_FROM_NAME, and SMTP_SECURE in your .env file and restart the server.' 
  });
});

// Request OTP for SMTP settings change - DISABLED
router.post('/settings/smtp/otp', adminAuth, async (req, res) => {
  return res.status(403).json({ 
    error: 'SMTP settings can only be configured via .env file. Please update your .env file and restart the server.' 
  });
});

// Test SMTP connection - DISABLED
router.post('/settings/smtp/test', adminAuth, async (req, res) => {
  return res.status(403).json({ 
    error: 'SMTP test is disabled. SMTP settings should be configured via .env file.' 
  });
});

// ========== VIDEO UPLOAD ==========

// Upload video to S3
router.post('/upload/video', adminAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const contentType = req.file.mimetype;

    // Upload to S3
    const videoUrl = await uploadVideo(fileBuffer, fileName, contentType);

    res.json({
      success: true,
      videoUrl,
      message: 'Video uploaded successfully',
    });
  } catch (error) {
    console.error('Video upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload video' });
  }
});

// Delete video from S3 (optional - for cleanup)
router.delete('/upload/video', adminAuth, async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    await deleteVideo(videoUrl);
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    console.error('Video delete error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete video' });
  }
});

// ========== STATS ==========

// Get dashboard stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const totalCourses = await Course.countDocuments();
    const activeCourses = await Course.countDocuments({ isActive: true });
    const totalLectures = await Lecture.countDocuments();
    const totalUsers = await User.countDocuments();
    const totalTeachers = await User.countDocuments({ role: { $in: ['teacher', 'admin'] } });
    const pendingWalletRequests = await WalletTransaction.countDocuments({ status: 'pending' });

    res.json({
      totalCourses,
      activeCourses,
      totalLectures,
      totalUsers,
      totalTeachers,
      pendingWalletRequests,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

