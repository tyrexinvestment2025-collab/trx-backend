// Устаревший модуль: раньше хранил отдельную (и никогда не обновлявшуюся) цену 97000.
// Теперь все потребители получают цену из единого сервиса priceService2.
const priceService = require('./priceService2');

module.exports = {
  getBitcoinPrice: () => priceService.getBitcoinPrice(),
  startPriceUpdater: () => priceService.start(),
};
