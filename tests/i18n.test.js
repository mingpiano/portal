'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRuntime } = require('../tools/dev/gas-mock');

const WEB = path.join(__dirname, '..', 'web', 'js');
const read = f => fs.readFileSync(path.join(WEB, f), 'utf8');
const load = f => import(pathToFileURL(path.join(WEB, f)).href);
const phs = s => (s.match(/\{(\w+)\}/g) || []).sort().join(',');

describe('中英文词条', () => {
  test('每个词条两种语言都有、不为空，变量名一一对应', async () => {
    const { DICT } = await load('dict.js');
    assert.deepEqual(Object.keys(DICT.zh), Object.keys(DICT.en));
    for (const k of Object.keys(DICT.zh)) {
      assert.ok(DICT.zh[k].trim() && DICT.en[k].trim(), '空词条：' + k);
      assert.equal(phs(DICT.zh[k]), phs(DICT.en[k]), '变量对不上：' + k);
    }
  });

  test('代码里用到的每一个词条键都存在', async () => {
    const { DICT } = await load('dict.js');
    const used = new Set();
    for (const f of ['views.js', 'app.js']) {
      const s = read(f);
      for (const m of s.matchAll(/\bt[x]?\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
      for (const m of s.matchAll(/(?:title|body|yes): '([a-z]+\.[a-zA-Z0-9]+)'/g)) used.add(m[1]);
      for (const m of s.matchAll(/'((?:err|login)\.[a-zA-Z_]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter(k => !k.endsWith('.') && !(k in DICT.zh));
    assert.deepEqual(missing, []);
  });

  test('动态拼出来的键也都有：页签、身份、曲目状态、积分流水、规则、错误码', async () => {
    const { DICT } = await load('dict.js');
    const rt = createRuntime({ quiet: true });
    const need = [];
    ['overview', 'students', 'record', 'notices', 'messages', 'points', 'home', 'learning', 'lessons'].forEach(k => need.push('tab.' + k));
    ['admin', 'parent', 'student'].forEach(k => need.push('role.' + k));
    ['new', 'review', 'done'].forEach(k => need.push('piece.' + k));
    // 积分流水的种类：从后台代码里读，后台新增一种这里会失败
    const rulesSrc = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Rules.js'), 'utf8');
    const kinds = new Set([...rulesSrc.matchAll(/key: '(\w+)'/g)].map(m => m[1]));
    assert.ok(kinds.size >= 6);
    kinds.forEach(k => need.push('ledger.' + k));
    Object.keys(rt.ctx.RULE_RANGE).forEach(k => need.push('rule.' + k, 'rule.' + k + 'H'));
    // 后台会返回的每一个错误码
    const codes = new Set();
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'apps-script')).filter(x => x.endsWith('.js')))
      for (const m of fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8').matchAll(/fail_\('(\w+)'/g)) codes.add(m[1]);
    ['network', 'server', 'generic', 'busy', 'unauthorized'].forEach(c => codes.add(c));
    codes.forEach(c => need.push('err.' + c));
    assert.deepEqual(need.filter(k => !(k in DICT.zh)), []);
  });

  test('网页的头像可选项和后台白名单完全一致', async () => {
    const { AVATAR_EMOJI, AVATAR_COLORS } = await load('util.js');
    const rt = createRuntime({ quiet: true });
    assert.deepEqual([...AVATAR_EMOJI], Array.from(rt.ctx.AVATAR_EMOJI));
    assert.deepEqual([...AVATAR_COLORS], Array.from(rt.ctx.AVATAR_COLORS));
  });

  test('网页里没有内联脚本、没有 innerHTML 以外的危险写法', () => {
    const html = fs.readFileSync(path.join(WEB, '..', 'index.html'), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'index.html 里不能有内联脚本');
    for (const f of ['views.js', 'app.js', 'util.js', 'api.js']) {
      const s = read(f);
      assert.ok(!/\beval\s*\(|new Function\(|document\.write\(|insertAdjacentHTML|outerHTML\s*=/.test(s), f + ' 含危险写法');
    }
    const app = read('app.js');
    const sets = [...app.matchAll(/\.innerHTML\s*=/g)].length;
    assert.equal(sets, 2, 'innerHTML 只允许在 render() 里给 #app 和 #modal-root 赋值');
  });
});
