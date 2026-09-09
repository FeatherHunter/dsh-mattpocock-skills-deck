# 日志包集成教程（从安装到首条落盘）

给从没见过日志包的 DSH 插件作者：照着下面步骤按序做，做完就有第一条日志落盘。概念与默认值总表见包内的 `README.md`，这里只讲动手顺序。

全程用词：日志系统指日志功能本身，日志包指装着日志系统的这个 npm 包。电话指宿主对外提供的方法；落盘指宿主统一写本地文件的动作。

## 步骤 0. 确认环境

Node 22 或更高：

```sh
node --version
```

## 步骤 1. 安装

```sh
npm install dsh-log
```

包还没公开发布时，这条命令装不上：先用本地路径或工作区引用代替（例如 `npm install ../dsh-log`），等包发布后才用上面的命令。发布前用 `npm view dsh-log` 查一次重名：返回 404 表示名字还没被占（本次查重 404，证据贴在 #562 票评论）。

## 步骤 2. 宿主侧接线（三步接入）

在宿主启动处写：

```js
import { createHostLog, registerHostLogPhones } from 'dsh-log/host'

const hostLog = createHostLog(
  { fs, timer, getCacheDir, getPlatform, DEFAULT_CWD },
  { pluginId: 'my-plugin' }
)
registerHostLogPhones(new Map(), hostLog)
```

三件事要对上：

1. `pluginId` 必填，换成自己插件的标识（小写英文字母、数字、中横线，1 到 32 个字符，大写直接报错）。
2. 五个运行依赖由你传入现成的对象：文件服务 `fs`、计时器 `timer`、取缓存目录函数 `getCacheDir`、取平台函数 `getPlatform`、默认工作目录 `DEFAULT_CWD`。
3. 注册表传你自己的电话注册表（例子用 `new Map()` 示意）；注册成功的 5 个电话名可从 `hostLog.phoneNames` 读到，形如 `my-plugin.logBatch` 等。

只传 `pluginId` 就用上全部默认：电话名前缀回退到插件标识，目录名派生为 `logs-my-plugin`，开关文件名派生为 `log-switch-my-plugin.json`，文件名按天。第二个插件不得与第一个共用同一目录，走默认派生自然分开。

如果注册时报“电话名已被注册，不覆盖旧的”，说明这个前缀已被别的插件用掉：换一个没被用过的前缀（`prefix` 显式传入），不要复用默认前缀 `wf`（`wf` 只给当前插件用）。

## 步骤 3. 客户端侧接线（两种消费二选一）

推荐直接 import：

```js
import { createClientLog } from 'dsh-log/client'

const clientLog = createClientLog(
  { host, timer, storage, broadcastLogSwitch },
  { pluginId: 'my-plugin' }
)
```

四个依赖全可选，有现成的就传，缺了走退化路、不抛错：宿主调用器 `host`、计时器 `timer`、存储 `storage`（只传 `storage`，旧名 `localStorage` 是迁移期兼容，两个都传以 `storage` 为准）、开关广播 `broadcastLogSwitch`（没有就不传，不报错）。前后缀保持与宿主侧同一个 `pluginId`，两端拼出的电话名自然对上。

只有把客户端拼进插件主文件闭包一起运行的插件，才用文本拼接：构建时取客户端入口编译后的声明体，去行首 `export` 后拼进闭包，调用时把闭包里现成的四个名字原样传给工厂。文本拼接消费方式只走客户端入口的声明体文本。

## 步骤 4. 写第一条日志并看它落盘

```js
// 开关默认关闭，错误与告警始终记，信息与调试只在开关打开时记。
// 调试阶段先打开开关（面向用户的开关界面见步骤 6）。
await clientLog.setLogSwitch(true, 1)
clientLog.log('info', 'my-plugin.hello', { step: 'started' })
clientLog.flush()
```

第二个参数是采样率，取 0 到 1 之间的小数，1 表示全量（默认就是 1）；传非数字时保持旧值不变。

随后在缓存目录下的 `logs-my-plugin` 目录里看到当天的 `年月日.log` 文件，里面有这一条。宿主是唯一的落盘者：客户端只进队列就返回，转发走电话，落盘走宿主刷盘链路。

记日志前先判断开关（高频调用处必须写，日志器体内的判断只是兜底）：

```js
if (clientLog.isEnabled('info')) {
  clientLog.log('info', 'my-plugin.step', { step: 'done', latencyMs: 12 })
}
```

累计丢弃数随时可读：`clientLog.getDroppedCount()`。失败只计数不抛错，队列满与转发失败都只加到这个数里。

## 步骤 5. 接入对象清单（可选，但推荐）

1. 把包内的 `event-list.template.json` 复制一份，`pluginId` 换成自己插件的标识，按实际事件填 `events` 与三类自报计数 `counts`。
2. 自己读成对象再传给 `eventList`（日志包不读盘）：

```js
import { readFileSync } from 'node:fs'

const myEventList = JSON.parse(readFileSync('./event-list.my-plugin.json', 'utf8'))
const hostLog = createHostLog(deps, { pluginId: 'my-plugin', eventList: myEventList })
```

3. 发布前用检查器自查（字段白名单与计数检查）：

```js
import { parseEventListManifest, checkEventFields, checkEventCounts } from 'dsh-log/host'

const manifest = parseEventListManifest(myEventList)
checkEventFields(manifest, 'my-plugin.hello', ['step'])
checkEventCounts(manifest)
```

每条事件四样东西：事件名、级别、允许字段（之外的键一律不记）、脱敏引用（只记规则名不记原文）。增删事件必须同步改清单的 `counts`，否则计数检查变红。细节见 `README.md` 第 7 节。

## 步骤 6. 界面建议（导出、清空、开关）

- 导出：在状态栏菜单与设置页各放一个导出入口，都调 `logExport`（入参可选日期，不传导出当天）。成功把回参的 `text` 存成文件给用户；失败分支记一行 `log.export.fail`（走 `logExportFail`，成功路径不调用）；失败原因只给机器码，面向用户的文案由界面经多语言系统转换，日志包内不写面向用户的中文字符串。
- 清空：在设置页放清空入口，调 `logClear`（`date` 传某天或 `all`），回参的 `removed` 告诉用户删掉几个文件。
- 开关：在设置页放调试开关（是否开启加采样率），调 `setLogSwitch` / 启动时调 `reconcileLogSwitch` 向宿主对账（以宿主为准）。开关写失败保持旧值（失败原因只给机器码：`host-unavailable`、`host-rejected`、`switch-timeout`、`stale` 等），由调用处提示用户，不回退为开启。

## 常见坑

1. 多进程同时写同一个目录会写坏：一个插件只建一个日志库实例，目录不要两个实例共用；第二个插件走默认派生自然分到不同目录。
2. Windows 文件名里不能有冒号：四段式文件名的启动时间已把冒号与斜杠转写为中横线，目录派生与标识字符约束也排除了文件不安全字符，不要自己拼带冒号的文件名。
3. 目录漂移（缓存目录变化导致找不到旧日志）：取缓存目录走传入的 `getCacheDir`，不要在包外自己缓存一份目录路径；目录里只记散列不记原文路径。
4. 电话名撞名：已注册的电话名再注册会报错、不覆盖，换前缀解决，不要复用 `wf`。
5. 标识大小写：收到大写直接报错，不做静默转小写，全小写重传即可。
6. 导出 `bytes` 是日志原文的字符串长度，不是真实字节数，按现状使用即可。
7. 开关写成功后，采样率以客户端请求时的值为准更新本地，不等宿主回（宿主回参本来就没有采样率）。

## 自查清单（按本文档能否走通）

- [ ] `npm install dsh-log` 成功，Node 22 或更高。
- [ ] 宿主侧三步接入跑通，`hostLog.phoneNames` 里 5 个电话名都带自己的前缀。
- [ ] 客户端二选一接通，高频调用处写了外层 `isEnabled` 判断。
- [ ] 首条日志落盘：在派生目录里找到当天文件并看到该条。
- [ ] `getDroppedCount` 可读；失败场景（断开宿主）只计数不抛错。
- [ ] 清单接入（如做）：模板已复制改名，检查器三函数全过，计数逐项一致。
- [ ] 发布前跑过第 9 节门禁（包内单测与 14 个日志门禁全绿，55 事件不变），dry-run 文件数与 `README.md` 第 9 节对上。
