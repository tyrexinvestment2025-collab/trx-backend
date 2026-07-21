// Положи этот файл в корень проекта (рядом с package.json)
require('dotenv').config(); // Загружаем переменные из .env
const mongoose = require('mongoose');
const connectDB = require('./src/config/db'); // Используем твой конфиг
const ReferralReward = require('./src/models/ReferralReward');

const seedTestRewards = async () => {
  try {
    // 1. Подключаемся через твой стандартный конфиг
    await connectDB();

    // --- НАСТРОЙКИ (Твои ID из базы) ---
    const MY_ID = "698153a925faae65b61f9aee"; 
    const PARTNER_ID = "698b92fff1b516d49aafac2f"; 
    // -----------------

    console.log("🧹 Очистка старых начислений...");
    await ReferralReward.deleteMany({ uplineUserId: MY_ID, partnerUserId: PARTNER_ID });

    const rewards = [];
    const now = new Date();

    console.log("🎲 Генерируем 10 записей для графика...");
    for (let i = 0; i < 10; i++) {
      const date = new Date();
      date.setDate(now.getDate() - i);
      
      rewards.push({
        uplineUserId: new mongoose.Types.ObjectId(MY_ID),
        partnerUserId: new mongoose.Types.ObjectId(PARTNER_ID),
        amountSats: Math.floor(Math.random() * 5000) + 1500,
        date: date.toISOString().split('T')[0]
      });
    }

    await ReferralReward.insertMany(rewards);

    console.log(`🚀 УСПЕХ! Добавлено ${rewards.length} записей.`);
    console.log("Теперь открывай вкладку 'Партнеры' и смотри график.");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Ошибка скрипта:", error);
    process.exit(1);
  }
};

seedTestRewards();