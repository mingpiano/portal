# 琴房课程系统（mingstudio_portal）

太太的钢琴工作室用的课程管理网站。**第一期**已完成：

- 老师、学生、家长用**邮箱验证码**登录（不用密码），家长与孩子配对
- 中文 / English 界面切换
- 学生名册（生日、开始日期、头像）、教材书单
- 记课 → 学生或家长签字（48 小时没签自动确认）→ 学费计数（每 10 节一期）→ 家长点“已付款”、老师确认收款
- 积分（每位学生可单独开关）、规则老师可改
- 通知、留言（邮件提醒）
- “正在学习”页（从每节课的曲目记录自动归纳）

后面几期（排课与日历、主题与庆祝动画、奖励、作业上传、伴奏库、作品集、YouTube 转存）见 [docs/STATUS.md](docs/STATUS.md)。

## 它是怎么搭起来的

| 部分 | 放在哪 | 作用 |
|---|---|---|
| 网页 | `web/` → GitHub Pages | 纯静态页面，没有构建步骤 |
| 后台 | `apps-script/` → Google Apps Script | 所有权限判断和数据读写都在这里 |
| 数据库 | Google Sheets（老师自己的账号） | 老师随时能直接打开表格看和改 |

网页只会拿到“这个人有权看的那部分数据”，其他人的信息根本不会发到浏览器里。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 在自己电脑上试

需要 Node 22 或更新。

```bash
npm run dev        # 打开 http://localhost:8080 ，后台是模拟的，数据在内存里
npm test           # 154 个后台与词条测试，几秒钟
npm run test:e2e   # 浏览器里真点一遍（需要 playwright 和 Chromium）
```

本机预览里：老师账号 `tester@gmail.com`；验证码在 `http://localhost:8080/__dev/mail?to=邮箱` 里看。

## 部署

先用测试账号 + 假学生跑通，再切到太太的账号。一步步的操作见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 目录

```
apps-script/   后台代码（Apps Script）
web/           网页（HTML / CSS / JS 模块）
tests/         自动测试（权限、登录、记课、学费、积分、词条、浏览器）
tools/dev/     本机模拟后台 + 预览服务器
tools/youtube/ 第 3 期的 YouTube 转存脚本（预留）
docs/          部署、架构说明、进度；reference/ 是演示版原文件
```
