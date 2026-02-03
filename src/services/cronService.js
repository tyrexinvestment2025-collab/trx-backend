const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const { getBitcoinPrice } = require('./priceService');

const startCronJobs = () => {
  console.log('Cron jobs initialized...');

  // ---------------------------------------------------------
  // ЗАДАЧА 1: Ежеминутное начисление (Sats + USD)
  // ---------------------------------------------------------
  cron.schedule('* * * * *', async () => {
    // console.log('[Cron] Minute Accrual...'); 
    
    try {
      // Подгружаем карты
      const activeCards = await UserCard.find({ status: 'Active' }).populate('cardTypeId');
      const btcPrice = getBitcoinPrice(); 

      let processedCount = 0;
      const minutesInYear = 365 * 24 * 60; 

      // Кэш для обновления юзеров, чтобы не делать 100 запросов к одному юзеру, если у него 100 карт
      const userProfitUpdates = {}; 

      for (const card of activeCards) {
        if (!card.cardTypeId) continue;

        const nominalSats = parseFloat(card.nominalSats.toString());
        const currentProfitSats = parseFloat(card.currentProfitSats.toString());
        const currentProfitUsd = parseFloat(card.currentProfitUsd.toString());

        // Расчет дохода
        const minuteRate = (card.cardTypeId.clientAPY / 100) / minutesInYear;
        const minuteProfitSats = nominalSats * minuteRate;
        const minuteProfitUsd = (minuteProfitSats / 100000000) * btcPrice;

        if (minuteProfitSats > 0) {
          // 1. Обновляем КАРТУ (накопительный профит на самой карте)
          card.currentProfitSats = currentProfitSats + minuteProfitSats;
          card.currentProfitUsd = currentProfitUsd + minuteProfitUsd;
          card.lastAccrualDate = new Date();
          await card.save();
          
          // 2. Собираем данные для обновления ЮЗЕРА (Статистика общего профита)
          if (!userProfitUpdates[card.userId]) {
             userProfitUpdates[card.userId] = 0;
          }
          userProfitUpdates[card.userId] += minuteProfitUsd;

          processedCount++;
        }
      }

      // 3. Массово обновляем статистику пользователей
      // Это переносит накопленный за минуту профит в поле totalProfitUsd пользователя
      const userIds = Object.keys(userProfitUpdates);
      if (userIds.length > 0) {
          await Promise.all(userIds.map(async (userId) => {
              const profitToAdd = userProfitUpdates[userId];
              
              // Используем $inc для безопасного добавления к текущему значению
              await User.findByIdAndUpdate(userId, {
                  $inc: { 'balance.totalProfitUsd': profitToAdd }
              });
          }));
      }
      
      if (processedCount > 0) {
          // console.log(`[Cron] Updated ${processedCount} cards and ${userIds.length} users.`);
      }

    } catch (error) {
      console.error('[Cron] Error in minute accrual:', error);
    }
  });

  // ---------------------------------------------------------
  // ЗАДАЧА 2: Разморозка средств (Cooling -> Finished)
  // ---------------------------------------------------------
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const cardsToUnlock = await UserCard.find({ 
        status: 'Cooling', 
        unlockAt: { $lte: now } 
      });

      for (const card of cardsToUnlock) {
        const user = await User.findById(card.userId);
        if (!user) continue;

        const purchasePrice = parseFloat(card.purchasePriceUsd.toString());

        // Размораживаем тело покупки
        // При остановке (Stop) мы перевели деньги в Pending. Сейчас забираем из Pending в Wallet.
        
        let userPending = parseFloat(user.balance.pendingWithdrawalUsd.toString());
        let userWallet = parseFloat(user.balance.walletUsd.toString());

        // Защита от отрицательных значений
        if (userPending >= purchasePrice) {
            userPending -= purchasePrice;
        } else {
            userPending = 0;
        }

        userWallet += purchasePrice;

        user.balance.pendingWithdrawalUsd = userPending;
        user.balance.walletUsd = userWallet;
        
        await user.save();

        card.status = 'Finished';
        await card.save();
        console.log(`[Cron] Unlocked card ${card._id}, returned $${purchasePrice} to user.`);
      }
    } catch (error) {
      console.error('[Cron] Error in unlocking funds:', error);
    }
  });
};

module.exports = startCronJobs;