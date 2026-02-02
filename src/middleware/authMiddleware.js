const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  // Проверяем заголовок Authorization: Bearer <token>
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Получаем токен из строки
      token = req.headers.authorization.split(' ')[1];

      // Декодируем
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Находим пользователя в БД и добавляем в req.user
      req.user = await User.findById(decoded.id).select('-password');

      next(); // Пропускаем запрос дальше к контроллеру
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

// Middleware для проверки прав Админа
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

module.exports = { protect, admin };