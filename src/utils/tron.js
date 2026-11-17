const crypto = require('crypto');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

/** base58 → байты (null, если есть недопустимый символ) */
function base58Decode(s) {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  return Buffer.concat([Buffer.alloc(zeros), body]);
}

/**
 * Адрес TRON (USDT TRC20): base58check, 25 байт = 0x41 + 20 байт + 4 байта контрольной суммы
 * (первые 4 байта sha256(sha256(первые 21 байт))). Опечатка в любом символе ловится контрольной суммой.
 */
function isValidTronAddress(addr) {
  if (typeof addr !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return false;
  const raw = base58Decode(addr);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return false;
  const check = sha256(sha256(raw.subarray(0, 21))).subarray(0, 4);
  return check.equals(raw.subarray(21));
}

module.exports = { isValidTronAddress };
