const express = require('express');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');

const router = express.Router();

// Dev-only seed route (supports /api/dev/seed when mounted at /api and /api/dev)
router.post(['/dev/seed', '/seed'], async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Forbidden in production' });
    }

    // Idempotent seed: if course exists, reuse
    let course = await Course.findOne({ title: 'Python Basics (Demo)' });
    if (!course) {
      course = await Course.create({
        title: 'Python Basics (Demo)',
        description: 'A short demo course showing the flow',
        thumbnailUrl: '',
        isActive: true,
      });
    }

    const videoIds = ['dQw4w9WgXcQ', 'kxopViU98Xo', '3GwjfUFyY6M', '9bZkp7q19f0', 'oHg5SJYRHA0'];
    const toInsert = [];
    for (let i = 0; i < videoIds.length; i++) {
      const exists = await Lecture.findOne({ courseId: course._id, orderIndex: i + 1 });
      if (!exists) {
        toInsert.push({
          courseId: course._id,
          title: `Lecture ${i + 1}`,
          videoId: videoIds[i],
          orderIndex: i + 1,
          isLocked: false,
        });
      }
    }
    if (toInsert.length) await Lecture.insertMany(toInsert);

    const lectures = await Lecture.find({ courseId: course._id }).sort({ orderIndex: 1 });
    return res.json({ course, lectures });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Import YouTube playlists into courses/lectures (dev only)
router.post(['/dev/import-playlists', '/import-playlists'], async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Forbidden in production' });
    }
    const { playlistIds } = req.body || {};
    if (!Array.isArray(playlistIds) || playlistIds.length === 0) {
      return res.status(400).json({ error: 'playlistIds array required' });
    }

    // Check for YOUTUBE_API_KEY
    if (!process.env.YOUTUBE_API_KEY) {
      return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured in .env' });
    }

    const { importPlaylist } = require('../services/importPlaylist');
    const results = [];
    for (const id of playlistIds) {
      const summary = await importPlaylist(id);
      results.push(summary);
    }

    const totalLectures = results.reduce((sum, r) => sum + r.lectureCount, 0);

    return res.json({
      ok: true,
      results,
      totalCourses: results.length,
      totalLectures,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error', details: e.message });
  }
});

// Dev self-unlock: persists access for the current user
const { auth } = require('../middleware/auth');
router.post(['/dev/self-unlock/:id', '/self-unlock/:id'], auth, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Forbidden in production' });
    }
    if (process.env.DEV_SELF_UNLOCK !== 'true') {
      return res.status(403).json({ error: 'Self-unlock disabled' });
    }
    const Access = require('../models/UserCourseAccess');
    const { id } = req.params;
    await Access.updateOne(
      { userId: req.user.id, courseId: id },
      { $set: { status: 'active' } },
      { upsert: true }
    );
    return res.json({ access: 'unlocked', courseId: id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post(['/seed/demo-courses', '/demo/seed-courses'], async (_req, res) => {
  try {
    const Course = require('../models/Course');
    const demos = [
      {
        title: 'Programming in Java',
        sourcePlaylistId: 'PLbRMhDVUMngcx5xHChJ-f7ofxZI4JzuQR',
        thumbnailUrl: '',
        description: 'Programming in Java — curated YouTube playlist',
      },
      {
        title: 'DSA using Python',
        sourcePlaylistId: 'PLyqSpQzTE6M_Fu6l8irVwXkUyC9Gwqr6_',
        thumbnailUrl: '',
        description: 'Data Structures & Algorithms using Python',
      },
      {
        title: 'Introduction to R',
        sourcePlaylistId: 'PLJ5C_6qdAvBFfF7qtFi8Pv_RK8x55jsUQ',
        thumbnailUrl: '',
        description: 'R programming basics — curated YouTube playlist',
      },
      {
        title: 'Engineering Mathematics',
        sourcePlaylistId: 'PLbRMhDVUMngeVrxtbBz-n8HvP8KAWBpI5',
        thumbnailUrl: '',
        description: 'Engineering Mathematics — curated YouTube playlist',
      },
      {
        title: 'Introduction to Cybersecurity',
        sourcePlaylistId: 'PLyqSpQzTE6M-jkJEzbS5oHJUp2GWPsq6e',
        thumbnailUrl: '',
        description: 'Introduction to Cybersecurity — curated YouTube playlist',
      },
    ];

    let created = 0;
    const results = [];
    for (const d of demos) {
      const update = {
        title: d.title,
        description: d.description || '',
        thumbnailUrl: d.thumbnailUrl || '',
        isActive: true,
        source: 'youtube',
        sourcePlaylistId: d.sourcePlaylistId,
      };
      const doc = await Course.findOneAndUpdate(
        { source: 'youtube', sourcePlaylistId: d.sourcePlaylistId },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      if (!doc.lectureCount || doc.lectureCount === 0) created++;
      results.push(doc);
    }

    return res.json({ ok: true, created, total: results.length, courses: results });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
