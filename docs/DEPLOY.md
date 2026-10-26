# 上线指南（不需要会编程）

按顺序做就行，每一步都写了“你会看到什么”。全程大约 30–40 分钟。

**先搞清楚三样东西：**

| 名字 | 是什么 | 在哪 |
|---|---|---|
| 网站 | 学生、家长、老师看到的页面 | GitHub Pages（已经开好） |
| 后台 | 负责登录、存数据、发邮件 | Google Apps Script（下面要建） |
| 数据表 | 所有学生和课程记录，老师能直接打开看 | Google 表格（后台自动建） |

**分两轮：** 第一轮用**测试账号**（假学生，邮件只发给你自己），确认没问题；第二轮换成**太太的账号**（空表，真学生）。

---

## 开始之前（只做一次）

1. **打开“终端”**：按 `Cmd + 空格`，输入“终端”，回车。
2. **确认装了 Node**：在终端输入 `node -v` 回车。显示 `v22…` 或更高就行；提示找不到，就去 <https://nodejs.org> 下载安装，再回来。
3. **关于 clasp**（把代码传到 Google 的小工具）：不用单独安装。下面所有命令都以 `npx @google/clasp` 开头，第一次运行会自动下载，要多等几秒。
4. **打开一个开关**：浏览器登录测试用的 Google 账号，打开 <https://script.google.com/home/usersettings>，把 **Google Apps Script API** 设为**开**。
5. **进入项目文件夹**（整段复制，回车）：
   ```
   cd "$HOME/Desktop/Mings MAC Backup/钢琴课网站文件夹/mingstudio_portal"
   ```

---

## 第一轮：测试账号

### 第 1 步　登录 Google

在终端输入：
```
npx @google/clasp login
```
浏览器会弹出登录页，选**测试用的 Google 账号**，一路点“允许”。看到终端出现 `Authorization successful` 就成功了。

### 第 2 步　建后台项目并上传代码

依次输入（每行回车一次）：
```
npx @google/clasp create-script --type standalone --title "琴房（测试）" --rootDir apps-script
cp .clasp.json .clasp.test.json
npx @google/clasp push
```
- 第一条会生成一个文件，里面记着这个后台项目的编号。
- 第三条如果问 `overwrite manifest?`，输入 `y` 回车。
- 看到 `Pushed 11 files` 左右就成功了。

### 第 3 步　初始化（建表、灌假数据）

1. 输入 `npx @google/clasp open-script`，浏览器打开后台编辑器。
2. 页面上方有一个函数下拉框，选 **setupTest**，点旁边的 **运行**。
3. 第一次会弹授权窗口：点“审核权限” → 选测试账号 → 如果出现“Google 未验证此应用”，点左下角 **高级** → **转至…（不安全）** → **允许**。（这是你自己的程序，不是风险。）
4. 下方“执行日志”出现 `完成（test）。数据表：https://docs.google.com/…` 就成功了。点那个链接能看到数据表，里面已经有 5 个假学生。

> 假学生的邮箱都是你自己邮箱的变体（例如 `你的名字+emma@gmail.com`），所以**所有验证码和提醒邮件都会进你自己的收件箱**，不会打扰任何人。

### 第 4 步　发布成网页接口

1. 编辑器右上角点 **部署** → **新建部署**。
2. 点“选择类型”旁边的齿轮 → **Web 应用**。
3. 填：**执行身份：我**；**谁有权访问：任何人**。
4. 点 **部署**，然后**复制**出现的“网页应用网址”（以 `/exec` 结尾）。先粘贴到记事本里留着。网址是https://script.google.com/macros/s/AKfycbyxYOBJRIdYzAtM0qu7ErtqV-0wOy7QPy5EffW8btZZNy9gdsoVKgwHyEW45OUybTAN/exec

### 第 5 步　告诉后台网站的地址

1. 编辑器左边点齿轮 **项目设置**。
2. 拉到最下面“脚本属性” → **添加脚本属性**。
3. 属性填 `SITE_URL`，值填：`https://xiesiqiao.github.io/mingstudio_portal/`（注意结尾有斜杠）。保存。

### 第 6 步　告诉网站后台的地址

1. 用“文本编辑”打开文件 `mingstudio_portal/web/js/config.js`。
2. 找到这一行：
   ```
   export const API_URL = 'https://script.google.com/macros/s/REPLACE_ME/exec';
   ```
   把引号里的整段网址换成第 4 步复制的网址。保存。
3. 回到终端，输入（整段复制）：
   ```
   git add -A
   git commit -m "连接后台"
   git push
   ```
4. 到 GitHub 仓库的 **Actions** 页面，等最新那一项出现绿色对勾（1–2 分钟）。
   如果是红色，点进去选 **Re-run all jobs**（上次失败是因为 Pages 当时还没开）。

### 第 7 步　试一试

打开 <https://xiesiqiao.github.io/mingstudio_portal/>，页面顶部会有“测试环境”提示条。

| 想看谁的视角 | 登录邮箱 |
|---|---|
| 老师 | 测试账号的邮箱 |
| 学生 Emma | 你的名字+emma@gmail.com |
| 家长 Chen | 你的名字+chen@gmail.com |

输入邮箱 → 去收件箱找 6 位验证码（也看看垃圾邮件箱）→ 输入即可。

**建议试一遍：** 老师“记课”→ 用学生账号“签字”→ 家长账号点“我已付款”→ 老师总览确认收款 → 互相留言。

想把假数据重置回初始状态：编辑器里选 **resetTestData** 点运行（只有测试环境能运行，太太的正式环境会拒绝，放心）。

---

## 第二轮：换成太太的账号

测试没问题后：

1. 终端输入 `npx @google/clasp logout`，再 `npx @google/clasp login`，这次选**太太的 Google 账号**。
2. 重复第 2 步，但把第二条命令改成保存为 prod：
   ```
   npx @google/clasp create-script --type standalone --title "琴房" --rootDir apps-script
   cp .clasp.json .clasp.prod.json
   npx @google/clasp push
   ```
3. 第 3 步改为运行 **setupProd**（建空表，只有老师账号，**没有假数据**）。
4. 重复第 4、5 步（部署、设置 `SITE_URL`）。
5. 重复第 6 步，把 `config.js` 里的网址换成**太太这个项目**的网址，再 `git add -A`、`git commit`、`git push`。
6. 太太用自己的邮箱登录，到“学生”页添加学生和家长、填邮箱、关联家长，就可以用了。从这一刻起，邮件会真的发出去。

以后想在两个项目之间切换：`node tools/use-env.js test` 或 `node tools/use-env.js prod`。

---

## 以后改了代码怎么更新

1. 终端：`npx @google/clasp push`。
2. 编辑器：**部署 → 管理部署 → 点铅笔 → 版本选“新版本” → 部署**（网址不变，不用改网站）。
3. 网站有改动：`git add -A`、`git commit -m "说明"`、`git push`。

---

## 出问题了？

| 现象 | 怎么办 |
|---|---|
| 网站显示“还没有连接到后台” | 第 6 步没做，或没等 Actions 变绿 |
| 登录一直提示“连不上服务器” | 第 4 步“谁有权访问”没选“任何人”，或网址复制错了（要以 `/exec` 结尾） |
| 收不到验证码 | 先看垃圾邮件箱；确认邮箱是老师登记过的那个；每个邮箱每小时最多 3 封 |
| 提示“表格结构和程序对不上” | 更新代码后，在编辑器运行一次 **upgradeSchema** |
| 想知道现在是测试还是正式 | 编辑器运行 **printStatus**，看日志第一行 |
| 提示 “User has not enabled the Apps Script API” | 做“开始之前”的第 4 步 |
| Actions 红色 | 点进去 Re-run；还不行就把报错文字发给我 |

**邮件额度：** 普通 Gmail 每天最多发约 100 封。系统在剩余不到 10 封时会停发学生邮件，把额度留给老师自己。
