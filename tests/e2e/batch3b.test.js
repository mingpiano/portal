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



describe('孩子登录码', () => {
  test('老师给没有邮箱的孩子生成登录码 → 孩子用名字 + 码登录 → 老师重新生成后旧码失效', async () => {
    const t = await newPage(); await login(t, OWNER);
    await tab(t, 'students');
    await t.click('[data-act=student-edit][data-id="s-mia"]');
    await t.click('[data-act=kidcode-make]');
    await t.waitForSelector('#kid-code-show');
    const code = (await t.locator('#kid-code-show').innerText()).replace(/\D/g, '');
    assert.match(code, /^\d{8}$/);
    assert.match(await t.locator('.kid-code').innerText(), /Mia Chen/);

    const k = await newPage();
    await k.click('[data-act=login-kid]');
    await k.fill('#kid-name', 'mia chen');
    await k.fill('#kid-code', '1234abcd'); // 只留数字
    assert.equal(await k.inputValue('#kid-code'), '1234');
    await k.fill('#kid-code', code);
    await k.click('form[data-form=login-kid] button[type=submit]');
    await k.waitForSelector('.tabs');
    assert.match(await bodyText(k), /Mia/);
    assert.equal(await k.$('.tab[data-tab="students"]'), null);
    assert.deepEqual(k.errors, []);

    // 关闭窗口后看不到码；重新生成（要确认），旧码失效
    await t.click('.kid-code ~ .btns [data-act=close]');
    assert.equal(await t.$('#kid-code-show'), null);
    await t.click('[data-act=student-edit][data-id="s-mia"]');
    await t.click('[data-act=kidcode-make]');
    await t.click('[data-act=confirm-yes]');
    await t.waitForSelector('#kid-code-show');
    const code2 = (await t.locator('#kid-code-show').innerText()).replace(/\D/g, '');
    assert.notEqual(code2, code);
    const k2 = await newPage();
    await k2.click('[data-act=login-kid]');
    await k2.fill('#kid-name', 'Mia Chen'); await k2.fill('#kid-code', code);
    await k2.click('form[data-form=login-kid] button[type=submit]');
    await k2.waitForSelector('.err');
    assert.match(await k2.locator('.err').innerText(), /不对|错|invalid|incorrect|wrong/i);
    assert.equal(await k2.inputValue('#kid-name'), 'Mia Chen', '名字不丢');
    assert.deepEqual(t.errors, []);
  });

  test('登录页：孩子登录的入口中英文都有，手机宽度没有横向滚动条', async () => {
    const p = await newPage({ mobile: true });
    await p.click('[data-act=login-kid]');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await p.click('[data-act=login-back]'); await p.click('[data-act=lang]');
    assert.match(await bodyText(p), /Sign in with a login code/);
  });
});
