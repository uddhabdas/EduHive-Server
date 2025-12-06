const { Schema, model, Types } = require('mongoose');

const schema = new Schema({
  userId: { type: Types.ObjectId, ref: 'User', index: true, required: true },
  courseId: { type: Types.ObjectId, ref: 'Course', index: true, required: true },
  lectureId: { type: Types.ObjectId, ref: 'Lecture', index: true, required: true },
  videoId: { type: String, index: true },        // redundancy for quick lookups
  position: { type: Number, default: 0 },        // seconds watched (current)
  duration: { type: Number, default: 0 },        // seconds (last known)
  secondsWatched: { type: Number, default: 0 },  // cumulative watched (optional)
  completed: { type: Boolean, default: false },  // >=90% watched
}, { timestamps: true });

schema.index({ userId: 1, courseId: 1, lectureId: 1 }, { unique: true });

module.exports = model('UserProgress', schema);
