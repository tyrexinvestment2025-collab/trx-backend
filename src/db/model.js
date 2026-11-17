/**
 * Тонкий слой моделей поверх PostgreSQL.
 *
 * Таблицы — обычные реляционные (src/db/migrations), деньги — NUMERIC.
 * Интерфейс повторяет то подмножество Mongoose, которое использует приложение
 * (find / findOne / findOneAndUpdate / updateOne / $inc / $set / populate / select / sort …),
 * поэтому бизнес-логика и её тесты не переписывались.
 *
 * Атомарность: findOneAndUpdate / updateOne берут строку через SELECT … FOR UPDATE и проверяют
 * условие фильтра после блокировки — две параллельные операции над одной заявкой/балансом
 * не пройдут обе (как условные обновления в Mongo).
 *
 * Поддерживаемые операторы фильтра: равенство, null, RegExp, $eq $ne $gt $gte $lt $lte $in $nin
 * $exists $regex/$options, $or, $and. Обновления: $set, $inc, $unset, $setOnInsert, upsert.
 */
const crypto = require('crypto');
const db = require('./index');

/** Десятичное значение (NUMERIC). toString — точная строка; в JSON — как Decimal128 у Mongo. */
class Dec {
  constructor(v) { this.v = String(v); }
  toString() { return this.v; }
  valueOf() { return Number(this.v); }
  toJSON() { return { $numberDecimal: this.v }; }
}

// --- id в формате ObjectId (24 hex): старые id из Mongo переносятся как есть ---
let counter = crypto.randomInt(0xffffff);
const PROCESS_RAND = crypto.randomBytes(5).toString('hex');
function newId() {
  counter = (counter + 1) % 0xffffff;
  return Math.floor(Date.now() / 1000).toString(16).padStart(8, '0') + PROCESS_RAND + counter.toString(16).padStart(6, '0');
}
const ID_RE = /^[a-f0-9]{24}$/i;

const snake = (s) => s.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const q = (ident) => `"${ident}"`;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Dec) && !(v instanceof RegExp);
const hasOps = (v) => isPlainObject(v) && Object.keys(v).some(k => k.startsWith('$'));

function getPath(obj, p) {
  if (obj == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, p)) return obj[p];
  let cur = obj;
  for (const k of p.split('.')) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}
function setPath(obj, p, v) {
  const ks = p.split('.');
  let cur = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (!isPlainObject(cur[ks[i]])) cur[ks[i]] = {}; cur = cur[ks[i]]; }
  cur[ks[ks.length - 1]] = v;
}
function delPath(obj, p) {
  const ks = p.split('.');
  let cur = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (cur == null) return; cur = cur[ks[i]]; }
  if (cur) delete cur[ks[ks.length - 1]];
}

const CAST = { decimal: 'numeric', double: 'double precision', int: 'integer', bigint: 'bigint' };

function toDb(f, v) {
  if (v === undefined || v === null) return null;
  switch (f.type) {
    case 'id': case 'ref': return String(typeof v === 'object' && v._id !== undefined ? v._id : v);
    case 'decimal': return String(v);
    case 'int': case 'double': case 'bigint': return Number(v);
    case 'bool': return Boolean(v);
    case 'date': return v instanceof Date ? v : new Date(v);
    case 'json': return JSON.stringify(v);
    default: return String(v);
  }
}
function fromDb(f, v) {
  if (v === undefined || v === null) return null;
  switch (f.type) {
    case 'id': case 'ref': return String(v).trim();
    case 'decimal': return new Dec(v);
    case 'int': case 'double': case 'bigint': return Number(v);
    case 'bool': return Boolean(v);
    case 'date': return v instanceof Date ? v : new Date(v);
    case 'json': return typeof v === 'string' ? JSON.parse(v) : v;
    default: return v;
  }
}

const registry = {};

/** Документ (не lean): поля + save() / toObject() */
class Doc {
  constructor(model, data, isNew) {
    Object.assign(this, data);
    Object.defineProperty(this, '$model', { value: model, enumerable: false });
    Object.defineProperty(this, '$isNew', { value: isNew, enumerable: false, writable: true });
    Object.defineProperty(this, '$orig', { value: isNew ? null : model._snapshot(this), enumerable: false, writable: true });
  }
  get id() { return this._id == null ? null : String(this._id); }
  toObject() { return plain(this); }
  toJSON() { return plain(this); }
  async save() {
    const m = this.$model;
    if (this.$isNew) {
      const created = await m._insert(plain(this));
      Object.assign(this, created);
      this.$isNew = false;
      this.$orig = m._snapshot(this);
      return this;
    }
    const now = m._snapshot(this);
    const $set = {};
    for (const p of Object.keys(now)) if (p !== '_id' && now[p] !== this.$orig[p]) $set[p] = getPath(this, p);
    if (Object.keys($set).length) {
      const fresh = await m.findOneAndUpdate({ _id: this._id }, { $set }, { new: true }).lean();
      if (fresh) Object.assign(this, fresh);
    }
    this.$orig = m._snapshot(this);
    return this;
  }
}

function plain(v) {
  if (v instanceof Doc) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = plain(v[k]);
    return o;
  }
  if (isPlainObject(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = plain(v[k]); return o; }
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

class Query {
  constructor(model, op, args) {
    Object.assign(this, { model, op, args, _select: null, _sort: null, _limit: null, _skip: null, _lean: false, _populate: [], _distinct: null });
  }
  select(s) { this._select = s; return this; }
  sort(s) { this._sort = s; return this; }
  limit(n) { this._limit = n; return this; }
  skip(n) { this._skip = n; return this; }
  lean() { this._lean = true; return this; }
  populate(path, select) { this._populate.push(typeof path === 'object' ? path : { path, select }); return this; }
  distinct(field) { this._distinct = field; return this; }
  session() { return this; }
  exec() { return this.model._exec(this); }
  then(res, rej) { return this.exec().then(res, rej); }
  catch(rej) { return this.exec().catch(rej); }
  finally(fn) { return this.exec().finally(fn); }
}

class Model {
  /**
   * fields: { 'path.to.field': { type: 'text'|'int'|'double'|'bigint'|'decimal'|'bool'|'date'|'json'|'ref', default, ref } }
   */
  constructor(name, table, fields, { timestamps = false, hooks = {} } = {}) {
    this.modelName = name;
    this.table = table;
    this.timestamps = timestamps;
    this.hooks = hooks;
    this.fields = { _id: { type: 'id', col: 'id' } };
    for (const [p, def] of Object.entries(fields)) this.fields[p] = { ...def, col: def.col || snake(p) };
    if (timestamps) {
      this.fields.createdAt = { type: 'date', col: 'created_at' };
      this.fields.updatedAt = { type: 'date', col: 'updated_at' };
    }
    this.paths = Object.keys(this.fields);
    registry[name] = this;
  }

  // ---------- служебное ----------
  field(p) {
    const f = this.fields[p];
    if (!f) throw new Error(`${this.modelName}: unknown field "${p}"`);
    return f;
  }
  isGroup(p) { return !this.fields[p] && this.paths.some(x => x.startsWith(p + '.')); }

  hydrate(row) {
    const o = {};
    for (const p of this.paths) {
      const f = this.fields[p];
      if (f.col in row) setPath(o, p, fromDb(f, row[f.col]));
    }
    return o;
  }

  _snapshot(obj) {
    const s = {};
    for (const p of this.paths) {
      const v = getPath(obj, p);
      if (v === undefined) continue;
      const d = toDb(this.fields[p], v);
      s[p] = d instanceof Date ? d.toISOString() : d === null ? null : String(d);
    }
    return s;
  }

  compileFilter(filter, params) {
    const parts = [];
    for (const [k, v] of Object.entries(filter || {})) {
      if (v === undefined) continue;
      if (k === '$or' || k === '$and') {
        const subs = v.map(s => `(${this.compileFilter(s, params)})`);
        parts.push(subs.length ? `(${subs.join(k === '$or' ? ' OR ' : ' AND ')})` : (k === '$or' ? 'FALSE' : 'TRUE'));
        continue;
      }
      parts.push(this._cond(k, v, params));
    }
    return parts.length ? parts.join(' AND ') : 'TRUE';
  }

  _cond(p, v, params) {
    const f = this.field(p);
    const col = q(f.col);
    const P = (val) => { params.push(val); return `$${params.length}`; };
    if (v instanceof RegExp) return `${col} ${v.flags.includes('i') ? '~*' : '~'} ${P(v.source)}`;
    if (hasOps(v)) {
      const out = [];
      for (const [op, x] of Object.entries(v)) {
        switch (op) {
          case '$eq': out.push(this._cond(p, x, params)); break;
          case '$ne': out.push(x === null ? `${col} IS NOT NULL` : `${col} IS DISTINCT FROM ${P(toDb(f, x))}`); break;
          case '$gt': out.push(`${col} > ${P(toDb(f, x))}`); break;
          case '$gte': out.push(`${col} >= ${P(toDb(f, x))}`); break;
          case '$lt': out.push(`${col} < ${P(toDb(f, x))}`); break;
          case '$lte': out.push(`${col} <= ${P(toDb(f, x))}`); break;
          case '$in': {
            const vals = (x || []).filter(e => e !== null && e !== undefined).map(e => toDb(f, e));
            const withNull = (x || []).some(e => e === null);
            const inSql = vals.length ? `${col} = ANY(${P(vals)})` : 'FALSE';
            out.push(withNull ? `(${inSql} OR ${col} IS NULL)` : inSql);
            break;
          }
          case '$nin': {
            const vals = (x || []).filter(e => e !== null && e !== undefined).map(e => toDb(f, e));
            out.push(vals.length ? `(${col} IS NULL OR NOT (${col} = ANY(${P(vals)})))` : 'TRUE');
            break;
          }
          case '$exists': out.push(x ? `${col} IS NOT NULL` : `${col} IS NULL`); break;
          case '$regex': {
            const src = x instanceof RegExp ? x.source : String(x);
            const ci = String(v.$options || '').includes('i') || (x instanceof RegExp && x.flags.includes('i'));
            out.push(`${col} ${ci ? '~*' : '~'} ${P(src)}`);
            break;
          }
          case '$options': break;
          default: throw new Error(`${this.modelName}: unsupported operator ${op}`);
        }
      }
      return out.length ? out.join(' AND ') : 'TRUE';
    }
    if (v === null) return `${col} IS NULL`;
    return `${col} = ${P(toDb(f, v))}`;
  }

  compileSort(sort) {
    if (!sort) return '';
    const entries = typeof sort === 'string'
      ? sort.split(/\s+/).filter(Boolean).map(s => (s.startsWith('-') ? [s.slice(1), -1] : [s, 1]))
      : Object.entries(sort);
    if (!entries.length) return '';
    return ' ORDER BY ' + entries.map(([p, d]) => `${q(this.field(p).col)} ${Number(d) < 0 || d === 'desc' ? 'DESC' : 'ASC'}`).join(', ');
  }

  /** Обновление → список "col = expr" (выражения ссылаются на таблицу под алиасом t) */
  compileSets(update, params) {
    const u = hasOps(update) ? update : { $set: update };
    const sets = new Map();
    const P = (val) => { params.push(val); return `$${params.length}`; };
    const put = (p, v) => {
      if (v === undefined) return;
      if (this.isGroup(p) && isPlainObject(v)) { for (const [k, x] of Object.entries(v)) put(`${p}.${k}`, x); return; }
      const f = this.fields[p];
      if (!f || p === '_id') return; // неизвестные поля игнорируются (как strict-режим Mongoose)
      sets.set(f.col, `${q(f.col)} = ${P(toDb(f, v))}`);
    };
    for (const [p, v] of Object.entries(u.$set || {})) put(p, v);
    for (const [p, v] of Object.entries(u.$inc || {})) {
      const f = this.field(p);
      sets.set(f.col, `${q(f.col)} = COALESCE(t.${q(f.col)}, 0) + ${P(String(v))}::${CAST[f.type] || 'numeric'}`);
    }
    for (const p of Object.keys(u.$unset || {})) { const f = this.field(p); sets.set(f.col, `${q(f.col)} = NULL`); }
    if (this.timestamps && !sets.has('updated_at')) sets.set('updated_at', `"updated_at" = ${P(new Date())}`);
    return [...sets.values()];
  }

  /** Значения для вставки при upsert: равенства из фильтра + $set + $setOnInsert + $inc */
  _upsertDoc(filter, update) {
    const u = hasOps(update) ? update : { $set: update };
    const doc = {};
    for (const [k, v] of Object.entries(filter || {})) {
      if (k.startsWith('$') || hasOps(v) || v instanceof RegExp) continue;
      setPath(doc, k, v);
    }
    for (const src of [u.$setOnInsert, u.$set]) for (const [k, v] of Object.entries(src || {})) setPath(doc, k, v);
    for (const [k, v] of Object.entries(u.$inc || {})) setPath(doc, k, Number(getPath(doc, k) || 0) + Number(v));
    return doc;
  }

  async _insert(input) {
    const doc = { ...input };
    if (this.hooks.preCreate) await this.hooks.preCreate(doc, this);
    const now = new Date();
    const cols = [], vals = [], ph = [];
    for (const p of this.paths) {
      const f = this.fields[p];
      let v = getPath(doc, p);
      if (p === '_id') v = v ? String(v) : newId();
      else if (this.timestamps && (p === 'createdAt' || p === 'updatedAt')) v = v || now;
      else if (v === undefined) v = typeof f.default === 'function' ? f.default() : f.default;
      if (v === undefined) continue;
      cols.push(q(f.col)); vals.push(toDb(f, v)); ph.push(`$${vals.length}`);
    }
    const { rows } = await db.query(`INSERT INTO ${q(this.table)} (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`, vals);
    return this.hydrate(rows[0]);
  }

  _wrap(obj, lean) { return obj == null ? null : lean ? obj : new Doc(this, obj, false); }

  parseSelect(spec) {
    if (!spec) return null;
    let toks;
    if (typeof spec === 'string') toks = spec.split(/\s+/).filter(Boolean);
    else toks = Object.entries(spec).map(([k, v]) => (v ? k : `-${k}`));
    if (toks.length && toks.every(t => t.startsWith('-'))) return { excl: toks.map(t => t.slice(1)) };
    return { incl: toks.filter(t => !t.startsWith('-')), noId: toks.includes('-_id') };
  }
  applySelect(obj, sel) {
    if (!sel || !obj) return obj;
    if (sel.excl) { for (const p of sel.excl) delPath(obj, p); return obj; }
    const out = {};
    if (!sel.noId) out._id = obj._id;
    for (const p of sel.incl) { const v = getPath(obj, p); if (v !== undefined) setPath(out, p, v); }
    return out;
  }

  async _populate(objs, specs, lean) {
    for (const spec of specs) {
      const f = this.field(spec.path);
      const ref = registry[f.ref];
      if (!ref) throw new Error(`${this.modelName}.${spec.path}: no ref model`);
      const ids = [...new Set(objs.filter(o => o && o[spec.path]).map(o => String(o[spec.path])))];
      const found = ids.length ? await ref.find({ _id: { $in: ids } }).select(spec.select || null).lean() : [];
      const byId = new Map(found.map(r => [String(r._id), r]));
      for (const o of objs) {
        if (!o || o[spec.path] === undefined) continue;
        const r = o[spec.path] == null ? null : byId.get(String(o[spec.path])) || null;
        o[spec.path] = ref._wrap(r, lean);
      }
    }
  }

  async _exec(qr) {
    const { op, args } = qr;
    if (op === 'find' || op === 'findOne') {
      const params = [];
      const where = this.compileFilter(args.filter, params);
      let sql = `SELECT * FROM ${q(this.table)} WHERE ${where}${this.compileSort(qr._sort)}`;
      const limit = op === 'findOne' ? 1 : qr._limit;
      if (limit) sql += ` LIMIT ${Number(limit)}`;
      if (qr._skip) sql += ` OFFSET ${Number(qr._skip)}`;
      const { rows } = await db.query(sql, params);
      if (qr._distinct) {
        const f = this.field(qr._distinct);
        const seen = new Map();
        for (const r of rows) { const v = fromDb(f, r[f.col]); if (v != null) seen.set(String(v), v); }
        return [...seen.values()];
      }
      const sel = this.parseSelect(qr._select);
      const objs = rows.map(r => this.applySelect(this.hydrate(r), sel));
      if (qr._populate.length) await this._populate(objs, qr._populate, qr._lean);
      const out = objs.map(o => this._wrap(o, qr._lean));
      return op === 'findOne' ? out[0] || null : out;
    }
    if (op === 'findOneAndUpdate') {
      const o = args.opts || {};
      const obj = await this._findAndModify(args.filter, args.update, { returnNew: Boolean(o.new || o.returnDocument === 'after'), upsert: Boolean(o.upsert), sort: o.sort || qr._sort });
      const sel = this.parseSelect(qr._select);
      const res = this.applySelect(obj, sel);
      if (res && qr._populate.length) await this._populate([res], qr._populate, qr._lean);
      return this._wrap(res, qr._lean);
    }
    if (op === 'findOneAndDelete') {
      const params = [];
      const where = this.compileFilter(args.filter, params);
      const { rows } = await db.query(
        `WITH target AS (SELECT id FROM ${q(this.table)} WHERE ${where} LIMIT 1 FOR UPDATE)
         DELETE FROM ${q(this.table)} AS t USING target WHERE t.id = target.id RETURNING t.*`, params);
      return this._wrap(rows[0] ? this.hydrate(rows[0]) : null, qr._lean);
    }
    throw new Error(`unknown op ${op}`);
  }

  /** Атомарно найти одну строку по фильтру (с блокировкой) и обновить. Возвращает новую или старую версию. */
  async _findAndModify(filter, update, { returnNew, upsert, sort } = {}) {
    const params = [];
    const where = this.compileFilter(filter, params);
    const order = this.compileSort(sort);
    const sets = this.compileSets(update, params);
    const T = q(this.table);
    let row = null;
    if (sets.length) {
      const { rows } = await db.query(
        `WITH target AS (SELECT ${returnNew ? 'id' : '*'} FROM ${T} WHERE ${where}${order} LIMIT 1 FOR UPDATE)
         UPDATE ${T} AS t SET ${sets.join(', ')} FROM target WHERE t.id = target.id RETURNING ${returnNew ? 't.*' : 'target.*'}`, params);
      row = rows[0] || null;
    } else {
      const { rows } = await db.query(`SELECT * FROM ${T} WHERE ${where}${order} LIMIT 1`, params);
      row = rows[0] || null;
    }
    if (row) return this.hydrate(row);
    if (!upsert) return null;
    const inserted = await this._insertIgnore(this._upsertDoc(filter, update));
    if (inserted) return returnNew ? inserted : null;
    // параллельный upsert успел вставить — обновляем его строку
    return this._findAndModify(filter, update, { returnNew, upsert: false, sort });
  }

  async _insertIgnore(doc) {
    try { return await this._insert(doc); }
    catch (e) { if (e.code === 11000) return null; throw e; }
  }

  // ---------- публичный API ----------
  find(filter = {}, projection) { const qr = new Query(this, 'find', { filter }); if (projection) qr.select(projection); return qr; }
  findOne(filter = {}, projection) { const qr = new Query(this, 'findOne', { filter }); if (projection) qr.select(projection); return qr; }
  findById(id, projection) {
    const qr = new Query(this, 'findOne', { filter: { _id: ID_RE.test(String(id)) ? String(id) : '000000000000000000000000' } });
    if (projection) qr.select(projection);
    return qr;
  }
  findOneAndUpdate(filter, update, opts = {}) { return new Query(this, 'findOneAndUpdate', { filter, update, opts }); }
  findByIdAndUpdate(id, update, opts = {}) { return this.findOneAndUpdate({ _id: String(id) }, update, opts); }
  findOneAndDelete(filter) { return new Query(this, 'findOneAndDelete', { filter }); }
  findByIdAndDelete(id) { return this.findOneAndDelete({ _id: String(id) }); }

  async updateOne(filter, update, opts = {}) {
    const params = [];
    const where = this.compileFilter(filter, params);
    const sets = this.compileSets(update, params);
    const T = q(this.table);
    const { rowCount } = await db.query(
      `WITH target AS (SELECT id FROM ${T} WHERE ${where} LIMIT 1 FOR UPDATE)
       UPDATE ${T} AS t SET ${sets.join(', ')} FROM target WHERE t.id = target.id`, params);
    if (rowCount || !opts.upsert) return { acknowledged: true, matchedCount: rowCount, modifiedCount: rowCount, upsertedCount: 0 };
    const inserted = await this._insertIgnore(this._upsertDoc(filter, update));
    if (inserted) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: inserted._id };
    return this.updateOne(filter, update, { upsert: false });
  }

  async updateMany(filter, update) {
    const params = [];
    const where = this.compileFilter(filter, params);
    const sets = this.compileSets(update, params);
    const { rowCount } = await db.query(`UPDATE ${q(this.table)} AS t SET ${sets.join(', ')} WHERE ${where}`, params);
    return { acknowledged: true, matchedCount: rowCount, modifiedCount: rowCount };
  }

  async deleteMany(filter = {}) {
    const params = [];
    const { rowCount } = await db.query(`DELETE FROM ${q(this.table)} WHERE ${this.compileFilter(filter, params)}`, params);
    return { acknowledged: true, deletedCount: rowCount };
  }
  async deleteOne(filter = {}) {
    const d = await this.findOneAndDelete(filter).lean();
    return { acknowledged: true, deletedCount: d ? 1 : 0 };
  }

  async countDocuments(filter = {}) {
    const params = [];
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${q(this.table)} WHERE ${this.compileFilter(filter, params)}`, params);
    return Number(rows[0].n);
  }
  estimatedDocumentCount() { return this.countDocuments({}); }

  async exists(filter = {}) {
    const params = [];
    const { rows } = await db.query(`SELECT id FROM ${q(this.table)} WHERE ${this.compileFilter(filter, params)} LIMIT 1`, params);
    return rows[0] ? { _id: String(rows[0].id).trim() } : null;
  }

  distinct(field, filter = {}) { return this.find(filter).distinct(field).exec(); }

  async create(input) {
    if (Array.isArray(input)) { const out = []; for (const d of input) out.push(await this.create(d)); return out; }
    return new Doc(this, await this._insert(plain(input)), false);
  }
  insertMany(arr) { return this.create(arr); }

  /** Новый несохранённый документ (как new Model({...})) */
  build(data) { return new Doc(this, plain(data), true); }

  async init() { /* схема создаётся миграциями */ }

  /** Сырой SQL для агрегатов */
  query(text, params) { return db.query(text, params); }
}

const isId = (v) => typeof v === 'string' && ID_RE.test(v);

module.exports = { Model, Doc, Dec, newId, isId, registry };
