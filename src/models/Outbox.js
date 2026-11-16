const mongoose = require('mongoose');

/**
 * Очередь сообщений бота (outbox). Бизнес-логика только кладёт событие сюда,
 * отправкой занимается воркер (src/bot/outbox.js). Текст не храним — только шаблон и параметры.
 * eventId уникальный: повторная постановка того же события не создаст второе сообщение.
 */
const outboxSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  chatId: { type: String, default: null },        // для админ-чата (вместо userId)
  threadId: { type: Number, default: null },      // тема в админ-группе
  template: { type: String, required: true },     // ключ шаблона, например deposit.confirmed
  params: { type: mongoose.Schema.Types.Mixed, default: {} },
  group: { type: String, default: 'money' },      // группа настроек уведомлений
  status: { type: String, enum: ['queued', 'sending', 'sent', 'failed', 'skipped'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  nextTryAt: { type: Date, default: Date.now },
  lockedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  messageId: { type: Number, default: null },
  error: { type: String, default: null }
}, { timestamps: true });

outboxSchema.index({ status: 1, nextTryAt: 1 });
// Отправленные записи живут 90 дней
outboxSchema.index({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600, partialFilterExpression: { status: 'sent' } });

module.exports = mongoose.model('Outbox', outboxSchema);
