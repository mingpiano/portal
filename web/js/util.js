/** 所有用户数据进入网页前都要过 esc()。 */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 头像可选项。必须和 apps-script/Config.js 里的白名单一致（有测试守着）。 */
export const AVATAR_EMOJI = ['🐼', '🦊', '🐱', '🐶', '🦄', '🐰', '🐯', '🦁', '🐸', '🐙', '🐧', '🦋', '🎹', '🎼', '🌿', '☕', '🌙', '🍃', '🕊️', '🌸', '🎷', '📚', '🌻'];
export const AVATAR_COLORS = ['#F6D7B0', '#CFE6D8', '#D6DDF5', '#F3D0DA', '#E9E2B5', '#D5EAF2'];

const initials = n => { n = String(n || '?').trim() || '?'; return /[A-Za-z]/.test(n[0]) ? n.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase() : n.slice(-2); };

export function avatar(p, size = 34) {
  const a = p && p.avatar, base = `width:${size}px;height:${size}px;font-size:${Math.round(size * .52)}px`;
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
