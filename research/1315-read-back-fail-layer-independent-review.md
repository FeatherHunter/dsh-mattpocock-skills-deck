# #1315 读回失败层次的独立复核

> 本文件只写从一手来源（源码、官方文档、盘上的真实文件）读到的事实，每条结论后面紧跟文件与行号。全文使用完整句子，只用术语表里已有的词，或者不需要解释的大白话。
>
> 调查时间 2026-10-21（Asia/Shanghai）。调查时的 HEAD 是 `15048de3`（「把 main 最新的研究笔记合入集成分支，保持与主线同步」，提交时间 2026-10-21 10:22:13 +0800）。
>
> 本文件是**独立复核稿**，由一个独立子代理另起一份调查写成：它先自己独立定位，再回头逐条核对主笔记 `research/1315-read-back-fail-layer.md`。调查期间没有改任何源码，没有改任何 issue 的状态。复现脚本写在临时目录 `D:\Temp\dsh-fs-1315\`（不在本仓内），脚本原文抄在第 6 节里。
>
> 主笔记已按本稿指出的四处订正改过一遍，订正清单记在主笔记的第 10 节。
>
> 下文 `dsh-fs-local/lib/index.js:NNN` 这种写法，指的是 DSH 桌面版安装包归档 `D:\DeepseekHarness\resources\app.asar` 里的 `dsh/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js`。归档里的文件用系统自带的 Node 直接读不到，本次先把归档头那一段 JSON 读出来、按里面的偏移取出文件内容，落到临时目录再逐行读的。

## 1. 结论

读回失败（失败行里的 `op=readBack`、`reason=read-fail`）发生在**打开文件**这一层，读的是**日志开关文件** `<缓存目录>/log-switch.json`，不是日志正文文件。

链条是这样：插件宿主每装配一次就建出一个日志实例，那个实例自己去读一次开关文件（`loadSwitch()`）；文件不存在时，DSH 的文件服务抛 `cannot read "<路径>": not found`（错误码 `FS_NOT_FOUND`）；日志库把这个异常整个吞掉，只记一条不带错误原文的 `log.persist.fail`。

票面问的三个候选里，答案是第一个：

- **不是「按行解析」**：开关文件解析失败抛的是 `SyntaxError`，整个 `dsh-log` 包里只有一处会把异常记成 `read-fail`（`node_modules/dsh-log/dist/engine/switch-file.js:43`，本仓旧实现在 `src/host/logStore.ts:233`），这一处记的是什么内容都不区分。
- **不是「并发写入后的读回窗口」**：并发写者观测记的是另一种组合（`op=writeBatch`、`reason=foreign-write`，`node_modules/dsh-log/dist/engine/pipeline.js:743` 与 `:752`），开关文件所有权冲突记的是 `op=persistSwitch`、`reason=dir-conflict`（`node_modules/dsh-log/dist/store.js:108`）。这两族都不带 `op=readBack`。
- **是「打开文件」**：读的是开关文件，文件不存在就抛错，错误被吞掉，只留下一条笼统的失败行。

还有三个补充事实，都会影响后面的修法选择：

1. **每个日志实例记一条**，不是每个进程记一条，也不是写一行日志记一条：日志库每建一个实例就自己读一次开关，「已读」标记是每个实例各存一份的（`node_modules/dsh-log/dist/engine/switch-file.js:26-28`），跟这个实例写了多少行日志无关。宿主每装配一次就建一个新实例（`src/host/index.ts:326-334`）。
2. **触发条件只有一个：缓存目录里没有开关文件。** 开关文件是用户真的拨过开关之后才被写出来的（`node_modules/dsh-log/dist/engine/switch-file.js:47-87`，落盘那一步在 `:73`），没拨过就永远没有。
3. **失败行本身信息不足**：它既不带错误原文也不带目录（`dirHash` 是空串的短指纹 `00001505`），所以光看日志分不出「文件不存在」「文件存在但内容坏了」「文件存在但不是普通文件」这三种情况。

另外还有一条连带后果：**开关读不到就等于开关关着，日志里就只剩常驻事件。** 开关关着时，错误、告警与常驻事件照常落盘，其余信息级事件不落盘（`node_modules/dsh-log/dist/engine/pipeline.js:192-198` 的 `isEnabled`，常驻名单 43 条在 `node_modules/dsh-log/dist/core/resident.js:22-35`）。同一天的两个实例对比：

| 2026-10-20 | 总行数 | 事件种类 |
| --- | --- | --- |
| 开发检出实例（开关文件不存在） | 1300 | 6 |
| 已安装实例（开关文件存在且为开） | 859596 | 93 |

## 2. 失败行的字段形状

开发检出实例 2026-10-20 的日志里，两条相邻的行（`ts` 是 epoch 毫秒，逐字取自 `.dsh-mattskillsdeck-cache/logs/2026-10-20.log`）：

```json
{"v":3,"ts":1792504330276,"level":"info","event":"host.start","fields":{"pid":52432,"startedAt":"2026-10-20T13:52:10.216Z","dir":"D:\\dsh-plugin\\dsh-mattpocock-skills-deck\\.dsh-mattskillsdeck-cache","os":"win32"}}
{"v":3,"ts":1792504330301,"level":"warn","event":"log.persist.fail","fields":{"pluginId":"wf","op":"readBack","reason":"read-fail","dirHash":"00001505"}}
```

两条相隔 25 毫秒。失败行只有四个键（`node_modules/dsh-log/dist/engine/pipeline.js:485-500`）：插件标识 `wf`、`op=readBack`、`reason=read-fail`、`dirHash=00001505`。这个 `dirHash` 是目录的短指纹（`node_modules/dsh-log/dist/core/ids.js:14-26` 的 djb2 算法），目录为空串时算出来就是 `00001505`——也就是说，**这条失败行没有带上任何目录信息**。

补一句形状的历史：2026-10-15 之前的同类行只有三个键（没有 `pluginId`），因为日志库在建库配置里没有插件标识时不补这个键（`node_modules/dsh-log/dist/engine/pipeline.js:489-495`）。本仓的旧实现在 `src/host/logStore.ts:46-51` 有一模一样的短指纹算法。

## 3. 从插件宿主到失败行的完整调用链

1. `src/host/index.ts:326-334`：每次装配都新建一个日志实例（取日志库的承诺变量声明在装配函数内部，每次装配都是一份新变量），装配好就调 `h.loadSwitch()`、再调 `h.writeStartupHeader()`。开关是每个实例各读一次。
2. `node_modules/dsh-log/dist/engine/switch-file.js:25-46`：`loadSwitch()` 的 try 块里依次是
   - `:30` `getCacheDir()`，拿不到目录就直接返回；
   - `:33` `resolveTarget(joinLogPath(dir, config.switchFileName))`，拼出开关文件的目标；
   - `:34` `await readTarget(target)`，真正去读；
   - `:37` `JSON.parse(txt)`，解析开关内容；
   - `:41-44` `catch (e) { void e; notePersistFail('readBack', 'read-fail', ''); }`——**异常对象被整个丢掉**（`void e`），失败行因此没有错误原文。
3. 开关文件名与日志目录名：`node_modules/dsh-log/dist/config/constants.js:20-21` 定义 `logs` 与 `log-switch.json`，`node_modules/dsh-log/dist/config/resolve.js:21-30` 在插件标识为 `wf` 时原样采用这两个名字。所以开关文件就在 `<缓存目录>` 根下，不在 `logs` 目录里（路径的拼法见 `node_modules/dsh-log/dist/engine/io.js:78-89`）。
4. 读文件这一步本身：`node_modules/dsh-log/dist/engine/io.js:110-119` 的 `readTarget` 走宿主给的文件服务 `fs.readText`。
5. DSH 的文件服务：`dsh-fs-local/lib/index.js:825-830` 的 `readText` → `:369-375` 的 `readWholeText` → `:349-361` 的 `statRegularFile`。文件不存在时，`:357` 抛 `new FsError(`cannot ${verb} "${target.displayPath}": not found`, "FS_NOT_FOUND")`，这里 `verb` 是 `"read"`（`readWholeText` 在 `:370` 传进去的），`displayPath` 是给人看的显示路径。同一个函数在 `:359` 对「不是普通文件」抛 `FS_NOT_REGULAR_FILE`。
6. 失败行本身由 `node_modules/dsh-log/dist/engine/pipeline.js:159-163` 的 `notePersistFail` 记下，形状是 `{op, reason, dirHash, at}`；落盘那行在 `:479-500` 拼。

两点补充：

- 本仓还留着一份旧实现（包不可用时才回退过去，`src/host/index.ts:327`），它有**一模一样的一行**：`src/host/logStore.ts:233`。所以无论走包还是走旧实现，现象都一样。
- 插件宿主给日志包的文件服务口里**没有追加写方法**（`src/host/platform/index.ts:140` 的注释写着透传的是 lstat、readText、writeText、resolve、listDir、stat）。日志包因此走「整份读出来、改完再整份写回」的路子，这也是 `foreign-write` 那族失败的来源。
- 界面上读开关的电话也会调 `loadSwitch()`（`node_modules/dsh-log/dist/phones.js:14-17`），但「已读」标记挡着，同一个实例不会因此再读一次、也不会再记一条。

## 4. 触发条件：为什么这个实例会没有开关文件

开关文件只有一条路会被写出来：`setSwitch()` → `persistSwitch()`（`node_modules/dsh-log/dist/engine/switch-file.js:47-87`）。也就是说，**只有用户真的在界面上拨过开关，文件才会出现**；没拨过就永远没有。

缓存目录跟着进程启动目录走：`src/host/git-process.ts:381-391` 把它算成 `<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/`。所以同一个 DSH 安装、同一个用户，**开关文件是按工作目录各存一份的**。

本机上有两套本插件实例，各自的缓存目录不同：

| 实例 | 缓存目录 | 有没有 `log-switch.json` |
| --- | --- | --- |
| 开发检出实例 | `D:\dsh-plugin\dsh-mattpocock-skills-deck\.dsh-mattskillsdeck-cache\` | 没有（目录里只有 `logs`、`shots-t2` 和几个仓库缓存用的 JSON 文件） |
| 已安装实例 | `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\` | 有，16 字节，内容 `{"enabled":true}`，创建时间 2026-10-16 16:29:05 |

连带后果：开关读不到，就等于开关关着。开关关着时，错误、告警与常驻事件照常落盘，其余信息级事件不落盘（同第 1 节的 `isEnabled` 与常驻名单）。同一天的两个实例对比见表（第 1 节）。

## 5. 现场对照：两个实例按天统计

已安装实例（开关文件存在）按天统计，`read-fail` 条数与 `host.start` 条数：

| 日期 | read-fail | host.start |
| --- | --- | --- |
| 2026-10-15 | 12 | 12 |
| 2026-10-16 | 12 | 17 |
| 2026-10-17 | 0 | 24 |
| 2026-10-18 | 0 | 7 |
| 2026-10-19 | 0 | 16 |
| 2026-10-20 | 0 | 35 |
| 2026-10-21 | 0 | 4 |

开发检出实例（开关文件不存在）按天统计：

| 日期 | read-fail | host.start |
| --- | --- | --- |
| 2026-10-14 | 85 | 91 |
| 2026-10-15 | 49 | 51 |
| 2026-10-16 | 36 | 40 |
| 2026-10-17 | 144 | 149 |
| 2026-10-18 | 153 | 159 |
| 2026-10-19 | 179 | 182 |
| 2026-10-20 | 131 | 133 |
| 2026-10-21 | 231 | 232 |

两个实例唯一的差别就是「开关文件在不在」，别的都一样：同一个 DSH 安装、同一个用户、同一份插件代码。结果是**开关文件缺失的时候，每建一个日志实例就记一条 read-fail**，不是每个进程一条。最硬的判据是开发检出实例 2026-10-20：当天 `host.start` 有 133 行、涉及 13 个进程号，却记了 131 条读回失败，远多于进程数（一个进程里装配约十次，所以一次进程启动大约带来十条读回失败）。

**时序对得上。** 已安装实例 2026-10-16 的 12 条 read-fail 的本地时间是 00:46:17、00:46:24、00:48:06、00:49:10、01:00:10、02:31:43、12:18:29、14:11:09、14:14:44、15:31:12、15:32:17、**16:29:00**；而开关文件的创建时间是 **16:29:05**。此后每天归零，`host.start` 照常记。

**间隔也对得上。** 2026-10-21 开发检出实例里 232 条 `host.start` 与 231 条 read-fail，每条 read-fail 距它前面最近一条 `host.start` 的间隔：最短 8 毫秒，最长 1030 毫秒，平均 223 毫秒。也就是说，**失败发生在日志实例建库的那一刻（一批实例在进程启动时接连建起来），不是写日志行的时候**。

## 6. 最小复现

复现方法：用 npm 包 `dsh-log`（本仓 `package/package.json:26` 写死 `"dsh-log": "0.3.4"`，实测装的就是 0.3.4）的宿主入口 `createHostLog` 建一份日志库，文件服务口按 DSH 的形状实现——`resolve` 交出目标，`readText` 先看文件在不在、是普通文件不普通文件，不在就抛 `FS_NOT_FOUND`，是目录就抛 `FS_NOT_REGULAR_FILE`，并把每次调用记进轨迹；然后调一次 `store.loadSwitch()`。四种情形各跑一次，外加一个并发情形。

脚本原文（本次跑在 `D:\Temp\dsh-fs-1315\repro.mjs`，跑法：`node D:\Temp\dsh-fs-1315\repro.mjs`）：

```js
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const HOST_URL = pathToFileURL('D:\\dsh-plugin\\dsh-mattpocock-skills-deck\\node_modules\\dsh-log\\dist\\host.js').href
const { createHostLog } = await import(HOST_URL)

class FsError extends Error { constructor(msg, code){ super(msg); this.code = code } }

// 仿 DSH 文件服务（dsh-fs-local）：resolve 只解析路径不要求文件存在；readText 先 stat 再读。
function makeFs(trace) {
  return {
    async resolve(p) { return { displayPath: String(p), targetKey: String(p) } },
    async readText(target) {
      const p = String(target.targetKey)
      let st = null
      try { st = statSync(p) } catch (e) { st = null }
      if (!st) { const err = new FsError('cannot read "'+target.displayPath+'": not found', 'FS_NOT_FOUND'); trace.push('readText threw FS_NOT_FOUND'); throw err }
      if (!st.isFile()) { const err = new FsError('cannot read "'+target.displayPath+'": not a regular file', 'FS_NOT_REGULAR_FILE'); trace.push('readText threw FS_NOT_REGULAR_FILE'); throw err }
      trace.push('readText returned ' + st.size + ' bytes')
      return readFileSync(p, 'utf8')
    },
    async writeText(target, text) {
      const p = String(target.targetKey)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, text, 'utf8')
      return true
    },
    async mkdir(dir) { mkdirSync(dir, { recursive: true }); return true },
    async listDir() { return [] },
  }
}

async function runCase(title, prepare) {
  const dir = mkdtempSync(join(tmpdir(), 'dshlog-1315-'))
  if (prepare) prepare(dir)
  const trace = []
  const { store } = createHostLog(
    { fs: makeFs(trace), timer: { timeout: (fn, ms) => setTimeout(fn, ms) }, getCacheDir: () => dir, getPlatform: () => null, DEFAULT_CWD: dir },
    { pluginId: 'wf', prefix: 'wf' }
  )
  await store.loadSwitch()
  await store.flushNow()
  const fail = store.getLastPersistFail()
  console.log('=== ' + title + ' ===')
  console.log('  开关文件在盘上：' + (existsSync(join(dir,'log-switch.json')) ? '是' : '否'))
  console.log('  文件服务动作轨迹：' + (trace.length ? trace.join(' | ') : '（没有调用文件服务）'))
  console.log('  getLastPersistFail：' + JSON.stringify(fail))
  console.log('')
}

await runCase('A 缓存目录里没有日志开关文件（现场情形）')
await runCase('B 开关文件存在且内容是合法 JSON', (d) => writeFileSync(join(d,'log-switch.json'), '{"enabled":true}', 'utf8'))
await runCase('C 开关文件存在但内容不是 JSON（解析层）', (d) => writeFileSync(join(d,'log-switch.json'), 'this is not json', 'utf8'))
await runCase('D 开关文件是一个目录（打开层：不是普通文件）', (d) => mkdirSync(join(d,'log-switch.json'), { recursive: true }))
```

实际输出（Node v24.19.0，`dsh-log` 0.3.4）：

```text
=== A 缓存目录里没有日志开关文件（现场情形） ===
  开关文件在盘上：否
  文件服务动作轨迹：readText threw FS_NOT_FOUND
  getLastPersistFail：{"op":"readBack","reason":"read-fail","dirHash":"00001505","at":1792550349019}

=== B 开关文件存在且内容是合法 JSON ===
  开关文件在盘上：是
  文件服务动作轨迹：readText returned 16 bytes
  getLastPersistFail：null

=== C 开关文件存在但内容不是 JSON（解析层） ===
  开关文件在盘上：是
  文件服务动作轨迹：readText returned 16 bytes
  getLastPersistFail：{"op":"readBack","reason":"read-fail","dirHash":"00001505","at":1792550349026}

=== D 开关文件是一个目录（打开层：不是普通文件） ===
  开关文件在盘上：是
  文件服务动作轨迹：readText threw FS_NOT_REGULAR_FILE
  getLastPersistFail：{"op":"readBack","reason":"read-fail","dirHash":"00001505","at":1792550349027}
```

这四行输出把层次钉住了：

- **情形 A 是现场情形**：文件服务确实抛了错（`FS_NOT_FOUND`），说明失败发生在打开文件那一步；读到的错误原文 `cannot read "<路径>": not found` 与 DSH 真实文件服务在缺文件时抛的完全一样（`dsh-fs-local/lib/index.js:357`）。
- 情形 B 证明：开关文件在、内容是合法 JSON 时，不会有失败。
- 情形 C 证明：解析层失败也被记成一模一样的 `read-fail`，而此时文件服务并没有抛错。所以**光看失败行分不出层次**，必须靠现场事实（缓存目录里到底有没有那个文件）来定。
- 情形 D 证明：同一个失败行还可能来自「文件在，但不是普通文件」。
- 并发情形（两个实例共用一个缓存目录，一个写开关、另一个读开关）：**一条 `read-fail` 都没有**。并发写者观测走的是别的事件（`persistSwitch`/`dir-conflict` 与 `writeBatch`/`foreign-write`），所以「并发写入后的读回窗口」这个候选可以排除。

另外补一条落盘证据：在同一份复现里，`loadSwitch()` 失败之后等 300 毫秒再刷一次盘，日志文件里就出现了这样一行，四个键与现场一模一样：

```json
{"v":3,"ts":1792550436125,"level":"warn","event":"log.persist.fail","fields":{"pluginId":"wf","op":"readBack","reason":"read-fail","dirHash":"00001505"}}
```

紧跟着失败就刷一次盘是刷不出来的（失败行是排队等下一轮刷盘才落盘，见 `node_modules/dsh-log/dist/engine/pipeline.js:479-500`）；给够一次刷盘机会，它就落盘了。

## 7. 与既有笔记 research/1315-read-back-fail-layer.md 的逐条比对

既有笔记在本次调查里只是待核对的对象，不是结论来源。逐条核对结果如下。

### 确认无误的主张

| 既有笔记的主张 | 核对结果 |
| --- | --- |
| 失败发生在「打开文件」这一层，读的是日志开关文件 `log-switch.json` | 确认。`node_modules/dsh-log/dist/engine/switch-file.js:34`（读）与 `:41-44`（catch） |
| 全仓只有一处把异常记成 `read-fail`，且不区分内容 | 确认。整包 `dsh-log` 里字符串 `readBack` 只出现在 `dist/engine/switch-file.js:43`；本仓旧实现 `src/host/logStore.ts:233` |
| 不是「按行解析」，也不是「并发写入后的读回窗口」 | 确认。并发两族分别是 `dist/engine/pipeline.js:743,752` 与 `dist/store.js:108`，都不带 `op=readBack` |
| 每个日志实例记一条，宿主每装配一次建一个新实例 | 确认。`dist/engine/switch-file.js:26-28`；`src/host/index.ts:326-334` |
| 触发条件只有一个：缓存目录里没有开关文件 | 确认。开关文件只有 `dist/engine/switch-file.js:47-87` 那一条产生途径 |
| 失败行四个键、不带错误原文、不带目录 | 确认。`dist/engine/pipeline.js:485-500`；短指纹算法 `dist/core/ids.js:14-26`，空串算出来是 `00001505` |
| 开关文件名与日志目录名的字面量位置 | 确认。`dist/config/constants.js:20-21`、`dist/config/resolve.js:21-30` |
| 文件服务那一步的调用链与抛错位置 | 确认。`dist/engine/io.js:110-119` → `dsh-fs-local/lib/index.js:825-830` → `:369-375` → `:349-361`，缺文件在 `:357` |
| 本仓旧实现有一模一样的一行 | 确认。`src/host/logStore.ts:233`；回退分支在 `src/host/index.ts:327` |
| 宿主给日志包的文件服务口没有追加写方法 | 确认。`src/host/platform/index.ts:140` |
| 两个实例的缓存目录与开关文件的有无、已安装实例那个文件的内容与创建时间 | 确认。已安装实例那个文件 16 字节、内容 `{"enabled":true}`、创建时间 2026-10-16 16:29:05 |
| 开发检出实例 2026-10-20 的 1300 行与 6 种事件、已安装实例同日的 859596 行与 93 种事件 | 确认。本次逐行统计结果一致 |
| 开发检出实例 2026-10-20 只有 13 个进程号却记了 131 条读回失败 | 确认。本次统计：`host.start` 133 行、13 个进程号、131 条 read-fail |
| 已安装实例 2026-10-16 的 12 条读回失败时间点，最后一条 16:29:00 | 确认。12 个时间点逐个对上，最后一条 16:29:00，比开关文件出现（16:29:05）早 5 秒 |
| 第 2 节引用的两条相邻日志行逐字属实 | 确认。逐字取自 `.dsh-mattskillsdeck-cache/logs/2026-10-20.log`，时间戳 1792504330276 与 1792504330301，相隔 25 毫秒 |
| 复现脚本留在 `.scratch/1315-repro.ts`（该目录已被忽略） | 确认。文件在，3732 字节、81 行，内容与笔记第 5 节所引全文一致；`.gitignore:5` 忽略 `.scratch/` |

### 需要更正或补细的地方

1. **2026-10-21 的几个数字是当天早些时点的快照，已经过时。** 既有笔记写开发检出实例 2026-10-21 的读回失败 179 条、`host.start` 180 条、并发写者观测 913 条、已安装实例的 `persistSwitch`/`dir-conflict` 113 条。本次在 2026-10-21 10:40 之后重新统计，同一个文件里分别是 231 条、232 条、950 条、131 条——当天日志还在继续增长，机制没变。这几处不是错的，是快照会过时；引用时应当标明统计时刻。
2. **「落盘的失败行条数：0」的说法可以更精确。** 既有笔记第 5 节说复现里落盘条数是 0，并归因于「诊断行要等刷盘才落盘」。方向是对的：紧跟着失败就刷一次盘确实落不下来。本次多等 300 毫秒再刷一次盘，那一行就落盘了，四个键与现场一模一样。所以更准确的说法是「失败行是排队等下一轮刷盘才落盘」，而不是「落不了盘」。
3. **既有笔记的复现文件服务只覆盖两种情形**（文件不存在、文件存在）。本次补了「文件在但是目录」（打开层的另一种失败）与「两个实例共用一个缓存目录同时写读开关」（并发候选）两种情形，结论是并发情形一条读回失败都不产生。
4. **早期日志行的形状略有不同**：2026-10-15 之前的同类失败行只有三个键（没有 `pluginId`），因为建库配置里没有插件标识时日志库不补这个键（`dist/engine/pipeline.js:489-495`）。既有笔记只引用了 2026-10-20 的四键形状，没有提这层历史。
5. **第 6 节引用的间隔统计里，「最短 0 毫秒」现已变成 8 毫秒**（当天日志又长了，第一条读回失败前面紧邻的 `host.start` 变了）。最长 1030 毫秒、平均 207→223 毫秒，同属快照漂移。

### 既有笔记没有说错、但可以再明确一句的地方

既有笔记第 1 节说「不是按行解析」，理由是「全仓只有一处会把异常记成 `read-fail`，这一处记的是什么内容都不区分」。这句话成立，但读起来像是「解析失败不会记成 read-fail」。更准确的说法是：**解析失败也会被记成完全一样的 `read-fail`，所以单看失败行区分不出层次；现场之所以判定是打开层，靠的是缓存目录里确实没有那个文件，以及文件在的时候内容是合法 JSON 这两个事实。** 这也是本次第 6 节情形 C 与情形 D 补上的内容。

## 8. 这次没能查清的

- **光看日志分不出层次。** 失败行不带错误原文、不带目录，所以「文件不存在」「内容不是 JSON」「不是普通文件」三种情况在日志里长得一模一样。本次是靠复现脚本（第 6 节）加两个实例的现场对照（第 5 节）才定位到层次的。
- **已安装实例那个开关文件是谁写的没查。** 能确定的是它 2026-10-16 16:29:05 出现，之后读回失败归零；具体是用户在界面上拨了开关，还是别的进程写的，本次没查。
- `log.rotate.degraded`、`read.degraded` 这些别的降级事件没查，它们与本票无关。
- 日志正文文件本身的写读一致性没查（那是 `foreign-write` 那族的事）。

## 9. 交给实施票 #1316 的输入

事实交给 #1316 去选：失败点在「读开关文件」这一步；触发条件是「缓存目录里没有开关文件」；每个日志实例一条（一次进程启动约十条）；失败行不带错误原文与目录。

三条可选修法，各自的代价（这里只摆事实与代价，不替 #1316 做决定）：

1. **在日志包里把「文件不存在」当正常态**：读开关之前先判断文件在不在，不在就当开关关着，不记失败。改的是 npm 包 `dsh-log`（上游仓库），本仓只能等发版再升级版本。
2. **在插件侧保证开关文件存在**：启动时若缓存目录里没有 `log-switch.json`，就先写一份 `{"enabled":false}`。好处是不用等上游发版；代价是插件要自己知道上游的文件名与内容格式（这两个字面现在住在 `node_modules/dsh-log/dist/config/constants.js:20-21`），上游改了名字或形状就会写错，而且写一个自己并不打算用的文件本身也有代价。
3. **只改诊断，不改行为**：让失败行带上错误原文与目录（上游 `switch-file.js:41-44` 的 `void e` 把异常对象丢了，本仓旧实现 `src/host/logStore.ts:233` 同样）。好处是下次一眼就能分层；代价是日志行的字段会变，而日志事件的清单与计数门禁在 `research/489-appendix.md` 第 1 章，增删事件或字段要同步改那里。

另外还有两件要单独拿主意的事，本次没有答案：

- 「开关文件不存在」这件事本身要不要报。现在的答案是「报」，而且报成了「每个日志实例一条」的告警：一次进程启动就报十来条。
- 「开关关着导致日志里只剩常驻事件」是不是也要在界面上说清楚，让用的人知道自己的日志为什么这么少。本次没查界面。

## 10. 范围声明

本票只回答「读回失败发生在哪一层」。没有处理 `foreign-write`（并发写者观测），没有处理 `host.start` 重复计数（那是兄弟票 #1317「把真重启与重复写分开：宿主启动事件的真实次数」的范围），没有改任何代码，没有改任何 issue 的状态。

本文件与主笔记由主会话一起提交入库；提交之前，两者都不在版本库里。复现脚本写在临时目录 `D:\Temp\dsh-fs-1315\`，没有落在本仓里。
