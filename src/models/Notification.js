const { Model } = require('../db/model');

module.exports = new Model('Notification', 'notifications', {
  userId: { type: 'ref', ref: 'User' },
  title: { type: 'text' },
  message: { type: 'text' },
  type: { type: 'text', default: 'INFO' }, // INFO | DEPOSIT | WITHDRAWAL | SYSTEM
  isRead: { type: 'bool', default: false },
  // Ключ локализации + параметры: фронт переводит сам, title/message — запасной текст
  key: { type: 'text' },
  params: { type: 'json' },
}, { timestamps: true });
