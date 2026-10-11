# 一次到位重构必须同步改掉的全部文件清单（任务 C：改动影响面，2026-10-11）

本文件只统计引用旧 deck 路径（`src/host/tools/deck*.js`、`src/shared/deck-tools/`、`src/host/platform/deck*.js`）的地方。
旧路径搬家或改名后，这些地方同步改，否则全仓验证变红。凡是没有亲眼看到原文的，一律标“未核实”，不猜。

## 一、测试脚本：动态引用类（共 30 个文件，用动态引用加载旧路径模块）

动态引用指形如 `await imp('src/...')` 或 `await import(...)` 的写法，路径搬家后这些字符串必须换成新路径。

1. `tests/verify-1003-single-outlet.js`：加载壳模块验单出口，改壳的新路径。
2. `tests/verify-1003-unified-decision.js`：同上，改壳的新路径。
3. `tests/verify-723-gate-wiring.js`：加载规范模块读工具顺序常量，改规范模块的新路径（另有 1 处注释提及旧路径，顺手更新）。
4. `tests/verify-784-effortId.js`：按九文件路径表逐个加载验身份字段，改九个工具文件的新路径。
5. `tests/verify-790-parent-edge.js`：加载建票与补边两个模块，改两个工具文件的新路径。
6. `tests/verify-829-parent-reread.js`：加载补边模块，改该工具文件的新路径。
7. `tests/verify-895-bulk-deadline.js`：加载调用余量、续跑游标、建图、补边、快照五个模块，改五个文件的新路径。
8. `tests/verify-895-github-memo.js`：加载调用余量模块，改该文件的新路径。
9. `tests/verify-898-block-merge.js`：加载续跑游标、建图、补边三个模块，改三个文件的新路径。
10. `tests/verify-908-progress-replace.js`：加载改票模块与规范模块，改两个文件的新路径（另读改票文件文本做断言，见文本断言类）。
11. `tests/verify-927-gate-injection.js`：加载额度同步模块，改该文件的新路径。
12. `tests/verify-929-batch-cycle.js`：加载补边模块，改该工具文件的新路径。
13. `tests/verify-934-935-invariants.js`：加载壳与会话目录两个模块，改两个文件的新路径。
14. `tests/verify-947-workspace-file.js`：加载锚文件读写与壳两个模块，改两个文件的新路径。
15. `tests/verify-957-workspace-writer.js`：加载锚文件读写、装配点、壳三个模块，改三个文件的新路径。
16. `tests/verify-971-markdown-parent.js`：加载建图、快照、单票、补边四个模块，改四个工具文件的新路径。
17. `tests/verify-992-readonly-labels.js`：加载建票与看工作区两个模块，改两个工具文件的新路径。
18. `tests/verify-deck-exec-phone.js`：加载代执行、行模块、共享格、注册帮助四个模块，改四个文件的新路径（另读入口与代执行文件文本做断言，见文本断言类）。
19. `tests/verify-deck-no-hang.js`：加载六个工具模块与装配点，改工具文件与装配点的新路径。
20. `tests/verify-deck-parallel.js`：加载互斥锁与改票模块，改两个文件的新路径（另有 1 处注释提及旧路径，顺手更新）。
21. `tests/verify-deck-quota-sync.js`：加载额度同步、壳、共享格三个模块，改三个文件的新路径。
22. `tests/verify-deck-render-detail.js`：加载注册帮助模块，改该文件的新路径（另读该文件文本做断言，见文本断言类）。
23. `tests/verify-deck-repo-resolve.js`：加载壳模块，改壳的新路径。
24. `tests/verify-deck-thin-reads.js`：加载单票与快照两个模块，改两个工具文件的新路径。
25. `tests/verify-deck-tools.js`：加载规范与壳两个模块，改两个文件的新路径（另有静态目录扫描，见文本断言类）。
26. `tests/verify-deck-tools-agent-register.js`：加载注册帮助与行模块，改两个文件的新路径（另读注册帮助文本与九文件路径表，见文本断言类）。
27. `tests/verify-deck-tools-host-wiring.js`：以装配点路径为常量做接线断言，改装配点与九个工具文件的新路径。
28. `tests/verify-deck-tools-matrix.js`：含四个工具文件的路径表，加载方式未核实，按新路径更新该表。
29. `tests/verify-deck-tools-row-zero-dep.js`：加载行模块验零依赖，改行模块的新路径（另读行模块文本、比发布包散列，见文本断言类）。
30. `tests/verify-markdown-body-shapes.js`：用静态引用导入改票模块与规范模块，改两个文件的新路径。

## 二、测试脚本：文本断言类（共 13 条，涉及 10 个文件，其中 7 个同时在第一类）

文本断言指读文件文本、比散列、写死路径表、数文件个数的写法，路径搬家后这些字符串与计数必须同步。

1. `tests/verify-908-progress-replace.js`：读改票文件文本做正文形状断言，改读取路径（动态引用部分见第一类第 10 条）。
2. `tests/verify-build-artifacts.js`：注释里写死各批次新增文件数与总数（45→46→47→58→60→68→69），新树落定后重写计数与注释。
3. `tests/verify-contract-vocabulary.js`：以旧路径加符号名做键的词汇表，改键里的旧路径。
4. `tests/verify-deck-exec-phone.js`：读宿主入口与代执行文件文本断言动态引入写法，改读取路径与被断言的引入字符串。
5. `tests/verify-deck-render-detail.js`：读注册帮助文件文本，改读取路径。
6. `tests/verify-deck-tools.js`：静态扫描 `src/host/tools` 与 `src/shared/deck-tools` 两个目录，改扫描目录为新树目录。
7. `tests/verify-deck-tools-agent-register.js`：读注册帮助文件文本，改读取路径。
8. `tests/verify-deck-tools-host-wiring.js`：装配点常量、九文件清单、接线用例里的旧路径，改三处字符串。
9. `tests/verify-deck-tools-row-zero-dep.js`：读行模块文本、比行模块与发布包散列、发布清单导出映射，改三处路径。
10. `tests/verify-issue179-workspace-switch.js`：读壳文件文本，改读取路径。
11. `tests/verify-723-gate-wiring.js`：仅 1 处注释提及旧路径，顺手更新注释。
12. `tests/verify-deck-parallel.js`：仅 1 处注释提及旧路径，顺手更新注释。
13. `tests/verify-log-truncate.js`：仅 1 处注释提及旧路径（散列写法说明），顺手更新注释。

注：本类 13 条中有 9 条的文件同时出现在第一类，两类合计去重后为 34 个文件，与全仓搜索的去重文件数一致。

## 三、src 内部引用者（2026-10-12 回填：初版只列了 4 个文件，实测 9 个必改加 4 个只改注释）

上面两类只覆盖了测试脚本，本类是旧路径搬家后必须同步改引用的源文件。本节每一行的行号都是回填时重新打开源码数出来的，不是照抄别处。分三小类，因为改法不同。

### 三甲、不搬家、但引用会断的文件（7 个文件，共 21 条 import，必须改）

1. `src/host/platformChannel.js`（9 条，全为动态 import）：`:48` 与 `:84` 各引一次 `./tracker/registryCore.js`（主路与回落分支各一次）、`:53` 引 `./tracker/backends/github/index.js`、`:58` 引 `./tracker/backends/markdown/index.js`、`:74` 引 `./tracker/backends/gitlab/index.js`、`:184` 引 `./tracker/detection/workspaceStore.js`、`:283` 引 `./tracker/detection/detectionService.js`、`:318` 引 `./tracker/detection/explicitDetector.js`、`:341` 引 `./tracker/detection/backendDecision.js`。
   新路径：注册表两条改 `src/tracker/registry/core.ts`；三个房间改 `src/tracker/rooms/<房名>/index.ts`；四层识别改 `src/tracker/detection/*.ts`。
2. `src/host/index.js`（2 条）：`:137` 动态引 `./tracker/backends/github/client.js`（取 `TIMEOUT_MS` 交给检查链）、`:239` 动态引 `./platform/deckExec.js`（代执行电话）。
3. `src/host/refresh/wiring.js`（6 条）：`:25` 引 `../platform/deckToolsAssembly.js`、`:32` 引 `../../shared/deck-tools/agent-register.js`、`:33` 引 `../../shared/deck-tools/exec-cell.js`、`:34` 引 `../platform/deckSandbox.js`、`:35` 引 `../platform/deckQuotaSync.js`、`:43` 引 `../../shared/deck-tools/workspace-file.js`。
4. `src/host/issueDetail.js`（1 条）：`:4` 静态引 `./tracker/backends/github/normalize.js` 的 `pullStateOf`。
5. `src/host/remotePredicates.js`（1 条）：`:19` 动态引 `./tracker/backends/markdown/parse.js`。
6. `src/host/workspaceCwd.js`（1 条）：`:5` 静态引 `../shared/deck-tools/workspace-file.js` 的三件导出。
7. `src/host/detectChain.js`（1 条）：`:22` 动态引 `./tracker/detection/preflightScope.js`。

### 三乙、随目录一起搬家、同时要改对 deck 层引用（2 个文件，2 条）

8. `src/host/tracker/detection/explicitDetector.js:14`：引 `../../../shared/deck-tools/workspace-file.js`。
9. `src/host/tracker/detection/backendDecision.js:18`：整体引 `../../../shared/deck-tools/workspace-file.js`。

这两条要改两件事：目录随 `detection/` 搬进 `src/tracker/detection/`（到 `src/shared/` 的上跳层数由四层变三层），引的锚文件读写改到 `src/deck/shell/workspace-anchor.ts`。
更正说明：初版把这两个文件归进「不搬家」那一类，与设计文档里「`detection/` 搬进 `src/tracker/detection/`」不符，这里改正——它们是随目录搬、同时改引用。

### 三丙、只有注释提到旧路径（4 个文件 4 处，不改也能跑，但该顺手改文案，免得后人照抄）

10. `src/host/publishFlow.js:6`（注释里写 `src/host/tracker/backends/github/init-project.js`）。
11. `src/client/kernel/link.js:111`（注释里写 `src/host/tracker/backends/<id>/index.js`）。
12. `src/client/kernel/locale-labels.js:28`（注释里写 `src/host/tracker/backends/markdown/label-colors-ops.js` 的行号）。
13. `src/shared/tracker/initProjectErrorKinds.js:5`（注释里写 `src/host/tracker/backends/github/init-project.js`）。

另有 2 个文件（`src/host/refresh/wiring.js` 的 `:23` 与 `:308`、`src/host/detectChain.js` 的 `:17`）也在注释里提旧路径，但它们已经算在三甲里，不重复计数，改 import 时顺手把注释一起改。

### 假阳性说明（别误改）

`src/host/tracker/index.js:17` 与 `src/host/tracker/snapshot.js:26` 引的是 `src/shared/tracker/deck-derive.js`，那是面板派生的共享件，不在本次搬家范围（`src/shared/**` 除 `deck-tools/` 外都不动），看到「deck」字样不要顺手改。

### 为什么这一类证明「房间是面板与 deck 共用、归 `src/tracker/` 不归 `src/deck/`」

三甲这 7 个文件里，有四个与 deck 工具毫无关系却在用房间：`platformChannel.js` 引三房与注册表（宿主起步装配，面板要用）、`issueDetail.js` 引 GitHub 房的 `normalize`、`remotePredicates.js` 引 Markdown 房的 `parse`、`index.js:137` 引 GitHub 房的 `client` 取超时常量。也就是说房间至少有两个独立调用方——deck 工具链与面板/宿主装配。把房间搬进 `src/deck/` 下面，这四个文件就从「同层或邻近层引用」变成「向上引用另一个功能的私有目录」，与 3.1 归属原则（共用归共用家）直接冲突。

## 四、构建脚本（1 个文件）

1. `scripts/build.mjs`：未发现 deck 专属清单段落（搜“deck-tools”等无命中，未核实是否有别名写法），通用原样复制逻辑（约第 626 到 679 行，`src/host` 整树进 `package/lib`、`src/shared` 进 `package/shared`）自动覆盖新旧路径；重构需新增一步 deck 真源转译步骤，具体落点未核实。

## 五、发布包镜像（24 个自动镜像加 1 处手写映射）

构建时与源逐字节一致的副本，新树落定后构建自动产出新路径副本，旧路径副本随构建清理消失。手写映射不在自动同步范围内，单列一条。

1. `package/shared/deck-tools/` 下 10 个文件（`agent-register.js`、`call-scope.js`、`edges.js`、`exec-cell.js`、`key-lock.js`、`plan-store.js`、`plan.js`、`session-resolve.js`、`shell.js`、`workspace-file.js`）：构建自动同步，无需手改。
2. `package/lib/platform/` 下 5 个文件（`deckExec.js`、`deckQuotaSync.js`、`deckSandbox.js`、`deckToolsAssembly.js`、`deckToolsRow.js`）：构建自动同步，无需手改。
3. `package/lib/tools/` 下 9 个文件（九个工具同名文件）：构建自动同步，无需手改。
4. `package/package.json:21` 手写 exports 映射 `"./tools": "./lib/platform/deckToolsRow.js"`：行模块搬家后这一行必改，不改发包出口就断了。

## 六、门禁基线文件（共 2 个文件）

1. `tests/file-granularity-baseline.json`：含 2 条 deck 条目（`src/shared/deck-tools/agent-register.js` 记 438 行、`src/shared/deck-tools/shell.js` 记 373 行，均为超 350 行的豁免基线），新树落定后按新路径与新行数重建这两条。
2. `tests/same-layer-baseline.json`：含 deck 相关豁免条目（亲眼看到 `src/shared/deck-tools/workspace-file.js` 一条与其余含 deck 字样的行，精确条数未逐条核对，标未核实），新树落定后按新豁免重建。

## 七、文档里引用旧路径的地方（仅列标题，不改内容，共 10 个文件）

1. `docs/adr/20260924-refresh-budget-architecture.md`：标题列出，正文引用情况未核实。
2. `research/1010-deck-chain-dirs.md`：调用链目录表，历史记录保留，不改。
3. `research/489-appendix.md`：日志事件对照表，引用情况未核实。
4. `research/746-llm-and-direct-attr-base.md`：标题列出，正文引用情况未核实。
5. `research/930-md-deck-audit.md`：标题列出，正文引用情况未核实。
6. `research/992-scene-verification.md`：标题列出，正文引用情况未核实。
7. `research/998-q2-quota-cooldown.md`：标题列出，正文引用情况未核实。
8. `research/998-q3-read-timeout.md`：标题列出，正文引用情况未核实。
9. `research/deck-issue-get-detail-loss-report.md`：标题列出，正文引用情况未核实。
10. `research/deck-tools-language-1010.md`：语言归属调研，历史记录保留，不改。

## 总数

测试脚本 34 个（含两类，去重后），src 内部引用者 9 个（三甲 7 个不搬家的加三乙 2 个随目录搬家的，共 23 条 import），构建脚本 1 个，发布包镜像 24 个（自动生成）加手写映射 1 处，门禁基线 2 个，文档标题 10 个（仅列出不改）。**手改总数为 47 个文件**（旧口径 42 = 34 测试加 1 构建加 2 基线加 4 src 加 1 映射；本次回填把 src 那一类由 4 个更正为 9 个，故 42 加 5 得 47）。另 24 个镜像由构建自动处理，另有 4 个文件只有注释提到旧路径（三丙），不计入必改数。
