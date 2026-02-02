const User = require('../models/User');
const UserCard = require('../models/UserCard');

/**
 * @desc    Получить основную информацию для страницы "Партнерка"
 * @route   GET /api/v1/referrals/info
 * @access  Private
 */
exports.getReferralInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

    // Используем имя бота из переменных окружения или заглушку
    const botUsername = process.env.TELEGRAM_BOT_USERNAME; 
    // Строим реферальную ссылку
    const referralLink = `https://t.me/${botUsername}?startapp&start=${user.referralCode}`;

    const totalEarnedSats = user.balance.referralSats.toString();

    // Получаем ID всех приглашенных пользователей
    const invitedUsers = await User.find({ uplineUserId: req.user._id }).select('_id');
    const invitedUserIds = invitedUsers.map(u => u._id);

    // Считаем, сколько из них имеют хотя бы одну активную карту (distinct userId)
    const activeReferralsCount = await UserCard.distinct('userId', {
      userId: { $in: invitedUserIds },
      status: 'Active'
    });


    res.status(200).json({
      referralLink,
      totalEarnedSats,
      stats: {
        totalInvited: invitedUserIds.length,
        activeReferralsCount: activeReferralsCount.length
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

/**
 * @desc    Получить список всех приглашенных рефералов
 * @route   GET /api/v1/referrals/list
 * @access  Private
 */
exports.getReferralList = async (req, res) => {
  try {
    // Находим всех, кого пригласил текущий пользователь
    const referrals = await User.find({ uplineUserId: req.user._id })
        .select('username tgId createdAt');
    
    const referralIds = referrals.map(r => r._id);

    // Находим ID тех рефералов, у которых есть активные карты
    const activeReferralIds = await UserCard.find({
        userId: { $in: referralIds },
        status: 'Active'
    }).distinct('userId');

    // Преобразуем массив ID в Set для быстрого поиска
    const activeIdsSet = new Set(activeReferralIds.map(id => id.toString()));

    // Формируем финальный ответ
    const response = referrals.map(ref => ({
      username: ref.username,
      tgId: ref.tgId,
      registeredAt: ref.createdAt,
      status: activeIdsSet.has(ref._id.toString()) ? 'Active' : 'Inactive'
    }));
    
    res.status(200).json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};