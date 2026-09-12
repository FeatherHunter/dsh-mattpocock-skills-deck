# 日志系统发布记录（#559 整改 E、#562 同步更新，本次随 Node 程序入口首发到官方源）

## 一、已发布：dsh-log 0.2.0

- 发布时间：2026-09-12
- 发布人：王辰浩（npm 身份见 `npm whoami`）
- 发布目标：https://registry.npmjs.org/，标签 `latest`，公开访问
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

- 发布后确认：
  - 官方源上的最新版本与标签：`version = 0.2.0`、`dist-tags = { latest: '0.2.0' }`。
  - 从一个模拟「别人的项目」的空目录里 `npm install dsh-log@0.2.0`，装完能 `import { createNodeHostLog } from 'dsh-log/node'` 并写出日志。
  - 发布真实输出里包含浏览器授权那一步（npm 会打印一条授权链接，在浏览器里确认后命令才返回）。

## 二、发布向导脚本

`publish-wizard.sh` 放在包目录下，把这次发布的全过程做成六段：体检（发布目标、文件数、名字是否被占）、网页登录（扫码）、升版本号、构建与干跑、正式发布（带确认闸）、发布后验证。
以后要发新版本时用它；它不在包的发布白名单内，不会随包发出去。Windows 上用 Git 自带的 bash 跑（不要用 WSL 的 bash，路径会对不上）：

```sh
"C:\Program Files\Git\bin\bash.exe" packages/dsh-log/publish-wizard.sh
```

## 三、历史：发布演练记录

- 演练时间：2026-09-09 与 2026-09-11（升级到 0.2.0 之前）
- 演练命令：先 `node packages/dsh-log/build.mjs`，再在包目录下 `npm publish --dry-run`（只演练不真发）
- 当时的演练结果：包名 dsh-log、版本 0.1.0、文件数 11、包大小 25.4 kB、解包后 86.2 kB，发布目标同样是官方源。
  逐行输出中与本次的差别只有三处（`package: dsh-log@0.1.0`、`version: 0.1.0`、`filename: dsh-log-0.1.0.tgz`），其余清单与大小一致，故不再重复抄录。
- 白名单变化史：8 文件（首发演练）→ 10 文件（白名单新增 `INTEGRATION.md` 与 `event-list.template.json`）→ 11 文件（新增 Node 程序入口 `dist/node.js`），与 `README.md` 第 9 节一致。
- 说明：`dist` 下 6 个 JS 由本地 build 生成，不入库；本记录文件与发布向导脚本都不在发布白名单内，不进发布包，只留本地作证据。
