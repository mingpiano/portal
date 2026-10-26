'use strict';
/**
 * Apps Script 的本地模拟层。
 *
 * 目的：让 apps-script/ 里的真实代码（一行不改）能在 Node 里跑，用来写测试和做本地预览。
 * 它模拟的是这份代码用到的那一小部分服务：Sheets、邮件、锁、属性、UUID、哈希。
 *
 * 为了让测试有意义，模拟层刻意复制了 Sheets 里最容易踩的坑：
 * - 没设成“纯文本”格式的格子里，写 '2018-03-04' 会被自动变成日期，'007' 变成数字 7，
 *   'TRUE' 变成布尔值，以 '=' 开头的会被当成公式。
 * - 设成纯文本格式（'@'）的格子才按字符串原样保存。
 * 如果后台代码忘了设纯文本格式，测试会立刻抓到。
 *
 * 另外，模拟层记录：发出的邮件、锁的使用、有没有在没拿锁的情况下写表。
 */

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC_DIR = path.join(__dirname, '..', '..', 'apps-script');
// 与 Apps Script 里文件的先后无关（全是函数声明），这里只是固定一个顺序
const FILES = ['Config.js', 'Util.js', 'Db.js', 'Rules.js', 'Mail.js', 'Auth.js', 'State.js', 'Handlers.js', 'Api.js', 'Setup.js'];

function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

/** Sheets 对“非纯文本”格子的自动识别。 */
function autoType(v) {
  if (typeof v !== 'string') return v;
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (v.startsWith('=')) return '#FORMULA!';
  return v;
}

class MockRange {
  constructor(sheet, row, col, nrows, ncols) { Object.assign(this, { sheet, row, col, nrows, ncols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nrows; r++) {
      const line = [];
      for (let c = 0; c < this.ncols; c++) line.push(this.sheet._get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.sheet._get(this.row, this.col); }
  setValues(vals) {
    if (vals.length !== this.nrows || vals.some(l => l.length !== this.ncols)) throw new Error('mock: range size mismatch');
    this.sheet._write();
    for (let r = 0; r < this.nrows; r++) for (let c = 0; c < this.ncols; c++) this.sheet._set(this.row + r, this.col + c, vals[r][c]);
    return this;
  }
  setValue(v) {
    this.sheet._write();
    for (let r = 0; r < this.nrows; r++) for (let c = 0; c < this.ncols; c++) this.sheet._set(this.row + r, this.col + c, v);
    return this;
  }
  setNumberFormat(fmt) {
    for (let r = 0; r < this.nrows; r++) for (let c = 0; c < this.ncols; c++) this.sheet._setFmt(this.row + r, this.col + c, fmt);
    return this;
  }
}

class MockSheet {
  constructor(rt, name) { this.rt = rt; this.name = name; this.data = []; this.fmt = []; this.maxRows = 1000; this.frozen = 0; }
  getName() { return this.name; }
  _get(r, c) { const row = this.data[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  _set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    while (this.fmt.length < r) this.fmt.push([]);
    const text = this.fmt[r - 1][c - 1] === '@';
    let val = v === undefined || v === null ? '' : v;
    val = text ? (isDate(val) ? val.toISOString() : String(val)) : autoType(val);
    this.data[r - 1][c - 1] = val;
    if (r > this.maxRows) this.maxRows = r;
  }
  _setFmt(r, c, f) { while (this.fmt.length < r) this.fmt.push([]); this.fmt[r - 1][c - 1] = f; if (r > this.maxRows) this.maxRows = r; }
  _write() { this.rt._noteWrite(this.name); }
  getLastRow() {
    for (let i = this.data.length; i >= 1; i--) if ((this.data[i - 1] || []).some(v => v !== '' && v !== undefined)) return i;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(row => { for (let c = row.length; c >= 1; c--) if (row[c - 1] !== '' && row[c - 1] !== undefined) { m = Math.max(m, c); break; } });
    return m;
  }
  getMaxRows() { return this.maxRows; }
  getRange(r, c, nr = 1, nc = 1) { return new MockRange(this, r, c, nr, nc); }
  deleteRow(r) { this._write(); this.data.splice(r - 1, 1); this.fmt.splice(r - 1, 1); }
  deleteRows(r, n) { this._write(); this.data.splice(r - 1, n); this.fmt.splice(r - 1, n); }
  setFrozenRows(n) { this.frozen = n; }
}

class MockSpreadsheet {
  constructor(rt, id, name) { this.rt = rt; this.id = id; this.name = name; this.sheets = [new MockSheet(rt, 'Sheet1')]; }
  getId() { return this.id; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(this.rt, n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function createRuntime(opts = {}) {
  const rt = {
    owner: opts.owner || 'teacher.test@gmail.com',
    tz: 'America/Denver',
    mail: [], mailQuota: 100, mailFail: false,
    props: new Map(), spreadsheets: new Map(),
    locked: false, lockAcquired: 0, inRequest: false, lockViolations: [],
    slept: 0, clockOffset: 0, fixedNow: null,
    writes: 0
  };
  rt._noteWrite = function (sheetName) {
    rt.writes++;
    if (rt.inRequest && !rt.locked && rt.requireLock) rt.lockViolations.push(sheetName);
  };

  const sandbox = {
    console: opts.quiet ? { log() {}, error() {}, warn() {} } : console,
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest(), b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      sleep: ms => { rt.slept += ms; },
      formatDate: (d, tz, fmt) => {
        if (fmt === 'yyyy-MM-dd') return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        // 和真正的 Apps Script 一样：h:mm a → “3:00 PM”（新版 ICU 会在 PM 前放窄空格，统一成普通空格）
        if (fmt === 'h:mm a') return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/\u202f/g, ' ');
        throw new Error('mock: unsupported format ' + fmt);
      }
    },
    Session: {
      getScriptTimeZone: () => rt.tz,
      getEffectiveUser: () => ({ getEmail: () => rt.owner })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (rt.props.has(k) ? rt.props.get(k) : null),
        setProperty: (k, v) => { rt.props.set(k, String(v)); },
        setProperties: o => { Object.keys(o).forEach(k => rt.props.set(k, String(o[k]))); },
        deleteProperty: k => { rt.props.delete(k); }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (rt.locked) return false; rt.locked = true; rt.lockAcquired++; return true; },
        waitLock: () => { if (rt.locked) throw new Error('lock timeout'); rt.locked = true; rt.lockAcquired++; },
        releaseLock: () => { rt.locked = false; }
      })
    },
    MailApp: {
      getRemainingDailyQuota: () => rt.mailQuota - rt.mail.length,
      sendEmail: m => {
        if (rt.mailFail) throw new Error('mock: mail failure');
        rt.mail.push({ to: m.to, subject: m.subject, body: m.body || '', htmlBody: m.htmlBody || '', name: m.name || '' });
      }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } })
    },
    SpreadsheetApp: {
      create: name => {
        const id = 'mock-' + crypto.randomBytes(6).toString('hex');
        const ss = new MockSpreadsheet(rt, id, name);
        rt.spreadsheets.set(id, ss);
        return ss;
      },
      openById: id => { const ss = rt.spreadsheets.get(id); if (!ss) throw new Error('mock: no such spreadsheet'); return ss; }
    },
    __clock: () => (rt.fixedNow != null ? rt.fixedNow : Date.now()) + rt.clockOffset
  };

  const ctx = vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('now_ = function () { return __clock(); };', ctx); // 让测试可以控制时间
  rt.ctx = ctx;

  rt.run = name => ctx[name]();
  rt.now = () => ctx.now_();
  rt.advance = ms => { rt.clockOffset += ms; };
  /** 发一个请求（和网页发的一样），返回解析后的响应。 */
  rt.call = (a, p, t) => {
    rt.inRequest = true;
    try {
      const out = ctx.doPost({ postData: { contents: JSON.stringify({ a, t, p }) } });
      return JSON.parse(out.getContent());
    } finally { rt.inRequest = false; }
  };
  rt.raw = body => {
    rt.inRequest = true;
    try { return JSON.parse(ctx.doPost({ postData: { contents: body } }).getContent()); } finally { rt.inRequest = false; }
  };
  /** 取最近发给某个邮箱的验证码（测试里代替“去收件箱看”）。 */
  rt.lastCode = email => {
    const m = rt.mail.filter(x => x.to === email).pop();
    const hit = m && /\b(\d{6})\b/.exec(m.body);
    return hit ? hit[1] : null;
  };
  /** 用邮箱+验证码登录，返回令牌（单一身份时）。 */
  rt.login = (email, opts2 = {}) => {
    const r1 = rt.call('auth.request', { email, lang: opts2.lang || 'zh' });
    if (!r1.ok) throw new Error('request failed: ' + r1.error);
    const code = rt.lastCode(email);
    const r2 = rt.call('auth.verify', { email, code, remember: !!opts2.remember });
    if (!r2.ok) throw new Error('verify failed: ' + r2.error);
    if (r2.data.ticket) {
      const pick = r2.data.accounts.find(a => !opts2.role || a.role === opts2.role);
      const r3 = rt.call('auth.choose', { ticket: r2.data.ticket, role: pick.role, id: pick.id });
      if (!r3.ok) throw new Error('choose failed: ' + r3.error);
      return r3.data.token;
    }
    return r2.data.token;
  };
  rt.sheet = name => rt.spreadsheets.get(rt.props.get('SHEET_ID')).getSheetByName(name);
  return rt;
}

module.exports = { createRuntime, SRC_DIR, FILES };
