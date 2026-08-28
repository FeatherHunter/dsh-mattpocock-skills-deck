# Markdown 后端初始化与 Wayfinder 面板不可见问题的调研

> 日期：2026-08-28
> 仓库：`D:/dsh-plugin/matt-demo-markdown-test1`（演示库，非 git）与 `D:/dsh-plugin/dsh-mattpocock-skills-deck`（宿主实现）
> 问题：① 初始化后两条环境检测为何存在、作用是什么；② wayfinder 拆解后右侧面板为何不出现 ISSUE

---

## 摘要

- **两条检测是真实的「后端健康检查」**，定义在 `src/shared/tracker/check-catalog.js` 的 `MARKDOWN_CATALOG`，经 `wf.chain`（`src/host/index.js`）求值后在面板「检查」链渲染。标签文字「可写」与实现「存在」有措辞偏差；第二条的细节文案直接来自 `mdParseOkPredicate`。
- **初始化后必为 FAIL 是符合预期的**：`setup-matt-pocock-skills` 对 Local Markdown 模板只写 `docs/agents/issue-tracker.md`，不创建 `.scratch`，更不创建 `.scratch/map.md`；首个 `wayfinder` 地图才会创建 `.scratch/<effort>/`。
- **面板不显示的直接原因是「写—读路径错位」**：wayfinder 按 `docs/agents/issue-tracker.md` 契约写到 `.scratch/<effort>/map.md` 与 `.scratch/<effort>/issues/`；而面板的 `wf.snapshot`（`src/host/index.js#buildSnapshot`）整段硬编码走 GitHub `gh api` 拉取，完全不走 `tracker.list` / `composeSnapshot`。即便未来走后端，宿主的 `predicate` 与 `listIssues` 也仍以扁平 `.scratch/map.md`、`.scratch/issues/` 为假设，与 wayfinder 的「每 effort 一目录」契约不一致。

---

## 一、两条环境检测的来源、定义与作用

### 1.1 唯一真源：检查目录

文件：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/shared/tracker/check-catalog.js`

- 通用检查（`GENERIC_CATALOG`）与后端检查（`GITHUB_CATALOG / GITLAB_CATALOG / MARKDOWN_CATALOG`）分离，前者「换后端结果不变」，后者「换后端行不存在而非标 na」（#226 起删 `na`）。
- Markdown 后端只声明 2 项（行号约 159–178）：

```js
export const MARKDOWN_CATALOG = Object.freeze([
  {
    id: 'md:scratchWritable',
    label: '.scratch 目录可写',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'primitive', primitive: PRIMITIVE_KIND.FILE_EXISTS, path: '.scratch' },
    origin: 'backends/markdown/preflight.js / inventory 类别 8',
  },
  {
    id: 'md:parseOk',
    label: '本地图谱可解析',
    scope: 'backend',
    backends: ['markdown'],
    check: { kind: 'backend', id: 'parseOk', backendId: 'markdown' },
    origin: 'backends/markdown/parse.js',
  },
])
```

来源标注：见 `check-catalog.js` 头部注释「形式化判据：若把 backendId 从 'github' 切到 'markdown' 期望结果不变 → 通用；否则 → 后端」。

### 1.2 渲染载体：wf.chain

文件：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/index.js` 约 1524–1701 行

- 前端只调 `wf.detect / wf.chain`，探测零 OS 直碰（经 `platform.fs / platform.path / platform.getHome`）。
- `wf.chain` 内：
  - 先 `getDetectionService().detect({cwd})` 拿 `selection.backendId`（三级联 explicit > matches > fallback）；
  - 用 `predicateRegistry.createPredicateRegistry({timeout:3000})` 并发求值；
  - 通用链（`genericChain`）与后端链（`catalogFor(backendId)`）独立求值，拼接为 `fullSnapshot`；
  - 若 `backendId === 'markdown'`，会经 `catalogFor('markdown')` 拿到上述 2 项，并经 `fixContract.attachFixContract` 附上修复指引（见下）。

### 1.3 求值实现

#### md:scratchWritable — 原语文件存在检测

文件：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/predicateRegistry.js` 约 90–150 行

```js
if (kind === PRIMITIVE_KIND.FILE_EXISTS) {
  const abs = await p.fs.resolve(rel, { cwd: ctx.cwd })
  if (typeof p.fs.exists === 'function') {
    const ok = await p.fs.exists(abs)
    if (ok) return makeResult('pass', rel + ' exists')
    // 目录兜底：listDir / stat / lstat（.scratch 是目录）
    if (typeof p.fs.listDir === 'function') { try { await p.fs.listDir(abs); return pass } }
    return makeResult('fail', rel + ' not found')
  }
}
```

注意：标签叫「可写」，但实现只判「存在」；文件头 `origin: backends/markdown/preflight.js` 也说明最初是「是否可写 / 是否存在」的早期预检，落地时简化为存在检测。后续 `fixes` 的文案才补上「检查权限 / 只读挂载」的完整指引。

#### md:parseOk — 后端谓词

注册处：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/index.js` 约 1583–1585 行

```js
registry.register('backend:markdown:parseOk', async (check, pctx) => {
  return await mdParseOkPredicate(platform, pctx.cwd || cwd)
})
```

实现体：同文件约 1265–1276 行

```js
async function mdParseOkPredicate(platform, cwd) {
  const hasMap = await fileExistsChainRel(platform, cwd, '.scratch/map.md')
  if (hasMap !== true) return { status: 'fail', detail: '.scratch/map.md missing — created by initialization' }
  const abs = await platform.fs.resolve('.scratch/map.md', { cwd })
  const text = await platform.fs.readText(abs)
  const { parseMd } = await import('./backends/markdown/parse.js')
  parseMd(String(text||''), {})
  return { status: 'pass', detail: 'local map parses OK' }
}
```

细节文案 `".scratch/map.md missing — created by initialization"` 正是用户截图中第二条的 `detail`。

#### 修复契约

文件：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/index.js` 末尾 `fixes / prompts`

```js
export const prompts = {
  mdParseFix: { zh: '本地 Markdown 图谱解析失败…', en: 'Local Markdown graph parse failed…' },
  mdWritableFix: { zh: '.scratch 目录不可写…', en: '.scratch is not writable…' },
}
export const fixes = {
  'md:scratchWritable': { hint: {zh:'…点「修复指引」…'}, actions: [{type:'inject-prompt', prompt:'mdWritableFix'}, {type:'refresh', target:'chain'}] },
  'md:parseOk':        { hint: {zh:'本地图谱解析失败…'}, actions: [{type:'inject-prompt', prompt:'mdParseFix'}, {type:'refresh', target:'chain'}] },
}
```

并由 `src/host/tracker/fixContract.js#attachFixContract` 在 `wf.chain` 组装时解析为按钮文案（双语 `hint` + `修复指引 / 重查`）。

### 1.4 为什么初始化后会是 FAIL（预期行为）

- **setup 的职责**：`C:/Users/辰辰洋洋/.agents/skills/setup-matt-pocock-skills/SKILL.md` 定义：探索、询问、三问分段，最后「写」阶段写入 `docs/agents/issue-tracker.md`、`docs/agents/domain.md` 等，但**不创建 `.scratch`**（见 `issue-tracker-local.md` 模板与 SKILL.md §3–4）。实测 `D:/dsh-plugin/matt-demo-markdown`（从未跑 wayfinder 的干净 Local Markdown 示例）确实无 `.scratch` 目录。
- **.scratch 的创建时机**：由 wayfinder 首次「Chart the map」在 `src/host/tracker/backends/markdown/write.js#ensureDir` 中懒创建 `.scratch/<effort>/`。
- **检测的语义**：`.scratch 目录可写` = 工作区是否具备本地落盘能力；`本地图谱可解析` = 首个地图文件是否已就绪且格式合法。初始化后工作区处于「已选 Local Markdown 但首张地图尚未绘制」的状态，二者 FAIL 是对「尚未落盘」的**诚实表达**，而非错误。

证据：用户当前已跑过一次 wayfinder 的 `matt-demo-markdown-test1` 上，磁盘实际结构为：

```
D:/dsh-plugin/matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan/
  map.md
  issues/01-research-promos.md
  issues/02-research-stores.md
  issues/03-choose-two-drinks.md
  issues/04-pick-order-time.md
  issues/05-fallback-plan.md
```

根级 `.scratch/map.md` 与 `.scratch/issues/` 仍不存在——因此按当前 `mdParseOkPredicate` 的硬编码路径，二者在**严格定义下仍会 FAIL**，即便工作区已有一个可用 effort。详见下一节「路径错位」。

---

## 二、wayfinder 拆解后右侧面板不出现 ISSUE 的原因

### 2.1 写路径（wayfinder）：每 effort 一目录

契约文件：`D:/dsh-plugin/matt-demo-markdown-test1/docs/agents/issue-tracker.md` §Wayfinding operations

> - **Map**: `.scratch/<effort>/map.md`
> - **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`

亦见 `AGENTS.md` 与 `SKILL.md (wayfinder)` 对同一约定的复述。实测 wayfinder 会话严格按此写入，前文目录清单即证据。

### 2.2 读路径（面板）：硬编码走 GitHub

文件：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/index.js#buildSnapshot` 约 1078–1251 行

```js
async function buildSnapshot(cwd, hintBackendId) {
  const repo = await getRepoKey(cwd)
  const fi = await fetchIssues(cwd)           // gh api repos/{owner}/{name}/issues?state=all …
  const mapsMeta = fi.issues.filter(x => x.labels.includes('wayfinder:map'))
  const d = await fetchMapsDetail(mapsMeta.map(m=>m.number), cwd) // GraphQL aliases + REST 降级
  // …组装 maps/tickets/stats…
  // selection 仅用于补 repository / viewer 字段，不决定数据来源
}
```

- `fetchIssues` 定义于约 790 行，内部固定 `gh api --paginate repos/.../issues`；
- `fetchMapsDetail` 约 958 行，固定 GraphQL query；
- 全程无 `if (selection.backendId === 'markdown')` 分支；
- 文件顶部注释「数据流：gh issue list 枚举 wayfinder:map …」也证明该函数自始按单后端（GitHub）设计。

因此，**无论 detection 判定为 markdown，面板 snapshot 仍去 GitHub 取数**。演示库既无 `git remote origin`，也无 `.git`，`getRepoKey` 返回 `null`，`fetchIssues` 退化为空数组，`maps` 空，右侧「列表/地图」自然空白。

### 2.3 即使切到后端，路径仍错位

假设未来 `buildSnapshot` 改为按 `backendId` 分发到 `tracker/snapshot.js#createSnapshotComposer` 的 `composeSnapshot`（该组合器会调 `tracker.list(ref,{})`），仍会撞上第二层错位：

文件：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/path.js`

```js
export function getRoot(repo,ctx){ return plat.join(cwd, '.scratch') }
export function mdPath(repo,kind,keyOrSlug,ctx){
  if(kind==='map') return plat.join(root,'map.md')          // .scratch/map.md
  if(kind==='issue') return plat.join(root,'issues', filename) // .scratch/issues/NN-*.md
}
export function issuesDir(repo,ctx){ return plat.join(root,'issues') }
```

文件：`D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/issues.js#listIssues`

```js
const mapP = mdPath(repo,'map')          // 尝试 .scratch/map.md
const idir = issuesDir(repo)             // 尝试 .scratch/issues
```

二者均为**扁平假设**（`.scratch` 下直接 `map.md + issues/`），与 wayfinder 契约的「`.scratch/<effort>/`」不匹配。因此即使宿主改走后端，当前实现也只能读到根级单 effort 的退化形态，读不到 `buy-luckin-coffee-plan` 子目录下的真实地图。

同样，`mdParseOkPredicate`（1.3 节）硬编码检查 `.scratch/map.md`，而真实地图在 `.scratch/buy-luckin-coffee-plan/map.md`，故该检查在多 effort 仓库下永远 FAIL（与用户截图一致）。

### 2.4 另两个加剧不可见的因素

1. **身份探测的兜底**：`src/host/tracker/backends/markdown/index.js#matches` 已做过兼容——若 `.scratch/map.md` 不存在但 `docs/agents/issue-tracker.md` 含 "Local Markdown"，仍判为 markdown。于是 `wf.detect` 能正确识别为 markdown，但 `wf.snapshot` 却不走 markdown，头部的 backend chip 与检测结果一致、与快照数据却矛盾，用户体感为「明明是 Markdown，面板却空」。

2. **链缓存**：`wf.chain` 有 30s `CHAIN_CACHE_MS`（src/host/index.js 约 1522 行），wayfinder 创建文件后若不 `force`，链状态可能仍显示旧的 FAIL，误导用户以为「写入失败」。

---

## 三、复现与校验步骤（可操作）

1. 在 `D:/dsh-plugin/matt-demo-markdown-test1` 执行：

   ```powershell
   Get-ChildItem -Force -Recurse .scratch | Format-Table FullName
   cat docs/agents/issue-tracker.md   # 确认含 "Local Markdown"
   cat .scratch/buy-luckin-coffee-plan/map.md | Select-Object -First 20
   ```

   预期：`.scratch` 存在，子目录含 `map.md`，根级 `.scratch/map.md` 不存在。

2. 打开 Deck 面板 → 检查 tab：应见 `md:scratchWritable`（若已判存在则 PASS，否则 FAIL .scratch not found）与 `md:parseOk`（FAIL .scratch/map.md missing）。

3. 打开「列表」tab 的网络/日志：`wf.snapshot` 返回 `{maps:[], issues:[]}`，`selection.backendId === 'markdown'` 但 `maps` 空。

4. 在宿主日志中追加临时 probe：

   ```js
   const reg = await getTrackerRegistry(); const tr = reg.get('markdown');
   const res = await tr.list({cwd, refId:cwd}, {}, {cwd, platform: await getPlatform(), fs: ctx.get('fs')})
   console.log(res) // 预期 {ok:true, data:[]} 因读 .scratch/map.md 失败
   ```

---

## 四、修复建议（按影响面递增）

### 方案 A — 最小文档修复（零代码）

- 在 `docs/agents/issue-tracker.md` 与面板空状态中说明：初始化后两条检测 FAIL 属预期；运行一次 wayfinder 后仍可能因「根 map 路径假设」显示 FAIL，不影响 `wayfinder` 的子目录读写。
- 成本最低，但未解决面板空白。

### 方案 B — 对齐检测路径（小改）

- 将 `mdParseOkPredicate` 改为扫描 `.scratch/*/map.md`（与 `matches` 的枚举逻辑一致），任一可解析即 PASS；文案改为 “no effort map found”。
- 将 `md:scratchWritable` 的谓词改为 `exists(.scratch) OR listDir(.scratch) 可枚举`，与 `predicateRegistry#FILE_EXISTS` 对目录的兜底一致，并把标签改为「.scratch 目录已就绪」以消除「可写」误导。
- 同步修改 `path.js / issues.js` 的 `getRoot` 语义：`list` 时枚举 `.scratch` 下所有子目录并聚合（或由上层传入 `effort`）。

### 方案 C — 打通面板快照（中等）

- 在 `src/host/index.js#buildSnapshot` 顶部按 `selection.backendId` 分发：

```js
if (sel && sel.backendId === 'markdown') {
  const composer = createSnapshotComposer(registry)
  const ref = registry.describe({cwd}, 'markdown')
  const r = await composer.composeSnapshot('markdown', ref, opCtx)
  // 将 r.snapshot 适配为 client 期望的 {maps, issues, labels, repository, selection}
  // 并复用 deriveDeck 计算 stats/levels
}
```

- 或将 `buildSnapshot` 的 GitHub 分支抽为 `fetchGithubSnapshot`，新增 `fetchMarkdownSnapshot`，由 `selection` 决定入口。
- 同时让 `snapshot.js#assembleSnapshot` 支持多 effort（`all` 中既含多张 `type:map` 的 map，也含各自 `parentKey` 指向对应 map 的 tickets）。

推荐演进：**B → C**。B 先让检查诚实，C 再让面板可见；二者共用同一「枚举 `.scratch/*`」的目录扫描逻辑。

---

## 五、附录：关键源码与证据速查

| 主题 | 路径 | 要点 |
|---|---|---|
| 检查目录真源 | `src/shared/tracker/check-catalog.js` 约 159–180 | `MARKDOWN_CATALOG` 2 项定义 |
| 通用 vs 后端判据 | 同上头部注释 | 「换 backend 结果不变 → 通用」 |
| host 求值与缓存 | `src/host/index.js` 约 1524–1701 | `wf.chain`, `CHAIN_CACHE_MS=30000` |
| markdown 谓词 | `src/host/index.js` 约 1265–1286, 1583–1585 | `mdParseOkPredicate`, 注册键 `backend:markdown:parseOk` |
| 原语实现 | `src/host/tracker/predicateRegistry.js` 约 90–200 | `FILE_EXISTS`, 目录 `listDir/stat` 兜底 |
| 修复契约 | `src/host/tracker/backends/markdown/index.js` 尾部, `src/host/tracker/fixContract.js` | `prompts/fixes/attachFixContract` |
| 写契约 | `docs/agents/issue-tracker.md` §Wayfinding operations, `AGENTS.md` | `.scratch/<effort>/map.md`, `issues/NN-*.md` |
| 读契约（宿主） | `src/host/index.js` 约 1078–1251 | `buildSnapshot` 硬编码 GitHub |
| 读契约（后端） | `src/host/tracker/backends/markdown/path.js`, `issues.js#listIssues` | 扁平 `.scratch/map.md` 假设 |
| 探测兜底 | `src/host/tracker/backends/markdown/index.js#matches` | 无 map 时读 `docs/agents/issue-tracker.md` 含 Local Markdown 即判真 |
| 磁盘证据 | `D:/dsh-plugin/matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan/` | 五个 ticket 文件 + `map.md` |

---

## 引用清单

- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/shared/tracker/check-catalog.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/shared/tracker/chain.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/index.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/predicateRegistry.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/fixContract.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/index.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/parse.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/read.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/write.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/path.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/backends/markdown/issues.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/snapshot.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/registry.js`
- `D:/dsh-plugin/dsh-mattpocock-skills-deck/src/host/tracker/detection/detectionService.js`
- `C:/Users/辰辰洋洋/.agents/skills/setup-matt-pocock-skills/SKILL.md`
- `C:/Users/辰辰洋洋/.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md`
- `C:/Users/辰辰洋洋/.agents/skills/wayfinder/SKILL.md`
- `D:/dsh-plugin/matt-demo-markdown-test1/AGENTS.md`
- `D:/dsh-plugin/matt-demo-markdown-test1/docs/agents/issue-tracker.md`
- `D:/dsh-plugin/matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan/map.md`
- `D:/dsh-plugin/matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan/issues/01-research-promos.md`
- `D:/dsh-plugin/matt-demo-markdown-test1/.scratch/buy-luckin-coffee-plan/issues/02-research-stores.md`
