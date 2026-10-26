/**
 * 各个操作（action）的处理函数。每个函数收到 (ctx, p)：
 *   ctx = 当前登录的身份 {role, id, email}；p = 网页传来的参数。
 * 凡是传进来的东西一律先校验再用，凡是读写学生数据的先检查这个人有没有权限。
 */

/* ---------- 权限 ---------- */

function findStudent_(id) {
  return dbAll_('Students').filter(function (s) { return s.id === id; })[0];
}
function isPaired_(parentId, studentId) {
  return dbAll_('Pairs').some(function (p) { return p.parentId === parentId && p.studentId === studentId; });
}
function canAccessStudent_(ctx, s) {
  if (ctx.role === 'admin') return true;
  if (!s || !s.active) return false;
  if (ctx.role === 'student') return ctx.id === s.id;
  if (ctx.role === 'parent') return isPaired_(ctx.id, s.id);
  return false;
}
/** 取学生；没有权限一律报 forbidden（不区分“不存在”和“不是你的”，避免被用来探测）。 */
function accessStudent_(ctx, id) {
  var s = findStudent_(String(id == null ? '' : id));
  if (!s) fail_(ctx.role === 'admin' ? 'not_found' : 'forbidden');
  if (!canAccessStudent_(ctx, s)) fail_('forbidden');
  return s;
}
function activeAdminEmails_() {
  return dbAll_('Admins').filter(function (a) { return a.active; }).map(function (a) { return normEmail_(a.email); });
}
function pairedParents_(studentId) {
  var parents = dbAll_('Parents');
  return dbAll_('Pairs').filter(function (p) { return p.studentId === studentId; })
    .map(function (p) { return parents.filter(function (x) { return x.id === p.parentId && x.active; })[0]; })
    .filter(Boolean);
}

/* ---------- 个人资料 ---------- */

function cleanAvatar_(a) {
  if (a == null) return null;
  if (a.t !== 'emoji' || AVATAR_EMOJI.indexOf(a.v) < 0 || AVATAR_COLORS.indexOf(a.c) < 0) fail_('bad_request', 'avatar');
  return { t: 'emoji', v: a.v, c: a.c };
}

function hProfileSave_(ctx, p) {
  var avatar = cleanAvatar_(p.avatar);
  var row;
  if (ctx.role === 'admin') {
    row = dbAll_('Admins').filter(function (a) { return normEmail_(a.email) === ctx.id; })[0];
    dbUpdate_('Admins', row, { avatar: avatar });
  } else if (ctx.role === 'parent') {
    row = dbAll_('Parents').filter(function (x) { return x.id === ctx.id; })[0];
    dbUpdate_('Parents', row, { avatar: avatar });
  } else {
    dbUpdate_('Students', findStudent_(ctx.id), { avatar: avatar });
  }
  return {};
}

/* ---------- 老师：学生与家长 ---------- */

function hStudentSave_(ctx, p) {
  var r = p.student || {};
  var name = str_(r.name, LIMITS.name, { required: true, label: 'name' });
  var email = normEmail_(r.email);
  if (email && !isEmail_(email)) fail_('bad_email');
  var kind = oneOf_(r.kind || 'child', ['child', 'adult'], 'kind');
  var lang = oneOf_(r.lang || 'zh', ['zh', 'en'], 'lang');
  var fields = {
    name: name, email: email, kind: kind, lang: lang,
    birth: dateOnly_(r.birth, 'birth'), start: dateOnly_(r.start, 'start'),
    adj: int_(r.adj == null || r.adj === '' ? 0 : r.adj, -2000, 2000, 'adj'),
    level: str_(r.level, LIMITS.level), grp: str_(r.grp, LIMITS.grp),
    dur: int_(r.dur == null || r.dur === '' ? 30 : r.dur, 10, 180, 'dur'),
    paid: int_(r.paid == null || r.paid === '' ? 0 : r.paid, 0, 500, 'paid'),
    carry: int_(r.carry == null || r.carry === '' ? 0 : r.carry, 0, 5000, 'carry'),
    showPoints: r.showPoints == null ? kind === 'child' : bool_(r.showPoints)
  };
  var all = dbAll_('Students');
  if (email && all.some(function (s) { return s.id !== r.id && s.email && normEmail_(s.email) === email; })) fail_('email_taken');
  if (kind === 'adult' && r.id && dbAll_('Pairs').some(function (x) { return x.studentId === r.id; })) fail_('adult_has_parent');

  if (r.id) {
    var row = findStudent_(String(r.id));
    if (!row) fail_('not_found');
    dbUpdate_('Students', row, fields);
    return { id: row.id };
  }
  var rec = fields;
  rec.id = newId_('s'); rec.claimed = false; rec.avatar = null; rec.books = []; rec.active = true; rec.created = iso_(now_());
  dbInsert_('Students', rec);
  return { id: rec.id };
}

function hStudentArchive_(ctx, p) {
  var s = findStudent_(String(p.id || ''));
  if (!s) fail_('not_found');
  dbUpdate_('Students', s, { active: bool_(p.active) });
  return {};
}

function hParentSave_(ctx, p) {
  var r = p.parent || {};
  var name = str_(r.name, LIMITS.name, { required: true, label: 'name' });
  var email = normEmail_(r.email);
  if (!isEmail_(email)) fail_('bad_email');
  var lang = oneOf_(r.lang || 'zh', ['zh', 'en'], 'lang');
  var all = dbAll_('Parents');
  if (all.some(function (x) { return x.id !== r.id && normEmail_(x.email) === email; })) fail_('email_taken');
  if (r.id) {
    var row = all.filter(function (x) { return x.id === r.id; })[0];
    if (!row) fail_('not_found');
    dbUpdate_('Parents', row, { name: name, email: email, lang: lang });
    return { id: row.id };
  }
  var id = newId_('p');
  dbInsert_('Parents', { id: id, name: name, email: email, lang: lang, avatar: null, active: true, created: iso_(now_()) });
  return { id: id };
}

function hParentArchive_(ctx, p) {
  var row = dbAll_('Parents').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!row) fail_('not_found');
  dbUpdate_('Parents', row, { active: bool_(p.active) });
  return {};
}

function hPairSet_(ctx, p) {
  var parent = dbAll_('Parents').filter(function (x) { return x.id === String(p.pid || ''); })[0];
  var s = findStudent_(String(p.sid || ''));
  if (!parent || !s) fail_('not_found');
  var on = bool_(p.on);
  if (on) {
    if (s.kind !== 'child') fail_('adult_has_parent');
    if (!isPaired_(parent.id, s.id)) dbInsert_('Pairs', { parentId: parent.id, studentId: s.id });
  } else {
    dbDelete_('Pairs', function (x) { return x.parentId === parent.id && x.studentId === s.id; });
  }
  return {};
}

function hBooksSave_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s) fail_('not_found');
  if (!Array.isArray(p.books) || p.books.length > 40) fail_('bad_request', 'books');
  var books = p.books.map(function (b) {
    return { n: str_(b.n, LIMITS.book, { required: true, label: 'book' }), s: oneOf_(b.s, ['current', 'done'], 'book status') };
  });
  dbUpdate_('Students', s, { books: books });
  return {};
}

/* ---------- 老师：记课、签字 ---------- */

function hLessonLog_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s || !s.active) fail_('not_found');
  var dateMs = Date.parse(p.date);
  var now = now_();
  if (!isFinite(dateMs) || dateMs > now + 86400000 || dateMs < now - 3 * 365 * 86400000) fail_('bad_request', 'date');
  var dur = int_(p.dur == null || p.dur === '' ? s.dur : p.dur, 10, 180, 'dur');
  if (!Array.isArray(p.pieces) || p.pieces.length < 1 || p.pieces.length > 12) fail_('bad_request', 'pieces');
  var pieces = p.pieces.map(function (x) {
    return { title: str_(x.title, LIMITS.piece, { required: true, label: 'piece' }), source: str_(x.source, LIMITS.piece),
      st: oneOf_(x.st || 'new', ['new', 'review', 'done'], 'piece status') };
  });
  var notes = { pieces: pieces, focus: str_(p.focus, LIMITS.focus), tempo: str_(p.tempo, LIMITS.tempo),
    homework: str_(p.homework, LIMITS.homework), due: dateOnly_(p.due, 'due') };
  var dup = dbAll_('Lessons').some(function (l) { return l.sid === s.id && Math.abs(ms_(l.date) - dateMs) < 60000; });
  if (dup) fail_('duplicate');

  var id = newId_('l');
  dbInsert_('Lessons', { id: id, sid: s.id, date: iso_(dateMs), dur: dur, status: 'done', confirmedAt: '', signedAt: '',
    signedBy: '', loggedAt: iso_(now), notes: notes });

  if (getConfigMap_()['mail.lessonSign'] === 'true') {
    var dateText = Utilities.formatDate(new Date(dateMs), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var parents = pairedParents_(s.id);
    if (parents.length) parents.forEach(function (pr) { sendMail_(pr.email, mailLessonSign_(s.name, dateText, pr.lang), 'lesson'); });
    else if (s.email) sendMail_(s.email, mailLessonSign_(s.name, dateText, s.lang), 'lesson');
  }
  return { id: id };
}

function hLessonDelete_(ctx, p) {
  var n = dbDelete_('Lessons', function (l) { return l.id === String(p.id || ''); });
  if (!n) fail_('not_found');
  return {};
}

function hLessonSign_(ctx, p) {
  var l = dbAll_('Lessons').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!l) fail_('forbidden');
  var s = findStudent_(l.sid);
  if (!s || !canAccessStudent_(ctx, s)) fail_('forbidden');
  if (l.status !== 'done') fail_('bad_request');
  if (l.signedAt) return {}; // 已签过，重复点击不重复记录
  if (signState_(l, now_()) === 'auto') fail_('already_confirmed');
  dbUpdate_('Lessons', l, { signedAt: iso_(now_()), signedBy: ctx.role === 'parent' ? 'parent:' + ctx.id : 'student' });
  return {};
}

/* ---------- 学费 ---------- */

function hTuitionPaid_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s) fail_('not_found');
  if (int_(p.expectPaid, 0, 500, 'expectPaid') !== s.paid) fail_('stale'); // 防止连点两次加两期
  dbUpdate_('Students', s, { paid: s.paid + 1, claimed: false });
  return {};
}

function hTuitionClaim_(ctx, p) {
  var s = accessStudent_(ctx, p.sid);
  if (ctx.role === 'student' && pairedParents_(s.id).length) fail_('forbidden'); // 有家长的孩子，由家长来点
  var done = dbAll_('Lessons').filter(function (l) { return l.sid === s.id && l.status === 'done'; }).length;
  if (!tuition_(s, done).due) fail_('not_due');
  dbUpdate_('Students', s, { claimed: true });
  return {};
}

function hTuitionRemind_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s || !s.active) fail_('not_found');
  var note = str_(p.note, LIMITS.note);
  var parents = pairedParents_(s.id);
  var to = parents.length ? parents.map(function (x) { return { email: x.email, lang: x.lang }; })
                          : (s.email ? [{ email: s.email, lang: s.lang }] : []);
  if (!to.length) fail_('no_recipient');
  var sent = 0;
  to.forEach(function (r) { if (sendMail_(r.email, mailTuition_(s.name, note, r.lang), 'tuition')) sent++; });
  if (!sent) fail_('mail_unavailable');
  return { sent: sent };
}

/* ---------- 积分规则 ---------- */

function hRulesSave_(ctx, p) {
  var r = p.rules || {};
  var clean = {};
  // 先全部校验，都合法再一起写入：不能出现“改了一半”
  Object.keys(RULE_RANGE).forEach(function (k) { clean[k] = int_(r[k], RULE_RANGE[k][0], RULE_RANGE[k][1], k); });
  Object.keys(clean).forEach(function (k) { setConfig_('rule.' + k, clean[k]); });
  return {};
}

/* ---------- 通知、留言 ---------- */

function hNoticeSend_(ctx, p) {
  var scope = oneOf_(p.scope, ['all', 'student'], 'scope');
  var sid = '';
  if (scope === 'student') { var s = findStudent_(String(p.sid || '')); if (!s || !s.active) fail_('not_found'); sid = s.id; }
  var aud = oneOf_(p.aud || 'both', ['both', 'student', 'parent'], 'aud');
  var title = str_(p.title, LIMITS.title, { required: true, label: 'title' });
  var body = str_(p.body, LIMITS.body, { required: true, label: 'body' });
  dbInsert_('Notices', { id: newId_('n'), ts: iso_(now_()), scope: scope, sid: sid, aud: aud, title: title, body: body, readBy: [] });
  return {};
}

function hNoticeRead_(ctx, p) {
  if (!Array.isArray(p.ids) || p.ids.length > 300) fail_('bad_request', 'ids');
  var key = userKey_(ctx);
  var students = dbAll_('Students'), pairs = dbAll_('Pairs');
  var kidIds = studentIdsFor_(ctx, students, pairs);
  var want = {};
  p.ids.forEach(function (i) { want[String(i)] = true; });
  dbAll_('Notices').forEach(function (n) {
    if (!want[n.id] || !noticeVisible_(ctx, n, kidIds)) return;
    var rb = n.readBy || [];
    if (rb.indexOf(key) < 0) dbUpdate_('Notices', n, { readBy: rb.concat([key]) });
  });
  return {};
}

function hMessageSend_(ctx, p) {
  var text = str_(p.text, LIMITS.text, { required: true, label: 'text' });
  var from, pid = '', s;
  if (ctx.role === 'admin') {
    s = findStudent_(String(p.sid || ''));
    if (!s) fail_('not_found');
    from = 'teacher';
  } else if (ctx.role === 'student') {
    s = accessStudent_(ctx, ctx.id);
    from = 'student';
  } else {
    s = accessStudent_(ctx, p.sid);
    if (s.kind !== 'child') fail_('forbidden');
    from = 'parent'; pid = ctx.id;
  }
  var now = now_();
  dbInsert_('Messages', { id: newId_('m'), sid: s.id, from: from, pid: pid, ts: iso_(now), text: text,
    readBy: from === 'teacher' ? ['admin'] : [] });

  if (from !== 'teacher' && getConfigMap_()['mail.teacherOnMessage'] === 'true') {
    var kind = 'msg:' + s.id;
    var recent = dbAll_('MailLog').some(function (r) { return r.kind === kind && r.status === 'sent' && ms_(r.ts) > now - MSG_MAIL_THROTTLE_MS; });
    if (!recent) {
      var who = from === 'parent' ? (dbAll_('Parents').filter(function (x) { return x.id === pid; })[0] || {}).name + ' / ' + s.name : s.name;
      var lang = getConfigMap_().teacher_lang === 'en' ? 'en' : 'zh';
      activeAdminEmails_().forEach(function (e) { sendMail_(e, mailTeacherMessage_(who, text, lang), kind); });
    }
  }
  return {};
}

function hMessageRead_(ctx, p) {
  var sid = String(p.sid || '');
  var students = dbAll_('Students'), pairs = dbAll_('Pairs');
  var byId = {}; students.forEach(function (s) { byId[s.id] = s; });
  var kidIds = studentIdsFor_(ctx, students, pairs);
  var key = userKey_(ctx);
  dbAll_('Messages').forEach(function (m) {
    if (m.sid !== sid || !messageVisible_(ctx, m, kidIds, byId)) return;
    var mine = ctx.role === 'admin' ? m.from !== 'teacher' : m.from === 'teacher';
    var rb = m.readBy || [];
    if (mine && rb.indexOf(key) < 0) dbUpdate_('Messages', m, { readBy: rb.concat([key]) });
  });
  return {};
}
