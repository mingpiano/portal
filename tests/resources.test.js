'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, DAY, fresh, WHO, ok, err, state } = require('./helpers');
const J = x => JSON.parse(JSON.stringify(x));
const CH = 1000000;

/** 上传一个文件：返回资源 id 和原始字节。 */
function upload(rt, { name = 'scale.pdf', size = 2500000, title = '', sids = ['s-emma'], all = false, note = '' } = {}) {
  const admin = rt.as(OWNER);
  const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 255;
  const b = ok(rt.call('res.begin', { name, size, title, sids, all, note }, admin));
  for (let i = 0; i < b.parts; i++) ok(rt.call('res.chunk', { id: b.id, i, data: bytes.subarray(i * CH, (i + 1) * CH).toString('base64') }, admin));
  ok(rt.call('res.finish', { id: b.id }, admin));
  return { id: b.id, bytes, parts: b.parts };
}
const download = (rt, token, id, parts) => Buffer.concat(Array.from({ length: parts }, (_, i) => Buffer.from(ok(rt.call('res.get', { id, i }, token)).data, 'base64')));
const resOf = (rt, who) => J(state(rt, who).resources);

describe('资源库：上传与下载', () => {
  test('分段上传 → 分享给 Emma 的人能一段一段取回，拼起来和原文件逐字节相同', () => {
    const rt = fresh(); const u = upload(rt);
    assert.equal(u.parts, 3);
    const got = download(rt, rt.as(WHO.emma), u.id, u.parts);
    assert.ok(got.equals(u.bytes), '字节完全一致');
  });
  test('老师能取任何文件；家长能取自己孩子被分享的文件', () => {
    const rt = fresh(); const u = upload(rt);
    assert.ok(download(rt, rt.as(OWNER), u.id, u.parts).equals(u.bytes));
    assert.ok(download(rt, rt.as(WHO.li), u.id, u.parts).equals(u.bytes), 'Li 是 Emma 的家长');
  });
  test('没被分享到的人拿不到：别的学生、别的家长、成人学生，全部 forbidden', () => {
    const rt = fresh(); const u = upload(rt);
    for (const who of ['zihan', 'lucas', 'sophia', 'chen', 'wang']) err(rt.call('res.get', { id: u.id, i: 0 }, rt.as(WHO[who])), 'forbidden');
    err(rt.call('res.get', { id: 'nope', i: 0 }, rt.as(WHO.emma)), 'forbidden');
  });
  test('分享给“所有学生”：每个人都能取（包括之后新增的学生）', () => {
    const rt = fresh(); const u = upload(rt, { sids: [], all: true, size: 10 });
    for (const who of ['emma', 'zihan', 'sophia', 'li', 'chen']) ok(rt.call('res.get', { id: u.id, i: 0 }, rt.as(WHO[who])));
  });
  test('成人学生也有资源库：可以单独分享给 Sophia', () => {
    const rt = fresh(); const u = upload(rt, { sids: ['s-sophia'], size: 100, name: 'a.mp3' });
    assert.equal(resOf(rt, 'sophia').length, 1); ok(rt.call('res.get', { id: u.id, i: 0 }, rt.as(WHO.sophia)));
    assert.equal(resOf(rt, 'emma').length, 0);
  });
  test('文件存在云端硬盘的专用文件夹里（不公开）；删除资源会把所有段丢进回收站', () => {
    const rt = fresh(); const u = upload(rt);
    const files = [...rt.drive.values()].filter(f => !f.folder);
    assert.equal(files.length, 3); assert.ok(files.every(f => !f.trashed));
    ok(rt.call('res.delete', { id: u.id }, rt.as(OWNER)));
    assert.ok([...rt.drive.values()].filter(f => !f.folder).every(f => f.trashed));
    assert.equal(resOf(rt, 'admin').length, 0);
    err(rt.call('res.get', { id: u.id, i: 0 }, rt.as(WHO.emma)), 'forbidden');
  });
});

describe('资源库：校验', () => {
  const begin = (rt, p) => rt.call('res.begin', Object.assign({ name: 'a.pdf', size: 10, sids: ['s-emma'] }, p), rt.as(OWNER));
  test('只收 PDF / 音频 / 视频；按扩展名判断，网页自己报的类型不算', () => {
    const rt = fresh();
    for (const name of ['a.exe', 'a.html', 'a.svg', 'a.js', 'a', 'a.pdf.exe', '.pdf', 'a.docx']) err(begin(rt, { name }), 'bad_file_type');
    for (const name of ['a.pdf', 'A.PDF', 'a.mp3', 'a.m4a', 'a.wav', 'a.ogg', 'a.mp4', 'a.webm']) ok(begin(rt, { name }));
    const mimes = state(rt, 'admin').resources.map(r => r.mime);
    assert.ok(mimes.includes('application/pdf') && mimes.includes('video/mp4') && mimes.includes('audio/mpeg'));
  });
  test('大小：1 字节到 25MB；0、负数、超大、不是数字都拒绝', () => {
    const rt = fresh();
    ok(begin(rt, { size: 1 })); ok(begin(rt, { size: 25 * 1024 * 1024 }));
    for (const size of [0, -5, 25 * 1024 * 1024 + 1, 'big', null, 1.5]) err(begin(rt, { size }), 'bad_request');
  });
  test('分享对象必须选：没选人、不存在的学生、格式不对都拒绝', () => {
    const rt = fresh();
    err(begin(rt, { sids: [] }), 'bad_request'); err(begin(rt, { sids: ['nope'] }), 'not_found'); err(begin(rt, { sids: 'x' }), 'bad_request');
    ok(begin(rt, { sids: [], all: true }));
  });
  test('上传顺序和大小：不能跳段；每段大小必须对；坏的 base64 拒绝；没开始的不能传', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const b = ok(rt.call('res.begin', { name: 'a.pdf', size: 1500000, sids: ['s-emma'] }, admin));
    const full = Buffer.alloc(CH).toString('base64'), rest = Buffer.alloc(500000).toString('base64');
    err(rt.call('res.chunk', { id: b.id, i: 1, data: rest }, admin), 'bad_request');              // 跳段
    err(rt.call('res.chunk', { id: b.id, i: 0, data: rest }, admin), 'bad_request');              // 第一段大小不对
    err(rt.call('res.chunk', { id: b.id, i: 0, data: '***' }, admin), 'bad_request');
    err(rt.call('res.chunk', { id: b.id, i: 0, data: 5 }, admin), 'bad_request');
    err(rt.call('res.chunk', { id: b.id, i: 2, data: rest }, admin), 'bad_request');              // 超出段数
    err(rt.call('res.finish', { id: b.id }, admin), 'bad_request');                                // 没传完
    ok(rt.call('res.chunk', { id: b.id, i: 0, data: full }, admin));
    err(rt.call('res.chunk', { id: b.id, i: 1, data: full }, admin), 'bad_request');              // 最后一段大小不对
    ok(rt.call('res.chunk', { id: b.id, i: 1, data: rest }, admin));
    ok(rt.call('res.chunk', { id: b.id, i: 0, data: full }, admin));                               // 重传同一段：覆盖
    ok(rt.call('res.finish', { id: b.id }, admin));
    err(rt.call('res.chunk', { id: b.id, i: 0, data: full }, admin), 'not_found');                // 已完成的不能再改
    err(rt.call('res.chunk', { id: 'nope', i: 0, data: full }, admin), 'not_found');
  });
  test('没传完的资源，学生和家长看不到、取不到；老师看得到状态', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const b = ok(rt.call('res.begin', { name: 'a.pdf', size: 10, sids: ['s-emma'] }, admin));
    ok(rt.call('res.chunk', { id: b.id, i: 0, data: Buffer.alloc(10).toString('base64') }, admin));
    assert.equal(resOf(rt, 'emma').length, 0);
    err(rt.call('res.get', { id: b.id, i: 0 }, rt.as(WHO.emma)), 'forbidden');
    assert.equal(resOf(rt, 'admin')[0].status, 'uploading');
  });
  test('超过一天没传完的残留，下一次上传时被清理，云端的段也进回收站', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    const b = ok(rt.call('res.begin', { name: 'a.pdf', size: 10, sids: ['s-emma'] }, admin));
    ok(rt.call('res.chunk', { id: b.id, i: 0, data: Buffer.alloc(10).toString('base64') }, admin));
    rt.advance(2 * DAY);
    ok(rt.call('res.begin', { name: 'b.pdf', size: 10, sids: ['s-emma'] }, rt.login(OWNER, { remember: true })));
    assert.ok(![...rt.drive.values()].some(f => !f.folder && !f.trashed));
  });
  test('单次请求的大小：一段（约 1.3MB）可以，其他操作超过 200KB 就拒绝', () => {
    const rt = fresh();
    const big = JSON.stringify({ a: 'res.chunk', t: 'x'.repeat(64), p: { id: 'r', i: 0, data: 'A'.repeat(1340000) } });
    err(rt.raw(big), 'unauthorized'); // 过了大小检查，才因为令牌不对被拒
    err(rt.raw(JSON.stringify({ a: 'bootstrap', t: 'x'.repeat(64), p: { pad: 'A'.repeat(300000) } })), 'too_large');
    err(rt.raw(JSON.stringify({ p: { data: 'A'.repeat(300000) }, a: 'res.chunk' })), 'too_large'); // 把动作名藏到后面也没用
    err(rt.raw('x'.repeat(1500000)), 'too_large');
  });
});

describe('资源库：链接、分享、新资源提醒', () => {
  const link = (rt, p) => rt.call('res.link', Object.assign({ title: '示范视频', url: 'https://youtu.be/abc', sids: ['s-emma'] }, p), rt.as(OWNER));
  test('贴链接：只收 https；标题必填', () => {
    const rt = fresh();
    ok(link(rt, {}));
    for (const url of ['http://a.com', 'javascript:alert(1)', 'data:text/html,x', 'ftp://a', 'https://', 'https://a b.com', '', 'https://a.com/"onclick=1', 'https://' + 'a'.repeat(500)]) err(link(rt, { url }), 'bad_url');
    err(link(rt, { title: '' }), 'bad_request');
  });
  test('链接资源不能当文件取', () => {
    const rt = fresh(); const id = ok(link(rt, {})).state.resources[0].id;
    err(rt.call('res.get', { id, i: 0 }, rt.as(WHO.emma)), 'forbidden');
  });
  test('新资源提醒：分享后学生、家长各自显示“新”；打开资源页标记已读，互不影响', () => {
    const rt = fresh(); upload(rt, { size: 10 });
    assert.equal(resOf(rt, 'emma')[0].isNew, true); assert.equal(resOf(rt, 'li')[0].isNew, true);
    const id = resOf(rt, 'emma')[0].id;
    ok(rt.call('res.seen', { ids: [id] }, rt.as(WHO.emma)));
    assert.equal(resOf(rt, 'emma')[0].isNew, false); assert.equal(resOf(rt, 'li')[0].isNew, true);
    ok(rt.call('res.seen', { ids: [id, id, 'nope'] }, rt.as(WHO.emma))); // 重复、不存在都没事
    err(rt.call('res.seen', { ids: 'x' }, rt.as(WHO.emma)), 'bad_request');
  });
  test('不能替别人标已读：标一个没分享给自己的资源，不会有任何改动', () => {
    const rt = fresh(); upload(rt, { size: 10 });
    const id = resOf(rt, 'admin')[0].id;
    ok(rt.call('res.seen', { ids: [id] }, rt.as(WHO.zihan)));
    assert.equal(resOf(rt, 'emma')[0].isNew, true);
    assert.ok(!JSON.stringify(rt.sheet('Resources').data).includes('student:s-zihan'));
  });
  test('改分享对象：新加的学生看到“新”，被去掉的立刻看不到、也取不到', () => {
    const rt = fresh(); const u = upload(rt, { size: 10 });
    const admin = rt.as(OWNER);
    ok(rt.call('res.update', { id: u.id, title: '新标题', note: 'n', sids: ['s-zihan'] }, admin));
    assert.equal(resOf(rt, 'emma').length, 0); err(rt.call('res.get', { id: u.id, i: 0 }, rt.as(WHO.emma)), 'forbidden');
    assert.equal(resOf(rt, 'zihan')[0].title, '新标题'); ok(rt.call('res.get', { id: u.id, i: 0 }, rt.as(WHO.zihan)));
    err(rt.call('res.update', { id: u.id, title: '', sids: ['s-zihan'] }, admin), 'bad_request');
    err(rt.call('res.update', { id: 'nope', title: 'x', sids: ['s-zihan'] }, admin), 'not_found');
  });
  test('学生和家长的数据里没有：别的学生的名字或编号、云端文件编号、分享名单', () => {
    const rt = fresh(); upload(rt, { sids: ['s-emma', 's-zihan'], size: 10 });
    const s = JSON.stringify(state(rt, 'emma').resources);
    assert.ok(!/s-zihan|chunks|sids|driveId|file\d/.test(s), s);
    assert.ok(!/"all"|"status"/.test(s));
    const a = state(rt, 'admin').resources[0]; assert.deepEqual(a.sids.sort(), ['s-emma', 's-zihan']); assert.ok(!('chunks' in a));
  });
  test('老师预览学生：看到的资源和学生自己的一样，预览不会标已读', () => {
    const rt = fresh(); upload(rt, { size: 10 });
    const pv = ok(rt.call('preview.state', { sid: 's-emma' }, rt.as(OWNER))).preview;
    assert.deepEqual(pv.resources, state(rt, 'emma').resources);
    assert.equal(resOf(rt, 'emma')[0].isNew, true);
  });
  test('归档的学生看不到资源；资源总数有上限', () => {
    const rt = fresh(), admin = rt.as(OWNER);
    upload(rt, { size: 10 });
    const emma = rt.as(WHO.emma);
    ok(rt.call('students.archive', { id: 's-emma', active: false }, admin));
    err(rt.call('res.get', { id: resOf(rt, 'admin')[0].id, i: 0 }, emma), 'unauthorized');
    for (let i = 0; i < 299; i++) ok(link(rt, { title: 't' + i }));
    err(link(rt, {}), 'too_many');
  });
  test('老版本的表格自动补上 Resources 表；其他身份不能用老师的操作', () => {
    const rt = fresh();
    assert.ok(rt.sheet('Resources'));
    for (const a of ['res.begin', 'res.chunk', 'res.finish', 'res.link', 'res.update', 'res.delete']) { err(rt.call(a, {}, rt.as(WHO.emma)), 'forbidden'); err(rt.call(a, {}, rt.as(WHO.li)), 'forbidden'); }
    err(rt.call('res.seen', {}, rt.as(OWNER)), 'forbidden');
  });
});
