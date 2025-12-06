const mongoose = require('mongoose');

const coursePurchaseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
    transactionId: { type: String, default: '' },
  },
  { timestamps: true }
);

coursePurchaseSchema.index({ userId: 1, courseId: 1 });
coursePurchaseSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('CoursePurchase', coursePurchaseSchema);

