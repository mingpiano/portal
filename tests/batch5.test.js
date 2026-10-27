'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, MIN, HOUR, DAY, fresh, WHO, ok, err, state, lessonParams } = require('./helpers');

const admin = rt => rt.as(OWNER);
const stu = (st, id) => st.students.find(s => s.id === id);
const save = (rt, id, extra) => {
  const s = stu(state(rt, 'admin'), id);
  return rt.call('students.save', { student: { id, name: s.name, email: s.email, kind: s.kind, lang: s.lang, birth: s.birth, start: s.start, level: s.level, grp: s.grp, dur: s.dur, paid: s.paid, carry: s.carry, adj: s.adj, showPoints: s.showPoints, ...extra } }, admin(rt));
};

describe('学费：每 N 节一期 / 按月', () => {
  test('默认每期 10 节，和以前完全一样', () => {
    const rt = fresh(); const e = stu(state(rt, 'admin'), 's-emma');
    assert.equal(e.tuition.mode, 'lessons'); assert.equal(e.tuition.n, 10); assert.equal(e.term, 10); assert.equal(e.billing, 'lessons');
  });
  test('一期改成 5 节：节数、剩余、该交费都按 5 算', () => {
    const rt = fresh();
    ok(save(rt, 's-lucas', { term: 5, paid: 2, carry: 8 }));
    const t = stu(state(rt, 'admin'), 's-lucas').tuition; // 已上 = carry 8 + 课记录
    const done = t.done; assert.equal(t.n, 5);
    assert.equal(t.left, 2 * 5 - (8 + done));
    assert.equal(t.used, Math.max(0, Math.min(5, 8 + done - 5)));
    assert.equal(t.due, t.left <= 0);
  });
  test('每期节数范围 1–50；乱填拒绝；不带这一项就不改原来的', () => {
    const rt = fresh();
    for (const v of [0, 51, -1, 'abc', 2.5]) err(save(rt, 's-emma', { term: v }), 'bad_request');
    ok(save(rt, 's-emma', { term: 8 }));
    ok(save(rt, 's-emma', {}));
    assert.equal(stu(state(rt, 'admin'), 's-emma').term, 8);
  });
  test('按月：本月已交 → 不该交；新的一个月开始没交 → 该交；交了又不欠', () => {
    const rt = fresh(), tk = rt.login(OWNER, { remember: true }); // 90 天不过期，后面要快进一个月
    const emma = () => ok(rt.call('bootstrap', {}, tk)).state.students.find(s => s.id === 's-emma');
    const cur = new Date(rt.now()).toISOString().slice(0, 7);
    ok(save(rt, 's-emma', { billing: 'month', billFrom: cur, paid: 1 }));
    let t = emma().tuition;
    assert.equal(t.mode, 'month'); assert.equal(t.due, false); assert.equal(t.owed, 0);
    const m0 = rt.ctx.ymKey_(rt.now(), 'America/Denver');
    while (rt.ctx.ymKey_(rt.now(), 'America/Denver') === m0) rt.advance(DAY); // 快进到下个月（刚好跨一个月）
    t = emma().tuition;
    assert.equal(t.due, true, '过了一个月没交'); assert.equal(t.owed >= 1, true);
    ok(rt.call('tuition.paid', { sid: 's-emma', expectPaid: 1 }, tk));
    assert.equal(emma().tuition.due, false);
  });
  test('按月没填起始月，就从保存这个月开始；格式不对拒绝；改回每 N 节会清掉起始月', () => {
    const rt = fresh();
    ok(save(rt, 's-emma', { billing: 'month', paid: 0 }));
    const s = stu(state(rt, 'admin'), 's-emma');
    assert.match(s.billFrom, /^\d{4}-\d{2}$/);
    assert.equal(s.tuition.due, true, '这个月一期都没交');
    err(save(rt, 's-emma', { billing: 'month', billFrom: '2026-13' }), 'bad_request');
    err(save(rt, 's-emma', { billing: 'yearly' }), 'bad_request');
    ok(save(rt, 's-emma', { billing: 'lessons' }));
    assert.equal(stu(state(rt, 'admin'), 's-emma').billFrom, '');
  });
  test('按月的学生：学生 / 家长能看到 tuition.mode，“我已付款”只在该交时可以点', () => {
    const rt = fresh(); const cur = new Date(rt.now()).toISOString().slice(0, 7);
    ok(save(rt, 's-emma', { billing: 'month', billFrom: cur, paid: 1 }));
    assert.equal(state(rt, 'li').students[0].tuition.mode, 'month');
    err(rt.call('tuition.claim', { sid: 's-emma' }, rt.as(WHO.li)), 'not_due');
    ok(save(rt, 's-emma', { billing: 'month', billFrom: cur, paid: 0 }));
    ok(rt.call('tuition.claim', { sid: 's-emma' }, rt.as(WHO.li)));
  });
  test('学费提醒邮件：按每期节数 / 按月写', () => {
    const rt = fresh(); rt.as(WHO.li);
    ok(save(rt, 's-emma', { term: 6 }));
    const n0 = rt.mail.length;
    ok(rt.call('tuition.remind', { sid: 's-emma', note: '' }, admin(rt)));
    assert.match(rt.mail[rt.mail.length - 1].body, /6 节|6 lessons/);
    ok(save(rt, 's-emma', { billing: 'month', billFrom: '2026-01' }));
    ok(rt.call('tuition.remind', { sid: 's-emma', note: '' }, admin(rt)));
    assert.match(rt.mail[rt.mail.length - 1].body, /2026-\d\d/);
    assert.ok(rt.mail.length > n0);
  });
  test('tuition_ 纯规则：N=5 边界；按月跨月', () => {
    const rt = fresh(), c = rt.ctx, J = x => JSON.parse(JSON.stringify(x));
    assert.deepEqual(J(c.tuition_({ paid: 1, carry: 0, term: 5 }, 5)), { mode: 'lessons', n: 5, done: 5, consumed: 5, left: 0, used: 5, due: true });
    assert.equal(c.tuition_({ paid: 2, carry: 0, term: 5 }, 6).used, 1);
    const tz = 'America/Denver', now = Date.parse('2026-11-15T12:00:00Z');
    const mk = (paid, from) => J(c.tuition_({ paid, billing: 'month', billFrom: from }, 0, [], now, tz));
    assert.equal(mk(1, '2026-11').due, false); assert.equal(mk(0, '2026-11').due, true);
    assert.equal(mk(2, '2026-10').due, false); assert.equal(mk(1, '2026-10').due, true);
    assert.equal(mk(1, '2026-12').due, false, '起始月还没到，不算欠');
    // 月份按老师时区：11/1 凌晨 UTC 在丹佛还是 10 月
    const edge = Date.parse('2026-11-01T03:00:00Z');
    assert.equal(J(c.tuition_({ paid: 0, billing: 'month', billFrom: '2026-11' }, 0, [], edge, tz)).due, false, '丹佛还是 10 月，11 月的账还没开始');
  });
});

describe('日历：排课、改时间、取消', () => {
  const at = (rt, days, h = 16) => { const d = new Date(rt.now() + days * DAY); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
  const add = (rt, sid, starts, extra) => rt.call('events.add', { sid, starts, dur: 30, note: '', ...extra }, admin(rt));
  const evs = (rt, who = 'admin') => state(rt, who).events;

  test('老账号升级：已有的“下次上课”变成日历里的一条（每位学生一条）', () => {
    const rt = fresh();
    const st = state(rt, 'admin');
    assert.equal(st.events.length, st.students.filter(s => s.active).length);
    assert.ok(st.students.every(s => s.next && s.nextId));
    // 模拟旧数据：清掉 Events，再跑升级
    const sh = rt.sheet('Events'); sh.clear && sh.clear();
  });
  test('一次排 1 节、或每周一节排 N 节；排完学生立刻看到最早的那节是“下次上课”', () => {
    const rt = fresh();
    const starts = [0, 7, 14, 21].map(k => at(rt, 20 + k));
    const r = ok(add(rt, 's-emma', starts));
    assert.equal(r.ids.length, 4);
    assert.equal(evs(rt).filter(e => e.sid === 's-emma').length, 1 + 4);
    // 种子里的下次上课在 3 天后，比新排的早，所以还是它
    assert.equal(state(rt, 'emma').students[0].next, evs(rt).find(e => e.id === 'e-emma-1').start);
  });
  test('检查：没有开始时间、超过 26 节、日期太离谱、同一学生同一时间重复，都拒绝', () => {
    const rt = fresh();
    err(add(rt, 's-emma', []), 'bad_request');
    err(add(rt, 's-emma', Array.from({ length: 27 }, (_, k) => at(rt, 10 + 7 * k))), 'bad_request');
    err(add(rt, 's-emma', ['abc']), 'bad_request');
    err(add(rt, 's-emma', [at(rt, 2000)]), 'bad_request');
    err(add(rt, 's-emma', [at(rt, 10), at(rt, 10)]), 'duplicate');
    ok(add(rt, 's-emma', [at(rt, 10)])); err(add(rt, 's-emma', [at(rt, 10)]), 'duplicate');
    err(add(rt, 's-nope', [at(rt, 10)]), 'not_found');
    err(add(rt, 's-emma', [at(rt, 11)], { dur: 5 }), 'bad_request');
  });
  test('只有老师能排课、改课、删课；学生家长只看自己孩子的', () => {
    const rt = fresh();
    for (const who of [WHO.emma, WHO.li]) {
      err(rt.call('events.add', { sid: 's-emma', starts: [at(rt, 9)], dur: 30 }, rt.as(who)), 'forbidden');
      err(rt.call('events.edit', { id: 'e-emma-1', dur: 60 }, rt.as(who)), 'forbidden');
      err(rt.call('events.delete', { id: 'e-emma-1' }, rt.as(who)), 'forbidden');
    }
    ok(add(rt, 's-lucas', [at(rt, 9)])); ok(add(rt, 's-mia', [at(rt, 9, 17)]));
    assert.ok(evs(rt, 'emma').every(e => e.sid === 's-emma'));
    assert.deepEqual([...new Set(evs(rt, 'chen').map(e => e.sid))].sort(), ['s-lucas', 's-mia']);
    assert.ok(evs(rt, 'zihan').every(e => e.sid === 's-zihan'));
  });
  test('改时间：学生页的“下次上课”跟着变；改成别的时间不影响别人', () => {
    const rt = fresh(); const e = evs(rt).find(x => x.id === 'e-emma-1');
    const to = at(rt, 6, 15);
    ok(rt.call('events.edit', { id: e.id, start: to, dur: 60, note: '线上' }, admin(rt)));
    const emma = state(rt, 'emma');
    assert.equal(emma.students[0].next, to);
    const e2 = emma.events.find(x => x.id === e.id); assert.equal(e2.dur, 60); assert.equal(e2.note, '线上');
    assert.equal(state(rt, 'lucas').students[0].next, evs(rt, 'lucas')[0].start);
  });
  test('取消：不再是“下次上课”，下一节顶上；恢复后又回来；全取消就显示没有', () => {
    const rt = fresh();
    const second = at(rt, 40); ok(add(rt, 's-emma', [second]));
    const first = evs(rt).find(x => x.id === 'e-emma-1').start;
    ok(rt.call('events.edit', { id: 'e-emma-1', status: 'cancelled' }, admin(rt)));
    assert.equal(state(rt, 'emma').students[0].next, second);
    ok(rt.call('events.edit', { id: 'e-emma-1', status: 'scheduled' }, admin(rt)));
    assert.equal(state(rt, 'emma').students[0].next, first);
    evs(rt).filter(x => x.sid === 's-emma').forEach(x => ok(rt.call('events.edit', { id: x.id, status: 'cancelled' }, admin(rt))));
    assert.equal(state(rt, 'emma').students[0].next, '');
    err(rt.call('events.edit', { id: 'e-emma-1', status: 'maybe' }, admin(rt)), 'bad_request');
  });
  test('撞时间：别的学生的课重叠会提醒（仍然保存），不撞就没有提醒', () => {
    const rt = fresh(); const t0 = at(rt, 12, 18);
    ok(add(rt, 's-lucas', [t0], { dur: 60 }));
    const r = ok(add(rt, 's-mia', [new Date(Date.parse(t0) + 30 * MIN).toISOString()]));
    assert.deepEqual(r.overlap, ['Lucas Chen']);
    assert.deepEqual(ok(add(rt, 's-sophia', [new Date(Date.parse(t0) + 60 * MIN).toISOString()])).overlap, []);
    assert.deepEqual(ok(rt.call('events.edit', { id: r.ids[0], dur: 30 }, admin(rt))).overlap, ['Lucas Chen']);
  });
  test('改时间 / 取消并勾选通知：家长（或成人学生本人）收到邮件，写的是学生那边的时间；不勾不发；过去的课不发', () => {
    const rt = fresh(); rt.as(WHO.li); rt.as(WHO.sophia);
    const count = () => rt.mail.filter(m => /变更|取消|changed|cancelled/.test(m.subject)).length;
    const base = count();
    ok(rt.call('events.edit', { id: 'e-emma-1', start: at(rt, 8, 15), notify: true }, admin(rt)));
    assert.equal(count() - base, 1); const m = rt.mail[rt.mail.length - 1];
    assert.equal(m.to, WHO.li); assert.match(m.body, /Emma Li/);
    ok(rt.call('events.edit', { id: 'e-emma-1', start: at(rt, 9, 15) }, admin(rt)));
    assert.equal(count() - base, 1, '没勾通知就不发');
    ok(rt.call('events.edit', { id: 'e-sophia-1', status: 'cancelled', notify: true }, admin(rt)));
    assert.equal(count() - base, 2); assert.equal(rt.mail[rt.mail.length - 1].to, WHO.sophia);
    assert.match(rt.mail[rt.mail.length - 1].subject, /取消|cancel/i);
  });
  test('删除：从日历消失；不存在的报找不到', () => {
    const rt = fresh();
    ok(rt.call('events.delete', { id: 'e-emma-1' }, admin(rt)));
    assert.ok(!evs(rt).some(x => x.id === 'e-emma-1'));
    err(rt.call('events.delete', { id: 'e-emma-1' }, admin(rt)), 'not_found');
    err(rt.call('events.edit', { id: 'e-emma-1', dur: 30 }, admin(rt)), 'not_found');
  });
});

describe('日历和记课互相关联', () => {
  const at = (rt, days, h = 16) => { const d = new Date(rt.now() + days * DAY); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
  const evs = rt => state(rt, 'admin').events;
  const lesson = (rt, id) => state(rt, 'admin').lessons.find(l => l.id === id);

  test('记课时填了下次上课 → 自动排进日历，学生页显示这个时间', () => {
    const rt = fresh(); const next = at(rt, 4, 20);
    const id = ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next }), admin(rt))).id;
    const e = evs(rt).find(x => x.src === id);
    assert.equal(e.start, next); assert.equal(e.status, 'scheduled');
    assert.equal(state(rt, 'lucas').students[0].next, next);
  });
  test('记课：上一节带出来的排课算“已上”；老师单独排的、时间对得上的那节也算已上', () => {
    const rt = fresh();
    // lucas 种子里有 e-lucas-1（上一节课带出的“下次上课”）
    const manual = at(rt, 0, 0); // 随便排一节今天附近的
    const dateIso = new Date(rt.now() - HOUR).toISOString();
    ok(rt.call('events.add', { sid: 's-lucas', starts: [dateIso], dur: 30 }, admin(rt)));
    ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { date: dateIso }), admin(rt)));
    const st = evs(rt).filter(e => e.sid === 's-lucas');
    assert.equal(st.find(e => e.id === 'e-lucas-1').status, 'done');
    assert.equal(st.find(e => e.start === dateIso).status, 'done');
    assert.equal(state(rt, 'lucas').students[0].next, '', '没有填下次，也没有别的排课');
  });
  test('老师先排了每周的课；记课时不填下次上课，“下次上课”仍然是日历里的下一节', () => {
    const rt = fresh(); const w = [0, 1, 2].map(k => at(rt, 14 + 7 * k));
    ok(rt.call('events.add', { sid: 's-lucas', starts: w, dur: 30 }, admin(rt)));
    ok(rt.call('lessons.log', lessonParams(rt, 's-lucas'), admin(rt)));
    assert.equal(state(rt, 'lucas').students[0].next, w[0]);
  });
  test('记课填的下次上课正好是日历里已有的那一节：认领，不重复', () => {
    const rt = fresh(); const t = at(rt, 14);
    ok(rt.call('events.add', { sid: 's-lucas', starts: [t], dur: 30 }, admin(rt)));
    const n = evs(rt).length;
    const id = ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next: t }), admin(rt))).id;
    assert.equal(evs(rt).length, n);
    assert.equal(evs(rt).find(x => x.start === t && x.sid === 's-lucas').src, id);
  });
  test('在日历里改时间 → 那节课记录里的“下次上课”一起改；取消 / 删除 → 清掉', () => {
    const rt = fresh(); const next = at(rt, 5, 20);
    const id = ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next }), admin(rt))).id;
    const e = evs(rt).find(x => x.src === id), to = at(rt, 6, 21);
    ok(rt.call('events.edit', { id: e.id, start: to }, admin(rt)));
    assert.equal(lesson(rt, id).notes.next, to);
    ok(rt.call('events.edit', { id: e.id, status: 'cancelled' }, admin(rt)));
    assert.equal(lesson(rt, id).notes.next, undefined);
    ok(rt.call('events.edit', { id: e.id, status: 'scheduled' }, admin(rt)));
    assert.equal(lesson(rt, id).notes.next, to);
    ok(rt.call('events.delete', { id: e.id }, admin(rt)));
    assert.equal(lesson(rt, id).notes.next, undefined);
  });
  test('修改课记录里的下次上课 → 日历同步；清空 → 排课删掉', () => {
    const rt = fresh(); const next = at(rt, 5, 20);
    const id = ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next }), admin(rt))).id;
    const params = over => ({ id, date: lesson(rt, id).date, dur: 30, pieces: [{ title: 'A', st: 'new' }], focus: 'f', homework: '', due: '', ...over });
    const to = at(rt, 7, 19);
    ok(rt.call('lessons.edit', params({ next: to }), admin(rt)));
    assert.equal(evs(rt).find(x => x.src === id).start, to);
    assert.equal(state(rt, 'lucas').students[0].next, to);
    ok(rt.call('lessons.edit', params({ next: '' }), admin(rt)));
    assert.ok(!evs(rt).some(x => x.src === id));
  });
  test('删掉一节课记录：它带出的排课还留着（只是不再关联）', () => {
    const rt = fresh(); const next = at(rt, 5, 20);
    const id = ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next }), admin(rt))).id;
    ok(rt.call('lessons.delete', { id }, admin(rt)));
    const e = evs(rt).find(x => x.start === next); assert.ok(e); assert.equal(e.src, '');
  });
  test('老数据升级：只有记课里填过“下次上课”、没有日历条目的，升级时补成排课', () => {
    const rt = fresh();
    const before = evs(rt).length;
    // 模拟旧版：把 Events 表清空（只留表头），再跑升级
    const sh = rt.sheet('Events'); sh.deleteRows(2, sh.getLastRow() - 1);
    rt.ctx.resetRequest_();
    assert.equal(rt.ctx.dbAll_('Events').length, 0);
    rt.ctx.migrateEvents_();
    assert.equal(evs(rt).length, before);
    rt.ctx.migrateEvents_(); // 再跑一次不会重复
    assert.equal(evs(rt).length, before);
  });
});

describe('按月：本月交了几节 + 本月已上手动修正', () => {
  const cur = rt => rt.ctx.ymKey_(rt.now(), rt.ctx.teacherTz_());
  test('交了 3 节、已上 2 节 → 2/3；上完变该交费（4/4 同理）', () => {
    const rt = fresh();
    ok(save(rt, 's-emma', { billing: 'month', billFrom: cur(rt), paid: 0, mPlan: 3, mDone: 2 }));
    let t = stu(state(rt, 'admin'), 's-emma').tuition;
    assert.equal(t.plan, 3); assert.equal(t.used, 2); assert.equal(t.left, 1); assert.equal(t.due, false);
    // 学生、家长看到的一样
    const mine = stu(state(rt, 'emma'), 's-emma').tuition; assert.equal(mine.used, 2); assert.equal(mine.plan, 3);
    // 再记一节课（系统自动 +1）→ 3/3，该续费
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), admin(rt)));
    t = stu(state(rt, 'admin'), 's-emma').tuition; assert.equal(t.used, 3); assert.equal(t.due, true);
    ok(save(rt, 's-emma', { billing: 'month', mPlan: 4, mDone: 4 }));
    t = stu(state(rt, 'admin'), 's-emma').tuition; assert.equal(t.used, 4); assert.equal(t.plan, 4); assert.equal(t.due, true);
  });
  test('已上留空 = 按记课自动算；手动修正只存差值，改别的字段再保存不会变', () => {
    const rt = fresh();
    ok(save(rt, 's-lucas', { billing: 'month', billFrom: cur(rt), mPlan: 5, mDone: '' }));
    const auto = stu(state(rt, 'admin'), 's-lucas').tuition.auto;
    assert.equal(stu(state(rt, 'admin'), 's-lucas').tuition.used, auto);
    ok(save(rt, 's-lucas', { billing: 'month', mPlan: 5, mDone: auto + 2 }));
    let s = stu(state(rt, 'admin'), 's-lucas'); assert.equal(s.tuition.used, auto + 2); assert.equal(s.mDone, auto + 2); assert.equal(s.mPlan, 5);
    ok(save(rt, 's-lucas', { billing: 'month', mPlan: 5, mDone: s.mDone, level: '改了别的' })); // 表单把现在的值原样送回
    assert.equal(stu(state(rt, 'admin'), 's-lucas').tuition.used, auto + 2);
  });
  test('范围检查；每 N 节一期的学生不受影响；不设节数 = 老的按月逻辑', () => {
    const rt = fresh();
    for (const v of [-1, 32, 'x', 1.5]) err(save(rt, 's-emma', { billing: 'month', mPlan: v }), 'bad_request');
    err(save(rt, 's-emma', { billing: 'month', mPlan: 3, mDone: -2 }), 'bad_request');
    ok(save(rt, 's-emma', { billing: 'lessons', mPlan: 3, mDone: 1 }));
    const e = stu(state(rt, 'admin'), 's-emma'); assert.equal(e.tuition.mode, 'lessons'); assert.ok(!e.mPlan);
    ok(save(rt, 's-emma', { billing: 'month', billFrom: cur(rt), paid: 1 }));
    const t = stu(state(rt, 'admin'), 's-emma').tuition; assert.equal(t.plan, 0); assert.equal(t.due, false);
  });
  test('到了下个月，上个月的“交了几节”自动失效，回到按月未交', () => {
    const rt = fresh(), tk = rt.login(OWNER, { remember: true });
    ok(save(rt, 's-emma', { billing: 'month', billFrom: cur(rt), paid: 0, mPlan: 3, mDone: 1 }));
    const m0 = cur(rt);
    for (let i = 0; i < 40 && cur(rt) === m0; i++) rt.advance(DAY);
    const t = ok(rt.call('bootstrap', {}, tk)).state.students.find(x => x.id === 's-emma').tuition; assert.equal(t.plan, 0); assert.equal(t.due, true);
  });
  test('该交费的提醒邮件：写“本月 N 节已上完”', () => {
    const rt = fresh();
    ok(save(rt, 's-emma', { billing: 'month', billFrom: cur(rt), paid: 1, mPlan: 2, mDone: 2 }));
    ok(rt.call('tuition.remind', { sid: 's-emma', note: '' }, admin(rt)));
    assert.match(rt.mail[rt.mail.length - 1].body, /2 节|2 paid lessons/);
  });
});
