# src/tracker/kernel — 共享内核（房间与宿主都要用的判定件）

这份目录是 #1159 建的归口。在它出现之前，房间要用的那几份判定件散在 `src/tracker/` 根上（`preflight.ts`、
`error-rules.ts`、`identity-keys.ts`、`detection/workspace-ownership.ts`），房间引它们只能靠
`tests/tracker-room-imports.json` 逐文件点名放行；有了这份目录，放行按目录一条就够。
来龙去脉与四个名字（契约 / 内核 / 房间 / 装配点）的分工见 `docs/adr/20261014-tracker-room-boundary.md`。

## 这里住什么

- `preflight.ts` —— 判档入口与失败结果的统一构造（`classifyError` / `verdictOf` / `fail`）
- `error-rules.ts` —— 判档规则表的唯一真源（哪句话归哪一档写在这里）
- `identity-keys.ts` —— 票身份算法（`effortOf` / `idOfParts` 等）
- `workspace-ownership.ts` —— 「这个工作区的属主是不是当前运行用户」的单一判断
- `outbound-tiers.ts` —— 出站命令的档位策略（读 12 秒 / 写 30 秒 / 探活 3 秒的纯判定；房间起 gh 命令前
  按它定超时，宿主起同一批命令时也按它定，所以它是两边共用的纯函数，不是宿主私有件）

**不在这里的**：契约层（`src/tracker/contract/`，只有类型与数据）、具体后端的实现（`rooms/<名字>/`）、
装配点（`registry/builtins.ts`）。

## 契约层与内核的分界

判据不是新造的，是仓里早就写着的那条：**契约层只有类型与数据、没有运行时实现**
（`.dependency-cruiser.cjs` 的两条规则与 `tests/verify-contract-types.js` 第二项守着）。
带规则表、带判断逻辑的运行时实现因此进不了契约层 —— 给它一个有名有界的家，就是这份目录。

一句话：房间与宿主都要用、又不是「类型与数据」的，放内核。

## 引用规矩

- **房间可以引内核**：登记表 `tests/tracker-room-imports.json` 里有 `^src/tracker/kernel/` 一条，不用逐文件点名。
- **宿主也可以引**（`src/host/**` 引内核是允许的方向：内核里的件本来就是两边共用的）。
- **内核不在 `same-layer-import-tracker` 的判域里**：`.dependency-cruiser.cjs` 那条规则的 `pathNot` 写着
  `^src/tracker/kernel/`，所以内核里的文件互相引不算同层违规（今天这几份互相零依赖，能不引就不引）。
- **deck 不许直接引内核**：`deck-deep-import` 的 `to` 已含 `^src/tracker/kernel/`。deck 需要后端能力时，
  先把那件事加到契约层的公开面上，再从 deck 引它。

## 加一份新件时要做什么

1. 文件写进来，用 TypeScript。类型检查归属 `src/tracker/tsconfig.json`（`include` 是目录通配，不用点名登记）。
2. 如果房间要引它，**登记表不用改**（`^src/tracker/kernel/` 那条已经覆盖）。
3. 跑 `node --import ./scripts/ts-hook.mjs tests/verify-dependency-rules.ts` 与 `npm run typecheck`；
   构建产物由 `scripts/build.mjs` 按 `src/tracker → package/tracker` 的镜像规则自动生成，也不用登记。
