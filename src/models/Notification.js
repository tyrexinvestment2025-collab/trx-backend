const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['INFO', 'DEPOSIT', 'WITHDRAWAL', 'SYSTEM'], default: 'INFO' },
  isRead: { type: Boolean, default: false },
}, {
  timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);