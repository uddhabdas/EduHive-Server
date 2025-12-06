const express = require('express');
const { auth } = require('../middleware/auth');
const UserProgress = require('../models/UserProgress');
const UserCourseAccess = require('../models/UserCourseAccess');
const Lecture = require('../models/Lecture');

const router = express.Router();

// POST /api/progress/upsert (protected) - upsert progress for a lecture
router.post('/progress/upsert', auth, async (req, res) => {
  try {
    let { courseId, lectureId, videoId, position, duration, watchedSeconds, currentTime, isComplete } = req.body || {};

    // Support both client payload shapes
    if (position === undefined && currentTime !== undefined) position = currentTime;
    if (duration === undefined && req.body?.totalDuration !== undefined) duration = req.body.totalDuration;
    if (watchedSeconds !== undefined && position === undefined) position = watchedSeconds; // treat as latest position

    if (!courseId || !lectureId || position === undefined || duration === undefined) {
      return res.status(400).json({ error: 'courseId, lectureId, position, duration required' });
    }

    const userId = req.user.id;

    const existing = await UserProgress.findOne({ userId, courseId, lectureId });
    const prevMax = existing && typeof existing.secondsWatched === 'number' ? existing.secondsWatched : 0;
    const currentPoint = Math.min(Math.max(0, position), Math.max(0, duration));
    const nextMax = Math.max(prevMax, currentPoint);
    const completed = !!(isComplete || (duration > 0 && nextMax / duration >= 0.9));

    await UserProgress.updateOne(
      { userId, courseId, lectureId },
      {
        $set: {
          videoId,
          position,
          duration,
          completed,
          secondsWatched: nextMax,
        },
      },
      { upsert: true }
    );

    res.json({ ok: true, completed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/progress/course/:courseId (protected) - get course progress summary + per-lecture progress
router.get('/progress/course/:courseId', auth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;

    // Get all lectures for this course
    const lectures = await Lecture.find({ courseId }).sort({ orderIndex: 1 });
    const totalLectures = lectures.length;

    // Get all progress for this user + course
    const progressData = await UserProgress.find({ userId, courseId });
    const progressMap = {};
    progressData.forEach((p) => {
      progressMap[p.lectureId.toString()] = p;
    });

    // Build items array with progress
    const items = lectures.map((lec) => {
      const prog = progressMap[lec._id.toString()];
      return {
        lectureId: lec._id,
        videoId: lec.videoId,
        title: lec.title,
        orderIndex: lec.orderIndex,
        position: prog ? prog.position : 0,
        duration: prog && prog.duration > 0 ? prog.duration : lec.duration || 0,
        completed: prog ? prog.completed : false,
        // aliases for client
        currentTime: prog ? prog.position : 0,
        totalDuration: (prog && prog.duration > 0 ? prog.duration : lec.duration || 0),
        isComplete: prog ? prog.completed : false,
      };
    });

    // Compute summary
    const knownDurations = items.filter((it) => it.duration > 0).length;
    const totalDuration = items.reduce((sum, it) => sum + it.duration, 0);
    const totalWatched = items.reduce((sum, it) => {
      const p = progressMap[it.lectureId.toString()];
      const watched = p && typeof p.secondsWatched === 'number' ? p.secondsWatched : (p ? p.position : 0);
      return sum + Math.min(watched, it.duration);
    }, 0);
    const percent = totalDuration > 0 ? totalWatched / totalDuration : 0;
    const remainingSeconds = Math.max(totalDuration - totalWatched, 0);

    const summary = {
      totalLectures,
      knownDurations,
      totalDuration,
      totalWatched,
      percent,
      remainingSeconds,
    };

    res.json({ summary, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/progress/next/:courseId (protected) - get next lecture to watch
router.get('/progress/next/:courseId', auth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user.id;

    // Get all lectures sorted by orderIndex
    const lectures = await Lecture.find({ courseId }).sort({ orderIndex: 1 });
    if (lectures.length === 0) {
      return res.status(404).json({ error: 'No lectures found' });
    }

    // Get progress for these lectures
    const lectureIds = lectures.map((l) => l._id);
    const progressData = await UserProgress.find({ userId, courseId, lectureId: { $in: lectureIds } });
    const completedSet = new Set();
    progressData.forEach((p) => {
      if (p.completed) {
        completedSet.add(p.lectureId.toString());
      }
    });

    // Find first incomplete lecture
    let nextLecture = lectures.find((lec) => !completedSet.has(lec._id.toString()));

    // If all completed, return the first lecture
    if (!nextLecture) {
      nextLecture = lectures[0];
    }

    res.json({
      lectureId: nextLecture._id,
      videoId: nextLecture.videoId,
      title: nextLecture.title,
      orderIndex: nextLecture.orderIndex,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/profile/summary', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const [progress, enrolledCount] = await Promise.all([
      UserProgress.find({ userId }),
      UserCourseAccess.countDocuments({ userId, status: 'active' }),
    ]);
    
    const totalWatchTime = progress.reduce((s, p) => s + (p.secondsWatched || 0), 0);
    const completedLectures = progress.filter((p) => p.completed).length;
    res.json({ coursesEnrolled: enrolledCount, totalWatchTime, completedLectures });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
