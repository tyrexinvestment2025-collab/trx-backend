require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const { startPriceUpdater } = require('./services/priceService');
const { startReferralJob } = require('./services/dailyReferralService');
const startCronJobs = require('./services/cronService');
const analyticsRoutes = require('./routes/analyticsRoutes');

const authRoutes = require('./routes/authRoutes');
const cardRoutes = require('./routes/cardRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const referralRoutes = require('./routes/referralRoutes');

connectDB();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(cors()); 

app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cards', cardRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/referrals', referralRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

app.get('/', (req, res) => res.send('Tyrex API is running...'));

startCronJobs();
startPriceUpdater();
startReferralJob();
console.log(`[ENV] API_URL is set to: ${process.env.API_URL}`);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    console.log(`🖼️ Check images here: http://localhost:${PORT}/static/nfts/coin_0.png`);
});