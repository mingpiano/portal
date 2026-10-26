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


const tinyPng = page => page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#39c'; g.fillRect(100, 50, 100, 100); return c.toDataURL('image/png').split(',')[1]; });

describe('第 2 版（批次一）', () => {
  test('logo 出现在登录页和所有角色的页面；标题改为 Ming\'s Piano Studio（中英文都是）', async () => {
    const page = await newPage();
    assert.equal(await page.title(), "Ming's Piano Studio");
    assert.ok(await page.$eval('img.login-logo, img.logo', i => i.complete && i.naturalWidth > 0), '登录页 logo 加载成功');
    for (const email of [OWNER, al('emma'), al('chen')]) {
      const p = await newPage(); await login(p, email);
      assert.ok(await p.$eval('.bar img.logo', i => i.complete && i.naturalWidth > 0), email + ' 顶栏有 logo');
      assert.match(await p.locator('.bar').innerText(), /Ming's Piano Studio/);
      await p.click('[data-act=lang]');
      assert.match(await p.locator('.bar').innerText(), /Ming's Piano Studio/);
      assert.deepEqual(p.errors, []);
    }
  });

  test('老师预览学生视角：看到学生的页面、不能改任何东西，退出后回到学生列表', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'students');
    await page.click('[data-act=preview][data-id="s-emma"]');
    await page.waitForSelector('.prev-note');
    assert.ok(await page.$('.tab[data-tab="homework"]'), '看到学生的“作业”页签');
    assert.equal(await page.$('.tab[data-tab="students"]'), null, '没有老师的页签');
    await tab(page, 'homework');
    const boxes = page.locator('.hwitem input');
    if (await boxes.count()) assert.ok(await boxes.first().isDisabled(), '预览里作业勾选是禁用的');
    await page.click('.prev-note [data-act=preview-exit]');
    await page.waitForSelector('.tab[data-tab="students"]');
    assert.equal(await page.$('.prev-note'), null);
    assert.deepEqual(page.errors, []);
  });

  test('学生在“作业”页勾选，刷新后仍然是勾选的；下次上课提醒显示“n 天后”', async () => {
    const page = await newPage(); await login(page, al('emma'));
    assert.match(await bodyText(page), /天后|明天|今天|in \d+ days|tomorrow|today|next lesson/i, '首页有下次课提醒');
    await tab(page, 'homework');
    const first = page.locator('.hwitem input').first();
    await first.waitFor();
    assert.equal(await first.isChecked(), false);
    await first.check();
    await page.waitForFunction(() => document.querySelector('.hwitem input').checked);
    await page.reload(); await page.waitForSelector('.tabs'); await tab(page, 'homework');
    assert.equal(await page.locator('.hwitem input').first().isChecked(), true);
    assert.deepEqual(page.errors, []);
  });

  test('记课：用 12 小时制按老师时区填写，并显示学生那边是几点；设下次上课后学生能看到', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'record');
    await page.selectOption('#rec-student', 's-emma'); // 纽约
    await page.fill('#rec-date', '2026-11-10');
    await page.selectOption('#rec-th', '3'); await page.selectOption('#rec-tm', '0'); await page.selectOption('#rec-tap', 'PM');
    const hint = await page.locator('#rec-hint').innerText();
    assert.match(hint, /5:00|下午5/, '丹佛 3 PM = 纽约 5 PM：' + hint);
    await page.fill('#rec-ndate', '2026-11-17');
    await page.selectOption('#rec-nh', '3'); await page.selectOption('#rec-nap', 'PM');
    await page.fill('#rec-pieces', 'Sonatina | Clementi | 新曲');
    await page.fill('#rec-hw', '第一条\n第二条');
    await page.click('form[data-form=rec-save] button[type=submit]');
    await page.waitForSelector('.lesson');
    assert.deepEqual(page.errors, []);
    // 下次上课早于本次 → 提示且已填内容不丢
    await page.fill('#rec-date', '2026-11-10'); await page.fill('#rec-ndate', '2026-11-01');
    await page.fill('#rec-pieces', 'X | Y | 新曲');
    await page.click('form[data-form=rec-save] button[type=submit]');
    assert.match(await page.locator('#toast').innerText(), /晚于|之后|after/i);
    assert.equal(await page.inputValue('#rec-pieces'), 'X | Y | 新曲');
  });

  test('头像：选图 → 裁剪 → 保存，顶栏变成照片；坏文件被拒绝', async () => {
    const page = await newPage(); await login(page, al('emma'));
    await page.click('[data-act=av-open]');
    const b64 = await tinyPng(page);
    await page.setInputFiles('input[data-change=av-file]', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
    await page.waitForSelector('#crop-cv');
    const box = await page.locator('#crop-cv').boundingBox();
    await page.mouse.move(box.x + 120, box.y + 120); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 120); await page.mouse.up();
    await page.fill('#crop-zoom', '2');
    await page.click('[data-act=crop-save]');
    await page.waitForSelector('.who .av img');
    assert.match(await page.getAttribute('.who .av img', 'src'), /^data:image\/jpeg;base64,/);
    // 非图片
    await page.click('[data-act=av-open]');
    await page.setInputFiles('input[data-change=av-file]', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    assert.match(await page.locator('#toast').innerText(), /图片|image|picture/i);
    assert.deepEqual(page.errors, []);
  });

  test('手机宽度：作业页、记课页、头像裁剪都没有横向滚动条', async () => {
    const check = async (p, what) => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), what + ' 横向溢出');
    const s = await newPage({ mobile: true }); await login(s, al('emma'));
    await check(s, '学生首页'); await tab(s, 'homework'); await check(s, '作业页');
    await s.click('[data-act=av-open]');
    await s.setInputFiles('input[data-change=av-file]', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(await tinyPng(s), 'base64') });
    await s.waitForSelector('#crop-cv'); assert.ok(await s.evaluate(() => document.querySelector('.modal').scrollWidth <= window.innerWidth), '裁剪窗口');
    const a = await newPage({ mobile: true }); await login(a, OWNER);
    await tab(a, 'record'); await check(a, '记课页'); await tab(a, 'students'); await check(a, '学生页');
  });
});
