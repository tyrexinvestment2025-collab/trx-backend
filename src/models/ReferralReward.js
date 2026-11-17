const { Model } = require('../db/model');

/** Реферальная выплата. UNIQUE (source_card_id, date): одна выплата за карту за день. */
module.exports = new Model('ReferralReward', 'referral_rewards', {
  uplineUserId: { type: 'ref', ref: 'User' },
  partnerUserId: { type: 'ref', ref: 'User' },
  amountSats: { type: 'double' },
  sourceCardId: { type: 'ref', ref: 'UserCard' }, // От какой карты пришло
  date: { type: 'text' }, // "YYYY-MM-DD" для группировки
}, { timestamps: true });
