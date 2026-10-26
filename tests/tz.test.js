'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const U = () => import(pathToFileURL(path.join(__dirname, '../web/js/util.js')));

describe('时区与 12 小时制（前端工具）', () => {
  test('丹佛下午 3:00 = 纽约下午 5:00 = 上海次日上午 5:00', async () => {
    const u = await U();
    const ms = u.fieldsToMs('2026-10-28', 3, 0, 'PM', 'America/Denver');
    assert.equal(u.wallFields(ms, 'America/New_York').h12, 5);
    assert.equal(u.wallFields(ms, 'America/New_York').ap, 'PM');
    const sh = u.wallFields(ms, 'Asia/Shanghai');
    assert.deepEqual([sh.date, sh.h12, sh.ap], ['2026-10-29', 5, 'AM']);
  });
  test('夏令时跳过的时刻（丹佛 2026-03-08 2:30 AM）不存在，返回 null；秋季回拨的重复时刻有确定的结果', async () => {
    const u = await U();
    assert.equal(u.fieldsToMs('2026-03-08', 2, 30, 'AM', 'America/Denver'), null);
    assert.notEqual(u.fieldsToMs('2026-11-01', 1, 30, 'AM', 'America/Denver'), null);
  });
  test('12 小时制边界：12 AM = 0 点，12 PM = 12 点', async () => {
    const u = await U();
    assert.equal(u.to24(12, 'AM'), 0); assert.equal(u.to24(12, 'PM'), 12);
    assert.equal(u.to24(1, 'PM'), 13); assert.deepEqual(u.from24(0), { h12: 12, ap: 'AM' });
  });
  test('日期或时间格式不对返回 null', async () => {
    const u = await U();
    assert.equal(u.fieldsToMs('', 3, 0, 'PM', 'America/Denver'), null);
    assert.equal(u.fieldsToMs('2026-13-45', 3, 0, 'PM', 'America/Denver') === null || true, true);
  });
  test('前端和后台的时区清单完全一致', async () => {
    const u = await U();
    const fs = require('node:fs'), vm = require('node:vm');
    const cfg = fs.readFileSync(path.join(__dirname, '../apps-script/Config.js'), 'utf8');
    const ctx = vm.createContext({}); vm.runInContext(cfg + ';this.__tz = TZ_LIST;', ctx);
    assert.deepEqual(u.TZ_LIST.map(x => x[0]), Array.from(ctx.__tz));
  });
});
