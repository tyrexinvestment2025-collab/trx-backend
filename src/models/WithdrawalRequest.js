const { Model } = require('../db/model');

module.exports = new Model('WithdrawalRequest', 'withdrawal_requests', {
  userId: { type: 'ref', ref: 'User' },
  amountUsd: { type: 'decimal' },
  status: { type: 'text', default: 'PENDING' }, // PENDING | PROCESSED | REJECTED
  walletAddress: { type: 'text' },
  processedDate: { type: 'date' },
  adminComment: { type: 'text' },
  payoutTxHash: { type: 'text' }, // хэш выплаты (админ указывает при «Выплачено»)
}, { timestamps: true });
