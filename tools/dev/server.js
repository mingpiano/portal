'use strict';
/**
 * 本机预览服务器：把 apps-script/ 里的真实后台代码（跑在模拟层里）和 web/ 静态网页放在一起。
 *   node tools/dev/server.js            → http://localhost:8080
 *
 * 只给本机用，数据在内存里，关掉就没了。额外的 /__dev/ 接口让测试能“偷看”发出的邮件、拨动时钟：
 *   GET  /__dev/mail?to=邮箱     该邮箱收到的邮件（含最近一次验证码）
 *   POST /__dev/advance?ms=N     把后台的时钟往后拨 N 毫秒（测试 48 小时自动确认）
 *   POST /__dev/reset            重新灌入假数据
 * 真正部署到 Apps Script 和 GitHub Pages 时都不存在这些接口。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRuntime } = require('./gas-mock');

const WEB = path.join(__dirname, '..', '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function create({ owner = 'tester@gmail.com' } = {}) {
  let rt;
  const boot = () => { rt = createRuntime({ owner, quiet: true }); rt.requireLock = true; rt.run('setupTest'); rt.ctx.CODE_GLOBAL_HOUR_REQUESTS = 100000; rt.ctx.CODE_GLOBAL_DAY = 100000; };
  boot();

  const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString('utf8'))); });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/api') {
        if (req.method === 'GET') return send(res, 200, rt.ctx.doGet().getContent());
        const body = await readBody(req);
        rt.inRequest = true;
        try { return send(res, 200, rt.ctx.doPost({ postData: { contents: body } }).getContent()); } finally { rt.inRequest = false; }
      }
      if (url.pathname === '/__dev/mail') {
        const to = url.searchParams.get('to');
        const list = rt.mail.filter(m => !to || m.to === to);
        return send(res, 200, JSON.stringify({ code: to ? rt.lastCode(to) : null, mails: list }));
      }
      if (url.pathname === '/__dev/advance' && req.method === 'POST') { rt.advance(Number(url.searchParams.get('ms')) || 0); return send(res, 200, '{"ok":true}'); }
      if (url.pathname === '/__dev/reset' && req.method === 'POST') { boot(); return send(res, 200, '{"ok":true}'); }
      if (url.pathname === '/__dev/call' && req.method === 'POST') { // 测试里直接以某个令牌调用后台（准备数据用）
        const { a, p, t } = JSON.parse(await readBody(req)); return send(res, 200, JSON.stringify(rt.call(a, p, t)));
      }
      // 静态文件
      let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(WEB, rel));
      if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    } catch (e) { return send(res, 500, JSON.stringify({ ok: false, error: 'server' })); }
  });
  return { server, get rt() { return rt; }, reset: boot };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const { server } = create();
  server.listen(port, '127.0.0.1', () => console.log(`本机预览：http://localhost:${port}  （老师账号 tester@gmail.com，验证码看 /__dev/mail?to=邮箱）`));
}
module.exports = { create };
