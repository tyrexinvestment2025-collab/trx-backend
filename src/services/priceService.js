const axios = require('axios');

// Переменная для хранения кешированной цены
let cachedPrice = {
  usd: 65000, // Стартовое значение на случай, если первый запрос не удастся
  lastUpdated: null
};

// Функция, которая делает запрос к CoinGecko и обновляет кеш
const updateBitcoinPrice = async () => {
  try {
    console.log('[PriceService] Fetching new Bitcoin price...');
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    
    if (response.data && response.data.bitcoin && response.data.bitcoin.usd) {
      cachedPrice.usd = response.data.bitcoin.usd;
      cachedPrice.lastUpdated = new Date();
      console.log(`[PriceService] New Bitcoin price updated: $${cachedPrice.usd}`);
    }
  } catch (error) {
    // Если CoinGecko недоступен, мы просто логируем ошибку и продолжаем использовать старую цену
    console.error('[PriceService] Error fetching Bitcoin price:', error.message);
  }
};

// Функция, которую будут вызывать наши контроллеры, чтобы получить цену
const getBitcoinPrice = () => {
  return cachedPrice.usd;
};

// Функция для запуска периодического обновления
const startPriceUpdater = () => {
  // 1. Сразу же обновляем цену при старте сервера
  updateBitcoinPrice();

  // 2. Устанавливаем интервал для обновления каждые 10 минут
  // 10 минут * 60 секунд * 1000 миллисекунд = 600000
  setInterval(updateBitcoinPrice, 600000);
  
  console.log('[PriceService] Bitcoin price updater started. Interval: 10 minutes.');
};

module.exports = {
  startPriceUpdater,
  getBitcoinPrice
};