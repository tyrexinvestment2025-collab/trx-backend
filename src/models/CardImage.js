const mongoose = require('mongoose');

const cardImageSchema = new mongoose.Schema({
  cardTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CardType', required: true, index: true },
  imageData: { type: String, required: true },
  index: { type: Number, required: true, index: true } // Индекс ускоряет поиск в разы
});

// Составной индекс для супер-быстрого нахождения конкретной картинки
cardImageSchema.index({ cardTypeId: 1, index: 1 });

module.exports = mongoose.model('CardImage', cardImageSchema);