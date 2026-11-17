const User = require('../models/User');
const UserCard = require('../models/UserCard');
const IncomeEvent = require('../models/IncomeEvent');
const DailyEarning = require('../models/DailyProfit');
const QuizAnswer = require('../models/QuizAnswer');
const { getFearAndGreedIndex } = require('../services/marketService');
const priceService = require('../services/priceService2');
const marketHistory = require('../services/marketHistory');
const COMPARISON_DATA = require('../config/benchmarks');
const { METRICS, TYREX_SCORE, SCORES_UPDATED_AT, BTC_SCENARIOS } = require('../config/benchmarks');
const QUIZ = require('../config/quiz');
const { toNum, round2, isObjectId } = require('../utils/money');
const { langOf: pickLang } = require('../bot/texts');

const SATS_IN_BTC = 100000000;
const DAYS_BACK = 366;

const dayKey = (d) => d.toISOString().split('T')[0];
const monthOf = (day) => day.slice(0, 7);

/**
 * «Доход»: только прибыль (без возврата цены карт и пополнений).
 *  - cards: выплаченная прибыль карт + начисленная на картах (работают / на охлаждении)
 *  - partners: забранные реферальные + ещё не забранные (по текущему курсу)
 *  - daily: начисления по дням за год (из журнала DailyEarning) — для тепловой карты и периодов
 *  - byMonth: те же начисления по месяцам за 12 месяцев
 *  - bySeries: доход по сериям карт
 */
const buildIncome = async (userId, user, btcPrice) => {
    const since = new Date(Date.now() - DAYS_BACK * 86400000);
    const [events, cards, days] = await Promise.all([
        IncomeEvent.find({ userId, type: { $in: ['CARD_PAYOUT', 'REFERRAL_CLAIM'] } }).select('type amountUsd meta createdAt').lean(),
        UserCard.find({ userId, isTrial: { $ne: true } })
            .select('status purchasePriceUsd currentProfitUsd coolingPayoutUsd cardTypeId')
            .populate('cardTypeId', 'name').lean(),
        DailyEarning.find({ userId, date: { $gte: dayKey(since) } }).select('date miningSats referralSats miningUsd referralUsd').lean()
    ]);

    const series = new Map();
    const addSeries = (name, field, amount) => {
        if (!(amount > 0)) return;
        const key = name || '—';
        const row = series.get(key) || { name: key, receivedUsd: 0, pendingUsd: 0 };
        row[field] += amount;
        series.set(key, row);
    };

    let paidCards = 0, claimedReferral = 0, paidPrincipal = 0;
    for (const ev of events) {
        if (ev.type === 'CARD_PAYOUT') {
            const profit = toNum(ev.meta?.profitUsd);
            paidCards += profit;
            paidPrincipal += toNum(ev.meta?.principalUsd);
            addSeries(ev.meta?.cardName, 'receivedUsd', profit);
        } else {
            claimedReferral += toNum(ev.amountUsd);
        }
    }

    let pendingCards = 0, investedNow = 0;
    for (const c of cards) {
        if (c.status === 'Active' || c.status === 'Cooling') investedNow += toNum(c.purchasePriceUsd);
        const amount = c.status === 'Active' ? toNum(c.currentProfitUsd) : c.status === 'Cooling' ? toNum(c.coolingPayoutUsd) : 0;
        if (amount > 0) { pendingCards += amount; addSeries(c.cardTypeId?.name, 'pendingUsd', amount); }
    }

    const price = btcPrice || 0;
    const unclaimedSats = (user?.balance?.referralSats || 0) + (user?.balance?.walletSats || 0);
    const unclaimedReferral = (unclaimedSats / SATS_IN_BTC) * price;

    // Дни: USD по курсу начисления, а для старых записей (только сатоши) — по текущему курсу
    const daily = days
        .map(d => ({
            date: d.date,
            cardsUsd: round2(d.miningUsd > 0 ? d.miningUsd : (toNum(d.miningSats) / SATS_IN_BTC) * price),
            referralUsd: round2(d.referralUsd > 0 ? d.referralUsd : (toNum(d.referralSats) / SATS_IN_BTC) * price),
        }))
        .filter(d => d.cardsUsd > 0 || d.referralUsd > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

    const months = new Map();
    const start = new Date(); start.setUTCDate(1);
    for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1));
        const key = dayKey(d).slice(0, 7);
        months.set(key, { month: key, cardsUsd: 0, referralUsd: 0 });
    }
    for (const d of daily) {
        const m = months.get(monthOf(d.date));
        if (m) { m.cardsUsd += d.cardsUsd; m.referralUsd += d.referralUsd; }
    }

    const cardsUsd = paidCards + pendingCards;
    const partnersUsd = claimedReferral + unclaimedReferral;
    const investedUsd = investedNow + paidPrincipal;

    return {
        totalUsd: round2(cardsUsd + partnersUsd),
        cardsUsd: round2(cardsUsd),
        partnersUsd: round2(partnersUsd),
        receivedUsd: round2(paidCards + claimedReferral),
        pendingUsd: round2(pendingCards + unclaimedReferral),
        investedUsd: round2(investedUsd),
        returnPct: investedUsd > 0 ? round2(((cardsUsd + partnersUsd) / investedUsd) * 100) : 0,
        daily,
        byMonth: [...months.values()].map(m => ({ ...m, cardsUsd: round2(m.cardsUsd), referralUsd: round2(m.referralUsd) })),
        bySeries: [...series.values()]
            .map(s => ({ ...s, receivedUsd: round2(s.receivedUsd), pendingUsd: round2(s.pendingUsd) }))
            .sort((a, b) => (b.receivedUsd + b.pendingUsd) - (a.receivedUsd + a.pendingUsd))
    };
};

/** «Скоро»: ближайшие выплаты после охлаждения и окончание подарочных карт */
const buildUpcoming = async (userId) => {
    const cards = await UserCard.find({
        userId, unlockAt: { $gt: new Date() },
        $or: [{ status: 'Cooling' }, { status: 'Active', isTrial: true }]
    }).select('status isTrial serialNumber unlockAt purchasePriceUsd coolingPayoutUsd remindBeforeEnd cardTypeId')
        .populate('cardTypeId', 'name').sort({ unlockAt: 1 }).limit(10).lean();

    return cards.map(c => ({
        cardId: c._id,
        name: c.cardTypeId?.name || 'Tyrex',
        serial: c.serialNumber,
        kind: c.isTrial ? 'trialEnd' : 'payout',
        at: c.unlockAt,
        amountUsd: c.isTrial ? 0 : round2(toNum(c.purchasePriceUsd) + toNum(c.coolingPayoutUsd)),
        profitUsd: c.isTrial ? 0 : round2(toNum(c.coolingPayoutUsd)),
        remind: c.remindBeforeEnd !== false
    }));
};

exports.getAnalyticsDashboard = async (req, res) => {
    try {
        const btcPrice = priceService.getBitcoinPrice();
        const userId = String(req.user._id);
        const user = await User.findById(userId).select('balance analytics').lean();

        const [fng, activeCards, income, upcoming] = await Promise.all([
            getFearAndGreedIndex(),
            UserCard.find({ userId, status: 'Active', isTrial: { $ne: true } })
                .select('purchasePriceUsd cardTypeId').populate('cardTypeId', 'clientAPY').lean(),
            buildIncome(userId, user, btcPrice),
            buildUpcoming(userId)
        ]);

        const cardsValueUsd = activeCards.reduce((acc, c) => acc + toNum(c.purchasePriceUsd), 0);
        const walletUsd = toNum(user?.balance?.walletUsd);
        const weighted = activeCards.reduce((acc, c) => acc + toNum(c.purchasePriceUsd) * (c.cardTypeId?.clientAPY || 0), 0);

        res.json({
            marketSentiment: fng,
            analytics: {
                currentBalance: round2(cardsValueUsd + walletUsd),
                cardsValueUsd: round2(cardsValueUsd),
                financialGoal: user?.analytics?.financialGoal || 50000,
                baseApy: cardsValueUsd > 0 ? round2(weighted / cardsValueUsd) : 0,
                activeNodes: activeCards.length,
                metrics: METRICS,
                benchmarks: { traditional: COMPARISON_DATA.traditional, crypto: COMPARISON_DATA.crypto },
                userScore: TYREX_SCORE,
                scoresUpdatedAt: SCORES_UPDATED_AT,
                scenarios: BTC_SCENARIOS,
                income,
                upcoming
            },
            btcPrice
        });
    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

/** GET /analytics/market?range=24h|7d|30d|1y — история курса BTC */
exports.getMarket = async (req, res) => {
    const range = String(req.query.range || '24h');
    if (!marketHistory.RANGES[range]) return res.status(400).json({ message: 'Bad range' });
    try {
        const data = await marketHistory.getHistory(range);
        res.json({ ...data, price: priceService.getBitcoinPrice() });
    } catch (e) {
        console.error('[Market] history failed:', e.message);
        res.status(503).json({ message: 'Market data unavailable', code: 'MARKET_UNAVAILABLE' });
    }
};

/** Вопрос дня: по дате UTC, одинаковый для всех */
const questionOfDay = (date) => {
    const n = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
    return QUIZ[((n % QUIZ.length) + QUIZ.length) % QUIZ.length];
};

const publicQuestion = (q, lang, answered) => ({
    id: q.id,
    question: q.q[lang],
    options: q.options[lang],
    ...(answered ? { answer: q.answer, explain: q.explain[lang], given: answered.answer, correct: answered.correct } : {})
});

/** GET /analytics/quiz?lang=ru */
exports.getQuiz = async (req, res) => {
    try {
        const lang = pickLang(req.query.lang);
        const date = dayKey(new Date());
        const q = questionOfDay(date);
        const answered = await QuizAnswer.findOne({ userId: req.user._id, date }).lean();
        const [total, correct] = await Promise.all([
            QuizAnswer.countDocuments({ userId: req.user._id }),
            QuizAnswer.countDocuments({ userId: req.user._id, correct: true })
        ]);
        res.json({ date, ...publicQuestion(q, lang, answered), stats: { total, correct } });
    } catch (e) {
        res.status(500).json({ message: 'Server Error' });
    }
};

/** POST /analytics/quiz/submit { questionId, answer, lang } — один ответ в день */
exports.submitQuiz = async (req, res) => {
    try {
        const lang = pickLang(req.body?.lang);
        const date = dayKey(new Date());
        const q = questionOfDay(date);
        const answer = Number(req.body?.answer);
        if (req.body?.questionId !== q.id) return res.status(409).json({ message: 'Question changed', code: 'QUIZ_STALE' });
        if (!Number.isInteger(answer) || answer < 0 || answer >= q.options.en.length) return res.status(400).json({ message: 'Bad answer' });

        let saved;
        try {
            saved = await QuizAnswer.create({ userId: req.user._id, date, questionId: q.id, answer, correct: answer === q.answer });
        } catch (e) {
            if (e.code !== 11000) throw e;
            saved = await QuizAnswer.findOne({ userId: req.user._id, date }).lean(); // уже отвечал сегодня
        }
        res.json({ date, ...publicQuestion(q, lang, saved) });
    } catch (e) {
        res.status(500).json({ message: 'Server Error' });
    }
};

/** POST /analytics/remind { cardId, on } — напомнить в чате за сутки до конца цикла */
exports.setReminder = async (req, res) => {
    try {
        const { cardId } = req.body || {};
        const on = req.body?.on !== false;
        if (!isObjectId(cardId)) return res.status(400).json({ message: 'Bad card id' });
        const card = await UserCard.findOneAndUpdate(
            { _id: cardId, userId: req.user._id, unlockAt: { $gt: new Date() }, $or: [{ status: 'Cooling' }, { status: 'Active', isTrial: true }] },
            on ? { $set: { remindBeforeEnd: true }, $unset: { remindSentAt: 1 } } : { $set: { remindBeforeEnd: false } },
            { new: true }
        ).lean();
        if (!card) return res.status(404).json({ message: 'Card not found', code: 'CARD_NOT_FOUND' });
        res.json({ success: true, remind: card.remindBeforeEnd });
    } catch (e) {
        res.status(500).json({ message: 'Server Error' });
    }
};
