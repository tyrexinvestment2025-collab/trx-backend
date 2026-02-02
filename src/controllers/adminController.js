const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const UserCard = require('../models/UserCard');
const CardType = require('../models/CardType');
const { updateUserStatus } = require('../utils/userStatusHelper');

// Вспомогательная функция для безопасного парсинга
const parseDecimal = (value) => {
    if (value && value.toString) {
        return parseFloat(value.toString());
    }
    return 0;
};

// Получить заявки на пополнение
exports.getPendingDeposits = async (req, res) => {
  try {
    const deposits = await DepositRequest.find({ status: 'PENDING' })
      .populate('userId', 'username tgId')
      .sort({ createdAt: -1 });

    const formattedDeposits = deposits.map(d => {
        // ЗАЩИТА: Если пользователь был удален, подставляем заглушку
        if (!d.userId) {
            return {
                ...d.toObject(),
                amountUsd: parseDecimal(d.amountUsd),
                userId: { username: 'DELETED_USER', tgId: 'N/A' }
            };
        }
        // Если все в порядке, обрабатываем как обычно
        return {
            ...d.toObject(),
            amountUsd: parseDecimal(d.amountUsd)
        };
    });

    res.json(formattedDeposits);
  } catch (error) {
    console.error("Error in getPendingDeposits:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Подтвердить пополнение
exports.confirmDeposit = async (req, res) => {
  try {
    const deposit = await DepositRequest.findById(req.params.id);
    if (!deposit || deposit.status !== 'PENDING') return res.status(400).json({ message: 'Request is not pending or not found' });

    const user = await User.findById(deposit.userId);
    // ЗАЩИТА: Если юзер не найден, отклоняем заявку
    if (!user) {
        deposit.status = 'REJECTED';
        deposit.adminComment = 'User not found';
        await deposit.save();
        return res.status(404).json({ message: 'User not found, request rejected.' });
    }

    const userWallet = parseDecimal(user.balance.walletUsd);
    const depositAmount = parseDecimal(deposit.amountUsd);
    
    user.balance.walletUsd = userWallet + depositAmount;
    await user.save();

    deposit.status = 'CONFIRMED';
    await deposit.save();

    await updateUserStatus(user._id);
    res.json({ message: 'Deposit confirmed' });
  } catch (error) {
    console.error("Error in confirmDeposit:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};


// Получить заявки на вывод
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const withdrawals = await WithdrawalRequest.find({ status: 'PENDING' })
      .populate('userId', 'username tgId balance')
      .sort({ createdAt: 1 });

    const formattedWithdrawals = withdrawals.map(w => {
        // ЗАЩИТА: Если пользователь был удален, подставляем заглушку
        if (!w.userId) {
            return {
                ...w.toObject(),
                amountUsd: parseDecimal(w.amountUsd),
                userId: { username: 'DELETED_USER', tgId: 'N/A', balance: { walletUsd: 0 } }
            };
        }

        // Если все в порядке, обрабатываем как обычно
        return {
            ...w.toObject(),
            amountUsd: parseDecimal(w.amountUsd),
            userId: {
                ...w.userId.toObject(),
                balance: {
                    walletUsd: parseDecimal(w.userId.balance?.walletUsd) // Доп. защита с optional chaining
                }
            }
        };
    });

    res.json(formattedWithdrawals);
  } catch (error) {
    console.error("Error in getPendingWithdrawals:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Обработать вывод
exports.processWithdrawal = async (req, res) => {
  try {
    const withdrawal = await WithdrawalRequest.findById(req.params.id);
    if (!withdrawal || withdrawal.status !== 'PENDING') return res.status(400).json({ message: 'Request is not pending or not found' });

    const user = await User.findById(withdrawal.userId);
    // Если юзер есть, обновляем его баланс
    if (user) {
      const userPending = parseDecimal(user.balance.pendingWithdrawalUsd);
      const withdrawalAmount = parseDecimal(withdrawal.amountUsd);
      
      let newPending = userPending - withdrawalAmount;
      if (newPending < 0) newPending = 0;
      
      user.balance.pendingWithdrawalUsd = newPending;
      await user.save();
    }

    // Заявку закрываем в любом случае (даже если юзера нет)
    withdrawal.status = 'PROCESSED';
    withdrawal.processedDate = Date.now();
    await withdrawal.save();

    res.json({ message: 'Withdrawal processed' });
  } catch (error) {
    console.error("Error in processWithdrawal:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Статистика
exports.getDashboardStats = async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $group: {
          _id: null,
          totalStaked: { $sum: '$balance.stakingUsd' },
          totalPendingWithdrawal: { $sum: '$balance.pendingWithdrawalUsd' },
          totalWallet: { $sum: '$balance.walletUsd' },
          totalUsers: { $sum: 1 }
        }
      }
    ]);

    const data = stats[0] || { totalStaked: 0, totalPendingWithdrawal: 0, totalWallet: 0, totalUsers: 0 };

    res.json({
      obligations: {
        currentStaked: parseFloat(data.totalStaked.toString()),
        pendingPayouts: parseFloat(data.totalPendingWithdrawal.toString()),
        totalLiability: parseFloat(data.totalStaked.toString()) + parseFloat(data.totalPendingWithdrawal.toString()) + parseFloat(data.totalWallet.toString())
      },
      usersCount: data.totalUsers
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * @desc    Получить расширенную статистику и аналитику
 * @route   GET /api/v1/admin/stats
 * @access  Private (Admin)
 */
exports.getStats = async (req, res) => {
  try {
    // Выполняем все запросы параллельно для максимальной производительности
    const [
      totalUsers,
      depositData,
      withdrawalData,
      stakedData,
      activeCardsCount
    ] = await Promise.all([
      User.countDocuments(),
      // Суммируем только подтвержденные депозиты (если у вас есть такая логика)
      DepositRequest.aggregate([
        { $match: { status: 'CONFIRMED' } },
        { $group: { _id: null, total: { $sum: '$amountSats' } } }
      ]),
      // Суммируем только обработанные выводы
      WithdrawalRequest.aggregate([
        { $match: { status: 'PROCESSED' } },
        { $group: { _id: null, total: { $sum: '$amountSats' } } }
      ]),
      // Суммируем стейкинг по всем пользователям
      User.aggregate([
        { $group: { _id: null, total: { $sum: '$balance.stakingSats' } } }
      ]),
      UserCard.countDocuments({ status: 'Active' })
    ]);

    res.status(200).json({
      totalUsers,
      totalDepositedSats: depositData[0]?.total.toString() || '0',
      totalWithdrawnSats: withdrawalData[0]?.total.toString() || '0',
      totalStakedSats: stakedData[0]?.total.toString() || '0',
      activeCardsCount,
    });
  } catch (error) {
    console.error('Admin Stats Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * @desc    Получить список пользователей с пагинацией и поиском
 * @route   GET /api/v1/admin/users
 * @access  Private (Admin)
 */
exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search;

    const query = {};

    if (search) {
      const searchConditions = [
        { username: { $regex: search, $options: 'i' } }
      ];
      if (!isNaN(parseInt(search))) {
        searchConditions.push({ tgId: parseInt(search) });
      }
      query.$or = searchConditions;
    }

    const skip = (page - 1) * limit;

    const users = await User.find(query)
      .select('_id username tgId role balance.walletSats createdAt isBanned')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await User.countDocuments(query);

    res.status(200).json({
      data: JSON.parse(JSON.stringify(users)),
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get Users Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * @desc    Получить полный отчет по одному пользователю
 * @route   GET /api/v1/admin/users/:userId/full-report
 * @access  Private (Admin)
 */
exports.getUserFullReport = async (req, res) => {
  try {
    const { userId } = req.params;

    const [user, cards, deposits, withdrawals, referralsCount] = await Promise.all([
      User.findById(userId),
      UserCard.find({ userId }).populate('cardTypeId'),
      DepositRequest.find({ userId }).sort({ createdAt: -1 }).limit(25),
      WithdrawalRequest.find({ userId }).sort({ createdAt: -1 }).limit(25),
      User.countDocuments({ refereeId: user?.tgId }) // предполагая что refereeId хранит tgId
    ]);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const transactions = [...deposits, ...withdrawals].sort((a,b) => b.createdAt - a.createdAt);

    res.status(200).json(JSON.parse(JSON.stringify({
      profile: user,
      cards,
      transactions,
      referrals: { count: referralsCount }
    })));
  } catch (error) {
    console.error('Get User Full Report Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * @desc    Забанить/разбанить пользователя
 * @route   POST /api/v1/admin/users/:userId/ban
 * @access  Private (Admin)
 */
exports.banUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isBanned = !user.isBanned;
    await user.save();

    res.status(200).json({ 
      message: `Пользователь ${user.isBanned ? 'забанен' : 'разбанен'}.`,
      isBanned: user.isBanned
    });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

/**
 * @desc    Обновить тип карты в маркетплейсе
 * @route   PUT /api/v1/admin/card-types/:typeId
 * @access  Private (Admin)
 */
exports.updateCardType = async (req, res) => {
    try {
        const { typeId } = req.params;
        const { nominalSats, clientAPY, available, isActive } = req.body;

        const updateData = {};
        if (nominalSats !== undefined) updateData.nominalSats = nominalSats;
        if (clientAPY !== undefined) updateData.clientAPY = clientAPY;
        if (available !== undefined) updateData.available = available;
        if (isActive !== undefined) updateData.isActive = isActive;
        
        const updatedCardType = await CardType.findByIdAndUpdate(
            typeId, 
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedCardType) {
            return res.status(404).json({ message: 'Тип карты не найден' });
        }

        res.status(200).json(JSON.parse(JSON.stringify(updatedCardType)));
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};


