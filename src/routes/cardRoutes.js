const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware'); 

const { 
  getCardTypes, 
  buyCard, 
  getMyCards, 
  stopCard,
  startCard 
} = require('../controllers/cardController');

router.get('/types', getCardTypes);

router.get('/my', protect, getMyCards);
router.post('/buy', protect, buyCard);
router.post('/:id/stop', protect, stopCard);
router.post('/:id/start', protect, startCard); 

module.exports = router;