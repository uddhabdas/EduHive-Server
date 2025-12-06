const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    status: { 
      type: String, 
      enum: ['pending', 'approved', 'rejected', 'completed'], 
      default: 'pending',
      index: true
    },
    utrNumber: { type: String, default: '', index: true },
    upiId: { type: String, default: 'eduhive@ybl' },
    description: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);

