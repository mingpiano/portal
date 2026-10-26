'use strict';
// 在“测试账号”和“太太的账号”两个 Apps Script 项目之间切换：
//   node tools/use-env.js test     → 把 .clasp.test.json 复制成 .clasp.json
//   node tools/use-env.js prod     → 把 .clasp.prod.json 复制成 .clasp.json
// 之后 clasp push / clasp deploy 就作用在对应的项目上。
const fs = require('node:fs');
const path = require('node:path');
const env = process.argv[2];
if (!['test', 'prod'].includes(env)) { console.error('用法：node tools/use-env.js test|prod'); process.exit(1); }
const root = path.join(__dirname, '..');
const src = path.join(root, `.clasp.${env}.json`);
if (!fs.existsSync(src)) { console.error(`找不到 .clasp.${env}.json。先复制 .clasp.example.json，填上那个项目的脚本 ID。`); process.exit(1); }
fs.copyFileSync(src, path.join(root, '.clasp.json'));
console.log(`已切换到 ${env} 环境（.clasp.json 已更新）。`);
