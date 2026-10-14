# 票 #1048 交付核对：判定「收全证据再合成，每步都能从日志读出为什么这么判」

这份笔记回答一个问题：票 #1048 已经关闭、评论里说做完了，照它票面的要求逐条对现在的代码，它真的做完了吗？

调查方法：只读。读代码、读 git 历史、读票面与评论，跑仓库既有的门禁脚本，再用临时脚本在 `D:\Temp` 下把 `src/tracker/detection/backendDecision.ts` 当黑盒探它的边界行为（脚本不进仓库）。本笔记是这次调查唯一写入的文件。

调查时的仓库状态：

- HEAD = `5e7c74aa`（写下 `src/host` 域类型检查配置缺口的调研笔记）。调查期间 HEAD 从 `f086a8e3`（本票落地提交）前移到 `5e7c74aa`，中间有别的会话提交的 `d255f2b7`、`2482604f`（#1147 跟踪器域转 TypeScript）。**本票相关的每个文件在 HEAD 上 `git status --porcelain` 都是空的**，即下面说「现在是」都是指已提交的状态。
- 同一个工作区里还有别的会话的未提交改动，不是我写的：调查开始时是几份未跟踪的 `research/*.md` 笔记；调查快结束时又多出两处已跟踪文件的改动（`git diff --stat` 显示 `research/489-appendix.md` 1 行、`tests/smoke-host-dispatch.test.js` 5 行）。下面引用附录的行号（58 / 60 / 204 / 243）是调查当时对着工作区文件核对过的，那 1 行改动没有移动这几行。
- 本票落地提交 `f086a8e3` 自己改了 15 个文件（`git show --stat f086a8e3`）：`package.json`、`research/489-appendix.md`、`src/host/detectChain.ts`、`src/host/workspaceLabelColors.js`、`src/tracker/detection/backendDecision.ts`、`src/tracker/detection/detectionService.ts`、`tests/gate-map.json`、`tests/tracker-contract/sections/labels.js`、`tests/verify-1003-single-outlet.js`、`tests/verify-730-cwd-consistent.js`、`tests/verify-963-log-order.js`、`tests/verify-detection-evidence.ts`、`tests/verify-github-label-colors.js`、`tests/verify-log-count.js`、`tests/verify-log-fields.js`。

## 一句话结论

票面可验收的要求一共十项（「要做的事」五项、文件清单一项、边界四句）：

- **确实做完 4 项**：明文顺序常量与装配顺序一致（A2）；内部三态字段与对外五字段不变（A5）；对外三样不变（C3）；相关门禁今天全绿（C4）。
- **只做了一半 5 项**：先收全证据再合成（A1，第三层证据条件跳过）；失败档位表（A3，缺一档且缺的那档文案是假话）；日志分层（A4，步骤线是真的，常驻线的三态字段与结果不同源）；正确输入下逐例一致（C1，有一处结论变化没被覆盖）；缺陷逐条修 + 回归断言（C2，46 项断言真实但有三处盲点）。
- **没做 1 项**：六件文件的注释与日志补齐（B1，实际只动了两件，四件一个字没动）。
- 另有三处「说的和做的不一样」横跨在上面几条里，单独列出来：常驻日志里的三态字段与结果里的三态不是同一条规则（在 A4 里）；旧解析器优先级的描述失实，导致一条门禁断言对旧代码也照样通过（在 C2 里）；无标题、只有正文关键词的声明文件今天会给出结论，而改动前不会，这条变化没进票面也没进门禁（在 C1 里）。

## 总表

| # | 票面要求 | 关键证据 | 判定 | 建议 |
|---|---|---|---|---|
| A1 | 先收集全部证据再合成结论 | `src/tracker/detection/backendDecision.ts:630` `const needAutodetect = !fileHit && !declHit;`、`:634` `else if (!needAutodetect)`；探测 P13 实测 `"各房有没有被问过": false`，步骤行 `autodetect/skipped/skipped-stronger-evidence` | 部分做（第三层证据是有条件跳过的，不是收全） | 另开票定取舍；不改设计就把票面与注释改成如实描述 |
| A2 | 多后端同时认领按明文顺序 GitHub > Markdown > GitLab 裁剪，门禁钉住与装配顺序一致 | `backendDecision.ts:212` `export const MULTI_CLAIM_ORDER: readonly string[] = ['github', 'markdown', 'gitlab'];`；`src/host/platformChannel.js:59/64/80` 的 import 与 `:61/:77/:82` 的 `reg.register` 都是 github → markdown → gitlab；门禁 `tests/verify-detection-evidence.ts:225-231` 按文本位置断言 | 已做 | 维持；另补 P19 那个兜底缺口 |
| A3 | 失败档位表每档写清看了哪些地方、缺什么、补什么 | `decisionGapOf`（`backendDecision.ts:336` 起）共 8 档；探测 P17 `matches-unknown-backend: null`、`autodetect-unknown-backend: null`；探测 P8 返回 `gap.id = "no-claim"`、文案「三处都没认领…各房自己的匹配都没说是谁」 | 部分做（缺「各房认了个没装上的后端」这一档，落回的那档文案是假话） | 补做 |
| A4 | 日志分层：平时一条结论，开调试开关记全过程 | `backendDecision.ts:417`（按需 `detection.step`）、`:423-433`（常驻 `detection.detect`）；`:430` 的三态由 winner 推导，而结果的三态在 `:719-728` 由另一套条件算；探测 P11 四个 undetermined 场景日志全写 `no-backend`；`src/host/sessionLifecycle.js:169` 还在发同名事件、只有旧五键 | 部分做（结论线在，但三态字段与结果不同源、会说反话；同名事件两个形状） | 补做 |
| A5 | 内部三态分开，对外五个字段不变 | `DecisionState`（`backendDecision.ts:69`）、结果里的 `state` / `missing` / `gap`（`:120`、`:719-745`）；`selectionFromOutlet`（`:241`）与改动前逐字相同；`node --import ./scripts/ts-hook.mjs tests/verify-1003-single-outlet.js` → `全部通过（27 条）`，exit 0 | 已做 | 维持 |
| B1 | 本票文件清单六件的注释与日志补齐到仓库标准 | `git show --stat f086a8e3` 只含 `backendDecision.ts`、`detectionService.ts` 两件；六件里五件的文件头（第 2 行）今天仍写迁移前的 `.js` 名（`git show f086a8e3:<文件>` 与现在逐字相同）；`git grep -n "detection\.detect\|detection\.step" -- src` 只出 `backendDecision.ts:417/423` 与 `sessionLifecycle.js:169` | 未做（四件一个字没动，注释与日志都没补） | 补做 |
| C1 | 边界①：正确输入下结论逐例一致 | 本票没有任何新旧行为对照；探测 P20 实测「声明文件只有正文关键词、没有标题行」今天会给出结论（`gitlab` / `github`），而改动前出口那套只看标题、这一情形不算数 | 部分做（有一处真实的结论变化没被覆盖） | 补做对照，或在票面/门禁里登记这条变化 |
| C2 | 边界②：缺陷逐条修 + 回归断言 | `tests/verify-detection-evidence.ts` 存在且 `共 46 项，全部通过`（`ok(` 调用数也是 46）；但三处盲点：无一条断言比较日志三态与结果三态、C 节断言对旧解析器的真实差异是空转、D 节只按文本位置查 import 语句 | 部分做 | 补做 |
| C3 | 边界③：对外三样不变 | `selectionFromOutlet` 与 `git show f086a8e3^:src/tracker/detection/backendDecision.ts` 里那版逐字相同；`verify-1003-single-outlet.js` 27 条全绿；`verify-detection-cascade.js` → `34 passed, 0 failed` / `DETECTION CASCADE OK` | 已做 | 维持 |
| C4 | 边界④：相关门禁全绿、不新增红点 | 在 HEAD `5e7c74aa` 上重跑：`verify-detection-evidence.ts` `共 46 项，全部通过`；`verify-1003-single-outlet.js` `全部通过（27 条）`；`verify-detection-cascade.js` `34 passed, 0 failed`；`verify-log-count.js` `全部通过 — 计数门禁生效（115 项断言）`；`verify-log-fields.js` `全部通过 — 字段白名单门禁生效（196 项断言）`；`verify-963-log-order.js` `共 23 项，全部通过`；`verify-gate-map.js` `全部通过（85 条断言）`。全部 exit 0 | 已做（今天绿） | 维持；但落地当天并不全绿，见下面 C4 一节 |

## 逐条详述

### A1 三层证据是「两层收全 + 第三层有条件跳过」

代码事实（看分支，不看注释）：

- `backendDecision.ts:630`：`const needAutodetect = !fileHit && !declHit;`
- `:634`：`} else if (!needAutodetect) {` —— 前两层任意一层命中，就不去问「各房自己认领」这一层，只在步骤轨迹里记一行 `autodetect/skipped/skipped-stronger-evidence`。

这是真的「没有问」，不是「问了没结果」。探测 P13 用一个会抛错的认领函数当探针：如果出口问过各房，那个函数一定会抛错、结果里会出现 `autodetect/error`。实测（输入是工作区文件写 markdown、声明文件写 github、两后端都已装，认领函数 `async () => { throw new Error('boom') }`）：

```
### P13 前两层都命中时，各房认领到底问没问（用一个会抛错的 select 当探针）
{
 "各房有没有被问过": false,
 "result": {
  "backendId": "markdown", "source": "explicit", "origin": "user-file", "canWrite": true, "reason": "",
  "ref": null, "multiHit": "(absent)", "pending": "(absent)", "state": "decided", "missing": "", "gap": null,
  "conflict": { "kind": "user-vs-declaration", "ids": ["markdown", "github"], "used": "markdown" },
  "steps": ["workspace-file/hit/file-hit/markdown/1", "declaration/hit/declaration-title-github/github/0", "autodetect/skipped/skipped-stronger-evidence//0"]
 },
 "log": [ ... "detection.step[debug] {\"step\":\"autodetect\",\"outcome\":\"skipped\",\"backendId\":\"\",\"ms\":0,\"reason\":\"skipped-stronger-evidence\"}", "detection.detect[info] {...,\"state\":\"decided\",...}" ]
}
```

票面写的是「先收集全部证据再合成结论」。现在的实现是「先看两层，够用就不问第三层」。这两件事在后果上不一样，最要紧的后果是**矛盾检测的覆盖面**：矛盾只在「工作区文件」和「声明文件」之间算，各房自己认领的内容永远进不了矛盾比较，因为大多数时候它根本没被问过。

第二个后果在探测 P4 里看得最清楚——工作区文件写的是注册表不认识的后端名 `gitlab`，声明文件写 `github`（已装）：出口直接按声明文件给结论，工作区文件那一层报的 `file-backend-unknown/gitlab` 既没进 `conflict`、也没进 `missing`：

```
### P4 工作区文件写的是注册表不认识的后端名（gitlab），声明文件写 github（已装）
输入：fakeFs({ 'docs/agents/workspace.json': {"version":2,"backendId":"gitlab","pickedAt":1,"source":"user"}, 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' })
      decideBackend(CWD, { fs, registry: 只装 github, skipAutodetect: true, logCtx })
{
 "result": { "backendId": "github", "source": "explicit", "origin": "declaration", "canWrite": false,
  "reason": "needs-generate", "ref": null, "multiHit": "(absent)", "pending": "(absent)",
  "state": "decided", "missing": "", "gap": null, "conflict": null,
  "steps": ["workspace-file/unknown-backend/file-backend-unknown/gitlab/5", "declaration/hit/declaration-title-github/github/0", "autodetect/skipped/skipped-by-caller//0"] },
 "log": [ "detection.detect[info] {\"cwdHash\":\"99950b46\",\"explicit\":true,\"matches\":0,\"pending\":false,\"selection\":\"github\",\"origin\":\"declaration\",\"state\":\"decided\",\"latencyMs\":5,\"conflict\":\"\"}" ]
}
```

再说一次公平的话：这一步到底该不该问，是设计取舍（各房认领是一次跨模块调用，问了就多一次开销），我没有证据说现在的取舍是错的；而且新门禁的第 46 项附近有一条断言**主动把这个取舍钉住了**——`tests/verify-detection-evidence.ts:281-282`：

```
ok(!!auto && auto.fields.outcome === 'skipped' && auto.fields.reason === 'skipped-stronger-evidence',
  '更确凿的证据在先时不问各房，并记下「跳过是因为前面已经有结论」', ...)
```

也就是说「前两层够用就不问第三层」是**有意为之、而且有门禁保护**的。我要指出的是另一件事：**票面第一句写的是「先收集全部证据再合成结论」，而票面、规格与门禁都没写清「第三层只在没有结论时才问」这条约定**；后果是「矛盾不静默吞」的覆盖面被悄悄收窄到跨层矛盾（各房自己认领的内容大多数时候根本没被读过）。这一条要么回规格票 #1132 把约定写下来，要么把票面与文件头注释改成如实描述。

### A2 明文顺序这一条是真做了

- 常量：`backendDecision.ts:212` `export const MULTI_CLAIM_ORDER: readonly string[] = ['github', 'markdown', 'gitlab'];`，并且从模块默认导出（`:761`）与门禁都能读到。
- 裁剪真的按它排：`orderClaims`（`:354-363`）把名单分成「三个认得的按常量序号排」与「不认得的排在后面、保持原相对次序」；`:699-702` 在返回之前调用它并记一行 `claim-order/hit/plain-order/<选中的>`。探测 P14 输入 `multiHit: ['gitlab', 'markdown']`，返回 `"multiHit": ["markdown", "gitlab"]`、`"backendId": "markdown"`，确实按常量重排了。
- 装配顺序与常量确实一致：`src/host/platformChannel.js:59/64/80` 依次 import github → markdown → gitlab，`:61/:77/:82` 也是按这个次序 `reg.register(...)`。门禁 `tests/verify-detection-evidence.ts:225-231` 读这个文件的文本、断言三个 import 字符串的位置严格递增：`ok(atGh > 0 && atMd > atGh && atGl > atMd, '装配处注册顺序仍是 github → markdown → gitlab（与明文裁剪顺序一致）', ...)`，实际通过。
- 这条门禁是**浅的**（只查 import 语句在文件里的先后），但就它声称要防的事（有人重排装配）来说是有效的，不必改。要说局限：它防不住「注册调用顺序与 import 顺序被改成不一致」这种情况——今天两者一致，是巧合地由代码写法维持的。

唯一的真缺口是兜底：如果裁剪之后的名单里没有一个已注册的后端，出口会把没注册的那个名字当结论返回。探测 P19（注册表只装 gitlab、各房报 `backendId: 'gitlab'` 且 `multiHit: ['github', 'gitlab']`）：

```
### P19 裁剪出的是没装上的后端名
输入：registry: reg(['gitlab'], async () => ({ backendId: 'gitlab', source: 'matches', multiHit: ['github', 'gitlab'] }))
{"backendId":"github","source":"matches","origin":"autodetect","state":"decided","gap":null,
 "steps":["workspace-file/miss","declaration/miss","autodetect/hit","claim-order/hit"]}
```

返回了一个注册表里没有的 `github`。在生产里这条大概走不到（注册表给出的名单本身就来自已注册的房间），所以这是兜底缺口而不是线上故障；但它和「只返回已注册后端」这条约定是冲突的，值得补一行判断。

### A3 失败档位表缺一档，缺的那一档还会说假话

档位表本身是真的：`decisionGapOf`（`backendDecision.ts:336` 起）按 id 给「看了哪些地方（`looked`）、缺什么（`missing`）、补什么就能定（`fix`）、一句人话（`text`）」，结果里的 `gap` 就是它。

缺的一档：探测 P17 直接查表——

```
### P17 档位表有没有覆盖「各房认了个没装上的后端」这一档
{ "matches-unknown-backend": null, "autodetect-unknown-backend": null,
  "declaration-unreadable": { "id": "declaration-unreadable", "looked": ["声明文件 docs/agents/issue-tracker.md"], "missing": "文件在，但读不出来",
    "fix": "把声明文件补回可读的标题行（例如 `# Issue tracker: GitHub`）",
    "text": "声明文件读不出来：把 docs/agents/issue-tracker.md 补回一行写明后端的标题，就能定下来。", "detail": "x" },
  "MULTI_CLAIM_ORDER": ["github","markdown","gitlab"] }
```

两个可能的 id 都查不到（`null`）。于是探测 P8 那种情形（工作区文件与声明文件都没有，各房认领明确说了 `gitlab`，只是这台机器没装 gitlab）落回 `no-claim` 档，对外说：

```
### P8 各房认领认了个没装上的后端（gitlab），声明文件与工作区文件都没有
输入：registry: reg(['github'], async () => ({ backendId: 'gitlab', source: 'matches' }))
{
 "result": { "backendId": null, "source": "fallback", "origin": "none", "canWrite": false, "reason": "no-backend",
  "ref": null, "multiHit": "(absent)", "pending": "(absent)", "state": "undetermined",
  "missing": "三处都没有认领",
  "gap": { "id": "no-claim", "missing": "三处都没有认领",
    "text": "三处都没认领：工作区文件、声明文件、各房自己的匹配都没说是谁。在面板上选定一个后端就能定下来。" },
  "conflict": null,
  "steps": ["workspace-file/miss/file-missing//0", "declaration/miss/declaration-missing//0", "autodetect/unknown-backend/matches-backend-unknown/gitlab/0"] },
 "log": [ ..., "detection.step[debug] {\"step\":\"autodetect\",\"outcome\":\"unknown-backend\",\"backendId\":\"gitlab\",\"ms\":0,\"reason\":\"matches-backend-unknown\"}", "detection.detect[info] {...,\"state\":\"no-backend\",...}" ]
}
```

步骤轨迹整整说了实话（`unknown-backend`、后端名 `gitlab`），可给人看的那句 `missing` / `text` 是「三处都没认领…各房自己的匹配都没说是谁」——**各房说了，说的是一个没装上的后端**。上游票 #1047 的更正评论把「读失败被当成没有」列成三态要解决的第一件事，P8 是同一类错，只是发生在第三层。

另外，声明文件读失败那一档在真实文件系统路径上不可达：读写失败如果不是「文件不存在」，`readDeclarationLayer` 把异常吞掉、当成「没有这份声明文件」（探测 P10，工作区文件与声明文件同时抛 `EACCES`）：

```
### P10 声明文件存在、但读的时候抛的不是「没有这份文件」
输入：fakeFs({ 'docs/agents/issue-tracker.md': { throwError: EACCES } })
{
 "reads": ["docs/agents/workspace.yaml", "docs/agents/workspace.json", "docs/agents/issue-tracker.md"],
 "result": { "backendId": null, "state": "no-backend", "missing": "三处都没有认领", "gap": { "id": "no-claim", ... },
  "steps": ["workspace-file/miss/file-missing//0", "declaration/miss/declaration-missing//0", "autodetect/miss/matches-no-claim//0"] },
 "log": [ "detection.detect[info] {...,\"state\":\"no-backend\",...}" ]
}
```

注意 `steps` 里两行都写着 `file-missing` / `declaration-missing`：**读不出来被记成了「没有这份文件」**，连步骤轨迹都在骗人。对照 P9b（文件读到了、内容解析不出来）才给 `workspace-file/unreadable/file-unreadable` 并落 `file-unreadable` 档。本票新增的 `unreadable` 这一档，只有「读到了但格式不对」走得到。

### A4 日志分层：步骤线是真的，结论线的三态字段不可信

- 按需步骤线（`detection.step`）是真的：`backendDecision.ts:412-418` 一处发射，步骤对象在这一处建，字段 `step / outcome / backendId / ms / reason` 与附录 #98 登记的五键逐字一致。探测里每条步骤线都能读出「看了哪一层、这一层什么结论、为什么、花了多久」。
- 常驻结论线（`detection.detect`）也在出口发（`:423-433`），九键齐全，与附录 #16 增补后的九键一致。
- **但 `state` 这一个字段是另算的**：`:430` 是 `state: winner.backendId ? 'decided' : (winner.pending ? 'undetermined' : 'no-backend')`——只看「有没有选中」与「有没有待定」；而返回结果的 `state` 在 `:719-728` 由 `pendingOnly` / `fileCleanMiss` / `declCleanMiss` / `nothingThere` 一组条件算出。两处不同源，于是出现了「日志说确实没有、结果说判不出来」：

```
### P11 结论线的 state 与返回结果的 state 对着看
[
 { "name": "工作区文件解析失败",     "resultState": "undetermined", "resultGap": "file-unreadable",   "logState": "no-backend" },
 { "name": "一层都没接上",           "resultState": "undetermined", "resultGap": "layer-unavailable", "logState": "no-backend" },
 { "name": "各房认了个没装的后端",   "resultState": "undetermined", "resultGap": "no-claim",          "logState": "no-backend", "logSelection": "" },
 { "name": "认领抛错",               "resultState": "undetermined", "resultGap": "autodetect-error",  "logState": "no-backend" }
]
```

四个「判不出来」的场景，日志全写 `no-backend`（确实没有后端）。还有一例更早的：根目录为空时（探测 P1，`decideBackend('', {...})`）结果 `state: "undetermined"`、`gap.id: "workspace-not-ready"`，常驻日志仍写 `"state":"no-backend"`。

附录 `research/489-appendix.md:58` 给这四键写的理由是「不开调试开关时，光看原来的五键分不出『确实没有后端』与『有一层没看成/没问成』」。**照现在的代码，这四键正是分不出的**——第 6 条对抗式探测里，这是最容易被当成「已经解决」的一处。

同一个事件今天还有第二个形状：`src/host/sessionLifecycle.js:169` 仍然自己发 `detection.detect`，但只有旧五键（`cwdHash / explicit / matches / pending / selection`），没有 `origin / state / latencyMs / conflict`：

```
src/host/sessionLifecycle.js:169:
try { if (logCtx) logCtx.fire('info', 'detection.detect', { cwdHash: hash8(cwd), explicit: !!(...), matches: ..., pending: !!(...), selection: String((sel && sel.backendId) || '') }) } catch (eL) {}
```

字段门禁不拦它（五键都在白名单里），附录也没登记这个形状。票面把它记作「已知重叠、留作后续」，但它比「重复一条」更麻烦：**同一个事件名，两条线字段不一样**，读日志的人按 `state` 取值时会读到 `undefined`。

### A5 三态与对外五字段

三态在类型层与返回里都在：`export type DecisionState = 'decided' | 'undetermined' | 'no-backend'`（`:69`），结果对象带 `state` / `missing` / `gap`。对外五个字段确实没动：`selectionFromOutlet`（`:241`）与改动前那版逐字相同，`node --import ./scripts/ts-hook.mjs tests/verify-1003-single-outlet.js` 输出 `全部通过（27 条）`，exit 0。这一条我判「已做」；「三态说得对不对」记在 A3、A4 两条里。

### B1 六件文件清单：只有两件被本票动过

票面列的六件是 `backendDecision.ts`、`detectionService.ts`、`explicitDetector.ts`、`parseIssueTracker.ts`、`preflightScope.ts`、`workspaceStore.ts`，要求「注释与日志补齐到仓库标准」。`git show --stat f086a8e3` 显示本票只改了前两件；后四件在本票里一个字都没动（它们最后一次被改是后来的 `2482604f`，那是 #1147 的 TypeScript 能力断言那件事，不是本票）。

六件的文件头（第 1 行是 `/**`，文件名写在第 2 行）：

| 文件 | 第 2 行今天写的 | 本票动过？ |
|---|---|---|
| `src/tracker/detection/backendDecision.ts` | `* tracker/detection/backendDecision.ts —— 后端判定的唯一真源（#1003 契约落地一期，#1048 收全证据二期）` | 动过（689 行改动） |
| `src/tracker/detection/detectionService.ts` | `* tracker/detection/detectionService.js — 探测级联编排（~80 行二联骨架 + 增量预留）` | 动过（61 行改动），但文件头没改 |
| `src/tracker/detection/explicitDetector.ts` | `* tracker/detection/explicitDetector.js — 显式分支（~40 行）` | 没动 |
| `src/tracker/detection/parseIssueTracker.ts` | `* tracker/detection/parseIssueTracker.js — 主锚结构化解析（~60 行骨架）` | 没动 |
| `src/tracker/detection/preflightScope.ts` | `* tracker/detection/preflightScope.js — 一次评估里的环境预检复用（#709 · T5 补）` | 没动 |
| `src/tracker/detection/workspaceStore.ts` | `* tracker/detection/workspaceStore.js — per-workspace 状态隔离（~80 行）` | 没动 |

这五行今天与 `f086a8e3` 当时逐字相同（`git show f086a8e3:<文件>` 对过），也就是说连后来那次 TypeScript 迁移也没顺手改掉。

日志侧，全仓只有三个发射点（`git grep -n "detection\.detect\|detection\.step" -- src`）：`backendDecision.ts:417`、`backendDecision.ts:423`、`sessionLifecycle.js:169`；`detectionService.ts:262-263` 只是把 `logCtx` 递给出口的注释。也就是说 `explicitDetector.ts`、`parseIssueTracker.ts`、`preflightScope.ts`、`workspaceStore.ts` 这四件在判定链上**一行日志都不留**——票面要求里的「日志补齐到仓库标准」对它们是零。

结论：B1 这一条是**未做**，不是「做了一半」。上一版交付把其中四件记成「留作后续」，并且理由写成「这四件带着别的票的未提交改动」；对照今天的工作区（本票相关文件 `git status --porcelain` 全空）这条理由已不成立，而且它把 `detectionService.ts` 漏掉了——那一件恰恰是本票改过的。

### C1 有一处真实的结论变化没被覆盖

「正确输入下结论逐例一致」是本票边界的第一句。本票没有做新旧行为对照（既有的三条门禁只能证明既有断言仍绿），而改动确实带来了一处方向性的变化：**声明文件里只有正文关键词、没有标题行**。探测 P20：

```
### P20 声明文件只有正文关键词、没有标题行（低置信兜底）
输入：fakeFs({ 'docs/agents/issue-tracker.md': <下面三种正文之一> })，registry: reg(['github','gitlab'])，skipAutodetect: true
{"声明文件正文":"这个仓库的 issue 都放在 gitlab 上。","判定":{"backendId":"gitlab","source":"explicit","origin":"declaration","state":"decided","gap":null,"steps":["workspace-file/miss","declaration/hit","autodetect/skipped"]}}
{"声明文件正文":"我们用的是 github issues。","判定":{"backendId":"github","source":"explicit","origin":"declaration","state":"decided","gap":null,"steps":["workspace-file/miss","declaration/hit","autodetect/skipped"]}}
{"声明文件正文":"随便写点什么","判定":{"backendId":null,"source":"fallback","origin":"none","state":"undetermined","gap":"autodetect-unavailable","steps":["workspace-file/miss","declaration/miss","autodetect/skipped"]}}
```

改动前，出口自带那套只看标题（`titleOnlyDeclarationId`），这两种正文本不会给出结论；现在给了，而且 `source` 记成 `explicit`（与标题命中同档）。这是本票引入的行为变化，票面没提、门禁没钉、`research/489-appendix.md` 也没记。它可能是想要的（`parseIssueTracker` 一直有这条低置信兜底），但按票面边界①，它需要一条逐例对照或一句登记。

### C2 新增门禁：46 项断言是真的，但有三处盲点

先给可信的部分（`node --import ./scripts/ts-hook.mjs tests/verify-detection-evidence.ts`，exit 0）：

```
共 46 项，全部通过
```

`Select-String -Path tests/verify-detection-evidence.ts -Pattern '^\s+ok\('` 数出来 46 处，与打印的条数一致，没有把一项拆成几项凑数。门禁按七个分节（`title(...)`）组织：A 三层顺序与来源、B 内部三态说实话、C 一次读取一份结论、D 多命中按明文顺序裁剪、E 证据矛盾带出来、F 日志分层、G 对外五个字段一个不动。断言里也有真的分支覆盖：A 节 5 项真读两层（工作区文件与声明文件都被读到，看 `reads` 记录）、B 节逐项覆盖失败档位的人话与三态（`:138-176`）、D 节覆盖「裁剪出名单外的名字」（`:210`）、G 节覆盖对外五字段（`:295` 起）。

三处盲点（这是我要否掉「足够对抗」这个说法的地方）：

1. **没有一条断言比较「结论线的三态」与「结果的三态」。** 46 项断言里碰过结论线字段的只有三处：`:242-243` 查 `conflict`、`:262` 查 `c.fields.state === 'decided'`、`:264` 查 `cwdHash` 只有 8 位、不含路径原文。`state` 那一处是**正面场景**（结论是 `decided` 时日志也写 `decided`，这一条无论日志用哪套规则算都会通过）；`undetermined` 与 `no-backend` 的场景里，`:143-151`、`:160-176` 查的都是**返回结果**的 `state`，没有一处回头去看同一趟日志写了什么。也就是说 A4 里那个「日志说 no-backend、结果说 undetermined」的错，**新门禁一条都拦不住**。这是本票最容易出错的地方，恰好没钉。
2. **C 节那条「多行标题时与 `parseIssueTracker` 同一答案」对旧那套解析器是空转的。** 断言原文（`tests/verify-detection-evidence.ts:199-201` 一带）：

   ```
   ok(JSON.stringify(bd.parseIssueTracker(multi).explicitBackendId) === JSON.stringify(<出口给的 id>), '多行标题时与 parseIssueTracker 同一答案（GitLab > Markdown > GitHub，出口那套 Markdown 优先的已删）', ...)
   ```

   旧出口那套解析器是 `git show f086a8e3^:src/tracker/detection/backendDecision.ts` 里的 `titleOnlyDeclarationId`，它的顺序是 `gitlab` → `markdown` → `github`（第 32-34 行），**与 `parseIssueTracker` 完全相同**。所以「多行标题都给出 gitlab」这条断言在改动前后都会通过，它证明不了「两套解析器已经合成一套」。两套真正会分岔的地方是「没有标题、只有正文关键词」——而那一支没有被断言（见 C1，行为确实变了，门禁没响）。顺带说：`src/tracker/detection/backendDecision.ts:30` 的文件头注释写着「出口自带那套只看标题、顺序是 Markdown > GitHub > GitLab」，这句话与旧代码不符；同样的说法还出现在本票的提交信息与票面评论里。
3. **D 节只按文本位置查 import 语句**（`:225-231`），不查 `reg.register` 的调用顺序（`platformChannel.js:61/77/82`）。今天两者一致，所以门禁是绿的；但「装配顺序」真正的含义是注册顺序，门禁钉的是它的一个侧面。

另外一处小口径问题：`ok()` 辅助函数的第三个参数（证据串）被丢掉了（`tests/verify-detection-evidence.ts:47-49` 定义成 `function ok(cond, name)`）。全文 46 处 `ok(...)` 调用里有 36 处传了第三个参数（用括号配对扫出来的：`ok( calls=46`，其中 36 处带证据串、10 处只有两个参数），这 36 处证据串在失败时一个字都打不出来。仓库里别的门禁是 `must(cond, inv, det)` 的写法、会把证据打出来，这里与仓库既有约定不一致。这不是缺陷，但会让人在真红的时候多花时间。

### C3 对外三样不变

`selectionFromOutlet`（`backendDecision.ts:241`）与改动前逐字相同；`tests/verify-1003-single-outlet.js` 27 条全绿；`tests/verify-detection-cascade.js` 输出 `verify-detection-cascade: 34 passed, 0 failed` 与 `DETECTION CASCADE OK`，exit 0。这一条已做。

### C4 门禁全绿这一条：今天成立，落地当天不成立

今天（HEAD `5e7c74aa`）我重跑了与本票相关的七道门禁，全部 exit 0：

```
tests/verify-detection-evidence.ts => exit=0    共 46 项，全部通过
tests/verify-1003-single-outlet.js => exit=0    全部通过（27 条）
tests/verify-detection-cascade.js  => exit=0    34 passed, 0 failed / DETECTION CASCADE OK
tests/verify-log-count.js          => exit=0    全部通过 — 计数门禁生效（115 项断言）
tests/verify-log-fields.js         => exit=0    全部通过 — 字段白名单门禁生效（196 项断言）
tests/verify-963-log-order.js      => exit=0    共 23 项，全部通过
tests/verify-gate-map.js           => exit=0    全部通过（85 条断言）
```

两处应当修正的说法：

- 收尾评论写「已登记进 verify 链（第 240 步）」。实测 `package.json` 的 `scripts.verify` 共 240 步，`tests/verify-detection-evidence.ts` 在**第 227 步**。写成「第 240 步」会把「链有 240 步」读成「自己是第 240 步」。
- 边界④说「相关门禁全绿」。附录 `research/489-appendix.md:58` 自己记着一笔：本票落地时 `tests/verify-log-fields.js` 是红的，因为 `detection.cache.hit`（#1131 的事件）还没登记，而本票明确不代它登记。今天它绿了，是因为 #1131 后来补登记了（`489-appendix.md:60`）。所以「不新增红点」做到了，「全绿」在当时不成立——这笔账写在附录里，没有写进票面边界。

## 第 6 条：对抗式探测的完整输入输出

脚本在仓库外：`D:\Temp\probe1048.mjs`（P1–P18）与 `D:\Temp\probe1048b.mjs`（P19–P21）。跑法：

```
cd D:\Temp
node --import file:///D:/dsh-plugin/dsh-mattpocock-skills-deck/scripts/ts-hook.mjs probe1048.mjs
node --import file:///D:/dsh-plugin/dsh-mattpocock-skills-deck/scripts/ts-hook.mjs probe1048b.mjs
```

脚本骨架：`fakeFs(files)` 造一个只认固定路径的读写接口，值可以是字符串、对象，或 `{ throwError: <error> }`（抛指定错误，用来模拟 `ENOENT` 之外的失败）；`reg(ids, select)` 造一个只装 `ids` 里那些后端的注册表，`select` 就是「各房自己认领」的答案；`fakeLog(debugOn)` 造一个 `logCtx`，按调试开关决定收不收 `detection.step`。每组用例打印返回对象的全字段（缺的字段写成 `(absent)`，这是打印器加的标记，不是返回对象里真有这个键）与这一趟发出的所有日志行。

### 与票面矛盾的六处

（1）前两层命中时第三层没问过——完整输出见 A1 的 P13。

（2）声明文件读失败被当成「没有这份文件」——完整输出见 A3 的 P10；工作区文件读失败同理（P9）：

```
### P9 工作区文件存在、但读的时候抛的不是「没有这份文件」（EACCES / 沙箱拒绝）
输入：fakeFs({ 'docs/agents/workspace.json': { throwError: EACCES } })，registry: reg(['github'], async () => null)
{
 "reads": ["docs/agents/workspace.yaml", "docs/agents/workspace.json", "docs/agents/issue-tracker.md"],
 "result": { "backendId": null, "source": "fallback", "origin": "none", "canWrite": false, "reason": "no-backend",
  "state": "no-backend", "missing": "三处都没有认领", "gap": { "id": "no-claim", ... }, "conflict": null,
  "steps": ["workspace-file/miss/file-missing//0", "declaration/miss/declaration-missing//0", "autodetect/miss/matches-no-claim//0"] },
 "log": [ "detection.detect[info] {...,\"state\":\"no-backend\",...}" ]
}
```

对照 P9b（文件读到了、内容不合法）：

```
### P9b 工作区文件读到了、但内容解析不出来（对照：这一支才给 file-unreadable）
输入：fakeFs({ 'docs/agents/workspace.json': 'this is not a workspace file' })
{ "state": "undetermined", "missing": "文件在，但读不出来或者格式不对",
  "gap": { "id": "file-unreadable", "text": "工作区文件读不出来：把 docs/agents/workspace.yaml 的格式改对，就能定下来。" },
  "steps": ["workspace-file/unreadable/file-unreadable//0", "declaration/miss/declaration-missing//0", "autodetect/miss/matches-no-claim//0"] }
```

（3）各房认了个没装上的后端 → 对外文案说「三处都没认领」——完整输出见 A3 的 P8。

（4）日志三态与结果三态不同源——完整输出见 A4 的 P11。

（5）裁剪可能返回没注册的后端名——完整输出见 A2 的 P19。

（6）无标题声明文件从「不算数」变成「算数」——完整输出见 C1 的 P20。

### 其余用例（完整返回对象）

根目录为空（`decideBackend('', { fs: fakeFs({}).fs, registry: reg(['github']), logCtx })`）——结果说判不出来，日志说确实没有：

```
### P1 空根（root = ""）
{
 "result": { "backendId": null, "source": "unknown", "origin": "unknown-workspace", "canWrite": false,
  "reason": "workspace-not-ready", "ref": "(absent)", "multiHit": "(absent)", "pending": "(absent)",
  "state": "undetermined", "missing": "还不知道这个工作区是哪条目录",
  "gap": { "id": "workspace-not-ready", "missing": "还不知道这个工作区是哪条目录",
    "text": "这个工作区还没就绪（还没认出是哪个目录），等面板认出工作区之后再试。" },
  "conflict": null, "steps": [] },
 "log": [ "detection.detect[info] {\"cwdHash\":\"00001505\",\"explicit\":false,\"matches\":0,\"pending\":false,\"selection\":\"\",\"origin\":\"unknown-workspace\",\"state\":\"no-backend\",\"latencyMs\":0,\"conflict\":\"\"}" ]
}
```

什么都不接（`decideBackend(CWD, {})`：没有读文件接口、没有注册表、没有认领）——三行步骤线各自如实说「这一层没看成 / 没得问」：

```
### P2 什么都不接
{
 "result": { "backendId": null, "source": "fallback", "origin": "none", "canWrite": false, "reason": "no-backend",
  "ref": null, "multiHit": "(absent)", "pending": "(absent)", "state": "undetermined",
  "missing": "有一层这次根本没看成（读文件的接口没接上）",
  "gap": { "id": "layer-unavailable", "missing": "有一层这次根本没看成（读文件的接口没接上）",
    "text": "有一层这次没看成（读文件的接口没接上），所以这次不算「看过之后确实没有」。" },
  "conflict": null,
  "steps": ["workspace-file/miss/file-layer-unavailable//0", "declaration/miss/declaration-layer-unavailable//0", "autodetect/skipped/no-registry//0"] },
 "log": [ "detection.step[debug] {\"step\":\"workspace-file\",\"outcome\":\"miss\",\"backendId\":\"\",\"ms\":0,\"reason\":\"file-layer-unavailable\"}",
          "detection.step[debug] {\"step\":\"declaration\",\"outcome\":\"miss\",\"backendId\":\"\",\"ms\":0,\"reason\":\"declaration-layer-unavailable\"}",
          "detection.step[debug] {\"step\":\"autodetect\",\"outcome\":\"skipped\",\"backendId\":\"\",\"ms\":0,\"reason\":\"no-registry\"}",
          "detection.detect[info] {...,\"state\":\"no-backend\",...}" ]
}
```

声明文件里写多行冲突标题（输入原文 `const multi = '# Issue tracker: GitLab\n# Issue tracker: GitHub\n# Issue tracker: Markdown\n'`）：

```
### P3 声明文件里写多行冲突标题
{ "backendId": "gitlab", "source": "explicit", "origin": "declaration", "reason": "needs-generate",
  "state": "decided", "gap": null, "conflict": null,
  "steps": ["workspace-file/miss/file-missing//0", "declaration/hit/declaration-title-gitlab/gitlab/0", "autodetect/skipped/skipped-by-caller//0"] }
```

结论是 `gitlab`，与 `parseIssueTracker` 自己的顺序一致（GitLab > Markdown > GitHub），也证明声明文件只读了一次。但请注意 `conflict: null`——声明文件内部自相矛盾时不算「矛盾」，本票要的「证据矛盾带出来」只覆盖跨层，不覆盖同层。

同一场景但注册表装了 gitlab（对照 P4）：

```
### P4b 同一个场景，但注册表装了 gitlab（对照：这时算矛盾）
输入：工作区文件写 gitlab、声明文件写 github，registry: reg(['github','gitlab'])，skipAutodetect: true
{ "backendId": "gitlab", "source": "explicit", "origin": "user-file", "canWrite": true, "reason": "",
  "state": "decided", "conflict": { "kind": "user-vs-declaration", "ids": ["gitlab", "github"], "used": "gitlab" },
  "steps": ["workspace-file/hit/file-hit/gitlab/0", "declaration/hit/declaration-title-github/github/0", "autodetect/skipped/skipped-by-caller//0"] }
```

两个场景只差「gitlab 装没装」，一个报矛盾、一个静默——说明「矛盾」的判据里有「注册表认不认得这个名字」这一层，这一点票面没写。

各房认领超时：

```
### P5 各房认领超时（pending）
输入：registry: reg(['github'], async () => ({ backendId: null, source: 'fallback', pending: true }))
{ "backendId": null, "source": "fallback", "origin": "pending", "canWrite": false, "reason": "pending", "ref": null,
  "pending": true, "state": "undetermined", "missing": "有房间认领超时，还没问完",
  "gap": { "id": "autodetect-pending", "missing": "有房间认领超时，还没问完",
    "text": "有房间还没问完（认领超时），这一次不敢下结论。等一会儿重试，或直接在面板上选定一个后端。" },
  "steps": ["workspace-file/miss/file-missing//1", "declaration/miss/declaration-missing//0", "autodetect/pending/matches-pending//0"] }
```

两层都命中且互不相同（都已装）：

```
### P6 工作区文件与声明文件都命中但互不相同（已装：markdown / github）
{ "backendId": "markdown", "origin": "user-file", "canWrite": true, "state": "decided",
  "conflict": { "kind": "user-vs-declaration", "ids": ["markdown", "github"], "used": "markdown" },
  "log": [ "detection.detect[info] {...,\"selection\":\"markdown\",\"origin\":\"user-file\",\"state\":\"decided\",\"conflict\":\"user-vs-declaration\"}" ] }
```

这一例说明 A5 的「矛盾进结果与日志」在**两层都报已装后端**时是真做到了。

各房认领问不了（没有注册表或调用方关掉）——这一档的文案与 P7/P12 一致，且明确写了「不能说确实没有后端」：

```
### P7 autodetect 没传、注册表也没有 select（问不了各房）
{ "backendId": null, "state": "undetermined", "gap": { "id": "autodetect-unavailable",
    "text": "前两处都没认领，而「各房自己认领」这一层这次没问成。所以只能说没定下来，不能说确实没有后端。" },
  "steps": ["workspace-file/miss/file-missing//0", "declaration/miss/declaration-missing//0", "autodetect/skipped/no-registry//0"] }

### P12 skipAutodetect 显式关掉（调用方自己关了这一层）
{ 同上，steps 末行是 "autodetect/skipped/skipped-by-caller//0" }
```

这一档是本票做得最扎实的一处：**没问过各房时，它确实拒绝了「确实没有后端」这个结论**，而且门禁 B 节就是专门钉它的（`tests/verify-detection-evidence.ts:138` 的标题写着「B 内部三态说实话：没问过各房，不许说『确实没有后端』（回归）」，`:150-151` 的断言查的就是这一支）。

多命中里混了没装的名字、以及裁剪只拿到陌生名：

```
### P14 多命中名单里混了没装的后端名（注册表报 backendId=markdown，multiHit=[gitlab, markdown]）
{ "backendId": "markdown", "source": "matches", "origin": "autodetect", "multiHit": ["markdown", "gitlab"],
  "state": "decided", "steps": [..., "claim-order/hit/plain-order/markdown/0"] }

### P16 各房认领报了一个装了的后端、同时 multiHit 里混着陌生名
输入：registry: reg(['github'], async () => ({ backendId: 'github', source: 'matches', multiHit: ['github', 'zzz'] }))
{ "backendId": "github", "multiHit": ["github", "zzz"], "state": "decided", "steps": [..., "claim-order/hit/plain-order/github/0"] }
```

`orderClaims` 的边界（空名单、重名、全陌生名）：

```
### P15 orderClaims 边界：空名单、重复名、全是陌生名
{"empty":[],"dup":["github","gitlab"],"unknownOnly":["zzz","aaa"],"notArray":[],"keys":["backendId","source","ref"]}
```

纯核 `decidePure` 在「既有结论又待定」时怎么选：

```
### P18 纯核 decidePure 的 pending 优先序（autodetect 同时带 backendId 与 pending）
{"pendingWithId":{"backendId":"github","source":"matches","origin":"autodetect","ref":null,"pending":true},
 "pendingNoId":{"backendId":null,"source":"fallback","origin":"pending","pending":true}}
```

有结论就先给结论（`pending: true` 保留在结果里），没结论才落待定档——这是合理的，记在这里备查。

### 探测没找到问题的边界（说明覆盖到了）

- 根目录不存在/为空：`unknown-workspace` 这一支有明确的档位与文案（P1，只有日志三态那一处不对）。
- 声明文件多行冲突标题：结论稳定、只读一次（P3），与 `parseIssueTracker` 一致。
- 各房认领超时（pending）：落 `autodetect-pending` 档、结果带 `pending: true`（P5）。
- `multiHit` 里混陌生名：`orderClaims` 把陌生名排在三个认得的之后、保持原相对次序（P14/P15/P16）。
- 认领函数直接抛错：落 `autodetect-error` 档（P11 第四例），这一支也是日志三态说错话的场景之一。

## 上一个执行者两条「留作后续」的复核

**第一条（两条路没有日志出口）——属实，而且比说的更严重。**

- `git grep -n "detection\.detect\|detection\.step" -- src` 全仓只有三个发射点：`backendDecision.ts:417`、`backendDecision.ts:423`、`sessionLifecycle.js:169`。`src/host/workspaceCwd.js:210` 与 `src/deck/shell/call-shell.ts:265` 调判定时都没传 `logCtx`，所以这两条路判定照做、日志一条不留。属实。
- 但把它和 `sessionLifecycle.js:169` 并列成「重复一条」是轻的：那条线不是「多一条结论」，而是**同名事件、不同字段集合**（旧五键）。字段门禁放行、附录未登记，读日志的人按 `state` 取值会拿到 `undefined`。这一条我建议按「同一事件两个形状」来修，不是留着。
- 它给的理由「得先给那条 `.js` 路径按仓库规矩转 TypeScript」对 `workspaceCwd.js` 成立，对 `call-shell.ts` 不成立（那本来就是 TypeScript 文件）。两件事被合并成一条理由了。

**第二条（四件文件头还写着迁移前的 `.js` 名）——方向对，但漏了一件、位置说错一行。**

- 属实的是这四件：`explicitDetector.ts`、`parseIssueTracker.ts`、`preflightScope.ts`、`workspaceStore.ts` 的文件头第 2 行今天仍写 `.js`。
- 漏了第五件：`detectionService.ts` 的第 2 行也写 `detectionService.js`——而它正是本票改过的两件之一，不在「别人未提交改动」的豁免里。
- 位置是第 2 行不是第 1 行（第 1 行是 `/**`），这处小错会让后来人按行号找不到。
- 它给的理由（这四件带着别的票的未提交改动）今天已不成立：这四个文件在当前工作区 `git status --porcelain` 是干净的。当时是否如此我无法回溯（那是别的会话的临时状态），但结论是：不修的理由会随时间失效，而问题还在。

## 最不该轻信的一句

「常驻结论线里的 `state` 让不开调试开关的人也能分出『确实没有后端』与『有一层没看成/没问成』。」（`research/489-appendix.md:58` 与票面评论里的同一说法）

这句话听起来像已经验收过的功能，实际是这次调查里最容易误导人的一处：这个字段由 `winner` 推导（`backendDecision.ts:430`），与结果里的三态不是同一条规则（`:719-728`）。探测出四个「判不出来」的场景，它一律写 `no-backend`（P11），根目录为空时也一样（P1）。一个人在只有常驻日志的现场读这一行，会得到与事实相反的结论——而「现场只看日志」正是这套日志体系存在的理由。第 4 条要求（日志分层）因此不能算做完。

第二不该轻信的是「三层证据先收全再合成」（票面第一句）：第三层证据在前两层任意一层命中时**根本没被问过**（P13），而这句话决定了「矛盾不静默吞」的覆盖面——各房自己认领的内容永远不会参与矛盾比较。

## 如果要补做：最小改动清单

按「改动最小、受益最大」排：

1. `src/tracker/detection/backendDecision.ts`
   - 让结论线的 `state` 与返回结果的 `state` 用同一个值：把 `:719-728` 算出的 `state`（以及 `gap.id`）传进 `fireConclusion`，`:430` 删掉自己那套推导；`state` 为 `undetermined` 时把 `gap.id` 一起写进常驻日志，这样不开调试开关也读得出「缺什么」。
   - 给 `decisionGapOf` 补一档「各房认了个没装上的后端」（带那个后端名），并改掉 `no-claim` 档文案里「三处都没认领」这种在第三层报过名时不成立的句子。
   - 工作区文件/声明文件的读失败，如果不是「文件不存在」，不要再记 `file-missing` / `declaration-missing`：至少要在步骤行里说「读不出来」。
   - 裁剪后若一个已注册候选都没有，不要返回没注册的名字（兜底）。
   - 改掉文件头 `:30` 那句与旧代码不符的注释（旧那套顺序是 GitLab > Markdown > GitHub，两套的真实差别是「只看标题」对「标题 + 正文低置信兜底」）。
2. `tests/verify-detection-evidence.ts`
   - 补一条断言：每个 `undetermined` 场景，结论线的 `state` 必须等于返回结果的 `state`；每个 `no-backend` 场景必须真是「问过各房且没人认领」。
   - 把 C 节那条「多行标题同一答案」换成能区分两套解析器的输入（无标题、正文只有关键词），把结论钉住。
   - 把 `ok()` 的第三参数（证据串）打出来，与仓库别的门禁的 `must(cond, inv, det)` 口径一致。
3. 六件文件的注释与日志
   - 五件文件头第 2 行的 `.js` 改成 `.ts`（一行一处）。
   - `explicitDetector.ts`、`parseIssueTracker.ts`、`preflightScope.ts`、`workspaceStore.ts` 各补关键分支日志——今天它们在判定链上一行都不留。
4. `src/host/sessionLifecycle.js:169`
   - 要么删掉这条与出口重复的结论线，要么补齐成与出口同样的九键并登记附录与字段门禁（两条路选一条，不要停在「同名不同形」）。
5. 无标题声明文件这条结论变化（P20）
   - 要么在门禁里补一条逐例对照把它登记成有意行为，要么回退；现在票面说的「逐例一致」没有依据。

## 建议另开票、不要夹带在补做里的事

- **「三层证据要不要全问」是设计取舍**（问各房是一次跨模块调用），应当回规格票 #1132 定，再回来改票面、注释与门禁；不要在补做里顺手改。
- **`src/host/workspaceCwd.js` 与 `src/deck/shell/call-shell.ts` 两条路没有日志出口**，以及前者按仓库规矩转 TypeScript——两件事，另开票。
- **`tests/verify-log-fields.js` 当年为什么是红的**（`detection.cache.hit` 属 #1131）已经由 #1131 自己补登记，不需要再动；只在票面上补一句「落地当天该门禁是红的、原因与归口」即可。
