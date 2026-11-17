const { Model } = require('../db/model');

/** История номера карты: MINING_SESSION (остановил майнинг), PURCHASE, SOLD_BACK */
module.exports = new Model('CardHistory', 'card_history', {
  cardTypeId: { type: 'ref', ref: 'CardType' },
  serialNumber: { type: 'int' },
  userId: { type: 'ref', ref: 'User' },
  eventType: { type: 'text' },
  profitUsd: { type: 'decimal', default: '0.0' },
  priceUsd: { type: 'decimal', default: '0.0' },
  startedAt: { type: 'date' },
  endedAt: { type: 'date', default: () => new Date() },
  durationDays: { type: 'double', default: 0 },
}, { timestamps: true });
