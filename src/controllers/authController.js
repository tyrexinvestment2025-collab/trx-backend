const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { verifyTelegramWebAppData } = require('../utils/telegramAuth');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
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

    // 3. Ищем пользователя
    let user = await User.findOne({ tgId: telegramUser.id });

    // --- ЕСЛИ ПОЛЬЗОВАТЕЛЬ НОВЫЙ ---
    if (!user) {
        let uplineId = null;

        if (startParam) {
            const inviter = await User.findOne({ referralCode: startParam });
            if (inviter && inviter.tgId !== telegramUser.id) {
                uplineId = inviter._id;
            }
        }

        let newCode = generateReferralCode();
        while (await User.findOne({ referralCode: newCode })) {
            newCode = generateReferralCode();
        }

        // Стартовый бонус настраивается через env (по умолчанию 0)
        const signupBonus = Number(process.env.SIGNUP_BONUS_USD) || 0;

        const newUser = new User({
            tgId: telegramUser.id,
            username: telegramUser.username || `User${telegramUser.id}`,
            role,
            languageCode: telegramUser.language_code || 'en',
            referralCode: newCode,
            uplineUserId: uplineId,
            balance: { walletUsd: signupBonus.toFixed(2) },
            accountStatus: 'NEWBIE'
        });

        try {
            await newUser.save();
            user = newUser;
        } catch (error) {
            // 11000 = параллельный запрос уже создал пользователя
            if (error.code === 11000) {
                user = await User.findOne({ tgId: telegramUser.id });
            } else {
                throw error;
            }
        }
    }

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
