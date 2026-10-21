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

---

## 2026-10-21 复核

记录现场：复核开始前记下基线提交，`git rev-parse --short HEAD` 是 `dd827466`（分支 `main`）。本轮完全只读：没有改 src、tests、scripts、package，没有提交、没有关票、没有发评论，唯一写入就是这份笔记的追加。工作树里当时还有别人未提交的改动（`README.md`、`docs/README.en.md`、两张 star-history SVG、`scripts/generate-star-history-svg.mts`、`tests/verify-star-history.ts`，以及未跟踪的 `%SystemDrive%/`、`research/998-recheck-gate-defer.md`），一律没有动。

### 一、票面症状摘要（复核用）

票 #898 说的是：一张票被两张以上票阻塞时，一次整图建骨架（`deck_map_plan_create`）或一次批量补边（`deck_map_link`）会逐条调用「整批替换」语义的阻塞边接口，后一次写把前一次写上的边删掉，最后只剩最后一条；而每一步的校验只看「当前这一条在不在读回结果里」，所以逐条都报成功、顶层状态也是 ok，静默丢边。期望是同一张票先合并成完整集合写一次，校验按本次全部目标核对。票面引用的路径都在搬家前的老树里，已经不存在；今天的对应实现与判定见下文。

### 二、今天的实现锚点（行号一律用今天源码的实际行号；旧笔记里的行号已经漂移）

- 整图建骨架：`src/deck/tools/map-plan-create.ts:396-399` 注释写明「同一张票的多条阻塞边先合并成完整集合再写一次」，`:410-417` 用 `blockByFrom` 按写出票号分组、同组目标去重（`g.targets.indexOf(j.to) < 0`）、`g.occ` 保留每条边原来的传入顺序；`:429-435` 每张写出票号只调一次 `applyBlockEdges(t, repo, opCtx, from, g.targets, ...)`，再按 `r.applied` 为每个目标判这一条是否落上。组内逐条、组间并行，这一点与旧笔记读到的一致。
- 批量补边：`src/deck/tools/map-link.ts:153-155` 注释写明合并写与「跨次调用仍按整批替换」；`:156-165` 的 `mergedBlocked` 按票号并集去重；`:167-174` 按票号分组；`:185` 用 `withKeyLock(repo, key, ...)` 让同一张票的组内写入串行、不同票并行，锁等不到时在 `:233-244` 逐条如实报失败；`:201-213` 同一个票号重复出现时不再重写，只用第一次的读回结果给这一项自己的目标逐个补明细；`:215-227` 第一次遇到该票号时用合并后的完整集合调一次 `applyBlockEdges`，并把读回来、但不在本次目标里的「计划外阻塞边」写进 notes。
- 工具层唯一的写点：`src/deck/shell/edge-landing.ts` 的 `applyBlockEdges`（`:178-218`）。`:190` 只调用一次 `t.setBlockedBy(repo, from, want, {}, opCtx)`；`:198-217` 写后读回整张票与依赖，用 `readOk` 区分「读失败」和「读回来了但没有」，再让本次每个目标各自去读回的全集里对一次（缺了就记为这条明细失败）；`:252-261` 的 `statusOfItems` 只要有一条明细不是 ok，顶层就不再是 ok。`src/deck` 这一层里 `setBlockedBy` 只有 `:190` 这一处调用。
- 其余写阻塞边的入口也只有两处，且都在写之前合并好了完整集合：`src/deck/tools/issue-create.ts:288`（建票时带 blockedBy，一次全集）、以及上面说的 `map-plan-create.ts:432` 与 `map-link.ts:216`。
- 契约与后端仍然是整批替换语义，没有变：`src/tracker/contract/operations.ts:202` 的声明；GitHub 房 `src/tracker/rooms/github/graph.ts:384-390` 对外入口（`:388` 发 `edge.write`），`:423-441` 读当前真值后算 `toAdd`/`toRemove` 再先删后加，`:457` 成功时把 `blockedBy` 覆写成本次要的集合；Markdown 房 `src/tracker/rooms/markdown/issues-patch.ts:206`、`:213` 是整行替换。

### 三、修复与门禁实跑结果（2026-10-21 亲手跑）

- 修复提交 `682c9747`「修复一票多阻塞边互相覆盖：同票先合并再写一次并逐项校验（#898）」（2026-10-08 09:56:18）是当前 HEAD 的祖先：`git merge-base --is-ancestor 682c9747 HEAD` 退出码 0。
- 回归门禁今天实跑：`node --import ./scripts/ts-hook.mts tests/verify-898-block-merge.ts`，输出「共 11 条，全部通过」，退出码 0。关键几条：A2 读回 C 的阻塞边两条全在、A3 对 C 只写一次（实写 1 次）、B2/B3 同一票拆两项传入也合并成一次写、D1 跨次调用仍是整批替换、E1 同批双边成环只保留第一条。门禁已登记在 `tests/gate-map.json:3445`（`node tests/verify-898-block-merge.ts`）。文件 2026-10-17 由 `.js` 转成 `.ts`，判据没动。
- 运行构建状态：`package`（Junction 到 profile 的 node_modules）里 `package/deck/tools/map-plan-create.js`、`map-link.js`、`package/deck/shell/edge-landing.js` 的修改时间都是 2026-10-21 13:24:25，产物里能看到合并写（`map-plan-create.js:341/344/347/368/370` 的 `blockByFrom` 与一次 `applyBlockEdges`；`map-link.js` 里的 `mergedBlocked` 与 `withKeyLock`；`edge-landing.js:77` 是那次唯一的 `setBlockedBy`）。10-21 日志里 13:41:18 还有一次 `host.start`（pid 31508，pluginVersion 1.9.0-beta.7），也就是说 13:24 这次构建之后插件宿主又启动/重载过一次，之后的日志对应这份构建；更早的日志由更早的构建记录，但旧笔记 2026-10-15 已核对过当时的 package 产物也带合并写，所以那些日子的日志同样反映合并写行为。

### 四、真机日志证据

日志目录：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\logs\`，2026-10-15 至 2026-10-21 共 7 个 `YYYY-MM-DD.log`，合计 2,411,835 行（`dsh-log export` 的摘要：bad=0，无坏行）；`log.rotate.degraded` 很多，按天分别是 0、14784、47117、30429、37872、30954、9948 条，轮转降级可能造成缺片，所以本次结论只把「搜到」当证据，「没搜到」只作旁证。查的时候没有整文件读入，全部先限定日期文件与事件名，再用 `dsh-log export` 摘要和 `Select-String` 精确匹配。

查了什么、命中多少：

1. `edge.write`（附录 1.4 节 #100，边写入的常驻结论线，字段 kind/route/ok/added/removed/kept/reason/latencyMs）：这个事件是提交 `6782b71a`（2026-10-14 18:01，#1054）引入的。2026-10-15 的日志里 0 条（那天运行中的构建还没有这个事件，当天 8 次 `deck_map_link` 与 2 次 `deck_map_plan_create` 没法用这个事件观察），10-16 的日志里第一次出现（ts=1792141101313，本地 2026-10-16 16:58:21）；10-16 至 10-21 一共 327 条，其中 `kind=block`（改阻塞边）91 条、`kind=parent`（改父子边）236 条，没有别的 kind。
2. `host.call` 里 `fields.kind="deck-tool"` 的调用：7 天里 `deck_map_link` 共 38 次、`deck_map_plan_create` 共 17 次。用每次调用的开始时间（`ts - latencyMs`）到结束时间（`ts`）圈出时间窗，再把窗内的 `edge.write` 对上，回答「一次调用里同一张票是不是只写了一次、写了几条」。
3. 找票面机制的反向痕迹：91 条 block 边写入里 `removed>0` 只有 7 条，全部落在 10-18 与 10-19 的 `deck_map_link` 窗口内；`deck_map_plan_create` 的窗口内 `removed` 恒为 0；`ok=false` 只有 1 条（10-18 一次 `added=6` 的写失败原因 `fail:env`，失败是如实报出来的，不是票面说的「报成功」）。

关键命中（「一笔写完整集合」的正面实例，added 是一次写入新建的边数）：

- 10-16 16:59 前后那次整图建骨架：窗内 3 笔 block 写，`+1`、`+1`、`+2`（三张票各一笔；其中一张票两个阻塞目标一笔写完）。
- 10-18 19:33 前后那次整图建骨架：窗内 8 笔，`+1`、`+1`、`+1`、`+2`、`+2`、`+2`、`+3`、`+6`（八张票各一笔；`+6` 是一张票六个阻塞目标一笔写完）。
- 10-18 02:02 前后那次批量补边：窗内只有一笔 `+4`（一张票四个阻塞目标一笔写完）。
- 10-20 14:58 前后那次批量补边：窗内 9 笔 = `+1` 七笔、`+3` 一笔、`+4` 一笔（九张票各一笔；`+3`、`+4` 各是一张票的多个目标一笔写完；这次调用的开始/结束是 ts 1792479481139 至 1792479519997）。
- 10-21 01:19 那次批量补边：窗内两笔，`+2` 一笔、`+1` 一笔（两张票各一笔；`+2` 是一张票两个阻塞目标一笔写完）。

反向痕迹：票面机制如果今天仍在真机发生，应当出现「同一次调用里同一张票被写两次，第二笔 `removed\)=1（把前一笔刚写的那条删掉）」的形态；91 条 block 写入里没有这种成对 `+1/-1` 形态，也没有任何一次地图工具调用出现「同一票先写一半再写另一半」的窗口形态。`removed>0` 的 7 笔是整批替换语义的正常表现：例如 10-19 一次批量补边窗口里出现 `+1/-2`、`+1/-2`、`+1/-3`、`+1/-4`、`+1/-5`，这是几张不同的票各自把这次调用之前就挂在票上的阻塞边整批替换掉，不是同一张票被分成多笔写（若同一票被分次写，第二笔的 `removed` 只会是 1，不会一路涨到 5）；门禁 D1 也明确守住「跨次调用仍是整批替换」这条口径。

必须说清的边界：

- `edge.write` 的字段里没有票号（隐私口径），也没有「这次应该几条」的直接字段（`added` 加 `kept` 可以推出本次目标数），所以日志不能把每一笔写归到某一张票上；「同一次调用里同票只写一次」这条主要靠源码与门禁证明，日志提供的是「窗口内写数与 added 形态」的旁证。
- 10-15 的日志没有 `edge.write`，不能当作当天的边写证据；`log.rotate.degraded` 多代表缺片风险存在，但本次结论的主要证据是搜到了合并写的正面实例，缺片造不出这种正面实例。
- 380 次 `deck_map_*` 调用里，时间上互相重叠的只有只读的 `deck_map_snapshot` 之间、以及 `deck_map_snapshot` 与 `deck_map_plan_create`（读对写）之间；没有看到两次写类地图工具同时进行。也就是说日志里没有跨工具并发改同一张票的实例，但这只是没发生过，不等于已经防住（见下一节未决问题）。

### 五、判定

**判定：不存在。** 票面「一次调用内部自己覆盖自己、只剩最后一条、回执仍报成功」的机制，在今天的 HEAD 源码、今天的运行构建、今天的真机日志三处都找不到落点：

1. 调用层在任何写发生之前就按票合并好了完整集合（`map-plan-create.ts:410-435`、`map-link.ts:156-228`），票面那种「循环里每条边各调一次」的写法在今天这棵树里没有落点。
2. 工具层写阻塞边只剩一个出口，一次只写一份完整集合，且写后按本次全部目标逐个读回核对（`edge-landing.ts:190`、`:198-217`、`:252-261`）；少一条会变成那条明细失败、顶层不再是 ok，票面「逐条全成功、顶层 ok」的第二半也对不上。
3. 修复提交 `682c9747` 在 HEAD 的祖先里；运行中的构建（2026-10-21 13:24:25）也带这份代码；回归门禁今天实跑 11 条全部通过。
4. 真机日志里能找到「一张票多个阻塞目标一笔写完」的正面实例（10-16 至 10-21 多笔 `added>=2` 的单笔写），找不到「同一次调用里同票被写两次、后写删前写」的形态。

### 六、埋点方案（不适用）

按任务口径，判「不存在」时不设计新的 dsh-log 埋点。如果以后要让「每张票这次应该几条、实际落几条」变成日志可直接判的事，需要在调用层新增一条事件（携带票号、本次期望条数、实际落上条数、是否走了合并写），这属于另一张票的日志埋点工作，并且要按 AGENTS.md 的日志埋点纪律同步 `research/489-appendix.md` 第 1 章对照表与 `tests/verify-log-fields.ts` 等白名单。今天不写方案正文。

### 七、未决问题

1. 跨工具并发改同一张票仍是一条与票面不同的问题路径：整图建骨架（`map-plan-create.ts:429-435`）和建票（`issue-create.ts:288`）写阻塞边时都没有取批量补边那把按票号的锁（`map-link.ts:185`）；而且 `src/deck/shell/write-mutex.ts:54` 的锁表是进程内模块级 `Map`，跨进程也保不住。两个不同调用同时改同一张票时，后写仍可能覆盖前写。这与票面「一次调用内部自己覆盖自己」不是一回事，7 天日志里也没有看到它真实发生（没有两次写类地图调用时间重叠）。建议：如果还没有单独票，另开一张收「同票跨工具并发写共用一把锁」，并单独评估锁要不要跨进程。
2. 旧笔记说「边这一侧没有独立的应该几条、实际几条计数」，今天 `edge.write` 已经提供了 `added/removed/kept`（#1054），但字段不含票号；要不要补票号（隐私口径要单独评估）另说。
3. 推荐收尾动作：由人验收后关闭 #898。关闭评论可写明：修复在调用层（同票合并写一次、写后按本次全部目标读回核对），修复提交 `682c9747` 已在 HEAD，运行构建 2026-10-21 13:24 含该修复，门禁 `tests/verify-898-block-merge.ts` 今天 11 条全部通过，真机日志 10-16 至 10-21 能找到一票多阻塞边一笔写完的正面实例；跨工具并发是另一条路，另票跟踪。此后保留 verify-898 在验证链里，它守的是「整批替换」这条编译期管不住的口径。

