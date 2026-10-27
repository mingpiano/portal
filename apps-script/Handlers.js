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
  if (a.t === 'img') {
    // 用户上传的照片：网页里已经裁成小方图并压缩成 JPEG，这里只认这个格式和大小
    var v = String(a.v == null ? '' : a.v);
    if (v.length > LIMITS.avatarImg || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/]+={0,2}$/.test(v)) fail_('bad_request', 'avatar');
    return { t: 'img', v: v };
  }
  if (a.t !== 'emoji' || AVATAR_EMOJI.indexOf(a.v) < 0 || AVATAR_COLORS.indexOf(a.c) < 0) fail_('bad_request', 'avatar');
  return { t: 'emoji', v: a.v, c: a.c };
}

function hProfileSave_(ctx, p) {
  if (p.tz !== undefined) {
    if (ctx.role !== 'admin') fail_('forbidden'); // 只有老师能改“老师所在时区”
    setConfig_('teacher_tz', oneOf_(p.tz, TZ_LIST, 'tz'));
  }
  if (p.birth !== undefined) { // 生日：学生自己填；孩子的，家长也可以填
    var target;
    if (ctx.role === 'student') target = findStudent_(ctx.id);
    else if (ctx.role === 'parent') { target = accessStudent_(ctx, p.sid); if (target.kind !== 'child') fail_('forbidden'); }
    else fail_('forbidden');
    var b = dateOnly_(p.birth, 'birth');
    if (b && Date.parse(b) > now_()) fail_('bad_request', 'birth');
    dbUpdate_('Students', target, { birth: b });
  }
  if (p.avatar !== undefined) {
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
  if (r.tz !== undefined && r.tz !== '') fields.tz = oneOf_(r.tz, TZ_LIST, 'tz');
  // 学费方式：每 N 节一期（默认 10），或按月。没带这几项就不动原来的。
  if (r.term !== undefined) fields.term = int_(r.term === '' ? 10 : r.term, 1, 50, 'term');
  if (r.billing !== undefined) {
    fields.billing = oneOf_(r.billing || 'lessons', ['lessons', 'month'], 'billing');
    var bf = String(r.billFrom == null ? '' : r.billFrom).trim();
    if (bf && !/^\d{4}-(0[1-9]|1[0-2])$/.test(bf)) fail_('bad_request', 'billFrom');
    fields.billFrom = fields.billing === 'month' ? (bf || ymKey_(now_(), teacherTz_())) : '';
    if (fields.billing !== 'month') { fields.mPlan = 0; fields.mAdj = 0; fields.mMonth = ''; }
  }
  // 按月：这个月交了几节课的学费（0/空 = 不设），以及“这个月已上几节”的手动修正（只存和系统计数的差）
  if (r.mPlan !== undefined && fields.billing !== 'lessons') {
    var plan = int_(r.mPlan === '' || r.mPlan == null ? 0 : r.mPlan, 0, 31, 'mPlan');
    fields.mPlan = plan;
    fields.mMonth = plan > 0 ? ymKey_(now_(), teacherTz_()) : '';
    fields.mAdj = 0;
    if (plan > 0 && r.mDone !== undefined && r.mDone !== '' && r.mDone != null) {
      var want = int_(r.mDone, 0, 99, 'mDone');
      var curYm = ymKey_(now_(), teacherTz_()), sidAuto = r.id ? String(r.id) : '';
      var auto = dbAll_('Lessons').filter(function (l) { return l.sid === sidAuto && l.status === 'done' && ymKey_(ms_(l.date), teacherTz_()) === curYm; }).length;
      fields.mAdj = want - auto;
    }
  }
  // 教材和学生资料一起保存（和“保存”按钮同一次提交，不会再丢）；没带 books 就不动原有的
  var books = r.books === undefined ? undefined : cleanBooks_(r.books);
  var all = dbAll_('Students');
  if (email && all.some(function (s) { return s.id !== r.id && s.email && normEmail_(s.email) === email; })) fail_('email_taken');
  if (kind === 'adult' && r.id && dbAll_('Pairs').some(function (x) { return x.studentId === r.id; })) fail_('adult_has_parent');

  if (r.id) {
    var row = findStudent_(String(r.id));
    if (!row) fail_('not_found');
    if (row.codeHash && normName_(name) !== normName_(row.name) && all.some(function (x) { return x.id !== row.id && x.active && x.kind === 'child' && x.codeHash && normName_(x.name) === normName_(name); })) fail_('name_taken');
    if (books !== undefined) fields.books = books;
    dbUpdate_('Students', row, fields);
    return { id: row.id };
  }
  var rec = fields;
  rec.tz = fields.tz || teacherTz_();
  if (fields.term === undefined) rec.term = 10;
  rec.id = newId_('s'); rec.claimed = false; rec.avatar = null; rec.books = books || []; rec.active = true; rec.created = iso_(now_());
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

/** 生成（或重置）孩子的登录码。明文只在这次返回里出现一次，表里存的是哈希。 */
function hKidCodeSet_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s || !s.active) fail_('not_found');
  if (s.kind !== 'child') fail_('not_child');
  var n = normName_(s.name);
  // 用名字登录，所以同名的孩子不能都开登录码，否则分不清谁是谁
  if (dbAll_('Students').some(function (x) { return x.id !== s.id && x.active && x.kind === 'child' && x.codeHash && normName_(x.name) === n; })) fail_('name_taken');
  var code = randomKidCode_();
  dbUpdate_('Students', s, { codeHash: hashKidCode_(s.id, code), codeVer: Number(s.codeVer || 0) + 1, codeFails: 0, codeLock: 0 });
  return { code: code, name: s.name };
}

/** 关闭孩子的登录码：旧码作废，已经用码登录的设备也立刻退出。 */
function hKidCodeClear_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s) fail_('not_found');
  dbUpdate_('Students', s, { codeHash: '', codeVer: Number(s.codeVer || 0) + 1, codeFails: 0, codeLock: 0 });
  return {};
}

function hBooksSave_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s) fail_('not_found');
  dbUpdate_('Students', s, { books: cleanBooks_(p.books) });
  return {};
}

/**
 * 教材列表：每项是一本教材，或者一首“单曲”（k:'single'，可注明选自哪本曲集 f）。
 * s 是学习状态：current 在学 / done 学过。
 */
function cleanBooks_(list) {
  if (!Array.isArray(list) || list.length > 40) fail_('bad_request', 'books');
  return list.map(function (b) {
    if (!b || typeof b !== 'object') fail_('bad_request', 'book');
    var out = { n: str_(b.n, LIMITS.book, { required: true, label: 'book' }), s: oneOf_(b.s, ['current', 'done'], 'book status') };
    if (b.k !== undefined && b.k !== '' && b.k !== 'book') {
      out.k = oneOf_(b.k, ['single', 'portfolio'], 'book kind');
      if (out.k === 'single') { var f = str_(b.f, LIMITS.book); if (f) out.f = f; }
      else { // 作品集：名字 + YouTube（或别的 https）链接
        var u = String(b.u == null ? '' : b.u).trim();
        if (u.length > 500 || !/^https:\/\/[^\s<>"']+$/i.test(u)) fail_('bad_url');
        out.u = u;
      }
    }
    return out;
  });
}

/* ---------- 老师：记课、签字 ---------- */

/**
 * 一首曲子：曲名、出处、本节课速度（音符+每分钟拍数）、是不是作业。
 * 是作业：状态为“新曲/巩固”，可带作业速度和“需要录视频”；不是作业：这首记为“学过”。
 * 老版本的数据没有 hw 字段，原样保留它的状态。
 */
function cleanPiece_(x) {
  if (!x || typeof x !== 'object') fail_('bad_request', 'piece');
  var out = { title: str_(x.title, LIMITS.piece, { required: true, label: 'piece' }), source: str_(x.source, LIMITS.piece) };
  var tempo = cleanTempo_(x.tempo); if (tempo) out.tempo = tempo;
  if (x.hw === undefined || x.hw === null) { out.st = oneOf_(x.st || 'new', ['new', 'review', 'done'], 'piece status'); return out; }
  out.hw = bool_(x.hw);
  if (!out.hw) { out.st = 'done'; return out; }
  out.st = oneOf_(x.st || 'new', ['new', 'review'], 'piece status');
  var ht = cleanTempo_(x.hwTempo); if (ht) out.hwTempo = ht;
  if (bool_(x.video)) out.video = true;
  return out;
}
/** 速度 = 音符 + 每分钟拍数。没填返回 null。 */
function cleanTempo_(v) {
  if (v === undefined || v === null || v === '' || (typeof v === 'object' && (v.b === '' || v.b == null))) return null;
  if (typeof v !== 'object') fail_('bad_request', 'tempo');
  return { n: oneOf_(String(v.n || 'q'), TEMPO_NOTES, 'tempo note'), b: int_(v.b, 20, 400, 'bpm') };
}

/** 记课 / 改课共用的检查：日期、时长、曲子、作业、下次上课。返回整理好的内容。 */
function parseLesson_(s, p) {
  var dateMs = Date.parse(p.date);
  var now = now_();
  if (!isFinite(dateMs) || dateMs > now + 86400000 || dateMs < now - 3 * 365 * 86400000) fail_('bad_request', 'date');
  var dur = int_(p.dur == null || p.dur === '' ? s.dur : p.dur, 10, 180, 'dur');
  if (!Array.isArray(p.pieces) || p.pieces.length < 1 || p.pieces.length > 12) fail_('bad_request', 'pieces');
  var pieces = p.pieces.map(cleanPiece_);
  var homework = str_(p.homework, LIMITS.homework);
  if (hwList_({ pieces: pieces, homework: homework }).length > LIMITS.hwItems) fail_('too_long', 'homework items');
  // 下次上课时间（可不填）：必须在这节课之后、一年之内
  var nextMs = 0;
  if (p.next != null && p.next !== '') {
    nextMs = Date.parse(p.next);
    if (!isFinite(nextMs) || nextMs <= dateMs || nextMs > dateMs + 366 * 86400000) fail_('bad_request', 'next');
  }
  var notes = { pieces: pieces, focus: str_(p.focus, LIMITS.focus), tempo: str_(p.tempo, LIMITS.tempo),
    homework: homework, due: dateOnly_(p.due, 'due') };
  if (nextMs) notes.next = iso_(nextMs);
  return { dateMs: dateMs, dur: dur, notes: notes, nextMs: nextMs };
}

function hLessonLog_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s || !s.active) fail_('not_found');
  var x = parseLesson_(s, p), now = now_();
  var dup = dbAll_('Lessons').some(function (l) { return l.sid === s.id && Math.abs(ms_(l.date) - x.dateMs) < 60000; });
  if (dup) fail_('duplicate');

  var id = newId_('l');
  dbInsert_('Lessons', { id: id, sid: s.id, date: iso_(x.dateMs), dur: x.dur, status: 'done', confirmedAt: '', signedAt: '',
    signedBy: '', loggedAt: iso_(now), notes: x.notes, hwDone: [] });
  completeEventsOnLog_(s, id, x.dateMs); // 对应这节课的排课算“已上”
  syncLessonEvent_(id, s, x.nextMs);   // 填了“下次上课”就同时排进日历

  if (getConfigMap_()['mail.lessonSign'] === 'true') {
    // 邮件里的时间按学生所在时区写，学生看到的和自己的钟一致
    var tz = studentTz_(s);
    var dateText = Utilities.formatDate(new Date(x.dateMs), tz, 'yyyy-MM-dd');
    var nextText = x.nextMs ? fmtTz_(x.nextMs, tz) : '';
    var parents = pairedParents_(s.id);
    if (parents.length) parents.forEach(function (pr) { sendMail_(pr.email, mailLessonSign_(s.name, dateText, pr.lang, nextText), 'lesson'); });
    else if (s.email) sendMail_(s.email, mailLessonSign_(s.name, dateText, s.lang, nextText), 'lesson');
  }
  return { id: id };
}

/**
 * 修改一节已记的课：学生不能换，签字状态和记课时间不变（不重发邮件）。
 * 学生已经勾过的作业：只保留“这一项内容没变”的勾，改动过的项目要重新勾。
 */
function hLessonEdit_(ctx, p) {
  var l = dbAll_('Lessons').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!l) fail_('not_found');
  var s = findStudent_(l.sid);
  if (!s) fail_('not_found');
  var x = parseLesson_(s, p);
  var dup = dbAll_('Lessons').some(function (o) { return o.id !== l.id && o.sid === s.id && Math.abs(ms_(o.date) - x.dateMs) < 60000; });
  if (dup) fail_('duplicate');
  var oldItems = hwList_(l.notes), newItems = hwList_(x.notes);
  var done = (l.hwDone || []).filter(function (i) { return oldItems[i] && newItems[i] && JSON.stringify(oldItems[i]) === JSON.stringify(newItems[i]); });
  dbUpdate_('Lessons', l, { date: iso_(x.dateMs), dur: x.dur, notes: x.notes, hwDone: done });
  syncLessonEvent_(l.id, s, x.nextMs);
  return { id: l.id };
}

function hLessonDelete_(ctx, p) {
  var n = dbDelete_('Lessons', function (l) { return l.id === String(p.id || ''); });
  if (!n) fail_('not_found');
  dbAll_('Events').forEach(function (e) { if (e.src === String(p.id || '')) dbUpdate_('Events', e, { src: '' }); }); // 排课留着，只是不再关联这节课
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

/* ---------- 作业勾选、预览 ---------- */

/** 学生（或家长）勾选 / 取消勾选某一节课里的第几项作业。 */
function hHomeworkCheck_(ctx, p) {
  var l = dbAll_('Lessons').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!l) fail_('forbidden');
  var s = findStudent_(l.sid);
  if (!s || !canAccessStudent_(ctx, s)) fail_('forbidden');
  var items = hwList_(l.notes);
  if (typeof p.idx !== 'number') fail_('bad_request', 'idx'); // null 和字符串不当作 0
  var idx = int_(p.idx, 0, Math.max(items.length - 1, 0), 'idx');
  if (!items.length) fail_('bad_request', 'idx');
  var done = (l.hwDone || []).filter(function (i) { return i < items.length; });
  var has = done.indexOf(idx) >= 0;
  if (bool_(p.on) && !has) done.push(idx);
  if (!bool_(p.on) && has) done = done.filter(function (i) { return i !== idx; });
  done.sort(function (a, b) { return a - b; });
  dbUpdate_('Lessons', l, { hwDone: done });
  return {};
}

/**
 * 老师预览：返回“这位学生登录后会看到的全部数据”，用的是和学生登录时同一个组装函数，
 * 所以预览里看到的和学生真实看到的一模一样。只读：网页在预览模式下不会发出任何修改请求。
 */
function hPreviewState_(ctx, p) {
  if (p.pid) { // 家长视角
    var pr = dbAll_('Parents').filter(function (x) { return x.id === String(p.pid); })[0];
    if (!pr || !pr.active) fail_('not_found');
    return { preview: buildState_({ role: 'parent', id: pr.id, email: '' }) };
  }
  var s = findStudent_(String(p.sid || ''));
  if (!s || !s.active) fail_('not_found');
  return { preview: buildState_({ role: 'student', id: s.id, email: '' }) };
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
  if (!tuitionFor_(s).due) fail_('not_due');
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
  var sent = 0, tu = tuitionFor_(s);
  to.forEach(function (r) { if (sendMail_(r.email, mailTuition_(s.name, note, r.lang, tu), 'tuition')) sent++; });
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
