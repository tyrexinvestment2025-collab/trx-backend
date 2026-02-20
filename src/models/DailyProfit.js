const mongoose = require('mongoose');

const dailyEarningSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true }, // Формат "YYYY-MM-DD"
  miningSats: { type: Number, default: 0 },
  referralSats: { type: Number, default: 0 },
}, { timestamps: true });

// Уникальный индекс, чтобы не дублировать записи за один день
dailyEarningSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyEarning', dailyEarningSchema);