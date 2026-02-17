const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getAnalyticsDashboard, submitQuizAnswer } = require('../controllers/analyticsController');

router.use(protect); // Защита токеном

router.get('/dashboard', getAnalyticsDashboard);
router.post('/quiz/submit', submitQuizAnswer);

module.exports = router;