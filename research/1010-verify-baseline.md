# 当前验证链基线（2026-10-12 实测，基线核查员产出）

这份文件回答一件事：**在重构动手之前，本仓库的验证链里有哪些门禁是红的**。它是重构分批落地时的对照基线——每批落地后重跑同一套，红灯只能减少、不能增加。

采集方式：只读加只跑，没有修改任何被检查的文件（本文件是唯一新增）。跑批器写在系统临时目录（`%TEMP%\dsh-baseline-1010\run-verify-baseline.cjs`），逐条起进程跑、记录退出码与失败行。采集时刻的仓库不是安静的——有并发会话正在改客户端与设置相关文件，所以下面专门分出「瞬态红」一节，别把它当成真债。

## 一、跑了什么

- `package.json` 的 `scripts.verify`：按 ` && ` 拆开共 **240 条** `node tests/…` 脚本，逐条跑完（240/240，无跳过）。
- `package.json` 的 `scripts.test`：`node scripts/verify-chain.js`（它自己会串跑整条 verify 链并停在第一个红灯）加 `scripts.test:smoke` 里的 **6 条**冒烟。
- 另有 **2 条不在任何链里**的孤立脚本，本次手动跑了：`tests/verify-829-parent-reread.js`、`tests/verify-971-markdown-parent.js`（见第四节末尾）。

合计执行 247 条命令，红灯 **14 条**（verify 链内）；测试链另有 2 条红（`scripts/verify-chain.js` 与一条冒烟，见下）。

## 二、红灯清单（verify 链内 14 条）

| # | 脚本 | 退出码 | 首个失败行（原文截断） | 根因分类 |
|---|------|--------|------------------------|----------|
| 1 | `tests/verify-deck-tools.js` | 1 | `FAIL deck_context 正例：回 ok（实得 unsupported）` | 甲（缺判定出口） |
| 2 | `tests/verify-deck-tools-matrix.js` | 1 | `FAIL [github] 建票：回 ok（实得 unsupported；reason=判定出口这次没装上…）` | 甲 |
| 3 | `tests/verify-790-parent-edge.js` | 1 | `FAIL D1 写后读回没父 → 逐条 failed（实得 undefined）` | 甲 |
| 4 | `tests/verify-895-bulk-deadline.js` | 1 | `FAIL 预算打满 → 部分成功（实得 unsupported）` | 甲 |
| 5 | `tests/verify-898-block-merge.js` | 1 | `FAIL A1 两条阻塞边明细都成功（实得 []）` | 甲 |
| 6 | `tests/verify-deck-no-hang.js` | 1 | `FAIL 沙箱挂住读照样回来（实得 unsupported）` | 甲 |
| 7 | `tests/verify-deck-parallel.js` | 1 | `FAIL 同票并发改标签两笔都成（实得 unsupported/unsupported）` | 甲 |
| 8 | `tests/verify-deck-thin-reads.js` | 1 | `FAIL 缺省取反向边（调了依赖接口）` | 甲 |
| 9 | `tests/verify-992-readonly-labels.js` | 1 | 抛异常 `TypeError: Cannot read properties of undefined (reading 'repo')`（`tests/verify-992-readonly-labels.js:276`） | 甲（下游崩塌） |
| 10 | `tests/verify-929-batch-cycle.js` | 1 | `FAIL ① 至少一条边如实报失败（实得 []）` | 甲 |
| 11 | `tests/verify-log-fields.js` | 1 | `FAIL 事件有埋点落点 choiceStore.hint.reject（全仓未找到）` | 乙（日志事件有表无落点） |
| 12 | `tests/verify-log-count.js` | 1 | `FAIL 按需事件有埋点 choiceStore.hint.reject`；`94 个事件全部落点无缺口 —— 缺口：choiceStore.hint.reject` | 乙 |
| 13 | `tests/verify-669-switch-visible.js` | 1 | 抛异常 `TypeError: Cannot read properties of null (reading 'dispatchEvent')`（`tests/verify-669-switch-visible.js:120`） | 丙（客户端界面，未深挖） |
| 14 | `tests/verify-locale-completeness.js` | 1（批跑时） | `FAIL C. 清单外新增 CJK 字符串 kernel/store-prefs.js=3` | **瞬态**：单独重跑退出码 0 |

测试链：`node scripts/verify-chain.js` 退出 1，停在 `tests/verify-deck-tools.js`（即上面第 1 条的连锁）；`tests/smoke-comment-passthrough.test.js` 退出 1，失败三项（`TrackerError{kind:auth} 直透`、`后端无 comment 方法 → kind:unsupported`、`selection 为空 → kind:unsupported`，见该文件 `:96`、`:101`、`:106`）。另外 5 条冒烟全绿。

绿灯：verify 链 226/240 绿；冒烟 5/6 绿。

## 三、根因甲：夹具没给装配方传「判定出口」（12 条同一个根因）

**这是本次基线里唯一的系统性红灯**，12 条全部由它引起（上表 1 到 10 加第四节两条孤立脚本）。

证据链（我逐条亲手核过）：

1. 壳硬要求这个依赖：`src/shared/deck-tools/shell.js:176` 取 `d.decideBackend`，`:177-180` 缺席时直接回三态 `unsupported`，文案是「判定出口这次没装上，我没往下做。请重试一次；如果仍然失败，请把这条提示原文报告给插件维护者。」
2. 这条硬要求是 2026-10-11 引入的：`git log -S "missing-decideBackend"` 命中提交 `24a4bf33`（提交信息「按单出口接通工具壳：显式四层交统一判定，整段包闸记账不变」）。
3. 生产装配**总是**传它：`src/host/platform/deckToolsAssembly.js:116` 里 `decideBackend: decideBackend || null`（静态引入 `../tracker/detection/backendDecision.js`，见该文件 `:26`）。所以线上不会踩这一支。
4. 红灯夹具**都没传**：`tests/verify-790-parent-edge.js:158-161` 的依赖对象里只有 `gate/registry/budget/estimate/costInputFrom/handleFor/backendCtx/now/log/invalidate`，没有 `decideBackend`；我逐个查了 14 条红灯脚本，全部 0 命中（其中第 11 到 14 条与 deck 无关，命中 0 不构成证据）。
5. 失败形态与第 1 条的返回完全一致：多条红灯的失败文案直接回显了那句「判定出口这次没装上」。
6. `tests/verify-992-readonly-labels.js:276` 的异常是下游崩塌：壳回了 unsupported，返回物没有 `data`，脚本直接读 `wr.data.repo.permissions.push` 就抛了。

**最小修法（两个方向，代价都写清，我不替你选）**

- 方向一：给每个夹具补一个「判定出口」桩。以 `tests/verify-790-parent-edge.js` 为例，在 `:158` 那个依赖对象里加一行：`decideBackend: async (cwd, o) => ({ backendId: 'stub-790', source: 'memory', ref: handle, multiHit: false, pending: false })`（它已经 `registry.bind(handle, 'stub-790')`，见 `:157`，所以桩直接回这个 id 与句柄即可）。代价：要改 12 个测试文件；好处是**只动测试、零生产行为变化**，且改完就与「生产总是传它」这件事对齐。风险是 12 个桩各写一份，将来装配口再变要改 12 处——可以抽一个共用夹具助手，但那要给 `tests/` 引入共享模块，属新结构，建议等重构搬完再抽。
- 方向二：改壳，让它允许缺席并退回直连选择（`registry.select`）。代价：这是**生产行为变化**，而且与 #1003 刻意收敛的「单出口」口径冲突（那条口径的意思正是：选后端只许经统一判定，不许壳自己挑一条路）；此外缺席时回退会把「装配错了」这件事藏起来，用户看到的是「后端没认出来」而不是「插件装错了」。好处是 12 个夹具一个字不改。**我不建议走这条**，但按你的要求把代价摆出来。

## 四、根因乙（2 条）与丙（1 条）：与 deck 无关，但同样红着

**根因乙（日志事件有表无落点）**：`verify-log-fields` 与 `verify-log-count` 都栽在同一件事上——`research/489-appendix.md` 里登记了事件 `choiceStore.hint.reject`（该文件 `:27`、`:130`、`:265`），而 `src/` 全树 0 命中（我 grep 过 `src/**/*.js` 与 `*.ts`）。也就是「表里有这个事件、代码里没人产生它」。这不是 deck 的账：`choiceStore` 属本机记忆那一摊（与设置/选择相关，近期有并发会话在改）。修法只有两条：要么在产生它的地方补埋点，要么从对照表里撤掉这一行——由那一摊的主人定。

**根因丙（客户端界面崩溃）**：`verify-669-switch-visible` 在 `:120` 等不到 `[data-repo-switch]` 这个元素（前面有 60 次 ×50 毫秒的等待循环，等满 3 秒仍未出现），于是 `querySelector` 回 `null`，紧接着调 `dispatchEvent` 抛错。这是界面渲染问题，落点在客户端（`src/client/**`），本次重构写范围之外；采集时刻正有并发会话在改 `src/client/kernel/store-prefs.js`、`views/ListTab.js`、`views/NoRepoCard.js` 等文件，我未能排除与那些改动的关系，故标「未深挖」。

**瞬态红（不建议计入基线）**：`verify-locale-completeness` 在批跑时红、单独重跑绿（退出码 0）。批跑时刻正是并发会话写 `src/client/kernel/store-prefs.js` 的时刻，报的正是该文件里「清单外新增 CJK 字符串 = 3」。这是「读到了写到一半的文件」，不是真债。

**两条孤立脚本（不在任何链里，但都是红的）**：`tests/verify-829-parent-reread.js`（`FAIL G3 写成功但读票失败 → 逐条 failed（实得 undefined）`）与 `tests/verify-971-markdown-parent.js`（`FAIL 扁平建图整体成功（实得 unsupported，边 []）`）。两条同属根因甲。它们**不在 `scripts.verify` 的 240 条里**——也就是说这两条即使一直红，也没有任何门禁会因此判红。建议在重构批次里决定：要么接进链，要么删掉，别让它们悬着。

## 五、给重构分批对照用的口径（建议）

1. **同一根因共 12 条**：上表第 1 到 10 条加两条孤立脚本。加上 `scripts/verify-chain.js`（它停在第一条 deck 红灯上，属连锁），共 **13 条红灯由这一个根因引起**。
2. **重构后应有的形态**：夹具不再各自手拼依赖对象，而是统一经装配口取值（这正是我们新架构里 `src/deck/registration/host-assemble.ts` 要做的事）。做到之后，这 13 条应当一次全绿——这也是重构「第一批可交付」的一个硬判据。
3. **与重构无关的红灯有 3 条**（日志事件表 2 条、客户端界面 1 条），另有 1 条瞬态。对照时把它们排除，别记到重构账上。
4. **测基线要在安静的树上测**：这次实测就撞到一条瞬态红（并发写文件）。建议每批落地的对照读数，先确认没有别的会话正在写 `src/`。
5. 生产装配里 `decideBackend: decideBackend || null` 这一句（`src/host/platform/deckToolsAssembly.js:116`）值得在重构时改成「缺了就明确报装配错」，因为今天「模块没加载到」与「没传依赖」在壳里长得一模一样，都回同一句「判定出口这次没装上」——排查时会绕路。
