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
app.use('/api/v1/cards', cardRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/referrals', referralRoutes);

app.get('/', (req, res) => {
  res.send('Tyrex API is running...');
});

const allowedOrigins = [
  'https://tyrex-currency.vercel.app/', 
  'https://cf813f5cc431.ngrok-free.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
}));

startCronJobs();
startPriceUpdater();
startReferralJob(); 

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});