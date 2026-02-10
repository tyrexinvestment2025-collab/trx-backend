const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const { getBitcoinPrice } = require('./priceService');

const startCronJobs = () => {
  console.log('Mining Hub: Pulse services initialized.');

  // ЗАДАЧА 1: LIVE ACCRUAL (SATS & USD)
  cron.schedule('* * * * *', async () => {
    try {
      const activeCards = await UserCard.find({ status: 'Active' }).populate('cardTypeId');
      const btcPrice = getBitcoinPrice(); 
      const minutesInYear = 365 * 24 * 60; 

      for (const card of activeCards) {
        if (!card.cardTypeId) continue;

        const nominalSats = parseFloat(card.nominalSats.toString());
        // Доход в минуту = APY / количество минут в году
        const minuteRate = (card.cardTypeId.clientAPY / 100) / minutesInYear;
        
        const minuteProfitSats = nominalSats * minuteRate;
        const minuteProfitUsd = (minuteProfitSats / 100000000) * btcPrice;

        if (minuteProfitSats > 0) {
          // Обновляем состояние самой карты (ноды)
          await UserCard.updateOne({ _id: card._id }, {
              $inc: { 
                  currentProfitSats: minuteProfitSats, 
                  currentProfitUsd: minuteProfitUsd 
              },
              $set: { lastAccrualDate: new Date() }
          });

          // Обновляем статистику пользователя (сколько всего заработал за всё время)
          await User.updateOne({ _id: card.userId }, {
              $inc: { 'balance.totalProfitUsd': minuteProfitUsd }
          });
        }
      }
    } catch (e) { console.error('[Mining Hub] Accrual Error:', e); }
  });

  // ЗАДАЧА 2: VAULT UNLOCK (Cooling -> Finished)
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      // Ищем ноды, у которых срок "заморозки" вышел
      const lockedNodes = await UserCard.find({ status: 'Cooling', unlockAt: { $lte: now } });

      for (const node of lockedNodes) {
        const price = parseFloat(node.purchasePriceUsd.toString());

        // Атомный возврат ТЕЛА покупки в Wallet пользователя
        await User.updateOne({ _id: node.userId }, {
            $inc: { 
                'balance.walletUsd': price,
                'balance.pendingWithdrawalUsd': -price // Убираем из пендинга
            }
        });

        // Сбрасываем статус ноды на Inactive (готова к повторной активации или продаже)
        node.status = 'Inactive';
        node.currentProfitSats = 0;
        node.currentProfitUsd = 0;
        await node.save();
        
        console.log(`[Vault] Node ${node._id} unfrozen. Allocation of $${price} returned.`);
      }
    } catch (e) { console.error('[Vault] Unlock Error:', e); }
  });
};

module.exports = startCronJobs;