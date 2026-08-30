# 环境检查（checks 面板）· 平台底座层 · 全链路研究笔记

> 写作日期：2026-08-29（以文件系统日期为准；用户原话为「2026-08-28 的本地日期」，本笔记写成当天日期）。
> 所有事实均从仓库源码第一手核实（src 真源），引用采用【文件:行号】格式。
> 只读研究，未改动除本文件外的任何文件；不提交 git。

---

## 1. 结论摘要（第一性原理一句话）

【检查 = 声明目录（shared/check-catalog.js，只描述不执行）→ 执行谓词（host 侧 predicateRegistry + host 内联后端谓词）→ 修复契约（后端 fixes → host 组装到 onFail）→ 链快照（host 内联 stepEvalParallel / enrichSnap / fullSnapshot）→ UI 只渲染与分发（ChecksTab + ChainRenderer + actions.js，零判定）】。全部判断发生在 host 侧；UI 无任何状态判定逻辑。

- 真实判断在哪里发生：primitive 检查在 predicateRegistry.js:execPrimitive；backend/preflight 检查在 host/index.js 的 wf.chain 内注册的 4 个后端谓词闭包（repoRemote / repoAccess / ghAuth / parseOk）；其中 gh 相关全部经 host 的 resolveGh / runGh / getRepoKey（走 host 的 getPlatform()，即 composePlatform 包装的 darwin/linux/win32 底座）。
- UI 无判定：ChecksTab 只按 status（done/current/fail/pending）染色行，动作按钮按动作类型翻译文案，提交后走既有重求值闭环（refresh / poll），从不判断「这检查为什么失败」。
- 契约层 chain.js / generic.js 的 evaluateChain 是「串行阻塞」语义；host 刻意不用它，改用内联的 stepEvalParallel（逐项独立求值），原因见 host/index.js:1723-1727（否则「前置未过」会把已算出的判定吞成 pending，违反 #281 红牌契约）。
- 两个已实锤的真实缺口：① md:scratchWritable 只查 .scratch【存在性】，从不测可写（标签「可写」与检测条件不符）；② gh:labels 在目录里声明了，但【运行时检查链从不渲染/求值】（host 过滤掉 + GITHUB_CHECKS 运行时视图只有 4 项）。

---

## 2. 检测项全表

### 2.1 通用检查（GENERIC_CATALOG，5 项，任何后端恒适用）

通用项定义在 check-catalog.js:31-76；链视图（Show/Action 契约级文案）在 GENERIC_CHECK_ITEMS（check-catalog.js:242-295）。group：env 组与 gate 组；GENERIC_ENV_CHAIN = filter(group===env)（:311），GENERIC_GATE_CHAIN = 已选后端 + tracker:initialized（:298-308）。

| 检查 id | 标签 | 检测条件（通过/失败判定） | 解决办法（UI 动作 + 底层命令） |
|---|---|---|---|
| skill:wayfinder | 技能 wayfinder 已安装 | 通过：platform.skillProbe(wayfinder)（host 注入的 ctx.skillProbe = probeSkill，host/index.js:1684）返回 level===ok。失败：返回 bad（未安装/名片无效）；无 skillProbe 时回退 getHome()/.agents/skills/该技能 的存在性探测（predicateRegistry.js:101-135，标准根单一尺度 #280）。pending：skills 服务不可用（最多 3 次等待后转 bad，host/index.js:1591-1598）。 | 通过：无动作。失败：FORM「帮我安装」（mode 单选：AI 按指引/自动 npx）→ submitAction INJECT_PROMPT installSkills；INJECT_PROMPT installSkills（安装指引）；REFRESH chain（check-catalog.js:247-251）。底层：DSH 技能注册表 skills.get(skillName)（host/index.js:1539）。 |
| skill:setup-matt-pocock-skills | 技能 setup-matt-pocock-skills 已安装 | 同 skill:wayfinder，probe setup-matt-pocock-skills。 | 同 skill:wayfinder（check-catalog.js:259-263）。 |
| skill:ask-matt | 技能 ask-matt 已安装 | 同 skill:wayfinder，probe ask-matt。 | 同 skill:wayfinder（check-catalog.js:271-275）。 |
| env:home | 用户主目录可解析 | 通过：platform.getHome() 返回【非空】路径。失败：返回 null。pending：platform 无 getHome 或抛错（predicateRegistry.js:85-94）。判定只问平台层，不再读 process.env.HOME（win32 从不设该变量，check-catalog.js:61-64、predicateRegistry.js:86-88）。 | 通过：无动作。失败：REFRESH chain（check-catalog.js:283，level=warn，无 inject 指引——环境级异常只能让用户重测）。 |
| tracker:initialized | 工作区已初始化（docs/agents/issue-tracker.md 存在） | 通过：platform.fs 探测 docs/agents/issue-tracker.md 存在（FILE_EXISTS，predicateRegistry.js:57-84）。失败：不存在。pending：fs 探测能力不可用。 | 通过：无动作。失败：INJECT_PROMPT setupRun（初始化指引），level=warn（check-catalog.js:291）。 |

### 2.2 GitHub 后端检查（GITHUB_CATALOG，5 项声明 / 运行时 4 项）

目录声明 check-catalog.js:81-122（含 gh:labels）；运行时后端链在 catalogFor(backendId) 基础上过滤【scope===backend 且 id!==gh:labels】（host/index.js:1767）。GitHub 后端自带运行时视图 GITHUB_CHECKS 只有 4 项（github/index.js:278-311，无 gh:labels）。

| 检查 id | 标签 | 检测条件（通过/失败判定） | 解决办法（UI 动作 + 底层命令） |
|---|---|---|---|
| gh:remote | GitHub 远端可解析（git remote origin → owner/name） | 通过：getRepoKey(cwd) 解析出 owner/name（host/index.js:1686-1692）。底层三级：① git remote get-url origin + parseGithubRepo（SSH/HTTPS 正则 github.com分隔符owner/name，host/index.js:1259-1264、github/index.js:25-30）→ ② .git/config 直读 → ③ gh repo view --json nameWithOwner。失败：三级均解析不出。pending：getRepoKey 抛错。 | 通过：无动作。失败：WIZARD + REFRESH（github/index.js:107-136）：「创建并发布」两步向导（仓库名[defaultFrom=cwd-basename] → 可见性 public/private）→ submitAction RPC wf.initPublish。 |
| gh:installed | GitHub CLI (gh) 已安装 | 通过：platform.resolveExecutable(gh) 返回非空（COMMAND_EXISTS，predicateRegistry.js:51-56）。失败：返回 null 且 PATH 无 gh。 | 通过：无动作。失败：INJECT_PROMPT noGhPrompt（安装指引，跨 OS：win→winget / mac→brew / linux→apt）+ REFRESH（github/index.js:87-96）。 |
| gh:authed | gh 已登录（gh auth status） | 通过：runGh([auth,status]) ok（host/index.js:1706-1718）。失败：仅当 kind==auth（明确的未登录/凭证失效）。pending：网络失败（kind==network）或其它异常（诚实未知），不给「未登录」误导。 | 通过：无动作。失败：INJECT_PROMPT ghAuthLogin（登录指引：gh auth login / refresh）+ REFRESH（github/index.js:97-106）。 |
| gh:repoAccess | 仓库可达（gh api repos/owner/name） | 通过：runGh([api,repos/owner/name]) ok（host/index.js:1693-1705）。失败：【仅】kind==notfound（确定仓库不存在/无权限）。pending：未登录（auth）、网络（network）、其它 exit——绝不因为「仓库已定位但未登录」就误判失败（host/index.js:1699-1703 实机复核修正）。 | 通过：无动作。失败：WIZARD「创建并发布」+ REFRESH（github/index.js:137-155）。修复指引 hint 走 repoAccessFix。 |
| gh:labels（声明存在，运行时不渲染） | 标签已齐（10 核心标签） | 目录里声明为 backend labels（check-catalog.js:114-122）；github/index.js 侧无此运行时项。实际不被求值：wf.chain 过滤 id!==gh:labels（host/index.js:1767）；GITHUB_CHECKS 运行时视图 4 项无此 id（github/index.js:278-311）。 | 无（不在检查链中）。 |

### 2.3 Markdown 后端检查（MARKDOWN_CATALOG，2 项）

| 检查 id | 标签 | 检测条件（通过/失败判定） | 解决办法（UI 动作 + 底层命令） |
|---|---|---|---|
| md:scratchWritable | .scratch 目录可写 | 实际判定：FILE_EXISTS 探测 .scratch【存在】（check-catalog.js:159、predicateRegistry.js:57-84：fs.resolve + exists/listDir/stat/lstat 兜底）。⚠️ 只查存在，从不测写权限（无 access(W_OK) / 写探测）。通过=.scratch 存在；失败=不存在；pending=fs 探测不可用。 | hint（markdown/index.js:113-121）：「.scratch 目录不可写…检查权限/只读挂载」+ INJECT_PROMPT mdWritableFix + REFRESH。但底层谓词从未测过「可写」，标签与检测条件不符（见第 6 节）。 |
| md:parseOk | 本地图谱可解析 | 通过：.scratch/map.md 存在且 parseMd(text) 不抛（host/index.js:1269-1280 的 mdParseOkPredicate）。失败：map.md 缺失，或 parseMd 抛异常，或读文件失败。pending：parseMd 未导出。 | hint（markdown/index.js:123-132）：「本地图谱解析失败…检查格式」+ INJECT_PROMPT mdParseFix + REFRESH。 |

### 2.4 GitLab 后端检查（GITLAB_CATALOG，3 项，参考）

glab:installed（COMMAND_EXISTS glab）/ glab:authed（preflight glabAuth）/ glab:repoAccess（backend repoAccess）—— check-catalog.js:125-150。GitLab 后端在【当前检查链】只由 catalogFor(gitlab) 提供声明，但 host 未注册 backend:gitlab:* 谓词，故运行时为 pending（未注册=不适用，诚实不猜，predicateRegistry.js:203-205）。

---

## 3. 全链路走读（catalog → predicate → snapshot → fix → UI → 动作分发）

### 3.1 目录层（声明，不执行）
src/shared/tracker/check-catalog.js：GENERIC_CATALOG（:31）/ GITHUB_CATALOG（:81）/ MARKDOWN_CATALOG（:153）/ GITLAB_CATALOG（:125）。catalogFor(backendId)（:196-202）= 通用 + 该后端；catalogItemToCheckItem（:321-334）把目录项转成契约层 CheckItem（后端项补默认 onFail=REFRESH）。scopeOf（:185）判通用/后端；MIGRATION_MAP（:207）。

### 3.2 谓词执行层（真实判断）
src/host/tracker/predicateRegistry.js：createPredicateRegistry（:148）+ resolveAll（:174，并行 + 单谓词超时→pending）+ toPredicateResults（:234，pass/fail/null）。primitive 检查执行在 execPrimitive（:47-140）：COMMAND_EXISTS（:51）、FILE_EXISTS（:57-84，存在性探测）、HOME_DIR（:85-94）、SKILL_PROBE（:101-135）。backend/preflight 检查按 key 查注册表：backend:后端id:检查id → backend:*:检查id → 检查id；preflight 用 preflight:检查id → 检查id（:190-202）；未注册 → pending（:204）。
src/host/tracker/generic.js：registerGenericPredicates（:30-62）注册 backendSelected（判 ctx.backendId/selection/explicitBackendId）；resolveGenericChain（:100-106）→ evaluateChain。通用链含 5 通用项 + selection:backendSelected（在 GATE_CHAIN，:298-308）。

### 3.3 宿主编排（chain 组装 + 后端谓词注册，host/index.js 的 wf.chain）
harness.handle(wf.chain)（host/index.js:1641-1856）：缓存 key=（cwd+backendId+lang），仅当链全绿（chainNotAllDone==false）才写 30s 缓存（:1847-1851）。谓词注册：registerGenericPredicates（:1674）+ 4 个后端谓词（:1686-1721：repoRemote / repoAccess / ghAuth / parseOk）。ctx.skillProbe = probeSkill（:1684）。ctx.platform = getPlatform()（host 用 composePlatform，见第 4 节）。
后端链 items：catalogFor(backendId) 过滤 scope===backend 且 id!==gh:labels（gh:labels 在此被排除，:1767）。
stepEvalParallel（:1728-1759，内联）：pass→done；fail→（onFail.actions.length>0 ? current : fail）；其余→pending（:1735）。pending 只保留检查项名称（strip onFail hint/actions，:1739-1741）。fullSnapshot = 通用 steps 拼接后端 steps（:1810-1816），引导语义 = 通用段 → 后端段，但各步独立判定（:1799-1801）。
enrichSnap（:1825-1837）：把谓词结果的 detail/hint 合并进 step.show（红牌分拣文案经链到达 UI）。

### 3.4 修复契约（fixContract.js）
attachFixContract(items, mod, lang, {cwd, owner})（fixContract.js:62-144）只对声明了 mod.fixes[itemId] 的检查项生效。pickLang（:29）取双语；resolvePrompt（:41）把 action.prompt 命中后端 mod.prompts[pk] 解成最终文案；normField（:83-113）解析 form/wizard 字段的 label/placeholder/optionSubs/preview、{owner} 占位替换（owner 由 host 预解析登录用户名，host/index.js:1779-1788）、defaultFrom=cwd-basename → 清洗工作区尾段为合法仓库名预填 defaultValue（:107-110）、cwd 注入 submitAction.params（:126-131）。含 refresh 则弃默认动作（防双「重查」，:136-138）。

### 3.5 UI 层（只渲染与分发，零判定）
ChecksTab.js（:9-222）：读 st.chainSnapshot（= wf.chain 返回的 fullSnapshot，probe.js:26）。每步染色 done/current/fail/pending（statusMeta :92-98）；每行一主按钮（form/wizard > inject-prompt/rpc）在右，refresh 归一化为顶部「重新检查」（:143-150）。hintTextOf（:118-128）把 prompt: 前缀交给 resolvePrompt。每 20s 静默重查（链未全绿时，:15-26）。
ChainRenderer.js（:41-230）：ChainBanner（current 唯一 42px，:174）、ChainSteps 步进条（:151）、ActionButton（:41，labelMap 五种动作 + unknown→unsupported 灰态；注意 wizard 不在 labelMap → ChainRenderer 会把 wizard 当 unsupported，ChecksTab 另行处理）。
actions.js（:36-199）：createActionDispatcher.dispatch 按 ACTION_TYPE 分发。inject-prompt（优先 resolvePrompt，:52-68）/ open-url / rpc（hostCall，业务失败 kind 翻译，:88-99）/ form / wizard（都走 renderForm，提交合并 values 后再 dispatch submitAction，:102-176）/ refresh（ctx.refresh，:177-183）。未知类型 → {ok:false,kind:unsupported}（:185）。
判断闭环位置：所有「这步为什么失败/怎么修」的知识在 host（后端 fixes + 谓词 detail）；UI 仅渲染，动作执行后经 refresh/轮询回到 host 重求值（重探谓词）→ 链状态更新。动作不承诺修复（chain.js:19-20「推进只来自重求值」）。

---

## 4. OS 差异与抽象层

### 4.1 平台接口（composePlatform 通用包装）
src/host/platform/index.js：composePlatform(ctx, osName, adapter, opts)（:98-119）对每个 OS 适配器统一包装为：getHome（memoize，:100、:50-56）；path（委托 node:path；win32→.win32 / darwin·linux→.posix；异步 joinHome，:59-73）；resolveExecutable(name)（包装 spec.resolveExecutable，throw→null，:102-108）；fs（透传 ctx.get(fs)，无 mkdir，:109）；env（只读 get(k)/has(k)，:76-85）。createPlatform(ctx, osName, opts)（:129-145）按 process.platform 查静态 REGISTRY。

### 4.2 三 adapter 对比表（getHome / pathImpl / resolveExecutable）

| 维度 | darwin（macOS） | linux | win32（Windows） |
|---|---|---|---|
| pathImpl | node:path.posix | node:path.posix | node:path.win32 |
| getHome 主源 | os.homedir() 或 null（:33-39） | os.homedir() 或 null（:33-39） | os.homedir()，护栏 ^[A-Za-z]: → USERPROFILE → HOMEDRIVE+HOMEPATH，不读 HOME（:44-60） |
| resolveExecutable 别名 | 仅 sh→sh 恒等（:45-48 直透） | 无 sh 别名（:45-48 直透） | cmd→cmd.exe（ALIAS，:14、:62-66） |
| resolveExecutable 对 gh | 无 DSH_GH_PATH 兜底（注释说「由上层 resolveGh 承载」，:8、:43） | 有：先 PATH，未命中→DSH_GH_PATH + fs.lstat 校验（:45-68） | 无 gh 兜底（:62-66） |
| 路径形态 | posix，零自实现 | posix，零自实现 | win32，零自实现 |

### 4.3 DSH_GH_PATH darwin 缺口核实结论
- 注释声称「gh 的 DSH_GH_PATH 兜底由上层 resolveGh 承载」（darwin/index.js:8）。
- 核实：上层 resolveGh【存在】（host/index.js:297-315），且确实做了 DSH_GH_PATH 兜底——platform.env.get(DSH_GH_PATH)（:306）+ platform.fs.lstat(fb) 校验（:309）。所以 host 的 runGh 路径（含 wf.chain 的 ghAuth/repoAccess 谓词、getRepoKey Tier3 gh repo view）在 darwin 上 DSH_GH_PATH 是可达的。
- 缺口收窄：ghClient（后端数据流 client.js:37-53）的 resolveGh 直接用 platform.resolveExecutable(gh)（:47）。darwin/win32 适配器【不含】DSH_GH_PATH 兜底 → 若 gh 只装在 DSH_GH_PATH 而不在 PATH，ghClient 路径在 darwin/win32 上找不到 gh（linux adapter 则能找到）。即：host 层 runGh 兜底成立，但 ghClient 路径（github 后端 preflight/list/get/getCurrentUser 等实际数据流）在 darwin/win32 上不认 DSH_GH_PATH——这是【部分真实缺口】，不致命（wf.chain 检查链不经 ghClient），但会让后端数据操作在不走 host runGh 时缺 gh。
- 另：host/index.js 内联 fallback getPlatform（:124-197）的 resolveExec（:176-190）有 DSH_GH_PATH gh 兜底，但该分支仅在 createPlatform 失败时才走（正常走 composePlatform），故不覆盖 darwin/win32 适配器缺口。

### 4.4 绕过 / 直用 platform 的调用点清单（全仓库 src/ 扫描）

| 位置 | 是否走 platform | 说明 |
|---|---|---|
| host/index.js:297-315 resolveGh（runGh 用） | 经 platform.resolveExecutable + platform.env + platform.fs.lstat | 走平台（DSH_GH_PATH 兜底在此） |
| host/index.js:421-424 resolveGit | platform.resolveExecutable(git) | 走平台 |
| host/index.js:427-430 getHome | platform.getHome() | 走平台 |
| host/index.js:2656-2684 openFolder | platform.os + platform.resolveExecutable(explorer/open/xdg-open) | 走平台（OS 分发正确） |
| host/index.js:124-197 内联 fallback getPlatform | 深兜底 | ⚠️ 读 process.env.USERPROFILE/HOME（:142、:146），只在 createPlatform 失败时触发；属潜在绕过（进程环境直读），正常不用 |
| github/index.js:216-237 getRepoKey Tier1 | platform.resolveExecutable(git) | 走平台 |
| github/index.js:363-377 initProject resolveGitLocal / resolveGhLocal | platform.resolveExecutable | 走平台 |
| github/client.js:41-53 ghClient.resolveGh | platform.resolveExecutable(gh) | 走平台，但 darwin/win32 无 DSH_GH_PATH 兜底（见 4.3） |
| markdown/path.js:1-2 getPlatformPath | ⚠️ 优先 ctx.platform.path，否则回退 node:path.win32/posix（按 process.platform） | 软平台：ctx.platform 缺席则绕过（node:path 直用） |
| markdown/index.js:9-11 getPlat | 同 path.js 的软平台回退 | 同上 |
| markdown/comments.js:7 / graph.js:6 / issues.js:7 | import node:path | 同样走 getPlat 软回退 |
| github/index.js:39-48 describe | cwd.split(正斜杠/反斜杠) | 非 platform.path，靠正则跨两种分隔符，可接受 |
| markdown/index.js:58 describe | 同上 split | 同上 |
| host/index.js:319-390 runGh | subprocess.spawn 直启（argv=[exe].concat(args)） | 执行走 DSH subprocess（不经 shell，无 cmd/sh 硬编码） |
| host/index.js:393-419 execProc | subprocess.spawn 直启 | 同上；git -C 等命令不经 shell |
| host/index.js:223-245 detectionExec | subprocess.spawn 直启 | 同上 |

最严重的绕过点：① markdown 后端各文件的 getPlatformPath/getPlat（path.js:2、index.js:10）在 ctx.platform 缺失时回退到 node:path 直用，是对「platform.path 单源」的软绕过（当前 ctx.platform 正常注入，故通常未触发，但作为守则存在回退旁路）；② host 内联 fallback getPlatform 直读 process.env（:142/146），是硬绕过，仅深兜底触发；③ darwin/win32 adapter 缺 DSH_GH_PATH 兜底（4.3 真实缺口，ghClient 路径受影响）。

---

## 5. 底座完备性评估（每项检测在 mac / linux / win 的处理状态）

| 检测项 | mac (darwin) | linux | win32 |
|---|---|---|---|
| skill:*（3 项） | ✓ 完整（skills 注册表，与 OS 无关） | ✓ | ✓ |
| env:home（HOME_DIR） | ✓ os.homedir() 或 null | ✓ | ✓ USERPROFILE 护栏（:52-60），不读 HOME |
| tracker:initialized（FILE_EXISTS） | ✓ | ✓ | ✓ |
| gh:installed（COMMAND_EXISTS gh） | ⚠️ 缺口：adapter 无 DSH_GH_PATH（:45-48），但 wf.chain 走 host runGh（resolveGh 有兜底）→ 检查链本身 OK；ghClient 路径缺 | ✓（adapter 自带 DSH_GH_PATH，:45-68） | ⚠️ 同 darwin：无 gh 兜底（:62-66） |
| gh:authed（preflight ghAuth） | ✓（host runGh 分类 auth/network/pending，:1706-1718） | ✓ | ✓ |
| gh:repoAccess（backend repoAccess） | ✓（host runGh 分类 notfound→fail / else pending，:1693-1705） | ✓ | ✓ |
| gh:remote（backend repoRemote） | ✓（getRepoKey 三级，git via platform） | ✓ | ✓（getRepoKey Tier2 直读 .git/config） |
| gh:labels | ✗ 缺失：运行时被过滤 / GITHUB_CHECKS 无此项（host/index.js:1767、github/index.js:278-311） | ✗ | ✗ |
| md:scratchWritable | △ 部分：谓词只查存在（predicateRegistry.js:57-84），不是「可写」 | △ | △ |
| md:parseOk | ✓ mdParseOkPredicate（host/index.js:1269-1280） | ✓ | ✓（readText/lstat via platform.fs） |
| glab:*（3 项） | ✗ 无谓词（运行时 pending，未注册） | ✗ | ✗ |

---

## 6. 从第一性原理出发的观察与建议

1. md:scratchWritable 的「可写」标签与检测条件不符（实锤）：目录声明用 FILE_EXISTS（check-catalog.js:159），谓词执行（predicateRegistry.js:57-84）与 host fileExistsChainRel（host/index.js:1281-1290）都只做存在性探测。修复契约 hint 却宣称「目录不可写…检查权限/只读挂载」（markdown/index.js:115-117）。建议：引入真正的写探测原语（如 fs.access(path, W_OK) / 探测写临时文件），或把标签改名为「.scratch 目录存在」并移除「可写」语义，避免 UI 展示与真实判定分裂。
2. 统一 gh 解析（消除双轨）：host 层 resolveGh 有 DSH_GH_PATH 兜底，但 ghClient 走 platform.resolveExecutable(gh) 无此兜底（darwin/win32）。建议：把 DSH_GH_PATH 兜底下沉到 composePlatform 通用层（而非只在 linux adapter），或在 ghClient.resolveGh 复刻 host resolveGh 的 env.get(DSH_GH_PATH)+lstat 兜底，使所有 gh 消费方行为一致。
3. gh:labels 死在声明层：目录里 5 项，运行时链把 id gh:labels 过滤掉（host/index.js:1767），GITHUB_CHECKS 也只有 4 项（github/index.js:278-311）。若确属「仓库就绪链标签引导」保留（check-catalog.js:79、:114-122 注释），应明确它是「引导」而非「检查」，并在目录注释中标注「不参与检查链求值」，避免读者误以为它会被判。
4. 串行 evaluateChain 与并行 stepEvalParallel 的语义分叉：契约层 chain.js 的 evaluateChain（串行阻塞）与 host 内联 stepEvalParallel（逐项独立）已分叉（host/index.js:1723-1727 明确弃用 evaluateChain）。建议：在 chain.js 契约里同步该决策（把「逐项独立、链只表达首个未通过步=currentIndex」写为基线），否则后续维护者读 evaluateChain 会误判链路语义。
5. soft-platform 回退旁路：markdown 后端 getPlatformPath/getPlat 在 ctx.platform 缺席时回退 node:path（path.js:2、index.js:10）。当前 ctx.platform 正常注入不触发，但作为守则存在。建议：若契约承诺「platform.path 单源」，应让缺失 ctx.platform 时显式 fail/报错而非静默回退 node:path，防开发期误用。
6. host 内联 fallback 直读 process.env：host/index.js:142/146 在 createPlatform 失败时直读 process.env.USERPROFILE/HOME（第二真相）。与「平台 env 只读视图」契约（platform/index.js:76-85）相悖。建议该深兜底改为复用平台 env 视图，或注明其为「平台创建失败时的最后防线」。

---

## 7. 材料与核验方式

已读核验的关键源码（读文件 + 逐行引用）：
- src/shared/tracker/check-catalog.js（目录与 UI 链视图：GENERIC/GITHUB/MARKDOWN/GITLAB_CATALOG、catalogFor、GENERIC_CHECK_ITEMS/GATE_ENV_CHAIN）
- src/shared/tracker/chain.js（PRIMITIVE_KIND/ACTION_TYPE/CHECK_STATE/SHOW_LEVELS、validateCheckItem/Action、evaluateChain 契约说明）
- src/host/tracker/predicateRegistry.js（execPrimitive 四原语：COMMAND_EXISTS/FILE_EXISTS/HOME_DIR/SKILL_PROBE；resolveAll key 分发、toPredicateResults）
- src/host/tracker/generic.js（registerGenericPredicates、getGenericChain、resolveGenericChain）
- src/host/index.js（wf.chain 主体 :1641-1856；getPlatform :124-197；后端 4 谓词 :1686-1721；stepEvalParallel :1728-1759；enrichSnap :1825-1837；fullSnapshot :1802-1823；mdParseOkPredicate :1269-1280；fileExistsChainRel :1281-1290；probeSkill :1531+；resolveGh :297-315；runGh :319-390；getRepoKey :609-647；openFolder :2656-2684；initPublish :2691+）
- src/host/tracker/fixContract.js（attachFixContract、pickLang、resolvePrompt、normField 全部逻辑）
- src/host/tracker/backends/github/index.js（GITHUB_CHECKS 4 项、fixes、prompts、getRepoKey :209-270、initProject :329+、parseGithubRepo :25-30、describe :37-51）
- src/host/tracker/backends/github/client.js（ghClient、resolveGh :41-53、execGh :59-89）
- src/host/tracker/backends/github/preflight.js（ghPreflight :39-105）
- src/host/tracker/backends/github/errors.js（classifyGhError 顺序）
- src/host/tracker/backends/markdown/index.js（fixes :112-133、prompts :100-109、createMarkdownBackend preflight :68-81）
- src/host/tracker/backends/markdown/path.js / read.js / parse.js（getPlatformPath 软回退、exists 探测、parseMd）
- src/host/platform/index.js（composePlatform 通用包装）+ darwin/index.js + linux/index.js + win32/index.js（三底座差异）
- src/host/tracker/registry.js（backendCtx 注入、Proxy 桩、matches/select）
- src/host/tracker/snapshot.js（确认是数据快照合成，非链快照）
- src/client/views/ChecksTab.js、src/client/views/shared/ChainRenderer.js、src/client/kernel/actions.js、src/client/kernel/probe.js（UI 渲染 + 动作分发 + chainSteps/loadChain）

核实方法：read 逐文件 + pwsh 的 Get-ChildItem/Select-String 全仓库通配（glob/grep 在本环境 ripgrep 启动失败，故用 pwsh 替代做符号定位与 OS 模式扫描：process.env.HOME / USERPROFILE / HOMEDRIVE / cmd.exe / node:path / subprocess.spawn / resolveExecutable / DSH_GH_PATH 等）。

未触碰：CONTEXT.md、docs/adr/（并行工作由他人进行），未提交 git，未改动仓库其它文件。
