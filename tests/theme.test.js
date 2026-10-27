'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const T = () => import(pathToFileURL(path.join(__dirname, '../web/js/theme.js')));
const D = (y, m, d) => new Date(y, m - 1, d);

describe('节庆与季节（背景装饰）', () => {
  test('节庆日期：万圣节、感恩节、圣诞、新年、情人节、春节前后各一周', async () => {
    const { festival } = await T();
    const cases = [
      [D(2026, 10, 15), 'halloween'], [D(2026, 10, 31), 'halloween'], [D(2026, 11, 1), 'halloween'], [D(2026, 10, 14), null],
      [D(2026, 11, 26), 'thanks'], [D(2026, 11, 19), 'thanks'], [D(2026, 11, 27), 'thanks'], [D(2026, 11, 28), null],
      [D(2026, 12, 10), 'xmas'], [D(2026, 12, 26), 'xmas'], [D(2026, 12, 27), 'newyear'], [D(2027, 1, 3), 'newyear'], [D(2027, 1, 4), null],
      [D(2027, 2, 6), 'lunar'], [D(2027, 1, 30), 'lunar'], [D(2027, 2, 13), 'lunar'], [D(2027, 2, 12), 'lunar'],
      [D(2027, 2, 14), 'valentine'], [D(2027, 4, 12), null], [D(2026, 7, 15), null]
    ];
    for (const [d, want] of cases) assert.equal(festival(d), want, d.toDateString());
  });
  test('感恩节是十一月第四个星期四', async () => {
    const { thanksgiving } = await T();
    for (const [y, day] of [[2025, 27], [2026, 26], [2027, 25], [2028, 23]]) assert.equal(thanksgiving(y).getDate(), day, String(y));
  });
  test('四季：3–5 春，6–8 夏，9–11 秋，12–2 冬', async () => {
    const { season } = await T();
    const want = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];
    want.forEach((w, i) => assert.equal(season(D(2026, i + 1, 15)), w, 'month ' + (i + 1)));
  });
  test('孩子用鲜艳大图案（含按年龄的角色），大人用淡色小图案；节庆期间换成节庆图案', async () => {
    const { themeFor, SEAS, FEST } = await T();
    const kid = { kind: 'child', birth: '2020-05-01' }, adult = { kind: 'adult' };
    const spring = D(2027, 4, 12);
    const tk = themeFor(spring, kid), ta = themeFor(spring, adult), tn = themeFor(spring, null);
    assert.equal(tk.kid, true); assert.equal(ta.kid, false); assert.equal(tn.kid, false);
    assert.deepEqual(tk.g, SEAS.spring.kid); assert.deepEqual(ta.g, SEAS.spring.ad); assert.deepEqual(tn.e, SEAS.spring.e);
    assert.ok(tk.e.length > ta.e.length);
    const h = themeFor(D(2026, 10, 31), kid); assert.equal(h.occ, 'halloween'); assert.deepEqual(h.g, FEST.halloween.kid.g);
  });
  test('孩子的角色按年龄：7 岁以下动物，8–10 岁花园，更大的星空；没有生日按最小的算', async () => {
    const { styleOf } = await T();
    const y = new Date().getFullYear();
    assert.equal(styleOf({ birth: `${y - 5}-01-01` }), 'animals');
    assert.equal(styleOf({ birth: `${y - 9}-01-01` }), 'garden');
    assert.equal(styleOf({ birth: `${y - 14}-01-01` }), 'space');
    assert.equal(styleOf({}), 'animals');
  });
  test('背景图案是现场生成的 SVG（data: 地址，符合页面的安全策略），不含任何外部地址', async () => {
    const { tileUri } = await T();
    const u = tileUri(['🎃', '👻'], true);
    assert.match(u, /^data:image\/svg\+xml,/);
    assert.ok(!/https?:/.test(decodeURIComponent(u.replace('data:image/svg+xml,', '')).replace('http://www.w3.org/2000/svg', '')));
  });
});
