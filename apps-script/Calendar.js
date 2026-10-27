/**
 * 日历：老师排课、改时间、取消；学生和家长只能看。
 *
 * 一节“排好的课”是 Events 表里的一行：哪位学生、几点开始、多长、备注、状态（scheduled 排着 / cancelled 已取消）。
 * 记课时填的“下次上课”也会变成一行（src 记着是哪节课），老师之后在日历里改时间，
 * 那节课记录里的“下次上课”会一起跟着改，两边始终一致。
 * 学生页“下次上课”= 这位学生最早的、没取消的未来课程（见 Rules.js 的 nextFor_）。
 */

var EVENT_TOTAL_MAX = 6000;

function cleanEventStart_(v) {
  var ms = Date.parse(v), now = now_();
  if (!isFinite(ms) || ms < now - 366 * 86400000 || ms > now + 2 * 366 * 86400000) fail_('bad_request', 'start');
  return ms;
}

/** 这些时间段里，别的（没取消的）课有没有撞上？返回撞上的学生名字（去重）。 */
function eventOverlaps_(startsMs, durMin, ignoreIds) {
  var names = {};
  var students = {};
  dbAll_('Students').forEach(function (s) { students[s.id] = s; });
  dbAll_('Events').forEach(function (e) {
    if (e.status !== 'scheduled' || (ignoreIds && ignoreIds.indexOf(e.id) >= 0)) return;
    var a = ms_(e.start), b = a + e.dur * 60000;
    startsMs.forEach(function (st) {
      if (st < b && st + durMin * 60000 > a && students[e.sid]) names[students[e.sid].name] = true;
    });
  });
  return Object.keys(names);
}

/** 新排课：starts 是一串开始时间（每周重复就是一串每隔一周的时间，由网页算好，夏令时不会错位）。 */
function hEventAdd_(ctx, p) {
  var s = findStudent_(String(p.sid || ''));
  if (!s || !s.active) fail_('not_found');
  if (!Array.isArray(p.starts) || p.starts.length < 1 || p.starts.length > EVENT_MAX_REPEAT) fail_('bad_request', 'starts');
  var dur = int_(p.dur == null || p.dur === '' ? s.dur : p.dur, 10, 180, 'dur');
  var note = str_(p.note, LIMITS.evNote);
  var seen = {};
  var mss = p.starts.map(function (v) { var ms = cleanEventStart_(v); if (seen[ms]) fail_('duplicate'); seen[ms] = true; return ms; });
  var all = dbAll_('Events');
  if (all.length + mss.length > EVENT_TOTAL_MAX) fail_('too_many');
  mss.forEach(function (ms) {
    if (all.some(function (e) { return e.sid === s.id && e.status === 'scheduled' && Math.abs(ms_(e.start) - ms) < 60000; })) fail_('duplicate');
  });
  var overlap = eventOverlaps_(mss, dur, null);
  var ids = [], nowIso = iso_(now_());
  mss.forEach(function (ms) {
    var id = newId_('e');
    dbInsert_('Events', { id: id, sid: s.id, start: iso_(ms), dur: dur, note: note, status: 'scheduled', src: '', created: nowIso, updated: nowIso });
    ids.push(id);
  });
  return { ids: ids, overlap: overlap };
}

/** 改一节排好的课：时间、时长、备注，或取消 / 恢复。可以通知学生（家长）。 */
function hEventEdit_(ctx, p) {
  var e = dbAll_('Events').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!e) fail_('not_found');
  var s = findStudent_(e.sid);
  if (!s) fail_('not_found');
  var patch = { updated: iso_(now_()) };
  var oldMs = ms_(e.start), newMs = oldMs;
  if (p.start !== undefined) {
    newMs = cleanEventStart_(p.start);
    if (dbAll_('Events').some(function (x) { return x.id !== e.id && x.sid === e.sid && x.status === 'scheduled' && Math.abs(ms_(x.start) - newMs) < 60000; })) fail_('duplicate');
    patch.start = iso_(newMs);
  }
  if (p.dur !== undefined) patch.dur = int_(p.dur, 10, 180, 'dur');
  if (p.note !== undefined) patch.note = str_(p.note, LIMITS.evNote);
  var oldStatus = e.status, newStatus = oldStatus;
  if (p.status !== undefined) { newStatus = oneOf_(p.status, ['scheduled', 'cancelled'], 'status'); patch.status = newStatus; }
  dbUpdate_('Events', e, patch);
  if (e.src) syncLessonNextFromEvent_(e);
  var overlap = newStatus === 'scheduled' ? eventOverlaps_([newMs], e.dur, [e.id]) : [];
  var moved = newMs !== oldMs, statusChanged = newStatus !== oldStatus;
  if (bool_(p.notify) && (moved || statusChanged) && Math.max(oldMs, newMs) > now_()) {
    notifyEventChange_(s, statusChanged && newStatus === 'cancelled' ? 'cancelled' : 'moved', oldMs, newMs);
  }
  return { overlap: overlap };
}

function hEventDelete_(ctx, p) {
  var e = dbAll_('Events').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!e) fail_('not_found');
  dbDelete_('Events', function (x) { return x.id === e.id; });
  if (e.src) setLessonNext_(e.src, null);
  return {};
}

/** 把排课的变化写回那节课记录里的“下次上课”：排着 → 新时间；取消 → 清空。 */
function syncLessonNextFromEvent_(e) {
  setLessonNext_(e.src, e.status === 'scheduled' ? ms_(e.start) : null);
}
function setLessonNext_(lessonId, ms) {
  var l = dbAll_('Lessons').filter(function (x) { return x.id === lessonId; })[0];
  if (!l) return;
  var notes = JSON.parse(JSON.stringify(l.notes || {}));
  if (ms && ms > ms_(l.date)) notes.next = iso_(ms); else delete notes.next;
  dbUpdate_('Lessons', l, { notes: notes });
}

/**
 * 记了一节课：这位学生“对应这节课”的排课算上完了（status = done），不再当作“下次上课”。
 * - 上一节课记课时顺手排的那一条（src 不为空，且是更早的课带出来的）：就是这一节。
 * - 老师在日历里单独排的，开始时间和这节课相差 3 小时内的。
 */
function completeEventsOnLog_(s, lessonId, dateMs) {
  var lessons = {};
  dbAll_('Lessons').forEach(function (l) { lessons[l.id] = l; });
  dbAll_('Events').forEach(function (e) {
    if (e.sid !== s.id || e.status !== 'scheduled') return;
    var hit = e.src ? (e.src !== lessonId && lessons[e.src] && ms_(lessons[e.src].date) < dateMs)
                    : Math.abs(ms_(e.start) - dateMs) <= 3 * 3600000;
    if (hit) dbUpdate_('Events', e, { status: 'done', updated: iso_(now_()) });
  });
}

/** 记课（或改课）时填了“下次上课”：同步成一条排课。没填就把这节课带出的排课删掉。 */
function syncLessonEvent_(lessonId, s, nextMs) {
  var all = dbAll_('Events');
  var linked = all.filter(function (e) { return e.src === lessonId; });
  var nowIso = iso_(now_());
  if (!nextMs) { if (linked.length) dbDelete_('Events', function (e) { return e.src === lessonId; }); return; }
  if (linked.length) { dbUpdate_('Events', linked[0], { start: iso_(nextMs), status: 'scheduled', updated: nowIso }); return; }
  var same = all.filter(function (e) { return e.sid === s.id && e.status === 'scheduled' && Math.abs(ms_(e.start) - nextMs) < 60000; })[0];
  if (same) { dbUpdate_('Events', same, { src: lessonId, updated: nowIso }); return; } // 老师已经在日历里排过这一节：认领它，不重复
  dbInsert_('Events', { id: newId_('e'), sid: s.id, start: iso_(nextMs), dur: s.dur, note: '', status: 'scheduled', src: lessonId, created: nowIso, updated: nowIso });
}

function notifyEventChange_(s, kind, oldMs, newMs) {
  if (getConfigMap_()['mail.lessonChange'] !== 'true') return;
  var tz = studentTz_(s);
  var to = pairedParents_(s.id).map(function (x) { return { email: x.email, lang: x.lang }; });
  if (!to.length && s.email) to = [{ email: s.email, lang: s.lang }];
  to.forEach(function (r) { sendMail_(r.email, mailLessonChange_(s.name, kind, fmtTz_(oldMs, tz), fmtTz_(newMs, tz), r.lang), 'lessonchange'); });
}

/** 老版本升级：把还没过去的“下次上课”变成日历里的排课（每位学生最近一节课的那个）。 */
function migrateEvents_() {
  var now = now_();
  var students = {};
  dbAll_('Students').forEach(function (s) { students[s.id] = s; });
  var had = {};
  dbAll_('Events').forEach(function (e) { had[e.sid] = true; });
  var latest = {};
  dbAll_('Lessons').filter(function (l) { return l.status === 'done'; }).forEach(function (l) {
    if (!latest[l.sid] || ms_(l.date) > ms_(latest[l.sid].date)) latest[l.sid] = l;
  });
  Object.keys(latest).forEach(function (sid) {
    var l = latest[sid], n = l.notes && l.notes.next ? ms_(l.notes.next) : 0;
    if (!had[sid] && students[sid] && n > now) syncLessonEvent_(l.id, students[sid], n);
  });
}
