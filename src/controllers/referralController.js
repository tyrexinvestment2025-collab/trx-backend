const User = require('../models/User');
const UserCard = require('../models/UserCard');
const ReferralReward = require('../models/ReferralReward');
const mongoose = require('mongoose');

// --- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ГЕНЕРАЦИИ ДАННЫХ (ТОЛЬКО ДЛЯ ТЕСТОВ) ---
const autoSeedHistory = async (uplineId, partnerId) => {
    const count = await ReferralReward.countDocuments({ uplineUserId: uplineId, partnerUserId: partnerId });
    if (count > 0) return; // Если данные уже есть, ничего не делаем

    console.log(`[AutoSeed] Generating history for partner ${partnerId}...`);
    const rewards = [];
    const now = new Date();

    for (let i = 0; i < 14; i++) {
        const date = new Date();
        date.setDate(now.getDate() - i);
        rewards.push({
            uplineUserId: uplineId,
            partnerUserId: partnerId,
            amountSats: Math.floor(Math.random() * 2500) + 500,
            date: date.toISOString().split('T')[0]
        });
    }
    await ReferralReward.insertMany(rewards);
};

exports.getReferralInfo = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const hasCards = await UserCard.exists({ userId: user._id });
        
        if (!hasCards) return res.json({ isLocked: true });

        const botName = process.env.TELEGRAM_BOT_NAME || 'tyrexcurrency_bot'; 
        const appName = process.env.TELEGRAM_APP_NAME || 'ereeefewefwefwef'; 
        const referralLink = `https://t.me/${botName}/${appName}?startapp=${user.referralCode}`;

        const myReferrals = await User.find({ uplineUserId: user._id });
        const referralIds = myReferrals.map(u => u._id);

        const activeCards = await UserCard.find({ userId: { $in: referralIds }, status: 'Active' });
        const totalPartnerCapital = activeCards.reduce((sum, card) => sum + parseFloat(card.purchasePriceUsd.toString() || 0), 0);
        const totalIdleCapital = myReferrals.reduce((sum, u) => sum + parseFloat(u.balance.walletUsd.toString() || 0), 0);
        const investorsCount = await UserCard.distinct('userId', { userId: { $in: referralIds } });

        res.json({
            isLocked: false,
            referralLink,
            totalEarnedSats: user.balance.referralSats || 0,
            apr: 15.5,
            stats: {
                totalInvited: myReferrals.length,
                nonInvestorsCount: myReferrals.length - investorsCount.length,
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

        // 1. АВТО-ЗАПОЛНЕНИЕ: Если ты админ или тестер, создаем данные для каждого партнера
        // В продакшене эту часть можно будет удалить
        for (const ref of referrals) {
            await autoSeedHistory(req.user._id, ref._id);
        }

        const [allCards, allRewards] = await Promise.all([
            UserCard.find({ userId: { $in: refIds } }),
            ReferralReward.find({ uplineUserId: req.user._id, partnerUserId: { $in: refIds } }).lean()
        ]);

        const list = referrals.map(r => {
            const userCards = allCards.filter(c => c.userId.toString() === r._id.toString());
            const userRewards = allRewards.filter(rew => rew.partnerUserId.toString() === r._id.toString());
            
            const totalEarnedFromHim = userRewards.reduce((sum, rew) => sum + rew.amountSats, 0);

            // Группировка для "Биржевого" графика
            const chartData = userRewards.reduce((acc, rew) => {
                const existing = acc.find(a => a.date === rew.date);
                if (existing) existing.val += rew.amountSats;
                else acc.push({ date: rew.date, val: rew.amountSats });
                return acc;
            }, []);

            return {
                id: r._id,
                username: r.username || 'Anonymous',
                registeredAt: r.createdAt,
                isActive: userCards.some(c => c.status === 'Active'),
                idleBalance: parseFloat(r.balance.walletUsd.toString() || 0).toFixed(2),
                totalInvestment: userCards.reduce((sum, c) => sum + parseFloat(c.purchasePriceUsd.toString()), 0).toFixed(2),
                myProfitFromHimBTC: (totalEarnedFromHim / 100000000).toFixed(8),
                chartData: chartData.sort((a,b) => a.date.localeCompare(b.date)).slice(-14)
            };
        });

        res.json(list);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error' });
    }
};

exports.claimRewards = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const amountToClaim = user.balance.referralSats || 0;

        if (amountToClaim <= 0) {
            return res.status(400).json({ success: false, message: "У вас нет накопленных наград." });
        }

        user.balance.walletSats = (user.balance.walletSats || 0) + amountToClaim;
        user.balance.referralSats = 0;
        await user.save();

        res.json({ success: true, claimedAmount: amountToClaim });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};