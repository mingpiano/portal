/**
 * 初始化。在 Apps Script 编辑器里选中函数名，点“运行”：
 *
 *   setupTest()       测试账号用：建表 + 灌入假学生。邮件只发给你自己的 +别名 地址。
 *   setupProd()       太太的账号用：只建空表和老师账号，没有任何假数据。
 *   resetTestData()   测试环境里清空重来（正式环境会拒绝运行，防止误删真数据）。
 *   upgradeSchema()   后面几期加了新表或新列以后运行一次，已有数据不动。
 *   printStatus()     看当前是测试还是正式、数据表在哪。
 *
 * 这些函数可以在测试账号和太太账号里各运行一次，代码完全一样；
 * 换账号就是“在新账号里新建一个项目，推送同一份代码，运行 setupProd()”。
 */

function setupTest() { return setup_('test'); }
function setupProd() { return setup_('prod'); }

function setup_(env) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SHEET_ID')) {
    throw new Error('这个项目已经初始化过了（' + (props.getProperty('ENV') || '?') + '）。测试环境想重来请运行 resetTestData()。');
  }
  var owner = normEmail_(Session.getEffectiveUser().getEmail());
  if (!isEmail_(owner)) throw new Error('取不到当前账号的邮箱，请确认已授权。');
  resetRequest_();
  var ss = SpreadsheetApp.create(env === 'test' ? '琴房（测试数据，都是假的）' : '琴房数据');
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone()); // 表格时区与脚本一致，老师手改日期才不会差一天
  props.setProperties({ SHEET_ID: ss.getId(), ENV: env, OWNER_EMAIL: owner, PEPPER: randomHex_(32) });
  ensureSchema_(ss);
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('工作表1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  seedBasics_(owner);
  if (env === 'test') seedFakeData_(owner);
  console.log('完成（' + env + '）。数据表：' + ss.getUrl());
  return ss.getUrl();
}

function resetTestData() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ENV') !== 'test') throw new Error('只有测试环境能重置。这是正式环境，已拒绝。');
  resetRequest_();
  var ss = ss_();
  Object.keys(SHEETS_).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  resetRequest_();
  var owner = props.getProperty('OWNER_EMAIL');
  seedBasics_(owner);
  seedFakeData_(owner);
  console.log('测试数据已重置。');
}

function upgradeSchema() {
  resetRequest_();
  ensureSchema_(ss_());
  setConfig_('schema_version', SCHEMA_VERSION);
  console.log('表结构已是第 ' + SCHEMA_VERSION + ' 版。');
}

function printStatus() {
  var props = PropertiesService.getScriptProperties();
  resetRequest_();
  console.log('环境：' + props.getProperty('ENV') + '；数据表：' + (props.getProperty('SHEET_ID') ? ss_().getUrl() : '（未初始化）') +
    '；网站地址 SITE_URL：' + (props.getProperty('SITE_URL') || '（未设置）'));
}

function seedBasics_(owner) {
  dbInsert_('Admins', { email: owner, name: '老师 Teacher', avatar: { t: 'emoji', v: '🎹', c: '#E9E2B5' }, active: true });
  setConfig_('schema_version', SCHEMA_VERSION);
}

/* ---------- 测试用的假数据 ---------- */

/** 把 name@gmail.com 变成 name+alias@gmail.com：邮件真的会到你自己的收件箱。 */
function alias_(owner, tag) {
  var at = owner.lastIndexOf('@');
  return owner.slice(0, at).split('+')[0] + '+' + tag + owner.slice(at);
}

function seedFakeData_(owner) {
  var now = now_(), DAY = 86400000, HOUR = 3600000;
  var yearsAgo = function (y, extraDays) {
    var d = new Date(now); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() + (extraDays || 0));
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  };

  var parents = [
    { id: 'p-li', name: '李女士 Ms. Li', email: alias_(owner, 'li'), lang: 'en', kids: ['s-emma'] },
    { id: 'p-chen', name: '陈先生 Mr. Chen', email: alias_(owner, 'chen'), lang: 'en', kids: ['s-lucas', 's-mia'] },
    { id: 'p-wang', name: '王先生 Mr. Wang', email: alias_(owner, 'wang'), lang: 'zh', kids: ['s-zihan'] }
  ];
  parents.forEach(function (p) {
    dbInsert_('Parents', { id: p.id, name: p.name, email: p.email, lang: p.lang, avatar: null, active: true, created: iso_(now) });
    p.kids.forEach(function (k) { dbInsert_('Pairs', { parentId: p.id, studentId: k }); });
  });

  var cast = [
    { id: 's-emma', name: 'Emma Li', email: alias_(owner, 'emma'), kind: 'child', lang: 'en', birth: yearsAgo(9, 40), start: yearsAgo(1, -5), level: 'Beginner · Thompson 3', grp: 'g1', dur: 45, paid: 2, carry: 14, wd: 2, tz: 'America/New_York', nextIn: 3,
      avatar: { t: 'emoji', v: '🦊', c: '#F6D7B0' }, books: [{ n: 'Thompson 3', s: 'current' }, { n: 'Thompson 2', s: 'done' }],
      notes: [
        { pieces: [['Arabesque', 'Burgmüller Op. 100 No. 2', 'new']], focus: 'Keep the right-hand triplets in bars 1–8 even; relax the wrist.', tempo: '♩ = 80', homework: 'Arabesque bars 1–8 slowly, 15 minutes a day.' },
        { pieces: [['Arabesque', 'Burgmüller Op. 100 No. 2', 'review'], ['Etude No. 40', 'Czerny Op. 599', 'new']], focus: 'Short left-hand chords; make p and f more contrasted.', tempo: '♩ = 92', homework: 'Play Arabesque all the way through; Czerny hands separately.' },
        { pieces: [['Arabesque', 'Burgmüller Op. 100 No. 2', 'done'], ['Etude No. 40', 'Czerny Op. 599', 'review']], focus: "Don't start the ritardando too early.", tempo: '♩ = 108', homework: 'Czerny with the metronome.' },
        { pieces: [['Minuet in G', 'Petzold BWV Anh. 114', 'new']], focus: 'Hands separately; left-hand fingering 1-2-3 in bars 9–16.', tempo: '♩ = 88', homework: 'Minuet bars 1–16, hands together, slowly.\nFive-finger warm-up, 5 minutes a day.' }] },
    { id: 's-zihan', name: '王子涵', email: alias_(owner, 'zihan'), kind: 'child', lang: 'zh', birth: yearsAgo(14, 120), start: yearsAgo(3, -40), level: '中级 · 奏鸣曲', grp: 'g2', dur: 60, paid: 2, carry: 13, wd: 4, tz: 'Asia/Shanghai', nextIn: 1,
      avatar: { t: 'emoji', v: '🦁', c: '#D6DDF5' }, books: [{ n: '克莱门蒂小奏鸣曲集', s: 'current' }, { n: '约翰·汤普森 4', s: 'done' }],
      notes: [
        { pieces: [['小奏鸣曲 第一乐章', 'Clementi Op. 36 No. 1', 'new'], ['G 大调音阶 两个八度', '音阶', 'review']], focus: 'Alberti 低音要轻，旋律在右手。', tempo: '♩ = 100', homework: 'Clementi 呈示部，左手单独录一遍。' },
        { pieces: [['小奏鸣曲 第一乐章', 'Clementi Op. 36 No. 1', 'review']], focus: '展开部第 16–23 小节节奏不稳，用节拍器。', tempo: '♩ = 112', homework: 'Clementi 全乐章，节拍器 ♩=104。' },
        { pieces: [['小奏鸣曲 第一乐章', 'Clementi Op. 36 No. 1', 'done'], ['托卡塔', 'Kabalevsky Op. 39 No. 18', 'new']], focus: 'Clementi 可以收尾了；Kabalevsky 先慢练和弦转换。', tempo: '♩ = 126', homework: 'Kabalevsky 第 1–12 小节。\nG 大调音阶，节拍器 ♩=80。' }] },
    { id: 's-lucas', name: 'Lucas Chen', email: alias_(owner, 'lucas'), kind: 'child', lang: 'en', birth: yearsAgo(8, 20), start: yearsAgo(2, -20), level: 'Beginner · Faber 2B', grp: 'g1', dur: 30, paid: 1, carry: 8, wd: 6, tz: 'America/Denver', nextIn: 4,
      avatar: null, books: [{ n: 'Faber 2B', s: 'current' }, { n: 'Faber 2A', s: 'done' }],
      notes: [
        { pieces: [['Gavotte', 'Faber Piano Adventures 2B', 'new']], focus: 'Lift the fingers for staccato; count out loud.', tempo: '♩ = 76', homework: 'Gavotte 3 times a day.' },
        { pieces: [['Gavotte', 'Faber Piano Adventures 2B', 'done'], ['C major scale, 1 octave', 'Scales', 'new']], focus: 'Prepare the thumb-under crossing early.', tempo: '♩ = 84', homework: 'C major scale 5 times each hand.' }] },
    { id: 's-sophia', name: 'Sophia Zhang', email: alias_(owner, 'sophia'), kind: 'adult', lang: 'en', birth: yearsAgo(31, 200), start: yearsAgo(0, -240), level: 'Intermediate · Romantic', grp: 'g2', dur: 60, paid: 1, carry: 3, wd: 1, tz: 'America/Chicago', nextIn: 2,
      avatar: { t: 'emoji', v: '🌿', c: '#CFE6D8' }, books: [{ n: 'Chopin Waltzes', s: 'current' }], showPoints: false,
      notes: [
        { pieces: [['Waltz in A minor', 'Chopin B. 150', 'new']], focus: 'Deep left-hand bass, light beats 2 and 3; change the pedal cleanly.', tempo: '♩. = 50', homework: 'Waltz bars 1–16; practice the pedaling on its own.' },
        { pieces: [['Waltz in A minor', 'Chopin B. 150', 'review'], ['Etude No. 1', 'Czerny Op. 849', 'new']], focus: 'Change the tone color when the middle section turns major.', tempo: '♩. = 58', homework: 'Whole waltz; Czerny bars 1–8.' }] },
    { id: 's-mia', name: 'Mia Chen', email: '', kind: 'child', lang: 'en', birth: yearsAgo(6, 90), start: yearsAgo(0, -35), level: 'Early beginner · Faber 1', grp: 'g0', dur: 30, paid: 1, carry: 0, wd: 6, tz: 'America/Los_Angeles', nextIn: 5,
      avatar: null, books: [{ n: 'Faber 1', s: 'current' }],
      notes: [
        { pieces: [['Hot Cross Buns', 'Faber 1 · Folk tune', 'new']], focus: 'Hold the hand like a small ball; count 1-2-3-4 while playing.', tempo: '♩ = 72', homework: 'Hot Cross Buns 3 times a day.' },
        { pieces: [['Hot Cross Buns', 'Faber 1 · Folk tune', 'done'], ['Merrily We Roll Along', 'Faber 1 · Folk tune', 'new']], focus: "Don't stop when switching hands.", tempo: '♩ = 80', homework: 'Merrily We Roll Along, right hand.' }] }
  ];

  cast.forEach(function (c) {
    dbInsert_('Students', { id: c.id, name: c.name, email: c.email, kind: c.kind, birth: c.birth, start: c.start, adj: 0, lang: c.lang,
      level: c.level, grp: c.grp, dur: c.dur, paid: c.paid, carry: c.carry, claimed: false,
      showPoints: c.showPoints === undefined ? c.kind === 'child' : c.showPoints, avatar: c.avatar, books: c.books, active: true, created: iso_(now - 200 * DAY), tz: c.tz });
    // 每周一节，最近一节在 1–3 天前；每个学生错开
    var latestAgo = { 's-emma': 1, 's-zihan': 5, 's-lucas': 3, 's-sophia': 6, 's-mia': 4 }[c.id];
    var count = c.notes.length;
    for (var i = 0; i < count; i++) {
      var ago = latestAgo + (count - 1 - i) * 7;
      var date = now - ago * DAY;
      var recent = i === count - 1;
      // emma 最近一节还在等签字（1 天前，未满 48 小时）；lucas 最近一节超过 48 小时没签（自动确认）；其余都签了
      var signed = !(recent && (c.id === 's-emma' || c.id === 's-lucas'));
      var n = c.notes[i];
      dbInsert_('Lessons', { id: 'l-' + c.id.slice(2) + '-' + (i + 1), sid: c.id, date: iso_(date), dur: c.dur, status: 'done', confirmedAt: '',
        signedAt: signed ? iso_(date + (3 + i) * HOUR) : '', signedBy: signed ? 'student' : '', loggedAt: iso_(date + HOUR),
        notes: (function () {
          var nt = { pieces: n.pieces.map(function (p) { return { title: p[0], source: p[1], st: p[2] }; }), focus: n.focus, tempo: n.tempo, homework: n.homework, due: '' };
          // 最近一节课填了“下次上课”：几天后的整点，学生页会显示“n 天后”
          if (recent) { var nx = new Date(now + c.nextIn * DAY); nx.setMinutes(0, 0, 0); nt.next = iso_(nx.getTime() + HOUR); }
          return nt;
        })(), hwDone: [] });
    }
  });

  dbInsert_('Notices', { id: 'n-1', ts: iso_(now - 2 * DAY), scope: 'all', sid: '', aud: 'both', readBy: [],
    title: '万圣节周六：穿戏服来上课吧 / Halloween Saturday: wear a costume', body: '10 月 31 日（周六）来上课的同学可以穿戏服。 Students with a lesson on Saturday, Oct 31 are welcome to wear a costume.' });
  dbInsert_('Notices', { id: 'n-2', ts: iso_(now - DAY), scope: 'student', sid: 's-emma', aud: 'both', readBy: [],
    title: 'Emma: please bring your Minuet score', body: 'We will go over the fingering in bars 9–16 next lesson.' });
  dbInsert_('Notices', { id: 'n-3', ts: iso_(now - 3 * HOUR), scope: 'student', sid: 's-sophia', aud: 'student', readBy: [],
    title: 'Sophia: you can stay 15 extra minutes this week', body: 'I have no lesson after yours this week, so we can run through both Bach voices together.' });

  dbInsert_('Messages', { id: 'm-1', sid: 's-lucas', from: 'student', pid: '', ts: iso_(now - 2 * DAY), text: 'Gavotte 第 3 小节我总是弹不顺。', readBy: ['admin'] });
  dbInsert_('Messages', { id: 'm-2', sid: 's-lucas', from: 'teacher', pid: '', ts: iso_(now - 2 * DAY + HOUR), text: 'Play the left hand alone slowly five times, then hands together. We will look at it together next lesson.', readBy: ['admin'] });
  dbInsert_('Messages', { id: 'm-3', sid: 's-mia', from: 'parent', pid: 'p-chen', ts: iso_(now - 3 * HOUR), text: 'Mia has a cold and might miss Saturday. Can we move her lesson to Sunday?', readBy: [] });
}
