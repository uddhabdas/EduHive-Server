const express = require('express');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');
const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');

const router = express.Router();
const Settings = require('../models/Settings');

// Get user wallet balance
router.get('/balance', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('walletBalance email name');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ balance: user.walletBalance || 0, user: { email: user.email, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user transaction history
router.get('/transactions', auth, async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Request wallet top-up (student submits UTR)
router.post('/topup', auth, async (req, res) => {
  try {
    const { amount, utrNumber, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!utrNumber || utrNumber.trim().length === 0) {
      return res.status(400).json({ error: 'UTR number is required' });
    }

    // Check if UTR already exists
    const existing = await WalletTransaction.findOne({ 
      utrNumber: utrNumber.trim(),
      status: { $in: ['pending', 'approved'] }
    });

    if (existing) {
      return res.status(400).json({ error: 'This UTR number has already been used' });
    }

    const upiIdDoc = await Settings.findOne({ key: 'payments.upiId' });
    const upiId = (upiIdDoc?.value || 'eduhive@ybl');
    const transaction = await WalletTransaction.create({
      userId: req.user.id,
      amount: parseFloat(amount),
      type: 'credit',
      status: 'pending',
      utrNumber: utrNumber.trim(),
      upiId,
      description: description || `Wallet top-up via UPI - UTR: ${utrNumber.trim()}`,
    });

    res.status(201).json(transaction);
  } catch (error) {
    console.error('Top-up error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// UPI config for wallet (UPI ID and QR URL)
router.get('/config', auth, async (req, res) => {
  try {
    const upiIdDoc = await Settings.findOne({ key: 'payments.upiId' });
    const qrDoc = await Settings.findOne({ key: 'payments.qrUrl' });
    return res.json({ upiId: upiIdDoc?.value || 'eduhive@ybl', qrUrl: qrDoc?.value || '' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all pending wallet requests
router.get('/admin/pending', adminAuth, async (req, res) => {
  try {
    const transactions = await WalletTransaction.find({ status: 'pending' })
      .populate('userId', 'email name')
      .sort({ createdAt: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all wallet transactions
router.get('/admin/transactions', adminAuth, async (req, res) => {
  try {
    const { status, userId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = userId;

    const transactions = await WalletTransaction.find(query)
      .populate('userId', 'email name')
      .populate('processedBy', 'email name')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Approve wallet request
router.post('/admin/approve/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    const transaction = await WalletTransaction.findById(id).populate('userId');
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({ error: 'Transaction is not pending' });
    }

    // Update transaction
    transaction.status = 'approved';
    transaction.processedBy = req.user.id;
    transaction.processedAt = new Date();
    if (adminNotes) transaction.adminNotes = adminNotes;

    // Update user wallet
    const user = await User.findById(transaction.userId._id);
    if (user) {
      user.walletBalance = (user.walletBalance || 0) + transaction.amount;
      await user.save();
    }

    // Mark transaction as completed
    transaction.status = 'completed';
    await transaction.save();

    res.json({ message: 'Wallet top-up approved', transaction });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Reject wallet request
router.post('/admin/reject/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    const transaction = await WalletTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.status !== 'pending') {
      return res.status(400).json({ error: 'Transaction is not pending' });
    }

    transaction.status = 'rejected';
    transaction.processedBy = req.user.id;
    transaction.processedAt = new Date();
    if (adminNotes) transaction.adminNotes = adminNotes;
    await transaction.save();

    res.json({ message: 'Wallet top-up rejected', transaction });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

