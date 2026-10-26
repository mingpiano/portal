# 部署指南

分两轮：**先测试账号**（假学生、邮件只发给你自己），**再太太的账号**（空表，真学生）。两轮用同一份代码，区别只在 Apps Script 项目里的 `ENV` 设置。

## 一次性准备

1. 装 Node 22+，然后 `npm i -g @google/clasp`。
2. 打开 <https://script.google.com/home/usersettings>，把 **Google Apps Script API** 打开。
3. `clasp login`（用要拥有数据的那个 Google 账号登录）。
4. 在 GitHub 新建仓库，把本文件夹推上去。仓库设置 → Pages → **Source 选 “GitHub Actions”**。

## 第一轮：测试账号

1. 用测试 Google 账号 `clasp login`。
2. `clasp create-script --type standalone --title "琴房（测试）" --rootDir apps-script`，会生成 `.clasp.json`。
   然后 `cp .clasp.json .clasp.test.json`（`.clasp.json` 已被 git 忽略，不会上传）。
3. `clasp push`。
4. `clasp open-script` 打开编辑器，选函数 **setupTest** → 运行。第一次会要求授权（看到“未经验证”提示时，点“高级”→“继续”，这是你自己的脚本）。
   运行结束后日志里有数据表的链接：已建好所有表，并灌入 5 个假学生、3 位假家长、13 节课。
   **假学生的邮箱都是你自己邮箱的 `+别名`（例如 `你+emma@gmail.com`），验证码和提醒邮件都会进你自己的收件箱。**
5. 编辑器里点 **部署 → 新建部署 → 类型：Web 应用**：执行身份选“我”，谁有权访问选“任何人”。复制以 `/exec` 结尾的网址。
6. 项目设置 → 脚本属性，新增 `SITE_URL` = 你的网站地址（形如 `https://你的用户名.github.io/mingstudio_portal/`，邮件里的登录链接用它）。
7. 把 `web/js/config.js` 里 `API_URL` 换成第 5 步的网址，提交并推送到 `main`，GitHub Actions 会自动发布网站（几分钟）。
8. 打开网站，用测试账号邮箱登录（老师），再用 `你+emma@gmail.com` 等登录看学生和家长的视角。页面顶部有“测试环境”提示条。
9. 想重来：编辑器里运行 **resetTestData**（只在测试环境能运行，正式环境会拒绝）。

之后改了后台代码：`clasp push`，再 **部署 → 管理部署 → 编辑 → 新版本**（网址不变）。

## 第二轮：切到太太的账号

1. 用太太的 Google 账号 `clasp login`，重复上面第 2–6 步，但 **第 4 步运行 setupProd**：只建空表和老师账号（就是登录的这个邮箱），没有任何假数据，邮件会真的发给学生和家长。
   `cp .clasp.json .clasp.prod.json`。之后用 `node tools/use-env.js test|prod` 在两个项目间切换。
2. 把 `web/js/config.js` 的 `API_URL` 换成太太那个项目的网址，推送。
3. 太太用自己的邮箱登录，在“学生”页添加学生和家长、填邮箱、关联家长，开始使用。
4. 测试用的 Apps Script 项目和表格可以保留（以后试新功能），或删掉。

## 邮件额度

普通 Gmail 每天最多发约 100 封。系统在剩余额度低于 10 封时会停止发学生邮件，把额度留给老师自己的邮件。验证码、记课签字、学费提醒、留言提醒都走这个额度。

## 出问题时

- 登录一直提示连不上：`API_URL` 没改，或部署时“谁有权访问”没选“任何人”。
- 提示“表格结构和程序对不上”：升级后在编辑器运行一次 **upgradeSchema**。
- 想看当前是测试还是正式：运行 **printStatus**。
