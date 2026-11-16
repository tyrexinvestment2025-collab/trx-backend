const axios = require('axios');

/**
 * Сообщения пользователю в чат с ботом.
 * Язык — из user.languageCode (сохраняется при логине из initData), по умолчанию en.
 * Ошибки (пользователь заблокировал бота и т.п.) не ломают вызывающий код.
 */
const TEXTS = {
  card_payout: {
    en: (p) => `✅ The cycle of card ${p.cardName} #${p.serial} has ended.\n$${p.amount} has been credited to your wallet (principal $${p.principal} + income $${p.profit}).`,
    uk: (p) => `✅ Цикл карти ${p.cardName} #${p.serial} завершено.\nНа гаманець зараховано $${p.amount} (тіло $${p.principal} + дохід $${p.profit}).`,
    ru: (p) => `✅ Цикл карты ${p.cardName} #${p.serial} завершён.\nНа кошелёк зачислено $${p.amount} (тело $${p.principal} + доход $${p.profit}).`,
  },
  trial_finished: {
    en: (p) => `🎁 Your gift card ${p.cardName} #${p.serial} has finished its term. Choose your first card in the shop to keep earning.`,
    uk: (p) => `🎁 Термін подарункової карти ${p.cardName} #${p.serial} завершився. Оберіть першу карту в магазині, щоб продовжити.`,
    ru: (p) => `🎁 Срок подарочной карты ${p.cardName} #${p.serial} закончился. Выберите первую карту в магазине, чтобы продолжить.`,
  },
};

const OPEN_APP = { en: 'Open Tyrex', uk: 'Відкрити Tyrex', ru: 'Открыть Tyrex' };

const pickLang = (code) => {
  const c = String(code || '').toLowerCase().slice(0, 2);
  if (c === 'uk') return 'uk';
  if (c === 'ru' || c === 'be' || c === 'kk') return 'ru';
  return 'en';
};

const appLink = () => {
  const bot = process.env.TELEGRAM_BOT_NAME || process.env.TELEGRAM_BOT_USERNAME;
  const app = process.env.TELEGRAM_APP_NAME;
  return bot && app ? `https://t.me/${bot}/${app}` : null;
};

async function notifyUser(user, key, params = {}) {
  if (process.env.DISABLE_BOT_MESSAGES === 'true') return false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const tpl = TEXTS[key];
  if (!token || !tpl || !user?.tgId) return false;

  const lang = pickLang(user.languageCode);
  const link = appLink();
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: user.tgId,
      text: tpl[lang](params),
      ...(link ? { reply_markup: { inline_keyboard: [[{ text: OPEN_APP[lang], url: link }]] } } : {})
    }, { timeout: 5000 });
    return true;
  } catch (e) {
    console.warn(`[botNotifier] ${key} → ${user.tgId} failed: ${e.response?.data?.description || e.message}`);
    return false;
  }
}

module.exports = { notifyUser, pickLang };
