const User = require('../models/User');
const { generateReferralCode } = require('../utils/referralCodeGenerator');
const { parseStartPayload, sourceOf } = require('../bot/startPayload');

const getAdminIds = () => String(process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const roleFor = (tgId) => (getAdminIds().includes(String(tgId)) ? 'ADMIN' : 'USER');

/** Язык по language_code Telegram: uk → uk, ru/be/kk → ru, остальное → en */
const langFromCode = (code) => {
  const c = String(code || '').toLowerCase().slice(0, 2);
  if (c === 'uk') return 'uk';
  if (c === 'ru' || c === 'be' || c === 'kk') return 'ru';
  return 'en';
};

/**
 * Единая точка создания пользователя — для входа в Mini App и для /start в боте.
 * Пригласивший ставится только при создании (первое касание) и никогда не меняется;
 * свой и несуществующий коды молча игнорируются.
 * Возвращает { user, created, inviter }.
 */
async function findOrCreateUser(tgUser, { startPayload, via } = {}) {
  const tgId = Number(tgUser.id);
  const existing = await User.findOne({ tgId });
  if (existing) return { user: existing, created: false, inviter: null };

  const parsed = parseStartPayload(startPayload);
  let inviter = null;
  if (parsed.kind === 'ref') {
    inviter = await User.findOne({ referralCode: parsed.code }).select('_id tgId lang languageCode canMessage').lean();
    if (inviter && Number(inviter.tgId) === tgId) inviter = null;
  }

  let code = generateReferralCode();
  while (await User.exists({ referralCode: code })) code = generateReferralCode();

  const signupBonus = Number(process.env.SIGNUP_BONUS_USD) || 0;
  const data = {
    tgId,
    username: tgUser.username || `User${tgId}`,
    firstName: String(tgUser.first_name || '').slice(0, 64),
    role: roleFor(tgId),
    languageCode: tgUser.language_code || 'en',
    lang: langFromCode(tgUser.language_code),
    referralCode: code,
    uplineUserId: inviter?._id || null,
    source: inviter ? 'ref' : sourceOf(parsed.kind === 'ref' ? { kind: 'none' } : parsed),
    canMessage: via === 'bot',
    balance: { walletUsd: signupBonus.toFixed(2) },
    accountStatus: 'NEWBIE'
  };

  try {
    const doc = await User.create(data);
    return { user: doc, created: true, inviter };
  } catch (e) {
    if (e.code === 11000) {
      // параллельный запрос (бот и приложение одновременно) уже создал пользователя
      return { user: await User.findOne({ tgId }), created: false, inviter: null };
    }
    throw e;
  }
}

module.exports = { findOrCreateUser, roleFor, getAdminIds, langFromCode };
