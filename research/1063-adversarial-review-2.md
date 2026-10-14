# #1063 返工复验（第二轮对抗式审查）

- 复核对象：commit `755f14f2`「修掉对抗式审查在 GitLab 房查出的九处缺陷，并给九条新能力补上真正的行为断言」（15 文件 +1809/−95，已推 `main`）
- 上一轮报告：`research/1063-adversarial-review.md`（453 行）
- 本机环境：Windows，命令一律 `pwsh`；**没有 GitLab 实例、没有 glab 登录**，所有远端行为只能纸面核对
- 立场：不是给返工盖章，是试着把它打穿。四条线各自独立做了一遍：九条能力逐条换空壳跑完整入口（18 次）、把新增的 ✗ 反例反向喂进正向断言用的同一批判据函数、官方文档与 GitLab/glab 源码一手核对、干净工作树复跑与统计口径复核。

---

## 总判

**本次返工站得住 —— 上一轮那三条核心指控都被真正堵上了，但还有一处必须返工，另有应收尾的两处。**

先说站得住的部分，全部是我亲手跑出来的，不是转述：

1. **九条能力逐条换成空壳，没有一条能全过。** 两种空壳（一律 `fail(env,'还没做')` / 形状全对但内容是假：数填 0、清单回空数组、游标回 null 而账目假成）× 九条能力 = 18 次跑完整契约入口，18 次全部 `exit=1`、末行 `CONTRACT SKELETON NOT SELF-CONSISTENT`，每次都至少红 1 条具名断言（多数红 3～13 条）。方向一没打穿。
2. **「干净工作树 886 passed, 4 failed、末行 CONTRACT SKELETON OK、退出码 0」属实。** 我在只含 `755f14f2` 的 detached 工作树上复跑得到同样的三样；4 条 FAIL 就是故意埋的 `violating-stub` 四条。
3. **9 条新增的 ✗ 反例不是空转。** 它们喂的是正向断言用的**同一个函数对象**（`countsAnswerCheck` / `pageAnswerCheck` / `labelListAnswerCheck` / `labelBatchAnswerCheck`），不是为 probe 另写的宽松函数；我又用 21 组「坏样本 / 合规样本」双向对照独立验过这些判据两边都分得清（详见第二节）。
4. **方向三的一手核对逐字对得上，没有找到新的编造引文。** `include_ancestor_groups` 默认 `true`、`PLANNER = 15`、`-s/--skipGitInit`、`link_type` 只有三值、「平台有原生父子层级」——都在官方文档或 GitLab/glab 源码里找到了原文。上一轮抓到的那类「把编的话安到契约头上」，这一轮没有再出现。
5. **九道门禁我也复核为全绿**（tsc 零输出 + 契约入口 + 另外七道 exit 0，见第四节）。

再说要改的地方：

| # | 轻重 | 位置 | 一句话 |
| --- | --- | --- | --- |
| A | **一般（必须改）** | `tests/tracker-contract/sections/listPage.js:325` | `listPage` 一旦回 `ok:false`，整段崩掉：886 条里这一段 59 条断言一条都不跑，只剩一条 `listPage · section-crash`。门禁仍然红（所以不是我打穿了），但「空壳被逮住」这件事不是靠它新加的断言完成的，而是靠一个没做 `ok` 守卫的解引用抛出 TypeError |
| B | 轻微（应改） | `tests/tracker-contract/sections/listPage.js:333`（本次新增行） | 把「结果超过 10000 条时远端不返回的响应头」说成 `rel="next"`；官方文档列的是 `x-total`、`x-total-pages`、`rel="last"`，没有 `rel="next"`。同一句错话在 `src/tracker/rooms/gitlab/labels-ops.ts:299` 早已存在，本次把它复制进了新文件 |
| C | 轻微（应改） | `tests/tracker-contract/sections/room-gitlab-extras.js:5`（本次新增行） | 「对抗式审查…**发现 10** 说」引错了编号：报告里的发现 10 是 `initProject` 没传 `-s/--skipGitInit`；那句结论在攻击面表第 10 行（`:37`）与返工建议第 1 条（`:442`），而且原文写的是「**其余八条**」，注释写成了「五条」 |
| D | 口径（应改） | 提交信息 | 「两处合计新增 99 条断言」对不上：实测**执行到的断言净增 94**（返工前 792 通过 → 返工后 886 通过；三处改动 +37、新段 +57）。静态数 `await assert(` 站点是 +95，也不是 99 |

结论口径：**主体三条声称（九条都被断言管住、干净树全绿、✗ 反例有判别力）全部成立；发现 A 属于本次新增代码的缺陷，应当返工；B、C、D 是文档与口径层面的收尾。**

---

## 一、方向一：九条能力逐条换空壳（18 次完整入口）

### 怎么做的

不改仓库文件，只在 `D:\Temp\adv2-1063`（`755f14f2` 的 detached 工作树）里追加一个探针文件，包一层 `gitlabBackend.create`：

```js
// D:\Temp\adv2-probe\shell-patch.ts（追加到临时树的 src/tracker/rooms/gitlab/index.ts 末尾）
const origCreate = gitlabBackend.create
gitlabBackend.create = (ctx) => {
  const t = origCreate(ctx)
  const op = (process.env.DSH_SHELL_OP || '').split(':')[0]
  const fake = (process.env.DSH_SHELL_OP || '').endsWith(':fake')
  // op 命中哪一条，就把那条方法换成 fail 壳 / 形状对内容假的壳
  return t
}
```

跑法（每次都跑完整入口，不看单段）：

```powershell
cd D:\Temp\adv2-1063
$env:DSH_SHELL_OP='listLabels:fake'
node --import ./scripts/ts-hook.mjs tests/verify-tracker-contract.js   # 记 exit / passed / FAIL 名单
```

### 结果（`D:\Temp\adv2-probe\matrix\*.txt`、`summary.csv`）

| 能力 | 一律失败壳 | 形状对内容假壳 | 被哪些断言逮住（新增红的条数） |
| --- | --- | --- | --- |
| `counts` | 881 passed / 9 failed（红 5） | 880/10（红 6） | `counts · 真实 gitlab 后端：…` 五条（三个数、URL 带 scope=all、state 本地收窄 ×3）；假壳多红一条「issues_statistics 报错 → 整体失败，不许给三个零」 |
| `listPage` | 827/5（**红 1：`listPage · section-crash`**） | 873/17（红 13） | 假壳红 13 条具名断言；失败壳见发现 A |
| `listLabels` | 881/9（红 5） | 881/9（红 5） | `labels · 真实 gitlab 后端：…`（清单必须真的全，空数组被当场逮住） |
| `setLabelColors` | 879/11（红 7） | 879/11（红 7） | 逐条记账断言（applied/failed 名单与 reason.kind） |
| `getCurrentUser` | 881/9（红 5） | 881/9（红 5） | `room-gitlab-extras · getCurrentUser：…` |
| `getRepoPermissions` | 876/14（红 10） | 877/13（红 9） | 五档 + 两格取高 + 「不许拿 false 顶上」 |
| `listSubIssues` | 882/8（红 4） | 883/7（红 3） | 画出来的子票名单、dropped、total=fetched、missing=0 |
| `initProject` | 876/14（红 10） | 877/13（红 9） | 命令 token、回执四格、push 失败如实回报 |
| `getRepoKey` | 881/9（红 5） | 883/7（红 3） | 三层兜底各一条 + 不许编名字 |

三种假壳里各有 1～2 条断言「侥幸通过」，原因都是**假答案恰好等于该档的正确值**（Guest(10) 就是 `{push:false,triage:false}`；真的没有关联行时就该回空表；认不出来就该回 `null`；假回执里硬编码的全路径恰好正确）。它们不构成漏洞：同一能力下仍有 3 条以上断言变红，18 次全部 exit=1。

### 发现 A（一般，必须改）：`listPage` 回 `ok:false` 时整段崩溃

- 位置：`tests/tracker-contract/sections/listPage.js:325`（本次新增行，落在新增 hunk `@@ -214,15 +248,122 @@` 内）

```js
const p2 = await gl.listPage(ref('gitlab'), { state: 'closed' }, { cursor: p1.data.nextCursor, limit: 2 }, glProbeCtx(s1))
//                                                                          ^^^^^^^^^^^^^^ 上一行 p1 只做了 `p1.ok === true && …` 的读法，这里没有守卫
```

- 事实：`p1` 是空壳回答（`{ok:false, error:{kind:'env',…}}`）时 `p1.data` 是 `undefined`，这一行抛 TypeError，整段 `run()` 抛出；runner 把它记成 `listPage · section-crash`，这段其余 58 条断言一条不跑（886 − 827 = 59）。
- 可复现构造：

```powershell
cd D:\Temp\adv2-1063
$env:DSH_SHELL_OP='listPage'
node --import ./scripts/ts-hook.mjs D:\Temp\adv2-probe\sec-stack.mjs D:\Temp\adv2-1063 listPage.js
# → THREW: TypeError: Cannot read properties of undefined (reading 'nextCursor')
#     at Module.run (file:///D:/Temp/adv2-1063/tests/tracker-contract/sections/listPage.js:325:88)
$env:DSH_SHELL_OP=''
node --import ./scripts/ts-hook.mjs D:\Temp\adv2-probe\sec-stack.mjs D:\Temp\adv2-1063 listPage.js
# → assertions=59 failed=0
```

- 后果：门禁仍然红（`CONTRACT SKELETON NOT SELF-CONSISTENT`、exit 1），所以**不是判据失效**；但「这一段新加的断言能逮住空壳」这句话在 `listPage` 上是不成立的 —— 逮住空壳的是崩溃，新加的 13 条判据一条都没机会说话。真正想验的「URL 带没带 state / per_page 收没收 / 游标语义对不对」，在实现坏掉时全都得不到答案。
- 我没能打穿的部分：我没能构造出「`listPage` 是空壳而这一段仍全绿」的情形（试了失败壳与假壳两种，假壳红 13 条、失败壳崩掉）；也没有发现崩溃被静默吞掉（exit 仍是 1）。我能指出的是**逮住方式的退化**，不是漏网。

---

## 二、方向二：那 9 条 ✗ 反例自证不是空转

### 2.1 喂的是不是同一个函数对象：是

| 新 ✗ 反例位置 | 喂进哪个判据 | 同一段里用同一判据的正向断言 |
| --- | --- | --- |
| `tests/tracker-contract/sections/counts.js:310`、`:311` | `countsAnswerCheck(SHELL, {open:15,closed:5,total:20})` | `counts.js:291`（同一个 `countsAnswerCheck`） |
| `tests/tracker-contract/sections/listPage.js:364`、`:365` | `pageAnswerCheck(SHELL, {items:2,nextCursor:'2',total:5})` | `listPage.js:318`、`:326`、`:328`、`:339`、`:340` |
| `tests/tracker-contract/sections/labels.js:531`、`:532` | `labelListAnswerCheck(SHELL_LIST, wantAll)` | `labels.js:486`、`:91` 那一段（`wantAll` 是测试自己脚本化出来的 103 条全量） |
| `tests/tracker-contract/sections/labels.js:534`、`:535`、`:536` | `labelBatchAnswerCheck(changes, SHELL_BATCH, want)` | `labels.js:495`、`:498`、`:499`、`:103` |

（任务书里说的「9 条」= 三处返工段各带的空壳反例：counts 2 + listPage 2 + labels 5。新段 `room-gitlab-extras.js` 另带 21 条，见 2.3。）

这四个判据的强度也核过了：`countsAnswerCheck`（`counts.js:121-131`）先过 `countsShapeCheck`、再逐格比三个数；`pageAnswerCheck`（`listPage.js:112-126`）先过 `pageShapeCheck`（`data` 只许有 `items`/`nextCursor`/`total` 三个键、行不许带 `number`、`state` 只许小写两态）再比条数/游标/总数；`labelListAnswerCheck`（`labels.js:222-227`）要求 `ok === true` 且清单与测试自己知道的全量一致；`labelBatchAnswerCheck`（`labels.js:240-266`）要求 `ok === true`、逐条记账、且 `applied`/`failed` 名单与每个失败项的 `reason.kind` 都与脚本化的远端回话对得上。所以「一律失败」与「形状对内容假」两类空壳都过不了它们。

### 2.2 把期望反过来会不会立刻变红：会

我用自己写的对照脚本（`D:\Temp\adv2-probe\checkers-both-sides.mjs`，只读仓库、直接 import 那四个模块的具名导出）把 21 组样本同时喂进去：每组给一个「坏样本」和一个「合规样本」，看判据是不是两边都分得清。

```powershell
cd D:\Temp\adv2-1063
node --import ./scripts/ts-hook.mjs D:\Temp\adv2-probe\checkers-both-sides.mjs D:\Temp\adv2-1063
```

结果：21 组里 20 组双向都分得清（坏样本违规数 ≥1、合规样本 0）；唯一那组「分不清」是**我自己配错了对**——`honestFailureCheck` 要的本来就是「如实失败」，我把失败壳当坏样本喂进去，它当然判合规（这正是它的职责）。把这一组换成正确的坏样本（`{ok:true,data:{push:false,triage:false}}`，把「不知道」画成「没有权限」）后 21/21 双向都分得清。也就是说：把 ✗ 反例的期望从「违规数 > 0」翻成「=== 0」，这 21 组**全部立刻变红**，probe 不是恒真。

### 2.3 `room-gitlab-extras.js` 里有没有「只验证测试自己造的桩数据」的断言：没找到

- 该段 21 条 ✗ 反例（`:296`、`:301`、`:306`、`:323`、`:405`、`:410`、`:415`、`:439`、`:506`、`:511`、`:516`、`:521`、`:546`、`:659`、`:664`、`:694`、`:757`、`:762`、`:785`、`:806`、`:824`）确实**不驱动房间代码**——它们是把坏样本喂给导出在 `:81`/`:100`/`:119`/`:138`/`:162`/`:181` 的六个检查器。但这不算「自证空转」：它们是判据的单元自证，文件头 `:38-40` 明写了这件事（「检查器是纯函数，把故意做坏的样本喂给同一个检查器 → 清单必须非空」），而**驱动房间代码的是同一批判据用在正例上**——矩阵证明了这一点：把五条能力逐条换空壳，这一段分别红 3～10 条具名断言。
- 只有一处需要注意的读法：`room-gitlab-extras.js:271-275` 这类「只问了一次那条命令」的断言查的是 `sc.calls`（桩记下的调用记录）。它验的是房间**发出了什么**，而 `calls` 由房间经桩产生，不是测试自己塞进去的；矩阵里换空壳后这条也红了（空壳不发命令）。
- 我没能打穿的部分：我没能让这一段任何一条 probe 变成恒真，也没找到「断言只查测试自己造的数据、房间可以随便坏」的例子。

---

## 三、方向三：源码与文档修正的一手核对（不采信注释里的引文）

结论：**这一轮没有再出现编造引文**。逐条对照如下（全部是我今天 2026-10-15 实拉的页面/源码，不是从注释里抄的）。

| 位置 | 注释的说法 | 一手来源 | 核对结果 |
| --- | --- | --- | --- |
| `src/tracker/rooms/gitlab/labels-ops.ts:47-54`、`:253-260` | `include_ancestor_groups` 默认 `true`，不写就会带上层分组标签 | https://docs.gitlab.com/api/labels/ 「List all project labels」属性表 | **逐字一致**：`\| include_ancestor_groups \| boolean \| no  \| Include ancestor groups. Defaults to \`true\`. \|` |
| 同上 | 改色走 `PUT /projects/:id/labels/:label_id`，只认项目自己的标签 | 同一页 `PUT …/labels/:label_id` 属性表 | 表里**没有** `include_ancestor_groups`；`label_id` 写作「The ID or title of a project's label」→ 与「只认项目自己的标签」一致。「分组标签远端回 404」是推断，不是文档原文（见第五节） |
| `src/tracker/rooms/gitlab/identity-ops.ts:62-79` | 「编辑议题（含元数据与锁定）」与「关闭/重开议题」都从 Planner(15) 起 | https://docs.gitlab.com/user/permissions/ 「Project planning → Project permissions for issues」表 | **两行核对一致**：`Edit issues, including metadata and item locking` 与 `Close and reopen issues` 的 Guest 格都是空的、Planner 起为 ✓ |
| 同上 | 档位数字出自 `lib/gitlab/access.rb`：`PLANNER = 15` | https://gitlab.com/gitlab-org/gitlab/-/raw/master/lib/gitlab/access.rb | **逐字一致**：`GUEST = 10`、`PLANNER = 15`、`REPORTER = 20`、`SECURITY_MANAGER = 25`、`DEVELOPER = 30`、`MAINTAINER = 40`、`OWNER = 50` |
| `identity-ops.ts:73` | 契约对 `triage` 的定义是「能不能整理别人的票（改指派、关别人的票）」（`contract/results.ts:104`） | 仓库自身 | **逐字一致**：`src/tracker/contract/results.ts:104` 就是这句 |
| `identity-ops.ts:76-77` | 「契约里没有『Reporter 及以上』那句话（`RepoPermissions` 只定义了两个布尔）」 | 仓库自身 | **一致**：`results.ts:101-106` 只有 `push` / `triage` 两个布尔，没有一个档位数字 |
| `src/tracker/rooms/gitlab/init-project.ts:25-37` 及其调用点 | `-s/--skipGitInit` 要传 | https://docs.gitlab.com/cli/repo/create/ | **逐字一致**：`  -s, --skipGitInit            Skip local repository setup (skips both 'git init' and cloning).` |
| 同上 | 源码里那一段的门是 `if !skipGitInit && …`；带一个名字参数时会问「Create a local project directory for <全路径>?」，答是就在新子目录里 `git init` + `git remote add origin` | https://gitlab.com/gitlab-org/cli/-/raw/main/internal/commands/project/create/project_create.go | **一致**：`BoolP("skipGitInit", "s", false, …)`；`if !skipGitInit && f.IO().IsInteractive() { doSetup = true; … Confirm(…, "Create a local project directory for %s?", project.NameWithNamespace) }`；`repoInitializer` = `git init <path>` + `git -C <path> remote add origin -- <url>`。注释自陈「宿主没有终端时 glab 本来就不做本地初始化」，与源码的 `IsInteractive()` 条件一致，没有把 `-s` 说成唯一门 |
| `src/tracker/rooms/gitlab/README.md` 第 1 节 | 响应头是本房客户端丢的，不是 glab 没有；`glab api` 有 `-i`（`--include`）与 `--paginate` | https://docs.gitlab.com/cli/api/ | **逐字一致**：`-i, --include  Include HTTP response headers in the output.`、`--paginate  Make additional HTTP requests to fetch all pages of results.` |
| `README.md` 第 3 节、`docs/tracker/capability-gitlab.md:54-55`、`src/tracker/rooms/gitlab/sub-issues.ts` 文件头 | 平台有原生父子层级（免费档就有），只是本房走的 REST `issue links` 没有层级类型 | https://docs.gitlab.com/user/work_items/child_items/ 与 https://docs.gitlab.com/api/issue_links/ | **一致**：child items 页 `Tier: Free, Premium, Ultimate`，且写明「A task that can be a child of an issue」「An issue … assigned to an epic」；issue links 页 `link_type` 「Possible values are `relates_to`, `blocks` and `is_blocked_by`」——**正好三种，没有层级那一种** |
| `src/tracker/rooms/gitlab/counts.ts:35-37`、`pages.ts:232-236` | 两处 catch 补的降级 reason 用登记表里已有的值 | 仓库自身 `src/tracker/rooms/gitlab/read-log.ts:80-90` | **一致**：`counts:transport` 与 `listPage:transport` 都在 `READ_DEGRADED_REASONS` 里 |
| `tests/tracker-contract/sections/room-gitlab-extras.js:283` | 与 `sections/idempotency.js:301` 的 `remoteCtx` 同一套缝 | 仓库自身 | **一致**：`tests/tracker-contract/sections/idempotency.js:301` 就是 `function remoteCtx(scripted) {` |

### 发现 B（轻微，应改）：新注释把「10000 条时被撤掉的响应头」说成 `rel="next"`

- 位置：`tests/tracker-contract/sections/listPage.js:333`（本次**新增**行，hunk `@@ -214,15 +248,122 @@` 内）

```
//   空表。这是设计代价，不是错误：少取一次的办法（读响应头的 rel="next"）在结果超过 10000 条时
//   远端根本不返回那一格，反而会变成静默截断。
```

- 一手来源（https://docs.gitlab.com/api/rest/#pagination-response-headers，2026-10-15 实拉）原文：

```
For performance reasons, if a query returns more than 10,000 records, GitLab doesn't return the following headers:
- `x-total`.
- `x-total-pages`.
- `rel="last"` `link`
```

- 事实：被撤掉的三样是 `x-total`、`x-total-pages`、`rel="last"`，**清单里没有 `rel="next"`**。所以「读 `rel="next"` 这条路在超过 10000 条时会失效、会变成静默截断」这句在官方文档里找不到依据；真正支撑那段设计代价的是 `x-total` 拿不到（这也正是它要表达的意思）。这句不是引文（没打引号），属于「把推断说成事实」。
- 同族扩散：`src/tracker/rooms/gitlab/labels-ops.ts:299` 早就写着「为什么不判响应头里的 `rel="next"`：GitLab 在结果超过 10000 条时不返回这一格」。用 `git show 755f14f2~1:src/tracker/rooms/gitlab/labels-ops.ts | Select-String 'rel="next"'` 确认它在**返工前就存在**（不是本次新增）；但本次把同一句话复制进了新的测试注释里。上一轮审查已经因为「编造引文」判过一次，这类未经核实的断言不该再扩散。
- 修法：把那半句改成 `x-total`（有官方依据），或明确标注「未核实」。
- 我没能打穿的部分：**我没有真机**（没有超过 10000 条记录的仓库），因此我**不能断言** `rel="next"` 在 >10000 条时一定还会返回。我能确定的只有「官方撤头清单里没有它」。所以这条的结论口径是「这句注释没有依据」，不是「它写反了」。

### 发现 C（轻微，应改）：新文件引错了审查报告的编号与条数

- 位置：`tests/tracker-contract/sections/room-gitlab-extras.js:5`（本次新增行）

```
 * 对抗式审查（`research/1063-adversarial-review.md`）发现 10 说：九条新能力里，`getCurrentUser`、
 * `getRepoPermissions`、`listSubIssues`、`initProject`、`getRepoKey` 五条**在整个仓库里没有任何一条断言
 * 真去要过一次数据** —— 有可能是函数在、逻辑对，也有可能明天被人改坏而门禁不响。
```

- 事实一（编号）：`research/1063-adversarial-review.md:282` 的「### 发现 10（轻微）」讲的是 **`initProject` 没传 `-s/--skipGitInit`**。上面那句结论实际在报告 `:37`（「十条攻击面」表的第 10 行）与 `:442`（返工建议第 1 条）。
- 事实二（条数）：报告 `:37` 写的是「九条里只有 `counts` 有一条针对 GitLab 的探针，而它刚被放宽；**其余八条**在整个仓库里没有任何一条断言验过它们真能拿到数据」——是八条，不是五条。五条是这个新段实际覆盖的条数（另外三条由本次改的三处承担），把「五条」挂到「报告说」上是错的。
- 可复现构造：

```powershell
Select-String -Path research\1063-adversarial-review.md -Pattern '^### 发现 10'   # → initProject 没传 -s/--skipGitInit
Select-String -Path research\1063-adversarial-review.md -Pattern '其余八条'      # → :37
Select-String -Path tests\tracker-contract\sections\room-gitlab-extras.js -Pattern '发现 10'  # → :5
```

- 我没能打穿的部分：这句注释不影响任何断言行为；它的实质结论（那五条此前没有行为断言）我核对为真，本次也确实补上了。

---

## 四、方向四：「全绿」与统计口径

### 4.1 干净工作树的复跑：属实

```powershell
git worktree add --detach D:\Temp\adv2-1063 755f14f2
cmd /c mklink /J D:\Temp\adv2-1063\node_modules D:\dsh-plugin\dsh-mattpocock-skills-deck\node_modules
cd D:\Temp\adv2-1063; node scripts/build.mjs      # 补 gitignore 掉的 .js 产物，缺了会 ERR_MODULE_NOT_FOUND
node --import ./scripts/ts-hook.mjs tests/verify-tracker-contract.js
# → EXIT: 0
# → contract-test: 886 passed, 4 failed
# → CONTRACT SKELETON OK
```

4 条 FAIL：`violating-stub · map title->title`、`· empty.labels present(EMPTY)`、`· log.labels EMPTY`、`· EMPTY≠MISSING labels` —— 就是故意埋的那四条。

### 4.2 主工作树那条 `labels · section-crash — Error: fs unavailable` 的归因：不是本次提交

- 我第一次在主工作树复跑时（当时 `src/tracker/rooms/markdown/*` 有另一个会话的未提交改动）：`774 passed, 5 failed`，多出 `FAIL labels · section-crash — Error: fs unavailable`、末行 `CONTRACT SKELETON NOT SELF-CONSISTENT`、exit 1。注意它不是「多一条 FAIL」而已：整个 labels 段崩掉，886 − 774 = 112 条断言一条没跑。
- 调用栈（用 `D:\Temp\adv2-probe\labels-stack.mjs` 直接 import 该段并打印 `e.stack`，因为仓库 runner 把异常 `String()` 掉了）：`tests/tracker-contract/sections/labels.js:737` → `src/tracker/rooms/markdown/label-colors-ops.ts:166` `listLabels` → `:134` `collectAllLabels` → `:69` `collectTicketLabelNames` → `src/tracker/rooms/markdown/issues-locate.ts:59` `listEfforts` → `src/tracker/rooms/markdown/read.ts:109` `listDirOrMissingIsEmpty` → `:81` `listDir` → `:42` `tagError` 抛 `Error: fs unavailable`。
- 栈上的 src 文件全在 `src/tracker/rooms/markdown/`，而 `git show --stat 755f14f2` 里**一个 markdown 文件都没有**（本次 15 个文件：`src/tracker/rooms/gitlab/` 八处、`docs/tracker/capability-gitlab.md`、`research/1063-adversarial-review.md`、四个测试文件）。`labels.js` 虽然是本次动过的文件，但它的四个 hunk 是 `@@ -17,8 +17,9 @@`、`@@ -27,6 +28,11 @@`、`@@ -202,6 +208,63 @@`、`@@ -368,31 +431,109 @@` —— 崩的那一行 `:737`（markdown/GitHub 那一段的调用点）**不在任何 hunk 里**。
- 事后追认：我干活期间那批 markdown 改动被提交成了 `71cca385`「Markdown 房按契约补齐 22 处对不上的地方…」（`git diff --stat 755f14f2..HEAD` 见 `src/tracker/rooms/markdown/label-colors-ops.ts`、`issues-locate.ts`、`read.ts` 都在其中，正是栈上那几个文件）。在当前 HEAD（`a519ce10`）上重跑同一入口：**`886 passed, 4 failed`、`CONTRACT SKELETON OK`、exit 0**。
- 结论：那条崩溃与 `755f14f2` 无关，是当时在飞的另一批改动造成的，现已随 `71cca385` 消失。
- 一个时间点上的注记：我收尾时主工作树又出现了新的未提交改动（`M src/tracker/rooms/markdown/issues-create.ts`，另一个会话在改），所以「主工作树现在绿不绿」是随时会变的快照；能稳定复现的是「只含 `755f14f2` 的干净树 886/4/OK」。

### 4.3 `tests/verify-tracker-contract.js` 的口径有没有被动手脚：没有

本次它只改了两行（`git diff 755f14f2~1 755f14f2 -- tests/verify-tracker-contract.js` 全文两处）：

```diff
+import roomGitlabExtrasSection from './tracker-contract/sections/room-gitlab-extras.js'
-for (const s of [contractSection, …, idempotencySection]) {
+for (const s of [contractSection, …, idempotencySection, roomGitlabExtrasSection]) {
```

统计、预期失败点名（四条 `violating-stub`）、`sectionsOk` 过滤器、末行判词一个字符都没动。另外核了新段的段名前缀是 `room-gitlab-extras · `（不以 `gitlab-` 开头），所以它**落在** `sectionsOk` 的统计范围里（不会被 `startsWith('gitlab-')` 那个排除条件吞掉）——这一段如果红，门禁就会红（我在五个 extras 空壳变体上验证过确实会红）。

### 4.4 发现 D（口径）：断言条数实测是 94，不是 99

同一入口在返工前那棵树上（`D:\Temp\adv2-parent`，detached `616ed477` = `755f14f2~1`）：`792 passed, 4 failed`、`CONTRACT SKELETON OK`、exit 0。于是**执行到的断言净增 94**。分段实测（直接 import 各段、数 `run()` 返回的条数）：

| 段 | 返工后 | 返工前 | 净增 |
| --- | --- | --- | --- |
| `sections/counts.js` | 38 | 31 | +7 |
| `sections/listPage.js` | 59 | 45 | +14 |
| `sections/labels.js` | 112 | 96 | +16 |
| `sections/room-gitlab-extras.js` | 57 | 不存在 | +57 |
| 合计 | | | **+94** |

静态数 `await assert(` 站点是 +95（counts 38/31、listPage 59/44、labels 110/94、extras 57/0），也对不上「99」；三处改动的净增是 37（不是任务书里转述的「42」）。我数不到任何得 99 的口径（就算把 4 条故意失败也算进去是 98）。

### 4.5 九道门禁：复核为全绿

```powershell
# 在 D:\Temp\adv2-tsc（另一棵只含 755f14f2、未加任何探针的工作树）里，先 node scripts/build.mjs 再：
node node_modules/typescript/bin/tsc -p src/tracker/tsconfig.json      # exit=0，(zero output)
# 在 D:\Temp\adv2-1063 里（探针加了但环境变量没开，处于惰性）：
node --import ./scripts/ts-hook.mjs tests/verify-tracker-contract.js                 # exit=0  CONTRACT SKELETON OK
node --import ./scripts/ts-hook.mjs tests/verify-capability-register.ts              # exit=0  能力登记三处对齐
node --import ./scripts/ts-hook.mjs tests/verify-1161-rooms-assembly-samples.ts      # exit=0  4/4
node --import ./scripts/ts-hook.mjs tests/verify-1136-room-cross-sample.ts           # exit=0  4/4
node --import ./scripts/ts-hook.mjs tests/verify-golden-receipts.ts                  # exit=0  9 个工具回执逐字节一致（10 项）
node --import ./scripts/ts-hook.mjs tests/verify-contract-types.js                   # exit=0  契约层类型门禁生效
node --import ./scripts/ts-hook.mjs tests/verify-log-fields.js                       # exit=0  字段白名单（218 项断言）
node --import ./scripts/ts-hook.mjs tests/verify-log-count.js                        # exit=0  计数门禁（136 项断言）
```

（第一次 tsc 我报错过一次：在被我追加探针的那棵树上跑，会在 `src/tracker/rooms/gitlab/index.ts:348` 报 `TS2591: Cannot find name 'process'` —— 那是我自己的探针代码，不是仓库的错。换到未加探针的干净树后 exit=0、零输出。）

---

## 五、我没能验证的部分

1. **没有真 GitLab、没有 glab 登录**：本次所有「远端会怎样」的判断都只是纸面核对（官方文档 + GitLab/glab 源码），没有发过一次真实请求。以下几条因此只能停在文档层面：
   - 「分组标签走 `PUT /projects/:id/labels/:label_id` 会 404」——文档只写了 `label_id` 是「项目自己的标签的 ID 或标题」，404 这个具体结果是推断；
   - `include_ancestor_groups=false` 在真机上是否真的把祖先分组标签滤掉、以及**分页**在关掉继承之后的行为；
   - `?simple=true` 这个参数（`room-gitlab-extras.js:226-229` 自己就声明了「源码级已核实、没真发过请求」）；
   - `glab repo create -s` 在无终端宿主里的真实行为、以及 `initProject` 真跑一次建仓 + push 的副作用（这条路会真的改世界，我没跑）；
   - `rel="next"` 在结果超过 10000 条时到底还在不在（发现 B 的边界，见上）。
2. **没有量过真实分页**：`listPage` 的游标语义、`counts` 的 `issues_statistics` 回包形状、`listSubIssues` 的 `.../issues/7/links` 明细，全部是脚本化桩驱动的；真机上各档回包里 `permissions` 的形状、`X-Total` 是否可用，我都没量过。
3. **只跑了 tracker 契约入口与九道门禁**，没有跑全量 `npm test` / `node scripts/verify-all.mjs`（那是一条长链，且与本票关系不大）；因此「别处门禁是否被这次改动碰坏」我只能给到「改动集中的那九道 + 契约入口」这一层。
4. **官方文档是活文档**（`docs.gitlab.com` 今天 2026-10-15 的状态，多数页面直接跟 master）：自管理老版本上 `include_ancestor_groups`、Planner 档位、`link_type` 三值这些未必一致。我没有版本矩阵。
5. **方向一我打不穿**：18 次里没有一次「某条能力是空壳而新增断言全过」；唯一需要打折的是 `listPage` 那次（被崩溃逮住，见发现 A）。
6. **返工的声称里我只核到 94 条断言**：99 这个数字我复现不出来（见发现 D）；如果作者用的是别的统计口径，需要他自己给出算式。

---

## 六、复现我做过的事（临时物清单）

- `D:\Temp\adv2-1063`：`755f14f2` 的 detached 工作树（**其 `src/tracker/rooms/gitlab/index.ts` 末尾被追加了空壳探针，已随工作树一起删掉**）
- `D:\Temp\adv2-parent`：`616ed477`（= `755f14f2~1`）的 detached 工作树，量返工前基线用
- `D:\Temp\adv2-tsc`：第三棵只含 `755f14f2` 的干净树，专供 tsc
- `D:\Temp\adv2-probe\shell-patch.ts`：空壳探针（按 `DSH_SHELL_OP=<能力>[:fake]` 惰性生效）
- `D:\Temp\adv2-probe\matrix.ps1` 与 `matrix\*.txt`、`summary.csv`：18 次矩阵的原始日志
- `D:\Temp\adv2-probe\checkers-both-sides.mjs`：21 组判据双向对照
- `D:\Temp\adv2-probe\sec-stack.mjs`：单段执行 + 真实栈打印（仓库 runner 只打 `String(e)`）
- `D:\Temp\adv2-probe\labels-stack.mjs`：主工作树那条 fs 崩溃的栈
- 收尾：两个/三个工作树的 `node_modules` 目录联接先 `cmd /c rmdir`，再 `git worktree remove --force`
