'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, al, MIN, HOUR, DAY, fresh, WHO, ok, err } = require('./helpers');

const req = (rt, email, lang) => rt.call('auth.request', { email, lang });
const verify = (rt, email, code, remember) => rt.call('auth.verify', { email, code, remember });
function allCells(rt, sheetName) {
  const sh = rt.sheet(sheetName);
  const out = [];
  for (let r = 1; r <= sh.getLastRow(); r++) for (let c = 1; c <= sh.getLastColumn(); c++) out.push(String(sh._get(r, c)));
  return out;
}

describe('验证码登录', () => {
  test('已注册邮箱：发一封邮件，里面是 6 位码；用它登录成功', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma, 'en'));
    assert.equal(rt.mail.length, 1);
    assert.equal(rt.mail[0].to, WHO.emma);
    assert.match(rt.mail[0].subject, /sign-in code: \d{6}/);
    const code = rt.lastCode(WHO.emma);
    assert.match(code, /^\d{6}$/);
    const d = ok(verify(rt, WHO.emma, code, true));
    assert.equal(d.role, 'student');
    assert.equal(d.token.length, 64);
  });

  test('验证码邮件按登录页的语言发中文或英文', () => {
    const rt = fresh();
    ok(req(rt, WHO.li, 'zh'));
    assert.match(rt.mail[0].subject, /登录验证码/);
  });

  test('验证码和令牌不会以明文留在任何表里，邮件日志里也没有验证码', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma, 'en'));
    const code = rt.lastCode(WHO.emma);
    const token = ok(verify(rt, WHO.emma, code, true)).token;
    for (const sheet of ['Codes', 'Sessions', 'MailLog', 'Config']) {
      const cells = allCells(rt, sheet);
      assert.ok(!cells.some(c => c.includes(token)), sheet + ' 含令牌明文');
      assert.ok(!cells.some(c => c.includes(code) && c !== '' && /^\d{6}$/.test(c)), sheet + ' 含验证码明文');
      assert.ok(!cells.some(c => c.includes('code: ' + code) || c.includes('验证码：' + code)), sheet + ' 日志含验证码');
    }
    assert.equal(allCells(rt, 'MailLog').filter(c => c === '[code]').length, 1);
  });

  test('不认识的邮箱：返回和认识的一样，但不发邮件（不暴露谁注册过）', () => {
    const rt = fresh();
    const known = ok(req(rt, WHO.emma, 'en'));
    const slept0 = rt.slept;
    const unknown = ok(req(rt, 'stranger@example.com', 'en'));
    assert.deepEqual(Object.keys(unknown).sort(), Object.keys(known).sort());
    assert.equal(rt.mail.length, 1, '陌生邮箱不能发信');
    assert.ok(rt.slept - slept0 >= 600, '故意等一会儿，让响应时间接近真的发信');
    err(verify(rt, 'stranger@example.com', '123456'), 'invalid_code');
  });

  test('邮箱格式不对', () => {
    const rt = fresh();
    for (const bad of ['', 'abc', 'a@b', 'a b@c.com', '<x>@y.com', 'a@b.c,d@e.f', null, 123, 'x'.repeat(130) + '@a.com'])
      err(req(rt, bad), 'bad_email');
  });

  test('大小写和空格不影响登录', () => {
    const rt = fresh();
    ok(req(rt, '  ' + WHO.emma.toUpperCase() + ' ', 'en'));
    assert.equal(rt.mail[0].to, WHO.emma);
    assert.equal(ok(verify(rt, WHO.emma.toUpperCase(), rt.lastCode(WHO.emma))).role, 'student');
  });

  test('验证码错 5 次后，即使输对也不行（防暴力猜）', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma));
    const right = rt.lastCode(WHO.emma);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) err(verify(rt, WHO.emma, wrong), 'invalid_code');
    err(verify(rt, WHO.emma, right), 'invalid_code');
  });

  test('验证码只能用一次', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma));
    const code = rt.lastCode(WHO.emma);
    ok(verify(rt, WHO.emma, code));
    err(verify(rt, WHO.emma, code), 'invalid_code');
  });

  test('验证码 10 分钟后失效', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma));
    const code = rt.lastCode(WHO.emma);
    rt.advance(10 * MIN + 1000);
    err(verify(rt, WHO.emma, code), 'invalid_code');
  });

  test('9 分钟内仍然有效', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma));
    const code = rt.lastCode(WHO.emma);
    rt.advance(9 * MIN);
    ok(verify(rt, WHO.emma, code));
  });

  test('重新请求后，旧验证码作废', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma));
    const first = rt.lastCode(WHO.emma);
    ok(req(rt, WHO.emma));
    const second = rt.lastCode(WHO.emma);
    if (first !== second) err(verify(rt, WHO.emma, first), 'invalid_code');
    ok(verify(rt, WHO.emma, second));
  });

  test('验证码格式不对（字母、5 位、对象）直接拒绝', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma));
    for (const bad of ['abcdef', '12345', '1234567', '', null, { $ne: 1 }, ['123456']]) err(verify(rt, WHO.emma, bad), 'invalid_code');
  });
});

describe('限流', () => {
  test('同一邮箱 1 小时最多请求 3 次，第 4 次被拒；1 小时后恢复', () => {
    const rt = fresh();
    for (let i = 0; i < 3; i++) ok(req(rt, WHO.emma));
    err(req(rt, WHO.emma), 'rate_limited');
    assert.equal(rt.mail.length, 3);
    rt.advance(HOUR + MIN);
    ok(req(rt, WHO.emma));
  });

  test('陌生邮箱同样限流（不然能用它刷满表格）', () => {
    const rt = fresh();
    for (let i = 0; i < 3; i++) ok(req(rt, 'nobody@example.com'));
    err(req(rt, 'nobody@example.com'), 'rate_limited');
  });

  test('同一邮箱一天最多 8 次', () => {
    const rt = fresh();
    for (let i = 0; i < 8; i++) { ok(req(rt, WHO.emma)); rt.advance(HOUR + MIN); }
    err(req(rt, WHO.emma), 'rate_limited');
  });

  test('全站每天最多发出 N 封验证码，保住 Gmail 的每日额度', () => {
    const rt = fresh();
    rt.ctx.CODE_GLOBAL_DAY = 3;
    for (const w of ['emma', 'li', 'chen']) ok(req(rt, WHO[w]));
    err(req(rt, WHO.wang), 'rate_limited');
    err(req(rt, 'anyone@example.com'), 'rate_limited'); // 对陌生邮箱的响应和已注册的一致
    rt.advance(DAY + MIN);
    ok(req(rt, WHO.wang));
  });

  test('全站每小时受理请求数有上限', () => {
    const rt = fresh();
    rt.ctx.CODE_GLOBAL_HOUR_REQUESTS = 4;
    for (let i = 0; i < 4; i++) ok(req(rt, `x${i}@example.com`));
    err(req(rt, 'x9@example.com'), 'rate_limited');
  });

  test('Gmail 剩余额度太低时拒绝发码，不把额度用光', () => {
    const rt = fresh();
    rt.mailQuota = 9; // 低于保留线 10
    err(req(rt, WHO.emma), 'mail_unavailable');
    assert.equal(rt.mail.length, 0);
  });

  test('邮件发送失败时报 mail_unavailable，并且之后能重试', () => {
    const rt = fresh();
    rt.mailFail = true;
    err(req(rt, WHO.emma), 'mail_unavailable');
    rt.mailFail = false;
    ok(req(rt, WHO.emma));
  });

  test('超过 3 天的验证码记录会被清理，表不会无限变长', () => {
    const rt = fresh();
    ok(req(rt, WHO.emma));
    assert.equal(rt.sheet('Codes').getLastRow(), 2);
    rt.advance(4 * DAY);
    ok(req(rt, WHO.li));
    assert.equal(rt.sheet('Codes').getLastRow(), 2, '旧记录清掉了，只剩新的');
  });
});

describe('登录状态', () => {
  test('“记住 90 天”：89 天后还有效，91 天后失效', () => {
    const rt = fresh();
    const t = rt.login(WHO.emma, { remember: true });
    rt.advance(89 * DAY);
    ok(rt.call('bootstrap', {}, t));
    rt.advance(2 * DAY);
    err(rt.call('bootstrap', {}, t), 'unauthorized');
  });

  test('不勾“记住我”：一天后失效', () => {
    const rt = fresh();
    const t = rt.login(WHO.emma, { remember: false });
    rt.advance(23 * HOUR);
    ok(rt.call('bootstrap', {}, t));
    rt.advance(2 * HOUR);
    err(rt.call('bootstrap', {}, t), 'unauthorized');
  });

  test('退出登录后令牌立刻作废', () => {
    const rt = fresh();
    const t = rt.login(WHO.emma, { remember: true });
    ok(rt.call('auth.logout', {}, t));
    err(rt.call('bootstrap', {}, t), 'unauthorized');
  });

  test('伪造、截断、改一个字符、缺失的令牌都是未登录', () => {
    const rt = fresh();
    const t = rt.login(WHO.emma, { remember: true });
    const flipped = t.slice(0, 63) + (t[63] === 'a' ? 'b' : 'a');
    for (const bad of [undefined, null, '', 'abc', t.slice(0, 63), t + 'a', flipped, 'x'.repeat(64), { a: 1 }, 12345])
      err(rt.call('bootstrap', {}, bad), 'unauthorized');
  });

  test('同一身份最多保留 10 个登录，超出的挤掉最旧的', () => {
    const rt = fresh();
    const tokens = [];
    for (let i = 0; i < 11; i++) { tokens.push(rt.login(WHO.emma, { remember: true })); rt.advance(DAY + MIN); }
    err(rt.call('bootstrap', {}, tokens[0]), 'unauthorized');
    ok(rt.call('bootstrap', {}, tokens[10]));
    ok(rt.call('bootstrap', {}, tokens[1]));
  });

  test('老师把学生归档后，那位学生手里的令牌立刻失效，也不能再要验证码', () => {
    const rt = fresh();
    const t = rt.login(WHO.emma, { remember: true });
    ok(rt.call('students.archive', { id: 's-emma', active: false }, rt.as(OWNER)));
    err(rt.call('bootstrap', {}, t), 'unauthorized');
    const mails = rt.mail.length;
    ok(req(rt, WHO.emma));
    assert.equal(rt.mail.length, mails, '归档学生收不到验证码');
    ok(rt.call('students.archive', { id: 's-emma', active: true }, rt.as(OWNER)));
    ok(rt.call('bootstrap', {}, t)); // 恢复后原来的登录又能用
  });

  test('改了学生的邮箱，旧登录失效（新邮箱要重新验证）', () => {
    const rt = fresh();
    const t = rt.login(WHO.emma, { remember: true });
    ok(rt.call('students.save', { student: { id: 's-emma', name: 'Emma Li', kind: 'child', email: al('emma2'), paid: 2, carry: 14 } }, rt.as(OWNER)));
    err(rt.call('bootstrap', {}, t), 'unauthorized');
  });

  test('老师邮箱登录成老师；家长邮箱登录成家长', () => {
    const rt = fresh();
    assert.equal(ok(rt.call('bootstrap', {}, rt.as(OWNER))).state.me.role, 'admin');
    assert.equal(ok(rt.call('bootstrap', {}, rt.as(WHO.li))).state.me.role, 'parent');
    assert.equal(ok(rt.call('bootstrap', {}, rt.as(WHO.sophia))).state.me.role, 'student');
  });
});

describe('一个邮箱对应多个身份', () => {
  function withDual(rt) {
    // 让家长“陈先生”的邮箱同时也是学生 Sophia 的邮箱，模拟“既是家长又是学员”
    ok(rt.call('students.save', { student: { id: 's-sophia', name: 'Sophia Zhang', kind: 'adult', email: WHO.chen, paid: 1, carry: 3 } }, rt.as(OWNER)));
  }

  test('验证后返回待选身份；选一个才拿到令牌', () => {
    const rt = fresh(); withDual(rt);
    ok(req(rt, WHO.chen));
    const d = ok(verify(rt, WHO.chen, rt.lastCode(WHO.chen), true));
    assert.equal(d.token, undefined, '选之前没有令牌');
    assert.equal(d.accounts.length, 2);
    assert.deepEqual(d.accounts.map(a => a.role).sort(), ['parent', 'student']);
    const parent = d.accounts.find(a => a.role === 'parent');
    const r = ok(rt.call('auth.choose', { ticket: d.ticket, role: parent.role, id: parent.id }));
    assert.equal(r.role, 'parent');
    assert.deepEqual(ok(rt.call('bootstrap', {}, r.token)).state.me.kids.sort(), ['s-lucas', 's-mia']);
  });

  test('临时凭证只能用一次，且不能选不在名单里的身份（比如老师）', () => {
    const rt = fresh(); withDual(rt);
    ok(req(rt, WHO.chen));
    const d = ok(verify(rt, WHO.chen, rt.lastCode(WHO.chen)));
    err(rt.call('auth.choose', { ticket: d.ticket, role: 'admin', id: OWNER }), 'forbidden');
    err(rt.call('auth.choose', { ticket: d.ticket, role: 'parent', id: 'p-chen' }), 'unauthorized'); // 上一步已消耗
  });

  test('临时凭证 10 分钟后失效', () => {
    const rt = fresh(); withDual(rt);
    ok(req(rt, WHO.chen));
    const d = ok(verify(rt, WHO.chen, rt.lastCode(WHO.chen)));
    rt.advance(10 * MIN + 1000);
    err(rt.call('auth.choose', { ticket: d.ticket, role: 'parent', id: 'p-chen' }), 'unauthorized');
  });

  test('临时凭证不能当登录令牌用', () => {
    const rt = fresh(); withDual(rt);
    ok(req(rt, WHO.chen));
    const d = ok(verify(rt, WHO.chen, rt.lastCode(WHO.chen)));
    err(rt.call('bootstrap', {}, d.ticket), 'unauthorized');
  });
});

describe('测试环境的邮件保护', () => {
  test('测试环境里，发往“不是测试账号别名”的邮箱一律不发，只记日志', () => {
    const rt = fresh();
    ok(rt.call('parents.save', { parent: { name: '真家长', email: 'real.parent@example.com', lang: 'en' } }, rt.as(OWNER)));
    err(req(rt, 'real.parent@example.com'), 'mail_unavailable');
    assert.equal(rt.mail.filter(m => m.to === 'real.parent@example.com').length, 0);
    assert.ok(allCells(rt, 'MailLog').includes('blocked_test_env'));
  });

  test('别名和点号都认：tester+x@gmail.com、t.e.s.ter@gmail.com 视为同一个账号', () => {
    const rt = fresh();
    const b = rt.ctx.baseEmail_;
    assert.equal(b('Tester+emma@Gmail.com'), 'tester@gmail.com');
    assert.equal(b('t.e.s.ter+a@googlemail.com'), 'tester@gmail.com');
    assert.equal(b('tester@example.com'), 'tester@example.com');
    assert.notEqual(b('tester2@gmail.com'), 'tester@gmail.com');
  });

  test('正式环境不设这道限制：可以发给任何邮箱', () => {
    const { createRuntime } = require('./helpers');
    const rt = createRuntime({ owner: 'wife@gmail.com', quiet: true });
    rt.requireLock = true;
    rt.run('setupProd');
    const tok = rt.login('wife@gmail.com');
    ok(rt.call('parents.save', { parent: { name: '家长', email: 'mom@example.com', lang: 'en' } }, tok));
    ok(req(rt, 'mom@example.com', 'en'));
    assert.equal(rt.mail.filter(m => m.to === 'mom@example.com').length, 1);
  });
});
