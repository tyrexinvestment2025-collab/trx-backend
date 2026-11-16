const mongoose = require('mongoose');

/** Decimal128 / string / number → number (NaN → 0) */
const toNum = (v) => {
    if (v === null || v === undefined) return 0;
    const n = parseFloat(v.toString());
    return Number.isFinite(n) ? n : 0;
};

/** Округление до центов */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Значение для $inc по Decimal128-полю */
const dec = (n) => mongoose.Types.Decimal128.fromString(round2(n).toFixed(2));

const isObjectId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v);

module.exports = { toNum, round2, dec, isObjectId };
