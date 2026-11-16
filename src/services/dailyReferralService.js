const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const DailyEarning = require('../models/DailyProfit');
const ReferralReward = require('../models/ReferralReward');
const priceService = require('./priceService2');

/**
 * Ежедневная реферальная выплата.
 * - Начисляется только в referralSats (невостребованные). В walletSats деньги попадают через /referrals/claim.
 *   Раньше начислялось сразу в оба поля, и claim добавлял сумму в кошелёк второй раз.
 * - Идемпотентно: уникальный индекс ReferralReward(sourceCardId, date) не даст выплатить дважды за день.
 */
const runDailyReferralPayouts = async () => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const activeCards = await UserCard.find({ status: 'Active', isTrial: { $ne: true } })
      .populate('userId', 'uplineUserId')
      .populate('cardTypeId', 'referralAPY');

    for (const card of activeCards) {
      const miner = card.userId;
      if (!miner?.uplineUserId || !card.cardTypeId?.referralAPY) continue;

      const uplineId = miner.uplineUserId;
      const isUplineActive = await UserCard.exists({ userId: uplineId, status: 'Active' });
      if (!isUplineActive) continue;

      const nominal = parseFloat(card.nominalSats.toString());
      const dailyReward = Math.floor((nominal * (card.cardTypeId.referralAPY / 100)) / 365);
      if (dailyReward <= 0) continue;

      try {
        await ReferralReward.create({
          uplineUserId: uplineId,
          partnerUserId: miner._id,
          amountSats: dailyReward,
          sourceCardId: card._id,
          date: today
        });
      } catch (e) {
        if (e.code === 11000) continue; // уже выплачено сегодня
        throw e;
      }

      await User.updateOne({ _id: uplineId }, { $inc: { 'balance.referralSats': dailyReward } });
      await DailyEarning.updateOne(
        { userId: uplineId, date: today },
        { $inc: { referralSats: dailyReward, referralUsd: ((priceService.getBitcoinPrice() || 0) * dailyReward) / 100000000 } },
        { upsert: true }
      );
    }
  } catch (e) { console.error('Referral Cron Error:', e); }
};

const startReferralJob = () => { cron.schedule('0 0 * * *', runDailyReferralPayouts); };
module.exports = { startReferralJob, runDailyReferralPayouts };
