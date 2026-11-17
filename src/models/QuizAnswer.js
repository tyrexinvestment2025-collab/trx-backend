const { Model } = require('../db/model');

/** Ответ на «Вопрос дня»: один ответ в день на пользователя (UNIQUE user_id, date) */
module.exports = new Model('QuizAnswer', 'quiz_answers', {
  userId: { type: 'ref', ref: 'User' },
  date: { type: 'text' }, // YYYY-MM-DD (UTC)
  questionId: { type: 'text' },
  answer: { type: 'int' },
  correct: { type: 'bool' },
}, { timestamps: true });
