/**
 * Настройки бота из окружения.
 *  BOT_TOKEN (или TELEGRAM_BOT_TOKEN) — токен
 *  WEBHOOK_SECRET — секрет заголовка X-Telegram-Bot-Api-Secret-Token
 *  WEBAPP_URL — постоянный адрес Mini App (для кнопок web_app); без него кнопки ведут по t.me-ссылке
 *  TELEGRAM_BOT_USERNAME / TELEGRAM_BOT_NAME — имя бота без @, TELEGRAM_APP_NAME — короткое имя Mini App
 *  ADMIN_CHAT_ID — админ-группа с темами; ADMIN_TOPIC_DEPOSITS / _WITHDRAWALS / _USERS / _ALERTS / _ERRORS — ID тем
 *  ALERT_AMOUNT_USD — порог «крупной» заявки (по умолчанию 1000)
 *  TELEGRAM_CHANNEL_ID / CHANNEL_URL — канал @TYREXcompany
 *  SUPPORT_URL, TERMS_URL, PRIVACY_URL — ссылки
 *  BOT_ENABLED=false — выключить бота целиком; DISABLE_BOT_MESSAGES=true — не отправлять сообщения (тесты/локально)
 */
const num = (v) => (v === undefined || v === '' ? null : Number(v));

const cfg = () => ({
  token: process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  webAppUrl: (process.env.WEBAPP_URL || '').replace(/\/+$/, ''),
  botUsername: (process.env.TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_BOT_NAME || 'tyrexcurrency_bot').replace(/^@/, ''),
  appName: process.env.TELEGRAM_APP_NAME || 'app',
  adminChatId: process.env.ADMIN_CHAT_ID || '',
  topics: {
    deposits: num(process.env.ADMIN_TOPIC_DEPOSITS),
    withdrawals: num(process.env.ADMIN_TOPIC_WITHDRAWALS),
    users: num(process.env.ADMIN_TOPIC_USERS),
    alerts: num(process.env.ADMIN_TOPIC_ALERTS),
    errors: num(process.env.ADMIN_TOPIC_ERRORS),
  },
  alertAmountUsd: Number(process.env.ALERT_AMOUNT_USD) || 1000,
  channelId: process.env.TELEGRAM_CHANNEL_ID || '-1001968067961',
  channelUrl: process.env.CHANNEL_URL || 'https://t.me/TYREXcompany',
  supportUrl: process.env.SUPPORT_URL || 'https://t.me/tyrex_support',
  termsUrl: process.env.TERMS_URL || '',
  privacyUrl: process.env.PRIVACY_URL || '',
  enabled: process.env.BOT_ENABLED !== 'false',
  sendingDisabled: process.env.DISABLE_BOT_MESSAGES === 'true',
});

/** Разделы Mini App, которые можно открыть из бота (белый список) */
const SECTIONS = { analytics: '/analytics', wallet: '/wallet', referral: '/partners', cards: '/cards', profile: '/profile', shop: '/shop', admin: '/admin' };

/** Ссылка t.me на Mini App с параметром startapp (работает и в группах) */
const appLink = (payload) => {
  const c = cfg();
  const base = `https://t.me/${c.botUsername}/${c.appName}`;
  return payload ? `${base}?startapp=${encodeURIComponent(payload)}` : base;
};

/**
 * Кнопка «открыть раздел» для личного чата: web_app по постоянному адресу,
 * а без WEBAPP_URL — обычная ссылка t.me с startapp=p_<раздел>.
 */
const openButton = (text, section) => {
  const c = cfg();
  const route = section ? SECTIONS[section] || '/' : '/';
  if (c.webAppUrl) return { text, web_app: { url: `${c.webAppUrl}${route === '/' ? '' : route}` } };
  return { text, url: appLink(section ? `p_${section}` : undefined) };
};

/** Реф-ссылка — всегда сразу в Mini App */
const refLink = (code) => appLink(`ref_${code}`);

module.exports = { cfg, SECTIONS, appLink, openButton, refLink };
