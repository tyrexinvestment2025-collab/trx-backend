const db = require('../db');

/** Подключение к PostgreSQL и применение схемы. Без базы сервер не стартует. */
const connectDB = async () => {
  try {
    await db.connectDB();
  } catch (error) {
    console.error(`PostgreSQL error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
