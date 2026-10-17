# dsh-plugin-update 从 0.17.1 升到 0.18.6：升了什么、我们改了什么、还剩什么

日期：2026-10-17。这份笔记是那次升级的调查结论与落地记录，写给之后接手的人看。

## 一句话

更新包从 0.17.1 升到 0.18.6，本仓跟着改了三个提交；0.18.6 新加了一个宿主电话（第 6 个，
`wf.updateCheckFallback`，用来在安装被「新包观察期」拦下时改用一个合规的旧版本），
按「先不要做那个功能」的决定我们没接，面板在用到它时会退化成一句提示，不会崩。
更新包相关的四道门禁全绿；全仓另有 25 道门禁是红的，全部来自并行的 TypeScript 迁移工作线，
与本次升级没有交集。

## 一、更新包从 0.17.1 到 0.18.6 到底更新了什么

逐版（据包的发布说明与包体比对）：

- **0.18.0**：新增子路径控件 `dsh-plugin-update/install-button`，导出 `mountInstallButton`，
  给宿主在自己的界面里放一个「安装」按钮用。
- **0.18.1**：过期检查（check-expired）自动重查并重装一次；`host.call.fail` 日志行补上
  `error` 稳定码。
- **0.18.2**：修「目标版本陈旧、运行版本是今天」却被画成有新版本的问题；渲染层加数字守卫。
- **0.18.3**：新增 `dev-source` 阻塞码——插件目录是 junction、源码链接或外部目录时不再误报
  `unknown-profile`；没有快照的失败页补了「复制诊断」按钮。
- **0.18.4**：安装失败诊断把命中失败标记的那几行前置；没有来源时文案改成「源=未声明」。
- **0.18.5**：新增安装失败翻译官 `src/install-cause.ts`，首期只认
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`；`diag` 多三个可选键 `causeKind`、`causePackage`、
  `causeUnlockAt`。
- **0.18.6**：新增「合规版降级」——`src/compliant-version.ts` 给出五值裁决（ok-now、wait-until、
  downgrade-available、no-compliant、abstain）；宿主电话从 5 个变成 6 个，新增
  `wf.updateCheckFallback`；安装失败页多两个按钮「装合规版」「等新版」，并走一次决议确认。

顺手核过的两件事：

- 派生逻辑没有变：官方工具 `derive-client-values.mjs` 在新旧两个包里 sha256 完全相同
  （`1B3BDB2F08043203A29BA3828072736B7124615C0EF256A0B40BDF7E1953E921`），所以派生文件变了
  只是数据源版本变了，不是算法变了。
- 事件表 `event-list.update.json` 现在 26 个事件，只有 `host.call.fail` 多了一格 `error` 字段。

## 二、本仓跟着改了什么

三个提交，都在 `main` 上：

- `f234d70e`：更新包升到 0.18.6。改了根 `package.json` 的依赖范围与 `update:latest` 脚本、
  发布清单 `package/package.json`、`pnpm-workspace.yaml` 的放行名单，
  并重跑派生更新 `scripts/generated/updateClient.derived.js`。
  同时把 `tests/verify-update-migration` 的期望电话名从 5 个补到 6 个——不补的话，
  0.18.6 的多出来的电话会让这道门禁当场转红。
- `bf9c249b`：四个开发依赖升到最新补丁版（`jsdom` 30.1.3、`playwright` 1.64.1、
  `react`/`react-dom` 19.3.1）。生产依赖 `dsh-log` 0.3.4、`ws` 8.22.0、`yaml` 2.9.1 本来就是最新。
  `typescript-ast`（`npm:typescript@5.6.3` 别名）故意不升，因为 `dependency-cruiser` 要
  TypeScript 小于 7 才能看见 `.ts`。
- `dd7e74aa`：把 `scripts/derive-update-from-package.mjs` 里写死的版本号改成从根
  `package.json` 现读。原来那三处提示写的是 `^0.13.0`、`0.17.x`、`pnpm update
  dsh-plugin-update@^0.17.1`——最后这处是会照着做的真指令，升级到 0.18.6 之后照它做会把依赖
  范围改回 `^0.17.1` 并装回旧版本。

## 三、故意没接的东西

第 6 个电话 `wf.updateCheckFallback` 没有接：`src/host/updateFromPackage.js` 的
`createUpdatePhoneHandlers` 只从包里取 5 个处理器，`src/host/index.ts` 也只注册 5 个。
这是按「先不要做那个功能」的决定停在这里的，不是漏了。

不接的后果核过（在打包产物 `scripts/generated/updateEntryPanel.bundle.js` 里读的实际代码）：
面板只在用户点「装合规版」那一刻拨这个电话，写的是
`try { reply = await call(phoneNames.updateCheckFallback, {...}) } catch { reply = null }`，
拿不到回复就落到 `sayCopyKey("panel.toast.fallback-unavailable")`，中文文案是
「这次失败用不上合规版，请看诊断信息」。所以按钮会诚实地说「用不上」，不会白屏也不会报错。

## 四、门禁现在的状态

本次升级相关的四道，逐条跑过，全绿：

- `tests/verify-update-migration.ts`
- `tests/verify-update-panel.js`
- `tests/verify-update-mirror-hint.js`
- `tests/verify-generated-no-shadow.js`

全仓另有 25 道红（`node scripts/verify-parallel.mjs --keep-going` 实跑，全文留在
`%TEMP%\dsh-verify-final.txt`），按形状分三类，全部落在并行的 TypeScript 迁移工作线上：

- 还按 `.js` 路径读源码的：`verify-log-store.js` 报 `src/host/index.js` 不存在，
  `verify-log-switch-526.js`、`verify-map-drill.js`（源码里已找不到 `recMapNum`）等同形。
- 源码改名/搬家后判据没跟上的：`verify-dependency-rules.ts`（`src/host/refresh/wiring.ts`
  的同层 import 违规）、`verify-no-title.js`（`Tip.js` 的薄预设与零横向 import）、
  `verify-subdir-first-frame.js`（找不到 `SNAP_WAIT_MS` 的中央引用）。
- 文档与发布流程类：`verify-release-contract.js`（`CHANGELOG.md` 还没有 v1.9.0-beta.1 那一节）。

另有 `verify-build-artifacts.js` 报「源码树里的过渡产物 85 件、上限 69 件」。它只统计 `src/`
下的东西，而本次升级一个 `src/` 文件都没碰，所以同样不是这次升级带出来的；
`src/*.js` 与同名 `.ts` 并存的那些过渡产物是并行工作线正在搬的，`scripts/build.mjs` 每构建一次
就会把这批同名 `.js` 重写一遍（写的时候不比对内容），所以看修改时间分不出是谁构建出来的，
只能按「判据只读 `src/`、本次改动与 `src/` 无交集」来归因。

## 五、还剩的尾巴

1. **没有发版，所以这次升级对用户还没生效。** 版本仍是 `1.9.0-beta.1`，用户要拿到 0.18.6
   的行为，得走一次发布。
2. 两个文件里还留着 `dsh-plugin-update@^0.13.0` 的旧字面：`scripts/build.mjs:1627` 的构建报错
   文案、`scripts/bundle-update-entry.mjs:41` 的找不到包文案。这两处只是念错了号，不构成
   「照它做会出错」的指令；同一类问题在 `research/dsh-log-034-upgrade-effort.md:49` 里记过，
   当时也按「不影响行为」处理。会把人带去降级的那处已经改掉（见 `dd7e74aa`）。
3. `scripts/derive-update-from-package.mjs` 仍是手写 JavaScript。按「先修后转、两次提交」的
   规矩，本次只做完了「修」，转 TypeScript 是下一次单独提交。
