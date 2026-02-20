const mongoose = require('mongoose');

const ExchangeOrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserCard' },
    type: { type: String, enum: ['BUY', 'SELL'], required: true },
    btcAmount: { type: Number, required: true },
    appUsdAmount: { type: Number, required: true }, // Сколько списали с юзера
    binanceUsdtAmount: { type: Number },           // Сколько реально ушло на Binance
    executedPrice: { type: Number },               // Цена исполнения на бирже
    binanceOrderId: { type: String },
    status: { type: String, enum: ['SUCCESS', 'FAILED'], default: 'SUCCESS' },
    errorLog: { type: String },
    profitDelta: { type: Number }                   // Разница (доход/убыток на курсе)
}, { timestamps: true });

module.exports = mongoose.model('ExchangeOrder', ExchangeOrderSchema);