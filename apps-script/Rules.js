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
function tuition_(student, doneCount) {
  var paid = student.paid || 0, carry = student.carry || 0;
  var consumed = carry + doneCount;
  var left = paid * 10 - consumed;
  var used = Math.max(0, Math.min(10, consumed - Math.max(paid - 1, 0) * 10));
  return { done: doneCount, consumed: consumed, left: left, used: used, due: left <= 0 };
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
