const { Model } = require('../db/model');

/** Принятые update_id вебхука — повтор того же апдейта не обрабатывается. Хранятся 3 дня (db/cleanup). */
module.exports = new Model('TgUpdate', 'tg_updates', {
  updateId: { type: 'bigint' },
  receivedAt: { type: 'date', default: () => new Date() },
});
