const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const UserCard = require('../models/UserCard');
const CardType = require('../models/CardType');
const { updateUserStatus } = require('../utils/userStatusHelper');
const Notification = require('../models/Notification'); // ИМПОРТ НОВОЙ МОДЕЛИ
const ExchangeOrder = require('../models/ExchangeOrder');
const ExcelJS = require('exceljs');
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


// Подтвердить пополнение + отправить уведомление
exports.confirmDeposit = async (req, res) => {
  try {
    const deposit = await DepositRequest.findById(req.params.id);
    if (!deposit || deposit.status !== 'PENDING') return res.status(400).json({ message: 'Request is not pending' });

    const user = await User.findById(deposit.userId);
    if (!user) {
        deposit.status = 'REJECTED';
        await deposit.save();
        return res.status(404).json({ message: 'User not found' });
    }

    const depositAmount = parseDecimal(deposit.amountUsd);
    user.balance.walletUsd = parseDecimal(user.balance.walletUsd) + depositAmount;
    await user.save();

    deposit.status = 'CONFIRMED';
    await deposit.save();

    // СОЗДАЕМ УВЕДОМЛЕНИЕ
    await Notification.create({
        userId: user._id,
        title: 'Deposit Confirmed',
        message: `Your account has been successfully topped up by $${depositAmount.toFixed(2)}.`,
        type: 'DEPOSIT'
    });

    await updateUserStatus(user._id);
    res.json({ message: 'Deposit confirmed and notification sent' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.processWithdrawal = async (req, res) => {
  try {
    const withdrawal = await WithdrawalRequest.findById(req.params.id);
    if (!withdrawal || withdrawal.status !== 'PENDING') return res.status(400).json({ message: 'Request is not pending' });

    const user = await User.findById(withdrawal.userId);
    if (user) {
      const withdrawalAmount = parseDecimal(withdrawal.amountUsd);
      let newPending = parseDecimal(user.balance.pendingWithdrawalUsd) - withdrawalAmount;
      user.balance.pendingWithdrawalUsd = newPending < 0 ? 0 : newPending;
      await user.save();

      // СОЗДАЕМ УВЕДОМЛЕНИЕ
      await Notification.create({
          userId: user._id,
          title: 'Withdrawal Processed',
          message: `Your withdrawal of $${withdrawalAmount.toFixed(2)} has been processed.`,
          type: 'WITHDRAWAL'
      });
    }

    withdrawal.status = 'PROCESSED';
    withdrawal.processedDate = Date.now();
    await withdrawal.save();

    res.json({ message: 'Withdrawal processed and notification sent' });
  } catch (error) {
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

exports.rejectWithdrawal = async (req, res) => {
    try {
        const { id } = req.params;
        const { adminComment } = req.body;

        const withdrawal = await WithdrawalRequest.findById(id);
        if (!withdrawal || withdrawal.status !== 'PENDING') return res.status(400).json({ message: 'Request not pending' });

        const user = await User.findById(withdrawal.userId);
        if (user) {
            const amount = parseDecimal(withdrawal.amountUsd);
            
            // Возвращаем деньги из Pending в Wallet
            user.balance.walletUsd = parseDecimal(user.balance.walletUsd) + amount;
            let newPending = parseDecimal(user.balance.pendingWithdrawalUsd) - amount;
            user.balance.pendingWithdrawalUsd = newPending < 0 ? 0 : newPending;
            
            await user.save();

            // Уведомляем пользователя
            await Notification.create({
                userId: user._id,
                title: 'Withdrawal Failed',
                message: `Your withdrawal request was rejected. Reason: ${adminComment || 'Security check failed'}. Funds have been returned to your balance.`,
                type: 'WITHDRAWAL'
            });
        }

        withdrawal.status = 'REJECTED';
        withdrawal.adminComment = adminComment || 'Rejected by admin';
        await withdrawal.save();

        res.json({ message: 'Withdrawal rejected and funds returned' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};
// ОТКЛОНИТЬ ПОПОЛНЕНИЕ
exports.rejectDeposit = async (req, res) => {
    try {
        const { id } = req.params;
        const { adminComment } = req.body; // Причина отказа

        const deposit = await DepositRequest.findById(id);
        if (!deposit || deposit.status !== 'PENDING') return res.status(400).json({ message: 'Request not pending' });

        deposit.status = 'REJECTED';
        deposit.adminComment = adminComment || 'Transaction not found or invalid';
        await deposit.save();

        // Уведомляем пользователя
        await Notification.create({
            userId: deposit.userId,
            title: 'Deposit Rejected',
            message: `Your deposit request for $${parseDecimal(deposit.amountUsd).toFixed(2)} was rejected. Reason: ${deposit.adminComment}`,
            type: 'DEPOSIT' // Тип оставим DEPOSIT, но в сообщении будет отказ
        });

        res.json({ message: 'Deposit rejected' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.getExchangeHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const orders = await ExchangeOrder.find()
            .populate('userId', 'username tgId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await ExchangeOrder.countDocuments();

        res.json({
            orders,
            pagination: { total, page, pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching exchange history' });
    }
};

// 2. ЭКСПОРТ В EXCEL
exports.exportExchangeToExcel = async (req, res) => {
    try {
        const orders = await ExchangeOrder.find()
            .populate('userId', 'username tgId')
            .sort({ createdAt: -1 });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Binance Transactions');

        // Шапка таблицы
        worksheet.columns = [
            { header: 'Date', key: 'date', width: 20 },
            { header: 'User', key: 'user', width: 20 },
            { header: 'Telegram ID', key: 'tgId', width: 15 },
            { header: 'Type', key: 'type', width: 10 },
            { header: 'BTC Amount', key: 'btc', width: 15 },
            { header: 'App USD Charged', key: 'appUsd', width: 15 },
            { header: 'Binance USDT Spent', key: 'binanceUsdt', width: 15 },
            { header: 'Rate (Executed)', key: 'rate', width: 15 },
            { header: 'Profit Delta ($)', key: 'profit', width: 15 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Binance ID', key: 'orderId', width: 25 }
        ];

        // Заполнение данными
        orders.forEach(o => {
            worksheet.addRow({
                date: o.createdAt.toLocaleString(),
                user: o.userId?.username || 'N/A',
                tgId: o.userId?.tgId || 'N/A',
                type: o.type,
                btc: o.btcAmount.toFixed(8),
                appUsd: o.appUsdAmount.toFixed(2),
                binanceUsdt: o.binanceUsdtAmount?.toFixed(2) || 0,
                rate: o.executedPrice || 0,
                profit: o.profitDelta?.toFixed(4) || 0,
                status: o.status,
                orderId: o.binanceOrderId || 'N/A'
            });
        });

        // Стилизация шапки
        worksheet.getRow(1).font = { bold: true };

        // Отправка файла
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Binance_Hedge_Report.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Excel Export Error:', error);
        res.status(500).send('Error generating report');
    }
};