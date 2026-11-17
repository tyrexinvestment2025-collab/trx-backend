const { Model } = require('../db/model');

/**
 * Очередь сообщений бота (outbox). Бизнес-логика только кладёт событие сюда,
 * отправкой занимается воркер (src/bot/outbox.js). Текст не храним — только шаблон и параметры.
 * eventId уникальный: повторная постановка того же события не создаст второе сообщение.
 * Отправленные записи старше 90 дней удаляет db/cleanup.
 */
module.exports = new Model('Outbox', 'outbox', {
  eventId: { type: 'text' },
  userId: { type: 'ref', ref: 'User', default: null },
  chatId: { type: 'text', default: null },        // для админ-чата (вместо userId)
  threadId: { type: 'int', default: null },       // тема в админ-группе
  template: { type: 'text' },                     // ключ шаблона, например deposit.confirmed
  params: { type: 'json', default: () => ({}) },
  group: { type: 'text', default: 'money' },      // группа настроек уведомлений
  status: { type: 'text', default: 'queued' },    // queued | sending | sent | failed | skipped
  attempts: { type: 'int', default: 0 },
  nextTryAt: { type: 'date', default: () => new Date() },
  lockedAt: { type: 'date', default: null },
  sentAt: { type: 'date', default: null },
  messageId: { type: 'bigint', default: null },
  error: { type: 'text', default: null },
}, { timestamps: true });
