const axios = require('axios');

/**
 * История курса BTC для раздела «Рынок» (свечи Binance, публичные рыночные данные).
 * Кэш в памяти: короткие периоды — 1 мин, длинные — 10 мин.
 */
const RANGES = {
    '24h': { interval: '15m', limit: 96, ttl: 60_000 },
    '7d': { interval: '1h', limit: 168, ttl: 5 * 60_000 },
    '30d': { interval: '4h', limit: 180, ttl: 10 * 60_000 },
    '1y': { interval: '1d', limit: 365, ttl: 10 * 60_000 },
};

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const cache = new Map();

const fetchJson = async (path) => {
    let lastErr;
    for (const host of HOSTS) {
        try {
            const r = await axios.get(`${host}${path}`, { timeout: 6000 });
            return r.data;
        } catch (e) { lastErr = e; }
    }
    throw lastErr;
};

const getHistory = async (range) => {
    const cfg = RANGES[range];
    if (!cfg) return null;
    const hit = cache.get(range);
    if (hit && Date.now() - hit.at < cfg.ttl) return hit.data;

    const [klines, ticker] = await Promise.all([
        fetchJson(`/api/v3/klines?symbol=BTCUSDT&interval=${cfg.interval}&limit=${cfg.limit}`),
        fetchJson('/api/v3/ticker/24hr?symbol=BTCUSDT')
    ]);
    // [openTime, open, high, low, close, ...] → [время закрытия свечи, цена закрытия]
    const points = klines.map(k => [Number(k[6]), Number(k[4])]).filter(p => p[1] > 0);
    const first = points[0]?.[1] || 0;
    const last = points[points.length - 1]?.[1] || 0;
    const data = {
        range,
        points,
        changePct: first > 0 ? ((last - first) / first) * 100 : 0,
        change24hPct: Number(ticker?.priceChangePercent) || 0,
        high: Math.max(...points.map(p => p[1])),
        low: Math.min(...points.map(p => p[1])),
    };
    cache.set(range, { at: Date.now(), data });
    return data;
};

module.exports = { getHistory, RANGES };
