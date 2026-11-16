const mongoose = require('mongoose');

const userCardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cardTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CardType', required: true },
  serialNumber: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['Inactive', 'Active', 'Cooling', 'Finished'], 
    default: 'Inactive' 
  },
  nominalSats: { type: mongoose.Schema.Types.Decimal128, required: true },
  purchasePriceUsd: { type: mongoose.Schema.Types.Decimal128, required: true },
  currentProfitUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
  currentProfitSats: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
  // Прибыль, зафиксированная при остановке (выплачивается вместе с телом после охлаждения)
  coolingPayoutUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
  
  isTrial: { type: Boolean, default: false }, // Если true — это подарочная монета

  imageUrl: { type: String },
  unlockAt: { type: Date },
  lastAccrualDate: { type: Date, default: Date.now },
  // «Напомнить»: бот пишет за сутки до конца цикла (unlockAt)
  remindBeforeEnd: { type: Boolean, default: true }, // напоминание за сутки до конца паузы/срока (выключается в аналитике)
  remindSentAt: { type: Date }
}, { timestamps: true });

userCardSchema.index({ cardTypeId: 1, serialNumber: 1 }, { unique: true });

module.exports = mongoose.model('UserCard', userCardSchema);