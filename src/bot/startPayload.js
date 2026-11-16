/**
 * Разбор параметра /start <payload> и start_param из initData Mini App — одна функция для обоих путей.
 *  ref_<код>          — пригласивший (только первое касание нового пользователя)
 *  p_<раздел>         — открыть экран (белый список)
 *  ch_<пост>          — метка источника из канала
 *  adm_dep_<id> / adm_wd_<id> — карточка заявки в админке (только для админов)
 *  <код>              — старый формат реф-ссылок приложения (startapp=<код>)
 */
const { SECTIONS } = require('./config');

const HEX24 = /^[a-f0-9]{24}$/i;
const CODE = /^[A-Za-z0-9]{4,32}$/;

const parseStartPayload = (raw) => {
  const p = String(raw || '').trim();
  if (!p) return { kind: 'none' };
  if (p.startsWith('ref_')) {
    const code = p.slice(4);
    return CODE.test(code) ? { kind: 'ref', code } : { kind: 'none' };
  }
  if (p.startsWith('p_')) {
    const section = p.slice(2);
    return SECTIONS[section] ? { kind: 'page', section } : { kind: 'page', section: null };
  }
  if (p.startsWith('ch_')) {
    const post = p.slice(3);
    return /^[A-Za-z0-9-]{1,32}$/.test(post) ? { kind: 'channel', post } : { kind: 'none' };
  }
  const adm = p.match(/^adm_(dep|wd)_([a-f0-9]{24})$/i);
  if (adm) return { kind: 'admin', target: adm[1].toLowerCase(), id: adm[2] };
  if (CODE.test(p) && !HEX24.test(p)) return { kind: 'ref', code: p, legacy: true };
  return { kind: 'none' };
};

/** Источник для статистики (пишется только новым пользователям) */
const sourceOf = (parsed) => {
  if (parsed.kind === 'ref') return 'ref';
  if (parsed.kind === 'channel') return `ch_${parsed.post}`;
  if (parsed.kind === 'page' && parsed.section) return `p_${parsed.section}`;
  return 'direct';
};

module.exports = { parseStartPayload, sourceOf };
