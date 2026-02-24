const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getAnalyticsDashboard } = require('../controllers/analyticsController');

router.use(protect); // Защита токеном

router.get('/dashboard', getAnalyticsDashboard);

module.exports = router;