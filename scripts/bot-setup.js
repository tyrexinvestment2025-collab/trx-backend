#!/usr/bin/env node
/**
 * Настройка бота в Telegram (запускать вручную):
 *
 *   node scripts/bot-setup.js --info                      — текущий вебхук и данные бота (только чтение)
 *   node scripts/bot-setup.js --commands                  — команды по языкам + /stats в меню админов
 *   node scripts/bot-setup.js --profile                   — имя, описание и короткое описание по языкам
 *   node scripts/bot-setup.js --menu                      — кнопка меню «Открыть» → WEBAPP_URL
 *   node scripts/bot-setup.js --webhook https://api.example.com   — setWebhook на <url>/api/v1/bot/webhook
 *   node scripts/bot-setup.js --delete-webhook
 *
 * Берёт BOT_TOKEN (или TELEGRAM_BOT_TOKEN), WEBHOOK_SECRET, WEBAPP_URL, ADMIN_IDS из .env.
 */
require('dotenv').config();
const axios = require('axios');

const TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error('BOT_TOKEN is not set'); process.exit(1); }
const api = async (method, params = {}) => {
  const { data } = await axios.post(`https://api.telegram.org/bot${TOKEN}/${method}`, params, { timeout: 15000 }).catch(e => ({ data: e.response?.data || { ok: false, description: e.message } }));
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
};

const COMMANDS = {
  en: [['app', 'Open Tyrex'], ['wallet', 'Balance, deposit and withdraw'], ['analytics', 'Income and forecast'], ['invite', 'Invite friends'], ['help', 'How it works'], ['support', 'Contact support'], ['lang', 'Change language'], ['privacy', 'Privacy and terms']],
  ru: [['app', 'Открыть Tyrex'], ['wallet', 'Баланс, пополнение и вывод'], ['analytics', 'Доход и прогноз'], ['invite', 'Пригласить друзей'], ['help', 'Как это работает'], ['support', 'Поддержка'], ['lang', 'Сменить язык'], ['privacy', 'Конфиденциальность и условия']],
  uk: [['app', 'Відкрити Tyrex'], ['wallet', 'Баланс, поповнення та виведення'], ['analytics', 'Дохід і прогноз'], ['invite', 'Запросити друзів'], ['help', 'Як це працює'], ['support', 'Підтримка'], ['lang', 'Змінити мову'], ['privacy', 'Конфіденційність та умови']],
};
const STATS = { en: ['stats', 'Admin: statistics'], ru: ['stats', 'Админ: статистика'], uk: ['stats', 'Адмін: статистика'] };

const PROFILE = {
  en: { name: 'Tyrex', short: 'BTC mining cards in Telegram. Open the app to start.', description: 'Tyrex — BTC mining cards inside Telegram.\n\nBuy a card, start it and income accrues every minute at the series rate. Notifications about deposits, withdrawals and your cards come here.\n\nAny investment involves risk.' },
  ru: { name: 'Tyrex', short: 'Карты майнинга BTC в Telegram. Откройте приложение, чтобы начать.', description: 'Tyrex — карты майнинга BTC прямо в Telegram.\n\nКупите карту, запустите её — и доход начисляется каждую минуту по ставке серии. Сюда приходят уведомления о пополнениях, выводах и ваших картах.\n\nЛюбые вложения связаны с риском.' },
  uk: { name: 'Tyrex', short: 'Картки майнінгу BTC у Telegram. Відкрийте застосунок, щоб почати.', description: 'Tyrex — картки майнінгу BTC просто в Telegram.\n\nКупіть картку, запустіть її — і дохід нараховується щохвилини за ставкою серії. Сюди надходять сповіщення про поповнення, виведення та ваші картки.\n\nБудь-які вкладення пов’язані з ризиком.' },
};

const toCmd = (list) => list.map(([command, description]) => ({ command, description }));

async function setCommands() {
  await api('setMyCommands', { commands: toCmd(COMMANDS.en) });
  for (const lang of Object.keys(COMMANDS)) await api('setMyCommands', { commands: toCmd(COMMANDS[lang]), language_code: lang });
  const admins = String(process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const id of admins) {
    try {
      await api('setMyCommands', { commands: toCmd([...COMMANDS.ru, STATS.ru]), scope: { type: 'chat', chat_id: Number(id) } });
    } catch (e) { console.warn(`  admin ${id}: ${e.message} (админ должен сначала нажать Start)`); }
  }
  console.log(`✓ commands: default + ${Object.keys(COMMANDS).join(', ')}; /stats for ${admins.length} admin(s)`);
}

async function setProfile() {
  for (const [lang, p] of Object.entries(PROFILE)) {
    const lc = lang === 'en' ? {} : { language_code: lang };
    await api('setMyName', { name: p.name, ...lc });
    await api('setMyShortDescription', { short_description: p.short, ...lc });
    await api('setMyDescription', { description: p.description, ...lc });
  }
  console.log('✓ name, description, short description (en default, ru, uk)');
}

async function setMenu() {
  const url = (process.env.WEBAPP_URL || '').replace(/\/+$/, '');
  if (!url) throw new Error('WEBAPP_URL is not set');
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Открыть', web_app: { url } } });
  console.log(`✓ menu button → ${url}`);
}

async function setWebhook(base) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) throw new Error('WEBHOOK_SECRET is not set');
  const url = `${String(base).replace(/\/+$/, '')}/api/v1/bot/webhook`;
  await api('setWebhook', {
    url, secret_token: secret, drop_pending_updates: false, max_connections: 40,
    allowed_updates: ['message', 'callback_query', 'inline_query', 'chat_member', 'my_chat_member'],
  });
  console.log(`✓ webhook → ${url}`);
}

async function info() {
  const me = await api('getMe');
  const wh = await api('getWebhookInfo');
  console.log(`bot: @${me.username} (id ${me.id}), main web app: ${me.has_main_web_app ? 'yes' : 'no'}`);
  console.log(`webhook: ${wh.url || '(none)'}; pending: ${wh.pending_update_count}; last error: ${wh.last_error_message || '—'}`);
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('Usage: see header of scripts/bot-setup.js'); return; }
  if (args.includes('--info')) await info();
  if (args.includes('--commands')) await setCommands();
  if (args.includes('--profile')) await setProfile();
  if (args.includes('--menu')) await setMenu();
  const wi = args.indexOf('--webhook');
  if (wi >= 0) await setWebhook(args[wi + 1]);
  if (args.includes('--delete-webhook')) { await api('deleteWebhook', { drop_pending_updates: false }); console.log('✓ webhook deleted'); }
})().catch(e => { console.error('✗', e.message); process.exit(1); });
