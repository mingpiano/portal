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
    'auth.kid':     { fn: authKid_, write: true },
    'auth.logout':  { fn: authLogout_, write: true, roles: ALL_ROLES },

    'bootstrap':    { fn: function (ctx) { touchSeen_(ctx); return {}; }, roles: ALL_ROLES, state: true },
    'profile.save': { fn: hProfileSave_, write: true, state: true, roles: ALL_ROLES },
    'homework.check': { fn: hHomeworkCheck_, write: true, state: true, roles: ['parent', 'student'] },
    'preview.state':  { fn: hPreviewState_, roles: ['admin'] },

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
    'res.begin':        { fn: hResBegin_, write: true, roles: ['admin'] },
    'res.chunk':        { fn: hResChunk_, write: true, roles: ['admin'] },
    'res.finish':       { fn: hResFinish_, write: true, state: true, roles: ['admin'] },
    'res.link':         { fn: hResLink_, write: true, state: true, roles: ['admin'] },
    'res.update':       { fn: hResUpdate_, write: true, state: true, roles: ['admin'] },
    'res.delete':       { fn: hResDelete_, write: true, state: true, roles: ['admin'] },
    'res.get':          { fn: hResGet_, roles: ALL_ROLES },
    'res.seen':         { fn: hResSeen_, write: true, state: true, roles: ['parent', 'student'] },
    'kidcode.set':      { fn: hKidCodeSet_, write: true, state: true, roles: ['admin'] },
    'kidcode.clear':    { fn: hKidCodeClear_, write: true, state: true, roles: ['admin'] },
    'books.save':       { fn: hBooksSave_, write: true, state: true, roles: ['admin'] },
    'lessons.log':      { fn: hLessonLog_, write: true, state: true, roles: ['admin'] },
    'events.add':       { fn: hEventAdd_, write: true, state: true, roles: ['admin'] },
    'events.edit':      { fn: hEventEdit_, write: true, state: true, roles: ['admin'] },
    'events.delete':    { fn: hEventDelete_, write: true, state: true, roles: ['admin'] },
    'lessons.edit':     { fn: hLessonEdit_, write: true, state: true, roles: ['admin'] },
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
    if (raw.length > 1400000 || (raw.length > 200000 && raw.slice(0, 80).indexOf('res.chunk') < 0)) fail_('too_large'); // 只有上传文件的一段（约 1.3MB）允许这么大，其余操作最多 200KB
    var req;
    try { req = JSON.parse(raw); } catch (x) { fail_('bad_request', 'json'); }
    if (raw.length > 200000 && !(req && req.a === 'res.chunk')) fail_('too_large');
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

/**
 * 处理一个请求，返回 {ok:true,data} 。测试里也直接调用它。
 * 代码升级（SCHEMA_VERSION 变大）后，表格如果还缺新列或新表，自动补齐一次再重试（已有数据不动），
 * 这样推送新版本后不用记得手动运行 upgradeSchema。
 * 版本号没变却缺列，说明是有人手动改坏了表头：不自动补，照常报错，免得悄悄读出一列空数据。
 */
function handle_(req) {
  try {
    return handleOnce_(req);
  } catch (err) {
    if (!(err && err.apiCode === 'schema_mismatch') || !schemaOutdated_()) throw err;
    migrateSchema_();
    return handleOnce_(req);
  }
}

function schemaOutdated_() {
  try {
    resetRequest_();
    return Number(getConfigMap_().schema_version || 0) < SCHEMA_VERSION;
  } catch (e) { return false; }
}

function migrateSchema_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('busy');
  try {
    resetRequest_();
    var oldVer = Number(getConfigMap_().schema_version || 0);
    ensureSchema_(ss_());
    resetRequest_();
    if (oldVer < 6) migrateEvents_(); // 第 6 版起有日历：把还没过去的“下次上课”变成排课
    setConfig_('schema_version', SCHEMA_VERSION);
  } finally { lock.releaseLock(); }
}

function handleOnce_(req) {
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
