const jwt = require('jsonwebtoken');
const User = require('../models/User');

const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id || decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if ((user.sessionVersion || 0) !== (decoded.sessionVersion || 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    if (user.role !== 'admin' && user.role !== 'teacher') {
      return res.status(403).json({ error: 'Access denied. Admin or Teacher role required' });
    }

    req.user = { id: user._id, email: user.email, role: user.role };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { adminAuth };

