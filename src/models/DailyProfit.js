const { Model } = require('../db/model');

/** Начисления за день (YYYY-MM-DD) — одна строка на пользователя в день */
module.exports = new Model('DailyEarning', 'daily_earnings', {
  userId: { type: 'ref', ref: 'User' },
  date: { type: 'text' },
  miningSats: { type: 'double', default: 0 },
  referralSats: { type: 'double', default: 0 },
  // Те же суммы в USD по курсу в момент начисления (для аналитики; старые записи — только сатоши)
  miningUsd: { type: 'double', default: 0 },
  referralUsd: { type: 'double', default: 0 },
}, { timestamps: true });
