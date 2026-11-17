/**
 * Перенос данных MongoDB → PostgreSQL.
 *
 *   MONGO_URI=… DATABASE_URL=… node scripts/migrate-from-mongo.js --yes
 *
 * - Mongo только читается.
 * - Таблицы Postgres очищаются (TRUNCATE) и заполняются заново — скрипт можно запускать повторно,
 *   например перед окончательным переключением.
 * - id и ссылки сохраняются (ObjectId → 24 hex), даты создания — тоже.
 * - В конце — сверка: количество записей и суммы балансов в обеих базах.
 */
require('dotenv').config();
// SRV-записи Atlas через публичный DNS (локальный резолвер их иногда не отдаёт)
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
const { MongoClient, ObjectId, Decimal128 } = require('mongodb');
const db = require('../src/db');

const MODELS = [
  ['users', require('../src/models/User')],
  ['cardtypes', require('../src/models/CardType')],
  ['cardimages', require('../src/models/CardImage')],
  ['usercards', require('../src/models/UserCard')],
  ['cardhistories', require('../src/models/CardHistory')],
  ['dailyearnings', require('../src/models/DailyProfit')],
  ['depositrequests', require('../src/models/DepositRequest')],
  ['withdrawalrequests', require('../src/models/WithdrawalRequest')],
  ['exchangeorders', require('../src/models/ExchangeOrder')],
  ['incomeevents', require('../src/models/IncomeEvent')],
  ['notifications', require('../src/models/Notification')],
  ['referralrewards', require('../src/models/ReferralReward')],
  ['quizanswers', require('../src/models/QuizAnswer')],
  ['adminactions', require('../src/models/AdminAction')],
  ['outboxes', require('../src/models/Outbox')],
  ['tgupdates', require('../src/models/TgUpdate')],
  ['tgfiles', require('../src/models/TgFile')],
];

/** BSON → обычные JS-значения: ObjectId → hex, Decimal128 → строка */
function plainify(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof ObjectId || v?._bsontype === 'ObjectId') return v.toHexString();
  if (v instanceof Decimal128 || v?._bsontype === 'Decimal128') return v.toString();
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(plainify);
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = plainify(x); return o; }
  return v;
}

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Приведение значений к ограничениям схемы (CHECK) — старые записи могли быть «грязными» */
function sanitize(collection, d) {
  if (collection === 'users') {
    d.role = pick(d.role, ['USER', 'ADMIN'], 'USER');
    d.accountStatus = pick(d.accountStatus, ['NEWBIE', 'DEPOSITOR', 'HOLDER', 'MINER'], 'NEWBIE');
    d.lang = pick(d.lang, ['ru', 'uk', 'en'], null);
    if (d.referralCode === '') d.referralCode = null;
  }
  if (collection === 'adminactions') d.source = pick(d.source, ['bot', 'admin_panel'], 'admin_panel');
  return d;
}

async function main() {
  if (!process.argv.includes('--yes')) {
    console.error('Таблицы Postgres будут очищены и заполнены из Mongo. Запустите с --yes.');
    process.exit(1);
  }
  if (!process.env.MONGO_URI || !process.env.DATABASE_URL) throw new Error('MONGO_URI и DATABASE_URL обязательны');

  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  const mdb = mongo.db();
  console.log(`Mongo: ${mdb.databaseName}`);

  await db.migrate();
  const tables = MODELS.map(([, m]) => `"${m.table}"`).join(', ');
  await db.query(`TRUNCATE ${tables}`);
  // Внешние ключи — после импорта (NOT VALID): старые записи удалённых пользователей переносятся как есть
  const { rows: fks } = await db.query(`SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`);
  for (const fk of fks) await db.query(`ALTER TABLE ${fk.tbl} DROP CONSTRAINT ${fk.conname}`);

  const report = [];
  for (const [coll, model] of MODELS) {
    const exists = (await mdb.listCollections({ name: coll }).toArray()).length > 0;
    if (!exists) { report.push({ coll, mongo: 0, pg: 0, errors: 0 }); continue; }
    const cursor = mdb.collection(coll).find({});
    let n = 0, errors = 0;
    for await (const raw of cursor) {
      n++;
      try {
        await model._insert(sanitize(coll, plainify(raw)));
      } catch (e) {
        errors++;
        if (errors <= 5) console.error(`  ${coll} ${raw._id}: ${e.message}`);
      }
    }
    const pg = await model.countDocuments();
    report.push({ coll, mongo: n, pg, errors });
    console.log(`${coll.padEnd(20)} mongo ${String(n).padStart(6)}  pg ${String(pg).padStart(6)}${errors ? `  ошибок ${errors}` : ''}`);
  }

  await db.migrate(); // вернуть внешние ключи

  // Сверка денег
  const mongoSums = (await mdb.collection('users').aggregate([{ $group: {
    _id: null,
    wallet: { $sum: { $toDouble: { $ifNull: ['$balance.walletUsd', 0] } } },
    staking: { $sum: { $toDouble: { $ifNull: ['$balance.stakingUsd', 0] } } },
    pending: { $sum: { $toDouble: { $ifNull: ['$balance.pendingWithdrawalUsd', 0] } } },
    refSats: { $sum: { $toDouble: { $ifNull: ['$balance.referralSats', 0] } } },
  } }]).toArray())[0] || {};
  const { rows: [pgSums] } = await db.query(`SELECT SUM(balance_wallet_usd)::float AS wallet, SUM(balance_staking_usd)::float AS staking,
    SUM(balance_pending_withdrawal_usd)::float AS pending, SUM(balance_referral_sats)::float AS "refSats" FROM users`);
  console.log('\nБалансы (Mongo → Postgres):');
  let moneyOk = true;
  for (const k of ['wallet', 'staking', 'pending', 'refSats']) {
    const a = Number(mongoSums[k] || 0), b = Number(pgSums?.[k] || 0);
    const ok = Math.abs(a - b) < 0.01;
    moneyOk = moneyOk && ok;
    console.log(`  ${k.padEnd(8)} ${a.toFixed(2).padStart(14)} → ${b.toFixed(2).padStart(14)} ${ok ? 'OK' : 'РАСХОЖДЕНИЕ'}`);
  }

  const countsOk = report.every(r => r.mongo === r.pg && r.errors === 0);
  console.log(`\nИтог: записи ${countsOk ? 'совпадают' : 'ЕСТЬ РАСХОЖДЕНИЯ'}, балансы ${moneyOk ? 'совпадают' : 'ЕСТЬ РАСХОЖДЕНИЯ'}`);

  await mongo.close();
  await db.close();
  process.exit(countsOk && moneyOk ? 0 : 2);
}

main().catch(async (e) => { console.error(e); try { await db.close(); } catch { /* ignore */ } process.exit(1); });
