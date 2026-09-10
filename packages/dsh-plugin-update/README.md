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
- `dist/client.js`（客户端侧用）：电话名拼法、轮询时间口径、手工兜底命令形状。客户端侧用文本拼接消费（取编译后函数的声明体拼进插件主文件闭包），面板界面不进包。

## 3. 三步接入（宿主侧）

```js
import { createHostUpdate } from 'dsh-plugin-update'

const update = createHostUpdate(
  { ctx, logCtx },
  { pluginId: 'my-plugin', prefix: 'my' }
)
// 把 update.handlers 按键注册进自己的电话表，电话名从 update.phoneNames 读到。
for (const [name, handler] of Object.entries(update.handlers)) {
  registry.set(name, handler)
}
```

三件事要对上：

1. `pluginId` 必填，换成自己插件的标识（非空字符串且不含路径分隔符）。
2. 不传 `prefix` 即 `wf`；当前插件传 `wf`，拼出的 3 个电话名、落盘目录、三个文件名与现状一字不差。第二个插件传自己的前缀即隔离。
3. 其余配置（目标包名、官方源、目录根、超时、轮询）全可选并带默认值，默认值等于现状。

一次调用得到该插件的一组电话名与处理器：单例复用键强制含插件标识，多插件不串内存状态与锁。

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
