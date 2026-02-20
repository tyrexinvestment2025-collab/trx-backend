const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const path = require('path');
const credentialsPath = path.join(process.cwd(), 'google-credentials.json');
const credentials = require(credentialsPath);

// Авторизация через скачанный ключ
const serviceAccountAuth = new JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

/**
 * Инициализация таблицы (создание шапки при первом запуске)
 */
async function initSheet() {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        
        // Устанавливаем заголовки, если их еще нет
        await sheet.setHeaderRow([
            'Дата/Время', 
            'Пользователь (TG)', 
            'Тип сделки', 
            'Объем BTC', 
            'Списано USD (App)', 
            'Потрачено USDT (Binance)', 
            'Курс исполнения', 
            'Профит ($)', 
            'Статус', 
            'Binance Order ID'
        ]);
        
        console.log('✅ [GoogleSheets] Лайв-таблица успешно инициализирована');
    } catch (e) {
        console.error('❌ [GoogleSheets] Ошибка инициализации:', e.message);
    }
}

/**
 * Добавление новой строки в таблицу в реальном времени
 */
async function appendOrder(data) {
    try {
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        
        await sheet.addRow({
            'Дата/Время': new Date().toLocaleString('ru-RU'),
            'Пользователь (TG)': data.username,
            'Тип сделки': data.type,
            'Объем BTC': data.btcAmount.toFixed(8),
            'Списано USD (App)': data.appUsd.toFixed(2),
            'Потрачено USDT (Binance)': data.binanceUsdt?.toFixed(2) || '0',
            'Курс исполнения': data.rate || '0',
            'Профит ($)': data.profit?.toFixed(4) || '0',
            'Статус': data.status,
            'Binance Order ID': data.orderId || 'N/A'
        });
        
    } catch (e) {
        console.error('❌ [GoogleSheets] Ошибка при записи строки:', e.message);
    }
}

module.exports = { initSheet, appendOrder };