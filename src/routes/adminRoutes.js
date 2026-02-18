const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');

const { 
  getStats,
  getUsers,
  getUserFullReport,
  banUser,
  updateCardType,
  getPendingDeposits,
  confirmDeposit,
  getPendingWithdrawals,
  processWithdrawal,
  rejectWithdrawal,
  rejectDeposit
} = require('../controllers/adminController');

// Применяем middleware для всех маршрутов в этом файле
router.use(protect, admin);

// --- Аналитика ---
router.get('/stats', getStats);

// --- Управление пользователями ---
router.get('/users', getUsers);
router.get('/users/:userId/full-report', getUserFullReport);
router.post('/users/:userId/ban', banUser);

// --- Управление Маркетплейсом ---
router.put('/card-types/:typeId', updateCardType);
router.post('/deposit/:id/reject', rejectDeposit);
router.post('/withdrawal/:id/reject', rejectWithdrawal);
// --- Обработка Финансовых Заявок (старая логика) ---
router.get('/deposits/pending', getPendingDeposits);
router.post('/deposit/:id/confirm', confirmDeposit);
router.get('/withdrawals/pending', getPendingWithdrawals);
router.post('/withdrawal/:id/process', processWithdrawal);

module.exports = router;