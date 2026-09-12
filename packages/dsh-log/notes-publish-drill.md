# 日志系统发布记录（dsh-log）

这份文件记的是「发出去的是什么」：每发一版，把原始输出与关键数字留在下面，供下一个人复现和核对。文中的字节数、文件数都描述**当时发出去的那一份**，不是当前工作区。0.2.0 是首次公开发布，随 Node 程序入口一起上线；此前只有本地演练（见第三节）。

## 一、已发布：dsh-log 0.2.0

- 发布时间：2026-09-12
- 发布人：王辰浩（npm 身份见 `npm whoami`）
- 发布目标：https://registry.npmjs.org/，标签 `latest`，公开访问
- 发布所用修订：`e6c871c`（官方源 `npm view dsh-log@0.2.0 gitHead` 可查；提交说明是"说明书修正：进度标题与内容之间必须空一整行"，与本包无关，它只是发布那一刻的仓库最新提交）
- 这一版的已知偏差：**包内 `README.md` 与 `INTEGRATION.md` 是发布当时的旧稿，与本仓当前工作区不一致**——包已经发出去了，包内 README 却还写着"包还没发到官方源"，随包的集成教程也跟着说安装命令装不上。原因是改好这段文字的提交（`af8f999`）在发布之后才落到仓库。修好的文档要跟下一版一起发出去才对读者生效，核对办法见第二节末。
- 发布命令（在 `packages/dsh-log` 目录下，先跑 `node build.mjs` 生成产物）：
  1. `node packages/dsh-log/build.mjs`
  2. `npm publish --registry=https://registry.npmjs.org/`（发布过程中 npm 要求了一次浏览器授权，授权后继续）
- 发布结果关键行：包名 dsh-log、版本 0.2.0、文件数 11、包大小 25.4 kB、解包后 86.2 kB
- 完整输出逐行如下：

```text
npm notice package: dsh-log@0.2.0
npm notice Tarball Contents
npm notice 14.2kB INTEGRATION.md
npm notice 1.1kB LICENSE
npm notice 16.2kB README.md
npm notice 15.4kB dist/client.js
npm notice 11.1kB dist/config.js
npm notice 1.9kB dist/host.js
npm notice 3.7kB dist/node.js
npm notice 9.2kB dist/phones.js
npm notice 12.4kB dist/store.js
npm notice 127B event-list.template.json
npm notice 870B package.json
npm notice Tarball Details
npm notice name: dsh-log
npm notice version: 0.2.0
npm notice filename: dsh-log-0.2.0.tgz
npm notice package size: 25.4 kB
npm notice unpacked size: 86.2 kB
npm notice shasum: 21128f0f6e2b236dd8ffa5237da90a19d55b8919
npm notice integrity: sha512-+yUgGjSuowSSm[...]snoZANU2KL9Tw==
npm notice total files: 11
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
```

上面清单里的 `INTEGRATION.md` 14.2kB 与 `README.md` 16.2kB 是 0.2.0 发出去的那两份，仓库里已经改过，字节数不再相同，属正常。

- 发布后确认：
  - 官方源上的最新版本与标签：`version = 0.2.0`、`dist-tags = { latest: '0.2.0' }`。
  - 从一个模拟「别人的项目」的空目录里 `npm install dsh-log@0.2.0`，装完能 `import { createNodeHostLog } from 'dsh-log/node'` 并写出日志。
  - 发布真实输出里包含浏览器授权那一步（npm 会打印一条授权链接，在浏览器里确认后命令才返回）。

## 二、怎么再发一版

包目录下的 `publish-wizard.sh`（不随包发布）把全过程做成六段：体检（发布目标、文件数、名字是否被占）、网页登录（扫码）、升版本号、构建与干跑、正式发布（带确认闸）、发布后验证。Windows 上用 Git 自带的 bash 跑（不要用 WSL 的 bash，路径会对不上）：

```sh
"C:\Program Files\Git\bin\bash.exe" packages/dsh-log/publish-wizard.sh
```

向导的"发布后验证"这一段只查官方源上的版本号，并要求把 `npm publish` 的原始输出补进本文档。另外两件事它没做，手动补上，都是几步的事：

1. **核对包内文档与仓库一致**。把刚发出去的包拿下来解开（`npm pack dsh-log@<刚发的版本>`），逐字比对包内 `README.md`、`INTEGRATION.md` 与 `packages/dsh-log/` 下的同名文件；再打开 npm 包页，看 README 开头讲安装的那几句是不是你想要的那几句。0.2.0 就是漏了这一步，把"包还没发到官方源"发了出去。
2. **记下发布修订**。`npm view dsh-log@<刚发的版本> gitHead` 读出这次发布对应的提交，连同版本、文件数、包大小、发布目标，按第一节的格式补一条记录。

## 三、历史：发布演练记录

- 演练时间：2026-09-09 与 2026-09-11（升级到 0.2.0 之前）
- 演练命令：先 `node packages/dsh-log/build.mjs`，再在包目录下 `npm publish --dry-run`（只演练不真发）
- 当时的演练结果：包名 dsh-log、版本 0.1.0、文件数 11、包大小 25.4 kB、解包后 86.2 kB，发布目标同样是官方源。
  逐行输出中与本次的差别只有三处（`package: dsh-log@0.1.0`、`version: 0.1.0`、`filename: dsh-log-0.1.0.tgz`），其余清单与大小一致，故不再重复抄录。
- 白名单变化史：8 文件（首发演练）→ 10 文件（白名单新增 `INTEGRATION.md` 与 `event-list.template.json`）→ 11 文件（新增 Node 程序入口 `dist/node.js`），与 `README.md` 第 9 节一致。
- 说明：`dist` 下 6 个 JS 由本地 build 生成，不入库；本记录文件与发布向导脚本都不在发布白名单内，不进发布包，只留本地作证据。
