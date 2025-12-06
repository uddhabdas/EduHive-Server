const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { Transform, PassThrough } = require('stream');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Helper to verify token from Authorization header first, then optional query token (for legacy video URLs)
async function verifyTokenOptional(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: decoded._id || decoded.id, email: decoded.email };
      return next();
    } catch (e) {
      // fall through to query token
    }
  }

  const queryToken = req.query.token;
  if (queryToken) {
    try {
      const decoded = jwt.verify(queryToken, process.env.JWT_SECRET);
      req.user = { id: decoded._id || decoded.id, email: decoded.email };
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
}

// Video streaming proxy endpoint
// GET /api/stream?url=<encodedVideoUrl>
router.get('/stream', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    const decodedUrl = decodeURIComponent(url);
    
    // Validate URL format
    try {
      new URL(decodedUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Get Range header from request
    const range = req.headers.range;
    
    // Prepare headers for upstream request
    const headers = {
      'User-Agent': 'EduHive-Streaming-Proxy/1.0',
    };

    // Forward Range header if present
    if (range) {
      headers['Range'] = range;
    }

    // Helper to parse range header (handles missing totalSize if explicit end provided)
    function parseRange(rangeHeader, totalSize) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader || '');
      if (!m) return null;
      const start = parseInt(m[1], 10);
      let end = null;
      if (m[2]) {
        end = parseInt(m[2], 10);
      } else if (typeof totalSize === 'number' && totalSize > 0) {
        end = totalSize - 1;
      }
      if (Number.isNaN(start) || start < 0) return null;
      if (end === null) return null;
      if (Number.isNaN(end) || end < start) {
        if (typeof totalSize === 'number' && totalSize > 0) {
          end = totalSize - 1;
        } else {
          end = start + (256 * 1024) - 1; // default to 256KB if unknown total
        }
      }
      if (typeof totalSize === 'number' && totalSize > 0) {
        end = Math.min(end, totalSize - 1);
      }
      return { start, end };
    }

    // If Range present, try to determine total size via HEAD first
    let totalSize = null;
    if (range) {
      try {
        const headResp = await axios.head(decodedUrl, { headers, timeout: 5000, validateStatus: (s) => s >= 200 && s < 500 });
        const len = headResp.headers['content-length'];
        if (len && !Number.isNaN(parseInt(len, 10))) totalSize = parseInt(len, 10);
      } catch (_) {}
    }

    const t0 = Date.now();
    console.log('[stream] GET /api/stream start', { range: !!range });
    console.log('[stream] GET /api/stream start', { range: !!range, reqRange: req.headers.range });
    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers,
      responseType: 'stream',
      timeout: 8000,
      validateStatus: (status) => status >= 200 && status < 400,
      maxRedirects: 5,
    });

    // Get content type from upstream
    let contentType = response.headers['content-type'] || 'video/mp4';
    const contentLength = response.headers['content-length'];
    const acceptRanges = response.headers['accept-ranges'] || 'bytes';
    const contentRange = response.headers['content-range'];

    if (contentType && /^text\//i.test(contentType)) {
      console.log('[stream] upstream content-type override', contentType);
      contentType = 'video/mp4';
    }

    // Set response headers for browser streaming
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': 'inline', // Force inline (play) instead of download
      'Accept-Ranges': acceptRanges || 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    });

    // If Range requested, enforce 206 semantics
    if (range) {
      if (response.status === 206) {
        console.log('[stream] branch=upstream-206');
        res.status(206);
        if (contentRange) res.set('Content-Range', contentRange);
        if (contentLength) res.set('Content-Length', contentLength);
        try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
        try { res.write(''); } catch {}
        const fast = new PassThrough({ highWaterMark: 256 * 1024 });
        response.data.once('data', () => {
          console.log('[stream] TTFB (flush->first-chunk) ms', Date.now() - t0);
        });
        response.data.pipe(fast).pipe(res);
      } else {
        // Upstream returned 200; craft 206 manually if possible
        if (!totalSize && contentLength && !Number.isNaN(parseInt(contentLength, 10))) {
          totalSize = parseInt(contentLength, 10);
        }
        const rng = totalSize ? parseRange(range, totalSize) : null;
        if (!rng) {
          // Attempt manual 206 using upstream content-length if available
          console.log('[stream] branch=range-present-no-rng -> manual-206');
          const { start, end } = parseRange(range, contentLength ? parseInt(contentLength, 10) : null) || { start: 0, end: (256 * 1024) - 1 };
          const chunkSize = end - start + 1;
          res.status(206);
          res.set('Content-Range', contentLength ? `bytes ${start}-${end}/${parseInt(contentLength, 10)}` : `bytes ${start}-${end}/*`);
          res.set('Content-Length', String(chunkSize));
          let passed = 0;
          let skipped = 0;
          const slicer = new Transform({
            transform(chunk, _enc, cb) {
              let buf = chunk;
              if (skipped < start) {
                const need = start - skipped;
                if (buf.length <= need) { skipped += buf.length; return cb(); }
                buf = buf.slice(need); skipped += need;
              }
              const remaining = chunkSize - passed;
              if (buf.length > remaining) {
                const slice = buf.slice(0, remaining);
                passed += slice.length; this.push(slice); return cb();
              } else {
                passed += buf.length; this.push(buf);
                if (passed >= chunkSize) this.end();
                return cb();
              }
            }
          });
          try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
          try { res.write(''); } catch {}
          const fast = new PassThrough({ highWaterMark: 256 * 1024 });
          response.data.once('data', () => { console.log('[stream] TTFB (flush->first-chunk) ms', Date.now() - t0); });
          response.data.pipe(slicer).pipe(fast).pipe(res);
        } else {
          const { start, end } = rng;
          const chunkSize = end - start + 1;
          console.log('[stream] branch=manual-206-slice', { start, end, chunkSize });
          res.status(206);
          res.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
          res.set('Content-Length', String(chunkSize));
          // Create slicing transform to drop bytes before start and stop after end
          let passed = 0; // bytes passed downstream
          let skipped = 0; // bytes skipped from upstream
          const slicer = new Transform({
            transform(chunk, _enc, cb) {
              let buf = chunk;
              // Skip until start
              if (skipped < start) {
                const needSkip = start - skipped;
                if (buf.length <= needSkip) {
                  skipped += buf.length;
                  return cb();
                } else {
                  buf = buf.slice(needSkip);
                  skipped += needSkip;
                }
              }
              // Limit to end
              const remaining = chunkSize - passed;
              if (buf.length > remaining) {
                const slice = buf.slice(0, remaining);
                passed += slice.length;
                this.push(slice);
                return cb();
              } else {
                passed += buf.length;
                this.push(buf);
                if (passed >= chunkSize) {
                  this.end();
                }
                return cb();
              }
            }
          });
          try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
          try { res.write(''); } catch {}
          const fast = new PassThrough({ highWaterMark: 256 * 1024 });
          response.data.once('data', () => {
            console.log('[stream] TTFB (flush->first-chunk) ms', Date.now() - t0);
          });
          response.data.pipe(slicer).pipe(fast).pipe(res);
        }
      }
    } else {
      // No range request - pass through
      console.log('[stream] branch=no-range', { reqRange: req.headers.range });
      res.status(200);
      if (contentLength) res.set('Content-Length', contentLength);
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
      try { res.write(''); } catch {}
      const fast = new PassThrough({ highWaterMark: 256 * 1024 });
      response.data.once('data', () => {
        console.log('[stream] TTFB (flush->first-chunk) ms', Date.now() - t0);
      });
      response.data.pipe(fast).pipe(res);
    }

    // Handle errors during streaming
    response.data.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error' });
      }
    });

  } catch (error) {
    console.error('Stream proxy error:', error.message);
    
    if (error.response) {
      // Upstream error
      const status = error.response.status || 500;
      const message = error.response.statusText || 'Upstream error';
      return res.status(status).json({ error: message });
    }
    
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Request timeout' });
    }
    
    res.status(500).json({ error: 'Stream proxy failed' });
  }
});

// Secure lecture streaming endpoint that hides upstream URL
// GET /api/stream/:id
router.get('/stream/:id', verifyTokenOptional, async (req, res) => {
  try {
    const Lecture = require('../models/Lecture');
    const Course = require('../models/Course');

    const lec = await Lecture.findById(req.params.id);
    if (!lec) return res.status(404).json({ error: 'Lecture not found' });
    const course = await Course.findById(lec.courseId);
    if (!course || !course.isActive) return res.status(404).json({ error: 'Course not found' });

    let userHasAccess = false;
    const isPaidCourse = course.isPaid && course.price > 0;
    if (isPaidCourse && req.user && req.user.id) {
      const UserCourseAccess = require('../models/UserCourseAccess');
      const access = await UserCourseAccess.findOne({ userId: req.user.id, courseId: course._id, status: 'active' });
      userHasAccess = !!access;
    }

    const allow = lec.isPreview || userHasAccess || !isPaidCourse;
    const targetUrl = lec.isPreview ? (lec.previewUrl || lec.videoUrl) : lec.videoUrl;
    if (!allow || !targetUrl) {
      return res.status(403).json({ error: 'Not authorized to stream this video' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Content-Disposition', 'inline');

    const rangeHeader = req.headers.range;
    console.log('[stream:id] RCV RANGE', rangeHeader);
    const headers = {
      'Accept': 'video/*',
      'User-Agent': 'EduHive-Streaming-Proxy/1.0',
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    };

    // Try to determine total size
    let totalSize = null;
    try {
      const head = await axios.head(targetUrl, { headers: { 'User-Agent': headers['User-Agent'] }, timeout: 1500, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 400 });
      totalSize = parseInt(head.headers['content-length'] || '', 10);
    } catch {}
    if (!totalSize && rangeHeader) {
      try {
      const probe = await axios.get(targetUrl, { headers: { ...headers, Range: 'bytes=0-0' }, timeout: 5000, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 400 });
        const cr = probe.headers['content-range'];
        const tm = cr && /\/(\d+)$/.exec(cr);
        if (tm) totalSize = parseInt(tm[1], 10);
      } catch {}
    }

    const t1 = Date.now();
    console.log('[stream:id] GET start');
    const upstream = await axios.get(targetUrl, { responseType: 'stream', headers, timeout: 8000, validateStatus: (s) => s >= 200 && s < 400, maxRedirects: 5 });
    const status = upstream.status;
    let contentType2 = upstream.headers['content-type'] || 'video/mp4';
    const upstreamCR = upstream.headers['content-range'];
    const upstreamCL = upstream.headers['content-length'];

    console.log('[stream:id] upstream', { status, contentType: contentType2 });
    if (contentType2 && /^text\//i.test(contentType2)) {
      console.log('[stream:id] upstream content-type override', contentType2);
      contentType2 = 'video/mp4';
    }

    res.setHeader('Content-Type', contentType2);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Content-Disposition', 'inline');

    if (rangeHeader) {
      if (status === 206 && upstreamCR) {
        res.setHeader('Content-Range', upstreamCR);
        if (upstreamCL) res.setHeader('Content-Length', upstreamCL);
        res.status(206);
        try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
        try { res.write(''); } catch {}
        const fast = new PassThrough({ highWaterMark: 256 * 1024 });
        upstream.data.once('data', () => { console.log('[stream:id] TTFB ms', Date.now() - t1); });
        upstream.data.pipe(fast).pipe(res);
      } else {
        // Craft 206 if possible
        const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader || '');
        let start = null; let end = null;
        if (m) { start = parseInt(m[1], 10); end = m[2] ? parseInt(m[2], 10) : (totalSize ? totalSize - 1 : null); }
        const reqStart = start !== null ? Math.max(0, start) : 0;
        let reqEnd = end !== null ? end : (totalSize ? totalSize - 1 : null);
        if (totalSize && reqEnd !== null) reqEnd = Math.min(reqEnd, totalSize - 1);
        const chunkSize = (reqEnd !== null) ? (reqEnd - reqStart + 1) : null;
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
        try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
        try { res.write(''); } catch {}
        const fast = new PassThrough({ highWaterMark: 256 * 1024 });
        upstream.data.once('data', () => { console.log('[stream:id] TTFB ms', Date.now() - t1); });
        upstream.data.pipe(slicer).pipe(fast).pipe(res);
      }
    } else {
      // No range
      if (upstreamCL) res.setHeader('Content-Length', upstreamCL);
      res.status(200);
      try { if (typeof res.flushHeaders === 'function') res.flushHeaders(); } catch {}
      try { res.write(''); } catch {}
      const fast = new PassThrough({ highWaterMark: 256 * 1024 });
      upstream.data.once('data', () => { console.log('[stream:id] TTFB ms', Date.now() - t1); });
      upstream.data.pipe(fast).pipe(res);
    }

    upstream.data.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Stream error' }); });
    res.on('aborted', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });
    res.on('close', () => { if (upstream.data && typeof upstream.data.destroy === 'function') upstream.data.destroy(); });
  } catch (e) {
    console.error('GET /api/stream/:id error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

router.get('/stream/:id/manifest', verifyTokenOptional, async (req, res) => {
  try {
    const Lecture = require('../models/Lecture');
    const Course = require('../models/Course');
    const lec = await Lecture.findById(req.params.id);
    if (!lec) return res.status(404).json({ error: 'Lecture not found' });
    const course = await Course.findById(lec.courseId);
    if (!course || !course.isActive) return res.status(404).json({ error: 'Course not found' });
    let userHasAccess = false;
    const isPaidCourse = course.isPaid && course.price > 0;
    if (isPaidCourse && req.user && req.user.id) {
      const UserCourseAccess = require('../models/UserCourseAccess');
      const access = await UserCourseAccess.findOne({ userId: req.user.id, courseId: course._id, status: 'active' });
      userHasAccess = !!access;
    }
    const allow = lec.isPreview || userHasAccess || !isPaidCourse;
    const targetUrl = lec.isPreview ? (lec.previewUrl || lec.videoUrl) : lec.videoUrl;
    if (!allow || !targetUrl) return res.status(403).json({ error: 'Not authorized to stream this video' });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Content-Disposition', 'inline');

    const headers = { 'User-Agent': 'EduHive-Streaming-Proxy/1.0', Accept: 'application/vnd.apple.mpegurl, */*' };
    let contentType = '';
    try {
      const head = await axios.head(targetUrl, { headers, timeout: 5000, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 500 });
      contentType = head.headers['content-type'] || '';
    } catch {}

    const prefix = '/api/stream?url=';

    const isM3U8 = (/application\/vnd\.apple\.mpegurl/i.test(contentType)) || (/application\/x-mpegURL/i.test(contentType)) || /\.m3u8(\?|$)/i.test(targetUrl);
    const isTS = (/video\/mp2t/i.test(contentType)) || /\.ts(\?|$)/i.test(targetUrl);

    if (isM3U8) {
      const resp = await axios.get(targetUrl, { headers, timeout: 8000, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 400, responseType: 'text' });
      const base = new URL(targetUrl);
      function resolveUrl(u) {
        try { return new URL(u, base).toString(); } catch { return u; }
      }
      let body = String(resp.data || '');
      body = body.replace(/URI="([^"]+)"/g, (_m, p1) => {
        const abs = resolveUrl(p1);
        return `URI=\"${prefix}${encodeURIComponent(abs)}\"`;
      });
      const lines = body.split(/\r?\n/);
      const out = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const abs = resolveUrl(trimmed);
        return `${prefix}${encodeURIComponent(abs)}`;
      }).join('\n');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.status(200);
      res.send(out);
      return;
    }

    if (isTS) {
      const abs = targetUrl;
      const seg = `${prefix}${encodeURIComponent(abs)}`;
      const m3u8 = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:30',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:30.0,',
        seg,
        '#EXT-X-ENDLIST'
      ].join('\n');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.status(200);
      res.send(m3u8);
      return;
    }

    res.status(415).json({ error: 'Unsupported source type' });
  } catch (e) {
    console.error('GET /api/stream/:id/manifest error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
