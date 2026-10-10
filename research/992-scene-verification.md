# #992 只读仓库标签能力降级：四场景“声称 vs 源码”核查

> 只读核查，不改代码、不联网。第一手源码以 `src/`、`tests/`、`README.md`、`docs/README.en.md` 为准。
> 核查对象：有人声称的四个用户可见场景（#992，提交 3bd0cad 修“只读仓库下标签能力静默降级”）。
> 每节结构：声称原文 → 源码证据（文件:行）→ verdict → 不一致（差在哪 / 影响 / 建议怎么改）。
> verdict 取值：成立 / 部分成立 / 不成立。

---

## 场景一（只读库建票）：PARTIAL + 正文“待补标签”区

### 声称原文（待核）

`deck_issue_create` 在标签没挂上时回 PARTIAL、文案含“标签没挂上”与权限原因、不再出现“我替你补了必备标签”，且 `items` 里有 `labels: failed` 逐条；建票后票正文会被尽力补上“待补标签（只读未落盘）”区（含待补名单、仓库名、fork 指路），改正文失败也不挡主路。

### 源码证据

**1. `labelFailed` 的判据 —— `src/host/tools/deckIssueCreate.js:123-126`**

```js
const labelFailed = !!(issue && issue.labelError)   // :123，唯一判据：后端票上有没有 labelError
const labelWhy = labelFailed ? String((issue.labelError && issue.labelError.message) || '后端没给出原因').slice(0, 300) : ''  // :124
if (ensured.added.length && !labelFailed) notes.push('我替你补了必备标签：' + ensured.added.join('、'))  // :125，“补了”只在没失败时说
if (labelFailed) notes.push('标签没挂上，别把它当成已经打上：逐条原因在下面的 items 里。')  // :126
```

**2. PARTIAL 分支的文案与 items —— `src/host/tools/deckIssueCreate.js:151-185`**

- 父子边也挂了 + 标签也挂了：`src/host/tools/deckIssueCreate.js:151-168`，`:155` 只有 `labelFailed` 时才追加 labels 项，`:160-161` 文案同时拼父边原因与 `标签也没挂上：+ labelWhy`。
- 只有标签挂了（最常见的只读情形）：`src/host/tools/deckIssueCreate.js:170-185`：
  - `:172` `items.push({ key: issue.key, step: 'labels', status: 'failed', reason: labelWhy })`
  - `:177` `text: '票 ' + key + ' 建好了：' + title + '。标签没挂上：' + labelWhy`
  - `:175-176` `status: PARTIAL, reason: BACKEND_UNSUPPORTED`
- 全成时：`src/host/tools/deckIssueCreate.js:186-196`，`:189` `status: OK`，文案为“建好了”，无“没挂上”。

**3. 后端 `labelError` 分支与正文区 —— `src/host/tracker/backends/github/issues-write.js:83-116,140`**

- 标签失败记票不吞错：`:89-93` `issue.labelError = { kind, message }`，注释写明“照 parentError 先例，票照样建成 ok:true”（`:90`）。
- 正文区拼接：`:100` 空正文守卫 `if (typeof issue.body === 'string' && issue.body)` —— **空正文直接跳过，只留 labelError**（`:99` 注释“正文为空时不敢写（会把建票锚与原有内容冲掉），只留 labelError”）。
- 区文案：`:103-107`，区名 `## 待补标签（只读未落盘）`（必带“未落盘”），内容含 `wantLabels.join('、')`（待补名单）、`parsed.owner + '/' + parsed.name`（仓库名，`:102`）、`你在「…」上只有读权限时…这不是网络问题` + `补标签要 triage 及以上权限（新建标签要 push）` + `fork 到自己名下，再把工作区 origin 指向 fork（插件只认 origin，不代改配置）`（fork 指路）。
- 幂等替换：`:108-111` 已有该区则正则替换，否则追加；`:112` `updateIssue(repo, issue.key, { body: newBody }, ctx)` 尽力写，`:113` 只有 `ur.ok === true` 才回填 `issue.body`，`:115` `catch {}` 空吞 —— **改正文失败不抛、不改返回**，`:140` 仍 `return { ok: true, data: issue }`。

### verdict：成立（带两处措辞级注记，不推翻结论）

- PARTIAL 状态、文案含“标签没挂上”+ 权限原因（`labelWhy` 即后端 `readonlyMessage` 全文，见场景二）、`!labelFailed` 门控“补了”那句、labels 失败项形状，四项与源码一字对上。
- 正文区“有名单、有仓库名、有 fork 指路、空正文不写、改正文失败不挡主路”五项与源码一字对上。

### 不一致（2 项，均轻微）

1. **“`items` 里逐条”粒度被夸大。**
   - 差在哪：源码每次调用最多只产生 **一个** labels 项（`:172` 单个 `{step:'labels', status:'failed'}` 聚合项，reason 里拼全标签名单），不是按标签名逐个拆项（如 bug 一条、needs-triage 一条）。父边同挂时也只是“父边 1 条 + 标签 1 条”（`:149` + `:155`）。“逐条”若理解为“按步骤逐条记账”则成立，若理解为“按标签名逐条”则不成立。
   - 影响：小。AI 侧能从 reason 文案里看到全部标签名，不丢信息；只是做自动化断言“items 里有 N 个标签项”的人会扑空。门禁 `tests/verify-992-readonly-labels.js:176-177`（E4）断言的也是单个 `step==='labels'` 项，与实现一致，证明“逐条”在门禁口径里就是“单聚合项”。
   - 建议：把声称改成“`items` 里有一条 `{step:'labels', status:'failed'}` 聚合项，reason 里带全标签名单与权限原因”，或真要逐标签拆项就改 `:172` 按 `wantLabels` 循环 push（但会改契约形状，需另议，不建议顺手改）。
2. **notes 里“下面的 items”方位词不准。**
   - 差在哪：`:126` 写“逐条原因在下面的 items 里”，实际返回包里 `notes` 与 `items` 是同级字段（`:178-180`），不是上下包含关系。
   - 影响：极小，纯措辞。
   - 建议：改成“逐条原因在同包的 items 里”。

---

## 场景二（只读库打标 / 改色失败说法）：权限归因改写

### 声称原文（待核）

`deck_issue_patch` 加标签失败时原因里出现仓库 owner/name 与“只有读权限”说法（不再是 404 原文或网络错误），且有写权限或问不出权限时原样返回。

### 源码证据

**1. 改写触发与改写条件 —— `src/host/tracker/backends/github/labels.js:74-84`**

```js
async function attributeLabelFailure(c, spec, wantNames, err, ctx) {  // :74
  const text = String((err && (err.message || err.stderr)) || '')     // :75
  const suspicious = /HTTP 404|\b404\b|does not have the correct permissions|addlabelstolabelable/i.test(text)  // :76
    || (err && err.kind === ERROR_KIND.AUTH)                          // :77
  if (!suspicious) return err                                         // :78，非权限失败原样走
  const perms = await readRepoPermissions(c, spec, ctx)               // :79
  if (perms && perms.triage === false) {                              // :80，只有确认 triage 为假才改写
    return { kind: ERROR_KIND.AUTH, message: readonlyMessage(spec, wantNames) }  // :81
  }
  return err                                                          // :83，有写权限（triage 真）或问不出来（null）都原样返回
}
```

- 调用点：`:119`（摘标签失败）、`:123`（加标签失败）两处都经 `attributeLabelFailure`。
- 判据细节：打标看的是 `triage`（`:80`），不是 `push` —— 与注释 `:70-72`“给票打标要 triage 起”一致。改色链看的是 `push`（见下），两处各看各的，没有混用。

**2. 统一说法全文 —— `src/host/tracker/backends/github/repo-permissions.js:85-90`**

```js
return '你在「' + String(spec || '') + '」上只有读权限，没有给票打标签的权限（打标签要 triage 及以上，新建标签要 push）——'  // :88
  + suffix + '没写进去，票本身不受影响。请换有写权限的账号，或请仓库管理员授予权限后补打。'  // :88-89
```

- `spec` 即 `owner/name`（调用方 `labels.js:115` 由 `parsed.owner + '/' + parsed.name` 拼出）；`suffix` 带这次没挂上的标签名单（`:86-87`）。“只有读权限”五字原文在 `:88`。

**3. 工具层原样上浮 —— `src/host/tools/deckIssuePatch.js:125-128,148-166`**

```js
const fail = (step, result) => {
  const msg = String((result && result.error && result.error.message) || '后端没给出原因').slice(0, 200)  // :126
  items.push({ key: key, step: step, status: 'failed', reason: msg })  // :127
}
```

- labels 路：`:160` `t.setLabels(...)` → `:162` 失败走 `fail('labels', r)`，不对 `error.message` 做任何改写、截断只到 200 字。改写只发生在后端 `attributeLabelFailure` 里，工具层是直通。

**4. 非权限失败（普通 500）不会被误改写**

- 普通 500 文案（如 `HTTP 500: Internal Server Error`）不命中 `:76` 的 404/权限句正则；其 `err.kind` 经 `classifyGhError` 落网络档（`errors.js` 无 500 专条，兜底走 `classifyError` → network），不等于 AUTH（`:77` 不成立）→ `:78` 直接 `return err`，连权限都不问。门禁 `tests/verify-github-label-colors.js:212,221` 用 500 演“中途失败不回滚”，断言仍逐条记账且不落鉴权档，与该分支一致。
- 边界：500 文案里若恰好含 `404` 子串（如 URL 参数 `?page=404`）会被 `:76` 的 `\b404\b` 误判为可疑，进而多问一次权限。但最终改写仍需 `triage===false`（`:80`），有写权限/问不出仍原样返回，所以最坏代价是一次多余的 `gh api repos/` 查询，不会造出假话。

**5. 改色链同口径 —— `src/host/tracker/backends/github/label-colors-ops.js:207-209,241-288`**

- `:207-209` 批内复用 `permCache`（一批只真问一次）；`:264` 只有 `HTTP 404|\b404\b` 才进 `explain404`；`:279-288` `explain404` 内 `push===false → auth`（`:281-282`，文案带 `spec` 与“没有写权限”）、`push===true → not-found`（`:284-285`）、问不出 → not-found + “无法确认…权限”（`:287`）。与打标链“问不出原样返回”同构（改色是逐条 reason，不是抛错）。

### verdict：成立

- “原因里有 owner/name + 只有读权限”“不再是 404 原文/网络错误”“有写权限或问不出原样返回”三句都有逐行支撑；500 不误改写得证（多问一次的最坏情形也不改判）。

### 不一致（1 项，测试覆盖缺口，非实现错）

- **门禁没测“问不出权限时 setLabels 原样返回”那一支。**
  - 差在哪：`tests/verify-992-readonly-labels.js:113-116`（C5）只测了“有写权限 → 原样返回 gh 原文”，`:96`（B4）只测了 helper 本体“问不出回 null”。两者的组合（setLabels + 权限查询失败 → 应原样返回 404 文案、不瞎说没权限）在 C 节没有用例。改色链倒是有（`tests/verify-github-label-colors.js:288-291` 断言 `cantAsk` 落 not-found + “无法确认”），打标链缺对称用例。
  - 影响：小。实现 `:83` 的 `return err` 肉眼可验，但以后有人动 `:79-83` 时门禁拦不住回归。
  - 建议：在 C 节补一例 `makeCtx({ permsFails: true })` + `setLabels` 断言 `ok===false && kind !== 'auth' && message 含 gh 原文`（只加断言，不改实现）。

---

## 场景三（检查页详情 / 补标签弹窗 fork 指路 / deck_context 只读提示）

### 声称原文（待核）

(a) 检查页 `gh:repoAccess` 行点开详情能看到 fork 那一句；(b) 建仓后“标签”步骤弹窗点“注入补全指引”填进输入框的文案末尾有 fork 那一句；(c) `deck_context` 在只读库上回 `repo.permissions` 与 notes“这个仓库只读：标签与写操作不可用。”+ fork 建议。

### 源码证据

**前置：文案声明 —— `src/host/tracker/backends/github/index.js:91-95,129-131`**

- (a) 的文案：`:91-95` `fixes['gh:repoAccess'].hint`，zh 末句为“若仓库只读（能看不能写），标签相关操作会失败：建议 fork 到自己名下，再把工作区 origin 指向 fork（插件只认 origin，不代改配置）。”en 同义含 fork。
- (b) 的文案：`:129-131` `prompts.ensureLabels`，zh 末段为“只读仓库补不上标签（建标签要 push，给票打标要 triage 及以上）：这时先 fork 到自己名下，再把工作区 origin 指向 fork；插件只认 origin，不代改配置。”en 同义含 fork。两份文案各写一份但同义（注释未声明单源，见下注记）。

**(a) 检查页渲染链 —— 有完整消费者**

1. 宿主组装：`src/host/detectChain.js:241` `items = fixMod.attachFixContract(items, tmod, chainLang, { cwd, owner })`。
2. 纯函数：`src/host/tracker/fixContract.js:71` `pickLang(fix.hint, lang)` → `:139` 并进 `onFail.show.hint`。
3. 客户端读：`src/client/kernel/probe-chain.js:182-183` `chainSteps(st)` / `chainStep(st, id)` 只读 `st.chainSnapshot.steps`。
4. 检查页渲染：`src/client/views/ChecksTab.js:132-142` `hintTextOf(s)` 读 `s.show.hint`（`prompt:` 前缀才走 resolvePrompt，纯文案直接返回 `:141`）；`:157` 取出 `hintText`；`:173` 直接渲染 `h('div', { className: 'dt', ... whiteSpace: 'pre-wrap' }, hintText)`。
5. 反证（横幅不渲染 hint）：`src/client/views/shared/ChainRenderer.js:205-208` `ChainBanner` 只拼 `title + desc`（`:217`），不读 `show.hint` —— fork 那句只出现在检查页行内，不出现在顶部横幅。

**(b) 弹窗注入链 —— 注入代码存在，但宿主当前无挂载**

1. 注入代码：`src/client/views/NoRepoCard.js:258-274` `doInject` 内 `:263-264` 按当前后端经 `moduleMetaOf(st, bidI).prompts.ensureLabels` 取文案（`:265` 按语言挑 zh/en），`:269` `inject(st, txt)` 填进输入框；按钮为 `:284` `tr('panel.labelsStepAction')` 即“注入补全指引”（词条见 `src/client/kernel/locale-panel.js:147-148` `panel.labelsStepAction` / `panel.labelsStepTitle` / `panel.labelsStepDesc`）。
2. 无挂载：全仓 `NoRepoCard` 引用仅定义（`NoRepoCard.js:17`）+ 注释（`ListTab.js:243` 写明“全屏红卡不再挂载于列表页顶部”）+ 测试反面断言；`grep "h(NoRepoCard"` 零命中。组件在产物里但没有任何父组件渲染它，`card.labelStep.visible` 置位的建仓成功回调（`NoRepoCard.js:125-173`）当前不可达。

**(c) deck_context 能力位 —— 宿主行为成立，无 UI 消费者**

1. 权限查询：`src/host/tools/deckContext.js:84-85` 仅 github 且有 `getRepoPermissions` 才问（`backend.js:129-137` 实现经 `readRepoPermissions` 读 `.permissions`，问不出回 `ok:false`）。
2. 三分支：`:99` markdown 恒 `{push:true, triage:true}`；`:100-101` github 问到真值用真值；`:102` 其余（含 gitlab、无方法、问不出）一律 `{unknown:true}`。
3. notes 两句：`:106-109` `push===false` 时才推两句 —— `:107` `这个仓库只读：标签与写操作不可用。`、`:108` `要在只读库上长期协作，建议先 fork 到自己名下，再把工作区 origin 指向 fork（插件只认 origin，不代改配置）。`；可写时（门禁 G9）无提示。
4. 回包位置：`:119` `repo: { ..., permissions: permissions }`。
5. 无 UI 消费者：全 `src/` 搜 `repo.permissions / permissions.push / permissions.triage / 这个仓库只读` 仅命中 `deckContext.js:106-107` 与注释（`repo-permissions.js:6`），`src/client` 零命中。`getRepoPermissions` 的调用方仅 `deckContext.js:85`（直搜全仓 13 命中里宿主调用仅此一处，其余为定义与测试桩）。

### verdict

- (a) **成立**（带一处措辞注记）。
- (b) **部分成立**：文案已声明 + 注入代码是弹窗那一份，链路对得上；但弹窗当前无挂载，用户点不到。
- (c) **部分成立**：宿主回包行为全对；但能力位只到 AI 为止，无 UI 渲染（“用户可见”四字只对了一半：AI 可见成立，面板可见不成立）。

### 不一致（3 项，按影响排序）

1. **(b) 标签步骤 Modal 是死代码，用户当前点不到“注入补全指引”。（影响：中）**
   - 差在哪：声称预设了“建仓后弹标签步骤弹窗”这条路可达，实际 `NoRepoCard` 无挂载点，建仓成功后进标签 Modal 的回调（`NoRepoCard.js:125-173`）与注入按钮（`:284`）都不可达。门禁只断言了文案含 fork（`verify-992:231` G3/G4），没断言挂载。
   - 影响：fork 指路在该入口实际触达率为零；用户只能经检查页 hint 或 AI 转述看到 fork 建议。若 #992 的验收标准含“建仓后弹窗可点”，现在不达标。
   - 建议（三选一，需拍板，不顺手改）：① 恢复挂载（把 `NoRepoCard` 接回建仓成功链并补挂载断言）；② 正式退役该 Modal（删组件 + 删 G3/G4 改断言，fork 指路只留检查页与 deck_context 两处）；③ 改声称为“文案已就绪、入口待接线”，并在文末渲染链路清单里登记。
2. **(c) `repo.permissions` 无 UI 渲染，面板不会变灰/挂只读徽。（影响：小中）**
   - 差在哪：声称把 deck_context 回包等同于“用户可见”，实际只有调工具的 AI 能看到 notes；面板侧（ChecksTab / 横幅 / 标签配色弹窗）没有任何 `repo.permissions` 分支，不会据此禁用按钮或显示只读态。标签配色弹窗走的是做法 B（`LabelColorDialog.js:17`“不提前猜只读，允许点保存，失败说清原因”），与权限位无联动。
   - 影响：用户在面板上得不到前置只读提示，只能撞上失败才知；AI 若不主动转述 notes，用户感知为零。
   - 建议：声称改成“能力位只到 AI 为止”；若要面板可见，需新开一条 UI 消费 `snapshot.repo.permissions` 的渲染分支（另议，不在 #992 内顺手做）。
3. **(a) “点开详情”与实际交互不符；横幅无 fork。（影响：小）**
   - 差在哪：ChecksTab 行内 hint 是**直接渲染**的（`:173`），无需点开；“点开”的是 desc 的悬浮 Tip（`:172`）。且顶部 `ChainBanner` 不渲染 hint（`ChainRenderer.js:205-208`），只看横幅的用户看不到 fork。
   - 影响：按声称去“点开详情”找的人可能错过（实际一眼就在行内）；只看横幅的人根本看不到。
   - 建议：声称改成“检查页 `gh:repoAccess` 行内直接展示 fork 那一句（无需点开；顶部横幅不展示）”。

- 附带注记（不判错）：`fixes.hint` 与 `prompts.ensureLabels` 的 fork 两句是**两份手写文案**（`index.js:93` 与 `:130`），不是同一常量。措辞已同义（都含 fork + origin + 不代改配置），但以后改一句易漏另一句。建议抽成同一常量或在门禁里加“两处同含 fork/origin”双断言（G3+G5 已是该形状，保留即可）。

---

## 场景四（README 前置条件）

### 声称原文（待核）

根 `README.md` 与 `docs/README.en.md` 前置要求段各多了一句权限说明。

### 源码证据

- 根：`README.md:24` 全文：`任务板绑定的仓库需要写权限：新建标签要 push 权限，给票打标签要 triage 及以上权限；只有读权限时能建票、能读票，但补标签、标签流转与 wayfinder 标签都不可用。`（位于 INSTALL 前置要求 `div` 内，`:22-24`）。
- 英文：`docs/README.en.md:28` 全文：`The repo your task board is bound to needs write access: creating labels requires push access, and labeling tickets requires triage access or higher. With read-only access you can still create and read tickets, but label backfill, label flow, and wayfinder labels are unavailable.`

### verdict：成立

- 逐字对过：中英各一句，权限阈值（push / triage）与只读能力边界（能建票能读票、标签链不可用）两两对应，无漏译。门禁 G1/G2（`verify-992:225,227`）断言的正是这两句的关键词（push/triage/只读、push access/triage），与实现对得上。

### 不一致：无。

---

## 额外核查（复数权限正则 + 两道门禁）

### E1. `errors.js` 与 `preflight.js` 的复数权限正则

- `src/host/tracker/backends/github/errors.js:86-89`：auth 分支新增 `does not have the correct permissions | addlabelstolabelable`（`:86`），注释 `:87-89` 写明“只加复数句式，404 仍归 NOTFOUND（那一档本来就是对的，不动）”；`:100` `404 → NOTFOUND` 原样保留；`:99` 网络特征排在 not-found 之前（#620 整改，不动）。
- `src/host/tracker/preflight.js:42-44`：注释写明“与 backends/github/errors.js 同改”，`:44` 同加复数两式；`:50` `not ?found|\b404\b → NOTFOUND` 原样保留。
- 门禁 `tests/verify-992-readonly-labels.js:77-82`（A1-A4）：复数句两处同归 auth（A1/A2）、404 仍 not-found（A3）、真断网仍 network（A4）。断言与实现逐行对上。
- **verdict：成立。无不一致。**

### E2. `tests/verify-992-readonly-labels.js` 是否真覆盖上述行为

- A（分类）：真覆盖，断言直调两处 `classify`，无错位。
- B（helper）：真覆盖，B2 断言同批只真发一次（`permCalls.length===1`，`:93`），B4 断言问不出回 null（`:96`）。实现 `repo-permissions.js:43-59` 的 Map 存 Promise 机制与断言对得上。
- C（setLabels 归因）：**基本覆盖，缺 1 支**（见场景二不一致：有写权限测了 C5，问不出没测）。C1-C4（`:107-112`）用真 `setLabels` + 脚本化 gh（读空标签 + 打标按权限句失败 + 权限只读）断言 ok=false / kind=auth / 含仓库名权限说法 / 无 404 原文，与 `labels.js:74-84` 对得上，无“A测B”错位。
- D（建票 labelError + 正文区）：真覆盖，D1-D3 断言票仍 ok + labelError 落 auth，D4-D5 断言 `--body` 调用含区名/仓库名/标签名/origin（`:128-130`），D6 断言改正文失败仍 ok + labelError 在（`:132-134`，`bodyFails` 桩）。与 `issues-write.js:89-115,140` 对得上。注：D 的 view 桩（`:57-59`）回包正文已含区标题是“读回”桩，不影响 D4（D4 取证的是发出的 `--body` 调用，不是读回），无错位。
- E（工具层）：**半覆盖** —— E1/E3/E4/E5/E6 用真 `createDeckIssueCreate` + 桩 tracker 断言 partial/无假话/单聚合项/回归 ok（`:173-186`），与 `deckIssueCreate.js:123-185` 对得上；但 E2（`:174`）的 `labelError.message` 是测试手写的桩文案（含“读权限”），不是后端 `readonlyMessage` 真值，所以 E2 只证明了“工具把后端原话拼进 PARTIAL”，没证明“后端原话含权限说法”（后者由 C3/D5 证明）。链条合起来是全的，单看 E 是桩代真。
- F（改色批内一次）：真覆盖，F1-F4（`:215-218`）经真 `githubModule.create` + 10 标签同撞 404 断言全落 auth + 只真问一次 + 无 viewerPermission，与 `label-colors-ops.js:207-209,279-283` 对得上。
- G（能力位 + 文档 + 提示词）：G1/G2 读两 README 真文件断言关键词；G3-G6 断言两处文案含 fork / 英文无中文；G7-G11 经真 `createDeckContext` + 三种桩断言只读带位/可写无提示/Markdown 恒可写/GitLab 未知。**缺的是渲染断言**：G3-G6 只断言文案字符串，不含挂载/注入消费者（见场景三 (b)(c) 不一致）。
- **verdict：部分成立** —— 行为断言与实现对得上，无方向性错位；缺口是 C 的“问不出→原样”支、E2 的桩代真、G 的无渲染断言（详见文末清单）。

### E3. `tests/verify-github-label-colors.js` 是否真覆盖上述行为

- 与 #992 相关的断言：`:98-104` 权限单源 mock（`gh api repos/` 回 `.permissions`，注释写明判据是 push、viewerPermission 已退役）；`:269-270` 404+只读落 auth 且多问一次权限（`permQueries.length===1`）；`:271` 不再用 `repo view`；`:278-279` 10 条同撞只问一次；`:288-291` 问不出落 not-found + “无法确认”；`:404-405` 真 404 仍 not-found 回归。
- 与实现（`label-colors-ops.js:241-288`）逐条对上，无“A测B”错位。
- **verdict：成立，带 2 处测试内 stale（均不致当前红，但会误导后人）：**
  1. `:184` 命令白名单 `k === 'label list' || 'label edit' || 'repo view'` 里有已退役的 `repo view`、缺现行的 `api`。当前该节（ADMIN + 标签存在，无 404）不触发权限查询所以仍绿；一旦未来在成功路径加一次权限查询就会被误杀。建议改成允许 `api repos/`（或直接删 `repo view` 加 `api`）。
  2. `:220` 注释“五条改动里前四条都发了命令”，实际 `many` 只有 4 条（`:213-218`），`edits.length===4`（`:220`）是对的，是注释把“四”写成“五”。另 `:221` 断言 applied 2 / failed 2 与 4 条输入（bug 成 + wayfinder 500 败 + 带空格成 + 还没建败）对得上，数字无错，只是注释错。建议把“五”改“四”。

---

## 未覆盖到的渲染链路（清单）

> “文案已声明但无渲染出口 / 能力位只到 AI 为止”的逐项登记。建议 #992 后续票按此清单补挂载或改声称，不要在核查票里顺手改。

1. **`repo.permissions` 无面板消费者（能力位只到 AI 为止）。**
   - 声明：`src/host/tools/deckContext.js:119` 回包 `repo.permissions` + `:107-108` 两句 notes。
   - 消费者搜索：`src/client` 内 `repo.permissions / permissions.push / 这个仓库只读` 零命中；`getRepoPermissions` 全仓宿主调用仅 `deckContext.js:85` 一处。面板（检查页/横幅/标签配色弹窗）均无只读分支。
   - 后果：用户在面板上无前置只读提示；AI 不转述则感知为零。
2. **补标签弹窗（`NoRepoCard` 标签步骤 Modal）无挂载，注入代码不可达。**
   - 声明：`src/host/tracker/backends/github/index.js:129-131` `prompts.ensureLabels`；注入：`src/client/views/NoRepoCard.js:258-270` `doInject` + `:284` 按钮。
   - 消费者搜索：`h(NoRepoCard` 全仓零命中；`src/client/views/ListTab.js:243` 注明不再挂载。建仓成功进 Modal 的回调（`NoRepoCard.js:125-173`）不可达。
   - 后果：G3/G4 的 fork 指路在该入口触达率为零。
3. **顶部横幅不渲染 `fixes.hint`（fork 只在检查页行内）。**
   - 检查页行内渲染：`src/client/views/ChecksTab.js:173`（有）。
   - 横幅渲染：`src/client/views/shared/ChainRenderer.js:205-208` `ChainBanner` 只拼 title+desc（无 hint）；`src/client/statusbar/bannerChain.js` 同口径只读快照标题/描述。只看横幅的用户看不到 fork。
4. **`setLabels` “权限问不出 → 原样返回”支无门禁。**
   - 实现：`src/host/tracker/backends/github/labels.js:83`。
   - 门禁缺口：`tests/verify-992-readonly-labels.js` C 节无 `permsFails` + `setLabels` 用例（B4 只测 helper 本体）。改色链有对称用例（`verify-github-label-colors.js:288-291`），打标链缺。
5. **E2 系桩代真（工具层 PARTIAL 文案的权限原因来自手写桩）。**
   - 位置：`tests/verify-992-readonly-labels.js:149,174`。E2 只证明格式，权限说法的真值由 C3/D5 证明。链条合计成立，单节Label 为“半覆盖”已在 E2 节注明。
6. **`verify-github-label-colors.js:184` 白名单含退役命令、缺现行命令；`:220` 注释数错。**
   - 详情见 E3 节。当前不红，但属“断言与实现口径错位”的潜伏项。
7. **fork 两句文案非单源（改一漏一风险）。**
   - 位置：`src/host/tracker/backends/github/index.js:93`（fixes.hint）与 `:130`（prompts.ensureLabels）各写一份 fork 话术。当前同义，建议抽常量或保留 G3+G5 双断言防漂移。

---

## Verdict 总览

- 场景一：成立（2 处措辞注记）
- 场景二：成立（1 处测试缺口）
- 场景三：(a) 成立（1 处措辞注记）；(b) 部分成立（弹窗无挂载）；(c) 部分成立（能力位无 UI 渲染）
- 场景四：成立
- 额外：复数正则成立；`verify-992` 部分成立（3 处缺口）；`verify-github-label-colors` 成立（2 处 stale）

*按场景计：2 成立、2 部分成立（含场景三整体按部分成立计：三子项为 1 成立 + 2 部分成立）、0 不成立。*
