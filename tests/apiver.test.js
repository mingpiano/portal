'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, fresh, ok } = require('./helpers');
const fs = require('node:fs'), path = require('node:path');

describe('后台版本号（防止“网页新了、后台忘了发布”）', () => {
  test('状态里带 apiVer，且和网页要求的版本一致', () => {
    const rt = fresh();
    const st = ok(rt.call('bootstrap', {}, rt.as(OWNER))).state;
    assert.equal(st.apiVer, rt.ctx.API_VERSION);
    const m = /WANT_API = (\d+)/.exec(fs.readFileSync(path.join(__dirname, '../web/js/views.js'), 'utf8'));
    assert.equal(Number(m[1]), rt.ctx.API_VERSION, 'views.js 的 WANT_API 要和 Config.js 的 API_VERSION 一致');
  });
});
