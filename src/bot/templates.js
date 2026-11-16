/**
 * Шаблоны сообщений очереди: template + params → { text, reply_markup }.
 * Суммы форматируются в момент отправки по языку получателя (в очереди лежат только числа).
 */
const { t } = require('./texts');
const { money, pct, dateTime, escapeHtml, maskShort } = require('./format');
const { cfg, openButton, appLink } = require('./config');
const A = require('./adminTexts');

const kb = (...rows) => ({ inline_keyboard: rows.filter(r => r && r.length) });
const supportBtn = (lang) => ({ text: t('btn.support', lang), url: cfg().supportUrl });
const cardName = (p) => `${escapeHtml(p.cardName || 'Tyrex')}${p.serial ? ` #${p.serial}` : ''}`;
const txUrlFor = (hash) => (/^[A-Za-z0-9]{64}$/.test(String(hash || '')) ? `https://tronscan.org/#/transaction/${hash}` : null);

/** Пользовательские шаблоны: группа настроек + рендер */
const USER = {
  'deposit.created': { group: 'money', render: (p, l) => ({ text: t('deposit.created', l, { amount: money(p.amount, l) }), kb: kb([openButton(t('btn.operations', l), 'wallet')]) }) },
  'deposit.confirmed': { group: 'money', render: (p, l) => ({ text: t('deposit.confirmed', l, { amount: money(p.amount, l), balance: money(p.balance, l) }), kb: kb([openButton(t('btn.wallet', l), 'wallet')]) }) },
  'deposit.rejected': { group: 'money', render: (p, l) => ({ text: t('deposit.rejected', l, { amount: money(p.amount, l), reason: escapeHtml(p.reason) }), kb: kb([supportBtn(l)]) }) },
  'withdrawal.created': { group: 'money', render: (p, l) => ({ text: t('withdrawal.created', l, { amount: money(p.amount, l), address: escapeHtml(maskShort(p.address)), eta: t('eta', l) }), kb: kb([openButton(t('btn.operations', l), 'wallet')]) }) },
  'withdrawal.paid': { group: 'money', render: (p, l) => ({ text: t('withdrawal.paid', l, { amount: money(p.amount, l), address: escapeHtml(maskShort(p.address)), txUrl: txUrlFor(p.txHash) }), kb: kb([openButton(t('btn.operations', l), 'wallet')]) }) },
  'withdrawal.rejected': { group: 'money', render: (p, l) => ({ text: t('withdrawal.rejected', l, { amount: money(p.amount, l), reason: escapeHtml(p.reason) }), kb: kb([supportBtn(l)]) }) },
  'card.bought': { group: 'money', render: (p, l) => ({ text: t('card.bought', l, { card: cardName(p) }), kb: kb([openButton(t('btn.startCard', l), 'cards')]) }) },
  'trial.activated': { group: 'money', render: (p, l) => ({ text: t('trial.activated', l, { card: cardName(p) }), kb: kb([openButton(t('btn.startCard', l), 'cards')]) }) },
  'trial.finished': { group: 'cards', render: (p, l) => ({ text: t('trial.finished', l, { card: cardName(p) }), kb: kb([openButton(t('btn.open', l), 'shop')]) }) },
  'card.cycle_ending': { group: 'cards', quiet: true, render: (p, l, u) => ({ text: t('card.cycle_ending', l, { card: cardName(p), trial: p.trial, when: dateTime(p.at, l, u?.timezone), amount: money(p.amount, l) }), kb: kb([openButton(t('btn.cards', l), 'cards')]) }) },
  'card.cycle_ended': { group: 'cards', batch: true, render: (p, l) => ({ text: t('card.cycle_ended', l, { card: cardName(p), amount: money(p.amount, l), principal: money(p.principal, l), profit: money(p.profit, l) }), kb: kb([openButton(t('btn.wallet', l), 'wallet')]) }) },
  'referral.joined': { group: 'partners', render: (p, l) => ({ text: t('referral.joined', l, { name: escapeHtml(p.name || '—') }), kb: kb([openButton(t('btn.partners', l), 'referral')]) }) },
  'referral.bonus': { group: 'partners', batch: true, render: (p, l) => ({ text: t('referral.bonus', l, { series: escapeHtml(p.series), rate: pct(p.rate, l) }), kb: kb([openButton(t('btn.partners', l), 'referral')]) }) },
  'account.banned': { group: 'money', render: (p, l) => ({ text: t('account.banned', l), kb: kb([supportBtn(l)]) }) },
};

/** Шаблоны админ-чата (только русский) */
const ADMIN = {
  'admin.deposit': (p) => ({ text: A.depositCard(p), kb: p.closed ? null : A.depositButtons(p.id) }),
  'admin.withdrawal': (p) => ({ text: A.withdrawalCard(p), kb: p.closed ? null : A.withdrawalButtons(p.id) }),
  'admin.alert': (p) => ({ text: A.alert(p), kb: p.userId ? kb([{ text: 'Открыть админку', url: appLink('p_admin') }]) : null }),
  'admin.daily': (p) => ({ text: A.daily(p), kb: kb([{ text: 'Открыть админку', url: appLink('p_admin') }]) }),
  'admin.error': (p) => ({ text: A.error(p), kb: null }),
};

const groupOf = (template) => USER[template]?.group || (template.startsWith('admin.') ? 'admin' : 'money');

/** Рендер одного сообщения. Для склеенных событий — заголовок и список строк, кнопки первого. */
const render = (template, params, lang, user, batch) => {
  if (ADMIN[template]) return ADMIN[template](params);
  const def = USER[template];
  if (!def) throw new Error(`Unknown template ${template}`);
  if (batch && batch.length > 1) {
    const parts = batch.map(p => def.render(p, lang, user));
    return { text: `${t('batchHeader', lang, { count: batch.length })}\n\n${parts.map(x => `• ${x.text}`).join('\n')}`, kb: parts[0].kb };
  }
  return def.render(params, lang, user);
};

module.exports = { USER, ADMIN, render, groupOf, kb, txUrlFor };
