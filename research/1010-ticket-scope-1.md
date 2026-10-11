# 票面核实（第 1 组）：790、829、898、971、895 与本次 deck 重构的关系

核实方法：用 `gh issue view <号> --json title,body,state,labels` 逐张读回正文（含诊断、实施、验收各段），再亲手打开票面点到的源码核对（不信票面自述），最后亲手跑每张票自己的回归门禁确认现状。判定用四档：**吞掉**（问题点落在重构范围内，重构后不复存在）／**部分**（一半在范围内）／**不归我们**（落点在范围外）／**已可关**（今天已不复存在或已修）。

重构范围（判定基准）：`src/deck/**`＋`src/tracker/contract/**`＋`src/tracker/registry/**`＋`src/tracker/rooms/github/**`＋`src/tracker/rooms/markdown/**`＋`src/tracker/detection/**`＋`src/host/refresh/**` 里被 deck 调到的行。范围外：`src/client/**`、提示词文案本身、`scripts/**` 残余脚本、GitLab 房代码、四个计算核。

---

## 一、#790 建票带父票与补边静默失败（判定：吞掉）

**票面事实**：2026-10-02 已实施（五源文件加一个专属门禁），未关闭，等真仓回放验收。

**我亲手核到的现状（都在重构范围内）**：

- `src/host/tracker/backends/github/graph.js:110-113`：挂父子主路已改成原生旗 `gh issue edit --parent`（按票号），裸接口回退用 `-F` 传数据库编号、删边同理（`:99`）。这正是票面根因「用票面号加小写 `-f` 必回 422」的修法。
- `src/host/tracker/backends/github/issues-write.js:134`：挂父失败记成票上的 `parentError`，不再空吞（票面根因 2 的修法）。
- 三个工具按「写后读回父是否等于目标」判落点，不再只看写回 ok（票面根因 4）。

**对应我们重构里的落点**：`src/tracker/rooms/github/graph.ts`、`issues-write.ts`；`src/deck/tools/map-link.ts`、`issue-create.ts`、`map-plan-create.ts`。

**重构后靠什么保证不再犯**：`tests/verify-790-parent-edge.js` 继续守（票面记 17 条）；再加契约层编译期约束——父边落点只能按读回结果判，写路径返回值形状由 `Tracker` 接口钉死。

**还剩什么**：票面第 1、2、4 条验收要求「在试验仓库用真后端跑一次」，今天未做。这一条不依赖重构，但重构后要再跑一次真仓冒烟才算数。

---

## 二、#829 deck_map_link 挂父子边在 GitHub 返回建成 0 条（判定：吞掉）

**票面事实**：2026-10-02 根因已证（`-f` 传票号必 422），源码已修，新门禁 7/7、790 门禁 17/17、矩阵 41/41；真机临时票直调验过；剩「宿主重启重载后经 deck 通道验一次」。

**我亲手核到的现状**：与 #790 同一处代码——`github/graph.js:110-113` 原生旗主路，`issues-write.js:134` 不再吞错。两张票修的是同一条路的两面（一张说父子边建不上、一张说回执与实查矛盾），今天只剩同一份代码。

**对应我们重构里的落点**：同 #790。

**重构后靠什么保证不再犯**：`tests/verify-829-parent-reread.js` 继续守（票面记 7 条）。

**还剩什么**：票面那句「宿主重启重载后经 deck 通道验一次」——这一条在重构完成后重载宿主时自然满足，不单独立项。

---

## 三、#898 整图建骨架与批量补边的阻塞边互相覆盖（判定：吞掉）

**票面事实**：2026-10-08 已实施，回归门禁 11 条全绿，待人工验收后关闭。当时结论写明这是三后端共有的调用层问题（后端是「整批替换」语义，调用层当「逐条追加」用）。

**我亲手核到的现状（重构范围内）**：

- `src/host/tools/deckMapPlanCreate.js:278-285`：阻塞边按写出票号分组后逐组写一次（`applyBlockEdges(t, repo, opCtx, from, g.targets, ...)`），不再每条各写一次；`parentOut`／`blockOut` 分组结果统一进明细。
- `src/host/tools/deckMapLink.js`：一次调用里同一票号先合并出完整集合再写一次（票面实施记录所述），我核到工具层引用 `applyBlockEdges`／`statusOfItems` 的写法与之一致。

**对应我们重构里的落点**：`src/deck/tools/map-plan-create.ts`、`map-link.ts`；`src/deck/shell/edge-landing.ts`（落点判定与逐项证据）。

**重构后靠什么保证不再犯**：`tests/verify-898-block-merge.js`（11 条，桩跟踪器同样是整批替换语义）。这类「语义口径」问题编译期管不了，只能靠这条门禁；迁移时它是必须跟着换路径并保持绿的一组。

**还剩什么**：票面「待人验收」那一步（合并与明细口径是否符合预期）——可以现在关，也可以随重构后的复验一起关。

---

## 四、#971 markdown 后端父边 9/9 失败（判定：吞掉）

**票面事实**：2026-10-09 走期望 A 修（读文件头注释加同目录改父成功），提交 5a79f44 在分支 `fix-971-markdown-parent`，加固提交 9d5dd3c 在本地主分支，待合入；后要按原计划标识在工作区重跑一次再关。

**我亲手核到的现状（重构范围内，且已在主线）**：

- `src/host/tracker/backends/markdown/parse.js:63-70` 的 `parentKeyFromFile`：只认文件头（标题之前、前十行内）的 `<!-- parentKey: ... -->`，正文里的同类注释不被劫持（注释里写明这是刻意收紧）。
- `src/host/tracker/backends/markdown/issues-patch.js:165-166`、`:221`：改父写文件头注释、比较在写队列内做。
- 加固提交 `9d5dd3c8` 确实在当前主线（`git log` 对 `parse.js` 可见），`tests/verify-971-markdown-parent.js` 在树里。分支 `fix-971-markdown-parent` 仍在远端，但其内容已被主线覆盖同一处。

**对应我们重构里的落点**：`src/tracker/rooms/markdown/parse.ts`、`issues-create.ts`、`issues-patch.ts`。

**重构后靠什么保证不再犯**：`tests/verify-971-markdown-parent.js`（票面记 14 条：原始 11 加加固 3）。

**还剩什么**：票面「合入后在 dsh-log 工作区用原计划标识重跑」——不依赖重构，随时可做。

---

## 五、#895 deck 工具批量写超时但副作用已落盘（判定：吞掉）

**票面事实**：2026-10-08 已实施，两组门禁 25 加 9 条全过，改动横跨调用外壳、续跑游标、建图、补边、读路径、去放大与取消真停。

**我亲手核到的现状（全部在重构范围内）**：

- `src/shared/deck-tools/call-scope.js` 与 `plan-store.js` 都在树里（前者管剩余额度自停与超时回执带核对指引，后者管续跑游标）。
- 两房去放大三件在树里：`github/roster.js`、`cycle-check.js`、`parent-repair.js`。
- `src/host/platformChannel.js` 的「调用方中止即杀进行中进程」在树里（这个文件今天还在旧位置，属迁移映射表里的引用者之一）。
- 两组门禁 `tests/verify-895-bulk-deadline.js`、`tests/verify-895-github-memo.js` 都在树里。

**对应我们重构里的落点**：`src/deck/shell/call-budget.ts`、`plan-cursor.ts`；`src/deck/tools/map-plan-create.ts`、`map-link.ts`、`map-snapshot.ts`、`issue-list.ts`；`src/tracker/rooms/github/roster.ts`、`cycle-check.ts`、`parent-repair.ts`。

**重构后靠什么保证不再犯**：这两组门禁（25 加 9 条）继续守；契约层的 `OpResult` 与三态形状把它要求的「超时回执带中间态」钉在类型里。

**还剩什么**：票面未做项（服务端排队轮询、改单次执行限时、重写远端调用层、全局硬顶）是当时明确的范围外，与重构无关。

---

## 六、横切发现：这五张票的门禁今天大面积是红的（重要，重构必须处理）

我亲手跑的现状（不是票面自述）：

| 门禁 | 今天的结果 |
| --- | --- |
| `tests/verify-790-parent-edge.js` | 红（D1、D3、D4、E1、E2、E3、F1 全红，形态是「实得 unsupported」） |
| `tests/verify-829-parent-reread.js` | 红 |
| `tests/verify-898-block-merge.js` | 红（11 条中 A1、A2、A3、B1、B2、B3、C2、C3 等红，「实写 0 次」） |
| `tests/verify-971-markdown-parent.js` | 红（「实得 unsupported，边 []」） |
| `tests/verify-895-bulk-deadline.js` | 红（25 条中多条「实得 unsupported」） |
| `tests/verify-895-github-memo.js` | **绿**（9 条全过） |

**根因（我核到的机制，不是猜测）**：`src/shared/deck-tools/shell.js:176-180` 现在硬要求装配方递入 `d.decideBackend`，缺席即回 `unsupported`（原因码 `backend-threw`，散列 `missing-decideBackend`）。这是 #1003「判定单出口」那一批改动带进来的要求。而上表这五个门禁的夹具**一个都没有传 `decideBackend`**（我对六个门禁文件逐个搜索，命中数全是 0），所以它们调工具时在选后端那一步就被挡回，表现为「实得 unsupported」「实写 0 次」。`verify-895-github-memo.js` 绿，是因为它测的是记忆与名册那一层，不走选后端。

**对本次重构的三个直接影响**：

1. **「吞掉」不能停在搬代码**。这五张票的修复代码确实都在树里、也都在我们的迁移范围内，但它们今天的保护网是破的。迁移时必须把这几条门禁的夹具补上 `decideBackend`（顺带换新路径），否则票面意义上的「已修」在重构后依然无门禁可守。
2. **这正是重构要吃下的活**。这些门禁都在迁移映射表要改路径的清单里，夹具修正与路径改写是同一次改动，不另立票。
3. **对新契约的启示**：`decideBackend` 是「缺了就整工具不可用」的硬依赖，写接口时它必须有明确位置（今天它由装配层递入、壳内判定），不能像 `resolveTimeoutMs` 那样「接受但从未接线」——那类字段在接口里要么接线要么删掉。

**给统筹者的三句话**：这五张票判定全是「吞掉」，不需要单独派人修；但它们各自的回归门禁今天因缺 `decideBackend` 而红，迁移那一批必须连夹具一起补，并以此作为这五张票真正关闭的条件；票面剩下的「真仓回放」「人工验收」「原工作区重跑」三件事不依赖重构，可随时做，也可以随重构后的复验一起收口。
