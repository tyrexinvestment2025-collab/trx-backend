const CardType = require('../models/CardType');
const UserCard = require('../models/UserCard');
const CardHistory = require('../models/CardHistory');
const User = require('../models/User');
const ExchangeOrder = require('../models/ExchangeOrder');
const Notification = require('../models/Notification');
const IncomeEvent = require('../models/IncomeEvent');
const googleSheet = require('../services/googleSheetService');
const priceService = require('../services/priceService2');
const binanceService = require('../services/binanceService');
const { updateUserStatus } = require('../utils/userStatusHelper');
const { toNum, round2, dec, isObjectId } = require('../utils/money');

const SATS_IN_BTC = 100000000;
const COOLING_DAYS = Number(process.env.COOLING_DAYS) || 30;
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 30;

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
 * Записывает сделку с биржей в БД (история в админке) и в Google Sheets.
 * Ошибки логирования не должны ломать ответ пользователю.
 */
const logExchange = async ({ user, cardId, type, btcAmount, appUsd, exchangeResult, sheetType }) => {
    const ok = !!exchangeResult?.success;
    const usdt = ok ? parseFloat(exchangeResult.spentUsdt ?? exchangeResult.receivedUsdt) || 0 : 0;
    const rate = ok ? (parseFloat(exchangeResult.executedPrice) || (btcAmount ? usdt / btcAmount : 0)) : 0;
    const profit = ok ? (type === 'BUY' ? appUsd - usdt : usdt - appUsd) : 0;

    try {
        await ExchangeOrder.create({
            userId: user._id,
            cardId,
            type,
            btcAmount,
            appUsdAmount: appUsd,
            binanceUsdtAmount: usdt,
            executedPrice: rate,
            binanceOrderId: exchangeResult?.orderId ? String(exchangeResult.orderId) : undefined,
            status: ok ? 'SUCCESS' : 'FAILED',
            errorLog: ok ? undefined : exchangeResult?.error,
            profitDelta: profit
        });
    } catch (e) {
        console.error('[ExchangeOrder log error]:', e.message);
    }

    googleSheet.appendOrder({
        username: user.username || user.tgId,
        type: sheetType || type,
        btcAmount,
        appUsd,
        binanceUsdt: usdt,
        rate,
        status: ok ? 'SUCCESS' : 'FAILED',
        profit,
        orderId: exchangeResult?.orderId || 'N/A'
    });

    return { rate };
};

/**
 * ПОЛУЧИТЬ ТИПЫ КАРТ
 */
exports.getCardTypes = async (req, res) => {
    try {
        const btcPrice = priceService.getBitcoinPrice();
        if (btcPrice === null) {
            return res.status(503).json({ message: 'Market data is syncing. Please wait...' });
        }

        const types = await CardType.find({ isActive: true }).lean();
        const baseUrl = getBaseUrl(req);

        res.json(types.map(t => ({
            ...t,
            id: t._id,
            imageUrl: `${baseUrl}${t.imagePath}`,
            priceUSDT: Math.round((toNum(t.nominalSats) / SATS_IN_BTC) * btcPrice)
        })));
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
        if (!isObjectId(id)) return res.status(400).json({ message: 'Invalid collection id' });

        const btcPrice = priceService.getBitcoinPrice();
        if (btcPrice === null) return res.status(503).json({ message: 'Price feed unavailable' });

        const cardType = await CardType.findById(id).lean();
        if (!cardType) return res.status(404).json({ message: 'Collection not found' });

        const baseUrl = getBaseUrl(req);
        const nominalSats = toNum(cardType.nominalSats);
        const priceUSDT = Math.round((nominalSats / SATS_IN_BTC) * btcPrice);

        const sold = await UserCard.find({ cardTypeId: id }).select('serialNumber').lean();
        const soldSet = new Set(sold.map(s => s.serialNumber));

        const items = [];
        for (let i = 1; i <= cardType.maxSupply; i++) {
            items.push({
                serialNumber: i,
                isSold: soldSet.has(i),
                priceUSDT,
                nominalSats,
                imageUrl: `${baseUrl}${cardType.imagePath}`
            });
        }

        res.json({ collection: { ...cardType, id: cardType._id, priceUSDT }, items });
    } catch (e) {
        console.error(`[getCollectionItems Error]: ${e.message}`);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * ПОКУПКА КАРТЫ
 * Порядок: резерв тиража → атомарное списание (с проверкой баланса) → создание карты.
 * При любой ошибке после списания — компенсация (возврат денег и тиража).
 */
exports.buyCard = async (req, res) => {
    const { cardTypeId } = req.body;
    const serialNumber = Number(req.body.serialNumber);

    if (!isObjectId(cardTypeId)) return res.status(400).json({ message: 'Invalid card type', code: 'INVALID_TYPE' });
    if (!Number.isInteger(serialNumber) || serialNumber < 1) {
        return res.status(400).json({ message: 'Invalid serial number', code: 'INVALID_SERIAL' });
    }

    const btcPrice = priceService.getBitcoinPrice();
    if (btcPrice === null) return res.status(503).json({ message: 'Price unavailable', code: 'PRICE_UNAVAILABLE' });

    let stockReserved = false;
    let debited = 0;

    try {
        const type = await CardType.findById(cardTypeId);
        if (!type || !type.isActive) return res.status(404).json({ message: 'Card type not found', code: 'INVALID_TYPE' });
        if (serialNumber > type.maxSupply) return res.status(400).json({ message: 'Invalid serial number', code: 'INVALID_SERIAL' });
        if (await UserCard.exists({ cardTypeId, serialNumber })) {
            return res.status(409).json({ message: 'This serial number is already sold', code: 'SERIAL_TAKEN' });
        }

        const nominalSats = toNum(type.nominalSats);
        const btcToBuy = nominalSats / SATS_IN_BTC;
        const costUSD = round2(btcToBuy * btcPrice);

        // 1. Резервируем единицу тиража
        const reserved = await CardType.findOneAndUpdate(
            { _id: cardTypeId, isActive: true, available: { $gt: 0 } },
            { $inc: { available: -1 } }
        );
        if (!reserved) return res.status(409).json({ message: 'Sold out', code: 'SOLD_OUT' });
        stockReserved = true;

        // 2. Атомарное списание: проходит, только если денег хватает
        const user = await User.findOneAndUpdate(
            { _id: req.user._id, 'balance.walletUsd': { $gte: dec(costUSD) } },
            { $inc: { 'balance.walletUsd': dec(-costUSD) } },
            { new: true }
        );
        if (!user) {
            await CardType.updateOne({ _id: cardTypeId }, { $inc: { available: 1 } });
            stockReserved = false;
            return res.status(400).json({ message: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' });
        }
        debited = costUSD;

        // 3. Создаём карту (уникальный индекс защищает номер от двойной продажи)
        const card = await UserCard.create({
            userId: user._id,
            cardTypeId,
            serialNumber,
            nominalSats: type.nominalSats,
            purchasePriceUsd: costUSD.toFixed(2),
            imageUrl: `${getBaseUrl(req)}${type.imagePath}`,
            status: 'Inactive'
        });

        // С этого момента покупка состоялась — дальше только побочные действия
        stockReserved = false;
        debited = 0;

        await CardHistory.create({ cardTypeId, serialNumber, userId: user._id, eventType: 'PURCHASE', priceUsd: costUSD.toFixed(2) });
        await updateUserStatus(user._id);

        res.status(201).json({ message: 'Success', card });

        // 4. Хедж на бирже — после ответа, чтобы пользователь не ждал
        const exchangeResult = await binanceService.executeMarketBuy(btcToBuy);
        await logExchange({ user, cardId: card._id, type: 'BUY', btcAmount: btcToBuy, appUsd: costUSD, exchangeResult });
    } catch (e) {
        // Компенсация
        if (debited) await User.updateOne({ _id: req.user._id }, { $inc: { 'balance.walletUsd': dec(debited) } }).catch(() => {});
        if (stockReserved) await CardType.updateOne({ _id: cardTypeId }, { $inc: { available: 1 } }).catch(() => {});

        if (res.headersSent) return console.error('[buyCard post-response error]:', e.message);
        if (e.code === 11000) return res.status(409).json({ message: 'This serial number is already sold', code: 'SERIAL_TAKEN' });
        console.error('[buyCard Error]:', e);
        res.status(500).json({ message: 'Error', code: 'SERVER_ERROR' });
    }
};

/**
 * СПИСОК КАРТ ПОЛЬЗОВАТЕЛЯ
 */
exports.getMyCards = async (req, res) => {
    try {
        const baseUrl = getBaseUrl(req);
        const cards = await UserCard.find({ userId: req.user._id }).populate('cardTypeId').lean();

        res.json(cards.map(card => {
            let finalImageUrl = card.imageUrl;
            if (!finalImageUrl || !finalImageUrl.startsWith('http')) {
                if (card.cardTypeId?.imagePath) finalImageUrl = `${baseUrl}${card.cardTypeId.imagePath}`;
            } else if (finalImageUrl.startsWith('http://') && process.env.NODE_ENV === 'production') {
                finalImageUrl = finalImageUrl.replace('http://', 'https://');
            }
            return { ...card, imageUrl: finalImageUrl };
        }));
    } catch (e) { res.status(500).json({ message: 'Error fetching cards' }); }
};

/**
 * ЗАПУСК МАЙНИНГА
 * Разрешён только для купленной карты, которая ещё не запускалась (Inactive).
 * Cooling/Finished — тело карты уже возвращено/возвращается, повторный запуск запрещён.
 */
exports.startCard = async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid card id' });

        const card = await UserCard.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id, status: 'Inactive', isTrial: { $ne: true } },
            { $set: { status: 'Active', lastAccrualDate: new Date() } },
            { new: true }
        );
        if (!card) return res.status(400).json({ message: 'Card cannot be started', code: 'INVALID_STATUS' });

        await User.updateOne({ _id: req.user._id }, { $inc: { 'balance.stakingUsd': dec(toNum(card.purchasePriceUsd)) } });
        await updateUserStatus(req.user._id);

        res.json({ message: 'Mining started', card });
    } catch (e) { res.status(500).json({ message: 'Error starting card' }); }
};

/**
 * ОСТАНОВКА МАЙНИНГА (Охлаждение)
 * Тело и прибыль замораживаются в pending и выплачиваются cron-ом по окончании охлаждения.
 */
exports.stopCard = async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid card id' });

        // Читаем прибыль и атомарно переводим статус (защита от двойного нажатия)
        const current = await UserCard.findOne({ _id: req.params.id, userId: req.user._id, status: 'Active', isTrial: { $ne: true } });
        if (!current) return res.status(400).json({ message: 'Card is not active', code: 'INVALID_STATUS' });

        const profit = round2(toNum(current.currentProfitUsd));
        const purchasePrice = round2(toNum(current.purchasePriceUsd));

        const card = await UserCard.findOneAndUpdate(
            { _id: current._id, status: 'Active' },
            { $set: {
                status: 'Cooling',
                unlockAt: new Date(Date.now() + COOLING_DAYS * 24 * 60 * 60 * 1000),
                currentProfitUsd: dec(0),
                coolingPayoutUsd: dec(profit)
            } },
            { new: true }
        );
        if (!card) return res.status(409).json({ message: 'Card state changed, retry', code: 'CONFLICT' });

        await User.updateOne({ _id: req.user._id }, {
            $inc: {
                'balance.pendingWithdrawalUsd': dec(purchasePrice + profit),
                'balance.stakingUsd': dec(-purchasePrice)
            }
        });

        await CardHistory.create({
            cardTypeId: card.cardTypeId, serialNumber: card.serialNumber, userId: req.user._id,
            eventType: 'MINING_SESSION', profitUsd: profit.toFixed(2), priceUsd: purchasePrice.toFixed(2),
            startedAt: current.updatedAt, endedAt: new Date()
        }).catch(() => {});
        await updateUserStatus(req.user._id);

        res.json({ message: 'Mining stopped. Card is cooling down.', unlockAt: card.unlockAt, payoutUsd: round2(purchasePrice + profit) });
    } catch (e) { res.status(500).json({ message: 'Error stopping card' }); }
};

/**
 * ПРОДАЖА КАРТЫ ОБРАТНО СЕРВИСУ (Refund)
 * Только для купленной, ни разу не запущенной карты (Inactive).
 * Finished-карты уже вернули тело через охлаждение, пробные карты не покупались — их продавать нельзя.
 */
exports.sellCardBack = async (req, res) => {
    try {
        if (!isObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid card id' });

        // Атомарно забираем карту — второй параллельный запрос уже ничего не найдёт
        const card = await UserCard.findOneAndDelete({
            _id: req.params.id, userId: req.user._id, status: 'Inactive', isTrial: { $ne: true }
        });
        if (!card) {
            return res.status(400).json({ message: 'Card cannot be sold in its current state', code: 'INVALID_STATUS' });
        }

        const nominalBTC = toNum(card.nominalSats) / SATS_IN_BTC;
        const refundAmount = round2(toNum(card.purchasePriceUsd));

        const user = await User.findOneAndUpdate(
            { _id: req.user._id },
            { $inc: { 'balance.walletUsd': dec(refundAmount) } },
            { new: true }
        );
        await CardType.updateOne({ _id: card.cardTypeId }, { $inc: { available: 1 } });
        const soldType = await CardType.findById(card.cardTypeId).select('name').lean();
        await IncomeEvent.create({
            userId: req.user._id, type: 'CARD_REFUND', amountUsd: dec(refundAmount),
            meta: { cardId: card._id, serialNumber: card.serialNumber, cardName: soldType?.name }
        }).catch(e => console.error('[IncomeEvent]', e.message));
        await CardHistory.create({
            cardTypeId: card.cardTypeId, serialNumber: card.serialNumber, userId: req.user._id,
            eventType: 'SOLD_BACK', priceUsd: refundAmount.toFixed(2)
        }).catch(() => {});
        await updateUserStatus(req.user._id);

        const exchangeResult = await binanceService.executeMarketSell(nominalBTC);
        const { rate } = await logExchange({
            user, cardId: card._id, type: 'SELL', btcAmount: nominalBTC, appUsd: refundAmount,
            exchangeResult, sheetType: 'SELL (Refund)'
        });

        res.json({
            success: true,
            message: 'Card sold',
            amount: refundAmount.toFixed(2),
            rate: rate || priceService.getBitcoinPrice(),
            isExchangeSuccess: !!exchangeResult.success
        });
    } catch (e) {
        console.error('❌ [sellCardBack Error]:', e.message);
        res.status(500).json({ message: 'Error selling card' });
    }
};

/**
 * ИСТОРИЯ ВЛАДЕНИЯ КАРТОЙ
 */
exports.getCardHistoryBySerial = async (req, res) => {
    try {
        if (!isObjectId(req.params.typeId)) return res.status(400).json({ message: 'Invalid id' });
        const history = await CardHistory.find({
            cardTypeId: req.params.typeId,
            serialNumber: Number(req.params.serial)
        })
        .populate('userId', 'username')
        .sort({ createdAt: -1 })
        .lean();

        res.json(history);
    } catch (e) { res.status(500).json({ message: 'Error fetching history' }); }
};

/**
 * ПОДАРОЧНАЯ КАРТА
 * Подписка на канал проверяется на сервере, а не по флагу клиента.
 */
exports.activateTrialCard = async (req, res) => {
    try {
        const { isChannelMember } = require('./userController');
        const member = await isChannelMember(req.user.tgId);
        if (member === false) return res.status(403).json({ message: 'Subscribe to the channel first', code: 'NOT_SUBSCRIBED' });
        if (member === null) return res.status(503).json({ message: 'Unable to verify subscription', code: 'SUBSCRIPTION_CHECK_FAILED' });

        const user = await User.findOneAndUpdate(
            { _id: req.user._id, isTrialActivated: false },
            { $set: { isTrialActivated: true, trialActivatedAt: new Date() } },
            { new: true }
        );
        if (!user) return res.status(400).json({ message: 'Gift already claimed', code: 'ALREADY_CLAIMED' });

        const rollback = () => User.updateOne({ _id: req.user._id }, { $set: { isTrialActivated: false }, $unset: { trialActivatedAt: 1 } });

        const miniType = await CardType.findOne({ name: { $regex: /^Tyrex Mini$/i } });
        if (!miniType) {
            await rollback();
            return res.status(404).json({ message: "Series 'Tyrex Mini' not found", code: 'INVALID_TYPE' });
        }

        const baseUrl = getBaseUrl(req);
        const finalImageUrl = `${baseUrl}${miniType.imagePath}`;
        const expiryDate = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

        // Номер может перехватить параллельная покупка — пробуем несколько раз
        let trialCard = null;
        for (let attempt = 0; attempt < 5 && !trialCard; attempt++) {
            const takenCards = new Set(await UserCard.find({ cardTypeId: miniType._id }).distinct('serialNumber'));
            const free = [];
            for (let i = 1; i <= miniType.maxSupply; i++) if (!takenCards.has(i)) free.push(i);
            if (free.length === 0) break;

            const serialNumber = free[Math.floor(Math.random() * free.length)];
            try {
                trialCard = await UserCard.create({
                    userId: user._id,
                    cardTypeId: miniType._id,
                    serialNumber,
                    status: 'Active',
                    nominalSats: miniType.nominalSats,
                    purchasePriceUsd: 0,
                    isTrial: true,
                    imageUrl: finalImageUrl,
                    unlockAt: expiryDate,
                    lastAccrualDate: new Date()
                });
            } catch (e) {
                if (e.code !== 11000) throw e;
            }
        }

        if (!trialCard) {
            await rollback();
            return res.status(409).json({ message: 'All coins are taken', code: 'SOLD_OUT' });
        }

        await CardType.updateOne({ _id: miniType._id }, { $inc: { available: -1 } });
        await updateUserStatus(user._id);

        await Notification.create({
            userId: user._id,
            title: '🌟 Tyrex Mini',
            message: `#${trialCard.serialNumber}`,
            type: 'INFO',
            key: 'trial_activated',
            params: { serial: trialCard.serialNumber }
        });

        res.json({
            success: true,
            serialNumber: trialCard.serialNumber,
            message: `#${trialCard.serialNumber}`,
            card: { ...trialCard.toObject(), imageUrl: finalImageUrl }
        });
    } catch (error) {
        console.error('[Trial Error]:', error);
        res.status(500).json({ message: 'Error activating gift', code: 'SERVER_ERROR' });
    }
};
