# src/shared/host-timer —— 宿主计时器句柄的撤销与 OpContext.timers 包装

这个域只解决一件事：**宿主计时器服务交回的句柄怎么撤销**，以及把它包成 Tracker 后端要的
`OpContext.timers`（`{ setTimeout, clearTimeout }`）时那份唯一的实现。立域的原因是 #1115：
在这之前，宿主里有六处各自手写这段包装，写法不一样，其中两种在真句柄上都是空操作。

## 为什么不能各写各的

宿主计时器服务是 `ctx.get('timer')`，由 DSH 里的 `@deepseek-ai/cordis-plugin-timer` 提供。
它的 `timeout(回调, 毫秒)` 交回的是一支**可调用的函数** —— cordis 的 effect 撤销器，不是数字句柄、
也没有 `dispose()` 方法。2026-10-14 实测：

| 撤销写法 | 结果 |
| --- | --- |
| 直接调用句柄本身 `handle()` | 撤销成功（fiber 上的 effect 数 1 → 0，回调不再触发） |
| 全局 `clearTimeout(handle)` | 不报错，静默无效，回调照常触发 |
| `handle.dispose()` | 抛 `TypeError`：它没有这个方法 |

撤销不掉的那一笔等待会一直活到自己到点。对「等不到就判还没答完」那条兜底来说，就是每次
未绑定工作区选后端都多留一个最长 30 秒的活计时器。详见仓库 issue #1115 的证据一节。

## 文件怎么摆、怎么用

- 手写真源：`src/host-timer/src/host-timers.ts`（本目录下 `src/` 子目录里）。
- 构建产物：`src/shared/host-timer/host-timers.js` —— 由 `scripts/build.mjs` 逐份转译生成，
  **不进版本库、不要手改**；构建脚本按「目录里有 `tsconfig.json`」自动认域，不需要在别处登记。
- 调用方（宿主侧，六处）：`src/host/platformChannel.js`（两处）、`src/host/commentThreads.js`、
  `src/host/workspaceCwd.js`、`src/host/snapshotBuild.ts`（两处）、`src/host/refresh/wiring.js`。
  写法一律是 `timers: hostTimers(timer)`，不要再自己写 `setTimeout` / `clearTimeout` 两个字段。

```js
import { hostTimers } from '../shared/host-timer/host-timers.js'
// ...
const opCtx = { cwd, platform, fs, caller: 'xxx', timers: hostTimers(timer), exec }
```

域里那份源码不 import 任何模块（共享层里同层互引被 `tests/verify-dependency-rules.ts` 拦住），
要判的三档形状与「为什么是这个顺序」都写在 `src/host-timer/src/host-timers.ts` 的文件头注释里；
改动前先读它，跑 `node --import ./scripts/ts-hook.mjs tests/verify-1115-timer-handle.ts`。
