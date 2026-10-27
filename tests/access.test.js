'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, al, DAY, HOUR, fresh, WHO, ok, err, state, lessonParams } = require('./helpers');

/**
 * 每个操作允许哪些身份调用。新增操作时必须在这里登记，否则“覆盖率”测试会失败，
 * 这样不会有哪个操作漏了权限检查。
 */
const GATES = {
  'auth.request': null, 'auth.verify': null, 'auth.choose': null, 'auth.kid': null,         // 不需要登录
  'auth.logout': ['admin', 'parent', 'student'],
  'bootstrap': ['admin', 'parent', 'student'],
  'profile.save': ['admin', 'parent', 'student'],
  'homework.check': ['parent', 'student'], 'preview.state': ['admin'],
  'notices.read': ['parent', 'student'],
  'messages.send': ['admin', 'parent', 'student'],
  'messages.read': ['admin', 'parent', 'student'],
  'lessons.sign': ['parent', 'student'],
  'tuition.claim': ['parent', 'student'],
  'students.save': ['admin'], 'students.archive': ['admin'], 'parents.save': ['admin'], 'parents.archive': ['admin'],
  'res.begin': ['admin'], 'res.chunk': ['admin'], 'res.finish': ['admin'], 'res.link': ['admin'], 'res.update': ['admin'], 'res.delete': ['admin'],
  'res.get': ['admin', 'parent', 'student'], 'res.seen': ['parent', 'student'],
  'kidcode.set': ['admin'], 'kidcode.clear': ['admin'], 'pairs.set': ['admin'], 'books.save': ['admin'], 'lessons.log': ['admin'], 'lessons.delete': ['admin'],
  'tuition.paid': ['admin'], 'tuition.remind': ['admin'], 'rules.save': ['admin'], 'notices.send': ['admin']
};
const ROLE_WHO = { admin: 'admin', parent: 'li', student: 'emma' };

describe('权限矩阵', () => {
  test('每个已登记的操作都在权限表里（新增操作不会漏掉权限检查）', () => {
    const rt = fresh();
    const registered = Array.from(Object.keys(rt.ctx.actions_())).sort();
    assert.deepEqual(registered, Object.keys(GATES).sort());
  });

  test('没有令牌：除登录相关的 3 个操作外，其余全部是 unauthorized', (t) => {
    const rt = fresh();
    let n = 0;
    for (const [a, roles] of Object.entries(GATES)) {
      if (!roles) continue;
      err(rt.call(a, {}, undefined), 'unauthorized'); n++;
      err(rt.call(a, {}, 'x'.repeat(64)), 'unauthorized'); n++;
    }
    t.diagnostic(`未登录组合 ${n} 个，全部被拒`);
  });

  test('身份不在允许名单里：全部是 forbidden（老师 / 家长 / 学生 × 全部操作）', (t) => {
    const rt = fresh();
    let denied = 0, total = 0;
    for (const [a, roles] of Object.entries(GATES)) {
      if (!roles) continue;
      for (const role of ['admin', 'parent', 'student']) {
        total++;
        if (roles.includes(role)) continue;
        const tok = rt.as(WHO[ROLE_WHO[role]]);
        err(rt.call(a, {}, tok), 'forbidden');
        denied++;
      }
    }
    t.diagnostic(`${Object.keys(GATES).length - 3} 个需登录的操作 × 3 种身份 = ${total} 种组合，其中 ${denied} 个应被拒，全部被拒`);
    assert.ok(denied > 20);
  });

  test('所有写操作都先拿了锁（没有“没加锁就写表”）', () => {
    const rt = fresh();
    const admin = rt.as(OWNER), emma = rt.as(WHO.emma), li = rt.as(WHO.li);
    ok(rt.call('notices.send', { scope: 'all', title: 't', body: 'b' }, admin));
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), admin));
    ok(rt.call('messages.send', { text: 'hi' }, emma));
    ok(rt.call('profile.save', { avatar: { t: 'emoji', v: '🐼', c: '#F6D7B0' } }, li));
    ok(rt.call('notices.read', { ids: ['n-1'] }, emma));
    ok(rt.call('auth.logout', {}, emma));
    assert.deepEqual(rt.lockViolations, []);
    assert.ok(rt.lockAcquired > 6);
  });
});

describe('数据隔离：每个人只拿到自己能看的', () => {
  const OTHERS = {
    emma: ['Sophia', 'Lucas', 'Mia', '王子涵', 'Zihan', 'chen', 'wang', 'sophia', 'lucas', 'zihan'],
    li: ['Sophia', 'Lucas', 'Mia', '王子涵', 'Zihan', 'sophia', 'lucas', 'zihan', 'chen', 'wang'],
    chen: ['Emma', 'Sophia', '王子涵', 'Zihan', 'emma', 'sophia', 'zihan', 'wang', '+li@'],
    sophia: ['Emma', 'Lucas', 'Mia', '王子涵', 'Zihan', 'emma', 'lucas', 'zihan', 'chen', 'wang', '+li@'],
    lucas: ['Emma', 'Sophia', 'Mia', '王子涵', 'Zihan', 'emma', 'sophia', 'zihan', 'wang', '+li@']
  };

  for (const [who, forbidden] of Object.entries(OTHERS)) {
    test(`${who} 的返回数据里不出现别人的姓名和邮箱`, () => {
      const rt = fresh();
      const dump = JSON.stringify(state(rt, who));
      for (const w of forbidden) {
        // 自己家的信息允许出现：先排除允许项
        const allowed = { chen: ['chen'], lucas: [], li: [], emma: [], sophia: [] }[who] || [];
        if (allowed.includes(w)) continue;
        if (who === 'lucas' && w === 'Mia') { /* 兄妹关系不在 Lucas 的数据里 */ }
        assert.ok(!dump.includes(w), `${who} 的数据里出现了 “${w}”`);
      }
    });
  }

  test('学生只看到自己的课、自己的学生资料；家长只看到配对的孩子', () => {
    const rt = fresh();
    const e = state(rt, 'emma');
    assert.deepEqual(e.students.map(s => s.id), ['s-emma']);
    assert.ok(e.lessons.length > 0 && e.lessons.every(l => l.sid === 's-emma'));
    const c = state(rt, 'chen');
    assert.deepEqual(c.students.map(s => s.id).sort(), ['s-lucas', 's-mia']);
    assert.ok(c.lessons.every(l => ['s-lucas', 's-mia'].includes(l.sid)));
    assert.deepEqual(state(rt, 'li').students.map(s => s.id), ['s-emma']);
  });

  test('非老师拿不到 paid/carry（老师才用的内部字段）、其他家长列表、归档学生', () => {
    const rt = fresh();
    for (const who of ['emma', 'li', 'chen', 'sophia']) {
      for (const s of state(rt, who).students) { assert.equal(s.paid, undefined); assert.equal(s.carry, undefined); assert.equal(s.parentIds, undefined); }
    }
    assert.equal(state(rt, 'emma').parents.length, 0);
    assert.deepEqual(state(rt, 'li').parents.map(p => p.id), ['p-li']);
    ok(rt.call('students.archive', { id: 's-mia', active: false }, rt.as(OWNER)));
    assert.deepEqual(state(rt, 'chen').students.map(s => s.id), ['s-lucas'], '归档的孩子对家长不可见');
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-mia').active, false, '老师仍能看到并恢复');
  });

  test('不能代签别人的课：学生签别人的、家长签没配对孩子的，都是 forbidden', () => {
    const rt = fresh();
    const lucasLesson = state(rt, 'admin').lessons.find(l => l.sid === 's-lucas' && l.signState === 'auto' || l.sid === 's-lucas').id;
    const emmaLesson = state(rt, 'emma').lessons.find(l => l.signState === 'pending').id;
    err(rt.call('lessons.sign', { id: lucasLesson }, rt.as(WHO.emma)), 'forbidden');
    err(rt.call('lessons.sign', { id: emmaLesson }, rt.as(WHO.chen)), 'forbidden');
    err(rt.call('lessons.sign', { id: 'nonexistent' }, rt.as(WHO.emma)), 'forbidden');
    err(rt.call('lessons.sign', { id: emmaLesson }, rt.as(OWNER)), 'forbidden', '老师不能代学生签字');
  });

  test('解除配对后，家长立刻看不到那个孩子（令牌不变）', () => {
    const rt = fresh();
    const tok = rt.as(WHO.chen);
    assert.equal(ok(rt.call('bootstrap', {}, tok)).state.students.length, 2);
    ok(rt.call('pairs.set', { pid: 'p-chen', sid: 's-mia', on: false }, rt.as(OWNER)));
    const s = ok(rt.call('bootstrap', {}, tok)).state;
    assert.deepEqual(s.students.map(x => x.id), ['s-lucas']);
    assert.ok(!JSON.stringify(s).includes('Mia'));
    err(rt.call('messages.send', { sid: 's-mia', text: 'x' }, tok), 'forbidden');
  });

  test('新配对后家长立刻能看到', () => {
    const rt = fresh();
    ok(rt.call('pairs.set', { pid: 'p-li', sid: 's-zihan', on: true }, rt.as(OWNER)));
    assert.deepEqual(state(rt, 'li').students.map(s => s.id).sort(), ['s-emma', 's-zihan']);
  });

  test('成人学生不能配家长；已有家长的孩子改成成人也不行', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    err(rt.call('pairs.set', { pid: 'p-li', sid: 's-sophia', on: true }, admin), 'adult_has_parent');
    err(rt.call('students.save', { student: { id: 's-emma', name: 'Emma Li', kind: 'adult', paid: 2, carry: 14 } }, admin), 'adult_has_parent');
  });
});

describe('积分对学生可见性', () => {
  test('关闭积分的学生：服务器根本不返回积分流水', () => {
    const rt = fresh();
    for (const who of ['sophia', 'admin']) assert.equal(state(rt, who).points['s-sophia'], undefined);
    assert.ok(state(rt, 'emma').points['s-emma']);
  });

  test('老师打开某位学生的积分后立即生效，关掉后立即消失', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const base = { id: 's-sophia', name: 'Sophia Zhang', kind: 'adult', email: WHO.sophia, paid: 1, carry: 3 };
    ok(rt.call('students.save', { student: { ...base, showPoints: true } }, admin));
    assert.ok(state(rt, 'sophia').points['s-sophia']);
    ok(rt.call('students.save', { student: { ...base, showPoints: false } }, admin));
    assert.equal(state(rt, 'sophia').points['s-sophia'], undefined);
  });
});

describe('通知和留言的可见范围', () => {
  const send = (rt, extra) => ok(rt.call('notices.send', { title: 'T', body: 'B', ...extra }, rt.as(OWNER)));
  const titles = (rt, who) => state(rt, who).notices.map(n => n.title);

  test('发给全体：学生和家长都收到', () => {
    const rt = fresh();
    send(rt, { scope: 'all', aud: 'both', title: 'ALL-BOTH' });
    for (const w of ['emma', 'li', 'chen', 'sophia']) assert.ok(titles(rt, w).includes('ALL-BOTH'), w);
  });

  test('发给全体但只发学生 / 只发家长', () => {
    const rt = fresh();
    send(rt, { scope: 'all', aud: 'student', title: 'ALL-STU' });
    send(rt, { scope: 'all', aud: 'parent', title: 'ALL-PAR' });
    assert.ok(titles(rt, 'emma').includes('ALL-STU') && !titles(rt, 'emma').includes('ALL-PAR'));
    assert.ok(titles(rt, 'li').includes('ALL-PAR') && !titles(rt, 'li').includes('ALL-STU'));
  });

  test('发给某位学生：只有他和他的家长（按 aud）收到，别人收不到', () => {
    const rt = fresh();
    send(rt, { scope: 'student', sid: 's-emma', aud: 'parent', title: 'EMMA-PAR' });
    send(rt, { scope: 'student', sid: 's-emma', aud: 'student', title: 'EMMA-STU' });
    send(rt, { scope: 'student', sid: 's-emma', aud: 'both', title: 'EMMA-BOTH' });
    assert.deepEqual(titles(rt, 'li').filter(t => t.startsWith('EMMA')).sort(), ['EMMA-BOTH', 'EMMA-PAR']);
    assert.deepEqual(titles(rt, 'emma').filter(t => t.startsWith('EMMA')).sort(), ['EMMA-BOTH', 'EMMA-STU']);
    for (const w of ['chen', 'sophia', 'lucas']) assert.deepEqual(titles(rt, w).filter(t => t.startsWith('EMMA')), [], w);
  });

  test('已读状态按人分开：学生读了，家长仍显示未读；不能替别人标已读', () => {
    const rt = fresh();
    send(rt, { scope: 'student', sid: 's-emma', aud: 'both', title: 'X' });
    const id = state(rt, 'emma').notices.find(n => n.title === 'X').id;
    assert.equal(state(rt, 'emma').notices.find(n => n.id === id).unread, true);
    ok(rt.call('notices.read', { ids: [id] }, rt.as(WHO.emma)));
    assert.equal(state(rt, 'emma').notices.find(n => n.id === id).unread, false);
    assert.equal(state(rt, 'li').notices.find(n => n.id === id).unread, true);
    // Sophia 看不到的通知，即使知道 id 也标不了
    ok(rt.call('notices.read', { ids: [id] }, rt.as(WHO.sophia)));
    const row = rt.ctx.dbAll_ && null; // 触发一次读以确认没有副作用
    const nRow = [...Array(rt.sheet('Notices').getLastRow())].map((_, i) => rt.sheet('Notices').getRange(i + 1, 1, 1, 8).getValues()[0]).find(r => r[0] === id);
    assert.ok(!String(nRow[7]).includes('sophia'));
  });

  test('新通知内容和标题保持原文（页面显示时才转义）', () => {
    const rt = fresh();
    send(rt, { scope: 'all', title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>' });
    const n = state(rt, 'emma').notices[0];
    assert.equal(n.title, '<img src=x onerror=alert(1)>');
  });

  test('留言：学生只在自己的线程里发言（传别人的 sid 也没用）', () => {
    const rt = fresh();
    ok(rt.call('messages.send', { sid: 's-lucas', text: 'hello' }, rt.as(WHO.emma)));
    const mine = state(rt, 'emma').messages;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].sid, 's-emma');
    assert.ok(!state(rt, 'chen').messages.some(m => m.text === 'hello'));
  });

  test('家长看到孩子和老师的整条留言线程；没配对的家长看不到', () => {
    const rt = fresh();
    const chen = state(rt, 'chen').messages;
    assert.deepEqual(chen.map(m => m.sid).sort(), ['s-lucas', 's-lucas', 's-mia']);
    assert.equal(chen.find(m => m.from === 'parent').pname, '陈先生 Mr. Chen');
    assert.equal(state(rt, 'li').messages.length, 0);
  });

  test('成人学生的留言只有他自己和老师看得到', () => {
    const rt = fresh();
    ok(rt.call('messages.send', { text: 'private question' }, rt.as(WHO.sophia)));
    for (const w of ['emma', 'li', 'chen', 'lucas']) assert.ok(!JSON.stringify(state(rt, w)).includes('private question'), w);
    assert.ok(state(rt, 'admin').messages.some(m => m.text === 'private question'));
    err(rt.call('messages.send', { sid: 's-sophia', text: 'x' }, rt.as(WHO.li)), 'forbidden');
  });

  test('家长不能往成人学生或没配对孩子的线程里发言', () => {
    const rt = fresh();
    err(rt.call('messages.send', { sid: 's-emma', text: 'x' }, rt.as(WHO.chen)), 'forbidden');
    err(rt.call('messages.send', { sid: 's-sophia', text: 'x' }, rt.as(WHO.chen)), 'forbidden');
  });

  test('未读红点：学生发 → 老师未读；老师回复 → 学生和家长各自未读，互不影响', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    ok(rt.call('messages.send', { text: 'question' }, rt.as(WHO.emma)));
    assert.equal(state(rt, 'admin').messages.filter(m => m.unread).length, 2, 'Emma 的新留言 + Mia 家长原有的一条');
    ok(rt.call('messages.send', { sid: 's-emma', text: 'answer' }, admin));
    assert.equal(state(rt, 'emma').messages.filter(m => m.unread).length, 1);
    assert.equal(state(rt, 'li').messages.filter(m => m.unread).length, 1);
    ok(rt.call('messages.read', { sid: 's-emma' }, rt.as(WHO.emma)));
    assert.equal(state(rt, 'emma').messages.filter(m => m.unread).length, 0);
    assert.equal(state(rt, 'li').messages.filter(m => m.unread).length, 1, '家长那边仍未读');
    ok(rt.call('messages.read', { sid: 's-emma' }, admin));
    assert.equal(state(rt, 'admin').messages.filter(m => m.sid === 's-emma' && m.unread).length, 0);
  });

  test('留言邮件提醒老师；同一个学生一小时内只提醒一次', () => {
    const rt = fresh();
    const before = rt.mail.length;
    const tok = rt.as(WHO.emma);
    const base = rt.mail.length;
    ok(rt.call('messages.send', { text: 'one' }, tok));
    ok(rt.call('messages.send', { text: 'two' }, tok));
    assert.equal(rt.mail.length - base, 1);
    assert.equal(rt.mail[rt.mail.length - 1].to, OWNER);
    assert.match(rt.mail[rt.mail.length - 1].subject, /Emma Li/);
    rt.advance(61 * 60 * 1000);
    ok(rt.call('messages.send', { text: 'three' }, tok));
    assert.equal(rt.mail.length - base, 2);
  });

  test('留言长度限制', () => {
    const rt = fresh();
    err(rt.call('messages.send', { text: 'x'.repeat(2001) }, rt.as(WHO.emma)), 'too_long');
    err(rt.call('messages.send', { text: '   ' }, rt.as(WHO.emma)), 'bad_request');
  });
});
