const User = require('../models/User');
const UserCard = require('../models/UserCard'); // Твоя модель владения картами
const CardType = require('../models/CardType'); // Твоя модель типов карт (для APY)
const { getFearAndGreedIndex } = require('../services/marketService');
const COMPARISON_DATA = require('../config/benchmarks');

exports.getAnalyticsDashboard = async (req, res) => {
    try {
        // Загружаем данные параллельно
        const [user, fng, userCards] = await Promise.all([
            User.findById(req.user._id).lean(),
            getFearAndGreedIndex(),
            // Нам нужно подтянуть данные о типе карты (CardType), чтобы узнать APY каждой карты
            UserCard.find({ userId: req.user._id, status: 'Active' })
                .populate('cardTypeId') 
                .lean()
        ]);

        // --- ДИНАМИЧЕСКИЙ СКОРИНГ TYREX ---
        
        // 1. Считаем средний APY (Доходность)
        const avgApy = userCards.length > 0 
            ? userCards.reduce((acc, card) => {
                // Берем APY из населенной (populated) модели CardType
                return acc + (card.cardTypeId ? card.cardTypeId.clientAPY : 0);
              }, 0) / userCards.length 
            : 0;

        // 2. Рассчитываем Tyrex Score на основе реальных данных юзера
        const tyrexScore = {
            yield: Math.min(95, 60 + (avgApy * 0.5)), // Доходность (база 60 + бонус от APY)
            liquidity: 80, // Ликвидность (стабильно высокая)
            entry: 90,     // Порог входа (очень доступно)
            safety: 100,    // Безопасность
            passive: 95,   // Пассивность (авто-майнинг)
            growth: 92     // Рост
        };

        // --- КВИЗ ЛОГИКА ---
        const today = new Date().setHours(0, 0, 0, 0);
        const lastQuiz = user.lastDailyQuizAt ? new Date(user.lastDailyQuizAt).setHours(0, 0, 0, 0) : 0;
        const isQuizAvailable = lastQuiz < today;

        res.json({
            marketSentiment: fng,
            quiz: {
                available: isQuizAvailable,
                // Тут выбор вопроса...
            },
            analytics: {
                benchmarks: COMPARISON_DATA,
                userScore: tyrexScore
            }
        });

    } catch (error) {
        console.error('Analytics Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};