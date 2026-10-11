# 对抗式审查报告（2026-10-11，只挑毛病）

审查对象三份：`docs/adr/20261011-deck-ts-rewrite.md`（设计决议）、`research/1010-deck-contract-surface.md`（契约调用面）、`research/1010-deck-blast-radius.md`（改动影响面）。方法：证据行号逐条亲手开文件核对（壳全文 366 行、九个工具关键段、两房入口、注册表形状、契约类型、接线 300-364 行），遗漏用全仓 grep 独立扫一遍，不只看三份产出互相印证。下面只列毛病，通过项在每节末一句话带过。

## 一、契约调用面清单的问题（5 必修加 1 小）

- B-F1（错，必修）：表 E2 标题写操作清单“21 个名字”，实际 `src/host/tracker/contract.js:58-74` 数组共 19 项，文件自列名单也是 19 个（两处都数过）。“外加 2 个类型占位”没有出处。应改为 19，删掉占位说法。
- B-F2（错，必修）：表 E3 标题写类型名“24 个”，实际列出 23 个（数过）。应改为 23，或补上漏的那一个并给出出处行。
- B-F3（漏，必修）：表 C 自称“装配时传入的全部依赖”，C1 只列 22 个，漏了三个真实存在的 toolDeps 成员：`decideBackend`（`src/host/platform/deckToolsAssembly.js:116` 递入、`src/shared/deck-tools/shell.js:176-180` 消费）、`readDeclarationId`（装配层 `:91-115` 缺席现拼并递入、壳 `:188-192` 经判定参数透传）、`resolveTimeoutMs`（壳 `:81` 文档与 `:218` 消费，但接线从未传入，属“接受但未接线”，接口设计时必须定去留，不能默默丢）。
- B-F4（漏，必修）：表 B 按工具列引用时，漏了各工具对 `shared/refresh/` 的直接引用：`src/host/tools/deckMapPlanCreate.js:19` 引 `shared/refresh/idempotency.js` 的 `matchAnchor` 与 `isAnchorHit`（B6-4 只给了行号没给来源，接口作者会找不到真源）；`:22-23` 引 `budget` 与 `tool-cost`；`src/host/tools/deckMapLink.js:10` 引 `tool-cost`。B1-5 只在 deck_context 一处提了额度常量，其余工具同类引用全漏。
- B-F5（错，必修）：C2-2 把 `protectDoubleHit` 写成现行“双命中保护写口”。实情是它已退役：`tests/verify-957-workspace-writer.js:163-165` 定死“传了也忽略，多命中照旧诚实报错”，`shell.js` 全文零引用，装配层 `:116` 的传递是旧兼容残留的死接线。新接口不应继承它，应删。清单把它当现行依赖收录会误导接口设计。
- B-F6（小）：B9-2 的 chainNote 参数漏了 `reason: 'tool.deck-write'`（实见 `src/host/tools/deckIssueReport.js:121`）；B0-7 的返回物除三项外还有 `memo`、`budget`、`execOp`、`ok`（实见 `src/shared/deck-tools/call-scope.js:324-333`）。接口设计无影响，补全即可。
- 通过项：表 A 20 个调用点行号全部精确命中；B1、B2、B3、B4、B5、B6、B8、B9 证据行全部精确命中；D1、D2、D3 行号精确命中且“两项不在契约内”的说法与房内注释一致；E1 五项校验精确命中；E3 所列类型名全部存在；5 条“未核实”标得老实，无编造。

## 二、改动影响面清单的问题（2 必修）

- C-F1（漏，必修）：漏了整类“`src/` 内部引用者”——4 个不搬家但引用旧路径、搬家后必改 import 的文件：`src/host/index.js:239`（动态引代执行）、`src/host/workspaceCwd.js:5`、`src/host/tracker/detection/explicitDetector.js:14`、`src/host/tracker/detection/backendDecision.js:18`（三处引锚文件读写）。清单只覆盖了 tests、构建、发包、基线、文档五类，src 内部这一类整段缺失。应增一节。
- C-F2（漏，必修）：漏了 `package/package.json:21` 手写 exports 映射 `"./tools": "./lib/platform/deckToolsRow.js"`。§四只写了 24 个自动生成的镜像，行模块搬家后这一行手写映射必改，不改发包出口就断了。
- 通过项：tests/ 下引用旧路径的文件，我独立 grep 到的 34 个与清单完全一致，无遗漏无多收；§三“构建无 deck 专属段、通用复制自动覆盖”属实；§五两处基线条目与文件内容相符；§六历史文件保留不改的口径正确。

## 三、设计决议 ADR 的问题（1 条件）

- A-F1（条件）：§7 代价段须同步加上 C-F1 与 C-F2 两处（4 个 src 文件加 1 处手写映射），补上即齐。其余挑不出毛病：引用的五个最重脚本名全部存在且确在清单内；“约三十个”对 34 是约数，通过；“发包镜像同步改”对清单“构建自动同步”是同一件事的两面，不矛盾；与地图决议评论及两份调研互相引用一致。

## 四、越界检查（通过）

`git status` 里三份产出均为新增未跟踪文件，三个子任务各只写了自己的一个文件。已修改的 7 个文件与新增的设置 phones 两件，分属面板与其他会话的地盘，无一件是三个子任务的写入。纪律通过。

## 五、verdict

- 设计决议 ADR：条件通过（补 A-F1 一句）。
- 契约调用面清单：不通过（必修 B-F1 到 B-F5，小 B-F6）。
- 改动影响面清单：不通过（必修 C-F1、C-F2）。
- 共识：方向与结构无问题，全是可修复的确切条目。修完找审查复验补丁行即可，不用重审全文。
