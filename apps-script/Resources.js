/**
 * 资源库：老师上传 PDF、音频、视频（或贴链接），选择分享给哪些学生。
 *
 * 为什么这样做：
 * - 文件存在老师自己的 Google 云端硬盘里一个专用文件夹，不公开分享。网页拿不到文件的直链，
 *   只能通过后台取，而后台每次都会先检查“这个人是不是被分享到了”。
 * - Apps Script 一次请求装不下大文件，所以网页把文件切成 1MB 一段，一段一段传；
 *   存的时候也保持分段（每段一个小文件），下载时网页一段一段取回再拼起来。服务器不用把整份文件拼在内存里。
 * - 上限 25MB。更大的视频建议贴链接（YouTube 不公开链接等）。
 */

var RES_MAX_BYTES = 25 * 1024 * 1024;
var RES_CHUNK = 1000000;                 // 每段 1,000,000 字节
var RES_MAX_COUNT = 300;
var RES_TYPES = {                        // 只认这几种文件，按扩展名判断，不信网页自己报的类型
  pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm'
};

function resFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('RES_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 被删了就重建 */ } }
  var f = DriveApp.createFolder('Keynote Portal files');
  props.setProperty('RES_FOLDER_ID', f.getId());
  return f;
}

function resTrashChunks_(r) { (r.chunks || []).forEach(function (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 已经没了 */ } }); }

/** 分享对象：all（所有学生，包括以后新增的）或具体的学生 id 列表。 */
function cleanShare_(p) {
  var all = bool_(p.all), sids = [];
  if (!all) {
    if (!Array.isArray(p.sids) || p.sids.length > 300) fail_('bad_request', 'sids');
    var known = {}; dbAll_('Students').forEach(function (s) { known[s.id] = true; });
    p.sids.forEach(function (i) { i = String(i); if (!known[i]) fail_('not_found'); if (sids.indexOf(i) < 0) sids.push(i); });
    if (!sids.length) fail_('bad_request', 'nobody');
  }
  return { all: all, sids: sids };
}

function resVisible_(ctx, r, kidIds) {
  if (ctx.role === 'admin') return true;
  if (r.status !== 'ready') return false;
  return !!r.all || (r.sids || []).some(function (i) { return kidIds.indexOf(i) >= 0; });
}

function resCleanName_(v) {
  var s = String(v == null ? '' : v).replace(/[\\\/\u0000-\u001f<>"|?*]/g, '').trim();
  return s.slice(0, 120);
}

/** 开始上传：登记文件信息，返回要传几段。 */
function hResBegin_(ctx, p) {
  var now = now_();
  // 清理超过一天还没传完的残留
  dbDelete_('Resources', function (r) { if (r.status === 'uploading' && ms_(r.ts) < now - 86400000) { resTrashChunks_(r); return true; } return false; });
  if (dbAll_('Resources').length >= RES_MAX_COUNT) fail_('too_many');
  var name = resCleanName_(p.name);
  var m = /^.+\.([A-Za-z0-9]{2,5})$/.exec(name);
  var ext = m ? m[1].toLowerCase() : '';
  if (!RES_TYPES[ext]) fail_('bad_file_type');
  var size = int_(p.size, 1, RES_MAX_BYTES, 'size');
  var title = str_(p.title, LIMITS.title, { label: 'title' }) || name.replace(/\.[^.]+$/, '');
  var share = cleanShare_(p);
  var id = newId_('r');
  dbInsert_('Resources', {
    id: id, title: title, kind: 'file', name: name, mime: RES_TYPES[ext], size: size, parts: Math.ceil(size / RES_CHUNK),
    chunks: [], url: '', note: str_(p.note, LIMITS.note), ts: iso_(now), all: share.all, sids: share.sids, status: 'uploading', seenBy: []
  });
  return { id: id, parts: Math.ceil(size / RES_CHUNK), chunk: RES_CHUNK };
}

/** 上传其中一段（按顺序）。重传同一段会覆盖。 */
function hResChunk_(ctx, p) {
  var r = dbAll_('Resources').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!r || r.status !== 'uploading') fail_('not_found');
  var i = int_(p.i, 0, r.parts - 1, 'part');
  var chunks = (r.chunks || []).slice();
  if (i > chunks.length) fail_('bad_request', 'order');
  if (typeof p.data !== 'string' || !/^[A-Za-z0-9+\/]*={0,2}$/.test(p.data)) fail_('bad_request', 'data');
  var bytes = Utilities.base64Decode(p.data);
  var expect = i < r.parts - 1 ? RES_CHUNK : r.size - (r.parts - 1) * RES_CHUNK;
  if (bytes.length !== expect) fail_('bad_request', 'size');
  var file = resFolder_().createFile(Utilities.newBlob(bytes, 'application/octet-stream', r.id + '_' + i));
  if (i < chunks.length) { try { DriveApp.getFileById(chunks[i]).setTrashed(true); } catch (e) { /* ignore */ } }
  chunks[i] = file.getId();
  dbUpdate_('Resources', r, { chunks: chunks });
  return { i: i };
}

/** 全部传完：检查段数，标记为可用。 */
function hResFinish_(ctx, p) {
  var r = dbAll_('Resources').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!r || r.status !== 'uploading') fail_('not_found');
  if ((r.chunks || []).length !== r.parts) fail_('bad_request', 'incomplete');
  dbUpdate_('Resources', r, { status: 'ready', ts: iso_(now_()) });
  return { id: r.id };
}

/** 贴链接（比如放在 YouTube 上的视频）：只接受 https 地址。 */
function hResLink_(ctx, p) {
  if (dbAll_('Resources').length >= RES_MAX_COUNT) fail_('too_many');
  var url = String(p.url == null ? '' : p.url).trim();
  if (url.length > 500 || !/^https:\/\/[^\s<>"']+$/i.test(url)) fail_('bad_url');
  var title = str_(p.title, LIMITS.title, { required: true, label: 'title' });
  var share = cleanShare_(p);
  var id = newId_('r');
  dbInsert_('Resources', { id: id, title: title, kind: 'link', name: '', mime: '', size: 0, parts: 0, chunks: [], url: url,
    note: str_(p.note, LIMITS.note), ts: iso_(now_()), all: share.all, sids: share.sids, status: 'ready', seenBy: [] });
  return { id: id };
}

/** 改标题、说明、分享对象。分享对象变了，新加入的学生会看到“新”。 */
function hResUpdate_(ctx, p) {
  var r = dbAll_('Resources').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!r) fail_('not_found');
  var share = cleanShare_(p);
  dbUpdate_('Resources', r, { title: str_(p.title, LIMITS.title, { required: true, label: 'title' }), note: str_(p.note, LIMITS.note), all: share.all, sids: share.sids });
  return {};
}

function hResDelete_(ctx, p) {
  var r = dbAll_('Resources').filter(function (x) { return x.id === String(p.id || ''); })[0];
  if (!r) fail_('not_found');
  resTrashChunks_(r);
  dbDelete_('Resources', function (x) { return x.id === r.id; });
  return {};
}

/** 取文件的第 i 段（base64）。老师可以取任何文件，学生和家长只能取分享给自己（或自己孩子）的。 */
function hResGet_(ctx, p) {
  var r = dbAll_('Resources').filter(function (x) { return x.id === String(p.id || ''); })[0];
  var kidIds = ctx.role === 'admin' ? [] : studentIdsFor_(ctx, dbAll_('Students'), dbAll_('Pairs'));
  if (!r || r.kind !== 'file' || !resVisible_(ctx, r, kidIds)) fail_('forbidden');
  var i = int_(p.i, 0, r.parts - 1, 'part');
  var bytes = DriveApp.getFileById(r.chunks[i]).getBlob().getBytes();
  return { i: i, data: Utilities.base64Encode(bytes) };
}

/** 打开资源页时，把看到的资源标成已读（“新”标记保留到离开这一页，和通知一样）。 */
function hResSeen_(ctx, p) {
  if (!Array.isArray(p.ids) || p.ids.length > 300) fail_('bad_request', 'ids');
  var key = userKey_(ctx), kidIds = studentIdsFor_(ctx, dbAll_('Students'), dbAll_('Pairs'));
  var want = {}; p.ids.forEach(function (i) { want[String(i)] = true; });
  dbAll_('Resources').forEach(function (r) {
    if (!want[r.id] || !resVisible_(ctx, r, kidIds)) return;
    var sb = r.seenBy || [];
    if (sb.indexOf(key) < 0) dbUpdate_('Resources', r, { seenBy: sb.concat([key]) });
  });
  return {};
}

/** 状态里的资源列表。给学生和家长的不含其他学生的名字、也不含云端文件编号。 */
function resourcesOut_(ctx, kidIds) {
  var admin = ctx.role === 'admin', key = userKey_(ctx);
  return dbAll_('Resources').filter(function (r) { return resVisible_(ctx, r, kidIds); })
    .sort(function (a, b) { return ms_(b.ts) - ms_(a.ts); })
    .map(function (r) {
      var o = { id: r.id, title: r.title, kind: r.kind, name: r.name, mime: r.mime, size: r.size, parts: r.parts, url: r.url, note: r.note, ts: r.ts };
      if (admin) { o.all = !!r.all; o.sids = r.sids || []; o.status = r.status; } else o.isNew = (r.seenBy || []).indexOf(key) < 0;
      return o;
    });
}
