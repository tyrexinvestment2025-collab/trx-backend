const { WebsocketStream } = require('@binance/connector');
const axios = require('axios');
const EventEmitter = require('events');

/**
 * Единый источник цены BTC для всего бэкенда.
 * - Основной поток: публичные рыночные данные Binance mainnet (без ключей).
 *   Торговля (binanceService) остаётся на тестнете — это отдельная история.
 * - Фолбэк: REST-опрос нескольких публичных API, если сокет молчит.
 * - getBitcoinPrice() возвращает null, если цена старше STALE_MS — вызывающий код обязан это обработать.
 */
const STALE_MS = Number(process.env.PRICE_STALE_MS) || 60_000;
const WS_URL = process.env.PRICE_WS_URL || 'wss://data-stream.binance.vision';
const FALLBACK_POLL_MS = 15_000;
const EMIT_THROTTLE_MS = 1_000;

const REST_SOURCES = [
    { name: 'Binance', url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', extract: d => parseFloat(d.price) },
    { name: 'Coinbase', url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot', extract: d => parseFloat(d.data.amount) },
    { name: 'Kraken', url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD', extract: d => parseFloat(Object.values(d.result)[0].c[0]) },
    { name: 'KuCoin', url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT', extract: d => parseFloat(d.data.price) },
];

class PriceService extends EventEmitter {
    constructor() {
        super();
        this.currentPrice = null;
        this.lastUpdated = 0;
        this.source = null;
        this.wsClient = null;
        this.isConnected = false;
        this.started = false;
        this.reconnectDelay = 5000;
        this.lastEmit = 0;
        this.pollTimer = null;
    }

    async start() {
        if (this.started) return;
        this.started = true;
        await this.fetchRestPrice();
        this.connectWebSocket();
        // Страховка: если сокет не обновлял цену дольше половины порога — берём из REST
        this.pollTimer = setInterval(() => {
            if (Date.now() - this.lastUpdated > STALE_MS / 2) this.fetchRestPrice();
        }, FALLBACK_POLL_MS);
    }

    setPrice(price, source) {
        if (!price || !Number.isFinite(price) || price <= 0) return;
        this.currentPrice = price;
        this.lastUpdated = Date.now();
        this.source = source;
        if (this.lastUpdated - this.lastEmit >= EMIT_THROTTLE_MS) {
            this.lastEmit = this.lastUpdated;
            this.emit('priceUpdate', { price, timestamp: this.lastUpdated });
        }
    }

    async fetchRestPrice() {
        for (const s of REST_SOURCES) {
            try {
                const { data } = await axios.get(s.url, { timeout: 4000 });
                const price = s.extract(data);
                if (price > 0) {
                    this.setPrice(price, `rest:${s.name}`);
                    return true;
                }
            } catch (e) {
                console.warn(`[PriceService] REST ${s.name} failed: ${e.response?.status || e.code || e.message}`);
            }
        }
        console.error('[PriceService] All REST sources failed');
        return false;
    }

    connectWebSocket() {
        if (this.isConnected || this.wsClient) return;

        const callbacks = {
            open: () => {
                this.isConnected = true;
                console.log('✅ [PriceService] WebSocket connected');
            },
            close: () => {
                this.isConnected = false;
                this.wsClient = null;
                console.warn('❌ [PriceService] WebSocket closed, reconnecting...');
                setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
            },
            message: (raw) => {
                try {
                    const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    // miniTicker: c = последняя цена
                    if (t && t.c) this.setPrice(parseFloat(t.c), 'ws:binance');
                } catch { /* игнорируем битые сообщения */ }
            }
        };

        try {
            this.wsClient = new WebsocketStream({ callbacks, wsURL: WS_URL });
            this.wsClient.miniTicker('BTCUSDT');
        } catch (e) {
            console.error('[PriceService] WS init error:', e.message);
            this.wsClient = null;
            setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
        }
    }

    /** Актуальная цена или null, если данных нет / они устарели */
    getBitcoinPrice() {
        if (!this.currentPrice || Date.now() - this.lastUpdated > STALE_MS) return null;
        return this.currentPrice;
    }
}

module.exports = new PriceService();
