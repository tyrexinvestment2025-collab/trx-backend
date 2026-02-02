const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const { getBitcoinPrice } = require('./priceService');

const startCronJobs = () => {
  console.log('Cron jobs initialized...');

  // ---------------------------------------------------------
  // ЗАДАЧА 1: Ежедневное начисление (Sats + USD)
  // ---------------------------------------------------------
  cron.schedule('1 0 * * *', async () => {
    console.log('[Cron] Daily Accrual (Dual Currency)...');
    
    try {
      const activeCards = await UserCard.find({ status: 'Active' }).populate('cardTypeId');
      const btcPrice = getBitcoinPrice(); // Текущий курс

      let processedCount = 0;

      for (const card of activeCards) {
        if (!card.cardTypeId) continue;

        // Читаем текущие значения
        const nominalSats = parseFloat(card.nominalSats.toString());
        const currentProfitUsd = parseFloat(card.currentProfitUsd.toString());
        const currentProfitSats = parseFloat(card.currentProfitSats.toString());

        // 1. Считаем дневной доход в САТОШИ (База)
        // Формула: (APY / 100) / 365
        const dailyRate = (card.cardTypeId.clientAPY / 100) / 365;
        const dailyProfitSats = Math.floor(nominalSats * dailyRate);

        // 2. Конвертируем этот доход в USD
        // (Sats / 100 млн) * Курс
        const dailyProfitUsd = (dailyProfitSats / 100000000) * btcPrice;

        if (dailyProfitSats > 0) {
          // 3. Обновляем ОБА поля
          card.currentProfitSats = currentProfitSats + dailyProfitSats;
          card.currentProfitUsd = currentProfitUsd + dailyProfitUsd;
          
          card.lastAccrualDate = new Date();
          await card.save();
          
          processedCount++;
        }
      }
      console.log(`[Cron] Accrual done. Updated ${processedCount} cards.`);
    } catch (error) {
      console.error('[Cron] Error in daily accrual:', error);
    }
  });

  // ---------------------------------------------------------
  // ЗАДАЧА 2: Разморозка средств (Cooling -> Finished)
  // ---------------------------------------------------------
  cron.schedule('5 0 * * *', async () => {
    console.log('[Cron] Checking for unlocking funds...');
    try {
      const now = new Date();
      const cardsToUnlock = await UserCard.find({ 
        status: 'Cooling', 
        unlockAt: { $lte: now } 
      });

      for (const card of cardsToUnlock) {
        const user = await User.findById(card.userId);
        if (!user) continue;

        // Логика возврата средств (Работаем с USD, так как баланс юзера в USD)
        const purchasePrice = parseFloat(card.purchasePriceUsd.toString());
        const profitUsd = parseFloat(card.currentProfitUsd.toString());
        const totalAmountUsd = purchasePrice + profitUsd;

        let userPending = parseFloat(user.balance.pendingWithdrawalUsd.toString());
        let userWallet = parseFloat(user.balance.walletUsd.toString());
        let userTotalProfit = parseFloat(user.balance.totalProfitUsd.toString());

        // Списываем с заморозки
        if (userPending >= totalAmountUsd) {
          userPending -= totalAmountUsd;
        } else {
          userPending = 0;
        }
        
        // Зачисляем на кошелек
        userWallet += totalAmountUsd;
        userTotalProfit += profitUsd; // Учитываем профит в общей статистике

        user.balance.pendingWithdrawalUsd = userPending;
        user.balance.walletUsd = userWallet;
        user.balance.totalProfitUsd = userTotalProfit;

        await user.save();

        card.status = 'Finished';
        await card.save();
      }
    } catch (error) {
      console.error('[Cron] Error in unlocking funds:', error);
    }
  });
};

module.exports = startCronJobs;