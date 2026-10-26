/**
 * 所有页面的 HTML。每个函数只根据 S（当前状态）返回字符串，不碰网络、不改状态。
 * 规则：任何来自服务器或用户输入的文字，进模板前必须经过 esc()，
 * 或者作为 t() 的变量（t 会自动转义变量）。
 */
import { t, tx, getLang } from './i18n.js';
import { esc, avatar, keyboard, fmtD, fmtDT, fmtYMD, spanSince, ageOf, signed, localInputNow, AVATAR_EMOJI, AVATAR_COLORS } from './util.js';

const lg = () => getLang();
const byId = (arr, id) => arr.find(x => x.id === id);

/* ---------- 选择器 ---------- */
export const role = S => S.data.me.role;
export const unreadNotices = S => S.data.notices.filter(n => n.unread).length;
export const unreadMsgs = S => S.data.messages.filter(m => m.unread).length;
export function curKid(S) { const ks = S.data.students; return ks.find(k => k.id === S.kid) || ks[0] || null; }
export function tabsFor(S) {
  if (role(S) === 'admin') return ['overview', 'students', 'record', 'notices', 'messages', 'points'];
  const base = ['home', 'learning', 'lessons', 'notices', 'messages'];
  if (S.data.students.some(s => s.showPoints)) base.push('points');
  return base;
}
export const defaultTab = S => (role(S) === 'admin' ? 'overview' : 'home');
const pill = (kind, text) => `<span class="pill ${kind}">${text}</span>`;

/* ---------- 登录 ---------- */
export function loginView(S) {
  const A = S.login;
  const head = `<div class="login-h"><div><h1 style="font-size:1.7rem">${t('app.name')}</h1><p class="muted"><span class="work">${t('app.name2')}</span></p></div>${langBtn()}</div>`;
  const err = A.err ? `<p class="err" role="alert">${t(A.err)}</p>` : '';
  let body;
  if (A.step === 'email') {
    body = `<form class="stack" style="gap:12px" data-form="login-email" novalidate>
      <label class="f">${t('login.email')}<input type="email" id="login-email" name="email" value="${esc(A.email)}" placeholder="you@example.com" autocomplete="email" inputmode="email"></label>
      ${err}
      <div class="btns"><button class="btn primary" type="submit" ${A.busy ? 'disabled' : ''}>${t(A.busy ? 'common.sending' : 'login.send')}</button></div>
      <p class="small muted">${t('login.help')}</p></form>`;
  } else if (A.step === 'code') {
    body = `<form class="stack" style="gap:12px" data-form="login-code" novalidate>
      <p>${t('login.sentTo', { email: A.email })}</p>
      <label class="f">${t('login.code')}<input type="text" id="login-code" name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······"></label>
      <label class="check"><input type="checkbox" id="login-remember" name="remember" ${A.remember ? 'checked' : ''}>${t('login.remember')}</label>
      ${err}
      <div class="btns"><button class="btn primary" type="submit" ${A.busy ? 'disabled' : ''}>${t(A.busy ? 'common.checking' : 'login.verify')}</button>
        <button class="btn" type="button" data-act="login-resend" ${A.busy || A.cooldown > 0 ? 'disabled' : ''}>${A.cooldown > 0 ? t('login.resendIn', { n: A.cooldown }) : t('login.resend')}</button>
        <button class="btn link small" type="button" data-act="login-back">${t('login.other')}</button></div>
      <p class="small muted">${t('login.codeHelp')}</p></form>`;
  } else {
    body = `<div class="stack" style="gap:10px"><p>${t('login.pick')}</p>${err}
      ${A.accounts.map((a, i) => `<button class="pick" data-act="login-pick" data-i="${i}">${avatar(a, 36)}<div class="grow"><b>${esc(a.name)}</b><div class="small muted">${t('role.' + a.role)}</div></div></button>`).join('')}
      <div class="btns"><button class="btn link small" data-act="login-back">${t('login.other')}</button></div></div>`;
  }
  return `<div class="login wrap"><div class="card">${head}${body}</div></div>`;
}

export function unconfiguredView() {
  return `<div class="login wrap"><div class="card"><h1>${t('app.name')}</h1><p>${t('boot.unconfigured')}</p></div></div>`;
}

const langBtn = () => `<button class="btn sm lang" data-act="lang" aria-label="${esc(tx('app.switchLang'))}">${lg() === 'zh' ? 'EN' : '中文'}</button>`;

/* ---------- 外壳 ---------- */
export function shell(S, body) {
  const d = S.data, me = d.me, L = lg();
  const studio = d.studio[L] || d.studio.zh || t('app.name');
  const tabs = tabsFor(S);
  const badge = k => {
    const n = k === 'notices' && me.role !== 'admin' ? unreadNotices(S) : k === 'messages' ? unreadMsgs(S) : 0;
    return n ? `<span class="badge" aria-label="${esc(tx('common.unread', { n }))}">${n}</span>` : '';
  };
  const showKids = me.role === 'parent' && d.students.length > 1 && S.tab !== 'home';
  const viewing = showKids ? `<div class="viewing"><span class="muted small">${t('par.viewing')}</span>${d.students.map(k => `<button class="kid-chip" data-act="kid" data-id="${esc(k.id)}" aria-pressed="${k.id === (curKid(S) || {}).id}">${avatar(k, 26)}${esc(k.name)}</button>`).join('')}</div>` : '';
  const env = d.env === 'test' ? `<div class="demo-note" role="note"><div class="wrap">${t('app.testEnv')}</div></div>` : '';
  const nameLine = me.role === 'admin' ? `<b>${t('role.admin')}</b>` : `<b>${esc(me.name)}</b> <span class="muted">${t('role.' + me.role)}</span>`;
  return `<header class="bar"><div class="wrap">
      <div class="brand"><div class="brand-t"><b>${esc(studio)}</b></div></div>
      <div class="who">${nameLine}<button class="avbtn" data-act="av-open" aria-label="${esc(tx('av.change'))}">${avatar(me, 32)}</button>${langBtn()}<button class="btn sm" data-act="logout">${t('app.logout')}</button></div>
    </div>
    <div class="wrap"><nav class="tabs" aria-label="${esc(tx('app.pages'))}">${tabs.map(k => `<button class="tab" data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${t('tab.' + k)}${badge(k)}</button>`).join('')}</nav></div>
  </header>${env}
  <main class="wrap">${viewing ? `<div class="stack">${viewing}<div class="stack">${body}</div></div>` : body}</main>`;
}

/* ---------- 小部件 ---------- */
function pieceList(ps) {
  const pl = st => (st === 'done' ? 'ok' : st === 'new' ? 'wait' : 'plain');
  return `<div class="pieces">${(ps || []).map(p => `<div class="piece"><span class="work">${esc(p.title)}</span><span class="muted small">${esc(p.source)}</span>${pill(pl(p.st), t('piece.' + p.st))}</div>`).join('')}</div>`;
}

function lessonBlock(S, l, { canSign, withStudent } = {}) {
  const n = l.notes || {}, L = lg();
  const sign = l.signState === 'signed' ? pill('ok', '✓ ' + esc(fmtDT(l.signedAt, L)))
    : l.signState === 'auto' ? pill('plain', t('les.auto'))
      : canSign ? `<button class="btn sm primary" data-act="sign" data-id="${esc(l.id)}">${t('les.sign')}</button>` : pill('wait', t('les.waiting'));
  const stu = withStudent ? byId(S.data.students, l.sid) : null;
  const del = role(S) === 'admin' ? `<button class="btn sm" data-act="lesson-del" data-id="${esc(l.id)}">${t('common.delete')}</button>` : '';
  return `<div class="lesson"><div class="no num">${l.n}<small>${esc(fmtD(l.date, L))}</small></div><div>
    ${stu ? `<p><b>${esc(stu.name)}</b> <span class="muted small">· ${t('les.minutes', { n: l.dur })}</span></p>` : ''}
    ${pieceList(n.pieces)}
    <dl class="kv"><dt>${t('les.focus')}</dt><dd>${esc(n.focus)}</dd><dt>${t('les.tempo')}</dt><dd class="work" style="font-style:normal">${esc(n.tempo)}</dd>
    <dt>${t('les.homework')}</dt><dd>${esc(n.homework)}${n.due ? ` <span class="muted small">· ${t('les.due', { d: fmtYMD(n.due, L) })}</span>` : ''}</dd>
    <dt>${t('les.signed')}</dt><dd>${sign}</dd></dl>${del ? `<div class="btns">${del}</div>` : ''}</div></div>`;
}

function bubbles(S, sid) {
  const d = S.data, me = d.me, L = lg();
  const list = d.messages.filter(m => m.sid === sid);
  if (!list.length) return `<p class="muted small">${t('msg.none')}</p>`;
  const mine = m => (me.role === 'admin' ? m.from === 'teacher' : me.role === 'student' ? m.from === 'student' : m.from === 'parent' && m.pid === me.id);
  const who = m => (m.from === 'teacher' ? tx('msg.teacher') : m.from === 'parent' ? tx('msg.parentOf', { name: m.pname || '' }) : (byId(d.students, m.sid) || {}).name || '');
  return `<div class="thread" id="thread">${list.map(m => {
    const fresh = S.fresh.m.has(m.id);
    return `<div class="bub ${mine(m) ? 'me' : ''} ${fresh ? 'fresh' : ''}"><span class="who-l">${esc(who(m))} · ${esc(fmtDT(m.ts, L))}${fresh ? ` · <b>${t('common.new')}</b>` : ''}</span><span style="white-space:pre-wrap">${esc(m.text)}</span></div>`;
  }).join('')}</div>`;
}

function journey(s) {
  const L = lg(), sp = spanSince(s.start), age = s.kind === 'child' ? ageOf(s.birth) : null;
  const spanTxt = sp ? (sp.y ? tx('jr.yearsMonths', { y: sp.y, m: sp.m }) : tx('jr.months', { m: sp.m })) : '';
  return `<dl class="kv2"><dt>${t('jr.started')}</dt><dd>${s.start ? `${esc(fmtYMD(s.start, L))}${spanTxt ? ' · ' + esc(spanTxt) : ''}` : '—'}</dd>
    <dt>${t('jr.lessons')}</dt><dd class="num">${t('jr.lessonsVal', { n: s.total, h: s.hours })}</dd>
    ${age != null ? `<dt>${t('jr.age')}</dt><dd>${t('jr.ageVal', { n: age })}</dd>` : ''}</dl>`;
}

function tuitionCard(S, s) {
  const tu = s.tuition, isParent = role(S) === 'parent';
  const payer = isParent || !s.hasParent;
  let msg;
  if (tu.due) {
    if (payer) msg = `<div class="pay"><div class="grow"><b>${t('tu.dueTitle')}</b><div>${t('tu.dueBody', { name: s.name })}</div></div>${s.claimed ? pill('ok', t('tu.claimed')) : `<button class="btn sm" data-act="claim" data-id="${esc(s.id)}">${t('tu.iPaid')}</button>`}</div>`;
    else msg = `<p class="small">${pill('plain', t('tu.allUsed'))}</p>`;
  } else msg = `<p class="small">${tu.left === 1 ? t('tu.left1') : t('tu.left', { n: tu.left })}</p>`;
  return `<section class="card"><div class="card-h"><h3>${t('tu.title')}</h3><span class="small muted num">${t('tu.used', { n: tu.used })}</span></div>
    ${keyboard(tu.used, tx('tu.kb', { n: tu.used }))}${msg}</section>`;
}

function pointsPeek(S, s) {
  const p = S.data.points[s.id];
  if (!p) return '';
  return `<section class="card"><div class="card-h"><h3>${t('pts.mine')}</h3><button class="btn link small" data-act="tab" data-tab="points">${t('pts.history')}</button></div>
    <div class="big-pts num">${p.total}</div><p class="small muted">${t('pts.available')}</p>
    <div class="rows">${p.entries.slice(0, 4).map(e => `<div class="row"><div class="grow small">${ledgerLabel(e)}</div><span class="pts ${e.pts >= 0 ? 'pos' : 'neg'} num">${signed(e.pts)}</span></div>`).join('')}</div></section>`;
}
const ledgerLabel = e => t('ledger.' + e.key, { n: e.n || '', s: e.streak || '' });

function unreadStrip(S) {
  const nN = unreadNotices(S), nM = unreadMsgs(S);
  if (!nN && !nM) return '';
  return `<section class="card"><div class="btns">${nN ? `<button class="btn" data-act="tab" data-tab="notices">${t('home.newNotices')} <span class="badge">${nN}</span></button>` : ''}${nM ? `<button class="btn" data-act="tab" data-tab="messages">${t('home.newReplies')} <span class="badge">${nM}</span></button>` : ''}</div></section>`;
}

/* ---------- 学生 / 家长：首页 ---------- */
export function homeView(S) {
  const d = S.data, me = d.me, L = lg();
  const greet = `<div class="page-h"><h1>${t('home.hi', { name: me.name })}</h1><span class="muted">${esc(fmtD(new Date(), L))}</span></div>`;
  if (me.role === 'parent') {
    if (!d.students.length) return `<div class="stack">${greet}<section class="card"><p class="muted">${t('par.noKids')}</p></section></div>`;
    return `<div class="stack">${greet}${unreadStrip(S)}${d.students.map(k => {
      const uns = d.lessons.filter(l => l.sid === k.id && l.signState === 'pending');
      const lr = k.learning || { current: [], finished: [] };
      return `<section class="card kidcard"><div class="head">${avatar(k, 48)}<div class="grow"><h2>${esc(k.name)}</h2><p class="small muted">${esc(k.level)}${k.birth ? ` · ${t('jr.ageVal', { n: ageOf(k.birth) })}` : ''}</p></div>
        <button class="btn sm" data-act="kid-go" data-id="${esc(k.id)}" data-tab="lessons">${t('par.lessons')}</button><button class="btn sm" data-act="kid-go" data-id="${esc(k.id)}" data-tab="learning">${t('tab.learning')}</button></div>
        ${uns.length ? `<div class="callout">${t('par.toSign', { n: uns.length })} <button class="btn link small" data-act="kid-go" data-id="${esc(k.id)}" data-tab="lessons">${t('par.signNow')}</button></div>` : ''}
        ${tuitionPayBanner(k)}
        <div class="grid2"><div class="stack" style="gap:8px"><p class="small muted">${t('par.progress')}</p>${keyboard(k.tuition.used, tx('tu.kb', { n: k.tuition.used }))}
          <p class="small num">${t('par.progressVal', { u: k.tuition.used, n: k.total })}</p></div>
          <div class="stack" style="gap:8px"><p class="small muted">${t('par.learning')}</p>
            ${lr.current.slice(0, 4).map(e => `<div class="piece"><span class="work">${esc(e.title)}</span>${pill(e.st === 'new' ? 'wait' : 'plain', t('piece.' + e.st))}</div>`).join('') || '<span class="muted small">—</span>'}
            <p class="small muted">${t('par.finished', { n: lr.finished.length })}</p></div></div>
        ${S.data.points[k.id] ? `<p class="small muted">${t('par.points', { name: k.name, n: S.data.points[k.id].total })}</p>` : ''}</section>`;
    }).join('')}</div>`;
  }
  const s = d.students[0];
  if (!s) return `<div class="stack">${greet}</div>`;
  const uns = d.lessons.filter(l => l.sid === s.id && l.signState === 'pending');
  return `<div class="stack">${greet}${unreadStrip(S)}
    ${uns.length ? `<section class="card"><div class="card-h"><h2>${t('home.signTitle')}</h2>${d.points[s.id] ? pill('wait', t('home.signPts', { n: d.rules.sign })) : ''}</div>${uns.map(l => lessonBlock(S, l, { canSign: true })).join('')}</section>` : ''}
    <div class="grid2">${tuitionCard(S, s)}${d.points[s.id] ? pointsPeek(S, s) : `<section class="card"><div class="card-h"><h3>${t('jr.title')}</h3></div>${journey(s)}</section>`}</div>
    ${d.points[s.id] ? `<section class="card"><div class="card-h"><h3>${t('jr.title')}</h3><button class="btn link small" data-act="tab" data-tab="learning">${t('home.whatLearning')}</button></div>${journey(s)}</section>` : ''}</div>`;
}
function tuitionPayBanner(k) {
  if (!k.tuition.due) return '';
  return `<div class="pay"><div class="grow"><b>${t('tu.dueTitle')}</b><div>${t('tu.dueBody', { name: k.name })}</div></div>${k.claimed ? pill('ok', t('tu.claimed')) : `<button class="btn sm" data-act="claim" data-id="${esc(k.id)}">${t('tu.iPaid')}</button>`}</div>`;
}

/* ---------- 学生 / 家长：正在学习、课程记录、通知、留言、积分 ---------- */
export function learningView(S) {
  const s = curKid(S), L = lg();
  if (!s) return '';
  const lr = s.learning || { current: [], finished: [] }, bk = s.books || [];
  const piece = e => `<div class="prow"><div class="grow"><span class="work">${esc(e.title)}</span> <span class="muted small">${esc(e.source)}</span></div>
    ${e.st === 'done' ? `${pill('ok', t('piece.done'))}<span class="small muted">${t('lrn.finishedOn', { d: fmtD(e.last, L) })}</span>` : `${pill(e.st === 'new' ? 'wait' : 'plain', t('piece.' + e.st))}<span class="small muted">${t('lrn.since', { d: fmtD(e.first, L), n: e.n })}</span>`}</div>`;
  return `<div class="stack"><div class="page-h"><h1>${t('tab.learning')}</h1><span class="muted">${esc(s.name)}</span></div>
    <div class="grid2"><section class="card"><h2>${t('lrn.books')}</h2><div class="chips" style="gap:8px">${bk.filter(b => b.s === 'current').map(b => `<span class="pbook">📘 ${esc(b.n)}</span>`).join('') || `<span class="muted small">${t('lrn.noBooks')}</span>`}</div>
      <h3>${t('lrn.oldBooks')}</h3><div class="chips" style="gap:8px">${bk.filter(b => b.s === 'done').map(b => `<span class="pbook">✓ ${esc(b.n)}</span>`).join('') || '<span class="muted small">—</span>'}</div></section>
      <section class="card"><h3>${t('jr.title')}</h3>${journey(s)}</section></div>
    <section class="card"><div class="card-h"><h2>${t('lrn.current')}</h2><span class="small muted">${lr.current.length}</span></div><div class="plist">${lr.current.map(piece).join('') || '<p class="muted small">—</p>'}</div></section>
    <section class="card"><div class="card-h"><h2>${t('lrn.past')}</h2></div><div class="plist">${lr.finished.map(piece).join('') || `<p class="muted small">${t('lrn.nonePast')}</p>`}</div></section>
    <p class="small muted">${t('lrn.note')}</p></div>`;
}

export function lessonsView(S) {
  const s = curKid(S);
  if (!s) return '';
  const ls = S.data.lessons.filter(l => l.sid === s.id);
  return `<div class="stack"><div class="page-h"><h1>${t('tab.lessons')}</h1><span class="muted">${esc(s.name)} · ${t('les.count', { n: ls.length })}</span></div>
    ${ls.map(l => `<section class="card">${lessonBlock(S, l, { canSign: l.signState === 'pending' })}</section>`).join('') || `<section class="card"><p class="muted">${t('les.none')}</p></section>`}</div>`;
}

export function noticesView(S) {
  const d = S.data, L = lg();
  if (role(S) === 'admin') return adminNotices(S);
  const par = role(S) === 'parent';
  return `<div class="stack"><div class="page-h"><h1>${t('tab.notices')}</h1><span class="muted">${t('nt.fromTeacher')}</span></div>
    ${d.notices.map(n => `<section class="card notice"><div class="notice-h"><h3>${esc(n.title)}</h3>${S.fresh.n.has(n.id) ? pill('bad', t('common.new')) : ''}<span class="small muted">${esc(fmtDT(n.ts, L))}</span></div>
      ${par && n.scope === 'student' ? `<span class="small">${pill('plain', t('nt.for', { name: (byId(d.students, n.sid) || {}).name || '' }))}</span>` : ''}
      <p style="white-space:pre-wrap">${esc(n.body)}</p></section>`).join('') || `<section class="card"><p class="muted">${t('nt.none')}</p></section>`}</div>`;
}

export function messagesView(S) {
  if (role(S) === 'admin') return adminMessages(S);
  const s = curKid(S);
  if (!s) return '';
  const canWrite = role(S) === 'student' || s.kind === 'child';
  return `<div class="stack"><div class="page-h"><h1>${t('msg.title')}</h1><span class="muted">${esc(s.name)}</span></div>
    <section class="card">${bubbles(S, s.id)}
      ${canWrite ? `<form class="stack" style="gap:8px" data-form="msg-send" data-sid="${esc(s.id)}"><label class="f">${t('msg.write')}<textarea id="umsg-text" name="text" style="min-height:64px" maxlength="2000" placeholder="${esc(tx('msg.placeholder'))}"></textarea></label><div class="btns"><button class="btn primary" type="submit">${t('common.send')}</button></div></form>` : ''}
      <p class="small muted">${t('msg.userNote')}</p></section></div>`;
}

export function pointsView(S) {
  if (role(S) === 'admin') return adminPoints(S);
  const s = curKid(S);
  if (!s) return '';
  const p = S.data.points[s.id];
  return `<div class="stack"><div class="page-h"><h1>${t('tab.points')}</h1><span class="muted">${esc(s.name)}</span></div>
    ${p ? `<section class="card"><div class="big-pts num">${p.total}</div><p class="small muted">${t('pts.available')}</p></section>
    <section class="card"><h3>${t('pts.log')}</h3><div class="rows">${p.entries.map(e => `<div class="row"><div class="grow"><div>${ledgerLabel(e)}</div><div class="small muted">${esc(fmtDT(e.t, lg()))}</div></div><span class="pts ${e.pts >= 0 ? 'pos' : 'neg'} num">${signed(e.pts)}</span></div>`).join('') || `<p class="muted small">${t('pts.none')}</p>`}</div></section>
    <section class="card"><h3>${t('pts.how')}</h3><p class="small">${t('pts.howSign', { n: S.data.rules.sign })}</p></section>`
      : `<section class="card"><p class="muted">${t('pts.off')}</p></section>`}</div>`;
}

/* ---------- 老师：总览 ---------- */
export function overviewView(S) {
  const d = S.data, L = lg();
  const active = d.students.filter(s => s.active);
  const due = active.filter(s => s.tuition.due);
  const pending = d.lessons.filter(l => l.signState === 'pending' && (byId(d.students, l.sid) || {}).active);
  const ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0);
  const month = d.lessons.filter(l => l.status === 'done' && new Date(l.date) >= ms).length;
  const unreadBy = {};
  d.messages.filter(m => m.unread).forEach(m => { unreadBy[m.sid] = (unreadBy[m.sid] || 0) + 1; });
  const rows = [];
  due.forEach(s => rows.push(`<div class="row">${avatar(s, 34)}<div class="grow"><b>${esc(s.name)}</b><div class="small muted">${t('ov.dueRow')}</div></div>
    ${s.claimed ? pill('ok', t('ov.claimed')) : ''}<button class="btn sm" data-act="remind" data-id="${esc(s.id)}">${t('ov.remind')}</button><button class="btn sm primary" data-act="paid" data-id="${esc(s.id)}">${t('ov.paid')}</button></div>`));
  Object.keys(unreadBy).forEach(sid => {
    const s = byId(d.students, sid); if (!s) return;
    rows.push(`<div class="row">${avatar(s, 34)}<div class="grow"><b>${esc(s.name)}</b><div class="small muted">${t('ov.unreadMsgs', { n: unreadBy[sid] })}</div></div><button class="btn sm primary" data-act="goto-msg" data-id="${esc(sid)}">${t('ov.reply')}</button></div>`);
  });
  pending.slice().sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt)).slice(0, 6).forEach(l => {
    const s = byId(d.students, l.sid);
    rows.push(`<div class="row">${avatar(s, 34)}<div class="grow"><b>${esc(s.name)}</b><div class="small muted">${t('ov.pendingSign', { n: l.n, d: fmtD(l.date, L) })}</div></div>${pill('wait', t('les.waiting'))}</div>`);
  });
  return `<div class="stack"><div class="page-h"><h1>${t('tab.overview')}</h1><span class="muted">${esc(fmtD(new Date(), L))}</span></div>
    <div class="stats"><div class="stat"><b>${active.length}</b><span>${t('ov.students')}</span></div><div class="stat"><b>${month}</b><span>${t('ov.month')}</span></div>
      <div class="stat"><b>${pending.length}</b><span>${t('ov.pending')}</span></div><div class="stat ${due.length ? 'flag' : ''}"><b>${due.length}</b><span>${t('ov.due')}</span></div></div>
    <section class="card"><div class="card-h"><h2>${t('ov.todo')}</h2><button class="btn primary sm" data-act="tab" data-tab="record">${t('ov.logLesson')}</button></div>
      <div class="rows">${rows.join('') || `<p class="muted">${t('ov.allClear')}</p>`}</div></section></div>`;
}

/* ---------- 老师：学生与家长 ---------- */
export function studentsView(S) {
  const d = S.data;
  const showArch = S.showArchived;
  const list = d.students.filter(s => showArch || s.active);
  const parents = d.parents.filter(p => showArch || p.active);
  const kidName = id => (byId(d.students, id) || {}).name || '';
  return `<div class="stack"><div class="page-h"><h1>${t('tab.students')}</h1><div class="btns"><button class="chip" data-act="toggle-archived" aria-pressed="${!!showArch}">${t('stu.showArchived')}</button><button class="btn primary sm" data-act="student-new">${t('stu.add')}</button></div></div>
    <section class="card"><div class="rows">${list.map(s => `<div class="row">${avatar(s, 38)}<div class="grow"><b>${esc(s.name)}</b> ${s.kind === 'adult' ? pill('plain', t('stu.adult')) : ''}${s.active ? '' : pill('bad', t('stu.archived'))}
        <div class="small muted">${esc(s.level)}${s.email ? ` · ${esc(s.email)}` : ''}</div></div>
        <div class="small num">${t('stu.tuitionRow', { u: s.tuition.used, l: Math.max(0, s.tuition.left) })}${s.tuition.due ? ' ' + pill('bad', t('stu.due')) : ''}</div>
        <button class="btn sm" data-act="student-edit" data-id="${esc(s.id)}">${t('common.edit')}</button></div>`).join('') || `<p class="muted">${t('stu.none')}</p>`}</div></section>
    <div class="page-h"><h2>${t('par.title')}</h2><button class="btn sm" data-act="parent-new">${t('par.add')}</button></div>
    <section class="card"><div class="rows">${parents.map(p => `<div class="row">${avatar(p, 34)}<div class="grow"><b>${esc(p.name)}</b>${p.active ? '' : ' ' + pill('bad', t('stu.archived'))}<div class="small muted">${esc(p.email)}</div></div>
        <div class="chips">${p.kids.map(k => `<span class="pill plain">${esc(kidName(k))}</span>`).join('')}</div><button class="btn sm" data-act="parent-edit" data-id="${esc(p.id)}">${t('common.edit')}</button></div>`).join('') || `<p class="muted">${t('par.none')}</p>`}</div></section></div>`;
}

const val = v => esc(v == null ? '' : v);
export function studentModal(S) {
  const d = S.data, id = S.modal.id, s = id ? byId(d.students, id) : null;
  const v = s || { name: '', email: '', kind: 'child', lang: 'zh', birth: '', start: '', level: '', grp: '', dur: 30, paid: 0, carry: 0, adj: 0, showPoints: true, books: [], active: true };
  const sel = (name, cur, opts) => `<select name="${name}">${opts.map(([k, lab]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${lab}</option>`).join('')}</select>`;
  const parents = d.parents.filter(p => p.active);
  const pairs = s && s.kind === 'child' ? `<div class="f full"><b>${t('stu.parents')}</b>
      <div class="picklist">${parents.map(p => `<label><input type="checkbox" data-change="pair" data-pid="${esc(p.id)}" data-sid="${esc(s.id)}" ${p.kids.includes(s.id) ? 'checked' : ''}>${esc(p.name)} <span class="muted small">${esc(p.email)}</span></label>`).join('') || `<span class="muted small">${t('par.none')}</span>`}</div>
      <p class="small muted">${t('stu.parentsHelp')}</p></div>` : '';
  const books = s ? `<div class="f full"><b>${t('stu.books')}</b><textarea id="books-text" style="min-height:80px" placeholder="Thompson 3 | current">${esc((s.books || []).map(b => `${b.n} | ${b.s}`).join('\n'))}</textarea>
      <div class="btns"><button class="btn sm" type="button" data-act="books-save" data-id="${esc(s.id)}">${t('stu.booksSave')}</button><span class="small muted">${t('stu.booksHelp')}</span></div></div>` : '';
  return `<div class="card-h"><h2>${t(s ? 'stu.edit' : 'stu.add')}</h2><button class="btn sm" data-act="close">${t('common.close')}</button></div>
    <form class="stack" data-form="student-save" ${s ? `data-id="${esc(s.id)}"` : ''}>
      <div class="form">
        <label class="f">${t('stu.name')}<input type="text" name="name" value="${val(v.name)}" maxlength="80" required></label>
        <label class="f">${t('stu.email')}<input type="email" name="email" value="${val(v.email)}" placeholder="${esc(tx('stu.emailPh'))}"></label>
        <label class="f">${t('stu.kind')}${sel('kind', v.kind, [['child', tx('stu.child')], ['adult', tx('stu.adult')]])}</label>
        <label class="f">${t('stu.lang')}${sel('lang', v.lang, [['zh', '中文'], ['en', 'English']])}</label>
        <label class="f">${t('stu.birth')}<input type="date" name="birth" value="${val(v.birth)}"></label>
        <label class="f">${t('stu.start')}<input type="date" name="start" value="${val(v.start)}"></label>
        <label class="f full">${t('stu.level')}<input type="text" name="level" value="${val(v.level)}" maxlength="80"></label>
        <label class="f">${t('stu.dur')}<input type="number" name="dur" value="${val(v.dur)}" min="10" max="180" step="5"></label>
        <label class="f">${t('stu.paid')}<input type="number" name="paid" value="${val(v.paid)}" min="0" max="500"></label>
        <label class="f">${t('stu.carry')}<input type="number" name="carry" value="${val(v.carry)}" min="0" max="5000"></label>
        <label class="f">${t('stu.adj')}<input type="number" name="adj" value="${val(v.adj)}" min="-2000" max="2000"></label>
        <label class="check full"><input type="checkbox" name="showPoints" ${v.showPoints ? 'checked' : ''}>${t('stu.showPoints')}</label>
        <input type="hidden" name="grp" value="${val(v.grp)}">
      </div>
      <p class="small muted">${t('stu.tuitionHelp')}</p>
      <div class="btns"><button class="btn primary" type="submit">${t('common.save')}</button>
        ${s ? `<button class="btn" type="button" data-act="archive" data-id="${esc(s.id)}" data-to="${s.active ? 'false' : 'true'}">${t(s.active ? 'stu.archive' : 'stu.restore')}</button>` : ''}</div>
    </form>${pairs}${books}`;
}

export function parentModal(S) {
  const d = S.data, id = S.modal.id, p = id ? byId(d.parents, id) : null;
  const v = p || { name: '', email: '', lang: 'zh', kids: [], active: true };
  const kids = d.students.filter(s => s.active && s.kind === 'child');
  return `<div class="card-h"><h2>${t(p ? 'par.edit' : 'par.add')}</h2><button class="btn sm" data-act="close">${t('common.close')}</button></div>
    <form class="stack" data-form="parent-save" ${p ? `data-id="${esc(p.id)}"` : ''}><div class="form">
      <label class="f">${t('stu.name')}<input type="text" name="name" value="${val(v.name)}" maxlength="80" required></label>
      <label class="f">${t('stu.email')}<input type="email" name="email" value="${val(v.email)}" required></label>
      <label class="f">${t('stu.lang')}<select name="lang"><option value="zh" ${v.lang === 'zh' ? 'selected' : ''}>中文</option><option value="en" ${v.lang === 'en' ? 'selected' : ''}>English</option></select></label></div>
      <div class="btns"><button class="btn primary" type="submit">${t('common.save')}</button>${p ? `<button class="btn" type="button" data-act="parent-archive" data-id="${esc(p.id)}" data-to="${p.active ? 'false' : 'true'}">${t(p.active ? 'stu.archive' : 'stu.restore')}</button>` : ''}</div></form>
    ${p ? `<div class="f full"><b>${t('par.kids')}</b><div class="picklist">${kids.map(k => `<label><input type="checkbox" data-change="pair" data-pid="${esc(p.id)}" data-sid="${esc(k.id)}" ${p.kids.includes(k.id) ? 'checked' : ''}>${esc(k.name)}</label>`).join('') || `<span class="muted small">${t('stu.none')}</span>`}</div></div>` : `<p class="small muted">${t('par.saveFirst')}</p>`}`;
}

export function confirmModal(S) {
  const m = S.modal;
  return `<div class="card-h"><h2>${t(m.title)}</h2></div><p>${t(m.body, m.vars)}</p>
    <div class="btns"><button class="btn primary" data-act="confirm-yes" ${S.busy ? 'disabled' : ''}>${t(m.yes || 'common.confirm')}</button><button class="btn" data-act="close">${t('common.cancel')}</button></div>`;
}

export function remindModal(S) {
  const d = S.data, s = byId(d.students, S.modal.id);
  const to = s.hasParent ? d.parents.filter(p => p.active && p.kids.includes(s.id)).map(p => p.email) : (s.email ? [s.email] : []);
  return `<div class="card-h"><h2>${t('rem.title')}</h2><button class="btn sm" data-act="close">${t('common.close')}</button></div>
    <p><b>${esc(s.name)}</b> · ${t('rem.to')} ${to.length ? to.map(esc).join(', ') : `<span class="err">${t('rem.nobody')}</span>`}</p>
    <form class="stack" data-form="remind" data-id="${esc(s.id)}"><label class="f">${t('rem.note')}<textarea name="note" id="rem-note" maxlength="500" placeholder="${esc(tx('rem.notePh'))}"></textarea></label>
      <div class="btns"><button class="btn primary" type="submit" ${to.length ? '' : 'disabled'}>${t('rem.send')}</button></div></form>`;
}

export function avatarModal(S) {
  const me = S.data.me, a = me.avatar || {};
  const draft = S.avDraft || (a.t === 'emoji' ? { v: a.v, c: a.c } : { v: null, c: AVATAR_COLORS[0] });
  const preview = draft.v ? { name: me.name, avatar: { t: 'emoji', v: draft.v, c: draft.c } } : { name: me.name, avatar: null };
  return `<div class="card-h"><h2>${t('av.title')}</h2><button class="btn sm" data-act="close">${t('common.close')}</button></div>
    <div style="display:flex;gap:14px;align-items:center">${avatar(preview, 64)}<span class="small muted">${t('av.help')}</span></div>
    <div class="av-grid">${AVATAR_EMOJI.map(v => `<button class="av-opt" data-act="av-pick" data-v="${v}" aria-pressed="${draft.v === v}" aria-label="${v}">${v}</button>`).join('')}</div>
    <div class="opt-row"><span>${t('av.color')}</span><div class="chips">${AVATAR_COLORS.map(c => `<button class="sw" style="background:${c}" data-act="av-col" data-c="${c}" aria-pressed="${draft.c === c}" aria-label="${c}"></button>`).join('')}</div></div>
    <div class="btns"><button class="btn primary" data-act="av-save" ${draft.v ? '' : 'disabled'}>${t('common.save')}</button>${me.avatar ? `<button class="btn" data-act="av-clear">${t('av.clear')}</button>` : ''}</div>`;
}

/* ---------- 老师：记课 ---------- */
export function recordView(S) {
  const d = S.data, L = lg();
  const act = d.students.filter(s => s.active);
  const pick = S.recSid && byId(act, S.recSid) ? S.recSid : (act[0] || {}).id;
  const cur = byId(act, pick) || { dur: 30 };
  const recent = d.lessons.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  return `<div class="stack"><div class="page-h"><h1>${t('rec.title')}</h1><span class="muted">${t('rec.sub')}</span></div>
  <div class="grid2">
  <form class="card" data-form="rec-save"><div class="form">
    <label class="f">${t('rec.student')}<select id="rec-student" name="sid" data-change="rec-student">${act.map(s => `<option value="${esc(s.id)}" ${s.id === pick ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="f">${t('rec.time')}<input type="datetime-local" id="rec-date" name="date" value="${esc(localInputNow())}"></label>
    <label class="f">${t('rec.dur')}<input type="number" id="rec-dur" name="dur" value="${esc(cur.dur)}" min="10" max="180" step="5"></label>
    <label class="f">${t('rec.due')}<input type="date" id="rec-due" name="due"></label>
    <label class="f full">${t('rec.pieces')}<textarea id="rec-pieces" name="pieces" placeholder="${esc(tx('rec.piecesPh'))}"></textarea></label>
    <label class="f full">${t('rec.focus')}<input type="text" id="rec-focus" name="focus" maxlength="300"></label>
    <label class="f">${t('rec.tempo')}<input type="text" id="rec-tempo" name="tempo" maxlength="60" placeholder="♩ = 80"></label>
    <label class="f full">${t('rec.homework')}<input type="text" id="rec-hw" name="homework" maxlength="400"></label>
  </div><div class="btns"><button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>${t('rec.save')}</button></div>
  <p class="small muted">${t('rec.langNote')}</p></form>
  <section class="card"><h3>${t('rec.afterTitle')}</h3><div class="steps">
    <div class="step"><div><b>${t('rec.s1')}</b><span class="small muted">${t('rec.s1b')}</span></div></div>
    <div class="step"><div><b>${t('rec.s2')}</b><span class="small muted">${t('rec.s2b', { n: d.rules.sign })}</span></div></div>
    <div class="step"><div><b>${t('rec.s3')}</b><span class="small muted">${t('rec.s3b')}</span></div></div></div></section></div>
  <section class="card"><h3>${t('rec.recent')}</h3>${recent.map(l => lessonBlock(S, l, { withStudent: true })).join('') || `<p class="muted small">${t('les.none')}</p>`}</section></div>`;
}

/* ---------- 老师：通知、留言、积分规则 ---------- */
function adminNotices(S) {
  const d = S.data, L = lg();
  const aud = { both: tx('nt.audBoth'), student: tx('nt.audStudent'), parent: tx('nt.audParent') };
  return `<div class="stack"><div class="page-h"><h1>${t('tab.notices')}</h1><span class="muted">${t('nt.adminSub')}</span></div>
  <div class="grid2"><form class="card" data-form="notice-send"><h3>${t('nt.send')}</h3><div class="form">
    <label class="f">${t('nt.to')}<select id="nt-to" name="to"><option value="all">${t('nt.all')}</option>${d.students.filter(s => s.active).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
    <label class="f">${t('nt.aud')}<select id="nt-aud" name="aud">${Object.entries(aud).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
    <label class="f full">${t('nt.title')}<input type="text" id="nt-title" name="title" maxlength="120"></label>
    <label class="f full">${t('nt.body')}<textarea id="nt-body" name="body" maxlength="2000"></textarea></label></div>
    <div class="btns"><button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>${t('common.send')}</button></div><p class="small muted">${t('nt.help')}</p></form>
  <section class="card"><h3>${t('nt.sent')}</h3><div class="rows">${d.notices.map(n => `<div class="row"><div class="grow"><b>${esc(n.title)}</b>
    <div class="small muted">${esc(fmtDT(n.ts, L))} · ${n.scope === 'all' ? t('nt.everyone') : esc((byId(d.students, n.sid) || {}).name || '')} · ${esc(aud[n.aud] || '')}</div><div class="small" style="white-space:pre-wrap">${esc(n.body)}</div></div></div>`).join('') || `<p class="muted small">${t('nt.none')}</p>`}</div></section></div></div>`;
}

function msgOrder(S) {
  const d = S.data, stus = d.students.filter(s => s.active);
  const unread = id => d.messages.filter(m => m.sid === id && m.unread).length;
  const last = id => d.messages.filter(m => m.sid === id).slice(-1)[0];
  return stus.slice().sort((a, b) => (unread(b.id) > 0) - (unread(a.id) > 0) || (new Date((last(b.id) || {}).ts || 0) - new Date((last(a.id) || {}).ts || 0)));
}
/** 当前正在看哪位学生的留言线程（老师可选；学生 / 家长是当前孩子）。 */
export function msgSelFor(S) {
  if (role(S) !== 'admin') return (curKid(S) || {}).id;
  const order = msgOrder(S);
  return S.msgSel && byId(order, S.msgSel) ? S.msgSel : (order[0] || {}).id;
}
function adminMessages(S) {
  const d = S.data;
  const stus = d.students.filter(s => s.active);
  const unread = id => d.messages.filter(m => m.sid === id && m.unread).length;
  const last = id => d.messages.filter(m => m.sid === id).slice(-1)[0];
  const order = msgOrder(S);
  const sel = msgSelFor(S);
  const s = byId(stus, sel);
  if (!s) return `<div class="stack"><div class="page-h"><h1>${t('tab.messages')}</h1></div><section class="card"><p class="muted">${t('stu.none')}</p></section></div>`;
  return `<div class="stack"><div class="page-h"><h1>${t('tab.messages')}</h1><span class="muted">${t('msg.adminSub')}</span></div>
  <div class="grid-side"><section class="card" style="padding:8px">${order.map(x => { const u = unread(x.id), l = last(x.id); return `<button class="pick" style="border:0;background:${x.id === sel ? 'var(--surface-2)' : 'transparent'}" data-act="sel-msg" data-id="${esc(x.id)}">${avatar(x)}<div class="grow"><b>${esc(x.name)}</b><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l ? esc(l.text) : t('msg.none')}</div></div>${u ? `<span class="badge">${u}</span>` : ''}</button>`; }).join('')}</section>
    <section class="card"><div class="card-h"><h2>${esc(s.name)}</h2><span class="small muted">${s.kind === 'child' ? t('msg.parentsSee') : t('msg.privateAdult')}</span></div>
      ${bubbles(S, sel)}
      <form class="stack" style="gap:8px" data-form="msg-send" data-sid="${esc(sel)}"><label class="f">${t('msg.reply')}<textarea id="msg-text" name="text" style="min-height:64px" maxlength="2000"></textarea></label><div class="btns"><button class="btn primary" type="submit">${t('msg.sendReply')}</button></div></form></section></div></div>`;
}

export const RULE_NOW = ['sign'];
export const RULE_LATER = ['confirm', 'ontime', 'late', 'missing', 'noshow', 'streakN', 'streakBonus', 'grace'];
function adminPoints(S) {
  const d = S.data, r = d.rules;
  const row = k => `<div class="rule"><div><b>${t('rule.' + k)}</b><div class="small muted">${t('rule.' + k + 'H')}</div></div><input type="number" name="${k}" value="${esc(r[k])}" style="width:84px" step="1"></div>`;
  return `<div class="stack"><div class="page-h"><h1>${t('tab.points')}</h1><span class="muted">${t('pts.adminSub')}</span></div>
  <div class="grid2"><form class="card" data-form="rules-save"><h3>${t('pts.rules')}</h3>${RULE_NOW.map(row).join('')}
    <p class="small muted" style="margin-top:6px">${t('pts.later')}</p>${RULE_LATER.map(row).join('')}
    <div class="btns"><button class="btn primary" type="submit" ${S.busy ? 'disabled' : ''}>${t('common.save')}</button></div></form>
  <section class="card"><h3>${t('pts.students')}</h3><div class="rows">${d.students.filter(s => s.active).map(s => { const p = d.points[s.id]; return `<div class="row">${avatar(s, 30)}<div class="grow">${esc(s.name)}</div>${p ? `<b class="num">${p.total}</b>` : pill('plain', t('pts.offShort'))}</div>`; }).join('')}</div>
    <p class="small muted">${t('pts.switchHelp')}</p></section></div></div>`;
}

export const VIEWS = {
  overview: overviewView, students: studentsView, record: recordView, notices: noticesView, messages: messagesView, points: pointsView,
  home: homeView, learning: learningView, lessons: lessonsView
};
export const MODALS = { student: studentModal, parent: parentModal, confirm: confirmModal, remind: remindModal, avatar: avatarModal };
