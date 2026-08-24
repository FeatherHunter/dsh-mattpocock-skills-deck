# 第三方 Tracker 扩展指南（Third-Party Tracker Guide）

> 面向：**外部第三方**（不在 `src/host/tracker/backends` 内，类似 Jira/Linear/Gitea/自建工具）与**内部新后端作者**（复用同一 TOC）。契约已全部定版（#125），本指南只教“怎么照抄 demo 扩展”，**不新增契约条款**（改契约归 `tracker-backend-design-contract.md` §1-8 + 契约修订流程，开票挂 #111）。

> 定版锚点：#147 7 行（demo-mini + `examples/demo-mini/` + 4 ops + 强验证 + 本文件）+ #125 V4（BackendModule 四件套 + Proxy 自动桩 + 三级联三态）+ 设计契约 §2（capability-by-fill）§4（cut 线）。

---

## 1. 你将得到什么（demo 形态 + 能力诚实上报 + UI 零改动链）

- **demo 后端是“证明接口可被外部实现”的钥匙**：`examples/demo-mini/`（不默认装配、不进 `src/host/tracker/backends/`，零发包） + `fixtures/demo-real/`（离线采样固件，可 `runPlayback`）。
- **能力诚实上报**：demo 只实现真会的 4 ops（`list/get/create/getDependencies`），余下 9 ops 由 `registry.js:wrapTracker` Proxy 自动补 `unsupported` 桩（准入墙消失，无需手写 capabilities 表）。
- **UI 零改动链**：`registry.describe(handle, backendId) → Selection.ref → snapshot.composeSnapshot → UI labelOf/backendIcon`（未知 `backendId` 原串展示，不分支），见 `src/host/tracker/registry.js:152-157` / `src/shared/tracker/shape.js:145-149` / `shared/tracker/constants.js:BACKEND_KIND`。

以本文为线索，可在仓库内找到每处实现（见各节末“定位”）。

---

## 2. 五分钟接入（`examples/demo-mini` 一行注册）

### Host 侧同步 API（当前可用）

```js
import { demoModule } from '../examples/demo-mini/index.js'
import { createRegistry } from '../src/host/tracker/registry.js'
import { createPlatform } from '../src/host/platform/index.js'

// host 单例（#113 平台抽象层：platform 已注 env/homedir，fs 来自 DSH dsh-fs-sandbox）
const platform = await createPlatform(hostCtx)
const backendCtx = { platform, fs: platform.fs, exec, timers: { setTimeout, clearTimeout }, log }
const registry = createRegistry(backendCtx, { matchesTimeout: 3000 })

// 注册（同步、无副作用；重复 id 默认抛 duplicate-id；HMR 用 {replace:true}）
const disp = registry.register(demoModule) // demoModule = { id:'demo-mini', label:'Demo Mini', create, matches }

// 生存期：按代隔离（旧代 dispose 不误杀新代，见 registry.js:172-180）
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

定位：`examples/demo-mini/index.js`（接入样板）/ `src/host/tracker/registry.js:161-181`（register）/ `src/host/platform/index.js`（平台）。

---

## 3. BackendModule 四件套（`id/label/create/matches`）+ 生存期

```ts
interface BackendModule {
  id: BackendId        // 唯一、开放 string（推荐 publisher.name）；内置 github/markdown/gitlab；'other' 禁注册
  label: string        // 显示名（UI 已知→徽标，未知→原串，不分支）
  create(ctx: BackendContext): Partial<Tracker> // 只实现真会的；缺的由 Proxy 补 unsupported 桩
  matches(handle: RepoHandle, ctx: OpContext): boolean // 启发式 boolean，不伪造身份
}
interface BackendContext { platform: Platform; fs: SandboxFS; exec; timers; log } // create 用（进程级能力）
interface OpContext extends BackendContext { cwd: string; signal: AbortSignal; refId?: string } // matches/detect/op/select 用
```

- **注册护栏**：同步校验形状四件，不因缺 op 拒绝；`'other'` 抛 `other-not-registrable`；`duplicate-id` 需 `{replace:true}`（HMR），见 `registry.js:124-133,161-165`。
- **Proxy**：`Partial<Tracker>` 缺方法→ `unsupportedStub(op, backendId)`（`{ok:false, error:{kind:'unsupported'}}`，返回不抛），Harness 即以此判断“缺能力”（G5 不分支），见 `registry.js:40-71`。
- **Disposable/on/describe/MIGRATE_KEY**：
  - `register` 返 `{dispose}`，按代隔离（`byId.get(id) !== entry` 则旧代不删新代），见 `registry.js:172-180` 测试 `sections/registry.js:103-112`。
  - `on('register'|'unregister'|'bind', fn): () => void`，抛错隔离，`unregister` 的 stale 负载携**真实 handle**（非字符串 key），见 `registry.js:149,259-264`。
  - `describe(handle, backendId): RepositoryRef`（骨架：`refId = handle.refId || (markdown?cwd:'')`，`name = refId||cwd||backendId`，`url=''`），不覆写即归一，见 `registry.js:152-157`。
  - `MIGRATE_KEY = {other:null}` 先落地，旧 `'other'` 缓存双读归客户端（#113/#114），见 `registry.js:21`。

校验两级（#125）：①注册时只验模块形状；②`verifyBackend` 异步验归一化纪律（有数据→必映射，无数据→必 `[]/''/null` 或省略），不验 op 支持。

---

## 4. 探测规则（`matches:boolean` + `select` 三级联 + `multiHit/pending`）

- **matches 语义**：`matches(handle, ctx): boolean`，只读 `cwd/fs`（经 `platform`），不确定一律 `false` + 记 `diagnostics`（由调用方日志），不伪造身份。demo 实现：`platform.fs` 探 `cwd/.demo/config.json` **或** `.scratch/map.md` 存在性（`lstat/stat/readText` 任一成功即命中），`signal.aborted` 时早退，见 `examples/demo-mini/matches.js`。
- **select 三级联三态**（`registry.js:200-237`）：
  1. `explicit(bound)`：`bind(handle, backendId|null)` 记忆（`backendId:null` = 显式无后端，`ref` 省略，不造假身份）。
  2. `matches`：并行 `allSettled` + 超时 `matchesTimeout`（默认 3000ms，可配）+ `AbortSignal`（超时同时 `controller.abort()` 传 `signal` 给 `matches`）；`boolean`；平局=`注册序`（Map 迭代序，`replace` 保持键位），暴露 `multiHit: BackendId[]` 供 `bind` 显式纠正。
  3. `fallback(unbound)`：仅当“无 explicit、无 `match===true`、无 `pending`”才 `backendId:null`（`ref` 省略）；**有 `pending:true` 则 surface 等待态，不静默 OtherCard**（UI 必须提示“等待/建议显式 bind”）。
  - `Selection = { backendId: BackendId|null, source: 'explicit'|'matches'|'fallback', ref?: RepositoryRef, multiHit?: BackendId[], pending?: true }`，`source` 无 `'detect'`（已改 `'matches'`），见 `contract.js:103-117`。
- **错误码**：`duplicate-id` / `other-not-registrable` / `unknown-backend`（`bind` 未注册 id）/ `bad-handle`（handle 缺 `cwd/refId`），见 `registry.js:TrackerRegistryError`。

边界（与 harness 对齐）：`matches` 抛错→`false`；超时→`{timedOut:true}` 排除出决策集（`pending:true`）；`'other'` 不注册；`Selection.backendId:null` 时 `ref` 省略。

---

## 5. 能力语义（capability-by-fill：`EMPTY []/''/null` vs `MISSING 省略`）

- **完整数据形状**（`shared/tracker/shape.js`）：核心字段（`key/type/title/state/body/url/createdAt/updatedAt/closedAt/parentKey`）**永远存在**（来源给不了→`''/null` 补齐）；能力字段（`author/assignees/labels/milestone/customFields/reason/blockedBy/comments`）可 `MISSING`。
- **EMPTY vs MISSING**：能实现但本条无内容 → `EMPTY`（属性存在且 `isEmpty([]/''/null)`）；不能实现 → `MISSING`（省略该字段，`hasField` 为 false）。**能力 = 事后事实**，无能力表、无线能力缓存、无运行期内省（G5 红线），见 `capability.js:diagnoseCapabilities/hasField/isEmpty`。
- **demo 的字段分工**（与 `tests/tracker-contract/fixtures/demo.js` 对齐）：
  - `implementedFields: ['labels','assignees','comments','blockedBy','reason']` → `EMPTY`（`[]/''`）。
  - `missingFields: ['author','milestone','customFields']` → `MISSING`（省略）。
- **诊断二分**：`diagnoseCapabilities(issue)` 只做日志二分（`label: EMPTY/MISSING/值`），不驱动 UI 隐藏（UI 按现有渲染逻辑处理空值），见 `host/tracker/capability.js` 与 `harness.js:98-110`。
- **诚实上报**：未实现 op→`{ok:false, error:{kind:'unsupported'}}`（`ERROR_KIND.UNSUPPORTED`），`conflict` 仅显式产生（`setBlockedBy` 自环/成环），非 regex 派生，见 `contract.js:ERROR_KIND` / `shared/tracker/constants.js`。

---

## 6. 契约测试复用（harness + runner + fixtures + 门禁）

公开验收面：**过 harness = 外部实现合规证据**（G4）。离线 playback 可 CI 跑，live 需注入真实 `exec/fs`。

- **纯形状断言** `runContractTests(fixture)`：`fixture = {name, normalize, withData, emptyData, mappings, implementedFields, missingFields, deckCases}` → 9 类断言（映射/骨架/state/EMPTY/MISSING/labels/closedAt/diagnose/EMPTY≠MISSING/frontier），见 `tests/tracker-contract/harness.js:56-126`。
- **真实适配器 Runner** `createRunnerContext/runWithAdapter/runPlayback/loadFixtures`：
  - `createRunnerContext({os,cwd,env,homedir,fs,exec})` → `BackendContext{platform,fs,exec,timers,log}`（含已解析 `platform` 实例，满足 #129 三底座可测性），见 `runner/index.js:45-94`。
  - `BackendModule.create(ctx)` → `Tracker` → `runWithAdapter({tracker,repo,fixturesDir,opCtx})` 做 live 形状门槛（`preflight/list/get/getDependencies` 的“不抛 + OpResult 形状”），见 `runner/index.js:200-280`。
  - `runPlayback({fixturesDir})` 离线校验采样固件（`metadata.json` + `normalized-*.json` 形状 + `diagnose` 可跑 + 无 token 残留），见 `runner/index.js:285-322`。
- **采样固件约定**（每后端一份，且记录来源/脱敏规则）：
  ```
  fixtures/<id>-real/
    metadata.json  { source, sampledAt, repo, refId, desensitization, fields }
    raw-*.json     未脱敏前的原始响应（已脱敏：ghp_/github_pat_ → [REDACTED]，邮箱→redacted@example.com，不记 Authorization 头）
    normalized-*.json  归一化后 Issue 期望
  ```
  demo 位于 `examples/demo-mini/fixtures/demo-real/`（不在 `files` 白名单，零发包，脚本 `scripts/generate-demo-fixtures.js` 可重采）。
- **门禁**：`node tests/verify-tracker-contract.js` → `359 passed · 4 failed（全为 violating 桩）· CONTRACT SKELETON OK`（demo 织入后从 `293/4` 增至 `359/4`，回归红线：`compliant` 全 PASS、`violating` 至少一 FAIL、`sections/*` 全 PASS），见 `tests/verify-tracker-contract.js` 与 `ONBOARDING.md:98-101`。
- **接入四件清单（ONBOARDING）**：①`src/host/tracker/backends/<id>/` ②`fixtures/<id>-real/`（`metadata.json+raw+normalized`）③`scripts/generate-<id>-fixtures.js` ④`verify-tracker-contract.js` 集成（保 `4 failed` 全为 `violating`），见 `tests/tracker-contract/README.md:98-105`。

---

## 7. 打包与更新

- **发包边界**：`examples/` **不在** `package.json#files` 白名单（当前 `private:true` 不发包；若发包，白名单为 `["lib","shared"]`，`examples/` 天然排除），`npm pack --dry-run` 验证无 `examples/` 泄漏（`scripts/generate-demo-fixtures.js` 已固化）。
- **DSH 插件打包**：第三方后端作为独立 npm 包（`publisher.name`），`dsh.contributes.trackers` manifest 预留（当前 DSH loader 只认 `dsh.contributes`，#125 Notes），或插件 `activate` 手动 `registry.register`（见 §2）。
- **更新/HMR**：`Disposable` 按代隔离 + `{replace:true}`（`sections/registry.js:103-112`），`on('bind') stale` 负载含真实 `handle` 供 UI 回退，不误删新代。

---

## 8. 接真实工具（以 Jira/Linear 为例）

> 以“文件后端 demo”为起点，替换 `create` 的 4 ops 实现 + `normalize` 对齐 + `matches` 探真实标识。

| 步骤 | 做什么 | 关键实现 |
|------|--------|----------|
| 1. `exec` 注入 | 真实远端需 `ctx.exec`（`subprocess.spawn` 薄封装） | `createRunnerContext({exec: realExec})`，`realExec = (cmd,args,opts)=>subprocess.spawn`，见 `runner/index.js:84-85`（默认抛 `ctx.exec not injected`，playback 绕过） |
| 2. `platform.fs` 置换 | `matches` 需读 `.jira/config.json` 或 `git remote` | 复用 `demoMatches` 的 `platform.fs` + `platform.path.join` + `signal.aborted` 早退（§4） |
| 3. `normalize` 对齐 `shape.js` | 把 Jira issue → `Issue`（`key=String(number/iid)`，`type/map` 正交，`blockedBy` 轻量引用，`labels: {name,color}`，`closedAt: string|null`） | 复刻 `examples/demo-mini/normalize.js` + `src/host/tracker/backends/github/normalize.js`（#138 一页纸方案：形状归一不变量） |
| 4. `fields` 清单 | 明确 `implementedFields / missingFields`（如 Jira 有 `author/milestone`，无 `customFields`） | 写入 `fixtures/<id>-real/metadata.json#fields` + `demoFixture.implementedFields/missingFields`，`diagnoseCapabilities` 日志二分验证 |
| 5. `getDependencies` 投影 | `blockedBy` 唯一真源，`blocking` 反向聚合（非第二真相），见 `contract.js:Dependencies` | 复用 `examples/demo-mini/index.js:getDependencies` 的 scan-store 反向聚合 |

---

## 9. Checklist（ONBOARDING 四件，CI 全绿）

- [ ] `src/host/tracker/backends/<id>/`（或 `examples/<id>/` 作外部示例，**不默认装配**）
- [ ] `fixtures/<id>-real/{metadata.json,raw-*.json,normalized-*.json}`（`metadata.desensitization` 四规则：`ghp_/github_pat_`→`[REDACTED]`、邮箱→`redacted@example.com`、不记 `Authorization` 头，见 `runner/index.js:315-318`）
- [ ] `scripts/generate-<id>-fixtures.js`（打真实 API → 脱敏 → 落盘 JSON + metadata）
- [ ] `tests/verify-tracker-contract.js` 集成：`runContractTests(demoFixture)` + `runPlayback({fixturesDir})`，保 `4 failed` 全为 `violating`（`npm run verify` 全绿）

验证（双闸可复现）：
```bash
node tests/verify-tracker-contract.js   # 骨架门禁（359/4/OK）
node scripts/generate-demo-fixtures.js # 重采（可选）
```

---

## 10. FAQ / 排障

| 现象 | 根因 | 处置 |
|------|------|------|
| `duplicate-id` | `id` 冲突（`publisher.name` 未遵） | 改 `id` 为 `acme.demo` 形态，或 HMR 传 `{replace:true}` |
| `other-not-registrable` | 误用 `id:'other'` | 改用 `Selection.backendId:null`（无后端 = 逃生舱，不造假后端） |
| `unknown-backend` | `bind(handle, id)` 指向未注册 id | 先 `register` 再 `bind`，或检查 `registry.has(id)` |
| `bad-handle` | `handle` 缺 `cwd/refId` | 传入 `RepoHandle{cwd}`，见 `registry.js:33-38` |
| `pending:true` | `matches` 超时（3000ms）被排除出决策集 | UI 显“等待/建议显式 bind”，不静默 OtherCard（§4） |
| `multiHit` | 多后端 `matches===true` 平局 | 取注册序首位，`multiHit` 暴露供 `bind` 显式纠正 |
| `unsupported` | 调未实现 op（9 桩） | 属预期诚实桩（`wrapTracker`），接真实工具时按 §8 补实现 |

> 契约修订归 #111，开票前先推翻设计契约 §2/§4（跨子图不变量），本指南不随子图决定增长（契约 §8 附注）。

---

## 定位索引（以 doc 为线索找每处实现）

| 指南章节 | 代码位置 |
|---------|----------|
| BackendModule 四件套 + Proxy | `src/host/tracker/registry.js:124-133,40-71,161-181` / `src/host/tracker/contract.js:94-101` |
| 三级联 select + pending/multiHit | `src/host/tracker/registry.js:200-237` / `src/host/tracker/contract.js:103-117` |
| capability-by-fill | `src/host/tracker/capability.js` / `src/shared/tracker/shape.js:107-140` |
| harness + runner | `tests/tracker-contract/harness.js` / `tests/tracker-contract/runner/index.js` |
| demo 后端 + fixtures | `examples/demo-mini/index.js` / `examples/demo-mini/normalize.js` / `examples/demo-mini/matches.js` / `examples/demo-mini/fixtures/demo-real/` |
| 门禁 | `tests/verify-tracker-contract.js`（含 demo 织入） |
| 平台三底座 | `src/host/platform/index.js` / `src/host/platform/{darwin,win32,linux}/` |

---

*产出：FeatherHunter · 2026-08-24 · 对照 registry.js:1-266 / contract.js:1-221 / shape.js:1-202 / harness.js:1-128 / runner/index.js:1-324 / ONBOARDING.md / tracker-backend-design-contract.md 全量逐行 + `tests/verify-tracker-contract.js` 门禁实测 + DSH 插件 `apply(ctx)/ctx.effect/dispose` 模型核验*
