/**
 * Данные для экрана «Аналитика». Значения задаёт заказчик — меняются здесь без правки фронтенда.
 *
 * Оценки 0–10 по шести метрикам (собственная оценка платформы, не независимый рейтинг):
 *   yield — доходность, growth — потенциал роста, passive — простота,
 *   liquidity — ликвидность, entry — доступность входа (выше = меньше денег на старт),
 *   safety — надёжность.
 * Подписи активов и выводы — во фронтенде: src/locales/<lang>/analytics.json (assets.<id>).
 */
const METRICS = ['yield', 'growth', 'passive', 'liquidity', 'entry', 'safety'];

// TODO(customer): оценки Tyrex и методику должен утвердить заказчик
const TYREX_SCORE = { yield: 9, growth: 8, passive: 9, liquidity: 4, entry: 10, safety: 6 };

// Когда оценки последний раз пересматривались (показывается рядом с оценками)
const SCORES_UPDATED_AT = '2026-11-16';

const COMPARISON_DATA = {
    traditional: [
        { subject: 'Real Estate', yield: 4, safety: 10, liquidity: 2, passive: 3, entry: 1, growth: 5 },
        { subject: 'Bank Deposit', yield: 2, safety: 8, liquidity: 9, passive: 10, entry: 9, growth: 1 },
        { subject: 'S&P 500', yield: 6, safety: 7, liquidity: 8, passive: 6, entry: 7, growth: 6 },
        { subject: 'Gold', yield: 3, safety: 9, liquidity: 7, passive: 8, entry: 8, growth: 4 },
        { subject: 'Business', yield: 10, safety: 2, liquidity: 3, passive: 1, entry: 2, growth: 10 },
        { subject: 'Funds', yield: 5, safety: 7, liquidity: 6, passive: 7, entry: 5, growth: 5 }
    ],
    crypto: [
        { subject: 'Staking', yield: 3, safety: 7, liquidity: 6, passive: 8, entry: 9, growth: 4 },
        { subject: 'Mining', yield: 6, safety: 6, liquidity: 4, passive: 2, entry: 2, growth: 6 },
        { subject: 'Trading', yield: 10, safety: 1, liquidity: 10, passive: 1, entry: 8, growth: 8 },
        { subject: 'Altcoins', yield: 3, safety: 2, liquidity: 5, passive: 3, entry: 9, growth: 5 },
        { subject: 'Bots', yield: 6, safety: 3, liquidity: 7, passive: 6, entry: 8, growth: 6 },
        { subject: 'Signals', yield: 7, safety: 1, liquidity: 8, passive: 3, entry: 9, growth: 8 }
    ]
};

/**
 * Сценарии курса BTC для «Прогноза»: изменение курса за год, %.
 * Курс влияет на долларовую сумму дохода карт (доход начисляется в BTC).
 * TODO(customer): значения из макета (−20 / 0 / +20), должен утвердить заказчик.
 */
const BTC_SCENARIOS = { bear: -20, base: 0, bull: 20 };

module.exports = COMPARISON_DATA;
module.exports.METRICS = METRICS;
module.exports.TYREX_SCORE = TYREX_SCORE;
module.exports.SCORES_UPDATED_AT = SCORES_UPDATED_AT;
module.exports.BTC_SCENARIOS = BTC_SCENARIOS;
