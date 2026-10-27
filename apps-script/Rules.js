/**
 * 业务规则（学费计数、积分、签字状态、学习内容）。
 * 这些函数不碰 Sheets 和邮件，只算数，所以可以直接用单元测试验证。
 */

/**
 * 学费计数。每期 10 节；paid 是已交几期，carry 是系统上线前这些期里已经上掉的课数。
 *   已上 = carry + 系统里记的课
 *   剩余 = paid × 10 − 已上；≤ 0 就该交下一期了
 *   used = 当前这一期里已上几节（0–10），用来画琴键进度
 */
function ymKey_(ms, tz) { return Utilities.formatDate(new Date(ms), tz, 'yyyy-MM'); }
function ymIndex_(key) { var m = /^(\d{4})-(\d{2})$/.exec(key); return m ? +m[1] * 12 + (+m[2] - 1) : 0; }

/**
 * 学费：每个学生可以选“每 N 节一期”（默认 10 节）或“按月”。
 * 每 N 节：left = 已交期数 × N − 已上课数（含上线前已上的）；left ≤ 0 就该交下一期。
 * 按月：从 billFrom 那个月起，每个日历月一期（按老师所在时区算月份）；已交月数少于已过去的月数就该交。
 * 返回 {mode, n, done, consumed, left, used, due, ...}：n 是每期节数（按月时为 0），used 是本期（本月）已上几节。
 */
function tuition_(student, doneCount, doneMs, nowMs, tz) {
  var paid = student.paid || 0;
  if (student.billing === 'month') {
    tz = tz || teacherTz_(); nowMs = nowMs == null ? now_() : nowMs;
    var cur = ymKey_(nowMs, tz);
    var from = /^\d{4}-\d{2}$/.test(student.billFrom || '') ? student.billFrom : cur;
    var elapsed = Math.max(0, ymIndex_(cur) - ymIndex_(from) + 1);
    var inMonth = (doneMs || []).filter(function (m) { return ymKey_(m, tz) === cur; }).length;
    return { mode: 'month', n: 0, done: doneCount, consumed: inMonth, left: paid - elapsed, used: inMonth, due: paid < elapsed, month: cur, owed: Math.max(0, elapsed - paid) };
  }
  var N = student.term > 0 ? student.term : 10, carry = student.carry || 0;
  var consumed = carry + doneCount;
  var left = paid * N - consumed;
  var used = Math.max(0, Math.min(N, consumed - Math.max(paid - 1, 0) * N));
  return { mode: 'lessons', n: N, done: doneCount, consumed: consumed, left: left, used: used, due: left <= 0 };
}
/** 某位学生现在的学费状态（自己去查已上的课）。 */
function tuitionFor_(s) {
  var done = dbAll_('Lessons').filter(function (l) { return l.sid === s.id && l.status === 'done'; });
  return tuition_(s, done.length, done.map(function (l) { return ms_(l.date); }), now_(), teacherTz_());
}

/** 一节课的签字状态：signed 学生签了；auto 超过 48 小时自动确认（不加分）；pending 还在等。 */
function signState_(lesson, nowMs) {
  if (lesson.status !== 'done') return 'none';
  if (lesson.signedAt) return 'signed';
  var logged = ms_(lesson.loggedAt) || ms_(lesson.date);
  return nowMs >= logged + AUTO_SIGN_MS ? 'auto' : 'pending';
}

/** 给某位学生的已上课按时间排序并编号（1、2、3……）。删掉一节课，后面的编号自动补上。 */
function numberLessons_(lessons) {
  var done = lessons.filter(function (l) { return l.status === 'done'; })
    .sort(function (a, b) { return ms_(a.date) - ms_(b.date); });
  var map = {};
  done.forEach(function (l, i) { map[l.id] = i + 1; });
  return map;
}

/**
 * 积分流水。系统只存事实（几点确认、几点签字、几点交作业），积分每次按当前规则现算，
 * 所以老师改了分值，所有人立刻按新规则重算，不用手工改分。
 * 返回 [{t, key, pts, lid, n, aid, streak}]，最新的在前。文字说明由网页按语言拼。
 * 第一期还没有作业上传，assignments 传空数组；第三期接上后同一个函数直接用。
 */
function ledger_(lessons, assignments, rules, nowMs) {
  var out = [];
  var numbers = numberLessons_(lessons);
  lessons.forEach(function (l) {
    if (l.confirmedAt) out.push({ t: ms_(l.confirmedAt), key: 'confirm', pts: rules.confirm, lid: l.id, n: numbers[l.id] || 0, date: l.date });
    if (l.signedAt) out.push({ t: ms_(l.signedAt), key: 'sign', pts: rules.sign, lid: l.id, n: numbers[l.id] || 0, date: l.date });
    if (l.status === 'noshow') out.push({ t: ms_(l.date), key: 'noshow', pts: rules.noshow, lid: l.id, date: l.date });
  });
  var streak = 0;
  assignments.slice().sort(function (a, b) { return ms_(a.due) - ms_(b.due); }).forEach(function (a) {
    var due = ms_(a.due);
    if (a.submittedAt) {
      var sub = ms_(a.submittedAt);
      if (sub <= due) {
        streak++;
        out.push({ t: sub, key: 'ontime', pts: rules.ontime, aid: a.id });
        if (rules.streakN > 0 && streak % rules.streakN === 0) out.push({ t: sub + 1, key: 'streak', pts: rules.streakBonus, streak: streak });
      } else {
        streak = 0;
        out.push({ t: sub, key: 'late', pts: rules.late, aid: a.id });
      }
    } else if (nowMs - due > rules.grace * 86400000) {
      streak = 0;
      out.push({ t: due + rules.grace * 86400000, key: 'missing', pts: rules.missing, aid: a.id });
    }
  });
  return out.sort(function (a, b) { return b.t - a.t; });
}

function pointsTotal_(entries) { return entries.reduce(function (s, e) { return s + e.pts; }, 0); }

/**
 * 从每节课的曲目记录里归纳“正在学 / 学过的”。
 * 同一首曲子（按曲名+出处）最后一次出现时的状态是“完成”就算学过的，否则算正在学。
 */
function learning_(lessons) {
  var map = {}, order = [];
  lessons.filter(function (l) { return l.status === 'done' && l.notes && l.notes.pieces; })
    .sort(function (a, b) { return ms_(a.date) - ms_(b.date); })
    .forEach(function (l) {
      l.notes.pieces.forEach(function (p) {
        var key = (p.title + '|' + (p.source || '')).toLowerCase();
        if (!map[key]) { map[key] = { title: p.title, source: p.source || '', first: l.date, n: 0 }; order.push(key); }
        var e = map[key];
        e.last = l.date; e.n++; e.st = p.st;
      });
    });
  var all = order.map(function (k) { return map[k]; });
  var byLast = function (a, b) { return ms_(b.last) - ms_(a.last); };
  return {
    current: all.filter(function (e) { return e.st !== 'done'; }).sort(byLast),
    finished: all.filter(function (e) { return e.st === 'done'; }).sort(byLast)
  };
}

/** 作业拆成逐项：每行一项，空行忽略。学生按项勾选，勾选记录按“第几项”保存。 */
function hwItems_(text) {
  return String(text || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
}

/**
 * 一节课的全部作业项：先是标为“作业”的曲子（按曲目顺序），再是文字作业的每一行。
 * 学生勾选记录的是这个列表里的第几项；课记下来以后不再修改，所以序号是稳定的。
 */
function hwList_(notes) {
  notes = notes || {};
  var out = [];
  (notes.pieces || []).forEach(function (p) { if (p.hw === true) out.push({ k: 'p', title: p.title }); });
  hwItems_(notes.homework).forEach(function (t) { out.push({ k: 't', text: t }); });
  return out;
}

/**
 * 下次上课时间：取最近一节课里老师填的“下次上课”，已经过去就不算。
 * 老师是在记课时填的，所以以最新一节课为准。
 */
function nextLesson_(lessons, nowMs) {
  var done = lessons.filter(function (l) { return l.status === 'done'; })
    .sort(function (a, b) { return ms_(b.date) - ms_(a.date); });
  var latest = done[0];
  var n = latest && latest.notes && latest.notes.next ? ms_(latest.notes.next) : 0;
  return n > nowMs ? iso_(n) : '';
}

/**
 * 下次上课时间：日历里这位学生最早的、还没取消的未来课程。
 * 这位学生从来没有日历条目时（上线日历之前的老数据），退回用最近一节课里填的“下次上课”。
 */
function nextFor_(lessons, events, nowMs) {
  if (!events.length) { var n = nextLesson_(lessons, nowMs); return n ? { start: n, id: '' } : null; }
  var up = events.filter(function (e) { return e.status === 'scheduled' && ms_(e.start) > nowMs; })
    .sort(function (a, b) { return ms_(a.start) - ms_(b.start); })[0];
  return up ? { start: up.start, id: up.id } : null;
}
