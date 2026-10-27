'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, fresh, ok, err, state, WHO: WHO_ } = require('./helpers');
const J = x => JSON.parse(JSON.stringify(x));

describe('教材 / 单曲：和学生资料一起保存', () => {
  test('编辑学生时带上 books：一次保存，教材不再丢；单曲可注明选自哪本曲集', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const stu = J(state(rt, 'admin').students.find(s => s.id === 's-emma'));
    const books = [{ n: 'Thompson 4', s: 'current' }, { n: 'Für Elise', s: 'current', k: 'single', f: 'Beethoven 精选集' }, { n: 'Minuet', s: 'done', k: 'single' }];
    ok(rt.call('students.save', { student: { ...stu, id: 's-emma', books } }, admin));
    assert.deepEqual(J(state(rt, 'emma').students[0].books), books);
  });
  test('不带 books 的保存不动原有教材', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const before = J(state(rt, 'admin').students.find(s => s.id === 's-emma').books);
    ok(rt.call('students.save', { student: { id: 's-emma', name: 'Emma Li', kind: 'child', lang: 'en' } }, admin));
    assert.deepEqual(J(state(rt, 'admin').students.find(s => s.id === 's-emma').books), before);
  });
  test('新建学生时也能带教材；清空教材（空数组）会真的清空', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const r = ok(rt.call('students.save', { student: { name: 'Andy', kind: 'child', lang: 'zh', books: [{ n: 'Faber 2A', s: 'current' }] } }, admin));
    assert.deepEqual(J(state(rt, 'admin').students.find(s => s.id === r.id).books), [{ n: 'Faber 2A', s: 'current' }]);
    ok(rt.call('students.save', { student: { id: r.id, name: 'Andy', kind: 'child', lang: 'zh', books: [] } }, admin));
    assert.deepEqual(J(state(rt, 'admin').students.find(s => s.id === r.id).books), []);
  });
  test('坏数据整体拒绝，学生资料和教材都不改', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const before = J(state(rt, 'admin').students.find(s => s.id === 's-emma'));
    for (const books of [[{ n: '', s: 'current' }], [{ n: 'a', s: 'x' }], [{ n: 'a', s: 'done', k: 'weird' }], [null], 'nope', Array.from({ length: 41 }, () => ({ n: 'a', s: 'done' }))])
      err(rt.call('students.save', { student: { id: 's-emma', name: 'Changed', kind: 'child', lang: 'en', books } }, admin), 'bad_request');
    assert.deepEqual(J(state(rt, 'admin').students.find(s => s.id === 's-emma')), before);
  });
  test('单曲的“选自”只保存非空的；k 为 book 或空等于整本教材', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    ok(rt.call('books.save', { sid: 's-emma', books: [{ n: 'A', s: 'current', k: 'single', f: '  ' }, { n: 'B', s: 'current', k: 'book' }, { n: 'C', s: 'done', k: '' }] }, admin));
    assert.deepEqual(J(state(rt, 'emma').students[0].books), [{ n: 'A', s: 'current', k: 'single' }, { n: 'B', s: 'current' }, { n: 'C', s: 'done' }]);
  });
});

describe('老师预览家长页', () => {
  test('预览家长：和家长自己登录时拿到的完全一样；只含自己孩子的数据', () => {
    const rt = fresh();
    const parents = J(state(rt, 'admin').parents);
    for (const [who, pr] of [['li', parents.find(p => /li/i.test(p.email))], ['chen', parents.find(p => /chen/i.test(p.email))]]) {
      const pv = ok(rt.call('preview.state', { pid: pr.id }, rt.as(OWNER))).preview;
      assert.equal(pv.me.role, 'parent'); assert.equal(pv.me.id, pr.id);
      assert.deepEqual({ ...pv, now: 0 }, { ...state(rt, who), now: 0 }, who);
      assert.equal(pv.teacherTz, undefined);
    }
  });
  test('只有老师能用；不存在或已归档的家长拿不到', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const pr = J(state(rt, 'admin').parents)[0];
    err(rt.call('preview.state', { pid: pr.id }, rt.as(WHO_.emma)), 'forbidden');
    err(rt.call('preview.state', { pid: pr.id }, rt.as(WHO_.li)), 'forbidden');
    err(rt.call('preview.state', { pid: 'nope' }, admin), 'not_found');
    ok(rt.call('parents.archive', { id: pr.id, active: false }, admin));
    err(rt.call('preview.state', { pid: pr.id }, admin), 'not_found');
  });
});
