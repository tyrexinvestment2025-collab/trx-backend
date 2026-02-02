const axios = require('axios');

let cachedPrice = {
  usd: 97000, // Актуальная примерная цена
  lastUpdated: null
};

// Список API источников в порядке приоритета
// Binance обычно самый надежный и не банит IP так часто, как CoinGecko
const sources = [
  {
    name: 'Binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    extract: (data) => parseFloat(data.price)
  },
  {
    name: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    extract: (data) => data.bitcoin.usd
  },
  {
    name: 'CoinDesk',
    url: 'https://api.coindesk.com/v1/bpi/currentprice/USD.json',
    extract: (data) => data.bpi.USD.rate_float
  }
];

const updateBitcoinPrice = async () => {
  // Пробуем источники по очереди
  for (const source of sources) {
    try {
      console.log(`[PriceService] Trying to fetch from ${source.name}...`);
      
      const response = await axios.get(source.url, {
        // Добавляем заголовок User-Agent, чтобы притвориться браузером (помогает от простых блокировок)
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
        },
        timeout: 5000 // Ждем не больше 5 секунд
      });

      const price = source.extract(response.data);

      if (price && !isNaN(price)) {
        cachedPrice.usd = price;
        cachedPrice.lastUpdated = new Date();
        console.log(`[PriceService] Success! Bitcoin price updated from ${source.name}: $${cachedPrice.usd}`);
        return; // Если успешно получили цену, выходим из функции, остальные источники не трогаем
      }
    } catch (error) {
      console.warn(`[PriceService] Failed to fetch from ${source.name}: ${error.message}`);
      // Если ошибка — цикл продолжится и попробует следующий источник
    }
  }

  console.error('[PriceService] All sources failed. Using old cached price.');
};

const getBitcoinPrice = () => {
  return cachedPrice.usd;
};

const startPriceUpdater = () => {
  updateBitcoinPrice();

  // Обновляем раз в 5 минут (Binance позволяет часто, это безопасно)
  // 5 * 60 * 1000 = 300000
  setInterval(updateBitcoinPrice, 300000);
  
  console.log('[PriceService] Multi-source price updater started.');
};

module.exports = {
  startPriceUpdater,
  getBitcoinPrice
};