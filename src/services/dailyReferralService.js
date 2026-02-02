const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');

const runDailyReferralPayouts = async () => {
  console.log('[Cron] Starting daily referral payouts job...');
  
  try {
    // 1. Получаем все активные карты пользователей, подтягивая данные о владельце и типе карты
    const activeCards = await UserCard.find({ status: 'Active' })
      .populate('userId', 'uplineUserId') // Нам нужен upline владельца карты
      .populate('cardTypeId', 'referralAPY'); // Нам нужен реф. процент с типа карты

    let payoutsCount = 0;
    
    for (const card of activeCards) {
      const cardOwner = card.userId;
      const cardType = card.cardTypeId;

      // 2. Проверяем, есть ли у владельца карты пригласитель (аплайн)
      if (!cardOwner || !cardOwner.uplineUserId || !cardType || !cardType.referralAPY) {
        continue; // Если нет аплайна или реф. процента, пропускаем
      }

      const uplineId = cardOwner.uplineUserId;

      // 3. Проверка "Активного Аплайна" - самая важная часть
      const isUplineActive = await UserCard.exists({ userId: uplineId, status: 'Active' });

      if (!isUplineActive) {
        console.log(`[Cron] Skipping payout for upline ${uplineId} because they are inactive.`);
        continue;
      }

      // 4. Если все проверки пройдены, рассчитываем и начисляем вознаграждение
      const nominal = parseFloat(card.nominalSats.toString());
      const referralAPY = cardType.referralAPY;
      
      // Расчет дневного вознаграждения (округляем вниз до целого сатоши)
      const dailyReward = Math.floor((nominal * (referralAPY / 100)) / 365);

      if (dailyReward > 0) {
        // 5. Атомарно обновляем баланс аплайна
        await User.updateOne(
          { _id: uplineId },
          {
            $inc: {
              'balance.walletSats': dailyReward,
              'balance.referralSats': dailyReward
            }
          }
        );
        payoutsCount++;
      }
    }
    
    console.log(`[Cron] Daily referral job finished. Processed ${payoutsCount} payouts.`);

  } catch (error) {
    console.error('[Cron] Error during daily referral payouts:', error);
  }
};

// Запускаем задачу каждый день в 3:01 ночи по UTC
const startReferralJob = () => {
  cron.schedule('1 3 * * *', runDailyReferralPayouts);
  console.log('Daily referral payout job scheduled for 03:01 UTC.');
};

module.exports = { startReferralJob };