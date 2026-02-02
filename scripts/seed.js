// Этот скрипт очищает коллекцию cardtypes и заполняет ее стартовыми данными

require('dotenv').config(); // Чтобы .env переменные были доступны
const mongoose = require('mongoose');
const connectDB = require('../src/config/db'); // Путь к вашему файлу подключения
const CardType = require('../src/models/CardType'); // Путь к модели

const cards = [
  {
    name: 'Tyrex Mini',
    nominalSats: 100000,   // 0.001 BTC
    clientAPY: 6,
    referralAPY: 6,
    available: 19,
    isActive: true
  },
  {
    name: 'Tyrex Midi',
    nominalSats: 500000,   // 0.005 BTC
    clientAPY: 10,
    referralAPY: 5,
    available: 29,
    isActive: true
  },
  {
    name: 'Tyrex Maxi',
    nominalSats: 10000000, // 0.1 BTC
    clientAPY: 25,
    referralAPY: 2,
    available: 5,
    isActive: true
  }
];

const seedDatabase = async () => {
  try {
    await connectDB();
    console.log('MongoDB connected for seeding...');

    // Очищаем коллекцию
    await CardType.deleteMany({});
    console.log('CardTypes collection cleared.');

    // Вставляем новые данные
    await CardType.insertMany(cards);
    console.log('Data seeded successfully!');

  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    // Закрываем соединение
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  }
};

seedDatabase();