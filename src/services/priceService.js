const axios = require('axios');

let cachedPrice = {
  usd: 97000, // Примерная цена
  lastUpdated: null
};

// Новые источники, отобранные специально для серверов в США и Shared Hosting
const sources = [
  {
    name: 'Coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    extract: (data) => parseFloat(data.data.amount)
  },
  {
    name: 'Blockchain.info',
    url: 'https://blockchain.info/ticker',
    extract: (data) => data.USD.last
  },
  {
    name: 'CoinCap',
    url: 'https://api.coincap.io/v2/assets/bitcoin',
    extract: (data) => parseFloat(data.data.priceUsd)
  },
  {
    name: 'KuCoin', // Тоже часто работает, запасной вариант
    url: 'https://api.kucoin.com/api/v1/market/stats?symbol=BTC-USDT',
    extract: (data) => parseFloat(data.data.last)
  }
];

const updateBitcoinPrice = async () => {
  for (const source of sources) {
    try {
      // Таймаут 4 секунды, чтобы не висеть долго, если сайт тупит
      const response = await axios.get(source.url, { timeout: 4000 });
      
      const price = source.extract(response.data);

      if (price && !isNaN(price)) {
        cachedPrice.usd = price;
        cachedPrice.lastUpdated = new Date();
        console.log(`[PriceService] Success! Updated from ${source.name}: $${cachedPrice.usd}`);
        return; // Успех - выходим
      }
    } catch (error) {
      // Логируем коротко, чтобы не засорять консоль
      const status = error.response ? error.response.status : error.code;
      console.warn(`[PriceService] Failed ${source.name} (${status})`);
    }
  }
  console.error('[PriceService] All sources failed. Keeping old price.');
};

const getBitcoinPrice = () => {
  return cachedPrice.usd;
};

const startPriceUpdater = () => {
  // Первый запуск сразу
  updateBitcoinPrice();
  
  // Обновляем раз в 5 минут (300000 мс)
  // Coinbase не любит запросы чаще раза в минуту с одного IP, так что 5 минут — безопасно
  setInterval(updateBitcoinPrice, 300000);
  
  console.log('[PriceService] Robust US-friendly price updater started.');
};

module.exports = {
  startPriceUpdater,
  getBitcoinPrice
};