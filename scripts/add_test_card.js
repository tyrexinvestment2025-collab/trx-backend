require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const connectDB = require('../src/config/db');
const CardType = require('../src/models/CardType');
const CardImage = require('../src/models/CardImage');
const UserCard = require('../src/models/UserCard'); // Импортируем для полной очистки

const cardsData = [
  { name: 'Tyrex Mini', sats: 100000, apy: 6, supply: 500 },
  { name: 'Tyrex Midi', sats: 500000, apy: 10, supply: 100 },
  { name: 'Tyrex Maxi', sats: 1000000, apy: 14, supply: 50 },
  { name: 'Tyrex Ultra', sats: 5000000, apy: 19, supply: 25 },
  { name: 'Tyrex Infinity', sats: 10000000, apy: 25, supply: 5 }
];

const reseedDatabase = async () => {
  try {
    await connectDB();
    console.log('🚀 Начинаем полную очистку базы данных...');

    // 1. ПОЛНАЯ ОЧИСТКА (Удаляем всё, чтобы не было мусора)
    await CardType.deleteMany({});
    await CardImage.deleteMany({});
    await UserCard.deleteMany({});
    console.log('🗑️ База данных полностью очищена (CardTypes, CardImages, UserCards).');

    // 2. Цикл создания 5 видов карточек
    for (let i = 0; i < cardsData.length; i++) {
      const data = cardsData[i];
      const imgName = `coin_${i}.png`; // coin_0.png, coin_1.png ...
      const imgPath = path.join(__dirname, imgName);

      if (!fs.existsSync(imgPath)) {
        console.error(`❌ Файл ${imgName} не найден в папке scripts! Пропускаю эту коллекцию.`);
        continue;
      }

      // Читаем картинку
      const imageBuffer = fs.readFileSync(imgPath);
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      // Создаем тип карточки (Коллекцию)
      const newCardType = await CardType.create({
        name: data.name,
        nominalSats: data.sats,
        clientAPY: data.apy,
        referralAPY: Math.round(data.apy * 0.1),
        maxSupply: data.supply,
        available: data.supply,
        isActive: true
      });

      // Привязываем картинку к этой коллекции (индекс 0 - основная)
      await CardImage.create({
        cardTypeId: newCardType._id,
        imageData: base64Image,
        index: 0
      });

      console.log(`✅ Создана коллекция: ${data.name} (Тираж: ${data.supply})`);
    }

    console.log('--- 🎉 База данных успешно обновлена! ---');
  } catch (error) {
    console.error('❌ Ошибка при сидировании:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

reseedDatabase();