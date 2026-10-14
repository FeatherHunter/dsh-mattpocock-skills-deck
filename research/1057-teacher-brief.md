# 地图09讨论背景调查：两房语义差异怎么定

- 日期：2026-10-13（若文件已存在，本次为覆盖重写）。
- 回答的问题：本地 Markdown 房与 GitHub 房之间已经查明的三类语义差异，事实是什么，每条事实的一手来源在哪里，用户会看到什么现象，补齐大概要改哪里，记为已知差异会付出什么代价。本文件只给事实、来源与影响，不做决策。

## 一、两房是什么，地图09要证明什么

GitHub 房是读写远端 GitHub 仓库的后端，调用经过本机安装的 `gh` 命令行进程发出网络请求（来源：`src/tracker/rooms/github/backend.ts:8` 引入 `ghClient`，`src/tracker/rooms/github/graph.ts:80`、`89`、`100` 等处调用 `c.execGh` 执行 `gh` 子命令）。

本地 Markdown 房是读写本工作区本地文件的后端，票就是工作区里 `.scratch` 目录下的 `map.md` 与每张票一个的 Markdown 文件，不经过网络（来源：`src/tracker/rooms/markdown/index.ts:29` 在 `matches` 里检查 `.scratch/map.md` 是否存在，`src/tracker/rooms/markdown/index.ts:109` 在 `preflight` 里检查同一路径，`src/tracker/rooms/markdown/issues-status.ts:41-43` 读整份文件、改一行、整份写回）。

两个后端在物理上是隔离的：一个动的是远端仓库，一个动的是本地磁盘文件，它们之间不共享存储，也不同步数据（来源：上面两段列出的实现位置互相没有引用关系；跨房间不许引用的纪律见 `src/tracker/rooms/github/cycle-check.ts:7` 注释“跨房间不许引”）。

地图09要证明的是“上层对后端无知”不是空话，也就是换一个完全没有 `gh` 的后端，同一套 deck 工具全部照样跑（来源：`research/1010-ticket-structure.md:223` 原文“证明‘上层对后端无知’不是空话——换一个完全没有 `gh` 的后端，同一套工具全部照跑”）。地图09的做完标志含“两房语义差异逐条落定或明确记为已知差异”（来源：`research/1010-ticket-structure.md:223` 同一条，地图09正文 `gh issue view 1056` 的“做完的标志”字段亦为同一句话）。本次讨论票是地图09的讨论票，只讨论，不写代码（来源：`gh issue view 1057` 正文“边界：只讨论”，“做完：每条差异都有去留与理由，写进本票评论”）。

本调查归并的三桶以 `research/1010-room-conformity-checklist.md` 第五节 8 处为准（来源：`research/1010-room-conformity-checklist.md:97-106` 列出 6 处收可选项不往下传、1 处写前版本校验整类未实现、1 处环检只有 GitHub 有）。该清单写于 2026-10-11，路径还是搬家前（来源：`research/1027-probe-handoff.md:121` 原文“注意该清单写于 2026-10-11，路径还是搬家前，行号以搬家更正为准”）。按当时口径，这 8 处语义差异不在契约票里逐条定，只作为地图08第一次真实压力测试的输入，逐条语义留给地图08讨论票与地图09讨论票（来源：`research/1027-probe-handoff.md:126-129` 转录的讨论结论原文）。规格书的口径是这三类差异不许用可选参数藏起来，要在接口注释里逐条写明本房不实现（来源：`specs/1010-ts-rewrite-spec.md:81`）。

## 二、第一桶：本地 Markdown 房 6 处收了可选项不往下传

### 2.1 契约怎么说的

契约的操作层给 6 个操作都声明了可选项参数，类型分别是批量取依赖选项、关票选项、通用写选项（来源：`src/tracker/contract/operations.ts:125-130` 的 `getDependencies` 收 `opts: DepsOpts | undefined`，`:136` 的 `close` 收 `opts: CloseOpts | undefined`，`:148-154` 的 `setLabels`、`:157-163` 的 `setAssignees`、`:166-172` 的 `setParent`、`:179-185` 的 `setBlockedBy` 收 `opts: SetOpts | undefined`）。

三个选项形状的含义是：批量取依赖选项今天只有一次问多个编号一项（来源：`src/tracker/contract/inputs.ts:57-61` 的 `DepsOpts.keys` 注释“一次问多个编号”）。关票选项今天只有关闭原因一项，不传就看后端默认（来源：`src/tracker/contract/inputs.ts:99-103` 的 `CloseOpts.reason` 注释“关闭原因；不传就看后端默认”）。通用写选项今天只有期望更新时间一项，是乐观并发控制（来源：`src/tracker/contract/inputs.ts:116-123` 的 `SetOpts.expectedUpdatedAt` 注释“乐观并发控制：与后端当前的更新时间对不上就返回冲突”）。

关闭原因是开放字符串，原样透传，不做分支，插件自己认得并收进保留表的只有完成与重复两个，GitHub 那边还会出现未计划等取值，照原样展示即可（来源：`src/tracker/contract/identity.ts:44-50` 的 `ClosedReason` 注释）。

### 2.2 两房各自怎么做的

GitHub 房 6 处都把可选项透传给真正的实现函数（来源：`src/tracker/rooms/github/backend.ts:82` 的 `getDependencies` 转发 `opts`，`:84` 的 `close` 转发 `opts`，`:88` 的 `setLabels` 转发 `opts`，`:92` 的 `setAssignees` 转发 `opts`，`:93` 的 `setParent` 转发 `opts`，`:94` 的 `setBlockedBy` 转发 `opts`）。透传之后，GitHub 房真的使用了这些字段：批量键在取依赖里走批量分支（来源：`src/tracker/rooms/github/graph.ts:177-188` 的 `opts.keys` 批量分支），关闭原因拼进关票命令并发回票上（来源：`src/tracker/rooms/github/issues-write.ts:156-158` 把 `opts.reason` 拼进 `gh issue close` 的 `--reason` 参数，`:176` 把 `opts.reason` 回填到返回的票上），期望更新时间在 4 个写操作里做写前比对（详见第三节，来源：`src/tracker/rooms/github/labels.ts:100-105`、`src/tracker/rooms/github/issues-write.ts:289-292`、`src/tracker/rooms/github/graph.ts:61-66`、`src/tracker/rooms/github/graph.ts:252-257`）。

本地 Markdown 房 6 处都在装配层声明了同样的参数个数，但在调用真正的实现函数时把可选项丢掉了（来源：`src/tracker/rooms/markdown/index.ts:132` 的 `getDependencies` 调 `getDependenciesForKey(opCtx,repo,key)` 只传三个，`:134` 的 `close` 调 `closeIssue(opCtx,repo,key)` 只传三个，`:138` 的 `setLabels` 调 `setLabelsIssue(opCtx,repo,key,labels)` 丢 `opts`，`:139` 的 `setAssignees` 调 `setAssigneesIssue(opCtx,repo,key,assignees)` 丢 `opts`，`:140` 的 `setParent` 调 `setParentIssue(opCtx,repo,key,parentKey)` 丢 `opts`，`:141` 的 `setBlockedBy` 调 `setBlockedByIssue(opCtx,repo,key,blockers)` 丢 `opts`）。

丢掉的具体字段是：取依赖丢掉了批量键（来源：`src/tracker/rooms/markdown/graph.ts:21` 的 `getDependenciesForKey(ctx,repo,key)` 签名只有三个参数，根本没有接收批量键的位置）。关票丢掉了关闭原因（来源：`src/tracker/rooms/markdown/issues-status.ts:50-52` 的 `closeIssue(ctx,repo,key)` 签名只有三个参数，实现是固定写 `Status: resolved` 一行，从不读取原因）。其余 4 处丢掉的都是期望更新时间（来源：`src/tracker/rooms/markdown/issues-patch.ts:327` 的 `setLabelsIssue(ctx,repo,key,labels)`、`199` 的 `setAssigneesIssue(ctx,repo,key,assignees)`、`244` 的 `setParentIssue(ctx,repo,key,parentKey)`、`183` 的 `setBlockedByIssue(ctx,repo,key,blockers)` 四个签名里都没有期望更新时间的位置）。

### 2.3 用户实际会看到什么现象

举一个具体的例子：调用方用同一个关闭原因同时关两张票，一张在 GitHub 房，一张在本地 Markdown 房，调用都传了关闭原因为重复。GitHub 房的那张票关掉后，读回的票上记着这次传的原因（来源：`src/tracker/rooms/github/issues-write.ts:176` 的回填行）。本地 Markdown 房的那张票同样显示成功关闭，文件里只多了一行是否解决的状态行，原因没有地方可记，下次读回时原因只能是空或省略（来源：`src/tracker/rooms/markdown/issues-status.ts:50-52` 从不处理原因，`src/tracker/contract/vocabulary.ts:51` 注明开放着的票依后端支持给空或省略）。用户看到的现象是同一个调用在两个后端返回了同样的成功，票面细节却不一样。

再举一个具体的例子：调用方一次问多张票的依赖关系，把编号列表放在批量键里。GitHub 房走批量分支，逐个取回再合并（来源：`src/tracker/rooms/github/graph.ts:177-188`）。本地 Markdown 房收到的批量键在装配层就被丢掉，实现函数只读了第一参数那一张票的依赖（来源：`src/tracker/rooms/markdown/index.ts:132` 与 `src/tracker/rooms/markdown/graph.ts:21-28`）。用户看到的现象是同样的批量调用，在 GitHub 房返回了批量结果，在本地房只返回了单张票的结果，而两次调用都显示成功。

### 2.4 补齐大概要改哪里

取依赖的批量键要在本地取依赖函数上加一个接收批量键的位置，读到多个编号时逐张读文件再合并，或者明确拒绝批量调用并返回做不到（改动点：`src/tracker/rooms/markdown/index.ts:132` 的装配转发，与 `src/tracker/rooms/graph.ts:21` 的实现签名，未核实逐张合并时反向聚合的性能影响）。

关票原因要在本地关票函数上加一个接收原因的位置，并决定原因写在文件的哪一行，以及读回时从哪一行读出来（改动点：`src/tracker/rooms/markdown/index.ts:134` 的装配转发、`src/tracker/rooms/markdown/issues-status.ts:50-52` 的写行与 `src/tracker/rooms/markdown/parse.ts` 的读行，未核实文件格式是否已有预留的原因行）。

其余 4 处的期望更新时间与第三节是同一件事，改动点见第三节。

### 2.5 记为差异会有什么代价

记为差异的代价是上层调用方必须记住同一个成功在两个后端含义不同：批量键在本地房无效，关闭原因在本地房写了等于没写。以后每个用到这两个字段的上层调用都要先问自己在哪个后端，或者接受本地房静默少做一部分工作。沉默的代价比报错大：调用方收到成功，会以为原因已经记下、批量已经取全，而盘上并没有（来源：本节 2.2 列出的 6 个丢弃位置均为成功返回，不返回失败）。

## 三、第二桶：写前版本校验在本地房整类未实现

### 3.1 契约怎么说的

通用写选项里的期望更新时间是乐观并发控制：调用方把上次读到的更新时间交回来，后端拿它与当前的更新时间比对，对不上就返回冲突，不做后写覆盖先写（来源：`src/tracker/contract/inputs.ts:116-123` 的 `SetOpts` 注释）。冲突是显式产生的失败分类，不是按错误文本猜出来的（来源：`src/tracker/rooms/github/labels.ts:6` 注释“不匹配到冲突是显式产生”，`src/tracker/contract/identity.ts:60-61` 把写前置失败列在冲突的含义里）。

需要澄清一处票面注释与类型的不一致：操作层的关票注释写着带期望更新时间时对不上就回冲突（来源：`src/tracker/contract/operations.ts:135`），但关票选项的类型里今天只有关闭原因，没有期望更新时间（来源：`src/tracker/contract/inputs.ts:99-103` 的 `CloseOpts` 只有一个 `reason` 字段）。改票操作今天根本没有可选项位置（来源：`src/tracker/contract/operations.ts:145` 的 `update` 签名是 `(repo,key,patch,ctx)`，没有选项参数）。所以按今天的类型，能做版本校验的只有覆盖式改标签、覆盖式改认领、改父地图、改阻塞关系这 4 个操作。关票与改票是否要加版本校验，是未核实事项，标未核实。

### 3.2 两房各自怎么做的

GitHub 房在 4 处认期望更新时间，做法都是写之前先读当前票，比对更新时间，对不上就返回冲突且不往下写（来源：`src/tracker/rooms/github/labels.ts:99-106` 的改标签前置，`src/tracker/rooms/github/issues-write.ts:288-293` 的改认领前置，`src/tracker/rooms/github/graph.ts:60-67` 的改父前置，`src/tracker/rooms/github/graph.ts:251-258` 的改阻塞前置）。4 处的比对文案逐字一致，都是期望时间与实际时间对不上（来源：上面 4 处各自的 `expectedUpdatedAt mismatch` 失败行）。

本地 Markdown 房整类未实现：全房搜索期望更新时间零命中（来源：2026-10-13 对 `src/tracker/rooms/markdown` 做 `expectedUpdatedAt` 全文搜索，零命中）。4 个对应的本地实现函数签名里没有接收期望更新时间的位置（来源：`src/tracker/rooms/markdown/issues-patch.ts:327`、`199`、`244`、`183` 四个签名），装配层收到的可选项也被丢掉（来源：`src/tracker/rooms/markdown/index.ts:138-141` 四行）。

版本号的语义是后端每次写票时更新的更新时间字符串，调用方读票时拿到它，下次写时原样交回，后端拿它判断这张票在两次调用之间有没有被别人改过（来源：GitHub 房 4 处前置都是拿 `getIssue` 读回的 `updatedAt` 与交进来的期望值做字符串相等比较，来源同上 4 处）。什么时候触发冲突：只有调用方交了非空的期望更新时间、且它与后端当前存的更新时间不相等时，才触发冲突（来源：4 处前置的条件写法一致，都是先判断期望值是字符串且非空，再比较不等，来源同上）。

### 3.3 用户实际会看到什么现象

举一个具体的例子：甲乙两人同时打开同一张票，两人读到的更新时间都是同一串。甲先改了标签并成功，更新时间变成新串。乙接着改同一张票，交回的还是旧串。在 GitHub 房，乙的第二次写会收到冲突失败，盘上的票保持甲改完的样子，乙的改动没有落盘（来源：`src/tracker/rooms/github/labels.ts:100-105` 的前置分支）。在本地 Markdown 房，乙的第二次写会成功，文件被整份改写，甲的改动被整份抹掉，两次调用都显示成功，盘上只剩乙的版本（来源：`src/tracker/rooms/markdown/issues-patch.ts:327-336` 直接读改写，不做任何比对；并发整份抹掉的机制见 `src/tracker/rooms/markdown/issues-patch.ts:19-23` 注释“后写的那一路把先写的那一路的改动整份抹掉”）。

### 3.4 补齐大概要改哪里

要在本地 4 个写函数上各加一个接收期望更新时间的位置，写之前先读当前文件的更新时间（或等价的文件版本标记），对不上就返回冲突且不写文件（改动点：`src/tracker/rooms/markdown/issues-patch.ts:327`、`199`、`244`、`183` 四个签名，`src/tracker/rooms/markdown/index.ts:138-141` 四处转发，以及本地票文件的更新时间读写位置，未核实本地文件今天是否有可靠的更新时间可比对）。

本地已有按文件排队的单写者队列（来源：`src/tracker/rooms/markdown/issues-patch.ts:24-34` 的按文件排队，与 `src/tracker/rooms/markdown/issues-status.ts:39` 的关门重开同样排队），它解决的是同时写同一份文件时的整份覆盖问题，不解决甲乙先后写、后写盖先写的问题，两者是不同的并发层次，补版本校验时不要把队列当成已经解决了版本问题。

### 3.5 记为差异会有什么代价

记为差异的代价是本地房永远是后写覆盖先写，而 GitHub 房是先比对再写。凡是依赖冲突来提醒用户先合并再写的上层流程，在本地房会静默丢改动。改动丢了之后没有日志能指出是谁盖掉了谁，因为两次调用都返回成功（来源：本节 3.2 列出的本地实现均为成功返回）。将来一旦有人在本地房上做协同编辑，这个差异会第一个变成丢数据故障。

## 四、第三桶：写后环检只有 GitHub 房有

### 4.1 契约怎么说的

改阻塞关系的契约写了两条硬规矩：自己阻塞自己就回冲突，写完之后成环就回冲突且不落盘（来源：`src/tracker/contract/operations.ts:174-177` 原文“自己阻塞自己到冲突；写完之后成环到冲突且不落盘”）。环检是写路径的一部分，不许省，省掉之后图会变成一团，而且再也解不开（来源：同一注释 `:177`）。

### 4.2 两房各自怎么做的

GitHub 房两条都做了：自环当场回冲突（来源：`src/tracker/rooms/github/graph.ts:249` 的自环分支），成环在落盘前用全图邻接表判一次，成环就回冲突且不往下写（来源：`src/tracker/rooms/github/graph.ts:222-231` 的按需组装邻接表，`:260-261` 的成环检测分支，`:239-244` 的写入 diff 尚未执行）。需要如实说明一处措辞差别：契约写的是写完之后成环，GitHub 房实现是写之前判环（来源：`src/tracker/rooms/github/graph.ts:259` 注释“成环检测（写前，不落盘）”，函数注释 `:233-238` 亦写“成环：写后环检成环到冲突不落盘”而代码位置在写之前）。效果一致，都是成环就不落盘，但“写后”三个字在实现里是“写前预判”，不是“先写再回滚”，这一点标为已核实的措辞差别。

判环用的方法是把拟写入边套进邻接表后做深度优先搜索，有环就判真（来源：`src/tracker/rooms/github/cycle-check.ts:55-73` 的 `hasCycle` 实现，`:56-58` 先套用拟写入边，`:61-70` 深度优先搜索）。邻接表优先用名册加脏票定向重读组装，拿不到时退回整仓拉取（来源：`src/tracker/rooms/github/cycle-check.ts:25-53` 的 `adjacencyFor` 实现）。

本地 Markdown 房只挡自环：读阻塞边时自环回冲突（来源：`src/tracker/rooms/markdown/graph.ts:28` 的读时自环分支），写阻塞边时自环回冲突（来源：`src/tracker/rooms/markdown/issues-patch.ts:186` 的写时自环分支）。除自环之外，本地写阻塞边直接改文件的阻塞行并落盘，不做全图判环（来源：`src/tracker/rooms/markdown/issues-patch.ts:183-197` 全函数无环检调用），本地读依赖也只扫同一工作单元内的文件做反向聚合，不判环（来源：`src/tracker/rooms/markdown/graph.ts:51-72` 的反向聚合只收集阻塞了谁，不调用判环函数）。

成环不落盘的意思是：一旦这一次写入会让阻塞图出现一圈互相等待（例如甲等乙、乙等丙、丙等甲），后端必须拒绝这一次写入，盘上的文件保持写入之前的样子，不留下半截新边（来源：契约 `src/tracker/contract/operations.ts:176` 的“不落盘”三个字，GitHub 房 `src/tracker/rooms/github/graph.ts:260-261` 的成环分支在任何写边循环之前返回）。

### 4.3 用户实际会看到什么现象

举一个具体的例子：已有甲阻塞在乙上（甲等乙），用户再把乙设成阻塞在甲上（乙等甲），两条边凑成一圈。在 GitHub 房，第二次写入返回冲突失败，读回两张票的依赖关系仍是写入之前的样子（来源：`src/tracker/rooms/github/graph.ts:260-261` 的成环分支在写边之前返回）。在本地 Markdown 房，第二次写入返回成功，两个文件的阻塞行各记一条，图上已经成环，下次读依赖时两张票互相出现在对方的阻塞列表里（来源：`src/tracker/rooms/markdown/issues-patch.ts:189-191` 直接写行落盘，`src/tracker/rooms/markdown/graph.ts:52-71` 反向聚合会把对方扫出来）。用户看到的现象是同样的成环操作，一个后端说做不到，一个后端说做到了，而做到的那个留下一圈解不开的等待。

### 4.4 补齐大概要改哪里

要在本地写阻塞边函数里加一次写前判环：写入之前把同一工作单元内所有票的阻塞关系读出来组装成邻接表，把拟写入边套进去判环，成环就返回冲突且不写文件（改动点：`src/tracker/rooms/markdown/issues-patch.ts:183-197` 的写函数，邻接组装可复用 `src/tracker/rooms/markdown/graph.ts:51-72` 的同单元扫描逻辑，判环算法可参考 `src/tracker/rooms/github/cycle-check.ts:55-73` 的深度优先搜索，未核实跨工作单元的边是否要纳入判环范围，本地阻塞关系今天只在同一工作单元内成立，来源：`src/tracker/rooms/markdown/graph.ts:3-5` 注释“阻塞关系只在同一工作单元内成立”）。

### 4.5 记为差异会有什么代价

记为差异的代价是本地房的阻塞图可以长期带环运行，而 GitHub 房不允许。环一旦落盘，后续的排序、展示与自动化推进都可能在环上打转，而契约注释已经写明环省掉之后图会变成一团，而且再也解不开（来源：`src/tracker/contract/operations.ts:177`）。解环需要人逐条拆边，机器无法判断该先拆哪一条。把环检记为差异，等于接受本地房的图可能需要人手工修环。

## 五、术语小词典

- 房间是指后端的一种叫法，GitHub 房是读写远端 GitHub 仓库的那一份实现，本地 Markdown 房是读写本工作区本地票文件的那一份实现，房间不同，票存在哪里、经过什么命令读写就不同。
- 契约是指工具与后端之间唯一的书面承诺，写明每个操作收什么参数、回什么形状，工具只认契约，不认具体是哪个房间在干活。
- 写前版本校验是指写操作落盘之前，先拿调用方交回来的期望更新时间与后端当前存的更新时间比对，对不上就返回冲突且不写文件，用来防止后写的人盖掉先写的人的改动。
- 写后环检是指改阻塞关系时保证图不成环，契约要求成环就返回冲突且不落盘，GitHub 房在写之前预判是否成环，效果同样是不让成环的边落盘。
- 可选项是指契约签名里标为可选的那个参数，例如批量键、关闭原因、期望更新时间，调用方可以传也可以不传，但房间收到之后应当按契约处理，不应当悄悄丢掉。
- 冲突回冲突不落盘是指后端用冲突这个失败分类明确告诉调用方这一次写没有做，盘上的数据保持写之前的样子，调用方应当把冲突当成需要人合并或换一种写法重试的信号，而不是当成成功。

## 六、留给人类定的三件事

1. 本地 Markdown 房丢掉的 6 个可选项字段，是逐个补齐，还是逐个在契约注释与本地文件格式里明确记为本房不实现。
2. 本地 Markdown 房缺席的写前版本校验，是给 4 个写操作补上期望更新时间的比对，还是明确记为本地房长期是后写覆盖先写，并让上层调用方按此调整协同流程。
3. 本地 Markdown 房缺席的写后环检，是补上写前判环并明确判环的范围是只看同一工作单元还是看全工作区，还是明确记为本地房允许成环并写清成环后由人手工拆环。

---

- 主要来源清单：`research/1010-room-conformity-checklist.md` 全文（重点第五节 `:97-112`），`src/tracker/contract/operations.ts`（重点 `:125-136`、`:148-185`、`:174-177`），`src/tracker/contract/inputs.ts`（重点 `:57-61`、`:99-103`、`:116-123`），`src/tracker/contract/identity.ts:44-50` 与 `:60-61`，`src/tracker/contract/vocabulary.ts:79`，`src/tracker/rooms/github/graph.ts`（重点 `:52-67`、`:172-188`、`:239-261`），`src/tracker/rooms/github/issues-write.ts`（重点 `:147-177`、`:271-293`、`:214`），`src/tracker/rooms/github/labels.ts:90-106`，`src/tracker/rooms/github/backend.ts:82-94`，`src/tracker/rooms/github/cycle-check.ts:25-73`，`src/tracker/rooms/markdown/index.ts:132-141`，`src/tracker/rooms/markdown/graph.ts:21-72`，`src/tracker/rooms/markdown/issues-patch.ts:183-197` 与 `:199`、`:244`、`:327`，`src/tracker/rooms/markdown/issues-status.ts:50-52`，`specs/1010-ts-rewrite-spec.md:81`，`research/1010-ticket-structure.md:223` 与 `:255`，`research/1027-probe-handoff.md:121-129`，`gh issue view 1056` 地图正文，`gh issue view 1057` 讨论票正文。
- 未核实事项：本地批量取依赖合并时的性能影响，本地文件格式是否有预留的关闭原因行，本地文件是否有可靠的更新时间可比对，判环范围是否含跨工作单元的边，关票与改票是否要新增版本校验位置。
