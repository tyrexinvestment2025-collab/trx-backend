/**
 * Очередь уведомлений (outbox) и воркер отправки.
 *
 * Бизнес-логика вызывает только enqueue() — с детерминированным eventId (например deposit.confirmed:<id>),
 * поэтому повторная обработка события не создаёт второе сообщение. Воркер:
 *  - захватывает записи атомарно (findOneAndUpdate), «зависшие» после перезапуска возвращает в очередь;
 *  - соблюдает лимиты: ≤ 25 сообщений/с всего, ≤ 1/с в один чат, ≤ 20/мин в админ-группу;
 *  - 429 → ждёт retry_after; 5xx/сеть → повтор через 10 с, 1 мин, 5 мин, 30 мин, затем failed + тема «Ошибки»;
 *  - 403 → skipped, canMessage = false (пользователь заблокировал бота), без повторов;
 *  - тихие часы 22:00–9:00 по часовому поясу пользователя — только для напоминаний (не для денег);
 *  - склейка: несколько одинаковых событий (бонусы, завершённые циклы) за 5 минут — одним сообщением.
 */
const Outbox = require('../models/Outbox');
const User = require('../models/User');
const { getBot } = require('./api');
const { cfg } = require('./config');
const { render, USER, groupOf } = require('./templates');
const { langOf } = require('./texts');

const BACKOFF_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000];
const BATCH_WINDOW_MS = 5 * 60_000;
const STUCK_MS = 2 * 60_000;

/** Поставить событие в очередь. Повтор того же eventId молча игнорируется. */
async function enqueue({ eventId, userId = null, chatId = null, threadId = null, template, params = {}, delayMs = 0 }) {
  if (!cfg().enabled) return null;
  try {
    return await Outbox.create({
      eventId, userId, chatId: chatId ? String(chatId) : null, threadId, template, params,
      group: groupOf(template), nextTryAt: new Date(Date.now() + delayMs),
    });
  } catch (e) {
    if (e.code === 11000) return null;
    console.error('[outbox] enqueue failed:', e.message);
    return null;
  }
}

/** Сообщение в админ-группу (если она настроена) */
async function enqueueAdmin({ eventId, topic, template, params }) {
  const c = cfg();
  if (!c.adminChatId) return null;
  return enqueue({ eventId, chatId: c.adminChatId, threadId: topic ? c.topics[topic] : null, template, params });
}

// ---------- Лимиты отправки ----------
let windowStart = 0;
let sentInWindow = 0;
const lastPerChat = new Map();
const adminSends = [];

const takeGlobal = () => {
  const now = Date.now();
  if (now - windowStart >= 1000) { windowStart = now; sentInWindow = 0; }
  if (sentInWindow >= 25) return false;
  sentInWindow += 1;
  return true;
};
const chatReadyIn = (chatId) => Math.max(0, (lastPerChat.get(chatId) || 0) + 1000 - Date.now());
const adminReadyIn = () => {
  const now = Date.now();
  while (adminSends.length && now - adminSends[0] > 60_000) adminSends.shift();
  return adminSends.length < 20 ? 0 : 60_000 - (now - adminSends[0]);
};

// ---------- Тихие часы ----------
const localHour = (tz, d = new Date()) => {
  try { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz || 'Europe/Kyiv' }).format(d)) % 24; }
  catch { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/Kyiv' }).format(d)) % 24; }
};
const isQuiet = (tz, d = new Date()) => { const h = localHour(tz, d); return h >= 22 || h < 9; };
/** Ближайшие 9:00 по местному времени (с точностью до часа) */
const nextMorning = (tz) => {
  const d = new Date();
  for (let i = 1; i <= 24; i++) {
    const c = new Date(d.getTime() + i * 3600_000);
    if (localHour(tz, c) === 9) { c.setMinutes(0, 0, 0); return c; }
  }
  return new Date(d.getTime() + 8 * 3600_000);
};

const prefAllows = (user, group) => {
  if (group === 'money' || group === 'admin') return true;
  const prefs = user.notifPrefs || {};
  const defaults = { cards: true, partners: true, news: true, digest: false, btc: false };
  return prefs[group] === undefined ? defaults[group] !== false : Boolean(prefs[group]);
};

const reportError = (where, message) => {
  const c = cfg();
  if (!c.adminChatId || !c.topics.errors) return;
  enqueueAdmin({ eventId: `admin.error:${where}:${Date.now()}`, topic: 'errors', template: 'admin.error', params: { where, message } });
};

/** Обработать одну захваченную запись */
async function deliver(job) {
  const c = cfg();
  const bot = getBot();
  const done = (status, extra = {}) => Outbox.updateOne({ _id: job._id }, { $set: { status, lockedAt: null, ...extra } });
  const retry = (ms, error) => Outbox.updateOne({ _id: job._id }, { $set: { status: 'queued', lockedAt: null, nextTryAt: new Date(Date.now() + ms), ...(error ? { error } : {}) } });

  if (c.sendingDisabled || !bot) return done('skipped', { error: 'sending disabled' });

  let chatId = job.chatId;
  let user = null;
  let lang = 'ru';
  let batch = null;

  if (job.userId) {
    user = await User.findById(job.userId).select('tgId lang languageCode canMessage notifPrefs timezone').lean();
    if (!user) return done('skipped', { error: 'user not found' });
    if (!user.canMessage) return done('skipped', { error: 'no write access' });
    if (!prefAllows(user, job.group)) return done('skipped', { error: 'disabled in settings' });
    if (USER[job.template]?.quiet && isQuiet(user.timezone)) return retry(nextMorning(user.timezone) - Date.now());
    chatId = String(user.tgId);
    lang = langOf(user);

    if (USER[job.template]?.batch) {
      const siblings = await Outbox.find({
        _id: { $ne: job._id }, userId: job.userId, template: job.template, status: 'queued',
        createdAt: { $gte: new Date(new Date(job.createdAt).getTime() - BATCH_WINDOW_MS), $lte: new Date(new Date(job.createdAt).getTime() + BATCH_WINDOW_MS) },
      }).limit(20).lean();
      if (siblings.length) {
        const claimed = await Outbox.updateMany({ _id: { $in: siblings.map(s => s._id) }, status: 'queued' }, { $set: { status: 'sending', lockedAt: new Date() } });
        if (claimed.modifiedCount) batch = [job, ...siblings];
      }
    }
  }

  const isAdminChat = c.adminChatId && chatId === String(c.adminChatId);
  const wait = Math.max(chatReadyIn(chatId), isAdminChat ? adminReadyIn() : 0);
  if (wait > 0 || !takeGlobal()) {
    if (batch) await Outbox.updateMany({ _id: { $in: batch.slice(1).map(b => b._id) } }, { $set: { status: 'queued', lockedAt: null } });
    return retry(Math.max(wait, 200));
  }

  const msg = render(job.template, job.params, lang, user, batch?.map(b => b.params));
  try {
    lastPerChat.set(chatId, Date.now());
    if (isAdminChat) adminSends.push(Date.now());
    const sent = await bot.api.sendMessage(chatId, msg.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(job.threadId ? { message_thread_id: job.threadId } : {}),
      ...(msg.kb ? { reply_markup: msg.kb } : {}),
    });
    const extra = { sentAt: new Date(), messageId: sent?.message_id ?? null, error: null };
    await done('sent', extra);
    if (batch) await Outbox.updateMany({ _id: { $in: batch.slice(1).map(b => b._id) } }, { $set: { status: 'sent', lockedAt: null, ...extra } });
  } catch (e) {
    const code = e.error_code || e.status;
    const desc = e.description || e.message || String(e);
    if (batch) await Outbox.updateMany({ _id: { $in: batch.slice(1).map(b => b._id) } }, { $set: { status: 'queued', lockedAt: null } });
    if (code === 429) return retry(((e.parameters?.retry_after || 5) * 1000), desc);
    if (code === 403) {
      if (user) await User.updateOne({ _id: user._id }, { $set: { canMessage: false, botBlockedAt: new Date() } });
      return done('skipped', { error: desc });
    }
    if (code === 400) {
      if (!isAdminChat) reportError(job.template, desc);
      return done('failed', { error: desc });
    }
    const attempts = (job.attempts || 0) + 1;
    if (attempts > BACKOFF_MS.length) {
      await done('failed', { attempts, error: desc });
      if (!isAdminChat) reportError(job.template, desc);
      return;
    }
    await Outbox.updateOne({ _id: job._id }, { $set: { status: 'queued', lockedAt: null, attempts, error: desc, nextTryAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]) } });
  }
}

/** Один проход воркера: вернуть зависшие, захватить и отправить готовые записи */
async function tick(max = 25) {
  await Outbox.updateMany({ status: 'sending', lockedAt: { $lt: new Date(Date.now() - STUCK_MS) } }, { $set: { status: 'queued', lockedAt: null } });
  let processed = 0;
  for (let i = 0; i < max; i++) {
    const job = await Outbox.findOneAndUpdate(
      { status: 'queued', nextTryAt: { $lte: new Date() } },
      { $set: { status: 'sending', lockedAt: new Date() } },
      { sort: { nextTryAt: 1 }, new: true }
    ).lean();
    if (!job) break;
    processed += 1;
    try { await deliver(job); }
    catch (e) {
      console.error('[outbox] deliver crashed:', e.message);
      await Outbox.updateOne({ _id: job._id }, { $set: { status: 'queued', lockedAt: null, nextTryAt: new Date(Date.now() + 10_000), error: e.message } });
    }
  }
  return processed;
}

let timer = null;
let running = false;
function startWorker(intervalMs = 1000) {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(); } catch (e) { console.error('[outbox] tick:', e.message); }
    finally { running = false; }
  }, intervalMs);
  console.log('📨 Bot outbox worker started');
}
const stopWorker = () => { if (timer) clearInterval(timer); timer = null; };

module.exports = { enqueue, enqueueAdmin, tick, startWorker, stopWorker, isQuiet, prefAllows };
