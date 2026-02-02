const crypto = require('crypto');

const verifyTelegramWebAppData = (telegramInitData) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not defined');

  // 2. Парсим строку запроса (query string) в объект
  const urlParams = new URLSearchParams(telegramInitData);
  const hash = urlParams.get('hash');
  
  // Если хеша нет, данные точно невалидны
  if (!hash) return false;

  // 3. Удаляем хеш из параметров, так как он не участвует в подписи данных
  urlParams.delete('hash');

  // 4. Сортируем параметры по алфавиту и собираем строку "key=value\n"
  const dataCheckString = Array.from(urlParams.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');

  // 5. Создаем секретный ключ (HMAC-SHA256 от токена с солью "WebAppData")
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(token)
    .digest();

  // 6. Хешируем нашу строку данных полученным секретным ключом
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // 7. Сравниваем полученный хеш с тем, что прислал Telegram
  return calculatedHash === hash;
};

module.exports = { verifyTelegramWebAppData };