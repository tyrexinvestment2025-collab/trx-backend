const cron = require('node-cron');
const UserCard = require('../models/UserCard');
const User = require('../models/User');

const runDailyReferralPayouts = async () => {
  console.log('💰 [Mining Pool] Starting daily referral distribution...');
  
  try {
    // 1. Берем все АКТИВНЫЕ карты в системе (только активные карты приносят доход)
    const activeCards = await UserCard.find({ status: 'Active' })
      .populate('userId', 'uplineUserId') // Нам нужен upline владельца карты
      .populate('cardTypeId', 'referralAPY'); // Нам нужен % рефки

    let totalSatsDistributed = 0;
    
    for (const card of activeCards) {
      const miner = card.userId;
      
      // Пропускаем, если:
      // - у юзера нет аплайна
      // - у карты нет типа или реферального процента
      if (!miner || !miner.uplineUserId || !card.cardTypeId || !card.cardTypeId.referralAPY) {
        continue;
      }

      const uplineId = miner.uplineUserId;

      // 2. ПРАВИЛО: Лидер получает доход, ТОЛЬКО если сам имеет активную карту
      const isUplineActive = await UserCard.exists({ userId: uplineId, status: 'Active' });
      
      if (!isUplineActive) {
          // Лидер не майнит -> не получает бонус
          continue; 
      }

      // 3. РАСЧЕТ
      // Формула: (Номинал_Sats * Ref_APY / 100) / 365 дней
      const nominal = parseFloat(card.nominalSats.toString());
      const refAPY = card.cardTypeId.referralAPY;
      
      const dailyReward = Math.floor((nominal * (refAPY / 100)) / 365);

      if (dailyReward > 0) {
        // 4. НАЧИСЛЕНИЕ (Атомарно)
        await User.updateOne(
          { _id: uplineId },
          {
            $inc: {
              'balance.walletSats': dailyReward,   // Доступно к выводу
              'balance.referralSats': dailyReward  // Общая статистика рефки
            }
          }
        );
        totalSatsDistributed += dailyReward;
      }
    }
    
    console.log(`✅ [Mining Pool] Distributed ${totalSatsDistributed} SATS to leaders.`);

  } catch (error) {
    console.error('❌ [Mining Pool] Error:', error);
  }
};

// Запуск каждый день в 00:00
const startReferralJob = () => {
  // Для тестов можешь поставить '* * * * *' (каждую минуту)
  cron.schedule('0 0 * * *', runDailyReferralPayouts);
  console.log('⏰ Referral Cronjob scheduled (Daily 00:00).');
};

module.exports = { startReferralJob };