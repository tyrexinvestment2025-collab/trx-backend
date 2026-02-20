require('dotenv').config();
const { Spot } = require('@binance/connector');

// 1. Инициализация
const apiKey = process.env.BINANCE_TESTNET_KEY;
const apiSecret = process.env.BINANCE_TESTNET_SECRET;

const client = new Spot(apiKey, apiSecret, {
  baseURL: 'https://testnet.binance.vision',
});

/**
 * Функция для проверки текущего баланса
 */
async function checkBalance() {
  try {
    const response = await client.account();
    const balances = response.data.balances;

    // Оставляем только BTC и USDT, чтобы не мусорить в консоли
    const myCoins = balances.filter(coin => coin.asset === 'BTC' || coin.asset === 'USDT');

    console.log('💰 --- ВАШ БАЛАНС ---');
    myCoins.forEach(coin => {
        // free - доступные средства, locked - в открытых ордерах
        console.log(`${coin.asset}: ${coin.free}`);
    });
    console.log('----------------------\n');

  } catch (error) {
    console.error('Ошибка при проверке баланса:', error.message);
  }
}

/**
 * Функция покупки
 */
async function buyBitcoin(amountUsdt) {
  try {
    console.log(`🛒 Покупаем BTC на ${amountUsdt} USDT...`);
    
    const response = await client.newOrder('BTCUSDT', 'BUY', 'MARKET', {
      quoteOrderQty: amountUsdt,
    });
    
    console.log(`✅ Успешно! Куплено: ${response.data.executedQty} BTC`);
    console.log(`💸 Потрачено: ${response.data.cummulativeQuoteQty} USDT\n`);

  } catch (error) {
    console.error('Ошибка покупки:', error.response ? error.response.data.msg : error.message);
  }
}

// === ГЛАВНЫЙ СЦЕНАРИЙ ===
(async () => {
    // 1. Смотрим баланс до сделки
    console.log('1. Проверка ДО покупки:');
    await checkBalance();

    // 2. Делаем покупку
    console.log('2. Выполнение сделки:');
    await buyBitcoin(50);

    // 3. Смотрим баланс после сделки (чтобы увидеть разницу)
    console.log('3. Проверка ПОСЛЕ покупки:');
    await checkBalance();
})();