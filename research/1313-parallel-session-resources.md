# 研究：并行会话在同一工作区会互踩的资源盘点（#1313）

> 本文件只写从一手来源读到的事实。每条结论后面紧跟文件与行号。全文使用完整句子，只使用术语表里已有的词，或者不需要解释的大白话。

## 一、基线与只读声明

本次研究的基线提交是 `ecadaab35cfe7463d16dafbf20f760bac8e70afa`，提交时间是 2026-10-21 02:22:56 +0800，提交标题是「构建缓存命中时不再改动产物文件，并把命中与真构建的日志分开（#1325）」。当前分支是 `main`；采集基线时 `git status --porcelain` 为空，工作树干净。这个提交本身就是 #1325 的落地提交，所以下文说的「#1325 之后」就是当前这棵树的状态。

本文件是这次研究唯一新增的文件。除它之外没有改动任何文件，没有跑构建，没有跑全链门禁，没有安装依赖，没有提交，也没有动 issue。文中所有行号都来自本次实际读到的文件内容；个别只能确定大致范围的，会在原处说明。

调查期间主分支上又合入了别的会话的提交（#1311、#1312 的两份研究笔记，外加一处与本票无关的客户端与门禁改动）。这些提交没有动 `scripts/build.mts`、`scripts/verify-parallel.mts`，也没有动插件宿主的落盘代码，所以下文引用的行号仍以基线提交 `ecadaab` 读到的内容为准。那两份笔记在本笔记动笔时还不在树上，是调查期间由别的会话补交的；今天主分支上已经可以直接按路径打开它们。

题目说的「两个会话」，指两个各自独立的进程，共用同一份仓库工作区。这个模型不是假设：插件把运行期缓存目录算在「当前 DSH 进程的工作目录」下面，源码写的是 `platform.path.join(cwd0, '.dsh-mattskillsdeck-cache')`，注释还说明文件沙箱只允许写工作目录之下（`src/host/git-process.ts:381-390`）。所以只要两个进程在同一个工作区里启动，它们的缓存、日志就会落到同一个目录，构建与门禁也会读写同一批文件。

## 二、五类资源逐类说明

### （一）构建缓存

构建缓存只有一个文件：`node_modules/.cache/dsh-build.json`，缓存格式版本是 2（`scripts/build.mts:93-94`）。缓存按「构建模式」分条目，模式键是排序后的命令行参数，不带参数时是 `full`（`scripts/build.mts:192-195`）。一次命中要同时满足两件事：手写输入的内容指纹与缓存里记的一致，并且缓存记的每一个产物都还在盘上、逐字节哈希一致（`scripts/build.mts:185-190`、`scripts/build.mts:215-243`）。输入指纹由缓存版本、Node 版本、构建模式键，以及每个输入文件的相对路径和内容哈希一起算出（`scripts/build.mts:185-190`）。`--force` 或环境变量 `DSH_BUILD_NO_CACHE=1` 会跳过命中判定，强制重建（`scripts/build.mts:91-92`、`scripts/build.mts:217-219`）。

读缓存用 `JSON.parse(readFileSync(...))`，任何异常都返回空条目，也就是「读到半截 JSON 就当没有缓存」，不会让构建崩掉（`scripts/build.mts:197-204`）。写缓存是先读一遍旧文件，改自己那个模式的条目，然后 `mkdirSync` 再 `writeFileSync(CACHE_PATH, JSON.stringify(cache))` 整份覆写；没有临时文件，没有改名，也没有锁（`scripts/build.mts:245-258`）。构建产物的通用写函数也一样，是 `mkdirSync` 加 `writeFileSync` 直接写（`scripts/build.mts:262-266`）。

两个会话同时跑真构建时，缓存层面会发生三件事。第一，两个构建都先读旧缓存、各自改自己那个模式的条目、再整份写回，后写的会覆盖先写的；如果两个构建的模式不同，先写进去的那个模式的条目就可能丢，下一次那个模式只能完整重建（`scripts/build.mts:245-258`）。第二，一个构建正在覆写时另一个构建来读，可能读到半截内容，读的一方会当成空缓存，于是完整重建，但不会崩（`scripts/build.mts:197-204`）。第三，两个构建的输入如果不同，后写的缓存记录的是它自己的输入指纹与它自己算出的产物哈希；实际工作树里的产物却可能已经被另一个构建改过，下一次命中判定会因产物哈希不一致而重建，所以不会出现「缓存说命中、实际产物是错的」这种假命中，但会多花一次完整构建的时间（`scripts/build.mts:227-236`）。

#1325 改掉的是命中路径上的写盘行为。命中时构建一个文件都不写，产物的修改时间保持原样，缓存文件自己也不再重写；旧行为是命中时把产物修改时间提到当前，让「产物比源新」的门禁不误报，但本地 link 的插件正被界面使用，DSH 按文件变化热更客户端产物，于是每命中一次面板就闪一次（`scripts/build.mts:80-89`）。这条修复由门禁 `tests/verify-1325-build-cache-nowrite.ts` 守住：它连跑两次构建，第二次必须报「缓存命中：」，并且逐项比较缓存清单里每个产物的修改时间、存在性，以及缓存文件自己的修改时间与大小都不变（`tests/verify-1325-build-cache-nowrite.ts:4-14`、`tests/verify-1325-build-cache-nowrite.ts:111-171`）。门禁自己在第一次构建失败时会提示「可能有人正在同时改文件或构建」（`tests/verify-1325-build-cache-nowrite.ts:88`），这句话正好说明并发构建是它预料得到的干扰源。

但真构建仍然会写文件，也仍然会改修改时间。真构建收尾会用 `utimesSync` 递归把 `package/lib`、`package/shared`、`package/deck`、`package/tracker`、`package/scripts` 整树的修改时间提到当前，注释说明这是为了让 `verify-parse-leaf` 的「产物比源新」判据通过（`scripts/build.mts:1645-1660`）。DSH 对本机 link 安装插件的客户端产物，热更判定只看入口文件的修改时间、元数据变更时间与文件大小，内容字节不参与（`research/1311-client-bundle-reload-signal.md:162`）。所以一次 `--force` 重建、或者缓存缺失导致的重建，即使内容一个字没变，也会把这些目录的元数据全部改掉，必然触发一次面板重载（`research/1311-client-bundle-reload-signal.md:158`）。「命中不闪」只覆盖了命中路径，真构建路径仍然会闪。真正把门禁判据换成内容指纹是 #1326 的范围，当前树里还没有落地：代码里提到它的只有 `scripts/build.mts:89` 的一句注释，另有 `research/1312-freshness-gates-content-digest.md` 这份研究笔记在讨论它。

另一份缓存是并行门禁的耗时表 `node_modules/.cache/dsh-verify-times.json`（`scripts/verify-parallel.mts:266`）。开始时读一次，读失败就返回空对象（`scripts/verify-parallel.mts:266-274`）；收尾时再读一次、合并本次的耗时、整份写回，写失败只吞掉、不算链红（`scripts/verify-parallel.mts:395-403`）。两个 `verify:parallel` 同时收尾时，后写的会覆盖先写的，另一个进程这一轮新测到的耗时可能丢；这只影响下一次的排程顺序，不影响任何断言的对错。

现有的缓解都只在「同一次 `verify:parallel` 之内」有效：会真跑构建的门禁被分到同一节车厢，车厢内串行（`scripts/verify-parallel.mts:94-114`、`scripts/verify-parallel.mts:262-264`）；每节含构建的车厢最前面先跑一次预构建，让后面的门禁命中缓存（`scripts/verify-parallel.mts:299-316`）。预构建被明确标成 `optional: true`，注释原话是「预构建是提速手段，不是门禁：它失败不算链红（比如同一台机器上还有别人在构建，两边撞了）」（`scripts/verify-parallel.mts:310-312`）。这句话等于仓库自己承认了跨会话构建会相撞，并且选择「撞了就撞了，不判红」，没有做任何跨进程协调。

判断：构建缓存文件的并发写属于本仓可修，修法是「写临时文件再改名」保证读的一方永远看到完整旧文件或完整新文件，并按模式合并条目而不是整份覆盖；耗时表同理。两个真构建同时写产物则很难只靠缓存层修干净，需要构建锁或「每次构建写独立目录再整体切换」，成本高，短期更适合写进操作规范。

### （二）产物目录

产物的写侧集中在 `scripts/build.mts`。它写 `client.js`（`scripts/build.mts:1040-1046`）、`package/lib/client.js`（`scripts/build.mts:1048-1068`）、`host.js`（`scripts/build.mts:1475-1486`）和 `package/README.md`（`scripts/build.mts:412`）；写之前会做一次幂等清理：把 `package/lib` 里除 `client.js` 以外的项逐个删掉，再把 `package/shared`、`package/deck`、`package/tracker` 整个删掉，然后重新建目录（`scripts/build.mts:1488-1513`）。接着它把每个域的源码转译写进 `package/shared/<域>/<名>.js`（`scripts/build.mts:1520-1543`），把 `src/host` 下的 `.js` 逐个复制到 `package/lib`（同目录有同名 `.ts` 的 `.js` 跳过，`scripts/build.mts:1544-1577`）。此外构建还会现场跑三个生成器，直接往源码树里写 `src/client/kernel/prompt-data.ts`、`src/client/kernel/locale-data.ts`、`src/shared/time-config/src/values.ts`（`scripts/build.mts:1775-1792`；三个生成器的写点分别是 `scripts/generate-prompt-config.mts:191-204`、`scripts/generate-locale-config.mts:103-115`、`scripts/generate-time-config.mts:425-440`）。这些生成文件在 `.gitignore` 里被明确标成不入库（`.gitignore:51-65`）。

产物的读侧很宽。发布入口 `package/package.json` 的 `main` 指向 `lib/index.js`，`exports` 里 `./client` 指向 `./lib/client.js`（`package/package.json:13`、`package/package.json:18-23`）；本机 link 安装下的真机测试直接改仓库里的 `package/package.json`（`research/1312-freshness-gates-content-digest.md:107`），说明 link 装的是 `package/` 这一份；所以界面与宿主读的是 `package/lib/` 下的产物。测试侧同样如此：本次用 `package/lib` 这一串在 `tests/` 下搜到 80 个文件（包含冒烟与辅助模块），例如 `tests/verify-958-label-name-visible.ts:29-30` 默认读 `package/lib/client.js`，缺产物时提示「先跑 node scripts/build.mts」；`docs/agents/verification.md:92-94` 也说明有几十扇门禁只读 `package/` 下的产物。DSH 本地 link 的热更加载读客户端产物这件事，构建注释里写得很直白：插件被界面使用，DSH 按文件变化热更客户端产物（`scripts/build.mts:86-89`）。热更判定只看入口文件的修改时间、元数据变更时间与文件大小（`research/1311-client-bundle-reload-signal.md:162`）；这里只把它当读侧背景，不深挖。

写侧不是原子写。`write()` 是 `mkdirSync` 加 `writeFileSync` 直接写（`scripts/build.mts:262-266`），清理又是「先删再建」（`scripts/build.mts:1488-1513`）。于是一个进程写到一半、另一个进程来读时，会看到三种坏状态：文件被删掉、文件存在但内容只写了一半、目录里一半是新产物一半是旧产物。读的一方如果是门禁，可能报「产物缺失」或解析失败；如果是 DSH 的热更加载，入口文件的元数据在写的过程中就变了，每 500 毫秒一次的轮询会重载这个插件（`research/1311-client-bundle-reload-signal.md:162`）；如果这时读到半个脚本，加载就失败，表现就是面板闪烁或反复重载。

两个会话同时跑真构建时，冲突面更大。两个构建都会先删 `package/lib`（除 `client.js`）与 `package/shared`、`package/deck`、`package/tracker`，再各自写回；删除与写入交错，最终每个文件由最后一个写者决定，整棵树可能是两个构建世代的混合。每个构建自己算的缓存产物哈希是在它写完之后算的，如果另一个构建随后又改了文件，下一次命中判定会发现哈希不一致并重建（`scripts/build.mts:227-236`），所以缓存不会把混合树当成命中；但在两次构建之间跑的门禁，读到的就是混合树。门禁读到的内容与它想验的源码世代可能对不上，红绿都不可信。

#1325 之后，命中路径已经不再碰产物，所以「两个会话各自跑一次构建、都命中」不会再改 `package/lib` 的修改时间与元数据变更时间；DSH 的判定只看这两样加上文件大小（`research/1311-client-bundle-reload-signal.md:162`），所以不会再触发重载。仍然存在的是：任一方跑真构建（首次、`--force`、输入变化、产物被改过）都会删目录、重写文件，并在收尾 touch 整棵产物树（`scripts/build.mts:1645-1660`）；两个真构建交错时没有锁，而且真构建即使内容没变也必然触发一次重载（`research/1311-client-bundle-reload-signal.md:158`）。现有缓解仍然只有同一次 `verify:parallel` 里的车厢与预构建（`scripts/verify-parallel.mts:262-264`、`scripts/verify-parallel.mts:299-316`），跨会话没有协调。`docs/agents/verification.md:41-52` 把「互斥步骤合成车厢、车头预构建、构建缓存」写成并发跑得快的三件事，但这三件事的作用范围就是一次链，文档没有声称能管两个会话。

判断：产物目录的「一个构建写、另一个读」属于本仓可修，优先级最高的一条是把产物写改成「同目录临时文件加改名」，把「先删再建」改成「新目录写好再整体切换」，这样读的一方至少不会看到半截文件；其次是加一个构建锁（独占创建锁文件，带进程号与时间戳，避免死锁）。「两个真构建同时跑」则更适合写进规范：同一工作区同一时刻只让一个会话跑真构建，另一个会话要读产物就等它结束，或者只跑命中缓存的构建。

### （三）git 索引

本仓库里会写 git 索引的，只有人和代理手里的 git 命令，以及插件版本管理面板的写命令。`src/shared/version-control/src/commands.ts` 把所有 git 命令的固定前缀写成 `--no-optional-locks`，注释是「后台不抢锁」（`src/shared/version-control/src/commands.ts:35-37`）；读命令有 `status`、`diff`、`log`、`worktree` 等（`src/shared/version-control/src/commands.ts:74-94`），写命令清单是 `add`、`reset`、`commit`、`pull`、`push`、`fetch`、`ls-files`、`remote`（`src/shared/version-control/src/commands.ts:100`），其中暂存是 `git add -- <路径>`、取消暂存是 `git reset HEAD -- <路径>`、提交是 `git commit -m <消息>`（`src/shared/version-control/src/commands.ts:120-130`）。`--no-optional-locks` 只让读命令不去抢「可选锁」，写命令该拿的 `index.lock` 仍然会拿，所以面板的读不会干扰别人，面板的暂存与提交会和代理的 git 命令争同一把锁。

测试与门禁基本不碰本仓的索引。会写索引的测试都在临时目录里初始化自己的仓库：`tests/verify-no-mixed-session.ts:107-123` 在临时目录里跑 `git add .` 与 `git commit`，`tests/verify-t1-initpublish.ts:299-304`、`tests/verify-t1-initpublish.ts:323-326` 与 `tests/verify-t1-getrepokey.ts:140-144`、`tests/verify-t1-getrepokey.ts:260-263` 也是在临时目录里 `git init`、`git add`、`git commit`。其余对 git 的调用是只读的：`tests/verify-log-exec-606.ts:314` 只跑 `git cat-file commit HEAD`，`tests/verify-time-config.ts:600` 只跑 `git ls-files src`，`tests/verify-839-credential-exec.ts:311` 只跑 `git config --get`。脚本里只有发布向导 `scripts/wizard-release.sh:159-194` 有 `git status` 与 `git push`，那是人工发布时用的。在本仓源码、脚本、测试与文档里搜索 `index.lock`，除本笔记自身外零命中，说明仓库没有针对索引锁的代码或文档；搜索 `GIT_INDEX_FILE` 只命中 `research/1013-src-host-type-config.md:109`，那是研究时借临时索引做实验，代码里没有「按会话分索引」的实现。

两个会话同时暂存或提交时，冲突来自 git 索引本身是工作区共享的，而不是来自某段仓库代码。索引只有一份，会话甲 `git add A`、会话乙 `git add B`，两次暂存会落在同一份索引里；随后会话甲执行面板的 `git commit -m`（参数里没有路径限定，见 `src/shared/version-control/src/commands.ts:120-130`），就会把乙暂存的 B 一起提交进去。两个提交真正同时发生时，git 的 `index.lock` 会让其中一个失败，失败的一方需要重试；但「先后暂存、任一提交」这种交错不会报错，会安静地把别人的改动带走。两个会话同时 `git status` 的风险低一些：插件命令带了 `--no-optional-locks`，不会去抢可选锁；代理直接跑普通的 `git status` 时是否刷新索引、是否会短暂拿锁，取决于 git 版本，本次没有做实验验证。

仓库现有的规定属于操作规范，不是并发锁。`AGENTS.md:38` 要求每个可以独立交付的模块完成就提交推送，这缩短了未提交改动在树上停留的窗口，间接减少两个会话交错暂存的机会；`AGENTS.md:40` 要求只用不会丢文件、不改写历史的命令，例如 `git status`、`git diff`、`git log`、`git add`、`git commit`、`git push`、`git pull --ff-only`；`AGENTS.md:42` 禁用 `reset --hard`、`checkout .`、`clean -f`、`push --force`、`rebase`、`filter-branch`。这些规定管的是「不要把文件弄丢、不要改写历史」，没有一句说「两个会话不要同时暂存」或「提交前先确认索引里有没有别人的东西」。

判断：git 索引的冲突基本只能靠规范约束。可以让代理在提交前先看 `git status`、只提交自己确认为自己的路径、避免 `git add -A` 或 `git add .`；面板提交最好改成带路径限定的提交，或者提交前把索引内容展示给人确认。真正要用「每个会话一份索引」也能做（设置 `GIT_INDEX_FILE`），但那会让面板、代理、人三方的暂存状态互相看不见，属于工作方式变更，不适合当成顺手的小修。

### （四）插件日志

日志落点是「DSH 进程工作目录」下的 `.dsh-mattskillsdeck-cache/logs/YYYY-MM-DD.log`。目录由 `src/host/git-process.ts:381-390` 算出，`src/host/logStore.ts:40-55` 定义 `logs` 目录名、`log-switch.json` 开关文件和按自然日分文件的文件名格式，`src/host/logStore.ts:203-206` 把它拼成当天的完整路径。写日志有两条路：宿主启动时先尝试 `src/host/logFromPackage.ts`，它动态 `import('dsh-log/host')` 并调用 `createHostLog`（`src/host/logFromPackage.ts:46-62`）；这条失败时，`src/host/index.ts:327` 会回退到插件自己的 `createLogStore`。两条路落的是同一个目录、同一类按天文件，`node_modules/dsh-log/dist/host.js:5` 的注释也说明插件传的标识是 `wf`，落盘目录与开关文件名不变。

插件自己的 `logStore` 是明确的单写者模型：注释说「宿主是唯一的落盘者」（`src/host/logStore.ts:32`）。一次写批次先把当天文件整份读进来，读失败当空串，再把新文本拼在后面整份写回（`src/host/logStore.ts:188-212`）。它的 `flushNow` 只有一个实例内的 `flushing` / `flushQueued` 防重入（`src/host/logStore.ts:164-187`），没有跨进程锁；普通日志按 `LOG_WRITE_DEBOUNCE_MS` 防抖，`error` 与 `warn` 直通（`src/host/logStore.ts:141-157`）。按天分文件只是把单次覆写的体积封顶在一天之内，没有轮转、改名或截断逻辑（`src/host/logStore.ts:40-55`、`src/host/logStore.ts:188`）。启动时会写一条带头 `host.start`，里面带进程号、启动时间与目录（`src/host/logStore.ts:253-262`），所以事后还能分辨某几行来自哪个进程，但分辨不等于不丢。

`dsh-log` 比 `logStore` 多一层「目录占用」：一个实例拿到目录后，另一个实例来拿会等 200 毫秒，等不到就标记冲突、本实例不写共享文件（`node_modules/dsh-log/dist/engine/dir-lease.js:13`、`node_modules/dsh-log/dist/store.js:115-121`）。但这层占用是「模块副本级状态」，每个模块副本一份登记表，同一进程里两份打包副本互相看不见，跨进程更是零保护，注释原话如此（`node_modules/dsh-log/dist/engine/dir-lease.js:4-5`）。所以两个独立进程各自加载一份 `dsh-log` 时，双方都可能认为自己拿到了目录，跨进程这一层等于没有。

真正决定并发后果的是文件系统端口有没有「追加」能力。`dsh-log` 的写盘分两种：端口有 `appendText` 时只追加新增行，没有时读旧文、拼新行、全文覆写（`node_modules/dsh-log/dist/engine/pipeline.js:708-710`、`node_modules/dsh-log/dist/engine/pipeline.js:714`）。追加走的是 `appendFile`（操作系统层的追加打开），单次追加在 4096 字节以内是原子的；`node_modules/dsh-log/dist/engine/io.js:3-13` 的注释记录了一次实测：两个进程各追加 20 行、每行 64KB 时，40 行里有 2 行读不出来（半行 JSON），把每次追加缩到 4KB 以内后坏行是 0。没有追加能力时就是整份读改写，两个进程交错会互相覆盖：甲读到旧文、乙读到同一份旧文，甲写回自己的新增、乙再写回自己的新增，甲那批行就丢了。`pipeline.js` 能通过「读回长度与自己记账不符」发现「有外人写过」，会记一条 `foreign-write` 失败，但仍然继续写（`node_modules/dsh-log/dist/engine/pipeline.js:740-744`）；文件超过阈值时会改名封存，没有改名能力就降级继续追加并记 `log.rotate.degraded`（`node_modules/dsh-log/dist/engine/pipeline.js:760-793`）。

插件传进去的文件系统端口有没有 `appendText`，本次没能证实。插件入口只写了 `const fs = ctx.get('fs')`（`src/host/index.ts:27`），并把同一个 `fs` 传给两条日志实现（`src/host/index.ts:327`）；本仓 `src/host` 与 `tests` 搜索 `appendText` 零命中；DSH 运行时是一个单文件 `app.asar`（约 1.8 亿字节），本次没有解包工具，无法读到运行时给的文件系统实现。所以只能分两种情况说：有追加能力时，两个进程写同一天日志会出现行与行交错，但每一行大概率完整，丢掉整行的情况少；没有追加能力时，两个进程的整份读改写会互相覆盖，丢行是必然的，只是丢多丢少看交错时机。

日志门禁的现状要分开看。`tests/verify-log-exec-606.ts:244-252` 会把日志文件按行切开、逐行 `JSON.parse`、过滤坏行，再数 `exec.run` 行数并断言等于起命令的次数；它用 `mkdtempSync` 建自己的临时目录并把它当作缓存目录（`tests/verify-log-exec-606.ts:216`、`tests/verify-log-exec-606.ts:225`），读的日志就在这个临时目录里（`tests/verify-log-exec-606.ts:244-252`），不读工作区里的真实日志，所以跨会话日志丢失不会让这扇门禁变红。`tests/verify-log-store.ts:132-155` 用内存文件系统连写 20 行，断言逐行能解析、顺序不乱，也不涉及两个进程。其余 `verify-log-*` 主要读源码形状或研究附录的对照表。结论是：日志并发冲突目前主要伤害「事后诊断的完整性」，不是当前门禁的红绿；但如果将来有门禁去读工作区真实日志，丢行就会直接变成计数不足的假红。

判断：日志属于「部分本仓可修」。最直接的一条是让插件给 `dsh-log` 传入带 `appendText` 的文件系统端口，或者在没有追加能力时退回「每个进程一个文件、读取时按时间合并」，避免整份读改写互相覆盖。跨进程的目录租约本身修在 `dsh-log`，那是独立仓库，不是本仓能单独改完的；在本仓这一侧，至少可以做到「追加优先、绝不整份覆写」。规范上则要写清楚：需要完整日志做诊断时，同一工作区别让两个会话同时写日志。

### （五）临时目录

固定在仓库根 `.tmp/` 下的共享临时文件有两份，都是构建的中间输入：`.tmp/vocabulary.client.js` 与 `.tmp/time-config.client.js`。构建在拼客户端闭包时读它们（`scripts/build.mts:678-681`、`scripts/build.mts:714`），在更早的阶段写它们（词汇表在 `scripts/build.mts:1200-1215`，时间常量在 `scripts/build.mts:1878-1890`）。两份都是固定名字，没有进程号、没有随机后缀，也没有锁。两个构建同时跑时，甲写完词汇表片段、乙又写了一遍，甲再去读，读到的可能是乙的内容；如果两边输入相同，内容一样，看不出问题；如果两边输入不同（一个会话刚改了配置，另一个会话还在用旧配置），甲拼出来的客户端就可能混进乙的片段。更麻烦的是 `.tmp` 是点目录，构建扫描输入时会跳过所有点开头的文件与目录（`scripts/build.mts:129-152`），所以缓存指纹根本不包含这两份片段，无法靠缓存发现自己拼错了。

构建里也有做对的临时文件：语法检查用的是 `.tmp/gate-syntax-check-<process.pid>.mjs`，进程号进了文件名（`scripts/build.mts:434`）。测试侧的临时目录大多用 `mkdtemp`，例如 `tests/smoke-naming-persistence.test.ts:15`、`tests/verify-1058-markdown-read-log.ts:110`、`tests/verify-1109-matches-timeout.ts:71`；脚本侧 `scripts/fix-issue-body.mts:427` 与 `scripts/wire-subissues.mts:740` 也用 `mkdtemp`。这些不会互相撞。

固定名字的证据文件有两份：`tests/verify-deck-tools-matrix.ts:489` 写 `.tmp/1299-dual-lane-evidence.md`，`tests/verify-deck-tools-matrix.ts:508` 写 `.tmp/713-backend-matrix.md`。它们只被这一扇门禁写，写成功就 `check(true, ...)`，不读回、不比较内容。两个会话同时跑这扇门禁时，后写的会覆盖先写的，证据文件只剩一份，但两边都会绿；这不是正确性冲突，是证据丢失。

`.compile/`、`.typecheck-*.txt`、`.verify-all-*.log` 在本仓 TypeScript 代码里找不到写者。`.compile/` 在 `.gitignore:13-14` 的注释里被说明为写 issue 正文时的草稿落点（研究笔记里也提到过它）；`.typecheck-*.txt` 在本次找到的说明里只出现在研究笔记的排除清单；`.verify-all-*.log` 在 `.gitignore:114-116` 的注释里被说明是人手动把 `verify-all` 输出重定向过去的。这些是人工操作的固定名字，不是自动流程的一部分；两个会话如果恰好写同一张票的草稿或同一个票号的日志，会互相覆盖，但概率与影响都低。

`tests/.tmp-repo-out/` 与 `tests/.tmp-repo-out2/` 是历史遗留的临时仓库副本，今天的代码没有写者；构建扫描输入时会跳过点目录，所以它们也不会进入输入指纹（`scripts/build.mts:140-141`）。它们占着固定名字，但当前不会造成并发冲突，只是容易让搜索源码的门禁扫到假代码——`tests/verify-contract-vocabulary.ts:67` 的注释就记录过这个坑。

同一次 `verify:parallel` 的 8 个工人之间，本次没有找到「两个不同门禁写同一个固定临时名」的直接例子。真跑构建的门禁被分在同一节车厢串行（`scripts/verify-parallel.mts:94-114`、`scripts/verify-parallel.mts:262-264`），所以构建片段只有一个人在写；矩阵门禁只有一扇，固定证据文件也只有它在写。仓库已经承认的并发干扰不是临时文件名，而是「门禁往工作树写探针文件，让扫源码的门禁假红」：`scripts/verify-stages.json:46-67` 因此把 `verify-1136`、`verify-1152`、`verify-1159`、`verify-1161` 排除出链，注释原话是「样本门禁，会往工作树写探针文件，并发跑会让扫源码的门禁假红」（`scripts/verify-stages.json:49-51`，同理由见 `:53-66`）。这是本仓在「门禁写工作树 + 并发」这件事上最明确的一次让步。

判断：`.tmp` 下固定名字的构建片段属于本仓可修，修法是每次构建用独立临时目录（进程号或随机后缀），拼装时只读自己那一份，或者写临时文件再原子改名。固定证据文件可以改成带进程号的名字，或者干脆不写进共享的 `.tmp`；但影响只是证据覆盖，优先级低于构建片段。人工用的 `.compile/`、`.verify-all-*.log` 只能靠规范：写草稿和重定向日志时文件名带上票号与会话标识，别用会撞的固定名。

## 三、汇总表

下表按五类资源拆到具体冲突面。「归属」一列只分两种：本仓可修，指改本仓的源码或脚本能消掉或大幅降低；只能靠规范约束，指本仓代码管不到，或者修起来会改变工作方式、不适合顺手做。

| 资源 | 冲突触发条件（两个会话同时做什么） | 现有缓解做法 | 归属 |
|---|---|---|---|
| 构建缓存文件 `node_modules/.cache/dsh-build.json` | 两个会话同时跑真构建，且构建模式不同 | 缓存只当加速；读坏当空；#1325 命中不写 | 本仓可修：临时文件加改名、按模式合并条目 |
| 构建缓存文件 | 一个会话真构建写缓存时，另一个会话真构建读缓存 | 读到半截 JSON 当空缓存，完整重建，不崩 | 本仓可修：原子写 |
| 构建耗时表 `dsh-verify-times.json` | 两个会话同时跑 `verify:parallel` 并同时收尾 | 读失败返回空；写失败吞掉，不影响红绿 | 本仓可修：合并加原子写 |
| `package/lib`、`package/shared` 等产物 | 一个会话真构建清理或重写时，另一个会话的门禁读产物 | 同一次链内车厢加预构建；跨会话无 | 本仓可修：原子替换 |
| 产物目录 | 两个会话同时跑真构建，输入还可能不同 | 缓存哈希事后发现不一致并重建；门禁可能读到混合世代 | 只能靠规范：同一工作区同时只跑一个真构建 |
| 生成源文件 `prompt-data.ts`、`locale-data.ts`、`values.ts` | 一个会话构建写生成文件时，另一个会话跑类型检查或构建读 | 无 | 本仓可修：生成器写临时文件再改名 |
| `.tmp/vocabulary.client.js`、`.tmp/time-config.client.js` | 两个会话同时构建，写片段与读片段交错 | 无；缓存也看不到点目录里的片段 | 本仓可修：每次构建独立临时目录 |
| `.tmp/1299-dual-lane-evidence.md`、`.tmp/713-backend-matrix.md` | 两个会话同时跑同一扇矩阵门禁 | 固定名覆盖，后写的赢，两边都绿 | 本仓可修：文件名带进程号 |
| git 索引 | 两个会话同时 `git add` 或同时 `git commit` | git 的 `index.lock` 让其中一个失败；AGENTS 纪律 | 只能靠规范：同一时刻一个会话管暂存与提交 |
| git 索引 | 两个会话各自暂存不同文件，随后任一提交 | 无；索引共享，暂存内容会合并进同一个提交 | 只能靠规范：提交前核对 `git status`，只提交自己的路径 |
| git 索引读 | 两个会话同时 `git status` | 插件命令带 `--no-optional-locks`；普通命令可能刷新索引 | 只能靠规范：代理直接跑读命令时别和提交交错 |
| 插件日志 `logs/日期.log` | 两个会话同一天同时写日志 | 单实例单写者；`dsh-log` 目录租约只护同进程 | 本仓可修：追加写或按进程分文件 |
| 插件日志 | 一个会话轮转或覆写时，另一个会话读日志做诊断（或将来有门禁读真实日志） | 读侧过滤坏行；跨进程无保护 | 只能靠规范：诊断时只让一个会话写日志 |
| 工作树探针文件 | 写探针的门禁与扫源码的门禁并发 | 把样本门禁排除出链（`verify-stages.json`） | 本仓可修：已用排除表缓解 |

## 四、为什么既有笔记不够

动笔前读了下面这些笔记与文档，逐一确认它们能不能直接回答「五类资源在跨会话并发下的冲突面、缓解、归属」。结论是不能，原因如下。

- `research/1010-verify-baseline.md`：它记录了一次真实现场——采集基线时有并发会话在写 `src/client/kernel/store-prefs.js`，`verify-locale-completeness` 批跑红、单跑绿，判定为「读到了写到一半的文件」（`research/1010-verify-baseline.md:7`、`research/1010-verify-baseline.md:64`），并建议在安静的树上测（`research/1010-verify-baseline.md:73`）。但它只记了这一个现象，没有盘点五类资源，也没有给缓解与归属。
- `research/1010-adversarial-executability.md`：它记录了同一扇 `tests/verify-settings-debug.js` 两次重跑读数不同（从 364 变 351，还多出两条失败），作者承认当时有并发会话在写 `src/client/kernel/` 一带（`research/1010-adversarial-executability.md:107`、`research/1010-adversarial-executability.md:126`）。这是「并发让门禁结果不可重复」的证据，但不是资源冲突面清单。
- `research/1020-类型检查与层级边界判据查证.md`：它讲的是类型检查的 `.tsbuildinfo` 用文件清单加内容哈希判断「变了没有」，还做了只改修改时间不动内容的实验（`research/1020-类型检查与层级边界判据查证.md:483-545`）。它给的是「判据该看内容而不是修改时间」的参照，没有涉及两个会话共享工作区。
- `research/613-builtin-ts.md`：它记录的是旧 `.js` 时代的产物新鲜度断言，按修改时间判断产物不早于源（`research/613-builtin-ts.md:146`）。它是 #1326 那条线的历史背景，不涉及并发。
- `research/1311-client-bundle-reload-signal.md`：它用实测回答了读侧的判定依据——DSH 对本机 link 安装插件的客户端产物，只看入口文件的修改时间、元数据变更时间与文件大小，内容不参与（`research/1311-client-bundle-reload-signal.md:162`）。它回答的是「什么会触发重载」，没有盘点五类资源，也没有给缓解与归属。
- `research/1012-final-plan.md`：它盘点的是运行期缓存落点，例如 `.dsh-mattskillsdeck-cache/*` 与日志开关 `log-switch.json`（`research/1012-final-plan.md:143`、`research/1012-final-plan.md:296`）。它回答「东西落在哪」，不回答「两个会话同时写会怎样」。
- `research/1312-freshness-gates-content-digest.md`：这是最接近的一份。它明确写了构建缓存的并发风险：`writeBuildCache()` 整文件覆盖写、没走临时文件加改名，两个构建同时写时后写的赢，读的一方读到半截 JSON 当空，并建议改成临时文件加改名（`research/1312-freshness-gates-content-digest.md:287`）。但它只覆盖构建缓存与产物新鲜度这一条线，没有 git 索引、插件日志、临时目录，也没有「本仓可修还是只能靠规范」的归属表；它的目标是 #1326 的判据改造，不是跨会话资源盘点。
- `docs/agents/verification.md`：它把「互斥步骤合成车厢、车头预构建、构建缓存」写成并发跑得快的原因（`docs/agents/verification.md:41-52`），也说了并发红步会串行重跑、复跑才红标 `flaky`（`docs/agents/verification.md:38-39`）。但这套机制的作用范围是一次 `verify:parallel`，文档没有声称能协调两个独立会话。

所以本笔记的增量是：把五类资源放在同一张表里，逐条给「两个会话同时做什么」的触发条件、现有缓解的实际作用范围，以及「本仓可修 / 只能靠规范」的归属；同时把 #1325 之后仍然存在的真构建写盘与元数据变化问题单独标出来。

## 五、结论与建议

#1325 之后消掉的是「缓存命中导致产物元数据变化」这一条。命中路径现在一个文件都不写，缓存文件自身也不重写，门禁 `tests/verify-1325-build-cache-nowrite.ts` 会逐项检查产物修改时间、缓存文件修改时间与大小都没变（`tests/verify-1325-build-cache-nowrite.ts:111-171`）。DSH 的热更判定只看入口文件的修改时间、元数据变更时间与文件大小（`research/1311-client-bundle-reload-signal.md:162`），而命中路径一个文件都不写，所以两个会话各自跑一次命中缓存的构建，不会再让面板闪。

仍然存在、且本仓值得修的有四条，按优先级排列。

1. **产物写盘改成原子替换。** 现在 `write()` 是直接 `writeFileSync`（`scripts/build.mts:262-266`），清理是先删再建（`scripts/build.mts:1488-1513`）。可以先写同目录临时文件再 `rename`，清理改成「新目录写好再整体切换」。这样另一个会话的门禁或热更加载至少不会读到半截文件。这是收益最大、改动面最集中的一条。
2. **构建缓存改成临时文件加改名，并按模式合并条目。** 现在整份覆盖写（`scripts/build.mts:245-258`），两个构建不同模式会互相丢条目。临时文件加改名能保证读的一方看到完整文件；如果还想不丢条目，写回前重新读一次并只更新自己的模式，或者用锁。耗时表 `dsh-verify-times.json` 同理（`scripts/verify-parallel.mts:395-403`）。
3. **构建中间片段用每次构建独立的临时目录。** `.tmp/vocabulary.client.js` 与 `.tmp/time-config.client.js` 是固定名（`scripts/build.mts:1200-1215`、`scripts/build.mts:1878-1890`），而 `.tmp` 不进输入指纹（`scripts/build.mts:129-152`）。可以建一个带进程号或随机后缀的目录，构建结束再删；语法检查已经用了进程号（`scripts/build.mts:434`），照着做即可。
4. **日志走追加而不是整份覆写。** 插件自己的 `logStore` 是读全文再写全文（`src/host/logStore.ts:188-212`），跨进程必丢行。要么给 `dsh-log` 传带 `appendText` 的文件系统端口，要么在没有追加能力时按进程分文件。`dsh-log` 的跨进程目录租约修在独立仓库，本仓能做的是「追加优先」。

只能写进规范的有三条。

1. **同一工作区同一时刻只让一个会话跑真构建。** 两个真构建交错会删目录、重写、touch 整棵产物树（`scripts/build.mts:1488-1513`、`scripts/build.mts:1645-1660`），本仓的缓存与车厢都管不到跨进程。规范应写明：要读产物就先等构建结束；只想确认缓存命中可以跑，但 `--force` 与首次构建要错开。
2. **git 暂存与提交同一时刻只归一个会话。** 索引只有一份，面板提交是 `git commit -m` 不带路径限定（`src/shared/version-control/src/commands.ts:120-130`），会把另一个会话暂存的内容一起提交。规范应写明：提交前先看 `git status`，只 `git add` 自己的路径，不要用 `git add -A` 或 `git add .`；两个会话都要提交时，先约好谁先谁后。
3. **需要完整日志做诊断时，只让一个会话写日志。** 两个独立进程各加载一份 `dsh-log`，目录租约跨进程不生效（`node_modules/dsh-log/dist/engine/dir-lease.js:4-5`）；没有追加能力时整份读改写会互相覆盖（`node_modules/dsh-log/dist/engine/pipeline.js:708-710`）。规范应写明：排查日志前先确认没有另一个会话在写同一个工作区的日志。

#1326 还没做，所以「产物新鲜度按修改时间判」的门禁仍然存在。这一条不属于本次五类资源的并发冲突，但它和 #1325 是同一根线：只要门禁还看修改时间，真构建收尾就还得 touch 整棵产物树（`scripts/build.mts:1645-1660`），真构建路径的面板闪就无法彻底消掉。建议在 #1326 落地后，把这段 touch 一并去掉，并复核 `tests/verify-ctx.ts:15-27`、`tests/verify-leaves.ts:128-130`、`tests/verify-log-artifacts.ts:96`、`tests/verify-log-client.ts:221` 这些按修改时间比较的地方。

值得新建的票，按性价比排：

- 一张「构建产物与构建缓存改成原子写」的小票：改 `scripts/build.mts` 的 `write()`、清理逻辑、`writeBuildCache()`，加一扇门禁模拟「读的一方在写的中途读」。
- 一张「构建中间片段按构建隔离」的小票：把 `.tmp/vocabulary.client.js` 与 `.tmp/time-config.client.js` 挪进每次构建独立的临时目录。
- 一张「插件日志追加写」的小票：先查清 DSH 给的文件系统端口有没有 `appendText`，没有就在本仓包一层 `appendFile`；有就直接用。
- 一张规范票：把上面三条写进 `AGENTS.md` 或 `docs/agents/verification.md`，明确「同一工作区同时只跑一个真构建、暂存提交同一时刻只归一个会话、诊断日志只让一个会话写」。

## 六、没能证实的地方

- **DSH 热更判定的依据，本笔记没有独立复测。** 这里的结论引用 #1311 的实测：对本机 link 安装插件的客户端产物，只看入口文件的修改时间、元数据变更时间与文件大小，内容字节不参与（`research/1311-client-bundle-reload-signal.md:162`）；#1311 同时说明真构建必然改元数据、必然触发一次重载（`research/1311-client-bundle-reload-signal.md:158`）。本次没有读 DSH 运行时实现，也没有重跑那个实验，只把它当读侧背景。
- **#1325 门禁用修改时间当「没写盘」的证据，没有直接比较元数据变更时间。** 它断言的是每个产物的修改时间、存在性与大小不变（`tests/verify-1325-build-cache-nowrite.ts:111-171`），理由写在文件头：写文件必然把修改时间抬到当前（`tests/verify-1325-build-cache-nowrite.ts:13-14`）。一次写入也会改元数据变更时间，所以这个代理证据够用；但门禁没有单独断言它。
- **插件拿到的文件系统端口有没有 `appendText`。** 插件入口只写了 `const fs = ctx.get('fs')`（`src/host/index.ts:27`），本仓源码与测试里没有 `appendText` 的引用；DSH 运行时是单文件 `app.asar`，没有解包工具，读不到它给的文件系统实现。因此「日志并发会丢行」的严重程度只能分两种情况说，不能给唯一结论。
- **git 的 `index.lock` 在两个提交真正同时发生时的具体表现。** 仓库里没有针对 `index.lock` 的代码或文档（在源码、脚本、测试与文档里搜索，除本笔记自身外零命中），本次也没有做「两个进程同时 commit」的实验。失败的一方是否会立刻报错、是否需要重试、重试会不会成功，都是 git 自身的行为，本笔记只按「其中一个会失败」的通用语义描述。
- **普通的 `git status` 是否一定刷新索引并短暂拿锁。** 插件给所有命令加了 `--no-optional-locks`，注释说「后台不抢锁」（`src/shared/version-control/src/commands.ts:35-37`），这说明作者认为读命令可能拿可选锁；但具体到本机 git 版本、具体到两个 `status` 同时跑会不会互相影响，本次没有实验证据。
- **`.compile/`、`.typecheck-*.txt`、`.verify-all-*.log` 当前有没有实际写者。** 代码里搜索不到写者，只有 `.gitignore` 的注释与研究笔记的排除清单提到它们；它们可能是人工命令的落点，也可能是历史遗留。本笔记只能说「自动流程里没有写者」，不能说「今天绝对没人写」。
- **同一次 `verify:parallel` 里 8 个工人撞固定临时名的直接例子。** 本次没有找到。能确认的是仓库因为「样本门禁往工作树写探针文件、并发会让扫源码的门禁假红」而把四扇门禁排除出链（`scripts/verify-stages.json:46-67`）；这是工作树文件冲突，不是 `.tmp` 固定名冲突。不能因为没找到例子就断言「一定没有」，只能说「在本次读到的代码里没有第二个写者」。
- **两个会话在真实工作流里同时跑真构建的概率。** 本次没有统计实际运行记录，也没有测两个构建同时跑的结果；冲突面是从代码路径推出来的，不是实测出来的。
- **`.tmp/1299-dual-lane-evidence.md` 与 `.tmp/713-backend-matrix.md` 是否被别的流程读回。** 写侧只有 `tests/verify-deck-tools-matrix.ts:489` 与 `:508` 两处，读侧没有搜到；所以「后写的覆盖先写的」只影响人看证据，不影响门禁判红。这一条是搜索结论，不是运行时观察。
