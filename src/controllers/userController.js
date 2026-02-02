const User = require('../models/User');
const UserCard = require('../models/UserCard'); // <--- ВАЖНО: Импорт модели карт
const WithdrawalRequest = require('../models/WithdrawalRequest');
const DepositRequest = require('../models/DepositRequest');
const jwt = require('jsonwebtoken');
const { verifyTelegramWebAppData } = require('../utils/telegramAuth');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
const { updateUserStatus } = require('../utils/userStatusHelper');
const { getBitcoinPrice } = require('../services/priceService'); 

// Логин
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
    
    const STARTING_USD = '1000.00'; 

    let user = await User.findOne({ tgId: telegramUser.id });
    let uplineUser = null;

    // Логика рефералки
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
      await updateUserStatus(user._id); 
    }

    const token = jwt.sign(
      { id: user._id, tgId: user.tgId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
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

exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    await updateUserStatus(userId);
    const updatedUser = await User.findById(userId);
    
    const cards = await UserCard.find({ userId: userId }).populate('cardTypeId');
    const btcPrice = getBitcoinPrice(); 

    // --- НОВОЕ: ПОЛУЧЕНИЕ ТРАНЗАКЦИЙ ---
    // Берем последние 5 депозитов и 5 выводов
    const deposits = await DepositRequest.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();
    const withdrawals = await WithdrawalRequest.find({ userId }).sort({ createdAt: -1 }).limit(5).lean();

    // Приводим к единому формату
    const formattedDeposits = deposits.map(d => ({
        ...d,
        type: 'DEPOSIT',
        amount: parseFloat(d.amountUsd.toString()) // Используем amountUsd
    }));

    const formattedWithdrawals = withdrawals.map(w => ({
        ...w,
        type: 'WITHDRAWAL',
        amount: parseFloat(w.amountUsd.toString()) // Используем amountUsd
    }));

    // Объединяем и сортируем по дате (самые новые сверху)
    const allTransactions = [...formattedDeposits, ...formattedWithdrawals]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10); // Оставляем топ-10
    // ------------------------------------

    res.json({
      ...JSON.parse(JSON.stringify(updatedUser)),
      cards: JSON.parse(JSON.stringify(cards)),
      transactions: allTransactions, // Отправляем на фронт
      btcPrice: btcPrice 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Запрос на вывод
exports.requestWithdrawal = async (req, res) => {
  const { amountUsd, walletAddress } = req.body;
  const minUsd = parseFloat(process.env.MIN_WITHDRAWAL_USD || '30');

  try {
    const user = await User.findById(req.user._id);
    
    const userWalletUsd = parseFloat(user.balance.walletUsd.toString());
    const amountToWithdraw = parseFloat(amountUsd);
    
    if (userWalletUsd < amountToWithdraw) {
      return res.status(400).json({ message: 'Insufficient USD balance' });
    }

    if (amountToWithdraw < minUsd) {
      return res.status(400).json({ message: `Minimum withdrawal is $${minUsd}` });
    }

    await WithdrawalRequest.create({
      userId: user._id,
      amountUsd: amountToWithdraw.toString(),
      walletAddress,
      status: 'PENDING'
    });

    user.balance.walletUsd = userWalletUsd - amountToWithdraw;
    const currentPending = parseFloat(user.balance.pendingWithdrawalUsd.toString());
    user.balance.pendingWithdrawalUsd = currentPending + amountToWithdraw;
    
    await user.save();
    await updateUserStatus(user._id);

    res.status(201).json({ message: 'Withdrawal requested' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.requestDeposit = async (req, res) => {
  const { amountUsd, txHash } = req.body;
  try {
    await DepositRequest.create({
      userId: req.user._id,
      amountUsd: amountUsd.toString(),
      txHash,
      status: 'PENDING'
    });
    res.status(201).json({ message: 'Deposit request created' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};