# 研究票 #648 取证：在一个已有工作区的子目录里新建会话，插件的每一层各把哪个目录当根

- 票：#648（地图 #647 第 1 项）
- 取证日期：2026-09-18
- 代码基线：`963764b`（仓库 `D:\dsh-plugin\dsh-mattpocock-skills-deck`）
- 只读承诺：`D:\ilife`、`D:\ilife\packages\skill-calorie` 全程只读（只有 readdir / stat / readFile / `git -C … remote get-url` / `git rev-parse`）；
  需要写盘才能看的几条路（配色文件放置、可写性写探测、建票）都在**我自己造的临时工作区**里做，见「最小复现怎么跑」。
  本次运行没有改用户机上任何仓库里的文件。

## 结论一览

一句话：**除了「GitHub 的启发式判定」和「GitHub 那条老取数路会顺着 git 往上走到仓库根」，插件其余每一层——显式声明、检查链、面板缓存键、后端绑定、写路径、随包脚本——都只认「会话所选的那个目录」。**

| 层 | 按哪个目录算 | 真实子目录 `D:\ilife\packages\skill-calorie` 上的实测结果 |
| --- | --- | --- |
| 后端探测 · 显式声明 | `<所选目录>/docs/agents/issue-tracker.md` | 读不到（`reason: read-failed`）→ 显式分支空，退到启发式 |
| 后端探测 · GitHub 启发式 | 先读 `<所选目录>/.git/config`，再跑 `git -C <所选目录> remote get-url origin` | **命中父仓库**（git 上溯）→ 判成 GitHub |
| 后端探测 · GitLab 启发式 | 读 `<所选目录>/.git/config`、`<所选目录>/docs/agents/issue-tracker.md`，最后跑 `git remote get-url origin`（进程工作目录=所选目录，git 照样上溯） | 不命中（父仓库远端是 github.com）；换成 GitLab 仓库的夹具后**命中父仓库** |
| 后端探测 · 本地 Markdown 启发式 | 只看 `<所选目录>/.scratch/**` 与 `<所选目录>/docs/agents/issue-tracker.md` | **不命中父仓库** |
| 环境检查链 · 工作区已初始化 | `<所选目录>/docs/agents/issue-tracker.md` | 红（`current`）：`docs/agents/issue-tracker.md 不存在` |
| 面板取数 · `wf.snapshot` | 选择结果决定走哪条路；GitHub 老路经 `getRepoRoot` / `getRepoKey` 上溯 | 不失败、也不空：返回**父仓库**的完整快照（27 张地图 / 500 条票），耗时 25.1 秒 |
| 四样状态的分桶键 | 面板快照的宿主单槽、链快照、后端绑定、仓库引用都按**所选目录**；磁盘快照缓存按**仓库** | 根会话与子目录会话各占一桶（磁盘缓存那一份是共用的） |
| 写路径 | 配色文件、`.scratch`、建票目录、初始化产出的主锚文件都按**所选目录** | 会真的落到子目录里（配色文件已复现） |
| 随包脚本 | `<进程工作目录>/docs/agents/issue-tracker.md` | 直接失败退 2，文案见第六节 |

真实子目录上「用户看到的三个现象」只复现出**一个**：检查链的「工作区未初始化」红牌。
「没有后端选择 + 右侧面板没有数据」这一对，复现条件是**后端应当是本地 Markdown（或仓库远端既不是 GitHub 也不是 GitLab）的子目录**，见第一节与第三节。
用户机上日志里那两类失败散列分别对应什么情况、能不能归到某个具体工作区，见第七节。

## 一、后端探测：从子目录出发，每个后端各自把哪个目录当根

### 1.1 显式声明那条路先走，读的是「会话所选目录」

`src/host/tracker/detection/explicitDetector.js:31` 拼的是相对于所选目录的路径：

```js
const target = await platform.fs.resolve('docs/agents/issue-tracker.md', { cwd })
raw = await platform.fs.readText(target)
} catch {
  return { selection: null, raw: null, parsed: { …, reason: 'read-failed' } }
```

实测（`.tmp-648-repro.mjs` 经插件自己注册的 `/api/dsws` 通道打真电话）：

```text
repo-root  D:\ilife
  explicit: {"explicitBackendId":"github","confidence":"high","reason":"github-template"}   rawIsNull=false
sub-dir    D:\ilife\packages\skill-calorie
  explicit: {"explicitBackendId":null,"confidence":"none","reason":"read-failed"}           rawIsNull=true
```

也就是说：子目录会话里，那条「仓库根声明了 GitHub」的事实**根本没被读到**，插件于是只剩启发式可用。

### 1.2 三个后端分开列（用我造的四个夹具跑，根与子目录各一份）

夹具造在系统临时目录里，每个都有 `sub/` 子目录（见 `.tmp-648-mkfixtures.mjs`）：

| 夹具 | 根会话结论 | 子目录会话结论 |
| --- | --- | --- |
| `t-nogit` 不是 git 仓库，根上声明本地 Markdown | 显式 markdown；启发式 github=false / gitlab=false / markdown=**true** | 显式读不到；启发式 **false / false / false** → 仲裁回落「无后端」 |
| `t-gitlab` git 仓库、`origin=https://gitlab.com/tmp648/demo.git`、根上声明 GitLab | 显式 gitlab；启发式 false / **true** / false | 显式读不到；启发式 **false / true / false** → 仍是 GitLab |
| `t-md-git-noremote` git 仓库但没有 remote，根上声明本地 Markdown 且带 `.scratch/map.md` | 显式 markdown；启发式 false / false / **true** | 显式读不到；启发式 **false / false / false** → 回落「无后端」 |
| `t-plain` 普通目录，既不是 git 仓库也没有任何声明 | 显式读不到；启发式 false / false / false → 回落「无后端」 | 同上，也是「无后端」 |

逐后端结论与代码出处：

**GitHub**（`src/host/tracker/backends/github/backend.js:36-50`）：先读 `<所选目录>/.git/config`，读不到就退到

```js
const r = await ctx.exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { cwd, timeout: 3000 })
const out = (r && (r.stdout || r.text)) || ''
if (/github\.com/i.test(String(out))) return true
```

`git -C <子目录>` 自己会顺着目录往上找仓库，所以**这条兜底会把父仓库的远端认成当前目录的仓库**。真实目录上的原命令输出：

```text
$ git -C D:\ilife\packages\skill-calorie remote get-url origin
https://github.com/FeatherHunter/ilife.git
$ git -C D:\ilife\packages\skill-calorie rev-parse --show-toplevel
D:/ilife
$ Test-Path D:\ilife\packages\skill-calorie\.git\config
False
```

所以子目录里命中的不是 `.git/config` 那条，而是 `git -C` 那条。旁证：整台机器上 13 个工作区挨个探一遍时（`.tmp-648-out-sweep.json`），
`D:\2Study\StudyNotes\2026` 也被判成 GitHub —— 它自己不是仓库根，是顺着 git 走到了上层的 `FeatherHunter/StudyNotes`。

**GitLab**（`src/host/tracker/backends/gitlab/index.js:40-60`）：前两步读 `<所选目录>/.git/config` 与 `<所选目录>/docs/agents/issue-tracker.md`（都不上溯），
第三步是 `exec('git', ['remote', 'get-url', 'origin'], { cwd })` —— 没带 `-C`，但进程工作目录就是所选目录，git 同样上溯。夹具实测：

```text
t-gitlab-root  显式 gitlab；启发式 github=false gitlab=true  markdown=false
t-gitlab-sub   显式读不到；启发式 github=false gitlab=true  markdown=false   → wf.detect = {"backendId":"gitlab","source":"matches","ref":{"name":"sub"}}
$ (在 t-gitlab\sub 里) git remote get-url origin
https://gitlab.com/tmp648/demo.git
$ (在 t-gitlab\sub 里) git rev-parse --show-prefix
sub/
```

**本地 Markdown**（`src/host/tracker/backends/markdown/index.js:15-56`）：只看所选目录，从不跑 git：

```js
const root=plat.join(cwd,'.scratch')
… 列举 root 下的每个目录，看有没有 map.md
const itPath=plat.join(cwd,'docs/agents/issue-tracker.md')   // 同样只看所选目录
if(typeof txt==='string'&&/Local\s+Markdown/i.test(txt)) return true
```

夹具实测：`t-md-git-noremote` 根的 `.scratch/map.md` 明明在，子目录里 markdown 仍判 false。真实机器上的同一现象：
`D:\3DeepSeekHarness\agents\xiaoshuai`（根声明本地 Markdown）下辖的 `research\` 子目录，启发式三条全 false。

三个后端分开说的一句话：**GitHub 与 GitLab 的启发式会顺着 git 上溯到父仓库，本地 Markdown 的启发式不会。**

### 1.3 「目录不在任何 git 仓库里」怎么判

`C:\Users`（用户机上真实存在的 DSH 工作区，5 个会话）实测：

```text
detect: {"backendId":null,"source":"fallback"}
matches: {"github":false,"gitlab":false,"markdown":false}
preflight: —（没有后端，不做预检）
probe : FAIL 无法解析 owner/repo
```

`t-plain`（普通目录）根与子目录、`t-nogit` 与 `t-md-git-noremote` 的子目录，结论一样：显式读不到 → 三条启发式全 false →
`registry.select` 走到 `src/host/tracker/registryCore.js:169` 的 `{ backendId: null, source: 'fallback' }`（没有超时的情况下不带 `pending`）。

这就是客户端上那条蓝色横幅（`src/client/statusbar/StatusBar.js:141-142`：`_backendUndecided = !(_selSBGate && _selSBGate.backendId)`，
文案 `banner.gate` = 「该工作区还没有设置 — 点击选择后端」）出现的条件。

## 二、环境检查链：红在哪几步、红牌文案是什么

`D:\ilife` 根会话十条全绿；`D:\ilife\packages\skill-calorie` 子目录会话**只红一行**：

```text
✓ selection:backendSelected = done      | explicit:github            | actions=[]
✗ tracker:initialized      = current   | docs/agents/issue-tracker.md 不存在 | hint=prompt:setupRun | actions=[{"type":"inject-prompt","prompt":"setupRun","label":"执行初始化"}]
✓ skill:wayfinder / skill:setup-matt-pocock-skills / skill:ask-matt = done
✓ env:home = done | C:\Users\辰辰洋洋
✓ gh:remote = done | FeatherHunter/ilife          ← 仓库行认的是父仓库
✓ gh:installed / gh:authed / gh:repoAccess = done
```

红的那一步读哪个路径，链条上是这样落地的：

- 检查目录声明：`src/shared/tracker/check-catalog-dirs.js:86-92`
  ```js
  { id: 'tracker:initialized', label: '工作区已初始化（docs/agents/issue-tracker.md 存在）', scope: 'generic',
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.FILE_EXISTS, path: 'docs/agents/issue-tracker.md' } }
  ```
- 路径怎么拼：`src/host/tracker/predicatePrimitives.js:66` 用 `ctx.cwd` 解析相对路径 —— `const abs0 = await p.fs.resolve(rel, { cwd: ctx.cwd })`；
  而 `ctx.cwd` 是 `src/host/detectChain.js:32` 洗过的工作区键，也就是**会话所选目录**，不是仓库根。
- 红牌文案与动作（静态）：`src/shared/tracker/check-catalog-views.js:92-98`
  ```js
  onFail: { show: { i18nKey: 'check.tracker.initialized.fail', fallback: '工作区未初始化', level: 'warn', hint: 'prompt:setupRun' },
            actions: [{ type: 'inject-prompt', prompt: 'setupRun', label: '执行初始化' }] }
  ```
  运行时 `desc` 是谓词给的更具体那句「docs/agents/issue-tracker.md 不存在」（`predicatePrimitives.js:105`），经 `enrichSnap` 合进链快照。

一个措辞上的观察（不影响结论，但会影响人读）：子目录里 `selection:backendSelected` 这一行通过时，行内描述的 `desc` 是
**`explicit:github`**，而子目录里根本没有显式声明（真相是 `matches`）。出处：`src/host/tracker/generic.js:43-49` 把
`ctx.explicitBackendId` 当成「显式」，而 `src/host/detectChain.js:73-75` 在没有显式声明时用选中结果回填了这个字段：

```js
const expConsistent = (selConsistent && selConsistent.backendId) ? selConsistent.backendId : (… parsed.explicitBackendId …)
```

夹具里同样能看到：`t-gitlab-sub`（显式读不到、靠 GitLab 启发式命中）那一行也写着 `explicit:gitlab`。

另外，后端为空的子目录（本地 Markdown 工作区的子目录、非 git 目录）链上红**两步**，而且整条后端段根本不出现：

```text
selection:backendSelected = current | no backend selected
tracker:initialized       = current | docs/agents/issue-tracker.md 不存在
（行清单只有通用段：selection / tracker / 三条技能 / env:home；没有任何后端行）
```

## 三、面板取数：`wf.snapshot` 在子目录里是失败、返回空，还是别的

答案分两种情形，都不是「失败」。

**情形 A：子目录所在仓库的远端是 GitHub（含真实样本 `D:\ilife\packages\skill-calorie`）。**
`wf.snapshot` **返回父仓库的完整快照**，不是空、也不是错：

```text
ok=true  repo={"owner":"FeatherHunter","name":"ilife"}  repoRoot="D:/ilife"
repository={"refId":"FeatherHunter/ilife"}  selection={"backendId":"github","source":"matches","ref":{"name":"skill-calorie"}}
maps=27  issues=500
```

机制：客户端会不会走编排器，看 `src/host/sessionLifecycle.js:55-57` 的 `isComposerSelection` —— 它只放行「后端不是 github」的情形；
GitHub 因此走 `src/host/sessionSnapshot.js` 里那条老路，而那条路上有两处会顺着 git 上溯：

```js
// sessionSnapshot.js:221-223
const rk = await getRepoKey(cwd)                  // repoKeys.js:227-236 内部先 getRepoRoot(cwd)，再拿仓库根去问 remote
if (rk && rk.owner && rk.name) repoRef2 = { backend: backendId2, refId: rk.owner + '/' + rk.name, … }
// repoKeys.js:165-176
const r = await execProc([git, '-C', key, 'rev-parse', '--show-toplevel'], key, 'repo-root')
```

**但没有数据的现象仍然会发生，代价是时间。**这一层没有报错，只是慢：同一台机器、同一个仓库，`wf.snapshot` 实测耗时

```text
空缓存：根 33.4 秒 / 子目录 46.2 秒（子目录那次先冷了一遍）
带磁盘快照：根 29.3 秒 / 子目录 27.1 秒
（两次复跑更稳的一组）根 24.8 秒 / 子目录 25.1 秒
```

而客户端在 `src/client/kernel/probe-snapshot.js:213-215` 给这次调用挂了 **30 秒**的上限：

```js
const _rawP = force ? host.call('wf.refresh', args) : host.call('wf.snapshot', args);
const _timeoutP = new Promise((_,rej)=>{ _timer=setTimeout(()=>{ _tryAbort(); rej(new Error('client loadSnapshot timeout 30s')); },30000); });
```

超时后 `st.snapMode='err'`、`st.snapError='client loadSnapshot timeout 30s'`（`probe-snapshot.js:292-298`），
客户端这次拿不到快照里的选择结论；那个目录若此前没有落过本地绑定记忆（`dsws.selectionByCwd`，`store-prefs.js:153-163`），
`st.selection` 就一直是空的 —— 于是面板同时呈现「没有后端选择」和「没有数据」。这解释了用户看到的两个现象，
但请注意它**不是子目录独有的**：根会话在同一仓库上走同一条慢路。

**情形 B：子目录里选不出后端（本地 Markdown 工作区的子目录 / 不是任何 git 仓库的目录）。**
`wf.snapshot` 返回 `ok:true` 但内容全空，**不是失败**：

```text
D:\3DeepSeekHarness\agents\xiaoshuai\research
  ok=true  maps=0  issues=0  repository=null  repoRoot=null     （耗时 2 毫秒）
D:\ilife\packages\skill-calorie 同仓库的对照：maps=27 issues=500
```

出处：`src/host/sessionSnapshot.js:184-212` —— `if (!_sel || !_sel.backendId)` 时直接吐一份空快照（`maps: []`、`issues: []`、`repository: null`、
`selection` 原样带上那个「无后端」结论）。这一支才是「右侧面板没有数据」的直接来源，而且它是**零等待**的空，不是超时。

同一情形下 `wf.probe` 会失败，错误原文是 **`无法解析 owner/repo`**（出处 `src/host/commentThreads.js:244` → `src/host/issueList.js:258`
`if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo' } }`，再由 `errText` 把 `.error` 这个字符串取出来）。
这条错误与用户机日志里的散列对得上，见第七节。

## 四、四样状态各按哪把键分桶

先说结论：**面板快照（客户端的表 + 宿主的单槽缓存）、链快照、后端绑定、仓库引用，四样都按「会话所选目录」的规整键分桶；
根会话与子目录会话因此各占一桶。只有落盘的磁盘快照缓存按「仓库」分。**

| 状态 | 位置 | 键 | 根 vs 子目录 |
| --- | --- | --- | --- |
| 面板快照（宿主内存单槽） | `src/host/sessionSnapshot.js:34` | `cache.snapshot && cache.cwd === cwd` | 各占一桶（单槽，谁的 cwd 对上谁用） |
| 面板快照（客户端内存表） | `src/client/kernel/store-snapshot.js:43`、`getCachedSnapshot` | `keyOf(cwd)`（`shared:workspaceKey` 的规整键） | 各占一桶 |
| 面板快照（客户端磁盘表 IndexedDB） | `store-snapshot.js:64`、`diskPutSnapshot(k, …)` | 同上，`k = keyOf(cwd)` | 各占一桶 |
| 面板快照（宿主磁盘文件） | `src/host/repoKeys.js:188-190`、`sessionSnapshot.js:255-259` | `cacheFileName(repo)` = `owner__name.json` | **同一份**（实测：一次复现里根与子目录两个快照只写出一个 `FeatherHunter__ilife.json`，12 MB） |
| 编排器里的快照 LRU | `src/host/tracker/snapshot.js:107` | `` `${backendId}:${ref.refId}` `` | 后端给的是仓库名时同一桶；本地 Markdown 的 `refId` 是所选目录，故各占一桶 |
| 链快照（宿主） | `src/host/detectChain.js:38` | `cwd + '\|' + backendId + '\|' + lang` | 各占一桶 |
| 链快照（客户端） | `store-snapshot.js:119-120` | `keyOf(cwd) + '\|' + backendId + '\|' + lang` | 各占一桶 |
| 后端绑定 | `src/host/tracker/registryShape.js:31-36`（`handleKey = handle.cwd \|\| handle.refId`）、`registryCore.js:130` | 所选目录的规整键 | 各占一桶（实测 `wf.bindings` 同时列出根与子目录两条） |
| 后端选择集（客户端） | `src/client/kernel/store-prefs.js:153-155, 194-197` | `keyOf(cwd)` | 各占一桶 |
| 仓库引用（客户端） | `store-prefs.js:196-197` | `keyOf(cwd)` | 各占一桶 |
| 仓库引用（宿主 `describe`） | `src/host/tracker/backends/github/repo.js:28-42` | `refId` 为空时用 `cwd` 的末段当名字 | 各占一桶（子目录得到 `name: "skill-calorie"`，直到快照那条路把它补成 `FeatherHunter/ilife`） |

实测片段（`.tmp-648-out-buckets.json`）：

```text
wf.bindings → [
  {cwd:"…\\md-ws",     backendId:"markdown", refId:"…\\md-ws"},
  {cwd:"…\\md-ws\\sub", backendId:"markdown", refId:"…\\md-ws\\sub"} ]
wf.chain(root) 首两行：selection:backendSelected=done(explicit:markdown) | tracker:initialized=done(docs/agents/issue-tracker.md 已存在)
wf.chain(sub)  首两行：selection:backendSelected=done(explicit:markdown) | tracker:initialized=current(docs/agents/issue-tracker.md 不存在)
```

顺带发现一处键形不一致（与「分桶」同源，值得在定版票里一并收掉）：`wf.bind` 用 `canonicalKey`（大小写折叠后的规整键）建桶，
而 `wf.selection` 走 `normCwd`（`src/host/workspaceCwd.js:11-33`，只做斜杠方向与相对路径归一，**不折叠大小写**），
`wf.registry` 里 `reg.bound({ cwd })`（`workspaceCwd.js:111-113`）用的是原样的入参。三者对同一条入参会算出两把不同的钥匙：`wf.bind` 那一侧会**折叠大小写**（`canonicalKey`），另外两个不会。
实测取自 `.tmp-648-out-buckets.json`（三处传的都是同一条入参 `…\md-ws\sub`，里面带大写字母）：
`wf.bind` 回包里的 cwd 已经是全小写的 `c:\users\…\md-ws\sub`；紧接着 `wf.selection` 对同一目录回的是
`{"backendId":null,"source":"fallback"}`，`wf.registry` 回包里 `bound` 字段是空的（看不到这份绑定）。
而 `wf.detect` / `wf.chain` / `wf.snapshot` 都用 `canonicalKey`，看得到这份绑定。

## 五、写路径：哪些动作会把文件落到子目录里

四类落点，触发条件与「已经真会发生 / 只是有可能」分开说。下面每一条的写盘记录来自 `.tmp-648-writes.mjs` ——
给文件服务的 `writeText` / `unlink` 套了一层记录器，然后在我自己造的临时工作区里把这几条路各走一遍。

**① `docs/agents/label-colors.json`（已经真会发生）。**
落点由 `src/host/tracker/backends/markdown/label-colors.js:41-45` 的 `workspaceDirOf` 决定：优先取本次调用上下文里的 `ctx.cwd`，
只有它为空的才退到 `repo.refId`——而 `ctx.cwd` 就是所选目录（`src/host/workspaceCwd.js:42-53` 用同一个 cwd 既算路径也算排队钥匙）。
触发点有两个：
- 用户在工作区里选定后端那一步：`wf.bind` → `placeLabelColorsFile`（`workspaceCwd.js:42-59`、`index.js` 里 `wf.bind` 的注册）。**只有本地 Markdown 系后端会放**（GitHub/GitLab 按 id 明确跳过），因为它实现了 `ensureLabelColorsFile`。
- 首次打开改色弹窗：`wf.listLabels` → `ensureLabelColors`（`src/host/tracker/backends/markdown/label-colors-ops.js:152-157`）。

实测写盘流水：

```text
wf.bind(subdir, markdown)  → writeText …\md-ws\sub\docs\agents\label-colors.json (323B)   labelColorsFile={"ok":true,"placed":true,"reason":"created"}
wf.listLabels(subdir)       → 0 次写入（文件已在，幂等：手改成 {"hand-edited":"123456"} 后再绑一次，文件一个字没动）
```

**② `.scratch/`（两半：一半真会发生但是瞬态的写，一半要靠 AI/人来写）。**
- 真会发生：检查链上 `md:scratchWritable` 那一步是「往目录写 2 字节探针再删掉」的写探测（`src/host/tracker/predicatePrimitives.js:114-176`，`check.path = '.scratch'`）。
  只要 `<所选目录>/.scratch` 存在，链一跑就会在**子目录**里写一次再删一次：
  ```text
  wf.chain(subdir, backendId=markdown) → writeText …\md-ws\sub\.scratch\.dsh-write-probe (2B)
                                        unlink    …\md-ws\sub\.scratch\.dsh-write-probe
  ```
  目录不存在时它直接判 `fail`「目录不存在」，一笔都不写（真实样本 `skill-calorie` 里没有 `.scratch`，所以这一步连行都不会出现——那一轮没有后端）。
- 靠 AI/人来写：本地 Markdown 的建票/改票本体在 `src/host/tracker/backends/markdown/issues-create.js`。票文件根目录这样算：
  `listEfforts(ctx)` 只看 `<所选目录>/.scratch`（`issues-locate.js:21-41`）；一个 effort 都没有时回落 `issuesDir(repo, ctx)`，
  而 `getRoot` 在 `refId` 非空时直接返回 `refId`（`path.js:4-14`、`43-47`），也就是**所选目录本身**。实测：
  ```text
  markdown create(subdir) → writeText …\md-ws\sub\issues\01-untitled.md (106B)   （当时 sub\.scratch 里没有 map.md）
  ```
  换句话说：从子目录会话建出来的票，落在**子目录**里（有 effort 时是 `子目录/.scratch/<effort>/issues/`，没有 effort 时是 `子目录/issues/`），
  永远不会落到父工作区的 `.scratch`。宿主这边没有任何一条电话会调这个 op（`wf.*` 清单里没有建票电话），所以现实里真正落笔的是按提示词干活的 AI。

**③ 初始化注入产出的 `docs/agents/issue-tracker.md`（注入一定发生，落哪个目录取决于会话工作目录）。**
插件自己不写这个文件（全仓只有读它的地方，见第一节）。用户点「执行初始化」后，客户端把这段提示词注进当前会话
（`src/client/kernel/prompts.js:30` 的 `setupRun` 模板 + `src/client/kernel/locale-panel.js:68-76` 的 `setup.<后端>.backendNote` 文案），
里面的文字只说「生成 docs/agents/issue-tracker.md」这种相对路径，不含任何方向；落笔的是 AI，而 AI 的工作目录就是这次会话的目录。
所以从子目录会话走一遍初始化，产物会留在子目录里 —— 这一步**只有静态证据加机制推理**（注入是本地拼串，必然发生；文件由 AI 写，我没在真机上跑）。

**④ 顺带一条不在票面清单里、但同源的写路径（有可能）**：`wf.initPublish`（「创建并发布」向导）会直接在 `args.cwd` 里跑 `git init` 与提交
（`src/host/publishFlow.js:53-92`）。从子目录会话点这个向导，等于在子目录里新起一个仓库。

## 六、随包脚本在子目录里跑会怎样

两条脚本都用 `<进程工作目录>/docs/agents/issue-tracker.md` 认后端，**不顺着 git 上溯**：
`scripts/fix-issue-body.mjs:124-151`（`detectBackend(cwd)` + `requireGithub`）、`scripts/wire-subissues.mjs:212-236`。

实测（都带 `--dry-run`，不联网、不写任何东西）：

```text
$ (cd D:\ilife) node <插件目录>\scripts\fix-issue-body.mjs --issue 648 --body-file <正文文件> --dry-run
演练：不会写任何东西。将执行的命令：
  gh issue edit 648 --body-file <临时文件，演练时未创建>
{"changed":["#648 正文：将按文件内容写回（演练未联网核对当前正文）"],"ok":true,"warnings":[],"dryRun":true,…}
EXIT=0

$ (cd D:\ilife) node <插件目录>\scripts\wire-subissues.mjs --map 647 --children 648,649 --body-file <地图正文文件> --dry-run
演练：不会联网、不会写任何东西。将执行的命令：
  gh issue edit 647 --body-file <临时文件，演练时未创建>
  gh issue edit 648 --parent 647
  gh issue edit 649 --parent 647
{"changed":["#647 正文：将按文件内容写回…","#648 将挂到 #647 下…","#649 将挂到 #647 下…"],"expected":2,"ok":true,"dryRun":true,…}
EXIT=0
```

```text
$ (cd D:\ilife\packages\skill-calorie) node <插件目录>\scripts\fix-issue-body.mjs --issue 648 --body-file <正文文件> --dry-run
{"changed":[],"ok":false,"dryRun":false,
 "error":"这个工作区用的不是首批支持的 GitHub（主锚文件：D:\\ilife\\packages\\skill-calorie\\docs\\agents\\issue-tracker.md）。认不出后端（文件不存在）。GitHub 工作区请确认该文件首行写着「# Issue tracker: GitHub」；本地 Markdown 工作区请直接改票文件存盘；GitLab 待第二批。"}
EXIT=2

$ (cd D:\ilife\packages\skill-calorie) node <插件目录>\scripts\wire-subissues.mjs --map 647 --children 648,649 --body-file <地图正文文件> --dry-run
{"changed":[],"ok":false,"dryRun":false,
 "error":"这个工作区用的不是首批支持的 GitHub（主锚文件：docs/agents/issue-tracker.md）。认不出后端（文件不存在）。…"}
EXIT=2
```

两点差别：`fix-issue-body.mjs` 把**绝对路径**写进回包（`…\packages\skill-calorie\docs\agents\issue-tracker.md`），
`wire-subissues.mjs` 只写相对路径 `docs/agents/issue-tracker.md`（`wire-subissues.mjs:234-235` 的注释明说「不把工作区绝对路径写进回包与终端」）。
两条的失败文案同源，`ok:false`、退出码 2，都停在「认不出后端」这一步，一个字节都没写。

这跟 `gh` 自己的行为正好相反：`gh` 会顺着 git 上溯，同一目录里 `gh repo view` 照样答得出来，所以「脚本失败」不是 GitHub 侧的限制，是脚本自己读锚文件的目录口径：

```text
$ (cd D:\ilife\packages\skill-calorie) gh repo view --json nameWithOwner -q .nameWithOwner
FeatherHunter/ilife
```

## 七、用户机日志里那两条失败散列：能归到哪个工作区

日志文件 `D:\0Tools\DSH Desktop\.dsh-mattskillsdeck-cache\logs\2026-09-17.log` 共 645 行：643 条 `host.call.fail` + 2 条 `log.persist.fail`。
按电话名数是：`wf.listLabels` 349 条、`wf.probe` 235 条、`wf.snapshot` 37 条、`wf.refresh` 21 条、`wf.issueDetail` 1 条。
两类散列按同一条 djb2 算法还原后是这两个原文（我用脚本逐字重算核对过）：

```text
246ae7f1 = "client loadSnapshot timeout 30s"     ← src/client/kernel/probe-snapshot.js:214
3e0aa7fd = "无法解析 owner/repo"                  ← src/host/issueList.js:167/258/308 等处的 error 字段，经 errText 取出
```

**`3e0aa7fd`（179 条 `wf.probe`）**：这条错误出现的条件是「所选目录既选不出后端、又解不出仓库」。
本次复现在三种情形里逐字复现了它：`C:\Users`（真实工作区，不是任何 git 仓库）、本地 Markdown 工作区的子目录（`xiaoshuai\research` 与夹具）、
以及我造的普通目录。反过来，**真实的子目录样本 `D:\ilife\packages\skill-calorie` 不会产生它**——它的 `wf.probe` 返回
`ok=true repo=FeatherHunter/ilife count=711`。2026-09-17 那天用户机上的 13 个工作区里，只有 `C:\Users` 一处满足这个条件，
所以这批失败**最可能**来自 `C:\Users` 那个工作区（或那天某个已从清单里消失的、不在 git 仓库里的目录）。

**`246ae7f1`（40 条：`wf.snapshot` 29 条 + `wf.refresh` 11 条）**：这条是客户端自己超时后写下的字符串，说明那 40 次调用**在 30 秒内没有回**。
本次实测 `wf.snapshot` 在这个 ilife 仓库上要 24.8 ~ 46.2 秒（根与子目录几乎一样），确实压在 30 秒这条线上，
所以这批失败与「打开 ilife 仓库的会话（根或子目录都算）」是一致的。但**日志行里没有工作区字段**（只有 method / kind / errorHash），
所以从日志本身**无法断定**是哪一次会话、哪一个目录触发的。

一句话回答票面的追问：日志里的失败能不能归到某个具体工作区 —— **归不了「自证」的那一种**，只能靠复现去反推；
能确定的是「哪种情形产生哪个字符串」，对应的情形已经写在这一节里。

## 最小复现怎么跑

在仓库根目录跑这三条（都是临时脚本，`node` 直接跑，不需要装依赖，不跑构建）：

```text
node .tmp-648-repro.mjs                     # 真实样本对照：D:\ilife 与 D:\ilife\packages\skill-calorie 各打一遍 wf.detect / wf.chain / wf.snapshot / wf.probe（空缓存）
node .tmp-648-repro.mjs seed-cache          # 同上，但先把用户机真实的 FeatherHunter__ilife.json 复制到临时缓存目录（复刻有缓存的现场）
node .tmp-648-mkfixtures.mjs                # 造四个最小夹具（非 git 仓库 / GitLab 仓库 / 无 remote 的 git 仓库 / 普通目录），随后用 TMP648_CWDS 喂给上面那个脚本
node .tmp-648-buckets.mjs                   # 分桶与绑定：wf.bind 根与子目录、wf.bindings、wf.registry、wf.selection
node .tmp-648-writes.mjs                    # 写路径流水：给文件服务的 writeText/unlink 套记录器，跑 bind / listLabels / chain / 建票
```

脚本是按插件真实的加载方式工作的：`import` 仓库里的 `src/host/index.js`，用一份真的平台层（真文件服务 + 真子进程服务）调它的 `apply(ctx)`，
再经插件自己注册的 `/api/dsws` 路由发请求（端点名要按 `src/seam/rpc.js:40` 的规矩去掉 `wf.` 前缀）。
临时目录与输出：`.tmp-648-out-*.json` 是完整回包；`%TEMP%\tmp648-*` 是夹具与运行时目录，可以随手删。

## 没能证实的部分

1. **日志里那 40 条 30 秒超时归不到具体会话。**`host.call.fail` 只记 method / kind / errorHash，没有工作区字段；我只能证明「哪种情形会超时」和「这个仓库确实慢到压线」。
2. **用户报告的三个现象没有在 `D:\ilife\packages\skill-calorie` 上同时复现。**我在真实目录上复现出的是「工作区未初始化」一行红 + 面板有数据（父仓库的）+ 耗时压线；
   「没有后端选择 + 面板没有数据」这一对是在**本地 Markdown 工作区的子目录**上复现的（`xiaoshuai\research` 与夹具）。这两条是不是同一件事，需要人在定版票里拍板。
3. **初始化注入的产物落在子目录**这一步只有静态证据（提示词文本 + AI 在会话目录里落笔的机制），我没有在真机上真的点一次初始化。
4. **技能检查那三行在我的夹具里不是真值。**夹具自带的技能服务是从用户级根与插件随包目录里查 SKILL.md 拼出来的，
   在真机上这三行的判据来自 DSH 技能注册表；本文引用链快照时只依赖门控行与仓库行。
5. **DSH 文件服务的沙箱行为没有覆盖。**我的夹具里的文件服务不做写栅栏（读穿透、写放行），
   所以「往子目录写会不会被 DSH 按会话可写根拦住」这件事没测；真实宿主里这一步要按会话政策算（`src/host/workspaceCwd.js:147-165`）。
6. **GitHub/GitLab 两条启发式的上溯能力只在夹具上验过 GitLab**，真实样本只有 GitHub 一侧（`D:\ilife`），没有真实 GitLab 仓库可对照。
