const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getUserProfile, requestWithdrawal, requestDeposit } = require('../controllers/userController');

router.get('/me', protect, getUserProfile);
router.post('/withdraw', protect, requestWithdrawal);
router.post('/deposit', protect, requestDeposit);

module.exports = router;