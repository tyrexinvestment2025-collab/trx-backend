/**
 * Подключение бота к серверу: вебхук, воркер очереди, ежедневная сводка для админов.
 *
 * Вебхук: POST /api/v1/bot/webhook
 *  - без верного X-Telegram-Bot-Api-Secret-Token → 401;
 *  - повтор update_id не обрабатывается (коллекция TgUpdate, хранится 3 дня);
 *  - отвечаем 200 сразу, обработка — после ответа (Telegram не ждёт и не шлёт повторы).
 * Регистрация вебхука, команд и описаний — скриптом scripts/bot-setup.js.
 */
const cron = require('node-cron');
const TgUpdate = require('../models/TgUpdate');
const User = require('../models/User');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { getBot } = require('./api');
const { cfg } = require('./config');
const { register } = require('./handlers');
const { startWorker, enqueueAdmin } = require('./outbox');
const { toNum, round2 } = require('../utils/money');

const WEBHOOK_PATH = '/api/v1/bot/webhook';
let registered = false;

/** Обработчики навешиваются один раз на общий экземпляр бота */
const ensureHandlers = () => {
  const bot = getBot();
  if (bot && !registered) { register(bot); registered = true; }
  return bot;
};

/** Express-обработчик вебхука (вынесен для тестов) */
const webhookHandler = async (req, res) => {
  const c = cfg();
  if (!c.webhookSecret || req.get('X-Telegram-Bot-Api-Secret-Token') !== c.webhookSecret) return res.sendStatus(401);
  const update = req.body;
  if (!update || typeof update.update_id !== 'number') return res.sendStatus(400);
  try {
    await TgUpdate.create({ updateId: update.update_id });
  } catch (e) {
    if (e.code === 11000) return res.sendStatus(200); // уже обработан
    console.error('[bot] dedupe store failed:', e.message);
  }
  res.sendStatus(200);
  const bot = ensureHandlers();
  if (!bot) return;
  try { await bot.handleUpdate(update); }
  catch (e) { console.error('[bot] update failed:', e.message); }
};

/** Итог дня для админ-чата — в General (без темы) */
async function dailySummary() {
  const now = new Date();
  const since = new Date(now.getTime() - 86400_000);
  const [newUsers, deps, wds, pendingDeposits, pendingWithdrawals] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: since } }),
    DepositRequest.find({ status: 'CONFIRMED', updatedAt: { $gte: since } }).select('amountUsd').lean(),
    WithdrawalRequest.find({ status: 'PROCESSED', processedDate: { $gte: since } }).select('amountUsd').lean(),
    DepositRequest.countDocuments({ status: 'PENDING' }),
    WithdrawalRequest.countDocuments({ status: 'PENDING' }),
  ]);
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Kyiv' }).format(now);
  await enqueueAdmin({
    eventId: `admin.daily:${now.toISOString().slice(0, 10)}`, topic: null, template: 'admin.daily',
    params: {
      date, newUsers,
      depositsCount: deps.length, depositsUsd: round2(deps.reduce((a, d) => a + toNum(d.amountUsd), 0)),
      withdrawalsCount: wds.length, withdrawalsUsd: round2(wds.reduce((a, w) => a + toNum(w.amountUsd), 0)),
      pendingDeposits, pendingWithdrawals,
    },
  });
}

/** Подключить бота к приложению Express */
function initBot(app) {
  const c = cfg();
  if (!c.enabled || !c.token) {
    console.log('🤖 Bot disabled (no token or BOT_ENABLED=false)');
    return;
  }
  ensureHandlers();
  app.post(WEBHOOK_PATH, webhookHandler);
  if (!c.webhookSecret) console.warn('⚠️  WEBHOOK_SECRET is not set — webhook will reject all updates');

  // Воркер и сводка работают там же, где кроны (локально с DISABLE_CRON=true — не запускаем)
  if (process.env.DISABLE_CRON !== 'true' && process.env.DISABLE_BOT_WORKER !== 'true') {
    startWorker();
    cron.schedule('0 9 * * *', () => dailySummary().catch(e => console.error('[bot] daily summary:', e.message)), { timezone: 'Europe/Kyiv' });
  }
  console.log(`🤖 Bot webhook at ${WEBHOOK_PATH}`);
}

module.exports = { initBot, webhookHandler, dailySummary, ensureHandlers, WEBHOOK_PATH };
