const mongoose = require('mongoose');
const { generateReferralCode } = require('../utils/referralCodeGenerator'); 

const userSchema = new mongoose.Schema({
  tgId: { type: Number, required: true, unique: true, index: true },
  username: { type: String, default: '' },
  role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
  
  referralCode: { type: String, unique: true, sparse: true },
  uplineUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  accountStatus: { 
    type: String, 
    enum: ['NEWBIE', 'DEPOSITOR', 'HOLDER', 'MINER'], 
    default: 'NEWBIE' 
  },

  balance: {
    walletUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
    stakingUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' }, 
    pendingWithdrawalUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
    totalProfitUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
    referralUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' }
  },
  isBanned: { type: Boolean, default: false }
}, {
  timestamps: true
});

userSchema.pre('save', async function() {
  if (this.isNew && !this.referralCode) {
    let code;
    let isUnique = false;
    while (!isUnique) {
      code = generateReferralCode();
      const existingUser = await this.constructor.findOne({ referralCode: code });
      if (!existingUser) isUnique = true;
    }
    this.referralCode = code;
  }
});

module.exports = mongoose.model('User', userSchema);