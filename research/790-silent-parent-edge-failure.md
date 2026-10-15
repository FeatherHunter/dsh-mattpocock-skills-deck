# #790 建票带父票与补边静默失败：今天这棵新树里还能不能复现

> 调查日期 2026-10-15 · 基线 `f3da13da`（地图09收尾：日志出口的同形复制收进内核一份，本房识别路径的失败不再被吞掉）
> 工作树现场：调查开始时 `git status --porcelain` 有 5 个别的会话留下的未提交改动，未动它们 —
> `src/tracker/contract/backend-module.ts`、`src/tracker/rooms/github/checks.ts`、`src/tracker/rooms/github/index.ts`、`src/tracker/rooms/gitlab/index.ts`、`src/tracker/rooms/markdown/index.ts`。
> 调查结束时这份清单又多了 `src/tracker/contract/README.md` 与 `tests/verify-contract-types.js` 两项、并多出几个未跟踪的研究笔记文件 —— 这是同一个工作区里别的会话正在改，不是本次调查碰的（本次只新增了本文件）。
> 本次只做只读调查：没有改任何源码、测试或配置，没有 `git add`/`commit`/`push`，没有跑全链 `npm run verify:all`。

## 一、票面症状原话摘要

报告人链路（2026-09-30，GitHub 后端，仓库 FeatherHunter/dsh-prompt，地图 #78，子票 90–94）：

- 建票带父票号，工具回执声称成功：「票 90 建好了：远程密度档：12宫格/8宫格可选（父票 78）」。
- 紧接着查这张票实际挂靠，读到的是「状态 open，父票（没有）」——回执与实查矛盾。
- 读地图 #78，多次读到「子票 9 张，未关闭 0 张、已关闭 9 张」，4 张 open 票（90/92/93/94）不在计数里。
- 事后批量补边（5 条）读到「这次要补 5 条边，建成 0 条」；单张补边读到「这次要补 1 条边，建成 0 条」——顶层一句话里没有为什么失败。
- 票面期望三条：建票带父票要么真正挂上、要么明确说清挂不上以及为什么；补边要么建成、要么说清「建成 0 条」的原因；地图子票计数要包含已经挂上的开放票。
- 票面 2026-10-02 实施记录列了四条根因（父子边把票面号当数据库编号、建票空 `catch` 吞掉挂父失败、补边顶层不带原因、验边判据把「不知道」当成了「挂上了」）和五处改动，并说明新加 17 条专属门禁全绿。但同一段的验收对照 5 条里 4 条至今标着「待真仓重放」——**这次修复从来没有在真后端上重放过**。

## 二、今天的代码对应物

今天这棵树里，票面写的老路径（`src/host/tools/deckMapLink.js`、`src/host/tracker/backends/github/graph.js`）已经搬到 `src/deck/tools/` 与 `src/tracker/rooms/`。搬家后的对应物如下。

### 2.1 补父边这条路：今天怎么判成功

- 工具入口在 `src/deck/tools/map-link.ts:49`（`deck_map_link` 的定义），父边那一步在 `src/deck/tools/map-link.ts:182-186`，调的是共用函数 `applyParentEdge`。
- 共用判定在 `src/deck/shell/edge-landing.ts:141-163`。写完一条父子边之后，它一定再读一次那张票（第 150 行），然后按读回来的 `parentKey` 判：

  ```ts
  const landedKey = (issueRow.parentKey !== undefined && issueRow.parentKey !== null) ? String(issueRow.parentKey) : ''
  const landedOk = (landedKey === want) || (ev.kind === 'body-line')
  ```

  （`src/deck/shell/edge-landing.ts:155-156`）判不出来就如实写未成：`src/deck/shell/edge-landing.ts:162` 的 `status` 只在 `landedOk` 为真时才是 `'ok'`；读票本身没成功时，证据原话是第 159 行的「写后读回失败：读票没成功（后端原话：…）；写操作已回成功，边可能已建成但没确认」。这一段正是票面根因第 4 条修的东西，今天还在。
- 房那一侧的写路径：`src/tracker/rooms/github/graph.ts:235` 先走原生旗 `gh issue edit <票号> --repo <仓库> --parent <父票号>`；老版本 gh 不认这个旗时才回退裸接口，回退前先取子票的数据库编号、再用 `-F` 传（`src/tracker/rooms/github/graph.ts:262-264`）；父票号不是数字时在 `src/tracker/rooms/github/graph.ts:233-234` 直接判错。票面根因第 1 条（拿票面号 + 小写 `-f` 调裸接口必回 422）从这里看已经被堵死。
- 落点归属的纯规则在 `src/deck/rules/edge-landing.ts:127-152`，它的 `ok` 只表示「判出来了」，未知也回 `true`（文件里第 124-125 行的注释把这条写明了，并点名这是 #790 的教训）。

### 2.2 建票带 `parentKey` 这条路：今天怎么走

- 工具层把父票号塞进建票入参：`src/deck/tools/issue-create.ts:142-148`。
- GitHub 房建完票之后挂父，挂不上就在票上记一笔原话、不再空吞：`src/tracker/rooms/github/issues-write.ts:187-202`（记的是 `parentError`，见第 195 行；票面根因第 2 条的修复保留）。
- 工具层建完之后确实写了读回核对：`src/deck/tools/issue-create.ts:183-194`。但这一段的判据是三样东西取「或」，其中一样就是本报告第三节要说的残留点：

  ```ts
  const createdKey = (issue && issue.parentKey !== undefined && issue.parentKey !== null) ? String(issue.parentKey) : ''
  parentLanded = (landedKey === String(rel)) || (createdKey === String(rel)) || ((ev && ev.kind) === 'body-line')
  if (ev && ev.kind === 'unsupported') parentLanded = false
  ```

  （`src/deck/tools/issue-create.ts:189-191`）

- 一次建整张地图骨架那条路（`src/deck/tools/map-plan-create.ts`）不受下面第三节那条路径影响：它建子票时虽然也带 `parentKey`（`src/deck/tools/map-plan-create.ts:320-325`），但父子边是建完之后另走一遍共用判定落下的（`src/deck/tools/map-plan-create.ts:374` 调 `applyParentEdge`），边到底成没成按读回判，不靠建票回包自带的 `parentKey`。

### 2.3 「建成 0 条」这种回执今天带不带原因

- 组装处在 `src/deck/tools/map-link.ts:245-257`：顶层一句话恒为「这次要补 N 条边，建成 M 条。」，只要有一条不是 `'ok'`，后面一定跟「失败 N 条：<票号>→<目标>：<证据>」。
- 这条路有一个能证明的不变式：`done` 只在逐条明细是 `'ok'` 时才加（`src/deck/tools/map-link.ts:185`、`204`、`215`），所以「`done` 等于 0 而明细非空」必然意味着每一条都是 `failed`，也就必然带上失败摘要。**「建成 0 条、一句话都不说为什么」这种回执在今天的补边这条路上构造不出来。**
- 报给用户的三态：`src/deck/shell/call-shell.ts:46` 的 `DECK_STATUS` 只有三个值 — `ok` / `partial` / `unsupported`，**没有单独表示「未确认」的一档**。「写已回成功、读回没确认」这种情形被并进 `unsupported`（全都没成）或 `partial`（部分没成），区别只写在证据文字里（就是 2.1 引的那句「边可能已建成但没确认」）。

## 三、判定：(c) 部分还在、换了形态

票面原来那条机制 —— 拿票面号加小写 `-f` 调裸接口导致必然 422、建票空 `catch` 吞掉挂父失败、补边顶层只有「建成 0 条」而没有原因 —— 在今天这棵树里已经消除，而且有 `tests/verify-790-parent-edge.js` 这 17 条专属门禁守着（今天跑过：17 条全绿）。

但同一类缺陷今天仍有一条能走通的路径，走法是这样：

1. `src/tracker/rooms/github/graph.ts:283-289` 在写动作回了成功、而紧跟着那次读回失败时（403、超时、网络抖动），**自己在本机拼一张 `parentKey` 已经等于目标值的票交回去**，并且 `ok: true`：

   ```ts
   const finalRes = await getIssue(repo, k, {}, ctx)
   if (finalRes.ok) return finalRes
   // optimistic：若 get 失败，构造本地更新
   const optimisticRaw = { number: Number(k) || k, parent: wantParent ? { number: Number(wantParent) } : null, parentKey: wantParent }
   ```

   （`src/tracker/rooms/github/graph.ts:283-288`）这一段是从更早的提交 `d3fcb3b7` 就留下来的老行为，不是这次搬家新加的。

2. `src/tracker/rooms/github/issues-write.ts:193` 的 `if (pr.ok) issue = pr.data as Issue` 直接把这张没有确认过的票当成建票结果，也不会设 `parentError`（从这一步看，它没有任何失败）。
3. 工具层自己那次读回如实读到父票为空，但 `src/deck/tools/issue-create.ts:190` 的第二样判据 `createdKey === String(rel)` 来自第 2 步那个未经确认的值，于是 `parentLanded` 仍然是真；第 191 行只在证据是「做不到」时才翻案，而这次读到的是「说不好」，翻不了。
4. 回执因此是 `src/deck/tools/issue-create.ts:231-241` 那一支：状态 `ok`，顶层一句话「票 90 建好了：…（父票 78）。返回值就是写后的真状态，不必再读一次。」——与票面记录的 2026-09-30 实测返回逐字同形。

同一处还有一条**不依赖任何偶发故障**的走法，只要那张票的正文里恰好出现了父票号就会命中，而且正文提到票号在日常写法里很常见（例如「归属 #78」「见 #78」）：

- 条件：房在票上记下了挂父失败的原话（`src/tracker/rooms/github/issues-write.ts:195`），读回来 `parentKey` 是空，正文里出现过父票号。
- 结果：`src/deck/tools/issue-create.ts:190` 的第三样判据 `(ev && ev.kind) === 'body-line'` 生效，回执同样是状态 `ok`、顶层「票 90 建好了：…（父票 78）。」，而房记下的后端原话 `parentError` 从头到尾**没有任何一处读它**（全仓搜索下来，写它的只有 `src/tracker/rooms/github/issues-write.ts` 第 35、195、199 行；读它的产品代码没有，只有 `tests/verify-error-single-source.ts:340` 把它列进了一张允许出现的字段清单，以及 `tests/verify-790-parent-edge.js:145` 那个假后端会造它）。
- 为什么这在 GitHub 上是误判：GitHub 这一房挂父只有 `setParent` 一条路，从不把父子关系写进正文（正文兜底是本地 Markdown 的表达方式）。判定把「正文行」也算成「落下了」，对 GitHub 不成立。
- 同一条判据在补边那一路也在用。`deck_map_link` 遇到同样的形状会回状态 `ok`、顶层「这次要补 1 条边，建成 1 条。」，只有逐条明细里写着落点是「正文行」。这一条比建票那条轻：落点栏确实如实写了「正文行」，但它没有把这条边算成没建成。

作为对照，同一场景下正文不提父票号时，建票回的是 `partial` 加上「父子边没挂上（要 78）：写后读回：结构字段与正文里都没找到这条父子关系」——差别只在正文里有没有那串字符。

### 顺带发现的一处措辞问题

`src/deck/rules/edge-landing.ts:39` 给「说不好」这一档的文案是「说不好（这次没读回来，别当它已经建好）」，但 `landingOf`（`src/deck/rules/edge-landing.ts:60-66`）在「读回来了、确实没找到」时也回这一档（`src/deck/rules/edge-landing.ts:152`）。这时说「这次没读回来」与事实不符。实测里逐条明细的落点栏就是这么写出来的。

### 我做了哪些只读验证

- 读了 `tests/verify-790-parent-edge.js`、`tests/verify-829-parent-reread.js`，并按 `node --import ./scripts/ts-hook.mjs tests/verify-790-parent-edge.js` 跑了 #790 的专属门禁：17 条全绿。门禁覆盖了原生旗主路、老版本回退、不存在票如实 404、写后读回缺父判失败、顶层摘要、建票 `partial`、读写一致仍 `ok`。
- 写了两支只读探针（放在系统临时目录 `D:\Temp\`，没有落进仓库）：
  - 第一支用真实 `src/tracker/rooms/github/graph.ts` 配一个脚本化的命令执行器：旗写成功、紧接着那次读回回 403。实得 `ok = true`、回来那张票的 `parentKey = "78"` —— 第 1 步的乐观值确实会交出来。
  - 第二支把工具层接在上述形状上（建票交回 `parentKey` 等于目标、读回如实是空）：`deck_issue_create` 实得状态 `ok`、顶层「票 90 建好了：带父票的新票（父票 78）。返回值就是写后的真状态，不必再读一次。」，逐条明细里落点是「说不好（这次没读回来，别当它已经建好）」。
  - 第三支验的是正文那条：正文写「这一张归属 #78。」、读回父票为空、房记了 `parentError`（`HTTP 422: sub_issue_id must be a database id`），实得状态 `ok` 与「（父票 78）」；正文不写父票号时同一形状回 `partial` 与「父子边没挂上（要 78）」。

## 四、不确定的地方

1. 第 1 步那次「写回路成功、紧跟着读回失败」需要一个真实的读回抖动（403、超时、网络中断）。我没有在真仓库上重放过（票面自己也没做过），所以说不清真机上多久撞一次。但这条路径是否成立不取决于频率 —— 第 3 步的判据本身就把一个「自己承认没确认」的值当成了确认，这才是要改的地方。
2. 本地 Markdown 房有一处形状类似但更轻的地方：`src/tracker/rooms/markdown/issues-create.ts:348-351` 把**请求的父票号**当作 meta 的 `parentKey` 传给解析，而 `src/tracker/rooms/markdown/parse.ts:280-290` 在票文件里没有父注释时就用 meta 交进来的值。也就是说这一房的「写后读回」并不是独立证据。要证明它能变成实际的错报，需要一个「写文件成功但父注释没落上」的假文件服务，我没有做（不许改测试）。Markdown 的父注释和正文是同一份写入，所以我不认为现实中容易撞上，但没验证到。
3. GitLab 房挂亲缘那一步是空捕获（`src/tracker/rooms/gitlab/issues.ts:265-275`，原文注释「亲缘链失败不拦建票主流程，票已建成，后续可补挂」），后端原话因此丢掉。它与 GitHub 的差别是：建票结果里不会带上一个编出来的 `parentKey`，所以工具层靠读回仍会判成 `partial`，不会静默成功；但「后端原话丢掉、只留一句通用的没挂上」这一点在两边都存在。
4. 探针用的都是脚本化的命令执行器，没有真后端参与；`npm run typecheck` 我没有跑（本次没改代码，跑它与本票的疑问无关）。`verify-deck-tools-matrix.js` 据票面记录本来就有一条与本票无关的存量红，我没有去动它。

## 五、若真要处理，该怎么做

把 `src/deck/tools/issue-create.ts:189-190` 那两个「或」项收掉或降级：建票回执判父子成没成，只认工具自己那一次写后读回（读回来的 `parentKey` 等于目标），契约交回来的 `parentKey` 只在读回确实没回来时用来避免误报失败，不再与读回平级；同时把 `body-line` 这一项限定在真的会写正文兜底的后端上，GitHub 这一房不接受「正文提到票号」当作父子边落下的证据（补边那一路的 `src/deck/shell/edge-landing.ts:156` 同一处判据要一起看）。顺带让工具层读一下房已经记下的 `parentError`，把后端原话带进顶层那一句话，别让它白记。
