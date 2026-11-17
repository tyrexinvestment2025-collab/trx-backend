const { Model } = require('../db/model');

module.exports = new Model('CardType', 'card_types', {
  name: { type: 'text' },
  nominalSats: { type: 'decimal' },
  clientAPY: { type: 'double' },
  referralAPY: { type: 'double', default: 0 },
  maxSupply: { type: 'int' },
  available: { type: 'int', default: 0 },
  imagePath: { type: 'text' },
  isActive: { type: 'bool', default: true },
}, { timestamps: true });
