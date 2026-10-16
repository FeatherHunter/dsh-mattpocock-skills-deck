# dsh-log 0.2.2 → 0.3.4 升级开发量调查

调查日期：2026-10-15。调查范围限定一手来源：npm registry、`node_modules/dsh-log`（package.json / INTEGRATION.md / README.md / dist）、git 历史、本仓源码与门禁。只做调查，不改业务代码，未提交。

## 1. 远端最新版是不是 0.3.4

是。依据：

- `npm view dsh-log version` 回 `0.3.4`；`npm view dsh-log dist-tags --json` 回 `{ "latest": "0.3.4" }`，没有别的分流标签。
- `npm view dsh-log time --json` 显示全部 8 个版本及发布时间：0.2.0、0.2.1（2026-09-12），0.2.2（2026-10-08），0.3.0、0.3.1、0.3.2、0.3.3、0.3.4（全部在 2026-10-14 同一天内发布，0.3.4 为 2026-10-14T21:24:40Z）。0.2.2 到 0.3.0 之间没有别的版本，0.3.4 之后没有新版本。
- 本机三处一致：根 `package.json` 声明 `"dsh-log": "^0.3.4"`，`package/package.json:26` 钉死 `"dsh-log": "0.3.4"`，`node_modules/dsh-log/package.json` 的 `version` 字段为 `0.3.4`。`pnpm-workspace.yaml` 的放行名单里有 `dsh-log@0.3.4` 一行。
- GitHub 仓库地址以包内声明为准：`node_modules/dsh-log/package.json` 的 `repository.url` 为 `git+https://github.com/FeatherHunter/dsh-log.git`。本次调查用未登录抓取看该仓库页面，只拿到通用导航外壳，没有读到 tag 或分支列表，所以 tag 与分支有没有更新的版本以下结论为准：npm registry 是判版本唯一的依据，registry 说最新就是 0.3.4。

## 2. 0.2.2 → 0.3.4 的断裂点与新增能力

### 2.1 断裂点（升级必须改代码的两处）

1. **建日志库时插件标识与电话名前缀双必填，不再给默认值。** 依据：`node_modules/dsh-log/dist/host.js` 的 `createHostLog` 注释写明缺任一建库当场抛中文错，`prefix` 不再回退到 `pluginId`；`dist/client.js` 的 `resolveClientLogConfig` 同样缺任一即抛。包自带的升级指引（`node_modules/dsh-log/INTEGRATION.md:328`）把这一项列为迁移第 1 条：补两行配置。本仓的接法见 `src/host/logFromPackage.js:23`（传 `{ pluginId: 'wf', prefix: 'wf' }`）与派生脚本尾部的客户端建日志器（`scripts/derive-log-from-package.mjs:196`，同样传 `wf`/`wf`）。
2. **存储键按插件标识派生，旧键作废。** 0.2.x 全插件共用一个开关存储键 `dsws.debug`；0.3.0 起实际键为 `dsws.debug.<pluginId>`，读写两处同改（`node_modules/dsh-log/dist/client.js:62-69`，`debugStorageKey` 函数在 `:68-69`，`LOG_DEBUG_KEY` 只保留作前缀字面）。本插件标识是 `wf`，所以新键是 `dsws.debug.wf`。包的升级指引（`INTEGRATION.md:329`）要求删掉手拼目录与开关与存储键的三处代码，改走自动派生，旧开关作废、用户需重开一次。本仓的迁移逻辑在 `src/client/kernel/settings-debug.js:38-56`（新键有值认新键，新键没有且旧键是对象才搬一次，采样率只留进证据）与派生脚本尾部的开机内存兜底（`scripts/derive-log-from-package.mjs:197-210`，只改内存、不提前落盘，注释写明为什么不能在这里持久化）。

### 2.2 电话名：动作名不变，前缀参数化；总数是 5 个写侧加 1 个只读查询

- 电话名拼法为前缀加动作名（`node_modules/dsh-log/dist/config/phones.js` 的 `buildPhoneName`/`buildPhoneNames`/`buildLogQueryPhoneName`）。动作名冻结 5 项：`logBatch`、`logExport`、`logClear`、`logGetSwitch`、`logSetSwitch`（`dist/host.js` 的 `HOST_LOG_PHONE_ACTIONS` 注释写明冻结依据）。
- 第 6 个是只读查询电话 `<prefix>.logQuery`，由 `buildLogQueryPhoneName` 单源派生，不进 5 项冻结映射（`dist/host.js` 的 `registerHostLogPhones` 注册 6 个，`phoneNames` 映射仍只有 5 个）。
- 前缀传 `wf` 时 5 个字面与旧版一字不差（`wf.logBatch` 等），所以本仓宿主注册侧零改名。注意区分：`src/host/index.js:327` 的 `wf.logAppend`（日志直追加）是更新包 `dsh-plugin-update` 0.16.0 起的第 5 个电话，不是日志包的电话，不要计入日志包的账。

### 2.3 新增能力：哪些本插件已用、哪些还没接

| 能力（首发版本） | 来源 | 本仓状态 |
|---|---|---|
| 轮转与保留（单文件超 5MB 封存、留 14 天，宿主侧自动做） | `INTEGRATION.md:200`、`README.md` 第 6.1 节 | 已用：零接线，宿主侧自动生效 |
| 读侧渲染 `parseLogLine`/`formatRow`/`formatRows`（根入口纯函数） | `dist/index.js`、`README.md:403-413` | 未接：本仓 `src/` 无引用（grep `formatRow` 在 `src/` 零命中） |
| 命令行 `dsh-log tail`（只读看日志） | `README.md:415-425` | 未接：人工排障工具，本仓无调用 |
| 命令行 `dsh-log export`（摘要加原始行） | `README.md:427-434` | 未接：同上，人工用 |
| 宿主侧链上下文 `store.trace()` | `dist/store.d.ts`（`trace` 方法）、`README.md:522-533` | 未接：本仓 `src/` 无 `store.trace` 调用 |
| 只读查询电话 `wf.logQuery` 与跨插件聚合 `aggregateLogQuery` | `dist/host.js`、`README.md:144-153` | 未接：本仓宿主只注册 5 个写侧电话（`src/host/index.js:314-318` 无 `logQuery`），`src/` 无 `aggregateLogQuery` 引用 |
| 0.3.4 目录摘要如实标注读不出的文件与缺的格子 | 包 `package.json` 的 `description` 字段、`README.md:700-703` | 未接：导出命令侧的展示修正，本仓无代码依赖 |
| 多文件打包（0.3.x 产物由单文件拆成多文件） | 派生脚本注释（`derive-log-from-package.mjs:80-83,157-168`） | 已适配：派生脚本加了 export 块剥离与 IIFE 作用域隔离，属本次升级手写量的一部分 |

事件计数口径不受影响：0.3.4 未新增日志事件名。`research/489-appendix.md` 顶部修订线中 0.3.4 升级没有留修订条目（cf6973a3 的文件清单里也没有该附录），现行计数仍以附录第 1 章为准（门禁 `tests/verify-log-count.js` 头注释：常驻 43、按需 47、自监控 5、总数 95）。

## 3. 本仓触碰 dsh-log 的手写文件与各自职责

以 `grep dsh-log`（144 处命中）为准，日志升级实际改到的手写文件只有以下几件（行号均为当前树）：

- `src/host/logFromPackage.js`（26 行）：宿主侧唯一接线。动态 import 已安装包的 `dsh-log/host`，以 `wf`/`wf` 建库并拿回日志库（`:12-25`）。本次升级改 3 增 2 删：注释补 `prefix` 必填口径，行为零变化。包不可用时由调用方（`src/host/index.js:313`）回退旧实现。
- `scripts/derive-log-from-package.mjs`（254 行）：客户端那一半的派生脚本。把已安装包的 `dist/client.js` 打包成单文件，落到 `scripts/generated/logKernel.derived.js`。本次升级改 66 增 12 删，全部手写：早失败哨兵的归一字面随多文件产物更新（`:83` 两条来源注释）、export 块剥离（`:162`）、IIFE 作用域隔离只留三个名字（`:173-188`：`createClientLog`、`debugStorageKey`、`LOG_DEBUG_KEY`）、开机内存兜底 tail（`:197-210`）。宿主那一半已在 #1016 退场（`:23-29` 注释写明去向）。
- `src/client/kernel/settings-debug.js`（366 行）：调试开关的持久化迁移归属处。`settingsDebugLegacy`（`:38-56`）实现新键优先、旧键只搬一次。本次升级改 31 增 14 删。
- `scripts/build.mjs`（`:1399-1446`）：两半版本一致断言 `assertLogHalvesVersionMatch`（`:1407-1433`，#1016 立项）与派生调用。本次升级未改该断言（构建错误文案里 `dsh-log@^0.2.2` 字样是旧注释残留，判据读的是已安装版本，不影响行为）。后续跟进提交 31384106 只动了更新包侧（`derive-update-from-package.mjs` 等），日志侧零改动。
- `tests/verify-settings-debug.js`（19 件事，头注释 `:1-50`）：开关迁移门禁。本次升级改 38 增 32 删：量新键 `dsws.debug.wf`、裸键只当升级证据（头注释第二件事），硬约束旧键名仍是 `dsws.debug`（`:311`）。
- 其余日志门禁（`tests/verify-log-*.js` 共 10 份：artifacts、client、count、exec-606、fields、selfmon、statusbar、store、switch-526、switch-597）本次升级零改动：事件名、字段白名单、计数一个没动。`verify-log-count.js` 对 `update.install.exec` 的核对仍走委托口径（到已安装包内白名单核对，`verify-log-count.js:94-103`），与 #1016 一致。
- 文档对照关系：`research/489-appendix.md` 第 1 章是事件对照表的唯一正源（现行条数以它为准）；`docs/design/335-logging-contract.md` 第 3 章是守卫与采样节流的操作口径（0 输入节写明条数快照不再逐处追改）。本次升级两份文档都不用改：无新增事件、无新增字段、无口径变化。`research/1052-dsh-log-dropped-events.md` 记录的是 0.2.2 时代的旧问题（事件白名单漏常驻信息），随 0.3.x 升级自然消解，不在本次改动清单里。
- 版本声明三处：根 `package.json`（`^0.3.4`，允许小修补浮动）、`package/package.json:26`（钉死 `0.3.4`，构建断言要求确切版本）、`pnpm-workspace.yaml`（放行名单 `dsh-log@0.3.4` 一行）。本次升级各改 3/2/6 行左右，纯版本号。

## 4. 开发量结论

### 4.1 已花掉的量（提交 cf6973a3，2026-10-15 16:55，日志部分）

用 `git show cf6973a3 --numstat` 复核，日志部分：

- 手写量：约 150 行新增、68 行删除，合计约 218 行变更。构成：派生脚本 66/12、settings-debug 31/14、开关门禁 38/32、logFromPackage 3/2、host/index 接线 1/1、三处版本声明 3/3＋2/2＋6/2。
- 自动派生量：`scripts/generated/logKernel.derived.js` 1025 增 477 删（合计约 1502 行），零手写成本，由派生脚本重跑生成。审查时只看派生脚本与哨兵，不逐行审派生文件。
- 口径：该提交是日志包与更新包的合包提交，更新包侧（`updateClient.derived.js` 687/82 等）另计，不在上述数字里。

### 4.2 未来再升的预估

- **小修补升级（如 0.3.5、0.3.6）：预计 0 行手写。** 依据：三道防线已立——派生脚本的早失败哨兵（名字改动当场失败）、构建的两半版本一致断言、开关迁移门禁。实证：本次之后的跟进提交 31384106（更新包 0.17.0→0.17.1，2026-10-15 17:24）就是纯面板补丁的样板：电话仍 5 个、快照仍 7 字段，本仓对应侧接线零改动，只重派生。日志包的小修补同理：`pnpm update` 加重派生加构建，三处门禁全绿即收工；只有哨兵变红才需动手。
- **下一次断裂升级（如 0.4.0 级别，改建库必填项、存储键、电话动作）：预计几十到一百多行手写，与本次同量级。** 依据：包自带的升级指引把迁移拆成固定条目（`INTEGRATION.md:328-329`：建库补配置各 1 行、删手拼 3 处），本仓的适配面也是固定的三处（派生脚本 tail、settings-debug 迁移、开关门禁）。本次 150 行新增就是该适配面的实测上限；若断裂只动一处（如只加电话），按比例只付其中一部分。派生文件的千行级 diff 照例不计手写。
