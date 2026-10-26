/**
 * 琴房 · Apps Script 后台 · 第一期
 *
 * 这里放常量和表结构。所有 .js 文件在 Apps Script 里共用一个全局作用域，
 * 所以文件之间只靠函数互相调用，顶层不执行任何有副作用的代码。
 * 以下划线结尾的函数是内部函数，网页只能通过 doPost 里登记的 action 调用。
 */

var API_VERSION = 1;
var SCHEMA_VERSION = 2;

/* ---------- 登录相关限制 ---------- */
var CODE_TTL_MS = 10 * 60 * 1000;          // 验证码 10 分钟有效
var CODE_MAX_ATTEMPTS = 5;                 // 一个验证码最多试 5 次
var CODE_PER_EMAIL_HOUR = 3;               // 同一邮箱每小时最多请求 3 次
var CODE_PER_EMAIL_DAY = 8;                // 同一邮箱每天最多 8 次
var CODE_GLOBAL_DAY = 60;                  // 全站每天最多真正发出 60 封验证码（留足 Gmail 每天约 100 封的额度）
var CODE_GLOBAL_HOUR_REQUESTS = 200;       // 全站每小时最多受理 200 次请求（包括不认识的邮箱），防止刷满表格
var TICKET_TTL_MS = 10 * 60 * 1000;        // 选择账户的临时凭证
var SESSION_REMEMBER_MS = 90 * 24 * 3600 * 1000;
var SESSION_SHORT_MS = 24 * 3600 * 1000;
var MAX_SESSIONS_PER_ACCOUNT = 10;
var MAIL_QUOTA_FLOOR = 10;                 // Gmail 剩余额度低于这个数就不再发邮件，留给老师自己的重要邮件
var AUTO_SIGN_MS = 48 * 3600 * 1000;       // 课后 48 小时没签字就自动确认（不加分）
var MSG_MAIL_THROTTLE_MS = 60 * 60 * 1000; // 同一个学生的留言，一小时内最多提醒老师一次

/* ---------- 文字长度上限 ---------- */
var LIMITS = { name: 80, email: 120, level: 80, grp: 40, title: 200, body: 4000, text: 2000,
  piece: 120, focus: 500, tempo: 40, homework: 800, note: 1000, book: 80, hwItems: 20, avatarImg: 16000 };

/**
 * 表结构。每一项是 '列名' 或 '列名:类型'。
 * 类型：s 文字（默认）、i 整数、b 是/否、j JSON、d 只有日期（YYYY-MM-DD）。
 * 读的时候按列名对应，不按位置，所以老师在表格里调整列顺序、多加几列备注都不会出问题。
 * 后面几期要加列，只要往这里加，再运行一次 upgradeSchema() 即可。
 */
var SHEETS_ = {
  Config:   ['key', 'value'],
  Admins:   ['email', 'name', 'avatar:j', 'active:b'],
  Students: ['id', 'name', 'email', 'kind', 'birth:d', 'start:d', 'adj:i', 'lang', 'level', 'grp', 'dur:i',
             'paid:i', 'carry:i', 'claimed:b', 'showPoints:b', 'avatar:j', 'books:j', 'active:b', 'created', 'tz'],
  Parents:  ['id', 'name', 'email', 'lang', 'avatar:j', 'active:b', 'created'],
  Pairs:    ['parentId', 'studentId'],
  Lessons:  ['id', 'sid', 'date', 'dur:i', 'status', 'confirmedAt', 'signedAt', 'signedBy', 'loggedAt', 'notes:j', 'hwDone:j'],
  Notices:  ['id', 'ts', 'scope', 'sid', 'aud', 'title', 'body', 'readBy:j'],
  Messages: ['id', 'sid', 'from', 'pid', 'ts', 'text', 'readBy:j'],
  Sessions: ['hash', 'kind', 'email', 'role', 'subject', 'created', 'expires', 'data:j'],
  Codes:    ['id', 'email', 'known:b', 'codeHash', 'created', 'expires', 'attempts:i', 'used:b', 'sent:b'],
  MailLog:  ['ts', 'to', 'subject', 'kind', 'status']
};

var DEFAULT_RULES = { confirm: 2, sign: 1, ontime: 3, late: -1, missing: -3, noshow: -5, streakN: 4, streakBonus: 5, grace: 3 };
var RULE_RANGE = { confirm: [-100, 100], sign: [-100, 100], ontime: [-100, 100], late: [-100, 100], missing: [-100, 100],
  noshow: [-100, 100], streakN: [0, 20], streakBonus: [-100, 100], grace: [0, 30] };

var STUDIO_NAME = 'Keynote Portal';
/** 速度的音符：whole 全、half 二分、quarter 四分、eighth 八分、sixteenth 十六分，带 . 的是附点。 */
var TEMPO_NOTES = ['w', 'h', 'h.', 'q', 'q.', 'e', 'e.', 's'];
var STUDIO_SUB = 'Ming Luo Piano Studio';
var STUDIO_FULL = 'Keynote Portal · Ming Luo Piano Studio';  // 中文和英文界面都显示这个名字
var DEFAULT_TZ = 'America/Denver';        // 老师所在时区的默认值（老师可以在“我的资料”里改）

/** 可选时区。网页里的下拉框用同一份（有测试守着）。只接受这里的 ID，不接受任意字符串。 */
var TZ_LIST = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei',
  'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland'];

var DEFAULT_CONFIG = {
  studio_name_zh: STUDIO_FULL,
  studio_name_en: STUDIO_FULL,
  teacher_tz: DEFAULT_TZ,
  'mail.lessonSign': 'true',      // 记课后给学生（或家长）发一封请签字的邮件
  'mail.teacherOnMessage': 'true', // 学生或家长留言时给老师发邮件提醒
  teacher_lang: 'zh'              // 给老师发的邮件用什么语言
};

/* 头像：只允许这些，不接受任意字符串 */
var AVATAR_EMOJI = ['🐼','🦊','🐱','🐶','🦄','🐰','🐯','🦁','🐸','🐙','🐧','🦋',
                    '🎹','🎼','🌿','☕','🌙','🍃','🕊️','🌸','🎷','📚','🌻'];
var AVATAR_COLORS = ['#F6D7B0','#CFE6D8','#D6DDF5','#F3D0DA','#E9E2B5','#D5EAF2'];
