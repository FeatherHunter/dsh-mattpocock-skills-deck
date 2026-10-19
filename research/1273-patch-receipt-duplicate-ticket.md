# 研究：改票回执里同一张票被送了两份（#1273）

> 本文件只写从一手来源读到的事实，以及用可复跑探针实测到的数字。每条结论后面紧跟文件与行号。调查期间没有修改任何业务代码。

## 结论先行

**重复不是渲染层多送的，是工具回执本来就装了两份同一张票。同进程时，渲染靠「两个字段是不是同一个对象」把第二份压掉；一旦经过 JSON 边界（连接路、fetch 路、PTC 会话），这个判断必然失效，两份一起交给模型。**

三条直接证据：

1. 源头：`src/deck/tools/issue-patch.ts:384-396` 把同一次写后回读的整张票同时放进 `data.ticket` 与 `readBack` 两格，源码里这两格是同一个对象。
2. 去重判据：`src/deck/registration/register-options.ts:171-173` 判的是 `d.ticket === source.readBack`（引用相等）；`src/deck/registration/agent-row.ts:258-311` 的连接路与 fetch 路返回的是 JSON 解码后的新对象，引用相等不可能成立。
3. 实测：同一引用时正文出现 1 次、渲染 398 字符；过一遍 `JSON.parse(JSON.stringify(value))` 后正文出现 2 次、渲染 751 字符。实机 PTC 会话里 `data.ticket` 与 `readBack` 各 887 字节、JSON 内容逐字相同但不是同一个对象。

## 一、现象与最小复现

票 #1273 的正文原话是：「data.ticket.body 与 readBack.body 各一份，让大文本量 issue 出现多次，占用上下文。」说的就是改票工具 `deck_issue_patch` 的成功回执里，同一张票出现两份。

最小复现（本机探针，未改代码）：探针在 `.scratch/triage-1273/probe-render-dedup.mjs`（`.scratch` 不入库，方法如下，可照抄复跑）。它导入 `src/deck/registration/register-options.ts` 的 `deckAgentOutputSpec()`，造一份与 `deck_issue_patch` 真实回包同形的值，正文用 `'BODY-'` 重复 50 次（共 250 字符），然后数渲染文本里这段正文出现几次：

- 两份字段指向同一个对象：正文 1 次，渲染 398 字符。
- 两份字段先过 `JSON.parse(JSON.stringify(value))`：正文 2 次，渲染 751 字符。

实机回执（PTC 会话，本会话通过 `run_code` 调 `deck_issue_patch`）：顶层有 `data` 与 `readBack` 两格；`data.ticket` 与 `readBack` 各 887 字节，JSON 内容完全相同，但已不是同一个对象。整份紧凑回执 2640 字节，两份票面合计占 67.2%。

## 二、证据链

### 2.1 源头：一次写后回读，两个字段都装整票

`src/deck/tools/issue-patch.ts:384-396`：

```ts
const back = (typeof t.get === 'function' && !sc.outOfBudget()) ? await t.get(repo, key, {}, opCtx) : null
const readBack = (back && back.ok === true) ? back.data : null
// ……
value: {
  status: status,
  // ……
  data: { requested: Object.keys(wants).filter((k) => wants[k]), ticket: readBack },
  items: items,
  readBack: readBack,
  notes: notes,
  touched: touched,
}
```

写后回读的结果 `readBack` 是整张票（含正文、评论、标签、认领、边等字段），它同时被塞进 `data.ticket`（:394）和顶层 `readBack`（:396）。两格在源码里是同一个引用，没有复制，也没有裁剪。

回读用的是后端的默认读法：`t.get(repo, key, {}, opCtx)` 不传 `comments` 参数。GitHub 房间的查询里 `comments(first:50)` 是写死的（`src/tracker/rooms/github/queries.ts:30`）；`src/tracker/rooms/github/issues.ts:419-420` 只在调用方点名 `opts.comments.first` 时才截断。所以这张回读票面最多带 50 条评论，重复量随评论数增长。

### 2.2 壳把两格原样并进信封

`src/deck/shell/call-shell.ts:447-456` 的 `mergeOutcome` 分别赋值 `out.data = v.data`（:453）与 `out.readBack = v.readBack`（:456）；两格在 `src/deck/shell/call-shell-types.ts:240-243` 里就是信封的字段。壳不做任何去重或裁剪，工具给什么就透什么。

### 2.3 渲染层的去重只在同进程有效

`src/deck/registration/register-options.ts:160-181` 的 `detailBlock` 是交给模型前的那一次投影。它先放 `data`，再放 `items`，再放 `readBack`；去重只有一条判据（:171-173）：

```ts
const sameTicket = d !== null && typeof d === 'object' && !Array.isArray(d) && d !== undefined && d.ticket === source.readBack
if (source.readBack !== undefined && source.readBack !== null && !sameTicket) pick.readBack = source.readBack
```

这段代码的意图写在 :161-163 的注释里：`deck_issue_patch` 已经把同一份放进 `data.ticket`，两处都送会白吃预算，所以「认得出同一份就只送一次」。问题在判据本身——「同一份」被定义成了「同一个对象引用」。

对应门禁 `tests/verify-deck-render-detail.ts:146-152` 只用同一个引用构造夹具：

```ts
const back = { key: '759', state: 'closed', body: '正文' }
const dedup = all({ status: 'ok', text: '票改好了。', data: { ticket: back, requested: ['state'] }, readBack: back })
```

所以门禁绿只能证明「同进程同引用」这一种情况。

### 2.4 生产路会经过 JSON 边界

`src/deck/registration/agent-row.ts` 的 `makeDelegatedExecute` 有三条路：

- 第一路，同进程共享格（:340-378）：直接调宿主里那张表的 `run`，返回的是内存里的对象，引用保留。
- 第二路，连接（:258-279）：`rpc.call('/api', 'dsws', { method: 'deckExec', payload })`，回包经连接层解码，是新的对象。
- 第三路，fetch（:281-311）：`res.json()`（:305），明确是 JSON 解码后的新对象。

三条路的选择顺序在 :380-389：同进程格优先，其次连接，最后 fetch。插件默认工具走连接或 fetch 时，工具结果到渲染函数手里之前已经过了一次 JSON 化，`d.ticket === source.readBack` 必然为假。

PTC 会话也一样。新建会话必须 PTC 的判据写在 `docs/adr/20260901-newsession-must-be-ptc-gate.md`；PTC 会话里模型经 `run_code` 拿到的是工具的原始信封（JSON 值），不是渲染后的文本块。本会话实测拿到的回执就是顶层含 `data` 与 `readBack` 的原始对象，两格内容相同但引用不同。

**所以：只有同进程共享格这一路去重生效；连接路、fetch 路与 PTC 会话都会把两份交给模型。**

### 2.5 为什么 #809 的门禁没抓到

#809 修的是「渲染只取 `value.text`，`data` 里的明细全部丢掉」，去重是同一处顺手加的便利逻辑。当时的手工夹具用的是同一个引用（见 2.3），没有 JSON 往返用例。

golden 回执夹具也把两份逐字冻结了：`tests/tracker-contract/fixtures/golden-receipts/08-deck_issue_patch.golden.json` 里，`data.ticket` 起于 :26、body 在 :29；`readBack` 起于 :121、body 在 :124；两处 comments 分别在 :31 与 :126，逐字相同。`tests/verify-golden-receipts.ts` 归一化后逐字节比对（固定会话、固定时钟，`--update` 只在有意改行为时才跑），所以这个测试通过恰恰说明两份重复是现行契约的一部分，而不是异常。

门禁绿与重复同时成立，原因就是：门禁只钉同进程同引用，也没钉「JSON 往返后不许重复」。

### 2.6 同族的另一处，本票未报，供参考

`src/deck/tools/issue-get.ts:214-243` 的读票回执里，`ticket.body`（`issueBrief` 的字段，:100-108）、`excerpt`（正文前 2000 字）与 `section.text`（指定小节时就是 excerpt）在短正文或指定小节时可能是同一段文字的最多三份。它与本票不同：excerpt 是设计上要的摘录，重复程度取决于正文长度与是否点小节。本票只报改票工具。

## 三、根因候选与置信度

按可能性从高到低：

1. **主因（高，探针与实机回执都已确认）**：`deck_issue_patch` 把同一张票同时装进 `data.ticket` 与 `readBack`，渲染去重只在同进程有效，跨 JSON 边界后两份都送。证据见 2.1-2.4。
2. **机制层次因（高）**：`detailBlock` 用引用相等当「同一份」的判据，跨进程/连接/fetch 必失效。这是 #809 修复留下的盲区，不是新写的 bug。
3. **放大因素（高）**：回读票面默认带最多 50 条评论（`queries.ts:30`、`issues.ts:419-420`），重复量随票变大；渲染的明细总预算是 60000 字符（`register-options.ts:113`，单段上限 8000，:112），两份会双花预算，第二份在末尾还可能被截成半份，人看到的更乱。
4. **测试缺口（高，解释为什么长期没被发现）**：`verify-deck-render-detail.ts:146-152` 只有同一引用用例；golden 08 把两份冻结；没有 JSON 往返回归用例。

排除项：

- **不是后端被同一动作调了两次**：`issue-patch.ts:384` 只有一次最终回读；文件里其它 `t.get`（:245、:263、:293、:325、:367）各自用于进度基线或关/开状态核对，结果不会进回执。重复来自工具把同一份主动放进两格。
- **不是渲染层凭空多造**：渲染只做投影，输入里本来就有两份。
- **不是 PTC 独有**：默认工具路的连接/fetch 同样 JSON 化，同样失效。

## 四、影响范围

- 触发面：所有经过连接路或 fetch 路的 `deck_issue_patch` 调用（默认工具路径），以及 PTC 会话（按 ADR，新建会话必须是 PTC）。同进程共享格这一路不受影响。
- 重复量：整张回读票面（正文、最多 50 条评论、标签、认领、边等字段）。小票实测 887 字节 × 2；按读票工具的量级推算，正文 4898 字的票，读回票面 JSON 约 9993 字节，改一次就多带约 10KB。回执本身 2640 字节的小票，两份票面占 67.2%。
- 成本性质：不是功能错误（票确实改对了），是每次改票多付一份票面的上下文与 token；票越大付得越多。
- 同族未报：读票工具的正文最多三份（2.6），不在本票范围。

## 五、修复方向候选（诊断阶段未改代码，只比较）

**A（推荐）源头只留一份**：`data.ticket` 保留整票（消费方依赖它，见下），`readBack` 改成核对用的少量字段，或者干脆不再单列（回读能力由 `data.ticket` 承载，它本来就是写后读回的结果）。渲染的「写后回读看得见」改成从 `data.ticket` 读。

- 消费方约束：`src/deck/shell/work-path-record.ts:123-129` 从 `data.ticket` 读 key/title/effortId，key 对不上就整条作废；`tests/verify-1261-work-route-receipt.ts:186-201` 固定了「改票回执 `data.ticket` 带 title，写进盘上」。所以 `data.ticket` 不能删、不能只剩摘要。
- 顶层 `readBack` 的消费面：grep 全仓只有壳原样并信封（`call-shell.ts:456`）、渲染展示（`register-options.ts:171-173`）、测试与 golden 夹具；没有业务逻辑读它。去掉或压短只影响展示与夹具。
- 代价：golden 08 要重建（属有意改行为）；`verify-deck-render-detail.ts:110-112` 那条「写后回读看得见」的断言要改成看 `data.ticket`；`verify-1106-deck-surface.ts:89` 的信封字段清单仍含 `readBack`（信封那格保留为 null 即可，清单不用动）。

**B 保留两份但把 `readBack` 压成核对摘要**（如 key/state/updatedAt）：改动小，重复量降到可忽略；但「同一张票两个对象」的形状还在，下次有人按引用去重仍然会踩。

**C 只改渲染去重**（比内容而不比引用）：不解决源头重复，也救不了 PTC 里的原始信封；JSON 逐字比较或规范比较每次都多一次序列化成本。不建议单独做。

三个方向的共同验收：JSON 往返后整票只出现一份；补一条「先 `JSON.parse(JSON.stringify(value))` 再渲染」的回归用例；回执形状若变了就重建 golden 08 并说明；现有门禁全绿。

## 六、既有笔记与本次调查的关系

仓内既有的 `research/deck-issue-get-detail-loss-report.md` 回答的是 #809 那一类问题——渲染函数只取一句摘要，`data` 里的明细全部丢掉。结论方向与本票相反：那次是「输出被丢」，本票是「输入重复」。它不覆盖「同一份装进两格、跨 JSON 边界去重失效」这件事，所以本次没有复用它的结论，按 /research 的规则重新查了一手来源。本次证据全部来自当前 HEAD `87c57dce` 的源码与实机回执；探针与原始回执留在本地 `.scratch/triage-1273/`，不入库。

## 七、分流结论

按现有证据，这张票是「已确认、可复现、修复边界清楚」的 bug：转 `ready-for-agent`，修复方向推荐 A，验收按第五节的共同验收写进代理简报。同族的读票工具重复不并入本票。
