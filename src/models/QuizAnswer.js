const mongoose = require('mongoose');

/** Ответ на «Вопрос дня»: один ответ в день на пользователя */
const quizAnswerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true }, // YYYY-MM-DD (UTC)
  questionId: { type: String, required: true },
  answer: { type: Number, required: true },
  correct: { type: Boolean, required: true }
}, { timestamps: true });

quizAnswerSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('QuizAnswer', quizAnswerSchema);
