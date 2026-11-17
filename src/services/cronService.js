const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const CardType = require('../models/CardType');
const User = require('../models/User');
const DailyEarning = require('../models/DailyProfit');
const priceService = require('./priceService2');
const { toNum, round2, dec } = require('../utils/money');
const IncomeEvent = require('../models/IncomeEvent');
const Notification = require('../models/Notification');
const events = require('../bot/events');

const MS_IN_YEAR = 365 * 24 * 60 * 60 * 1000;
const SATS_IN_BTC = 100000000;
const CONCURRENCY = 25;

/** Выполняет fn для элементов пачками по CONCURRENCY */
const inBatches = async (items, fn) => {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
};

/**
 * Начисление прибыли.
 * Прибыль считается от фактически прошедшего времени с lastAccrualDate,
 * а обновление карты условное (lastAccrualDate не изменился) — поэтому
 * несколько инстансов/повторные запуски не начислят дважды, а пропущенные минуты догонятся.
 */
const accrueProfits = async () => {
  const btcPrice = priceService.getBitcoinPrice();
  if (btcPrice === null) {
    console.warn('[Cron] Accrual skipped: no fresh BTC price');
    return;
  }

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const allActive = await UserCard.find({ status: 'Active' }).populate('cardTypeId', 'clientAPY').lean();
  // Карты удалённых пользователей не начисляем (их владельца нет — начислять некуда)
  const owners = new Set((await User.find({ _id: { $in: [...new Set(allActive.map(c => String(c.userId)))] } }).select('_id').lean()).map(u => String(u._id)));
  const activeCards = allActive.filter(c => owners.has(String(c.userId)));

  await inBatches(activeCards, async (card) => {
    if (!card.cardTypeId) return;
    const from = new Date(card.lastAccrualDate || card.updatedAt || now);
    // Пробная карта не зарабатывает после окончания срока
    const until = card.isTrial && card.unlockAt && card.unlockAt < now ? new Date(card.unlockAt) : now;
    const elapsed = until - from;
    if (elapsed <= 0) return;

    const nominalSats = toNum(card.nominalSats);
    const profitSats = nominalSats * (card.cardTypeId.clientAPY / 100) * (elapsed / MS_IN_YEAR);
    const profitUsd = (profitSats / SATS_IN_BTC) * btcPrice;
    if (!(profitSats > 0)) return;

    const r = await UserCard.updateOne(
      { _id: card._id, status: 'Active', lastAccrualDate: card.lastAccrualDate },
      { $inc: { currentProfitSats: profitSats, currentProfitUsd: profitUsd }, $set: { lastAccrualDate: until } }
    );
    if (r.modifiedCount !== 1) return; // другой инстанс уже начислил

    await Promise.all([
      User.updateOne({ _id: card.userId }, { $inc: { 'balance.totalProfitUsd': profitUsd } }),
      DailyEarning.updateOne({ userId: card.userId, date: today }, { $inc: { miningSats: profitSats, miningUsd: profitUsd } }, { upsert: true })
    ]);
  });
};

/**
 * Завершение пробных карт и окончание охлаждения.
 */
const processExpirations = async () => {
  const now = new Date();

  // А) Пробные карты с истёкшим сроком (атомарно по одной — чтобы уведомить ровно один раз)
  const expiredTrials = await UserCard.find({ isTrial: true, status: 'Active', unlockAt: { $lte: now } })
    .populate('cardTypeId', 'name').lean();
  await inBatches(expiredTrials, async (trial) => {
    const claimed = await UserCard.findOneAndUpdate({ _id: trial._id, status: 'Active' }, { $set: { status: 'Finished' } });
    if (!claimed) return;
    const params = { cardName: trial.cardTypeId?.name || 'Tyrex', serial: trial.serialNumber };
    await Notification.create({ userId: trial.userId, title: 'Gift card finished', message: `${params.cardName} #${params.serial}`, type: 'INFO', key: 'trial_finished', params }).catch(() => {});
    await events.trialFinished(claimed, params.cardName);
  });

  // Б) Охлаждение закончилось: выплачиваем тело + зафиксированную прибыль.
  //    Переход статуса атомарный — выплата произойдёт ровно один раз.
  const locked = await UserCard.find({ status: 'Cooling', unlockAt: { $lte: now }, isTrial: { $ne: true } }).lean();

  await inBatches(locked, async (node) => {
    const claimed = await UserCard.findOneAndUpdate(
      { _id: node._id, status: 'Cooling' },
      { $set: { status: 'Finished' } }
    );
    if (!claimed) return;

    const principal = round2(toNum(claimed.purchasePriceUsd));
    const profit = round2(toNum(claimed.coolingPayoutUsd));
    const payout = round2(principal + profit);
    await User.updateOne({ _id: claimed.userId }, {
      $inc: { 'balance.walletUsd': dec(payout), 'balance.pendingWithdrawalUsd': dec(-payout) }
    });

    const cardType = await CardType.findById(claimed.cardTypeId).select('name').lean();
    const params = { cardName: cardType?.name || 'Tyrex', serial: claimed.serialNumber, amount: payout.toFixed(2), principal: principal.toFixed(2), profit: profit.toFixed(2) };
    await IncomeEvent.create({
      userId: claimed.userId, type: 'CARD_PAYOUT', amountUsd: dec(payout),
      meta: { cardId: claimed._id, serialNumber: claimed.serialNumber, cardName: params.cardName, principalUsd: principal, profitUsd: profit }
    }).catch(e => console.error('[IncomeEvent]', e.message));
    await Notification.create({ userId: claimed.userId, title: 'Cycle finished', message: `+$${params.amount}`, type: 'INFO', key: 'card_payout', params }).catch(() => {});
    await events.cycleEnded(claimed, { cardName: params.cardName, serial: params.serial, amount: payout, principal, profit });
  });
};

/**
 * card.cycle_ending: за сутки до конца паузы (выплата) или срока подарочной карты бот пишет пользователю.
 * Включено по умолчанию; переключатель «Напомнить» в аналитике выключает его для карты (remindBeforeEnd: false),
 * группа «Карты» в настройках — для всех карт. Тихие часы соблюдает очередь.
 * Атомарная пометка remindSentAt — сообщение ставится в очередь один раз.
 */
const processReminders = async () => {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const due = await UserCard.find({
    remindBeforeEnd: { $ne: false }, remindSentAt: null,
    unlockAt: { $gt: now, $lte: soon },
    $or: [{ status: 'Cooling' }, { status: 'Active', isTrial: true }]
  }).populate('cardTypeId', 'name').lean();

  await inBatches(due, async (card) => {
    const claimed = await UserCard.findOneAndUpdate(
      { _id: card._id, remindSentAt: null },
      { $set: { remindSentAt: now } },
      { new: true }
    ).lean();
    if (!claimed) return;
    await events.cycleEnding(card, {
      cardName: card.cardTypeId?.name || 'Tyrex',
      serial: card.serialNumber,
      trial: Boolean(card.isTrial),
      at: card.unlockAt,
      amount: round2(toNum(card.purchasePriceUsd) + toNum(card.coolingPayoutUsd))
    });
  });
};

let accrualRunning = false;
let expirationRunning = false;

const startCronJobs = () => {
  console.log('Mining Hub: pulse services active.');

  cron.schedule('* * * * *', async () => {
    if (accrualRunning) return; // не запускаем новый цикл, пока не закончился предыдущий
    accrualRunning = true;
    try { await accrueProfits(); }
    catch (e) { console.error('Cron Accrual Error:', e); }
    finally { accrualRunning = false; }
  });

  // Служебная чистка (замена TTL-индексов Mongo)
  cron.schedule('30 3 * * *', () => require('../db/cleanup').cleanup().catch(e => console.error('Cleanup Error:', e.message)));

  cron.schedule('* * * * *', async () => {
    if (expirationRunning) return;
    expirationRunning = true;
    try { await processExpirations(); await processReminders(); }
    catch (e) { console.error('Cron Expiration Error:', e); }
    finally { expirationRunning = false; }
  });
};

module.exports = startCronJobs;
module.exports.accrueProfits = accrueProfits;
module.exports.processExpirations = processExpirations;
module.exports.processReminders = processReminders;
