/** 所有用户数据进入网页前都要过 esc()。 */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 头像可选项。必须和 apps-script/Config.js 里的白名单一致（有测试守着）。 */
export const AVATAR_EMOJI = ['🐼', '🦊', '🐱', '🐶', '🦄', '🐰', '🐯', '🦁', '🐸', '🐙', '🐧', '🦋', '🎹', '🎼', '🌿', '☕', '🌙', '🍃', '🕊️', '🌸', '🎷', '📚', '🌻'];
export const AVATAR_COLORS = ['#F6D7B0', '#CFE6D8', '#D6DDF5', '#F3D0DA', '#E9E2B5', '#D5EAF2'];

const initials = n => { n = String(n || '?').trim() || '?'; return /[A-Za-z]/.test(n[0]) ? n.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() : n.slice(-2); };

/** 照片头像：只认后台同样规则的小图（data URL，JPEG / PNG / WebP，不超过 16000 字符）。 */
export const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const IMG_MAX = 16000;

export function avatar(p, size = 34) {
  const a = p && p.avatar, base = `width:${size}px;height:${size}px;font-size:${Math.round(size * .52)}px`;
  if (a && a.t === 'img' && typeof a.v === 'string' && a.v.length <= IMG_MAX && IMG_RE.test(a.v)) return `<div class="av" style="width:${size}px;height:${size}px"><img src="${esc(a.v)}" alt=""></div>`;
  if (a && a.t === 'emoji' && AVATAR_EMOJI.includes(a.v) && AVATAR_COLORS.includes(a.c)) return `<div class="av" style="${base};background:${a.c};color:#1C2333">${a.v}</div>`;
  const ini = initials(p && p.name);
  const cjk = ini.length > 1 && !/[A-Za-z]/.test(ini);
  return `<div class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * (cjk ? .36 : .4))}px">${esc(ini)}</div>`;
}

/** 十个琴键的“本期进度”。 */
export function keyboard(used, label) {
  const W = 24, H = 80, n = 10;
  let s = `<svg class="kb" viewBox="0 0 ${W * n + 2} ${H + 2}" role="img" aria-label="${esc(label)}">`;
  for (let i = 0; i < n; i++) s += `<rect x="${1 + i * W}" y="1" width="${W}" height="${H}" rx="3" class="wk${i < used ? ' on' : ''}"/>`;
  [0, 1, 3, 4, 5, 7, 8].forEach(i => { s += `<rect x="${1 + (i + 1) * W - 7}" y="1" width="14" height="${H * .58}" rx="2" class="bk"/>`; });
  for (let i = 0; i < n; i++) s += `<text x="${1 + i * W + W / 2}" y="${H - 8}" class="kn num${i < used ? ' on' : ''}">${i + 1}</text>`;
  return s + '</svg>';
}

/* ---------- 日期 ---------- */
const pad = n => String(n).padStart(2, '0');
export function parseYMD(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
export function fmtYMD(s, lang) { const d = parseYMD(s); if (!d) return '—'; return lang === 'zh' ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日` : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
export function fmtD(v, lang) {
  const d = new Date(v); if (isNaN(d)) return '—';
  const y = d.getFullYear() !== new Date().getFullYear();
  return lang === 'zh' ? `${y ? d.getFullYear() + ' 年 ' : ''}${d.getMonth() + 1} 月 ${d.getDate()} 日`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y ? { year: 'numeric' } : {}) });
}
export function fmtT(v) { const d = new Date(v); return isNaN(d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export const fmtDT = (v, lang) => `${fmtD(v, lang)} ${fmtT(v)}`;
/** <input type="datetime-local"> 的默认值：当前整点，本地时间。 */
export function localInputNow() { const d = new Date(); d.setMinutes(0, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`; }

/** 学琴多久：{y, m}（按整月算）。 */
export function spanSince(startYMD, now = new Date()) {
  const s = parseYMD(startYMD); if (!s) return null;
  let m = (now.getFullYear() - s.getFullYear()) * 12 + now.getMonth() - s.getMonth();
  if (now.getDate() < s.getDate()) m--;
  m = Math.max(0, m);
  return { y: Math.floor(m / 12), m: m % 12 };
}
export function ageOf(birthYMD, now = new Date()) {
  const b = parseYMD(birthYMD); if (!b) return null;
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a;
}
export const signed = n => (n > 0 ? '+' : '') + n;


/* ---------- 时区 ---------- */
/** 可选时区 [ID, 中文名, English]。必须和 apps-script/Config.js 的 TZ_LIST 一致（有测试守着）。 */
export const TZ_LIST = [
  ['America/New_York', '美国东部（纽约）', 'US Eastern (New York)'], ['America/Chicago', '美国中部（芝加哥）', 'US Central (Chicago)'],
  ['America/Denver', '美国山区（丹佛）', 'US Mountain (Denver)'], ['America/Phoenix', '美国亚利桑那（凤凰城）', 'Arizona (Phoenix)'],
  ['America/Los_Angeles', '美国西部（洛杉矶）', 'US Pacific (Los Angeles)'], ['America/Anchorage', '阿拉斯加', 'Alaska'],
  ['Pacific/Honolulu', '夏威夷', 'Hawaii'], ['America/Toronto', '加拿大东部（多伦多）', 'Canada Eastern (Toronto)'],
  ['America/Vancouver', '加拿大西部（温哥华）', 'Canada Pacific (Vancouver)'], ['America/Mexico_City', '墨西哥城', 'Mexico City'],
  ['Europe/London', '英国（伦敦）', 'UK (London)'], ['Europe/Paris', '中欧（巴黎）', 'Central Europe (Paris)'],
  ['Europe/Berlin', '中欧（柏林）', 'Central Europe (Berlin)'], ['Asia/Shanghai', '中国（北京时间）', 'China (Beijing)'],
  ['Asia/Hong_Kong', '香港', 'Hong Kong'], ['Asia/Taipei', '台北', 'Taipei'], ['Asia/Tokyo', '日本（东京）', 'Japan (Tokyo)'],
  ['Asia/Seoul', '韩国（首尔）', 'Korea (Seoul)'], ['Asia/Singapore', '新加坡', 'Singapore'],
  ['Australia/Sydney', '澳大利亚（悉尼）', 'Australia (Sydney)'], ['Pacific/Auckland', '新西兰（奥克兰）', 'New Zealand (Auckland)']
];
export const tzName = (id, lang) => { const r = TZ_LIST.find(x => x[0] === id); return r ? (lang === 'zh' ? r[1] : r[2]) : id; };

const dtf = {};
function zparts(ms, tz) {
  const f = dtf[tz] || (dtf[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const o = {}; for (const p of f.formatToParts(ms)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
/** 某个时刻，该时区比 UTC 快多少毫秒（含夏令时）。 */
export function tzOffsetMs(ms, tz) { const p = zparts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; }
/** 把“某时区的墙上时间”换成 UTC 毫秒。夏令时不存在的时间（春天跳过的那一小时）返回 null。 */
export function wallToMs(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ms = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(ms, tz);
  ms = guess - off2;
  const p = zparts(ms, tz);
  return p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi ? ms : null;
}
export const to24 = (h12, ap) => (Number(h12) % 12) + (ap === 'PM' ? 12 : 0);
export const from24 = h => ({ h12: h % 12 === 0 ? 12 : h % 12, ap: h >= 12 ? 'PM' : 'AM' });
/** 某时刻在某时区的墙上时间，拆成表单要的 { date:'YYYY-MM-DD', h12, mi, ap }。 */
export function wallFields(ms, tz) {
  const p = zparts(ms, tz), f = from24(p.h);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, h12: f.h12, mi: p.mi, ap: f.ap };
}
/** 表单里的日期 + 12 小时制时间 → UTC 毫秒（按给定时区理解）；日期缺失或时间不存在返回 null。 */
export function fieldsToMs(date, h12, mi, ap, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ''); if (!m) return null;
  return wallToMs(+m[1], +m[2], +m[3], to24(h12, ap), Number(mi), tz);
}
/** 默认的“上课时间”：现在这一刻在该时区的整点。 */
export function nowFields(tz, now = Date.now()) { const f = wallFields(now, tz); f.mi = 0; return f; }

/** 12 小时制的钟点：中文“下午3:00”，英文“3:00 PM”。 */
export function fmtClock(v, tz, lang) {
  const d = new Date(v); if (isNaN(d)) return '';
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/\u202f/g, ' ');
}
/** 某时区的日期（不是浏览器所在地的日期）；不是今年才带年份。 */
export function fmtDateZ(v, tz, lang, { weekday = false, now = Date.now() } = {}) {
  const d = new Date(v); if (isNaN(d)) return '—';
  const p = zparts(d.getTime(), tz), yr = p.y !== zparts(now, tz).y;
  if (lang === 'zh') {
    const wd = weekday ? ' ' + new Intl.DateTimeFormat('zh-CN', { timeZone: tz, weekday: 'short' }).format(d) : '';
    return `${yr ? p.y + ' 年 ' : ''}${p.m} 月 ${p.d} 日${wd}`;
  }
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', ...(weekday ? { weekday: 'short' } : {}), ...(yr ? { year: 'numeric' } : {}) }).format(d);
}
export const fmtWhenZ = (v, tz, lang, o) => `${fmtDateZ(v, tz, lang, o)} ${fmtClock(v, tz, lang)}`;
/** 时区缩写，比如 EDT、MST；没有缩写的地方是 GMT+8。 */
export function tzAbbr(v, tz) {
  const d = new Date(v); if (isNaN(d)) return '';
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d).find(x => x.type === 'timeZoneName');
  return part ? part.value : '';
}
/** 按该时区的日历算，v 是几天后：0 今天，1 明天……（过去为负）。 */
export function daysUntil(v, tz, now = Date.now()) {
  const a = zparts(new Date(v).getTime(), tz), b = zparts(now, tz);
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

/* ---------- 速度：音符 = 每分钟拍数 ---------- */
/** 速度可选的音符（和后台 TEMPO_NOTES 一致）。 */
export const TEMPO_NOTES = ['w', 'h', 'h.', 'q', 'q.', 'e', 'e.', 's'];
const NOTE_SYM = { q: '♩', 'q.': '♩.', e: '♪', 'e.': '♪.', s: '♬' };
/** 音符的符号（常见字体里没有的二分、全音符用文字代替）。 */
export const noteSym = (n, name) => NOTE_SYM[n] || name;
/** 把 {n, b} 写成 “♩ = 80”；没有速度返回空字符串。name(n) 给出音符的文字名称。 */
export function tempoText(tp, name) { return tp && tp.b ? `${noteSym(tp.n, name(tp.n))} = ${tp.b}` : ''; }

/** 文件大小：1.2 MB / 340 KB。 */
export function fmtSize(n) {
  n = Number(n) || 0;
  return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
