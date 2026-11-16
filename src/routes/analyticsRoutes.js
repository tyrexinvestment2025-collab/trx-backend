const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getAnalyticsDashboard, getMarket, getQuiz, submitQuiz, setReminder } = require('../controllers/analyticsController');

router.use(protect); // Защита токеном

router.get('/dashboard', getAnalyticsDashboard);
router.get('/market', getMarket);
router.get('/quiz', getQuiz);
router.post('/quiz/submit', submitQuiz);
router.post('/remind', setReminder);

module.exports = router;
