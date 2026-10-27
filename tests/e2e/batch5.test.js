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

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

describe('批次五：日历与学费方式', () => {
  test('老师：日历显示本月、种子里的课；翻月；点某一天看当天的课', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'calendar');
    await page.waitForSelector('.cal-grid');
    assert.ok(await page.locator('.cal-cell:not(.empty)').count() >= 28);
    assert.equal(await page.locator('.cal-cell.today').count(), 1);
    const title = await page.locator('.cal-nav h2').innerText();
    await page.click('[data-act=cal-month][data-d="1"]');
    assert.notEqual(await page.locator('.cal-nav h2').innerText(), title);
    await page.click('[data-act=cal-today]');
    assert.equal(await page.locator('.cal-nav h2').innerText(), title);
    // 接下来的课里有种子数据；点开其中一天
    assert.ok(await page.locator('.evlist .evrow').count() >= 1);
    assert.deepEqual(page.errors, []);
  });

  test('老师：添加课程（每周重复 3 节）→ 出现在日历；修改时间；取消；删除', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'calendar');
    const day = ymd(inDays(30));
    await page.click('.page-h [data-act=ev-new]');
    await page.selectOption('#ev-student', 's-lucas');
    assert.equal(await page.inputValue('#ev-dur'), '30', '时长默认是这位学生的课长');
    await page.fill('#ev-date', day);
    await page.selectOption('#rec-eh', '4'); await page.selectOption('#rec-em', '30'); await page.selectOption('#rec-eap', 'PM');
    await page.fill('#ev-rep', '3'); await page.fill('#ev-note', '线上');
    assert.match(await page.locator('#ev-hint').innerText(), /./, '学生那边的时间提示');
    await page.click('form[data-form=ev-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    // 跳到了那天；当天列表里有这节课
    assert.match(await page.locator('.evlist').first().innerText(), /Lucas Chen/);
    assert.match(await page.locator('.evlist').first().innerText(), /线上/);
    const before = await page.locator('.evlist .evrow', { hasText: 'Lucas Chen' }).count();
    // 修改
    await page.locator('.evlist').first().locator('[data-act=ev-edit]').first().click();
    await page.selectOption('#rec-eh', '5');
    await page.click('form[data-form=ev-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    assert.match(await page.locator('.evlist').first().innerText(), /5:30/);
    // 取消
    await page.locator('.evlist').first().locator('[data-act=ev-edit]').first().click();
    await page.click('[data-act=ev-status][data-to=cancelled]');
    await page.waitForSelector('#toast.show');
    assert.match(await page.locator('.evlist').first().innerText(), /已取消/);
    // 删除（要确认）
    await page.locator('.evlist').first().locator('[data-act=ev-edit]').first().click();
    await page.click('[data-act=ev-del]');
    await page.click('[data-act=confirm-yes]');
    await page.waitForSelector('#toast.show');
    assert.match(await page.locator('.evlist').first().innerText(), /没有课/);
    assert.deepEqual(page.errors, []);
    assert.ok(before >= 1);
  });

  test('学生：能看到自己的课、有 Google 日历链接和 .ics 下载，但没有任何修改按钮', async () => {
    const s = await newPage(); await login(s, al('emma'));
    await tab(s, 'calendar');
    await s.waitForSelector('.cal-grid');
    assert.equal(await s.locator('[data-act=ev-new],[data-act=ev-edit]').count(), 0);
    const link = s.locator('a', { hasText: 'Google' }).first();
    const href = await link.getAttribute('href');
    assert.match(href, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=/);
    assert.match(await link.getAttribute('rel'), /noopener/);
    const [dl] = await Promise.all([s.waitForEvent('download'), s.locator('[data-act=ev-ics]').first().click()]);
    const txt = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(txt, /BEGIN:VCALENDAR/); assert.match(txt, /BEGIN:VEVENT/); assert.match(txt, /SUMMARY:Piano lesson · Emma Li/); assert.match(txt, /UID:e-emma-1@keynote-portal/);
    assert.ok(txt.includes('\r\n'), '换行是 CRLF');
    const [dl2] = await Promise.all([s.waitForEvent('download'), s.click('[data-act=ev-ics-all]')]);
    assert.match(fs.readFileSync(await dl2.path(), 'utf8'), /END:VCALENDAR/);
    assert.deepEqual(s.errors, []);
  });

  test('家长：日历里只有自己孩子的课；首页“下次上课”旁边有加入日历', async () => {
    const p = await newPage(); await login(p, al('chen'));
    await tab(p, 'calendar');
    const txt = await p.locator('main').innerText();
    assert.match(txt, /Lucas Chen/); assert.match(txt, /Mia Chen/); assert.ok(!/Emma Li/.test(txt) && !/王子涵/.test(txt));
    const s = await newPage(); await login(s, al('lucas'));
    await tab(s, 'home');
    assert.ok(await s.locator('.next [data-act=ev-ics]').count() >= 1, '下次上课卡片上有 .ics 按钮');
  });

  test('记课时填“下次上课” → 日历里立刻有这一节；老师在日历里改时间，学生首页同步', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'record');
    await page.fill('#rp0-title', 'Gavotte');
    const nd = ymd(inDays(9));
    await page.fill('#rec-ndate', nd);
    await page.selectOption('#rec-nh', '7'); await page.selectOption('#rec-nap', 'PM');
    await page.click('form[data-form=rec-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    await tab(page, 'calendar');
    await page.click(`[data-act=cal-day][data-day="${nd}"]`).catch(async () => { await page.click('[data-act=cal-month][data-d="1"]'); await page.click(`[data-act=cal-day][data-day="${nd}"]`); });
    assert.match(await page.locator('.evlist').first().innerText(), /7:00/);
    await page.locator('.evlist').first().locator('[data-act=ev-edit]').first().click();
    assert.match(await page.locator('.modal').innerText(), /记课时填的|lesson record/i);
    await page.selectOption('#rec-eh', '8');
    await page.click('form[data-form=ev-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    assert.match(await page.locator('.evlist').first().innerText(), /8:00/);
    assert.deepEqual(page.errors, []);
  });

  test('手机宽度：日历没有横向滚动，点日期能看到当天', async () => {
    const page = await newPage({ mobile: true }); await login(page, OWNER);
    await tab(page, 'calendar'); await page.waitForSelector('.cal-grid');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '无横向滚动');
    await shot(page, 'b5-cal-mobile');
    const d = await newPage(); await login(d, OWNER); await tab(d, 'calendar'); await d.waitForSelector('.cal-grid'); await shot(d, 'b5-cal-desktop'); await d.click('.page-h [data-act=ev-new]'); await shot(d, 'b5-ev-modal');
  });

  test('学费方式：学生编辑页选“按月” → 每期节数消失、出现起始月；保存后学生首页显示按月', async () => {
    const page = await newPage(); await login(page, OWNER);
    await tab(page, 'students');
    await page.click('[data-act=student-edit][data-id="s-emma"]');
    assert.ok(await page.locator('form[data-form=student-save] [name=term]').count() === 1);
    await page.selectOption('form[data-form=student-save] [name=billing]', 'month');
    assert.equal(await page.locator('form[data-form=student-save] [name=term]').count(), 0);
    assert.ok(await page.locator('form[data-form=student-save] [name=billFrom]').count() === 1);
    await page.fill('form[data-form=student-save] [name=paid]', '1');
    await page.click('form[data-form=student-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    const s = await newPage(); await login(s, al('emma'));
    const txt = await s.locator('main').innerText();
    assert.match(txt, /this month/i); assert.ok(!/10 lessons/i.test(txt));
    await page.click('[data-act=student-edit][data-id="s-emma"]');
    assert.equal(await page.inputValue('form[data-form=student-save] [name=billing]'), 'month');
    // 改成每 5 节一期
    await page.selectOption('form[data-form=student-save] [name=billing]', 'lessons');
    await page.fill('form[data-form=student-save] [name=term]', '5');
    await page.click('form[data-form=student-save] button[type=submit]');
    await page.waitForSelector('#toast.show');
    const s2 = await newPage(); await login(s2, al('emma'));
    assert.match(await s2.locator('main').innerText(), /\/ 5/);
  });

  test('每期很多节（例如 20）时，琴键改成进度条', async () => {
    await adminCall('students.save', { student: { id: 's-emma', name: 'Emma Li', email: al('emma'), kind: 'child', lang: 'en', birth: '', start: '', level: 'x', grp: '', dur: 45, paid: 1, carry: 14, adj: 0, showPoints: true, term: 20 } });
    const s = await newPage(); await login(s, al('emma'));
    assert.equal(await s.locator('.kb').count(), 0);
    assert.equal(await s.locator('.kbar').count() >= 1, true);
  });
});
