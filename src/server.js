require('dotenv').config();
const express = require('express');
const http = require('http'); // Добавлено
const { Server } = require("socket.io"); // Добавлено
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const googleSheet = require('./services/googleSheetService');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
// В блоке запуска сервисов:
googleSheet.initSheet(); // Проверит таблицу и создаст шапку

// Сервисы
const priceService = require('./services/priceService2'); 
const { startReferralJob } = require('./services/dailyReferralService');
const startCronJobs = require('./services/cronService');

// Роуты
const analyticsRoutes = require('./routes/analyticsRoutes');
const authRoutes = require('./routes/authRoutes');
const cardRoutes = require('./routes/cardRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const referralRoutes = require('./routes/referralRoutes');

const app = express();

// Создаем HTTP сервер для работы с сокетами
const server = http.createServer(app);

// Настройка Socket.io с учетом специфики Render.com
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 25000,
    pingTimeout: 60000
});

app.use(express.json());
// Короткий журнал запросов к API (REQUEST_LOG=true)
if (process.env.REQUEST_LOG === 'true') {
    app.use('/api', (req, res, next) => {
        const t = Date.now();
        res.on('finish', () => console.log(`[req] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - t}ms`));
        next();
    });
}
app.use(express.urlencoded({ extended: true })); 
app.use(cors()); 

app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cards', cardRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/referrals', referralRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

// Собранный фронт (Mini App) с того же адреса, если задан FRONTEND_DIST — тогда VITE_API_URL=/api/v1
if (process.env.FRONTEND_DIST) {
    const dist = path.resolve(process.env.FRONTEND_DIST);
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|static\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
    app.get('/', (req, res) => res.send('Tyrex API is running...'));
}

// Запуск фоновых задач — после подключения к базе и применения схемы
connectDB().then(() => {
// Telegram-бот: вебхук, очередь уведомлений, админ-чат
require('./bot').initBot(app);
if (process.env.DISABLE_CRON !== 'true') {
    startCronJobs();
    startReferralJob();
} else {
    console.log('⏸️  Cron jobs disabled (DISABLE_CRON=true)');
}
priceService.start();

// Трансляция цены из PriceService в Socket.io
priceService.on('priceUpdate', (data) => {
    io.emit('priceUpdate', data);
});

// Обработка подключений клиентов
io.on('connection', (socket) => {
    console.log(`🟢 Socket client connected: ${socket.id}`);
    const lastPrice = priceService.getBitcoinPrice();
    if (lastPrice) socket.emit('priceUpdate', { price: lastPrice });
});

console.log(`[ENV] API_URL is set to: ${process.env.API_URL}`);

const PORT = process.env.PORT || 5000;
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`🚀 Server on port ${PORT}`);
    console.log(`🔌 WebSockets active`);
});
});