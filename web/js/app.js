import * as api from './api.js';
import { CONFIGURED } from './config.js';
import { t, tx, getLang, setLang } from './i18n.js';
import * as V from './views.js';

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
  fresh: { n: new Set(), m: new Set() }, readTried: new Set(),
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
function snapshot() {
  const snap = { vals: {}, focus: null };
  document.querySelectorAll('#app input, #app textarea, #app select, #modal-root input, #modal-root textarea, #modal-root select').forEach(el => {
    const k = formKey(el); if (!k || el.type === 'hidden') return;
    snap.vals[k] = el.type === 'checkbox' ? { c: el.checked } : { v: el.value };
  });
  const a = document.activeElement;
  if (a && a !== document.body && formKey(a)) snap.focus = { k: formKey(a), s: a.selectionStart, e: a.selectionEnd };
  return snap;
}
function restore(snap) {
  if (!snap) return;
  document.querySelectorAll('#app input, #app textarea, #app select, #modal-root input, #modal-root textarea, #modal-root select').forEach(el => {
    const k = formKey(el); const v = k && snap.vals[k]; if (!v || el.type === 'hidden') return;
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
}

function offlineView() {
  return `<div class="login wrap"><div class="card"><h1>${t('app.name')}</h1><p>${t('boot.offline')}</p><div class="btns"><button class="btn primary" data-act="retry">${t('common.retry')}</button></div></div></div>`;
}

export function render({ keep = true } = {}) {
  const snap = keep ? snapshot() : null, sy = window.scrollY;
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
  document.title = S.screen === 'app' ? (S.data.studio[getLang()] || t('app.name')) : t('app.name');
  restore(snap);
  window.scrollTo(0, sy);
  const th = $('#thread'); if (th) th.scrollTop = th.scrollHeight;
  autoRead();
}

function focusFirst(root) { const el = $(root + ' input:not([type=hidden]), ' + root + ' textarea, ' + root + ' select'); if (el) el.focus({ preventScroll: true }); }
function go(patch, { scroll = false } = {}) { Object.assign(S, patch); S.fresh = { n: new Set(), m: new Set() }; render({ keep: false }); if (scroll) window.scrollTo(0, 0); }

let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
const errText = code => { const m = tx('err.' + code); return m.startsWith('⟦') ? tx('err.generic') : m; };

/* ---------- 数据与请求 ---------- */
function setData(state) { S.data = state; S.lastSync = Date.now(); if (S.kid && !state.students.some(s => s.id === S.kid)) S.kid = null; }

const STALE_CODES = ['stale', 'already_confirmed', 'not_found', 'forbidden', 'duplicate'];
/** 发一个需要登录的请求。成功时用返回的最新数据整体替换界面。 */
async function run(action, params, opt = {}) {
  if (S.busy) return { ok: false, error: 'busy_local' };
  S.busy = true; if (!opt.silent) render();
  const r = await api.call(action, params, S.token);
  S.busy = false;
  if (!r.ok) {
    if (r.error === 'unauthorized') { sessionEnded('login.expired'); return r; }
    if (!opt.quiet) toast(errText(r.error));
    if (STALE_CODES.includes(r.error) && !opt.quiet) { await refresh(true); return r; }
    render({ keep: !opt.fresh });
    return r;
  }
  if (r.data && r.data.state) setData(r.data.state);
  render({ keep: !opt.fresh });
  return r;
}
async function refresh(force) {
  if (S.screen !== 'app' || S.busy) return;
  if (!force && (Date.now() - S.lastSync < 120000 || S.modal)) return;
  const r = await api.call('bootstrap', {}, S.token);
  if (r.ok) { setData(r.data.state); render(); } else if (r.error === 'unauthorized') sessionEnded('login.expired');
}

/** 打开留言页 / 通知页时，把看到的未读标成已读（“新”标记保留到离开这一页）。 */
function autoRead() {
  if (S.screen !== 'app' || S.busy) return;
  const d = S.data;
  if (S.tab === 'notices' && d.me.role !== 'admin') {
    const ids = d.notices.filter(n => n.unread && !S.readTried.has('n' + n.id)).map(n => n.id);
    if (ids.length) { ids.forEach(i => S.readTried.add('n' + i)); run('notices.read', { ids }, { quiet: true, silent: true }); }
  } else if (S.tab === 'messages') {
    const sid = V.msgSelFor(S);
    const ids = d.messages.filter(m => m.sid === sid && m.unread && !S.readTried.has('m' + m.id)).map(m => m.id);
    if (ids.length) { ids.forEach(i => S.readTried.add('m' + i)); run('messages.read', { sid }, { quiet: true, silent: true }); }
  }
}

/* ---------- 登录 / 退出 ---------- */
function sessionEnded(msgKey) {
  store.set(KEY.token, null); store.set(KEY.token, null, true);
  Object.assign(S, { token: null, data: null, modal: null, screen: 'login', tab: null, kid: null });
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
  async 'rec-save'(f, fd) {
    const pieces = parsePieces(fd.get('pieces'));
    if (!pieces.length || pieces.some(p => !p.title)) return toast(tx('err.rec_pieces'));
    const when = new Date(fd.get('date'));
    if (isNaN(when)) return toast(tx('err.bad_request'));
    const sid = fd.get('sid'); S.recSid = sid;
    const r = await run('lessons.log', { sid, date: when.toISOString(), dur: num(fd.get('dur')), pieces, focus: fd.get('focus'), tempo: fd.get('tempo'), homework: fd.get('homework'), due: fd.get('due') || '' }, { fresh: true });
    if (r.ok) toast(tx('rec.saved'));
  },
  async 'student-save'(f, fd) {
    const student = { name: fd.get('name'), email: fd.get('email'), kind: fd.get('kind'), lang: fd.get('lang'), birth: fd.get('birth') || '', start: fd.get('start') || '',
      level: fd.get('level'), grp: fd.get('grp'), dur: num(fd.get('dur')), paid: num(fd.get('paid')), carry: num(fd.get('carry')), adj: num(fd.get('adj')), showPoints: !!fd.get('showPoints') };
    if (f.dataset.id) student.id = f.dataset.id;
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
    if (r.ok) { S.fresh = { n: new Set(), m: new Set() }; render({ keep: false }); toast(tx('msg.sentOk')); }
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
  close() { S.modal = null; S.avDraft = null; render({ keep: false }); },
  'close-bg'(d, el, e) { if (e.target === el) ACT.close(); },
  'student-new'() { S.modal = { type: 'student', id: null }; render({ keep: false }); focusFirst('#modal-root'); },
  'student-edit'(d) { S.modal = { type: 'student', id: d.id }; render({ keep: false }); focusFirst('#modal-root'); },
  'parent-new'() { S.modal = { type: 'parent', id: null }; render({ keep: false }); focusFirst('#modal-root'); },
  'parent-edit'(d) { S.modal = { type: 'parent', id: d.id }; render({ keep: false }); focusFirst('#modal-root'); },
  async archive(d) { const r = await run('students.archive', { id: d.id, active: d.to === 'true' }, { fresh: true }); if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); } },
  async 'parent-archive'(d) { const r = await run('parents.archive', { id: d.id, active: d.to === 'true' }, { fresh: true }); if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); } },
  async 'books-save'(d) {
    const books = parseBooks($('#books-text').value);
    if (books.some(b => !b.n)) return toast(tx('err.bad_request'));
    const r = await run('books.save', { sid: d.id, books }); if (r.ok) toast(tx('common.saved'));
  },
  remind(d) { S.modal = { type: 'remind', id: d.id }; render({ keep: false }); focusFirst('#modal-root'); },
  paid(d) {
    const s = stuById(d.id);
    S.modal = { type: 'confirm', title: 'cf.paidTitle', body: 'cf.paidBody', vars: { name: s.name }, yes: 'ov.paid',
      run: async () => { const r = await run('tuition.paid', { sid: s.id, expectPaid: s.paid }, { fresh: true }); if (r.ok) { S.modal = null; render({ keep: false }); toast(tx('common.saved')); } else { S.modal = null; render({ keep: false }); } } };
    render({ keep: false });
  },
  'lesson-del'(d) {
    S.modal = { type: 'confirm', title: 'cf.delTitle', body: 'cf.delBody', vars: {}, yes: 'common.delete',
      run: async () => { const r = await run('lessons.delete', { id: d.id }, { fresh: true }); S.modal = null; render({ keep: false }); if (r.ok) toast(tx('common.saved')); } };
    render({ keep: false });
  },
  'confirm-yes'() { if (S.modal && S.modal.run) S.modal.run(); },
  async sign(d) { const r = await run('lessons.sign', { id: d.id }); if (r.ok) toast(tx('les.signedOk')); },
  async claim(d) { const r = await run('tuition.claim', { sid: d.id }); if (r.ok) toast(tx('tu.claimedOk')); },
  'av-open'() { S.avDraft = null; S.modal = { type: 'avatar' }; render({ keep: false }); },
  'av-pick'(d) { const a = S.data.me.avatar; S.avDraft = { ...(S.avDraft || (a && a.t === 'emoji' ? { v: a.v, c: a.c } : { v: null, c: '#F6D7B0' })), v: d.v }; render(); },
  'av-col'(d) { const a = S.data.me.avatar; S.avDraft = { ...(S.avDraft || (a && a.t === 'emoji' ? { v: a.v, c: a.c } : { v: null, c: '#F6D7B0' })), c: d.c }; render(); },
  async 'av-save'() { const a = S.avDraft; if (!a || !a.v) return; const r = await run('profile.save', { avatar: { t: 'emoji', v: a.v, c: a.c } }, { fresh: true }); if (r.ok) { S.modal = null; S.avDraft = null; render({ keep: false }); } },
  async 'av-clear'() { const r = await run('profile.save', { avatar: null }, { fresh: true }); if (r.ok) { S.modal = null; S.avDraft = null; render({ keep: false }); } },
  async logout() { const tk = S.token; sessionEnded(''); api.call('auth.logout', {}, tk); },
  /* 登录 */
  'login-back'() { Object.assign(S.login, { step: 'email', err: '', ticket: null, accounts: [] }); render({ keep: false }); focusFirst('#app'); },
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
  'rec-student'(el) {
    S.recSid = el.value;
    const s = stuById(el.value), dur = $('#rec-dur');
    if (s && dur) dur.value = s.dur;
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
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el); });
document.addEventListener('input', e => {
  if (e.target.id === 'login-code') {
    const v = e.target.value.replace(/\D/g, '').slice(0, 6); if (v !== e.target.value) e.target.value = v;
    if (v.length === 6 && !S.login.busy) e.target.form.requestSubmit(); // 输满 6 位自动提交
  }
});
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
