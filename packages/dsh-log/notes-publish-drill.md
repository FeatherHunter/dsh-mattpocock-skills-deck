# 日志系统发布演练记录（#559 整改 E，#562 同步更新）

- 演练时间：2026-09-09（UTC）
- 演练命令（按顺序两步）：
  1. `node packages/dsh-log/build.mjs`（先本地生成日志系统的编译产物）
  2. 在 `packages/dsh-log` 目录下跑 `npm publish --dry-run`（只演练不真发）
- 演练结果关键行：
  - 包名：dsh-log
  - 版本：0.1.0
  - 文件数：10（total files: 10）
  - 包内容：LICENSE、README.md、INTEGRATION.md、event-list.template.json、dist 下 5 个 JS（client.js、config.js、host.js、phones.js、store.js）、package.json
  - 发布目标：https://registry.npmjs.org/，标签 latest，公开访问（dry-run，未真发）
- 完整输出逐行如下：

```text
npm notice package: dsh-log@0.1.0
npm notice Tarball Contents
npm notice 8.1kB INTEGRATION.md
npm notice 1.1kB LICENSE
npm notice 13.7kB README.md
npm notice 15.7kB dist/client.js
npm notice 11.1kB dist/config.js
npm notice 1.9kB dist/host.js
npm notice 9.2kB dist/phones.js
npm notice 12.4kB dist/store.js
npm notice 127B event-list.template.json
npm notice 818B package.json
npm notice Tarball Details
npm notice name: dsh-log
npm notice version: 0.1.0
npm notice filename: dsh-log-0.1.0.tgz
npm notice package size: 21.4 kB
npm notice unpacked size: 74.2 kB
npm notice shasum: 3fad15e10fe9a9d6e8c65140b80a3ffecd002539
npm notice integrity: sha512-AfwbKUucHsupU[...]ae11Y1tQQslog==
npm notice total files: 10
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)
```

- 说明：dist 下 5 个 JS 由本地 build 生成，不入库；本记录文件不在包的发布白名单内，不进发布包，只留本地作证据。上次记录为 8 文件，本次因白名单新增 `INTEGRATION.md` 与 `event-list.template.json` 变为 10 文件，与 `README.md` 第 9 节一致。
