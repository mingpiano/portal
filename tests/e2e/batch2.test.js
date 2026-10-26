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



describe('批次二：多曲目、速度、作业标记', () => {
  test('记 3 首曲子：作业 + 要录视频 / 作业 / 不是作业；学生看到速度、视频提示，不是作业的进入“学过”', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'record');
    await page.selectOption('#rec-student', 's-emma');
    await page.selectOption('#rec-count', '3');
    assert.equal(await page.locator('.prow').count(), 3);
    await page.fill('#rp0-title', 'Arabesque'); await page.fill('#rp0-t-b', '80');
    await page.selectOption('#rp0-h-n', 'e'); await page.fill('#rp0-h-b', '120'); await page.check('#rp0-vid');
    await page.fill('#rp1-title', 'Czerny 40'); await page.selectOption('#rp1-st', 'review');
    await page.fill('#rp2-title', 'Gavotte Z'); await page.selectOption('#rp2-hw', 'no');
    assert.equal(await page.locator('#rp2-vid').count(), 0, '不是作业时没有视频选项');
    assert.equal(await page.inputValue('#rp0-title'), 'Arabesque', '切换时已填内容不丢');
    await page.fill('#rec-hw', '音阶 5 遍');
    await page.click('form[data-form=rec-save] button[type=submit]');
    await page.waitForFunction(() => document.querySelectorAll('.prow').length === 1 && !document.querySelector('#rp0-title').value);
    assert.match(await bodyText(page), /Arabesque/);
    assert.deepEqual(page.errors, []);

    const s = await newPage(); await login(s, al('emma'));
    await tab(s, 'homework');
    const txt = await bodyText(s);
    assert.match(txt, /Arabesque/); assert.match(txt, /♪ = 120/); assert.match(txt, /视频|video/i);
    assert.match(txt, /Czerny 40/); assert.match(txt, /音阶 5 遍/);
    assert.ok(!/Gavotte Z/.test(await s.locator('.hwchecks').first().innerText()), '不是作业的曲子不在作业清单里');
    await tab(s, 'learning');
    assert.match(await s.locator('main').innerText(), /Gavotte Z/);
  });

  test('曲名为空、速度拍数超范围都有明白的提示，已填内容不丢', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'record');
    await page.fill('#rec-focus', '保留我');
    await page.click('form[data-form=rec-save] button[type=submit]');
    assert.match(await page.locator('#toast').innerText(), /曲名/);
    await page.fill('#rp0-title', 'A'); await page.fill('#rp0-t-b', '5');
    await page.click('form[data-form=rec-save] button[type=submit]');
    assert.match(await page.locator('#toast').innerText(), /20.*400/);
    assert.equal(await page.inputValue('#rec-focus'), '保留我');
  });

  test('手机宽度：多曲目记课表单没有横向滚动条', async () => {
    const page = await newPage({ mobile: true }); await login(page, OWNER);
    await tab(page, 'record'); await page.selectOption('#rec-count', '4');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });
});
