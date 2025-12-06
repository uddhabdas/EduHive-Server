const express = require('express');
const router = express.Router();

router.post('/logs', (req, res) => {
  try {
    console.warn('client-log', { at: new Date().toISOString(), body: req.body });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;