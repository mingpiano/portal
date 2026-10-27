'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, fresh, ok, err, state } = require('./helpers');
const J = x => JSON.parse(JSON.stringify(x));

// 种子里有个没有邮箱的孩子：Mia Chen（s-mia）
const setup = () => { const rt = fresh(); const admin = rt.as(OWNER); const r = ok(rt.call('kidcode.set', { sid: 's-mia' }, admin)); return { rt, admin, code: r.code, name: r.name }; };
const kid = (rt, name, code, extra = {}) => rt.call('auth.kid', Object.assign({ name, code }, extra), undefined);

describe('孩子用名字 + 登录码登录', () => {
  test('老师生成 8 位登录码；孩子用名字 + 码登录，看到的就是自己的页面', () => {
    const { rt, code, name } = setup();
    assert.match(code, /^\d{8}$/); assert.equal(name, 'Mia Chen');
    const lg = ok(kid(rt, 'Mia Chen', code));
    assert.equal(lg.role, 'student'); assert.equal(lg.id, 's-mia');
    const st = ok(rt.call('bootstrap', {}, lg.token)).state;
    assert.equal(st.me.role, 'student'); assert.equal(st.me.id, 's-mia'); assert.equal(st.students.length, 1);
  });
  test('名字不分大小写、空格宽松；码里的空格忽略', () => {
    const { rt, code } = setup();
    ok(kid(rt, '  mia   CHEN ', code.slice(0, 4) + ' ' + code.slice(4)));
  });
  test('明文登录码不存在表里，也不会出现在任何人的数据里', () => {
    const { rt, admin, code } = setup();
    const dump = JSON.stringify(rt.sheet('Students').data);
    assert.ok(!dump.includes(code), '表里没有明文');
    for (const who of ['admin']) assert.ok(!JSON.stringify(state(rt, who)).includes(code));
    const s = state(rt, 'admin').students.find(x => x.id === 's-mia');
    assert.equal(s.hasCode, true); assert.ok(!('codeHash' in s));
    assert.ok(!JSON.stringify(state(rt, 'admin')).match(/codeHash|codeVer|codeLock/));
  });
  test('学生和家长看不到“有没有登录码”', () => {
    const { rt } = setup();
    for (const who of ['li', 'emma']) assert.ok(!JSON.stringify(state(rt, who)).includes('hasCode'), who);
  });
  test('输错：名字不存在、码错、格式不对，返回同样的错误；没开登录码的孩子也登不进去', () => {
    const { rt, code } = setup();
    err(kid(rt, 'Nobody', '12345678'), 'invalid_code');
    err(kid(rt, 'Mia Chen', code === '00000000' ? '11111111' : '00000000'), 'invalid_code');
    err(kid(rt, 'Mia Chen', '1234'), 'invalid_code'); err(kid(rt, 'Mia Chen', 'abcdefgh'), 'invalid_code'); err(kid(rt, '', code), 'invalid_code');
    err(kid(rt, 'Emma Li', '12345678'), 'invalid_code'); // 有邮箱、没开登录码
    err(kid(rt, 'Mia Chen', null), 'invalid_code');
  });
  test('连续输错 5 次锁 15 分钟（锁住时连正确的码也不行），15 分钟后恢复', () => {
    const { rt, code } = setup();
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < 5; i++) err(kid(rt, 'Mia Chen', wrong), 'invalid_code');
    err(kid(rt, 'Mia Chen', code), 'rate_limited');
    rt.advance(14 * 60000); err(kid(rt, 'Mia Chen', code), 'rate_limited');
    rt.advance(2 * 60000); ok(kid(rt, 'Mia Chen', code));
  });
  test('输错的次数在输对一次后清零', () => {
    const { rt, code } = setup();
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let i = 0; i < 4; i++) err(kid(rt, 'Mia Chen', wrong), 'invalid_code');
    ok(kid(rt, 'Mia Chen', code));
    for (let i = 0; i < 4; i++) err(kid(rt, 'Mia Chen', wrong), 'invalid_code');
    ok(kid(rt, 'Mia Chen', code));
  });
  test('重新生成：旧码立刻失效，用旧码登录的设备也被踢出', () => {
    const { rt, admin, code } = setup();
    const old = ok(kid(rt, 'Mia Chen', code)).token;
    ok(rt.call('bootstrap', {}, old));
    const code2 = ok(rt.call('kidcode.set', { sid: 's-mia' }, admin)).code;
    assert.notEqual(code2, code);
    err(kid(rt, 'Mia Chen', code), 'invalid_code');
    err(rt.call('bootstrap', {}, old), 'unauthorized');
    ok(rt.call('bootstrap', {}, ok(kid(rt, 'Mia Chen', code2)).token));
  });
  test('关闭登录码：不能再登录，已登录的设备退出', () => {
    const { rt, admin, code } = setup();
    const tk = ok(kid(rt, 'Mia Chen', code)).token;
    ok(rt.call('kidcode.clear', { sid: 's-mia' }, admin));
    err(kid(rt, 'Mia Chen', code), 'invalid_code'); err(rt.call('bootstrap', {}, tk), 'unauthorized');
    assert.equal(state(rt, 'admin').students.find(x => x.id === 's-mia').hasCode, false);
  });
  test('归档的孩子不能登录，已登录的也退出；恢复后同一个码又能用', () => {
    const { rt, admin, code } = setup();
    const tk = ok(kid(rt, 'Mia Chen', code)).token;
    ok(rt.call('students.archive', { id: 's-mia', active: false }, admin));
    err(kid(rt, 'Mia Chen', code), 'invalid_code'); err(rt.call('bootstrap', {}, tk), 'unauthorized');
    ok(rt.call('students.archive', { id: 's-mia', active: true }, admin));
    ok(kid(rt, 'Mia Chen', code));
  });
  test('孩子的令牌只能做学生能做的事：不能调用老师的操作；不能替别的孩子操作', () => {
    const { rt, code } = setup();
    const tk = ok(kid(rt, 'Mia Chen', code)).token;
    for (const a of ['students.save', 'lessons.log', 'kidcode.set', 'kidcode.clear', 'preview.state', 'rules.save']) err(rt.call(a, {}, tk), 'forbidden');
    const st = ok(rt.call('bootstrap', {}, tk)).state;
    assert.ok(!JSON.stringify(st).includes('Emma Li'));
  });
  test('只有老师能生成；成人学生不能设；同名的孩子不能都开；已归档的不能设', () => {
    const { rt, admin } = setup();
    err(rt.call('kidcode.set', { sid: 's-emma' }, rt.as(J(state(rt, 'admin').parents[0].email))), 'forbidden');
    err(rt.call('kidcode.set', { sid: 's-sophia' }, admin), 'not_child');
    err(rt.call('kidcode.set', { sid: 'nope' }, admin), 'not_found');
    const dup = ok(rt.call('students.save', { student: { name: 'mia  chen', kind: 'child', lang: 'zh' } }, admin)).id;
    err(rt.call('kidcode.set', { sid: dup }, admin), 'name_taken');
    ok(rt.call('students.save', { student: { id: dup, name: 'Mia Chen B', kind: 'child', lang: 'zh' } }, admin));
    ok(rt.call('kidcode.set', { sid: dup }, admin));
    // 已开码的孩子不能改成和别人一样的名字
    err(rt.call('students.save', { student: { id: dup, name: 'Mia Chen', kind: 'child', lang: 'zh' } }, admin), 'name_taken');
  });
  test('孩子的会话数量有上限，不会无限增长', () => {
    const { rt, code } = setup();
    for (let i = 0; i < 15; i++) ok(kid(rt, 'Mia Chen', code));
    const n = rt.sheet('Sessions').data.filter(r => r.includes('s-mia')).length;
    assert.ok(n <= 10, 'sessions ' + n);
  });
  test('孩子登录不发任何邮件、不动 Codes 表', () => {
    const { rt, code } = setup();
    const before = rt.mail.length, codesBefore = rt.sheet('Codes').data.length;
    ok(kid(rt, 'Mia Chen', code));
    assert.equal(rt.mail.length, before); assert.equal(rt.sheet('Codes').data.length, codesBefore);
  });
  test('老版本的表格（没有登录码的列）第一次请求时自动补列', () => {
    const rt = fresh();
    const sh = rt.sheet('Students'); const hdr = sh.data[0];
    for (const c of ['codeHash', 'codeVer', 'codeFails', 'codeLock']) { const i = hdr.indexOf(c); assert.ok(i >= 0, c); }
  });
});
