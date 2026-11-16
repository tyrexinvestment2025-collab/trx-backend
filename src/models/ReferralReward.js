// src/models/ReferralReward.js
const mongoose = require('mongoose');

const referralRewardSchema = new mongoose.Schema({
  uplineUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  partnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountSats: { type: Number, required: true },
  sourceCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserCard' }, // От какой карты пришло
  date: { type: String, required: true }, // Формат "YYYY-MM-DD" для легкой группировки
}, { timestamps: true });

// Идемпотентность: одна выплата за карту за день (защита от повторного запуска cron / нескольких инстансов)
referralRewardSchema.index({ sourceCardId: 1, date: 1 }, { unique: true, partialFilterExpression: { sourceCardId: { $exists: true } } });

module.exports = mongoose.model('ReferralReward', referralRewardSchema);