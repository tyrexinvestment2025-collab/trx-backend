const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { verifyTelegramWebAppData } = require('../utils/telegramAuth');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
const { updateUserStatus } = require('../utils/userStatusHelper'); 

exports.login = async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ message: 'No initData' });

    // 1. Проверяем подпись
    const isValid = verifyTelegramWebAppData(initData);
    if (!isValid) return res.status(401).json({ message: 'Invalid data' });

    // 2. Парсим данные
    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    const startParam = urlParams.get('start_param'); 
    
    const telegramUser = JSON.parse(userString);
    const adminIds = (process.env.ADMIN_IDS || '').split(',');
    const role = adminIds.includes(String(telegramUser.id)) ? 'ADMIN' : 'USER';

    // 3. Ищем пользователя
    let user = await User.findOne({ tgId: telegramUser.id });

    // --- ЕСЛИ ПОЛЬЗОВАТЕЛЬ НОВЫЙ ---
    if (!user) {
        let uplineId = null;

        // Ищем пригласившего
        if (startParam) {
            const inviter = await User.findOne({ referralCode: startParam });
            if (inviter && inviter.tgId !== telegramUser.id) {
                uplineId = inviter._id;
            }
        }

        // Генерируем код
        let newCode = generateReferralCode();
        while (await User.findOne({ referralCode: newCode })) {
            newCode = generateReferralCode();
        }

        // Создаем объект (но пока не сохраняем в БД)
        const newUser = new User({
            tgId: telegramUser.id,
            username: telegramUser.username || `User${telegramUser.id}`,
            role,
            referralCode: newCode,
            uplineUserId: uplineId,
            balance: { walletUsd: 100000 }, // Бонус
            accountStatus: 'NEWBIE'
        });

        // --- ВАЖНЫЙ БЛОК: ОБРАБОТКА ДУБЛИКАТОВ ---
        try {
            await newUser.save();
            user = newUser; // Успешно создали
        } catch (error) {
            // Если ошибка 11000 (Duplicate Key), значит параллельный запрос успел создать юзера раньше нас
            if (error.code === 11000) {
                console.log(`⚠️ Race condition handled: User ${telegramUser.id} already exists.`);
                user = await User.findOne({ tgId: telegramUser.id });
            } else {
                // Если это другая ошибка — падаем
                throw error;
            }
        }
    } 
    // --- ЕСЛИ ПОЛЬЗОВАТЕЛЬ УЖЕ БЫЛ ---
    else {
        user.username = telegramUser.username || user.username;
        if (!user.referralCode) {
             user.referralCode = generateReferralCode();
             await user.save();
        }
        // Аплайна не меняем для старых юзеров
    }

    // Если user все равно null (крайне маловероятно), кидаем ошибку
    if (!user) {
        return res.status(500).json({ message: 'User creation failed due to concurrency' });
    }

    await updateUserStatus(user._id);

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};