# 原型实测：git worktree 加独立产物目录能不能支撑本地 link 并行开发（#1322）

> 这份文件记录一次可重跑的实测，用事实回答票号 #1322 提出的问题：每个并行会话在自己的 git worktree 里构建、产物也留在 worktree 内，而本机已经安装的插件 link 仍然指向主工作区的 `package/` 时，界面看到的是谁、两个会话会不会互相覆盖。文中的数字都是本次实际量到的；复现命令在最后一节，原始快照与探针脚本留在工作区的 `.scratch/1322/` 目录（这个目录不进版本库）。实验基线提交是 `8b514a37`，采集期间 `main` 工作树干净。

## 一、一句话结论

- 只要本机 link 还指向主工作区的 `package/`，在 worktree 里构建**不会**改变界面：产物写在 worktree 自己的目录里，主工作区的产物一个字节都没动，界面在观测窗口内没有收到重载信号。两个 worktree 同时构建也互不覆盖。
- 代价出现在**依赖目录与构建缓存**上，而不是产物目录：如果 worktree 继续复用主工作区的 `node_modules`（仓内现在用目录联接），全仓仍然只有一份构建缓存 `node_modules/.cache/dsh-build.json`，两个会话的输入不同时每轮都会互相作废，各自都走完整构建；甚至输入完全相同的时候，因为 esbuild 注释里「从构建根到 node_modules 的相对路径」不同，产物字节也不同，缓存记的是最后构建那棵树的产物，别的树照样对不上。
- 给每个 worktree 独立装一份依赖（本次实测 1.42 秒、逻辑体积 124.5 MB，硬链接自本机内容仓库）以后，构建缓存跟着各自一份，互不作废；这样装出来的产物与主工作区**逐字节相同**，第二次构建 0.23 秒命中缓存、一个文件都不写。
- 因此本票的答案：worktree 加独立产物目录可以支撑并行开发；要真正互不干扰，worktree 里的依赖目录与构建缓存也要独立，不能只把源码和产物隔开。把本机 link 指到某个 worktree 再打开界面这件事本次没有实测，只写明为待验证的一步（见第八节）。

## 二、实验基线

- 基线提交 `8b514a37`（2026-10-21 03:05:50 +0800），`git status --porcelain` 为空。Node v24.19.0，pnpm 11.22.0，git 2.49.0.windows.1。
- 本机 link 的位置与指向：`C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck` 是目录联接，指向 `D:\dsh-plugin\dsh-mattpocock-skills-deck\package`。也就是说界面与宿主读的是主工作区的 `package/lib/` 这一份。
- 主工作区基线产物：`package/lib/client.js` 2099243 字节，SHA256 `ce3fad78…`，DSH 用来判断是否热更的产物版本标识是 `389b8e49b661`；`client.js` 2096629 字节；`host.js` 58647 字节；`package/lib/index.js` 58560 字节。
- 观测界面用的通道：本机 DSH 的面板事件流 `http://127.0.0.1:50303/plugins/events`（SSE）。脚本只统计两类帧：连接时发的 `graph` 快照帧与产物变化后的 `rebuilt` 帧；另外记录快照帧里本插件的版本标识。
- 构建入口是 `scripts/build.mts`。它的构建根 `ROOT` 是脚本所在仓库的根，缓存文件固定在 `node_modules/.cache/dsh-build.json`（`scripts/build.mts:94`），输入是 `src`、`scripts`、`tests`、`config/copy` 四个目录加上一串单文件（`scripts/build.mts:104-105`），产物目录是 `.build`、`package/lib`、`package/deck`、`package/tracker` 等（`scripts/build.mts:116`）。构建没有「把产物写到别处」的开关：所有产物都落在 `ROOT` 里面，这正是 worktree 方案能起作用的原因——换了 `ROOT` 就等于换了产物落点。

## 三、做法

1. 在仓库里建两棵探针 worktree：`.worktrees/1322-probe-a` 与 `.worktrees/1322-probe-b`，都用 `git worktree add --detach <路径> HEAD` 从基线提交开出；两棵树的 `git status --porcelain` 都为空。
2. 两棵树各自把 `node_modules` 做成指向主工作区 `node_modules` 的目录联接（junction），复用现有依赖。这是仓内已经在用的做法：`.worktrees/1324-1326` 的 `node_modules` 就是这种联接。
3. 先启动 SSE 统计脚本采集 90 秒，再在两棵树里并行启动 `node scripts/build.mts`，两边都等结束；然后对比构建前后的两份快照。
4. 快照脚本记录：主工作区四个产物的字节数、修改时间、元数据变更时间、SHA256 与版本标识；`package/lib` 整树的元数据指纹（文件数、总字节、逐文件「路径 + 大小 + 修改时间」的哈希）；`.build`、`package/deck`、`package/tracker`、`package/shared` 四个目录各自的同类指纹；`git status`、`HEAD`、`.git/index` 的字节数与哈希；构建缓存各模式条目的指纹与产物数量；`git worktree list`。
5. 另做一组受控实验量「共享依赖下缓存互相顶掉」：在 B 树里放一个未跟踪的 `.ts` 文件当输入变化，构建 B，再构建 A，观察两次构建是否命中缓存、缓存条目的输入指纹怎么变；实验后删掉标记文件。
6. 最后把 B 树的 `node_modules` 联接删掉（`cmd /c rmdir node_modules`，只删链接不碰目标），在 B 树里跑 `pnpm install --offline --ignore-scripts --frozen-lockfile` 得到一份独立依赖，重复构建，量耗时、体积、缓存落点与产物字节。

## 四、结果一：产物落在哪里，主工作区有没有被碰

- 两棵树构建都成功（退出码 0），日志里两边都是「完整构建」（没有命中缓存），说明并发构建本身能跑通。
- 产物都写进了各自 worktree 里：`.worktrees/1322-probe-a/client.js` 与 `.worktrees/1322-probe-b/client.js` 都是 2096821 字节、SHA256 都是 `B0449DED…`；两棵树的 `package/lib/client.js` 都是 2099435 字节、SHA256 都是 `4FF49FB6…`，两棵树彼此逐字节相同。
- 主工作区没被碰：构建前后两份快照逐项对比，`HEAD` 相同，`git status` 都为空，`.git/index` 的字节数与 SHA256 完全相同（`790aeb71…`）；`client.js`、`host.js`、`package/lib/client.js`、`package/lib/index.js` 四个产物的字节数、修改时间、元数据变更时间、SHA256 与版本标识全部不变；`package/lib` 整树与四个产物目录的元数据指纹也全部不变。
- 两棵 worktree 的产物与主工作区产物差 192 字节（2099435 对 2099243），差异只有一处：esbuild 生成代码里的注释写共享依赖的相对路径。主工作区写的是 `// node_modules/.pnpm/dsh-plugin-update@0.18.38/…`，worktree 里写的是 `// ../../node_modules/.pnpm/dsh-plugin-update@0.18.38/…`（逐字节对比：前 1676134 字节相同、后 70302 字节相同，中间唯一差异就是这段注释）。这是说明性质的信息，不影响插件行为；但它后面会带出一个缓存副作用，见第七节。

## 五、结果二：界面看到的是谁

- 90 秒观测窗口覆盖了两次构建的全程与结束后的平静期。窗口里只收到 1 帧，是连接时发的 `graph` 快照帧；`rebuilt` 帧为 0；本插件的产物版本标识从头到尾都是 `389b8e49b661`，没变。
- 也就是说：本机 link 指向主工作区的 `package/` 时，worktree 里的构建对界面**完全不可见**，既不会热更、也不会丢面板状态。原因是界面读的是 link 目标那一份 `package/lib/client.js`，而 worktree 把产物写进了自己的目录。
- 反过来说，想让界面看到某个 worktree 的构建结果，必须显式把那一条 link 指到那个 worktree 的 `package/`。这一步会改变界面读到的入口文件，按 DSH 现在的热更判定（只看入口文件的修改时间、元数据变更时间与大小，见 `research/1311-client-bundle-reload-signal.md:162`）会触发一次重挂载。这次没有实测这一步，留待需要时验证（见第八节）。

## 六、结果三：git 索引

- 每个 worktree 有自己的索引文件：`.git/worktrees/1322-probe-a/index` 与 `.git/worktrees/1322-probe-b/index`（字节数都是 208964）。主工作区的 `.git/index` 在两次构建前后字节数与哈希全同。
- 三处工作树（主工作区与两棵 worktree）在测后 `git status --porcelain` 都为空。也就是说「在 worktree 里构建」不会把产物当改动写进任何一处索引，也不会碰主工作区的暂存区。
- 边界要写清：worktree 只让「工作区文件与索引文件」互不干扰，不解决「两个会话同时提交同一个分支」的问题——那是规范层面的事（`research/1313-parallel-session-resources.md` 第三节已经把索引文件的共享问题讲了一遍），本票没有重新验证。

## 七、结果四：共享依赖时构建缓存会被互相顶掉

两棵树都通过目录联接复用主工作区 `node_modules` 时，全仓只有一个缓存文件，里面按构建模式分条目（不带参数是 `full`）。实测三组：

1. 两棵树并行构建：各约 18.9 秒，全程重叠，两边都是完整构建。构建结束后缓存里的 `full` 条目输入指纹是 `019fc9e3a96b…`（与主工作区基线相同，因为两棵树的输入和主工作区一模一样），产物清单 432 项。
2. 在 B 树放一个未跟踪的 `.ts` 文件当输入变化：B 构建 10.58 秒，完整构建，缓存指纹变成 `c08f86a3c5dc…`，日志写「手写输入有变化 → 正常构建。」；紧接着 A 构建 10.57 秒，也是完整构建，指纹回到 `019fc9e3a96b…`。两个会话的输入只要不一样，就是每轮互相作废、各自全量重建。
3. 更隐蔽的一层：两棵树的输入完全相同（都从同一提交开出、都没有额外改动）时，产物字节仍然与主工作区差 192 字节（第四节那段注释），缓存里记的产物哈希是最后构建那棵树的样子。于是「输入相同」并不能让另一棵树命中缓存，缓存条目会被来回改写。本次没有把「主工作区构建」和「worktree 构建」交叉验证这一条，但机制从产物字节差异与缓存写入口径可以直接推出来，这也是后续「每个 worktree 独立缓存」建议的直接理由。

单棵树的完整构建耗时约 10.6 秒，两路并发时各约 18.9 秒（互相抢 CPU 与磁盘）。这个量级说明：共享依赖下的代价不是「多跑一次构建」，而是「每次都要多跑一次真构建」，并且真构建会整树 touch 产物（`scripts/build.mts:1652` 一带），对界面就是每轮闪一次。

## 八、结果五：每个 worktree 独立装依赖

- 删掉 B 树的 `node_modules` 联接（`cmd /c rmdir node_modules`，只删链接），在 B 树里跑 `pnpm install --offline --ignore-scripts --frozen-lockfile`：1.42 秒完成，包内容从本机内容仓库 `D:\.pnpm-store\v11` 硬链接过来，逻辑体积 124.5 MB；`pnpm-lock.yaml` 没被改动，`git status` 干净。
- B 树独立构建：9.27 秒，完整构建（新缓存，第一次必然全量）；产物 `client.js` 2096629 字节、`package/lib/client.js` 2099243 字节，与主工作区产物**逐字节相同**（SHA256 分别是 `FCA29662…` 与 `CE3FAD78…`，和主工作区基线一致）。原因是依赖目录就在构建根里面，esbuild 注释里的相对路径又变回 `node_modules/…`。
- 再跑一次：0.23 秒，日志「缓存命中：输入与产物都没变，这次没有重建、没有写任何产物文件」，四个产物的修改时间逐项不变。
- 主工作区全程没被碰：同一套快照脚本在独立构建后对比基线，`HEAD`、`git status`、`.git/index`、四个产物、`package/lib` 整树与四个产物目录的元数据指纹全部相同；主工作区的缓存条目也没变（`full` 条目输入指纹 `019fc9e3a96b…`）。
- 代价写清楚：124.5 MB 是逻辑体积，实际新增磁盘占用很少（硬链接共享同一份内容，且都在 D 盘）；真正新增的是每棵树的 inode 与目录项。冷存储或离线缓存里没有这些包时，安装要下载，时间另算；本次没有测。

## 九、需要补充的操作步骤（草案）

1. 开一棵隔离工作树：`git worktree add --detach .worktrees/<票号>-<用途> <基线提交>`。不要在 main 工作树里做这件票要隔离的事。
2. 依赖二选一：
   - 复用主工作区依赖：`cmd /c mklink /J <worktree>\node_modules <主工作区>\node_modules`。省 124.5 MB，但构建缓存与主工作区共用一份，两个会话同时构建时会互相作废（第七节）。
   - 独立依赖（推荐给会跑构建的会话）：不要建联接，在 worktree 里直接 `pnpm install --offline --ignore-scripts --frozen-lockfile`。本次实测 1.42 秒、124.5 MB 逻辑体积，换来的是一份独立缓存，第二次构建起 0.23 秒命中、不写产物。
3. 每个会话只在自己的 worktree 里跑构建与验证；不要在主工作区跑真构建。主工作区一旦被真构建，`package/lib/client.js` 的元数据会变，界面按现有判定会重挂载（`research/1311-client-bundle-reload-signal.md:162`）。
4. 要让界面看 worktree 的效果：把那一条 profile 目录下的 link（`…\profiles\desktop\node_modules\dsh-mattpocock-skills-deck`）临时指到该 worktree 的 `package/`，联调完再指回主工作区。这一步本次没有实测，属于待验证操作（会触发一次重挂载）。
5. 提交与推送仍按单会话规则走：worktree 隔离了索引文件，但两个会话同时往同一分支提交/推送仍会互相打断，需要人工约定同一时间只归一个会话做提交窗口。

## 十、对地图 #1319「还没说清」两处的回答

- 「git worktree 与本地 link 的目录指向如何配合」：已实测。link 指向主工作区时，worktree 的构建对界面不可见、也不互相覆盖；要联调必须显式把 link 指到目标 worktree 的 `package/`，这一步会触发一次重挂载。因此 worktree 方案能支撑「并行开发」，但「让界面看某一棵树」需要一次显式切换，不能指望自动。
- 「构建互斥用文件锁还是排程层互斥」：本票不替 #1323 拍板，但给出成本数据供决策——每个 worktree 独立装依赖只要 1.42 秒、逻辑体积 124.5 MB，就能让每棵树有自己的缓存、互不作废。如果接受这个成本，那么「两个会话必须排队跑构建」的紧约束可以放宽成「每个会话在自己的树里构建」；文件锁可能只剩「同一棵树内避免并发构建」这一层用途。

## 十一、没覆盖到的与残留风险

- 没有实测把 link 指到 worktree 再指回来这一整套切换动作，也没有实测切换后界面是否正常显示 worktree 的构建结果。
- 没有实测两个会话同时跑完整验证链（`npm run verify:parallel`）会不会在 worktree 之间互相影响；那是 #1323 的范围。
- 没有实测「冷存储」场景的独立安装耗时，也没有测 pnpm 之外的包管理器。
- 构建缓存共享时的「假命中窗口」（`research/1313-parallel-session-resources.md` 第一节）与本票无关，仍然存在；本票只是又发现一个「输入相同、产物字节不同」导致的正常 miss。
- 本次还观察到旁证：实验收尾阶段主工作区里有另一个会话在改 `config/prompts/ticket-action-templates.yaml` 与 `config/prompts/ticket-creation.yaml`（这两个文件都在构建输入清单里，见 `scripts/build.mts:105`），并在主工作区跑了一次真构建：主工作区 `package/lib/client.js` 从 `ce3fad78…` 变成 `ff29721e…`，界面版本标识从 `389b8e49b661` 变成 `4d85ccaa8bdf`。这正好说明「在主工作区跑真构建会改界面」这条判断在真实并发下仍然成立，也说明隔离要同时覆盖产物、依赖与缓存三样。

## 十二、复现命令（pwsh）

```powershell
# 1) 建两棵探针树并复用主工作区依赖
git worktree add --detach .worktrees/1322-probe-a 8b514a37
git worktree add --detach .worktrees/1322-probe-b 8b514a37
cmd /c mklink /J .worktrees\1322-probe-a\node_modules D:\dsh-plugin\dsh-mattpocock-skills-deck\node_modules
cmd /c mklink /J .worktrees\1322-probe-b\node_modules D:\dsh-plugin\dsh-mattpocock-skills-deck\node_modules

# 2) 先把观测与快照挂上，再并行构建（观测脚本见 .scratch/1322/）
node .scratch/1322/sse-probe.mjs 90000 .scratch/1322/sse-during.log
node .scratch/1322/snapshot.mjs baseline
# 在两个 worktree 里各跑一次 node scripts/build.mts（可并行后台）
node .scratch/1322/snapshot.mjs post
node .scratch/1322/compare.mjs baseline post

# 3) 每个 worktree 独立装依赖的对照
cmd /c rmdir .worktrees\1322-probe-b\node_modules
pnpm --dir .worktrees\1322-probe-b install --offline --ignore-scripts --frozen-lockfile
node .worktrees\1322-probe-b\scripts\build.mts
```

清理：`git worktree remove --force .worktrees/1322-probe-a .worktrees/1322-probe-b`；如果目录因为残留的忽略文件删不干净，先 `cmd /c rmdir` 删掉 `node_modules` 联接（这一步只删链接，不碰主工作区依赖），再删目录。

## 十三、关联笔记与票

- `research/1313-parallel-session-resources.md`：盘点了并行会话会互踩的五类资源（构建缓存、产物目录、git 索引、插件日志、临时片段）。这份笔记没有覆盖 worktree 与本地 link 目录指向如何配合，本票补的就是这一段。
- `research/1311-client-bundle-reload-signal.md`：DSH 对本机 link 插件的热更判定只看入口文件的修改时间、元数据变更时间与大小；本票的界面观测据此解释。
- `research/1312-freshness-gates-content-digest.md`：门禁仍按修改时间判产物新鲜度的盘点，与构建缓存内容摘要的替代方向。
- 相关票：#1319（地图）、#1323（同工作区构建互斥）、#1321（把并行会话开发规范写进仓库代理操作说明，被 #1323 与本票阻塞）、#1325（缓存命中不写产物）、#1326（产物新鲜度改内容摘要）。
