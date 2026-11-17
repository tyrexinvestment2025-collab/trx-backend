const { Dec, isId } = require('../db/model');

/** NUMERIC (Dec) / string / number → number (NaN → 0) */
const toNum = (v) => {
    if (v === null || v === undefined) return 0;
    const n = parseFloat(v.toString());
    return Number.isFinite(n) ? n : 0;
};

/** Округление до центов */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Денежное значение для $inc / $set по NUMERIC-полю (до центов) */
const dec = (n) => new Dec(round2(n).toFixed(2));

/** id записи (24 hex, формат бывших ObjectId) */
const isObjectId = (v) => isId(v);

module.exports = { toNum, round2, dec, isObjectId };
