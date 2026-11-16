const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) return res.status(401).json({ message: 'Not authorized, user not found' });
    if (user.isBanned) return res.status(403).json({ message: 'Account is banned', code: 'BANNED' });

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// Middleware для проверки прав Админа
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') return next();
  return res.status(403).json({ message: 'Not authorized as an admin' });
};

module.exports = { protect, admin };
