/**
 * 把“这个人能看到的全部数据”组装成一份 JSON 给网页。
 * 权限都在这里卡死：老师看全部；家长只看配对孩子；学生只看自己。
 * 其他人的数据不会出现在返回里，网页再怎么改也看不到。
 */

function studentIdsFor_(ctx, students, pairs) {
  if (ctx.role === 'admin') return students.map(function (s) { return s.id; });
  if (ctx.role === 'student') return students.filter(function (s) { return s.id === ctx.id && s.active; }).map(function (s) { return s.id; });
  var mine = pairs.filter(function (p) { return p.parentId === ctx.id; }).map(function (p) { return p.studentId; });
  return students.filter(function (s) { return s.active && mine.indexOf(s.id) >= 0; }).map(function (s) { return s.id; });
}

function noticeVisible_(ctx, n, kidIds) {
  if (ctx.role === 'admin') return true;
  if (ctx.role === 'student') return (n.scope === 'all' || n.sid === ctx.id) && (n.aud === 'both' || n.aud === 'student');
  return (n.scope === 'all' || kidIds.indexOf(n.sid) >= 0) && (n.aud === 'both' || n.aud === 'parent');
}

function messageVisible_(ctx, m, kidIds, studentsById) {
  if (ctx.role === 'admin') return true;
  if (ctx.role === 'student') return m.sid === ctx.id;
  // 家长能看到孩子和老师的留言（儿童安全上的透明做法）；成人学生的留言只有老师看得到
  var s = studentsById[m.sid];
  return kidIds.indexOf(m.sid) >= 0 && !!s && s.kind === 'child';
}

function buildState_(ctx) {
  var now = now_();
  var rules = getRules_(), cfg = getConfigMap_();
  var students = dbAll_('Students'), parents = dbAll_('Parents'), pairs = dbAll_('Pairs');
  var admin = ctx.role === 'admin';
  var ids = studentIdsFor_(ctx, students, pairs);
  var visible = students.filter(function (s) { return ids.indexOf(s.id) >= 0; });
  var byId = {};
  students.forEach(function (s) { byId[s.id] = s; });
  var parentById = {};
  parents.forEach(function (p) { parentById[p.id] = p; });

  var lessonsBy = {};
  dbAll_('Lessons').forEach(function (l) { (lessonsBy[l.sid] = lessonsBy[l.sid] || []).push(l); });

  var points = {}, lessonsOut = [], studentsOut = [];
  visible.forEach(function (s) {
    var ls = lessonsBy[s.id] || [];
    var doneList = ls.filter(function (l) { return l.status === 'done'; });
    var numbers = numberLessons_(ls);
    var mins = doneList.reduce(function (a, l) { return a + l.dur; }, 0) + s.adj * s.dur;
    var kidParents = pairs.filter(function (p) { return p.studentId === s.id && parentById[p.parentId] && parentById[p.parentId].active; });
    var out = {
      id: s.id, name: s.name, email: s.email, kind: s.kind, birth: s.birth, start: s.start, adj: s.adj, lang: s.lang,
      level: s.level, grp: s.grp, dur: s.dur, showPoints: s.showPoints, avatar: s.avatar, books: s.books || [],
      active: s.active, claimed: s.claimed, hasParent: kidParents.length > 0,
      done: doneList.length, total: doneList.length + s.adj, hours: Math.round(mins / 6) / 10,
      tuition: tuition_(s, doneList.length), learning: learning_(ls),
      tz: studentTz_(s), next: nextLesson_(ls, now)
    };
    if (admin) {
      out.paid = s.paid; out.carry = s.carry; out.hasCode = !!s.codeHash;
      out.parentIds = kidParents.map(function (p) { return p.parentId; });
    }
    studentsOut.push(out);

    ls.slice().sort(function (a, b) { return ms_(b.date) - ms_(a.date); }).forEach(function (l) {
      lessonsOut.push({
        id: l.id, sid: l.sid, n: numbers[l.id] || 0, date: l.date, dur: l.dur, status: l.status,
        signState: signState_(l, now), signedAt: l.signedAt, signedBy: l.signedBy, loggedAt: l.loggedAt, notes: l.notes, hwDone: l.hwDone || []
      });
    });
    if (s.showPoints) {
      var entries = ledger_(ls, [], rules, now);
      points[s.id] = { total: pointsTotal_(entries), entries: entries };
    }
  });

  var me;
  if (admin) {
    var a = dbAll_('Admins').filter(function (x) { return normEmail_(x.email) === ctx.id; })[0] || {};
    me = { role: 'admin', id: ctx.id, name: a.name || '', email: ctx.id, avatar: a.avatar || null };
  } else if (ctx.role === 'parent') {
    var pr = parentById[ctx.id];
    me = { role: 'parent', id: pr.id, name: pr.name, email: pr.email, lang: pr.lang, avatar: pr.avatar, kids: ids };
  } else {
    var st = byId[ctx.id];
    me = { role: 'student', id: st.id, name: st.name, email: st.email, lang: st.lang, avatar: st.avatar };
  }

  var parentsOut = [];
  if (admin) {
    parentsOut = parents.map(function (p) {
      return { id: p.id, name: p.name, email: p.email, lang: p.lang, avatar: p.avatar, active: p.active,
        kids: pairs.filter(function (x) { return x.parentId === p.id; }).map(function (x) { return x.studentId; }) };
    });
  } else if (ctx.role === 'parent') {
    var self = parentById[ctx.id];
    parentsOut = [{ id: self.id, name: self.name, email: self.email, lang: self.lang, avatar: self.avatar, active: true, kids: ids }];
  }

  var key = userKey_(ctx);
  var notices = dbAll_('Notices').filter(function (n) { return noticeVisible_(ctx, n, ids); })
    .sort(function (a, b) { return ms_(b.ts) - ms_(a.ts); })
    .map(function (n) {
      return { id: n.id, ts: n.ts, scope: n.scope, sid: n.sid, aud: n.aud, title: n.title, body: n.body,
        unread: !admin && (n.readBy || []).indexOf(key) < 0 };
    });
  var messages = dbAll_('Messages').filter(function (m) { return messageVisible_(ctx, m, ids, byId); })
    .sort(function (a, b) { return ms_(a.ts) - ms_(b.ts); })
    .map(function (m) {
      var unread = admin ? (m.from !== 'teacher' && (m.readBy || []).indexOf('admin') < 0)
                         : (m.from === 'teacher' && (m.readBy || []).indexOf(key) < 0);
      var pn = m.pid && parentById[m.pid] ? parentById[m.pid].name : '';
      return { id: m.id, sid: m.sid, from: m.from, pid: m.pid, pname: pn, ts: m.ts, text: m.text, unread: unread };
    });

  var out = {
    env: isTestEnv_() ? 'test' : 'prod', apiVer: API_VERSION,
    studio: { zh: cfg.studio_name_zh, en: cfg.studio_name_en },
    now: iso_(now), rules: rules, me: me,
    students: studentsOut, parents: parentsOut, lessons: lessonsOut, points: points,
    notices: notices, messages: messages, resources: resourcesOut_(ctx, ids)
  };
  // 老师所在时区只给老师：学生和家长只看到自己所在时区的时间
  if (admin) out.teacherTz = teacherTz_();
  return out;
}
