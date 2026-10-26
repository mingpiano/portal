/**
 * 数据层：把 Google Sheets 当成几张小表来用。
 *
 * 要点：
 * - 按“列名”对应，不按位置。表头顺序变了、多了备注列，都不影响。
 * - 所有单元格设成纯文本格式并且一律写字符串，否则 Sheets 会把 2018-03-04 自动变成日期、
 *   把 007 变成 7。读的时候再按类型转回来（Sheets 里被改成日期的也能读回来）。
 * - 一次请求里同一张表只读一次（REQ_.tbl 缓存），写的时候同步更新缓存。
 */

function parseCols_(name) {
  return SHEETS_[name].map(function (spec) {
    var p = spec.split(':');
    return { name: p[0], type: p[1] || 's' };
  });
}

function ss_() {
  if (!REQ_.ss) {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) fail_('not_setup');
    REQ_.ss = SpreadsheetApp.openById(id);
  }
  return REQ_.ss;
}

function resetRequest_() { REQ_ = { tbl: {} }; }

function coerce_(v, type) {
  if (type === 'i') { var n = Number(v); return isFinite(n) ? Math.trunc(n) : 0; }
  if (type === 'b') return v === true || String(v).toLowerCase() === 'true';
  if (type === 'j') {
    if (v === '' || v == null) return null;
    try { return JSON.parse(String(v)); } catch (e) { return null; }
  }
  if (type === 'd') {
    if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return v == null ? '' : String(v).trim();
  }
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return v == null ? '' : String(v);
}

function serialize_(v, type) {
  if (type === 'j') return v == null ? '' : JSON.stringify(v);
  if (type === 'b') return v ? 'true' : 'false';
  if (type === 'i') return String(Math.trunc(Number(v) || 0));
  return v == null ? '' : String(v);
}

/** 读整张表。返回对象数组，每个对象带 _row（表里的行号）。 */
function dbAll_(name) {
  if (REQ_.tbl[name]) return REQ_.tbl[name].rows;
  var sh = ss_().getSheetByName(name);
  if (!sh) fail_('schema_mismatch', 'missing sheet ' + name);
  var cols = parseCols_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var values = lastRow >= 1 && lastCol >= 1 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var header = (values[0] || []).map(function (h) { return String(h).trim(); });
  var idx = {};
  header.forEach(function (h, i) { if (!(h in idx)) idx[h] = i; });
  cols.forEach(function (c) { if (!(c.name in idx)) fail_('schema_mismatch', name + '.' + c.name); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var blank = true;
    for (var k = 0; k < line.length; k++) { if (line[k] !== '' && line[k] != null) { blank = false; break; } }
    if (blank) continue;
    var obj = { _row: r + 1 };
    cols.forEach(function (c) { obj[c.name] = coerce_(line[idx[c.name]], c.type); });
    rows.push(obj);
  }
  REQ_.tbl[name] = { rows: rows, idx: idx, ncols: header.length };
  return rows;
}

function dbMeta_(name) { dbAll_(name); return REQ_.tbl[name]; }

/** 追加一行，返回写入后的对象。 */
function dbInsert_(name, obj) {
  var meta = dbMeta_(name);
  var sh = ss_().getSheetByName(name);
  var cols = parseCols_(name);
  var line = [];
  for (var i = 0; i < meta.ncols; i++) line.push('');
  var out = {};
  cols.forEach(function (c) {
    var v = obj[c.name];
    out[c.name] = coerce_(serialize_(v, c.type), c.type);
    line[meta.idx[c.name]] = serialize_(v, c.type);
  });
  var row = sh.getLastRow() + 1;
  var range = sh.getRange(row, 1, 1, meta.ncols);
  range.setNumberFormat('@');
  range.setValues([line]);
  out._row = row;
  meta.rows.push(out);
  return out;
}

/** 修改一行里的几个字段。row 是 dbAll_ 返回的对象。 */
function dbUpdate_(name, row, patch) {
  var meta = dbMeta_(name);
  var sh = ss_().getSheetByName(name);
  var cols = parseCols_(name);
  cols.forEach(function (c) {
    if (!(c.name in patch)) return;
    var cell = sh.getRange(row._row, meta.idx[c.name] + 1);
    cell.setNumberFormat('@');
    cell.setValue(serialize_(patch[c.name], c.type));
    row[c.name] = coerce_(serialize_(patch[c.name], c.type), c.type);
  });
  return row;
}

/** 删除满足条件的行，返回删掉几行。从下往上删，行号才不会错位。 */
function dbDelete_(name, pred) {
  var rows = dbAll_(name).filter(pred);
  if (!rows.length) return 0;
  var sh = ss_().getSheetByName(name);
  rows.map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (r) { sh.deleteRow(r); });
  delete REQ_.tbl[name]; // 行号变了，下次重新读
  return rows.length;
}

/* ---------- 建表、升级 ---------- */

/**
 * 保证每张表都存在、表头齐全、整列是纯文本格式。可以反复运行：
 * 缺的表会建出来，缺的列追加在最后，已有的数据一律不动。
 */
function ensureSchema_(ss) {
  Object.keys(SHEETS_).forEach(function (name) {
    var cols = parseCols_(name);
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var lastCol = sh.getLastColumn();
    var header = lastCol >= 1 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    var added = false;
    cols.forEach(function (c) {
      if (header.indexOf(c.name) < 0) { header.push(c.name); added = true; }
    });
    if (added || lastCol === 0) {
      var hr = sh.getRange(1, 1, 1, header.length);
      hr.setNumberFormat('@');
      hr.setValues([header]);
    }
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), header.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });
}

/* ---------- 设置项 ---------- */

function getConfigMap_() {
  var map = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) { map[k] = DEFAULT_CONFIG[k]; });
  dbAll_('Config').forEach(function (r) { if (r.key) map[r.key] = r.value; });
  return map;
}

function getRules_() {
  var cfg = getConfigMap_(), rules = {};
  Object.keys(DEFAULT_RULES).forEach(function (k) {
    var v = cfg['rule.' + k];
    rules[k] = (v === undefined || v === '') ? DEFAULT_RULES[k] : Number(v);
  });
  return rules;
}

function setConfig_(key, value) {
  var row = dbAll_('Config').filter(function (r) { return r.key === key; })[0];
  if (row) dbUpdate_('Config', row, { value: String(value) });
  else dbInsert_('Config', { key: key, value: String(value) });
}

function isTestEnv_() { return PropertiesService.getScriptProperties().getProperty('ENV') === 'test'; }
