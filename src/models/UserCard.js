const { Model } = require('../db/model');

module.exports = new Model('UserCard', 'user_cards', {
  userId: { type: 'ref', ref: 'User' },
  cardTypeId: { type: 'ref', ref: 'CardType' },
  serialNumber: { type: 'int' },
  status: { type: 'text', default: 'Inactive' }, // Inactive | Active | Cooling | Finished
  nominalSats: { type: 'decimal' },
  purchasePriceUsd: { type: 'decimal' },
  currentProfitUsd: { type: 'decimal', default: '0.0' },
  currentProfitSats: { type: 'decimal', default: '0.0' },
  // Прибыль, зафиксированная при остановке (выплачивается вместе с телом после охлаждения)
  coolingPayoutUsd: { type: 'decimal', default: '0.0' },
  isTrial: { type: 'bool', default: false }, // подарочная карта
  imageUrl: { type: 'text' },
  unlockAt: { type: 'date' },
  lastAccrualDate: { type: 'date', default: () => new Date() },
  // «Напомнить»: бот пишет за сутки до конца цикла (unlockAt); выключается в аналитике
  remindBeforeEnd: { type: 'bool', default: true },
  remindSentAt: { type: 'date' },
}, { timestamps: true });
