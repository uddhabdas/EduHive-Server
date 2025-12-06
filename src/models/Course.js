const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    about: { type: String, default: '' },
    highlights: [{ type: String }],
    thumbnailUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    source: { type: String, default: '' },
    sourcePlaylistId: { type: String, default: '', index: true },
    lectureCount: { type: Number, default: 0 },
    price: { type: Number, default: 0, min: 0 },
    isPaid: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: '' },
    videoUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Course', courseSchema);
