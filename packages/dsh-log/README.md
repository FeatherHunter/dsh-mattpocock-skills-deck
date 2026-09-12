# dsh-log（日志包）

可复用的日志系统装成的 npm 包：DSH 插件与独立跑的 Node 程序都能照着这份文档集成使用。
地图 #556 的一部分，本包包含宿主引擎（#559）、客户端引擎（#560）、事件清单格式与通用检查器（#561），集成步骤另见包内的 `INTEGRATION.md`（从安装到首条落盘的按序教程）。

全程用词：日志系统指日志功能本身（引擎、对外接口、检查器、文档）；日志包指装着日志系统的这个 npm 包。电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。

## 1. 安装

```sh
npm install dsh-log
```

要求 Node 22 或更高。当前版本 `0.2.0`，已发布到 npm 官方源（标签 `latest`）。

## 2. 三个入口，按运行位置选用

- `dsh-log/host`：DSH 插件宿主侧用。建日志库、拼电话名、注册电话名、事件清单检查器。
- `dsh-log/client`：DSH 插件客户端侧用。建日志器、电话名拼法、批量转发口径数字。
- `dsh-log/node`：**不是插件的独立 Node 程序用**（例如一个技能自己的命令行）。一句话建好落盘日志，不必自己拼文件服务与计时器。

三个入口在同一个包里，装一次全都有。

`dsh-log/node` 与前两个的区别：它不碰电话层、也没有客户端转发，只有「把日志落到本地文件」以及它背后的级别规则、目录派生与失败计数。它**不决定日志写到哪**——目录由调用方传入，入口自己不读任何环境变量、也不带默认路径。

## 2.1 独立 Node 程序怎么接（`dsh-log/node`）

```js
import { createNodeHostLog } from 'dsh-log/node'

const log = await createNodeHostLog(
  { cacheDir: '/你自己决定的/日志目录' },
  { pluginId: 'your-program' }
)

log.store.log('warn', 'your.step.fail', { step: 'fetch', reason: 'timeout' })
await log.ready   // 等这一下：程序退出前日志才真的落盘
```

落点由 `cacheDir` 与标识一起决定：日志写在 `<cacheDir>/logs-your-program/2026-09-11.log`，调试开关写在 `<cacheDir>/log-switch-your-program.json`。目录不存在时入口自己建。

三件要知道的事：

1. **`await log.ready` 不能省**。落盘是防抖加异步写的，短命程序不等它，日志会随进程一起消失。这一下会等到「前面写的每一行都已经在文件里」才返回。
2. **开关每次新建时会被读回来**。独立程序每次调用都是新进程，所以入口建库时会把上次留下的开关读回来，打开的详细日志在下次调用仍然生效；写入用 `log.store.handleLogSetSwitch({ enabled: true, sampleRate: 1 })`。
3. **级别规则与插件侧完全一致**：错误与告警恒落盘，常驻信息落盘，其余信息与调试只在开关打开时落盘。

## 3. 三步接入（宿主侧）

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'

// 五个运行依赖全部由调用方传入，包内不自己抓：
// fs 文件服务、timer 计时器、getCacheDir 取缓存目录函数、
// getPlatform 取平台函数、DEFAULT_CWD 默认工作目录。
// 每个依赖的最小形状与可省略项见 INTEGRATION.md 步骤 2 的形状表。
const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'wf' }
)
registerHostLogPhones(new Map(), hostLog)
```

1. 装包。
2. 调用建日志库工厂并传入插件标识（`pluginId` 必填，其余全有默认）。
3. 用默认配置即跑：默认前缀 `wf` 下 5 个电话名、目录名、开关文件名、按天文件名与本仓现状一字不差。

第二个插件把 `pluginId` 换成自己的标识即可：电话名自动加前缀隔离，目录与开关文件名默认派生为不同名字，不得共用同一目录。

一次建库调用得到一个独立实例：内存队列、累计丢弃数、开关状态各自独立，互不串。

## 4. 配置默认值派生（#558 冻结）

必填只有插件标识 `pluginId`：只能用小写英文字母、数字、中横线，长度 1 到 32。收到大写直接报错，不做静默转小写；收到含点或文件不安全字符（斜杠、反斜杠、冒号、星号、问号、引号、尖括号、竖线、空格）的值同样报错，因为点留作前缀与动作名之间的分隔符，拼进目录名与文件名后必须仍是合法名字。

| 配置键 | 默认 | 说明 |
|---|---|---|
| `prefix` | 回退到 `pluginId`（当前插件两者都是 `wf`） | 电话名前缀；新电话名 = 前缀 + 点 + 动作名 |
| `logDirName` | 派生 | 标识为 `wf` 时为 `logs`，其他标识时为 `logs-标识`；允许显式覆盖 |
| `switchFileName` | 派生 | 标识为 `wf` 时为 `log-switch.json`，其他标识时为 `log-switch-标识.json`；允许显式覆盖 |
| `fileNamePolicy` | `daily` | 按天（年月日点 log，如 `2026-09-06.log`）；四段式只作可选项 |
| `maxQueue` | `1000` | 宿主内存队列上限，满时按级别丢弃、只计数不抛错 |
| `eventList` | `null` | 事件清单注入点位（对象形式，见第 7 节；不传为 `null`，主路径零变化） |

四段式文件名的四段定死为日期点插件标识点进程号点启动时间：插件名取配置里的插件标识，进程号取不到时回退 0，启动时间取宿主建日志库那一刻（以启动头写入的 `pid` 与 `startedAt` 为准，里面的冒号与斜杠转写为中横线后才拼入）。清空与导出里按文件名匹配的正则随策略分支：`daily` 走按天正则，四段式走对应的四段正则。

## 5. 电话名、前缀隔离与客户端接入

### 5.1 五个电话

新电话名 = 前缀 + 点 + 动作名。默认前缀 `wf` 下 5 个字面与现状一字不差：

| 电话名（默认前缀下） | 方向 | 入参 | 回参 |
|---|---|---|---|
| `wf.logBatch` | 客户端调宿主，批量上报 | 日志条目数组（`entries`）加客户端累计丢弃数（`droppedCount`） | 是否成功（`ok`）加接收条数（`accepted`）加宿主侧累计丢弃数（`dropped`） |
| `wf.logExport` | 客户端调宿主，导出 | 可选日期（`date`），多余字段忽略 | 是否成功加文件名加长度（`bytes`，日志原文的字符串长度，不是真实字节数）加回退标记（`fallback`）加当天日志原文（`text`）加系统信息摘要（`summary`）加目录与路径（`dir`/`path`） |
| `wf.logClear` | 客户端调宿主，清空 | 日期或全部（`date` 为某天或 `all`） | 是否成功加删掉几个文件（`removed`） |
| `wf.logGetSwitch` | 客户端调宿主，读开关 | 空对象 `{}` | 是否成功加是否开启加采样率 |
| `wf.logSetSwitch` | 客户端调宿主，写开关 | 是否开启加采样率 | 是否成功加实际生效的是否开启（`ok` 与 `enabled`，不回采样率；客户端写成功后用请求时的采样率更新本地，不等宿主回） |

前缀只隔离电话名，不隔离磁盘上的文件，磁盘隔离靠上面的目录名与开关文件名默认派生。宿主注册电话名时，若该名字已被注册，则报错、不覆盖旧的。默认前缀 `wf` 只给当前插件用，第二个插件必须显式配自己的前缀后才能注册。

导出成功回 8 个键（含原文 `text`、摘要 `summary`、目录与路径 `dir`/`path`）；导出失败只回 4 个键（`ok`、`fileName`、`bytes`、`fallback`），调用处走失败分支处理。

### 5.2 客户端两种消费方式（二选一）

两种方式行为一致，选一种即可，推荐直接 import。

方式一，直接 import（推荐）：调用方写 `import { createClientLog } from 'dsh-log/client'`，把四个依赖与插件配置传进来，当场得到日志器，打包工具正常解析 import。

```js
import { createClientLog } from 'dsh-log/client'

const clientLog = createClientLog(
  { host, timer, storage, broadcastLogSwitch },
  { pluginId: 'wf' }
)
clientLog.log('info', 'my.event', { step: 'started' })
```

四个依赖全部由调用方传入（全可选，缺了走退化路，不抛错）：宿主调用器 `host`（只用 `call` 一个方法，桥接写法见 INTEGRATION.md 步骤 3 的三行示例）、计时器 `timer`（只用 `timeout` 一个方法，没有就回退全局函数）、存储 `storage`（只用读写两个方法，没有就每次用默认）、开关广播 `broadcastLogSwitch`（一个无参函数，没有就不广播，不报错）。

方式二，文本拼接（只给把客户端拼进插件主文件闭包一起运行的插件用）：构建时取客户端入口编译后的声明体，去行首 `export` 后拼进插件主文件闭包，调用时把闭包里现成的四个名字原样传给工厂。文本拼接消费方式只走客户端入口的声明体文本。本仓当前插件本次不切拼接源（默认 `wf` 下行为零变化），拼接形态留给第二个插件验证。

客户端批量转发口径（#558 冻结，复用 `CLIENT_BATCH` 常量，不另写一遍）：每批最多 50 条、每 1000 毫秒发一次、单包约 128KB 或队列 100 条先到先截，裁掉的记入丢弃数。开关看门狗超时 5000 毫秒，只记一行告警，不改返回值。本地开关存在本地存储里，键名是 `dsws.debug`，形状是是否开启加采样率加版本号，默认关闭。建日志器时同步读本地做界面秒显，随后启动对账再向宿主看齐（以宿主为准）。

日志器动作与宿主同名同参同语义：是否允许记（`isEnabled`）、记一行（`log`）、立刻转发或刷盘（`flush`，客户端侧只管转发，不管落盘；调转发后约 1 秒可见、不调约 2 秒、错误与告警直通，见 INTEGRATION.md 步骤 4）、读累计丢弃数（`getDroppedCount`）。

## 6. 失败语义（#558 冻结）

失败只计数不抛错：写盘失败、队列满、转发失败都只加到累计丢弃数里；所有电话失败都回是否成功为假的结构，不抛异常。两处例外原样保留，不扩大：

- 唯独记录电话（`logBatch`）的最外层例外回成功加接收 0 条（`ok` 为真、`accepted` 为 0）。
- 导出电话多余字段忽略（多传的字段不改变行为）。

开关读写失败保持旧值，不回退为开启。客户端写开关失败原因只给机器码（`host-unavailable`、`host-rejected`、`switch-timeout`、`stale` 等），面向用户的文案由界面经多语言系统转换。

## 7. 对象清单、模板与检查器（#561）

每条事件四样东西：事件名、级别（`error`、`warn`、`info`、`debug`）、允许字段（之外的键一律不记）、脱敏引用（`codes` 是截断或散列代号，`rules` 是具名正则名，都是引用名，命中只记规则名不记原文）。`kind` 只为计数检查服务：`resident` 常驻（始终落盘的轻量轨迹）、`ondemand` 按需（只在调试开关打开时记）、`selfmon` 自监控（日志管道自己的故障行），三类实际条数须与清单自报的 `counts` 逐项核对。`guard` 可选，一句话写清采样或节流，无特殊守卫不写。

空模板见包内的 `event-list.template.json`（模板里的 `pluginId` 换成自己插件的标识；只含一条事件的最小填好例子见 INTEGRATION.md 步骤 5）。调用方把清单拼成对象传给 `eventList`：

```js
import { readFileSync } from 'node:fs'

const myEventList = JSON.parse(readFileSync('./event-list.my-plugin.json', 'utf8'))

const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'my-plugin', eventList: myEventList }
)
```

路径形式请调用方自己读成对象再传入，日志包不读盘（字符串直接传给 `eventList` 只存不解析，检查器收到字符串会报错并提示先读成对象）。对象形式的清单当场验形状，错了直接报错（含中文说明），不静默修补；数组形式同样被拦下（只收对象，数组多半是把事件表直接当成了清单）。

检查器经宿主入口导出，都是纯函数，不新增日志事件：

```js
import { parseEventListManifest, checkEventFields, checkEventCounts } from 'dsh-log/host'

const manifest = parseEventListManifest(myEventList)
checkEventFields(manifest, 'gh.exec', ['argv0', 'cwdHash'])
checkEventCounts(manifest)
```

`parseEventListManifest` 验形状，`checkEventFields` 做字段白名单检查（未知事件名、未知字段键都算不通过，并把名单带回给调用方），`checkEventCounts` 做计数检查（增删事件必须同步改清单的 `counts`，否则这里变红）。本仓现有 55 事件对照仍以 `research/489-appendix.md` 与 `tests/verify-log-*.js` 为准，本包只给格式与检查器，不复刻那张表，免得两处对照要双写同步。

## 8. 已知事项（#560 带走的两条 P1，本包首版行为）

1. 导出失败行读全局散列，是四个注入依赖之外的第 5 个隐式依赖。`logExportFail` 在包内没有共享闭包可用时，只认挂在全局对象上的同名函数（`dswsLogHash` 与 `dswsLogTrunc`，测试桩走这条）：全局上有就用它们做截断与散列，没有就回退包内自带的散列函数，行为一致。收敛计划：如果调用方闭包里有自己的散列与截断函数且希望输出与旧模块一字相同，把它们挂到全局对象同名位置即可；不需要一字相同时什么都不用做。
2. 存储双键过渡期以 `storage` 为准。建日志器收 `storage` 与旧名 `localStorage` 两个键（迁移期兼容）：只传一个就用它，两个都传以 `storage` 为准。新接入的插件只传 `storage`。收敛时间表待定，在此之前双键行为保持本节所述不变。

## 9. 发布前 build 与门禁跑法

发布前按顺序两步（演练只跑 dry-run，不真发）：

```sh
node packages/dsh-log/build.mjs
cd packages/dsh-log && npm publish --dry-run
```

编译产物在 `dist` 下（6 个 JS：`client.js`、`config.js`、`host.js`、`node.js`、`phones.js`、`store.js`），本地生成、不入库。发布白名单（`files`）共 11 个文件：`dist` 下 6 个 JS、`event-list.template.json`、`INTEGRATION.md`、`README.md`、`LICENSE`、`package.json`。加新文件进包时同步改 `files` 并重跑 dry-run 确认文件数。

门禁跑法（改包后全跑，退出码全 0 才算过）：

```sh
node --test packages/dsh-log/tests/host.test.mjs packages/dsh-log/tests/eventList.test.mjs packages/dsh-log/tests/client.test.mjs packages/dsh-log/tests/node.test.mjs
node tests/verify-log-artifacts.js
node tests/verify-log-channel.js
node tests/verify-log-client.js
node tests/verify-log-flush.js
node tests/verify-log-guards.js
node tests/verify-log-scrub.js
node tests/verify-log-selfmon.js
node tests/verify-log-truncate.js
node tests/verify-log-switch-526.js
node tests/verify-log-store.js
node tests/verify-log-statusbar.js
node tests/verify-log-coverage.js
node tests/verify-log-count.js
node tests/verify-log-fields.js
```

包内四套单测共 45 项（宿主引擎、客户端引擎、事件清单、Node 程序入口），14 个日志门禁全绿，且 55 事件（常驻 30、按需 20、自监控 5）不变。有 TypeScript 环境时另跑包内类型检查（`tsc -p packages/dsh-log/tsconfig.json`）。未新增日志事件时，附录第 1 章对照表不用动。

包已发布到官方源：最新版本 `0.2.0`（`npm view dsh-log version` 可查）。再发新版本时，除了上面两步，还要按第 10 节的版本策略定版本号、把实际发布输出记进发布记录（包内 `notes-publish-drill.md`），或用包内的发布向导脚本 `publish-wizard.sh` 走一遍完整流程（体检、登录、升版本、干跑、发布、发布后验证六段）。

## 10. 版本策略

语义化版本。破坏性变更有 5 类：电话改名、增删改入参回参形状、改配置写法、改事件清单字段形状、改文件名策略的默认形状。自首个公开发布起算，日志系统的公共接口连续 3 个版本无破坏性变更之前不议拆。

## 11. 安全声明与许可证

用包的人发现安全漏洞，请走本仓 GitHub Issues 报告（标题注明安全字样），紧急情况可直接联系维护人。MIT 许可证，版权人王辰浩，与仓库根 LICENSE 一致。
