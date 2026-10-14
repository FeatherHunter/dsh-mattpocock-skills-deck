# #1136 对抗式审查·依赖图与机制核验（2026-10-14）

审查人：独立对抗式审查员（路线＝依赖图与机制核验）。只查事实，不做修复，不改源码。

底座：临时工作树 `D:\Temp\1136-graph`（钉在 `474602bd`＝今天的 `origin/main`），依赖用 junction 借主仓的 `node_modules`。所有引擎命令都用同一条：

```
node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs src/host src/shared src/seam src/deck \
  --config .dependency-cruiser.cjs --output-type json --no-progress
```

（根清单与门禁 `tests/verify-dependency-rules.ts:242-243` 的 `cruiseRoots()` 一致。）临时树里另有我写的四个计数脚本：`rule-hits.cjs`、`dedupe-hits.cjs`、`room-coverage.cjs`、`unresolvable-report.cjs`，以及模拟构建的 `make-artifacts.cjs`。

---

## 0. 一句话结论

`.dependency-cruiser.cjs` 里两条「后端房间纪律」规则（`cross-room-import`、`room-imports-third-party-package`）的起始判据停在 `^src/host/tracker/backends/`，而这个目录在 2026-10-13 的提交 `d0fdb277`（#1019 目录归位）里被搬到了 `src/tracker/rooms/`——那次提交改了 `tests/gate-map.json` 与 `tests/same-layer-baseline.json` 两份**记录**，唯独没碰规则文件。结果：这两条规则今天在图上命中 **0 个模块**、报 **0 条违规**，门禁照旧打印「房间纪律与禁循环零违规」。原 triage 的六条主张基本成立；但覆盖面比它说的更大：**只把指针改对会让门禁以 62～80 条「白名单缺口」的新红法整片红掉，而房间今天真正的跨房违规是 0 条**；另外 `src/tracker` 根本不在引擎的根清单里，房间的 `.js` 半边今天压根没进图。

---

## 1. 逐条核验原主张（表）

| # | 原主张 | 判定 | 一手证据 |
|---|---|---|---|
| 1 | `cross-room-import` 的 `from.path` 与同房间放行的 `pathNot` 都是死路径；磁盘上 `src/host/tracker/backends/` 不存在 | **成立** | `.dependency-cruiser.cjs:96` `from: { path: '^src/host/tracker/backends/(github\|gitlab\|markdown)/' }`；`:100` `pathNot: ['^src/host/tracker/backends/$1/'].concat(ROOM_WHITELIST)`。临时树 `Test-Path src\host\tracker\backends` → `False`，`Test-Path src\tracker\rooms` → `True` |
| 2 | `room-imports-third-party-package` 同样指向那个不存在的目录；`ROOM_WHITELIST` 还是搬家前的清单 | **半成立** | 前半成立：`.dependency-cruiser.cjs:109` `from: { path: '^src/host/tracker/backends/' }`。后半成立但结论要说全：`ROOM_WHITELIST`（`:34-42`）逐条等于旧门禁 `tests/verify-no-cross-import.js` 的 `WHITELIST_RE`（`git show 9c32032e^:tests/verify-no-cross-import.js` 读出同样 7 条，一字不差）。可它 7 条里 **2 条已经死了**（`^src/shared/labels\.js$` 文件没了；`^src/host/tracker/preflight\.js$` 现在是 `src/tracker/preflight.ts`），**剩下 5 条一条都没覆盖房间今天真正依赖的新去处**（`src/tracker/contract/`、`src/tracker/preflight.ts`、`src/tracker/detection/`、`src/host/outbound/`）。所以「搬家前的清单」的后果不是「只差指针」，而是「改了指针立刻多出 62～80 条红」（见 §2、§4） |
| 3 | 往 `src/tracker/rooms/github/index.ts` 加一行 `import '../gitlab/index.js'` 后门禁仍退出 0、打印「房间纪律与禁循环零违规」 | **成立** | 注入后 `node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts` → `exit=0`，末行 `引用方向门禁通过（同层 3 + 70 + 27 + 6 条存量已记名，房间纪律与禁循环零违规）`；同一棵树上引擎 JSON 里 `cross-room-import` 违规 **0** 条，而 `src/tracker/rooms/github/index.ts` 确实在图里（它出边 5 条）。**注意**：`tests/verify-dependency-rules.ts:637-640` 那句绿灯是写死的字符串，跟命中与否无关——这也是它能若无其事打印的原因 |
| 4 | 只把两条规则的 `from` 与 `pathNot` 指到 `^src/tracker/rooms/`（白名单一字不改），同一条边当场判红、退出 1；换成同房 `import './backend.js'` 不判红 | **成立，但代价被严重低估** | 只改指针（`config-fixed-from.cjs`，由 `make-fixed-config.cjs` 生成，白名单未动）：引擎报 `cross-room-import` **63** 条（注入的那 1 条 + 62 条白名单缺口）。门禁输出 `INFO 其中在存量豁免里放行 106 条，新增 63 条` → `门禁未通过：新增方向违规要先拆分消边，或按「只许减不许增」记进 tests/same-layer-baseline.json` → `exit=1`。同房那条边：把它换回 `import './backend.js'` 后仍是 62 条，注入的那条**没有**额外贡献违规 |
| 5 | `tests/verify-dependency-rules.ts` 只核对规则名字与 `severity === 'error'`，不核对「这条规则在图上有没有命中过任何模块」 | **成立（有一处近似例外）** | `:58` `const EXPECTED_RULES = [...]`（10 条）；`:546-554` 只比名字与 `r.severity !== 'error'`；`:637-640` 绿灯字符串写死。唯一的正面检查是 `:591-595` 的 `coreDependencyCount > 0`（`:504` 定义、`:538` 赋值），它数的是**全图 core 类依赖边的总数**，不是某条规则命中过模块 |
| 6 | `tests/gate-map.json`（含今天 HEAD）里没有任何 `tracker/backends` 字样；今天 `verify-gate-map.js` 的红来自别的来源 | **成立** | 临时树与主工作树里 `-Pattern "tracker/backends"` 命中 **0** 行；`-Pattern "backends"` 命中 2 行，是 `src/client/kernel/builtin-backends.js` 与 `BackendSelector.js`（`tests/gate-map.json:6033` 等），与追踪器无关。今天 `verify-gate-map.js` 的红确实是别的来源：`反向依赖 src/shared/refresh/budget.js 的那些门禁全被选中（该选 13 扇，漏 7 扇）`、`覆盖面记的文件数与磁盘上 src/ 的文件数一致（表里 534，磁盘上 462）`、`归属写成目录的门禁…漏掉的 56 个`（其中含 `src/tracker/rooms/gitlab/client.ts`） |

---

## 2. 全规则命中表（A）

数法：`node dedupe-hits.cjs <graph.json> <config.cjs>`——**先按 `source` 去重再数**（为什么必须去重见 §6.5：引擎的 JSON 输出里同一个 `source` 会出现两条）。图来自 §0 那条四根命令，未跑构建（＝今天检出的真实样子）。

| 规则名 | 起点判据（原文，`.dependency-cruiser.cjs`） | 命中模块数 | 违规数 | 判定 |
|---|---|---|---|---|
| `same-layer-import-platform` | `from.path: '^src/host/platform/'` | 7 | 3 | 有牙 |
| `same-layer-import-host` | `from.path: '^src/host/'`，`pathNot: ['^src/host/platform/','^src/host/tracker/backends/']` | 66 | 70 | 有牙（`pathNot` 里那半条已死，但删不删都不影响结果——`^src/host/` 本来就匹配不到已经不存在的目录） |
| `same-layer-import-shared` | `from.path: '^src/shared/'` | 59 | 27 | 有牙 |
| `same-layer-import-seam` | `from.path: '^src/seam/'` | 7 | 6 | 有牙 |
| `cross-room-import` | `from.path: '^src/host/tracker/backends/(github\|gitlab\|markdown)/'` | **0** | **0** | **空转**（起点路径在磁盘与图上都不存在） |
| `room-imports-third-party-package` | `from.path: '^src/host/tracker/backends/'` | **0** | **0** | **空转**（同因） |
| `deck-deep-import` | `from.path: '^(src/deck/\|src/host/tools/\|src/shared/deck-tools/)'`，`pathNot: DECK_DEEP_IMPORT_WHITELIST`（今天为空） | 37 | 0 | 有牙（命中 37 个模块、今天零违规，不算空转） |
| `deck-rules-stay-pure` | `from.path: '^src/deck/rules/'` | 9 | 0 | 同上 |
| `deck-rules-no-node-builtins` | `from.path: '^src/deck/rules/'` | 9 | 0 | 同上 |
| `circular-dependency` | `from: {}`（无起点判据，判据是全图的环） | 全图（364 个模块条目） | 0 | 有牙（今天 0 环，属「从零开始守」而不是「空转」） |

补充判据（不在表里但要一起看）：
- `deck-deep-import` 的 `to.path` 是 `'^(src/host/tracker/(backends|detection)/|src/tracker/rooms/)'`（`:144`），`backends` 那半也死了，但 `src/tracker/rooms/` 那半是活的——所以这条规则整体还有牙。
- `options`（`:214-222`）：`doNotFollow: { path: 'node_modules' }`、`tsPreCompilationDeps: true`、无 `exclude`。
- 结论：**整份配置 10 条规则里，只有那 2 条房间规则是真正意义上的空转**；其余 8 条在今天这棵树上都有起点命中（`circular-dependency` 的命中面是全图）。

---

## 3. git 考古（B）

**规则文件是谁写的、什么时候写的**：`git log --follow --oneline -- .dependency-cruiser.cjs` 只有 5 个提交，最早的是 2026-10-13 的 `9c32032e`（「门禁换轨：引用方向改读依赖图」）。它写规则时目录还是 `src/host/tracker/backends/`——配置里 `:127`、`:150` 的注释至今还在说「今天 src/host/tracker/backends/&lt;名字&gt;/，搬家后 src/tracker/rooms/&lt;名字&gt;/」，说明作者当时就知道要搬，但把「搬」留给了以后。

**谁删掉了那个目录**：`d0fdb277`（#1019 目录归位，2026-10-13，142 个文件）。它的父提交是 `95a1acfe`（`git rev-parse d0fdb277^` 实测等于 `95a1acfe`）。`git show --name-only d0fdb277 | Select-String "dependency-cruiser|same-layer-baseline|verify-dependency|gate-map"` 只回两行：`tests/gate-map.json` 与 `tests/same-layer-baseline.json`。**`.dependency-cruiser.cjs` 与任何 `verify-*` 都不在名单里**——搬了代码，两份记录跟上了，判据本身没跟上。这就是「规则指向不存在目录」的直接成因。

**搬家前 vs 搬家后（同一套数法，同一份配置）**：

| 时点 | 模块数 | `cross-room-import` 起点命中 | `cross-room-import` 违规 | `room-imports-third-party-package` 起点命中 | 后者违规 |
|---|---|---|---|---|---|
| `95a1acfe`（搬家前） | 292 | **63** | 0 | **63** | 12 |
| `474602bd`（今天） | 364 | **0** | 0 | **0** | 0 |

「搬家前有牙、搬家后没牙」这个说法**在起点命中这一层成立**（63 → 0）。但要把话说准，有两处必须限定：

1. 搬家前 `cross-room-import` 起点命中 63 个模块，**违规是 0**——它当时也没抓到任何真跨房引用。
2. 我在 `95a1acfe` 上做了一次反向验证：往 `src/host/tracker/backends/github/index.js` 顶层注入 `import '../../gitlab/index.js'`（当时两个房间都是 `.js`），引擎给出的边是
   `../../gitlab/index.js => resolved= ../../gitlab/index.js  couldNotResolve= true  types= ["unknown"]`
   ——**解析失败**，于是 `cross-room-import` 的 `to.path: '^src/'` 匹配不上，违规数仍是 **0**；这条边只被 `room-imports-third-party-package` 吃掉（12 → 13），因为它把 `unknown` 也算第三方。可证伪的对照是今天：今天两个房间的入口都是 `.ts`，同样一行 `import '../gitlab/index.js'` 能解析成 `src/tracker/rooms/gitlab/index.ts`，于是当场判红（63 条里的那 1 条）。
   所以「搬家前它有牙」这句话只在「起点路径对了、且目标是能解析的 `.ts`」时才成立；**对当时真实的 `.js` 房间，它同样是瞎的**，而且瞎法更隐蔽——违规会被错记成「第三方包」。

**门禁当时的颜色（一处需要更正的观察）**：在未跑构建的 `95a1acfe` 检出上跑 `node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts` → `exit=1`，`INFO 其中在存量豁免里放行 119 条，新增 12 条`，那 12 条全是上面说的 `unknown` 假红。我一开始把这个当成「搬家前门禁就已经是红的」，**这个结论要撤回**：CI 的步骤顺序是先构建、后门禁——`.github/workflows/verify.yml:59-60` `- name: Build artifacts (Gate I3)` / `run: node scripts/build.mjs`，`:63-64` 才是 `- name: Verify chain` / `run: node scripts/verify-all.mjs`；而 `package.json` 的 `verify` 那条链（238 步，`verify-dependency-rules.ts` 在第 92 步）**本身不含 `scripts/build.mjs`**（`v.includes('scripts/build.mjs') === false`）。产物在 CI 里是齐的，那 12 条 `unknown` 假红在 CI 里不该出现。**更正后的说法**：搬家前 CI 里门禁是绿的，而那次「绿」是靠一条起点命中 63 个模块、违规 0 条的规则换来的；搬家后门禁还是绿的，但那条规则的起点命中已经掉到 0。**绿灯的样子没变，守的东西没了**——这正是没人发现的原因。

---

## 4. 存量记名与图上覆盖（C/D）

### C. `tests/same-layer-baseline.json` 的「存量已记名」是怎么判的

- 判据在 `tests/verify-dependency-rules.ts:226-228`：
  `const key = String(v.from || '') + '|' + String(v.to || '')`；`const isSameLayer = name.startsWith(SAME_LAYER_RULE_PREFIX)`（`:70` `SAME_LAYER_RULE_PREFIX = 'same-layer-import-'`）；`if (isSameLayer && allowed.has(key)) tolerated.push(v)`。
- 也就是说：**键绑在图上解析出来的「引用方模块路径 | 被引模块路径」这一对字符串上**，跟 `.dependency-cruiser.cjs` 的白名单没有任何关系；而且**只有同层四条规则的违规有豁免通道**，房间纪律、第三方包、循环依赖一律直接判红（脚本 `:215` 的原话）。
- `:569` `if (!entries.length) fail('存量豁免清单是空的（空集合不许当成「没有违规」）')`——空清单本身判红，这条设计今天没被触发（清单 106 条，`:604` 打印放行 106 / 新增 0）。
- 清单自己的 `note` 也写着：「backends 三房间不在此清单（房间纪律由 .dependency-cruiser.cjs 的 cross-room-import 一条守着，没有豁免）」。

**把白名单重列之后会不会整体位移**：**不会**。同层四条的违规在改指针前后完全一致：改前 `3+70+27+6 = 106`，改后（`config-fixed-from.cjs` 跑同一棵树）仍是 `3+70+27+6 = 106`，`tolerated=106 / fresh=0`。原因是同层规则的起点都落在 `src/host`、`src/shared`、`src/seam` 上，与 `src/tracker/**` 无关。

**门禁会不会换一种红法**：**会，而且是修不好的那种**。修好指针后新增的 63 条 `cross-room-import` 违规，**一条都不能被存量清单吸收**（豁免只收 `same-layer-import-*`）。门禁给的建议原文是「或按『只许减不许增』记进 tests/same-layer-baseline.json」——这条建议对房间规则**根本不适用**，写进清单也不会生效。所以「重列白名单」这件事没有中间态：要么白名单一次补全，要么门禁整片红。

另外记一条事实（不是主张）：仓里这套手写的存量机制，引擎自己有原生版本——dependency-cruiser 18.6.0 提供 `--output-type baseline`、`baseline.mode: shrink-only | full | format`、`baseline.staleEntriesSeverity`（`node_modules/dependency-cruiser/src/report/baseline.mjs:27-45,74`，`node_modules/dependency-cruiser/types/options.d.mts` 的 `baseline` 段，`types/baseline-violations.d.mts`）。原生版能报「清单里有、这次不再违规」的 **stale entry**（`staleEntriesSeverity` 可设成 `error`），这正是本仓这套机制缺的那一半信号；但它是「违规条目的」陈旧信号，不是「规则判据本身死了」的信号（见 §5）。

### D. 图上覆盖

**门禁喂给引擎的根清单**（原文，带行号）：
- `tests/verify-dependency-rules.ts:44` `const SCAN_TREES = ['src/host', 'src/shared', 'src/seam']`
- `tests/verify-dependency-rules.ts:51` `const OPTIONAL_TREES = ['src/deck']`
- `tests/verify-dependency-rules.ts:242-243` `function cruiseRoots(): string[] { return SCAN_TREES.concat(OPTIONAL_TREES.filter((tree) => existsSync(join(ROOT, tree)))) }`
- `tests/verify-dependency-rules.ts:515-517` `spawn(..., [binAbs, ...cruiseRoots(), '--config', CONFIG_REL, '--output-type', 'json', '--no-progress'], ...)`
- **`src/tracker` 不在根清单里**，一个字都没有。

**今天 `src/tracker/rooms/**` 的进图情况**（`node room-coverage.cjs graph.json .`）：

```
{ "onDisk": 65, "inGraph": 56, "notInGraph": 9 }
```

没进图的 9 个：

```
src/tracker/rooms/gitlab/client.js
src/tracker/rooms/gitlab/create-write.js
src/tracker/rooms/gitlab/errors.js
src/tracker/rooms/gitlab/graph-blocking.js
src/tracker/rooms/gitlab/graph-membership.js
src/tracker/rooms/gitlab/idempotency.js
src/tracker/rooms/gitlab/normalize.js
src/tracker/rooms/gitlab/queries.js
src/tracker/rooms/markdown/normalize.ts
```

**为什么没进（实测出来的机制）**：被当依赖边扫到的 `.js` 文件**不会被继续跟进**。证据链：
- `src/tracker/rooms/gitlab/index.ts` 在图里，出边 5 条，都指向同房间的 `.js`（`./comments.js`、`./graph.js`、`./issues.js`、`./labels.js`、`./preflight.js`）；
- 这 5 个 `.js` 的模块条目都是 `followable: false`、出边 0——`graph.json` 里 `src/tracker/rooms/gitlab/comments.js` 就是 `{"followable":false,"dependencies":[]}`；
- 于是由这些 `.js` 再引出去的 8 个 gitlab 件（`client.js`、`errors.js`、`queries.js`…）永远进不了图；
- 反证：把这 5 个 `.js` 里任何一个**当根**单独跑，它立刻被跟进——`dependency-cruiser src/tracker/rooms/gitlab/comments.js` 得到 10 个模块（含 `client.js`、`errors.js`、`queries.js`、`contract/vocabulary.ts`、`preflight.ts`）；
- 同树的 `.ts` 不受影响：`src/tracker/rooms/github/backend.ts` 出边 17 条、`markdown/index.ts` 出边 14 条。
- 全图口径：364 个模块条目里 **109 个 `followable: false`**（含 Node 内置模块与 70 条解析不到的边）。**成因我没有坐实**（见 §6.4），能坐实的是「与所在目录是不是扫描根强相关」这个经验规律。

**补 `src/tracker` 为根会带来什么**（在「跑过构建、`from` 已指对」的树上实测，`graph-tracker-fixed3.json`）：

| 指标 | 四根（今天） | 五根（补 `src/tracker`） |
|---|---|---|
| `cross-room` 起点命中 | 56 | **65** |
| `cross-room-import` 违规 | 62 | **80** |
| `room-imports-third-party-package` 违规 | 0 | **0**（补 `src/shared/refresh/create-write.js` 产物前是 1，那 1 条也是假红） |
| 同层四条违规 | 106 | **106（不变）** |
| 环 | 0 | **0** |
| 违规合计 | 62 | **186** |
| 模块（数组条数 / 去重后） | 389 / 301 | 412 / 316 |

80 条 `cross-room-import` 按目标分组（`from` 涉及 45 个房间文件）：

```
src/tracker/contract/*   48
src/tracker/preflight.ts 26
src/host/outbound/*       2
src/host/refresh/*        1
src/tracker/detection/*   1
src/tracker/error-rules.ts      1
src/tracker/identity-keys.ts    1
```

**房间与房间之间的边：0 条。** 结论很硬：改对指针 + 补根之后，房间纪律今天能报出的 80 条里，**没有一条是真的跨房违规**，全部是「白名单没跟上搬家」的缺口；那 62 条（不补根时）同理。另外补根没有引入新环，也没有影响 `deck-*` 三条（起点不在这棵树里）。

---

## 5. 引擎有没有「规则一条都没命中」的内置信号（E）

**读的是哪个版本、哪些文件**：`node_modules/dependency-cruiser/package.json` 的 `"version": "18.6.0"`。读过：
- `src/analyze/summarize/index.mjs:182` — `...(pOptions.ruleSet ? { ruleSetUsed: addRuleSetUsed(pOptions) } : {})`
- `src/report/error.mjs:216`、`src/report/error-html/index.mjs:61`、`src/report/markdown.mjs:99`、`src/report/teamcity.mjs:265` — `ruleSetUsed` 的全部消费点
- `src/schema/cruise-result.validate.mjs:1` — `ruleSetUsed` 的形状定义
- `src/report/baseline.mjs`、`types/options.d.mts`、`types/baseline-violations.d.mts`
- `src/configs/rules/*.cjs`（内置规则集，含 `not-to-unresolvable.cjs`、`no-orphans.cjs`）
- `src/extract/resolve/module-classifiers.mjs:56-95`、`src/extract/resolve/resolve-cjs.mjs:7-57`、`src/extract/extract-dependencies.mjs:111`、`src/extract/index.mjs:48-117`（为查 §6.4 的机制而读）

**结论：没有这种内置信号。** `summary.ruleSetUsed.forbidden` 只是把配置里的规则原样抄一遍（`name` / `severity` / `comment`），引擎**不统计每条规则命中过多少模块**；`addRuleSetUsed(pOptions)` 是从 **options** 里取规则，不是从分析结果里取的。所以「这条规则报 0 条违规」与「这条规则的判据写死了」在引擎输出上完全同形，四个 reporter 拿 `ruleSetUsed` 也只是为了渲染/解释。

**别混进来的两个「有信号」的东西**：
1. **原生 baseline**（`--output-type baseline`、`baseline.mode: shrink-only|full|format`、`baseline.staleEntriesSeverity`，`src/report/baseline.mjs`）：它能报「清单里有、这次不再违规」的 stale entry，`staleEntriesSeverity: 'error'` 时会让退出码非零。但这是**违规条目**的陈旧信号——而 `cross-room-import` 根本没有豁免清单（`tests/same-layer-baseline.json` 的 `note` 明说「backends 三房间不在此清单」），所以没有任何条目会变 stale，这条信号对本案无效。
2. **内置规则**：`src/configs/rules/not-to-unresolvable.cjs` 恰好吃那 70 条 `couldNotResolve` 的边（今天未启用）；`no-orphans.cjs` 管孤儿模块。

**所以原 triage 想加的防复发判据不是重造轮子**：仓库得自己判「这条规则的起点在图上命中过模块没有」。成本很低——临时树里的 `dedupe-hits.cjs` 是 40 行。

---

## 6. 对抗面：我会错在哪

### 6.1 「环境造成的红」到底影响哪些规则、几条（这是本节最该先看的一条）

做法：临时树里用 `make-artifacts.cjs` 按 `src/shared/<域>/src/<名>.ts` 真源，把图上解析不到的产物路径逐个造出来（**29 个文件，模拟「跑过构建」**）。

| 口径 | 解析不到的边 | 模块（数组/去重） | 同层四条 | `cross-room-import` | `room-imports-third-party-package` |
|---|---|---|---|---|---|
| 未跑构建 | **70** | 364 / 305 | 106 | 0 | 0 |
| 模拟构建后 | **3** | 389 / 301 | 106 | 0 | 0 |
| 未跑构建 + `from` 指对 | 70 | 364 / 305 | 106 | 63（含注入的 1 条） | **9** |
| 模拟构建 + `from` 指对 | **3** | 389 / 301 | 106 | 62 | **0** |

那 70 条解析不到的边分三类（`node unresolvable-report.cjs graph.json .`）：**67 条**指向 `src/shared/<域>/<名>.js`（真源 `src/shared/<域>/src/<名>.ts` 在，纯粹是「没跑构建」），**3 条**是 `src/host/logFromPackage.js -> dsh-log/host`、`src/host/pickerShell.js -> electron`、`src/host/updateFromPackage.js -> dsh-plugin-update`（本环境没装/是宿主注入，与构建无关）。

**结论（请与「规则本身的病」分开看）**：
- 全部 10 条规则里，**只有 `room-imports-third-party-package` 会吃到这类假红**——因为只有它的 `to` 判据里带 `unknown` / `undetermined`（`:111-121`）。未跑构建时它会把 9 条正常的房外引用报成「引了第三方包」，跑过构建后归零。
- `cross-room-import` **完全不吃这个干扰**（它的 `to` 是 `path: '^src/'`，只看路径、不看依赖类型）：未构建 62 条 → 构建后仍是 62 条。
- 同层四条也不吃：构建前后都是 `3+70+27+6`。（它们虽然也大量命中「未解析的产物路径」，但那些边在两种口径下都在，数量不变。）
- 一个反过来的坑：这些假红的**存在与否取决于跑没跑构建**，而 CI 是「先构建后门禁」（`verify.yml:59-64`），本地人是「直接跑门禁」。所以同一条规则在两种环境下能给出 0 与 9 两个数——这也是 §3 里我一度把「搬家前门禁是红的」判错的原因。

### 6.2 如果我判「两条规则空转」判错了，最可能错在哪

最可能错在**「命中 0」是用法问题而不是配置问题**：如果门禁不是用 `cruiseRoots()` 那四个根、而是别处（比如 `verify-parallel.mjs` 或某个只看 `--config` 的入口）跑引擎，根清单可能不同。证伪实验：`Select-String -Path tests\verify-dependency-rules.ts -Pattern "cruiseRoots|SCAN_TREES"` —— 若除了 `:44/:51/:242/:515` 之外还有第二处拼根清单的地方，我的结论要重算。我实测过的是 `:515-517` 那一处（它也是 `spawn` 的唯一出口）。

### 6.3 关于「搬家前有牙」，我差点判错两次

- 第一次错在把「未跑构建导致的 12 条假红」当成了「搬家前门禁本来就红」。更正依据是 CI 步骤顺序（`verify.yml:59-64` 先 `node scripts/build.mjs` 再 `node scripts/verify-all.mjs`）。证伪实验：在 `95a1acfe` 上先跑 `node scripts/build.mjs`、再跑 `node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts`，若仍报 12 条 `room-imports-third-party-package`，则我的更正站不住。
- 第二次错在只凭「起点命中 63 个模块」就推断它有牙。实际注入真跨房引用（两条 `.js` 房间之间）后，那条边**解析失败**，规则报 0——所以我把它降级成「起点路径对了，但对 `.js`→`.js` 的跨房边仍然看不见」。证伪实验（我已跑过一遍，可复现）：在 `95a1acfe` 的 `src/host/tracker/backends/github/index.js` 顶层加 `import '../../gitlab/index.js'`，跑引擎，看 `cross-room-import` 是否仍为 0、`room-imports-third-party-package` 是否 12→13。

### 6.4 9 个房间文件没进图：机制我只坐实了一半

我能坐实的是「被当依赖扫到的 `.js` 不被跟进」这个**经验规律**（证据见 §4.D）。我**没能**在引擎源码里指出决定这件事的那一行：`src/extract/resolve/module-classifiers.mjs:91-95` 的 `isFollowable` 只看扩展名在不在 `resolveOptions.extensions` 里，理论上 `.js` 该在；`resolve-cjs.mjs:45-49` 的默认值是 `followable: false`，只有走完 `addResolutionAttributes` 才会被覆盖成真值。所以真正的原因可能是「`.js` 说明符在解析时走了另一条路径」，但我没查到那一步。**证伪实验**：把 `src/tracker/rooms/gitlab/comments.js` 原样复制到 `src/host/` 下（`src/host` 是扫描根）并让同目录一个 `.ts` 引它，若它在图里变成有出边、且另外 8 个件随之进图，则「与是否落在扫描根内有关」成立、与扩展名无关；若它照样是 `followable:false`，我的解释就是错的，得改成「`.js` 一律不跟进，今天有出边的那些 `.js` 是因为它们是根文件」。

### 6.5 我的数字口径与别人可能对不上：模块表要先按 `source` 去重

引擎 `--output-type json` 的 `modules` 数组里，**同一个 `source` 会出现两条**（实测：未构建 364 条 / 305 个不同 source；模拟构建 389 / 301；补根 412 / 316）。不去重会把起点命中数抬高一大截：`same-layer-import-host` 102 → **66**、`same-layer-import-shared` 77 → **59**、`same-layer-import-platform` 8 → **7**、`same-layer-import-seam` 11 → **7**。§2 的表全部是去重后的数。若有人用不去重的口径复核，两边会差在这里，不是差在规则上。违规数不受影响（引擎自己的 `summary.violations` 是权威值，构建前后都是 106）。

### 6.6 我这次没做、也可能改变结论的事

- **没在临时树里跑一次真构建**（`node scripts/build.mjs`）：产物集合是用 `make-artifacts.cjs` 按需生成的（29 个 + 补根后追加 1 个）。真构建可能产出更多文件，从而把某些 `unknown` 边变成能解析的边。不过 `cross-room-import` 与同层四条的数字在两种口径下都没变，所以主结论不受影响；**受影响的只有第三方包那一条**。
- **没验 `src/tracker/rooms/markdown/normalize.ts` 为什么也没进图**：它不是 `.js`，按理不该被 §4.D 的规律解释。可能是今天没有任何在图的文件引它（它成不了链上的一环），也可能是别的原因。我判「未解」。
- **没跑 `verify-gate-map.js` 的全部失败明细**：§1 第 6 条引的三条失败是摘要行，够用来说明「今天的红与 `tracker/backends` 无关」，但没有逐条展开。

---

## 7. 对决议的建议（只写本路该管的部分）

1. **两条房间规则的起点必须改**（`from` 与 `to.pathNot` 里那两处 `^src/host/tracker/backends/` 都要改成 `^src/tracker/rooms/`）。这是纯 bug 修复，不涉及任何架构取舍；判据跟着目录走，`9c32032e` 写规则时就该一起改，`d0fdb277` 搬家时必须一起改。
2. **改指针不能单独发**。白名单要在同一票里一次补齐，至少覆盖实测出来的 7 类目标：`^src/tracker/contract/`、`^src/tracker/preflight\.ts$`、`^src/tracker/detection/`、`^src/host/outbound/`、`^src/host/refresh/`、`^src/tracker/error-rules\.ts$`、`^src/tracker/identity-keys\.ts$`；同时把两条已死条目（`^src/shared/labels\.js$`、`^src/host/tracker/preflight\.js$`）换成它们在今天树上的落点。只改指针 = 62～80 条新红，而门禁对房间规则**没有任何豁免通道**（§4.C 实测 exit 1），等于把门禁改成常红。
3. **`src/tracker` 要进根清单**。不进根，房间的 `.js` 半边永远不在图上（§4.D：65 个文件只进 56 个），这两条规则即使指针改对也只看得见 `.ts` 那一半。这是 `9c32032e`「换判据读取对象」那次换轨漏掉的另一半——当时的四棵树是照着老门禁的扫描范围写的，而 #1019 之后 `src/tracker/**` 已经是规则要管的重点区域。
4. **加一条「判据零命中就判红」的自检**：在 `tests/verify-dependency-rules.ts` 里，对每条 `forbidden` 规则断言其 `from.path` 在图上至少命中 1 个模块（`circular-dependency` 的 `from` 是空的，按无起点判据豁免）。引擎没有这个信号（§5），所以这不是重造轮子；实现成本约 40 行（参照临时树里的 `dedupe-hits.cjs`，注意先按 `source` 去重）。这一条才是 #1136 真正要防的复发。
5. **报「房间纪律零违规」时把分母一起报出来**。今天 `tests/verify-dependency-rules.ts:637-640` 那句是写死的字符串；改成「房间纪律：命中 N 个房间模块、违规 0 条」之后，「N=0」一眼就能看出问题。这比新增自检更便宜，也更难被绕过。
6. **别把两件事混成一件**：`tests/gate-map.json` 今天的红（`src/shared/refresh/budget.js` 的扇出漏选、534 vs 462、目录归属漏 56 个）与本次房间纪律无关；`d0fdb277` 确实同步改过 gate-map，但那是另一条线的问题。
7. **顺带记一笔、不建议在本票做**：`room-imports-third-party-package` 把 `unknown` / `undetermined` 当「第三方包」，所以「没跑构建」时它会把正常的房外引用报成引了第三方包（实测 9 条）。这是一个独立的判据口径问题，修不修要单独决定；本票只要知道「这条规则的假红来源是构建产物，不是真的引了包」。

---

## 8. 未解问题

1. 引擎里决定「被当依赖扫到的 `.js` 不跟进」的确切那一行没找到（候选与证伪实验见 §6.4）；只坐实了经验规律。
2. `src/tracker/rooms/markdown/normalize.ts` 为什么也没进图，单独没解释（它不是 `.js`）。
3. 真构建（`node scripts/build.mjs`）的产物集合没实测，只用模拟产物代替（影响面见 §6.6）。
4. `95a1acfe` 上「先构建后门禁」的完整复现没跑（只从 CI 配置与 `package.json` 的链推断）。
5. 补根之后 `deck-deep-import` 等三条规则的命中面我没重新逐条核对（只确认违规数没变）。

---

## 附：读过的一手材料清单

**仓库文件**
- `.dependency-cruiser.cjs`（全文 223 行）：`:31-42` `ROOM_WHITELIST`、`:44-46` `DECK_DEEP_IMPORT_WHITELIST`、`:53-86` 四条同层规则、`:89-123` 两条房间规则、`:134-145` `deck-deep-import`、`:147-152` 「反方向那条今天先不上」的理由、`:166-200` 两条纯规则侧规则、`:202-211` `circular-dependency`、`:214-222` `options`
- `tests/verify-dependency-rules.ts`：`:19` 存量豁免说明、`:32-33` 「本文件读的 .dependency-cruiser.cjs 与 tests/same-layer-baseline.json 会被它算成归属依据」、`:44` `SCAN_TREES`、`:51` `OPTIONAL_TREES`、`:58` `EXPECTED_RULES`、`:70` `SAME_LAYER_RULE_PREFIX`、`:215-216` 豁免只收同层、`:226-228` 键与容忍、`:242-243` `cruiseRoots()`、`:249`/`:278` 用根清单的地方、`:504`/`:538` `coreDependencyCount`、`:515-517` `spawn` 引擎、`:546-554` 规则名与 severity 检查、`:556-572` 存量清单读取（`:569` 空清单判红）、`:591-595` core 依赖计数检查、`:604` 放行/新增打印、`:637-640` 写死的绿灯字符串
- `tests/same-layer-baseline.json`：`note`（含「backends 三房间不在此清单」「2026-10-13（#1019 目录归位）：键跟着搬家表换到新路径」）、106 条 `entries`（键形如 `src/host/versionControl.js|src/host/versionControlFiles.js`）
- `tests/gate-map.json`：`tracker/backends` 0 行；`backends` 2 行（`builtin-backends.js`、`BackendSelector.js`）
- `tests/verify-gate-map.js`、`scripts/gate-map.mjs`（今天的失败摘要来自它们）
- `package.json`：`build = node scripts/build.mjs`、`test = npm run typecheck && node scripts/build.mjs && node scripts/verify-chain.js && npm run test:smoke`、`verify`（238 步，第 92 步是 `tests/verify-dependency-rules.ts`，链里 `includes('scripts/build.mjs') === false`）
- `.github/workflows/verify.yml`：`:59-60` `Build artifacts (Gate I3)` → `node scripts/build.mjs`、`:63-64` `Verify chain` → `node scripts/verify-all.mjs`
- `scripts/verify-all.mjs`、`scripts/verify-chain.js`（步骤顺序）
- `AGENTS.md`（「测试怎么直接加载 .ts」一节，含 `module.registerHooks()` 与 Node 下限口径）

**git**
- `git log --follow --oneline -- .dependency-cruiser.cjs`（5 个提交，最早 `9c32032e`）
- `git show --stat --oneline d0fdb277`（142 个文件）、`git show --name-only --format="" d0fdb277`（只回 `tests/gate-map.json`、`tests/same-layer-baseline.json` 两行相关）
- `git rev-parse d0fdb277^` → `95a1acfe`；`git merge-base --is-ancestor 9c32032e d0fdb277` → 是祖先
- `git show 9c32032e^:tests/verify-no-cross-import.js`（老门禁的 `WHITELIST_RE` 7 条）
- `git ls-files src/tracker/rooms/gitlab`（13 个 `.js` + 1 个 `index.ts`）

**引擎（dependency-cruiser 18.6.0）**
- `package.json`（版本）、`src/analyze/summarize/index.mjs:182`、`src/report/{error.mjs:216, error-html/index.mjs:61, markdown.mjs:99, teamcity.mjs:265}`、`src/schema/cruise-result.validate.mjs`、`src/report/baseline.mjs:27-45,70-74`、`types/options.d.mts`、`types/baseline-violations.d.mts`、`src/configs/rules/*.cjs`、`src/extract/resolve/module-classifiers.mjs:56-95`、`src/extract/resolve/resolve-cjs.mjs:7-57`、`src/extract/extract-dependencies.mjs:111`、`src/extract/index.mjs:48-117`

**临时树里我写的脚本（都在 `D:\Temp\1136-graph`）**
- `rule-hits.cjs`：按配置里每条规则的正则数「起点命中几个模块 / 图上几条违规」
- `dedupe-hits.cjs`：同上但先按 `source` 去重（§2 的表用它）
- `room-coverage.cjs`：数 `src/tracker/rooms/**` 有多少源码文件进了图
- `unresolvable-report.cjs`：把解析不到的边分类（产物路径 / 路径本身坏了 / 其它）
- `make-artifacts.cjs`：按 `src/shared/<域>/src/<名>.ts` 生成产物 `.js`，模拟「跑过构建」
- `make-fixed-config.cjs`：由 `.dependency-cruiser.cjs` 生成「只把两条房间规则的起点指到 `^src/tracker/rooms/`」的 `config-fixed-from.cjs`（白名单未动）
- 图快照：`graph.json`（四根·未构建）、`graph-built.json`（四根·模拟构建）、`graph3/4/5.json`（改指针的三次）、`graph-tracker.json`（补根）、`graph-tracker-fixed{,2,3}.json`（补根+改指针）、`graph-before.json` 与 `graph-before-inject{,2}.json`（`95a1acfe` 三个口径）
