const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { verifyTelegramWebAppData } = require('../utils/telegramAuth');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
const { findOrCreateUser, langFromCode } = require('../services/userService');
const events = require('../bot/events');
const { updateUserStatus } = require('../utils/userStatusHelper');

const getAdminIds = () => (process.env.ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

exports.login = async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ message: 'No initData' });

    // 1. Проверяем подпись и свежесть
    if (!verifyTelegramWebAppData(initData)) {
        return res.status(401).json({ message: 'Invalid data' });
    }

    // 2. Парсим данные
    const urlParams = new URLSearchParams(initData);
    const startParam = urlParams.get('start_param');

    let telegramUser;
    try {
        telegramUser = JSON.parse(urlParams.get('user'));
    } catch {
        return res.status(400).json({ message: 'Invalid user payload' });
    }
    if (!telegramUser?.id) return res.status(400).json({ message: 'Invalid user payload' });

    // Роль вычисляется при каждом входе: изменения ADMIN_IDS применяются и к старым пользователям
    const role = getAdminIds().includes(String(telegramUser.id)) ? 'ADMIN' : 'USER';

    // 3. Находим или создаём пользователя (та же функция, что и для /start в боте).
    //    Реф-код из start_param (ref_<код> или старый формат <код>) засчитывается только новому пользователю.
    const { user: found, created, inviter } = await findOrCreateUser(telegramUser, { startPayload: startParam, via: 'app' });
    let user = found;
    if (created && inviter) await events.referralJoined(inviter._id, user);

    if (!user) {
        return res.status(500).json({ message: 'User creation failed due to concurrency' });
    }

    if (user.isBanned) {
        return res.status(403).json({ message: 'Account is banned', code: 'BANNED' });
    }

    // --- Обновляем данные существующего пользователя ---
    const updates = {};
    if (telegramUser.username && telegramUser.username !== user.username) updates.username = telegramUser.username;
    if (user.role !== role) updates.role = role;
    if (telegramUser.language_code && telegramUser.language_code !== user.languageCode) updates.languageCode = telegramUser.language_code;
    if (!user.referralCode) updates.referralCode = generateReferralCode();
    if (telegramUser.first_name && telegramUser.first_name !== user.firstName) updates.firstName = String(telegramUser.first_name).slice(0, 64);
    if (!user.lang) updates.lang = langFromCode(telegramUser.language_code);
    // initData сообщает, разрешил ли пользователь боту писать (allows_write_to_pm)
    if (telegramUser.allows_write_to_pm === true && !user.canMessage) { updates.canMessage = true; updates.botBlockedAt = null; }
    if (Object.keys(updates).length) {
        user = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true });
    }

    await updateUserStatus(user._id);

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};
