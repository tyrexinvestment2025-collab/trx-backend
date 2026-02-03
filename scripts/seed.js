// seed.js
// Этот скрипт очищает коллекции cardtypes и usercards, и заполняет cardtypes новыми данными с учетом maxSupply

require('dotenv').config(); 
const mongoose = require('mongoose');
const connectDB = require('../src/config/db'); 
const CardType = require('../src/models/CardType'); 
const UserCard = require('../src/models/UserCard'); // Импортируем, чтобы очистить старые покупки

const cards = [
  {
    name: 'Tyrex Mini',
    nominalSats: 100000,   // 0.001 BTC
    clientAPY: 6,
    referralAPY: 6,
    maxSupply: 100,        // НОВОЕ: Всего выпущено 100 штук
    available: 100,        // НОВОЕ: На старте доступно все 100
    isActive: true
  },
  {
    name: 'Tyrex Midi',
    nominalSats: 500000,   // 0.005 BTC
    clientAPY: 10,
    referralAPY: 5,
    maxSupply: 50,         // Лимит 50 штук
    available: 50,
    isActive: true
  },
  {
    name: 'Tyrex Maxi',
    nominalSats: 10000000, // 0.1 BTC
    clientAPY: 25,
    referralAPY: 2,
    maxSupply: 10,         // Эксклюзив, всего 10 штук
    available: 10,
    isActive: true
  },
    {
    name: 'Tyrex Infinity',
    nominalSats: 50000000, // 0.1 BTC
    clientAPY: 2500,
    referralAPY: 2,
    maxSupply: 3,         // Эксклюзив, всего 10 штук
    available: 3,
    isActive: true
  }
];

const seedDatabase = async () => {
  try {
    await connectDB();
    console.log('MongoDB connected for seeding...');

    // 1. Очищаем покупки пользователей (ВАЖНО: старые карты без serialNumber сломают новый фронтенд)
    await UserCard.deleteMany({});
    console.log('UserCards collection cleared (Clean start for NFTs).');

    // 2. Очищаем типы карт
    await CardType.deleteMany({});
    console.log('CardTypes collection cleared.');

    // 3. Вставляем новые коллекции с параметрами тиража
    await CardType.insertMany(cards);
    console.log('New Collection Data seeded successfully!');

  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    // Закрываем соединение
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  }
};

seedDatabase();