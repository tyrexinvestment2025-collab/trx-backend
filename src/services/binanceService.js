const { Spot } = require('@binance/connector');

const apiKey = process.env.BINANCE_TESTNET_KEY;
const apiSecret = process.env.BINANCE_TESTNET_SECRET;

// Используем Тестнет. Для реала смени URL на основной.
const client = new Spot(apiKey, apiSecret, {
    baseURL: 'https://testnet.binance.vision'
});

/**
 * Исполнение рыночной покупки BTC
 * @param {number} btcAmount - Количество BTC (не сатоши!)
 */
async function executeMarketBuy(btcAmount) {
    try {
        // Binance требует точность. BTC обычно до 5-6 знаков.
        const quantity = parseFloat(btcAmount.toFixed(6));
        
        // Минимальный ордер на Binance обычно 5-10 USDT. 
        // Если покупка слишком мелкая, биржа выдаст ошибку.
        
        const response = await client.newOrder('BTCUSDT', 'BUY', 'MARKET', {
            quantity: quantity
        });

        return {
            success: true,
            orderId: response.data.orderId,
            executedPrice: response.data.fills[0]?.price || 'Market',
            spentUsdt: response.data.cummulativeQuoteQty,
            data: response.data
        };
    } catch (error) {
        console.error('❌ [Binance Exchange Error]:', error.response ? error.response.data.msg : error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Исполнение рыночной продажи BTC (когда юзер продает карту назад)
 */
async function executeMarketSell(btcAmount) {
    try {
        const quantity = parseFloat(btcAmount.toFixed(6));
        const response = await client.newOrder('BTCUSDT', 'SELL', 'MARKET', {
            quantity: quantity
        });

        return {
            success: true,
            orderId: response.data.orderId,
            receivedUsdt: response.data.cummulativeQuoteQty,
            data: response.data
        };
    } catch (error) {
        console.error('❌ [Binance Exchange Error]:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { executeMarketBuy, executeMarketSell };