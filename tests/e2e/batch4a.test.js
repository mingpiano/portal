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

describe('批次四·一：登录时间、生日、改课记录、作品集', () => {
  test('老师在学生和家长名册里看到“最近登录”：没登录过 → 学生登录后变成今天', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'students');
    assert.match(await page.locator('main').innerText(), /还没登录过/);
    const s = await newPage(); await login(s, al('emma'));
    await page.reload(); await page.waitForSelector('.tabs'); await tab(page, 'students');
    const row = await page.locator('.row', { hasText: 'Emma Li' }).first().innerText();
    assert.match(row, /最近登录：.*今天/);
    assert.deepEqual(page.errors, []);
  });

  test('学生自己填生日；老师编辑页同步看到', async () => {
    const s = await newPage(); await login(s, al('sophia'));
    await s.click('[data-act=av-open]');
    await s.fill('input[name=birth]', '1992-05-06');
    await s.click('form[data-form=profile-birth] button[type=submit]');
    await s.waitForSelector('#toast.show');
    const a = await newPage(); await login(a, OWNER);
    await tab(a, 'students');
    await a.click('[data-act=student-edit][data-id="s-sophia"]');
    assert.equal(await a.inputValue('form[data-form=student-save] [name=birth]'), '1992-05-06');
    assert.deepEqual(s.errors, []);
  });

  test('家长在自己的资料里填孩子的生日', async () => {
    const p = await newPage(); await login(p, al('li'));
    await p.click('[data-act=av-open]');
    assert.match(await p.locator('#modal-root').innerText(), /Emma Li.*birthday/i);
    await p.fill('form[data-form=profile-birth] input[name=birth]', '2017-03-04');
    await p.click('form[data-form=profile-birth] button[type=submit]');
    await p.waitForSelector('#toast.show');
    const e = await newPage(); await login(e, al('emma'));
    await e.click('[data-act=av-open]');
    assert.equal(await e.inputValue('form[data-form=profile-birth] input[name=birth]'), '2017-03-04');
  });

  test('记课页最近记录：点“编辑”→ 表单带出原内容 → 改完保存 → 记录更新、不多出一节', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'record');
    const total = await page.locator('.lesson').count();
    await page.locator('[data-act=lesson-edit]').first().click();
    await page.waitForSelector('.edit-note');
    assert.match(await page.locator('.edit-note').innerText(), /正在修改/);
    assert.ok((await page.inputValue('#rp0-title')).length > 0, '曲名带出来');
    assert.ok((await page.inputValue('#rec-focus')).length > 0, '重点带出来');
    assert.equal(await page.locator('#rec-student').count(), 0, '修改时不能换学生');
    await page.fill('#rec-focus', '改过的重点 XYZ');
    await page.click('form[data-form=rec-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    assert.equal(await page.locator('.edit-note').count(), 0, '保存后回到新记一节');
    assert.equal(await page.locator('.lesson').count(), total);
    assert.match(await page.locator('main').innerText(), /改过的重点 XYZ/);
    assert.deepEqual(page.errors, []);
  });

  test('修改时增减曲目数量、取消修改回到空白表单', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'record');
    await page.locator('[data-act=lesson-edit]').first().click();
    await page.waitForSelector('.edit-note');
    const t0 = await page.inputValue('#rp0-title');
    const n0 = Number(await page.inputValue('#rec-count'));
    await page.selectOption('#rec-count', String(n0 + 1));
    assert.equal(await page.inputValue('#rp0-title'), t0, '加一首时原来的不丢');
    assert.equal(await page.inputValue(`#rp${n0}-title`), '', '新加的一首是空的');
    await page.click('.edit-note [data-act=rec-edit-cancel]');
    assert.equal(await page.locator('.edit-note').count(), 0);
    assert.equal(await page.inputValue('#rp0-title'), '', '回到空白表单');
  });

  test('作品集：老师在编辑页添加（名称 + YouTube 链接）；学生学习页能点开，学完的打 ✓、正在学的不打勾', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'students');
    await page.click('[data-act=student-edit][data-id="s-emma"]');
    const n = await page.locator('.bk-row').count();
    await page.click('[data-act=book-add]');
    await page.selectOption(`[name="bk${n}k"]`, 'portfolio');
    await page.fill(`#bk${n}-n`, '2026 秋季作品集');
    await page.fill(`#bk${n}-u`, 'http://bad.example/x');
    await page.selectOption(`[name="bk${n}s"]`, 'done');
    await page.click('form[data-form=student-save] button[type=submit]');
    assert.match(await page.locator('#toast').innerText(), /链接|link|https/i, 'http 链接被拒绝');
    assert.equal(await page.inputValue(`#bk${n}-n`), '2026 秋季作品集', '提示后已填内容还在');
    await page.fill(`#bk${n}-u`, 'https://www.youtube.com/watch?v=abc123');
    await page.click('form[data-form=student-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    const s = await newPage(); await login(s, al('emma'));
    await tab(s, 'learning');
    const link = s.locator('a', { hasText: '2026 秋季作品集' });
    assert.equal(await link.getAttribute('href'), 'https://www.youtube.com/watch?v=abc123');
    assert.match(await link.getAttribute('rel'), /noopener/);
    const chips = await s.locator('.pbook').evaluateAll(els => els.map(e => ({ t: e.innerText, tick: !!e.querySelector('.tick') })));
    const port = chips.find(c => /作品集/.test(c.t)); assert.ok(port.tick, '学完的有 ✓');
    assert.ok(chips.filter(c => !c.tick).length >= 1 && chips.filter(c => !c.tick).every(c => !/✓/.test(c.t)), '正在学的没有 ✓');
    assert.deepEqual(s.errors, []);
  });

  test('正在学的教材 / 单曲 / 作品集一个都不打勾（第 2 个以后也不打），学完的全部打勾', async () => {
    await adminCall('books.save', { sid: 's-emma', books: [
      { n: 'A', s: 'current' }, { n: 'B', s: 'current', k: 'single', f: 'X' }, { n: 'C', s: 'current' }, { n: 'D', s: 'current', k: 'portfolio', u: 'https://youtu.be/d' },
      { n: 'E', s: 'done' }, { n: 'F', s: 'done', k: 'single' }] });
    const s = await newPage(); await login(s, al('emma'));
    await tab(s, 'learning');
    const cur = await s.locator('.pbook').evaluateAll(els => els.map(e => ({ t: e.innerText.trim(), tick: !!e.querySelector('.tick') })));
    for (const n of ['A', 'B', 'C', 'D']) assert.equal(cur.find(c => c.t.includes(n + (n === 'B' ? '' : ''))).tick, false, n + ' 正在学，不该有 ✓');
    for (const n of ['E', 'F']) assert.equal(cur.find(c => new RegExp('(^|\\s)' + n + '(\\s|$)').test(c.t)).tick, true, n + ' 学完了，该有 ✓');
  });
});
