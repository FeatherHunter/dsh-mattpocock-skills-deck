# deck_issue_get 明细丢失调查报告

调查对象：`dsh-mattpocock-skills-deck` 插件，工具 `deck_issue_get`
现场：`deck_issue_get({key:"502", comments:50})` 只回一句摘要，没有正文、评论、标签、认领、边明细。
调查纪律：只读，未修改任何既有文件。

---

## 一、结论先行

**明细是「完整取回来了，装进了返回值，然后在最后交给模型看的那一步被丢掉的」。**

不是请求时没要字段。GraphQL 查询里 body、comments、labels、assignees、parent、blockedBy 全部都选了；
GitHub 返回的完整票据被 `normalizeIssue` 归一后放进 `value.data`；`value.data` 确实带着
`ticket` / `excerpt` / `comments` / `relations` / `landings` / `dependenciesRaw` 一路传到了 agent 层。
**丢在渲染函数**：`src/shared/deck-tools/agent-register.js:82-85` 的 `deckAgentRender` 只取
`value.text` 拼成一个文本块，其余整块丢弃。模型能看到的通道只有这一个。

丢掉的原因不是疏忽，是一条**为另一个工具定下的规则被套用到了全部九个工具上**：
`src/shared/deck-tools/agent-register.js:88-89` 的注释写明「渲染只取那一句话，避免把整张地图的子票清单铺进历史」，
这句话针对的是 `deck_map_snapshot`（它的 `data` 里是整张地图的子票清单），
但渲染函数是九个工具共用的同一个 `deckAgentRender`。

所以：**描述承诺的是数据契约，渲染实现的是展示策略，两者从未对齐。**

---

## 二、证据链（自上而下）

### 第 1 层：工具描述——承诺了明细

`src/host/tools/deckIssueGet.js:12`

```js
description: '同属 dsh-mattpocock-skills-deck 插件的 ISSUE 与 map 管理能力，……读一个 ISSUE 的完整关系：正文、评论、label、assignee 与 parent 和 blockedBy 边，每条边标出落点。',
```

### 第 2 层：网络请求——明细**要了**，而且要全了

`src/host/tracker/backends/github/queries.js:14-30`（单票字段清单 `ISSUE_FRAGMENT`）：

```js
export const ISSUE_FRAGMENT = [
  'number', 'title', 'state', 'body', 'url', 'createdAt', 'updatedAt', 'closedAt',
  'author{login avatarUrl __typename ... on User{name} ... on Organization{name}}',
  'assignees(first:50){nodes{login name avatarUrl __typename}}',
  'labels(first:50){nodes{name color description}}',
  'milestone{title description state dueOn}',
  'comments(first:50){nodes{id author{login avatarUrl __typename ... on User{name} ... on Organization{name}} authorAssociation body createdAt updatedAt lastEditedAt}}',
  'parent{number}',
  'blockedBy(first:50){nodes{number title state}}',
].join(' ')
```

`src/host/tracker/backends/github/queries.js:43-47`（单票查询 `GET_QUERY` 用整份 fragment）：

```js
export const GET_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){ ${ISSUE_FRAGMENT} }
  }
}`
```

实际发出去的命令构造在 `src/host/tracker/backends/github/issues.js:268-270`：

```js
const query = GET_QUERY
const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${parsed.owner}`, '-F', `name=${parsed.name}`, '-F', `number=${num}`]
const r = await c.execGh(args, { cwd: ctx && ctx.cwd })
```

**这一层是全的。body、comments、labels、assignees、parent、blockedBy 一个不落。**

### 第 3 层：取回与归一——也全

`src/host/tracker/backends/github/issues.js:334-339`：

```js
let normalized = normalizeIssue(issue)
if (opts && opts.comments && typeof opts.comments.first === 'number' && normalized.comments && normalized.comments.length > opts.comments.first) {
  normalized.comments = normalized.comments.slice(0, opts.comments.first)
}
return { ok: true, data: normalized }
```

### 第 4 层：工具主体——取回并存进了 `data`

`src/host/tools/deckIssueGet.js:79`（发起取数）：

```js
const got = await c.tracker.get(repo, key, { comments: { first: first } }, c.opCtx)
```

`src/host/tools/deckIssueGet.js:92-95`（取到的票与关系）：

```js
const issue = got.data || {}
const dep = typeof c.tracker.getDependencies === 'function' ? await c.tracker.getDependencies(repo, key, {}, c.opCtx) : null
const dependencies = (dep && dep.ok === true) ? dep.data : null
const rel = relationsOf(issue, dependencies)
```

`src/host/tools/deckIssueGet.js:99-102`（正文取节与截断）：

```js
const bodyText = typeof issue.body === 'string' ? issue.body : ''
const sec = sectionOf(bodyText, a.section)
...
const excerpt = (sec.found ? sec.text : bodyText).slice(0, sec.found ? 2000 : 2000)
```

### 第 5 层：摘要那一句的组装位置（问题 1 的答案）

**`src/host/tools/deckIssueGet.js:108`**：

```js
text: '票 ' + key + ' 读回来了：状态 ' + stateText + closedText + '，父票 ' + (rel.parentKey || '（没有）') + '，被阻塞 ' + rel.blockedBy.length + ' 条，阻塞别人 ' + rel.blocking.length + ' 条。',
```

这一行就是你看到的那句话，逐字对上。`stateText`（:103）来自 `issue.state`，
`closedText`（:104）来自 `issue.closedAt`，`rel` 来自 :95 的 `relationsOf`。
**这解释了为什么状态、关闭日期、父票、阻塞计数全都正确**——这些恰好是 `text` 字符串唯一用到的那几个字段。

### 第 6 层：明细确实被放进了返回值（问题 2 的答案）

**`src/host/tools/deckIssueGet.js:105-127`**，与 `:108` 同一个 `return`：

```js
return {
  value: {
    status: DECK_STATUS.OK,
    text: '票 ' + key + ' 读回来了：……',
    data: {
      ticket: issueBrief(issue),                 // :110 —— key/title/state/type/labels/assignees/updatedAt/closedAt/url/body
      excerpt: excerpt,                          // :111 —— 正文前 2000 字
      section: sec.found ? { name: sec.name, text: excerpt } : null,   // :112 —— 指定节的正文
      relations: rel,                            // :113 —— parentKey / blockedBy / blocking
      landings: {                                // :114-119 —— 每条边的落点判定
        parent: rel.parentKey ? EDGE_LANDING.CONTRACT_PARENT_FIELD : EDGE_LANDING.UNKNOWN,
        blockedBy: rel.blockedBy.length ? EDGE_LANDING.CONTRACT_BLOCK_FIELD : EDGE_LANDING.UNKNOWN,
        caveat: '……',
      },
      comments: Array.isArray(issue.comments) ? issue.comments.slice(0, first) : [],   // :120 —— 评论全文
      dependenciesRaw: dependencies,              // :121 —— 依赖边原文
    },
    notes: notes,
    touched: [],
  },
  claimed: { requests: 2, points: 6 },
}
```

`ticket` 的构造在 `src/host/tools/deckIssueGet.js:26-34`（`issueBrief`），它把 labels、assignees、body 都带上了。
`relations` 的构造在 `src/shared/deck-tools/edges.js:61-70`（`relationsOf`）。

**所以：明细取回来了，放进了 `value.data`，一步都没丢。**

### 第 7 层：代执行与电话——原样透传，没有裁剪

`src/host/platform/deckExec.js:83-91`（宿主电话，整包返回）：

```js
const value = pickValue(back)
...
return value
```

`src/host/platform/deckToolsRow.js:302-303`（行模块第一路，同进程共享格）：

```js
const value = back && back.value !== undefined ? back.value : back
if (value && typeof value.status === 'string' && typeof value.text === 'string') { notePath('cell'); return value }
```

`src/host/platform/deckToolsRow.js:213-222`（`pickHostValue`，第二、三路的回包拆包）同样只挑 `value` 整体，不拆字段。

**这一层也没有丢。**

### 第 8 层：丢在这里（问题「丢在哪一层」的答案）

**`src/shared/deck-tools/agent-register.js:82-85`**：

```js
function deckAgentRender(args, value) {
  const text = value && typeof value.text === 'string' ? value.text : ''
  return [{ type: 'text', text: text }]
}
```

`value.data` 在这里被彻底丢掉，只剩 `value.text` 一个字符串块。

同一个文件 `:88-89` 的注释说明了动机：

```js
 * 输出的固定形状（官方写法用）：每次调用都带状态与一句话（壳里保证这两格永远是字符串），
 * 其余原样透出。渲染只取那一句话，避免把整张地图的子票清单铺进历史。
```

注释里「其余原样透出」说的是 **schema**（`:100` 的 `additionalProperties: true` 确实放行），
但 **render 并不透出**。schema 放行 ≠ 内容送达模型——这正是描述与实现脱节的地方。

这个渲染函数被两处注册入口共用，两条路都堵死：

- **行模块**：`src/host/platform/deckToolsRow.js:151` → `output: deckAgentOutputSchemaRaw()`
- **宿主自举**：`src/host/refresh/wiring.js:301` 调 `hookDeckAgentTools`
  → `src/shared/deck-tools/agent-register.js:260` → `output: deckAgentOutputSchemaRaw()`
  （`wiring.js:301` 传的 `loadDefineTool` 返回 `Promise.resolve(null)`，所以走退路分支，
  不会走 `:137` 的 `deckAgentOutputSpec()`；但两者用的是**同一个** `deckAgentRender`，见 `:102` 与 `:123`。）

**无论哪条注册路径生效，模型看到的都只有那一句话。**

---

## 三、问题 4：有没有落盘或缓存可以显式读取

**没有 `deck_issue_get` 结果的缓存。** 全仓 `writeFile` / `writeFileSync` / `appendFile` / `mkdtemp` / `tmpdir` 扫描结果里，
与本链路相关的只有 `src/host/refresh/sessionTickets.js`，而它**只记票号不记内容**：

`src/shared/refresh/chain.js:286-294`（落盘形状）：

```js
const key = chainTicketKey(e ? e.ticketKey : "")
...
entries.push([key, effort, ..., action])
...
shards.push({ s: shard.shardId, r: shard.rootHash, b: shard.backend, e: entries.slice(0, CHAIN_SESSION_CAP) })
```

路径规律见 `src/host/refresh/sessionTickets.js:24-26` 与 `:40`，
`src/host/repoKeys.js:218`：

- 缓存根目录：`<DSH 进程启动目录>/.dsh-mattskillsdeck-cache/`
  （注意拼写是 `mattskillsdeck`，**没有**中间那个连字符；`.dsh-mattskills-deck-cache` 这个名字在盘上不存在）
- 处理链落盘：`<缓存根>/session-tickets.json`（`SESSION_TICKETS_FILE`，`sessionTickets.js:40`）
- 命名守护落盘：`<缓存根>/naming-guardian.json`（`src/host/namingGuardian.js:15`）
- 日志落盘：`<缓存根>/logs/`（`src/host/logStore.js:7`）

**另有一份含完整正文的缓存，但它不是本次工具的产物，而是面板的快照：**

- 路径：`<缓存根>/<owner>__<repo>.json`，本机实测
  `D:\dsh-plugin\dsh-mattpocock-skills-deck\.dsh-mattskillsdeck-cache\FeatherHunter__dsh-mattpocock-skills-deck.json`（7.3 MB）
- 内容：`cacheFormat: 3`，`issues` 共 342 条，每条的字段为
  `key, type, title, state, body, url, createdAt, updatedAt, closedAt, parentKey, labels, assignees, comments, blockedBy, reason, author, ...`
  —— **带 body 和 comments 全量**，人可以直接打开读。
- **但本机这份快照里没有 502**（`updatedAt` 是 2026-08-29，而 502 是 2026-09-29 关闭的，快照早于它）。
  所以它不能用来复现或绕过本次问题，只能说明「这份明细确实在盘上存在过，只是不在这个票上、也不是这条工具写的」。

`.scratch/` 下的目录（`chain-probe/srccopy/`、`576-lab-*`、`1726` 等）是测试脚本的产物目录，
内容是源码副本与实验夹具，**与票面数据无关**。

---

## 四、问题 5：描述为什么和实现不一致

描述定义在 `src/host/tools/deckIssueGet.js:12`（工具 `definition` 对象内），
它描述的是**数据契约**（后端该取回什么）；渲染在
`src/shared/deck-tools/agent-register.js:82-85` 决定的是**给模型看什么**。

两者从来没有被绑在一起过。设计上的取舍写在 `agent-register.js:88-89`：
为了不让 `deck_map_snapshot` 把整张地图的子票清单铺进对话历史，渲染统一只取一句话。
`deck_issue_get` 与 `deck_map_snapshot` 共用了这一个渲染函数，于是
「不让地图刷屏」这条规矩**顺带把「读一张票」也降级成了一句话**。

工具描述没有跟着改，于是描述继续承诺明细，实现继续只给一句话——**描述是过期的承诺**。

**还有一处相关的死代码**：`src/host/tools/deckIssueGet.js:4-5` 的文件头注释称

```
// 「优先读宿主已有快照」落在实现上是：宿主把快照缓存（snapshot.js 的 get/getDependencies）通过
// deps.readThrough 注进来时先用它，没注入就现读；
```

但全仓搜索 `readThrough` **只有这一行注释命中，没有任何代码读它**。
即「优先读宿主已有快照」这条设计**从未实现**，每次调用都实打实走网络。
这与本 bug 不是同一个原因，但如果要修，顺手可以把它接上——面板那份快照里本来就有 body 和 comments。

---

## 五、修复建议方向（未改任何代码）

**首选：按工具分派渲染函数，不要让九个工具共用一个「只回一句话」的渲染。**

1. 在 `src/shared/deck-tools/agent-register.js` 里保留 `deckAgentRender` 给
   `deck_map_snapshot` / `deck_issue_list` 这类「清单型」工具用（它们当初就是为防刷屏才这么写的），
   另加一个给 `deck_issue_get` 用的渲染：先出那一句摘要，再把 `value.data` 里的
   `ticket`（去掉 body）、`excerpt`、`comments`、`relations`、`landings` 依次编成文本块。
2. 注册处按名字选渲染：`src/host/platform/deckToolsRow.js:146-153`（`toRawRegistration`）
   与 `src/shared/deck-tools/agent-register.js:239-263`（`buildAgentToolOptions` / 退路分支）
   都是拿到 `definition.name` 就能分派的现成位置。
3. **必须同步改测试**：`tests/verify-deck-tools-agent-register.js:172-174` 现在断言
   `rendered.length === 1`，等于把这个丢数据的行为钉死了。修的时候要改成按工具分别断言。

**配套考虑：**

- **总量封顶**。`excerpt` 已经截到 2000 字，但 `comments` 最多 50 条、每条都带完整 body，
  一次 `deck_issue_get` 可能带回几万字。建议加一个总字符预算（例如正文 2000 + 评论按总长截断），
  并在截断时如实说一句「评论还有 N 条没带回」，别让模型以为看全了。
- **修描述或修实现，二选一写清楚**。若决定维持「只回摘要」，就把 `deckIssueGet.js:12` 的描述改成
  实际行为；若决定给明细（推荐），描述可以顺带补一句返回结构，让模型知道去 `data` 里找。
- **可选的省流优化**：把 `deckIssueGet.js:4-5` 注释承诺、但从未实现的 `deps.readThrough` 接上，
  优先读宿主已构建的快照（面板那份快照本来就带 body 与 comments），能同时省一次网络往返。
  注意这需要先解决快照新鲜度问题——本机那份快照的时间戳比票的关闭时间还早一个月。

---

## 六、src 与发布产物的一致性

`src/` 与 `package/lib/` 是两份，本次涉及的五个文件**逐行完全相同**（`Compare-Object` 无差异）：

| 源码 | 产物 | 结果 |
|---|---|---|
| `src/host/tools/deckIssueGet.js` | `package/lib/tools/deckIssueGet.js` | 完全相同 |
| `src/host/platform/deckToolsRow.js` | `package/lib/platform/deckToolsRow.js` | 完全相同 |
| `src/host/platform/deckToolsAssembly.js` | `package/lib/platform/deckToolsAssembly.js` | 完全相同 |
| `src/host/platform/deckExec.js` | `package/lib/platform/deckExec.js` | 完全相同 |
| `src/shared/deck-tools/agent-register.js` | `package/shared/deck-tools/agent-register.js` | 完全相同 |

**结论：发布产物没有落后于源码，用户装到的包就是这份代码，bug 在线上同样存在。**
（产物目录比源码少一层 `host/`，映射关系是 `src/host/X` → `package/lib/X`；
`queries.js` 未进入产物目录，不在本次比对范围内。）

---

## 七、逐问作答索引

| 问题 | 答案 | 证据 |
|---|---|---|
| 1. 摘要那句话在哪一行组装 | `src/host/tools/deckIssueGet.js:108` | 见上文第 5 层 |
| 2. 有没有真去取 body/comments/labels/assignee | 取了，全都在 `value.data` 里（:110-121），一步没丢 | 见上文第 2、3、6 层 |
| 3. 是不是上游只请求了聚合字段 | **不是。** GraphQL 选了 body、comments(first:50)、labels、assignees、parent、blockedBy 全量 | `queries.js:14-30, 43-47`；`issues.js:268-270` |
| 4. 有没有落盘/缓存可显式读取 | 没有本次工具的缓存。处理链只存票号（`chain.js:286-294`）。面板快照 `<缓存根>/<owner>__<repo>.json` 带 body 与 comments，但与本工具无关，且本机那份不含 502 | `sessionTickets.js:24-26,40`；`repoKeys.js:218`；`chain.js:279-297` |
| 5. 描述在哪定义、为何不一致 | `src/host/tools/deckIssueGet.js:12`；渲染 `agent-register.js:82-85` 是为 `deck_map_snapshot` 防刷屏而设，被九个工具共用，描述从未随之修改 | 见上文第 8 层与第四节 |
