const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { verifyTelegramWebAppData } = require('../utils/telegramAuth');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
const { updateUserStatus } = require('../utils/userStatusHelper'); 

exports.login = async (req, res) => {
  try {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ message: 'initData is required' });

    const isValid = verifyTelegramWebAppData(initData);
    if (!isValid) return res.status(401).json({ message: 'Invalid Telegram data' });

    const urlParams = new URLSearchParams(initData);
    const userString = urlParams.get('user');
    const startParam = urlParams.get('start_param');
    
    if (!userString) return res.status(400).json({ message: 'User data missing' });

    const telegramUser = JSON.parse(userString);
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => id.trim()) : [];
    const role = adminIds.includes(String(telegramUser.id)) ? 'ADMIN' : 'USER';
    
    const STARTING_USD = '100000.00'; 

    let user = await User.findOne({ tgId: telegramUser.id });
    let uplineUser = null;

    if (startParam) {
        uplineUser = await User.findOne({ referralCode: startParam });
        if (uplineUser && uplineUser.tgId === telegramUser.id) uplineUser = null;
    }

    if (!user) {
      let newReferralCode;
      let isCodeUnique = false;
      while (!isCodeUnique) {
        newReferralCode = generateReferralCode();
        if (!(await User.findOne({ referralCode: newReferralCode }))) isCodeUnique = true;
      }

      user = new User({
        tgId: telegramUser.id,
        username: telegramUser.username || '',
        role: role,
        'balance.walletUsd': STARTING_USD,
        accountStatus: 'DEPOSITOR', 
        referralCode: newReferralCode,
        uplineUserId: uplineUser ? uplineUser._id : null
      });
      await user.save();
    } else {
      user.username = telegramUser.username || user.username;
      user.role = role;
      
      if (!user.referralCode) {
          let newCode;
          do {
            newCode = generateReferralCode();
          } while (await User.findOne({ referralCode: newCode }));
          user.referralCode = newCode;
      }
      
      if (!user.uplineUserId && uplineUser) user.uplineUserId = uplineUser._id;
      
      await user.save();
      // Обновляем статус на всякий случай
      await updateUserStatus(user._id); 
    }

    const token = jwt.sign(
      { id: user._id, tgId: user.tgId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    // Получаем актуального юзера после всех обновлений статуса
    const finalUser = await User.findById(user._id);

    res.json({
      token,
      user: JSON.parse(JSON.stringify(finalUser))
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};