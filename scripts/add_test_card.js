require('dotenv').config();
const db = require('../src/db');
const fs = require('fs');
const path = require('path');
const connectDB = require('../src/config/db');
const CardType = require('../src/models/CardType');
const UserCard = require('../src/models/UserCard');
const CardHistory = require('../src/models/CardHistory');

const cardsData = [
  { name: 'Tyrex Mini', sats: 100000, apy: 6, refApy: 6, supply: 500, img: 'coin_0.png' },
  { name: 'Tyrex Midi', sats: 500000, apy: 10, refApy: 5, supply: 100, img: 'coin_1.png' },
  { name: 'Tyrex Maxi', sats: 1000000, apy: 14, refApy: 4, supply: 50, img: 'coin_2.png' },
  { name: 'Tyrex Ultra', sats: 5000000, apy: 19, refApy: 3, supply: 25, img: 'coin_3.png' },
  { name: 'Tyrex Infinity', sats: 10000000, apy: 25, refApy: 2, supply: 5, img: 'coin_4.png' }
];

const reseed = async () => {
  try {
    await connectDB();
    console.log('🚀 Начинаю очистку базы...');
    
    await CardType.deleteMany({});
    await UserCard.deleteMany({});
    await CardHistory.deleteMany({});

    console.log('♻️ База очищена. Начинаю импорт карточек...');

    for (let d of cardsData) {
      // ПРОВЕРКА: Существует ли файл физически?
      // Мы находимся в /scripts, выходим на уровень выше в корень, затем в /public/nfts
      const physicalPath = path.join(__dirname, '..', 'public', 'nfts', d.img);
      
      if (!fs.existsSync(physicalPath)) {
        console.error(`❌ ФАЙЛ НЕ НАЙДЕН: ${physicalPath}`);
        console.log(`Проверь, что в корне проекта есть папка public/nfts и в ней лежит ${d.img}`);
        continue; // Пропускаем эту карту, если файла нет
      }

      await CardType.create({
        name: d.name,
        nominalSats: d.sats,
        clientAPY: d.apy,
        referralAPY: d.refApy,
        maxSupply: d.supply,
        available: d.supply,
        // Этот путь пойдет в браузер: http://localhost:5000/static/nfts/coin_0.png
        imagePath: `/static/nfts/${d.img}`,
        isActive: true
      });
      
      console.log(`✅ Создана карта: ${d.name} (Файл: ${d.img})`);
    }

    console.log('✨ ГОРЯЧИЙ РЕСИД ЗАВЕРШЕН УСПЕШНО!');
  } catch (error) {
    console.error('❌ ОШИБКА ПРИ ВЫПОЛНЕНИИ:', error);
  } finally {
    await db.close();
    process.exit();
  }
};

reseed();