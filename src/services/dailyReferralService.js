const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const DailyEarning = require('../models/DailyProfit');

const runDailyReferralPayouts = async () => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const activeCards = await UserCard.find({ status: 'Active' })
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

      if (dailyReward > 0) {
        // Начисляем лидеру
        await User.updateOne({ _id: uplineId }, {
            $inc: { 'balance.walletSats': dailyReward, 'balance.referralSats': dailyReward }
        });
        // Записываем в лог дня
        await DailyEarning.updateOne(
            { userId: uplineId, date: today },
            { $inc: { referralSats: dailyReward } },
            { upsert: true }
        );
      }
    }
  } catch (e) { console.error('Referral Cron Error:', e); }
};

const startReferralJob = () => { cron.schedule('0 0 * * *', runDailyReferralPayouts); };
module.exports = { startReferralJob };