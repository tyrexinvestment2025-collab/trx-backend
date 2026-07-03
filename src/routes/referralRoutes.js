const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getReferralInfo, getReferralList, claimRewards } = require('../controllers/referralController');

router.use(protect);

router.get('/info', getReferralInfo);
router.get('/list', getReferralList);
router.post('/claim', claimRewards);

module.exports = router;