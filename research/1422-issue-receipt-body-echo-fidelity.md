# 研究：回执里的票面正文有没有被改写（#1422）

> 本文件只写从一手来源读到的事实，以及用可复跑探针实测到的数字。每条结论后面紧跟文件与行号。调查期间没有修改任何业务代码。

## 结论先行

**回执里的票面正文是后端返回值的原样透传；交给模型前只有一处改动——单段正文超过 8000 字符、整份明细超过 60000 字符时按上限截断，并在原地写明「……（本段已截断，原长 N 字符）」。全仓没有把术语换成中文、改写数字或归一路径大小写的代码。报告人描述的系统性改写，本机复现不出来。**

三条直接证据：

1. 读取回执把正文原样放进 `data.ticket.body`（`src/deck/tools/issue-get.ts:109`、`:242`）；改票回执的写后回读也原样放进 `data.ticket`（`src/deck/tools/issue-patch.ts:432`、`:448`）。
2. 渲染层只在超上限时截断并加标注（`src/deck/registration/register-options.ts:112-113`、`:124-158`）。用与门禁同一份 render 跑 #1422 的真实回执形状，明细解析回来的正文与 `gh api` 直读原文逐字节相等（679 vs 679）。
3. 连续两次 `deck_issue_get({ key: '1422' })` 的 `data.ticket.body` 都是 679 字符、sha256 前缀 `0fe5853b46e09301`，与 `gh api ... --jq .body` 逐字节相同；同一票多次读回也没有逐次变化。

## 一、现象与最小复现

票 #1422 报告人环境是 1.9.0-beta.9。报告内容：`deck_issue_get` / `deck_issue_patch` 回执中的 `ticket.body` 与 GitHub 实际正文存在系统性文本差异（术语被替换、数字漂移、路径大小写变化），同一票多次读回逐次不同。票面两条期望：回显与远端原文逐字节一致（或明确标注「回显为渲染摘要，非原文」）；`workRoute` 支持 `detail=off` 或按需裁剪。

最小复现（本机，未改代码，四步）：

1. 用 `deck_issue_get({ key: '1422' })` 连读两次，取回执 `data.ticket.body`，算长度与 sha256。
2. 用 `gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/1422 --jq .body` 直读同一票正文，做同样的计算。
3. 从 `src/deck/registration/register-options.ts` 导入 `deckAgentOutputSchemaRaw().render`（门禁用的是同一份），造一份与读取回执同形的值渲染成文本，再从明细 JSON 里取回正文比较。
4. 合成一段 9000 字符正文，走同一个 render，看截断后的长度与标注。

结果：

- 两次读取：679 字符、sha256 前缀 `0fe5853b46e09301`，两次逐字节相同。
- 与 gh 直读：679 字符、同一个 sha，逐字节相同；没有术语替换、数字漂移或路径大小写变化。
- 渲染后从明细取回正文：679 vs 679，逐字节相等（`exact true`）；整份渲染 1662 字符。
- 9000 字符正文：渲染出 8020 字符 = 前 8000 字符 + `……（本段已截断，原长 9000 字符）`。
- 改票回执的当前形状（`data.ticket` 一份 + 顶层三格摘要）：679 字正文只出现 1 次，整份渲染 977 字符。
- `workRoute` 取 core 档（8 条）时整票渲染 2233 字符，作为体量参考。

本机装的是 HEAD 构建（含 #1273 的 b29fe3b9），报告人环境是 1.9.0-beta.9 的发布 tag。读取路径与渲染上限在两版相同（2.1、2.2 引的代码在 tag 上一致）；#1273 只改「改票回执顶层放整票还是三格摘要」（2.3）。

## 二、证据链

### 2.1 读取：正文原样透传，不加工

`src/deck/tools/issue-get.ts:103-118` 的 `issueBrief` 把后端的 `issue.body` 直接写进 `body`（`:109`），不 trim、不归一、不替换：

```ts
function issueBrief(issue: Record<string, unknown> | null | undefined) {
  if (!issue || typeof issue !== 'object') return null
  return {
    // ……
    updatedAt: issue.updatedAt || '', closedAt: issue.closedAt || '', url: issue.url || '', body: issue.body !== undefined ? issue.body : null,
    // ……
  }
}
```

`data.ticket` 就是它（`:242`）。正文另外还有 `excerpt`（`:227-230`，前 2000 字，带 `section` 时取该节），但那是单独一格，不回流到 `ticket.body`。

### 2.2 渲染：只做显式截断，没有改写

`src/deck/registration/register-options.ts:108-113` 写明两个上限的用途：「压掉的地方一律原地写明，不让人误以为拿全了」。

```ts
const DETAIL_STRING_CAP = 8000
const DETAIL_TOTAL_CAP = 60000
```

`:124-158` 的 `projectDetail` 只做三件事：字符串超上限时按余量截断并加标注（`:127-128`），数组装不下时整项不送并说明丢了几项（`:141`），对象装不下时把字段名列进 `__未带回`（`:154`）。

```ts
const cap = Math.min(budget.left, DETAIL_STRING_CAP)
const s = v.length <= cap ? v : v.slice(0, cap) + '……（本段已截断，原长 ' + v.length + ' 字符）'
```

同一文件 `:162-163` 的注释说明 #1273 已把改票回执顶层的整票换成三格摘要；`:175-187` 的 `sameRenderedValue` 只负责内容去重，不改写内容。

### 2.3 改票回执：整票一份，顶层只放核对摘要

`src/deck/tools/issue-patch.ts:431-450`：写后回读 `back = t.get(...)`（`:431`）拿到整票，整票进 `data.ticket`（`:448`），顶层 `readBack` 只放 `{key, state, updatedAt}` 三格（`:439`、`:450`）。`:434-437` 的注释逐字说明了 #1273 的由来。

发布 tag 上的差别只有这一处：`git show v1.9.0-beta.9:src/deck/tools/issue-patch.ts` 的 `:442` 把整票放进 `data.ticket`，`:444` 又把同一个 `readBack` 放进顶层 `readBack`；渲染层靠内容判重（`:175-187`）把第二份压掉，正文不会因此出现两次。

### 2.4 全仓找不到改写正文的代码

在 `src/` 下按 grilling / map / 盘问 / 地图 / toUpperCase / toLowerCase / replace 等关键词检索，没有找到对正文做术语替换、数字改写或路径大小写归一的代码。GitHub 房自己改写正文只有一处：`src/tracker/rooms/github/issues-write.ts:160-168` 往正文写「## 待补标签（只读未落盘）」章节，与本票描述的差异无关。

### 2.5 报告人看到改写的另一种可能

插件回执与远端原文一致，而报告人看到的是「模型上下文里的文本」，那改写更可能发生在模型上下文这一侧：长会话里旧的工具回显会被压缩/摘要后放回上下文，摘要常伴随术语翻译、数字漂移与路径归一。本仓 `research/746-llm-and-direct-attr-base.md:66` 记录 DSH 会话事件里有 `purpose?: 'compaction' | 'session-title'`，`:127` 提到会话被压缩或含分支时会出现 `compaction/*` 与 `session/end-seed` 一类事件。这条只是线索，不是结论；要坐实需要报告人给出原始回执（见票面待拍板问题）。

## 三、与票面两项期望的对照

1. 「回执 body 回显与远端原文逐字节一致（或明确标注）」：已实现。正文原样透传；只有超过 8000 字符才截断，且截断处写明原长。#1422 全文 679 字符，实测逐字节一致。
2. 「workRoute 支持 detail=off 或按需裁剪」：按需裁剪已实现（#1303，随 1.9.0-beta.9 发布）：成功回执默认 `core`（票号、会话、时间，最多 20 条），传 `workRouteDetail: 'standard'` 才带标题与动作；参数定义见 `src/deck/tools/issue-patch.ts:83`，投影见 `src/deck/shell/work-path-readout.ts:214-231`（core 只映射三格，`:229` 把剩余条数记进 `omitted`），摘要句 `:272-286` 会在 core 档说明缺什么。没有单独的 `off` 档；成功回执里本来只剩摘要，不传详情。

## 四、复跑方法

探针不入库（本机放在 `%TEMP%\render-probe.mjs` 与 `render-probe2.mjs`），内容就是上面「最小复现」四步。关键命令：

```powershell
gh api repos/FeatherHunter/dsh-mattpocock-skills-deck/issues/1422 --jq .body
node --import ./scripts/ts-hook.mts <探针>.mjs
```

**一句话结论：当前代码的回执正文是原样透传，只有显式截断标注；票面两项期望都已实现，报告的「系统性改写」在本机复现不出来。**
