# 票 #998 复核：deck_* 工具被「连续失败到退避门槛」整片推迟（2026-10-21）

- 复核人：单票核实员 recheck-998（只核这一张票）
- 复核时间：2026-10-21 13:39–14:05（Asia/Shanghai）
- 代码基线：`git rev-parse --short HEAD` = **dd827466**（提交「补上「什么情况下才该走 YAML」的判据与那 8 项的做法分类（#1330）」，2026-10-21 13:32:49 +0800）
- 工作树状态：开工时只有一条别人的未跟踪项 `?? %SystemDrive%/`，全程未动；本次复核只读，唯一写入是本文件。
- 复核范围：票面描述的故障机制在**今天的源码**与**今天真机运行环境**里是否还存在。票正文「## 七、全量审查发现」的 13 条按 `research/1010-ticket-scope-2.md` 属重构清单，不在本次判定内。

## 一、票面症状摘要

票标题是「BUG：deck_* 工具整片被闸推迟（gate-defer，连续失败到退避门槛），会话里上报没成功」。2026-10-10 真机上，同一个工作区的所有 deck_ 工具（建票、查票、改票、补边、看地图、上报等）统一返回同一句拒绝：

> 这一次选后端被闸推迟了（连续失败到了退避门槛：拉开间隔再试，成功一次立刻归零），先不做。

机器码是 `gate-defer`，连续 5 次、跨约 15 分钟反复出现，只能重启进程恢复。票内 2026-10-10 的诊断评论把它归为**闸的连续失败计数自锁**：计数到门槛后所有 AI 工具调用被推迟；被推迟的调用既不算失败也不算成功，只有真跑成功才归零，于是「到门槛 → 谁都进不来 → 没有成功可归零 → 还是谁都进不来」。当时日志里反复出现 `refresh.decide`，字段形如 `{"category":"ai-tool","kind":"probe","verdict":"defer","reason":"failure-backoff","tier":"green"}`；而同一时间 gh 已经恢复（约 1 秒一条 ok），工具仍被推到最后由人重启进程。

票内还记录了 2026-10-10 的修复：提交 **71dbc3e**「修复 deck 工具被「连续失败」永久锁死：到门槛之后放一笔探针进来试，成功即解锁」。做法是给连续失败加一台半开窗口状态机（原因代号 `failure-half-open`），到门槛之后按窗口放一笔探针真跑一次：成功当场归零，失败则计数加一、窗口重开。同日 14:12 完全重启后真机验证：`deck_issue_report` 成功 1099 毫秒、`deck_context` 成功 26.3 秒、`failure-backoff` 0 次；但半开路径本身当时**还没有被真机自然触发**，票内留的判据是「下次连续失败时日志出现 `failure-half-open`，随后归零」。

票内另有两种要区分开的现象：第 5 条评论讲的是 gh 不在宿主进程 PATH → 额度读数同步失败 → 账本剩余为 0 → deck_* 回「选后端被闸推迟（读的额度已用完…）」，原因代号是 `reserve-kept-for-writes`；票末评论的 `backend-threw`（远端调用在限时内没回来）是另一条超时路径。两者都不是本票的 `failure-backoff` 自锁。

## 二、今天的实现锚点（HEAD dd827466，逐处亲读）

### 1. 闸的入口与原因文案

- `src/host/refresh/gate.ts:20` 的注释仍写着「#998：连续失败到门槛之后由 failure-window.js 那台状态机放一笔探针进来试」。
- `src/host/refresh/gate.ts:291-307`：每笔请求的裁决输入在 `inputFor` 里组装，其中 **297-300 行**是今天的关键：

  ```ts
  const win = failureWindow.failureWindowOf(s)
  const trialDue = win.failures >= FAILURE_DEFER_AT && failureWindow.halfOpenTrialIsDue(
    win, now(), nextAttemptDelayMs(win.failures, limits), FAILURE_HALF_OPEN_DELAY_MS,
  )
  ```

  305 行把 `halfOpenTrialDue: trialDue` 一起传给裁决函数。
- `src/host/refresh/gate.ts:309-312`：`refresh.decide` 的埋点（调试级，外层先判 `logCtx.isEnabled('debug')`），字段是 `{category, kind, verdict, reason, tier, cycle, keyHash}`。
- `src/host/refresh/gate.ts:314-317`：`refresh.skipped` 的埋点（也是调试级），字段是 `{keyHash, kind, reason, pending}`。
- `src/host/refresh/gate.ts:360-367`：真失败时 `failureWindow.recordFailure(...)` 把连续失败计数加一、窗口从此刻重开；真成功时 `failuresSinceSuccess = 0`（这就是「成功一次立刻归零」）。
- `src/host/refresh/gate.ts:378-382`：放行的那一笔如果是探针（`allow` + `failure-half-open`），立刻把窗口起点改成此刻（`consumeHalfOpenTrial`）。注释写明两个目的：这一笔再失败，下一次等待从此刻重新算，不会连环重试；这一笔成功，下面的归零当场开锁。
- `src/host/refresh/gate.ts:385-394`：`defer` 的被放进推迟队列（同工作区只留最后一笔）并发 `refresh.skipped`；返回给调用方的 `detail` 仍然是 policy 里那句原因文案，查不到就是空串。

### 2. 裁决规则

- `src/shared/refresh/src/policy.ts:75`：`FAILURE_DEFER_AT = 3`（连续失败到 3 次进入退避）。
- `src/shared/refresh/src/policy.ts:144-145`：两个原因代号的中文文案，`failure-backoff` 是「连续失败到了退避门槛：拉开间隔再试，成功一次立刻归零」，`failure-half-open` 是「连续失败退避了一大轮：放这一笔进来试一次，成了解锁、不成按下一档接着等」。
- `src/shared/refresh/src/policy.ts:253-260`：`failures >= FAILURE_DEFER_AT` 时，生命周期那档降级成只出缓存；`halfOpenTrialDue === true` 就 `return verdict('allow','failure-half-open')`，否则才 `return verdict('defer','failure-backoff')`。257 行注释点明这是给「谁也进不来、所以永远没人能归零」的死锁留的出口。

### 3. 窗口状态机

- `src/shared/refresh/src/failure-window.ts:32` `failureWindowOf`、`:43` `windowLengthMs`（窗口长度 = 退避档 + 半开额外等待）、`:55` `halfOpenTrialIsDue`（窗口起点必须大于 0，且已经安静够一整轮）、`:65` `consumeHalfOpenTrial`、`:70` `recordFailure`。
- `src/shared/time-config/src/values.ts:275`：`FAILURE_HALF_OPEN_DELAY_MS = 300000`（5 分钟）；`:315`：`CHAIN_BACKOFF_MS = [8000, 30000, 120000, 300000]`。所以第 3 次失败后的探针等待是 120000 + 300000 = 420000 毫秒，第 4 次起是 300000 + 300000 = 600000 毫秒。

### 4. deck 工具这一侧

- `src/deck/shell/call-shell.ts:61`：`GATE_DEFER: 'gate-defer'`。
- `src/deck/shell/call-shell.ts:275`、`:319`：选后端 / resolve 走 `gate.send({source:'tool.call', kind:'probe', bucket:'rest', workspaceKey, plan:[...]})`。
- `src/deck/shell/call-shell.ts:301`：选后端被推迟时回「这一次选后端被闸推迟了（…），先不做。」。
- `src/deck/shell/call-shell.ts:400-408`：工具操作走 `gate.send({source:'tool.call', kind:'tool-batch', bucket:'graphql', workspaceKey, plan:[...]})`。
- `src/deck/shell/call-shell.ts:425`：工具操作被推迟时回「这一次被闸推迟了（…），我没有动手。」，机器码同为 `gate-defer`。

## 三、修复提交与单扇门禁实跑

- 修复提交在 HEAD 里：`git merge-base --is-ancestor 71dbc3e HEAD` 退出码 0（是祖先）；`git log -1 --format=%s 71dbc3e` 输出「修复 deck 工具被「连续失败」永久锁死：到门槛之后放一笔探针进来试，成功即解锁」。之后 gate.ts 只经过迁移与日志类提交（8f8090f2、45deb070、135f5ac8），没有把这段逻辑删掉或改回去。
- 门禁登记：`tests/gate-map.json` 第 4048-4049、7982、8072、8108 行都登记了 `node tests/verify-998-half-open.ts`。
- 本票专属单扇门禁**实跑通过**：

  ```
  node --import ./scripts/ts-hook.mts tests/verify-998-half-open.ts
  ```

  Node v24.19.0，退出码 0，末行输出「全部通过 — 连续失败不再自锁（29 项断言）」，29 条断言全部 PASS。断言覆盖的关键行为包括：
  - 先在真闸上复现旧死锁的形状，再验证半开窗口边界（等待 420000 毫秒、600000 毫秒两档）；
  - 安静够一整轮后放一笔探针真跑；
  - 探针成功当场归零；
  - 探针失败时计数 3 → 4，窗口重开，下一次等待按下一档算；
  - 同一工作区在飞时不会放第二笔探针；
  - 被推迟的请求不增加连续失败计数；
  - 没有接 `halfOpenTrialDue` 的地方保持旧行为；
  - 人的动作与读额度不受这条逻辑影响；
  - 工作区视图带出 `backoffWindowStartedAt`。

  运行中只有仓库已知的 `MODULE_TYPELESS_PACKAGE_JSON` 警告，与本次判定无关。

## 四、运行构建状态（与 HEAD 源码分开说明）

真机侧运行的是 `D:\dsh-plugin\dsh-mattpocock-skills-deck\package`：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck` 是指向它的 Junction（链接类型 Junction，目标路径明确）。这一份构建的 `package.json` 版本是 1.9.0-beta.7，包内最新文件时间 **2026-10-21 13:24:25**。

- `package/lib/refresh/gate.js`（14414 字节，2026-10-21 13:24:25）**含修复**：第 3 行 import `FAILURE_HALF_OPEN_DELAY_MS`、第 5 行 import `failure-window`、第 152 行使用 `FAILURE_HALF_OPEN_DELAY_MS`、第 159 行 `halfOpenTrialDue`、第 217 行 `if (v.verdict === "allow" && v.reason === "failure-half-open")`。
- `package/shared/refresh/failure-window.js` 存在，文件头写明 AUTO-GENERATED，来源是 `src/shared/refresh/src/failure-window.ts`。
- `package/shared/refresh/policy.js` 第 23 行有 `failure-half-open` 文案、第 83 行 `return verdict('allow','failure-half-open')`。

**口径要说清**：13:24:25 的构建早于 HEAD 最近一次提交（13:32:49 的 #1330），所以不能断言「运行构建逐字节等于今天的 HEAD」；但 #998 的修复是 2026-10-10 的 71dbc3e，远早于两者，**HEAD 源码与运行构建都含这段修复**。DeepSeek Harness 今天有 11:41、12:46、13:28、13:38 等多个启动时间，都晚于 10-10，也就是说今天真机加载的哪一份构建都带修复。

## 五、真机日志证据

日志目录：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\`，每天一个 `YYYY-MM-DD.log`，本次查 **2026-10-15 至 2026-10-21** 共 7 个文件，约 235 万行、389MB。查询方式全部是流式逐行过滤（不整文件读入、不整行 `ConvertFrom-Json`），只按日期文件、事件名与关键词限定。

### 1. 每天覆盖与缺片说明

| 日期 | 行数 | `log.rotate.degraded` 条数 |
|---|---|---|
| 2026-10-15 | 51079 | 0 |
| 2026-10-16 | 164121 | 14784 |
| 2026-10-17 | 434807 | 47117 |
| 2026-10-18 | 367468 | 30429 |
| 2026-10-19 | 361582 | 37872 |
| 2026-10-20 | 859596 | 30954 |
| 2026-10-21（查时仍在写） | 170872 | 9824 |

`log.rotate.degraded` 多说明日志轮转时可能缺片，这是本目录的已知口径限制；但下面的正向证据（同一批文件里 deck 工具成功记录大量存在、`refresh.decide` 记录完整可统计）说明缺片没有吞掉整类事件。

### 2. 关键词与事件命中数（7 天合计）

| 查询对象 | 命中数 |
|---|---|
| `"reason":"failure-backoff"`（含 `category":"ai-tool"` 的） | **0** |
| `"reason":"failure-half-open"` | **0** |
| 字面 `gate-defer` 与「选后端被闸推迟」 | **0** |
| `"event":"gh.resolve.fail"` | **0** |

### 3. `refresh.decide` 的分布（说明闸到底因什么原因推迟）

按「类别|结论|原因」流式统计：

- 10-15：仅 2 条 `background|allow`。这一天调试开关大多没开，`refresh.decide` 本身记不下来，只能靠下面的 `host.call` 失败数旁证。
- 10-16：`ai-tool|allow|ai-tool-within-caps` 1018 条、`user-action|allow` 603 条、`background|allow|background-fits` 502 条、`background|allow|quota-read-free` 90 条、`background|defer|reserve-kept-for-writes` 32 条。
- 10-17：`ai-tool|allow` 3668 条、`background|defer|reserve-kept-for-writes` 91 条。
- 10-18：`ai-tool|allow` 3372 条、`background|defer|reserve-kept-for-writes` 32 条。
- 10-19：`ai-tool|allow` 4404 条、`background|defer|reserve-kept-for-writes` 63 条、`ai-tool|reject|ai-tool-below-remaining` 2 条。
- 10-20：`ai-tool|allow` 4013 条、`background|defer|reserve-kept-for-writes` 566 条、`background|defer|rate-limited` 147 条、`ai-tool|defer|rate-limited` 27 条、`ai-tool|defer|reserve-kept-for-writes` 3 条。
- 10-21（查时）：`ai-tool|allow` 2228 条、`background|defer|reserve-kept-for-writes` 12 条。

结论：这 7 天里，AI 工具这一档出现的推迟原因**只有 `rate-limited`（撞限流）与 `reserve-kept-for-writes`（读额度花到给写留的保底）**，两个都不是本票的连续失败自锁；`failure-backoff` 与 `failure-half-open` 一次都没有出现。10-16 至 10-21 这 6 天调试日志是开的，合计约 3.7 万条 `refresh.decide`，足以覆盖本票机制。

### 4. deck 工具实际可用（与「整片被推迟」直接相反）

- `host.call`（kind 为 `deck-tool`）成功条数按天约 2015 / 1927 / 2126 / 1927 / 2478 / 2328 / 1237 条（10-15 起逐日）。
- `host.call.fail`（kind 为 `deck-tool`）每天 9 到 38 条；10-16 至 10-21 按方法分：`deck.agentRegister` 101 条、`deck_issue_get` 3 条、`deck_context` 2 条、`deck_issue_patch` 1 条。没有任何「同一工作区整片工具同时失败」的形状；`deck.agentRegister` 是 agent 注册路径的个别失败，与闸推迟不是一回事。
- 今天最近 3 小时（查时约 10:38–13:41）：deck 工具 `host.call` 成功 340 条，AI 工具 `refresh.decide` 放行 620 条，非放行 0 条。
- 本次复核亲手调用 `deck_issue_get` 成功，日志原句（`ts`=1792561032007，2026-10-21 13:37:12 本地）：

  ```json
  {"v":3,"level":"info","event":"host.call","fields":{"method":"deck_issue_get","latencyMs":1669,"ok":true,"kind":"deck-tool"}}
  ```

  另外今天凌晨 00:12:10 的 `refresh.decide` 原句也可以对照，说明 deck 工具这一档在闸里是正常放行：

  ```json
  {"v":3,"ts":1792512730291,"level":"debug","event":"refresh.decide","fields":{"category":"ai-tool","kind":"tool-batch","verdict":"allow","reason":"ai-tool-within-caps","tier":"green","cycle":"","keyHash":"b54375f9"}}
  ```

- 10-20 的 `rate-limited` 推迟原句（说明现在若仍看到「被闸推迟」，先看 reason）：

  ```json
  {"v":3,"ts":1792462800075,"level":"debug","event":"refresh.decide","fields":{"category":"ai-tool","kind":"probe","verdict":"defer","reason":"rate-limited","tier":"red"}}
  ```

### 5. 是否足够

足够。理由有三条：一是 `host.call` 与 `host.call.fail` 是 info/warn 级、不受调试开关影响，7 天里 deck 工具成功量每天上千、失败只是零星；二是 10-16 起调试日志开着，约 3.7 万条裁决记录里没有本票的原因代号；三是今天真实会话里 deck 工具仍然正常（本次复核自己调用成功）。10-15 当天调试开关大多关闭，但那天的 deck 工具成功数仍有 2015 条、失败 14 条，也没有整片失败的形状。

## 六、判定：**不存在**

票面描述的故障机制——连续失败计数到门槛后把同一工作区所有 AI 工具调用推迟、且被推迟的调用无法归零造成永久自锁——在今天的代码与真机运行环境里已经不存在，并且有门禁守着。三条直接证据：

1. **源码**：`src/host/refresh/gate.ts:297-300` 算出 `trialDue`，`src/shared/refresh/src/policy.ts:253-260` 在到门槛后按 `halfOpenTrialDue` 放一笔探针（`allow` + `failure-half-open`），`src/host/refresh/gate.ts:360-367` 真成功即归零、`378-382` 探针失败则从此刻重开窗口。也就是说「谁都进不来」的状态最多持续一个窗口（第 3 次失败后 420000 毫秒、第 4 次起 600000 毫秒），之后一定有一笔能进来，进来成功就开锁。
2. **门禁**：`node --import ./scripts/ts-hook.mts tests/verify-998-half-open.ts` 退出码 0，29 项断言全过，覆盖复现旧死锁、探针成功归零、探针失败计数 3→4 且窗口重开、在飞不放第二笔、被推推迟不加计数等行为；修复提交 71dbc3e 是 HEAD 的祖先。
3. **真机日志**：2026-10-15 至 2026-10-21 共 7 个日志文件、约 235 万行里，`reason` 为 `failure-backoff` 的 0 条、`failure-half-open` 的 0 条、机器码 `gate-defer` 与「选后端被闸推迟」0 条；同一时期 deck 工具每天成功上千条，失败只是零星（且没有整片同时失败的形状）。运行构建 `package/lib/refresh/gate.js`（2026-10-21 13:24:25）也包含这段修复。

**需要向读者说清的一点**：今天的闸仍然会因为别的原因为推迟 deck 工具，包括撞限流（`rate-limited`）、读额度花到给写留的保底（`reserve-kept-for-writes`）、以及 AI 工具额度低于剩余（`ai-tool-below-remaining`）。10-19、10-20 的日志里就有这些实例。它们不是本票的「连续失败自锁」，判定不受影响；将来若有人再看到「被闸推迟」，应先看 `refresh.decide` 的 `reason` 再判断该查哪条线。

## 七、埋点方案

**本票不需要新增埋点。** 判定为「不存在」，且现有埋点已经够用：`refresh.decide`（`src/host/refresh/gate.ts:309-312`）记录每一笔的类别、种类、结论、原因、档位与工作区短指纹；`refresh.skipped`（`src/host/refresh/gate.ts:314-317`）记录被推迟的请求与队列长度；`host.call`/`host.call.fail` 记录 deck 工具的实际调用与失败；半开路径的专用原因代号 `failure-half-open` 已经在 `src/shared/refresh/src/policy.ts:145` 定义并有文案。这些事件都登记在 `research/489-appendix.md` 第 1 章对照表里，无需新增事件、无需改白名单。

如果将来要在真机上自然观察半开路径，现有日志的判据已经写死：**下一次连续失败达到 3 次后，安静够一整轮，日志里应出现 `refresh.decide` 的 `reason":"failure-half-open"`，紧跟一笔 `host.call`（成功则随后 `refresh.decide` 回到 `ai-tool-within-caps`；失败则连续失败计数加一、窗口重开）。** 看到这一段就说明自愈路径真的在真机上跑过；看不到则需要先确认调试开关开着，再确认是否真的连续失败了 3 次（这两个前提在日志里都能查）。这属于后续观察，不属于本票修复缺失。

## 八、未决问题

1. **半开自愈路径在 10-15 至 10-21 的真实日志里从未被自然触发**（`failure-half-open` 0 条）。原因是这 7 天里没有出现过连续 3 次失败，所以没有机会触发。因此「真机自然触发后半开路径工作」这一条仍只有门禁 29 项与 10-10 重启后的间接证据支撑；这是观察条件的缺失，不是修复缺失。若必须等真机自然触发再关票，只能等下一次连续失败，无法人为制造（人为制造连续失败是另一回事，且不应在只读阶段做）。
2. **票正文期望第三条没有完全满足**：票面写「就算调不动也要说到能修的程度」，今天 `gate-defer` 返回给人的仍然只是 `REASONS` 里那句原因文案加 `detail`（`src/host/refresh/gate.ts:391-393`），没有说清是哪一个工作区、哪一类调用、连续失败了几次、上一次成功是什么时候。日志里有 `keyHash` 与计数可以查，但给人看的回复没有这些。这是产品表达上的改进点，不是本票故障机制，若要补应另立窄单。
3. **其他推迟原因仍在，容易与本票混淆**：`rate-limited`、`reserve-kept-for-writes`、`ai-tool-below-remaining` 今天都可能让 deck 工具回 `gate-defer`；其中额度读数同步与冷却问题已由 `research/998-q2-quota-cooldown.md` 记录并另立 #1006。将来若再出现「deck 工具被推迟」，应先看 `refresh.decide` 的 `reason`，不要直接按本票回滚。
4. **票正文「## 七、全量审查发现」的 13 条**（六条严重、七条中等）仍未逐条建票或勾销，按 `research/1010-ticket-scope-2.md` 属重构清单，需在地图 #1010 下另行处理，不在本票判定内。
5. **运行构建与 HEAD 的细微时间差**：运行构建 13:24:25 早于 HEAD 最近提交 13:32:49（#1330），所以「运行构建等于今天 HEAD」不成立；但 #998 修复早于两者，判定不受影响。若有人要求「运行构建必须等于 HEAD 全部提交」，那是构建新鲜度问题，需另行处理。

## 附：本次用到的查询口径

- 基线：`git rev-parse --short HEAD` 与 `git merge-base --is-ancestor 71dbc3e HEAD`。
- 单扇门禁：`node --import ./scripts/ts-hook.mts tests/verify-998-half-open.ts`（只跑这一扇，未跑全链、未跑构建）。
- 日志：对 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\2026-10-{15..21}.log` 逐文件流式逐行过滤；关键词为 `"reason":"failure-backoff"`、`"reason":"failure-half-open"`、`gate-defer`、「选后端被闸推迟」、`"event":"gh.resolve.fail"` 与 `"event":"refresh.decide"` / `"event":"host.call"` / `"event":"host.call.fail"`；未整文件读入、未对整行做 JSON 全量解析、未改动任何日志文件。
- 运行构建：只读检查 `package/lib/refresh/gate.js`、`package/shared/refresh/failure-window.js`、`package/shared/refresh/policy.js` 与 `package.json`，未构建、未改动。
