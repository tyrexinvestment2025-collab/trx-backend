// src/models/ReferralReward.js
const mongoose = require('mongoose');

const referralRewardSchema = new mongoose.Schema({
  uplineUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  partnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountSats: { type: Number, required: true },
  sourceCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserCard' }, // От какой карты пришло
  date: { type: String, required: true }, // Формат "YYYY-MM-DD" для легкой группировки
}, { timestamps: true });

module.exports = mongoose.model('ReferralReward', referralRewardSchema);