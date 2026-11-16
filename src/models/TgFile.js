const mongoose = require('mongoose');

/** file_id картинок, уже загруженных в Telegram (приветствие, QR) — чтобы не отправлять файл заново */
const tgFileSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  fileId: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('TgFile', tgFileSchema);
