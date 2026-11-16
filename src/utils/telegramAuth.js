const crypto = require('crypto');

// Сколько секунд initData считается свежим (по умолчанию сутки)
const MAX_AGE_SEC = Number(process.env.TG_AUTH_MAX_AGE_SEC) || 24 * 60 * 60;

/**
 * Проверка подписи Telegram WebApp initData
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * @returns {boolean}
 */
const verifyTelegramWebAppData = (telegramInitData) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not defined');
  if (typeof telegramInitData !== 'string' || !telegramInitData) return false;

  const urlParams = new URLSearchParams(telegramInitData);
  const hash = urlParams.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return false;

  // Свежесть: без auth_date или со старым auth_date — отказ (защита от повторного использования)
  const authDate = Number(urlParams.get('auth_date'));
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > MAX_AGE_SEC || authDate - nowSec > 60) return false;

  urlParams.delete('hash');

  const dataCheckString = Array.from(urlParams.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest();

  // Сравнение в постоянное время
  return crypto.timingSafeEqual(calculatedHash, Buffer.from(hash, 'hex'));
};

module.exports = { verifyTelegramWebAppData };
