/**
 * 网页入口。网页用 POST 发一段 JSON：{ a: 操作名, t: 令牌, p: 参数 }。
 * 用 text/plain 发送，浏览器就不会先发预检请求（Apps Script 不支持预检）。
 *
 * 每个操作登记在 actions_() 里：
 *   roles  允许哪些身份调用（不写表示不需要登录）
 *   write  是否会改数据（会改的先加锁，同一时间只让一个写操作进行）
 *   state  处理完后顺便返回最新的完整数据，网页少一次往返
 */

var ALL_ROLES = ['admin', 'parent', 'student'];

function actions_() {
  return {
    'auth.request': { fn: authRequest_, write: true },
    'auth.verify':  { fn: authVerify_, write: true },
    'auth.choose':  { fn: authChoose_, write: true },
    'auth.logout':  { fn: authLogout_, write: true, roles: ALL_ROLES },

    'bootstrap':    { fn: function () { return {}; }, roles: ALL_ROLES, state: true },
    'profile.save': { fn: hProfileSave_, write: true, state: true, roles: ALL_ROLES },

    'notices.read':  { fn: hNoticeRead_, write: true, state: true, roles: ['parent', 'student'] },
    'messages.send': { fn: hMessageSend_, write: true, state: true, roles: ALL_ROLES },
    'messages.read': { fn: hMessageRead_, write: true, state: true, roles: ALL_ROLES },
    'lessons.sign':  { fn: hLessonSign_, write: true, state: true, roles: ['parent', 'student'] },
    'tuition.claim': { fn: hTuitionClaim_, write: true, state: true, roles: ['parent', 'student'] },

    'students.save':    { fn: hStudentSave_, write: true, state: true, roles: ['admin'] },
    'students.archive': { fn: hStudentArchive_, write: true, state: true, roles: ['admin'] },
    'parents.save':     { fn: hParentSave_, write: true, state: true, roles: ['admin'] },
    'parents.archive':  { fn: hParentArchive_, write: true, state: true, roles: ['admin'] },
    'pairs.set':        { fn: hPairSet_, write: true, state: true, roles: ['admin'] },
    'books.save':       { fn: hBooksSave_, write: true, state: true, roles: ['admin'] },
    'lessons.log':      { fn: hLessonLog_, write: true, state: true, roles: ['admin'] },
    'lessons.delete':   { fn: hLessonDelete_, write: true, state: true, roles: ['admin'] },
    'tuition.paid':     { fn: hTuitionPaid_, write: true, state: true, roles: ['admin'] },
    'tuition.remind':   { fn: hTuitionRemind_, write: true, state: true, roles: ['admin'] },
    'rules.save':       { fn: hRulesSave_, write: true, state: true, roles: ['admin'] },
    'notices.send':     { fn: hNoticeSend_, write: true, state: true, roles: ['admin'] }
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 直接用浏览器打开网址会走到这里：只告诉你服务在线，不返回任何数据。 */
function doGet() { return json_({ ok: true, service: 'piano-studio', api: API_VERSION }); }

function doPost(e) {
  var out;
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 200000) fail_('too_large');
    var req;
    try { req = JSON.parse(raw); } catch (x) { fail_('bad_request', 'json'); }
    out = handle_(req);
  } catch (err) {
    out = errorResponse_(err);
  }
  return json_(out);
}

function errorResponse_(err) {
  if (err && err.apiCode) return { ok: false, error: err.apiCode };
  console.error(err && err.stack ? err.stack : String(err)); // 细节只写进后台日志，不返回给网页
  return { ok: false, error: 'server' };
}

/** 处理一个请求，返回 {ok:true,data} 。测试里也直接调用它。 */
function handle_(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) fail_('bad_request');
  var table = actions_(), name = String(req.a);
  // 只认自己登记的操作名；'constructor'、'__proto__' 这类原型链上的名字一律当作未知
  if (!Object.prototype.hasOwnProperty.call(table, name)) fail_('unknown_action');
  var spec = table[name];
  var p = req.p == null ? {} : req.p;
  if (typeof p !== 'object' || Array.isArray(p)) fail_('bad_request');
  var lock = null, held = false;
  try {
    if (spec.write) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) fail_('busy');
      held = true;
    }
    resetRequest_(); // 拿到锁之后再读表，保证读到的是最新的
    var ctx = null;
    if (spec.roles) {
      ctx = ctxFromToken_(req.t);
      if (spec.roles.indexOf(ctx.role) < 0) fail_('forbidden');
    }
    var data = spec.fn(ctx, p) || {};
    if (spec.state) data.state = buildState_(ctx);
    return { ok: true, data: data };
  } finally {
    if (held) lock.releaseLock();
  }
}
