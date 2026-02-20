require('dotenv').config();
const { Spot } = require('@binance/connector');

// 1. Инициализация (ключи из .env)
const apiKey = process.env.BINANCE_TESTNET_KEY;
const apiSecret = process.env.BINANCE_TESTNET_SECRET;

const client = new Spot(apiKey, apiSecret, {
  baseURL: 'https://testnet.binance.vision',
});

/**
 * Функция для проверки баланса (BTC и USDT)
 */
async function checkBalance() {
  try {
    const response = await client.account();
    const balances = response.data.balances;
    
    // Фильтруем только нужные монеты
    const myCoins = balances.filter(coin => coin.asset === 'BTC' || coin.asset === 'USDT');

    console.log('💰 --- ТЕКУЩИЙ БАЛАНС ---');
    myCoins.forEach(coin => {
        console.log(`${coin.asset}: ${coin.free}`);
    });
    console.log('------------------------\n');
    return myCoins; // Возвращаем балансы, чтобы можно было использовать их в логике

  } catch (error) {
    console.error('Ошибка проверки баланса:', error.message);
  }
}

/**
 * Функция ПРОДАЖИ Bitcoin (BTC) за USDT по рынку
 * @param {number} quantityBtc - Сколько БИТКОИНОВ продать (например, 0.001)
 */
async function sellBitcoin(quantityBtc) {
  try {
    console.log(`📉 Продаем ${quantityBtc} BTC по рынку...`);

    const response = await client.newOrder('BTCUSDT', 'SELL', 'MARKET', {
      quantity: quantityBtc, // Внимание: при продаже указываем количество монет (BTC)
    });

    console.log('✅ Ордер на продажу исполнен!');
    console.log(`💵 Получено USDT (примерно): ${response.data.cummulativeQuoteQty}`);
    console.log(`📤 Продано BTC: ${response.data.executedQty}\n`);

  } catch (error) {
    // Если ошибка "Account has insufficient balance" - значит вы пытаетесь продать больше, чем есть
    if (error.response) {
        console.error('❌ Ошибка API:', error.response.data.msg);
    } else {
        console.error('❌ Ошибка выполнения:', error.message);
    }
  }
}

// === ГЛАВНЫЙ СЦЕНАРИЙ ===
(async () => {
    // 1. Смотрим баланс ДО продажи
    console.log('1. Проверка ДО продажи:');
    await checkBalance();

    // 2. Продаем 0.0005 BTC 
    // (Убедитесь, что у вас есть столько на балансе после покупки!)
    console.log('2. Выполнение продажи:');
    await sellBitcoin(0.0005);

    // 3. Смотрим баланс ПОСЛЕ продажи
    console.log('3. Проверка ПОСЛЕ продажи:');
    await checkBalance();
})();