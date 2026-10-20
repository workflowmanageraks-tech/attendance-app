'use strict';
// Minimal Google Apps Script runtime on top of an in-memory copy of the spreadsheet.
// Reads are synchronous (from memory); every change is logged as a Sheets-API request and flushed after each call.
const crypto = require('crypto');

const colNum = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const isEmpty = v => v === '' || v === null || v === undefined;

function cellData(v) {
  if (isEmpty(v)) return {};
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v } };
  if (v && typeof v.getTime === 'function') return { userEnteredValue: { stringValue: new Date(v.getTime()).toISOString() } };
  return { userEnteredValue: { stringValue: String(v) } };
}

class Range {
  constructor(sh, r, c, nr, nc, wholeCols) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; this.whole = !!wholeCols; }
  grid() {
    const g = { sheetId: this.sh.id, startColumnIndex: this.c - 1, endColumnIndex: this.c - 1 + this.nc };
    if (!this.whole) { g.startRowIndex = this.r - 1; g.endRowIndex = this.r - 1 + this.nr; }
    return g;
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.v[this.r - 1 + i] || [], line = [];
      for (let j = 0; j < this.nc; j++) { const x = row[this.c - 1 + j]; line.push(x === undefined || x === null ? '' : x); }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  _put(vals, mk) {
    this.sh._grow(this.r + this.nr - 1, this.c + this.nc - 1);
    const rows = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.v[this.r - 1 + i] || (this.sh.v[this.r - 1 + i] = []);
      const cells = [];
      for (let j = 0; j < this.nc; j++) { const x = vals[i][j]; row[this.c - 1 + j] = isEmpty(x) ? '' : x; cells.push(mk(x)); }
      rows.push({ values: cells });
    }
    this.sh.wb.ops.push({ updateCells: { range: this.grid(), rows, fields: 'userEnteredValue' } });
    return this;
  }
  setValues(vals) {
    if (vals.length !== this.nr || (vals[0] || []).length !== this.nc) throw new Error('The number of rows/columns of the data does not match the range.');
    return this._put(vals, cellData);
  }
  setValue(v) { return this._put(Array.from({ length: this.nr }, () => Array(this.nc).fill(v)), cellData); }
  setFormula(f) { return this._put(Array.from({ length: this.nr }, () => Array(this.nc).fill(f)), x => ({ userEnteredValue: { formulaValue: x } })); }
  clearContent() { return this._put(Array.from({ length: this.nr }, () => Array(this.nc).fill('')), cellData); }
  setNumberFormat(fmt) {
    if (fmt === '@') this.sh.wb.ops.push({ repeatCell: { range: this.grid(), cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } });
    return this;
  }
  setFontWeight(w) {
    this.sh.wb.ops.push({ repeatCell: { range: this.grid(), cell: { userEnteredFormat: { textFormat: { bold: w === 'bold' } } }, fields: 'userEnteredFormat.textFormat.bold' } });
    return this;
  }
}

class Sheet {
  constructor(wb, m) { this.wb = wb; this.id = m.id; this.name = m.title; this.v = m.values || []; this.rows = m.rows || 1000; this.cols = m.cols || 26; }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getMaxRows() { return this.rows; }
  getMaxColumns() { return this.cols; }
  getLastRow() { for (let i = this.v.length - 1; i >= 0; i--) if ((this.v[i] || []).some(x => !isEmpty(x))) return i + 1; return 0; }
  getLastColumn() { let m = 0; this.v.forEach(r => { for (let j = (r || []).length - 1; j >= 0; j--) if (!isEmpty(r[j])) { m = Math.max(m, j + 1); break; } }); return m; }
  _grow(rows, cols) {
    if (rows > this.rows) { this.wb.ops.push({ appendDimension: { sheetId: this.id, dimension: 'ROWS', length: rows - this.rows } }); this.rows = rows; }
    if (cols > this.cols) { this.wb.ops.push({ appendDimension: { sheetId: this.id, dimension: 'COLUMNS', length: cols - this.cols } }); this.cols = cols; }
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      let m = /^([A-Z]+):([A-Z]+)$/.exec(a);
      if (m) { const c1 = colNum(m[1]), c2 = colNum(m[2]); return new Range(this, 1, c1, this.rows, c2 - c1 + 1, true); }
      m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
      if (!m) throw new Error('Unsupported range: ' + a);
      const c1 = colNum(m[1]), r1 = +m[2], c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    if (a < 1 || b < 1) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    return new Range(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(arr) { return this.getRange(this.getLastRow() + 1, 1, 1, arr.length).setValues([arr]); }
  deleteRows(r, n) {
    this.v.splice(r - 1, n); this.rows = Math.max(1, this.rows - n);
    this.wb.ops.push({ deleteDimension: { range: { sheetId: this.id, dimension: 'ROWS', startIndex: r - 1, endIndex: r - 1 + n } } });
  }
  deleteRow(r) { this.deleteRows(r, 1); }
  _insertAt(idx) {
    this._grow(idx, 0); this.v.splice(idx, 0, []); this.rows++;
    this.wb.ops.push({ insertDimension: { range: { sheetId: this.id, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 }, inheritFromBefore: false } });
  }
  insertRowBefore(r) { this._insertAt(r - 1); }
  insertRowAfter(r) { this._insertAt(r); }
  insertColumnsAfter(col, n) {
    this.wb.ops.push({ insertDimension: { range: { sheetId: this.id, dimension: 'COLUMNS', startIndex: col, endIndex: col + n }, inheritFromBefore: true } });
    this.cols += n;
  }
  setFrozenRows(n) {
    this.wb.ops.push({ updateSheetProperties: { properties: { sheetId: this.id, gridProperties: { frozenRowCount: n } }, fields: 'gridProperties.frozenRowCount' } });
  }
}

class Workbook {
  constructor(store) { this.store = store; this.sheets = []; this.ops = []; this.loadedAt = 0; }
  async load() {
    this.sheets = (await this.store.load()).map(m => new Sheet(this, m));
    this.ops = []; this.loadedAt = Date.now();
  }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error('A sheet with the name "' + name + '" already exists.');
    const id = 100000 + Math.floor(Math.random() * 1e9);
    this.ops.push({ addSheet: { properties: { sheetId: id, title: name } } });
    const sh = new Sheet(this, { id, title: name, values: [], rows: 1000, cols: 26 });
    this.sheets.push(sh); return sh;
  }
  deleteSheet(sh) {
    this.ops.push({ deleteSheet: { sheetId: sh.id } });
    this.sheets = this.sheets.filter(s => s !== sh);
  }
  async flush() {
    if (!this.ops.length) return;
    const ops = this.ops; this.ops = [];
    try { for (let i = 0; i < ops.length; i += 400) await this.store.flush(ops.slice(i, i + 400)); }
    catch (e) { this.loadedAt = 0; throw e; }     // memory may now differ from the sheet: reload next time
  }
}

function fmtDate(d, tz, fmt) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(d.getTime())).forEach(x => { p[x.type] = x.value; });
  return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
}
const toBuf = x => Buffer.isBuffer(x) ? x : Buffer.from(Array.from(x).map(b => b & 255));

function install(wb, env, rt) {
  // rt = { delay: ms to wait before replying, mails: [] queued e-mails }
  const tz = env.TZ || 'Asia/Kolkata';
  const cache = new Map();
  const PROPS = '_App Properties';
  const propsSheet = () => {
    let s = wb.getSheetByName(PROPS);
    if (!s) { s = wb.insertSheet(PROPS); s.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]); }
    return s;
  };
  const props = {
    getProperty(k) {
      const s = propsSheet(), last = s.getLastRow();
      if (last < 2) return null;
      const r = s.getRange(2, 1, last - 1, 2).getValues().find(x => String(x[0]) === k);
      return r ? String(r[1]) : null;
    },
    getProperties() {
      const s = propsSheet(), last = s.getLastRow(), out = {};
      if (last < 2) return out;
      s.getRange(2, 1, last - 1, 2).getValues().forEach(r => { if (String(r[0]) !== '') out[String(r[0])] = String(r[1]); });
      return out;
    },
    deleteProperty(k) { this.setProperty(k, ''); },
    setProperty(k, v) {
      const s = propsSheet(), last = s.getLastRow();
      const vals = last < 2 ? [] : s.getRange(2, 1, last - 1, 2).getValues();
      const i = vals.findIndex(x => String(x[0]) === k);
      if (i >= 0) s.getRange(i + 2, 2).setValue(String(v)); else s.appendRow([k, String(v)]);
    }
  };
  globalThis.CAL_RT_ = rt;                       // Google Calendar jobs queued by Code.gs, run by server.js
  Object.assign(globalThis, {
    SpreadsheetApp: { getActiveSpreadsheet: () => wb, getUi: () => ({ alert() {}, ButtonSet: {}, Button: {} }) },
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => ({
      get(k) { const e = cache.get(k); if (!e) return null; if (e.t < Date.now()) { cache.delete(k); return null; } return e.v; },
      put(k, v, ttl) { cache.set(k, { v: String(v), t: Date.now() + (ttl || 600) * 1000 }); },
      getAll(keys) { const out = {}; (keys || []).forEach(k => { const e = cache.get(k); if (e && e.t >= Date.now()) out[k] = e.v; }); return out; },
      remove(k) { cache.delete(k); }
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },   // requests already run one at a time
    Session: { getScriptTimeZone: () => tz, getEffectiveUser: () => ({ getEmail: () => env.OWNER_EMAIL || '' }) },
    MailApp: { sendEmail(m) { rt.mails.push(m); }, getRemainingDailyQuota: () => 100 },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: ms => { rt.delay += ms; },
      formatDate: (d, z, f) => fmtDate(d, z || tz, f),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (algo, s) => Array.from(crypto.createHash(algo).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      base64Encode: x => (typeof x === 'string' ? Buffer.from(x, 'utf8') : toBuf(x)).toString('base64'),
      base64EncodeWebSafe: x => (typeof x === 'string' ? Buffer.from(x, 'utf8') : toBuf(x)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    },
    Logger: { log: (...a) => console.log(...a) }
  });
  return { cache, props };
}

module.exports = { Workbook, install };
