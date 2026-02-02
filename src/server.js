require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const startCronJobs = require('./services/cronService'); 
const { startPriceUpdater } = require('./services/priceService'); 
const { startReferralJob } = require('./services/dailyReferralService'); 

const authRoutes = require('./routes/authRoutes');
const cardRoutes = require('./routes/cardRoutes'); 
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const referralRoutes = require('./routes/referralRoutes');

connectDB();

const app = express();

app.use(express.json());
app.use(cors());

// Подключение API
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cards', cardRoutes); // <--- Подключили
app.use('/api/v1/user', userRoutes); // <--- Подключили (для профиля и выводов) -> api/v1/user/profile
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/referrals', referralRoutes);

app.get('/', (req, res) => {
  res.send('Tyrex API is running...');
});

startCronJobs();
startPriceUpdater();
startReferralJob(); 

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});