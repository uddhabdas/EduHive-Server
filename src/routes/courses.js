const express = require('express');
const { auth } = require('../middleware/auth');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const UserProgress = require('../models/UserProgress');
const { ALLOW_SKIP_IF_PREV_COMPLETED, COMPLETION_THRESHOLD } = require('../config/progress');

const router = express.Router();

// Optional local override thumbnails mapped by playlistId (explicit)
const OVERRIDE_THUMBS = {
  // Introduction to Cybersecurity
  'PLyqSpQzTE6M-jkJEzbS5oHJUp2GWPsq6e': 'introduction_to_cybersecurity.jpg',
  // Engineering Mathemat
  'PLbRMhDVUMngeVrxtbBz-n8HvP8KAWBpI5': 'engineering_mathematics.jpg',
  // Introduction to R
  'PLJ5C_6qdAvBFfF7qtFi8Pv_RK8x55jsUQ': 'introduction_to_r.jpg',
  // DSA using Python
  'PLyqSpQzTE6M_Fu6l8irVwXkUyC9Gwqr6_': 'dsa_using_python.jpg',
  // Programming in Java
  'PLbRMhDVUMngcx5xHChJ-f7ofxZI4JzuQR': 'programming_in_java.jpg',
};

// Build a dynamic map from filenames in public/course-images to support all courses
let FILE_STEM_MAP = null;
function loadFileStemMap() {
  if (FILE_STEM_MAP) return FILE_STEM_MAP;
  FILE_STEM_MAP = new Map();
  try {
    const dir = path.join(__dirname, '..', 'public', 'course-images');
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const stem = f.replace(/\.[^.]+$/, '').toLowerCase();
      FILE_STEM_MAP.set(stem, f);
    }
  } catch (_) {}
  return FILE_STEM_MAP;
}

function slugifyTitle(t) {
  return (t || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getOverrideUrlForCourse(_c, _base) {
  return null;
}

router.get('/courses', async (req, res) => {
  try {
    const PLACEHOLDER_THUMB = 'https://placehold.co/600x338/EEF2F7/475569?text=Course';
    const docs = await Course.find({ isActive: true }).sort({ createdAt: -1 });
    const Lecture = require('../models/Lecture');
    const courses = await Promise.all(docs.map(async (c) => {
      const cleanTitle = (c.title || '').trim();
      const desc = (c.description && c.description.trim()) ? c.description : `About: ${cleanTitle}`;
      const previews = await Lecture.find({ courseId: c._id, isPreview: true }).sort({ orderIndex: 1 }).limit(3);
      return ({
        _id: c._id,
        title: cleanTitle,
        description: desc,
        thumbnailUrl: (c.thumbnailUrl && c.thumbnailUrl.trim()) ? c.thumbnailUrl : PLACEHOLDER_THUMB,
        lectureCount: typeof c.lectureCount === 'number' ? c.lectureCount : 0,
        price: c.price || 0,
        isPaid: c.isPaid || false,
        previewAvailable: previews.length > 0,
        previewLectures: previews.map((l) => ({
          lectureId: l._id,
          title: l.title,
          orderIndex: l.orderIndex,
          previewUrl: l.previewUrl,
          duration: l.duration || 0,
        })),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });
    }));
    res.json(courses);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/courses/:id - get single course details (public)
router.get('/courses/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course || !course.isActive) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const cleanTitle = (course.title || '').trim();
    const desc = (course.description && course.description.trim()) ? course.description : `About: ${cleanTitle}`;
    const Lecture = require('../models/Lecture');
    const UserCourseAccess = require('../models/UserCourseAccess');
    const jwt = require('jsonwebtoken');
    let userHasAccess = false;
    const authHeader = req.headers.authorization || '';
    const [scheme, tokenHeader] = authHeader.split(' ');
    const token = tokenHeader || (req.query && req.query.token);
    if (scheme === 'Bearer' && token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded._id || decoded.id;
        if (course.isPaid && course.price > 0 && userId) {
          const access = await UserCourseAccess.findOne({ userId, courseId: course._id, status: 'active' });
          userHasAccess = !!access;
        }
      } catch {}
    }
    const lectures = await Lecture.find({ courseId: course._id }).sort({ orderIndex: 1, _id: 1 });
    
    res.json({
      _id: course._id,
      title: cleanTitle,
      description: desc,
      thumbnailUrl: (course.thumbnailUrl && course.thumbnailUrl.trim()) ? course.thumbnailUrl : 'https://placehold.co/600x338/EEF2F7/475569?text=Course',
      lectureCount: typeof course.lectureCount === 'number' ? course.lectureCount : 0,
      price: course.price || 0,
      isPaid: course.isPaid || false,
      about: course.about || '',
      highlights: Array.isArray(course.highlights) ? course.highlights : [],
      notes: course.notes || '',
      videoUrl: course.videoUrl || '',
      lectures: lectures.map((l) => ({
        lectureId: l._id,
        title: l.title,
        orderIndex: l.orderIndex,
        duration: l.duration || 0,
        isPreview: !!l.isPreview,
        videoPlayable: !!l.isPreview || userHasAccess,
        videoUrl: (!!l.isPreview || userHasAccess) ? (l.videoUrl || '') : null,
        previewUrl: l.previewUrl || '',
      })),
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Streaming endpoint with Range support and gating
router.get('/lectures/:id/stream', async (req, res) => {
  try {
    const Lecture = require('../models/Lecture');
    const Course = require('../models/Course');
    const UserCourseAccess = require('../models/UserCourseAccess');
    const jwt = require('jsonwebtoken');
    const axios = require('axios');

    const lec = await Lecture.findById(req.params.id);
    if (!lec) return res.status(404).json({ error: 'Lecture not found' });
    const course = await Course.findById(lec.courseId);
    if (!course || !course.isActive) return res.status(404).json({ error: 'Course not found' });

    let userHasAccess = false;
    const authHeader = req.headers.authorization || '';
    const [scheme, tokenHeader] = authHeader.split(' ');
    const token = tokenHeader || (req.query && req.query.token);
    if (scheme === 'Bearer' && token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded._id || decoded.id;
        if (course.isPaid && course.price > 0 && userId) {
          const access = await UserCourseAccess.findOne({ userId, courseId: course._id, status: 'active' });
          userHasAccess = !!access;
        }
      } catch {}
    }

    const allow = lec.isPreview || userHasAccess || !(course.isPaid && course.price > 0);
    const targetUrl = lec.isPreview ? (lec.previewUrl || lec.videoUrl) : lec.videoUrl;
    if (!allow || !targetUrl) {
      return res.status(403).json({ error: 'Not authorized to stream this video' });
    }

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Content-Disposition', 'inline');

    const range = req.headers.range;
    const headers = {
      'Accept': 'video/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(range ? { Range: range } : {}),
    };
    
    try {
      const { Transform } = require('stream');
      const rangeHeader = req.headers.range || '';
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      let start = null; let end = null;
      if (m) { start = parseInt(m[1], 10); end = m[2] ? parseInt(m[2], 10) : null; }

      let totalSize = null;
      try {
        const head = await axios.head(targetUrl, { headers: { 'User-Agent': headers['User-Agent'] }, timeout: 15000, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 400 });
        totalSize = parseInt(head.headers['content-length'] || '', 10);
      } catch {}
      if (!totalSize && rangeHeader) {
        try {
          const probe = await axios.get(targetUrl, { headers: { ...headers, Range: 'bytes=0-0' }, timeout: 15000, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 400 });
          const cr = probe.headers['content-range'];
          const tm = cr && /\/(\d+)$/.exec(cr);
          if (tm) totalSize = parseInt(tm[1], 10);
        } catch {}
      }

      if (!rangeHeader) {
        const upstream = await axios.get(targetUrl, { responseType: 'stream', headers, timeout: 30000, validateStatus: (s) => s >= 200 && s < 400, maxRedirects: 5 });
        const contentType = upstream.headers['content-type'] || 'video/mp4';
        const contentLength = upstream.headers['content-length'];
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
        res.setHeader('Content-Disposition', 'inline');
        if (contentLength) res.setHeader('Content-Length', contentLength);
        res.status(200);
        upstream.data.pipe(res);
        upstream.data.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: 'Stream error' }); else res.destroy(); });
        res.on('aborted', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });
        res.on('close', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });
        return;
      }

      const reqStart = start !== null ? Math.max(0, start) : 0;
      let reqEnd = end !== null ? end : (totalSize ? totalSize - 1 : null);
      if (totalSize && reqEnd !== null) reqEnd = Math.min(reqEnd, totalSize - 1);
      const chunkSize = reqEnd !== null ? (reqEnd - reqStart + 1) : null;

      const upstream = await axios.get(targetUrl, { responseType: 'stream', headers, timeout: 30000, validateStatus: (s) => s >= 200 && s < 400, maxRedirects: 5 });
      const status = upstream.status;
      const contentType = upstream.headers['content-type'] || 'video/mp4';
      const upstreamCR = upstream.headers['content-range'];
      const upstreamCL = upstream.headers['content-length'];

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
      res.setHeader('Content-Disposition', 'inline');

      if (status === 206 && upstreamCR) {
        res.setHeader('Content-Range', upstreamCR);
        if (upstreamCL) res.setHeader('Content-Length', upstreamCL);
        res.status(206);
        upstream.data.pipe(res);
        upstream.data.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: 'Stream error' }); else res.destroy(); });
        res.on('aborted', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });
        res.on('close', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });
        return;
      }

      if (totalSize && chunkSize) {
        res.setHeader('Content-Range', `bytes ${reqStart}-${reqEnd}/${totalSize}`);
        res.setHeader('Content-Length', String(chunkSize));
      }
      res.status(206);

      let skipped = 0;
      let passed = 0;
      const slicer = new Transform({
        transform(chunk, _enc, cb) {
          let buf = chunk;
          if (skipped < reqStart) {
            const need = reqStart - skipped;
            if (buf.length <= need) { skipped += buf.length; return cb(); }
            buf = buf.slice(need);
            skipped += need;
          }
          if (chunkSize !== null) {
            const remaining = chunkSize - passed;
            if (buf.length > remaining) {
              const slice = buf.slice(0, remaining);
              passed += slice.length;
              this.push(slice);
              return cb();
            } else {
              passed += buf.length;
              this.push(buf);
              if (passed >= chunkSize) this.end();
              return cb();
            }
          }
          this.push(buf);
          return cb();
        }
      });

      upstream.data.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: 'Stream error' }); else res.destroy(); });
      slicer.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Stream error' }); else res.destroy(); });
      res.on('aborted', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });
      res.on('close', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });

      upstream.data.pipe(slicer).pipe(res);
    } catch (axiosError) {
      if (!res.headersSent) {
        if (axiosError.response) {
          res.status(axiosError.response.status || 500).json({ error: 'Failed to fetch video' });
        } else if (axiosError.code === 'ECONNABORTED') {
          res.status(504).json({ error: 'Request timeout' });
        } else {
          res.status(500).json({ error: 'Failed to stream video' });
        }
      }
    }
  } catch (e) {
    console.error('Stream endpoint error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Generic proxy for streaming with proper headers
router.get('/stream', async (req, res, next) => {
  try {
    return next();
  } catch (e) {
    console.error('GET /api/stream error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/courses/:id/lectures (protected) - ordered lectures for a course
router.get('/courses/:id/lectures', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const UserCourseAccess = require('../models/UserCourseAccess');
    const Course = require('../models/Course');
    
    // Check if course exists and if it's paid
    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // If course is paid, require active access record
    if (course.isPaid && course.price > 0) {
      const access = await UserCourseAccess.findOne({ userId: req.user.id, courseId: id, status: 'active' });
      if (!access) {
        return res.status(403).json({ 
          error: 'Access revoked or not purchased',
          message: 'You need active access to view lectures',
          courseId: id,
          price: course.price,
        });
      }
    }

    const lectures = await Lecture.find({ courseId: id }).sort({ orderIndex: 1, _id: 1 });

    // Attach per-lecture progress + sequential lock state
    const userId = req.user.id;
    const progressData = await UserProgress.find({ userId, courseId: id });
    const progressMap = {};
    progressData.forEach((p) => {
      progressMap[p.lectureId.toString()] = p;
    });

    let hasIncompleteBefore = false;
    const enriched = lectures.map((lec, index) => {
      const prog = progressMap[lec._id.toString()];
      const duration = prog && prog.duration > 0 ? prog.duration : lec.duration || 0;
      const maxWatchedSeconds = prog && typeof prog.secondsWatched === 'number'
        ? prog.secondsWatched
        : (prog ? prog.position : 0);
      const ratio = duration > 0 ? maxWatchedSeconds / duration : 0;
      const watchedPercentage = Math.min(100, Math.round(ratio * 100));
      const completed = !!(prog && prog.completed);

      // sequential lock logic
      let locked = false;
      if (index === 0) {
        locked = false;
      } else if (!ALLOW_SKIP_IF_PREV_COMPLETED) {
        locked = hasIncompleteBefore;
      } else {
        const prevLecture = lectures[index - 1];
        const prevProg = progressMap[prevLecture._id.toString()];
        const prevDuration = prevProg && prevProg.duration > 0 ? prevProg.duration : prevLecture.duration || 0;
        const prevMax = prevProg && typeof prevProg.secondsWatched === 'number'
          ? prevProg.secondsWatched
          : (prevProg ? prevProg.position : 0);
        const prevRatio = prevDuration > 0 ? prevMax / prevDuration : 0;
        const prevCompleted = !!(prevProg && prevProg.completed) || prevRatio >= COMPLETION_THRESHOLD;
        locked = !prevCompleted;
      }

      if (!completed) {
        hasIncompleteBefore = true;
      }

      return {
        _id: lec._id,
        courseId: lec.courseId,
        title: lec.title,
        videoId: lec.videoId,
        videoUrl: lec.videoUrl,
        previewUrl: lec.previewUrl,
        isPreview: !!lec.isPreview,
        orderIndex: lec.orderIndex,
        duration,
        thumbnailUrl: lec.thumbnailUrl,
        notes: lec.notes,
        notesFileUrl: lec.notesFileUrl,
        // progress
        position: prog ? prog.position : 0,
        completed,
        maxWatchedSeconds,
        watchedPercentage,
        locked,
      };
    });

    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/courses/:id/access', auth, async (_req, res) => {
  return res.json({ access: 'unlocked' });
});

router.delete('/courses/:id/access', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const UserCourseAccess = require('../models/UserCourseAccess');
    const UserProgress = require('../models/UserProgress');
    const CoursePurchase = require('../models/CoursePurchase');

    const accessDel = await UserCourseAccess.deleteMany({ userId, courseId: id });
    const progressDel = await UserProgress.deleteMany({ userId, courseId: id });
    const purchaseDel = await CoursePurchase.deleteMany({ userId, courseId: id });

    return res.json({
      ok: true,
      deleted: {
        access: accessDel.deletedCount || 0,
        progress: progressDel.deletedCount || 0,
        purchases: purchaseDel.deletedCount || 0,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// List courses with active access for the current user
router.get('/my/access', auth, async (req, res) => {
  try {
    const UserCourseAccess = require('../models/UserCourseAccess');
    const Course = require('../models/Course');
  const accessDocs = await UserCourseAccess
    .find({ userId: req.user.id, status: 'active' })
    .populate('courseId')
    .sort({ createdAt: -1 });
  const courses = accessDocs
    .map((doc) => doc.courseId)
    .filter((c) => !!c)
    .map((c) => {
      const cleanTitle = (c.title || '').trim();
      const desc = (c.description && c.description.trim()) ? c.description : `About: ${cleanTitle}`;
      return ({
        _id: c._id,
        title: cleanTitle,
        description: desc,
        thumbnailUrl: (c.thumbnailUrl && c.thumbnailUrl.trim()) ? c.thumbnailUrl : 'https://placehold.co/600x338/EEF2F7/475569?text=Course',
        lectureCount: typeof c.lectureCount === 'number' ? c.lectureCount : 0,
        price: c.price || 0,
        isPaid: c.isPaid || false,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });
    });
    return res.json(courses);
  } catch (e) {
    console.error('GET /api/my/access error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});
    
router.post('/courses/:id/sync-from-player', auth, async (_req, res) => {
  return res.status(410).json({ error: 'deprecated' });
});

// Fallback: import playlist by scraping public YouTube playlist HTML (no Data API)
router.post('/courses/:id/import-playlist', auth, async (req, res) => {
  try {
    const axios = require('axios');
    const { id } = req.params;
    const course = await Course.findById(id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!course.sourcePlaylistId) return res.status(400).json({ error: 'No sourcePlaylistId' });

    const desktopUrl = `https://www.youtube.com/playlist?list=${course.sourcePlaylistId}`;
    const mobileUrl = `https://m.youtube.com/playlist?list=${course.sourcePlaylistId}`;

    async function fetchHtml(url, ua) {
      const resp = await axios.get(url, {
        headers: {
          'User-Agent': ua,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 10000,
        validateStatus: () => true,
      });
      if (resp.status < 200 || resp.status >= 400) return '';
      return resp.data || '';
    }

    let html = await fetchHtml(desktopUrl, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
    let ids = Array.from(new Set([...(html.matchAll(/\"videoId\":\"([a-zA-Z0-9_-]{11})\"/g))].map(m => m[1])));

    if (ids.length === 0) {
      // fallback to mobile HTML and watch hrefs
      const hrefIds = Array.from(new Set([...(html.matchAll(/href=\\"\/watch\?v=([a-zA-Z0-9_-]{11})/g))].map(m => m[1])));
      ids = hrefIds;
    }

    if (ids.length === 0) return res.status(404).json({ error: 'no_videos_found' });
    const first = await Lecture.findOne({ courseId: course._id }).sort({ orderIndex: 1 });
    const courseThumbSeed = (first && first.thumbnailUrl) ? first.thumbnailUrl : 'https://placehold.co/600x338/EEF2F7/475569?text=Course';
    // build items (cap to 300)
    const items = ids.slice(0, 300).map((vid, idx) => ({ videoId: vid, title: `Video ${idx + 1}`, orderIndex: idx + 1 }));

    let upserts = 0;

    for (const item of items) {
      const update = {
        courseId: course._id,
        title: item.title,
        videoId: item.videoId,
        orderIndex: item.orderIndex,
        isLocked: false,
      };
      
      await Lecture.updateOne({ courseId: course._id, videoId: item.videoId }, { $set: update }, { upsert: true });
      upserts++;
    }

    const lectureCount = await Lecture.countDocuments({ courseId: course._id });
    const firstLecture = await Lecture.findOne({ courseId: course._id }).sort({ orderIndex: 1 });
    const courseThumbFinal = (course.thumbnailUrl && course.thumbnailUrl.trim())
      ? course.thumbnailUrl
      : ((firstLecture && firstLecture.thumbnailUrl) ? firstLecture.thumbnailUrl : 'https://placehold.co/600x338/EEF2F7/475569?text=Course');
    await Course.updateOne({ _id: course._id }, { $set: { lectureCount, thumbnailUrl: courseThumbFinal } });

    return res.json({ ok: true, upserts, deleted: 0, lectureCount, thumbnailUrl: courseThumbFinal });
  } catch (e) {
    console.error('import-playlist failed:', e?.message || e);
    return res.status(500).json({ error: 'Server error' });
  }
});

const jwt = require('jsonwebtoken');

router.get('/courses/recommended', async (req, res) => {
  try {
    const PLACEHOLDER_THUMB = 'https://placehold.co/600x338/EEF2F7/475569?text=Course';

    let userId = null;
    try {
      const authHeader = req.headers.authorization || '';
      const [, token] = authHeader.split(' ');
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded._id || decoded.id || null;
      }
    } catch {}

    const courses = await Course.find({ isActive: true }).sort({ lectureCount: -1, createdAt: -1 });

    let result = [];
    if (userId) {
      result = courses
        .slice(0, 6)
        .map((c) => {
          const cleanTitle = (c.title || '').trim();
          const desc = (c.description && c.description.trim()) ? c.description : `About: ${cleanTitle}`;
          return ({
            _id: c._id,
            title: cleanTitle,
            description: desc,
            thumbnailUrl: (c.thumbnailUrl && c.thumbnailUrl.trim()) ? c.thumbnailUrl : PLACEHOLDER_THUMB,
            lectureCount: typeof c.lectureCount === 'number' ? c.lectureCount : 0,
            price: c.price || 0,
            isPaid: c.isPaid || false,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          });
        });
    } else {
      result = courses
        .slice(0, 6)
        .map((c) => {
          const cleanTitle = (c.title || '').trim();
          const desc = (c.description && c.description.trim()) ? c.description : `About: ${cleanTitle}`;
          return ({
            _id: c._id,
            title: cleanTitle,
            description: desc,
            thumbnailUrl: (c.thumbnailUrl && c.thumbnailUrl.trim()) ? c.thumbnailUrl : PLACEHOLDER_THUMB,
            lectureCount: typeof c.lectureCount === 'number' ? c.lectureCount : 0,
            price: c.price || 0,
            isPaid: c.isPaid || false,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          });
        });
    }

    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
