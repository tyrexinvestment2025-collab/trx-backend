/**
 * События продукта → сообщения бота. Вызывается из контроллеров и сервисов ПОСЛЕ успешной денежной операции.
 * Всё уходит через outbox с детерминированным eventId (повтор не продублирует сообщение).
 * Ошибки здесь никогда не ломают вызывающий код.
 */
const User = require('../models/User');
const Outbox = require('../models/Outbox');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { enqueue, enqueueAdmin } = require('./outbox');
const { getBot } = require('./api');
const { cfg } = require('./config');
const A = require('./adminTexts');
const { toNum, round2 } = require('../utils/money');
const { maskStore } = require('./format');

const safe = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { console.error('[bot events]', e.message); return null; }
};

const userInfo = async (userId) => User.findById(userId).select('tgId username firstName balance uplineUserId').lean();
const actorName = (actor) => (actor?.username ? `@${actor.username}` : actor?.tgId ? `id ${actor.tgId}` : 'админка');

/** Параметры карточки заявки в админ-чате */
const depositCardParams = (d, u) => ({
  id: String(d._id), amount: round2(toNum(d.amountUsd)), txHash: d.txHash, createdAt: d.createdAt,
  tgId: u?.tgId, username: u?.username && !/^User\d+$/.test(u.username) ? u.username : null, firstName: u?.firstName,
});
const withdrawalCardParams = (w, u) => ({
  id: String(w._id), amount: round2(toNum(w.amountUsd)), address: w.walletAddress, createdAt: w.createdAt,
  balance: round2(toNum(u?.balance?.walletUsd)),
  tgId: u?.tgId, username: u?.username && !/^User\d+$/.test(u.username) ? u.username : null, firstName: u?.firstName,
});

/** Заменить карточку заявки в админ-чате на итог (кнопки исчезают) */
async function closeAdminCard(kind, request, user, result) {
  const c = cfg();
  const bot = getBot();
  const eventId = `admin.${kind}:${request._id}`;
  const card = await Outbox.findOne({ eventId }).lean();
  const base = kind === 'deposit' ? depositCardParams(request, user) : withdrawalCardParams(request, user);
  if (!card) return;
  // «Баланс после заявки» — как на момент создания, а не после обработки
  if (kind !== 'deposit' && card.params?.balance !== undefined) base.balance = card.params.balance;
  const params = { ...base, ...result, at: new Date(), closed: true };
  if (card.status !== 'sent' || !card.messageId) {
    // Карточка ещё не ушла — отправим сразу закрытой
    await Outbox.updateOne({ _id: card._id, status: 'queued' }, { $set: { params } });
    return;
  }
  if (!bot || c.sendingDisabled) return;
  const text = kind === 'deposit' ? A.depositCard(params) : A.withdrawalCard(params);
  await bot.api.editMessageText(card.chatId, card.messageId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
    .catch(e => console.warn('[bot] edit admin card:', e.description || e.message));
}

const alertsFor = async (kind, request, user) => {
  const c = cfg();
  const amount = round2(toNum(request.amountUsd));
  const who = { tgId: user?.tgId, username: user?.username, firstName: user?.firstName, userId: String(user?._id || '') };
  if (amount >= c.alertAmountUsd) {
    await enqueueAdmin({ eventId: `admin.alert:big:${request._id}`, topic: 'alerts', template: 'admin.alert', params: { type: 'big', kind, amount, threshold: c.alertAmountUsd, ...who } });
  }
  const since = new Date(Date.now() - 3600_000);
  const [deps, wds] = await Promise.all([
    DepositRequest.countDocuments({ userId: request.userId, createdAt: { $gte: since } }),
    WithdrawalRequest.countDocuments({ userId: request.userId, createdAt: { $gte: since } }),
  ]);
  if (deps + wds > 3) {
    await enqueueAdmin({ eventId: `admin.alert:burst:${request.userId}:${new Date().toISOString().slice(0, 13)}`, topic: 'alerts', template: 'admin.alert', params: { type: 'burst', count: deps + wds, ...who } });
  }
};

module.exports = {
  depositCreated: safe(async (deposit) => {
    const u = await userInfo(deposit.userId);
    await enqueue({ eventId: `deposit.created:${deposit._id}`, userId: deposit.userId, template: 'deposit.created', params: { amount: round2(toNum(deposit.amountUsd)) } });
    await enqueueAdmin({ eventId: `admin.deposit:${deposit._id}`, topic: 'deposits', template: 'admin.deposit', params: depositCardParams(deposit, u) });
    await alertsFor('dep', deposit, u);
  }),

  depositConfirmed: safe(async (deposit, user, actor) => {
    await enqueue({ eventId: `deposit.confirmed:${deposit._id}`, userId: deposit.userId, template: 'deposit.confirmed', params: { amount: round2(toNum(deposit.amountUsd)), balance: round2(toNum(user?.balance?.walletUsd)) } });
    await closeAdminCard('deposit', deposit, await userInfo(deposit.userId), { result: 'confirmed', by: actorName(actor) });
  }),

  depositRejected: safe(async (deposit, reason, actor) => {
    await enqueue({ eventId: `deposit.rejected:${deposit._id}`, userId: deposit.userId, template: 'deposit.rejected', params: { amount: round2(toNum(deposit.amountUsd)), reason } });
    await closeAdminCard('deposit', deposit, await userInfo(deposit.userId), { result: 'dep_rejected', by: actorName(actor), reason });
  }),

  withdrawalCreated: safe(async (w) => {
    const u = await userInfo(w.userId);
    await enqueue({ eventId: `withdrawal.created:${w._id}`, userId: w.userId, template: 'withdrawal.created', params: { amount: round2(toNum(w.amountUsd)), address: maskStore(w.walletAddress) } });
    await enqueueAdmin({ eventId: `admin.withdrawal:${w._id}`, topic: 'withdrawals', template: 'admin.withdrawal', params: withdrawalCardParams(w, u) });
    await alertsFor('wd', w, u);
  }),

  withdrawalPaid: safe(async (w, txHash, actor) => {
    await enqueue({ eventId: `withdrawal.paid:${w._id}`, userId: w.userId, template: 'withdrawal.paid', params: { amount: round2(toNum(w.amountUsd)), address: maskStore(w.walletAddress), txHash } });
    await closeAdminCard('withdrawal', w, await userInfo(w.userId), { result: 'paid', by: actorName(actor), txHash });
  }),

  withdrawalRejected: safe(async (w, reason, actor) => {
    await enqueue({ eventId: `withdrawal.rejected:${w._id}`, userId: w.userId, template: 'withdrawal.rejected', params: { amount: round2(toNum(w.amountUsd)), reason } });
    await closeAdminCard('withdrawal', w, await userInfo(w.userId), { result: 'wd_rejected', by: actorName(actor), reason });
  }),

  /** Покупка карты: сообщение покупателю и бонус пригласившему */
  cardBought: safe(async (card, cardType, buyer) => {
    await enqueue({ eventId: `card.bought:${card._id}`, userId: buyer._id, template: 'card.bought', params: { cardName: cardType?.name, serial: card.serialNumber } });
    if (buyer.uplineUserId && cardType?.referralAPY > 0) {
      await enqueue({ eventId: `referral.bonus:${card._id}`, userId: buyer.uplineUserId, template: 'referral.bonus', params: { series: cardType.name, rate: cardType.referralAPY } });
    }
  }),

  trialActivated: safe(async (card, cardType, userId) => {
    await enqueue({ eventId: `trial.activated:${card._id}`, userId, template: 'trial.activated', params: { cardName: cardType?.name, serial: card.serialNumber } });
  }),

  trialFinished: safe(async (card, cardName) => {
    await enqueue({ eventId: `trial.finished:${card._id}`, userId: card.userId, template: 'trial.finished', params: { cardName, serial: card.serialNumber } });
  }),

  cycleEnded: safe(async (card, params) => {
    await enqueue({ eventId: `card.cycle_ended:${card._id}`, userId: card.userId, template: 'card.cycle_ended', params });
  }),

  cycleEnding: safe(async (card, params) => {
    await enqueue({ eventId: `card.cycle_ending:${card._id}:${new Date(card.unlockAt).getTime()}`, userId: card.userId, template: 'card.cycle_ending', params });
  }),

  referralJoined: safe(async (inviterId, newUser) => {
    await enqueue({ eventId: `referral.joined:${newUser._id}`, userId: inviterId, template: 'referral.joined', params: { name: String(newUser.firstName || '').slice(0, 64) } });
  }),

  accountBanned: safe(async (user) => {
    await enqueue({ eventId: `account.banned:${user._id}:${Date.now()}`, userId: user._id, template: 'account.banned', params: {} });
  }),
};
