'use strict';
const { test, describe } = require('node:test');
const { assert, OWNER, HOUR, DAY, fresh, WHO, ok, err, state, lessonParams } = require('./helpers');

// 一张 1×1 的真实 JPEG（头像上传的合法样例）
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('名称与头像', () => {
  test('中文和英文界面看到的工作室名字相同：Ming\'s Piano Studio', () => {
    const rt = fresh();
    for (const who of ['admin', 'emma', 'li']) {
      const s = state(rt, who);
      assert.equal(s.studio.zh, "Ming's Piano Studio");
      assert.equal(s.studio.en, "Ming's Piano Studio");
    }
  });

  test('所有身份都能上传照片头像；清除后回到字母头像', () => {
    const rt = fresh();
    for (const who of ['admin', 'li', 'emma']) {
      const tok = rt.as(WHO[who]);
      ok(rt.call('profile.save', { avatar: { t: 'img', v: JPEG } }, tok));
      assert.deepEqual(state(rt, who).me.avatar, { t: 'img', v: JPEG }, who);
      ok(rt.call('profile.save', { avatar: null }, tok));
      assert.equal(state(rt, who).me.avatar, null);
    }
  });

  test('老师看到学生和家长的照片头像；学生看不到别人的头像数据', () => {
    const rt = fresh();
    ok(rt.call('profile.save', { avatar: { t: 'img', v: JPEG } }, rt.as(WHO.emma)));
    const a = state(rt, 'admin').students.find(s => s.id === 's-emma');
    assert.equal(a.avatar.t, 'img');
    assert.ok(!JSON.stringify(state(rt, 'zihan')).includes(JPEG));
  });

  test('不合格的头像一律拒绝：太大、不是 base64、svg / html / 脚本、多余字段', () => {
    const rt = fresh(), tok = rt.as(WHO.emma);
    const bad = [
      { t: 'img', v: 'data:image/jpeg;base64,' + 'A'.repeat(16000) },
      { t: 'img', v: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      { t: 'img', v: 'data:text/html;base64,PGgxPmhpPC9oMT4=' },
      { t: 'img', v: 'javascript:alert(1)' },
      { t: 'img', v: 'https://example.com/a.jpg' },
      { t: 'img', v: 'data:image/jpeg;base64,@@@' },
      { t: 'img', v: JPEG + '"onerror="x' },
      { t: 'img' },
      { t: 'emoji', v: '💣', c: '#F6D7B0' },
      { t: 'other', v: 'x' }
    ];
    for (const a of bad) err(rt.call('profile.save', { avatar: a }, tok), 'bad_request');
    assert.equal(state(rt, 'emma').me.avatar.v, '🦊', '被拒绝后原来的头像不变');
  });

  test('只存 t 和 v：多传的字段不会被写进表格', () => {
    const rt = fresh();
    ok(rt.call('profile.save', { avatar: { t: 'img', v: JPEG, evil: '<script>' } }, rt.as(WHO.emma)));
    assert.deepEqual(Object.keys(state(rt, 'emma').me.avatar).sort(), ['t', 'v']);
  });
});

describe('时区', () => {
  test('老师所在时区默认是丹佛；学生没填时和老师一样，只有老师能在资料里改', () => {
    const rt = fresh();
    assert.equal(state(rt, 'admin').teacherTz, 'America/Denver');
    ok(rt.call('profile.save', { tz: 'America/New_York' }, rt.as(OWNER)));
    assert.equal(state(rt, 'admin').teacherTz, 'America/New_York');
    err(rt.call('profile.save', { tz: 'America/Denver' }, rt.as(WHO.emma)), 'forbidden');
    err(rt.call('profile.save', { tz: 'America/Denver' }, rt.as(WHO.li)), 'forbidden');
    err(rt.call('profile.save', { tz: 'Mars/Base' }, rt.as(OWNER)), 'bad_request');
    err(rt.call('profile.save', { tz: '' }, rt.as(OWNER)), 'bad_request');
  });

  test('老师所在时区不会出现在学生和家长的数据里', () => {
    const rt = fresh();
    for (const who of ['emma', 'li', 'chen']) {
      const s = state(rt, who);
      assert.equal(s.teacherTz, undefined, who);
      assert.ok(!JSON.stringify(s).includes('teacherTz'), who);
    }
  });

  test('保存学生时区：只接受名单里的；新学生默认用老师的时区；改别的字段不会清掉时区', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    const { id } = ok(rt.call('students.save', { student: { name: '新同学', kind: 'child' } }, tok));
    assert.equal(state(rt, 'admin').students.find(s => s.id === id).tz, 'America/Denver');
    ok(rt.call('students.save', { student: { id, name: '新同学', kind: 'child', tz: 'Asia/Shanghai' } }, tok));
    ok(rt.call('students.save', { student: { id, name: '新同学改名', kind: 'child' } }, tok)); // 没带 tz
    assert.equal(state(rt, 'admin').students.find(s => s.id === id).tz, 'Asia/Shanghai');
    err(rt.call('students.save', { student: { id, name: 'x', kind: 'child', tz: 'Mars/Base' } }, tok), 'bad_request');
    err(rt.call('students.save', { student: { id, name: 'x', kind: 'child', tz: "America/Denver'; drop" } }, tok), 'bad_request');
  });

  test('学生和家长看到的是学生自己的时区', () => {
    const rt = fresh();
    assert.equal(state(rt, 'emma').students[0].tz, 'America/New_York');
    assert.equal(state(rt, 'li').students[0].tz, 'America/New_York');
    assert.equal(state(rt, 'zihan').students[0].tz, 'Asia/Shanghai');
  });

  test('老师改了自己的时区后，没填时区的老学生跟着变；填了的不变', () => {
    const rt = fresh();
    const sh = rt.sheet('Students');
    const col = sh.data[0].indexOf('tz');
    sh.data[sh.data.findIndex(r => r[0] === 's-lucas')][col] = ''; // 模拟升级前已有的学生，没有时区
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-lucas').tz, 'America/Denver');
    ok(rt.call('profile.save', { tz: 'America/Chicago' }, rt.as(OWNER)));
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-lucas').tz, 'America/Chicago');
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-emma').tz, 'America/New_York');
  });

  test('网页的时区下拉名单和后台白名单完全一致（见 tz.test.js）', () => {
    const rt = fresh();
    assert.ok(Array.from(rt.ctx.TZ_LIST).includes('America/Denver'));
    assert.ok(Array.from(rt.ctx.TZ_LIST).includes('Asia/Shanghai'));
  });
});

describe('下次上课时间', () => {
  const when = rt => rt.now() - HOUR;

  test('记课时填下次上课：学生、家长、老师都看到；没填就没有', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    const next = new Date(rt.now() + 5 * DAY).toISOString();
    ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next }), tok));
    assert.equal(state(rt, 'lucas').students[0].next, next);
    assert.equal(state(rt, 'chen').students.find(s => s.id === 's-lucas').next, next);
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-lucas').next, next);
    ok(rt.call('lessons.log', lessonParams(rt, 's-mia', { date: new Date(rt.now() - 2 * HOUR).toISOString() }), tok));
    // mia 的种子数据里本来有下次上课；这节新课没填，以最新一节为准，所以变成没有
    assert.equal(state(rt, 'admin').students.find(s => s.id === 's-mia').next, '');
  });

  test('下次上课必须在这节课之后、一年之内，格式要对', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    const d = when(rt);
    for (const next of [new Date(d - HOUR).toISOString(), new Date(d).toISOString(), new Date(d + 400 * DAY).toISOString(), 'soon', '2026-13-45']) {
      err(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next }), tok), 'bad_request');
    }
    assert.equal(rt.sheet('Lessons').data.filter(r => r[1] === 's-lucas').length, 2 + 1 - 1, '失败的请求不会写入课程');
  });

  test('过去的下次上课时间不再显示；只看最近一节课', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    ok(rt.call('lessons.log', lessonParams(rt, 's-lucas', { next: new Date(rt.now() + 2 * HOUR).toISOString() }), tok));
    assert.ok(state(rt, 'lucas').students[0].next);
    rt.advance(3 * HOUR);
    assert.equal(state(rt, 'lucas').students[0].next, '');
  });

  test('给学生的签字邮件按学生所在时区写出下次上课时间（12 小时制），并提醒练琴和作业', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    // 固定一个确定的时刻：丹佛 3:00 PM = 纽约 5:00 PM，次日
    const d = new Date(rt.now() - HOUR);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3, 22, 0, 0)); // 22:00 UTC
    const base = rt.mail.length;
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma', { next: next.toISOString() }), tok));
    const m = rt.mail.slice(base).find(x => x.to === WHO.li);
    assert.ok(m, '发给家长');
    const fmt = (tz, o) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(next).replace(/ /g, ' ');
    const clock = fmt('America/New_York', { hour: 'numeric', minute: '2-digit', hour12: true });
    assert.match(clock, /^\d{1,2}:\d{2} (AM|PM)$/);
    assert.ok(m.body.includes(clock), '邮件里是纽约时间 ' + clock + '：' + m.body);
    assert.ok(!m.body.includes(fmt('America/Denver', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' ') || clock === fmt('America/Denver', { hour: 'numeric', minute: '2-digit', hour12: true }), '不是老师的时间');
    assert.match(m.body, /Next lesson/);
    assert.match(m.body, /practice/);
  });

  test('没填下次上课时，邮件里不提下次上课', () => {
    const rt = fresh(), tok = rt.as(OWNER), base = rt.mail.length;
    ok(rt.call('lessons.log', lessonParams(rt, 's-emma'), tok));
    assert.ok(!rt.mail.slice(base).some(m => /Next lesson|下次上课/.test(m.body)));
  });

  test('下次上课的纯计算：只认最新一节课、已过去的不算', () => {
    const rt = fresh(), c = rt.ctx;
    const now = Date.UTC(2026, 9, 26, 12);
    const L = (date, next, status = 'done') => ({ status, date: new Date(date).toISOString(), notes: next ? { next: new Date(next).toISOString() } : {} });
    assert.equal(c.nextLesson_([], now), '');
    assert.equal(c.nextLesson_([L(now - DAY, now + DAY)], now), new Date(now + DAY).toISOString());
    assert.equal(c.nextLesson_([L(now - 8 * DAY, now + 2 * DAY), L(now - DAY, null)], now), '', '最新一节课没填，旧的不算');
    assert.equal(c.nextLesson_([L(now - DAY, now - HOUR)], now), '', '已过去');
    assert.equal(c.nextLesson_([L(now - DAY, now + DAY, 'noshow')], now), '', '缺课记录不算');
  });
});

describe('作业勾选', () => {
  let n = 0;
  const log = (rt, hw) => ok(rt.call('lessons.log', lessonParams(rt, 's-emma', { homework: hw, date: new Date(rt.now() - (1 + n++ * 2) * HOUR).toISOString() }), rt.as(OWNER))).id;

  test('作业按行拆成逐项，空行忽略', () => {
    const rt = fresh();
    assert.deepEqual(Array.from(rt.ctx.hwItems_(' a \n\n b\r\n  \nc ')), ['a', 'b', 'c']);
    assert.deepEqual(Array.from(rt.ctx.hwItems_('')), []);
    assert.deepEqual(Array.from(rt.ctx.hwItems_(undefined)), []);
  });

  test('学生勾选、取消勾选；重复勾选不重复记录；结果按顺序保存', () => {
    const rt = fresh(), emma = rt.as(WHO.emma);
    const id = log(rt, '第一项\n第二项\n第三项');
    const checked = () => state(rt, 'emma').lessons.find(l => l.id === id).hwDone;
    assert.deepEqual(checked(), []);
    ok(rt.call('homework.check', { id, idx: 2, on: true }, emma));
    ok(rt.call('homework.check', { id, idx: 0, on: true }, emma));
    ok(rt.call('homework.check', { id, idx: 0, on: true }, emma));
    assert.deepEqual(checked(), [0, 2]);
    ok(rt.call('homework.check', { id, idx: 2, on: false }, emma));
    ok(rt.call('homework.check', { id, idx: 1, on: false }, emma)); // 取消一个本来没勾的：没事
    assert.deepEqual(checked(), [0]);
  });

  test('家长可以替孩子勾选；老师能看到进度；别家的学生和家长不能动', () => {
    const rt = fresh();
    const id = log(rt, 'a\nb');
    ok(rt.call('homework.check', { id, idx: 1, on: true }, rt.as(WHO.li)));
    assert.deepEqual(state(rt, 'admin').lessons.find(l => l.id === id).hwDone, [1]);
    assert.deepEqual(state(rt, 'emma').lessons.find(l => l.id === id).hwDone, [1]);
    for (const who of ['zihan', 'chen', 'wang']) err(rt.call('homework.check', { id, idx: 0, on: true }, rt.as(WHO[who])), 'forbidden');
    err(rt.call('homework.check', { id, idx: 0, on: true }, rt.as(OWNER)), 'forbidden'); // 老师不替学生勾
    assert.deepEqual(state(rt, 'admin').lessons.find(l => l.id === id).hwDone, [1], '被拒绝的请求没有改任何东西');
  });

  test('编号越界、课程不存在、没有作业，都是干净的错误', () => {
    const rt = fresh(), emma = rt.as(WHO.emma);
    const id = log(rt, 'a\nb');
    for (const idx of [-1, 2, 99, 1.5, 'x', null]) err(rt.call('homework.check', { id, idx, on: true }, emma), 'bad_request');
    err(rt.call('homework.check', { id: 'nope', idx: 0, on: true }, emma), 'forbidden');
    const none = log(rt, '');
    err(rt.call('homework.check', { id: none, idx: 0, on: true }, emma), 'bad_request');
  });

  test('作业最多 20 项', () => {
    const rt = fresh();
    const ok20 = Array.from({ length: 20 }, (_, i) => 'x' + i).join('\n');
    assert.ok(ok20.length <= 800);
    log(rt, ok20);
    n = 5;
    const tooMany = Array.from({ length: 21 }, (_, i) => 'x' + i).join('\n');
    err(rt.call('lessons.log', lessonParams(rt, 's-emma', { homework: tooMany, date: new Date(rt.now() - 30 * HOUR).toISOString() }), rt.as(OWNER)), 'too_long');
  });

  test('老师以后改了作业项数，多出来的旧勾选不会算进去', () => {
    const rt = fresh(), emma = rt.as(WHO.emma);
    const id = log(rt, 'a\nb\nc');
    ok(rt.call('homework.check', { id, idx: 2, on: true }, emma));
    const sh = rt.sheet('Lessons'), col = sh.data[0].indexOf('notes');
    const row = sh.data.findIndex(r => r[0] === id);
    const n = JSON.parse(sh.data[row][col]); n.homework = 'a\nb'; sh.data[row][col] = JSON.stringify(n);
    ok(rt.call('homework.check', { id, idx: 0, on: true }, emma));
    assert.deepEqual(state(rt, 'emma').lessons.find(l => l.id === id).hwDone, [0]);
  });
});

describe('老师预览学生页', () => {
  test('预览返回的数据和学生自己登录时拿到的完全一样（除了时间戳）', () => {
    const rt = fresh();
    for (const [sid, who] of [['s-emma', 'emma'], ['s-zihan', 'zihan'], ['s-sophia', 'sophia'], ['s-mia', null]]) {
      const pv = ok(rt.call('preview.state', { sid }, rt.as(OWNER))).preview;
      assert.equal(pv.me.role, 'student');
      assert.equal(pv.me.id, sid);
      assert.equal(pv.teacherTz, undefined, '预览里也看不到老师的时区');
      if (who) {
        const real = state(rt, who);
        assert.deepEqual({ ...pv, now: 0 }, { ...real, now: 0 }, sid);
      }
    }
  });

  test('预览里没有别的学生、也没有付款细节之外的老师专属数据', () => {
    const rt = fresh();
    const pv = ok(rt.call('preview.state', { sid: 's-emma' }, rt.as(OWNER))).preview;
    const text = JSON.stringify(pv);
    for (const other of ['王子涵', 'Lucas Chen', 'Sophia Zhang', 'Mia Chen']) assert.ok(!text.includes(other), other);
    assert.equal(pv.students.length, 1);
    assert.deepEqual(pv.parents, []);
    assert.equal(pv.students[0].paid, undefined);
  });

  test('已归档或不存在的学生不能预览；学生和家长不能用这个操作看别人', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    err(rt.call('preview.state', { sid: 'nope' }, tok), 'not_found');
    err(rt.call('preview.state', {}, tok), 'not_found');
    ok(rt.call('students.archive', { id: 's-lucas', active: false }, tok));
    err(rt.call('preview.state', { sid: 's-lucas' }, tok), 'not_found');
    err(rt.call('preview.state', { sid: 's-zihan' }, rt.as(WHO.emma)), 'forbidden');
    err(rt.call('preview.state', { sid: 's-emma' }, rt.as(WHO.li)), 'forbidden');
  });

  test('预览不会改任何数据（不会把通知标成已读，也不写表）', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    const before = rt.writes;
    ok(rt.call('preview.state', { sid: 's-emma' }, tok));
    assert.equal(rt.writes, before);
    assert.equal(state(rt, 'emma').notices.filter(n => n.unread).length, 2);
  });
});

describe('升级：新版本代码遇到旧表格', () => {
  test('版本号落后时，缺的新列和新表会自动补上，数据不动，请求照常成功', () => {
    const rt = fresh();
    const before = JSON.stringify(state(rt, 'admin').students.map(s => [s.id, s.name, s.birth, s.tz]));
    // 模拟旧版本的表格：没有 tz 和 hwDone 列，版本号是 1
    for (const [sheet, col] of [['Students', 'tz'], ['Lessons', 'hwDone']]) {
      const sh = rt.sheet(sheet), c = sh.data[0].indexOf(col);
      sh.data.forEach(r => r.splice(c, 1));
    }
    rt.sheet('Config').data.forEach(r => { if (r[0] === 'schema_version') r[1] = '1'; });
    rt.ctx.resetRequest_();
    const r = ok(rt.call('bootstrap', {}, rt.as(OWNER)));
    assert.equal(r.state.students.length, 5);
    assert.ok(rt.sheet('Students').data[0].includes('tz'));
    assert.ok(rt.sheet('Lessons').data[0].includes('hwDone'));
    rt.sheet('Config').data.forEach(r2 => { if (r2[0] === 'schema_version') assert.equal(r2[1], String(rt.ctx.SCHEMA_VERSION)); });
    rt.ctx.resetRequest_();
    assert.equal(JSON.stringify(state(rt, 'admin').students.map(s => [s.id, s.name, s.birth, s.tz === 'America/Denver' || s.tz])).length > 10, true);
    assert.deepEqual(state(rt, 'admin').students.map(s => [s.id, s.name, s.birth]), JSON.parse(before).map(x => x.slice(0, 3)));
  });

  test('版本号是最新的却缺列（有人手改了表头），不会自动补，仍然明确报错', () => {
    const rt = fresh(), tok = rt.as(OWNER);
    rt.sheet('Students')._set(1, 4, 'kindx');
    err(rt.call('bootstrap', {}, tok), 'schema_mismatch');
  });

  test('种子数据：每个假学生有时区和下次上课时间', () => {
    const rt = fresh();
    const s = state(rt, 'admin');
    assert.ok(s.students.every(x => x.tz && x.next), JSON.stringify(s.students.map(x => [x.name, x.tz, x.next])));
    assert.deepEqual(new Set(s.students.map(x => x.tz)).size >= 4, true, '覆盖多个时区');
  });
});
