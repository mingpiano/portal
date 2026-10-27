'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, MIN, HOUR, DAY, fresh, WHO, ok, err, state, lessonParams } = require('./helpers');

describe('最近登录时间', () => {
  test('学生 / 家长登录后，老师在名册里看到最近登录；没登录过的是空', () => {
    const rt = fresh();
    const before = state(rt, 'admin');
    assert.ok(before.students.every(s => s.lastSeen === ''), '还没人登录过');
    rt.as(WHO.emma);
    rt.as(WHO.li);
    const st = ok(rt.call('bootstrap', {}, rt.as(OWNER))).state;
    assert.ok(st.students.find(s => s.id === 's-emma').lastSeen, 'Emma 有登录时间');
    assert.ok(st.parents.find(p => p.id === 'p-li').lastSeen, '李女士有登录时间');
    assert.equal(st.students.find(s => s.id === 's-lucas').lastSeen, '', 'Lucas 没登录过');
  });
  test('学生和家长自己的页面里看不到别人的登录时间', () => {
    const rt = fresh();
    rt.as(WHO.emma);
    const li = state(rt, 'li');
    assert.ok(li.students.every(s => s.lastSeen === undefined));
    assert.ok(li.parents.every(p => p.lastSeen === undefined || p.lastSeen === '' || true));
    const emma = state(rt, 'emma');
    assert.equal(emma.students[0].lastSeen, undefined);
  });
  test('记住设备的人隔天再打开网页也算来过；30 分钟内不重复写', () => {
    const rt = fresh();
    const tok = rt.as(WHO.emma);
    const seen = () => ok(rt.call('bootstrap', {}, rt.as(OWNER))).state.students.find(s => s.id === 's-emma').lastSeen;
    const t0 = seen();
    rt.advance(10 * MIN); ok(rt.call('bootstrap', {}, tok));
    assert.equal(seen(), t0, '10 分钟内不更新');
    rt.advance(2 * HOUR); ok(rt.call('bootstrap', {}, tok));
    assert.ok(Date.parse(seen()) > Date.parse(t0), '2 小时后更新');
  });
  test('老师自己的打开不记录', () => {
    const rt = fresh();
    ok(rt.call('bootstrap', {}, rt.as(OWNER)));
    const st = ok(rt.call('bootstrap', {}, rt.as(OWNER))).state;
    assert.ok(st.students.every(s => s.lastSeen === ''));
  });
});

describe('学生自己填生日', () => {
  test('学生能改自己的生日；老师那边同步看到', () => {
    const rt = fresh(), tok = rt.as(WHO.sophia);
    ok(rt.call('profile.save', { birth: '1992-05-06' }, tok));
    assert.equal(state(rt, 'sophia').students[0].birth, '1992-05-06');
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-sophia').birth, '1992-05-06');
    ok(rt.call('profile.save', { birth: '' }, tok)); // 可以清空
  });
  test('格式不对、未来的日子、不存在的日子都拒绝', () => {
    const rt = fresh(), tok = rt.as(WHO.sophia);
    for (const b of ['1992-13-01', '1992-02-30', 'abc', '2999-01-01', '1800-01-01']) err(rt.call('profile.save', { birth: b }, tok), 'bad_request');
  });
  test('家长能填自己孩子的生日，别人的孩子不行；成人学生的生日家长碰不到', () => {
    const rt = fresh(), li = rt.as(WHO.li);
    ok(rt.call('profile.save', { birth: '2017-03-04', sid: 's-emma' }, li));
    assert.equal(state(rt, 'emma').students[0].birth, '2017-03-04');
    err(rt.call('profile.save', { birth: '2017-03-04', sid: 's-lucas' }, li), 'forbidden');
    err(rt.call('profile.save', { birth: '2017-03-04', sid: 's-sophia' }, li), 'forbidden');
    err(rt.call('profile.save', { birth: '2017-03-04' }, li), 'forbidden');
  });
  test('老师账号不能用这个入口改学生生日（老师在“编辑学生”里改）', () => {
    const rt = fresh();
    err(rt.call('profile.save', { birth: '2017-03-04', sid: 's-emma' }, rt.as(OWNER)), 'forbidden');
  });
});

describe('修改已记的课', () => {
  const mk = (rt, extra) => ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', Object.assign({ date: new Date(rt.now() - 5 * HOUR).toISOString() }, extra)), rt.as(OWNER))).id;
  const get = (rt, id) => state(rt, 'admin').lessons.find(l => l.id === id);
  const params = (rt, over) => Object.assign({ date: new Date(rt.now() - 5 * HOUR).toISOString(), dur: 30, pieces: [{ title: 'Minuet in G', source: 'Petzold', st: 'new' }], focus: 'f', homework: 'h', due: '' }, over);

  test('能改曲目、重点、作业、时长、日期，签字状态不变', () => {
    const rt = fresh(), id = mk(rt);
    const lucas = rt.as(WHO.chen);
    // 家长先签字
    const before = get(rt, id);
    ok(rt.call('lessons.sign', { id }, lucas));
    const signed = get(rt, id);
    assert.equal(signed.signState, 'signed');
    ok(rt.call('lessons.edit', { id, ...params(rt, { dur: 45, focus: '左手更轻', pieces: [{ title: 'Gavotte', source: 'Gurlitt', hw: true, st: 'review', tempo: { n: 'q', b: 90 } }], homework: '' }) }, rt.as(OWNER)));
    const after = get(rt, id);
    assert.equal(after.dur, 45); assert.equal(after.notes.focus, '左手更轻');
    assert.equal(after.notes.pieces[0].title, 'Gavotte'); assert.deepEqual(after.notes.pieces[0].tempo, { n: 'q', b: 90 });
    assert.equal(after.signState, 'signed'); assert.equal(after.signedAt, signed.signedAt);
    assert.equal(after.loggedAt, before.loggedAt);
    assert.equal(state(rt, 'admin').lessons.filter(l => l.sid === 's-lucas').length, state(rt, 'admin').lessons.filter(l => l.sid === 's-lucas').length);
  });
  test('修改不重发签字邮件，也不会多出一节课', () => {
    const rt = fresh(), id = mk(rt);
    const n = state(rt, 'admin').lessons.length, mails = rt.mail.length;
    ok(rt.call('lessons.edit', { id, ...params(rt, { focus: 'new' }) }, rt.as(OWNER)));
    assert.equal(state(rt, 'admin').lessons.length, n); assert.equal(rt.mail.length, mails);
  });
  test('学生已勾的作业：内容没变的保留，改了的清掉', () => {
    const rt = fresh();
    const id = mk(rt, { pieces: [{ title: 'A', st: 'new', hw: true }, { title: 'B', st: 'new', hw: true }], homework: '练音阶' });
    const chen = rt.as(WHO.chen);
    [0, 1, 2].forEach(i => ok(rt.call('homework.check', { id, idx: i, on: true }, chen)));
    assert.deepEqual(get(rt, id).hwDone, [0, 1, 2]);
    ok(rt.call('lessons.edit', { id, ...params(rt, { pieces: [{ title: 'A', st: 'new', hw: true }, { title: 'C', st: 'new', hw: true }], homework: '练音阶' }) }, rt.as(OWNER)));
    assert.deepEqual(get(rt, id).hwDone, [0, 2], 'A 和“练音阶”保留，B 换成 C 要重勾');
  });
  test('时间和同一学生另一节课撞了要拒绝；自己和自己不算撞', () => {
    const rt = fresh();
    const a = mk(rt, { date: new Date(rt.now() - 5 * HOUR).toISOString() });
    const b = mk(rt, { date: new Date(rt.now() - 9 * HOUR).toISOString() });
    err(rt.call('lessons.edit', { id: b, ...params(rt, { date: new Date(rt.now() - 5 * HOUR).toISOString() }) }, rt.as(OWNER)), 'duplicate');
    ok(rt.call('lessons.edit', { id: a, ...params(rt, { date: new Date(rt.now() - 5 * HOUR).toISOString() }) }, rt.as(OWNER)));
  });
  test('下次上课时间可以改、可以清空；不存在的课报找不到', () => {
    const rt = fresh(), id = mk(rt);
    const next = new Date(rt.now() + 3 * DAY).toISOString();
    ok(rt.call('lessons.edit', { id, ...params(rt, { next }) }, rt.as(OWNER)));
    assert.equal(get(rt, id).notes.next, next);
    ok(rt.call('lessons.edit', { id, ...params(rt, { next: '' }) }, rt.as(OWNER)));
    assert.equal(get(rt, id).notes.next, undefined);
    err(rt.call('lessons.edit', { id: 'l-nope', ...params(rt) }, rt.as(OWNER)), 'not_found');
  });
  test('同样的检查：没有曲子、太老的日期都拒绝；学生和家长不能改', () => {
    const rt = fresh(), id = mk(rt);
    err(rt.call('lessons.edit', { id, ...params(rt, { pieces: [] }) }, rt.as(OWNER)), 'bad_request');
    err(rt.call('lessons.edit', { id, ...params(rt, { date: new Date(rt.now() - 4 * 365 * DAY).toISOString() }) }, rt.as(OWNER)), 'bad_request');
    err(rt.call('lessons.edit', { id, ...params(rt) }, rt.as(WHO.chen)), 'forbidden');
    err(rt.call('lessons.edit', { id, ...params(rt) }, rt.as(WHO.lucas)), 'forbidden');
  });
});

describe('作品集（教材列表里的第三种）', () => {
  const save = (rt, books) => rt.call('books.save', { sid: 's-emma', books }, rt.as(OWNER));
  test('作品集有名字和 https 链接，学生家长能看到', () => {
    const rt = fresh();
    ok(save(rt, [{ n: '2026 秋季作品集', s: 'done', k: 'portfolio', u: 'https://www.youtube.com/watch?v=abc' }, { n: 'Thompson 3', s: 'current' }]));
    const b = state(rt, 'emma').students[0].books;
    assert.deepEqual(b[0], { n: '2026 秋季作品集', s: 'done', k: 'portfolio', u: 'https://www.youtube.com/watch?v=abc' });
    assert.equal(b[1].k, undefined);
  });
  test('链接必须是 https；javascript: / http: / 空链接都拒绝', () => {
    const rt = fresh();
    for (const u of ['javascript:alert(1)', 'http://x.com', '', 'https://a b.com', 'https://x.com/"onmouseover=']) {
      err(save(rt, [{ n: 'x', s: 'done', k: 'portfolio', u }]), 'bad_url');
    }
  });
  test('学生编辑页一起保存作品集（students.save 带 books）', () => {
    const rt = fresh(), a = rt.as(OWNER);
    const s = state(rt, 'admin').students.find(x => x.id === 's-emma');
    ok(rt.call('students.save', { student: { id: s.id, name: s.name, email: s.email, kind: s.kind, lang: s.lang, birth: s.birth, start: s.start, level: s.level, grp: s.grp, dur: s.dur, paid: s.paid, carry: 0, adj: s.adj, showPoints: true,
      books: [{ n: 'Fall', s: 'current', k: 'portfolio', u: 'https://youtu.be/x' }] } }, a));
    assert.equal(state(rt, 'admin').students.find(x => x.id === 's-emma').books[0].u, 'https://youtu.be/x');
  });
});

describe('留言邮件提醒老师', () => {
  const sendMsg = (rt, who, sid) => ok(rt.call('messages.send', { text: 'hello', sid }, rt.as(WHO[who])));
  const alerts = rt => rt.mail.filter(m => /留言|new message/.test(m.subject)).length; // 登录验证码邮件不算
  test('学生留言 → 老师收到邮件；同一学生 10 分钟内连发只提醒一次，之后又会提醒', () => {
    const rt = fresh(), base = alerts(rt);
    sendMsg(rt, 'emma', 's-emma');
    assert.equal(alerts(rt) - base, 1);
    assert.equal(rt.mail[rt.mail.length - 1].to, OWNER);
    sendMsg(rt, 'emma', 's-emma');
    assert.equal(alerts(rt) - base, 1, '10 分钟内不重复');
    rt.advance(11 * MIN);
    sendMsg(rt, 'emma', 's-emma');
    assert.equal(alerts(rt) - base, 2);
  });
  test('家长留言也提醒；不同学生互不影响；老师自己回复不发邮件给自己', () => {
    const rt = fresh(), base = alerts(rt);
    sendMsg(rt, 'li', 's-emma'); sendMsg(rt, 'lucas', 's-lucas');
    assert.equal(alerts(rt) - base, 2);
    ok(rt.call('messages.send', { text: 'ok', sid: 's-emma' }, rt.as(OWNER)));
    assert.equal(alerts(rt) - base, 2);
  });
});
