const { Model } = require('../db/model');

/** Журнал действий администраторов (бот и админка). Не удаляется никогда — для разбора споров. */
module.exports = new Model('AdminAction', 'admin_actions', {
  adminTgId: { type: 'bigint', default: null },
  adminUserId: { type: 'ref', ref: 'User', default: null },
  action: { type: 'text' },   // dep.ok, dep.reject, wd.paid, wd.reject, ban, unban
  targetId: { type: 'text' },
  reason: { type: 'text', default: null },
  meta: { type: 'json', default: () => ({}) },
  source: { type: 'text' },   // bot | admin_panel
  at: { type: 'date', default: () => new Date() },
});
