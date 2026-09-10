# dsh-plugin-update（更新包）

可复用的更新系统装成的 npm 包：任何 DSH 插件照着文档能集成检查更新等功能。
地图 #579 的一部分，本包包含更新核心、落盘与执行跑腿、读取器、宿主入口、客户端入口，集成步骤另见后续集成文档票（#585）。

全程用词：更新系统指更新功能本身（引擎、对外接口、文档）；更新包指装着更新系统的这个 npm 包。电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。

两个名字不要搞混：本包自己的名字是 `dsh-plugin-update`（包自己叫什么）；目标包名参数是要检查更新的那个包是谁（默认是当前插件的旧包名 `dsh-mattpocock-skills-deck`）。新包查谁，由调用方传入目标包名决定。

## 1. 安装

```sh
npm install dsh-plugin-update
```

要求 Node 22 或更高。当前版本 `0.1.0`。零运行时依赖。

包还没公开发布时，这条命令装不上：先用本地路径代替（例如 `npm install ../dsh-plugin-update`），等包发布后才用上面的命令。发布前用 `npm view dsh-plugin-update` 查一次重名。

## 2. 双入口

包根即宿主侧入口（`package.json` 的 `exports` 只暴露包根与 `./package.json`）：

- 包根（宿主侧用）：建更新能力、拼电话名、给调用方回电话名与处理器。宿主侧用标准模块写法，直接 `import`。
- `dist/client.js`（客户端侧用）：电话名拼法、轮询时间口径、手工兜底命令形状。客户端侧**在构建期派生取值**（把本文件打包一次，把你自己的前缀代进去，得到三个电话名与轮询间隔的常量），面板界面不进包。

## 3. 三步接入（双入口）

下面例子假设你的插件标识是 `my-notes-plugin`、电话名前缀是 `notes`、要查更新的包也是 `my-notes-plugin`。
把三处名字都换成你自己的，不要照抄 `wf`（`wf` 只是当前插件的历史取值，新插件传自己的前缀即隔离）。

第 1 步：装包。

```sh
npm install dsh-plugin-update
```

要求 Node 22 或更高。零运行时依赖。包还没公开发布时先用本地路径代替（例如 `npm install ../dsh-plugin-update`），发布前用 `npm view dsh-plugin-update` 查一次重名。

第 2 步：宿主侧接线（包根直接 `import`）。

```js
import { createHostUpdate } from 'dsh-plugin-update'

const update = createHostUpdate(
  { ctx, logCtx },
  {
    pluginId: 'my-notes-plugin',
    prefix: 'notes',
    targetPackageName: 'my-notes-plugin',
  }
)
// 把 update.handlers 按键注册进自己的电话表，电话名从 update.phoneNames 读到，不要自己拼字符串。
for (const [name, handler] of Object.entries(update.handlers)) {
  registry.set(name, handler)
}
```

这一步得到该插件的一组电话名与处理器：`notes.updateStatus`、`notes.updateCheck`、`notes.updateInstall`。
单例复用键强制含插件标识，多插件不串内存状态与锁。其余配置（官方源、目录根、超时、轮询）全可选并带默认值，默认值等于现状，不传即走现状。

第 3 步：客户端侧接线（构建期派生取值）。

这一步的目标只有一句：**面板里不要写死电话名与轮询间隔，全部从本包派生出来**。做法是构建时把本包的客户端入口打包一次，把你的前缀代进去，在你的仓库里生成一个小文件，里面是三个电话名与轮询间隔的常量；面板直接引用这些常量。

在第 2 步已有的配置上再补两处接线：

```js
// 生成出来的文件里长这样（名字随你，这里是本仓用的形状）：
//   export const UPD_STATUS  = 'notes.updateStatus'
//   export const UPD_CHECK   = 'notes.updateCheck'
//   export const UPD_INSTALL = 'notes.updateInstall'
//   export const UPD_POLL    = 1000
//
// 面板里这样用（宿主侧用同一套 phoneNames，两边必须同前缀）：
host.call(UPD_STATUS, {})            // 查状态
host.call(UPD_CHECK, {})             // 查新版
host.call(UPD_INSTALL, { checkId, requestId })  // 装更新
setInterval(readStatus, UPD_POLL)    // 轮询间隔
```

面板不再出现 `'notes.updateStatus'` 这样的字面量，也不再出现写死的 `1000`。以后要换前缀或换轮询间隔，只改本包的配置再重新派生一次，面板一行都不用动。

派生要用的三样取值都在本包的客户端入口里，按名字取即可：

```js
buildClientPhoneNames('notes')  // 电话名拼法，与宿主侧同一套（前缀 + 点 + 动作名）
CLIENT_POLL.defaultMs           // 面板轮询间隔默认值（1 秒）
CLIENT_POLL.minMs               // 轮询间隔下限（250 毫秒，低于它要报错而不是静默取整）
manualCommand({ ... })          // 手工兜底命令的形状，与宿主侧同一套政策
```

注意 `manualCommand` 一般不用你在面板里算：宿主每次回包都会带一条现成的手工命令（见第 9 节），面板拿到就展示，不要自己拼。

**参考实现**：本包自带集成工具 `derive-client-values.mjs`，在你自己的插件仓库里跑一条命令即可（它的输入是包里的 `dist/client.js`，纯 JS，不需要你自己有 TypeScript）：

```sh
node node_modules/dsh-plugin-update/derive-client-values.mjs --prefix notes --out scripts/generated/updateClient.derived.js
```

生成的 `UPD_STATUS` / `UPD_CHECK` / `UPD_INSTALL` / `UPD_POLL` 就是上面那段面板示例要用的常量。以后换前缀或升级本包，重新跑一次这条命令即可。

自定义项与注意点：

- `--prefix` 必填，必须与宿主侧 `createHostUpdate` 传的 `prefix` 一致，否则面板调的电话名和宿主注册的电话名对不上。
- `--out` 必填，且故意不给默认值：默认值会覆盖别人的文件，写错比报错更糟。
- 工具用 `esbuild` 只做「打包一次」这件事（构建期使用，不引入运行期依赖）。esbuild 优先从本包自己的 `node_modules` 找，找不到再从你的仓库找；两处都没有时它会打印一句明确的安装提示，不静默失败。
- `--dry-run` 只打印生成内容、不写文件，用来先看一眼再决定。

客户端只做三件事：照前缀拼电话名、按间隔轮询查状态、装不上时展示手工兜底命令与待重启提示（见第 9、10 节）。
`pluginId` 必填（非空字符串且不含路径分隔符），`prefix` 不传即 `wf`，新插件务必传自己的前缀。

## 4. 配置默认值（规格 #591 冻结）

| 配置键 | 默认 | 说明 |
|---|---|---|
| `pluginId` | 必填，无默认 | 非空字符串且不含路径分隔符 |
| `prefix` | `wf` | 电话名前缀；新电话名 = 前缀 + 点 + 动作名 |
| `targetPackageName` | `dsh-mattpocock-skills-deck` | 要检查更新的那个包是谁 |
| `registryUrl` | `https://registry.npmjs.org/` | 官方源 |
| `homeDir` | 现推导 | 环境变量 `DSH_HOME` 优先，否则家目录下 `.dsh` |
| `checkTimeoutMs` | `10000` | 联网超时，须为有限大于 0 的数 |
| `confirmationTtlMs` | `600000` | 凭证有效期，须为有限大于 0 的数 |
| `installTimeoutMs` | `900000` | 安装时限，须为有限大于 0 的数 |
| `panelPollMs` | `1000` | 面板轮询，不得小于 250 毫秒 |

落盘目录按标识派生：家目录下 `updates` 加插件标识加使用范围短指纹，三文件名保持 `state.json`、`install.lock`、`before.json` 不变。标识取旧值时路径与旧原文一字不差（永久冻结）。读走双读（先新后旧），写只写新，旧路径只读保留。

安装执行两条路由：桌面宿主走桌面服务（激活范围对不上宁可不装，转手工命令），普通宿主走子进程参数数组（不经 shell、不用 `PATH` 名、不按系统分支）。

## 5. 冻结清单（动任一条即走破冰讨论）

默认电话名、入参回参形状、配置写法（只经函数入参注入）、配方五键形状、事件字段基线（三事件各加必填 `pluginId`）、默认旧路径。加可选键只需同步改文档与白名单。完整结论见规格 #591。

## 6. 门禁模板自查（#584）

每条事件四样东西：事件名、级别（`error`、`warn`、`info`、`debug`）、允许字段（之外的键一律不记）、脱敏引用（`codes` 是截断或散列代号，`rules` 是具名正则名，都是引用名，命中只记规则名不记原文）。`kind` 只为计数检查服务：`resident` 常驻（始终落盘的轻量轨迹）、`ondemand` 按需（只在调试开关打开时记）、`selfmon` 自监控（日志管道自己的故障行），三类实际条数须与清单自报的 `counts` 逐项核对。`guard` 可选，一句话写清采样或节流，无特殊守卫不写。

空模板见包内的 `event-list.template.json`（模板里的 `pluginId` 换成自己插件的标识）。调用方把清单拼成对象再传入，更新包不读盘：

```js
import { readFileSync } from 'node:fs'

const myEventList = JSON.parse(readFileSync('./event-list.my-notes-plugin.json', 'utf8'))
```

路径形式请调用方自己读成对象再传入，更新包不读盘（字符串直接传给检查器会报错并提示先读成对象）。对象形式的清单当场验形状，错了直接报错（含中文说明），不静默修补；数组形式同样被拦下（只收对象，数组多半是把事件表直接当成了清单）。

检查器经包根导出，都是纯函数，不新增日志事件：

```js
import { parseEventListManifest, checkEventFields, checkEventCounts } from 'dsh-plugin-update'

const manifest = parseEventListManifest(myEventList)
checkEventFields(manifest, 'host.call', ['method', 'pluginId'])
checkEventCounts(manifest)
```

`parseEventListManifest` 验形状，`checkEventFields` 做字段白名单检查（未知事件名、未知字段键都算不通过，并把名单带回给调用方），`checkEventCounts` 做计数检查（增删事件必须同步改清单的 `counts`，否则这里变红）。本仓现有 55 事件对照仍以 `research/489-appendix.md` 与 `tests/verify-log-*.js` 为准，本包只给格式与检查器，不复刻那张表，免得两处对照要双写同步。

第二家同机隔离自查（电话名、目录、锁互不串）：两家各传自己的插件标识与电话名前缀，电话名逐个不同，落盘目录与锁文件逐个不同，各拿各的锁互不阻塞。完整断言见包内 `tests/gate.test.mjs` 的双前缀一节，照抄即用。

零运行时依赖与数组无 shell 同样在 `tests/gate.test.mjs` 里断言：`package.json` 无 `dependencies`，包内只引用相对路径与 `node:` 内建；执行器只走参数数组，不经 shell、不用 `PATH` 名、不按系统分支。

## 7. 发布前 build 与门禁跑法

发布前按顺序两步（演练只跑 dry-run，不真发）：

```sh
node packages/dsh-plugin-update/build.mjs
cd packages/dsh-plugin-update && npm publish --dry-run
```

编译产物在 `dist` 下（9 个 JS：`client.js`、`commands.js`、`config.js`、`gate.js`、`host.js`、`ports.js`、`reader.js`、`service.js`、`store.js`），本地生成、不入库。发布白名单（`files`）共 4 项（`dist`、`event-list.template.json`、`README.md`、`LICENSE`，另加隐含的 `package.json`；`dist` 下 9 个 JS 全带上）。加新文件进包时同步改 `files` 并重跑 dry-run 确认文件数。

门禁跑法（改包后全跑，退出码全 0 才算过）：

```sh
node --test packages/dsh-plugin-update/tests/*.test.mjs
node tests/verify-update-regression.js
node tests/verify-update-freshness.js
node tests/verify-update-install.js
node tests/verify-update-routes.js
node tests/verify-update-panel.js
node tests/verify-log-fields.js
node tests/verify-log-count.js
```

## 8. 八种装不了原因（`blockedReason` 对照表）

查状态返回的快照里有六个字段，其中 `canInstall` 说能不能装、`blockedReason` 说装不了的原因。
能装时原因是空，不用看表；装不了时原因一定是下面八种之一，照表处理，不要自己猜。

| 原因 | 中文含义 | 用户该做什么 |
|---|---|---|
| `unknown-profile` | 使用范围认不出（名字非法或目录不存在） | 检查使用范围名是否含特殊字符、目录是否还在；这种情形不给手工命令，先把范围修好 |
| `source-install` | 当前是从源码装的，不是按版本号装的 | 这种情形不给手工命令；想走更新先按版本号重装一次 |
| `invalid-installation` | 已装的包不完整（名字对不上、版本非法、入口文件缺失） | 重装当前版本，修好已装目录再查更新 |
| `installation-changed` | 安装位置在使用中途变了（换了目录或换了包） | 重新打开宿主再查一次，让指纹重新绑定；还出现就重装 |
| `pending-restart` | 新版已装到磁盘，正在跑的还是旧版（见第 10 节） | 重启宿主，让新版跑起来；这是正常终态，不是失败 |
| `registry-conflict` | 本地声明的版本与磁盘实际版本互相矛盾 | 打开使用范围的清单文件，看目标包名那一行写的是不是版本号，改成版本号再试 |
| `incompatible-node` | 新版要求的 Node 与当前运行的 Node 对不上 | 先升级 Node 到 22 或更高，再查更新 |
| `recovery-required` | 上次安装被打断，留下一个半截任务 | 重新点一次安装；一直出现就按第 12 节排错 |

面板拿到非空原因时，直接展示上表“用户该做什么”那一列的一句话，不要只展示英文原因本身。

## 9. 手工兜底命令（自动装不上时给人复制执行）

每次查状态与查新版都会顺带回一条手工命令（字段名 `manual`），能给则给、不能给则为空。
为空是正常的两种情形：源码安装与认不出使用范围（上表前两行），此时不展示命令，只展示原因。

命令形状固定（精确版本、官方源、`--save-exact`），例子里的名字是第 3 节那家自己的名字：

```sh
dsh plugin --profile my-web add --save-exact my-notes-plugin@1.2.3 --registry=https://registry.npmjs.org/
```

其中 `my-web` 是当前使用范围名，`my-notes-plugin@1.2.3` 是要装的目标包加精确版本。
使用范围名含空格或特殊字符时命令里会自动加引号，复制整行执行即可。
网络受限时用户可自行去掉 `--registry=` 尾巴走本地源；桌面宿主激活范围对不上时自动装会诚实失败，同样复制这条命令手工执行。

宿主侧每次回包都带 `manual`，面板侧每次拿到都刷新展示，不要缓存旧命令。

## 10. ⚠️ 待重启提示（显眼，必须做）

`pending-restart` 不是失败，是“磁盘已是新版、正在跑的还是旧版”，必须重启宿主才生效。
面板必须满足三条，少一条即不合格：

1. 用显眼样式单独展示（例如顶部横幅加 ⚠️），不要只在日志或悬停提示里藏一行小字。
2. 文案说清两件事：新版号是多少、重启后才生效。例子：`⚠️ 新版 1.2.3 已装好，正在跑的还是 1.2.2，重启宿主后生效。`
3. 待重启期间不再提供安装按钮（快照里 `canInstall` 已为假），只提供重启指引与第 9 节的手工命令查询入口。

判断条件只看快照：`blockedReason === 'pending-restart'` 即展示，`installedVersion !== runningVersion` 可作辅助校验，不要自己另起一套版本号比较。

## 11. 轮询与凭证有效期可调

四个时间都可在第 3 节第 2 步的配置里调，不传即走默认值（默认值等于现状，默认行为不变）。
只卡下限，不设上限，越界直接抛错而不是静默取整。

| 配置键 | 默认 | 下限 | 调大场景 |
|---|---|---|---|
| `checkTimeoutMs`（联网超时） | `10000`（10 秒） | 须为有限大于 0 的数 | 慢网络查新版总超时 |
| `confirmationTtlMs`（凭证有效期） | `600000`（10 分钟） | 须为有限大于 0 的数 | 用户查完新版隔很久才点安装，凭证过期要重查 |
| `installTimeoutMs`（安装时限） | `900000`（15 分钟） | 须为有限大于 0 的数 | 大包安装超过 15 分钟被终止 |
| `panelPollMs`（面板轮询） | `1000`（1 秒） | 不得小于 250 毫秒 | 轮询太密想调疏，或想调密但不低于 250 毫秒 |

例子（还是第 3 节那家自己的名字，只调两项，其余走默认）：

```js
const update = createHostUpdate(
  { ctx, logCtx },
  {
    pluginId: 'my-notes-plugin',
    prefix: 'notes',
    targetPackageName: 'my-notes-plugin',
    confirmationTtlMs: 20 * 60_000,
    panelPollMs: 2000,
  }
)
```

客户端轮询间隔同样走 `assertPollInterval` 校验，小于 250 毫秒直接抛错。
另有两处固定不变、不要当成可调项写进文档：查新版 2 秒内重复点击复用上次结果、安装执行终止宽限 3 秒。

凭证过期（`check-expired`）是正常错误码，不是程序缺陷：用户拿着过期的检查编号点安装一定失败，面板此时重新调一次查新版、拿新凭证再提交即可。

## 12. 排错

按从常见到少见的顺序查，一次只动一处，动完重查一次状态。

1. `pluginId` 报错说必填或含路径分隔符：换成自己插件的标识，非空且不含 `/` `\`。
2. 电话名串台（两家插件收到对方的电话）：检查两家 `prefix` 是否相同，相同即改成不同的前缀；电话名永远从 `update.phoneNames` 读到，不要自己拼字符串。
3. 面板轮询报错说小于 250 毫秒：把 `panelPollMs` 调到 250 或更大。
4. 查新版总超时：先调大 `checkTimeoutMs`，再检查官方源地址是否写错、网络是否通官方源。
5. 点安装报 `check-expired`：凭证过期了，重新查一次新版再点安装；不要重试旧编号。
6. 点安装报 `update-busy`：同一使用范围同时只装一个，等当前任务结束再点；面板轮询看到任务离开 `installing`/`verifying` 即为空闲。
7. 手工命令为空：对照第 8 节前两行（源码安装或认不出使用范围），先修范围再要命令。
8. 装完版本号没变：先看是否 `pending-restart`（见第 10 节），是则重启宿主；不是则按第 8 节的表格查原因。
9. 桌面宿主自动装失败但命令端能装：检查桌面当前激活的使用范围是不是插件所在的那一个，对不上时自动装一定诚实失败，复制第 9 节命令手工执行。
10. 还定位不到：打开调试日志，按插件标识过滤 `host.call`、`host.call.fail`、`update.install.exec` 三个事件，看 `pluginId` 与 `route`、`exitCode` 字段；日志里不记命令与路径原文，只看枚举与数字即可定位。

## 13. 新人三步自查（默认路径跑通清单）

新人照第 3 节例子把名字换成自己的之后，按下面三条逐项打勾，全勾即默认路径跑通：

1. 第 2 步调通：宿主启动不报错，`update.phoneNames` 读到自家前缀的三电话名（例如 `notes.updateStatus`），查状态返回六字段快照。
2. 第 3 步调通：面板按间隔轮询到快照，能展示第 8 节的原因文案；有新版时安装按钮可用，无新版与待重启时按钮状态正确。
3. 待重启与兜底可见：模拟一次 `pending-restart` 看到第 10 节横幅，模拟一次自动装失败看到第 9 节手工命令可复制执行。

本节三条全绿即达到本票验收“新人照文档三步跑通默认路径”。
