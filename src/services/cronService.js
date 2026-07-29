const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const DailyEarning = require('../models/DailyProfit');
const { getBitcoinPrice } = require('./priceService');

const startCronJobs = () => {
  console.log('Mining Hub: pulse services active.');

  // 1. НАЧИСЛЕНИЕ ПРИБЫЛИ (Раз в минуту)
  cron.schedule('* * * * *', async () => {
    try {
      const activeCards = await UserCard.find({ status: 'Active' }).populate('cardTypeId');
      const btcPrice = getBitcoinPrice(); 
      const minutesInYear = 365 * 24 * 60; 
      const today = new Date().toISOString().split('T')[0];

      for (const card of activeCards) {
        if (!card.cardTypeId) continue;

        const nominalSats = parseFloat(card.nominalSats.toString());
        const minuteRate = (card.cardTypeId.clientAPY / 100) / minutesInYear;
        const minuteProfitSats = minuteRate * nominalSats;
        const minuteProfitUsd = (minuteProfitSats / 100000000) * btcPrice;

        if (minuteProfitSats > 0) {
          await UserCard.updateOne({ _id: card._id }, {
              $inc: { 
                currentProfitSats: minuteProfitSats, 
                currentProfitUsd: minuteProfitUsd 
              },
              $set: { lastAccrualDate: new Date() }
          });

          await User.updateOne({ _id: card.userId }, {
              $inc: { 'balance.totalProfitUsd': minuteProfitUsd }
          });

          await DailyEarning.updateOne(
            { userId: card.userId, date: today },
            { $inc: { miningSats: minuteProfitSats } },
            { upsert: true }
          );
        }
      }
    } catch (e) { console.error('Cron Accrual Error:', e); }
  });

  // 2. ОТКЛЮЧЕНИЕ ТРИАЛЬНЫХ КАРТ И РАЗМОРОЗКА (Раз в минуту)
  cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();

        // А) Завершаем ТРИАЛЬНЫЕ карты, у которых вышел срок (1 месяц)
        const expiredTrials = await UserCard.find({ 
            isTrial: true, 
            status: 'Active', 
            unlockAt: { $lte: now } 
        });

        for (const trial of expiredTrials) {
            trial.status = 'Finished';
            await trial.save();
            console.log(`[Trial] Card ${trial._id} expired and deactivated.`);
        }

        // Б) Обычная логика разморозки стейкинга (Cooling -> Finished)
        const locked = await UserCard.find({ 
            status: 'Cooling', 
            unlockAt: { $lte: now },
            isTrial: false // Только для купленных карт
        });

        for (const node of locked) {
            const price = parseFloat(node.purchasePriceUsd.toString());
            await User.updateOne({ _id: node.userId }, {
                $inc: { 'balance.walletUsd': price, 'balance.pendingWithdrawalUsd': -price }
            });
            node.status = 'Finished';
            await node.save();
        }
    } catch (e) {
        console.error('Cron Expiration Error:', e);
    }
  });
};

module.exports = startCronJobs;