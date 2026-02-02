const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getReferralInfo, getReferralList } = require('../controllers/referralController');

router.use(protect);

router.get('/info', getReferralInfo);
router.get('/list', getReferralList);

module.exports = router;