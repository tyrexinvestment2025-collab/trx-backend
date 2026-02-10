const CardType = require('../models/CardType');
const UserCard = require('../models/UserCard');
const CardHistory = require('../models/CardHistory');
const User = require('../models/User');
const { getBitcoinPrice } = require('../services/priceService');
const { updateUserStatus } = require('../utils/userStatusHelper');

const parseDecimal = (v) => v ? parseFloat(v.toString()) : 0;

const getBaseUrl = () => process.env.API_URL || 'http://localhost:5000';

exports.getCardTypes = async (req, res) => {
    try {
        const btcPrice = getBitcoinPrice();
        const types = await CardType.find({ isActive: true }).lean();
        const baseUrl = getBaseUrl();

        const response = types.map(t => ({
            ...t,
            id: t._id,
            imageUrl: `${baseUrl}${t.imagePath}`,
            priceUSDT: Math.round((parseDecimal(t.nominalSats) / 100000000) * btcPrice)
        }));
        res.json(response);
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};

exports.getCollectionItems = async (req, res) => {
    try {
        const { id } = req.params;
        const cardType = await CardType.findById(id).lean();
        const baseUrl = getBaseUrl();
        const btcPrice = getBitcoinPrice();
        const priceUSDT = Math.round((parseDecimal(cardType.nominalSats) / 100000000) * btcPrice);

        const sold = await UserCard.find({ cardTypeId: id }).select('serialNumber').lean();
        const soldSet = new Set(sold.map(s => s.serialNumber));

        const items = [];
        for (let i = 1; i <= cardType.maxSupply; i++) {
            items.push({
                serialNumber: i,
                isSold: soldSet.has(i),
                priceUSDT,
                imageUrl: `${baseUrl}${cardType.imagePath}`
            });
        }
        res.json({ collection: { ...cardType, id: cardType._id, priceUSDT }, items });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};

exports.buyCard = async (req, res) => {
    const { cardTypeId, serialNumber } = req.body;
    try {
        const user = await User.findById(req.user._id);
        const type = await CardType.findById(cardTypeId);
        const btcPrice = getBitcoinPrice();
        const baseUrl = getBaseUrl();
        const cost = (parseDecimal(type.nominalSats) / 100000000) * btcPrice;

        if (parseDecimal(user.balance.walletUsd) < cost) return res.status(400).json({ message: 'No money' });

        user.balance.walletUsd = parseDecimal(user.balance.walletUsd) - cost;
        type.available -= 1;
        await user.save();
        await type.save();

        const card = await UserCard.create({
            userId: user._id,
            cardTypeId,
            serialNumber,
            nominalSats: type.nominalSats,
            purchasePriceUsd: cost.toFixed(2),
            imageUrl: `${baseUrl}${type.imagePath}`,
            status: 'Inactive'
        });

        await CardHistory.create({ cardTypeId, serialNumber, userId: user._id, eventType: 'PURCHASE', priceUsd: cost });
        await updateUserStatus(user._id);
        res.status(201).json({ message: 'Success', card });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};

exports.getMyCards = async (req, res) => {
    try {
        const cards = await UserCard.find({ userId: req.user._id }).populate('cardTypeId').lean();
        res.json(cards);
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};
exports.startCard = async (req, res) => {
    try {
        const card = await UserCard.findOne({ _id: req.params.id, userId: req.user._id });
        card.status = 'Active';
        card.lastAccrualDate = Date.now();
        await card.save();
        const user = await User.findById(req.user._id);
        user.balance.stakingUsd = parseDecimal(user.balance.stakingUsd) + parseDecimal(card.purchasePriceUsd);
        await user.save();
        res.json({ message: 'Started', card });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};
exports.stopCard = async (req, res) => {
    try {
        const card = await UserCard.findOne({ _id: req.params.id, userId: req.user._id });
        const profit = parseDecimal(card.currentProfitUsd);
        card.status = 'Cooling';
        card.unlockAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        card.currentProfitUsd = 0;
        await card.save();
        const user = await User.findById(req.user._id);
        user.balance.pendingWithdrawalUsd = parseDecimal(user.balance.pendingWithdrawalUsd) + parseDecimal(card.purchasePriceUsd) + profit;
        user.balance.stakingUsd = Math.max(0, parseDecimal(user.balance.stakingUsd) - parseDecimal(card.purchasePriceUsd));
        await user.save();
        res.json({ message: 'Stopped' });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};
exports.sellCardBack = async (req, res) => {
    try {
        const card = await UserCard.findOne({ _id: req.params.id, userId: req.user._id });
        if (card.status !== 'Inactive') return res.status(400).json({ message: 'Mining must be stopped' });
        const user = await User.findById(req.user._id);
        user.balance.walletUsd = parseDecimal(user.balance.walletUsd) + parseDecimal(card.purchasePriceUsd);
        await user.save();
        await CardType.findByIdAndUpdate(card.cardTypeId, { $inc: { available: 1 } });
        await UserCard.findByIdAndDelete(card._id);
        res.json({ message: 'Sold' });
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};
exports.getCardHistoryBySerial = async (req, res) => {
    try {
        const history = await CardHistory.find({ cardTypeId: req.params.typeId, serialNumber: req.params.serial }).populate('userId', 'username').sort({ createdAt: -1 });
        res.json(history);
    } catch (e) { res.status(500).json({ message: 'Error' }); }
};