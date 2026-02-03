const mongoose = require('mongoose');

const cardHistorySchema = new mongoose.Schema({
  // Ссылка на тип коллекции
  cardTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CardType', required: true },
  
  // Номер NFT, к которому относится запись
  serialNumber: { type: Number, required: true },
  
  // Владелец
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // Тип события: 
  // MINING_SESSION - завершил майнинг (остановил)
  // PURCHASE - купил в магазине
  // SOLD_BACK - продал обратно системе
  eventType: { 
    type: String, 
    enum: ['MINING_SESSION', 'PURCHASE', 'SOLD_BACK'], 
    required: true 
  },

  profitUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' }, // Профит (для майнинга)
  priceUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },  // Цена операции
  
  startedAt: { type: Date }, 
  endedAt: { type: Date, default: Date.now },
  durationDays: { type: Number, default: 0 }
}, {
  timestamps: true
});

// Индекс для быстрого поиска истории конкретного номера
cardHistorySchema.index({ cardTypeId: 1, serialNumber: 1 });

module.exports = mongoose.model('CardHistory', cardHistorySchema);