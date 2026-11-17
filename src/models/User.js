const { Model } = require('../db/model');
const { generateReferralCode } = require('../utils/referralCodeGenerator');

const User = new Model('User', 'users', {
  tgId: { type: 'bigint' },
  username: { type: 'text', default: '' },
  languageCode: { type: 'text', default: 'en' }, // из Telegram initData, для сообщений бота
  role: { type: 'text', default: 'USER' },       // USER | ADMIN

  referralCode: { type: 'text' },
  uplineUserId: { type: 'ref', ref: 'User', default: null },

  // Триал и CRM
  isTrialActivated: { type: 'bool', default: false },
  trialActivatedAt: { type: 'date' },
  totalDepositedUsd: { type: 'decimal', default: '0.0' },
  accountStatus: { type: 'text', default: 'NEWBIE' }, // NEWBIE | DEPOSITOR | HOLDER | MINER

  'analytics.financialGoal': { type: 'double', default: 50000 },

  'balance.walletUsd': { type: 'decimal', default: '0.0' },
  'balance.stakingUsd': { type: 'decimal', default: '0.0' },
  'balance.pendingWithdrawalUsd': { type: 'decimal', default: '0.0' },
  'balance.totalProfitUsd': { type: 'decimal', default: '0.0' },
  'balance.referralUsd': { type: 'decimal', default: '0.0' },
  'balance.walletSats': { type: 'double', default: 0 },
  'balance.lastDailyQuizAt': { type: 'date', default: null },
  'balance.referralSats': { type: 'double', default: 0 },

  isBanned: { type: 'bool', default: false },

  // Бот и уведомления
  firstName: { type: 'text', default: '' },       // имя из Telegram — для «По вашей ссылке пришёл …»
  lang: { type: 'text', default: null },          // ru | uk | en; null — ещё не выбран
  canMessage: { type: 'bool', default: false },   // нажал Start или разрешил писать из Mini App
  botBlockedAt: { type: 'date', default: null },
  timezone: { type: 'text', default: 'Europe/Kyiv' },
  'notifPrefs.cards': { type: 'bool', default: true },
  'notifPrefs.partners': { type: 'bool', default: true },
  'notifPrefs.news': { type: 'bool', default: true },
  'notifPrefs.digest': { type: 'bool', default: false },
  'notifPrefs.btc': { type: 'bool', default: false },
  pendingRef: { type: 'text', default: null },    // реф-код из /start до первого входа в приложение
  source: { type: 'text', default: null },        // ref / ch_<пост> / p_<раздел> / direct
  channelGiftAt: { type: 'date', default: null },
}, {
  timestamps: true,
  hooks: {
    // Реф-код при создании, если не задан
    async preCreate(doc, model) {
      if (doc.referralCode) return;
      let code = generateReferralCode();
      while (await model.exists({ referralCode: code })) code = generateReferralCode();
      doc.referralCode = code;
    },
  },
});

module.exports = User;
