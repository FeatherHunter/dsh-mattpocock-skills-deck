# 更新包发布演练记录（#583 抽离票）

- 演练时间：2026-09-10（UTC）
- 演练命令（按顺序四步）：
  1. `node packages/dsh-plugin-update/build.mjs`（先本地生成更新包的编译产物：tsc 只做类型检查，esbuild 一对一转译 8 个文件）
  2. 在 `packages/dsh-plugin-update` 目录下跑 `npm pack --dry-run`（检查文件清单只含发布文件）
  3. 在 `packages/dsh-plugin-update` 目录下跑 `npm publish --dry-run`（确认包名与版本号可发布，只演练不真发）
  4. 打真包并在干净临时目录实际安装，引用包根跑一次建能力冒烟（网页端 npm 侧验证）
- 演练结果关键行：
  - 包名：dsh-plugin-update（`npm view dsh-plugin-update` 返回 404，名字仍可用；迁移票 #586 开工前再复查一次）
  - 版本：0.1.0
  - 文件数：11（total files: 11）
  - 包内容：LICENSE、README.md、dist 下 8 个 JS（client.js、commands.js、config.js、host.js、ports.js、reader.js、service.js、store.js）、package.json
  - 发布目标：https://registry.npmjs.org/，公开访问（dry-run，未真发）
  - 干净安装冒烟：`added 1 package`，包根 `createHostUpdate` 建能力成功，三电话名与处理器齐备（SMOKE_OK）
- 说明：dist 下 8 个 JS 由本地 build 生成，不入库；本记录文件不在包的发布白名单内，不进发布包，只留本地作证据。
  桌面宿主侧需真人参与验证（本票 Question 原文要求），自动化只覆盖到假件双路由，见 #583 进度区。
