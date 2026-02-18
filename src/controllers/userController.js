const User = require('../models/User');
const UserCard = require('../models/UserCard'); // <--- ВАЖНО: Импорт модели карт
const WithdrawalRequest = require('../models/WithdrawalRequest');
const DepositRequest = require('../models/DepositRequest');
const jwt = require('jsonwebtoken');
const { verifyTelegramWebAppData } = require('../utils/telegramAuth');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
const { updateUserStatus } = require('../utils/userStatusHelper');
const { getBitcoinPrice } = require('../services/priceService'); 

const parseDecimal = (value) => {
    if (!value) return 0;
    const str = value.toString();
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
};
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    await updateUserStatus(userId);
    const updatedUser = await User.findById(userId);
    
    const cards = await UserCard.find({ userId: userId }).populate('cardTypeId');
    const btcPrice = getBitcoinPrice(); 

    // --- НОВОЕ: ПОЛУЧЕНИЕ ТРАНЗАКЦИЙ ---
    // Берем последние 5 депозитов и 5 выводов
    const deposits = await DepositRequest.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();
    const withdrawals = await WithdrawalRequest.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();

    // Приводим к единому формату
    const formattedDeposits = deposits.map(d => ({
        ...d,
        type: 'DEPOSIT',
        amount: parseFloat(d.amountUsd.toString()) // Используем amountUsd
    }));

    const formattedWithdrawals = withdrawals.map(w => ({
        ...w,
        type: 'WITHDRAWAL',
        amount: parseFloat(w.amountUsd.toString()) // Используем amountUsd
    }));

    // Объединяем и сортируем по дате (самые новые сверху)
    const allTransactions = [...formattedDeposits, ...formattedWithdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10); // Оставляем топ-10
    // ------------------------------------

    res.json({
      ...JSON.parse(JSON.stringify(updatedUser)),
      cards: JSON.parse(JSON.stringify(cards)),
      transactions: allTransactions, // Отправляем на фронт
      btcPrice: btcPrice 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.requestDeposit = async (req, res) => {
    try {
        const { amountUsd, txHash } = req.body;
        if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

        if (!amountUsd || !txHash) return res.status(400).json({ message: 'Invalid data' });

        await DepositRequest.create({
            userId: req.user._id,
            amountUsd: amountUsd.toString(),
            txHash,
            status: 'PENDING'
        });
        res.status(201).json({ message: 'Deposit requested' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// --- ВЫВОД ---
exports.requestWithdrawal = async (req, res) => {
    try {
        const { amountUsd, walletAddress } = req.body;
        if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

        const user = await User.findById(req.user._id);
        const userWalletUsd = parseDecimal(user.balance.walletUsd);
        const amountToWithdraw = parseFloat(amountUsd);

        if (isNaN(amountToWithdraw) || amountToWithdraw <= 0) return res.status(400).json({ message: 'Invalid amount' });
        if (userWalletUsd < amountToWithdraw) return res.status(400).json({ message: 'Insufficient balance' });

        await WithdrawalRequest.create({
            userId: user._id,
            amountUsd: amountToWithdraw.toString(),
            walletAddress,
            status: 'PENDING'
        });

        user.balance.walletUsd = (userWalletUsd - amountToWithdraw).toString();
        const currentPending = parseDecimal(user.balance.pendingWithdrawalUsd);
        user.balance.pendingWithdrawalUsd = (currentPending + amountToWithdraw).toString();

        await user.save();
        res.status(201).json({ message: 'Withdrawal requested' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// --- ИСТОРИЯ ---
exports.getTransactionHistory = async (req, res) => {
    try {
        // ЗАЩИТА: проверяем, что юзер авторизован
        if (!req.user || !req.user._id) {
            return res.status(401).json({ message: 'Access denied. No user in request.' });
        }

        const userId = req.user._id;

        const [deposits, withdrawals] = await Promise.all([
            DepositRequest.find({ userId }).lean(),
            WithdrawalRequest.find({ userId }).lean()
        ]);

        const history = [
            ...deposits.map(d => ({
                id: d._id,
                type: 'DEPOSIT',
                amount: parseDecimal(d.amountUsd),
                status: d.status,
                date: d.createdAt,
                meta: d.txHash
            })),
            ...withdrawals.map(w => ({
                id: w._id,
                type: 'WITHDRAWAL',
                amount: parseDecimal(w.amountUsd),
                status: w.status,
                date: w.createdAt,
                meta: w.walletAddress
            }))
        ];

        history.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(history);
    } catch (error) {
        console.error('History Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

const Notification = require('../models/Notification');

// Получить уведомления пользователя
exports.getNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(20);
        res.json(notifications);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching notifications' });
    }
};

// Отметить все как прочитанные
exports.markNotificationsRead = async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
        res.json({ message: 'Marked as read' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notifications' });
    }
};