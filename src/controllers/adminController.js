const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const UserCard = require('../models/UserCard');
const CardType = require('../models/CardType');
const { updateUserStatus } = require('../utils/userStatusHelper');
const Notification = require('../models/Notification'); // ИМПОРТ НОВОЙ МОДЕЛИ
const ExchangeOrder = require('../models/ExchangeOrder');
const ExcelJS = require('exceljs');
const { toNum, round2, dec, isObjectId } = require('../utils/money');
const parseDecimal = toNum;
const requestService = require('../services/requestService');
const actorOf = (req) => ({ userId: req.user?._id, tgId: req.user?.tgId, username: req.user?.username, source: 'admin_panel' });
const sendResult = (res, r, okMessage) => {
  if (r.ok) return res.json({ message: okMessage });
  if (r.code === 'INVALID_ID') return res.status(400).json({ message: 'Invalid id' });
  if (r.code === 'NOT_FOUND') return res.status(404).json({ message: 'Not found' });
  return res.status(400).json({ message: 'Request is not pending' });
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
// Статус меняется атомарно: повторный клик / параллельный запрос не зачислит деньги дважды
exports.confirmDeposit = async (req, res) => {
  try {
    sendResult(res, await requestService.confirmDeposit(req.params.id, actorOf(req)), 'Deposit confirmed and notification sent');
  } catch (error) {
    console.error('confirmDeposit error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.processWithdrawal = async (req, res) => {
  try {
    sendResult(res, await requestService.markWithdrawalPaid(req.params.id, req.body?.txHash, actorOf(req)), 'Withdrawal processed and notification sent');
  } catch (error) {
    console.error('processWithdrawal error:', error);
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
    const one = async (sql) => (await User.query(sql)).rows[0];

    const [totalUsers, depositData, withdrawalData, balances, activeCardsCount, pendingDeposits, pendingWithdrawals] = await Promise.all([
      User.countDocuments(),
      one(`SELECT COALESCE(SUM(amount_usd), 0) AS total FROM deposit_requests WHERE status = 'CONFIRMED'`),
      one(`SELECT COALESCE(SUM(amount_usd), 0) AS total FROM withdrawal_requests WHERE status = 'PROCESSED'`),
      one(`SELECT COALESCE(SUM(balance_staking_usd), 0) AS staked, COALESCE(SUM(balance_wallet_usd), 0) AS wallet,
                  COALESCE(SUM(balance_pending_withdrawal_usd), 0) AS pending FROM users`),
      UserCard.countDocuments({ status: 'Active' }),
      DepositRequest.countDocuments({ status: 'PENDING' }),
      WithdrawalRequest.countDocuments({ status: 'PENDING' })
    ]);

    const b = { staked: toNum(balances.staked), wallet: toNum(balances.wallet), pending: toNum(balances.pending) };
    res.status(200).json({
      totalUsers,
      totalDepositedUsd: round2(toNum(depositData.total)),
      totalWithdrawnUsd: round2(toNum(withdrawalData.total)),
      totalStakedUsd: round2(b.staked),
      totalWalletUsd: round2(b.wallet),
      totalPendingUsd: round2(b.pending),
      totalLiabilityUsd: round2(b.staked + b.wallet + b.pending),
      activeCardsCount,
      pendingDeposits,
      pendingWithdrawals
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
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);
    const search = req.query.search;

    const query = {};

    if (search) {
      const searchConditions = [
        { username: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
      ];
      if (/^\d+$/.test(search)) {
        searchConditions.push({ tgId: parseInt(search) });
      }
      query.$or = searchConditions;
    }

    const skip = (page - 1) * limit;

    const users = await User.find(query)
      .select('_id username tgId role balance createdAt isBanned accountStatus')
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
    if (!isObjectId(userId)) return res.status(400).json({ message: 'Invalid id' });

    const [user, cards, deposits, withdrawals, referralsCount] = await Promise.all([
      User.findById(userId),
      UserCard.find({ userId }).populate('cardTypeId'),
      DepositRequest.find({ userId }).sort({ createdAt: -1 }).limit(25),
      WithdrawalRequest.find({ userId }).sort({ createdAt: -1 }).limit(25),
      User.countDocuments({ uplineUserId: userId })
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
    const r = await requestService.toggleBan(req.params.userId, actorOf(req));
    if (!r.ok) return res.status(r.code === 'INVALID_ID' ? 400 : 404).json({ message: 'User not found' });
    res.status(200).json({
      message: `Пользователь ${r.user.isBanned ? 'забанен' : 'разбанен'}.`,
      isBanned: r.user.isBanned
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
/**
 * @desc    Все серии карт, включая неактивные (витрина /cards/types отдаёт только активные)
 * @route   GET /api/v1/admin/card-types
 */
exports.getAllCardTypes = async (req, res) => {
    try {
        const types = await CardType.find().sort({ nominalSats: 1 }).lean();
        res.json(types.map(t => ({ ...t, id: t._id, nominalSats: toNum(t.nominalSats) })));
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.updateCardType = async (req, res) => {
    try {
        const { typeId } = req.params;
        const { nominalSats, clientAPY, available, isActive } = req.body;

        if (!isObjectId(typeId)) return res.status(400).json({ message: 'Invalid id' });

        const updateData = {};
        const num = (v) => Number(v);
        if (nominalSats !== undefined) {
            if (!(num(nominalSats) > 0)) return res.status(400).json({ message: 'nominalSats must be > 0' });
            updateData.nominalSats = String(Math.round(num(nominalSats)));
        }
        if (clientAPY !== undefined) {
            if (!(num(clientAPY) >= 0 && num(clientAPY) <= 100)) return res.status(400).json({ message: 'clientAPY must be 0..100' });
            updateData.clientAPY = num(clientAPY);
        }
        if (available !== undefined) {
            if (!Number.isInteger(num(available)) || num(available) < 0) return res.status(400).json({ message: 'available must be integer >= 0' });
            updateData.available = num(available);
        }
        if (isActive !== undefined) updateData.isActive = Boolean(isActive);
        
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
        sendResult(res, await requestService.rejectWithdrawal(req.params.id, req.body?.adminComment, actorOf(req)), 'Withdrawal rejected and funds returned');
    } catch (error) {
        console.error('rejectWithdrawal error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};
// ОТКЛОНИТЬ ПОПОЛНЕНИЕ
exports.rejectDeposit = async (req, res) => {
    try {
        sendResult(res, await requestService.rejectDeposit(req.params.id, req.body?.adminComment, actorOf(req)), 'Deposit rejected');
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