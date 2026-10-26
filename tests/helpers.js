'use strict';
const assert = require('node:assert/strict');
const { createRuntime } = require('../tools/dev/gas-mock');

const OWNER = 'tester@gmail.com';
const al = tag => `tester+${tag}@gmail.com`;
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** 一个全新的测试环境（假数据已灌入）。 */
function fresh() {
  const rt = createRuntime({ owner: OWNER, quiet: true });
  rt.requireLock = true;
  rt.run('setupTest');
  rt._tok = {};
  rt.as = (email, opts) => (rt._tok[email] = rt._tok[email] || rt.login(email, opts));
  return rt;
}
const WHO = {
  admin: OWNER, emma: al('emma'), zihan: al('zihan'), lucas: al('lucas'), sophia: al('sophia'),
  li: al('li'), chen: al('chen'), wang: al('wang')
};

function ok(r) { assert.equal(r.ok, true, 'expected ok, got ' + JSON.stringify(r)); return r.data; }
function err(r, code) { assert.equal(r.ok, false, 'expected error ' + code + ', got ok'); assert.equal(r.error, code, JSON.stringify(r)); }
const state = (rt, who) => ok(rt.call('bootstrap', {}, rt.as(WHO[who]))).state;

/** 一节新课的合法参数 */
function lessonParams(rt, sid, extra = {}) {
  return Object.assign({
    sid, date: new Date(rt.now() - HOUR).toISOString(), dur: 30,
    pieces: [{ title: 'Minuet in G', source: 'Petzold', st: 'new' }], focus: 'f', tempo: '♩ = 80', homework: 'h', due: ''
  }, extra);
}

module.exports = { assert, createRuntime, OWNER, al, MIN, HOUR, DAY, fresh, WHO, ok, err, state, lessonParams };
