/**
 * Подключение к PostgreSQL.
 * В проде — пул pg (DATABASE_URL). В тестах можно подставить другой драйвер с тем же query(text, params)
 * (например, PGlite) через setDriver().
 */
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// bigint (tgId) → Number: Telegram id помещаются в безопасный диапазон JS
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// numeric оставляем строкой — модели заворачивают в Dec без потери точности

let driver = null;

function getDriver() {
  if (!driver) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    driver = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
    });
    driver.on('error', (e) => console.error('[pg] idle client error:', e.message));
  }
  return driver;
}

function setDriver(d) { driver = d; }

/** Ошибки Postgres → коды, которые ждёт код приложения (11000 — дубликат уникального ключа) */
function mapError(e) {
  if (e && e.code === '23505') { e.pgCode = '23505'; e.code = 11000; }
  return e;
}

async function query(text, params = []) {
  try {
    const r = await getDriver().query(text, params);
    return { rows: r.rows || [], rowCount: r.rowCount ?? r.affectedRows ?? (r.rows ? r.rows.length : 0) };
  } catch (e) {
    throw mapError(e);
  }
}

/** Применить схему (идемпотентно: CREATE … IF NOT EXISTS) */
async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (typeof getDriver().exec === 'function') await getDriver().exec(sql); // PGlite: несколько команд за раз
    else await query(sql);
  }
}

async function connectDB() {
  await query('SELECT 1');
  await migrate();
  const u = new URL(process.env.DATABASE_URL);
  console.log(`PostgreSQL connected: ${u.hostname}/${u.pathname.slice(1)}`);
}

async function close() {
  if (driver && typeof driver.end === 'function') await driver.end();
  else if (driver && typeof driver.close === 'function') await driver.close();
  driver = null;
}

module.exports = { query, migrate, connectDB, close, setDriver, getDriver };
