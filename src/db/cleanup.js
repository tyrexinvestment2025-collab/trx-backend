const db = require('./index');

/**
 * Замена TTL-индексов Mongo: старые служебные записи удаляются раз в сутки.
 *  - outbox: отправленные сообщения старше 90 дней;
 *  - tg_updates: принятые update_id старше 3 дней.
 */
async function cleanup() {
  const a = await db.query(`DELETE FROM outbox WHERE status = 'sent' AND sent_at < now() - interval '90 days'`);
  const b = await db.query(`DELETE FROM tg_updates WHERE received_at < now() - interval '3 days'`);
  return { outbox: a.rowCount, tgUpdates: b.rowCount };
}

module.exports = { cleanup };
