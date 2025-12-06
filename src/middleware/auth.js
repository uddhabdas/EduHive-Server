const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id || decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if ((user.sessionVersion || 0) !== (decoded.sessionVersion || 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.user = { id: user._id, email: user.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { auth };
