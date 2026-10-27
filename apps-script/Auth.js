/**
 * 登录：邮箱 → 6 位验证码 → 令牌。
 *
 * 设计要点（为什么这样做）：
 * - 验证码只存哈希，10 分钟有效、用一次作废、最多试 5 次。
 * - 令牌是 64 位十六进制随机串，表里只存它的哈希；表格被看到也拿不到能用的令牌。
 * - 不告诉外人“这个邮箱有没有注册”：不认识的邮箱同样返回成功，只是不发信
 *   （并故意等一会儿，让响应时间和真的发信差不多）。
 * - 请求次数有上限（每邮箱、全站），防止有人用别人的邮箱刷屏，或者把 Gmail 每日额度刷光。
 * - 每次请求都重新确认账户还在、没被归档，所以老师归档某位学生后，他的登录立刻失效。
 */

/** 这个邮箱能登录成哪些身份。一个邮箱可以同时是老师、家长、学生，登录时选一个。 */
function accountsForEmail_(email) {
  var out = [];
  dbAll_('Admins').forEach(function (a) { if (a.active && normEmail_(a.email) === email) out.push({ role: 'admin', id: normEmail_(a.email) }); });
  dbAll_('Parents').forEach(function (p) { if (p.active && normEmail_(p.email) === email) out.push({ role: 'parent', id: p.id }); });
  dbAll_('Students').forEach(function (s) { if (s.active && s.email && normEmail_(s.email) === email) out.push({ role: 'student', id: s.id }); });
  return out;
}

function accountInfo_(acct) {
  var row;
  if (acct.role === 'admin') row = dbAll_('Admins').filter(function (a) { return normEmail_(a.email) === acct.id; })[0];
  else if (acct.role === 'parent') row = dbAll_('Parents').filter(function (p) { return p.id === acct.id; })[0];
  else row = dbAll_('Students').filter(function (s) { return s.id === acct.id; })[0];
  return { role: acct.role, id: acct.id, name: row ? row.name : '', avatar: row ? row.avatar : null };
}

function pruneAuth_(now) {
  dbDelete_('Codes', function (c) { return ms_(c.created) < now - 3 * 86400000; });
  dbDelete_('Sessions', function (s) { return ms_(s.expires) < now; });
}

/** 第一步：请求验证码。 */
function authRequest_(ctx, p) {
  var email = normEmail_(p.email);
  if (!isEmail_(email)) fail_('bad_email');
  var lang = p.lang === 'en' ? 'en' : 'zh';
  var now = now_();
  pruneAuth_(now);

  var codes = dbAll_('Codes');
  var mine = codes.filter(function (c) { return c.email === email; });
  var hourN = mine.filter(function (c) { return ms_(c.created) > now - 3600000; }).length;
  var dayN = mine.filter(function (c) { return ms_(c.created) > now - 86400000; }).length;
  if (hourN >= CODE_PER_EMAIL_HOUR || dayN >= CODE_PER_EMAIL_DAY) fail_('rate_limited');
  var allHour = codes.filter(function (c) { return ms_(c.created) > now - 3600000; }).length;
  var sentDay = codes.filter(function (c) { return c.sent && ms_(c.created) > now - 86400000; }).length;
  if (allHour >= CODE_GLOBAL_HOUR_REQUESTS || sentDay >= CODE_GLOBAL_DAY) fail_('rate_limited');

  var known = accountsForEmail_(email).length > 0;
  var code = known ? randomCode_() : '';
  var row = dbInsert_('Codes', {
    id: newId_('c'), email: email, known: known, codeHash: known ? hashCode_(email, code) : '',
    created: iso_(now), expires: iso_(now + CODE_TTL_MS), attempts: 0, used: false, sent: false
  });
  if (known) {
    if (!sendMail_(email, mailCode_(code, lang), 'code', '[code]')) fail_('mail_unavailable');
    dbUpdate_('Codes', row, { sent: true });
  } else {
    Utilities.sleep(600 + Math.floor(Math.random() * 500));
  }
  return { sent: true, ttlSeconds: CODE_TTL_MS / 1000 };
}

/** 第二步：提交验证码。只有一个身份就直接登录；有多个就返回临时凭证让用户选。 */
function authVerify_(ctx, p) {
  var email = normEmail_(p.email);
  var code = String(p.code == null ? '' : p.code).trim();
  if (!isEmail_(email) || !/^\d{6}$/.test(code)) fail_('invalid_code');
  var now = now_();
  var rows = dbAll_('Codes').filter(function (c) { return c.email === email && c.known && c.sent; })
    .sort(function (a, b) { return (ms_(b.created) - ms_(a.created)) || (b._row - a._row); }); // 同一毫秒内以后写入的为准
  var cur = rows[0];
  if (!cur || cur.used || ms_(cur.expires) < now || cur.attempts >= CODE_MAX_ATTEMPTS) fail_('invalid_code');
  if (cur.codeHash !== hashCode_(email, code)) {
    dbUpdate_('Codes', cur, { attempts: cur.attempts + 1 });
    fail_('invalid_code');
  }
  dbUpdate_('Codes', cur, { used: true });

  var accts = accountsForEmail_(email);
  if (!accts.length) fail_('invalid_code');
  var remember = bool_(p.remember);
  if (accts.length === 1) return issueSession_(email, accts[0], remember);

  var ticket = randomHex_(32);
  dbInsert_('Sessions', {
    hash: hashToken_(ticket), kind: 'ticket', email: email, role: '', subject: '',
    created: iso_(now), expires: iso_(now + TICKET_TTL_MS), data: { accounts: accts, remember: remember }
  });
  return { ticket: ticket, accounts: accts.map(accountInfo_) };
}


/**
 * 孩子没有邮箱：用“名字 + 老师发的 8 位登录码”登录。
 * 为什么不用“名字 + 生日”：生日是公开信息，同学、亲戚都知道，等于没有密码。
 * - 登录码只存哈希；老师只在生成的那一刻能看到明文，忘了就重新生成（旧码立刻失效，已登录的设备也退出）。
 * - 同一个孩子连续输错 5 次，锁 15 分钟；8 位数字一天最多能试 480 次，猜中的机会可以忽略。
 * - 名字不存在和密码错返回同样的错误，也等一会儿再回，不暴露“有没有这个孩子”。
 */
function authKid_(ctx, p) {
  var name = normName_(p.name), code = String(p.code == null ? '' : p.code).replace(/\s/g, '');
  if (!name || name.length > LIMITS.name || !/^\d{8}$/.test(code)) fail_('invalid_code');
  var now = now_();
  pruneAuth_(now);
  var kid = dbAll_('Students').filter(function (s) { return s.active && s.kind === 'child' && s.codeHash && normName_(s.name) === name; })[0];
  if (!kid) { Utilities.sleep(600 + Math.floor(Math.random() * 500)); fail_('invalid_code'); }
  if (Number(kid.codeLock || 0) > now) fail_('rate_limited');
  if (kid.codeHash !== hashKidCode_(kid.id, code)) {
    var fails = Number(kid.codeFails || 0) + 1;
    if (fails >= KID_MAX_FAILS) dbUpdate_('Students', kid, { codeFails: 0, codeLock: now + KID_LOCK_MS });
    else dbUpdate_('Students', kid, { codeFails: fails });
    fail_('invalid_code');
  }
  if (Number(kid.codeFails || 0)) dbUpdate_('Students', kid, { codeFails: 0 });
  return issueSession_('', { role: 'student', id: kid.id }, bool_(p.remember), { cv: Number(kid.codeVer || 0) });
}

/** 第三步（只有多个身份时）：选一个身份。临时凭证用一次作废。 */
function authChoose_(ctx, p) {
  if (typeof p.ticket !== 'string' || p.ticket.length !== 64) fail_('unauthorized');
  var h = hashToken_(p.ticket), now = now_();
  var t = dbAll_('Sessions').filter(function (s) { return s.hash === h && s.kind === 'ticket'; })[0];
  if (!t || ms_(t.expires) < now) fail_('unauthorized');
  var pick = (t.data && t.data.accounts || []).filter(function (a) { return a.role === p.role && a.id === p.id; })[0];
  dbDelete_('Sessions', function (s) { return s.hash === h; });
  if (!pick) fail_('forbidden');
  return issueSession_(t.email, pick, !!(t.data && t.data.remember));
}

function issueSession_(email, acct, remember, data) {
  var now = now_(), token = randomHex_(32);
  // 同一个身份最多留 10 个登录，超出的删最旧的
  var mine = dbAll_('Sessions').filter(function (s) { return s.kind === 'session' && s.email === email && s.role === acct.role && s.subject === acct.id; })
    .sort(function (a, b) { return ms_(a.created) - ms_(b.created); });
  var excess = mine.length - (MAX_SESSIONS_PER_ACCOUNT - 1);
  if (excess > 0) {
    var drop = {};
    mine.slice(0, excess).forEach(function (s) { drop[s.hash] = true; });
    dbDelete_('Sessions', function (s) { return drop[s.hash]; });
  }
  var expires = now + (remember ? SESSION_REMEMBER_MS : SESSION_SHORT_MS);
  dbInsert_('Sessions', {
    hash: hashToken_(token), kind: 'session', email: email, role: acct.role, subject: acct.id,
    created: iso_(now), expires: iso_(expires), data: data || null
  });
  return { token: token, role: acct.role, id: acct.id, expiresAt: iso_(expires) };
}

/** 令牌 → 当前身份。令牌无效、过期、或账户已归档都算未登录。 */
function ctxFromToken_(token) {
  if (typeof token !== 'string' || token.length !== 64) fail_('unauthorized');
  var h = hashToken_(token);
  var s = dbAll_('Sessions').filter(function (r) { return r.hash === h && r.kind === 'session'; })[0];
  if (!s || ms_(s.expires) < now_()) fail_('unauthorized');
  var ok;
  if (s.email === '' && s.role === 'student') { // 孩子用登录码登录的：学生还在、没归档、登录码没被重置或关闭
    var kid = findStudent_(s.subject);
    ok = !!(kid && kid.active && kid.kind === 'child' && kid.codeHash && s.data && Number(s.data.cv) === Number(kid.codeVer || 0));
  } else {
    ok = accountsForEmail_(s.email).some(function (a) { return a.role === s.role && a.id === s.subject; });
  }
  if (!ok) fail_('unauthorized');
  return { email: s.email, role: s.role, id: s.subject, session: s };
}

function userKey_(ctx) { return ctx.role === 'admin' ? 'admin' : ctx.role + ':' + ctx.id; }

function authLogout_(ctx) {
  var h = ctx.session.hash;
  dbDelete_('Sessions', function (s) { return s.hash === h; });
  return {};
}
