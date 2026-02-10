const mongoose = require('mongoose');

const cardTypeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  nominalSats: { type: mongoose.Schema.Types.Decimal128, required: true },
  clientAPY: { type: Number, required: true },
  referralAPY: { type: Number, default: 0 },
  maxSupply: { type: Number, required: true, default: 100 },
  available: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('CardType', cardTypeSchema);