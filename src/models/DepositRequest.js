const { Model } = require('../db/model');

module.exports = new Model('DepositRequest', 'deposit_requests', {
  userId: { type: 'ref', ref: 'User' },
  amountUsd: { type: 'decimal' },
  status: { type: 'text', default: 'PENDING' }, // PENDING | CONFIRMED | REJECTED
  txHash: { type: 'text', default: '' },
  adminComment: { type: 'text' },
}, { timestamps: true });
