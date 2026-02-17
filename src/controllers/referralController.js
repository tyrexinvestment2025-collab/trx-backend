const User = require('../models/User');
const UserCard = require('../models/UserCard');

exports.getReferralInfo = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    const hasCards = await UserCard.exists({ userId: user._id });

    if (!hasCards) {
        return res.json({ 
            isLocked: true,
            message: "Purchase a miner to unlock your invite link." 
        });
    }

    const botName = process.env.TELEGRAM_BOT_NAME || 'tyrexcurrency_bot'; 
    const appName = process.env.TELEGRAM_APP_NAME || 'ereeefewefwefwef'; // <-- Вот твое короткое имя
    const referralLink = `https://t.me/${botName}/${appName}?startapp=${user.referralCode}`;

    const myReferrals = await User.find({ uplineUserId: user._id }).select('_id');
    const referralIds = myReferrals.map(u => u._id);

    const activeMinersCount = await UserCard.distinct('userId', {
      userId: { $in: referralIds },
      status: 'Active'
    });

    const allRefCards = await UserCard.find({
        userId: { $in: referralIds },
        status: 'Active'
    }).populate('cardTypeId');

    let dailyPassiveSats = 0;

    for (const card of allRefCards) {
        if (card.cardTypeId) {
            const nominal = parseFloat(card.nominalSats.toString());
            const refApy = card.cardTypeId.referralAPY || 0;
            
            const income = (nominal * (refApy / 100)) / 365;
            dailyPassiveSats += income;
        }
    }

    const monthlyPassiveSats = dailyPassiveSats * 30;

    res.json({
        isLocked: false,
        referralLink,
        totalEarnedSats: user.balance.referralSats || 0,
        stats: {
            totalInvited: referralIds.length,
            activeMiners: activeMinersCount.length,
            estMonthlyIncomeBtc: monthlyPassiveSats / 100000000 
        }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error' });
  }
};

exports.getReferralList = async (req, res) => {
    try {
        const referrals = await User.find({ uplineUserId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(50)
            .select('username createdAt');

        const refIds = referrals.map(r => r._id);
        const activeIds = await UserCard.distinct('userId', { userId: { $in: refIds }, status: 'Active' });
        const activeSet = new Set(activeIds.map(id => id.toString()));

        const list = referrals.map(r => ({
            id: r._id,
            username: r.username || 'Anonymous',
            registeredAt: r.createdAt,
            isActive: activeSet.has(r._id.toString())
        }));

        res.json(list);
    } catch (e) {
        res.status(500).json({ message: 'Error' });
    }
};