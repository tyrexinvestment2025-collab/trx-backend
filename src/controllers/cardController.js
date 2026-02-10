const CardType = require('../models/CardType');
const UserCard = require('../models/UserCard');
const CardHistory = require('../models/CardHistory');
const User = require('../models/User');
const CardImage = require('../models/CardImage'); // НОВОЕ
const { getBitcoinPrice } = require('../services/priceService');
const { updateUserStatus } = require('../utils/userStatusHelper');

const parseDecimal = (value) => value ? parseFloat(value.toString()) : 0;

// Список коллекций
exports.getCardTypes = async (req, res) => {
    try {
        const cardTypes = await CardType.find({ isActive: true });
        const btcPrice = getBitcoinPrice();

        const response = await Promise.all(cardTypes.map(async card => {
            const nominalSats = parseDecimal(card.nominalSats);
            const priceUSDT = (nominalSats / 100000000) * btcPrice;
            
            // Для превью берем первую картинку из отдельной коллекции
            const firstImg = await CardImage.findOne({ cardTypeId: card._id, index: 0 });
            
            return {
                ...card.toObject(),
                nominalSats: nominalSats,
                priceUSDT: Math.round(priceUSDT),
                imageUrl: firstImg ? firstImg.imageData : ''
            };
        }));
        res.json(response);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// Список номеров внутри коллекции
exports.getCollectionItems = async (req, res) => {
    try {
        const { id } = req.params;
        const cardType = await CardType.findById(id);
        if (!cardType) return res.status(404).json({ message: 'Collection not found' });

        const btcPrice = getBitcoinPrice();
        const nominalSats = parseDecimal(cardType.nominalSats);
        const priceUSDT = Math.round((nominalSats / 100000000) * btcPrice);

        // Получаем все картинки этой коллекции
        const allImages = await CardImage.find({ cardTypeId: id }).sort({ index: 1 });
        const imagesCount = allImages.length;

        const soldCards = await UserCard.find({ cardTypeId: id }).select('serialNumber');
        const soldSet = new Set(soldCards.map(c => c.serialNumber));

        const items = [];
        for (let i = 1; i <= cardType.maxSupply; i++) {
            const imgIndex = (i - 1) % imagesCount;
            items.push({
                serialNumber: i,
                isSold: soldSet.has(i),
                priceUSDT: priceUSDT,
                nominalSats: nominalSats,
                imageUrl: allImages[imgIndex] ? allImages[imgIndex].imageData : ''
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

// Покупка карты
exports.buyCard = async (req, res) => {
    const { cardTypeId, serialNumber } = req.body;
    try {
        const user = await User.findById(req.user._id);
        const cardType = await CardType.findById(cardTypeId);
        const btcPrice = getBitcoinPrice();

        if (!cardType) return res.status(404).json({ message: 'Not found' });

        const nominalSats = parseDecimal(cardType.nominalSats);
        const costUsd = (nominalSats / 100000000) * btcPrice;

        if (parseDecimal(user.balance.walletUsd) < costUsd) {
            return res.status(400).json({ message: 'Insufficient funds' });
        }

        // Вычисляем картинку для этого номера
        const allImages = await CardImage.find({ cardTypeId: cardType._id }).sort({ index: 1 });
        const imgIndex = (serialNumber - 1) % allImages.length;
        const assignedImageUrl = allImages[imgIndex] ? allImages[imgIndex].imageData : '';

        user.balance.walletUsd = parseDecimal(user.balance.walletUsd) - costUsd;
        if (cardType.available > 0) cardType.available -= 1;
        
        await cardType.save();
        await user.save();

        const newCard = await UserCard.create({
            userId: user._id,
            cardTypeId: cardType._id,
            serialNumber: serialNumber,
            nominalSats: cardType.nominalSats.toString(),
            purchasePriceUsd: costUsd.toString(),
            imageUrl: assignedImageUrl, // Картинка теперь в UserCard навсегда
            status: 'Inactive'
        });

        await CardHistory.create({
            cardTypeId: cardType._id,
            serialNumber: serialNumber,
            userId: user._id,
            eventType: 'PURCHASE',
            priceUsd: costUsd
        });

        await updateUserStatus(user._id);
        res.status(201).json({ message: 'Success', card: newCard });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error' });
    }
};
exports.getMyCards = async (req, res) => {
    try {
        const cards = await UserCard.find({ userId: req.user._id }).populate('cardTypeId');
        res.json(cards);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

exports.sellCardBack = async (req, res) => {
    try {
        const card = await UserCard.findOne({ _id: req.params.id, userId: req.user._id });
        if (!card || card.status !== 'Inactive') return res.status(400).json({ message: 'Cannot sell' });

        const user = await User.findById(req.user._id);
        const refund = parseDecimal(card.purchasePriceUsd);

        user.balance.walletUsd = parseDecimal(user.balance.walletUsd) + refund;
        await user.save();

        const cardType = await CardType.findById(card.cardTypeId);
        if (cardType) {
            cardType.available += 1;
            await cardType.save();
        }

        await CardHistory.create({
            cardTypeId: card.cardTypeId,
            serialNumber: card.serialNumber,
            userId: user._id,
            eventType: 'SOLD_BACK',
            priceUsd: refund
        });

        await UserCard.findByIdAndDelete(card._id);
        await updateUserStatus(user._id);
        res.json({ message: 'Refunded', refund });
    } catch (error) {
        res.status(500).json({ message: 'Error' });
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