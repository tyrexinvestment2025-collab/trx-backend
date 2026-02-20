require('dotenv').config();
const { Spot } = require('@binance/connector');

// Глобальные переменные
let currentBtcPrice = 0; // Здесь всегда будет актуальная цена
const SPREAD_PERCENT = 0.002; // 0.2% - наш запас на скачки курса и комиссию

// Клиент для торговли (API Key)
const client = new Spot(process.env.BINANCE_TESTNET_KEY, process.env.BINANCE_TESTNET_SECRET, {
    baseURL: 'https://testnet.binance.vision'
});

// Клиент для Веб-сокета (Без ключей, просто слушаем публичный канал)
const wsClient = new Spot(null, null, {
    baseURL: 'wss://testnet.binance.vision' // Адрес WS для Тестнета
});

/**
 * 1. Запуск прослушки цены (WebSockets)
 * Обновляет переменную currentBtcPrice в реальном времени
 */
function startPriceStream() {
    console.log('🔗 Подключаемся к WebSocket Binance...');
    
    // Подписываемся на тикер 'btcusdt@bookTicker' (лучшая цена покупки/продажи)
    // Это самый быстрый способ получать цену
    const callbacks = {
        open: () => console.log('✅ WebSocket открыт. Слушаем цену BTC...'),
        close: () => console.log('❌ WebSocket закрыт'),
        message: (data) => {
            const ticker = JSON.parse(data);
            // 'a' - best ask price (лучшая цена, по которой кто-то готов продать нам)
            if (ticker.a) {
                currentBtcPrice = parseFloat(ticker.a);
                // Можно раскомментировать для отладки, но будет спамить
                // console.log(`🔥 Цена обновлена: ${currentBtcPrice}`);
            }
        }
    };

    // Запускаем стрим
    wsClient.bookTickerStream('BTCUSDT', callbacks);
}

/**
 * 2. Функция покупки Карточки
 * @param {string} userId - ID юзера (из Монго)
 * @param {number} cardPriceBtc - Цена карточки в Биткоинах (например, 0.01 BTC)
 */
async function buyCardForUser(userId, cardPriceBtc) {
    if (currentBtcPrice === 0) {
        throw new Error('Цена еще не загрузилась, подождите секунду');
    }

    // 1. Считаем, сколько долларов списать с юзера
    // Добавляем спред (запас), чтобы мы не ушли в минус
    const estimatedPrice = currentBtcPrice * (1 + SPREAD_PERCENT);
    const amountToChargeUSD = cardPriceBtc * estimatedPrice;

    console.log(`\n🎫 Юзер ${userId} покупает карту за ${cardPriceBtc} BTC`);
    console.log(`📊 Биржевой курс: ${currentBtcPrice}`);
    console.log(`🛡️ Курс для клиента (+0.2%): ${estimatedPrice.toFixed(2)}`);
    console.log(`💰 Списываем с баланса: $${amountToChargeUSD.toFixed(2)}`);

    // ТУТ КОД СПИСАНИЯ ИЗ ТВОЕЙ MONGODB
    // await User.updateOne({_id: userId}, { $inc: { balanceUsd: -amountToChargeUSD } });

    try {
        // 2. Идем на Бинанс и покупаем РОВНО нужное количество BTC по рынку
        console.log('🚀 Отправляем ордер на Binance...');
        
        const response = await client.newOrder('BTCUSDT', 'BUY', 'MARKET', {
            quantity: cardPriceBtc // Покупаем конкретный объем BTC (карточку)
        });

        const executedQty = response.data.executedQty;
        const totalSpent = response.data.cummulativeQuoteQty; // Сколько реально потратили USDT

        console.log('✅ Успех!');
        console.log(`📉 Реально потрачено на бирже: $${totalSpent}`);
        console.log(`💵 Списано с клиента: $${amountToChargeUSD}`);
        
        // Считаем профит компании (разница курсов)
        const profit = amountToChargeUSD - parseFloat(totalSpent);
        console.log(`🤑 Профит сервиса на спреде: $${profit.toFixed(4)}`);

        // ТУТ ЗАПИСЬ В MONGODB ИСТОРИИ ТРАНЗАКЦИЙ

        return { success: true, txId: response.data.orderId, profit };

    } catch (error) {
        console.error('❌ Ошибка покупки:', error.response ? error.response.data.msg : error.message);
        // ТУТ ВАЖНО: Если ошибка - вернуть деньги юзеру в БД (Rollback)
        throw error;
    }
}

// === ЗАПУСК СИСТЕМЫ ===
(async () => {
    // 1. Запускаем "слушателя" цен
    startPriceStream();

    // Эмуляция: Ждем 3 секунды, пока цена подгрузится, и пробуем купить
    setTimeout(async () => {
        try {
            // Представим, что юзер покупает карту стоимостью 0.001 BTC
            await buyCardForUser('user_telegram_123', 0.001);
        } catch (e) {
            console.error(e);
        }
    }, 3000);
})();