/**
 * 发邮件。三道保护：
 * 1. 测试环境只发给“测试账号自己的 +别名”地址，永远发不到真学生手里。
 * 2. Gmail 每日额度剩得不多时就停，留给老师自己的邮件。
 * 3. 邮件日志（MailLog）只记收件人、类型和结果，绝不记验证码。
 */

function siteUrl_() { return PropertiesService.getScriptProperties().getProperty('SITE_URL') || ''; }

function studioName_(lang) {
  var cfg = getConfigMap_();
  return lang === 'en' ? cfg.studio_name_en : cfg.studio_name_zh;
}

function logMail_(to, subject, kind, status) {
  try { dbInsert_('MailLog', { ts: iso_(now_()), to: to, subject: subject, kind: kind, status: status }); } catch (e) { /* 日志失败不影响主流程 */ }
}

/** 测试环境里，收件人必须和测试账号是同一个 Gmail（忽略 +别名 和点）。 */
function allowedInTest_(to) {
  var owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '';
  return !!owner && baseEmail_(to) === baseEmail_(owner);
}

/**
 * 发一封邮件。返回 true/false，不抛错：邮件发不出去不应该让主要操作失败。
 * logSubject 是写进日志的标题（验证码邮件传 '[code]'，避免把验证码写进表格）。
 */
function sendMail_(to, mail, kind, logSubject) {
  to = normEmail_(to);
  var subj = logSubject || mail.subject;
  if (!isEmail_(to)) { logMail_(to, subj, kind, 'bad_address'); return false; }
  if (isTestEnv_() && !allowedInTest_(to)) { logMail_(to, subj, kind, 'blocked_test_env'); return false; }
  if (MailApp.getRemainingDailyQuota() < MAIL_QUOTA_FLOOR) { logMail_(to, subj, kind, 'quota_low'); return false; }
  try {
    MailApp.sendEmail({ to: to, subject: mail.subject, body: mail.text, htmlBody: mail.html, name: mail.from || STUDIO_FULL });
    logMail_(to, subj, kind, 'sent');
    return true;
  } catch (e) {
    logMail_(to, subj, kind, 'error');
    return false;
  }
}

function wrapHtml_(inner) {
  return '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#18202F;max-width:520px">' + inner + '</div>';
}
function linkLine_(lang) {
  var u = siteUrl_();
  if (!u) return { html: '', text: '' };
  var label = lang === 'en' ? 'Open the site' : '打开网站';
  return { html: '<p><a href="' + escHtml_(u) + '">' + label + '</a></p>', text: '\n' + label + ': ' + u };
}

/* ---------- 邮件内容 ---------- */

function mailCode_(code, lang) {
  var studio = studioName_(lang);
  var zh = lang !== 'en';
  var subject = zh ? studio + ' 登录验证码：' + code : studio + ' sign-in code: ' + code;
  var lead = zh ? '你的登录验证码是' : 'Your sign-in code is';
  var tail = zh ? '10 分钟内有效，只能用一次。如果不是你本人在登录，忽略这封邮件就行。'
                : 'It works for 10 minutes and only once. If you did not try to sign in, you can ignore this email.';
  return {
    subject: subject, from: studio,
    text: lead + ' ' + code + '\n' + tail,
    html: wrapHtml_('<p>' + lead + '</p><p style="font-size:30px;font-weight:700;letter-spacing:.3em;margin:8px 0">' + escHtml_(code) + '</p><p style="color:#565E71;font-size:13px">' + tail + '</p>')
  };
}

function mailLessonSign_(studentName, dateText, lang, nextText) {
  var zh = lang !== 'en';
  var studio = studioName_(lang), link = linkLine_(lang);
  var subject = zh ? studio + '：请确认 ' + studentName + ' 的课后记录' : studio + ': please sign off on ' + studentName + "'s lesson notes";
  var body = zh ? '老师记好了 ' + studentName + '（' + dateText + '）这节课的学习记录。登录网站点“确认签字”即可。48 小时内没有签字会自动确认，但不加积分。'
                : 'Your teacher has logged the lesson for ' + studentName + ' (' + dateText + '). Sign in and tap "Sign" to confirm. If nobody signs within 48 hours it is confirmed automatically, without points.';
  var next = '';
  if (nextText) next = zh ? '下次上课：' + nextText + '（按学生所在时区）。请在上课前练琴，并完成作业。'
                          : 'Next lesson: ' + nextText + ' (in the student\'s time zone). Please practice and finish the homework before then.';
  return { subject: subject, from: studio, text: body + (next ? '\n\n' + next : '') + link.text,
    html: wrapHtml_('<p>' + escHtml_(body) + '</p>' + (next ? '<p><b>' + escHtml_(next) + '</b></p>' : '') + link.html) };
}

function mailTuition_(studentName, note, lang) {
  var zh = lang !== 'en';
  var studio = studioName_(lang), link = linkLine_(lang);
  var subject = zh ? studio + '：学费提醒' : studio + ': tuition reminder';
  var body = zh ? studentName + ' 本期 10 节课已经上完，请交下一期学费。' : studentName + ' has finished all 10 lessons in this term. Next term\'s tuition is due.';
  var noteHtml = note ? '<p style="white-space:pre-wrap;background:#F3EADA;border-radius:8px;padding:10px 12px">' + escHtml_(note) + '</p>' : '';
  return { subject: subject, from: studio, text: body + (note ? '\n\n' + note : '') + link.text, html: wrapHtml_('<p>' + escHtml_(body) + '</p>' + noteHtml + link.html) };
}

function mailTeacherMessage_(fromName, text, lang) {
  var zh = lang !== 'en';
  var studio = studioName_(lang), link = linkLine_(lang);
  var subject = zh ? studio + '：' + fromName + ' 给你留言了' : studio + ': new message from ' + fromName;
  var preview = text.length > 300 ? text.slice(0, 300) + '…' : text;
  return { subject: subject, from: studio, text: preview + link.text, html: wrapHtml_('<p style="white-space:pre-wrap">' + escHtml_(preview) + '</p>' + link.html) };
}
