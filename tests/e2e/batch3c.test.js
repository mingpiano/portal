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



const wav = () => { const n = 8000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; };
const pdfBytes = () => { const b = Buffer.alloc(2300000); for (let i = 0; i < b.length; i++) b[i] = (i * 13 + 5) & 255; b.write('%PDF-1.4', 0); return b; };

async function addResource(t, { file, title, to = ['s-emma'], all = false }) {
  await tab(t, 'resources');
  await t.setInputFiles('#res-file', file);
  if (title) await t.fill('#res-title', title);
  if (all) await t.check('input[name=all]'); else for (const id of to) await t.check(`input[name=to][value="${id}"]`);
  await t.click('form[data-form=res-add] button[type=submit]');
  await t.waitForFunction(() => !document.querySelector('#res-prog') && document.querySelectorAll('.res-item').length > 0, null, { timeout: 30000 });
}

describe('资源库', () => {
  test('老师上传 2.3MB 的 PDF（分 3 段）→ 学生看到“新”提醒 → 下载的文件和原文件逐字节一样；打开页面后“新”的红点消失', async () => {
    const t = await newPage(); await login(t, OWNER);
    const pdf = pdfBytes();
    await addResource(t, { file: { name: 'etude 40.pdf', mimeType: 'application/pdf', buffer: pdf }, title: 'Czerny 40' });
    assert.match(await t.locator('.res-item').first().innerText(), /Czerny 40/);
    assert.deepEqual(t.errors, []);

    const s = await newPage(); await login(s, al('emma'));
    assert.equal(await s.locator('.tab[data-tab="resources"] .badge').innerText(), '1');
    await tab(s, 'resources');
    assert.match(await s.locator('.res-item').first().innerText(), /新|New/);
    const [dl] = await Promise.all([s.waitForEvent('download', { timeout: 30000 }), s.click('[data-act=res-dl]')]);
    assert.equal(dl.suggestedFilename(), 'etude 40.pdf'); // （沙箱的系统语言是 C，中文文件名会被浏览器改成 download；真实的 Mac 上不受影响）
    const got = fs.readFileSync(await dl.path());
    assert.ok(got.equals(pdf), '下载的文件和上传的逐字节相同');
    assert.ok(await s.locator('[data-act=res-print]').count() === 1, '有打印');
    await tab(s, 'notices'); await tab(s, 'resources');
    assert.equal(await s.locator('.tab[data-tab="resources"] .badge').count(), 0, '已读后红点消失');
    assert.doesNotMatch(await s.locator('.res-item').first().innerText(), /新|New/);
    assert.deepEqual(s.errors, []);
  });

  test('音频只能在线播放：有播放器，没有下载按钮；播放器没有下载入口；右键菜单被禁用', async () => {
    const t = await newPage(); await login(t, OWNER);
    await addResource(t, { file: { name: 'demo.wav', mimeType: 'audio/wav', buffer: wav() }, title: '示范', to: ['s-emma'] });
    const s = await newPage(); await login(s, al('emma')); await tab(s, 'resources');
    assert.equal(await s.locator('[data-act=res-dl]').count(), 0, '音频没有下载按钮');
    assert.equal(await s.locator('[data-act=res-print]').count(), 0);
    await s.click('[data-act=res-play]');
    await s.waitForSelector('audio.nodl');
    assert.match(await s.getAttribute('audio.nodl', 'src'), /^blob:/);
    assert.match(await s.getAttribute('audio.nodl', 'controlslist'), /nodownload/);
    assert.equal(await s.locator('.modal a[download], .modal [data-act=res-dl]').count(), 0);
    const prevented = await s.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector('audio.nodl').dispatchEvent(e); return e.defaultPrevented; });
    assert.equal(prevented, true);
    await s.waitForFunction(() => document.querySelector('audio.nodl').readyState >= 1, null, { timeout: 10000 }); // CSP 允许 blob: 媒体，真的能载入
    await s.click('[data-act=viewer-close]');
    assert.equal(await s.locator('audio').count(), 0);
    assert.deepEqual(s.errors, []);
  });

  test('只有被分享的人看得到：Emma 的家长看得到，别的学生和家长、成人学生看不到；改分享后立刻生效', async () => {
    const t = await newPage(); await login(t, OWNER);
    await addResource(t, { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 tiny') }, title: '只给 Emma', to: ['s-emma'] });
    const seen = async who => { const p = await newPage(); await login(p, al(who)); await tab(p, 'resources'); return (await p.locator('.res-item').count()); };
    assert.equal(await seen('li'), 1); assert.equal(await seen('zihan'), 0); assert.equal(await seen('sophia'), 0); assert.equal(await seen('chen'), 0);
    // 老师改成分享给 Sophia（成人学生）
    await t.click('[data-act=res-edit]');
    await t.uncheck('.modal input[name=to][value="s-emma"]'); await t.check('.modal input[name=to][value="s-sophia"]');
    await t.click('.modal button[type=submit]'); await t.waitForSelector('#toast.show');
    assert.equal(await seen('sophia'), 1); assert.equal(await seen('emma'), 0);
    // 删除
    await t.click('[data-act=res-del]'); await t.click('[data-act=confirm-yes]');
    await t.waitForFunction(() => !document.querySelector('.res-item'));
    assert.equal(await seen('sophia'), 0);
  });

  test('贴链接：只收 https；学生点“打开链接”在新页面打开（带 noopener）', async () => {
    const t = await newPage(); await login(t, OWNER);
    await tab(t, 'resources'); await t.click('[data-act=res-kind][data-k=link]');
    await t.fill('#res-title', '视频'); await t.fill('#res-url', 'http://bad.example'); await t.check('input[name=all]');
    await t.click('form[data-form=res-add] button[type=submit]');
    await t.waitForFunction(() => /https/.test(document.querySelector('#toast').innerText));
    assert.equal(await t.inputValue('#res-title'), '视频', '服务器报错后，已填的内容不丢');
    assert.ok(await t.isChecked('input[name=all]'));
    await t.fill('#res-url', 'https://youtu.be/abc');
    await t.click('form[data-form=res-add] button[type=submit]');
    await t.waitForSelector('.res-item');
    const s = await newPage(); await login(s, al('zihan')); await tab(s, 'resources');
    const a = s.locator('.res-item a.btn');
    assert.equal(await a.getAttribute('href'), 'https://youtu.be/abc');
    assert.equal(await a.getAttribute('target'), '_blank'); assert.match(await a.getAttribute('rel'), /noopener/);
  });

  test('填错有明白的提示、已填内容不丢：没选文件、没选人、类型不对', async () => {
    const t = await newPage(); await login(t, OWNER); await tab(t, 'resources');
    await t.fill('#res-title', '保留我');
    await t.click('form[data-form=res-add] button[type=submit]');
    assert.match(await t.locator('#toast').innerText(), /选择一个文件/);
    await t.setInputFiles('#res-file', { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
    await t.click('form[data-form=res-add] button[type=submit]');
    assert.match(await t.locator('#toast').innerText(), /分享给谁|选择分享/);
    assert.equal(await t.inputValue('#res-title'), '保留我');
    await t.setInputFiles('#res-file', { name: 'evil.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
    await t.check('input[name=all]');
    await t.click('form[data-form=res-add] button[type=submit]');
    assert.match(await t.locator('#toast').innerText(), /PDF/);
    assert.equal(await t.locator('.res-item').count(), 0);
  });

  test('老师预览学生：看得到资源列表；手机宽度没有横向滚动条', async () => {
    const t = await newPage(); await login(t, OWNER);
    await addResource(t, { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 tiny') }, title: '预览用', to: ['s-emma'] });
    await tab(t, 'students'); await t.click('[data-act=preview][data-id="s-emma"]'); await t.waitForSelector('.prev-note');
    await tab(t, 'resources');
    assert.match(await t.locator('.res-item').first().innerText(), /预览用/);
    const m = await newPage({ mobile: true }); await login(m, OWNER); await tab(m, 'resources');
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '老师资源页');
    const k = await newPage({ mobile: true }); await login(k, al('emma')); await tab(k, 'resources');
    assert.ok(await k.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '学生资源页');
  });
});
