// ВАЖНО: Мы используем require, поэтому нужна версия node-fetch@2
const fetch = require('node-fetch'); 

let fngCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 час

/**
 * Получает индекс Страха и Жадности (Fear & Greed)
 * Источник: https://api.alternative.me/fng/
 */
exports.getFearAndGreedIndex = async () => {
    const now = Date.now();

    // Если есть кэш и он свежий — отдаем его
    if (fngCache && (now - lastFetchTime < CACHE_DURATION)) {
        return fngCache;
    }

    try {
        const response = await fetch('https://api.alternative.me/fng/?limit=1');
        const data = await response.json();
        
        if (data && data.data && data.data.length > 0) {
            const indexValue = parseInt(data.data[0].value);
            const status = data.data[0].value_classification;
            
            fngCache = { value: indexValue, status };
            lastFetchTime = now;
            return fngCache;
        }
    } catch (error) {
        console.error("Error fetching F&G Index:", error.message);
    }

    // Фоллбек (если API недоступен или ошибка сети)
    return { value: 50, status: "Neutral" };
};