const { Model } = require('../db/model');

module.exports = new Model('ExchangeOrder', 'exchange_orders', {
  userId: { type: 'ref', ref: 'User' },
  cardId: { type: 'ref', ref: 'UserCard' },
  type: { type: 'text' },                    // BUY | SELL
  btcAmount: { type: 'double' },
  appUsdAmount: { type: 'double' },          // Сколько списали с юзера
  binanceUsdtAmount: { type: 'double' },     // Сколько реально ушло на Binance
  executedPrice: { type: 'double' },         // Цена исполнения на бирже
  binanceOrderId: { type: 'text' },
  status: { type: 'text', default: 'SUCCESS' }, // SUCCESS | FAILED
  errorLog: { type: 'text' },
  profitDelta: { type: 'double' },           // Разница (доход/убыток на курсе)
}, { timestamps: true });
