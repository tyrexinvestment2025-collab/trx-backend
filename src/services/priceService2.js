const { WebsocketStream, Spot } = require('@binance/connector');
const EventEmitter = require('events');

class PriceService extends EventEmitter {
    constructor() {
        super();
        this.currentPrice = null; 
        this.lastUpdated = null;
        this.wsClient = null;
        this.isConnected = false;
        this.reconnectDelay = 5000;

        // REST клиент для мгновенного получения цены при холодном старте
        this.restClient = new Spot('', '', { baseURL: 'https://testnet.binance.vision' });
    }

    /**
     * Запуск сервиса
     */
    async start() {
        try {
            // Сначала получаем цену через REST, чтобы API не отдавало null первые секунды
            await this.fetchInitialPrice();
            // Затем подключаем сокет для постоянного обновления
            this.connectWebSocket();
        } catch (error) {
            console.error('⚠️ [PriceService] Start error:', error.message);
        }
    }

    async fetchInitialPrice() {
        try {
            const response = await this.restClient.tickerPrice('BTCUSDT');
            this.currentPrice = parseFloat(response.data.price);
            this.lastUpdated = Date.now();
            console.log(`✅ [PriceService] Initial price via REST: ${this.currentPrice}`);
        } catch (error) {
            console.error('❌ [PriceService] REST fetch failed:', error.message);
        }
    }

    connectWebSocket() {
        if (this.isConnected) return;

        console.log('🔗 [PriceService] Connecting to Binance WebSocket...');
        
        const callbacks = {
            open: () => {
                this.isConnected = true;
                console.log('✅ [PriceService] WebSocket Stream Connected');
            },
            close: () => {
                this.isConnected = false;
                console.warn('❌ [PriceService] WebSocket Disconnected. Reconnecting...');
                this.wsClient = null;
                setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
            },
            message: (data) => {
                const ticker = typeof data === 'string' ? JSON.parse(data) : data;
                if (ticker.a) {
                    this.currentPrice = parseFloat(ticker.a);
                    this.lastUpdated = Date.now();
                    // Генерируем событие для server.js
                    this.emit('priceUpdate', { price: this.currentPrice, timestamp: this.lastUpdated });
                }
            }
        };

        this.wsClient = new WebsocketStream({ 
            callbacks, 
            wsURL: 'wss://stream.testnet.binance.vision' 
        });
        this.wsClient.bookTicker('BTCUSDT');
    }

    /**
     * Безопасный геттер цены
     */
    getBitcoinPrice() {
        // Если цены нет или она старее 30 секунд - данные невалидны
        if (!this.currentPrice || (Date.now() - this.lastUpdated) > 30000) {
            return null;
        }
        return this.currentPrice;
    }
}

module.exports = new PriceService();