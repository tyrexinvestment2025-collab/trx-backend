const { refLink } = require('../bot/config');
const User = require('../models/User');
const UserCard = require('../models/UserCard');
const ReferralReward = require('../models/ReferralReward');
const CardType = require('../models/CardType');
const IncomeEvent = require('../models/IncomeEvent');
const priceService = require('../services/priceService2');
const { round2, dec } = require('../utils/money');

/**
 * Визначає статус партнера на основі його активності
 */
const getPartnerStatusInfo = (partner, partnerCards) => {
    const now = new Date();
    const hasPaidCard = partnerCards.some(c => !c.isTrial && (c.status === 'Active' || c.status === 'Cooling'));
    const trialCard = partnerCards.find(c => c.isTrial);
    const idleBalance = parseFloat(partner.balance.walletUsd?.toString() || 0);

    if (!partner.isTrialActivated) {
        return {
            status: 'NOT_ACTIVATED', label: 'НЕ АКТИВОВАНО', color: '#FF4141',
            description: 'Клієнт ще не активував вітальну монету. Допоможіть йому почати.', params: {}
        };
    }

    if (partner.isTrialActivated && !hasPaidCard && trialCard) {
        const daysSince = Math.floor((now - partner.trialActivatedAt) / (1000 * 60 * 60 * 24));
        const daysLeft = 7 - daysSince;
        if (daysLeft > 0) {
            return {
                status: 'WAITING', label: `ПЕРШИЙ ДОХІД ЧЕРЕЗ ${daysLeft}дн`, color: '#FFB700',
                description: `Клієнт тестує систему.`, params: { daysLeft }
            };
        }
    }

    if (partner.isTrialActivated && !hasPaidCard) {
        return {
            status: 'INVEST', label: 'ЧАС ІНВЕСТУВАТИ', color: '#FF7000',
            description: 'Тестовий період завершено. Час придбати першу реальну NFT.', params: {}
        };
    }

    const hasActivePaid = partnerCards.some(c => !c.isTrial && c.status === 'Active');
    if (idleBalance > 10 && !hasActivePaid) {
        return {
            status: 'GROW', label: 'ЧАС ЗРОСТАТИ', color: '#A855F7',
            description: 'У клієнта є вільні кошти. Запропонуйте йому розширити потужності.', params: {}
        };
    }

    if (hasActivePaid) {
        return {
            status: 'WORKING', label: 'ГРОШІ ПРАЦЮЮТЬ', color: '#22C55E',
            description: 'Активний інвестор. Все працює в штатному режимі.', params: {}
        };
    }

    return { status: 'UNKNOWN', label: 'В ПРОЦЕСІ', color: '#94A3B8', description: 'Клієнт вивчає платформу.', params: {} };
};

exports.getReferralInfo = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const hasCards = await UserCard.exists({ userId: user._id });
        
        if (!hasCards) return res.json({ isLocked: true });

        // Одна форма реф-ссылки для приложения и бота: сразу в Mini App, startapp=ref_<код>
        const referralLink = refLink(user.referralCode);

        const myReferrals = await User.find({ uplineUserId: user._id });
        const referralIds = myReferrals.map(u => u._id);

        // Капитал партнёров = сумма их активных КУПЛЕННЫХ нод (пробные не считаются)
        const activeCards = await UserCard.find({ userId: { $in: referralIds }, status: 'Active', isTrial: { $ne: true } });
        const totalPartnerCapital = activeCards.reduce((sum, card) => sum + parseFloat(card.purchasePriceUsd.toString() || 0), 0);
        // Инвестор = есть хотя бы одна купленная карта (в любом статусе)
        const investorsCount = await UserCard.distinct('userId', { userId: { $in: referralIds }, isTrial: { $ne: true } });

        const types = await CardType.find({ isActive: true }).select('referralAPY').lean();
        const { rows: claimedRows } = await IncomeEvent.query(
            `SELECT COALESCE(SUM((meta->>'sats')::double precision), 0) AS sats FROM income_events WHERE user_id = $1 AND type = 'REFERRAL_CLAIM'`,
            [String(user._id)]
        );
        const claimedSats = Number(claimedRows[0]?.sats) || 0;
        const refApys = types.map(t => t.referralAPY || 0);

        res.json({
            isLocked: false,
            referralLink,
            // Всего заработано = ещё не забрано + старые «застрявшие» сатоши + уже забранное (по журналу доходов)
            totalEarnedSats: (user.balance.referralSats || 0) + (user.balance.walletSats || 0) + claimedSats,
            availableSats: (user.balance.referralSats || 0) + (user.balance.walletSats || 0),
            referralApyMin: refApys.length ? Math.min(...refApys) : 0,
            referralApyMax: refApys.length ? Math.max(...refApys) : 0,
            stats: {
                totalInvited: myReferrals.length,
                investorsCount: investorsCount.length,
                nonInvestorsCount: myReferrals.length - investorsCount.length,
                totalPartnerCapital: Math.round(totalPartnerCapital * 100) / 100
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

        const [allCards, allRewards] = await Promise.all([
            UserCard.find({ userId: { $in: refIds } }).populate('cardTypeId'),
            ReferralReward.find({ uplineUserId: req.user._id, partnerUserId: { $in: refIds } }).lean()
        ]);

        const list = referrals.map(r => {
            const userCards = allCards.filter(c => c.userId.toString() === r._id.toString());
            const userRewards = allRewards.filter(rew => rew.partnerUserId.toString() === r._id.toString());
            
            const totalEarnedFromHimSats = userRewards.reduce((sum, rew) => sum + rew.amountSats, 0);
            const statusInfo = getPartnerStatusInfo(r, userCards);

            // --- ФОРМУЄМО ІНВЕНТАР МОНЕТ ---
            const inventory = {
                bought: userCards.filter(c => !c.isTrial).map(c => ({
                    name: c.cardTypeId?.name || 'Unknown Node',
                    serial: c.serialNumber,
                    status: c.status
                })),
                staked: userCards.filter(c => c.status === 'Active').map(c => ({
                    name: c.cardTypeId?.name || 'Unknown Node',
                    serial: c.serialNumber,
                    isTrial: c.isTrial
                }))
            };

            // Группування РЕАЛЬНИХ даних для графіка
            const chartData = userRewards.reduce((acc, rew) => {
                const dateStr = rew.date || new Date(rew.createdAt).toISOString().split('T')[0];
                const existing = acc.find(a => a.date === dateStr);
                if (existing) existing.val += rew.amountSats;
                else acc.push({ date: dateStr, val: rew.amountSats });
                return acc;
            }, []);

            return {
                id: r._id,
                username: r.username || 'Anonymous',
                // username вида User<tgId> — заглушка, а не настоящий ник: ссылку t.me на неё не даём
                tgUsername: r.username && !/^User\d+$/.test(r.username) ? r.username : null,
                registrationDate: r.createdAt,
                
                // CRM (статус — код, фронт переводит; label/description — запасной текст)
                status: statusInfo.status,
                statusParams: statusInfo.params || {},
                statusLabel: statusInfo.label,
                statusColor: statusInfo.color,
                statusDescription: statusInfo.description,

                // Фінанси: балансы и депозиты партнёра не раскрываем — только то, что заработал сам реферер
                myProfitFromHimBTC: (totalEarnedFromHimSats / 100000000).toFixed(8),
                myProfitFromHimSats: totalEarnedFromHimSats,
                lastRewardDate: userRewards.length ? userRewards.map(rw => rw.date).sort().slice(-1)[0] : null,
                
                // Детальний список монет
                inventory,

                // Реальний графік (сортований по даті)
                chartData: chartData.sort((a,b) => a.date.localeCompare(b.date)).slice(-14)
            };
        });

        res.json(list);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error fetching list' });
    }
};

exports.claimRewards = async (req, res) => {
    try {
        const btcPrice = priceService.getBitcoinPrice();
        if (btcPrice === null) return res.status(503).json({ success: false, code: 'PRICE_UNAVAILABLE' });

        const user = await User.findById(req.user._id).lean();
        const refSats = user?.balance?.referralSats || 0;
        // walletSats раньше копился при claim, но нигде не тратился — забираем и его
        const legacySats = user?.balance?.walletSats || 0;
        const totalSats = refSats + legacySats;
        const amountUsd = round2((totalSats / 100000000) * btcPrice);

        if (totalSats <= 0 || amountUsd < 0.01) {
            return res.status(400).json({ success: false, code: 'NOTHING_TO_CLAIM', message: 'Nothing to claim' });
        }

        // Условное обновление: если параллельный claim уже забрал сумму — ничего не произойдёт
        const r = await User.updateOne(
            { _id: req.user._id, 'balance.referralSats': refSats, 'balance.walletSats': user.balance.walletSats },
            { $inc: { 'balance.walletUsd': dec(amountUsd), 'balance.referralSats': -refSats, 'balance.walletSats': -legacySats } }
        );
        if (r.modifiedCount !== 1) return res.status(409).json({ success: false, code: 'CONFLICT' });

        await IncomeEvent.create({
            userId: req.user._id, type: 'REFERRAL_CLAIM', amountUsd: dec(amountUsd),
            meta: { sats: totalSats, btcPrice }
        }).catch(e => console.error('[IncomeEvent]', e.message));

        res.json({ success: true, claimedSats: totalSats, claimedUsd: amountUsd, btcPrice });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};