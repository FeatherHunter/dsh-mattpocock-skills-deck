# host/platform — 平台抽象层（次缝 · 通用层）

> **归属**：本目录为子图 **「定稿平台抽象层（全 deck OS 可插拔）」（#113）** 的次缝；本实现为 **#130 通用层**。
> 权威依据 = **#129**（CLOSED 定稿接口）+ **#113**（D1–D7、已确认 5 条、裁决 A/B）。
> 本层 `createPlatform(ctx)` 注册为宿主侧服务（`ctx.get('platform')` = 已解析实例，**非工厂**）；host 构建
> `BackendContext` 时调用一次、全局复用（符合契约「非工厂」——避免每后端各建实例、各持缓存）。

## 结构（与主缝同构）

```
platform/
├── index.js          ← 平台抽象接口 + createPlatform(ctx) 工厂 + 按 process.platform 静态 import 查表 + 通用包装（单点）
├── darwin/  win32/  linux/   ← 每 OS 一个适配器（本票只提供最小结构 + TODO；OS 专属行为归各 OS 底座 map）
└── README.md
```

每个 OS 适配器只提供 OS 专属原语（`pathImpl` / `getHome` / `resolveExecutable`）；通用包装
（`getHome` 缓存、`env` 只读视图、`resolveExecutable` throw→null、`path` 委托 `node:path`、`fs` 透传）
由 `index.js` 的 `composePlatform` **单点**提供，跨 OS 不重复。

## 原语（#129 定稿接口）

- `os` —— 当前平台 kind（`'win32'` / `'darwin'` / `'linux'`）。
- `getHome(): Promise<string|null>` —— 跨 OS 单点；结果缓存在实现内部（替换现有 userHome 缓存变量；
  不暴露 getHomeFresh，缓存失效策略由平台自定——进程内主目录不变，默认终身缓存）。
- `path` —— 同步对象 `join / sep / dirname / basename / resolve / normalize / isAbsolute / relative`
  （**全部委托 `node:path`**：win32→`node:path.win32`，darwin/linux→`node:path.posix`）+ 唯一异步成员
  `joinHome(...segs)` = `path.join(await getHome(), ...segs)`——deck 永不字符串拼接 `'\\'`。
- `resolveExecutable(name): Promise<string|null>` —— 包装 DSH `subprocess.resolveExecutable`（按名别名 + 环境变量覆盖）；
  DSH 找不到时 throw → 本层 try/catch **转 null**。
- `fs` —— **透传** `ctx.get('fs')`（DSH dsh-fs-sandbox：读穿透、写有栅栏）；**无 `mkdir`**。
  **path-shaped（lstat / resolve）vs target-shaped（readText / writeText / stat / listDir）**——
  实现者勿把裸路径串直接喂给 target-shaped 方法。
- `env` —— 只读视图 `get(k)` / `has(k)`；`process.env` 只读包装（只读不改、不外发；spawn 一律经 DSH subprocess）。

## 归属与边界

- `#110`（macOS 环境检查探测失败）与 PR `#106`（macOS 用户主目录探测 + 路径分隔符适配）的收尾**归此层**，
  不在探测逻辑里打补丁（D2 直接收尾）。
- 契约层 `host/tracker/backends/*` 只依赖本层接口，不依赖某具体 OS 实现。
- **#130 只实现通用层**：各 OS 专属行为（win32 盘符护栏、cmd→cmd.exe 别名、getHome 优先级细节、环境变量覆盖）归
  **3 个 OS 底座 map**（#113 子票另行规划）；调用点迁移 = 独立 task 票；打包通道/CI = #136 宿主构建管线。
