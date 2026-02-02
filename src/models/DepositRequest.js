const mongoose = require('mongoose');

const depositRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountUsd: { type: mongoose.Schema.Types.Decimal128, required: true }, 
  status: { type: String, enum: ['PENDING', 'CONFIRMED', 'REJECTED'], default: 'PENDING' },
  txHash: { type: String, default: '' },
  adminComment: { type: String }
}, {
  timestamps: true
});

module.exports = mongoose.model('DepositRequest', depositRequestSchema);