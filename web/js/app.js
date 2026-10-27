import * as api from './api.js';
import { CONFIGURED } from './config.js';
import { t, tx, getLang, setLang } from './i18n.js';
import * as V from './views.js';
import { applyTheme } from './theme.js';
import { fieldsToMs, wallFields, nowFields, icsCalendar } from './util.js';

/* ---------- 本机存储（只放“个人偏好”和登录令牌；读写都包 try，隐私模式下也能用） ---------- */
const KEY = { token: 'ms.token', lang: 'ms.lang' };
const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
  set(k, v, session) { try { const s = session ? sessionStorage : localStorage; if (v == null) s.removeItem(k); else s.setItem(k, v); } catch (e) { /* 忽略 */ } }
};

/* ---------- 状态 ---------- */
const S = {
  screen: 'boot',              // boot | offline | login | app
  token: null, data: null, tab: null, kid: null, msgSel: null, recSid: null,
  showArchived: false, modal: null, avDraft: null, busy: false, lastSync: 0,
  upload: null, upName: '', upSize: 0, resKind: 'file', dl: null, viewer: null, recN: 1, recHw: {}, recEdit: null, recDraft: null, calMonth: null, calDay: null, preview: null, adminData: null, adminLang: null, crop: null,
  fresh: { n: new Set(), m: new Set(), r: new Set() }, readTried: new Set(),
  login: { step: 'email', email: '', ticket: null, accounts: [], err: '', busy: false, remember: true, cooldown: 0 }
};
window.__S = S; // 仅供浏览器测试读取

const $ = sel => document.querySelector(sel);
const norm = s => String(s || '').trim().toLowerCase();

/* ---------- 渲染 ---------- */
function formKey(el) {
  if (el.id) return '#' + el.id;
  const f = el.closest('form');
  return f && el.name ? `${f.dataset.form || ''}/${f.dataset.id || ''}/${el.name}` : null;
}
function snapshot(skipBooks) {
  const snap = { vals: {}, focus: null };
  document.querySelectorAll('#app input, #app textarea, #app select, #modal-root input, #modal-root textarea, #modal-root select').forEach(el => {
    const k = formKey(el); if (!k || el.type === 'hidden' || el.type === 'file') return;
    if (skipBooks && /\/bk\d+[nfksu]$|^#bk\d+-[nfu]$/.test(k)) return; // 教材行增删后，序号变了，用刚整理好的数据，不要用旧快照
    snap.vals[k] = el.type === 'checkbox' ? { c: el.checked } : { v: el.value };
  });
  const a = document.activeElement;
  if (a && a !== document.body && formKey(a)) snap.focus = { k: formKey(a), s: a.selectionStart, e: a.selectionEnd };
  return snap;
}
function restore(snap) {
  if (!snap) return;
  document.querySelectorAll('#app input, #app textarea, #app select, #modal-root input, #modal-root textarea, #modal-root select').forEach(el => {
    const k = formKey(el); const v = k && snap.vals[k]; if (!v || el.type === 'hidden' || el.type === 'file') return;
    if (el.type === 'checkbox') el.checked = v.c; else if (el.value !== v.v) el.value = v.v;
  });
  if (snap.focus) {
    const el = [...document.querySelectorAll('#app input, #app textarea, #app select, #modal-root input, #modal-root textarea, #modal-root select')].find(x => formKey(x) === snap.focus.k);
    if (el) { el.focus({ preventScroll: true }); try { if (snap.focus.s != null) el.setSelectionRange(snap.focus.s, snap.focus.e); } catch (e) { /* 数字/邮箱输入框不支持 */ } }
  }
}

function markFresh() {
  if (S.screen !== 'app') return;
  const d = S.data;
  if (S.tab === 'notices' && d.me.role !== 'admin') d.notices.filter(n => n.unread).forEach(n => S.fresh.n.add(n.id));
  if (S.tab === 'messages') { const sid = V.msgSelFor(S); d.messages.filter(m => m.sid === sid && m.unread).forEach(m => S.fresh.m.add(m.id)); }
  if (S.tab === 'resources' && d.me.role !== 'admin') (d.resources || []).filter(r => r.isNew).forEach(r => S.fresh.r.add(r.id));
}

function offlineView() {
  return `<div class="login wrap"><div class="card"><h1>${t('app.name')}</h1><p class="small muted">${t('app.sub')}</p><p>${t('boot.offline')}</p><div class="btns"><button class="btn primary" data-act="retry">${t('common.retry')}</button></div></div></div>`;
}

export function render({ keep = true, skipBooks = false } = {}) {
  const snap = keep ? snapshot(skipBooks) : null, sy = window.scrollY;
  markFresh();
  let html;
  if (!CONFIGURED) html = V.unconfiguredView();
  else if (S.screen === 'boot') html = `<div class="login wrap"><div class="card"><p class="muted">${t('common.loading')}</p></div></div>`;
  else if (S.screen === 'offline') html = offlineView();
  else if (S.screen === 'login') html = V.loginView(S);
  else {
    if (!V.tabsFor(S).includes(S.tab)) S.tab = V.defaultTab(S);
    html = V.shell(S, V.VIEWS[S.tab](S));
  }
  $('#app').innerHTML = html;
  const mr = $('#modal-root');
  mr.innerHTML = S.modal && S.screen === 'app' ? `<div class="overlay" data-act="close-bg"><div class="modal" role="dialog" aria-modal="true">${V.MODALS[S.modal.type](S)}</div></div>` : '';
  document.title = tx('app.name') + ' · ' + tx('app.sub');
  restore(snap);
  window.scrollTo(0, sy);
  const th = $('#thread'); if (th) th.scrollTop = th.scrollHeight;
  applyTheme($('#bg'), S.screen === 'app' && S.data.me.role === 'student' ? S.data.students[0] : null);
  drawCrop(); updateHints();
  autoRead();
}

function focusFirst(root) { const el = $(root + ' input:not([type=hidden]), ' + root + ' textarea, ' + root + ' select'); if (el) el.focus({ preventScroll: true }); }
function go(patch, { scroll = false } = {}) { Object.assign(S, patch); S.fresh = { n: new Set(), m: new Set(), r: new Set() }; render({ keep: false }); if (scroll) window.scrollTo(0, 0); }

let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
const errText = code => { const m = tx('err.' + code); return m.startsWith('⟦') ? tx('err.generic') : m; };

/* ---------- 数据与请求 ---------- */
function setData(state) { S.data = state; S.lastSync = Date.now(); if (S.kid && !state.students.some(s => s.id === S.kid)) S.kid = null; }

const STALE_CODES = ['stale', 'already_confirmed', 'not_found', 'forbidden', 'duplicate'];
/** 发一个需要登录的请求。成功时用返回的最新数据整体替换界面。 */
async function run(action, params, opt = {}) {
  if (S.preview) { if (!opt.quiet) toast(tx('prev.readonly')); return { ok: false, error: 'preview' }; }
  if (S.busy) return { ok: false, error: 'busy_local' };
  S.busy = true; if (!opt.silent) render();
  const r = await api.call(action, params, S.token);
  S.busy = false;
  if (!r.ok) {
    if (r.error === 'unauthorized') { sessionEnded('login.expired'); return r; }
    if (!opt.quiet) toast(errText(r.error));
    if (STALE_CODES.includes(r.error) && !opt.quiet) { await refresh(true); return r; }
    render(); // 出错时保留已填的内容，让人改一下再提交
    return r;
  }
  if (r.data && r.data.state) setData(r.data.state);
  render({ keep: !opt.fresh });
  return r;
}
async function refresh(force) {
  if (S.screen !== 'app' || S.busy || S.preview) return;
  if (!force && (Date.now() - S.lastSync < 120000 || S.modal)) return;
  const r = await api.call('bootstrap', {}, S.token);
  if (r.ok) { setData(r.data.state); render(); } else if (r.error === 'unauthorized') sessionEnded('login.expired');
}

/** 打开留言页 / 通知页时，把看到的未读标成已读（“新”标记保留到离开这一页）。 */
function autoRead() {
  if (S.screen !== 'app' || S.busy || S.preview) return;
  const d = S.data;
  if (S.tab === 'notices' && d.me.role !== 'admin') {
    const ids = d.notices.filter(n => n.unread && !S.readTried.has('n' + n.id)).map(n => n.id);
    if (ids.length) { ids.forEach(i => S.readTried.add('n' + i)); run('notices.read', { ids }, { quiet: true, silent: true }); }
  } else if (S.tab === 'resources' && d.me.role !== 'admin') {
    const ids = (d.resources || []).filter(r => r.isNew && !S.readTried.has('r' + r.id)).map(r => r.id);
    if (ids.length) { ids.forEach(i => S.readTried.add('r' + i)); run('res.seen', { ids }, { quiet: true, silent: true }); }
  } else if (S.tab === 'messages') {
    const sid = V.msgSelFor(S);
    const ids = d.messages.filter(m => m.sid === sid && m.unread && !S.readTried.has('m' + m.id)).map(m => m.id);
    if (ids.length) { ids.forEach(i => S.readTried.add('m' + i)); run('messages.read', { sid }, { quiet: true, silent: true }); }
  }
}

/* ---------- 登录 / 退出 ---------- */
function sessionEnded(msgKey) {
  closeViewer(); upFile = null;
  store.set(KEY.token, null); store.set(KEY.token, null, true);
  Object.assign(S, { upload: null, dl: null, upName: '', upSize: 0, recN: 1, recHw: {}, recEdit: null, recDraft: null, preview: null, adminData: null, crop: null, token: null, data: null, modal: null, screen: 'login', tab: null, kid: null });
  Object.assign(S.login, { step: 'email', err: msgKey || '', busy: false, ticket: null, accounts: [] });
  render({ keep: false });
}
let cdTimer;
function startCooldown(n = 30) {
  clearInterval(cdTimer); S.login.cooldown = n;
  cdTimer = setInterval(() => { S.login.cooldown--; if (S.login.cooldown <= 0) clearInterval(cdTimer); if (S.screen === 'login') render(); }, 1000);
}
async function finishLogin(token, remember) {
  S.token = token;
  store.set(KEY.token, remember ? token : null); store.set(KEY.token, remember ? null : token, true);
  const r = await api.call('bootstrap', {}, token);
  if (!r.ok) { S.login.busy = false; S.login.step = 'email'; S.login.err = 'err.' + (r.error === 'network' ? 'network' : 'generic'); render(); return; }
  setData(r.data.state);
  if (!store.get(KEY.lang) && r.data.state.me.lang) setLang(r.data.state.me.lang);
  Object.assign(S, { screen: 'app', tab: V.defaultTab(S), kid: null, modal: null });
  Object.assign(S.login, { step: 'email', busy: false, err: '', email: '' });
  render({ keep: false });
  toast(tx(remember ? 'login.okRemember' : 'login.okSession'));
}

/* ---------- 表单 ---------- */
const ST_WORDS = { new: 'new', '新曲': 'new', '新': 'new', review: 'review', '巩固': 'review', '复习': 'review', done: 'done', '完成': 'done', '学完': 'done' };
const BK_WORDS = { current: 'current', '在学': 'current', '正在学': 'current', done: 'done', '学过': 'done', '完成': 'done', '学完': 'done' };
const splitBar = line => line.split(/[|｜]/).map(x => x.trim());
export function parsePieces(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [title, source, st] = splitBar(l); return { title, source: source || '', st: ST_WORDS[(st || '').toLowerCase()] || 'new' }; });
}
export function parseBooks(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, s] = splitBar(l); return { n, s: BK_WORDS[(s || '').toLowerCase()] || 'current' }; });
}
const num = v => (v === '' || v == null ? '' : Number(v));

/* ---------- 头像：选图 → 拖动/缩放裁剪 → 144px JPEG ---------- */
const CROP = 240, AV_OUT = 144, AV_MAX_BYTES = 15 * 1024 * 1024;
function cropGeom() {
  const c = S.crop, base = CROP / Math.min(c.img.width, c.img.height), sc = base * c.zoom;
  const w = c.img.width * sc, h = c.img.height * sc;
  c.ox = Math.min(0, Math.max(CROP - w, c.ox)); c.oy = Math.min(0, Math.max(CROP - h, c.oy));
  return { sc, w, h };
}
function paintCrop(cv, size) {
  const c = S.crop, g = cropGeom(), k = size / CROP, ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(c.img, c.ox * k, c.oy * k, g.w * k, g.h * k);
}
function drawCrop() { const cv = $('#crop-cv'); if (cv && S.crop) paintCrop(cv, CROP); }
function startCrop(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast(tx('av.notImage'));
  if (file.size > AV_MAX_BYTES) return toast(tx('av.tooBig'));
  const rd = new FileReader();
  rd.onerror = () => toast(tx('av.notImage'));
  rd.onload = () => {
    const img = new Image(); // 用 data: 地址读图（页面的安全策略不允许 blob:）
    img.onload = () => {
      const base = CROP / Math.min(img.width, img.height);
      S.crop = { img, zoom: 1, ox: (CROP - img.width * base) / 2, oy: (CROP - img.height * base) / 2 };
      render({ keep: false });
    };
    img.onerror = () => toast(tx('av.notImage'));
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}
function exportCrop() {
  const cv = document.createElement('canvas'); cv.width = cv.height = AV_OUT; paintCrop(cv, AV_OUT);
  for (const q of [0.82, 0.7, 0.55, 0.4]) { const v = cv.toDataURL('image/jpeg', q); if (v.length <= 16000) return v; }
  return null;
}
let drag = null;
document.addEventListener('pointerdown', e => {
  const cv = e.target.closest && e.target.closest('[data-drag="crop"]'); if (!cv || !S.crop) return;
  drag = { x: e.clientX, y: e.clientY, ox: S.crop.ox, oy: S.crop.oy, k: CROP / cv.getBoundingClientRect().width };
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (!drag || !S.crop) return;
  S.crop.ox = drag.ox + (e.clientX - drag.x) * drag.k; S.crop.oy = drag.oy + (e.clientY - drag.y) * drag.k; drawCrop();
});
const endDrag = () => { drag = null; };
document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);

/* ---------- 记课表单：学生那边是几点（只用 textContent 更新） ---------- */
function recMs(prefix) {
  const v = id => { const el = $('#rec-' + id); return el ? el.value : ''; };
  const dateEl = $(prefix === 't' ? '#rec-date' : '#rec-ndate');
  if (!dateEl) return null;
  return fieldsToMs(dateEl.value, +v(prefix + 'h'), +v(prefix + 'm'), v(prefix + 'ap'), S.data.teacherTz);
}
/** 添加 / 修改课程的弹窗里，“学生那边是几点”的提示。 */
function updateEvHint() {
  const h = $('#ev-hint'); if (!h || !S.modal || S.modal.type !== 'event') return;
  const who = $('#ev-student') || $('#modal-root input[name=sid]');
  const ms = fieldsToMs($('#ev-date').value, +$('#rec-eh').value, +$('#rec-em').value, $('#rec-eap').value, S.data.teacherTz);
  h.textContent = ms == null ? tx('err.bad_time') : V.tzHint(S, who && who.value, ms);
}
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; };
function downloadText(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function updateHints() {
  updateEvHint();
  if (S.screen !== 'app' || S.tab !== 'record' || !$('#rec-hint')) return;
  const sid = ($('#rec-student') || {}).value;
  const ms = recMs('t'), nms = $('#rec-ndate').value ? recMs('n') : null;
  $('#rec-hint').textContent = ms == null ? tx('err.bad_time') : V.tzHint(S, sid, ms);
  $('#rec-nhint').textContent = !$('#rec-ndate').value ? '' : nms == null ? tx('err.bad_time') : V.tzHint(S, sid, nms);
}
function setNext(ms) {
  const f = wallFields(ms, S.data.teacherTz);
  $('#rec-ndate').value = f.date; $('#rec-nh').value = String(f.h12); $('#rec-nm').value = String(f.mi); $('#rec-nap').value = f.ap;
  if (![...$('#rec-nm').options].some(o => +o.value === f.mi)) { const o = new Option(String(f.mi).padStart(2, '0'), String(f.mi)); $('#rec-nm').add(o); $('#rec-nm').value = String(f.mi); }
}

/** 读速度输入：没填 → null；填错 → false；正常 → {n, b}。 */
function readTempo(fd, name) {
  const raw = String(fd.get(name + 'b') || '').trim();
  if (!raw) return null;
  const b = Number(raw);
  return Number.isInteger(b) && b >= 20 && b <= 400 ? { n: fd.get(name + 'n') || 'q', b } : false;
}

/** 读教材表单：每行 {k, n, f, s}；名字两头的空格去掉，整行都空着的行忽略。 */
function readBookRows(root) {
  const out = [];
  for (let i = 0; root.querySelector(`[name="bk${i}n"]`); i++) {
    const g = k => { const el = root.querySelector(`[name="bk${i}${k}"]`); return el ? String(el.value).trim() : ''; };
    const kk = g('k'), k = kk === 'single' || kk === 'portfolio' ? kk : 'book', row = { n: g('n'), s: g('s') === 'done' ? 'done' : 'current' };
    if (k === 'single') { row.k = 'single'; if (g('f')) row.f = g('f'); }
    if (k === 'portfolio') { row.k = 'portfolio'; row.u = g('u'); }
    out.push(row);
  }
  return out;
}
/** 退出“修改课记录”，回到新记一节课的空白表单。 */
function recReset() { S.recEdit = null; S.recDraft = null; S.recN = 1; S.recHw = {}; }
const bookDraft = () => { const f = $('#modal-root form[data-form="student-save"]'); return f ? readBookRows(f).map(r => ({ ...r, k: r.k || 'book' })) : []; };

/* ---------- 资源库：上传、下载、在线播放 ---------- */
const RES_MAX = 25 * 1024 * 1024, RES_PART = 1000000;
const RES_EXT = ['pdf', 'mp3', 'm4a', 'wav', 'ogg', 'mp4', 'webm'];
let upFile = null, viewerUrl = null;
/** 直接调后台（不经过 run()：上传和下载要很多次请求，不能每次都重画整个页面）。 */
async function callAuth(action, params) {
  const r = await api.call(action, params, S.token);
  if (!r.ok && r.error === 'unauthorized') sessionEnded('login.expired');
  return r;
}
const readB64 = blob => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onerror = () => reject(fr.error); fr.onload = () => resolve(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
function setProg(a, b) {
  const p = $('#res-prog'), tx_ = $('#res-prog-text');
  if (p) p.value = a; if (tx_) tx_.textContent = tx('res.uploading', { a, b });
}
function shareFrom(fd) { const all = !!fd.get('all'); return { all, sids: all ? [] : fd.getAll('to') }; }
async function uploadFile(fd) {
  const file = upFile;
  if (!file) return toast(tx('res.err.nofile'));
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!RES_EXT.includes(ext) || file.name.indexOf('.') <= 0) return toast(tx('err.bad_file_type'));
  if (file.size > RES_MAX) return toast(tx('res.err.big'));
  if (!file.size) return toast(tx('res.err.empty'));
  const share = shareFrom(fd);
  if (!share.all && !share.sids.length) return toast(tx('res.err.nobody'));
  const total = Math.ceil(file.size / RES_PART);
  S.upload = { done: 0, total }; render();
  const fail = code => { S.upload = null; render(); toast(typeof code === 'string' && code !== 'network' ? errText(code) : tx('res.err.upload')); };
  const b = await callAuth('res.begin', { name: file.name, size: file.size, title: String(fd.get('title') || '').trim(), note: String(fd.get('note') || ''), ...share });
  if (!b.ok) return fail(b.error);
  for (let i = 0; i < b.data.parts; i++) {
    const data = await readB64(file.slice(i * RES_PART, (i + 1) * RES_PART));
    let r;
    for (let attempt = 0; attempt < 3; attempt++) { r = await callAuth('res.chunk', { id: b.data.id, i, data }); if (r.ok || r.error !== 'network') break; }
    if (!r.ok) return fail(r.error);
    S.upload.done = i + 1; setProg(i + 1, total);
  }
  const f = await callAuth('res.finish', { id: b.data.id });
  if (!f.ok) return fail(f.error);
  setData(f.data.state); S.upload = null; upFile = null; S.upName = ''; S.upSize = 0;
  render({ keep: false }); toast(tx('res.uploaded'));
}
/** 取回整个文件（一段一段取），拼成 Blob。进度显示在按钮上。 */
async function fetchResource(r) {
  S.dl = { id: r.id, done: 0, total: r.parts }; render();
  const parts = [];
  for (let i = 0; i < r.parts; i++) {
    let res;
    for (let attempt = 0; attempt < 3; attempt++) { res = await callAuth('res.get', { id: r.id, i }); if (res.ok || res.error !== 'network') break; }
    if (!res.ok) { S.dl = null; render(); toast(errText(res.error)); return null; }
    const bin = atob(res.data.data), u8 = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    parts.push(u8); S.dl.done = i + 1; render();
  }
  S.dl = null; render();
  return new Blob(parts, { type: r.mime });
}
function closeViewer() { if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; } S.viewer = null; }

const FORMS = {
  async 'login-email'(f, fd) {
    const email = norm(fd.get('email')); const A = S.login;
    A.email = email; A.err = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { A.err = 'err.bad_email'; return render(); }
    A.busy = true; render();
    const r = await api.call('auth.request', { email, lang: getLang() });
    A.busy = false;
    if (!r.ok) { A.err = 'err.' + (['rate_limited', 'network', 'mail_unavailable', 'busy', 'bad_email'].includes(r.error) ? r.error : 'generic'); return render(); }
    A.step = 'code'; startCooldown(30); render({ keep: false }); focusFirst('#app');
  },
  async 'login-code'(f, fd) {
    const A = S.login; A.err = ''; A.remember = !!fd.get('remember');
    const code = String(fd.get('code') || '').replace(/\D/g, '');
    if (code.length !== 6) { A.err = 'err.invalid_code'; return render(); }
    A.busy = true; render();
    const r = await api.call('auth.verify', { email: A.email, code, remember: A.remember });
    if (!r.ok) { A.busy = false; A.err = 'err.' + (['invalid_code', 'rate_limited', 'network', 'busy'].includes(r.error) ? r.error : 'generic'); render({ keep: false }); return focusFirst('#app'); }
    if (r.data.ticket) { A.busy = false; A.step = 'pick'; A.ticket = r.data.ticket; A.accounts = r.data.accounts; return render({ keep: false }); }
    await finishLogin(r.data.token, A.remember);
  },
  async 'login-kid'(f, fd) {
    const A = S.login; A.err = ''; A.remember = !!fd.get('remember'); A.kidName = String(fd.get('name') || '');
    const code = String(fd.get('code') || '').replace(/\D/g, '');
    if (!A.kidName.trim() || code.length !== 8) { A.err = 'err.invalid_code'; return render(); }
    A.busy = true; render();
    const r = await api.call('auth.kid', { name: A.kidName, code, remember: A.remember });
    if (!r.ok) { A.busy = false; A.err = 'err.' + (['invalid_code', 'rate_limited', 'network', 'busy'].includes(r.error) ? r.error : 'generic'); render({ keep: false }); return focusFirst('#app'); }
    await finishLogin(r.data.token, A.remember);
  },
  async 'res-add'(f, fd) {
    if ((S.resKind || 'file') === 'file') return uploadFile(fd);
    const share = shareFrom(fd);
    if (!share.all && !share.sids.length) return toast(tx('res.err.nobody'));
    const r = await run('res.link', { title: String(fd.get('title') || '').trim(), url: String(fd.get('url') || '').trim(), note: String(fd.get('note') || ''), ...share }, { fresh: true });
    if (r.ok) toast(tx('res.uploaded'));
  },
  async 'res-update'(f, fd) {
    const share = shareFrom(fd);
    if (!share.all && !share.sids.length) return toast(tx('res.err.nobody'));
    const r = await run('res.update', { id: f.dataset.id, title: String(fd.get('title') || '').trim(), note: String(fd.get('note') || ''), ...share }, { fresh: true });
    if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); }
  },
  async 'rec-save'(f, fd) {
    const pieces = [];
    for (let i = 0; i < S.recN; i++) {
      const title = String(fd.get(`p${i}title`) || '').trim();
      if (!title) return toast(tx('err.rec_pieces'));
      const tempo = readTempo(fd, `p${i}t`); if (tempo === false) return toast(tx('err.bpm'));
      const hw = fd.get(`p${i}hw`) !== 'no';
      const pc = { title, source: String(fd.get(`p${i}src`) || '').trim(), tempo, hw };
      if (hw) {
        const ht = readTempo(fd, `p${i}h`); if (ht === false) return toast(tx('err.bpm'));
        Object.assign(pc, { st: fd.get(`p${i}st`) || 'new', hwTempo: ht, video: !!fd.get(`p${i}vid`) });
      }
      pieces.push(pc);
    }
    const tz = S.data.teacherTz;
    const ms = fieldsToMs(fd.get('date'), +fd.get('th'), +fd.get('tm'), fd.get('tap'), tz);
    if (ms == null) return toast(tx('err.bad_time'));
    let next = '';
    if (fd.get('ndate')) {
      const nms = fieldsToMs(fd.get('ndate'), +fd.get('nh'), +fd.get('nm'), fd.get('nap'), tz);
      if (nms == null) return toast(tx('err.bad_time'));
      if (nms <= ms) return toast(tx('err.next_before'));
      next = new Date(nms).toISOString();
    }
    const sid = fd.get('sid'); S.recSid = sid;
    const body = { date: new Date(ms).toISOString(), dur: num(fd.get('dur')), pieces, focus: fd.get('focus'), homework: fd.get('homework'), due: fd.get('due') || '', next };
    const r = S.recEdit ? await run('lessons.edit', { id: S.recEdit, ...body }, { fresh: true }) : await run('lessons.log', { sid, ...body }, { fresh: true });
    if (r.ok) { const was = S.recEdit; recReset(); render({ keep: false }); toast(tx(was ? 'rec.savedEdit' : 'rec.saved')); if (was) window.scrollTo(0, 0); }
  },
  async 'ev-save'(f, fd) {
    const tz = S.data.teacherTz, date = String(fd.get('date') || ''), h = +fd.get('eh'), mi = +fd.get('em'), ap = fd.get('eap');
    const ms = fieldsToMs(date, h, mi, ap, tz); if (ms == null) return toast(tx('err.bad_time'));
    const dur = num(fd.get('dur')), note = String(fd.get('note') || '').trim();
    let r;
    if (f.dataset.id) r = await run('events.edit', { id: f.dataset.id, start: new Date(ms).toISOString(), dur, note, notify: !!fd.get('notify') }, { fresh: true });
    else {
      const n = Math.min(26, Math.max(1, Math.floor(Number(fd.get('rep')) || 1))), starts = [];
      for (let k = 0; k < n; k++) { const m2 = fieldsToMs(addDays(date, 7 * k), h, mi, ap, tz); if (m2 == null) return toast(tx('err.bad_time')); starts.push(new Date(m2).toISOString()); }
      r = await run('events.add', { sid: fd.get('sid'), starts, dur, note }, { fresh: true });
    }
    if (r.ok) {
      S.modal = null; S.calDay = date; S.calMonth = date.slice(0, 7); render({ keep: false });
      const ov = (r.data && r.data.overlap) || [];
      toast(ov.length ? tx('cal.overlap', { names: ov.join(', ') }) : tx('common.saved'));
    }
  },
  async 'profile-birth'(f, fd) {
    const body = { birth: String(fd.get('birth') || '') };
    if (S.data.me.role === 'parent') body.sid = f.dataset.id;
    const r = await run('profile.save', body, { fresh: true });
    if (r.ok) { render({ keep: false }); toast(tx('common.saved')); }
  },
  async 'student-save'(f, fd) {
    const student = { name: fd.get('name'), email: fd.get('email'), kind: fd.get('kind'), lang: fd.get('lang'), birth: fd.get('birth') || '', start: fd.get('start') || '',
      tz: fd.get('tz') || undefined, level: fd.get('level'), grp: fd.get('grp'), dur: num(fd.get('dur')), paid: num(fd.get('paid')), carry: fd.has('carry') ? num(fd.get('carry')) : ((stuById(f.dataset.id) || {}).carry || 0), adj: num(fd.get('adj')), showPoints: !!fd.get('showPoints'),
      billing: fd.get('billing') || 'lessons', billFrom: fd.get('billFrom') || '' };
    if (fd.has('mPlan')) { student.mPlan = fd.get('mPlan'); student.mDone = fd.get('mDone'); }
    if (fd.has('term')) student.term = num(fd.get('term'));
    if (f.dataset.id) student.id = f.dataset.id;
    student.books = readBookRows(f);
    if (student.books.some(b => !b.n)) return toast(tx('err.book_name'));
    if (student.books.some(b => b.k === 'portfolio' && !/^https:\/\/\S+$/i.test(b.u || ''))) return toast(tx('err.bad_url'));
    const r = await run('students.save', { student }, { fresh: true });
    if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); }
  },
  async 'parent-save'(f, fd) {
    const parent = { name: fd.get('name'), email: fd.get('email'), lang: fd.get('lang') };
    if (f.dataset.id) parent.id = f.dataset.id;
    const r = await run('parents.save', { parent }, { fresh: true });
    if (r.ok) {
      if (!f.dataset.id) { S.modal = { type: 'parent', id: r.data.id }; } else S.modal = null;
      render({ keep: false }); toast(tx('common.saved'));
    }
  },
  async remind(f, fd) {
    const r = await run('tuition.remind', { sid: f.dataset.id, note: fd.get('note') }, { fresh: true });
    if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('rem.sent', { n: r.data.sent })); }
  },
  async 'notice-send'(f, fd) {
    const to = fd.get('to');
    const r = await run('notices.send', { scope: to === 'all' ? 'all' : 'student', sid: to === 'all' ? '' : to, aud: fd.get('aud'), title: fd.get('title'), body: fd.get('body') }, { fresh: true });
    if (r.ok) toast(tx('nt.sentOk'));
  },
  async 'msg-send'(f, fd) {
    const text = String(fd.get('text') || '').trim();
    if (!text) return;
    const p = { text }; if (S.data.me.role !== 'student') p.sid = f.dataset.sid;
    const r = await run('messages.send', p, { fresh: true });
    if (r.ok) { S.fresh = { n: new Set(), m: new Set(), r: new Set() }; render({ keep: false }); toast(tx('msg.sentOk')); }
  },
  async 'rules-save'(f, fd) {
    const rules = {};
    [...V.RULE_NOW, ...V.RULE_LATER].forEach(k => { rules[k] = num(fd.get(k)); });
    const r = await run('rules.save', { rules });
    if (r.ok) toast(tx('common.saved'));
  }
};

/* ---------- 点击动作 ---------- */
const stuById = id => S.data.students.find(s => s.id === id);
const ACT = {
  lang() { const l = getLang() === 'zh' ? 'en' : 'zh'; setLang(l); store.set(KEY.lang, l); render(); },
  retry() { boot(); },
  tab(d) { go({ tab: d.tab }, { scroll: true }); },
  kid(d) { go({ kid: d.id }); },
  'kid-go'(d) { go({ kid: d.id, tab: d.tab }, { scroll: true }); },
  'goto-msg'(d) { go({ tab: 'messages', msgSel: d.id }, { scroll: true }); },
  'sel-msg'(d) { go({ msgSel: d.id }); },
  'toggle-archived'() { S.showArchived = !S.showArchived; render(); },
  close() { closeViewer(); S.modal = null; S.avDraft = null; S.crop = null; render({ keep: false }); },
  'close-bg'(d, el, e) { if (e.target === el) ACT.close(); },
  'res-kind'(d) { S.resKind = d.k === 'link' ? 'link' : 'file'; render(); },
  'res-edit'(d) { S.modal = { type: 'resedit', id: d.id }; render({ keep: false }); focusFirst('#modal-root'); },
  'res-del'(d) {
    S.modal = { type: 'confirm', title: 'res.delTitle', body: 'res.delBody', vars: {}, yes: 'common.delete',
      run: async () => { const r = await run('res.delete', { id: d.id }, { fresh: true }); S.modal = null; render({ keep: false }); if (r.ok) toast(tx('common.saved')); } };
    render({ keep: false });
  },
  async 'res-dl'(d) {
    if (S.dl) return;
    const r = (S.data.resources || []).find(x => x.id === d.id); if (!r) return;
    const blob = await fetchResource(r); if (!blob) return;
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = r.name || 'file'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  async 'res-print'(d) {
    if (S.dl) return;
    const r = (S.data.resources || []).find(x => x.id === d.id); if (!r) return;
    const w = window.open('', '_blank'); // 必须在点击的那一刻打开，否则会被浏览器当成弹窗拦截
    if (w) w.document.title = r.title;
    const blob = await fetchResource(r); if (!blob) { if (w) w.close(); return; }
    const url = URL.createObjectURL(blob);
    if (w) { w.location.href = url; toast(tx('res.printHint')); } else { ACT['res-dl'](d); toast(tx('res.popupBlocked')); }
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60000);
  },
  async 'res-play'(d) {
    if (S.dl) return;
    const r = (S.data.resources || []).find(x => x.id === d.id); if (!r) return;
    const blob = await fetchResource(r); if (!blob) return;
    closeViewer(); viewerUrl = URL.createObjectURL(blob);
    S.viewer = { id: r.id, url: viewerUrl }; S.modal = { type: 'resview' }; render({ keep: false });
  },
  'viewer-close'() { ACT.close(); },
  'book-add'() { const rows = bookDraft(); rows.push({ k: 'book', n: '', s: 'current' }); S.modal.books = rows; render({ skipBooks: true }); const ins = document.querySelectorAll('#modal-root .bk-row input[type=text]'); const last = [...ins].reverse().find(x => /^bk\d+n$/.test(x.name)); if (last) last.focus({ preventScroll: true }); },
  'book-del'(d) { const rows = bookDraft(); rows.splice(Number(d.i), 1); S.modal.books = rows; render({ skipBooks: true }); },
  'student-new'() { S.modal = { type: 'student', id: null, books: [] }; render({ keep: false }); focusFirst('#modal-root'); },
  'student-edit'(d) { S.modal = { type: 'student', id: d.id, books: (stuById(d.id).books || []).map(b => ({ k: b.k === 'single' ? 'single' : 'book', n: b.n, f: b.f || '', s: b.s })) }; render({ keep: false }); focusFirst('#modal-root'); },
  'parent-new'() { S.modal = { type: 'parent', id: null }; render({ keep: false }); focusFirst('#modal-root'); },
  'parent-edit'(d) { S.modal = { type: 'parent', id: d.id }; render({ keep: false }); focusFirst('#modal-root'); },
  async archive(d) { const r = await run('students.archive', { id: d.id, active: d.to === 'true' }, { fresh: true }); if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); } },
  async 'parent-archive'(d) { const r = await run('parents.archive', { id: d.id, active: d.to === 'true' }, { fresh: true }); if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); } },
  remind(d) { S.modal = { type: 'remind', id: d.id }; render({ keep: false }); focusFirst('#modal-root'); },
  paid(d) {
    const s = stuById(d.id);
    if (s.tuition.plan) { // 按月且设了节数：收到款后在编辑页填新一轮“本月交了几节”
      S.modal = { type: 'student', id: s.id, books: (s.books || []).map(b => ({ k: b.k === 'single' ? 'single' : 'book', n: b.n, f: b.f || '', s: b.s })) };
      render({ keep: false }); toast(tx('cf.paidPlanHint')); return;
    }
    S.modal = { type: 'confirm', title: 'cf.paidTitle', body: s.tuition.mode === 'month' ? 'cf.paidBodyMonth' : 'cf.paidBody', vars: { name: s.name, t: s.tuition.n }, yes: 'ov.paid',
      run: async () => { const r = await run('tuition.paid', { sid: s.id, expectPaid: s.paid }, { fresh: true }); if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); } else { S.modal = null; render({ keep: false }); } } };
    render({ keep: false });
  },
  'cal-day'(d) { S.calDay = d.day; S.calMonth = d.day.slice(0, 7); render({ keep: false }); },
  'cal-month'(d) {
    const tz = V.calTz ? V.calTz(S) : S.data.teacherTz, cur = S.calMonth || wallFields(Date.now(), tz).date.slice(0, 7);
    const [y, m] = cur.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + Number(d.d), 1));
    S.calMonth = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; S.calDay = null; render({ keep: false });
  },
  'cal-today'() { S.calMonth = null; S.calDay = null; render({ keep: false }); },
  'ev-new'(d) { S.modal = { type: 'event', day: d.day || '' }; render({ keep: false }); },
  'ev-edit'(d) { S.modal = { type: 'event', id: d.id }; render({ keep: false }); },
  async 'ev-status'(d) {
    const n = $('#modal-root input[name=notify]');
    const r = await run('events.edit', { id: d.id, status: d.to, notify: !!(n && n.checked) }, { fresh: true });
    if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); }
  },
  'ev-del'(d) {
    S.modal = { type: 'confirm', title: 'cal.delTitle', body: 'cal.delBody', vars: {}, yes: 'common.delete',
      run: async () => { const r = await run('events.delete', { id: d.id }, { fresh: true }); S.modal = null; render({ keep: false }); if (r.ok) toast(tx('common.saved')); } };
    render({ keep: false });
  },
  'ev-ics'(d) {
    const e = (S.data.events || []).find(x => x.id === d.id); if (!e) return;
    downloadText('lesson.ics', icsCalendar([V.evCalData(S, e)]), 'text/calendar;charset=utf-8');
  },
  'ev-ics-all'() {
    const up = (S.data.events || []).filter(e => e.status === 'scheduled' && Date.parse(e.start) > Date.now());
    if (up.length) downloadText('lessons.ics', icsCalendar(up.map(e => V.evCalData(S, e))), 'text/calendar;charset=utf-8');
  },
  'lesson-edit'(d) {
    const l = S.data.lessons.find(x => x.id === d.id); if (!l) return;
    const ps = (l.notes && l.notes.pieces) || [];
    S.recEdit = l.id; S.recDraft = { pieces: ps }; S.recSid = l.sid;
    S.recN = Math.min(V.REC_MAX_PIECES, Math.max(1, ps.length));
    S.recHw = {}; ps.forEach((p, i) => { S.recHw[i] = (p.hw === undefined ? p.st !== 'done' : p.hw) ? 'yes' : 'no'; });
    S.tab = 'record'; render({ keep: false }); window.scrollTo(0, 0);
  },
  'rec-edit-cancel'() { recReset(); render({ keep: false }); },
  'lesson-del'(d) {
    S.modal = { type: 'confirm', title: 'cf.delTitle', body: 'cf.delBody', vars: {}, yes: 'common.delete',
      run: async () => { const r = await run('lessons.delete', { id: d.id }, { fresh: true }); S.modal = null; render({ keep: false }); if (r.ok) toast(tx('common.saved')); } };
    render({ keep: false });
  },
  'confirm-yes'() { if (S.modal && S.modal.run) S.modal.run(); },
  async sign(d) { const r = await run('lessons.sign', { id: d.id }); if (r.ok) toast(tx('les.signedOk')); },
  async claim(d) { const r = await run('tuition.claim', { sid: d.id }); if (r.ok) toast(tx('tu.claimedOk')); },
  'av-open'() { S.avDraft = null; S.crop = null; S.modal = { type: 'avatar' }; render({ keep: false }); },
  'av-pick'(d) { const a = S.data.me.avatar; S.avDraft = { ...(S.avDraft || (a && a.t === 'emoji' ? { v: a.v, c: a.c } : { v: null, c: '#F6D7B0' })), v: d.v }; render(); },
  'av-col'(d) { const a = S.data.me.avatar; S.avDraft = { ...(S.avDraft || (a && a.t === 'emoji' ? { v: a.v, c: a.c } : { v: null, c: '#F6D7B0' })), c: d.c }; render(); },
  async 'av-save'() { const a = S.avDraft; if (!a || !a.v) return; const r = await run('profile.save', { avatar: { t: 'emoji', v: a.v, c: a.c } }, { fresh: true }); if (r.ok) { S.modal = null; S.avDraft = null; render({ keep: false }); } },
  async 'av-clear'() { const r = await run('profile.save', { avatar: null }, { fresh: true }); if (r.ok) { S.modal = null; S.avDraft = null; render({ keep: false }); } },
  async preview(d) {
    if (S.busy || S.preview) return;
    S.busy = true; render();
    const r = await api.call('preview.state', d.kind === 'parent' ? { pid: d.id } : { sid: d.id }, S.token);
    S.busy = false;
    if (!r.ok) { if (r.error === 'unauthorized') return sessionEnded('login.expired'); toast(errText(r.error)); return render(); }
    S.adminData = S.data; S.adminLang = getLang();
    S.preview = { id: d.id, kind: d.kind || 'student' }; S.data = r.data.preview; S.modal = null; S.kid = null; S.msgSel = null;
    const l = S.data.me.lang; if (l === 'zh' || l === 'en') setLang(l);
    S.tab = V.defaultTab(S); render({ keep: false }); window.scrollTo(0, 0);
  },
  'preview-exit'() {
    if (!S.preview) return;
    S.data = S.adminData; S.adminData = null; S.preview = null; setLang(S.adminLang || getLang());
    S.tab = 'students'; S.modal = null; S.kid = null; render({ keep: false }); window.scrollTo(0, 0);
  },
  'rec-next7'() {
    const ms = recMs('t'); if (ms == null) return toast(tx('err.bad_time'));
    const dt = new Date(ms + 7 * 86400000); setNext(dt.getTime()); updateHints();
  },
  'rec-next-clear'() { $('#rec-ndate').value = ''; updateHints(); },
  async 'crop-save'() {
    if (!S.crop) return;
    const v = exportCrop(); if (!v) return toast(tx('av.tooBig'));
    const r = await run('profile.save', { avatar: { t: 'img', v } }, { fresh: true });
    if (r.ok) { S.crop = null; S.modal = null; render({ keep: false }); }
  },
  'kidcode-make'(d) {
    const s = stuById(d.id);
    const run_ = async () => {
      const r = await run('kidcode.set', { sid: s.id }, { fresh: true });
      if (r.ok) { S.modal = { type: 'kidcode', name: r.data.name, code: r.data.code, sid: s.id }; render({ keep: false }); } else { S.modal = null; render({ keep: false }); }
    };
    if (!s.hasCode) return run_();
    S.modal = { type: 'confirm', title: 'kid.resetTitle', body: 'kid.resetBody', vars: { name: s.name }, yes: 'kid.reset', run: run_ };
    render({ keep: false });
  },
  'kidcode-off'(d) {
    const s = stuById(d.id);
    S.modal = { type: 'confirm', title: 'kid.offTitle', body: 'kid.offBody', vars: { name: s.name }, yes: 'kid.turnOff',
      run: async () => { const r = await run('kidcode.clear', { sid: s.id }, { fresh: true }); S.modal = null; render({ keep: false }); if (r.ok) toast(tx('common.saved')); } };
    render({ keep: false });
  },
  async 'kid-copy'() {
    const m = S.modal; if (!m || m.type !== 'kidcode') return;
    const text = tx('kid.copyText', { name: m.name, code: m.code, url: location.origin + location.pathname });
    try { await navigator.clipboard.writeText(text); toast(tx('kid.copied')); } catch (e) { toast(tx('kid.copyFail')); }
  },
  async logout() { const tk = S.token; sessionEnded(''); api.call('auth.logout', {}, tk); },
  /* 登录 */
  'login-kid'() { Object.assign(S.login, { step: 'kid', err: '' }); render({ keep: false }); focusFirst('#app'); },
  'login-back'() { Object.assign(S.login, { step: 'email', err: '', ticket: null, accounts: [], kidName: '' }); render({ keep: false }); focusFirst('#app'); },
  async 'login-resend'() {
    const A = S.login; if (A.busy || A.cooldown > 0) return;
    A.busy = true; A.err = ''; render();
    const r = await api.call('auth.request', { email: A.email, lang: getLang() });
    A.busy = false;
    if (!r.ok) A.err = 'err.' + (['rate_limited', 'network', 'mail_unavailable', 'busy'].includes(r.error) ? r.error : 'generic'); else startCooldown(30);
    render();
  },
  async 'login-pick'(d) {
    const A = S.login, a = A.accounts[+d.i]; if (!a || A.busy) return;
    A.busy = true; render();
    const r = await api.call('auth.choose', { ticket: A.ticket, role: a.role, id: a.id });
    if (!r.ok) { A.busy = false; A.step = 'email'; A.err = 'err.' + (r.error === 'network' ? 'network' : 'invalid_code'); return render({ keep: false }); }
    await finishLogin(r.data.token, A.remember);
  }
};

const CHANGE = {
  async pair(el) {
    const r = await run('pairs.set', { pid: el.dataset.pid, sid: el.dataset.sid, on: el.checked }, { silent: true });
    if (!r.ok) render({ keep: false }); // 失败时把勾选恢复成服务器上的真实状态
  },
  'av-file'(el) { const f = el.files && el.files[0]; el.value = ''; startCrop(f); },
  async 'me-tz'(el) { const r = await run('profile.save', { tz: el.value }, { fresh: true }); if (r.ok) toast(tx('common.saved')); },
  async hw(el) {
    const on = el.checked;
    const r = await run('homework.check', { id: el.dataset.id, idx: Number(el.dataset.idx), on }, { silent: true });
    if (!r.ok) render({ keep: false });
  },
  'book-kind'() { S.modal.books = bookDraft(); render({ skipBooks: true }); },
  'res-file'(el) {
    const f = el.files && el.files[0]; el.value = '';
    if (!f) return;
    upFile = f; S.upName = f.name; S.upSize = f.size;
    const ti = $('#res-title'); if (ti && !ti.value.trim()) ti.value = f.name.replace(/\.[^.]+$/, '').slice(0, 200);
    render();
  },
  'ev-student'(el) { const s = stuById(el.value), dur = $('#ev-dur'); if (s && dur) dur.value = s.dur; updateEvHint(); },
  'bill-mode'(el) { S.modal.billing = el.value; render(); },
  'rec-count'(el) { S.recN = Math.min(V.REC_MAX_PIECES, Math.max(1, Number(el.value) || 1)); render(); },
  'rec-hw'(el) { S.recHw = { ...S.recHw, [el.dataset.i]: el.value }; render(); },
  'rec-student'(el) {
    S.recSid = el.value;
    const s = stuById(el.value), dur = $('#rec-dur');
    if (s && dur) dur.value = s.dur;
    updateHints();
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = ACT[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  fn(el.dataset, el, e);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form]; if (fn) fn(f, new FormData(f));
});
document.addEventListener('change', e => { if (e.target.classList && e.target.classList.contains('rec-tf')) updateHints(); const el = e.target.closest('[data-change]'); if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el); });
document.addEventListener('input', e => {
  if (e.target.id === 'crop-zoom' && S.crop) { S.crop.zoom = Number(e.target.value); drawCrop(); return; }
  if (e.target.classList && e.target.classList.contains('rec-tf')) { updateHints(); return; }
  if (e.target.id === 'kid-code') { const v = e.target.value.replace(/\D/g, '').slice(0, 8); if (v !== e.target.value) e.target.value = v; return; }
  if (e.target.id === 'login-code') {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6); if (v !== e.target.value) e.target.value = v;
    if (v.length === 6 && !S.login.busy) e.target.form.requestSubmit(); // 输满 6 位自动提交
  }
});
document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('.nodl')) e.preventDefault(); }); // 音频、视频只在线播放：不给“另存为”的右键菜单
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.modal) ACT.close(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });

/* ---------- 启动 ---------- */
async function boot() {
  const pref = store.get(KEY.lang);
  setLang(pref || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'));
  if (!CONFIGURED) { S.screen = 'login'; return render(); }
  const tk = store.get(KEY.token) || store.get(KEY.token, true);
  if (!tk) { S.screen = 'login'; return render(); }
  S.screen = 'boot'; render({ keep: false });
  S.token = tk;
  const r = await api.call('bootstrap', {}, tk);
  if (r.ok) { setData(r.data.state); if (!pref && r.data.state.me.lang) setLang(r.data.state.me.lang); S.screen = 'app'; S.tab = V.defaultTab(S); return render({ keep: false }); }
  if (r.error === 'network' || r.error === 'server' || r.error === 'busy') { S.screen = 'offline'; return render({ keep: false }); }
  store.set(KEY.token, null); store.set(KEY.token, null, true);
  S.token = null; S.screen = 'login'; render({ keep: false });
}
boot();
