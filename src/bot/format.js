/** Форматирование для сообщений бота: суммы по языку, экранирование HTML, маска адреса */
const LOCALES = { ru: 'ru-RU', uk: 'uk-UA', en: 'en-US' };

/** «927,60 $» для ru/uk, «$927.60» для en — как в приложении */
const money = (n, lang = 'en') =>
  new Intl.NumberFormat(LOCALES[lang] || 'en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(Number(n)) ? Number(n) : 0);

const pct = (n, lang = 'en') =>
  `${new Intl.NumberFormat(LOCALES[lang] || 'en-US', { maximumFractionDigits: 1 }).format(Number(n) || 0)}%`;

const int = (n, lang = 'en') => new Intl.NumberFormat(LOCALES[lang] || 'en-US').format(Math.round(Number(n) || 0));

/** Дата и время в часовом поясе пользователя: «завтра в 14:00» — просто «17 нояб., 14:00» */
const dateTime = (d, lang = 'en', timeZone = 'Europe/Kyiv') => {
  try {
    return new Intl.DateTimeFormat(LOCALES[lang] || 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(d));
  } catch {
    return new Intl.DateTimeFormat(LOCALES[lang] || 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' }).format(new Date(d));
  }
};

/** Экранирование пользовательского текста под parse_mode HTML */
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Адрес для пользователя: первый символ + последние 4 (T…3f9a) */
const maskShort = (addr) => { const a = String(addr || ''); return a.length > 6 ? `${a[0]}…${a.slice(-4)}` : a; };
/** Адрес для хранения в outbox: первые 6 + последние 4 */
const maskStore = (addr) => { const a = String(addr || ''); return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a; };

module.exports = { money, pct, int, dateTime, escapeHtml, maskShort, maskStore, LOCALES };
