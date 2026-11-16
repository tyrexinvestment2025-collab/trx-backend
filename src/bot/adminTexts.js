/** Тексты админ-чата (на русском). Все данные пользователя экранируются. */
const { money, escapeHtml, dateTime } = require('./format');
const { appLink } = require('./config');

const fmt = (n) => money(n, 'ru');
const who = (p) => `${p.username ? `@${escapeHtml(p.username)}` : escapeHtml(p.firstName || 'без имени')} · <code>${p.tgId}</code>`;
const when = (d) => dateTime(d || Date.now(), 'ru', 'Europe/Kyiv');

const STATUS = {
  confirmed: (p) => `✅ Подтвердил ${escapeHtml(p.by)}, ${when(p.at)}`,
  dep_rejected: (p) => `❌ Отклонил ${escapeHtml(p.by)}, ${when(p.at)}\nПричина: ${escapeHtml(p.reason)}`,
  paid: (p) => `✅ Выплачено, отметил ${escapeHtml(p.by)}, ${when(p.at)}${p.txHash ? `\nХэш: <code>${escapeHtml(p.txHash)}</code>` : ''}`,
  wd_rejected: (p) => `❌ Отклонил ${escapeHtml(p.by)}, ${when(p.at)}\nПричина: ${escapeHtml(p.reason)}\nСумма возвращена на баланс.`,
};

const depositCard = (p) => [
  `<b>Пополнение ${fmt(p.amount)}</b>`,
  who(p),
  `Хэш: <a href="https://mempool.space/tx/${escapeHtml(p.txHash)}">${escapeHtml(String(p.txHash).slice(0, 10))}…${escapeHtml(String(p.txHash).slice(-6))}</a>`,
  `Создана: ${when(p.createdAt)}`,
  p.result ? `\n${STATUS[p.result](p)}` : '',
].filter(Boolean).join('\n');

const withdrawalCard = (p) => [
  `<b>Вывод ${fmt(p.amount)}</b>`,
  who(p),
  `Баланс после заявки: ${fmt(p.balance)}`,
  `Адрес TRC20:\n<code>${escapeHtml(p.address)}</code>`,
  `Создана: ${when(p.createdAt)}`,
  p.result ? `\n${STATUS[p.result](p)}` : '',
].filter(Boolean).join('\n');

const openBtn = (kind, id) => ({ text: 'Открыть в админке', url: appLink(`adm_${kind}_${id}`) });

const depositButtons = (id) => ({ inline_keyboard: [
  [{ text: 'Подтвердить', callback_data: `dep:ok:${id}` }, { text: 'Отклонить', callback_data: `dep:no:${id}` }],
  [openBtn('dep', id)],
] });
const withdrawalButtons = (id) => ({ inline_keyboard: [
  [{ text: 'Выплачено', callback_data: `wd:paid:${id}` }, { text: 'Отклонить', callback_data: `wd:no:${id}` }],
  [openBtn('wd', id)],
] });

/** Второй шаг подтверждения */
const confirmButtons = (kind, action, id) => ({ inline_keyboard: [
  [{ text: 'Да', callback_data: `${kind}:${action}!:${id}` }, { text: 'Нет', callback_data: `${kind}:back:${id}` }],
] });

const ALERTS = {
  big: (p) => `Крупная заявка: ${p.kind === 'wd' ? 'вывод' : 'пополнение'} ${fmt(p.amount)} (порог ${fmt(p.threshold)})`,
  burst: (p) => `Больше 3 заявок за час от одного пользователя (${p.count})`,
  dupHash: () => 'Один хэш в двух заявках',
};
const alert = (p) => `⚠️ <b>Тревога</b>\n${ALERTS[p.type] ? ALERTS[p.type](p) : escapeHtml(p.type)}\n${who(p)}`;

const daily = (p) => [
  `<b>Итог дня</b> — ${escapeHtml(p.date)}`,
  `Новых пользователей: ${p.newUsers}`,
  `Пополнений подтверждено: ${p.depositsCount} на ${fmt(p.depositsUsd)}`,
  `Выводов выплачено: ${p.withdrawalsCount} на ${fmt(p.withdrawalsUsd)}`,
  `В ожидании: пополнений ${p.pendingDeposits}, выводов ${p.pendingWithdrawals}`,
].join('\n');

const error = (p) => `🛑 <b>Ошибка бота</b>\n${escapeHtml(p.where)}: ${escapeHtml(String(p.message).slice(0, 500))}`;

const stats = (p) => [
  '<b>Статистика</b>',
  `Пользователей: ${p.users} (+${p.users24h} за сутки)`,
  `Работающих карт: ${p.activeCards}`,
  `Заявок в ожидании: пополнений ${p.pendingDeposits}, выводов ${p.pendingWithdrawals}`,
  `Могут получать сообщения бота: ${p.canMessage}`,
].join('\n');

module.exports = { depositCard, withdrawalCard, depositButtons, withdrawalButtons, confirmButtons, alert, daily, error, stats, STATUS };
