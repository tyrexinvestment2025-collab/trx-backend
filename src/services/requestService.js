/**
 * Обработка заявок на пополнение и вывод — одна логика для админки и для кнопок в админ-чате бота.
 * Переходы статуса атомарные (PENDING → …): двойное нажатие или два админа одновременно
 * не начислят деньги дважды. Каждое действие пишется в журнал AdminAction.
 *
 * actor = { userId, tgId, username, source: 'bot' | 'admin_panel' }
 * Результат: { ok: true, request, user } или { ok: false, code: 'NOT_PENDING' | 'NOT_FOUND' | 'INVALID_ID' }
 */
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Notification = require('../models/Notification');
const AdminAction = require('../models/AdminAction');
const { updateUserStatus } = require('../utils/userStatusHelper');
const { toNum, round2, dec, isObjectId } = require('../utils/money');
const events = require('../bot/events');

const log = (actor, action, targetId, reason, meta) =>
  AdminAction.create({
    adminTgId: actor?.tgId ?? null, adminUserId: actor?.userId ?? null,
    action, targetId: String(targetId), reason: reason || null, meta: meta || {}, source: actor?.source || 'admin_panel',
  }).catch(e => console.error('[AdminAction]', e.message));

const cleanReason = (r, fallback) => String(r || '').trim().slice(0, 500) || fallback;

async function confirmDeposit(id, actor) {
  if (!isObjectId(id)) return { ok: false, code: 'INVALID_ID' };
  const deposit = await DepositRequest.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'CONFIRMED' } }, { new: true });
  if (!deposit) return { ok: false, code: 'NOT_PENDING' };

  const amount = round2(toNum(deposit.amountUsd));
  const user = await User.findOneAndUpdate(
    { _id: deposit.userId },
    { $inc: { 'balance.walletUsd': dec(amount), totalDepositedUsd: dec(amount) } },
    { new: true }
  );
  if (!user) {
    await DepositRequest.updateOne({ _id: deposit._id }, { $set: { status: 'REJECTED', adminComment: 'User not found' } });
    return { ok: false, code: 'NOT_FOUND' };
  }

  await Notification.create({ userId: user._id, title: 'Deposit Confirmed', message: `Your account has been topped up by $${amount.toFixed(2)}.`, type: 'DEPOSIT', key: 'deposit_confirmed', params: { amount } });
  await log(actor, 'dep.ok', deposit._id, null, { amount });
  await updateUserStatus(user._id);
  await events.depositConfirmed(deposit, user, actor);
  return { ok: true, request: deposit, user };
}

async function rejectDeposit(id, reason, actor) {
  if (!isObjectId(id)) return { ok: false, code: 'INVALID_ID' };
  const adminComment = cleanReason(reason, 'Transaction not found or invalid');
  const deposit = await DepositRequest.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'REJECTED', adminComment } }, { new: true });
  if (!deposit) return { ok: false, code: 'NOT_PENDING' };

  const amount = round2(toNum(deposit.amountUsd));
  await Notification.create({ userId: deposit.userId, title: 'Deposit Rejected', message: `Your deposit request for $${amount.toFixed(2)} was rejected. Reason: ${adminComment}`, type: 'DEPOSIT', key: 'deposit_rejected', params: { amount, reason: adminComment } });
  await log(actor, 'dep.reject', deposit._id, adminComment, { amount });
  await events.depositRejected(deposit, adminComment, actor);
  return { ok: true, request: deposit };
}

async function markWithdrawalPaid(id, txHash, actor) {
  if (!isObjectId(id)) return { ok: false, code: 'INVALID_ID' };
  const hash = /^[A-Za-z0-9]{20,128}$/.test(String(txHash || '').trim()) ? String(txHash).trim() : null;
  const withdrawal = await WithdrawalRequest.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { $set: { status: 'PROCESSED', processedDate: new Date(), ...(hash ? { payoutTxHash: hash } : {}) } },
    { new: true }
  );
  if (!withdrawal) return { ok: false, code: 'NOT_PENDING' };

  const amount = round2(toNum(withdrawal.amountUsd));
  // Деньги уже списаны с кошелька при создании заявки — убираем их из pending
  await User.updateOne({ _id: withdrawal.userId }, { $inc: { 'balance.pendingWithdrawalUsd': dec(-amount) } });
  await Notification.create({ userId: withdrawal.userId, title: 'Withdrawal Processed', message: `Your withdrawal of $${amount.toFixed(2)} has been processed.`, type: 'WITHDRAWAL', key: 'withdrawal_processed', params: { amount } });
  await log(actor, 'wd.paid', withdrawal._id, null, { amount, txHash: hash });
  await events.withdrawalPaid(withdrawal, hash, actor);
  return { ok: true, request: withdrawal };
}

async function rejectWithdrawal(id, reason, actor) {
  if (!isObjectId(id)) return { ok: false, code: 'INVALID_ID' };
  const adminComment = cleanReason(reason, 'Rejected by admin');
  const withdrawal = await WithdrawalRequest.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'REJECTED', adminComment } }, { new: true });
  if (!withdrawal) return { ok: false, code: 'NOT_PENDING' };

  const amount = round2(toNum(withdrawal.amountUsd));
  // Возвращаем деньги из pending в кошелёк
  await User.updateOne({ _id: withdrawal.userId }, { $inc: { 'balance.walletUsd': dec(amount), 'balance.pendingWithdrawalUsd': dec(-amount) } });
  await Notification.create({ userId: withdrawal.userId, title: 'Withdrawal Rejected', message: `Your withdrawal request was rejected. Reason: ${adminComment}. Funds have been returned to your balance.`, type: 'WITHDRAWAL', key: 'withdrawal_rejected', params: { amount, reason: adminComment } });
  await log(actor, 'wd.reject', withdrawal._id, adminComment, { amount });
  await events.withdrawalRejected(withdrawal, adminComment, actor);
  return { ok: true, request: withdrawal };
}

async function toggleBan(userId, actor) {
  if (!isObjectId(userId)) return { ok: false, code: 'INVALID_ID' };
  const user = await User.findById(userId);
  if (!user) return { ok: false, code: 'NOT_FOUND' };
  user.isBanned = !user.isBanned;
  await user.save();
  await log(actor, user.isBanned ? 'ban' : 'unban', user._id);
  if (user.isBanned) await events.accountBanned(user);
  return { ok: true, user };
}

module.exports = { confirmDeposit, rejectDeposit, markWithdrawalPaid, rejectWithdrawal, toggleBan };
