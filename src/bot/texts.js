/**
 * Тексты бота (parse_mode HTML). Параметры приходят уже отформатированными и экранированными
 * (суммы — в формате языка, имена и причины — через escapeHtml).
 * Админ-чат — только на русском (src/bot/adminTexts.js).
 */
const FRAUD = {
  ru: 'Поддержка Tyrex не пишет первой и никогда не просит пароли, коды или перевод денег.',
  uk: 'Підтримка Tyrex не пише першою й ніколи не просить паролі, коди чи переказ грошей.',
  en: 'Tyrex support never writes first and never asks for passwords, codes or money transfers.',
};

const T = {
  // ---------- Кнопки ----------
  btn: {
    open: { ru: 'Открыть Tyrex', uk: 'Відкрити Tyrex', en: 'Open Tyrex' },
    channel: { ru: 'Канал Tyrex', uk: 'Канал Tyrex', en: 'Tyrex channel' },
    support: { ru: 'Поддержка', uk: 'Підтримка', en: 'Support' },
    deposit: { ru: 'Пополнить', uk: 'Поповнити', en: 'Deposit' },
    withdraw: { ru: 'Вывести', uk: 'Вивести', en: 'Withdraw' },
    wallet: { ru: 'Открыть кошелёк', uk: 'Відкрити гаманець', en: 'Open wallet' },
    operations: { ru: 'Мои операции', uk: 'Мої операції', en: 'My operations' },
    analytics: { ru: 'Аналитика', uk: 'Аналітика', en: 'Analytics' },
    cards: { ru: 'Мои карты', uk: 'Мої картки', en: 'My cards' },
    startCard: { ru: 'Запустить', uk: 'Запустити', en: 'Start' },
    partners: { ru: 'Партнёры', uk: 'Партнери', en: 'Partners' },
    share: { ru: 'Поделиться', uk: 'Поділитися', en: 'Share' },
    claim: { ru: 'Забрать {amount}', uk: 'Забрати {amount}', en: 'Claim {amount}' },
    qr: { ru: 'QR-код', uk: 'QR-код', en: 'QR code' },
    terms: { ru: 'Условия и риски', uk: 'Умови та ризики', en: 'Terms and risks' },
    privacy: { ru: 'Конфиденциальность', uk: 'Конфіденційність', en: 'Privacy' },
  },

  // ---------- Команды ----------
  welcome: {
    ru: (p) => `Привет${p.name ? `, ${p.name}` : ''}! Это <b>Tyrex</b> — карты майнинга BTC в Telegram.\n\nКупите карту, запустите её — и доход начисляется каждую минуту по ставке серии. Всё управление — в приложении.\n\n<i>${FRAUD.ru}</i>`,
    uk: (p) => `Привіт${p.name ? `, ${p.name}` : ''}! Це <b>Tyrex</b> — картки майнінгу BTC у Telegram.\n\nКупіть картку, запустіть її — і дохід нараховується щохвилини за ставкою серії. Усе керування — у застосунку.\n\n<i>${FRAUD.uk}</i>`,
    en: (p) => `Hi${p.name ? `, ${p.name}` : ''}! This is <b>Tyrex</b> — BTC mining cards in Telegram.\n\nBuy a card, start it, and income accrues every minute at the series rate. Everything is managed in the app.\n\n<i>${FRAUD.en}</i>`,
  },
  app: {
    ru: () => 'Откройте приложение Tyrex:', uk: () => 'Відкрийте застосунок Tyrex:', en: () => 'Open the Tyrex app:',
  },
  wallet: {
    ru: (p) => `<b>Кошелёк</b>\nДоступно: <b>${p.available}</b>\nВ обработке: ${p.pending}`,
    uk: (p) => `<b>Гаманець</b>\nДоступно: <b>${p.available}</b>\nВ обробці: ${p.pending}`,
    en: (p) => `<b>Wallet</b>\nAvailable: <b>${p.available}</b>\nPending: ${p.pending}`,
  },
  analytics: {
    ru: () => 'Доход, сравнение с другими активами, прогноз и рынок — в «Аналитике».',
    uk: () => 'Дохід, порівняння з іншими активами, прогноз і ринок — в «Аналітиці».',
    en: () => 'Income, comparison with other assets, forecast and market — in Analytics.',
  },
  invite: {
    ru: (p) => `<b>Ваша ссылка</b>\n${p.link}\n\nПриглашено: ${p.invited} · Купили карту: ${p.bought} · Доступно: <b>${p.available}</b>\nБонус — ${p.rates} годовых от номинала карт ваших партнёров, в зависимости от серии.`,
    uk: (p) => `<b>Ваше посилання</b>\n${p.link}\n\nЗапрошено: ${p.invited} · Купили картку: ${p.bought} · Доступно: <b>${p.available}</b>\nБонус — ${p.rates} річних від номіналу карток ваших партнерів, залежно від серії.`,
    en: (p) => `<b>Your link</b>\n${p.link}\n\nInvited: ${p.invited} · Bought a card: ${p.bought} · Available: <b>${p.available}</b>\nBonus — ${p.rates} a year of your partners’ card nominal, depending on the series.`,
  },
  shareText: {
    ru: 'Присоединяйся к Tyrex — карты майнинга BTC прямо в Telegram',
    uk: 'Приєднуйся до Tyrex — картки майнінгу BTC просто в Telegram',
    en: 'Join Tyrex — BTC mining cards right inside Telegram',
  },
  qrCaption: {
    ru: (p) => `QR-код вашей ссылки — для встреч вживую.\n${p.link}`,
    uk: (p) => `QR-код вашого посилання — для зустрічей наживо.\n${p.link}`,
    en: (p) => `QR code of your link — for meeting in person.\n${p.link}`,
  },
  help: {
    ru: () => '<b>Как это работает</b>\n1. Пополните кошелёк и купите карту в Магазине.\n2. Запустите карту — доход начисляется каждую минуту по ставке серии. Ставка может меняться.\n3. Остановите карту, когда захотите: после паузы цена покупки и доход придут на кошелёк, их можно вывести.\n\nЛюбые вложения связаны с риском. Подробнее — в условиях.',
    uk: () => '<b>Як це працює</b>\n1. Поповніть гаманець і купіть картку в Магазині.\n2. Запустіть картку — дохід нараховується щохвилини за ставкою серії. Ставка може змінюватися.\n3. Зупиніть картку, коли захочете: після паузи ціна купівлі й дохід надійдуть на гаманець, їх можна вивести.\n\nБудь-які вкладення пов’язані з ризиком. Детальніше — в умовах.',
    en: () => '<b>How it works</b>\n1. Top up your wallet and buy a card in the Shop.\n2. Start the card — income accrues every minute at the series rate. The rate may change.\n3. Stop the card whenever you like: after a pause, the purchase price and income go to your wallet and can be withdrawn.\n\nAny investment involves risk. See the terms for details.',
  },
  support: {
    ru: (p) => `Напишите в поддержку — укажите ваш ID: <code>${p.tgId}</code>\n\n<i>${FRAUD.ru}</i>`,
    uk: (p) => `Напишіть у підтримку — вкажіть ваш ID: <code>${p.tgId}</code>\n\n<i>${FRAUD.uk}</i>`,
    en: (p) => `Contact support and include your ID: <code>${p.tgId}</code>\n\n<i>${FRAUD.en}</i>`,
  },
  langChoose: { ru: () => 'Выберите язык:', uk: () => 'Оберіть мову:', en: () => 'Choose a language:' },
  langSet: { ru: () => 'Готово, теперь по-русски.', uk: () => 'Готово, тепер українською.', en: () => 'Done, English it is.' },
  privacy: {
    ru: () => 'Политика конфиденциальности и условия использования:',
    uk: () => 'Політика конфіденційності та умови використання:',
    en: () => 'Privacy policy and terms of use:',
  },
  unknown: {
    ru: () => 'Я понимаю команды из меню. Всё остальное — в приложении.',
    uk: () => 'Я розумію команди з меню. Усе інше — у застосунку.',
    en: () => 'I understand the commands from the menu. Everything else is in the app.',
  },
  banned: {
    ru: () => 'Доступ к аккаунту ограничен. Напишите в поддержку.',
    uk: () => 'Доступ до акаунта обмежено. Напишіть у підтримку.',
    en: () => 'Access to your account is restricted. Please contact support.',
  },
  noAccount: {
    ru: () => 'Сначала откройте приложение — там создастся ваш кошелёк.',
    uk: () => 'Спочатку відкрийте застосунок — там створиться ваш гаманець.',
    en: () => 'Open the app first — your wallet will be created there.',
  },

  // ---------- Уведомления ----------
  'deposit.created': {
    ru: (p) => `Заявка на пополнение <b>${p.amount}</b> принята. Проверим транзакцию и напишем.`,
    uk: (p) => `Заявку на поповнення <b>${p.amount}</b> прийнято. Перевіримо транзакцію й напишемо.`,
    en: (p) => `Your deposit request for <b>${p.amount}</b> is received. We’ll check the transaction and let you know.`,
  },
  'deposit.confirmed': {
    ru: (p) => `✅ Зачислено <b>${p.amount}</b>. Баланс: ${p.balance}`,
    uk: (p) => `✅ Зараховано <b>${p.amount}</b>. Баланс: ${p.balance}`,
    en: (p) => `✅ <b>${p.amount}</b> credited. Balance: ${p.balance}`,
  },
  'deposit.rejected': {
    ru: (p) => `Пополнение на ${p.amount} отклонено.\nПричина: ${p.reason}`,
    uk: (p) => `Поповнення на ${p.amount} відхилено.\nПричина: ${p.reason}`,
    en: (p) => `Deposit of ${p.amount} was rejected.\nReason: ${p.reason}`,
  },
  'withdrawal.created': {
    ru: (p) => `Заявка на вывод <b>${p.amount}</b> на ${p.address} принята. Обычно обрабатываем ${p.eta}.`,
    uk: (p) => `Заявку на виведення <b>${p.amount}</b> на ${p.address} прийнято. Зазвичай обробляємо ${p.eta}.`,
    en: (p) => `Withdrawal request for <b>${p.amount}</b> to ${p.address} is received. We usually process it ${p.eta}.`,
  },
  'withdrawal.paid': {
    ru: (p) => `✅ Выплачено <b>${p.amount}</b> на ${p.address}.${p.txUrl ? `\n<a href="${p.txUrl}">Транзакция</a>` : ''}`,
    uk: (p) => `✅ Виплачено <b>${p.amount}</b> на ${p.address}.${p.txUrl ? `\n<a href="${p.txUrl}">Транзакція</a>` : ''}`,
    en: (p) => `✅ <b>${p.amount}</b> paid to ${p.address}.${p.txUrl ? `\n<a href="${p.txUrl}">Transaction</a>` : ''}`,
  },
  'withdrawal.rejected': {
    ru: (p) => `Вывод ${p.amount} отклонён.\nПричина: ${p.reason}\nДеньги вернулись на баланс.`,
    uk: (p) => `Виведення ${p.amount} відхилено.\nПричина: ${p.reason}\nГроші повернулися на баланс.`,
    en: (p) => `Withdrawal of ${p.amount} was rejected.\nReason: ${p.reason}\nThe money is back on your balance.`,
  },
  'card.bought': {
    ru: (p) => `${p.card} — ваша. Запустите её, чтобы пошёл доход.`,
    uk: (p) => `${p.card} — ваша. Запустіть її, щоб пішов дохід.`,
    en: (p) => `${p.card} is yours. Start it to begin earning.`,
  },
  'card.cycle_ending': {
    ru: (p) => p.trial ? `Срок подарочной карты ${p.card} закончится ${p.when}.` : `Пауза карты ${p.card} закончится ${p.when} — на кошелёк придёт около ${p.amount}.`,
    uk: (p) => p.trial ? `Термін подарункової картки ${p.card} завершиться ${p.when}.` : `Пауза картки ${p.card} завершиться ${p.when} — на гаманець надійде близько ${p.amount}.`,
    en: (p) => p.trial ? `Your gift card ${p.card} ends ${p.when}.` : `The pause of card ${p.card} ends ${p.when} — about ${p.amount} will arrive in your wallet.`,
  },
  'card.cycle_ended': {
    ru: (p) => `Цикл карты ${p.card} завершён. На кошелёк зачислено <b>${p.amount}</b> (цена покупки ${p.principal} + доход ${p.profit}).`,
    uk: (p) => `Цикл картки ${p.card} завершено. На гаманець зараховано <b>${p.amount}</b> (ціна купівлі ${p.principal} + дохід ${p.profit}).`,
    en: (p) => `The cycle of card ${p.card} has ended. <b>${p.amount}</b> credited to your wallet (purchase price ${p.principal} + income ${p.profit}).`,
  },
  'trial.activated': {
    ru: (p) => `🎁 ${p.card} — ваша. Запустите её в приложении.`,
    uk: (p) => `🎁 ${p.card} — ваша. Запустіть її в застосунку.`,
    en: (p) => `🎁 ${p.card} is yours. Start it in the app.`,
  },
  'trial.finished': {
    ru: (p) => `Срок подарочной карты ${p.card} закончился. Выберите первую карту в магазине, чтобы продолжить.`,
    uk: (p) => `Термін подарункової картки ${p.card} завершився. Оберіть першу картку в магазині, щоб продовжити.`,
    en: (p) => `Your gift card ${p.card} has finished its term. Choose your first card in the shop to keep earning.`,
  },
  'referral.joined': {
    ru: (p) => `По вашей ссылке пришёл ${p.name}.`,
    uk: (p) => `За вашим посиланням прийшов ${p.name}.`,
    en: (p) => `${p.name} joined via your link.`,
  },
  'referral.bonus': {
    ru: (p) => `Ваш партнёр купил карту ${p.series}. Вам начисляется бонус ${p.rate} годовых от её номинала, пока карта работает.`,
    uk: (p) => `Ваш партнер купив картку ${p.series}. Вам нараховується бонус ${p.rate} річних від її номіналу, поки картка працює.`,
    en: (p) => `Your partner bought a ${p.series} card. You earn a ${p.rate} a year bonus on its nominal while it runs.`,
  },
  'account.banned': {
    ru: () => 'Доступ к аккаунту ограничен. Напишите в поддержку.',
    uk: () => 'Доступ до акаунта обмежено. Напишіть у підтримку.',
    en: () => 'Access to your account is restricted. Please contact support.',
  },
  // Склейка нескольких одинаковых событий в одно сообщение
  batchHeader: {
    ru: (p) => `Несколько событий (${p.count}):`, uk: (p) => `Кілька подій (${p.count}):`, en: (p) => `Several updates (${p.count}):`,
  },
  eta: { ru: 'в течение 24 часов', uk: 'протягом 24 годин', en: 'within 24 hours' },
};

const LANGS = ['ru', 'uk', 'en'];

/** Язык пользователя: выбранный (lang), иначе из Telegram; uk → uk, ru/be/kk → ru, остальное → en */
const langOf = (userOrCode) => {
  const explicit = userOrCode && typeof userOrCode === 'object' ? userOrCode.lang : null;
  if (LANGS.includes(explicit)) return explicit;
  const code = String((userOrCode && typeof userOrCode === 'object' ? userOrCode.languageCode : userOrCode) || '').toLowerCase().slice(0, 2);
  if (code === 'uk') return 'uk';
  if (code === 'ru' || code === 'be' || code === 'kk') return 'ru';
  return 'en';
};

/** Текст по ключу: функция или строка; {x} в строках кнопок заменяется параметрами */
const t = (key, lang, params = {}) => {
  const node = key.includes('.') && !T[key] ? key.split('.').reduce((o, k) => (o ? o[k] : undefined), T) : T[key];
  const v = node?.[lang] ?? node?.en;
  if (typeof v === 'function') return v(params);
  if (typeof v === 'string') return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''));
  return key;
};

module.exports = { t, langOf, LANGS, FRAUD };
