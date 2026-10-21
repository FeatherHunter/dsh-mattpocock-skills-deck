# 票 #916 复核：终端已登录、面板仍报「缺登录前提」

## 一、复核信息与结论速览

- 复核日期：2026-10-21，只读复核（未改任何源码、测试、构建产物，未提交、未关票、未发评论）。
- 基线：HEAD 短哈希 `dd827466`（本会话开始时记录，写作前再核仍为 `dd827466`）。工作树里有并行会话的改动（README.md、docs/README.en.md、docs/star-history-*.svg、package/README.md 已暂存；research/898-blocked-by-overwrite.md、research/960-claim-verification.md 已修改），本次一律未动。
- 运行中的插件构建：`D:\dsh-plugin\dsh-mattpocock-skills-deck\package`（Junction 到 profile 的 node_modules）。本次日志反映的是 2026-10-21 13:24 构建的产物；`package/lib/client.js` 的修改时间在 13:43 被并行会话又重写过一次，核对内容仍包含 #916 修复。
- 一句话结论：票面最初那一路「查不到登录态被当成缺登录」已经修复并守住；但**同一句英文黄条今天仍会因为「网络抖动被两级分类器判成确定未登录」而出现**，2026-10-20 的真机日志里有两次实例。因此判定为**存在**（以另一层机制存在）。

## 二、票面症状摘要

- 票号与标题：#916「gh already logged in but panel still shows Sign-in prerequisite missing」，状态 open，标签 bug / ready-for-agent，父票 #1010，零评论。
- 现场：2026-10-08 15:19 的截图里，终端 `gh auth status` 显示已登录账号 FeatherHunter；同一屏的状态栏黄条写着「Sign-in prerequisite missing - open guide to authenticate」，按钮「View sign-in guide」。报告人不愿意再跑一遍 `gh auth login`。
- 期望：已经登录时不该出现这条黄条；如果插件实际检查的是别的东西（别的工作区、别的账号、别的站点），界面要把差异说清楚。
- 票面 triage 给出的根因候选：A（高）检查项只有通过、失败、查不到三种，横幅把「查不到」也当成「没通过」，文案不区分失败与查不到；B（中）面板跑 `gh` 的环境和人手终端不同（工作区目录、约 15 秒单次超时与约 30 秒总兜底、Windows TLS 或代理、PATH、令牌在另一个用户目录）；C 旧快照；D 账号或站点不匹配。

## 三、今天的实现锚点（文件:行，行号以 HEAD `dd827466` 为准）

### 1. 检查项声明与文案键

- `src/tracker/rooms/github/checks.ts:38`：房间检查项声明 `id: 'gh:authed'`（这张票的检查项本体）。
- `src/tracker/rooms/github/index.ts:57`：修复知识与文案键的映射位置（随房间转写后仍在）。
- `src/shared/tracker/guide-steps.ts:100-107`：引导第 3 步，`id: 'gh:authed'`、`checks: ['gh:authed']`、`banner: BANNER.ghAuth`、`missing: MISSING.ghAuthLogin`。
- `src/shared/tracker/guide-steps.ts:31`：`MISSING.ghAuthRecheck = { type: 'recheck' }`，即「重新检查」这个不注入登录引导的动作。
- `src/shared/tracker/guide-steps.ts:44`：`BANNER.ghAuth = { text: 'banner.ghauth', btn: 'banner.ghauthBtn', tone: 'warn' }`——票面那条黄条的文案键。
- `src/shared/tracker/guide-steps.ts:45`：`BANNER.ghAuthUnknown = { text: 'banner.ghauthUnknown', btn: 'banner.ghauthUnknownBtn', tone: 'warn' }`——#995 修复新增的「状态暂时确认不了」横幅。

### 2. 三态判定与横幅选择

- `src/shared/tracker/guide-steps.ts:189-205`：`guideStepState()` 把检查链状态折成四态——全 done 为 done；任一 fail 或标了 current 为 failed；否则 pending；一项结果都没有为 absent。**注意 pending 与 failed 是分开的**，这正是 #995 修复的落点。
- `src/shared/tracker/guide-steps.ts:213`：`guideBannerOf()`——当 `gh:authed` 且状态是 pending 时改用 `BANNER.ghAuthUnknown`，不再用缺登录横幅。
- `src/shared/tracker/guide-steps.ts:224`：`guideMissingOf()`——同一条件下改用 `MISSING.ghAuthRecheck`（只重查，不注入登录引导）。
- `src/client/statusbar/bannerChain.ts:220-228`：客户端 `guideBannerMeta()` 调用 `guideBannerOf()` 取当前步的横幅文案键与按钮。
- `src/client/statusbar/bannerChain.ts:246-262`：`runGuideMissing()` 的 recheck 分支——带 `user-recheck` 令牌调用 `wf.detect`，并各刷新一次链与快照。
- `src/client/statusbar/bannerChain.ts:292`：`logGuideInject()` 用 `log('info','guide.inject',{ step, outcome })` 记录按钮点击（客户端日志通道）。全仓没有任何一行日志记录「横幅最终选了哪个文案键」。

### 3. 宿主检查链的判定（今天的核心）

- `src/host/detectChain.ts:317-331`：`preflight:ghAuth` 检查项。
  - `:321`：`ghAsk('gh', ['auth','status'], ghOptsFor(cwd), 'ghAuth')`——真正跑的只有 `gh auth status`。
  - 成功 → `pass`。
  - `:327`：`kind === 'auth'` → `fail`，细节文案「GitHub 登录状态已失效（重新登录 gh auth login / refresh）」。
  - `:328`：`kind === 'network'` → `pending`，「网络异常，暂时无法确认登录状态」。
  - `:329`：其它（含超时）→ `pending`。
  - `:323-324` 的注释写明约定：「仅当明确未登录（kind=auth）才判 fail」。
- `src/host/git-process.ts:191-271`：`runGh` 把非零退出归成四种：超时 → `network`（`:243`）；文案命中认证正则 → `auth`（`:244`，正则为 `/not logged in|auth failed|bad credentials|failed to log in|token.*invalid|keyring|re-authenticate|auth refresh/i`，`:245` notfound、`:246` network 依次在后）；成功 → `kind: 'ok'`（`:266`）。
- `src/host/git-process.ts:248`：`gh.exec` 这一行只有 `argv0、cwdHash、latencyMs、kind、exitCode`，**不记录命令参数，不记录命中了哪段文案**。
- `src/host/git-process.ts:249`：`error.normalize` 只有 `rawKind、mappedKind`（宿主侧）。
- `src/host/detectChain.ts:399-407`：修文案预取，`runGh(['api','user','-q','.login'])` 与 `GH_LOGIN_PREFETCH_MS` 赛跑，只用于生成修复提示句，不参与判定。

### 4. 房间预检（只影响读取降级，不影响横幅）

- `src/tracker/rooms/github/preflight.ts:54-149`：房间预检第 2 关 `preflight:auth`，`:94` 跑 `execGh(['auth','status'], { cwd, via: 'preflight.auth' })`；失败时 `emitReadDegraded(opCtx,'preflight','preflight:auth')`，通过时 `emitPreflightGatePass(2)`；`:135` 再跑 `gh api repos/{owner}/{name}`（`via: 'preflight.api'`）。
- `src/tracker/kernel/error-rules.ts:192-198`：房间侧文案分类正则（`/not logged in|authentication|bad credentials|unauthorized|permission denied|does not have the correct permissions|credential|\bauth\b/i`→AUTH）；`:114`、`:129` 是结构化 401/403 走 `fact` 规则；`:200-202` 网络句式；`:242-248` 兜底 NETWORK；`:256-279` 截断与脱敏。
- 房间预检判负只让房间读降级（黄条之外的提示另算），不直接把宿主链判成 fail。判定两处是**独立的两套分类器**，但今天对同一段文案会得到同样的 `auth` 结论。

### 5. 文案原文

- `src/client/kernel/locale-data.ts:1875`：英文 `'banner.ghauth': 'Sign-in prerequisite missing — open guide to authenticate'`（即票面原句）；`:1876`「View sign-in guide」。
- `src/client/kernel/locale-data.ts:1877`：英文 `'banner.ghauthUnknown': 'Sign-in status unknown — retry the check'`；`:1878`「Re-check」。
- `src/client/kernel/locale-data.ts:1598-1601`：同四条中文（`banner.ghauth` 为「登录态未就绪 —— 点右侧注入认证引导」）。
- `config/copy/panel.yaml:347-350`：英文文案对照（`:347` 就是票面那句）；`:55-58` 中文。

### 6. 运行构建状态

- 本次日志对应的运行构建是 2026-10-21 13:24 构建的 `package/`。抽查 `package/lib/detectChain.js`：含「登录状态已失效」细节文案，`preflight:ghAuth` 在该文件第 191 行；`package/lib/git-process.js` 含 `'failed to log in'` 正则；`package/lib/client.js` 含 `'banner.ghauthUnknown'`。
- 也就是说：#995 的 pending 中性横幅修复与「auth → fail」这条路径**都已经在正在运行的构建里**，不是「只在 HEAD 源码、运行构建没跟上」。下面的日志证据正是这份构建产生的。

## 四、修复提交与门禁实跑结果

- 修复提交：`a8baea9f57ff852c573f61eec7826ab71d6fb394`（2026-10-08 16:43:39 +0800，标题「修复登录状态查不到时误报缺登录：pending 改出中性横幅与重查入口（#916）」）。`git merge-base --is-ancestor a8baea9 HEAD` 退出码 0，**修复在 HEAD 里**。改动落在 locale-panel.js、StatusBar.js、bannerChain.js、guide-steps.js 四个文件与新增门禁 `tests/verify-916-ghauth-unknown-banner.js`。
- 时间线上的一个关键观察：票面截图是 2026-10-08 15:19，修复提交在同日 16:43 —— 截图之后约 84 分钟。所以**票面原始现场大概率就是 A 路（pending 冒充缺登录）**，那一路今天已经修好。
- 本票专属门禁实跑（本会话、HEAD `dd827466`）：
  ```
  node --import ./scripts/ts-hook.mts tests/verify-916-ghauth-unknown-banner.ts
  ```
  结果：14 条断言全部 PASS，末行 `916 BANNER TESTS PASSED`，退出码 0（仅一条 `MODULE_TYPELESS_PACKAGE_JSON` 警告，AGENTS.md 已把它列为已知代价）。该测试文件头注写明 2026-10-17 由 `.js` 转成 `.ts`，判据未改。
- 门禁守的是什么：failing 的 `gh:authed` 出 `banner.ghauth` 并注入 `PROMPT:ghAuthLogin`；pending 的 `gh:authed` 出 `banner.ghauthUnknown`，点按钮只重查（detect、链、快照各一次，`trigger=user-recheck`，`guide.inject outcome=action`）；状态为 `current` 时按 fail 算；done 后横幅轮到下一步。
- 门禁守不到的是什么：它只覆盖 pending 分支的横幅选择，**完全不检验「auth 分类本身是不是误判」**。这就是下面残余问题的位置。

## 五、真机日志证据

### 1. 查了什么、怎么查的

- 日志目录：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\`，按天分文件 `YYYY-MM-DD.log`，可用范围为 2026-10-15 起。文件大小：10-15 约 6.6MB、10-16 约 24.2MB、10-17 约 66.8MB、10-18 约 56.8MB、10-19 约 55.5MB、10-20 约 134.4MB、10-21 约 27MB（另有 10-21 的临时子目录）。每行是 `{"v":3,"ts":UTC 毫秒,"level":…,"event":…,"fields":{…}}`。debug 级别已开（10-21 当天 debug 9.2 万行、info 6.2 万行、warn 1.6 万行、error 0 行）。
- 查法：只用 `dsh-log` 的 tail 子命令（`node C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-log\dist\cli.js tail "<日志目录>" -n … --since … --level … --json`）与对单日文件的 `Select-String` 精确匹配；从不整文件读入、从不全量 `ConvertFrom-Json`。按事件名与关键词统计命中（`"event":"chain.predicate"`、`"event":"gh.exec"`、`"id":"gh:authed","status"`、`"via":"preflight.auth"`、`"event":"error.normalize"`、`"event":"guide.inject"` 等），并对命中行逐条读原文。
- 日志的时间戳是 UTC 毫秒，看人类时间要加 8 小时。
- 覆盖不足先说清：票面截图 2026-10-08 早于日志可用起始日（10-15），**原始现场不可能查到**；日志也不记录 gh 的命令参数、stderr 原文、横幅实际渲染结果（详见第五节第 6 小节）。

### 2. 每天的判定统计（按 `"id":"gh:authed","status":"…"` 计数）

| 日期 | pass | pending | fail | 说明 |
| --- | --- | --- | --- | --- |
| 10-15 | 0 | 0 | 0 | 当天没有链判定行（无 chain.predicate） |
| 10-16 | 6 | 0 | 0 | |
| 10-17 | 13 | 0 | 0 | |
| 10-18 | 7 | 0 | 0 | |
| 10-19 | 14 | 1 | 0 | 13:31:22 一次 pending（网络故障，见 5.4） |
| 10-20 | 35 | 0 | **2** | 10:11:21 与 13:21:09 两次 fail（见 5.3） |
| 10-21（截至复核时） | 10 | 0 | 0 | 今天没有 fail |

补充计数（同一批文件）：宿主 `gh.exec` 里 kind=auth 的行数按天为 10-18 无、10-19 无、10-20 **6 条**、10-21 0 条（这 6 条里正好有 2 条成为链 fail）；房间 `via=preflight.auth` 的 auth 判负按天为 10-18 10 条、10-19 99 条、10-20 712 条、10-21 1 条（房间判负只让读降级，不直接出黄条）；`error.normalize` 的 mappedKind=auth 按天为 10-18 6 条、10-19 33 条、10-20 126 条、10-21 1 条。

### 3. 两个 fail 窗口的原文与对照证据

**窗口一：2026-10-20 10:11:21（日志 2026-10-20.log 第 214979 行，ts=1792462281140）**

- 10:11:21.139 宿主 `gh.exec`：`{"argv0":"gh","cwdHash":"1a673de8","latencyMs":816,"kind":"auth","exitCode":1}` —— 这就是链自己跑的 `gh auth status`，非零退出且被文案正则归成 `auth`。
- 同一毫秒（10:11:21.140）`chain.predicate` 连续落三行：`gh:installed pass`、`gh:authed fail`、`gh:repoAccess pending`；同时 `chain.preflight.reuse {cwdHash:'1a673de8', checks:0, reused:0}`。
- **同一秒内仍有成功的需登录调用**：10:11:20.957、10:11:21.368、10:11:21.435、10:11:21.979 等宿主 `gh.exec` 都是 `kind:'ok', exitCode:0`（耗时 1–4 秒的真实 API 调用）。另有 10:11:17.951 房间一条 `kind:'network'` 与宿主 `kind:'auth'` 落在同一毫秒，说明当时网络状态在抖动，不同请求的结局不一致。
- 链在 10:23:17 自行回到 pass（约 12 分钟），期间没有人动过凭据。

**窗口二：2026-10-20 13:21:09（日志 2026-10-20.log 第 370794 行，ts=1792473669213）**

- 13:21:05 起出现成对的 `issues.fallback {from:'gh-api', to:'gh-issue-list', reason:'paginate-failed'}` 与 `fallback.chain`，宿主 `gh.exec` 的 `gh api --paginate` 连续约 3.3–3.7 秒后 exit 1；同一时段另有大量 `kind:'ok', exitCode:0` 的宿主调用（3.0–4.1 秒）。
- 13:21:08.784 房间侧 `exec.run {argv0:'gh', cwdHash:'41dcac8b', latencyMs:918, exitCode:1, via:'detect-preflight'}` 三连；紧接着 `error.normalize {rawKind:'exit:1', mappedKind:'auth', layer:'phrase', via:'common', exitCode:1}`——**分类层是 `phrase`（文案命中认证词），不是 `fact`（结构化 HTTP 401）**。这一点很关键：如果是真 401，房间规则会走 `:114` 的 fact 分支；今天是靠文案判的。
- 13:21:09.202 宿主 `gh.exec`：`kind:'auth', exitCode:1, latencyMs:979, cwdHash:'41dcac8b'`；13:21:09.213 `chain.predicate` 落 `gh:authed fail`、`gh:repoAccess pending`，随后 `chain.cache.write {allGreen:false, doneCount:8}`。
- **判负后不到半秒，需登录的真 API 调用成功**：13:21:09.658 `exec.run {argv0:'gh', cwdHash:'1a673de8', latencyMs:1413, exitCode:0, via:'refresh'}` 配 `quota.spend {bucket:'graphql', requests:1, points:1, remaining:1593}`；13:21:12.091、13:21:13.210、13:21:14.036 又有同类成功调用（exitCode 0 + graphql 配额扣减）。13:21:14.430 `snapshot.built {issues:36, labels:5, open:0, closed:14, partial:false}` 也是成功构建的快照。凭据在这段时间可用。
- 链在 13:29:57 自行回到 pass（约 9 分钟），期间同样没有人动过凭据。

**为什么这不是「房间读被挡住」造成的假象**：10:06–10:21 房间侧 ok 计数恒为 0，是因为预检第 2 关（`preflight:auth`）一旦失败就会挡住房间后续所有读，所以房间 ok=0 不能当作「令牌死了」的证据；真正的反证来自宿主同时段大量 `kind:'ok'` 的调用，以及 13:21:09.658 起 `via:'refresh'` 的成功 GraphQL 调用。

### 4. 一次 pending 实例（证明 #995 修复生效）

- 10-19 13:31:22（2026-10-19.log 第 139777 行，ts=1792387882323）：`gh:authed pending`（18 分钟后同一条命令成功，期间无人动凭据）。该窗口前后 120 秒内有 636 条 gh 调用事件，房间 `preflight.auth` 的 `kind='network'` 耗时约 10.2–10.3 秒并伴随 `gh.timeout {timeoutMs:15000}`，是网络故障；链按设计判 pending，客户端出的是中性横幅 `banner.ghauthUnknown`（「Sign-in status unknown — retry the check」），不是票面那句。**今天所有 `gh:authed` 为 pending 的实例都没有出缺登录横幅**，这一路修复成立。
- 全周期内 `guide.inject` 里带 `gh:authed` 的点击数为 0——没人点过登录横幅按钮，所以「点了按钮之后怎么走」这条路径在这批日志里没有现场。

### 5. 今天的现状（2026-10-21 截至复核时）

- 宿主 `gh.exec` 的 auth 判负 0 条，链判定 10 次全 pass、无 fail；房间 `preflight.auth` 只有 1 条 auth 判负（只影响读降级）。也就是说今天到复核时为止没有复现，但机制还在（见第六节）。

### 6. 日志证据的边界（哪些结论靠日志、哪些靠推断与活体实验）

- 日志没有记录 gh 的命令行参数：宿主 `gh.exec` 只有 `argv0`，连 `via` 都没有，所以「13:21:09.202 那条就是 `gh auth status`」是靠链的调用点与毫秒级先后关系推断的（同一毫秒内的 `chain.predicate` 可以佐证）。
- 日志没有记录 stderr 原文与命中的具体文案，也没有记录「为什么判 auth」。
- 日志没有记录横幅最终选了哪个文案键：`guide.inject` 只记按钮点击，`gh:authed` 的点击数又是 0，所以「用户当时看到的确实是那句英文」这一步只能靠代码路径推断（fail → guideStepState=failed → guideBannerOf 给 BANNER.ghAuth → locale `:1875`）。
- 10-20 的两次 fail 到底由什么外部故障触发（TLS、代理、DNS、系统时间？）日志里没有线索：没有代理字段、没有 gh 版本字段、没有错误的原文摘要。
- `log.rotate.degraded` 在这几天大量出现，日志可能缺片；本次统计都在整日文件上做，命中数按「能看到的行」计。

### 7. 活体实验：为什么「网络抖动」会变成「确定未登录」

今天 13:40 左右在真机上做的只读实验（未改动任何配置）：

- 正常状态：`gh auth status` 退出码 0（账号 FeatherHunter，单账号，`hosts.yml` 在 `C:\Users\辰辰洋洋\AppData\Roaming\GitHub CLI\hosts.yml`，scopes 齐全）；`gh api user -q .login` 输出 FeatherHunter、退出码 0；`gh version` 为 2.97.0；`GH_HOST`、`GH_TOKEN`、`GITHUB_TOKEN` 均未设置。
- 只设 `GH_TOKEN` 为假值：`gh auth status` 退出码 1，输出「Failed to log in to github.com using token (GH_TOKEN) / The token in GH_TOKEN is invalid.」；`gh api user` 输出「Bad credentials (HTTP 401)」。这是**真失效**的样子。
- 只设 `HTTPS_PROXY`/`HTTP_PROXY` 指向一个死端口（`http://127.0.0.1:9`，模拟连不上 API）：**`gh auth status` 同样退出码 1，输出「Failed to log in to github.com account FeatherHunter (…hosts.yml) / The token in …hosts.yml is invalid. / To re-authenticate, run: gh auth refresh -h github.com / To forget about this account, run: gh auth logout …」**——注意，**连不上 API 时 `gh auth status` 也会说「令牌无效、请重新登录」**，和真的失效在文案上几乎一样；而此时 `gh api user` 报的是 proxyconnect 连接拒绝。
- 把这段断网文案喂给源码里同一份正则：宿主 `src/host/git-process.ts:244` 的 auth 正则匹配（命中 "failed to log in"）→ `kind='auth'`；房间 `src/tracker/kernel/error-rules.ts:194` 的 auth 正则也命中（命中「gh auth refresh」里的 "auth" 词）→ `mappedKind='auth'`。恢复环境后 `gh auth status` 又回到退出码 0。
- 结论：**任何让 gh 连不上 API 的抖动（TLS、代理、DNS、系统时间偏差）都会让 `gh auth status` 打印「令牌无效/请重新登录」的文案；插件里两级分类器都靠文案判 auth，于是链把它判成「确定未登录」→ 出票面那句黄条。而同一台机器上其它 gh 调用可能正好成功（部分请求失败），这就是 10-20 窗口的形态。**

## 六、判定

**存在。**

- 今天仍可复现的路径（HEAD 源码 + 运行构建）：
  1. 网络或代理抖动使 `gh auth status` 连不上 API（活体实验：死代理即可复现）；
  2. `gh` 打印「Failed to log in … token is invalid … re-authenticate」并退出 1；
  3. `src/host/git-process.ts:244` 的正则命中，返回 `kind='auth'`；
  4. `src/host/detectChain.ts:327` 把 `auth` 映射成 `fail`；
  5. `src/shared/tracker/guide-steps.ts:189-205` 折成 failed，`:213` 给出 `BANNER.ghAuth`；
  6. 客户端 `src/client/statusbar/bannerChain.ts:220-228` 取到 `banner.ghauth`，`src/client/kernel/locale-data.ts:1875` 渲染出票面那句英文黄条。
  真机日志实例：2026-10-20 10:11:21 与 13:21:09 两次（各持续约 12 分钟与约 9 分钟），判负的同时同一台机器上有需登录的真 API 调用成功，凭据可用，所以是误报。
- 票面原始机制已修复：#995 的 `a8baea9` 让 pending 走中性横幅（`banner.ghauthUnknown`），10-19 的 pending 实例与 14 条门禁断言都证明这一路守住了；截图时间（15:19）比修复提交（16:43）早 84 分钟，原始现场很可能是这一路。
- 残余问题的本质：**auth 分支不做环境交叉验证**——文案说「令牌无效」就直接判「确定未登录」，而文案在连不上 API 时同样会出现。它与 #917「失败分支未排除环境差异」同源。

## 七、埋点方案（本阶段只写方案，不改代码）

目标：下一次出现「面板判未登录」时，只看本地日志就能分清「凭据真的失效」与「环境抖动导致的假失败」，并且知道用户实际看到的横幅是哪一条。

### 事件一（常驻）：`chain.ghauth`

- 落点：`src/host/detectChain.ts:317-331`，在 `preflight:ghAuth` 求值结束、返回 pass/fail/pending 之前落一行（每次求值一行）。
- 理由：现在只有 `chain.predicate` 在状态**变化**时落 id/status，无法回答「为什么判这个状态、依据哪条文案、在哪个工作区、有没有代理干扰、等了多久」。这是本票最核心的缺口。
- 事件名风格：与既有 `chain.predicate`、`chain.backoff`、`chain.preflight.reuse`、`chain.stale.drop` 同前缀（`chain.`），不另造风格。
- 字段（只收能排除一种故障的信号）：
  - `status`：pass / fail / pending —— 面板拿到什么结论（落盘后可与横幅决策对照）。
  - `kind`：ok / auth / network / timeout / exit / notfound / other —— 分类器给出的原始类别。
  - `exitCode`：数字或空 —— 退出码（区分「进程跑了并失败」与「根本没起来」）。
  - `latencyMs`：本次 `gh auth status` 的耗时 —— 排除超时边界造成的误分类。
  - `failPhrase`：枚举 `not-logged-in / auth-failed / bad-credentials / failed-to-log-in / token-invalid / keyring / re-authenticate / auth-refresh / none` —— **哪段文案命中的认证正则**（用 `runGh` 返回的错误文本按 `:244` 同一份正则逐项测试得出，不落原文）。这是区分「真未登录」与「网络文案」的第一现场。
  - `cwdHash`：8 位短指纹（沿用 `gh.exec` 的既有做法，不落完整路径）。
  - `timeoutMs`：本次检查用的超时（`ghOptsFor` 的值）——排除「超时被算成 auth」。
  - `proxySet`：布尔值，`HTTPS_PROXY`/`HTTP_PROXY` 是否有值（**只记布尔，绝不记值**，值里可能有凭证）。
- 看不到/不该记：原始错误文本、令牌、完整路径、hosts.yml 内容。
- 频率与级别：链判定一天约 40 次（10-20 全天 37 次 pass+fail），info 级常驻成本可忽略。

### 事件二（按需，诊断开关打开时才跑）：`gh.auth.crosscheck`

- 落点：`src/host/detectChain.ts:327` 的 `kind === 'auth'` 分支内；只在 auth 判负时触发，且只在按需诊断开关打开时执行（开关定义遵守 `docs/design/335-logging-contract.md` 第 3 章的按需档规范；默认关闭，护住正常路径的性能与网络调用）。
- 动作：用同一份 `cwd`、短超时（建议 5 秒）立即跑一次 `runGh(['api','user','-q','.login'])`，把结论与刚才的 `gh auth status` 放在同一行。
- 字段：
  - `authKind`：刚才的分类（应恒为 auth）。
  - `authExitCode`、`authLatencyMs`：刚才的退出码与耗时。
  - `failPhrase`：同事件一。
  - `crossKind`：ok / auth / network / timeout / exit / other —— 交叉验证调用的归类。
  - `crossExitCode`、`crossLatencyMs`：交叉验证的退出码与耗时。
  - `verdict`：`token-works` / `token-dead` / `inconclusive` —— **本事件的核心结论**：auth status 说令牌无效，但 api user 成功 ⇒ token-works（误报的确证）；两边都判 auth ⇒ token-dead（真失效）；交叉调用网络失败 ⇒ inconclusive。
  - `ghVersion`：本次进程内首次取值后缓存，记一次 `gh --version` 的第一行 —— 排除「gh 版本行为差异」。
  - `ghPathHash`：`gh` 可执行文件的 8 位短指纹 —— 排除「面板跑的是另一个 gh」。
  - `cwdHash`、`proxySet`：同事件一。
- 为什么这条是决定性的：今天靠「同一时段其它调用成功」来推断误报；有了这一行，误报与真失效在**同一工作区、同一时刻、同一份凭据**上被直接对比，不再需要推断。
- 说明：这个调用本身就是将来修复的方向（`auth` 判负前先交叉验证，成功则按 pending 处理，与 #995 的自愈方向一致）。本阶段只埋点，不动判定行为。

### 事件三（客户端，常驻）：`banner.decide`

- 落点：`src/client/statusbar/bannerChain.ts:220-228` 的 `guideBannerMeta()` 内，只在所选横幅（步或文案键）变化时落一行。
- 理由：今天没有任何日志记录横幅最终选了哪个键，无法证明用户「看到的」是缺登录横幅还是中性横幅；这条把「链的判定」和「界面上的句子」接起来。
- 字段：`step`（如 gh:authed）、`status`（done/failed/pending/absent）、`bannerKey`（如 banner.ghauth / banner.ghauthUnknown）、`missingType`（如 auth-login / recheck）、`changedFrom`（上一个键，首次为空）——只收能把「判定与实际显示」对上的信号，不记文案全文。
- 客户端日志走既有 `log()` 通道（`bannerChain.ts:292` 已有 `guide.inject` 的先例），info 级，仅在变化时写，不会刷屏。

### 「这条日志落盘后，看到什么说明故障存在/不存在」

- **故障存在（误报）**：出现 `chain.ghauth status=fail` 且同一时段（±2 分钟内）有 `gh.auth.crosscheck verdict=token-works`；或 `status=fail` 且 `failPhrase` 属于 `{failed-to-log-in, token-invalid, re-authenticate, auth-refresh}` 而同一时段宿主有 `gh.exec kind=ok / exec.run exitCode=0` 的需登录调用；随后 `banner.decide bannerKey=banner.ghauth` 证明用户看到的就是票面那句。
- **故障不存在（真失效）**：所有 `status=fail` 行都伴随 `gh.auth.crosscheck verdict=token-dead`，或 `error.normalize layer=fact httpCode=401`（结构化 401）；没有出现「token-works 而链 fail」的组合。
- **修复回归（另一类问题）**：出现 `status=pending` 而 `banner.decide bannerKey=banner.ghauth`（按 #995 修复应为 `banner.ghauthUnknown`）——说明中性横幅那一路掉了，单独报。
- **长期只有 pass / pending 且 pending 时 bannerKey=banner.ghauthUnknown**：本票的用户可见症状在这段时间不成立。

### 要同步的白名单与附录

- `research/489-appendix.md` 第 1 章事件对照表：新增三条（编号接当天现行最大号；写作时附录共 114 条，常驻 53 条、按需 56 条、自监控 5 条，且当天另有并行会话在加 #118/#119，**落笔实现时以附录现行值为准，不要照抄这里的数字**）；同时更新 counts 字面与编号清单，并登记级别、字段、落点。
- `tests/verify-log-fields.ts:20` 起的事件到字段白名单（ALLOWED）：加三条事件与各自字段；该门禁按调用点字面量校验，新增调用点必须同步。
- `tests/verify-log-count.ts:21` 起的常驻/按需名单与 counts 断言：把新事件加进对应名单（事件一、三为常驻，事件二为按需），并更新数字。
- `docs/design/335-logging-contract.md` 第 3 章：事件二用了按需诊断开关，按该章规范登记开关与「外层先判开关」的约定。
- 客户端产物新鲜度门禁：`tests/verify-log-client.ts`、`tests/verify-log-artifacts.ts`（事件三落在客户端，需要重建客户端产物才能通过）；另看 `tests/verify-log-statusbar.ts` 是否收集状态栏事件。
- 依赖：事件一、二的实现要先把 `failPhrase` 的计算放到 `runGh` 的错误返回附近（`src/host/git-process.ts:238-251`，不改变返回值），或由 `detectChain` 用同一份正则就地推导（改动更小，推荐后者先做）。

## 八、未决问题

1. 10-20 两次判负当时的 stderr 原文没有落盘，日志只有 exit code 与分类结果；「网络抖动」这一判断来自活体实验可复现的机制加上并发成功调用的推断，不是当刻的直接记录。埋上事件一、二后，下一次出现即可直接定论。
2. 触发抖动的具体外部原因（TLS/schannel、代理、DNS、系统时间）今天不可考：10-20 的日志没有代理与网络字段。活体实验用死代理复现了同一段文案与同一分类结果，机制成立，但当晚的真实触发源无法回填。
3. 与 #917 的边界：「auth 分支不做环境交叉验证」正是 #917「失败分支未排除环境差异」的题面。建议由 lead 决定两票的归属：是在 #916 记录残余并把修复并入 #917，还是把「auth 前先交叉验证」作为 #916 的后续修复单独建票。
4. 关闭口径：#995 的修复（pending 不冒充缺登录）与门禁都成立，但票面「终端已登录、面板说缺登录」这个**用户可见结果**今天仍能出现（10-20 两次）。不建议现在就按「已修复」关票；若要关，评论里要把两件事分开：pending 路已修复，auth 误判是残余并指向 #917 与埋点。
5. 旧快照与账号/站点不匹配（triage 的 C、D 两路）本次没有排除性证据：日志里看不到快照生成时刻与当前登录账号的对比，也没有站点（github.com 与 Enterprise）差异记录；本轮判定不依赖这两路，但若要彻底收口，建议后续在事件一里补 `ghHost` / 站点字段（只记主机名，不记令牌）。
