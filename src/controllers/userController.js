const User = require('../models/User');
const UserCard = require('../models/UserCard');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const DepositRequest = require('../models/DepositRequest');
const Notification = require('../models/Notification');
const DailyEarning = require('../models/DailyProfit'); // Убедись, что модель импортирована
const { verifyTelegramWebAppData } = require('../utils/telegramAuth');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
const { updateUserStatus } = require('../utils/userStatusHelper');

// Импортируем экземпляр нашего нового PriceService
const priceService = require('../services/priceService'); 

/**
 * Утилита для парсинга Decimal/String в Number
 */
const parseDecimal = (value) => {
    if (!value) return 0;
    const num = parseFloat(value.toString());
    return isNaN(num) ? 0 : num;
};

/**
 * ПОЛУЧЕНИЕ ПРОФИЛЯ ПОЛЬЗОВАТЕЛЯ
 * Включает в себя актуальную цену BTC из WebSocket/REST гибрида
 */
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date().toISOString().split('T')[0];

    // Параллельное выполнение запросов к БД для оптимизации времени ответа
    const [user, cards, daily] = await Promise.all([
      User.findById(userId),
      UserCard.find({ userId }).populate('cardTypeId'),
      DailyEarning.findOne({ userId, date: today })
    ]);

    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    // Получаем цену через защищенный метод геттер
    const btcPrice = priceService.getBitcoinPrice(); 
    
    // Если цена === null, значит сервис еще не получил данные от Binance 
    // или данные старее допустимого порога (30 сек). Отвечаем 503.
    if (btcPrice === null) {
        return res.status(503).json({ 
            message: 'Market data is temporarily unavailable. Please try again.',
            retryAfter: 5 
        });
    }

    const earnedTodaySats = (daily?.miningSats || 0) + (daily?.referralSats || 0);

    res.json({
      ...user.toObject(),
      cards,
      btcPrice, // Гарантированно актуальная цена
      earnedTodaySats
    });
  } catch (error) {
    console.error(`[UserProfile Error]: ${error.message}`);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * ЗАПРОС НА ДЕПОЗИТ
 */
exports.requestDeposit = async (req, res) => {
    try {
        const { amountUsd, txHash } = req.body;
        
        if (!amountUsd || !txHash) {
            return res.status(400).json({ message: 'Missing required fields: amountUsd or txHash' });
        }

        await DepositRequest.create({
            userId: req.user._id,
            amountUsd: amountUsd.toString(),
            txHash,
            status: 'PENDING'
        });

        res.status(201).json({ message: 'Deposit request submitted successfully' });
    } catch (error) {
        console.error(`[Deposit Error]: ${error.message}`);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * ЗАПРОС НА ВЫВОД СРЕДСТВ
 */
exports.requestWithdrawal = async (req, res) => {
    try {
        const { amountUsd, walletAddress } = req.body;
        const userId = req.user._id;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const userWalletUsd = parseDecimal(user.balance.walletUsd);
        const amountToWithdraw = parseFloat(amountUsd);

        if (isNaN(amountToWithdraw) || amountToWithdraw <= 0) {
            return res.status(400).json({ message: 'Invalid withdrawal amount' });
        }

        if (userWalletUsd < amountToWithdraw) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        // Атомарное обновление баланса пользователя
        user.balance.walletUsd = (userWalletUsd - amountToWithdraw).toFixed(2);
        const currentPending = parseDecimal(user.balance.pendingWithdrawalUsd);
        user.balance.pendingWithdrawalUsd = (currentPending + amountToWithdraw).toFixed(2);

        await Promise.all([
            user.save(),
            WithdrawalRequest.create({
                userId: user._id,
                amountUsd: amountToWithdraw.toString(),
                walletAddress,
                status: 'PENDING'
            })
        ]);

        res.status(201).json({ message: 'Withdrawal request created' });
    } catch (error) {
        console.error(`[Withdrawal Error]: ${error.message}`);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * ИСТОРИЯ ТРАНЗАКЦИЙ
 */
exports.getTransactionHistory = async (req, res) => {
    try {
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

        // Сортировка: сначала новые
        history.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(history);
    } catch (error) {
        console.error(`[History Error]: ${error.message}`);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * УВЕДОМЛЕНИЯ
 */
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

exports.markNotificationsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.user._id, isRead: false }, 
            { isRead: true }
        );
        res.json({ message: 'Success' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notifications' });
    }
};