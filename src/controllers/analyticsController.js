const User = require('../models/User');
const { getFearAndGreedIndex } = require('../services/marketService');

// База вопросов (в будущем можно вынести в БД)
const QUIZ_QUESTIONS = [
    {
        id: 1,
        question: "What happens to Bitcoin mining rewards roughly every 4 years?",
        options: ["They Double", "They Halve (Halving)", "Stay Same"],
        correctIndex: 1
    },
    {
        id: 2,
        question: "Who is the creator of Bitcoin?",
        options: ["Vitalik Buterin", "Satoshi Nakamoto", "Elon Musk"],
        correctIndex: 1
    },
    {
        id: 3,
        question: "What is the maximum supply of Bitcoin?",
        options: ["21 Million", "100 Million", "Infinite"],
        correctIndex: 0
    }
];

/**
 * GET /api/v1/analytics/dashboard
 * Возвращает данные для экрана аналитики: Индекс страха, доступность квиза
 */
exports.getAnalyticsDashboard = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const fng = await getFearAndGreedIndex();

        // Проверяем, проходил ли сегодня квиз
        const today = new Date().setHours(0, 0, 0, 0);
        const lastQuiz = user.lastDailyQuizAt ? new Date(user.lastDailyQuizAt).setHours(0, 0, 0, 0) : 0;
        const isQuizAvailable = lastQuiz < today;

        // Выбираем случайный вопрос для сегодня (или можно по дню года)
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
        const questionOfTheDay = QUIZ_QUESTIONS[dayOfYear % QUIZ_QUESTIONS.length];

        // Убираем правильный ответ, чтобы не палить его на фронт
        const safeQuestion = { ...questionOfTheDay, correctIndex: undefined };

        res.json({
            marketSentiment: fng,
            quiz: {
                available: isQuizAvailable,
                data: isQuizAvailable ? safeQuestion : null
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * POST /api/v1/analytics/quiz/submit
 * Проверка ответа и начисление награды
 */
exports.submitQuizAnswer = async (req, res) => {
    // ЗАЩИТА: Проверяем, есть ли body
    if (!req.body || typeof req.body.questionId === 'undefined') {
        return res.status(400).json({ message: 'Invalid data format' });
    }

    const { questionId, answerIndex } = req.body;

    try {
        const user = await User.findById(req.user._id);
        
        // Проверка на повторное прохождение
        const today = new Date().setHours(0, 0, 0, 0);
        const lastQuiz = user.lastDailyQuizAt ? new Date(user.lastDailyQuizAt).setHours(0, 0, 0, 0) : 0;

        if (lastQuiz >= today) {
            return res.status(400).json({ message: 'Already completed today' });
        }

        const question = QUIZ_QUESTIONS.find(q => q.id === questionId);
        if (!question) return res.status(404).json({ message: 'Question not found' });

        const isCorrect = question.correctIndex === answerIndex;

        if (isCorrect) {
            user.balance.walletSats = (user.balance.walletSats || 0) + 10; // +10 Сатоши
            user.lastDailyQuizAt = new Date();
            await user.save();
            return res.json({ success: true, reward: 10 });
        } else {
            user.lastDailyQuizAt = new Date();
            await user.save();
            return res.json({ success: false, reward: 0 });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};
