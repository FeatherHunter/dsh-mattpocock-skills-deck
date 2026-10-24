# 第三方 Tracker 扩展指南（Third-Party Tracker Guide）

> 面向：**外部第三方**（不在 `src/tracker/rooms` 内，类似 Jira/Linear/Gitea/自建工具）与**内部新后端作者**（复用同一 TOC）。契约已全部定版（#125），本指南只教“怎么照抄 demo 扩展”，**不新增契约条款**（改契约归 `tracker-backend-design-contract.md` §1-8 + 契约修订流程，开票挂 #111）。2026-10-23 起（规格 #1439、收口 #1448）「接入完成」由四件变五件：每个后端还要交一份**预算声明**并实现**额度读数**，见 §3.1。

> 定版锚点：#147 7 行（demo-mini + `examples/demo-mini/` + 4 ops + 强验证 + 本文件）+ #125 V4（BackendModule 四件套 + Proxy 自动桩 + 三级联三态）+ #1439/#1448（BackendModule 扩成五件套：加必填的预算声明；能力名录 25→26，第 26 条是 readBudget）+ 设计契约 §2（capability-by-fill）§4（cut 线）。

---

## 1. 你将得到什么（demo 形态 + 能力诚实上报 + UI 零改动链）

- **demo 后端是“证明接口可被外部实现”的钥匙**：`examples/demo-mini/`（不默认装配、不进 `src/tracker/rooms/`，零发包） + `fixtures/demo-real/`（离线采样固件，可 `runPlayback`）。
- **能力诚实上报**：demo 只实现真会的 4 ops（`list/get/create/getDependencies`），余下 9 ops 由 `src/tracker/registry/shape.ts:wrapTracker` Proxy 自动补 `unsupported` 桩（准入墙消失，无需手写 capabilities 表）。
- **UI 零改动链**：`registry.describe(handle, backendId) → Selection.ref → snapshot.composeSnapshot → UI labelOf/backendIcon`（未知 `backendId` 原串展示，不分支），见 `src/tracker/registry/views.ts:20-62` / `src/shared/tracker/shape.js:165-169` / `src/tracker/contract/vocabulary.ts:BACKEND_KIND`。

以本文为线索，可在仓库内找到每处实现（见各节末“定位”）。

---

## 2. 五分钟接入（`examples/demo-mini` 一行注册）

### Host 侧同步 API（当前可用）

```js
import { demoModule } from '../examples/demo-mini/index.js'
import { createRegistry } from '../src/tracker/registry/core.js'
import { createPlatform } from '../src/host/platform/index.js'

// host 单例（#113 平台抽象层：platform 已注 env/homedir，fs 来自 DSH dsh-fs-sandbox）
const platform = await createPlatform(hostCtx)
const backendCtx = { platform, fs: platform.fs, exec, timers: { setTimeout, clearTimeout }, log }
const registry = createRegistry(backendCtx) // 选后端的兜底等待走缺省值：30 秒（src/tracker/registry/core.ts 的 MATCHES_TIMEOUT_MS，#1109）

// 注册（同步、无副作用；重复 id 默认抛 duplicate-id；HMR 用 {replace:true}）
const disp = registry.register(demoModule) // demoModule = { id:'demo-mini', label:'Demo Mini', create, matches }

// 生存期：按代隔离（旧代 dispose 不误杀新代，见 src/tracker/registry/core.ts:109-117）
// DSH 插件形态：
// export async function apply(ctx) {
//   const registry = ctx.get('trackerRegistry') // God-split 轮补线：host 暴露单例（T-146-01）
//   const d = registry.register(demoModule)
//   ctx.effect(() => d.dispose()) // fiber dispose 时自动 unregister + stale bind 回退
// }
```

### DSH 插件 manifest 形态（预留，与 DSH 官方约束对齐）

```json
// package.json（DSH loader 当前只认 dsh.contributes，见 #125 Notes）
{
  "dsh": {
    "contributes": {
      "trackers": [{ "id": "acme.demo", "module": "./lib/tracker.js" }]
    }
  }
}
```

对外占位 `id` 推荐 `publisher.name`（如 `acme.demo`），demo 对外即 `acme.demo`（`examples/demo-mini/index.js:demoModuleAcme`）。

定位：`examples/demo-mini/index.js`（接入样板）/ `src/tracker/registry/core.ts:98-118`（register）/ `src/host/platform/index.js`（平台）。

---

## 3. BackendModule 五件套（`id/label/create/matches/budget`）+ 生存期

```ts
interface BackendModule {
  id: BackendId        // 唯一、开放 string（推荐 publisher.name）；内置 github/markdown/gitlab；'other' 禁注册
  label: string        // 显示名（UI 已知→徽标，未知→原串，不分支）
  create(ctx: BackendContext): Partial<Tracker> // 只实现真会的；缺的由 Proxy 补 unsupported 桩
  matches(handle: RepoHandle, ctx: OpContext): boolean // 启发式 boolean，不伪造身份
  budget: BackendBudgetModel // 必填（#1439 起）：额度口径声明，缺了注册表拒绝；形状真源 src/tracker/contract/budget-model.ts
}

interface BackendBudgetModel { // 四个字段缺一个就注册失败，含义与样例见 §3.1
  kind: 'two-buckets' | 'requests-only' | 'off-network' | 'unknown'
  countsRequests: boolean
  countsPoints: boolean
  independentBuckets: boolean
}
interface BackendContext { platform: Platform; fs: SandboxFS; exec; timers; log } // create 用（进程级能力）
interface OpContext extends BackendContext { cwd: string; signal: AbortSignal; refId?: string } // matches/detect/op/select 用
```

- **注册护栏**：同步校验形状五件，不因缺 op 拒绝；缺 `budget` 声明或形状不对当场拒绝（报错原文见 §3.1）；`'other'` 抛 `other-not-registrable`；`duplicate-id` 需 `{replace:true}`（HMR），见 `src/tracker/registry/shape.ts:99-108` 与 `src/tracker/registry/core.ts:100-103`。
- **Proxy**：`Partial<Tracker>` 缺方法→ `unsupportedStub(op, backendId)`（`{ok:false, error:{kind:'unsupported'}}`，返回不抛），Harness 即以此判断“缺能力”（G5 不分支），见 `src/tracker/registry/shape.ts:63-96`。
- **Disposable/on/describe/MIGRATE_KEY**：
  - `register` 返 `{dispose}`，按代隔离（`byId.get(id) !== entry` 则旧代不删新代），见 `src/tracker/registry/core.ts:109-117` 测试 `sections/registry.js:108-116`。
  - `on('register'|'unregister'|'bind', fn): () => void`，抛错隔离，`unregister` 的 stale 负载携**真实 handle**（非字符串 key），见 `src/tracker/registry/core.ts:89-93,222-227`。
  - `describe(handle, backendId): RepositoryRef`（骨架：`refId = handle.refId || (markdown?cwd:'')`，`name = refId||cwd||backendId`，`url=''`），不覆写即归一，见 `src/tracker/registry/views.ts:20-62`。
  - `MIGRATE_KEY = {other:null}` 先落地，旧 `'other'` 缓存双读归客户端（#113/#114），见 `src/tracker/registry/shape.ts:20`。

校验两级（#125）：①注册时只验模块形状；②`verifyBackend` 异步验归一化纪律（有数据→必映射，无数据→必 `[]/''/null` 或省略），不验 op 支持。

### 3.1 预算声明与额度读数（#1439 起必交）

2026-10-23 起（规格 #1439，收口 #1448），「接入完成」从四件变成五件：除了适配器代码、采样固件、生成脚本、门禁集成，还要交**预算声明**并实现**额度读数**。原因是闸与账本从「调用方各自记录 GitHub 两个桶」改成「操作管线按后端自己声明的额度模型记账」：后端不声明，管线就无法判断这次调用该不该拦、该记到哪本账上。

**最小预算声明**（每个后端都必须有，四个字段缺一不可）：

```ts
export const myBudget = {
  kind: 'requests-only',    // two-buckets | requests-only | off-network | unknown 四选一
  countsRequests: true,     // 请求数进不进账本，必须明说
  countsPoints: false,      // 点数进不进账本，必须明说
  independentBuckets: false // 只有「两个桶各自独立」的后端才写 true
}
```

- 四个 `kind` 的意思：`two-buckets` 是请求数与点数分两个独立桶（GitHub）；`requests-only` 只有一个按次数计的额度（GitLab）；`off-network` 是本地或离网后端，不需要额度（Markdown、示例 demo-mini）；`unknown` 是暂时说不清，账本只记发出去的请求数——不要拿它掩盖一个其实知道的口径。
- 形状真源是 `src/tracker/contract/budget-model.ts`，校验在 `src/tracker/registry/shape.ts:121,146`。缺声明或形状不对，注册当场失败，报错点名缺哪一格，原文形如：`BackendModule 'my-backend' budget invalid: budget 必须是一个对象（后端模块缺预算声明）`。
- 不要按 `backendId` 写等值分支：闸和账本只读声明，静态门禁会拦住「按后端编号写死」的写法。
- 三个内置后端今天的声明：GitHub 两个独立桶、GitLab 只计请求数、Markdown 离网，分别住在各自房间的 `index.ts` 的 `budget` 字段；示例 `examples/demo-mini/index.ts` 也带了一份离网声明，可直接照抄结构。

**额度读数 `readBudget`**（能力名录第 26 条，操作名录第 23 条）：

它只回答「现在还剩多少」，不裁决（不决定这次调用放不放行）、不记账、不抛。返回值沿用 `OpResult`：成功信封是 `{ ok: true, data: ... }`，字段名是 `data`，不是 `reading`。四种读数都必须诚实：

```ts
// 读到两个独立桶（GitHub）
{ ok: true, data: { known: true, kind: 'two-buckets', buckets: { rest: { limit, remaining }, graphql: { limit, remaining } } } }
// 读到一个请求桶（GitLab）
{ ok: true, data: { known: true, kind: 'requests-only', requests: { limit, remaining } } }
// 离网后端（Markdown）
{ ok: true, data: { known: true, kind: 'off-network' } }
// 读不到：必须带原因，绝不拿 0 冒充
{ ok: true, data: { known: false, reason: 'not-measured' | 'unavailable' | 'unsupported' } }
```

- 三个 `reason` 的分工：`not-measured` 是还没测到（例如命令不在本机）；`unavailable` 是测到了但这次取不到（鉴权失败、网络错误、解析失败、响应头缺数）；`unsupported` 是这个后端根本没有这项能力。
- 参考实现：GitHub 在 `src/tracker/rooms/github/budget.ts`（REST 与 GraphQL 两个桶）、GitLab 在 `src/tracker/rooms/gitlab/budget.ts`（读 `RateLimit-Limit` / `RateLimit-Remaining` 响应头）、Markdown 在 `src/tracker/rooms/markdown/budget.ts`（恒离网）。
- 参考测试：`tests/verify-tracker-session.ts`（三态与不裁决不记账）、`tests/verify-1443-github-readbudget.ts`（gh 缺失、未登录、网络失败都回未知并带原因，不回 0）、`tests/verify-1446-gitlab-budget.ts`、`tests/verify-1447-gitlab-e2e.ts`（真房间 + 假 glab，不联网）。
- 这条对第三方后端是**破坏性变更**：不交 `budget` 的模块以前能注册，今天注册直接失败。发布说明里已写明；第三方按本节补一份声明即可，操作实现本身不用改。

---

## 4. 探测规则（`matches:boolean` + `select` 三级联 + `multiHit/pending`）

- **matches 语义**：`matches(handle, ctx): boolean`，只读 `cwd/fs`（经 `platform`），不确定一律 `false` + 记 `diagnostics`（由调用方日志），不伪造身份。demo 实现：`platform.fs` 探 `cwd/.demo/config.json` **或** `.scratch/map.md` 存在性（`lstat/stat/readText` 任一成功即命中），`signal.aborted` 时早退，见 `examples/demo-mini/matches.js`。
- **select 三级联三态**（`src/tracker/registry/core.ts:142-191`）：
  1. `explicit(bound)`：`bind(handle, backendId|null)` 记忆（`backendId:null` = 显式无后端，`ref` 省略，不造假身份）。
  2. `matches`：并行 `allSettled` + 超时 `matchesTimeout`（默认 30 秒，可配；这一个数只有一个出处——`src/tracker/registry/core.ts` 的 `MATCHES_TIMEOUT_MS`，生产装配路径不许自带等待值）+ `AbortSignal`（超时同时 `controller.abort()` 传 `signal` 给 `matches`）；`boolean`；平局=`注册序`（Map 迭代序，`replace` 保持键位），暴露 `multiHit: BackendId[]` 供 `bind` 显式纠正。
  3. `fallback(unbound)`：仅当“无 explicit、无 `match===true`、无 `pending`”才 `backendId:null`（`ref` 省略）；**有 `pending:true` 则 surface 等待态，不静默 OtherCard**（UI 必须提示“等待/建议显式 bind”）。
  - `Selection = { backendId: BackendId|null, source: 'explicit'|'matches'|'fallback', ref?: RepositoryRef, multiHit?: BackendId[], pending?: true }`，`source` 无 `'detect'`（已改 `'matches'`），见 `src/tracker/contract/index.ts:141-147`。
- **错误码**：`duplicate-id` / `other-not-registrable` / `unknown-backend`（`bind` 未注册 id）/ `bad-handle`（handle 缺 `cwd/refId`），见 `src/tracker/registry/shape.ts:TrackerRegistryError`。

边界（与 harness 对齐）：`matches` 抛错→`false`；超时→`{timedOut:true}` 排除出决策集（`pending:true`）；`'other'` 不注册；`Selection.backendId:null` 时 `ref` 省略。

---

## 5. 能力语义（capability-by-fill：`EMPTY []/''/null` vs `MISSING 省略`）

- **完整数据形状**（`shared/tracker/shape.js`）：核心字段（`key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey`）**永远存在**（来源给不了→`''/null` 补齐）；能力字段（`author/assignees/labels/milestone/customFields/reason/blockedBy/comments`）可 `MISSING`。
- **EMPTY vs MISSING**：能实现但本条无内容 → `EMPTY`（属性存在且 `isEmpty([]/''/null)`）；不能实现 → `MISSING`（省略该字段，`hasField` 为 false）。**能力 = 事后事实**，无能力表、无线能力缓存、无运行期内省（G5 红线），见 `capability.js:diagnoseCapabilities/hasField/isEmpty`。
- **demo 的字段分工**（与 `tests/tracker-contract/fixtures/demo.js` 对齐）：
  - `implementedFields: ['labels','assignees','comments','blockedBy','reason']` → `EMPTY`（`[]/''`）。
  - `missingFields: ['author','milestone','customFields']` → `MISSING`（省略）。
- **诊断二分**：`diagnoseCapabilities(issue)` 只做日志二分（`label: EMPTY/MISSING/值`），不驱动 UI 隐藏（UI 按现有渲染逻辑处理空值），见 `host/tracker/capability.js` 与 `harness.js:118-130`。
- **诚实上报**：未实现 op→`{ok:false, error:{kind:'unsupported'}}`（`ERROR_KIND.UNSUPPORTED`），`conflict` 仅显式产生（`setBlockedBy` 自环/成环），非 regex 派生，见 `src/tracker/contract/vocabulary.ts:ERROR_KIND`。

---

## 6. 契约测试复用（harness + runner + fixtures + 门禁）

公开验收面：**过 harness = 外部实现合规证据**（G4）。离线 playback 可 CI 跑，live 需注入真实 `exec/fs`。

- **纯形状断言** `runContractTests(fixture)`：`fixture = {name, normalize, withData, emptyData, mappings, implementedFields, missingFields, deckCases}` → 9 类断言（映射/骨架/state/EMPTY/MISSING/labels/closedAt/diagnose/EMPTY≠MISSING/frontier），见 `tests/tracker-contract/harness.js:56-146`。
- **真实适配器 Runner** `createRunnerContext/runWithAdapter/runPlayback/loadFixtures`：
  - `createRunnerContext({os,cwd,env,homedir,fs,exec})` → `BackendContext{platform,fs,exec,timers,log}`（含已解析 `platform` 实例，满足 #129 三底座可测性），见 `runner/index.js:45-94`。
  - `BackendModule.create(ctx)` → `Tracker` → `runWithAdapter({tracker,repo,fixturesDir,opCtx})` 做 live 形状门槛（`preflight/list/get/getDependencies` 的“不抛 + OpResult 形状”），见 `runner/index.js:153-265`。
  - `runPlayback({fixturesDir})` 离线校验采样固件（`metadata.json` + `normalized-*.json` 形状 + `diagnose` 可跑 + 无 token 残留），见 `runner/index.js:275-322`。
- **采样固件约定**（每后端一份，且记录来源/脱敏规则）：
  ```
  fixtures/<id>-real/
    metadata.json  { source, sampledAt, repo, refId, desensitization, fields }
    raw-*.json     未脱敏前的原始响应（已脱敏：ghp_/github_pat_ → [REDACTED]，邮箱→redacted@example.com，不记 Authorization 头）
    normalized-*.json  归一化后 Issue 期望
  ```
  demo 位于 `examples/demo-mini/fixtures/demo-real/`（不在 `files` 白名单，零发包，脚本 `scripts/generate-demo-fixtures.js` 可重采）。
- **门禁**：`node tests/verify-tracker-contract.js` → `620 passed · 4 failed（全为 violating 桩）· CONTRACT SKELETON OK`（历史数字依次是 `293/4`、`359/4`、`590/4`，每张票都会长；**别把数字当门槛**，回归红线的形状是：`compliant` 全 PASS、`violating` 那 4 条预期失败都在（按名字点名）、`sections/*` 全 PASS 含 `sections/labels.js` 里对真实后端模块的探针），见 `tests/verify-tracker-contract.js` 与 `tests/tracker-contract/README.md`。
- **接入五件清单（ONBOARDING）**：①`src/tracker/rooms/<id>/` ②`fixtures/<id>-real/`（`metadata.json+raw+normalized`）③`scripts/generate-<id>-fixtures.js` ④`verify-tracker-contract.js` 集成（保那 4 条 `violating` 预期失败都在）⑤预算声明 `budget` 与 `readBudget` 读数（见 §3.1），见 `tests/tracker-contract/README.md` 与 `tests/tracker-contract/ONBOARDING.md`。

---

## 7. 打包与更新

- **发包边界**：`examples/` **不在** `package.json#files` 白名单（当前 `private:true` 不发包；若发包，白名单为 `["lib","shared"]`，`examples/` 天然排除），`npm pack --dry-run` 验证无 `examples/` 泄漏（`scripts/generate-demo-fixtures.js` 已固化）。
- **DSH 插件打包**：第三方后端作为独立 npm 包（`publisher.name`），`dsh.contributes.trackers` manifest 预留（当前 DSH loader 只认 `dsh.contributes`，#125 Notes），或插件 `activate` 手动 `registry.register`（见 §2）。
- **更新/HMR**：`Disposable` 按代隔离 + `{replace:true}`（`sections/registry.js:108-116`），`on('bind') stale` 负载含真实 `handle` 供 UI 回退，不误删新代。

---

## 8. 接真实工具（以 Jira/Linear 为例）

> 以“文件后端 demo”为起点，替换 `create` 的 4 ops 实现 + `normalize` 对齐 + `matches` 探真实标识。

| 步骤 | 做什么 | 关键实现 |
|------|--------|----------|
| 1. `exec` 注入 | 真实远端需 `ctx.exec`（`subprocess.spawn` 薄封装） | `createRunnerContext({exec: realExec})`，`realExec = (cmd,args,opts)=>subprocess.spawn`，见 `runner/index.js:84-85`（默认抛 `ctx.exec not injected`，playback 绕过） |
| 2. `platform.fs` 置换 | `matches` 需读 `.jira/config.json` 或 `git remote` | 复用 `demoMatches` 的 `platform.fs` + `platform.path.join` + `signal.aborted` 早退（§4） |
| 3. `normalize` 对齐 `shape.js` | 把 Jira issue → `Issue`（`key=String(number/iid)`，`type/map` 正交，`blockedBy` 轻量引用，`labels: {name,color}`，`closedAt: string|null`） | 复刻 `examples/demo-mini/normalize.js` + `src/tracker/rooms/github/normalize.ts`（#138 一页纸方案：形状归一不变量） |
| 4. `fields` 清单 | 明确 `implementedFields / missingFields`（如 Jira 有 `author/milestone`，无 `customFields`） | 写入 `fixtures/<id>-real/metadata.json#fields` + `demoFixture.implementedFields/missingFields`，`diagnoseCapabilities` 日志二分验证 |
| 5. `getDependencies` 投影 | `blockedBy` 唯一真源，`blocking` 反向聚合（非第二真相），见 `src/tracker/contract/index.ts:Dependencies` | 复用 `examples/demo-mini/index.js:getDependencies` 的 scan-store 反向聚合 |

---

## 9. Checklist（ONBOARDING 五件，CI 全绿）

- [ ] `src/tracker/rooms/<id>/`（或 `examples/<id>/` 作外部示例，**不默认装配**）
- [ ] `fixtures/<id>-real/{metadata.json,raw-*.json,normalized-*.json}`（`metadata.desensitization` 四规则：`ghp_/github_pat_`→`[REDACTED]`、邮箱→`redacted@example.com`、不记 `Authorization` 头，见 `runner/index.js:315-318`）
- [ ] `scripts/generate-<id>-fixtures.js`（打真实 API → 脱敏 → 落盘 JSON + metadata）
- [ ] `tests/verify-tracker-contract.js` 集成：`runContractTests(demoFixture)` + `runPlayback({fixturesDir})`，过关判据是 `CONTRACT SKELETON OK` 加上违规桩里按名字点名的那 4 条失败必须出现（`npm run verify` 全绿）。断言总数每张票都会增长，**不要把这个数字当门槛**
- [ ] `budget` 声明与 `readBudget` 读数（§3.1）：模块里交四字段预算模型且注册不被拒；`readBudget` 的三种结果都如实回（读到带数、读不到带 `reason`、离网）、不裁决不记账；参考 `tests/verify-tracker-session.ts`、`tests/verify-1443-github-readbudget.ts`、`tests/verify-1446-gitlab-budget.ts`、`tests/verify-1447-gitlab-e2e.ts`

验证（双闸可复现）：
```bash
node tests/verify-tracker-contract.js   # 骨架门禁（现值 620/4/OK；数字会随票增长，不是门槛）
node scripts/generate-demo-fixtures.js # 重采（可选）
```

---

## 10. FAQ / 排障

| 现象 | 根因 | 处置 |
|------|------|------|
| `duplicate-id` | `id` 冲突（`publisher.name` 未遵） | 改 `id` 为 `acme.demo` 形态，或 HMR 传 `{replace:true}` |
| `other-not-registrable` | 误用 `id:'other'` | 改用 `Selection.backendId:null`（无后端 = 逃生舱，不造假后端） |
| `unknown-backend` | `bind(handle, id)` 指向未注册 id | 先 `register` 再 `bind`，或检查 `registry.has(id)` |
| `bad-handle` | `handle` 缺 `cwd/refId` | 传入 `RepoHandle{cwd}`，见 `src/tracker/registry/shape.ts:55-60` |
| `pending:true` | `matches` 超时（30 秒）被排除出决策集 | UI 显“等待/建议显式 bind”，不静默 OtherCard（§4） |
| `multiHit` | 多后端 `matches===true` 平局 | 取注册序首位，`multiHit` 暴露供 `bind` 显式纠正 |
| `unsupported` | 调未实现 op（9 桩） | 属预期诚实桩（`wrapTracker`），接真实工具时按 §8 补实现 |
| `budget invalid` | 模块没交预算声明或字段形状不对（#1439 起必交） | 按 §3.1 补 `budget`（四个字段缺一个也会拒），报错原文会点名缺的是哪一格 |

> 契约修订归 #111，开票前先推翻设计契约 §2/§4（跨子图不变量），本指南不随子图决定增长（契约 §8 附注）。

---

## 定位索引（以 doc 为线索找每处实现）

| 指南章节 | 代码位置 |
|---------|----------|
| BackendModule 五件套（含预算声明）+ Proxy | `src/tracker/registry/shape.ts:99-108,63-96,121,146` / `src/tracker/registry/core.ts:98-118` / `src/tracker/contract/index.ts:113-131` / `src/tracker/contract/budget-model.ts:21-63` |
| 预算声明与 readBudget 读数 | `src/tracker/contract/budget-model.ts:59-63` / `src/tracker/rooms/{github,gitlab,markdown}/budget.ts` / `tests/verify-1443-github-readbudget.ts` |
| 三级联 select + pending/multiHit | `src/tracker/registry/core.ts:142-191` / `src/tracker/contract/index.ts:141-147` |
| capability-by-fill | `src/host/tracker/capability.js` / `src/shared/tracker/shape.js:133-160` |
| harness + runner | `tests/tracker-contract/harness.js` / `tests/tracker-contract/runner/index.js` |
| demo 后端 + fixtures | `examples/demo-mini/index.js` / `examples/demo-mini/normalize.js` / `examples/demo-mini/matches.js` / `examples/demo-mini/fixtures/demo-real/` |
| 门禁 | `tests/verify-tracker-contract.js`（含 demo 织入） |
| 平台三底座 | `src/host/platform/index.js` / `src/host/platform/{darwin,win32,linux}/` |

---

*产出：FeatherHunter · 2026-08-24 · 对照 registry.js:1-266 / contract.js:1-221 / shape.js:1-202 / harness.js:1-128 / runner/index.js:1-324 / ONBOARDING.md / tracker-backend-design-contract.md 全量逐行 + `tests/verify-tracker-contract.js` 门禁实测 + DSH 插件 `apply(ctx)/ctx.effect/dispose` 模型核验*

*2026-10-23 修订（规格 #1439 / 收口 #1448）：BackendModule 从四件套扩成五件套（加必填预算声明）、能力名录 25→26（第 26 条 `readBudget`）、readBudget 读数四变体与取数纪律（读不到绝不拿 0 冒充）；§3.1 与 `tests/tracker-contract/ONBOARDING.md` 第 ⑤ 节同步。*
