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



describe('教材/单曲、家长预览、背景装饰', () => {
  test('编辑学生：添加教材和单曲，直接点最下面的“保存”，重新打开还在；学生的学习页显示单曲和出处', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'students');
    await page.click('[data-act=student-edit][data-id="s-emma"]');
    const before = await page.locator('.bk-row').count();
    await page.click('[data-act=book-add]');
    await page.fill(`#bk${before}-n`, 'Thompson 9');
    await page.click('[data-act=book-add]');
    await page.selectOption(`[name="bk${before + 1}k"]`, 'single');
    await page.fill(`#bk${before + 1}-n`, 'Für Elise');
    await page.fill(`#bk${before + 1}-f`, 'Beethoven 精选集');
    assert.equal(await page.inputValue(`#bk${before}-n`), 'Thompson 9', '加行时已填的内容不丢');
    await page.click('form[data-form=student-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    await page.click('[data-act=student-edit][data-id="s-emma"]');
    assert.equal(await page.locator('.bk-row').count(), before + 2);
    assert.equal(await page.inputValue(`#bk${before}-n`), 'Thompson 9');
    assert.equal(await page.inputValue(`#bk${before + 1}-f`), 'Beethoven 精选集');
    // 删除一行再保存
    await page.click(`[data-act=book-del][data-i="${before}"]`);
    assert.equal(await page.locator('.bk-row').count(), before + 1);
    await page.click('form[data-form=student-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    const s = await newPage(); await login(s, al('emma'));
    await tab(s, 'learning');
    const txt = await s.locator('main').innerText();
    assert.match(txt, /Für Elise/); assert.match(txt, /Beethoven 精选集/); assert.ok(!/Thompson 9/.test(txt));
    assert.deepEqual(page.errors, []);
  });

  test('教材有空名字的行：给提示、已填内容不丢', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'students');
    await page.click('[data-act=student-edit][data-id="s-emma"]');
    const n = await page.locator('.bk-row').count();
    await page.click('[data-act=book-add]');
    await page.fill('form[data-form=student-save] [name=level]', '保留我');
    await page.click('form[data-form=student-save] button[type=submit]');
    assert.match(await page.locator('#toast').innerText(), /名称|name/i);
    assert.equal(await page.inputValue('form[data-form=student-save] [name=level]'), '保留我');
    assert.equal(await page.locator('.bk-row').count(), n + 1);
  });

  test('预览家长页：看到家长的页面（孩子卡片）、操作全部关闭，退出回到老师页面', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'students');
    await page.click('[data-act=preview][data-kind=parent]');
    await page.waitForSelector('.prev-note');
    assert.equal(await page.$('.tab[data-tab="students"]'), null);
    assert.ok(await page.$('.tab[data-tab="notices"]'), '家长的页签');
    assert.match(await page.locator('.prev-note').innerText(), /家长|parent|Li|Chen|Wang/i);
    await page.click('.prev-note [data-act=preview-exit]');
    await page.waitForSelector('.tab[data-tab="students"]');
    assert.deepEqual(page.errors, []);
  });

  test('背景装饰：老师、家长、学生页面都有季节/节庆背景（孩子的更鲜艳）', async () => {
    const info = async p => p.evaluate(() => { const b = document.getElementById('bg'); return { bg: b.style.background, tile: b.style.getPropertyValue('--tile'), kid: b.dataset.kid }; });
    const a = await newPage(); await login(a, OWNER);
    const ia = await info(a); assert.match(ia.bg, /linear-gradient/); assert.match(ia.tile, /^url\("data:image\/svg\+xml/); assert.equal(ia.kid, '0');
    const k = await newPage(); await login(k, al('emma'));
    const ik = await info(k); assert.match(ik.bg, /linear-gradient/); assert.equal(ik.kid, '1');
    const p = await newPage(); await login(p, al('li'));
    assert.equal((await info(p)).kid, '0');
    assert.deepEqual([a, k, p].flatMap(x => x.errors), [], 'CSP 不拦截 data: 背景');
  });
});
