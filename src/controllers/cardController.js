const CardType = require('../models/CardType');
const UserCard = require('../models/UserCard');
const CardHistory = require('../models/CardHistory');
const User = require('../models/User');
const ExchangeOrder = require('../models/ExchangeOrder'); // Импорт новой модели
const googleSheet = require('../services/googleSheetService'); // Добавлено

// Импортируем Singleton сервис цены
const priceService = require('../services/priceService2'); 
const { updateUserStatus } = require('../utils/userStatusHelper');
const binanceService = require('../services/binanceService'); // НОВОЕ

/**
 * Утилита для безопасной работы с числами
 */
const parseDecimal = (v) => v ? parseFloat(v.toString()) : 0;

/**
 * Хелпер для формирования базового URL (поддержка HTTPS на Render)
 */
const getBaseUrl = (req) => {
    if (process.env.NODE_ENV === 'production' && req) {
        return `https://${req.get('host')}`;
    }
    return process.env.API_URL || 'http://localhost:5000'; 
};

/**
 * ПОЛУЧИТЬ ТИПЫ КАРТ
 * Пересчитывает стоимость в USDT на лету по актуальному курсу
 */
exports.getCardTypes = async (req, res) => {
    try {
        const btcPrice = priceService.getBitcoinPrice();
        
        // Защита: если цена не получена от биржи, не даем пользователю видеть витрину
        if (btcPrice === null) {
            return res.status(503).json({ message: 'Market data is syncing. Please wait...' });
        }

        const types = await CardType.find({ isActive: true }).lean();
        const baseUrl = getBaseUrl(req);

        const response = types.map(t => ({
            ...t,
            id: t._id,
            imageUrl: `${baseUrl}${t.imagePath}`,
            // Расчет: (сатоши / 100 млн) * цена BTC
            priceUSDT: Math.round((parseDecimal(t.nominalSats) / 100000000) * btcPrice)
        }));

        res.json(response);
    } catch (e) { 
        console.error(`[getCardTypes Error]: ${e.message}`);
        res.status(500).json({ message: 'Server Error' }); 
    }
};

/**
 * ПОЛУЧИТЬ ЭЛЕМЕНТЫ КОЛЛЕКЦИИ (Конкретные номера карт)
 */
exports.getCollectionItems = async (req, res) => {
    try {
        const { id } = req.params;
        const btcPrice = priceService.getBitcoinPrice();

        if (btcPrice === null) {
            return res.status(503).json({ message: 'Price feed unavailable' });
        }

        const cardType = await CardType.findById(id).lean();
        if (!cardType) return res.status(404).json({ message: 'Collection not found' });

        const baseUrl = getBaseUrl(req);
        const priceUSDT = Math.round((parseDecimal(cardType.nominalSats) / 100000000) * btcPrice);

        const sold = await UserCard.find({ cardTypeId: id }).select('serialNumber').lean();
        const soldSet = new Set(sold.map(s => s.serialNumber));

const items = [];
const nominalSats = parseDecimal(cardType.nominalSats); // Берем из типа карты

for (let i = 1; i <= cardType.maxSupply; i++) {
    items.push({
        serialNumber: i,
        isSold: soldSet.has(i),
        priceUSDT,
        nominalSats, // ОБЯЗАТЕЛЬНО ДОБАВЛЯЕМ СЮДА
        imageUrl: `${baseUrl}${cardType.imagePath}`
    });
}

        res.json({ 
            collection: { ...cardType, id: cardType._id, priceUSDT }, 
            items 
        });
    } catch (e) { 
        console.error(`[getCollectionItems Error]: ${e.message}`);
        res.status(500).json({ message: 'Server Error' }); 
    }
};

/**
 * ПОКУПКА КАРТЫ (С логированием статистики)
 */
exports.buyCard = async (req, res) => {
    const { cardTypeId, serialNumber } = req.body;
    try {
        const btcPrice = priceService.getBitcoinPrice();
        if (btcPrice === null) return res.status(503).json({ message: 'Price unavailable' });

        const user = await User.findById(req.user._id);
        const type = await CardType.findById(cardTypeId);
        
        const nominalSats = parseDecimal(type.nominalSats);
        const btcToBuy = nominalSats / 100000000;
        const costUSD = btcToBuy * btcPrice;

        if (parseDecimal(user.balance.walletUsd) < costUSD) return res.status(400).json({ message: 'No money' });

        // 1. Внутренние операции БД
        user.balance.walletUsd = (parseDecimal(user.balance.walletUsd) - costUSD).toFixed(2);
        type.available -= 1;
        await user.save();
        await type.save();

        const baseUrl = getBaseUrl(req);
        const card = await UserCard.create({
            userId: user._id, cardTypeId, serialNumber,
            nominalSats: type.nominalSats,
            purchasePriceUsd: costUSD.toFixed(2),
            imageUrl: `${baseUrl}${type.imagePath}`,
            status: 'Inactive'
        });

        // 2. Исполнение ордера на Binance
        const exchangeResult = await binanceService.executeMarketBuy(btcToBuy);

        // 3. ЛАЙВ-ЗАПИСЬ В GOOGLE SHEETS
        // Вызываем без await, чтобы не заставлять юзера ждать ответа от гугла
        googleSheet.appendOrder({
            username: user.username || user.tgId,
            type: 'BUY',
            btcAmount: btcToBuy,
            appUsd: costUSD,
            binanceUsdt: exchangeResult.success ? parseFloat(exchangeResult.spentUsdt) : 0,
            rate: exchangeResult.success ? parseFloat(exchangeResult.executedPrice) : 0,
            status: exchangeResult.success ? 'SUCCESS' : 'FAILED',
            profit: exchangeResult.success ? (costUSD - parseFloat(exchangeResult.spentUsdt)) : 0,
            orderId: exchangeResult.orderId
        });

        // 4. История и логи
        await CardHistory.create({ cardTypeId, serialNumber, userId: user._id, eventType: 'PURCHASE', priceUsd: costUSD.toFixed(2) });
        await updateUserStatus(user._id);

        res.status(201).json({ message: 'Success', card });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};

/**
 * СПИСОК КАРТ ПОЛЬЗОВАТЕЛЯ
 */
exports.getMyCards = async (req, res) => {
    try {
        const baseUrl = getBaseUrl(req);
        const cards = await UserCard.find({ userId: req.user._id }).populate('cardTypeId').lean();

        const processedCards = cards.map(card => {
            let finalImageUrl = card.imageUrl;
            if (!finalImageUrl || !finalImageUrl.startsWith('http')) {
                if (card.cardTypeId && card.cardTypeId.imagePath) {
                    finalImageUrl = `${baseUrl}${card.cardTypeId.imagePath}`;
                }
            } 
            else if (finalImageUrl.startsWith('http://') && process.env.NODE_ENV === 'production') {
                finalImageUrl = finalImageUrl.replace('http://', 'https://');
            }
            
            return { ...card, imageUrl: finalImageUrl };
        });

        res.json(processedCards);
    } catch (e) { res.status(500).json({ message: 'Error fetching cards' }); }
};

/**
 * ЗАПУСК МАЙНИНГА (Стейкинг)
 */
exports.startCard = async (req, res) => {
    try {
        const card = await UserCard.findOne({ _id: req.params.id, userId: req.user._id });
        if (!card) return res.status(404).json({ message: 'Card not found' });
        if (card.status === 'Active') return res.status(400).json({ message: 'Already active' });

        card.status = 'Active';
        card.lastAccrualDate = Date.now();
        
        const user = await User.findById(card.userId); 
        user.balance.stakingUsd = (parseDecimal(user.balance.stakingUsd) + parseDecimal(card.purchasePriceUsd)).toFixed(2);
        
        await Promise.all([card.save(), user.save()]);
        
        res.json({ message: 'Mining started', card });
    } catch (e) { res.status(500).json({ message: 'Error starting card' }); }
};

/**
 * ОСТАНОВКА МАЙНИНГА (Охлаждение)
 */
exports.stopCard = async (req, res) => {
    try {
        const card = await UserCard.findOne({ _id: req.params.id, userId: req.user._id });
        if (!card || card.status !== 'Active') return res.status(400).json({ message: 'Card is not active' });

        const profit = parseDecimal(card.currentProfitUsd);
        const purchasePrice = parseDecimal(card.purchasePriceUsd);

        card.status = 'Cooling';
        card.unlockAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
        card.currentProfitUsd = 0; 
        
        const user = await User.findById(card.userId); 
        // Возвращаем тело карты и накопленный профит в ожидание
        user.balance.pendingWithdrawalUsd = (parseDecimal(user.balance.pendingWithdrawalUsd) + purchasePrice + profit).toFixed(2);
        user.balance.stakingUsd = Math.max(0, parseDecimal(user.balance.stakingUsd) - purchasePrice).toFixed(2);
        
        await Promise.all([card.save(), user.save()]);
        res.json({ message: 'Mining stopped. Card is cooling down.' });
    } catch (e) { res.status(500).json({ message: 'Error stopping card' }); }
};

/**
 * ПРОДАЖА КАРТЫ ОБРАТНО СЕРВИСУ (Refund)
 */
/**
 * ПРОДАЖА КАРТЫ ОБРАТНО СЕРВИСУ (Refund)
 * С продажей BTC на бирже и записью в Google Таблицу
 */
exports.sellCardBack = async (req, res) => {
    try {
        const card = await UserCard.findOne({ _id: req.params.id, userId: req.user._id });
        
        // Защита: продать можно только неактивную карту (майнинг должен быть остановлен)
        if (!card || card.status !== 'Inactive') {
            return res.status(400).json({ message: 'Mining must be stopped before selling back' });
        }

        const user = await User.findById(card.userId); 
        const nominalBTC = parseDecimal(card.nominalSats) / 100000000;
        const refundAmount = parseDecimal(card.purchasePriceUsd); // Сумма возврата (сколько он платил при покупке)

        // 1. Финансовая операция в приложении: Возвращаем доллары на кошелек юзера
        const balanceBefore = parseDecimal(user.balance.walletUsd);
        user.balance.walletUsd = (balanceBefore + refundAmount).toFixed(2);
        
        // 2. ОПЕРАЦИЯ НА БИРЖЕ: Продаем BTC на Binance, чтобы вернуть ликвидность в USDT
        console.log(`[Exchange] Selling ${nominalBTC.toFixed(8)} BTC back to Binance...`);
        const exchangeResult = await binanceService.executeMarketSell(nominalBTC);

        // 3. Сохраняем изменения в БД и удаляем карту
        await user.save();
        await CardType.findByIdAndUpdate(card.cardTypeId, { $inc: { available: 1 } });
        await UserCard.findByIdAndDelete(card._id);

        // 4. LIVE ЗАПИСЬ В GOOGLE SHEETS
        // Здесь profit = (сколько реально получили с биржи в USDT - сколько отдали юзеру в USD)
        const realReceivedUsdt = exchangeResult.success ? parseFloat(exchangeResult.receivedUsdt) : 0;
        
        googleSheet.appendOrder({
            username: user.username || user.tgId,
            type: 'SELL (Refund)',
            btcAmount: nominalBTC,
            appUsd: refundAmount,
            binanceUsdt: realReceivedUsdt,
            rate: exchangeResult.success ? (realReceivedUsdt / nominalBTC).toFixed(2) : 0,
            status: exchangeResult.success ? 'SUCCESS' : 'FAILED',
            profit: exchangeResult.success ? (realReceivedUsdt - refundAmount) : 0,
            orderId: exchangeResult.orderId || 'N/A'
        });

        // Лог в консоль сервера
        console.log(`
        ==================================================
        📉 [REFUND & SELL BACK COMPLETED]
        ==================================================
        👤 User:      ${user.username || user.tgId}
        📦 Volume:    ${nominalBTC.toFixed(8)} BTC
        💵 Refunded:  $${refundAmount.toFixed(2)} USD
        🏛️ Binance:   ${exchangeResult.success ? '✅ Sold for $' + realReceivedUsdt : '❌ Failed'}
        📊 PNL:       $${(realReceivedUsdt - refundAmount).toFixed(4)}
        ==================================================
        `);

        res.json({ 
            message: 'Card sold back successfully', 
            refundAmount, 
            exchange: exchangeResult.success 
        });

    } catch (e) { 
        console.error('❌ [sellCardBack Error]:', e.message);
        res.status(500).json({ message: 'Error during sell back' }); 
    }
};

/**
 * ИСТОРИЯ ВЛАДЕНИЯ КАРТОЙ
 */
exports.getCardHistoryBySerial = async (req, res) => {
    try {
        const history = await CardHistory.find({ 
            cardTypeId: req.params.typeId, 
            serialNumber: req.params.serial 
        })
        .populate('userId', 'username')
        .sort({ createdAt: -1 })
        .lean();
        
        res.json(history);
    } catch (e) { res.status(500).json({ message: 'Error fetching history' }); }
};