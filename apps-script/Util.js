/** 工具函数：时间、随机数、哈希、输入清洗、错误类型。 */

/** 请求内的临时缓存（每次请求开始时重置）。 */
var REQ_ = { tbl: {} };

/** 当前时间（毫秒）。测试时可以整个替换这个函数来“穿越”。 */
function now_() { return new Date().getTime(); }
function iso_(ms) { return new Date(ms).toISOString(); }
function ms_(isoStr) { var t = Date.parse(isoStr); return isNaN(t) ? 0 : t; }

function ApiError_(code, detail) {
  var e = new Error(code + (detail ? ': ' + detail : ''));
  e.apiCode = code;
  return e;
}
function fail_(code, detail) { throw ApiError_(code, detail); }

/* ---------- 随机数与哈希 ---------- */

/** 用 UUID 的随机部分拼出十六进制随机串（Utilities.getUuid 来自系统的安全随机数）。 */
function randomHex_(bytes) {
  var s = '';
  while (s.length < bytes * 2) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, bytes * 2);
}
/** 6 位验证码。取 UUID 前 12 位十六进制（这部分全是随机位），模 100 万，偏差可以忽略。 */
function randomCode_() {
  var n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000;
  return ('000000' + n).slice(-6);
}
/** 8 位孩子登录码：取 UUID 的 16 位十六进制（全是随机位），模 1 亿。 */
function randomKidCode_() {
  var n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 13), 16) % 100000000;
  return ('00000000' + n).slice(-8);
}
/** 名字比较：去掉首尾空格、多个空格并成一个、不分大小写。 */
function normName_(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase(); }
function newId_(prefix) { return prefix + randomHex_(5); }

function sha256_(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = b < 0 ? b + 256 : b; return ('0' + v.toString(16)).slice(-2); }).join('');
}
function pepper_() {
  var props = PropertiesService.getScriptProperties();
  var p = props.getProperty('PEPPER');
  if (!p) { p = randomHex_(32); props.setProperty('PEPPER', p); }
  return p;
}
function hashCode_(email, code) { return sha256_(pepper_() + '|code|' + email + '|' + code); }
function hashKidCode_(sid, code) { return sha256_(pepper_() + '|kid|' + sid + '|' + code); }
function hashToken_(token) { return sha256_(pepper_() + '|token|' + token); }

/* ---------- 输入清洗 ---------- */

function normEmail_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s;
}
function isEmail_(s) { return s.length <= LIMITS.email && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(s); }

/** 去掉首尾空白并限制长度；必填项为空时报错。 */
function str_(v, max, opts) {
  opts = opts || {};
  var s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  if (opts.required && !s) fail_('bad_request', (opts.label || 'field') + ' required');
  if (s.length > max) fail_('too_long', opts.label || '');
  return s;
}
function int_(v, lo, hi, label) {
  var n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < lo || n > hi) fail_('bad_request', label || 'number');
  return n;
}
function oneOf_(v, list, label) {
  if (list.indexOf(v) < 0) fail_('bad_request', label || 'value');
  return v;
}
/** 只有日期的字段：'' 或 YYYY-MM-DD，并且是真实存在的日期。 */
function dateOnly_(v, label) {
  var s = String(v == null ? '' : v).trim();
  if (!s) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) fail_('bad_request', label || 'date');
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) fail_('bad_request', label || 'date');
  if (+m[1] < 1900 || +m[1] > 2100) fail_('bad_request', label || 'date');
  return s;
}
function bool_(v) { return v === true || v === 'true'; }

function escHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** Gmail 把 a.b+x@gmail.com 和 ab@gmail.com 当成同一个邮箱。测试环境的邮件白名单用它判断。 */
function baseEmail_(email) {
  var e = normEmail_(email), at = e.lastIndexOf('@');
  if (at < 0) return e;
  var local = e.slice(0, at), dom = e.slice(at + 1);
  local = local.split('+')[0];
  if (dom === 'gmail.com' || dom === 'googlemail.com') { local = local.replace(/\./g, ''); dom = 'gmail.com'; }
  return local + '@' + dom;
}

/* ---------- 时区 ---------- */

function isTz_(v) { return TZ_LIST.indexOf(v) >= 0; }
/** 老师所在时区（设置里没有或不合法就用默认值）。 */
function teacherTz_() {
  var v = getConfigMap_().teacher_tz;
  return isTz_(v) ? v : DEFAULT_TZ;
}
/** 学生所在时区；没填就当作和老师同一个时区。 */
function studentTz_(s) { return s && isTz_(s.tz) ? s.tz : teacherTz_(); }
/** 把某个时刻按指定时区写成“2026-10-28 3:00 PM”（12 小时制）。 */
function fmtTz_(ms, tz) {
  var d = new Date(ms);
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd') + ' ' + Utilities.formatDate(d, tz, 'h:mm a');
}
