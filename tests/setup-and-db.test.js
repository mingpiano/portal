'use strict';
const { test, describe } = require('node:test');
const { assert, createRuntime, OWNER, fresh, WHO, ok, err, state } = require('./helpers');

const COUNT = n => rt => rt.sheet(n).getLastRow() - 1;

describe('初始化与数据层', () => {
  test('setupTest 建齐所有表和表头，并灌入假数据', () => {
    const rt = fresh();
    const names = Object.keys(rt.ctx.SHEETS_);
    for (const n of names) {
      const sh = rt.sheet(n);
      assert.ok(sh, 'missing sheet ' + n);
      const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      const want = Array.from(rt.ctx.SHEETS_[n], c => c.split(':')[0]);
      assert.deepEqual([...header], want, n);
    }
    assert.equal(rt.sheet('Sheet1'), null, '默认的 Sheet1 应该删掉');
    assert.deepEqual([COUNT('Students')(rt), COUNT('Parents')(rt), COUNT('Pairs')(rt), COUNT('Lessons')(rt)], [5, 3, 4, 13]);
    assert.equal(COUNT('Admins')(rt), 1);
    assert.equal(rt.props.get('ENV'), 'test');
  });

  test('假学生的邮箱全是测试账号的 +别名，真学生不可能收到邮件', () => {
    const rt = fresh();
    const emails = [...rt.sheet('Students').getRange(2, 3, 5, 1).getValues().map(r => r[0]),
      ...rt.sheet('Parents').getRange(2, 3, 3, 1).getValues().map(r => r[0])].filter(Boolean);
    assert.equal(emails.length, 7);
    for (const e of emails) assert.ok(rt.ctx.baseEmail_(e) === rt.ctx.baseEmail_(OWNER) && e.includes('+'), e);
  });

  test('重复运行 setup 会被拒绝，不会覆盖已有数据', () => {
    const rt = fresh();
    assert.throws(() => rt.run('setupTest'), /已经初始化/);
    assert.throws(() => rt.run('setupProd'), /已经初始化/);
  });

  test('setupProd：只有空表和老师账号，没有任何假数据', () => {
    const rt = createRuntime({ owner: 'wife@gmail.com', quiet: true });
    rt.run('setupProd');
    assert.equal(rt.props.get('ENV'), 'prod');
    for (const n of ['Students', 'Parents', 'Pairs', 'Lessons', 'Notices', 'Messages']) assert.equal(COUNT(n)(rt), 0, n);
    assert.equal(COUNT('Admins')(rt), 1);
    assert.equal(rt.sheet('Admins').getRange(2, 1).getValue(), 'wife@gmail.com');
    const tok = rt.login('wife@gmail.com');
    const s = ok(rt.call('bootstrap', {}, tok)).state;
    assert.equal(s.env, 'prod');
    assert.equal(s.students.length, 0);
  });

  test('resetTestData：测试环境可以重来；正式环境拒绝运行', () => {
    const rt = fresh();
    rt.call('notices.send', { scope: 'all', title: 't', body: 'b' }, rt.as(OWNER));
    assert.equal(COUNT('Notices')(rt), 4);
    rt.run('resetTestData');
    assert.deepEqual([COUNT('Students')(rt), COUNT('Lessons')(rt), COUNT('Notices')(rt)], [5, 13, 3]);

    const prod = createRuntime({ owner: 'wife@gmail.com', quiet: true });
    prod.run('setupProd');
    const tok = prod.login('wife@gmail.com');
    ok(prod.call('students.save', { student: { name: '真学生', kind: 'child' } }, tok));
    assert.throws(() => prod.run('resetTestData'), /只有测试环境能重置/);
    assert.equal(COUNT('Students')(prod), 1, '真数据不能被清掉');
  });

  test('日期、数字、true/false 在 Sheets 里保持原样（纯文本格式生效）', () => {
    const rt = fresh();
    const s = state(rt, 'admin').students.find(x => x.id === 's-emma');
    assert.match(s.birth, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(s.start, /^\d{4}-\d{2}-\d{2}$/);
    // 表里存的确实是字符串，而不是被 Sheets 自动转换的日期
    const cell = rt.sheet('Students').getRange(2, 5).getValue();
    assert.equal(typeof cell, 'string');
    assert.equal(cell, s.birth);
  });

  test('模拟层自检：不设纯文本格式，日期/数字/公式真的会被 Sheets 自动改写', () => {
    const rt = fresh();
    const sh = rt.sheet('Config');
    const probe = sh.getRange(50, 10, 1, 4); // 表结构之外的格子，没设过纯文本格式
    probe.setValues([['2018-03-04', '007', 'TRUE', '=1+1']]);
    const v = probe.getValues()[0];
    assert.equal(Object.prototype.toString.call(v[0]), '[object Date]');
    assert.equal(v[1], 7);
    assert.equal(v[2], true);
    assert.equal(v[3], '#FORMULA!');
  });

  test('以 = 开头的文字当作普通文字保存，不会变成公式', () => {
    const rt = fresh();
    const evil = '=HYPERLINK("http://evil.example","点我")';
    const id = ok(rt.call('students.save', { student: { name: evil, kind: 'child' } }, rt.as(OWNER))).id;
    const s = state(rt, 'admin').students.find(x => x.id === id);
    assert.equal(s.name, evil);
    const row = rt.sheet('Students').getLastRow();
    assert.equal(rt.sheet('Students').getRange(row, 2).getValue(), evil);
  });

  test('老师在表格里调换列顺序、多加一列备注，系统照常读写', () => {
    const rt = fresh();
    const sh = rt.sheet('Students');
    // 交换第 2、3 列（name 和 email），再在最右边加一列“备注”
    for (let r = 1; r <= sh.getLastRow(); r++) {
      const a = sh._get(r, 2), b = sh._get(r, 3);
      sh._set(r, 2, b); sh._set(r, 3, a);
    }
    sh._set(1, sh.getLastColumn() + 1, '备注');
    sh._set(2, sh.getLastColumn(), '这位学生周三常迟到');
    const s = state(rt, 'admin');
    assert.equal(s.students.find(x => x.id === 's-emma').name, 'Emma Li');
    ok(rt.call('students.save', { student: { id: 's-emma', name: 'Emma L.', kind: 'child', paid: 2, carry: 14 } }, rt.as(OWNER)));
    assert.equal(state(rt, 'admin').students.find(x => x.id === 's-emma').name, 'Emma L.');
    assert.equal(sh._get(2, sh.getLastColumn()), '这位学生周三常迟到', '备注列不能被覆盖');
  });

  test('老师在 Sheets 界面里手改生日，被转成日期对象后也能读回 YYYY-MM-DD', () => {
    const rt = fresh();
    const sh = rt.sheet('Students');
    sh.data[1][4] = new Date(Date.UTC(2015, 5, 9, 6, 0, 0)); // 第 2 行第 5 列 = birth；6月9日 0 点（Denver 时区，与本机时区无关）
    assert.equal(state(rt, 'admin').students[0].birth, '2015-06-09');
  });

  test('缺列会明确报错，而不是悄悄读出错数据', () => {
    const rt = fresh();
    const tok = rt.as(OWNER);
    rt.sheet('Students')._set(1, 4, 'kindx'); // 把 kind 列改名
    const r = rt.call('bootstrap', {}, tok);
    err(r, 'schema_mismatch');
    assert.ok(!JSON.stringify(r).includes('Students'), '只告诉网页“表结构不对”，不带表名');
  });

  test('upgradeSchema：后面几期加新表、新列，运行一次就补齐，已有数据不动', () => {
    const rt = fresh();
    const tok = rt.as(OWNER);
    const before = JSON.stringify(state(rt, 'admin').students.map(x => [x.id, x.name, x.birth]));
    const ss = rt.spreadsheets.get(rt.props.get('SHEET_ID'));
    ss.deleteSheet(ss.getSheetByName('MailLog'));          // 缺一张表
    rt.ctx.SHEETS_.Students.push('theme');                  // 第二期给学生加一列
    err(rt.call('bootstrap', {}, tok), 'schema_mismatch');   // 新代码先上线、还没升级表：明确报错
    rt.run('upgradeSchema');
    assert.ok(rt.sheet('MailLog'), '缺的表补回来');
    const sh = rt.sheet('Students');
    assert.equal(sh._get(1, sh.getLastColumn()), 'theme', '新列追加在最后');
    rt.ctx.resetRequest_();
    assert.equal(JSON.stringify(state(rt, 'admin').students.map(x => [x.id, x.name, x.birth])), before, '已有数据不变');
    ok(rt.call('students.save', { student: { name: '新同学', kind: 'child' } }, tok));
  });
});

describe('接口的健壮性', () => {
  test('坏请求：非 JSON、未知操作、超大请求、数组参数，都返回干净的错误', () => {
    const rt = fresh();
    err(rt.raw('not json'), 'bad_request');
    err(rt.raw('[]'), 'bad_request');
    err(rt.raw('{"a":"nope"}'), 'unknown_action');
    err(rt.raw(JSON.stringify({ a: 'bootstrap', p: [] })), 'bad_request');
    err(rt.raw('x'.repeat(200001)), 'too_large');
    err(rt.raw(JSON.stringify({ a: '__proto__' })), 'unknown_action');
    err(rt.raw(JSON.stringify({ a: 'constructor' })), 'unknown_action');
  });

  test('出现意外错误时不泄露细节，并且锁会释放', () => {
    const rt = fresh();
    const tok = rt.as(OWNER);
    rt.ctx.hNoticeSend_ = () => { throw new TypeError('secret internal detail: Students!B7'); }; // 模拟代码里的意外错误
    const r = rt.call('notices.send', { scope: 'all', title: 't', body: 'b' }, tok);
    err(r, 'server');
    assert.equal(rt.locked, false, '出错后锁必须释放');
    assert.ok(!JSON.stringify(r).includes('secret'), '错误里不能带内部细节');
  });

  test('别人正占着锁时，写操作返回 busy，读操作不受影响', () => {
    const rt = fresh();
    const tok = rt.as(OWNER);
    rt.locked = true;
    err(rt.call('notices.send', { scope: 'all', title: 't', body: 'b' }, tok), 'busy');
    ok(rt.call('bootstrap', {}, tok));
    rt.locked = false;
  });

  test('doGet 只说服务在线，不返回任何数据', () => {
    const rt = fresh();
    const out = JSON.parse(rt.ctx.doGet().getContent());
    assert.deepEqual(Object.keys(out).sort(), ['api', 'ok', 'service']);
  });
});
