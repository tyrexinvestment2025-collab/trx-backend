const User = require('../models/User');
const UserCard = require('../models/UserCard');
const Notification = require('../models/Notification');

exports.getReferralInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    // Перевірка наявності карт у самого користувача (для розблокування)
    const hasCards = await UserCard.exists({ userId: user._id });
    if (!hasCards) {
        return res.json({ isLocked: true });
    }

    const referralLink = `https://t.me/${process.env.TELEGRAM_BOT_NAME}/${process.env.TELEGRAM_APP_NAME}?startapp=${user.referralCode}`;

    // Знаходимо всіх рефералів 1-ї лінії
    const myReferrals = await User.find({ uplineUserId: user._id });
    const referralIds = myReferrals.map(u => u._id);

    // 1. КАПІТАЛ ПАРТНЕРІВ (Сума всіх куплених карт рефералами)
    const activeCards = await UserCard.find({ userId: { $in: referralIds } });
    const totalPartnerCapital = activeCards.reduce((sum, card) => {
        return sum + parseFloat(card.purchasePriceUsd.toString() || 0);
    }, 0);

    // 2. КАПІТАЛ НЕ В РОБОТІ (Сума walletUsd на балансах рефералів)
    const totalIdleCapital = myReferrals.reduce((sum, u) => {
        return sum + parseFloat(u.balance.walletUsd.toString() || 0);
    }, 0);

    // 3. СТАТИСТИКА РЕЄСТРАЦІЙ
    const totalInvited = myReferrals.length;
    // Кількість тих, хто купив хоча б одну карту
    const investorsCount = await UserCard.distinct('userId', { userId: { $in: referralIds } });
    const nonInvestorsCount = totalInvited - investorsCount.length;

    res.json({
        isLocked: false,
        referralLink,
        totalEarnedSats: user.balance.referralSats || 0,
        apr: 15.5, // Можна розраховувати динамічно або брати з конфігу
        stats: {
            totalInvited,
            investorsCount: investorsCount.length,
            nonInvestorsCount,
            totalPartnerCapital,
            totalIdleCapital
        }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error' });
  }
};

exports.getReferralList = async (req, res) => {
    try {
        const referrals = await User.find({ uplineUserId: req.user._id }).sort({ createdAt: -1 });
        const refIds = referrals.map(r => r._id);
        
        // Знаходимо активні карти для кожного
        const activeIds = await UserCard.distinct('userId', { userId: { $in: refIds }, status: 'Active' });
        const activeSet = new Set(activeIds.map(id => id.toString()));

        const list = referrals.map(r => ({
            id: r._id,
            username: r.username || 'Anonymous',
            registeredAt: r.createdAt,
            isActive: activeSet.has(r._id.toString()),
            idleBalance: parseFloat(r.balance.walletUsd.toString()).toFixed(2),
            // Загальна сума інвестицій (якщо треба для розширеної інфи)
            // Примітка: для швидкості краще рахувати це агрегацією, але поки так:
            totalInvestment: 0 
        }));

        res.json(list);
    } catch (e) {
        res.status(500).json({ message: 'Error' });
    }
};

exports.claimRewards = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    const amountToClaim = user.balance.referralSats || 0;

    if (amountToClaim <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: "У вас нет накопленных вознаграждений для сбора." 
      });
    }

    // 1. Переводим средства на основной баланс
    user.balance.sats = (user.balance.sats || 0) + amountToClaim;

    // 2. Обнуляем реферальный баланс
    user.balance.referralSats = 0;

    // 3. Сохраняем изменения пользователя
    await user.save();

    // 4. Создаем уведомление с правильными полями (title и message)
    try {
        const Notification = require('../models/Notification');
        await Notification.create({ 
            userId: user._id, 
            title: "Винагорода зібрана", // Заголовок (обязательно)
            message: `Ви успішно зібрали реферальну винагороду в розмірі ${Math.floor(amountToClaim)} SATS` // Сообщение (обязательно)
        });
    } catch (notificationError) {
        // Если уведомление не создалось, не прерываем основной процесс сбора денег
        console.error('Notification creation failed:', notificationError.message);
    }

    res.json({
      success: true,
      message: "Награды успешно собраны!",
      claimedAmount: amountToClaim,
      newBalance: user.balance.sats
    });

  } catch (error) {
    console.error('Claim rewards error:', error);
    res.status(500).json({ success: false, message: "Ошибка при сборе средств." });
  }
};