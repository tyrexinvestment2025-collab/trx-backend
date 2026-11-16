const mongoose = require('mongoose');
const { generateReferralCode } = require('../utils/referralCodeGenerator'); 

const userSchema = new mongoose.Schema({
  tgId: { type: Number, required: true, unique: true, index: true },
  username: { type: String, default: '' },
  languageCode: { type: String, default: 'en' }, // из Telegram initData, для сообщений бота
  role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
  
  referralCode: { type: String, unique: true, sparse: true },
  uplineUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // --- НОВЫЕ ПОЛЯ ДЛЯ ТРИАЛА И CRM ---
  isTrialActivated: { type: Boolean, default: false }, // Нажал ли "Получить NFT"
  trialActivatedAt: { type: Date }, // Дата активации подарка
  totalDepositedUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' }, // Общая сумма всех пополнений
  // ----------------------------------

  accountStatus: { 
    type: String, 
    enum: ['NEWBIE', 'DEPOSITOR', 'HOLDER', 'MINER'], 
    default: 'NEWBIE' 
  },
  analytics: {
        financialGoal: { type: Number, default: 50000 },
  },
  balance: {
    walletUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
    stakingUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' }, 
    pendingWithdrawalUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
    totalProfitUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },
    referralUsd: { type: mongoose.Schema.Types.Decimal128, default: '0.0' },

    walletSats: { type: Number, default: 0 }, 
    lastDailyQuizAt: { type: Date, default: null },
    referralSats: { type: Number, default: 0 } 
  },
  isBanned: { type: Boolean, default: false },

  // --- Бот и уведомления ---
  firstName: { type: String, default: '' },            // имя из Telegram — для «По вашей ссылке пришёл …»
  lang: { type: String, enum: ['ru', 'uk', 'en', null], default: null }, // выбранный язык (бот и приложение); null — ещё не выбран
  canMessage: { type: Boolean, default: false },        // нажал Start или разрешил писать из Mini App
  botBlockedAt: { type: Date, default: null },
  timezone: { type: String, default: 'Europe/Kyiv' },
  notifPrefs: {
    cards: { type: Boolean, default: true },
    partners: { type: Boolean, default: true },
    news: { type: Boolean, default: true },
    digest: { type: Boolean, default: false },
    btc: { type: Boolean, default: false }
  },
  pendingRef: { type: String, default: null },          // реф-код из /start до первого входа в приложение
  source: { type: String, default: null },              // ref / ch_<пост> / p_<раздел> / direct
  channelGiftAt: { type: Date, default: null }
}, {
  timestamps: true
});

userSchema.pre('save', async function() {
  if (this.isNew && !this.referralCode) {
    let code;
    let isUnique = false;
    const User = mongoose.model('User'); 
    while (!isUnique) {
      code = generateReferralCode();
      const existingUser = await User.findOne({ referralCode: code });
      if (!existingUser) isUnique = true;
    }
    this.referralCode = code;
  }
});

module.exports = mongoose.model('User', userSchema);