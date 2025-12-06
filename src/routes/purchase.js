const express = require('express');
const { auth } = require('../middleware/auth');
const Course = require('../models/Course');
const User = require('../models/User');
const CoursePurchase = require('../models/CoursePurchase');
const WalletTransaction = require('../models/WalletTransaction');
const UserCourseAccess = require('../models/UserCourseAccess');
const { getPurchaseTemplate } = require('../utils/emailTemplates');

const router = express.Router();
const { sendEmail } = require('../utils/emailService');

async function sendPurchaseEmail(to, name, courseTitle, amount, transactionId) {
  try {
    const subject = `Purchase Confirmed: ${courseTitle}`;
    const text = `Hi ${name || ''},\n\nYou have successfully purchased/enrolled in: ${courseTitle}.\nAmount: ₹${amount}.\nTransaction: ${transactionId}.\n\nThank you!\nEduHive`;
    
    const html = getPurchaseTemplate({
      name: name || '',
      courseTitle,
      amount,
      transactionId,
      date: new Date().toLocaleDateString()
    });

    const result = await sendEmail({
      to,
      subject,
      text,
      html
    });

    if (!result.success) {
      console.error('Failed to send purchase email:', result.error);
      // Don't throw - purchase email is non-critical
    } else {
      console.log('Purchase email sent successfully to:', to);
    }
  } catch (error) {
    console.error('Failed to send purchase email:', error.message || error);
    // Don't throw - purchase email is non-critical
  }
}

// Purchase course with wallet
router.post('/courses/:courseId/purchase', auth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await Course.findById(courseId);
    
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // For free courses, allow enrollment without payment (based solely on price)
    if (course.price <= 0) {
      // Check if already enrolled
      const existingPurchase = await CoursePurchase.findOne({
        userId: user._id,
        courseId: course._id,
        status: 'completed',
      });

      if (existingPurchase) {
        return res.status(400).json({ error: 'Course already enrolled' });
      }

      const purchase = await CoursePurchase.create({
        userId: user._id,
        courseId: course._id,
        amount: 0,
        status: 'completed',
        transactionId: `FREE-${Date.now()}`,
      });

      await UserCourseAccess.findOneAndUpdate(
        { userId: user._id, courseId: course._id },
        { $setOnInsert: { userId: user._id, courseId: course._id, status: 'active' } },
        { upsert: true, new: true }
      );

      try { await sendPurchaseEmail(user.email, user.name, course.title, 0, purchase.transactionId); } catch {}
      return res.json({
        message: 'Course enrolled successfully',
        purchase,
        newBalance: user.walletBalance,
      });
    }

    // Check if already purchased
    const existingPurchase = await CoursePurchase.findOne({
      userId: user._id,
      courseId: course._id,
      status: 'completed',
    });

    if (existingPurchase) {
      return res.status(400).json({ error: 'Course already purchased' });
    }

    // Check wallet balance
    const walletBalance = user.walletBalance || 0;
    if (walletBalance < course.price) {
      return res.status(400).json({ 
        error: 'Insufficient wallet balance',
        required: course.price,
        available: walletBalance,
      });
    }

    // Deduct from wallet
    user.walletBalance = walletBalance - course.price;
    await user.save();

    // Create purchase record
    const purchase = await CoursePurchase.create({
      userId: user._id,
      courseId: course._id,
      amount: course.price,
      status: 'completed',
      transactionId: `WALLET-${Date.now()}`,
    });

    await UserCourseAccess.findOneAndUpdate(
      { userId: user._id, courseId: course._id },
      { $setOnInsert: { userId: user._id, courseId: course._id, status: 'active' } },
      { upsert: true, new: true }
    );

    // Create wallet transaction (debit)
    await WalletTransaction.create({
      userId: user._id,
      amount: course.price,
      type: 'debit',
      status: 'completed',
      description: `Course purchase: ${course.title}`,
    });

    try { await sendPurchaseEmail(user.email, user.name, course.title, course.price, purchase.transactionId); } catch {}
    res.json({
      message: 'Course purchased successfully',
      purchase,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check if user has purchased a course
router.get('/courses/:courseId/purchased', auth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const purchase = await CoursePurchase.findOne({
      userId: req.user.id,
      courseId,
      status: 'completed',
    });

    res.json({ purchased: !!purchase });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's purchased courses
router.get('/purchases', auth, async (req, res) => {
  try {
    const purchases = await CoursePurchase.find({
      userId: req.user.id,
      status: 'completed',
    })
      .populate('courseId')
      .sort({ createdAt: -1 });

    res.json(purchases);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

