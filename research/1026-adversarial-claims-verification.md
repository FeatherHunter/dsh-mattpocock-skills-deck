# #1026 对抗式审查指控核验报告（只读核查）

- 核查对象：ticket #1026（契约收尾）关票后提出的 P1–P4 四项指控，外加审查者自称已过关的三项 exoneration 复核。
- 核查方式：只读。读了探针原文、门禁原文、契约原文、两张票的正文与评论、git 历史，全仓 grep，未改任何代码与票面。
- 报告文件：`research/1026-adversarial-claims-verification.md`（本文件是本次核查唯一写入的文件）。

---

## P1a. 探针实际断言的是 `ProbeShape`，不是 `BackendModule`

**verdict：证实。**

两份探针的赋值目标都是文件内自定的弱化形状 `ProbeShape`，不是 `BackendModule`。而 #1026 正文两处（§范围第 3 条、§收尾）写的都是直接赋给 `BackendModule`，对不上。

一手证据：

- `tests/contract-probe-github.ts:44-50`：
  ```ts
  type ProbeShape = Omit<BackendModule, 'create' | 'openRepository' | 'checks'> & {
    create: (...args: any[]) => unknown
    openRepository?: unknown
    checks?: unknown
  }

  export const githubProbe: ProbeShape = githubModule
  ```
- `tests/contract-probe-markdown.ts:45-51`：同形状，`export const markdownProbe: ProbeShape = markdownModule`。
- #1026 正文§范围第 3 条原文：“把它的导出赋给契约里的 `BackendModule` 类型。后端与契约一致就编译通过，不一致当场变红”。
- #1026 正文§收尾原文：“探针写法是维护者认可的（与 #1095 同思路）：整模块对象一次性赋给 `BackendModule` 类型，靠多余属性检查和缺失检查当场报错。”
- #1026 评论（2026-10-13 08:06:27，票面矛盾拍板）同样写的是“把它的导出赋给契约的 `BackendModule` 类型”。
- 三处弱化（`create` 只断可调用、`openRepository` 只断存在、`checks` 只断存在）在探针文件头里如实写了（github 版 `:9-24`、markdown 版 `:10-25`），所以弱化本身没有藏，但票面正文的措辞把它说成了直接断 `BackendModule`，属于票面夸大。

---

## P1b. “靠多余属性检查当场报错”不成立；增成员确实只能靠运行时腿

**verdict：证实。**

分两段说。

### P1b-1：excess property check 不适用于 `export const x: T = 已导入的符号`

TypeScript 官方手册的 Excess Property Checks 一节把这条检查的适用范围限定在对象字面量（fresh object literal）赋值或传参时。参考链接（第一手来源）：

- <https://www.typescriptlang.org/docs/handbook/2/objects.html#excess-property-checks>
- <https://www.typescriptlang.org/docs/handbook/interfaces.html#excess-property-checks>

说明：本次核查环境里这两页正文抓取被截断，未能逐字摘录；手册该节的规则转述如下——多余属性检查只对新鲜的对象字面量生效，已存在的变量、导入的符号再赋值给带类型标注的目标时不触发。下面的本地复现是硬证据，结论不依赖转述。

用仓库自带 TypeScript（`node_modules/typescript`，版本号 `7.0.2`）当场复现，`--strict`：

复现命令（PowerShell，在仓库根执行）：

```powershell
node -e "console.log(require('./node_modules/typescript/package.json').version)"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-excess-probe'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Set-Content -Path (Join-Path $tmp 'excess.ts') -Value "interface T { a: string }`nconst src = { a: 'x', b: 123 };`nexport const x: T = src;`n"
Set-Content -Path (Join-Path $tmp 'fresh.ts') -Value "interface T { a: string }`nexport const y: T = { a: 'x', b: 123 };`n"
node ./node_modules/typescript/bin/tsc --noEmit --strict (Join-Path $tmp 'excess.ts')
node ./node_modules/typescript/bin/tsc --noEmit --strict (Join-Path $tmp 'fresh.ts')
```

输出（原样）：

```
7.0.2
--- non-fresh (expect exit 0, no error) ---
exit=0
--- fresh literal (expect TS2353 error) ---
../../Temp/dsh-excess-probe/fresh.ts(2,31): error TS2353: Object literal may only specify known properties, and 'b' does not exist in type 'T'.
exit=1
```

结论：带多余属性 `b` 的非字面量赋值编译通过（退出码 0、零报错），新鲜字面量才报 `TS2353`。#1026 收尾写的“靠多余属性检查和缺失检查当场报错”对 `export const githubProbe: ProbeShape = githubModule` 这种已导入符号的赋值不适用——多余属性那一半是错的（缺失检查那一半是对的：目标类型的必填成员在源对象里缺了会报错）。

### P1b-2：后端“增成员”探针抓不住，只能由门禁运行时腿 caught

**verdict：证实。**

- 探针赋值 `const githubProbe: ProbeShape = githubModule` 里，`githubModule` 是导入的已有符号（非新鲜字面量），按 P1b-1 的结论，多余属性检查不触发；类型相容只要求目标的成员在源里存在，源对象多带成员完全合法。所以后端加成员，探针永远是绿的。
- 门禁第 7 项运行时腿是唯一登记增减成员的地方。`tests/verify-contract-types.js:487-501` 把真加载的模块键集合与快照逐字比：
  ```js
  const keysOk = JSON.stringify(got.keys) === JSON.stringify(want.keys)
  ...
  (!keysOk ? '；键集合变了：先确认增减的成员有没有契约覆盖，确认后把新快照记进本门禁' : '')
  ```
  快照在 `:100-111`（github 16 个键、`openRepository='url'`、`checksKind='function'`；markdown 15 个键、`openRepository='folder'`、`checksKind='absent'`）。
- 精确化补充（指控原文没展开，但如实记录）：缺成员分两种。ProbeShape 保留下来的必填成员（`id`/`label`/`matches` 等，以及弱化后仍必填的 `create`）缺了，探针会红；但被弱化成可选 `unknown` 的 `openRepository`/`checks` 缺了，探针看不见。弱化路径本身有没有“缺成员一定红”的自动化证明，见 P2 结论（没有）。

---

## P1c. “5 次提交”实际是 6 个

**verdict：证实。**

- #1026 正文§进度原文：“2026-10-13 做完并关票（5 次提交，都已推送到 main，见「收尾」一节）。”
- 同一正文§收尾列出的哈希是 6 个：`5090d305`、`63f2a638`、`aafa3716`、`95226de2`、`b07e64b5`、`d50825c7`。
- `git log --oneline main` 核对：6 个全在 main 上，一字不差：
  ```
  d50825c7 把门禁文件头一句内部简称改成人话，决定人与理由指到票面（#1026）
  b07e64b5 删掉已搬空的旧契约行为文件，落点只留新文件（#1026）
  95226de2 契约门禁改写：探针编译进门、反面证明与运行时腿，撤掉两条旧同集断言（#1026）
  aafa3716 契约操作名录收成单源并把过时注释改成真话，探针发现的两处形状差同步进契约（#1026）
  63f2a638 门禁引用跟随行为搬家：指到新文件并转译后求值，断言语义一个字没变（#1026）
  5090d305 把契约目录里的三份行为搬到隔壁并同步实现侧引用，契约目录只留类型与数据（#1026）
  ```
  `git log --oneline --all` 按这 6 个哈希计数也是 6。
- 可能的成因（推测，非开脱）：“5 次”那句可能是第 6 个提交（`d50825c7` 文件头改人话）落地前写的，收尾补了第 6 个但进度里的数字没改。但按票面文字核验，指控成立：写的是 5，实际是 6。

---

## P2. 门禁反面证明与探针实际跑的不是同一条路；弱化路径无自动化证明

**verdict：证实。**

### 开关与断言目标确实不一致

- 探针实际跑的开关：`tests/verify-contract-types.js:90-94`（`PROBE_TSC_ARGS`）含 `'--strict', 'false'`，另有 `'--allowJs', '--checkJs', 'false'`，门禁第 5 项用它直编两份探针（`:395-399`）。
- 反面证明用的开关：`:445-449` 是 `'--noEmit', '--strict', '--target', 'es2020', '--lib', 'es2020,dom', '--module', 'esnext', '--moduleResolution', 'bundler', '--skipLibCheck'`——`--strict` 开，没有 `allowJs`/`checkJs false`。
- 断言目标不一致：探针断的是 `ProbeShape`（两份探针文件 `:44-51`）；反面证明（`:428-461`）现拼假后端断的是 `BackendModule` 本体：
  ```js
  `export const bad: BackendModule = { id: 'neg', label: 'neg', ` +
  `create: (() => { throw new Error('neg') }) as unknown as BackendModule['create'] }\n`
  ```
  要求编不过且输出点名 `matches`（`:452-456`）。
- 附带发现：门禁第 6 项文件头注释（`:30`）写的是“拿同一套严格开关编它”，“同一套”三个字与实际不符——探针是 `--strict false` 的宽松开关，反面证明是 `--strict`，两者既不是同一套，严格程度还反了。

### “弱化后的那条路能否抓住缺成员”：没有自动化证明

**结论：没有。**

- 全仓 grep `ProbeShape` 只有 4 处命中，全在两份探针文件里（定义各一处、使用各一处），没有任何反面测试拿 `ProbeShape` 编过坏后端。
- 门禁第 6 项只证明了“直接断 `BackendModule` 能抓住缺 `matches`”，没有证明“断 `ProbeShape`（宽松开关 + 三处弱化）能抓住缺成员”。弱化后仍必填的成员（`matches`、`id`、`label`、`create` 存在性）理论上缺了会红，但这只是类型规则的推论，没有一段自动化代码把它钉住。

---

## P3. “请维护者确认一句”真实存在且未被回应，票已关闭

**verdict：证实。**

- #1026 正文§收尾“与 #1095 当天留言的出入”一条末尾原文：“若维护者要改主意，#1095 可以接着改这扇门禁，判据都在文件头写着。请维护者确认一句。”
- #1026 状态：closed（关闭于 2026-10-13T10:07:21Z）。
- #1095 现状核验（`deck_issue_get` 读回）：状态 closed（关闭于 2026-10-13T09:41:08Z，早于 #1026 关票）；正文§进度只写了遗留路由（构建产物门禁→#1105、契约目录类型与纯度→#1026），没有回应 #1026 的确认请求；评论最新一条是 09:41:02Z 的关票结论，早于 #1026 关票，不可能回应收尾里那句话。其中第 7 条“#1026 问的两条名录同集断言：本票把运行时真源指到新文件后它们已是绿的，本票不撤（撤等于放水，留给维护者定）”是关票前对同一分歧的表态，不是针对“请维护者确认一句”的回复。
- 时间旁证：#1026 写的“#1095 在 17:41 留言”与 #1095 评论的 09:41:02Z（UTC，北京时间 17:41）对得上，内容也对得上（“同集两条本票不撤”对“本票不撤”，“行号缺陷本票不动”对“门禁报行号不准那个缺陷（#1103）本票不动”）。所以“出入”的描述属实，而收尾请求的那句确认在 #1095 那边没有下文，票却已经关了。

---

## P4. 探针不证明 `create` 返回深层；运行时调用方众多，“只影响类型精度”站得住

**verdict：证实（定性站得住）。**

### 探针文件头自述

- `tests/contract-probe-github.ts:9-16`：`create` 的返回深层（每条操作是否合 `OpResult` 字面量联合）明确弱化，原因是后端实现里 `ok` 被加宽成 `boolean`，只断“存在、能调用”，深层一致性留后续专票。
- `tests/contract-probe-markdown.ts:10-17`：同上。

### 真实后端 `create()` 的调用方枚举（grep 证据）

`tests` 内 grep `(githubModule|markdownModule)\.create` 命中 8 个测试文件、9 处：

- `tests/verify-709-no-self-continuing-timers.js:159`（`githubModule.create({})`）
- `tests/verify-928-field-line-rewrite.js:76`（`markdownModule.create({})`，`:77` 紧接着调 `tracker.create` 真建票）
- `tests/verify-922-ticket-file-queue.js:101`（`markdownModule.create({})`）
- `tests/verify-992-readonly-labels.js:204`（`githubModule.create({})`）
- `tests/verify-972-title-body.js:47`（`markdownModule.create({})`，`:53-92` 四次真 `tracker.create`）
- `tests/verify-970-whole-document.js:46`（`markdownModule.create({})`，`:50` 真 `tracker.create`）
- `tests/verify-github-label-colors.js:123`（文件头 `:18` 写明用真实 GitHub 后端模块装配）
- `tests/verify-markdown-label-colors.js:125`

另有：

- `scripts/matrix-smoke.js:154`：`const tracker = githubModule.create(backendCtx)`，随后过 playback + live smoke（`:160-168` 不抛加 `OpResult` 形状）。
- `scripts/matrix-full.js:151-153`：三房 `Module.create` 工厂引用。
- 生产路径 `src/tracker/registry/registryCore.ts:91`：`wrapTracker(mod, mod.create(backendCtx), backendCtx)`。
- `tests/tracker-contract/sections/idempotency*.js` 等经注册表调各后端 `create` 建票。

合计十余处，覆盖测试、脚本与生产装配，指控里举例的三处（`verify-992*`、`verify-709*`、`matrix-smoke`）全部存在。

### 加宽的三处在运行时确实无害

- `create` 返回的 `ok` 加宽（`boolean` vs 字面量联合）：运行时的真值仍是字面量 `true`/`false`，上面列的测试与冒烟断的正是运行时行为（建票成功、幂等键去重、playback 形状），类型加宽不改变任何运行值。
- `checks` 种类分歧（契约数组 vs GitHub 零参函数 vs Markdown 缺席）：全仓 `src` 内 grep `\.checks\b` 只命中 `src/client/statusbar/bannerChain.js:46,89` 的 `step.checks`（无关对象）；宿主把模块对象透给界面时只取 `links`/`capabilities`/`prompts`/`setupPrompt`/`labelPalette`/`openRepository`（如 `src/host/sessionRefresh.ts:132`），从不读模块的 `checks`；探针文件头称宿主走检测链不走它，与代码一致。
- `openRepository` 字面量加宽（`string` vs `'url'|'folder'`）：真值由运行时腿钉死（`:100-111` 快照 + `:491-493` 只认 `url`/`folder`/不声明）；消费方只做界面分流（`src/client/kernel/builtin-backends.js:38`、`src/client/panel/Dock.js:211`、`src/client/views/labels/labelColorErrors.js:187`），读到宽类型的值不影响对错。
- 契约正文也给了兜底依据：`src/tracker/contract/backend-module.ts:15-19` 写明注册表只校验 `id` 非空、`label` 字符串、`create`/`matches` 函数，其余可选，缺字段回退骨架——加宽与缺席在运行时语义里本来就是合法态。

所以“今天只影响类型精度、不影响运行时对错”这个定性成立：弱化丢掉的是静态门禁的精度，运行时对错另有十余处真调用和快照腿守着。

---

## 附加：exoneration 三项复核（审查者自称已过关，复核有无放水）

### ① 绿路径实际执行的 `check()` 恰好 10 个——属实，未放水

逐个数的（`tests/verify-contract-types.js`）：绿路径（全部通过、无缺件、无异常）会执行且仅执行这 10 次 `check`：

| # | 行号 | 内容 |
|---|------|------|
| 1 | `:294` | 五样输入齐（缺件即红） |
| 2 | `:323` | `tsc -p tsconfig.contract.json` 零错误 |
| 3 | `:349` | 契约目录 `.ts` 全部进了编译 |
| 4 | `:368` | 19 个操作名齐 |
| 5 | `:384` | 无运行时实现 |
| 6 | `:414` | 两份探针文件自己零报错 |
| 7 | `:418` | 后端内部报错数等于基线 200 |
| 8 | `:454` | 缺 `matches` 假后端编不过且点名 |
| 9 | `:494` | github 快照一致 |
| 10 | `:494` | markdown 快照一致（同一行循环两次） |

失败分支上的 `check(false, …)`（`:306`、`:309`、`:319`、`:336`、`:340`、`:393`、`:401`、`:431`、`:478`、`:480`、`:485`）绿路径不执行；`:381` 的 `console.log('  FAIL '…)` 不是 `check` 调用。审查者数的 10 个无误。

### ② `Object.freeze(CATALOG_OPERATIONS)` 真无其他消费者——属实，未放水

- 全仓 grep `CATALOG_OPERATIONS` 只有 2 处命中，都在 `src/tracker/contract/index.ts`（`:18` 导入、`:66` `Object.freeze(CATALOG_OPERATIONS)` 转出）。
- 全仓 grep `operations-catalog`：值引用导入只有 `index.ts:18`；`src/tracker/contract/operations.ts:53` 是 `import type`（转译擦除，运行时无引用）；`tests/verify-contract-types.js` 只是读文本做名字断言；其余是文档。没有第二份运行时拷贝，单源成立。

### ③ `PROBE_NONPROBE_ERROR_BASELINE = 200` 增减都红——属实，未放水

计数机制（`tests/verify-contract-types.js:404-424`）：把 `tsc` 输出按 `/\(\d+,\d+\)\s*:\s*error\s+TS\d+/` 逐行计数，按文件后缀滤出探针自己的报错（`:406-411`，有就单独记 FAIL），`nonProbeCount = 总数 - 探针数`，再 `check(nonProbeCount === 200)`，且 `:424` 有 `if (nonProbeCount !== PROBE_NONPROBE_ERROR_BASELINE) failed = true`。多了（新增债务）红，少了（动了实现面）同样红，双向都钉死。审查者的说法无误。

---

## 总表

| 指控 | verdict | 一句话 |
|------|---------|--------|
| P1a 探针断的是 `ProbeShape` 而非 `BackendModule` | 证实 | 两份探针 `:44-51` 赋值目标均为 `ProbeShape`，票面§范围与§收尾写的 `BackendModule` 对不上 |
| P1b 多余属性检查不适用于已导入符号赋值 | 证实 | 手册限定 fresh 字面量；本地 tsc 7.0.2 复现：非字面量赋值 exit 0，新鲜字面量 TS2353 |
| P1b后半 增成员只能运行时腿 caught | 证实 | 非新鲜赋值不触发多余属性检查；唯一登记处是门禁第 7 项键快照 `:487-501` |
| P1c “5 次提交”实为 6 个 | 证实 | 收尾列 6 哈希，`git log main` 6 个全在 |
| P2 反面证明与探针开关/目标不一致 | 证实 | 探针 `--strict false` 断 `ProbeShape`；反面 `--strict` 断 `BackendModule`；注释“同一套”也不对 |
| P2 弱化路径缺成员有无自动化证明 | 没有 | 全仓 `ProbeShape` 仅 4 命中，无反面测试走弱化路径 |
| P3 “请维护者确认一句”存在且票已关、#1095 无回应 | 证实 | 原文在 #1026 收尾；#1026 已 closed；#1095 更早关闭且正文评论无回应 |
| P4 只影响类型精度、不影响运行时对错 | 证实（成立） | `create()` 真调用十余处；加宽三处运行时无害均有代码证据 |
| exoneration ① 绿路径 10 个 check | 通过，未放水 | 逐行数过，恰好 10 个 |
| exoneration ② `Object.freeze` 无其他消费者 | 通过，未放水 | 值引用仅 `index.ts` 一处 |
| exoneration ③ 基线 200 增减都红 | 通过，未放水 | 双向判红代码在 `:418-424` |
