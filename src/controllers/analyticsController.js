const User = require('../models/User');
const UserCard = require('../models/UserCard');
const { getFearAndGreedIndex } = require('../services/marketService');
const priceService = require('../services/priceService'); // Твой сервис цен
const COMPARISON_DATA = require('../config/benchmarks');

exports.getAnalyticsDashboard = async (req, res) => {
    try {
        // Получаем текущую цену BTC из твоего сервиса
        const btcPrice = priceService.getBitcoinPrice() || 60000; 

        // Загружаем данные
        const [user, fng, userCards] = await Promise.all([
            User.findById(req.user._id).lean(),
            getFearAndGreedIndex(),
            UserCard.find({ userId: req.user._id, status: 'Active' })
                .populate('cardTypeId')
                .lean()
        ]);

        // --- РАСЧЕТ БАЛАНСА ---
        // 1. Сумма всех активных карт в USD (основываясь на их покупной стоимости)
        const cardsValueUsd = userCards.reduce((acc, card) => acc + (parseFloat(card.purchasePriceUsd) || 0), 0);
        
        // 2. Добавляем баланс кошелька (в предположении, что он есть в user.balance.walletUsd)
        const walletUsd = user.balance?.walletUsd ? parseFloat(user.balance.walletUsd) : 0;
        
        const totalBalanceUsd = cardsValueUsd + walletUsd;

        // --- ДИНАМИЧЕСКИЙ СКОРИНГ TYREX ---
        const avgApy = userCards.length > 0 
            ? userCards.reduce((acc, card) => acc + (card.cardTypeId?.clientAPY || 0), 0) / userCards.length 
            : 0;

        const tyrexScore = {
            yield: Math.min(95, 60 + (avgApy * 0.5)),
            liquidity: 80,
            entry: 90,
            safety: 100,
            passive: 95,
            growth: 92
        };

        // --- ОТВЕТ ДЛЯ ФРОНТЕНДА ---
        res.json({
            marketSentiment: fng,
            analytics: {
                // База для умного алгоритма на фронте
                currentBalance: totalBalanceUsd,
                financialGoal: user.analytics?.financialGoal || 50000,
                baseApy: avgApy,
                
                // Данные для бенчмарков (старая логика)
                benchmarks: COMPARISON_DATA,
                userScore: tyrexScore
            },
            // Данные для квиза (оставляем как было)
            quiz: {
                available: (user.lastDailyQuizAt ? new Date(user.lastDailyQuizAt).setHours(0,0,0,0) : 0) < new Date().setHours(0,0,0,0)
            }
        });

    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};