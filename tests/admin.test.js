'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, HOUR, fresh, WHO, ok, err, state, lessonParams } = require('./helpers');

const S = (extra = {}) => ({ name: '新同学', kind: 'child', ...extra });

describe('老师：学生管理', () => {
  test('新增学生：默认值正确（不看积分与否按类型、时长 30、无头像、无书）', () => {
    const rt = fresh();
    const id = ok(rt.call('students.save', { student: S() }, rt.as(OWNER))).id;
    const s = state(rt, 'admin').students.find(x => x.id === id);
    assert.equal(s.kind, 'child'); assert.equal(s.dur, 30); assert.equal(s.showPoints, true);
    assert.equal(s.avatar, null); assert.deepEqual(JSON.parse(JSON.stringify(s.books)), []);
    assert.equal(s.paid, 0); assert.equal(s.active, true);
    const a = ok(rt.call('students.save', { student: S({ kind: 'adult' }) }, rt.as(OWNER))).id;
    assert.equal(state(rt, 'admin').students.find(x => x.id === a).showPoints, false, '成人默认不看积分');
  });

  const bad = [
    ['姓名为空', { name: '   ' }, 'bad_request'],
    ['姓名太长', { name: 'x'.repeat(300) }, 'too_long'],
    ['邮箱格式不对', { email: 'not-an-email' }, 'bad_email'],
    ['类型不合法', { kind: 'robot' }, 'bad_request'],
    ['语言不合法', { lang: 'fr' }, 'bad_request'],
    ['生日不是日期', { birth: '2015-13-45' }, 'bad_request'],
    ['生日格式不对', { birth: 'June 9' }, 'bad_request'],
    ['课时长 5', { dur: 5 }, 'bad_request'],
    ['已交期数为负', { paid: -1 }, 'bad_request'],
    ['已交期数是小数', { paid: 1.5 }, 'bad_request'],
    ['已上课数是文字', { carry: 'many' }, 'bad_request']
  ];
  for (const [name, patch, code] of bad) {
    test('拒绝：' + name, () => {
      const rt = fresh();
      const n = rt.sheet('Students').getLastRow();
      err(rt.call('students.save', { student: S(patch) }, rt.as(OWNER)), code);
      assert.equal(rt.sheet('Students').getLastRow(), n);
    });
  }

  test('邮箱统一小写、去空格；已被别的学生用了就拒绝；改自己的不算冲突', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const id = ok(rt.call('students.save', { student: S({ email: '  Tester+NEW@Gmail.com ' }) }, admin)).id;
    assert.equal(state(rt, 'admin').students.find(x => x.id === id).email, 'tester+new@gmail.com');
    err(rt.call('students.save', { student: S({ email: WHO.emma }) }, admin), 'email_taken');
    ok(rt.call('students.save', { student: S({ id, email: 'tester+new@gmail.com', level: '更新' }) }, admin));
  });

  test('修改不存在的学生：not_found', () => {
    const rt = fresh();
    err(rt.call('students.save', { student: S({ id: 's-ghost' }) }, rt.as(OWNER)), 'not_found');
  });

  test('归档：学生不能再登录，已登录的会话立刻失效；恢复后可再登录', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const tok = rt.as(WHO.lucas, { remember: true });
    ok(rt.call('bootstrap', {}, tok));
    ok(rt.call('students.archive', { id: 's-lucas', active: false }, admin));
    err(rt.call('bootstrap', {}, tok), 'unauthorized');
    const sentBefore = rt.mail.filter(m => m.to === WHO.lucas).length;
    const r = rt.call('auth.request', { email: WHO.lucas, lang: 'en' });
    assert.equal(r.ok, true, '不暴露这个邮箱是否有效');
    assert.equal(rt.mail.filter(m => m.to === WHO.lucas).length, sentBefore, '但不会发验证码给已归档账号');
    ok(rt.call('students.archive', { id: 's-lucas', active: true }, admin));
    assert.ok(rt.login(WHO.lucas));
  });

  test('归档家长：家长登录失效；孩子本人不受影响', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const tok = rt.as(WHO.chen, { remember: true });
    ok(rt.call('parents.archive', { id: 'p-chen', active: false }, admin));
    err(rt.call('bootstrap', {}, tok), 'unauthorized');
    assert.ok(rt.login(WHO.lucas), '孩子仍可登录');
  });

  test('改学生邮箱后，旧邮箱登录的会话作废，必须用新邮箱重新登录；旧邮箱不再能登录', () => {
    const rt = fresh();
    const tok = rt.as(WHO.emma, { remember: true });
    ok(rt.call('students.save', { student: { id: 's-emma', name: 'Emma Li', kind: 'child', email: 'tester+emma2@gmail.com', paid: 2, carry: 14 } }, rt.as(OWNER)));
    err(rt.call('bootstrap', {}, tok), 'unauthorized');
    const sentBefore = rt.mail.filter(m => m.to === WHO.emma).length;
    rt.call('auth.request', { email: WHO.emma, lang: 'en' });
    assert.equal(rt.mail.filter(m => m.to === WHO.emma).length, sentBefore, '旧邮箱收不到验证码');
    const me = ok(rt.call('bootstrap', {}, rt.login('tester+emma2@gmail.com'))).state.me;
    assert.equal(me.id, 's-emma');
  });
});

describe('老师：家长、配对、书单', () => {
  test('新增家长：邮箱必填且合法、不能重复；配对后立刻能登录并看到孩子', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    err(rt.call('parents.save', { parent: { name: 'X', email: '' } }, admin), 'bad_email');
    err(rt.call('parents.save', { parent: { name: 'X', email: 'nope' } }, admin), 'bad_email');
    err(rt.call('parents.save', { parent: { name: 'X', email: WHO.li } }, admin), 'email_taken');
    err(rt.call('parents.save', { parent: { name: '', email: 'tester+x@gmail.com' } }, admin), 'bad_request');
    const pid = ok(rt.call('parents.save', { parent: { name: '新家长', email: 'tester+newp@gmail.com', lang: 'en' } }, admin)).id;
    ok(rt.call('pairs.set', { pid, sid: 's-mia', on: true }, admin));
    const s = ok(rt.call('bootstrap', {}, rt.login('tester+newp@gmail.com'))).state;
    assert.deepEqual(s.students.map(x => x.id), ['s-mia']);
  });

  test('配对重复点击只留一条；解除再解除不报错；不存在的 id 报 not_found', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const n = rt.sheet('Pairs').getLastRow();
    ok(rt.call('pairs.set', { pid: 'p-li', sid: 's-emma', on: true }, admin));
    ok(rt.call('pairs.set', { pid: 'p-li', sid: 's-emma', on: true }, admin));
    assert.equal(rt.sheet('Pairs').getLastRow(), n, '已存在的配对不重复写入');
    ok(rt.call('pairs.set', { pid: 'p-li', sid: 's-emma', on: false }, admin));
    ok(rt.call('pairs.set', { pid: 'p-li', sid: 's-emma', on: false }, admin));
    err(rt.call('pairs.set', { pid: 'p-ghost', sid: 's-emma', on: true }, admin), 'not_found');
    err(rt.call('pairs.set', { pid: 'p-li', sid: 's-ghost', on: true }, admin), 'not_found');
  });

  test('一位孩子可以有两位家长，一位家长可以有多个孩子', () => {
    const rt = fresh();
    ok(rt.call('pairs.set', { pid: 'p-wang', sid: 's-emma', on: true }, rt.as(OWNER)));
    assert.ok(state(rt, 'wang').students.some(s => s.id === 's-emma'));
    assert.ok(state(rt, 'li').students.some(s => s.id === 's-emma'));
    assert.equal(state(rt, 'chen').students.length, 2);
  });

  test('书单：保存后学生立刻看到；状态和数量有限制；名字原样保存', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    ok(rt.call('books.save', { sid: 's-emma', books: [{ n: 'Thompson 4', s: 'current' }, { n: '<b>x</b>', s: 'done' }] }, admin));
    assert.deepEqual(JSON.parse(JSON.stringify(state(rt, 'emma').students[0].books)), [{ n: 'Thompson 4', s: 'current' }, { n: '<b>x</b>', s: 'done' }]);
    err(rt.call('books.save', { sid: 's-emma', books: [{ n: 'a', s: 'burning' }] }, admin), 'bad_request');
    err(rt.call('books.save', { sid: 's-emma', books: [{ n: '', s: 'current' }] }, admin), 'bad_request');
    err(rt.call('books.save', { sid: 's-emma', books: Array.from({ length: 41 }, () => ({ n: 'a', s: 'done' })) }, admin), 'bad_request');
    err(rt.call('books.save', { sid: 's-emma', books: 'nope' }, admin), 'bad_request');
    err(rt.call('books.save', { sid: 's-ghost', books: [] }, admin), 'not_found');
    assert.equal(state(rt, 'emma').students[0].books.length, 2, '被拒绝的请求不改书单');
  });
});

describe('头像只收白名单', () => {
  const good = { t: 'emoji', v: '🐼', c: '#F6D7B0' };
  const roles = [['admin', OWNER], ['parent', WHO.li], ['student', WHO.emma]];

  for (const [role, who] of roles) {
    test(role + ' 可以设置和清除头像', () => {
      const rt = fresh();
      const tok = rt.as(who);
      ok(rt.call('profile.save', { avatar: good }, tok));
      const me = ok(rt.call('bootstrap', {}, tok)).state.me;
      assert.deepEqual(JSON.parse(JSON.stringify(me.avatar)), good);
      ok(rt.call('profile.save', { avatar: null }, tok));
      assert.equal(ok(rt.call('bootstrap', {}, tok)).state.me.avatar, null);
    });
  }

  test('拒绝：任意表情、任意颜色、图片地址、脚本、额外字段', () => {
    const rt = fresh();
    const tok = rt.as(WHO.emma);
    const evil = [
      { t: 'emoji', v: '💀', c: '#F6D7B0' }, { t: 'emoji', v: '🐼', c: '#000000' },
      { t: 'img', v: 'https://evil.example/x.png', c: '#F6D7B0' },
      { t: 'emoji', v: '<img src=x onerror=alert(1)>', c: '#F6D7B0' },
      { t: 'emoji', v: '🐼', c: 'red;background:url(//evil)' }, 'string', 42
    ];
    for (const a of evil) err(rt.call('profile.save', { avatar: a }, tok), 'bad_request');
    const saved = ok(rt.call('profile.save', { avatar: { ...good, extra: '<script>' } }, tok));
    const me = ok(rt.call('bootstrap', {}, tok)).state.me;
    assert.deepEqual(Object.keys(me.avatar).sort(), ['c', 't', 'v'], '多余字段被丢掉');
  });
});

describe('邮件内容不会被名字或留言注入', () => {
  const evilName = '<img src=x onerror=alert(1)>Kid';

  test('学生名字含 HTML：记课邮件里被转义，纯文本版保持原样', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    ok(rt.call('students.save', { student: { id: 's-emma', name: evilName, kind: 'child', paid: 2, carry: 14 } }, admin));
    const base = rt.mail.length;
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), admin));
    const m = rt.mail[rt.mail.length - 1];
    assert.ok(rt.mail.length > base);
    assert.ok(!m.htmlBody.includes('<img'), m.htmlBody);
    assert.ok(m.htmlBody.includes('&lt;img'));
    assert.ok(m.body.includes(evilName));
  });

  test('家长留言含 HTML：给老师的提醒邮件里被转义', () => {
    const rt = fresh();
    ok(rt.call('messages.send', { sid: 's-lucas', text: '<script>steal()</script> hi' }, rt.as(WHO.chen)));
    const m = rt.mail[rt.mail.length - 1];
    assert.equal(m.to, OWNER);
    assert.ok(!m.htmlBody.includes('<script>'));
    assert.ok(m.htmlBody.includes('&lt;script&gt;'));
  });

  test('验证码邮件里没有登录链接以外的东西，且登记表不存验证码', () => {
    const rt = fresh();
    rt.login(WHO.emma);
    const code = rt.lastCode(WHO.emma);
    assert.match(code, /^\d{6}$/);
    const log = rt.sheet('MailLog');
    const dump = JSON.stringify(log.data);
    assert.ok(!dump.includes(code), '邮件登记表里不能出现验证码');
    assert.ok(!dump.includes('sign-in code: ' + code));
  });

  test('正式环境才会真发给学生：测试环境发给非测试邮箱会被拦下', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    const base = rt.mail.length;
    ok(rt.call('students.save', { student: { id: 's-sophia', name: 'Sophia', kind: 'adult', email: 'real.person@example.com', paid: 1, carry: 3 } }, admin));
    ok(rt.call('lessons.log', lessonParams(rt, 's-sophia'), admin));
    assert.ok(!rt.mail.slice(base).some(m => m.to === 'real.person@example.com'), '测试环境不能给真人发信');
  });
});

describe('邮件额度保护', () => {
  test('剩余额度低于保底线时，不再发学生邮件（留给老师自己的 Gmail）', () => {
    const rt = fresh();
    const admin = rt.as(OWNER);
    rt.mailQuota = rt.mail.length + 9; // 剩 9，低于保底 10
    const base = rt.mail.length;
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), admin));
    assert.equal(rt.mail.length, base);
  });
});
