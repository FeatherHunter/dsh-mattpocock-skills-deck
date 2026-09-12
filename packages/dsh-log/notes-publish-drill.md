# 日志系统发布演练记录（#559 整改 E，#562 同步更新，本次随 Node 程序入口更新）

- 演练时间（最近一次）：2026-09-11
- 演练命令（按顺序两步）：
  1. `node packages/dsh-log/build.mjs`（先本地生成日志系统的编译产物）
  2. 在 `packages/dsh-log` 目录下跑 `npm publish --dry-run`（只演练不真发）
- 演练结果关键行：
  - 包名：dsh-log
  - 版本：0.1.0
  - 文件数：11（total files: 11）
  - 包内容：LICENSE、README.md、INTEGRATION.md、event-list.template.json、dist 下 6 个 JS（client.js、config.js、host.js、node.js、phones.js、store.js）、package.json
  - 发布目标：https://registry.npmjs.org/，标签 latest，公开访问（dry-run，未真发）
- 完整输出逐行如下：

```text
npm notice package: dsh-log@0.1.0
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
npm notice version: 0.1.0
npm notice filename: dsh-log-0.1.0.tgz
npm notice package size: 25.4 kB
npm notice unpacked size: 86.2 kB
npm notice shasum: 2f0c0c58e887321eaa94b3e051fc9c3d84b8464e
npm notice integrity: sha512-+gn0dDPELHKe5[...]dH2h/f/DAfj9Q==
npm notice total files: 11
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)
```

- 说明：dist 下 6 个 JS 由本地 build 生成，不入库；本记录文件不在包的发布白名单内，不进发布包，只留本地作证据。历史上依次为 8 文件（首发演练）、10 文件（白名单新增 `INTEGRATION.md` 与 `event-list.template.json`）、本次 11 文件（新增 Node 程序入口 `dist/node.js`），与 `README.md` 第 9 节一致。
- 本次同时验证：从外部项目用本地路径装包后，`dsh-log/node` 能直接 import 并写出日志（等待落盘约 90 毫秒，日志正文为一行 JSON）。
