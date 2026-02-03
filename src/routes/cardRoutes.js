const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); 

const { 
  getCardTypes, 
  getCollectionItems, 
  getMyCards, 
  buyCard, 
  startCard, 
  stopCard,
  sellCardBack,
  getCardHistoryBySerial
} = require('../controllers/cardController');

router.get('/types', getCardTypes);

router.get('/my', protect, getMyCards);
router.post('/buy', protect, buyCard);
router.get('/types/:id/items', getCollectionItems); 
router.get('/history/:typeId/:serial', getCardHistoryBySerial);
router.post('/:id/sell-back', protect, sellCardBack); // <--- Продажа системе

router.post('/:id/stop', protect, stopCard);
router.post('/:id/start', protect, startCard);

module.exports = router;