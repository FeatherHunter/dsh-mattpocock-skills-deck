# demo-mini — 第三方扩展范式样板

> 定版：#147 7 行 + #148 落地。身份 `demo-mini`（对外 `acme.demo` 占位），不默认装配，不进 `src/host/tracker/backends/`。

## 你将得到
- `index.js`：`demoModule`（`id/label/create/matches` 四件套）+ `createDemoBackend`（内存实现 4 ops）
- `normalize.js`：`shared/tracker/shape.js` 归一化（核心字段恒存在 + 能力字段 EMPTY/MISSING）
- `matches.js`：`platform.fs` 探 `cwd/.demo/config.json` 或 `.scratch/map.md`，`boolean`（超时 3000ms 由 registry 托管）
- `fixtures/demo-real/`：采样固件（已脱敏，可直接 `runPlayback`）

## 一行接入
```js
import { demoModule } from '../../examples/demo-mini/index.js'
import { createRegistry } from '../../src/host/tracker/registry.js'
const registry = createRegistry(backendCtx)
const disp = registry.register(demoModule)
// DSH 插件：ctx.effect(() => disp.dispose())
```

`describe` 不覆写，复用 `registry.describe` 骨架；余下 9 ops 由 `wrapTracker` Proxy 补 `unsupported` 桩。

## 验证
```js
import { demoModule } from '../../examples/demo-mini/index.js'
import runContractTests from '../../tests/tracker-contract/harness.js'
import { demoFixture } from '../../tests/tracker-contract/fixtures/demo.js'
runContractTests(demoFixture) // G4

import { runPlayback } from '../../tests/tracker-contract/runner/index.js'
await runPlayback({ fixturesDir: 'examples/demo-mini/fixtures/demo-real' })
```
