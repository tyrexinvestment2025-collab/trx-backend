/**
 * Обработчики апдейтов бота: /start и глубокие ссылки, команды, язык, QR, быстрые действия в админ-чате.
 * Бот никогда не молчит: на любой текст в личке — подсказка и кнопки.
 */
const { InputFile } = require('grammy');
const QRCode = require('qrcode');
const User = require('../models/User');
const UserCard = require('../models/UserCard');
const CardType = require('../models/CardType');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const TgFile = require('../models/TgFile');
const priceService = require('../services/priceService2');
const requestService = require('../services/requestService');
const { findOrCreateUser, getAdminIds } = require('../services/userService');
const { parseStartPayload } = require('./startPayload');
const { t, langOf, LANGS } = require('./texts');
const { money, pct, int, escapeHtml } = require('./format');
const { cfg, openButton, refLink } = require('./config');
const A = require('./adminTexts');
const events = require('./events');
const { toNum, round2 } = require('../utils/money');

const SATS = 100_000_000;
const kb = (...rows) => ({ inline_keyboard: rows.filter(r => r && r.length) });
const isAdminTg = (tgId) => getAdminIds().includes(String(tgId));
const isPrivate = (ctx) => ctx.chat?.type === 'private';
const supportBtn = (lang) => ({ text: t('btn.support', lang), url: cfg().supportUrl });
const send = (ctx, text, extra = {}) => ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

/** Пользователь из базы по апдейту (без создания) */
const dbUser = (ctx) => User.findOne({ tgId: ctx.from.id });

/** Язык ответа: из профиля, иначе из Telegram */
const langFor = (user, ctx) => langOf(user || ctx.from?.language_code);

/** Заблокированному — одно сообщение с поддержкой, без данных */
const guardBanned = async (ctx, user) => {
  if (!user?.isBanned) return false;
  const l = langFor(user, ctx);
  await send(ctx, t('banned', l), { reply_markup: kb([supportBtn(l)]) });
  return true;
};

const markReachable = (tgId, firstName) => User.updateOne(
  { tgId },
  { $set: { canMessage: true, botBlockedAt: null, ...(firstName ? { firstName: String(firstName).slice(0, 64) } : {}) } }
);

// ---------- /start ----------
async function onStart(ctx) {
  const payload = ctx.match || '';
  const parsed = parseStartPayload(payload);
  const { user: created, created: isNew, inviter } = await findOrCreateUser(ctx.from, { startPayload: payload, via: 'bot' });
  await markReachable(ctx.from.id, ctx.from.first_name);
  const user = await User.findById(created._id).lean();
  if (isNew && inviter) await events.referralJoined(inviter._id, user);
  if (await guardBanned(ctx, user)) return;

  const l = langFor(user, ctx);
  let section = null;
  if (parsed.kind === 'page') section = parsed.section;
  if (parsed.kind === 'admin' && isAdminTg(ctx.from.id)) section = 'admin';

  const markup = kb(
    [openButton(t('btn.open', l), section)],
    [{ text: t('btn.channel', l), url: cfg().channelUrl }],
  );
  const text = t('welcome', l, { name: escapeHtml(ctx.from.first_name || '') });

  const photo = await TgFile.findOne({ key: 'welcome' }).lean();
  const photoUrl = process.env.WELCOME_IMAGE_URL;
  if (photo || photoUrl) {
    try {
      const msg = await ctx.replyWithPhoto(photo ? photo.fileId : photoUrl, { caption: text, parse_mode: 'HTML', reply_markup: markup });
      const fileId = msg?.photo?.[msg.photo.length - 1]?.file_id;
      if (!photo && fileId) await TgFile.updateOne({ key: 'welcome' }, { $set: { fileId } }, { upsert: true });
      return;
    } catch (e) { console.warn('[bot] welcome photo failed:', e.description || e.message); }
  }
  await send(ctx, text, { reply_markup: markup });
}

// ---------- Команды ----------
async function onApp(ctx) {
  const user = await dbUser(ctx);
  if (await guardBanned(ctx, user)) return;
  const l = langFor(user, ctx);
  await send(ctx, t('app', l), { reply_markup: kb([openButton(t('btn.open', l))]) });
}

async function onWallet(ctx) {
  const user = await dbUser(ctx);
  if (await guardBanned(ctx, user)) return;
  const l = langFor(user, ctx);
  if (!user) return send(ctx, t('noAccount', l), { reply_markup: kb([openButton(t('btn.open', l))]) });
  const pendingDeposits = await DepositRequest.find({ userId: user._id, status: 'PENDING' }).select('amountUsd').lean();
  const pending = toNum(user.balance?.pendingWithdrawalUsd) + pendingDeposits.reduce((a, d) => a + toNum(d.amountUsd), 0);
  await send(ctx, t('wallet', l, { available: money(toNum(user.balance?.walletUsd), l), pending: money(pending, l) }), {
    reply_markup: kb([openButton(t('btn.deposit', l), 'wallet'), openButton(t('btn.withdraw', l), 'wallet')]),
  });
}

async function onAnalytics(ctx) {
  const user = await dbUser(ctx);
  if (await guardBanned(ctx, user)) return;
  const l = langFor(user, ctx);
  await send(ctx, t('analytics', l), { reply_markup: kb([openButton(t('btn.analytics', l), 'analytics')]) });
}

/** Данные для /invite */
async function inviteData(user) {
  const partners = await User.find({ uplineUserId: user._id }).select('_id').lean();
  const ids = partners.map(p => p._id);
  const buyers = ids.length ? await UserCard.distinct('userId', { userId: { $in: ids }, isTrial: { $ne: true } }) : [];
  const price = priceService.getBitcoinPrice() || 0;
  const sats = (user.balance?.referralSats || 0) + (user.balance?.walletSats || 0);
  const types = await CardType.find({ isActive: true }).select('referralAPY').lean();
  const rates = types.map(x => x.referralAPY).filter(r => r > 0);
  return { invited: partners.length, bought: buyers.length, availableUsd: round2((sats / SATS) * price), minRate: rates.length ? Math.min(...rates) : 0, maxRate: rates.length ? Math.max(...rates) : 0 };
}

async function onInvite(ctx) {
  const user = await dbUser(ctx);
  if (await guardBanned(ctx, user)) return;
  const l = langFor(user, ctx);
  if (!user) return send(ctx, t('noAccount', l), { reply_markup: kb([openButton(t('btn.open', l))]) });
  const d = await inviteData(user);
  const link = refLink(user.referralCode);
  const rates = d.minRate === d.maxRate ? pct(d.maxRate, l) : `${pct(d.minRate, l)}–${pct(d.maxRate, l)}`;
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('shareText', l))}`;
  await send(ctx, t('invite', l, { link, invited: int(d.invited, l), bought: int(d.bought, l), available: money(d.availableUsd, l), rates }), {
    reply_markup: kb(
      [{ text: t('btn.share', l), url: share }],
      [openButton(t('btn.claim', l, { amount: money(d.availableUsd, l) }), 'referral'), { text: t('btn.qr', l), callback_data: 'inv:qr' }],
    ),
  });
}

async function onQr(ctx) {
  await ctx.answerCallbackQuery();
  const user = await dbUser(ctx);
  if (!user || user.isBanned) return;
  const l = langFor(user, ctx);
  const link = refLink(user.referralCode);
  const key = `qr:${user.referralCode}`;
  const cached = await TgFile.findOne({ key }).lean();
  const caption = t('qrCaption', l, { link });
  if (cached) return ctx.replyWithPhoto(cached.fileId, { caption });
  const png = await QRCode.toBuffer(link, { width: 720, margin: 3, color: { dark: '#0B0E17', light: '#FFFFFF' } });
  const msg = await ctx.replyWithPhoto(new InputFile(png, 'tyrex-invite.png'), { caption });
  const fileId = msg?.photo?.[msg.photo.length - 1]?.file_id;
  if (fileId) await TgFile.updateOne({ key }, { $set: { fileId } }, { upsert: true });
}

async function onHelp(ctx) {
  const user = await dbUser(ctx);
  if (await guardBanned(ctx, user)) return;
  const l = langFor(user, ctx);
  const c = cfg();
  await send(ctx, t('help', l), { reply_markup: kb(
    [openButton(t('btn.open', l))],
    c.termsUrl ? [{ text: t('btn.terms', l), url: c.termsUrl }] : [openButton(t('btn.terms', l), 'profile')],
  ) });
}

async function onSupport(ctx) {
  const user = await dbUser(ctx);
  const l = langFor(user, ctx);
  await send(ctx, t('support', l, { tgId: ctx.from.id }), { reply_markup: kb([supportBtn(l)]) });
}

const langKeyboard = () => kb([
  { text: 'Русский', callback_data: 'lang:ru' }, { text: 'Українська', callback_data: 'lang:uk' }, { text: 'English', callback_data: 'lang:en' },
]);

async function onLang(ctx) {
  const user = await dbUser(ctx);
  await send(ctx, t('langChoose', langFor(user, ctx)), { reply_markup: langKeyboard() });
}

async function onLangPick(ctx) {
  const lang = ctx.match[1];
  if (!LANGS.includes(lang)) return ctx.answerCallbackQuery();
  await User.updateOne({ tgId: ctx.from.id }, { $set: { lang } });
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t('langSet', lang)).catch(() => {});
}

async function onPrivacy(ctx) {
  const user = await dbUser(ctx);
  const l = langFor(user, ctx);
  const c = cfg();
  const rows = [];
  if (c.privacyUrl) rows.push([{ text: t('btn.privacy', l), url: c.privacyUrl }]);
  if (c.termsUrl) rows.push([{ text: t('btn.terms', l), url: c.termsUrl }]);
  if (!rows.length) rows.push([openButton(t('btn.terms', l), 'profile')]);
  await send(ctx, t('privacy', l), { reply_markup: kb(...rows) });
}

async function statsData() {
  const since = new Date(Date.now() - 86400_000);
  const [users, users24h, activeCards, pendingDeposits, pendingWithdrawals, canMessage] = await Promise.all([
    User.countDocuments({}), User.countDocuments({ createdAt: { $gte: since } }),
    UserCard.countDocuments({ status: 'Active' }),
    DepositRequest.countDocuments({ status: 'PENDING' }), WithdrawalRequest.countDocuments({ status: 'PENDING' }),
    User.countDocuments({ canMessage: true }),
  ]);
  return { users, users24h, activeCards, pendingDeposits, pendingWithdrawals, canMessage };
}

async function onStats(ctx) {
  if (!isAdminTg(ctx.from.id)) return onUnknown(ctx);
  await send(ctx, A.stats(await statsData()));
}

async function onUnknown(ctx) {
  if (!isPrivate(ctx)) return;
  const user = await dbUser(ctx);
  if (await guardBanned(ctx, user)) return;
  const l = langFor(user, ctx);
  await send(ctx, t('unknown', l), { reply_markup: kb([openButton(t('btn.open', l))], [supportBtn(l)]) });
}

// ---------- Админ-чат: быстрые действия ----------
const actorOf = (ctx) => ({ tgId: ctx.from.id, username: ctx.from.username || null, source: 'bot' });
const loadRequest = async (kind, id) => {
  const Model = kind === 'dep' ? DepositRequest : WithdrawalRequest;
  const r = await Model.findById(id).lean();
  if (!r) return null;
  const u = await User.findById(r.userId).select('tgId username firstName balance').lean();
  return { r, u };
};
const cardText = (kind, r, u) => {
  const base = {
    id: String(r._id), amount: round2(toNum(r.amountUsd)), createdAt: r.createdAt,
    tgId: u?.tgId, username: u?.username && !/^User\d+$/.test(u.username) ? u.username : null, firstName: u?.firstName,
  };
  return kind === 'dep'
    ? A.depositCard({ ...base, txHash: r.txHash })
    : A.withdrawalCard({ ...base, address: r.walletAddress, balance: round2(toNum(u?.balance?.walletUsd)) });
};
const whoShort = (u) => (u?.username && !/^User\d+$/.test(u.username) ? `@${escapeHtml(u.username)}` : `id ${u?.tgId}`);
const NOT_PENDING = 'Заявка уже обработана';

async function onAdminAction(ctx) {
  const [, kind, action, id] = ctx.match;
  if (!isAdminTg(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Нет прав', show_alert: true });
  const data = await loadRequest(kind, id);
  if (!data) return ctx.answerCallbackQuery({ text: 'Заявка не найдена', show_alert: true });
  const { r, u } = data;
  const amount = money(toNum(r.amountUsd), 'ru');

  if (r.status !== 'PENDING') {
    await ctx.answerCallbackQuery({ text: NOT_PENDING, show_alert: true });
    return ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  }

  const editCard = (suffix, markup) => ctx.editMessageText(`${cardText(kind, r, u)}${suffix ? `\n\n${suffix}` : ''}`, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: markup }).catch(() => {});

  // Шаг 1 → вопрос «Да / Нет»
  if (action === 'ok' || action === 'paid') {
    await ctx.answerCallbackQuery();
    const q = action === 'ok' ? `Подтвердить ${amount} для ${whoShort(u)}?` : `Отметить выплату ${amount} для ${whoShort(u)}?`;
    return editCard(`<b>${q}</b>`, A.confirmButtons(kind, action, id));
  }
  if (action === 'back') {
    await ctx.answerCallbackQuery();
    return editCard('', kind === 'dep' ? A.depositButtons(id) : A.withdrawalButtons(id));
  }
  // Шаг 2: подтверждение пополнения
  if (action === 'ok!') {
    const res = await requestService.confirmDeposit(id, actorOf(ctx));
    await ctx.answerCallbackQuery({ text: res.ok ? 'Готово' : NOT_PENDING, show_alert: !res.ok });
    return;
  }
  // Шаг 2 для выплаты: попросить хэш (можно пропустить)
  if (action === 'paid!') {
    await ctx.answerCallbackQuery();
    await editCard('<i>Жду хэш выплаты ответом ниже или нажмите «Без хэша».</i>', kb([{ text: 'Без хэша', callback_data: `wd:nohash:${id}` }, { text: 'Отмена', callback_data: `wd:back:${id}` }]));
    return ctx.reply(`Хэш выплаты для заявки [wd:${id}] — ответьте на это сообщение.`, {
      ...(ctx.msg?.message_thread_id ? { message_thread_id: ctx.msg.message_thread_id } : {}),
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Хэш транзакции' },
    });
  }
  if (action === 'nohash') {
    const res = await requestService.markWithdrawalPaid(id, null, actorOf(ctx));
    await ctx.answerCallbackQuery({ text: res.ok ? 'Готово' : NOT_PENDING, show_alert: !res.ok });
    return;
  }
  // Отказ: причина обязательна — ответом на сообщение (ForceReply)
  if (action === 'no') {
    await ctx.answerCallbackQuery();
    return ctx.reply(`Причина отказа для заявки [${kind}:${id}] — ответьте на это сообщение. Её получит пользователь дословно.`, {
      ...(ctx.msg?.message_thread_id ? { message_thread_id: ctx.msg.message_thread_id } : {}),
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Причина отказа' },
    });
  }
  return ctx.answerCallbackQuery();
}

/** Ответ админа на запрос причины / хэша */
async function onAdminReply(ctx, next) {
  const prompt = ctx.msg?.reply_to_message?.text || '';
  const m = prompt.match(/\[(dep|wd):([a-f0-9]{24})\]/);
  if (!m || ctx.msg.reply_to_message.from?.id !== ctx.me.id) return next();
  if (!isAdminTg(ctx.from.id)) return; // не-админ в чате — молча игнорируем
  const [, kind, id] = m;
  const text = String(ctx.msg.text || '').trim();
  if (!text) return ctx.reply('Нужен текст.', { reply_parameters: { message_id: ctx.msg.message_id } });

  let res;
  if (prompt.startsWith('Хэш выплаты')) res = await requestService.markWithdrawalPaid(id, text, actorOf(ctx));
  else if (kind === 'dep') res = await requestService.rejectDeposit(id, text, actorOf(ctx));
  else res = await requestService.rejectWithdrawal(id, text, actorOf(ctx));

  await ctx.reply(res.ok ? 'Готово, пользователь получил уведомление.' : NOT_PENDING, { reply_parameters: { message_id: ctx.msg.message_id } });
}

// ---------- Статус бота в личке (заблокировал / разблокировал) ----------
async function onMyChatMember(ctx) {
  const upd = ctx.myChatMember;
  if (upd.chat.type !== 'private') return;
  const status = upd.new_chat_member.status;
  if (status === 'kicked') await User.updateOne({ tgId: upd.from.id }, { $set: { canMessage: false, botBlockedAt: new Date() } });
  if (status === 'member') await User.updateOne({ tgId: upd.from.id }, { $set: { canMessage: true, botBlockedAt: null } });
}

/** Регистрация всех обработчиков на экземпляре бота */
function register(bot) {
  bot.on('my_chat_member', onMyChatMember);
  bot.command('start', (ctx) => (isPrivate(ctx) ? onStart(ctx) : undefined));
  bot.command('app', onApp);
  bot.command('wallet', (ctx) => (isPrivate(ctx) ? onWallet(ctx) : undefined));
  bot.command('analytics', onAnalytics);
  bot.command('invite', (ctx) => (isPrivate(ctx) ? onInvite(ctx) : undefined));
  bot.command('help', onHelp);
  bot.command('support', onSupport);
  bot.command('lang', onLang);
  bot.command('privacy', onPrivacy);
  bot.command('stats', onStats);
  bot.callbackQuery(/^lang:(ru|uk|en)$/, onLangPick);
  bot.callbackQuery('inv:qr', onQr);
  bot.callbackQuery(/^(dep|wd):(ok|paid|back|ok!|paid!|nohash|no):([a-f0-9]{24})$/, onAdminAction);
  bot.on('message:text', onAdminReply);
  bot.on('message', onUnknown);
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());
  bot.catch((err) => console.error('[bot] handler error:', err.error?.message || err.message));
}

module.exports = { register, statsData, inviteData };
