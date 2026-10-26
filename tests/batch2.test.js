'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, HOUR, fresh, WHO, ok, err, state, lessonParams } = require('./helpers');

let n = 0;
const log = (rt, pieces, extra = {}) => rt.call('lessons.log', lessonParams(rt, 's-emma', Object.assign({ pieces, homework: '', date: new Date(rt.now() - (1 + n++ * 2) * HOUR).toISOString() }, extra)), rt.as(OWNER));
const lesson = (rt, id, who = 'emma') => state(rt, who).lessons.find(l => l.id === id);

describe('多曲目、速度、作业标记', () => {
  const P = [
    { title: 'Arabesque', source: 'Burgmüller', tempo: { n: 'q', b: 80 }, hw: true, st: 'review', hwTempo: { n: 'q', b: 96 }, video: true },
    { title: 'Minuet', source: 'Petzold', tempo: { n: 'e', b: 120 }, hw: false },
    { title: 'Scale', hw: true, st: 'new' }
  ];

  test('每首曲子保存自己的速度、作业标记、作业速度、是否要录视频；不是作业的记为“学过”', () => {
    const rt = fresh(); const id = ok(log(rt, P)).id;
    const ps = lesson(rt, id).notes.pieces;
    assert.deepEqual(ps[0], { title: 'Arabesque', source: 'Burgmüller', tempo: { n: 'q', b: 80 }, hw: true, st: 'review', hwTempo: { n: 'q', b: 96 }, video: true });
    assert.equal(ps[1].st, 'done'); assert.equal(ps[1].hw, false);
    assert.ok(!('hwTempo' in ps[1]) && !('video' in ps[1]));
    assert.equal(ps[2].st, 'new'); assert.ok(!('tempo' in ps[2]));
  });

  test('“不是作业”的曲子即使带着视频、作业速度，也不会保存这些；状态被强制为学过', () => {
    const rt = fresh();
    const id = ok(log(rt, [{ title: 'X', hw: false, st: 'new', video: true, hwTempo: { n: 'q', b: 90 } }])).id;
    assert.deepEqual(lesson(rt, id).notes.pieces[0], { title: 'X', source: '', hw: false, st: 'done' });
  });

  test('作业项 = 标为作业的曲子（按顺序）+ 文字作业每一行；勾选按这个序号', () => {
    const rt = fresh(); const emma = rt.as(WHO.emma);
    const id = ok(log(rt, P, { homework: '音阶\n视奏' })).id; // 作业项 4 个：Arabesque、Scale、音阶、视奏
    assert.deepEqual(Array.from(rt.ctx.hwList_(lesson(rt, id).notes).map(x => x.k)), ['p', 'p', 't', 't']);
    for (const idx of [0, 3]) ok(rt.call('homework.check', { id, idx, on: true }, emma));
    err(rt.call('homework.check', { id, idx: 4, on: true }, emma), 'bad_request');
    assert.deepEqual(lesson(rt, id).hwDone, [0, 3]);
  });

  test('只有曲子作业、没有文字作业也能勾选；全部不是作业时没有作业项', () => {
    const rt = fresh(), emma = rt.as(WHO.emma);
    const a = ok(log(rt, [{ title: 'A', hw: true }])).id;
    ok(rt.call('homework.check', { id: a, idx: 0, on: true }, emma));
    const b = ok(log(rt, [{ title: 'B', hw: false }])).id;
    err(rt.call('homework.check', { id: b, idx: 0, on: true }, emma), 'bad_request');
  });

  test('速度的音符只能是约定的几种，拍数 20–400 的整数', () => {
    const rt = fresh();
    for (const tempo of [{ n: 'x', b: 80 }, { n: 'q', b: 19 }, { n: 'q', b: 401 }, { n: 'q', b: 80.5 }, { n: 'q', b: 'abc' }, 'fast'])
      err(log(rt, [{ title: 'A', tempo }]), 'bad_request');
    for (const nn of ['w', 'h', 'h.', 'q', 'q.', 'e', 'e.', 's']) ok(log(rt, [{ title: 'A' + nn, tempo: { n: nn, b: 60 } }]));
  });

  test('速度留空 = 没有速度，不报错', () => {
    const rt = fresh();
    const id = ok(log(rt, [{ title: 'A', tempo: { n: 'q', b: '' } }, { title: 'B', tempo: null }, { title: 'C', hw: true, hwTempo: { n: 'q', b: '' } }])).id;
    for (const p of lesson(rt, id).notes.pieces) assert.ok(!('tempo' in p) && !('hwTempo' in p));
  });

  test('曲目数量：1–12 首；作业项合计最多 20（曲子作业 + 文字作业）', () => {
    const rt = fresh();
    err(log(rt, []), 'bad_request');
    err(log(rt, Array.from({ length: 13 }, (_, i) => ({ title: 'p' + i }))), 'bad_request');
    ok(log(rt, Array.from({ length: 12 }, (_, i) => ({ title: 'p' + i, hw: true })), { homework: Array.from({ length: 8 }, (_, i) => 'x' + i).join('\n') }));
    err(log(rt, Array.from({ length: 12 }, (_, i) => ({ title: 'q' + i, hw: true })), { homework: Array.from({ length: 9 }, (_, i) => 'y' + i).join('\n') }), 'too_long');
  });

  test('非法的曲目数据被拒绝', () => {
    const rt = fresh();
    err(log(rt, [null]), 'bad_request'); err(log(rt, ['abc']), 'bad_request');
    err(log(rt, [{ title: '' }]), 'bad_request');
    err(log(rt, [{ title: 'A', hw: true, st: 'done' }]), 'bad_request'); // 作业只能是新曲或巩固
  });

  test('学习页：旧格式的课照旧；新格式里“不是作业”的进入“学过”，是作业的留在“正在学”', () => {
    const rt = fresh();
    ok(log(rt, [{ title: 'Old', source: '', st: 'review' }, { title: 'Old2', source: '', st: 'done' }]));
    ok(log(rt, [{ title: 'Alpha', hw: true, st: 'new' }, { title: 'Beta', hw: false }]));
    const stu = state(rt, 'admin').students.find(x => x.id === 's-emma');
    const names = k => (stu.learning[k] || []).map(e => e.title);
    assert.ok(names('current').includes('Old') && names('current').includes('Alpha'));
    assert.ok(names('finished').includes('Old2') && names('finished').includes('Beta'));
    assert.ok(!names('current').includes('Beta'));
  });

  test('学生和家长看得到每首曲子的速度和视频要求；邮件和老师端不丢数据', () => {
    const rt = fresh(); const id = ok(log(rt, P)).id;
    for (const who of ['emma', 'li', 'admin']) assert.equal(lesson(rt, id, who).notes.pieces[0].video, true, who);
  });
});
