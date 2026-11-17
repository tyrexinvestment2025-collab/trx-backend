const { Model } = require('../db/model');

/** file_id картинок, уже загруженных в Telegram (приветствие, QR) — чтобы не отправлять файл заново */
module.exports = new Model('TgFile', 'tg_files', {
  key: { type: 'text' },
  fileId: { type: 'text' },
}, { timestamps: true });
