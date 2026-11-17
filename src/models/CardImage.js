const { Model } = require('../db/model');

module.exports = new Model('CardImage', 'card_images', {
  cardTypeId: { type: 'ref', ref: 'CardType' },
  imageData: { type: 'text' },
  index: { type: 'int' },
});
