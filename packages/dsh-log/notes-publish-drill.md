# 日志系统发布演练记录（#559 整改 E）

- 演练时间：2026-09-09（UTC）
- 演练命令（按顺序两步）：
  1. `node packages/dsh-log/build.mjs`（先本地生成日志系统的编译产物）
  2. 在 `packages/dsh-log` 目录下跑 `npm publish --dry-run`（只演练不真发）
- 演练结果关键行：
  - 包名：dsh-log
  - 版本：0.1.0
  - 文件数：8（total files: 8）
  - 包内容：LICENSE、README.md、dist 下 5 个 JS（client.js、config.js、host.js、phones.js、store.js）、package.json
  - 发布目标：https://registry.npmjs.org/，标签 latest，公开访问（dry-run，未真发）
- 完整输出逐行如下：

```text
npm notice package: dsh-log@0.1.0
npm notice Tarball Contents
npm notice 1.1kB LICENSE
npm notice 3.2kB README.md
npm notice 682B dist/client.js
npm notice 5.0kB dist/config.js
npm notice 1.7kB dist/host.js
npm notice 9.2kB dist/phones.js
npm notice 12.4kB dist/store.js
npm notice 717B package.json
npm notice Tarball Details
npm notice name: dsh-log
npm notice version: 0.1.0
npm notice filename: dsh-log-0.1.0.tgz
npm notice package size: 9.8 kB
npm notice unpacked size: 34.0 kB
npm notice total files: 8
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)
```

- 说明：dist 下 5 个 JS 由本地 build 生成，不入库；本记录文件不在包的发布白名单（files 只有 dist、README.md、LICENSE）内，不进发布包，只留本地作证据。
