# 全新工作区首开引导顺序：消费方精确地图（票 #662）

本文件把「首开引导顺序」今天分散在四处的读取方逐个查清，供接下来写规格的人照着改。全文只写事实与坐标，末尾不写结论。
每一处都给了文件与行号；关键处直接抄了源码原文，抄的时候保留原样。
与本文件配套的现状走查记录是 `research/660-onboarding-chain-recon.md`（那份记的是维护者实机路径与历史票号），本文件补的是「谁在读这条顺序、读的是哪一份数据」。

---

## A. 检查页渲染路径

### A.1 页签与组件是怎么挂上去的

- 页签按钮：`src/client/views/shared/Tabs.js:34` 一行 `tabBtn('checks', 'gear', tr('panel.tabChecks'), 7)`，优先级 7 排在最后（列表 4 / 拉取请求 5 / 技能 6 / 环境检查 7）。
- 页签内容：`src/client/panel/Dock.js:293-298` 这一段按 `s.tab` 三选一渲染，环境检查那一支是

  ```js
  s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
  ```

- 组件本体：`src/client/views/ChecksTab.js:9` `export const ChecksTab = ({ st }) => {`。它由构建拼进客户端闭包（叶子清单 `scripts/build.mjs:337` 的 `{ id: 'checksTab', file: 'src/client/views/ChecksTab.js' }`），所以源码里没有 import。
- 另一条进入检查页的路径是状态栏那枚环境读数：`src/client/statusbar/StatusBar.js:199` 的 `go('checks')`。

### A.2 行从哪来、按什么顺序排

行就是链快照里的步骤，按快照数组的原顺序渲染，客户端不做任何排序：

- `src/client/views/ChecksTab.js:34` `const steps = chainSteps(st)`，`:148` `const stepRows = steps.length ? steps.map(function (s, i) { … })`，`:217` 把 `stepRows` 直接放进返回的节点数组。
- `chainSteps` 的定义在 `src/client/kernel/probe-chain.js:111`：

  ```js
  export const chainSteps = (st) => (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : []
  ```

- `st.chainSnapshot` 是客户端在 `src/client/kernel/probe-chain.js:79-80` 从宿主回包里挑出来的：

  ```js
  if (res && res.ok && (res.fullSnapshot || res.snapshot)) {
    const snap = res.fullSnapshot || res.snapshot
    st.chainSnapshot = snap
  ```

所以**检查页的行顺序 = 宿主 `fullSnapshot.steps` 的顺序**，既不是客户端读目录，也不是客户端读 `catalogFor`。宿主那边的顺序在 `src/host/detectChain.js:209-210` 拼出来：

```js
fullChain = chainAndSnap.chain.concat((backendChain && backendChain.chain) ? backendChain.chain : [])
const allSteps = genSteps.concat(backSteps)
```

两段各自的顺序来源是：

- 通用段：`getGenericChain(kind)`（`src/host/tracker/generic.js:81-85`），`kind` 缺省 `'all'` 时返回 `GENERIC_CHAIN`，也就是 `GENERIC_GATE_CHAIN` 接 `GENERIC_ENV_CHAIN`（`src/shared/tracker/check-catalog-views.js:118`）。
- 后端段：`src/host/detectChain.js:166`，`catalogFor(backendId)` 过滤出 `scope === 'backend'` 且排除 `gh:labels`，再逐项转成检查项。

按今天的数据展开，检查页从上到下的实际顺序是：

1. `selection:backendSelected`（已选择后端）
2. `tracker:initialized`（工作区已初始化）
3. `skill:wayfinder`
4. `skill:setup-matt-pocock-skills`
5. `skill:ask-matt`
6. `env:home`
7. GitHub 后端段：`gh:remote`、`gh:installed`、`gh:authed`、`gh:repoAccess`

三件在写规格前必须先知道的事：

- 技能三项排在 GitHub 的仓库与命令行检查**之前**，因为通用环境段整体接在后端段之前（`detectChain.js:209` 的拼接）。这维修订顺序时是最容易被忽略的一处。
- `gh:labels` 在目录里有（`src/shared/tracker/check-catalog-dirs.js:133-140`），但在 `detectChain.js:166` 被显式排除，检查页永远不显示它。
- `GENERIC_CHECK_ITEMS` 里 `tracker:initialized` 的 `group` 是 `'gate'`（`check-catalog-views.js:97`），所以它只出现在 `GENERIC_GATE_CHAIN`，不出现在 `GENERIC_ENV_CHAIN`（`:115` 按 `group === 'env'` 过滤）。

### A.3 每行的修复指引文字与动作按钮

修复指引文字的来路：

- 渲染侧入口在 `src/client/views/ChecksTab.js:137-147` 的 `hintTextOf`：

  ```js
  const raw = (s && s.show && (s.show.hint || '')) || ''
  if (!raw) return ''
  if (typeof raw === 'string' && raw.indexOf('prompt:') === 0) {
    const pk = raw.slice(7)
    if (chainDispatcher && typeof chainDispatcher.resolvePrompt === 'function') {
      try { const r = chainDispatcher.resolvePrompt(pk, {}); if (typeof r === 'string' && r) return r } catch (e) {}
    }
  }
  ```

  也就是说：链上每一行的 `show.hint` 如果是 `'prompt:某键'` 形态，就交给动作分发器的 `resolvePrompt` 解出全文；解不出就把原串当文字显示。
- `resolvePrompt` 的接法在 `src/client/views/ChecksTab.js:102`：

  ```js
  resolvePrompt: function (id, params) { try { if (id === 'setupRun') return resolveSetupRunText(st); return promptTextFor(st, id, params) } catch (e) { return '' } }
  ```

  其中 `setupRun` 走 `ChecksTab.js:43-50` 的 `resolveSetupRunText`（过一遍注入决策函数 `injectSetupDecision`，只有决策结果是 `'setup'` 才返回全文），其余键走 `src/client/kernel/prompts.js:295` 的 `promptTextFor`。
- 带 `prompt:` 前缀的 hint 目前有三处，全在通用链视图里：`src/shared/tracker/check-catalog-views.js:51`、`:63`、`:75` 三个技能项用 `'prompt:installSkillsFix'`，`:95` 的 `tracker:initialized` 用 `'prompt:setupRun'`。
- 后端段每一行的 hint 不是目录里写的，而是宿主在组装快照时从后端声明解析进来的，见下面 A.4 的修复契约一节；`src/host/detectChain.js:232` 又把谓词结果里的 `detail`/`hint` 合并进 `show.desc`/`show.hint`：

  ```js
  return Object.assign({}, s, { show: Object.assign({}, base, rd.detail ? { desc: base.desc || rd.detail } : {}, rd.hint ? { hint: base.hint || rd.hint } : {}) })
  ```

行标题的来路：每一行的标题不是快照里的现成文字，而是客户端拿 `show.i18nKey` 去词条表里查出来的。渲染处是 `src/client/views/ChecksTab.js:151` 的 `const label = checkShowTitle(s.show, s.id)`，解析函数是 `src/client/views/shared/ChainRenderer.js:26-39`（先 `tr(i18nKey)`，查不到才回落 `show.fallback`，再回落 `show.title`）。键名由宿主在通用链视图里生成，形如 `'check.' + id + '.pass'`（`src/shared/tracker/check-catalog-views.js:36-41` 的 `showFor`、`:134` 的默认形态），双语词条写在 `src/client/kernel/locale-word.js`（检查组）。
这条链有门禁钉着：`tests/verify-issue529-checks-i18n.js`（在 `npm run verify` 链上）用正则从 `src/shared/tracker/check-catalog-views.js` 里机械提取所有 `i18nKey: '...'`（`:20-32`），再补一份写死的十个后端 id（`:26`），逐个要求中英成对；它同时要求 `ChecksTab.js` 与 `ChainRenderer.js` 两个文件里中文字符串为零（`:74-75`）。也就是说，**检查项的键名一旦换地方生成，这条门禁的提取源也要跟着改**，否则它会从「按目录枚举」退化成「只查那十个写死的 id」。

动作按钮的来路：

- 只有失败或当前步才渲染按钮：`src/client/views/ChecksTab.js:165`

  ```js
  const fixActions = (s.status === 'fail' || s.status === 'current') ? (Array.isArray(s.actions) ? s.actions : []) : []
  ```

- 每行只留一个主按钮，挑选次序是「form 或 wizard 优先，其次 inject-prompt 或 rpc」：`ChecksTab.js:166`；按钮文案由 `ChecksTab.js:120-129` 的 `miniActionLabel` 按动作类型给（`inject-prompt` 优先用后端下发的 `label`）。
- 按钮在执行期间会因为仓库同步态被禁用：`ChecksTab.js:167-171`（`disabled: !!repoSync`）。
- 点击后统一走动作分发器：`ChecksTab.js:130-136` 的 `runAction` → `chainDispatcher.dispatch(a)`；分发器在 `ChecksTab.js:51-107` 构造，真正的实现是 `src/client/kernel/actions.js:36` 的 `createActionDispatcher`（动作词汇表定义在 `actions.js:15`：`inject-prompt / open-url / rpc / form / refresh / wizard`）。
- 注入、开链接、宿主电话、表单渲染四件事由分发器回调接到客户端能力上（`ChecksTab.js:55-100`），刷新的实现是 `host.call('wf.detect', { force: true })` 加 `loadChain(st, true)` 加 `loadSnapshot(st, true, true)`。

后端声明的修复知识（四处顺序来源里的第四处）：

- 声明位置：`src/host/tracker/backends/github/index.js:32-113`（`gh:installed` / `gh:authed` / `gh:remote` / `gh:repoAccess` 四项，hint 加动作，动作里含两步 wizard 的 `wf.initPublish`），`src/host/tracker/backends/markdown/index.js:194`，`src/host/tracker/backends/gitlab/index.js:158`。
- 挂载位置：`src/host/detectChain.js:188` 调 `fixMod.attachFixContract(items, tmod, chainLang, { cwd: cwd, owner: _fixOwner })`，实现是 `src/host/tracker/fixContract.js:62-144`。
- 解析规则（`fixContract.js`）：`hint` 取当前语言（`:71` 与 `:29-38` 的 `pickLang`）；`inject-prompt` 的 `prompt` 命中后端 `prompts` 键就换成全文（`:75-77`、`:41-51`）；`form`/`wizard` 的字段文案与 `submitAction.params.cwd` 一并填好（`:82-132`）；后端声明里带 `refresh` 就不再补默认的 `refresh`（`:136-138`）；最后把 hint 并进 `onFail.show`（`:139-141`）。

还有一处**同义但不同实现**的渲染器要留意：`src/client/views/shared/ChainRenderer.js` 里另有一套按钮文案表（`:64-71` 的 `labelMap`），只由 `src/client/views/NoRepoCard.js:105` 使用；而 `NoRepoCard` 目前全仓没有任何挂载点（`src/client/views/ListTab.js:227-228` 的注释写着已不再挂载，全仓搜索只有测试里的反面断言）。写规格时以 `ChecksTab` 那一套为准，`ChainRenderer` 这套属于待清理的旧路。

### A.4 「开门链门槛」逻辑，以及 GENERIC_GATE_CHAIN / catalogFor / GENERIC_CHAIN 的全部消费方

`GENERIC_GATE_CHAIN` 的定义在 `src/shared/tracker/check-catalog-views.js:101-112`，注释写的语义是「已选后端 → 已初始化」两步：

```js
export const GENERIC_GATE_CHAIN = Object.freeze([
  {
    id: 'selection:backendSelected',
    check: { kind: 'backend', id: 'backendSelected' },
    onPass: { … }, onFail: { … actions: [{ type: ACTION_TYPE.REFRESH, target: 'chain' }] },
    label: '已选择后端',
    group: 'gate',
  },
  GENERIC_CHECK_ITEMS.find(c => c.id === 'tracker:initialized'),
].filter(Boolean))
```

它被谁读、各自用在哪一步：

1. `src/shared/tracker/check-catalog-views.js:118` 自己拼全链：`GENERIC_CHAIN = Object.freeze([...GENERIC_GATE_CHAIN, ...GENERIC_ENV_CHAIN])`。这是唯一决定「门槛两步排在整条通用链最前」的地方。
2. `src/shared/tracker/check-catalog-views.js:127` 的 `catalogItemToCheckItem` 里按 id 反查：`GENERIC_CHECK_ITEMS.find(...) || GENERIC_GATE_CHAIN.find(...)`。这里只用成员关系，不用顺序。
3. `src/host/tracker/generic.js:18` 静态 import 这三个常量；`:81-85` 的 `getGenericChain(kind)` 按 `kind` 切片：

   ```js
   if (kind === 'gate') return [...GENERIC_GATE_CHAIN]
   if (kind === 'env') return [...GENERIC_ENV_CHAIN]
   return [...GENERIC_CHAIN]
   ```

4. `src/host/tracker/generic.js:103-109` 的 `resolveGenericChain` 用它求值；`src/host/detectChain.js:121` 调用它，`kind` 取自 `detectChain.js:120` 的 `const kind = (args && args.kind) || 'all'`。
5. `src/host/tracker/generic.js:130-136` 的 `GENERIC_EXPORTS` 导出 `gateChain` / `envChain` / `allChain`。**全仓（含测试）没有任何地方读 `GENERIC_EXPORTS`**，它是死导出。
6. 测试：`tests/verify-generic-catalog.js:34-43` 断言 `GENERIC_GATE_CHAIN.length === 2`、`GENERIC_ENV_CHAIN.length >= 3`；`:49-52` 断言 `getGenericChain('gate')` 里含 `backendSelected` 与 `tracker:initialized`；`:124-137` 直接拿 `GENERIC_GATE_CHAIN` 喂 `evaluateChain` 验门槛首步失败时阻塞。

`catalogFor` 的消费方：

1. `src/host/detectChain.js:166` —— 决定后端段的行顺序，进而决定检查页后端段从上到下怎么排。
2. `src/host/tracker/generic.js:116-119` 的 `assertGenericConsistent` —— 只比较四个后端下通用子集的 id 集合是否一致，排序后再比，与顺序无关。
3. `tests/verify-generic-catalog.js:36-40`、`tests/verify-dirwritable.js:24/119/123`、`tests/verify-chain-renderer.js:189-192` —— 都是按 id 取项或比较集合。
4. `src/host/tracker/backends/github/checks.js:51` 只有注释提到它。

`GENERIC_CHAIN` 的消费方：`src/host/tracker/generic.js:84`（`getGenericChain` 缺省分支）、`:135`（死导出）、`tests/verify-generic-catalog.js` 多处。

运行时的一个关键事实：**客户端从来不按 `kind` 取门槛那一段**。`src/client/kernel/probe-chain.js:74` 传给 `wf.chain` 的参数只有 `cwd` / `backendId` / `force` / `lang` 四项，没有 `kind`，所以宿主恒走 `'all'`，`'gate'` 与 `'env'` 两个切片今天只在测试里被调用。

还有一处更容易踩：**状态栏那条蓝条不读链**。`selection:backendSelected` 这个 id 在 `src/client/**` 里一次都没出现（全仓搜索只有通用目录、`src/host/tracker/generic.js` 的谓词注册和测试用到）。状态栏的蓝条由它自己的一套判据决定，见 A.5。所以「门槛第一步」在界面上有两个互不相干的读法：检查页第一行读链步骤，状态栏读 `s.selection`。

### A.5 状态栏那条顺序（作为对照，维修订时的第二处来源）

- 判定：`src/client/statusbar/StatusBar.js:142`

  ```js
  const firstBlock = (_gateActive || _backendUndecided) ? 'gate' : ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
  ```

  其中 `_backendUndecided` 在 `:141`，`_gateActive` 在 `:136`，都由 `s.selection` 直接算出来，与链快照无关。
- 读数：`src/client/statusbar/checksums.js:18-42`。技能条取三个技能步里最差的那一步（`:22-34` 的 `worstOf`，`rank` 里 `done < current < fail < pending`），`ghcli` 与 `ghauth` 分别取 `chainStep(s, 'gh:installed')` 与 `chainStep(s, 'gh:authed')`（`:36-37`），`setup` 取 `setupCheck(s)` 也就是 `chainStep(s, 'tracker:initialized')`（`probe-chain.js:121`）。
- 渲染：`StatusBar.js:251-267`，五档分别对应蓝条（`:253-256`）、ghcli 条（`:257-259`）、ghauth 条（`:260-261`）、setup 黄条（`:262-266`）、技能黄条（`:267`）。
- 这一条链只认 GitHub 的两个 id，所以 GitLab 与 Markdown 工作区里状态栏只能落到 `gate` / `setup` / `skills` 三档；`ghcli` 那颗按钮注入的还是链上那一行的 `show.hint`（`StatusBar.js:259`），与检查页那行的 `inject-prompt` 动作不是同一份文字。

---

## B. 客户端 / 共享 / 宿主三侧的引用规则

### B.1 三条边能不能建（按今天的代码实测）

**客户端模块能不能 import `src/shared/**`？不能，而且不是靠门禁拦，是靠构建机制根本不支持。**
`src/client/**` 下的所有 `.js` 里没有任何一条 import 语句，搜 `import` 命中的全是注释与 JSDoc（例：`src/client/kernel/actions.js:14`、`src/client/kernel/slots.js:6`、`src/client/kernel/portal.js:11`、`src/client/views/IssueDetail.js:6`、`src/client/kernel/slotRenderer-repo-sync.js:3`、`src/client/kernel/tabsfold.js:6`）。
原因是构建把客户端源码按文本拼成一个闭包函数体：`scripts/build.mjs:361-363`

```js
function extractModuleBlock(file) {
  return read(file).split('\n').map((l) => l.replace(/^(\s*)export\s+/, '$1')).join('\n').trim()
}
```

它只剥掉行首的 `export `，**留下的任何静态 import 都会原样落在闭包体里**，闭包体又是被当成脚本编译的（`build.mjs:181-188` 的 `gatePrecheck` 用 `new vm.Script('(async () => {\n'+code+'\n})()')`），静态 import 不是脚本的合法语法，构建会当场失败。共享代码要进客户端，只能走「文本拼接」这条通道（见 B.3）。

**宿主能不能 import `src/shared/**`？能，而且是常规做法。**实例：

- `src/host/tracker/generic.js:17-18` 两条静态 import：`import { GENERIC_CATALOG, catalogFor } from '../../shared/tracker/check-catalog-dirs.js'` 与 `import { GENERIC_CHECK_ITEMS, GENERIC_GATE_CHAIN, … } from '../../shared/tracker/check-catalog-views.js'`。
- `src/host/detectChain.js:163-165` 三条动态 import：`await import('../shared/tracker/check-catalog-dirs.js')`、`('../shared/tracker/check-catalog-views.js')`、`('../shared/tracker/chain-validate.js')`。
- `src/host/namingGuardian.js:17` 一次动态 import 三份共享命名文件；`src/host/bootstrap.js:197` 动态 import `../shared/matt-skills.js`。
- 后端房间里的例子：`src/host/tracker/backends/github/issues.js:11`、`gitlab/normalize.js:15`、`markdown/parse.js:1` 各自 import `shared/tracker/constants.js`。

**客户端能不能 import `src/host/**`？不能。**客户端与宿主之间只有一条 `host.call('wf.xxx', 参数)` 的电话线：客户端侧的发起点是 `src/client/kernel/probe-chain.js:76` 的 `host.call('wf.chain', args)`，宿主侧的注册点是 `src/host/index.js:229` 的 `harness.handle('wf.chain', …)`。动作分发器里的 `hostCall` 也是同一条线（`src/client/kernel/actions.js:84-88`，由调用方在 `ChecksTab.js:57` 接上）。
**宿主也从不 import 客户端**：在 `src/host/**` 里搜 `src/client` 与 `../client` 零命中。

### B.2 两道结构门禁的实际规则

- `tests/verify-no-cross-import.js`（跨房引用门禁，文件是 GBK 编码，用 UTF-8 读会报错）。扫描域只有三座后端房间：`src/host/tracker/backends/github`、`gitlab`、`markdown`（`:30-31`）。白名单在 `:38-45`：

  ```js
  const WHITELIST_RE = [
    /^src\/shared\/tracker\//,
    /^src\/shared\/labels\.js$/,
    /^src\/shared\/label-color\//,
    /^src\/host\/tracker\/preflight\.js$/,
    /^src\/host\/platform\//,
  ]
  ```

  规则是同房间相对路径放行、白名单放行、node 内置放行，其余一律违规；动态 import 的说明符必须是字面量，写成变量也算违规（`:167-177`）。**它不管客户端，也不管共享层。**
- `tests/verify-no-same-layer-import.js`（同层互引门禁，`.js` 开头有 BOM）。层的划分在 `:41-48`：`platform` / `backends` / `host` / `shared` / `seam`，**`client` 明确不在范围**，理由写在 `:16`：「client 不在范围：它的模块经 scripts/build.mjs 文本拼进闭包，源码层天然零 import 边」。规则是同一层内部文件之间不许互相引用，新增边直接失败，存量边记在 `tests/same-layer-baseline.json` 里只许减不许增。今天共享层里的存量边只有两条：`src/shared/tracker/deck-derive.js:17` 与 `src/shared/tracker/shape.js:17` 各自 import `./constants.js`，登记在 `tests/same-layer-baseline.json:187-201`（owner 写着「二批·shared拆分票」）。**这条规则直接约束新模块：新的共享模块之间不许互相引用，也不能 import 同层的既有共享文件。**

### B.3 客户端产物是怎么拼出来的：新增一个 `src/client/kernel/` 模块要做什么

客户端只有一个真源入口 `src/client/index.js`，构建把它拆成「头注释 + 插件对象函数体」两段（`build.mjs:57-69` 的 `extractPluginBody`），再往函数体里补三样东西：

1. 在 `apply(ctx) {` 后面注入 `src/client/kernel/ctx.js` 的声明体（`build.mjs:219-231` 的 `extractCtxBlock` 与 `wireCtx`）。
2. 按三张清单把各模块文本替换回标记处（`build.mjs:364-403` 的 `wireModules`）：
   - `KERNEL_MODULES`（`build.mjs:237-273`，30 项），标记形如 `// ==== kernel:<name> (spliced by build) ====`；
   - `LEAF_MODULES`（`build.mjs:307-360`），标记形如 `// ==== leaf:<id> (spliced by build) ====`；
   - `SHARED_SPLICE`（`build.mjs:283-300`），标记形如 `// ==== shared:<name> (spliced by build) ====`。
3. 替换后再按同一段函数体产出两个产物（`build.mjs:406-439` 的 `buildClient`）：`client.js` 是 `cordis_define` 函数体形态（`:413-415`），`package/lib/client.js` 是同一个函数体外面套 `window.__ModuleLoader__.load({ … factory: (require) => { … } })` 工厂壳（`:417-433`），壳里给 `React` / `host` / `styles` / `timer` 四个自由变量提供 pkg 方言的绑定（`build.mjs:73-117`）。

于是，**新增一个 `src/client/kernel/<名>.js` 想进产物，要做三件事，缺一件就白写**：

1. 在 `KERNEL_MODULES` 里加一项 `{ name: '<标记名>', file: 'src/client/kernel/<名>.js' }`（`build.mjs:237-273`）。
2. 在 `src/client/index.js` 里、需要它生效的位置加一行标记 `// ==== kernel:<标记名> (spliced by build) ====`。构建靠这个标记找落脚点，找不到就报错：

   ```js
   if (out.indexOf(marker) < 0) throw new Error(`[build] 缺 marker ${marker} 对应 ${m.file} — 请在 src/client/index.js 加标记并在 KERNEL_MODULES 注册`)
   ```

   （`build.mjs:368-369`，叶子与共享两轮同款，见 `:372-373` 与 `:377-378`。）标记的位置就是模块在闭包里的定义位置，闭包内靠变量名互相看见，**所以标记顺序就是依赖顺序**。
3. 跑 `node scripts/build.mjs` 重新生成 `client.js` 与 `package/lib/client.js`（两个产物都是构建产物，不许手改；`package/lib/index.js` 是 `src/host/index.js` 的原样复制，`package/shared/*` 是 `src/shared` 的原样复制，见 `build.mjs:451-499`）。

另外三条容易漏的配套：

- 反向检查只覆盖叶子：`build.mjs:381-401` 只遍历 `src/client/views`、`panel`、`statusbar`、`floating` 四个目录，发现未登记的 `.js` 就报错并提示「新加叶子需在 LEAF_MODULES 加一项并在 src/client/index.js 加标记」。**kernel 目录不在这次反向检查里**，所以只加文件不加登记与标记，构建不会报错，但代码不会进产物，运行时表现为「某个函数未定义」。
- `tests/verify-kernel.js:14-45` 另有一份 kernel 模块与导出清单，`:47-54` 的 `SOURCES` 由这份清单机械展开成「产物新鲜度」基准（`:56-65`：任一源文件比产物新就判过期）。新模块要在这份清单里登记，否则导出检查与新鲜度检查都不会覆盖它。另有两条不走拼接的特例，记在 `docs/architecture/kernel-contract.md:23-26`：`kernel/ctx.js` 经 `wireCtx` 注入到 `apply(ctx)` 顶部，`kernel/tabsfold.js` 内联在 `src/client/index.js` 里，两者都不在 30 个拼接模块之内（门禁分别是 `tests/verify-ctx.js` 与 `tests/verify-tabsfold-leaf.js`）。
- 模块里有中文字符串字面量会被 `tests/verify-locale-completeness.js:98-149` 拦下：清单外的文件出现字符串级中文即红，新文件必须为 0（`ChecksTab.js` 与 `ChainRenderer.js` 两条基线都是 0，`:113` 与 `:120`）。所以新模块里的文案必须走 `tr()` 词条，双语词条加在 `src/client/kernel/locale-*.js` 四个片段里（`verify-locale-completeness.js:20` 列了这四份加合并器共五个文件），键的 zh/en 各出现一次由 `:38-44` 断言。
- 文档侧：`docs/architecture/kernel-contract.md:28-66` 是 kernel 模块的对外接口表（冻结表），新增模块要在表里补一行，写清导出、依赖与说明。

### B.4 新增一个共享模块要做什么

`SHARED_SPLICE` 目前 10 项（`build.mjs:283-300`），登记格式与 kernel 相同，只是多一个 `marker` 字段：

```js
{ marker: '// ==== shared:trackerConstants (spliced by build) ====', file: 'src/shared/tracker/constants.js' },
```

要点：

- 客户端要用的共享模块，除了加进 `SHARED_SPLICE`，还要在 `src/client/index.js` 里加对应标记（现有标记位置见 `src/client/index.js:104`（mattSkills）、`:130`（trackerConstants）、`:131`（三份命名文件挤在一行）、`:132`（trackerSync）、`:133`（slots）、`:156`（workspaceKey）、`:160-161`（两份配色核心产物））。
- **被拼进闭包的共享文件必须零 import。**原因是 B.1 那条：拼进去的文本会留在闭包体里。今天只有两个共享文件带相对 import（`shape.js`、`deck-derive.js`），它们都没进拼接清单，是宿主专用。
- 共享层内部不许互相 import（`verify-no-same-layer-import.js:145-147`），所以新模块要么自包含，要么把需要的东西由调用方传进来。
- `tests/verify-build-artifacts.js:141-142` 用两个死数字锁 `src/shared` 的文件数（`srcSharedFiles.length === 26`、`pkgSharedFiles.length === 26`）；`:131-140` 是历次新增文件时留的「来历注释」序列。**新增一个共享文件就要把这两处数字改成 27，并按同样格式补一行来历注释**，否则门禁直接红。
- 如果新共享文件是某个 TypeScript 核心的转译产物，还有逐字节与新鲜度门禁：`tests/verify-label-color-freshness.js:25`、`:68`（`SPLICED` 清单）与 `tests/verify-update-freshness.js` 的同款做法；`tests/verify-generated-no-shadow.js` 检查派生文件与拼接分块的顶层名字不许重复，也不许出现 `__DSW_VERSION__` / `__DSW_REPO_URL__`。

---

## C. 新的共享步骤清单模块可以放哪里

### C.1 `src/shared/` 现有模块清单（26 个 `.js`，含行数）

行数按该文件的总行数（`split(/\r?\n/).length`，与 `tests/verify-file-granularity.js:48-51` 同口径）。

- `src/shared/parser.js`（118 行）——宿主纯函数叶子：`normalizeBody` / `parseMapBody` / `parseProgress` / `computeLevels` / `groupTickets`。
- `src/shared/labels.js`（26 行）——核心标签清单单源（10 个标签，`CANONICAL_LABELS`），宿主与客户端都要用同一份名集合。
- `src/shared/tracker/link.js`（49 行）——契约层 URL 供给纯函数。**今天全仓没有任何 import 点**（只有它自己的头注释还写着「host + client 共用」）；客户端侧用链接函数是另一份 `src/client/kernel/link.js`。这是既有共享文件里的一处历史遗留，写规格时不要把它当成「两半共用」的先例。
- `src/shared/matt-skills.js`（78 行）——Matt Pocock 技能套件单源：技能名清单与 25 项探测名。
- `src/shared/workspaceKey.js`（110 行）——客户端侧工作区键归一（`keyOf`）；宿主另有自己的一份 `src/host/workspaceKey.js`（247 行，含「锚到工作区根」第二步），两者今天不是互相 import 的关系。
- `src/shared/ui/slots.js`（97 行）——内部 UI 槽位声明（五座位与向导判据），拼进客户端闭包。
- `src/shared/tracker/constants.js`（144 行）——契约层枚举与票身份算法：`STATE` / `ISSUE_TYPE` / `ERROR_KIND` / `effortOf` / `idOf` / `idOfParts`。
- `src/shared/tracker/chain-types.js`（234 行）——契约层形状定义：`Check` / `Show` / `Action` / `CheckItem` / `StepSnapshot` / `ChainSnapshot` 与动作、状态枚举。
- `src/shared/tracker/chain-validate.js`（245 行）——`validateCheckItem` / `validateChain`（形状校验，不验内容）。
- `src/shared/tracker/chain-evaluate.js`（269 行）——`evaluateChain` 纯函数求值器，以及 `isChainComplete` / `currentStepOf` / `chainProgress` / `capsuleSummary`。
- `src/shared/tracker/check-catalog-dirs.js`（246 行）——四个检查目录（通用、GitHub、GitLab、Markdown）、`scopeOf` / `catalogFor` / `MIGRATION_MAP` / `CATALOG_VERSION`。
- `src/shared/tracker/check-catalog-views.js`（155 行）——通用链视图：`GENERIC_CHECK_ITEMS` / `GENERIC_GATE_CHAIN` / `GENERIC_ENV_CHAIN` / `GENERIC_CHAIN` / `catalogItemToCheckItem` / `validateGenericShape`。
- `src/shared/tracker/shape.js`（228 行）——归一化数据形状的类型定义（票、仓库、快照、能力字段的存在约定）。
- `src/shared/tracker/deck-derive.js`（241 行）——deck 派生视图纯函数（frontier / claimed / blocked 计数与分层）。
- `src/shared/tracker/sync.js`（184 行）——面板增量同步求值器与节拍常量（`SYNC`：`FALLBACK_PROBE_MS` 等）。
- `src/shared/tracker/list-dedupe.js`（55 行）——列表按身份去重。
- `src/shared/tracker/indexWindow.js`（156 行）——增量索引的时间窗与水印。
- `src/shared/naming-titles.js`（147 行）——命名守护的占位识别、标题清洗与草稿档/编号档合成。
- `src/shared/naming-tracking.js`（286 行）——命名守护的值比对锁、跟踪态与分档状态机、失败重试。
- `src/shared/naming-attribution.js`（173 行）——命名守护的编号归属（新增编号、语义相关性判定）。
- `src/shared/update/ports.js`（6 行）/ `service.js`（349 行）/ `commands.js`（74 行）——更新核心的转译产物（源码在 `update-core/`）。
- `src/shared/label-color/ports.js`（3 行）/ `colors.js`（30 行）/ `prompt.js`（19 行）——配色核心的转译产物（源码在 `label-color-core/`）。

### C.2 已经被客户端与宿主两半都消费的共享模块

「两半都消费」的判据是：既在 `SHARED_SPLICE` 里（会被拼进客户端闭包），又在 `src/host/**` 里有 import 点。按这个判据，今天只有四组：

| 共享模块 | 客户端消费点（先拼进闭包，再由闭包内代码引用） | 宿主消费点 |
|---|---|---|
| `src/shared/tracker/constants.js` | 拼接标记 `src/client/index.js:130`；引用例：`src/client/views/ListTabRow.js:11`（`effortOf`）、`src/client/views/MapDetail.js:13`（`idOf`）、`src/client/views/IssueDetail.js:252`（`idOfParts`） | `src/host/commentThreads.js:4`、`src/host/tracker/snapshot.js:22`、`src/host/tracker/contract.js:17`、`src/host/tracker/registryShape.js:12`、`src/host/tracker/preflight.js:13`，以及三座后端房间的多数文件 |
| `src/shared/naming-titles.js`、`naming-tracking.js`、`naming-attribution.js` | 拼接标记 `src/client/index.js:131`；引用例：`src/client/kernel/api-naming.js:184`（`evaluateRenameLock`）、`:191`（`composeDraftTitle`）、`:195`（`newSessionTitle`） | `src/host/namingGuardian.js:17` 一次动态 import 三份后合并 |
| `src/shared/matt-skills.js` | 拼接标记 `src/client/index.js:104`（技能清单派生 probeList） | `src/host/bootstrap.js:197` 动态 import 取 `MATT_SKILL_PROBE_NAMES` |
| `src/shared/label-color/colors.js` | 拼接标记 `src/client/index.js:160`；引用例：`src/client/views/labels/labelColorErrors.js:135`、`src/client/views/labels/labelColorPatch.js:54`（`normalizeColor`） | `src/host/tracker/backends/github/label-colors-ops.js:27`、`markdown/label-colors.js:22`、`label-colors-palette.js:11`、`label-colors-paint.js:9`、`label-colors-ops.js:7` |

几个需要注意的相反情况（写规格时别照抄旧注释）：

- `src/shared/tracker/sync.js`、`src/shared/ui/slots.js`、`src/shared/workspaceKey.js`、`src/shared/label-color/prompt.js` 这四份虽然都在 `SHARED_SPLICE` 里，但**今天在 `src/host/**` 里找不到任何 import 点**，实际只有客户端半边在读。`tests/verify-build-artifacts.js:126-140` 的注释把其中几份写成「host import + client splice 双消费」，那是旧注释，已与代码不符。
- `src/shared/tracker/check-catalog-dirs.js` 与 `check-catalog-views.js` 反过来：只被宿主半边在运行时引用，客户端半边没有任何引用，所以它们**不在** `SHARED_SPLICE` 里。`scripts/build.mjs:278-282` 把这条结论写得很明确：

  > 「shared-0（#443）接线结论：下面各项与 src/client/index.js 里拼接标记一一对应，已经对齐；chain 系与 check-catalog 系只被 host 半在运行时引用，client 半没有运行时引用，所以不进拼接清单，S1/S3 拆分时不新设拼接标记」

  这正是今天的真实分工：**检查项的文案与动作声明留在宿主半边，客户端只拿到演进后的快照数据**（`show` / `actions` 里已经是解析好的一手文本与结构）。新的步骤清单模块若想沿用这个分工，就放共享层但不进拼接；若想两半都直接读同一份清单常量，就要进 `SHARED_SPLICE` 并接受 B.3 / B.4 的全部配套。

### C.3 文件体量上限纪律（350 行）

门禁在 `tests/verify-file-granularity.js`：

- 上限与严重档：`:18-19` 的 `const LIMIT = 350` / `const SEVERE = 500`。
- 扫描范围：`src/` 下所有 `.js`（`:31-46`），豁免只有两个派生目录 `src/host/logPkg/`、`src/host/updatePkg/`（`:24-29`，理由是那是原样复制来的编译产物）。
- 行数口径：总行数，空行与注释都算（`:48-51`）。
- 过渡形态：超标文件的行数记在 `tests/file-granularity-baseline.json`，只许减不许增；不在基线里的新超标直接失败；文件达标后必须同票重录基线把它移出（`:85-109`）。**今天这份基线是空的**（`{"version":1,"recordedAt":"2026-09-10","files":{}}`），也就是说任何超过 350 行的文件都会当场变红。
- 同口径的第二道（只针对客户端叶子）：`tests/verify-leaves.js:92` 的 `const limit = 350`。
- 仓库文档里的口径：`docs/architecture/split-blueprint.md:12` 写「仓库 src/ 目录下每个生产代码文件都不超过 350 行（按总行数算，空行和注释都算进去，零例外）」；`:62` 与 `:165` 记了基线锁的来历与「超过 350 不通过、超过 500 同样不通过但多写一句严重并阻断发布」。
- 头注释里同行还写了一条**预估纪律**，新文件建议照写：`src/shared/tracker/check-catalog-dirs.js:2`、`check-catalog-views.js:2`、`src/host/detectChain.js:2` 都写着「以后谁改它：……。预估约 N 行，超 350 打回。」

写规格时的现实含义：给步骤清单新开一个文件是对的，一个文件放不下就按「一个文件一件事」拆成几个互不 import 的文件（`docs/adr/20260913-builtin-ts-shape.md:71` 把这条代价写明了：共享层文件之间不许互相引用，所以跨文件只传数据、不互相 import）。

---

## D. 链快照的形状

### D.1 `wf.chain` 回包的六个字段

宿主在 `src/host/detectChain.js:252` 组装回包：

```js
const result = { ok: true, backendId: backendId || null, chain: chainAndSnap.chain, resolved: chainAndSnap.resolved, snapshot: genericSnap, backendChain: backendChain, fullChain: fullChain, fullSnapshot: fullSnapshot }
```

逐个字段：

- `ok`、`backendId`：`backendId` 是本次探测认定的后端 id（可能是 `null`，见 `:52-59` 的三档取值）。
- `chain`：通用段的检查项数组（`CheckItem` 对象，不是步骤）。来自 `src/host/tracker/generic.js:103-109` 的 `resolveGenericChain`，即 `getGenericChain('all')` 的 `GENERIC_CHAIN` 原样。
- `resolved`：通用段每项的求值结果表，键是检查项 id，值是 `{ status, detail?, hint? }`（由 `predicateCore.resolveAll` 产出，`:190-191` 对后端段同法处理）。
- `snapshot`：通用段自己的步骤快照（`detectChain.js:248` 过了一遍 `enrichSnap` 合并 detail/hint）。它是 `fullSnapshot` 的前半段，字段结构与 `fullSnapshot` 相同。
- `backendChain`：后端段的四件套，`:194` 组装：

  ```js
  backendChain = { chain: items, resolved: resolved, snapshot: snapshot, errors: errs }
  ```

  `items` 是 `catalogFor(backendId)` 过滤后的检查项（已挂修复契约），`errors` 来自 `chain-validate.js` 的 `validateChain`。没有后端时它是 `null`（`:160` 初始化）。`:249-250` 会把它的 `snapshot` 也做一次 `enrichSnap`。
- `fullChain`：通用段加后端段两段检查项首尾相接（`:209`）。**客户端没有任何地方读它**（见 D.4）。
- `fullSnapshot`：两段步骤首尾相接的完整快照，也是客户端唯一真正渲染的那份（`:201-222`）。
- 缓存口径：只有「全绿」才写进宿主 30 秒缓存（`:253-260`，`CHAIN_CACHE_MS = 30000` 在 `:11`）；未全绿每次真探测。

### D.2 每一步的形状

宿主走的是自己实现的并行求值器 `stepEvalParallel`（`detectChain.js:126-157`），**不是** `src/shared/tracker/chain-evaluate.js` 里的 `evaluateChain`。所以在客户端看到的每一步固定是这八个字段（`detectChain.js:140`）：

```js
return { id: it.id, check: it.check, status: status, show: show, actions: actions, isApplicable: true, blockedBy: null, isCurrent: false, isBlocking: status !== 'done' }
```

其中 `status`、`show`、`actions` 的计算在紧邻的上面几行（`:132-139`），值得整段引下来：

```js
const rd = rMap[it.id]
const isPass = rd === 'pass'
const isFail = rd === 'fail'
const status = isPass ? 'done' : (isFail ? (((it.onFail && Array.isArray(it.onFail.actions) && it.onFail.actions.length)) ? 'current' : 'fail') : 'pending')
const _pendingShow = (function () { const bb = (it.onFail && it.onFail.show) || {}; const oo = {}; if (bb.fallback != null) oo.fallback = bb.fallback; if (bb.title != null) oo.title = bb.title; if (bb.i18nKey != null) oo.i18nKey = bb.i18nKey; return oo })()
const show = isPass ? ((it.onPass && it.onPass.show) || null) : (isFail ? ((it.onFail && it.onFail.show) || null) : _pendingShow)
const actions = isFail && it.onFail && Array.isArray(it.onFail.actions) ? it.onFail.actions : []
```

从这段能读出三条写规格时必须知道的语义：

- `status === 'current'` 的判据是「这一步判为失败、并且声明了失败动作」，**不是**「第一个未完成的步骤」。所以一条链里可能同时存在多个 `current` 行（检查页每行都会给它们配按钮）。
- `pending` 的行会被剥掉 hint 与动作（只留 `fallback` / `title` / `i18nKey`），这是 `:134-136` 注释里写的「诚实未知只保留名称」。
- `blockedBy` 恒为 `null`、`isCurrent` 恒为 `false`。因此 `src/client/views/ChecksTab.js:156-160` 那段「被前置阻塞」的提示文案（`tr('env.waitingBlocked')`）在当前数据下永远不会显示——它是给另一套求值器准备的。

作为对照，`src/shared/tracker/chain-evaluate.js:110-187` 的 `evaluateChain` 才是「前步通过才进下一步」的串行求值器，它会算出真正的 `isCurrent`（全链只有一个，`:163` 与 `:172`）、`blockedBy`（指向链头，`:145`、`:162`、`:180`）与 `isBlocking`（`:164`、`:173`）。宿主今天只在两处用到它：`src/host/tracker/generic.js:107`（`resolveGenericChain` 内部算一遍，但结果随后被 `detectChain.js:159` 的并行求值器覆盖）与 `detectChain.js:205` / `:222` 的兜底分支（真出异常时 `fullSnapshot` 会退回这份串行快照）。同一文件里的 `currentStepOf` / `chainProgress` / `capsuleSummary`（`chain-evaluate.js:234-268`）目前只被测试调用。

### D.3 `firstNotDone` / `currentIndex` 的计算代码

通用段（`src/host/detectChain.js:142-154`）：

```js
const firstNotDone = steps.findIndex(function (s) { return s.status !== 'done' })
const allDone = firstNotDone < 0
const snapshot = {
  steps: steps,
  currentIndex: allDone ? null : firstNotDone,
  failedIndex: firstNotDone,
  doneCount: steps.filter(function (s) { return s.status === 'done' }).length,
  applicableCount: steps.length,
  totalCount: steps.length,
  chainState: allDone ? 'allDone' : (steps[firstNotDone].status === 'pending' ? 'pending' : 'hasCurrent'),
  version: '1',
}
if (allDone) { snapshot.isComplete = true } else { snapshot.isComplete = false; snapshot.hasBlockingFailure = steps[firstNotDone].status !== 'pending'; snapshot.blockingCheck = steps[firstNotDone].id }
```

全链（`src/host/detectChain.js:211-221`）：

```js
const firstNotDone = allSteps.findIndex(function (s) { return s.status !== 'done' })
const allDone = firstNotDone < 0
fullSnapshot = {
  steps: allSteps,
  currentIndex: allDone ? null : firstNotDone,
  doneCount: allSteps.filter(function (s) { return s.status === 'done' }).length,
  applicableCount: allSteps.length,
  totalCount: allSteps.length,
  chainState: allDone ? 'allDone' : (allSteps[firstNotDone].status === 'pending' ? 'pending' : 'hasCurrent'),
  version: '1',
}
```

注意全链那一份**没有** `failedIndex` / `isComplete` / `hasBlockingFailure` / `blockingCheck` 四个字段（那是通用段独有的），客户端也没有任何地方读这四个字段。

写规格时要留意的两处不一致：`currentIndex` 指向的是「第一个非 done 的步骤」，而每一行自己的 `status === 'current'` 是按「失败且有动作」判的；两者在同一条链上可能指向不同的行。

### D.4 客户端怎么读它：全部调用点

写入侧（把回包放进会话状态）：

- `src/client/kernel/probe-chain.js:76-88` 的 `loadChain`：`:79-84` 挑 `fullSnapshot || snapshot` 存进 `st.chainSnapshot`，同时把 `st.chain`、`st.fullChain`、`st.chainResolved`、`st.backendChain` 也一起存下。`:92-96` 按「是否全绿」安排 8 秒自动重探（`CHAIN_AUTO_POLL_MS = 8000`，`:22`）。
- `src/client/kernel/probe-chain.js:57-67` 的缓存命中路径（同样写入这几个字段）。
- `src/client/kernel/probe-auto.js:217-225` 把一份新快照广播给同工作区的其他会话。
- `src/client/kernel/store-snapshot.js:30` 初始化这些字段，`:210-223` 从链缓存水合。
- `src/client/kernel/store-switch.js:114-125` 为切换确认单独打一次 `wf.chain`，用 `fullSnapshot || snapshot` 之后**按 id 取** `gh:remote` / `gh:installed` / `gh:authed` 三步判「能不能走迁移」。

读取侧（真正读数据的）：

- `src/client/kernel/probe-chain.js:111-121` 是全部派生读数的定义处：`chainSteps`（取 `st.chainSnapshot.steps`）、`chainStep`（按 id 找一步）、`chainStepStatus` / `chainStepOk` / `chainStepBad`、`readyCount` / `envTotal` / `envLabel`（都按 `status !== 'pending'` 口径过滤）、`setupCheck`（取 `tracker:initialized`）。
- `src/client/views/ChecksTab.js:24`、`:34`、`:37`：轮询判断、整页行渲染、`gh:remote` 单步判定。
- `src/client/views/shared/ChainRenderer.js:173`（步进条按 `snapshot.steps` 顺序铺）与 `:195-196`（横幅取 `snapshot.currentIndex` 那一步）。
- `src/client/views/NoRepoCard.js:23`（`gh:remote`）、`:73`（找 `gh:remote` 是否为 fail）、`:98`（`steps[currentIndex]` 取当前步，看它有没有 form/wizard 动作）。**这个组件今天没有挂载点**，见 A.2 末尾说明。
- `src/client/statusbar/checksums.js:23`、`:36-37`，`src/client/statusbar/StatusBar.js:259`（取 `gh:installed` 的 `show.hint`）。
- `src/client/views/ListTab.js:128`（数 fail 与 current 的行数）。
- `src/client/views/SubworkspaceMark.js:70-78`（`tracker:initialized` 一步判定），`src/client/kernel/slotRenderer-repo-sync.js:35`（`gh:remote`）。
- **从不被读的字段**：`st.chain`、`st.chainResolved`、`st.fullChain`、`st.backendChain` 只在写入侧出现，全仓没有任何读取点（搜索这四个名字只有 `probe-chain.js`、`probe-auto.js`、`store-snapshot.js` 三个写入处）。也就是说「通用段 / 后端段」的分段信息今天没有到达界面，界面看到的只有拼好的一份 `fullSnapshot`。

### D.5 依赖步骤顺序的消费方（逐个说明各自怎么用这一步顺序）

1. 宿主拼快照：`src/host/detectChain.js:209-221`，顺序决定 `fullSnapshot.steps` 的次序、`currentIndex` 指向哪一行、`doneCount` 的分母。这是所有下游顺序的总源。
2. 检查页行序：`src/client/views/ChecksTab.js:148`，原样照抄 `steps` 顺序，不做二次排序。
3. 横幅（当前只有旧路径会用到）：`src/client/views/shared/ChainRenderer.js:195-204`，用 `snapshot.currentIndex` 取「当前步」，取不到时退回「第一个 `fail` 的步骤」；`ChainSteps`（`:173`）按数组顺序画步进条并给每步编 `idx + 1`。
4. `NoRepoCard` 的建仓委托：`src/client/views/NoRepoCard.js:76`（要求 `currentIndex != null`）与 `:98`（`steps[currentIndex]` 取当前步判断有没有 form/wizard 动作）。它读的是索引，所以**改动步骤顺序会直接改变这个组件的分支走向**（虽然它当前没挂载）。
5. 状态栏优先级：`src/client/statusbar/StatusBar.js:142`。它不用数组顺序，而是把顺序硬编码成一条三元表达式；但意图与检查页顺序是同一件事，所以规格必须把这两处一起说清。
6. 全绿与轮询判定：`src/client/kernel/probe-chain.js:32-33`、`:92-93` 与 `src/client/views/ChecksTab.js:21-32`，都只做 `steps.some(s => s.status !== 'done')`，与顺序无关。
7. 计数与徽标：`src/client/kernel/probe-chain.js:117-120`（就绪分子分母）、`src/client/statusbar/checksums.js:24-34`（技能三项取最差态）、`src/client/views/ListTab.js:128`（坏项计数），与顺序无关。
8. 宿主缓存：`src/host/detectChain.js:256-260`，全绿才缓存，与顺序无关。
9. 测试里锁顺序的地方：`tests/verify-generic-catalog.js:41-52`（门槛链长度与成员）、`tests/verify-chain.js:167/176/222`（`currentIndex` 等于第几步）、`tests/verify-chain-renderer.js:165-186`（构造夹具时按索引给 `currentIndex`）、`tests/tracker-contract/sections/chain.js:68/95/104/110`（串行求值器语义）。

### D.6 与顺序有关、但今天没接上的东西（写规格时的陷阱清单）

1. 状态栏蓝条不读链步骤：`selection:backendSelected` 这个 id 在 `src/client/**` 零出现，蓝条由 `StatusBar.js:141-142` 的 `s.selection` 判据决定。门槛链第一步在界面上只有检查页第一行在显示。
2. 检查页的「被前置阻塞」提示是死代码：`ChecksTab.js:156-160` 读 `s.blockedBy`，而宿主并行求值器把它恒设为 `null`（`detectChain.js:140`）。
3. 每行自己的 `status === 'current'` 与快照的 `currentIndex` 不是同一个概念（D.2 末尾已说明）。
4. `st.chain` / `st.fullChain` / `st.backendChain` 存而不用（D.4）。
5. `GENERIC_EXPORTS`（`src/host/tracker/generic.js:130-136`）无任何消费方。
6. `kind`（`'gate'` / `'env'` / `'all'`）这条入口在实际运行中恒为 `'all'`，客户端从不传它（`probe-chain.js:74`）。
7. 与顺序有关的门禁有两条**没有挂在 `npm run verify` 链上**：`tests/verify-generic-catalog.js`、`tests/verify-chain-renderer.js`、`tests/verify-chain.js`、`tests/verify-344-chain-auto-refresh.js`、`tests/verify-skill-probe-redcard-and-waiting.js`、`tests/verify-496b-inject-guard.js` 都不在 `package.json` 的 `scripts.verify` 里（`package.json` 里那份长长的 `verify` 命令逐条列脚本名，可以对照）。改动顺序后若要靠机器拦住回归，要么把相关用例接进链上，要么新写一条并挂上去——本仓库的惯例是新门禁自己断言「已在 npm run verify 链里」，例：`tests/verify-596-rpc-carrier.js:26`、`tests/verify-wizard-exit-609.js:141`。
8. `npm run verify` 里与检查页直接相关的既有门禁是 `tests/verify-issue529-checks-i18n.js` 与 `tests/verify-655-setup-layout.js`（初始化布局注入，`tests/verify-655-setup-layout.js:242` 会同时读 `ChecksTab.js` 与 `NoRepoCard.js` 与两个产物）。前者除了要求中英成对，还用正则从 `src/shared/tracker/check-catalog-views.js` 里机械提取检查项键名（`tests/verify-issue529-checks-i18n.js:20-32`），所以把键名的生成地搬走时，这条门禁的提取源要同票改（细节见 A.3 的「行标题的来路」）。
