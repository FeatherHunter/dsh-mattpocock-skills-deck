# 898 阻塞边互相覆盖：在今天这棵新树里还能不能走到

调查日期：2026-10-15。只做只读调查，没有改任何源码、测试或配置。

记录现场：当前提交是 `f3da13da`（地图09收尾：日志出口的同形复制收进内核一份，本房识别路径的失败不再被吞掉（#1182））。
工作树有另外几处未提交的改动，属于别的会话，本次没有动它们：
`src/tracker/contract/backend-module.ts`、`src/tracker/rooms/github/checks.ts`、`src/tracker/rooms/github/index.ts`、
`src/tracker/rooms/gitlab/index.ts`、`src/tracker/rooms/markdown/index.ts`。这五处改动都没有碰到设置阻塞边的注册与图关系实现。

## 一、票面症状（原话摘要）

票 #898 说的是：一张票被两张以上票阻塞时，一次整图建骨架（`deck_map_plan_create`）或一次批量补边（`deck_map_link`）
会逐条调用「整批替换」语义的阻塞边接口，后一次调用把前一次写上的边删掉，最终只剩最后一条；
而每一步的校验只看「当前这一条在不在读回结果里」，所以逐条都报成功，顶层状态也是 ok，没有任何线索提示有边丢了。
票面引用的证据都是搬家前的老路径：`src/host/tools/deckMapPlanCreate.js:160-167`、`src/host/tools/deckMapLink.js`、
`src/host/tracker/backends/github/graph.js:269-303`、`src/host/tracker/contract.js:46`。
票面期望：同一张票的多条阻塞边要么先合并成完整集合再写一次，校验要按本次请求的全部目标核对。

票面正文与评论还记录：这张票 2026-10-08 已经实施过一次修复，并留下回归门禁 `tests/verify-898-block-merge.js`（11 条），
状态至今仍是打开、标签 `bug` 加 `ready-for-agent`，等待人工验收后关闭。

## 二、今天的代码对应物

老路径 `src/host/tools/` 与 `src/host/tracker/` 今天已经不存在；对应的实现在新的 TypeScript 树里。

### 整图建骨架（原 deckMapPlanCreate）

- 文件：`src/deck/tools/map-plan-create.ts`。
- 阻塞边先按「写出票号」分组、组内目标去重：`src/deck/tools/map-plan-create.ts:359-367`
  （`blockByFrom` 这张表，同一票号只建一组，`g.targets.indexOf(j.to) < 0` 保证同一个目标不重复）。
- 每张票只写一次，一次带上该票的全部目标：`src/deck/tools/map-plan-create.ts:379-386`
  （`applyBlockEdges(t, repo, opCtx, from, g.targets, ...)`）。
- 逐条明细按「读回来的全集」判，而不是只判当前这一条：`src/deck/tools/map-plan-create.ts:385`
  用 `r.applied` 决定这一条是否记为已落上，`r.applied` 由读回结果算出（见下一节的共用函数）。
- 父子边仍是单父语义、逐条写：`src/deck/tools/map-plan-create.ts:370-378`（父子与阻塞两条路分开，互不影响）。

### 批量补边（原 deckMapLink）

- 文件：`src/deck/tools/map-link.ts`。
- 一次调用里先把同一个票号的阻塞目标合并成完整集合：`src/deck/tools/map-link.ts:150-159`
  （`mergedBlocked` 这张表，同一个票号只留一份并集）。
- 第一次遇到该票号时，用合并后的完整集合写一次：`src/deck/tools/map-link.ts:207-208`
  （`const want = mergedBlocked.get(key) || asList(job.blockedBy)`，然后 `applyBlockEdges(..., want, ...)`）。
- 同一个票号再次出现时不再重写，只按第一次的读回结果为它自己的目标补明细：`src/deck/tools/map-link.ts:195-205`。
- 同一张票的写入还加了一把按票号的锁，同票串行、不同票并行：`src/deck/tools/map-link.ts:179`
  （`withKeyLock(repo, key, ...)`），锁没等到时逐条如实报失败（`src/deck/tools/map-link.ts:225-236`）。

### 契约语义与唯一的写入点

- 工具层写阻塞边只有一个出口：`src/deck/shell/edge-landing.ts:171-200` 的 `applyBlockEdges`。
  它在 `src/deck/shell/edge-landing.ts:182` 只调一次 `t.setBlockedBy(repo, from, want, {}, opCtx)`，
  `want` 是调用方合并好的完整目标集合；写完先读回整张票与依赖（`src/deck/shell/edge-landing.ts:190-193`），
  再让本次请求的每个目标各自去读回的全集里对一次（`src/deck/shell/edge-landing.ts:194-198`）。
  在 `src/deck/` 这一层里搜 `setBlockedBy`，只有这一处调用点。
- 契约的签名与硬规矩：`src/tracker/contract/operations.ts:191-202`（自环与成环回 `conflict`，环检不许省）。
  工具参数说明仍写着阻塞目标是整批替换：`src/deck/tools/map-link.ts:56`，以及
  `specs/1106-deck-tool-surface-spec.md:31`。
- 后端仍然是整批替换语义（这一点没有变，也不需要变）：
  GitHub 房 `src/tracker/rooms/github/graph.ts:457-458` 先算
  `toRemove = [...knownSet].filter((b) => !uniq.includes(b))`，再先删后加；
  Markdown 房 `src/tracker/rooms/markdown/issues-patch.ts:204` 起、GitLab 房 `src/tracker/rooms/gitlab/graph-blocking.ts:254` 起同样是整行/整批替换。

### 顶层回执怎么判成功

- 逐条明细汇总成顶层结论：`src/deck/shell/edge-landing.ts:234-243`（`statusOfItems`，只要有一条不是 ok，顶层就不是 ok）。
  批量补边在 `src/deck/tools/map-link.ts:245-257` 还会把失败原因摘要写进顶层那句话。
- 整图建骨架另有一处计数核对，但它数的是子票不是边：`src/deck/tools/map-plan-create.ts:400-409`
  （计划几张子票、按父票列出来几张，对不上就说 partial）。
  边这一侧没有单独的「应该几条、实际几条」计数，靠的是每个目标逐个去读回全集里核对。

### 装配与产物

- 今天真正装上去的就是这两个工具：`src/deck/registration/host-assemble.ts:33-34` 与 `:50-51`
  （`createDeckMapPlanCreate` / `createDeckMapLink` 进九个工具的工厂清单）。
- 构建产物里也带着合并写：`package/deck/tools/map-plan-create.js:296-326`、`package/deck/shell/edge-landing.js:72-75`。
- 老实现只剩在废弃目录里：`.scratch/` 与 `.worktrees/` 下有几份 `src/host/tools/deckMapPlanCreate.js`、`deckMapLink.js`，
  不在构建与装配的路径上，`src/` 与 `scripts/` 里已经没有任何地方引用老名字。
- 一处容易误会的旧字符串：`src/deck/registration/host-assemble.ts:59-69` 的 `DECK_TOOL_FILES` 里还写着老路径
  （`src/host/tools/deckMapPlanCreate.js` 等）。它只是随回执一起报出去的说明性清单
  （`src/host/refresh/wiring.js:323` 与 `:425-426` 把它放进 `files` 一格），不用它去找或加载实现，所以不构成复现路径。

## 三、判定

**判定：(b) 已被新结构消除。** 今天找不到一条能复现票面症状（丢边且回执全报成功）的代码路径。

依据：

1. 一次调用里同一张票的阻塞目标在任何写入发生之前就已经合并成完整集合。整图建骨架在
   `src/deck/tools/map-plan-create.ts:359-367` 按票分组，批量补边在 `src/deck/tools/map-link.ts:150-159` 按票号并集；
   两边都不会出现「同一张票、同一次调用、分两次各写一半」的调用。
2. 工具层写阻塞边只剩一个出口，且它一次只写一份完整集合：`src/deck/shell/edge-landing.ts:182`。
   票面当年那种「循环里每条边各自调一次」的写法在今天这棵树上没有落点。
3. 校验口径已经改成按本次全部目标核对：`src/deck/shell/edge-landing.ts:194-198` 让每个目标去读回的全集里对，
   `src/deck/tools/map-link.ts:195-205` 让重复项复用同一份读回结果逐个判。少一条边会如实变成那一条明细失败，
   顶层经 `src/deck/shell/edge-landing.ts:234-243` 汇总后不再是 ok，票面「逐条全成功、顶层 ok」的第二半也对不上。
4. 后端语义没变，所以问题确实修在调用层，与票面诊断一致：`src/tracker/rooms/github/graph.ts:457-458` 仍是整批替换。
5. 回归门禁仍在、仍然对着新树跑、今天全绿：`tests/verify-898-block-merge.js` 引用的是
   `src/deck/tools/map-plan-create.ts` 与 `src/deck/tools/map-link.ts`，本次实跑 11 条全部通过
   （含「对 C 只写一次」「读回两条全在」「跨次调用仍按完整集合替换」「同批成环仍拒」）。

## 四、不确定处

- 没有拿真后端实跑。实跑会在远端仓库建出试验票，票面当初也是因此选择静态核验；本轮的结论建立在读源码
  加跑那条不联网的回归门禁（桩跟踪器与 GitHub 后端同为整批替换语义）之上。
- 整图建骨架那条路没有用批量补边那把按票号的锁（`src/deck/tools/map-link.ts:179` 有，`src/deck/tools/map-plan-create.ts` 没有）。
  如果同一时刻另有一次调用在改同一张票，两笔之间仍然可以互相覆盖。这条与票面说的机制不是同一回事
  （票面是「一次调用内部自己覆盖自己」），今天也没有门禁覆盖它。
- 边这一侧没有独立的「应该几条、实际几条」计数，诚实程度取决于写后读回能不能拿到真实的阻塞边全集。
  读回拿不到时，今天的结果是「如实报失败」（假失败），而不是票面那种「静默丢边还报成功」。
- 票面实施记录里说「一次调用里同一票号又清空又加的矛盾写法按合并（并集）处理，已在注释写明」，
  今天的注释（`src/deck/tools/map-link.ts:147-149`）写了合并写这件事，但没有单独写明这条并集口径。

## 五、若真要处理

这张票在新结构下已经没有可复现的缺陷路径，剩下的都是收尾动作：由人验收后关闭，同时把回归门禁
`tests/verify-898-block-merge.js` 保留在验证链里（它守的是「整批替换语义」这条编译期管不住的口径，搬迁时最容易丢）。
若还想再稳一层，可以给整图建骨架的同票写入也接上批量补边那把按票号的锁，挡住两个工具并发改同一张票时的互相覆盖——
那是另一条路，需要另开一张票来收。
