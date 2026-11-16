const mongoose = require('mongoose');

/** Журнал действий администраторов (бот и админка). Не удаляется никогда — для разбора споров. */
const adminActionSchema = new mongoose.Schema({
  adminTgId: { type: Number, default: null },
  adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, required: true },   // dep.ok, dep.reject, wd.paid, wd.reject, ban, unban
  targetId: { type: String, required: true },
  reason: { type: String, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  source: { type: String, enum: ['bot', 'admin_panel'], required: true },
  at: { type: Date, default: Date.now }
});

adminActionSchema.index({ targetId: 1 });
adminActionSchema.index({ at: -1 });

module.exports = mongoose.model('AdminAction', adminActionSchema);
