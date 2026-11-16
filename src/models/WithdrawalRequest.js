const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountUsd: { type: mongoose.Schema.Types.Decimal128, required: true }, 
  status: { type: String, enum: ['PENDING', 'PROCESSED', 'REJECTED'], default: 'PENDING' },
  walletAddress: { type: String, required: true },
  processedDate: { type: Date },
  adminComment: { type: String },
  payoutTxHash: { type: String } // хэш выплаты (админ указывает при «Выплачено»)
}, {
  timestamps: true
});

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);