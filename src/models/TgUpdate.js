const mongoose = require('mongoose');

/** Принятые update_id вебхука — повтор того же апдейта не обрабатывается. Хранятся 3 дня. */
const tgUpdateSchema = new mongoose.Schema({
  updateId: { type: Number, required: true, unique: true },
  receivedAt: { type: Date, default: Date.now, expires: 3 * 24 * 3600 }
});

module.exports = mongoose.model('TgUpdate', tgUpdateSchema);
