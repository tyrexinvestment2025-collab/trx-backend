const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { 
    getUserProfile, 
    requestWithdrawal, 
    requestDeposit,
    getTransactionHistory,
    getNotifications,
    markNotificationsRead,
    checkSubscription
 } = require('../controllers/userController');

router.get('/me', protect, getUserProfile);
router.post('/withdraw', protect, requestWithdrawal);
router.post('/deposit', protect, requestDeposit);
router.get('/history', protect, getTransactionHistory); 
router.get('/notifications',protect, getNotifications);
router.post('/notifications/read', protect, markNotificationsRead);
router.post('/check-subscription', protect, checkSubscription);

module.exports = router;