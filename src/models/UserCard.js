const mongoose = require('mongoose');

const userCardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cardTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CardType', required: true },
  
  status: { 
    type: String, 
    enum: ['Inactive', 'Active', 'Cooling', 'Finished'], 
    default: 'Inactive' 
  },
  
  nominalSats: { type: mongoose.Schema.Types.Decimal128, required: true },
  
  purchasePriceUsd: { type: mongoose.Schema.Types.Decimal128, required: true },

  currentProfitUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
  currentProfitSats: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },

  coolingStartedAt: { type: Date },
  unlockAt: { type: Date },
  lastAccrualDate: { type: Date, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('UserCard', userCardSchema);