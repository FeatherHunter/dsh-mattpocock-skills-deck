# #1315 读回失败（readBack / read-fail）发生在哪一层：读「日志开关文件」的那一步

> 本文件只写从一手来源读到的事实，每条结论后面紧跟文件与行号。全文使用完整句子，只用术语表里已有的词，或者不需要解释的大白话。
>
> 调查时间 2026-10-21（Asia/Shanghai）。调查时的 HEAD 是 `2265d940`（「新增原型实测记录：worktree 加独立依赖能支撑并行构建，界面仍看主工作区（#1322）」，提交时间 2026-10-21 09:03:46 +0800）。
>
> 本文件是这次调查的主笔记：没有改任何源码，没有跑构建，没有改任何 issue 的状态。复现脚本放在 `.scratch/1315-repro.ts`（该目录已被 gitignore），脚本全文抄在第 5 节里，想自己跑一遍的人可以直接照抄。
>
> 这份笔记写完之后另有一份独立复核：`research/1315-read-back-fail-layer-independent-review.md`（由一个独立子代理另起一份调查写成，先独立得出结论，再回头逐条核对本笔记）。它与本笔记的机制结论、源码行号、现场数据都对得上，并指出四处需要订正；这四处已按复核意见改进本笔记，改动清单见第 10 节。
>
> 下文 `dsh-fs-local/lib/index.js:NNN` 这类写法，指的是 DSH 桌面版安装包归档 `D:\DeepseekHarness\resources\app.asar` 里的 `dsh/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js`。归档里的文件用系统自带的 Node 直接读不到（实测 `fs.existsSync` 对归档内路径返回假），本次是先把归档头那一段 JSON 读出来、按里面的偏移取出文件内容，落到 `.scratch/dsh-fs-local-index.js` 再逐行读的。

## 1. 结论

读回失败发生在**打开文件**这一层，读的是**日志开关文件** `<缓存目录>/log-switch.json`，不是日志正文文件。

链条是这样：宿主每装配一次就建出一个日志实例，那个实例自己去读一次开关文件（`loadSwitch()`）；文件不存在时，DSH 的文件服务抛 `cannot read "<路径>": not found`（错误码 `FS_NOT_FOUND`）；日志库把这个异常整个吞掉，只记一条不带错误原文的 `log.persist.fail`（`op=readBack`、`reason=read-fail`）。

所以这张票问的三个候选里，答案是第一个：

- **不是「按行解析」**：开关文件解析失败抛的是 `SyntaxError`，但全仓只有一处会把异常记成 `read-fail`（`node_modules/dsh-log/dist/engine/switch-file.js:43`，本仓旧实现在 `src/host/logStore.ts:233`），这一处记的是什么内容都不区分。
- **不是「并发写入后的读回窗口」**：并发写者观测记的是另一种组合（`op=writeBatch`、`reason=foreign-write`），见第 7 节。
- **是「打开文件」**：读的是开关文件，文件不存在就抛错，错误被吞掉，只留下一条笼统的失败行。

还有三个补充事实，都会影响后面的修法选择：

1. **每个日志实例记一条**，不是每个进程记一条，也不是写一行日志记一条：日志库每建一个实例就自己读一次开关，「已读」标记是每个实例各存一份的（`node_modules/dsh-log/dist/engine/switch-file.js:26-28`），跟这个实例写了多少行日志无关。宿主每装配一次就建一个新实例（`src/host/index.ts:326-334`），开发检出实例一个进程里装配了约十次，所以一次进程启动会带上十来条读回失败。
2. **触发条件只有一个：缓存目录里没有开关文件。** 开关文件是用户真的拨过开关之后才被写出来的，没拨过就永远没有。
3. **失败行本身信息不足**：它既不带错误原文也不带目录（`dirHash` 是空串的短指纹 `00001505`），所以光看日志分不出「文件不存在」「文件存在但内容坏了」「文件存在但不是普通文件」这三种情况。

另外还有一条连带后果，值得单独说：**开关读不到就等于开关关着，日志里就只剩常驻事件。** 这解释了为什么开发检出实例的日志一天只有 1300 行、6 种事件，而已安装实例同一天有 859596 行、93 种事件。

## 2. 失败行长什么样

开发检出实例 2026-10-20 的日志里，两条相邻的行（`ts` 是 epoch 毫秒）：

```json
{"v":3,"ts":1792504330276,"level":"info","event":"host.start","fields":{"pid":52432,"startedAt":"2026-10-20T13:52:10.216Z","dir":"D:\\dsh-plugin\\dsh-mattpocock-skills-deck\\.dsh-mattskillsdeck-cache","os":"win32"}}
{"v":3,"ts":1792504330301,"level":"warn","event":"log.persist.fail","fields":{"pluginId":"wf","op":"readBack","reason":"read-fail","dirHash":"00001505"}}
```

两条相隔 25 毫秒。失败行只有四个键（`node_modules/dsh-log/dist/engine/pipeline.js:485-499`）：插件标识 `wf`、`op=readBack`、`reason=read-fail`、`dirHash=00001505`。这个 `dirHash` 是目录的短指纹，目录为空串时就是 `00001505`（本仓旧实现里同款算法在 `src/host/logStore.ts:46-51`）——也就是说，**这条失败行没有带上任何目录信息**。

这条失败行的形状还有一段历史：2026-10-15 之前的同类行只有三个键（没有 `pluginId`），因为建库配置里没有插件标识时日志包不补这个键（`node_modules/dsh-log/dist/engine/pipeline.js:489-495`）。2026-10-15 当天两种形状混在一起：开发检出实例当天 49 条读回失败里，28 条带 `pluginId`、21 条不带。已安装实例 2026-10-15 那 12 条全是三键形状，而且那天整个文件 51079 行里没有一行带 `v` 键。

顺带说明地图 #1314 正文里那处数字该怎么读。正文原来写的是「2026-10-20 的插件日志共 1300 行，读回失败 775 条」（本次已经把地图正文改成拆开的写法）。775 这个数把两族失败混在一起了。按 `op` 与 `reason` 拆开同一份日志文件：

| op / reason | 2026-10-20 | 2026-10-21（当日 10:46 的快照） | 这是什么 |
| --- | --- | --- | --- |
| `writeBatch / foreign-write` | 644 | 950 | 并发写者观测，与读回失败无关 |
| `readBack / read-fail` | 131 | 231 | 真正的读回失败 |

也就是说，地图正文说的「读回失败」里有 83% 其实是并发写者观测。真正要定位的是那 131 条。

2026-10-21 当天的日志还在继续长，上表这一列是当日 10:46 的快照；引用当天的数字时都要带上这个时刻，早上量到的数会更小。

## 3. 失败点定位

从插件宿主到失败行，完整调用链如下：

1. `src/host/index.ts:326-334`：每次装配都新建一个日志实例（取日志库的承诺变量声明在装配函数内部，每次装配都是一份新变量），装配好就调 `h.loadSwitch()`、再调 `h.writeStartupHeader()`。开关是每个实例各读一次。
2. `node_modules/dsh-log/dist/engine/switch-file.js:25-46`：`loadSwitch()` 的 try 块里依次是
   - `:30` `getCacheDir()`，拿不到目录就直接返回；
   - `:33` `resolveTarget(joinLogPath(dir, config.switchFileName))`，拼出开关文件的目标；
   - `:34` `await readTarget(target)`，真正去读；
   - `:37` `JSON.parse(txt)`，解析开关内容；
   - `:41-44` `catch (e) { void e; notePersistFail('readBack', 'read-fail', ''); }`——**异常对象被整个丢掉**（`void e`），失败行因此没有错误原文。
3. 开关文件名与日志目录名：`node_modules/dsh-log/dist/config/constants.js:20-21` 定义 `logs` 与 `log-switch.json`，`node_modules/dsh-log/dist/config/resolve.js:21-30` 在插件标识为 `wf` 时原样采用这两个名字。所以开关文件就在 `<缓存目录>` 根下，不在 `logs` 目录里。
4. 读文件这一步本身：`node_modules/dsh-log/dist/engine/io.js:110-119` 的 `readTarget` 走宿主给的文件服务 `fs.readText`。
5. DSH 的文件服务：`dsh-fs-local/lib/index.js:825-830` 的 `readText` → `:369-375` 的 `readWholeText` → `:349-361` 的 `statRegularFile`。文件不存在时，`:357` 抛 `new FsError(\`cannot ${verb} "${target.displayPath}": not found\`, "FS_NOT_FOUND")`，这里 `verb` 是 `"read"`，`displayPath` 是给人看的显示路径。
6. 失败行本身由 `node_modules/dsh-log/dist/engine/pipeline.js:159-163` 的 `notePersistFail` 记下，形状是 `{op, reason, dirHash, at}`。

两点补充：

- 本仓还留着一份旧实现（包不可用时才回退过去，`src/host/index.ts:327`），它有**一模一样的一行**：`src/host/logStore.ts:233`。所以无论走包还是走旧实现，现象都一样。
- 插件宿主给日志包的文件服务口里**没有追加写方法**（`src/host/platform/index.ts:140` 附近的注释写着透传的是 lstat、readText、writeText、resolve、listDir、stat）。日志包因此走「整份读出来、改完再整份写回」的路子，这也是第 7 节那族 `foreign-write` 的来源。

## 4. 触发条件：为什么这个实例会没有开关文件

开关文件只有一条路会被写出来：`setSwitch()` → `persistSwitch()`（`node_modules/dsh-log/dist/engine/switch-file.js:47-87`）。也就是说，**只有用户真的在界面上拨过开关，文件才会出现**；没拨过就永远没有。

缓存目录跟着进程启动目录走：`src/host/git-process.ts:381-390` 把它算成 `<DSH 进程 cwd>/.dsh-mattskillsdeck-cache/`。所以同一个 DSH 安装、同一个用户，**开关文件是按工作目录各存一份的**。

本机上有两套本插件实例，各自的缓存目录不同：

| 实例 | 缓存目录 | 有没有 `log-switch.json` |
| --- | --- | --- |
| 开发检出实例 | `D:\dsh-plugin\dsh-mattpocock-skills-deck\.dsh-mattskillsdeck-cache\` | 没有（目录里只有 `logs`、`shots-t2` 和几个仓库缓存用的 JSON 文件） |
| 已安装实例 | `C:\Users\辰辰洋洋\.dsh\profiles\desktop\.dsh-mattskillsdeck-cache\` | 有，16 字节，内容 `{"enabled":true}`，创建时间 2026-10-16 16:29:05 |

连带后果：开关读不到，就等于开关关着。开关关着时，错误、告警与常驻事件照常落盘，其余信息级事件不落盘（`node_modules/dsh-log/dist/engine/pipeline.js:192-198` 的 `isEnabled`，常驻名单在 `node_modules/dsh-log/dist/core/resident.js:22-35`）。同一天的两个实例对比：

| 2026-10-20 | 行数 | 事件种类 |
| --- | --- | --- |
| 开发检出实例（开关文件不存在） | 1300 | 6 种：`log.persist.fail`、`gh.exec`、`host.start`、`host.call.fail`、`host.call`、`gh.resolve.fail` |
| 已安装实例（开关文件存在且为开） | 859596 | 93 种 |

这就是地图 #1314 正文里「日志失真污染排查依据」的一个具体来源：开发检出实例的日志里，根本没有大部分事件可查。

## 5. 最小复现

复现方法：用 npm 包 `dsh-log`（本仓 `package/package.json` 里写死 `"dsh-log": "0.3.4"`，实测装的就是 0.3.4）的宿主入口 `createHostLog` 建一份日志库，文件服务口按 DSH 的形状实现——`resolve` 交出目标，`readText` 对不存在的文件抛 `FS_NOT_FOUND`，然后调一次 `store.loadSwitch()`。三种情形各跑一次：开关文件不存在、开关文件存在且内容是合法 JSON、开关文件存在但内容不是 JSON。

脚本原文（本次跑在 `.scratch/1315-repro.ts`，跑法：`node --import ./scripts/ts-hook.mts .scratch/1315-repro.ts`）：

```ts
import { createHostLog } from 'dsh-log/host'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

type Row = { event?: string; level?: string; fields?: Record<string, unknown> }

/** 仿 DSH 文件服务：文件不存在时 readText 抛 FS_NOT_FOUND，并把错误原文记下来。 */
function makeFs(captured: string[]) {
  return {
    async resolve(p: string): Promise<unknown> { return p },
    async readText(target: unknown): Promise<string> {
      const p = String(target)
      if (!existsSync(p)) {
        const err = new Error(\`cannot read "\${p}": not found\`) as Error & { code?: string }
        err.code = 'FS_NOT_FOUND'
        captured.push(err.message)
        throw err
      }
      return readFileSync(p, 'utf8')
    },
    async writeText(target: unknown, text: string): Promise<unknown> {
      const p = String(target)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, text, 'utf8')
      return true
    },
    async mkdir(dir: string): Promise<unknown> { mkdirSync(dir, { recursive: true }); return true },
    async listDir(): Promise<string[]> { return [] },
  }
}

async function runCase(title: string, prepare?: (dir: string) => void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-log-1315-'))
  if (prepare) prepare(dir)
  const captured: string[] = []
  const { store } = createHostLog(
    {
      fs: makeFs(captured) as never,
      timer: { timeout: (fn: (...a: unknown[]) => void, ms: number) => setTimeout(fn, ms) } as never,
      getCacheDir: () => dir,
      getPlatform: () => null,
      DEFAULT_CWD: dir,
    },
    { pluginId: 'wf', prefix: 'wf' }
  )
  await store.loadSwitch()
  await store.flushNow()
  const fail = store.getLastPersistFail()
  const logDir = join(dir, 'logs')
  const rows: Row[] = existsSync(logDir)
    ? readdirSync(logDir).flatMap((f) => readFileSync(join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row))
    : []
  const failRows = rows.filter((r) => r.event === 'log.persist.fail')
  console.log('=== ' + title + ' ===')
  console.log('  开关文件在盘上：' + (existsSync(join(dir, 'log-switch.json')) ? '是' : '否'))
  console.log('  getLastPersistFail：' + JSON.stringify(fail))
  console.log('  落盘的失败行条数：' + failRows.length)
  for (const r of failRows) console.log('  失败行原文：' + JSON.stringify(r))
  console.log('  文件服务抛出的错误原文：' + (captured.length ? captured.join(' | ') : '（没有抛错）'))
  console.log('')
}

await runCase('情形 A：缓存目录里没有日志开关文件')
await runCase('情形 B：日志开关文件存在，内容是合法 JSON', (dir) => {
  writeFileSync(join(dir, 'log-switch.json'), '{"enabled":true}', 'utf8')
})
await runCase('情形 C：日志开关文件存在，但内容不是 JSON', (dir) => {
  writeFileSync(join(dir, 'log-switch.json'), 'this is not json', 'utf8')
})
```

实际输出（Node v24.19.0，`dsh-log` 0.3.4）：

```text
=== 情形 A：缓存目录里没有日志开关文件 ===
  开关文件在盘上：否
  getLastPersistFail：{"op":"readBack","reason":"read-fail","dirHash":"00001505","at":1792545911477}
  落盘的失败行条数：0
  文件服务抛出的错误原文：cannot read "D:\Temp\dsh-log-1315-mQy7v8/log-switch.json": not found

=== 情形 B：日志开关文件存在，内容是合法 JSON ===
  开关文件在盘上：是
  getLastPersistFail：null
  落盘的失败行条数：0
  文件服务抛出的错误原文：（没有抛错）

=== 情形 C：日志开关文件存在，但内容不是 JSON ===
  开关文件在盘上：是
  getLastPersistFail：{"op":"readBack","reason":"read-fail","dirHash":"00001505","at":1792545911489}
  落盘的失败行条数：0
  文件服务抛出的错误原文：（没有抛错）
```

三件事被这一次复现钉住了：

- 情形 A 与现场看到的失败行形状完全一致：`op=readBack`、`reason=read-fail`、`dirHash=00001505`。
- 情形 A 里文件服务抛出的错误原文是 `cannot read "<路径>": not found`，与 DSH 真实文件服务在缺文件时抛的完全一样（`dsh-fs-local/lib/index.js:357`）。
- **情形 C 证明「文件存在但内容不是 JSON」会被记成一模一样的 `read-fail`**，一行都看不出区别。这就是第 1 节说的「失败行信息不足」。
- 这个脚本只建了一份日志库，所以只出一条失败行。「一个进程里为什么会有十来条」不在这份脚本的覆盖范围里，那一条靠第 6 节的现场统计来定。

关于「落盘的失败行条数：0」：复现里这个数是 0，是因为这条诊断行要等下一轮刷盘才落盘，失败之后紧接着刷的那一次盘读不到它。这不是「落不了盘」——再给一次刷盘机会它就落盘了，四个键与现场一模一样（见本节末尾的「补做的三个复核」）。`store.getLastPersistFail()` 已经把同样的四键形状回了出来，而现场日志里那条失败行就是它落盘后的样子。

### 补做的三个复核

独立复核指出：上面的复现只覆盖了「文件不存在」「文件存在且是合法 JSON」「文件存在但内容不是 JSON」三种情形，缺「文件在但是一个目录」与「两个实例同时读写同一个开关文件」两种；关于失败行会不会落盘，也要给一次刷盘机会才能看清。本次补做这三件事，脚本放在 `.scratch/1315-verify.ts`（该目录已被 gitignore），脚本全文如下：

```ts
/**
 * 独立复核脚本（#1315）：核对独立复核笔记提出的四处待更正点。
 *
 * 跑法（在本仓根目录）：
 *   node --import ./scripts/ts-hook.mts .scratch/1315-verify.ts
 *
 * 本脚本只做三件事：
 * 1. 情形 A 之后再给一次刷盘机会，看那条失败行到底会不会落盘（复核点二）；
 * 2. 情形 D：开关文件是一个目录（不是普通文件），看失败行是否与情形 A 一模一样（复核点三之一）；
 * 3. 并发情形：两个实例共用一个缓存目录，一个写开关、另一个读开关，看会不会出现 readBack/read-fail（复核点三之二）。
 */
import { createHostLog } from 'dsh-log/host'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

type Row = { event?: string; level?: string; fields?: Record<string, unknown> }
type FsError = Error & { code?: string }

/** 仿 DSH 文件服务（dsh-fs-local/lib/index.js 的 statRegularFile）：缺文件抛 FS_NOT_FOUND，不是普通文件抛 FS_NOT_REGULAR_FILE。 */
function makeFs(trace: string[]) {
  return {
    async resolve(p: string): Promise<unknown> { return p },
    async readText(target: unknown): Promise<string> {
      const p = String(target)
      let st: ReturnType<typeof statSync> | null = null
      try { st = statSync(p) } catch { st = null }
      if (!st) {
        const err = new Error(`cannot read "${p}": not found`) as FsError
        err.code = 'FS_NOT_FOUND'
        trace.push('readText 抛 FS_NOT_FOUND')
        throw err
      }
      if (!st.isFile()) {
        const err = new Error(`cannot read "${p}": not a regular file`) as FsError
        err.code = 'FS_NOT_REGULAR_FILE'
        trace.push('readText 抛 FS_NOT_REGULAR_FILE')
        throw err
      }
      trace.push('readText 读到 ' + st.size + ' 字节')
      return readFileSync(p, 'utf8')
    },
    async writeText(target: unknown, text: string): Promise<unknown> {
      const p = String(target)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, text, 'utf8')
      return true
    },
    async mkdir(dir: string): Promise<unknown> { mkdirSync(dir, { recursive: true }); return true },
    async listDir(): Promise<string[]> { return [] },
  }
}

function readRows(dir: string): Row[] {
  const logDir = join(dir, 'logs')
  if (!existsSync(logDir)) return []
  return readdirSync(logDir)
    .flatMap((f) => readFileSync(join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row))
}

// 复核点二：失败行是排队等下一轮刷盘才落盘，还是根本落不了盘。
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-log-1315-verify-'))
  const trace: string[] = []
  const { store } = createHostLog(
    {
      fs: makeFs(trace) as never,
      timer: { timeout: (fn: (...a: unknown[]) => void, ms: number) => setTimeout(fn, ms) } as never,
      getCacheDir: () => dir,
      getPlatform: () => null,
      DEFAULT_CWD: dir,
    },
    { pluginId: 'wf', prefix: 'wf' }
  )
  await store.loadSwitch()
  await store.flushNow()
  console.log('=== 复核点二：失败行会不会落盘 ===')
  console.log('  失败后立刻刷一次盘，落盘的失败行条数：' + readRows(dir).filter((r) => r.event === 'log.persist.fail').length)
  await new Promise((r) => setTimeout(r, 300))
  await store.flushNow()
  const after = readRows(dir).filter((r) => r.event === 'log.persist.fail')
  console.log('  再等 300 毫秒刷一次盘，落盘的失败行条数：' + after.length)
  for (const r of after) console.log('  失败行原文：' + JSON.stringify(r))
  console.log('')
}

// 复核点三之一：开关文件是一个目录时，失败行是否与缺文件时一模一样。
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-log-1315-verify-'))
  mkdirSync(join(dir, 'log-switch.json'), { recursive: true })
  const trace: string[] = []
  const { store } = createHostLog(
    {
      fs: makeFs(trace) as never,
      timer: { timeout: (fn: (...a: unknown[]) => void, ms: number) => setTimeout(fn, ms) } as never,
      getCacheDir: () => dir,
      getPlatform: () => null,
      DEFAULT_CWD: dir,
    },
    { pluginId: 'wf', prefix: 'wf' }
  )
  await store.loadSwitch()
  console.log('=== 复核点三之一：开关文件是一个目录 ===')
  console.log('  文件服务轨迹：' + (trace.length ? trace.join(' | ') : '（没有调用文件服务）'))
  console.log('  getLastPersistFail：' + JSON.stringify(store.getLastPersistFail()))
  console.log('')
}

// 复核点三之二：两个实例共用一个缓存目录，一个写开关、另一个读开关，会不会出现 readBack/read-fail。
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-log-1315-verify-'))
  writeFileSync(join(dir, 'log-switch.json'), '{"enabled":true}', 'utf8')
  const trace: string[] = []
  const make = () => createHostLog(
    {
      fs: makeFs(trace) as never,
      timer: { timeout: (fn: (...a: unknown[]) => void, ms: number) => setTimeout(fn, ms) } as never,
      getCacheDir: () => dir,
      getPlatform: () => null,
      DEFAULT_CWD: dir,
    },
    { pluginId: 'wf', prefix: 'wf' }
  )
  const writer = make().store
  const reader = make().store
  for (let i = 0; i < 5; i++) {
    await writer.setSwitch(i % 2 === 0)
    await reader.loadSwitch()
    await writer.log('info', 'probe.concurrent', { i })
  }
  await writer.flushNow()
  await reader.flushNow()
  await new Promise((r) => setTimeout(r, 300))
  await writer.flushNow()
  await reader.flushNow()
  const rows = readRows(dir)
  const fails = rows.filter((r) => r.event === 'log.persist.fail')
  console.log('=== 复核点三之二：两个实例同目录一写一读 ===')
  console.log('  日志总行数：' + rows.length)
  console.log('  落盘失败行条数：' + fails.length)
  for (const r of fails) console.log('  失败行原文：' + JSON.stringify(r))
  console.log('  读侧实例的 getLastPersistFail：' + JSON.stringify(reader.getLastPersistFail()))
  console.log('')
}
```

跑法：`node --import ./scripts/ts-hook.mts .scratch/1315-verify.ts`。实际输出（Node v24.19.0，`dsh-log` 0.3.4）：

```text
=== 复核点二：失败行会不会落盘 ===
  失败后立刻刷一次盘，落盘的失败行条数：0
  再等 300 毫秒刷一次盘，落盘的失败行条数：1
  失败行原文：{"v":3,"ts":1792551256663,"level":"warn","event":"log.persist.fail","fields":{"pluginId":"wf","op":"readBack","reason":"read-fail","dirHash":"00001505"}}

=== 复核点三之一：开关文件是一个目录 ===
  文件服务轨迹：readText 抛 FS_NOT_REGULAR_FILE
  getLastPersistFail：{"op":"readBack","reason":"read-fail","dirHash":"00001505","at":1792551256967}

=== 复核点三之二：两个实例同目录一写一读 ===
  日志总行数：3
  落盘失败行条数：0
  读侧实例的 getLastPersistFail：null
```

这三件事各自说明什么：

- **失败行是会落盘的，只是要等下一轮刷盘**。落盘那一行的四个键与现场日志里的失败行完全一样，插件标识也是 `wf`。
- **「开关文件是一个目录」与「开关文件不存在」记出来的失败行一模一样**，都只有 `op=readBack`、`reason=read-fail`、`dirHash=00001505` 这几个键。文件服务抛的是 `FS_NOT_REGULAR_FILE`（不是 `FS_NOT_FOUND`），但日志里分不出来。这是第 8 节「光看日志分不出层次」的第二个实证。
- **两个实例共用一个缓存目录、一读一写，不会产生读回失败**：读侧实例的 `getLastPersistFail()` 是 `null`，一条 `readBack/read-fail` 都没落。票面问的「并发写入后的读回窗口」这个候选，到此被实验排除。

## 6. 现场对照：两个实例按天统计

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
| 2026-10-21（截至当日 10:46 的快照，当天仍在增长） | 231 | 232 |

两个实例唯一的差别就是「开关文件在不在」，别的都一样：同一个 DSH 安装、同一个用户、同一份插件代码。结果是**开关文件缺失的时候，每建一个日志实例就记一条 read-fail**，不是每个进程一条。最硬的判据是开发检出实例：2026-10-20 当天只有 13 个进程号，却记了 131 条读回失败，远多于进程数；同一批日志里的启动头事件有 133 条，两者几乎一一对应（启动头也是每个实例写一行，见 `research/1317-host-start-real-counts.md`）。开发检出实例一个进程里装配约十次，所以一次进程启动大约带来十条读回失败。

**时序对得上。** 已安装实例 2026-10-16 的 12 条 read-fail 的本地时间是 00:46:17、00:46:24、00:48:06、00:49:10、01:00:10、02:31:43、12:18:29、14:11:09、14:14:44、15:31:12、15:32:17、**16:29:00**；对应时刻的 `host.start` 是 00:46:16、00:46:23、00:48:05、00:49:09、01:00:09、02:31:42、12:18:27、14:11:08、14:14:43、15:31:11、15:32:16、**16:28:59**。**最后一条 read-fail 在 16:29:00，而开关文件的创建时间是 16:29:05**；此后 19:51 那次启动没有再记 read-fail，之后每天归零，而 `host.start` 照常记。

**间隔也对得上。** 2026-10-21 开发检出实例里 232 条 `host.start` 与 231 条 read-fail（截至当日 10:46 的快照）。每条 read-fail 距离**时间上最近**的那条 `host.start`：最短 0 毫秒，最长 273 毫秒，平均 47 毫秒，没有一条超过 500 毫秒。也就是说，**失败发生在日志实例建库的那一刻（一批实例在进程启动时接连建起来），不是写日志行的时候**。

这里要说清楚一个口径问题：按「文件里排在它前面那一行 `host.start`」算，间隔是最短 8 毫秒、最长 1030 毫秒、平均 223 毫秒；上面那句用的是「时间上最近」，两个数不一样。原因是日志文件里的行**不按时间排**——多个写者各自整份读改写同一份文件，写进来的行会插到别处（2026-10-21 这份文件里有 154 对相邻行的时间戳是倒着的，2026-10-20 那份有 92 对）。所以「前面最近」这种说法必须说清是按行序还是按时间，两种都指向同一个结论：失败与建库同时发生。

## 7. 不是这件事的另外两族失败

- `writeBatch / foreign-write`：`node_modules/dsh-log/dist/engine/pipeline.js:740-744`。写之前会把文件长度读回来，跟自己上次记账的长度对不上，就说明有别的写者动过这份文件，于是记一条。这属于并发写者观测，跟读回失败是两回事。（追加与读改写两态、以及两进程交错时的实测结果，记在 `research/1313-parallel-session-resources.md:65`。）
- `persistSwitch / dir-conflict`：`node_modules/dsh-log/dist/store.js:106-109`。两个实例抢同一个开关文件的所有权时记一条。已安装实例 2026-10-20 有 403 条、2026-10-21 有 131 条（截至当日 10:46 的快照）。

这两族都不是本票要回答的「读回失败」，但它们和本票的现象混在同一份日志里，地图正文把它们合在一起数了。

## 8. 这次没能查清的

- **光看日志分不出层次。** 失败行不带错误原文、不带目录，所以「文件不存在」「内容不是 JSON」「不是普通文件」三种情况在日志里长得一模一样。本次是靠复现脚本（第 5 节）加两个实例的现场对照（第 6 节）才定位到层次的。上面第 5 节末尾那三个复核是这层结论的两个实证：开关文件是一个目录时抛的是 `FS_NOT_REGULAR_FILE`，记出来的失败行与文件不存在时逐字相同。
- **已安装实例那个开关文件是谁写的没查。** 能确定的是它 2026-10-16 16:29:05 出现，之后 read-fail 归零；具体是用户在界面上拨了开关，还是别的进程写的，本次没查。
- `log.rotate.degraded`、`read.degraded` 这些别的降级事件没查，它们与本票无关。
- 日志正文文件本身的写读一致性没查（那是 `foreign-write` 那族的事）。

## 9. 交给实施票 #1316 的输入

事实交给 #1316 去选：失败点在「读开关文件」这一步；触发条件是「缓存目录里没有开关文件」；每个日志实例一条（一次进程启动约十条）；失败行不带错误原文与目录；并发读写不会产生这类失败（第 5 节末尾已用实验排除），所以不必按「并发问题」那一族去设计修法。

三条可选修法，各自的代价（这里只摆事实与代价，不替 #1316 做决定）：

1. **在日志包里把「文件不存在」当正常态**：读开关之前先判断文件在不在，不在就当开关关着，不记失败。改的是 npm 包 `dsh-log`（上游仓库），本仓只能等发版再升级版本。
2. **在插件侧保证开关文件存在**：启动时若缓存目录里没有 `log-switch.json`，就先写一份 `{"enabled":false}`。好处是不用等上游发版；代价是插件要自己知道上游的文件名与内容格式（这两个字面现在住在 `node_modules/dsh-log/dist/config/constants.js:20-21`），上游改了名字或形状就会写错，而且写一个自己并不打算用的文件本身也有代价。
3. **只改诊断，不改行为**：让失败行带上错误原文与目录（上游 `switch-file.js:41-44` 的 `void e` 把异常对象丢了，本仓旧实现 `src/host/logStore.ts:233` 同样）。好处是下次一眼就能分层；代价是日志行的字段会变，而日志事件的清单与计数门禁在 `research/489-appendix.md` 第 1 章，增删事件或字段要同步改那里。

另外还有两件要单独拿主意的事，本次没有答案：

- 「开关文件不存在」这件事本身要不要报。现在的答案是「报」，而且报成了「每个日志实例一条」的告警：一次进程启动就报十来条。
- 「开关关着导致日志里只剩常驻事件」是不是也要在界面上说清楚，让用的人知道自己的日志为什么这么少。这次没查界面。

## 10. 独立复核与本笔记的订正记录

独立复核稿是 `research/1315-read-back-fail-layer-independent-review.md`，由一个独立子代理另起一份调查写成：它先自己独立定位，再回头逐条核对本笔记。结论一致——失败发生在打开文件那一层，读的是缓存目录下的日志开关文件；它把本笔记的机制结论、源码行号、现场数据逐条对过，16 项主张确认无误。

它指出四处需要订正，本笔记已按它的意见改过：

1. **当天（2026-10-21）的几个数字是快照，会过时。** 本笔记初稿写的 179 条读回失败、180 条启动事件、913 条并发写者观测、113 条目录冲突，是当天早些时点量的；当日 10:46 重新统计是 231、232、950、131。本笔记已把 10-21 那几处数字改成带统计时刻的写法，并说明当天日志还在长。
2. **「落盘的失败行条数：0」的说法不够准。** 准确的说法是「失败行排队等下一轮刷盘才落盘」，不是「落不了盘」。本笔记已改，并补上再给一次刷盘机会它就落盘的实测。
3. **复现缺两种情形。** 本笔记已补上「开关文件是一个目录」与「两个实例同时读写同一个开关文件」两种情形，并把脚本与输出抄在第 5 节末尾。
4. **早期日志行的形状略有不同。** 2026-10-15 之前的同类失败行只有三个键（没有 `pluginId`），本笔记初稿只引了 2026-10-20 的四键形状，已补上这层历史。

另外它指出本笔记有一处「没说错但可以再明确一句」：解析失败也会被记成完全一样的 `read-fail`，所以单看失败行区分不出层次；现场之所以判定是打开层，靠的是缓存目录里确实没有那个文件、以及文件在的时候内容是合法 JSON 这两个事实。本笔记第 1 节已把这句话写明。

它还指出本笔记第 6 节「间隔统计」没写清口径。按行序算与按时间算出的数不一样，原因是日志文件里的行不按时间排（多个写者各自整份读改写同一份文件）。本笔记已把两种口径都写出来，并说明两种都指向同一个结论。

## 11. 范围声明

本票只回答「读回失败发生在哪一层」。没有处理 `foreign-write`（并发写者观测），没有处理 `host.start` 重复计数（那是兄弟票 #1317「把真重启与重复写分开：宿主启动事件的真实次数」的范围），没有改任何代码，没有改任何 issue 的状态。

调查期间工作树里出现的另外两个文件（`research/1317-host-start-real-counts.md`、`research/1330-yaml-配置化调查.md`）不是本次产出，没有动；它们后来由各自的会话提交入库，与本票无关。
