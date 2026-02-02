const CardType = require('../models/CardType');
const UserCard = require('../models/UserCard');
const User = require('../models/User');
const { getBitcoinPrice } = require('../services/priceService');
const { updateUserStatus } = require('../utils/userStatusHelper');

// Получить типы карт для магазина
exports.getCardTypes = async (req, res) => {
  try {
    const cardTypes = await CardType.find({ isActive: true });
    const btcPrice = getBitcoinPrice();

    const response = cardTypes.map(card => {
      const nominalSats = parseFloat(card.nominalSats.toString());
      // Расчет цены в USD на лету по курсу
      const priceUSDT = (nominalSats / 100000000) * btcPrice;
      
      const cardObject = card.toObject();
      cardObject.priceUSDT = Math.round(priceUSDT); // Округляем цену
      return cardObject;
    });

    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Получить мои карты
exports.getMyCards = async (req, res) => {
  try {
    const cards = await UserCard.find({ userId: req.user._id }).populate('cardTypeId');
    res.json(JSON.parse(JSON.stringify(cards)));
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

// Покупка карты (в инвентарь)
exports.buyCard = async (req, res) => {
  const { cardTypeId } = req.body;

  try {
    const user = await User.findById(req.user._id);
    const cardType = await CardType.findById(cardTypeId);
    const btcPrice = getBitcoinPrice();

    if (!cardType) return res.status(404).json({ message: 'Card type not found' });
    if (cardType.available <= 0) return res.status(400).json({ message: 'Sold out' });

    const nominalSats = parseFloat(cardType.nominalSats.toString());
    const costUsd = (nominalSats / 100000000) * btcPrice;

    const userWalletUsd = parseFloat(user.balance.walletUsd.toString());

    if (userWalletUsd < costUsd) {
      return res.status(400).json({ 
        message: `Insufficient funds. Need $${costUsd.toFixed(2)}, have $${userWalletUsd.toFixed(2)}` 
      });
    }

    // 1. Списываем с кошелька (Wallet)
    user.balance.walletUsd = userWalletUsd - costUsd;
    
    // ВАЖНО: Мы НЕ добавляем в stakingUsd здесь. Карта просто лежит.

    // 2. Уменьшаем наличие в магазине
    cardType.available -= 1;
    
    await cardType.save();
    await user.save();

    // 3. Создаем карту (Статус Inactive)
    const newCard = await UserCard.create({
      userId: user._id,
      cardTypeId: cardType._id,
      nominalSats: cardType.nominalSats.toString(),
      purchasePriceUsd: costUsd.toString(),
      currentProfitUsd: '0.0',
      currentProfitSats: '0.0',
      status: 'Inactive', // Карта ожидает запуска
      lastAccrualDate: Date.now()
    });

    await updateUserStatus(user._id);

    res.status(201).json({ message: 'Card purchased successfully', card: newCard });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Transaction failed' });
  }
};

// Запуск карты (Start Mining)
exports.startCard = async (req, res) => {
    try {
      const cardId = req.params.id;
      const card = await UserCard.findOne({ _id: cardId, userId: req.user._id });
  
      if (!card) return res.status(404).json({ message: 'Card not found' });
      if (card.status !== 'Inactive') return res.status(400).json({ message: 'Card is not Inactive' });
  
      // 1. Активируем карту
      card.status = 'Active';
      card.lastAccrualDate = Date.now();
      await card.save();
  
      // 2. Добавляем стоимость карты в баланс майнинга (stakingUsd)
      const user = await User.findById(req.user._id);
      const purchasePrice = parseFloat(card.purchasePriceUsd.toString());
      const currentStaking = parseFloat(user.balance.stakingUsd.toString());
      
      user.balance.stakingUsd = currentStaking + purchasePrice;
      await user.save();
  
      await updateUserStatus(user._id);
  
      res.json({ message: 'Mining started', card });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server Error' });
    }
};

// Остановка карты
exports.stopCard = async (req, res) => {
  try {
    const cardId = req.params.id;
    const card = await UserCard.findOne({ _id: cardId, userId: req.user._id });

    if (!card) return res.status(404).json({ message: 'Card not found' });
    if (card.status !== 'Active') return res.status(400).json({ message: 'Not active' });

    const now = new Date();
    // Разморозка до 1-го числа следующего месяца
    const unlockDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    // 1. Меняем статус на Cooling
    card.status = 'Cooling';
    card.unlockAt = unlockDate;
    card.coolingStartedAt = now;
    await card.save();

    const user = await User.findById(req.user._id);
    
    // 2. Снимаем со стейкинга (Mining Capital)
    const purchasePrice = parseFloat(card.purchasePriceUsd.toString());
    const currentStaking = parseFloat(user.balance.stakingUsd.toString());
    
    // Защита от отрицательного баланса
    user.balance.stakingUsd = (currentStaking - purchasePrice) < 0 ? 0 : currentStaking - purchasePrice;
    
    // 3. Добавляем в Pending (Тело + Профит)
    const profitUsd = parseFloat(card.currentProfitUsd.toString());
    const totalToUnlock = purchasePrice + profitUsd;

    const currentPending = parseFloat(user.balance.pendingWithdrawalUsd.toString());
    user.balance.pendingWithdrawalUsd = currentPending + totalToUnlock;
    
    await user.save();
    await updateUserStatus(user._id);

    res.json({ message: 'Stopped', unlockAt: unlockDate });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};