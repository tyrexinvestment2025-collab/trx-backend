const mongoose = require('mongoose');

const cardImageSchema = new mongoose.Schema({
  cardTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CardType', required: true },
  imageData: { type: String, required: true }, // Тут будет Base64
  index: { type: Number, required: true }      // Номер картинки в коллекции (0, 1, 2...)
});

module.exports = mongoose.model('CardImage', cardImageSchema);