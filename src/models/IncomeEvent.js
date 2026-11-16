const mongoose = require('mongoose');

/**
 * Зачисления на кошелёк, которые не являются депозитом:
 * - CARD_PAYOUT   — выплата тела карты + прибыли после охлаждения
 * - CARD_REFUND   — продажа карты обратно (возврат цены покупки)
 * - REFERRAL_CLAIM — реферальная награда, переведённая в USD
 * Используется для фильтра «Доход» в истории кошелька.
 */
const incomeEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['CARD_PAYOUT', 'CARD_REFUND', 'REFERRAL_CLAIM'], required: true },
  amountUsd: { type: mongoose.Schema.Types.Decimal128, required: true },
  // Детали: { cardId, serialNumber, cardName, principalUsd, profitUsd, sats, btcPrice }
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('IncomeEvent', incomeEventSchema);
