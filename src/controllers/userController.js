const axios = require('axios');
const User = require('../models/User');
const UserCard = require('../models/UserCard');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const DepositRequest = require('../models/DepositRequest');
const Notification = require('../models/Notification');
const DailyEarning = require('../models/DailyProfit');
const IncomeEvent = require('../models/IncomeEvent');
const priceService = require('../services/priceService2');
const { toNum, round2, dec } = require('../utils/money');

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1001968067961';
const MIN_WITHDRAWAL_USD = Number(process.env.MIN_WITHDRAWAL_USD) || 10;
const MAX_DEPOSIT_USD = Number(process.env.MAX_DEPOSIT_USD) || 1_000_000;
// Адрес для депозитов (пока заглушка — заменить в .env перед запуском)
const DEPOSIT_BTC_ADDRESS = process.env.DEPOSIT_BTC_ADDRESS || 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

const TRC20_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BTC_TXID_RE = /^[a-fA-F0-9]{64}$/;

/**
 * Проверка подписки на канал через Bot API.
 * @returns {Promise<boolean|null>} true/false, либо null если проверить не удалось
 */
const isChannelMember = async (tgId) => {
    try {
        const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMember`;
        const { data } = await axios.get(url, { params: { chat_id: CHANNEL_ID, user_id: tgId }, timeout: 5000 });
        return ['member', 'administrator', 'creator'].includes(data?.result?.status);
    } catch (error) {
        // 400 "user not found" = точно не участник; другие 400 (chat not found, нет прав) — проверить не можем
        const desc = String(error.response?.data?.description || '').toLowerCase();
        if (error.response?.status === 400 && (desc.includes('user not found') || desc.includes('participant_id_invalid'))) return false;
        console.error('Subscription check error:', error.response?.data || error.message);
        return null;
    }
};
exports.isChannelMember = isChannelMember;

/**
 * ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
 */
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date().toISOString().split('T')[0];

    const [user, cards, daily] = await Promise.all([
      User.findById(userId),
      UserCard.find({ userId }).populate('cardTypeId'),
      DailyEarning.findOne({ userId, date: today })
    ]);

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Профиль отдаём всегда; если цены нет — btcPrice: null, фронт покажет «синхронизация»
    const btcPrice = priceService.getBitcoinPrice();
    const earnedTodaySats = (daily?.miningSats || 0) + (daily?.referralSats || 0);

    res.json({
      ...user.toObject(),
      cards,
      btcPrice,
      earnedTodaySats,
      config: {
        depositBtcAddress: DEPOSIT_BTC_ADDRESS,
        minWithdrawalUsd: MIN_WITHDRAWAL_USD
      }
    });
  } catch (error) {
    console.error(`[UserProfile Error]: ${error.message}`);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

/**
 * ЗАПРОС НА ДЕПОЗИТ
 * Адрес общий, поэтому зачисление подтверждает админ вручную после проверки транзакции.
 * Здесь — валидация формата и защита от повторной подачи одного хэша.
 */
exports.requestDeposit = async (req, res) => {
    try {
        const amount = round2(Number(req.body.amountUsd));
        const txHash = String(req.body.txHash || '').trim().toLowerCase();

        if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_DEPOSIT_USD) {
            return res.status(400).json({ message: 'Invalid amount', code: 'INVALID_AMOUNT' });
        }
        if (!BTC_TXID_RE.test(txHash)) {
            return res.status(400).json({ message: 'Invalid transaction hash', code: 'INVALID_TX_HASH' });
        }

        const duplicate = await DepositRequest.exists({ txHash, status: { $ne: 'REJECTED' } });
        if (duplicate) return res.status(409).json({ message: 'This transaction was already submitted', code: 'DUPLICATE_TX' });

        await DepositRequest.create({ userId: req.user._id, amountUsd: amount.toFixed(2), txHash, status: 'PENDING' });

        res.status(201).json({ message: 'Deposit request submitted successfully' });
    } catch (error) {
        console.error(`[Deposit Error]: ${error.message}`);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * ЗАПРОС НА ВЫВОД СРЕДСТВ
 * Списание атомарное и условное: параллельные запросы не уведут баланс в минус.
 */
exports.requestWithdrawal = async (req, res) => {
    try {
        const amount = round2(Number(req.body.amountUsd));
        const walletAddress = String(req.body.walletAddress || '').trim();

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: 'Invalid withdrawal amount', code: 'INVALID_AMOUNT' });
        }
        if (amount < MIN_WITHDRAWAL_USD) {
            return res.status(400).json({ message: `Minimum withdrawal is $${MIN_WITHDRAWAL_USD}`, code: 'BELOW_MINIMUM', min: MIN_WITHDRAWAL_USD });
        }
        if (!TRC20_RE.test(walletAddress)) {
            return res.status(400).json({ message: 'Invalid TRC20 address', code: 'INVALID_ADDRESS' });
        }

        const user = await User.findOneAndUpdate(
            { _id: req.user._id, 'balance.walletUsd': { $gte: dec(amount) } },
            { $inc: { 'balance.walletUsd': dec(-amount), 'balance.pendingWithdrawalUsd': dec(amount) } },
            { new: true }
        );
        if (!user) return res.status(400).json({ message: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });

        try {
            await WithdrawalRequest.create({ userId: user._id, amountUsd: amount.toFixed(2), walletAddress, status: 'PENDING' });
        } catch (e) {
            // Компенсация, если заявка не создалась
            await User.updateOne({ _id: user._id }, { $inc: { 'balance.walletUsd': dec(amount), 'balance.pendingWithdrawalUsd': dec(-amount) } });
            throw e;
        }

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

        const [deposits, withdrawals, incomes] = await Promise.all([
            DepositRequest.find({ userId }).lean(),
            WithdrawalRequest.find({ userId }).lean(),
            IncomeEvent.find({ userId }).sort({ createdAt: -1 }).limit(200).lean()
        ]);

        const history = [
            ...deposits.map(d => ({
                id: d._id,
                type: 'DEPOSIT',
                amount: toNum(d.amountUsd),
                status: d.status,
                date: d.createdAt,
                meta: d.txHash,
                adminComment: d.adminComment || null
            })),
            ...withdrawals.map(w => ({
                id: w._id,
                type: 'WITHDRAWAL',
                amount: toNum(w.amountUsd),
                status: w.status,
                date: w.createdAt,
                meta: w.walletAddress,
                adminComment: w.adminComment || null
            })),
            ...incomes.map(i => ({
                id: i._id,
                type: 'INCOME',
                subtype: i.type,
                amount: toNum(i.amountUsd),
                status: 'CONFIRMED',
                date: i.createdAt,
                meta: null,
                details: i.meta || {}
            }))
        ];

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
        await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
        res.json({ message: 'Success' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notifications' });
    }
};

exports.checkSubscription = async (req, res) => {
    const member = await isChannelMember(req.user.tgId);
    if (member === null) return res.status(503).json({ success: false, code: 'SUBSCRIPTION_CHECK_FAILED' });
    return res.json({ success: member, code: member ? 'SUBSCRIBED' : 'NOT_SUBSCRIBED' });
};
