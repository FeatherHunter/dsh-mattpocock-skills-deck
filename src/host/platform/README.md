# host/platform — 平台抽象层（次缝）

> **占位说明**：本目录归子图 **「定稿平台抽象层（全 deck OS 可插拔）」（#113）** 设计，本 MAP 只确立结构。

## 结构（与主缝同构）

```
platform/
├── index.js          ← 平台抽象接口 + 按 process.platform 分发
├── darwin/
├── win32/
└── linux/
```

每个 OS 子目录提供 `Platform` 实现的**一个版本**；后端（github/markdown/gitlab）访问 OS 只经 `createPlatform(ctx)`，绝不直接 `ctx.get('fs')` / `path.join` / 硬编码分隔符。

## 原语（#113 定）

- `os()` 平台探测
- `env(name)` / `getHome()` —— 用户主目录 / HOME 优先级（`#110` macOS getHome 根治点）
- `path.join(...)` 跨平台拼接（杜绝反斜杠硬编码）
- `fs` —— DSH 沙箱文件系统封装（读穿透、写有栅栏）
- `resolveExecutable(bin)` —— gh / glab / sh / cmd

## 归属

- `#110`（macOS 环境检查探测失败）与 PR `#106`（macOS 用户主目录探测 + 路径分隔符适配）的收尾**归此层**，不在探测逻辑里打补丁。
- 契约层 `host/tracker/backends/*` 只依赖本层接口，不依赖某具体 OS 实现。
