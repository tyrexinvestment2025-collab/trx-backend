const CardType = require('../models/CardType');
const UserCard = require('../models/UserCard');
const CardHistory = require('../models/CardHistory');
const User = require('../models/User');
const { getBitcoinPrice } = require('../services/priceService');
const { updateUserStatus } = require('../utils/userStatusHelper');

const parseDecimal = (value) => value ? parseFloat(value.toString()) : 0;

// ... (getCardTypes, getCollectionItems, getMyCards - БЕЗ ИЗМЕНЕНИЙ)
exports.getCardTypes = async (req, res) => {
    try {
      const cardTypes = await CardType.find({ isActive: true });
      const btcPrice = getBitcoinPrice();
  
      const response = cardTypes.map(card => {
        const nominalSats = parseDecimal(card.nominalSats);
        const priceUSDT = (nominalSats / 100000000) * btcPrice;
        return {
          ...card.toObject(),
          nominalSats: nominalSats,
          priceUSDT: Math.round(priceUSDT)
        };
      });
      res.json(response);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server Error' });
    }
};

exports.getCollectionItems = async (req, res) => {
    try {
        const { id } = req.params;
        const cardType = await CardType.findById(id);
        if (!cardType) return res.status(404).json({ message: 'Collection not found' });

        const btcPrice = getBitcoinPrice();
        const nominalSats = parseDecimal(cardType.nominalSats);
        const priceUSDT = Math.round((nominalSats / 100000000) * btcPrice);

        const soldCards = await UserCard.find({ cardTypeId: id }).select('serialNumber');
        const soldSet = new Set(soldCards.map(c => c.serialNumber));

        const items = [];
        for (let i = 1; i <= cardType.maxSupply; i++) {
            items.push({
                serialNumber: i,
                isSold: soldSet.has(i),
                priceUSDT: priceUSDT, 
                nominalSats: nominalSats
            });
        }

        res.json({
            collection: { ...cardType.toObject(), priceUSDT },
            items
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.getMyCards = async (req, res) => {
    try {
      const cards = await UserCard.find({ userId: req.user._id }).populate('cardTypeId');
      res.json(JSON.parse(JSON.stringify(cards)));
    } catch (error) {
      res.status(500).json({ message: 'Server Error' });
    }
};

// --- ПОКУПКА (С ЗАПИСЬЮ В ИСТОРИЮ) ---
exports.buyCard = async (req, res) => {
  const { cardTypeId, serialNumber } = req.body;

  try {
    const user = await User.findById(req.user._id);
    const cardType = await CardType.findById(cardTypeId);
    const btcPrice = getBitcoinPrice();

    if (!cardType) return res.status(404).json({ message: 'Card type not found' });
    if (serialNumber < 1 || serialNumber > cardType.maxSupply) return res.status(400).json({ message: 'Invalid serial number' });

    const existingCard = await UserCard.findOne({ cardTypeId, serialNumber });
    if (existingCard) return res.status(400).json({ message: `Serial #${serialNumber} is already sold out` });

    const nominalSats = parseDecimal(cardType.nominalSats);
    const costUsd = (nominalSats / 100000000) * btcPrice;
    const userWalletUsd = parseDecimal(user.balance.walletUsd);

    if (userWalletUsd < costUsd) {
      return res.status(400).json({ message: `Insufficient funds.` });
    }

    // Списание
    user.balance.walletUsd = userWalletUsd - costUsd;
    
    // Уменьшаем available
    if (cardType.available > 0) {
        cardType.available -= 1;
        await cardType.save();
    }
    await user.save();

    // Создаем карту
    const newCard = await UserCard.create({
      userId: user._id,
      cardTypeId: cardType._id,
      serialNumber: serialNumber,
      nominalSats: cardType.nominalSats.toString(),
      purchasePriceUsd: costUsd.toString(),
      status: 'Inactive', 
      lastAccrualDate: Date.now()
    });

    // ИСТОРИЯ: Покупка
    await CardHistory.create({
        cardTypeId: cardType._id,
        serialNumber: serialNumber,
        userId: user._id,
        eventType: 'PURCHASE',
        priceUsd: costUsd,
        endedAt: Date.now()
    });

    await updateUserStatus(user._id);

    res.status(201).json({ message: `Tyrex #${serialNumber} purchased`, card: newCard });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) return res.status(400).json({ message: 'Already bought.' });
    res.status(500).json({ message: 'Transaction failed' });
  }
};


// --- ПРОДАЖА СИСТЕМЕ (НОВОЕ) ---
exports.sellCardBack = async (req, res) => {
    try {
        const { id } = req.params; // ID карты UserCard
        
        const card = await UserCard.findOne({ _id: id, userId: req.user._id });
        if (!card) return res.status(404).json({ message: 'Card not found' });

        // Продавать можно только Inactive (остановить майнинг сначала)
        if (card.status !== 'Inactive') {
            return res.status(400).json({ message: 'Stop mining first to sell' });
        }

        const user = await User.findById(req.user._id);
        const refundAmount = parseDecimal(card.purchasePriceUsd); // Возвращаем по цене покупки

        // 1. Возврат денег
        const currentWallet = parseDecimal(user.balance.walletUsd);
        user.balance.walletUsd = currentWallet + refundAmount;
        await user.save();

        // 2. Возврат карты в пул (увеличиваем available)
        const cardType = await CardType.findById(card.cardTypeId);
        if (cardType) {
            if (cardType.available < cardType.maxSupply) {
                cardType.available += 1;
                await cardType.save();
            }
        }

        // 3. Запись в историю
        await CardHistory.create({
            cardTypeId: card.cardTypeId,
            serialNumber: card.serialNumber,
            userId: user._id,
            eventType: 'SOLD_BACK',
            priceUsd: refundAmount,
            endedAt: Date.now()
        });

        // 4. Удаление физической карты у пользователя
        await UserCard.findByIdAndDelete(id);
        
        await updateUserStatus(user._id);

        res.json({ message: 'Card sold back to system', refundAmount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// --- ПОЛУЧЕНИЕ ИСТОРИИ (ПО НОМЕРУ) ---
exports.getCardHistoryBySerial = async (req, res) => {
    try {
        const { typeId, serial } = req.params;
        
        const history = await CardHistory.find({ 
            cardTypeId: typeId, 
            serialNumber: parseInt(serial) 
        })
        .populate('userId', 'username tgId') // Для отображения ников
        .sort({ createdAt: -1 });

        res.json(history);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};


// --- СТАНДАРТНЫЕ МЕТОДЫ (Start/Stop) ---
exports.startCard = async (req, res) => {
    try {
      const cardId = req.params.id;
      const card = await UserCard.findOne({ _id: cardId, userId: req.user._id });
  
      if (!card || card.status !== 'Inactive') return res.status(400).json({ message: 'Error starting' });
  
      card.status = 'Active';
      card.lastAccrualDate = Date.now();
      await card.save();
  
      const user = await User.findById(req.user._id);
      const purchasePrice = parseDecimal(card.purchasePriceUsd);
      user.balance.stakingUsd = parseDecimal(user.balance.stakingUsd) + purchasePrice;
      await user.save();
  
      res.json({ message: 'Mining started', card });
    } catch (error) {
      res.status(500).json({ message: 'Server Error' });
    }
};

exports.stopCard = async (req, res) => {
  try {
    const cardId = req.params.id;
    const card = await UserCard.findOne({ _id: cardId, userId: req.user._id });

    if (!card || card.status !== 'Active') return res.status(400).json({ message: 'Error stopping' });

    const now = new Date();
    const unlockDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const profitUsd = parseDecimal(card.currentProfitUsd);
    
    // ИСТОРИЯ МАЙНИНГА
    const durationMs = now - new Date(card.lastAccrualDate); 
    const durationDays = Math.max(0, Math.floor(durationMs / (1000 * 60 * 60 * 24)));

    await CardHistory.create({
        cardTypeId: card.cardTypeId,
        serialNumber: card.serialNumber,
        userId: req.user._id,
        eventType: 'MINING_SESSION',
        profitUsd: profitUsd,
        startedAt: card.lastAccrualDate,
        endedAt: now,
        durationDays: durationDays
    });

    card.status = 'Cooling';
    card.unlockAt = unlockDate;
    card.coolingStartedAt = now;
    card.currentProfitUsd = 0; 
    await card.save();

    const user = await User.findById(req.user._id);
    const purchasePrice = parseDecimal(card.purchasePriceUsd);
    
    // Баланс
    let currentStaking = parseDecimal(user.balance.stakingUsd);
    user.balance.stakingUsd = Math.max(0, currentStaking - purchasePrice);
    
    user.balance.pendingWithdrawalUsd = parseDecimal(user.balance.pendingWithdrawalUsd) + purchasePrice + profitUsd;
    
    await user.save();

    res.json({ message: 'Stopped', unlockAt: unlockDate });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};