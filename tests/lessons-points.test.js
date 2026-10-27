'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, MIN, HOUR, DAY, fresh, WHO, ok, err, state, lessonParams } = require('./helpers');

const plain = x => JSON.parse(JSON.stringify(x)); // 跨 vm 对象比较用
const R = { confirm: 2, sign: 1, ontime: 3, late: -1, missing: -3, noshow: -5, streakN: 4, streakBonus: 5, grace: 3 };
const iso = ms => new Date(ms).toISOString();

describe('记课', () => {
  test('记一节课：学生马上看到，编号接在最后一节后面，信息原样保存', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const before = state(rt, 'emma').lessons.length;
    const id = ok(rt.call('lessons.log', lessonParams(rt, 's-emma', { focus: '左手稳定', homework: '第 3 行' }), admin)).id;
    const e = state(rt, 'emma');
    const l = e.lessons.find(x => x.id === id);
    assert.equal(e.lessons.length, before + 1);
    assert.equal(l.n, before + 1);
    assert.equal(l.signState, 'pending');
    assert.equal(l.notes.focus, '左手稳定');
    assert.equal(l.notes.pieces[0].title, 'Minuet in G');
    assert.equal(e.students[0].done, before + 1, '学生资料里的已上课数同步增加');
  });

  test('记课后给配对的家长发签字邮件（不发给孩子）；成人学生则发给本人', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const base = rt.mail.length;
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), admin));
    const sent = rt.mail.slice(base);
    assert.deepEqual(sent.map(m => m.to), [WHO.li]);
    ok(rt.call('lessons.log', lessonParams(rt, 's-sophia'), admin));
    assert.equal(rt.mail[rt.mail.length - 1].to, WHO.sophia);
  });

  test('关闭“记课发邮件”后不再发信', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    rt.ctx.setConfig_('mail.lessonSign', 'false');
    const base = rt.mail.length;
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), admin));
    assert.equal(rt.mail.length, base);
  });

  test('邮件发送失败不影响记课本身', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    rt.mailFail = true;
    const id = ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), admin)).id;
    assert.ok(state(rt, 'admin').lessons.some(l => l.id === id));
  });

  const bad = [
    ['日期在两天后', rt => ({ date: iso(rt.now() + 2 * DAY) }), 'bad_request'],
    ['日期早于三年前', rt => ({ date: iso(rt.now() - 3 * 365 * DAY - DAY) }), 'bad_request'],
    ['日期不是日期', () => ({ date: 'yesterday-ish' }), 'bad_request'],
    ['没有曲目', () => ({ pieces: [] }), 'bad_request'],
    ['曲目超过 12 首', () => ({ pieces: Array.from({ length: 13 }, (_, i) => ({ title: 'p' + i })) }), 'bad_request'],
    ['曲名为空', () => ({ pieces: [{ title: '  ' }] }), 'bad_request'],
    ['曲目状态不合法', () => ({ pieces: [{ title: 'a', st: 'hacked' }] }), 'bad_request'],
    ['时长 9 分钟', () => ({ dur: 9 }), 'bad_request'],
    ['时长 181 分钟', () => ({ dur: 181 }), 'bad_request'],
    ['作业太长', () => ({ homework: 'x'.repeat(5000) }), 'too_long'],
    ['截止日期格式不对', () => ({ due: '12/31' }), 'bad_request']
  ];
  for (const [name, mk, code] of bad) {
    test('拒绝：' + name, () => {
      const rt = fresh();
      const n = rt.sheet('Lessons').getLastRow();
      err(rt.call('lessons.log', lessonParams(rt, 's-emma', mk(rt)), rt.as(OWNER)), code);
      assert.equal(rt.sheet('Lessons').getLastRow(), n, '被拒绝的请求不能写进表');
    });
  }

  test('拒绝：不存在的学生、已归档的学生', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    err(rt.call('lessons.log', lessonParams(rt, 's-nobody'), admin), 'not_found');
    ok(rt.call('students.archive', { id: 's-mia', active: false }, admin));
    err(rt.call('lessons.log', lessonParams(rt, 's-mia'), admin), 'not_found');
  });

  test('一分钟内给同一个学生记两次，判为重复（防连点）；隔开就可以', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const p = lessonParams(rt, 's-emma');
    ok(rt.call('lessons.log', p, admin));
    err(rt.call('lessons.log', p, admin), 'duplicate');
    ok(rt.call('lessons.log', { ...p, date: iso(Date.parse(p.date) - 5 * MIN) }, admin));
    ok(rt.call('lessons.log', { ...p, sid: 's-lucas' }, admin));
  });

  test('删除一节课：后面的编号自动补上，已删除的不能再删', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const ls = state(rt, 'admin').lessons.filter(l => l.sid === 's-emma').sort((a, b) => a.n - b.n);
    const victim = ls[1];
    ok(rt.call('lessons.delete', { id: victim.id }, admin));
    const after = state(rt, 'admin').lessons.filter(l => l.sid === 's-emma').sort((a, b) => a.n - b.n);
    assert.deepEqual(after.map(l => l.n), after.map((_, i) => i + 1));
    assert.equal(after.length, ls.length - 1);
    err(rt.call('lessons.delete', { id: victim.id }, admin), 'not_found');
  });

  test('“正在学习”由服务器归纳：新记的曲子出现在学生的“正在学”里', () => {
    const rt = fresh();
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma', { pieces: [{ title: 'Sonatina in C', source: 'Clementi', st: 'new' }] }), rt.as(OWNER)));
    const L = plain(state(rt, 'emma').students[0].learning);
    assert.ok(L.current.some(p => p.title === 'Sonatina in C'));
    assert.ok(L.finished.some(p => p.title === 'Arabesque'), '种子数据里 Arabesque 已完成');
  });

  test('家长和学生的课数、学时与老师看到的一致', () => {
    const rt = fresh();
    const a = state(rt, 'admin').students.find(s => s.id === 's-emma');
    const e = state(rt, 'emma').students[0];
    const l = state(rt, 'li').students[0];
    for (const k of ['done', 'total', 'hours', 'tuition']) assert.deepEqual(plain(e[k]), plain(a[k]), k);
    assert.deepEqual(plain(l.tuition), plain(a.tuition));
  });
});

describe('签字和积分', () => {
  const newLesson = (rt, sid = 's-emma') => ok(rt.call('lessons.log', lessonParams(rt, sid), rt.as(OWNER))).id;

  test('学生签字：状态变 signed，加 1 分（默认规则），签两次只算一次', () => {
    const rt = fresh();
    const id = newLesson(rt);
    const p0 = state(rt, 'emma').points['s-emma'].total;
    ok(rt.call('lessons.sign', { id }, rt.as(WHO.emma)));
    const e = state(rt, 'emma');
    const l = e.lessons.find(x => x.id === id);
    assert.equal(l.signState, 'signed');
    assert.equal(l.signedBy, 'student');
    assert.equal(e.points['s-emma'].total, p0 + 1);
    const t0 = l.signedAt;
    rt.advance(HOUR);
    ok(rt.call('lessons.sign', { id }, rt.as(WHO.emma)));
    const l2 = state(rt, 'emma').lessons.find(x => x.id === id);
    assert.equal(l2.signedAt, t0, '重复点击不改签字时间');
    assert.equal(state(rt, 'emma').points['s-emma'].total, p0 + 1);
  });

  test('家长替孩子签：记下是哪位家长；孩子随后看到已签', () => {
    const rt = fresh();
    const id = newLesson(rt, 's-lucas');
    ok(rt.call('lessons.sign', { id }, rt.as(WHO.chen)));
    assert.equal(state(rt, 'chen').lessons.find(l => l.id === id).signedBy, 'parent:p-chen');
    assert.equal(state(rt, 'lucas').lessons.find(l => l.id === id).signState, 'signed');
  });

  test('48 小时没签自动确认，之后不能补签、也没有积分', () => {
    const rt = fresh();
    const emmaTok = rt.as(WHO.emma, { remember: true }); // 长期登录，否则 1 天后会话过期
    const id = newLesson(rt);
    const p0 = state(rt, 'emma').points['s-emma'].total;
    rt.advance(48 * HOUR - MIN);
    assert.equal(state(rt, 'emma').lessons.find(l => l.id === id).signState, 'pending');
    rt.advance(2 * MIN);
    assert.equal(state(rt, 'emma').lessons.find(l => l.id === id).signState, 'auto');
    err(rt.call('lessons.sign', { id }, rt.as(WHO.emma)), 'already_confirmed');
    assert.equal(state(rt, 'emma').points['s-emma'].total, p0);
  });

  test('老师改规则，所有人的积分立刻按新规则重算；越界的数值被拒', () => {
    const rt = fresh();
    const id = newLesson(rt);
    ok(rt.call('lessons.sign', { id }, rt.as(WHO.emma)));
    const before = state(rt, 'emma').points['s-emma'];
    const signs = before.entries.filter(e => e.key === 'sign').length;
    ok(rt.call('rules.save', { rules: { ...R, sign: 5 } }, rt.as(OWNER)));
    const after = state(rt, 'emma').points['s-emma'];
    assert.equal(after.total - before.total, 4 * signs);
    err(rt.call('rules.save', { rules: { ...R, sign: 101 } }, rt.as(OWNER)), 'bad_request');
    err(rt.call('rules.save', { rules: { ...R, streakN: -1 } }, rt.as(OWNER)), 'bad_request');
    err(rt.call('rules.save', { rules: { sign: 1 } }, rt.as(OWNER)), 'bad_request');
    assert.equal(state(rt, 'emma').points['s-emma'].total, after.total, '被拒绝的修改不留痕迹');
  });
});

describe('学费', () => {
  const sophiaDue = rt => ok(rt.call('students.save', { student: { id: 's-sophia', name: 'Sophia Zhang', kind: 'adult', email: WHO.sophia, paid: 1, carry: 10 } }, rt.as(OWNER)));

  test('种子数据里 Lucas 该交费；交一期后不再该交，并清掉“已申报”', () => {
    const rt = fresh();
    let l = state(rt, 'admin').students.find(s => s.id === 's-lucas');
    assert.equal(l.tuition.due, true);
    ok(rt.call('tuition.claim', { sid: 's-lucas' }, rt.as(WHO.chen)));
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-lucas').claimed, true);
    ok(rt.call('tuition.paid', { sid: 's-lucas', expectPaid: l.paid }, rt.as(OWNER)));
    l = state(rt, 'admin').students.find(s => s.id === 's-lucas');
    assert.equal(l.claimed, false);
    assert.equal(l.tuition.due, false);
  });

  test('连点两次“已收款”只加一期（expectPaid 对不上就拒绝）', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const paid = state(rt, 'admin').students.find(s => s.id === 's-lucas').paid;
    ok(rt.call('tuition.paid', { sid: 's-lucas', expectPaid: paid }, admin));
    err(rt.call('tuition.paid', { sid: 's-lucas', expectPaid: paid }, admin), 'stale');
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-lucas').paid, paid + 1);
  });

  test('没到期不能申报“已付款”', () => {
    const rt = fresh();
    const s = state(rt, 'admin').students.find(x => !x.tuition.due && x.hasParent);
    const parent = Object.keys(WHO).find(k => ['li', 'chen'].includes(k) && state(rt, k).students.some(x => x.id === s.id));
    err(rt.call('tuition.claim', { sid: s.id }, rt.as(WHO[parent])), 'not_due');
  });

  test('有家长的孩子不能自己点“已付款”，由家长点；成人学生自己点', () => {
    const rt = fresh();
    err(rt.call('tuition.claim', { sid: 's-lucas' }, rt.as(WHO.lucas)), 'forbidden');
    sophiaDue(rt);
    ok(rt.call('tuition.claim', { sid: 's-sophia' }, rt.as(WHO.sophia)));
    err(rt.call('tuition.claim', { sid: 's-lucas' }, rt.as(WHO.sophia)), 'forbidden');
  });

  test('提醒交费：发给家长，不发给孩子；没人可发时明确报错', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const base = rt.mail.length;
    const r = ok(rt.call('tuition.remind', { sid: 's-lucas', note: '本周三前' }, admin));
    assert.equal(r.sent, 1);
    assert.deepEqual(rt.mail.slice(base).map(m => m.to), [WHO.chen]);
    ok(rt.call('students.save', { student: { id: 's-zihan', name: '王子涵', kind: 'child', paid: 1, carry: 3, email: '' } }, admin));
    ok(rt.call('pairs.set', { pid: 'p-wang', sid: 's-zihan', on: false }, admin));
    err(rt.call('tuition.remind', { sid: 's-zihan' }, admin), 'no_recipient');
  });

  test('学费提醒邮件里的备注会被转义，不会变成网页代码', () => {
    const rt = fresh();
    rt.call('tuition.remind', { sid: 's-lucas', note: '<script>alert(1)</script>' }, rt.as(OWNER));
    const m = rt.mail[rt.mail.length - 1];
    assert.ok(!m.htmlBody.includes('<script>'));
    assert.ok(m.htmlBody.includes('&lt;script&gt;'));
  });
});

describe('纯规则（不碰表格）', () => {
  const rt = fresh();
  const c = rt.ctx;

  test('tuition_：整期边界', () => {
    const t = (paid, carry, done) => plain(c.tuition_({ paid, carry }, done));
    assert.deepEqual(t(1, 0, 0), { mode: 'lessons', n: 10, done: 0, consumed: 0, left: 10, used: 0, due: false });
    assert.deepEqual(t(1, 0, 9), { mode: 'lessons', n: 10, done: 9, consumed: 9, left: 1, used: 9, due: false });
    assert.deepEqual(t(1, 0, 10), { mode: 'lessons', n: 10, done: 10, consumed: 10, left: 0, used: 10, due: true });
    assert.deepEqual(t(2, 10, 3), { mode: 'lessons', n: 10, done: 3, consumed: 13, left: 7, used: 3, due: false });
    assert.equal(t(2, 10, 10).due, true);
    assert.equal(t(0, 0, 0).due, true, '一期都没交，也算该交');
    assert.equal(t(1, 0, 12).left, -2, '超课时显示为负数');
    assert.equal(t(1, 0, 12).used, 10, '琴键进度不超过 10');
  });

  test('signState_：恰好 48 小时是 auto；没上成的课没有签字状态', () => {
    const logged = iso(Date.UTC(2026, 0, 1));
    const L = x => ({ status: 'done', loggedAt: logged, date: logged, signedAt: '', ...x });
    const t0 = Date.parse(logged);
    assert.equal(c.signState_(L(), t0 + 48 * HOUR - 1), 'pending');
    assert.equal(c.signState_(L(), t0 + 48 * HOUR), 'auto');
    assert.equal(c.signState_(L({ signedAt: logged }), t0 + 99 * HOUR), 'signed');
    assert.equal(c.signState_(L({ status: 'noshow' }), t0), 'none');
  });

  test('numberLessons_：按日期编号，与记录先后无关；只数“已上”的课', () => {
    const L = (id, d, status = 'done') => ({ id, date: iso(Date.UTC(2026, 0, d)), status });
    const m = plain(c.numberLessons_([L('c', 20), L('a', 5), L('x', 10, 'noshow'), L('b', 12)]));
    assert.deepEqual(m, { a: 1, b: 2, c: 3 });
  });

  const A = (id, dueDay, subDay) => ({ id, due: iso(Date.UTC(2026, 0, dueDay)), submittedAt: subDay == null ? '' : iso(Date.UTC(2026, 0, subDay)) });
  const NOW = Date.UTC(2026, 1, 28);
  const keys = es => plain(es).map(e => e.key);

  test('ledger_：按时交 +3；迟交 -1 并清零连续；超过宽限没交 -3', () => {
    const e = plain(c.ledger_([], [A('a1', 5, 5), A('a2', 10, 12), A('a3', 15, null)], R, NOW));
    const by = k => e.filter(x => x.key === k);
    assert.equal(by('ontime').length, 1); assert.equal(by('ontime')[0].pts, 3);
    assert.equal(by('late')[0].pts, -1);
    assert.equal(by('missing')[0].pts, -3);
    assert.equal(c.pointsTotal_(e), -1);
  });

  test('ledger_：宽限期内还没交，暂时不扣分', () => {
    const due = Date.UTC(2026, 1, 27);
    const e = plain(c.ledger_([], [{ id: 'a', due: iso(due), submittedAt: '' }], R, due + 3 * DAY));
    assert.equal(e.length, 0, '正好 3 天仍在宽限内');
    assert.equal(plain(c.ledger_([], [{ id: 'a', due: iso(due), submittedAt: '' }], R, due + 3 * DAY + 1)).length, 1);
  });

  test('ledger_：连续按时 4 次奖励 +5；中间迟交后重新累计', () => {
    const four = [1, 2, 3, 4].map(i => A('a' + i, i * 3, i * 3 - 1));
    const e = plain(c.ledger_([], four, R, NOW));
    assert.equal(e.filter(x => x.key === 'streak').length, 1);
    assert.equal(c.pointsTotal_(e), 4 * 3 + 5);
    const broken = [A('a1', 3, 2), A('a2', 6, 5), A('a3', 9, 12), A('a4', 12, 11), A('a5', 15, 14), A('a6', 18, 17)];
    assert.equal(plain(c.ledger_([], broken, R, NOW)).filter(x => x.key === 'streak').length, 0, '迟交后连续次数归零，只剩 3 次');
    const eight = Array.from({ length: 8 }, (_, i) => A('b' + i, 3 * (i + 1), 3 * (i + 1) - 1));
    assert.equal(plain(c.ledger_([], eight, R, NOW)).filter(x => x.key === 'streak').length, 2);
  });

  test('ledger_：streakN = 0 表示关闭连续奖励；流水最新的在前', () => {
    const four = [1, 2, 3, 4].map(i => A('a' + i, i * 3, i * 3 - 1));
    const e = plain(c.ledger_([], four, { ...R, streakN: 0 }, NOW));
    assert.equal(e.filter(x => x.key === 'streak').length, 0);
    const ts = e.map(x => x.t);
    assert.deepEqual(ts, [...ts].sort((a, b) => b - a));
  });

  test('ledger_：课程签字加分、缺课扣分，课的编号写进流水', () => {
    const ls = [
      { id: 'l1', date: iso(Date.UTC(2026, 0, 1)), status: 'done', signedAt: iso(Date.UTC(2026, 0, 2)), confirmedAt: '' },
      { id: 'l2', date: iso(Date.UTC(2026, 0, 8)), status: 'done', signedAt: '', confirmedAt: '' },
      { id: 'l3', date: iso(Date.UTC(2026, 0, 15)), status: 'noshow', signedAt: '', confirmedAt: '' }
    ];
    const e = plain(c.ledger_(ls, [], R, NOW));
    assert.deepEqual(keys(e).sort(), ['noshow', 'sign']);
    assert.equal(e.find(x => x.key === 'sign').n, 1);
    assert.equal(c.pointsTotal_(e), 1 - 5);
  });

  test('learning_：同一首曲子以最后一次的状态为准；曲名+出处不同算两首', () => {
    const L = (d, pieces) => ({ id: 'l' + d, status: 'done', date: iso(Date.UTC(2026, 0, d)), notes: { pieces } });
    const r = plain(c.learning_([
      L(15, [{ title: 'Minuet in G', source: 'Petzold', st: 'done' }, { title: 'Sonatina', source: 'Clementi', st: 'review' }]),
      L(1, [{ title: 'minuet in g', source: 'petzold', st: 'new' }, { title: 'Sonatina', source: 'Kuhlau', st: 'new' }]),
      { id: 'x', status: 'noshow', date: iso(Date.UTC(2026, 0, 20)), notes: { pieces: [{ title: 'Ghost', st: 'new' }] } }
    ]));
    assert.deepEqual(r.finished.map(p => p.title.toLowerCase()), ['minuet in g'], '大小写不同的同一首曲子合并');
    assert.equal(r.finished.length, 1);
    assert.equal(r.finished[0].n, 2);
    assert.deepEqual(r.current.map(p => p.source).sort(), ['Clementi', 'Kuhlau']);
    assert.ok(!JSON.stringify(r).includes('Ghost'), '没上成的课不进“正在学”');
  });
});
