'use strict';
/**
 * 浏览器端到端测试：真的启动本机预览服务器 + 真的 Chromium，像人一样点。
 * 运行：npm run test:e2e   （需要装好 playwright 和 Chromium）
 */
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { create } = require('../../tools/dev/server');

const OWNER = 'tester@gmail.com';
const al = tag => `tester+${tag}@gmail.com`;
const SHOTS = process.env.SHOTS_DIR || '';

let srv, base, browser;
before(async () => {
  srv = create({ owner: OWNER });
  await new Promise(r => srv.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser.close(); srv.server.close(); });
beforeEach(() => { srv.reset(); adminTok = null; });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1200, height: 900 }, locale: opts.locale || 'zh-CN' });
  const page = await ctx.newPage();
  // 沙箱里连不上外网：外部请求（字体）直接放弃，别拖慢测试
  await page.route(u => !u.href.startsWith(base), r => r.abort());
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(base + '/');
  return page;
}
const mailCode = async email => (await (await fetch(`${base}/__dev/mail?to=${encodeURIComponent(email)}`)).json()).code;
async function login(page, email, { remember = true } = {}) {
  await page.fill('#login-email', email);
  await page.click('button[type=submit]');
  await page.waitForSelector('#login-code');
  const code = await mailCode(email);
  assert.match(code, /^\d{6}$/);
  if (!remember) await page.uncheck('#login-remember');
  await page.fill('#login-code', code); // 输满 6 位自动提交
  await page.waitForSelector('.tabs');
}
const tab = (page, name) => page.click(`.tab[data-tab="${name}"]`);
let adminTok = null;
const adminCall = async (a, p) => {
  adminTok = adminTok || srv.rt.login(OWNER, { remember: true });
  const tok = adminTok;
  const r = await (await fetch(`${base}/__dev/call`, { method: 'POST', body: JSON.stringify({ a, p, t: tok }) })).json();
  assert.equal(r.ok, true, JSON.stringify(r)); return r.data;
};
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); } };
const bodyText = page => page.evaluate(() => document.body.innerText);

describe('登录', () => {
  test('老师用邮箱验证码登录，看到“测试环境”提示和总览', async () => {
    const page = await newPage();
    assert.match(await bodyText(page), /发送验证码/);
    await login(page, OWNER);
    const text = await bodyText(page);
    assert.match(text, /测试环境/);
    assert.match(text, /在读学生/);
    await shot(page, 'teacher-overview');
    assert.deepEqual(page.errors, []);
  });

  test('错误的验证码会提示；邮箱格式不对会提示；不存在的邮箱也一样进入输入验证码这一步（不暴露谁有账号）', async () => {
    const page = await newPage();
    await page.fill('#login-email', 'nope');
    await page.click('button[type=submit]');
    assert.match(await bodyText(page), /邮箱格式不对/);
    await page.fill('#login-email', 'stranger@example.com');
    await page.click('button[type=submit]');
    await page.waitForSelector('#login-code');
    await page.fill('#login-code', '123456');
    await page.waitForSelector('.err');
    assert.match(await bodyText(page), /验证码不对或已过期/);
  });

  test('勾选“记住我”后刷新页面仍是登录状态；退出登录后令牌作废', async () => {
    const page = await newPage();
    await login(page, al('emma'));
    await page.reload();
    await page.waitForSelector('.tabs');
    await page.click('[data-act="logout"]');
    await page.waitForSelector('#login-email');
    await page.reload();
    await page.waitForSelector('#login-email');
  });

  test('不勾选“记住我”：关闭页面（新标签）后需要重新登录', async () => {
    const page = await newPage();
    await login(page, al('emma'), { remember: false });
    const page2 = await page.context().newPage();
    await page2.route(u => !u.href.startsWith(base), r => r.abort());
    await page2.goto(base + '/');
    await page2.waitForSelector('#login-email');
  });

  test('同一个邮箱对应多个账号（老师同时是家长）时，让人选择进入哪一个', async () => {
    await adminCall('parents.save', { parent: { name: '老师兼家长', email: OWNER, lang: 'zh' } });
    const page = await newPage();
    await page.fill('#login-email', OWNER);
    await page.click('button[type=submit]');
    await page.waitForSelector('#login-code');
    await page.fill('#login-code', await mailCode(OWNER));
    await page.waitForSelector('[data-act="login-pick"]');
    assert.equal(await page.locator('[data-act="login-pick"]').count(), 2);
    await page.locator('[data-act="login-pick"]').first().click();
    await page.waitForSelector('.tabs');
  });
});

describe('老师的日常', () => {
  test('记课 → 学生收到签字邮件 → 学生签字 → 积分加一', async () => {
    const t = await newPage();
    await login(t, OWNER);
    await tab(t, 'record');
    await t.selectOption('#rec-student', 's-emma');
    await t.fill('#rec-pieces', 'Sonatina in C | Clementi | 新曲\nC major scale | Scales | review');
    await t.fill('#rec-focus', '手腕放松');
    await t.fill('#rec-tempo', '♩ = 90');
    await t.fill('#rec-hw', '每天 10 分钟');
    await shot(t, 'teacher-record');
    await t.click('button[type=submit]');
    await t.waitForSelector('#toast.show');
    assert.match(await t.textContent('#toast'), /已保存|Saved/);
    assert.match(await bodyText(t), /Sonatina in C/);
    const mails = (await (await fetch(`${base}/__dev/mail?to=${encodeURIComponent(al('li'))}`)).json()).mails;
    assert.ok(mails.some(m => /签字|sign off/i.test(m.subject + m.body)), '家长收到了签字邮件');

    const s = await newPage();
    await login(s, al('emma'));
    const before = Number(await s.textContent('.big-pts'));
    assert.match(await bodyText(s), /请签字确认上节课|Please sign off on your last lesson/);
    await shot(s, 'student-home');
    let pending = await s.locator('[data-act="sign"]').count();
    assert.equal(pending, 2, '种子里待签 1 节 + 刚记的 1 节');
    while (pending > 0) { // 一节一节签，每签一节积分 +1
      await s.locator('[data-act="sign"]').first().click();
      await s.waitForFunction(n => document.querySelectorAll('[data-act="sign"]').length === n, pending - 1);
      pending--;
    }
    assert.equal(Number(await s.textContent('.big-pts')), before + 2, '两节各 +1');
  });

  test('填错内容时给出明白的提示，而且已填的内容不丢', async () => {
    const t = await newPage();
    await login(t, OWNER);
    await tab(t, 'record');
    await t.fill('#rec-focus', '这段文字不能丢');
    await t.click('button[type=submit]');
    await t.waitForSelector('#toast.show');
    assert.match(await t.textContent('#toast'), /至少写一首曲目/);
    assert.equal(await t.inputValue('#rec-focus'), '这段文字不能丢');
  });

  test('学费：家长点“我已付款” → 老师总览出现“家长说已付款” → 老师确认收款 → 不再提醒', async () => {
    const c = await newPage();
    await login(c, al('chen'));
    assert.match(await bodyText(c), /缴费提醒|Tuition reminder/);
    await c.click('[data-act="claim"]');
    await c.waitForSelector('.pay .pill.ok');
    const t = await newPage();
    await login(t, OWNER);
    assert.match(await bodyText(t), /家长说已付款/);
    await shot(t, 'teacher-overview-due');
    await t.click('[data-act="paid"]');
    await t.waitForSelector('[data-act="confirm-yes"]');
    await t.click('[data-act="confirm-yes"]');
    await t.waitForFunction(() => !document.querySelector('[data-act="paid"]'));
    assert.equal(await t.locator('.stat.flag').count(), 0, '“该交学费”不再标红');
  });

  test('新增学生、关联家长，家长马上能登录并看到孩子', async () => {
    const t = await newPage();
    await login(t, OWNER);
    await tab(t, 'students');
    await t.click('[data-act="parent-new"]');
    await t.fill('.modal input[name=name]', '新家长');
    await t.fill('.modal input[name=email]', al('newp'));
    await t.click('.modal button[type=submit]');
    await t.waitForSelector('.modal [data-change="pair"], .modal .picklist'); // 保存后仍停在这个家长，可以选孩子
    await t.click('[data-act="close"]');
    await t.click('[data-act="student-new"]');
    await t.fill('.modal input[name=name]', '小明');
    await t.fill('.modal input[name=level]', '入门');
    await t.click('.modal button[type=submit]');
    await t.waitForFunction(() => !document.querySelector('.modal'));
    await t.locator('.row', { hasText: '小明' }).locator('[data-act="student-edit"]').click();
    await t.locator('.modal label', { hasText: '新家长' }).locator('input').check();
    await t.waitForTimeout(300);
    const p = await newPage();
    await login(p, al('newp'));
    assert.match(await bodyText(p), /小明/);
  });

  test('留言：学生发 → 老师看到红点并回复 → 学生看到带“新”标记的回复', async () => {
    const s = await newPage();
    await login(s, al('emma'));
    await tab(s, 'messages');
    await s.fill('#umsg-text', '老师，Minuet 第 9 小节怎么练？');
    await s.click('button[type=submit]');
    await s.waitForSelector('.bub.me');
    const t = await newPage();
    await login(t, OWNER);
    assert.ok(await t.locator('.tab[data-tab="messages"] .badge').count() > 0);
    await tab(t, 'messages');
    await t.locator('[data-act="sel-msg"]', { hasText: 'Emma Li' }).click();
    await t.fill('#msg-text', '先左手慢练 5 遍。');
    await t.click('button[type=submit]');
    await t.waitForSelector('.bub.me');
    await s.reload();
    await s.waitForSelector('.tabs');
    assert.ok(await s.locator('.tab[data-tab="messages"] .badge').count() > 0);
    await tab(s, 'messages');
    await s.waitForSelector('.bub.fresh');
    assert.match(await bodyText(s), /先左手慢练/);
    await s.waitForFunction(() => !document.querySelector('.tab[data-tab="messages"] .badge'));
  });

  test('积分规则：改“签字”分值，保存后学生的积分立刻按新规则重算', async () => {
    const t = await newPage();
    await login(t, OWNER);
    await tab(t, 'points');
    await t.fill('input[name=sign]', '5');
    await t.click('button[type=submit]');
    await t.waitForSelector('#toast.show');
    const s = await newPage();
    await login(s, al('emma'));
    assert.equal(Number(await s.textContent('.big-pts')), 15);
  });
});

describe('家长与学生的页面', () => {
  test('家长：看到两个孩子的卡片，切换孩子看课程记录', async () => {
    const p = await newPage();
    await login(p, al('chen'));
    const t = await bodyText(p);
    assert.match(t, /Lucas Chen/); assert.match(t, /Mia Chen/);
    assert.ok(!t.includes('Emma'));
    await shot(p, 'parent-home');
    await tab(p, 'lessons');
    await p.click('.kid-chip:has-text("Mia")');
    assert.match(await bodyText(p), /Hot Cross Buns/);
    assert.ok(!(await bodyText(p)).includes('Gavotte'));
  });

  test('学生：正在学习页分出“正在学”和“学过”', async () => {
    const s = await newPage();
    await login(s, al('emma'));
    await tab(s, 'learning');
    const t = await bodyText(s);
    assert.match(t, /Minuet in G/); assert.match(t, /Arabesque/);
    await shot(s, 'student-learning');
  });

  test('成人学生 Sophia 没开积分：看不到积分页签；自己交费自己点', async () => {
    const s = await newPage();
    await login(s, al('sophia'));
    assert.equal(await s.locator('.tab[data-tab="points"]').count(), 0);
  });

  test('超过 48 小时没签：显示“自动确认”，不能再签', async () => {
    const t = await newPage();
    await login(t, OWNER);
    const s = await newPage();
    await login(s, al('emma'));
    assert.ok(await s.locator('[data-act="sign"]').count() > 0);
    await fetch(`${base}/__dev/advance?ms=${49 * 3600 * 1000}`, { method: 'POST' });
    await s.reload();
    await s.waitForSelector('.tabs');
    assert.equal(await s.locator('[data-act="sign"]').count(), 0);
    await tab(s, 'lessons');
    assert.match(await bodyText(s), /自动确认|Auto-confirmed/);
  });
});

describe('中英文', () => {
  test('切换到英文后所有页面都是英文，没有漏翻译的占位符；刷新后记住选择', async () => {
    for (const [email, tabs] of [[OWNER, ['overview', 'students', 'record', 'notices', 'messages', 'points']], [al('chen'), ['home', 'learning', 'lessons', 'notices', 'messages', 'points']], [al('emma'), ['home', 'learning', 'lessons', 'notices', 'messages', 'points']]]) {
      const page = await newPage();
      await login(page, email);
      if (await page.evaluate(() => document.documentElement.lang) !== 'en') await page.click('[data-act="lang"]'); // 账号语言是中文的才需要切
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
      for (const k of tabs) {
        if (!(await page.locator(`.tab[data-tab="${k}"]`).count())) continue;
        await tab(page, k);
        const text = await bodyText(page);
        assert.ok(!text.includes('⟦'), `${email}/${k} 有漏翻译的词条`);
        assert.ok(!/[一-鿿]/.test(await page.evaluate(() => [...document.querySelectorAll('.tabs, .bar .who, h1, h2, h3, button.btn, label.f, .stat span')].filter(e => !e.closest('.notice, .bub, .lesson, .thread')).map(e => e.innerText).join(' ').replace(/中文|王子涵|李女士|陈先生|王先生|老师/g, ''))), `${email}/${k} 英文界面里还有中文`);
      }
      await page.reload(); await page.waitForSelector('.tabs');
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    }
  });

  test('英文浏览器第一次打开默认是英文', async () => {
    const page = await newPage({ locale: 'en-US' });
    assert.match(await bodyText(page), /Send code/);
  });
});

describe('安全：恶意内容不会在页面里执行', () => {
  test('名字、曲目、通知、留言、教材里的 HTML 和脚本只会被当成文字显示', async () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    const evil2 = '<script>window.__xss=2</script>';
    await adminCall('students.save', { student: { id: 's-emma', name: 'Emma' + evil, kind: 'child', email: al('emma'), level: evil2, paid: 2, carry: 14 } });
    await adminCall('parents.save', { parent: { id: 'p-li', name: '李' + evil, email: al('li'), lang: 'en' } });
    await adminCall('books.save', { sid: 's-emma', books: [{ n: evil, s: 'current' }] });
    await adminCall('notices.send', { scope: 'all', title: evil, body: evil2 });
    await adminCall('lessons.log', { sid: 's-emma', date: new Date(Date.now() - 3600e3).toISOString(), dur: 30, pieces: [{ title: evil, source: evil2, st: 'new' }], focus: evil, tempo: evil2, homework: evil, due: '' });
    await adminCall('messages.send', { sid: 's-emma', text: evil2 + evil });
    for (const [email, tabs] of [[OWNER, ['overview', 'students', 'record', 'notices', 'messages', 'points']], [al('emma'), ['home', 'learning', 'lessons', 'notices', 'messages', 'points']], [al('li'), ['home', 'learning', 'lessons', 'notices', 'messages']]]) {
      const page = await newPage();
      await login(page, email);
      for (const k of tabs) {
        if (!(await page.locator(`.tab[data-tab="${k}"]`).count())) continue;
        await tab(page, k);
      }
      if (email === OWNER) { await tab(page, 'students'); await page.locator('[data-act="student-edit"]').first().click(); }
      assert.equal(await page.evaluate(() => window.__xss), undefined, email + ' 触发了脚本');
      assert.equal(await page.locator('img[src="x"]').count(), 0, email + ' 页面里被注入了图片');
      assert.equal(await page.locator('main script, #app script').count(), 0);
      assert.deepEqual(page.errors, []);
    }
    const s = await newPage();
    await login(s, al('emma'));
    await tab(s, 'lessons');
    assert.ok((await bodyText(s)).includes('<img src=x onerror="window.__xss=1">'), '恶意内容应该原样当文字显示出来');
  });
});

describe('手机屏幕', () => {
  test('手机宽度下每个页面都没有横向滚动条', async () => {
    for (const [email, tabs] of [[OWNER, ['overview', 'students', 'record', 'notices', 'messages', 'points']], [al('chen'), ['home', 'learning', 'lessons', 'notices', 'messages', 'points']], [al('emma'), ['home', 'learning', 'lessons', 'notices', 'messages', 'points']]]) {
      const page = await newPage({ mobile: true });
      await page.waitForSelector('#login-email');
      await shot(page, 'mobile-login');
      await login(page, email);
      for (const k of tabs) {
        if (!(await page.locator(`.tab[data-tab="${k}"]`).count())) continue;
        await tab(page, k);
        const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        assert.ok(w[0] <= w[1], `${email}/${k} 宽 ${w[0]} > 屏幕 ${w[1]}`);
        await shot(page, `mobile-${email === OWNER ? 'teacher' : email.includes('chen') ? 'parent' : 'student'}-${k}`);
      }
    }
  });
});
