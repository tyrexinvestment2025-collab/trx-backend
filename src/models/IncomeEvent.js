const { Model } = require('../db/model');

/**
 * Зачисления на кошелёк, которые не являются депозитом:
 * - CARD_PAYOUT   — выплата тела карты + прибыли после охлаждения
 * - CARD_REFUND   — продажа карты обратно (возврат цены покупки)
 * - REFERRAL_CLAIM — реферальная награда, переведённая в USD
 * meta: { cardId, serialNumber, cardName, principalUsd, profitUsd, sats, btcPrice }
 */
module.exports = new Model('IncomeEvent', 'income_events', {
  userId: { type: 'ref', ref: 'User' },
  type: { type: 'text' },
  amountUsd: { type: 'decimal' },
  meta: { type: 'json', default: () => ({}) },
}, { timestamps: true });
