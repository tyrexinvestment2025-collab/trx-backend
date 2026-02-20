const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const DailyEarning = require('../models/DailyProfit');
const { getBitcoinPrice } = require('./priceService');

const startCronJobs = () => {
  console.log('Mining Hub: pulse services active.');

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
          // 1. Обновляем Карту (NFT)
          await UserCard.updateOne({ _id: card._id }, {
              $inc: { currentProfitSats: minuteProfitSats, currentProfitUsd: minuteProfitUsd },
              $set: { lastAccrualDate: new Date() }
          });

          // 2. Обновляем общую статистику Юзера
          await User.updateOne({ _id: card.userId }, {
              $inc: { 'balance.totalProfitUsd': minuteProfitUsd }
          });

          // 3. НОВОЕ: Записываем в ежедневный лог (для графиков и "Сегодня")
          await DailyEarning.updateOne(
            { userId: card.userId, date: today },
            { $inc: { miningSats: minuteProfitSats } },
            { upsert: true }
          );
        }
      }
    } catch (e) { console.error('Cron Accrual Error:', e); }
  });

  // Логика разморозки (Cooling -> Finished) - оставляем без изменений
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const locked = await UserCard.find({ status: 'Cooling', unlockAt: { $lte: now } });
    for (const node of locked) {
        const price = parseFloat(node.purchasePriceUsd.toString());
        await User.updateOne({ _id: node.userId }, {
            $inc: { 'balance.walletUsd': price, 'balance.pendingWithdrawalUsd': -price }
        });
        node.status = 'Finished';
        await node.save();
    }
  });
};

module.exports = startCronJobs;