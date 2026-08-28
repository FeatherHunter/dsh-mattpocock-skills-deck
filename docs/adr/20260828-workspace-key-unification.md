# ADR：工作区钥匙规整统一（workspace key unification · 地图 #278 A 方案）

> 日期：2026-08-28 定版（承接 #276 规格与 #279 决议）
> 地位：#279「统一路径入口」的真落盘约束。#279 原票内决议所称"15 处已接入"与 HEAD 不符（票内清单已过期）；本 ADR 记录实际落盘范围与边界，与 #276 冲突以更新日期者为准（CONTEXT.md 同款两条规则）。
> 关联：#276（规格父票）· #278（实施地图）· #279（统一路径入口）· #284（链缓存与九格退役）· #295（mac 回归单，另案）

---

## 1. 背景（第一性原理与证据链）

- **用户高频场景是多工作区快速切换**：3 个不同工作区，每 5-10 分钟来回切，每天必走。不是"同一文件夹三种写法"的考题——多工作区隔离是主路。
- **同一工作区会以多种写法到达 host**：客户端 `detectCwd` 从会话快照的六个字段（cwd/workspacePath/projectPath/path/dir/root）探测 cwd，不同字段来源的写法可能不同（盘符大小写、尾斜杠、斜杠方向）。host 侧按工作区分桶的抽屉若用原始串做钥匙，同一工作区就分裂成多桶：重复 25 名技能探测与 gh 网络调用、缓存打不中、失效删除删不中（删不中即缓存僵尸——"装了仍报未装"的冻结形态）。
- **判装本身天然不串**：`probeSkill` 走 DSH skills 服务（`ctx.get('skills')`），零 cwd 参数（#280 唯一尺），技能判定是进程级。会串的是其余按 cwd 分桶的抽屉。
- **`workspaceKey.js` 洗衣机已在但零接线**：提交 e62fd61 落了 `normalizeWorkspacePath` / `canonicalWorkspaceKey`，但全库无调用点、无 ADR、无测试（`git log --all` 在案）。

## 2. 目标

1. **A→B→C→B→A 连续切 5 轮不串**：同一工作区的任何写法洗成同一把钥匙；不同工作区永不合并成同一桶。
2. **读写删三侧同形**：抽屉的写入、命中、失效删除用同一把规整钥匙——否则删除删不中，缓存变僵尸。
3. **不扩大回归面**：只接按工作区分桶的抽屉；不做三写法字节一致的全量考古接线。

## 3. 决策

### 3.1 钥匙形状（洗衣机语义）

- `canonicalWorkspaceKey(raw, { getPlatform, getFs, getDefaultCwd })`：绝对路径直接短路（零 fs 调用，主流形态）；非绝对经 `fs.resolve`；再退 `getHome` join；无平台时原样返回。空值回退默认 cwd（DSH 进程目录）。
- `normalizeWorkspacePath`：Windows 小写折叠 + 尾斜杠去除 + 斜杠方向归一；POSIX 保持大小写。
- **根白名单（本次修订）**：盘符根（`D:\`，normalize 恒带尾反斜杠）、裸斜杠、POSIX 根保持原样不去斜杠。**UNC 共享根不在白名单**——`\\srv\share\\` 与 `\\srv\share` 必须洗成同一把钥匙（统一去尾斜杠）。原实现的 UNC 正则把带尾斜杠形态当根放行、不去尾斜杠，同工作区两种写法仍会分桶；因洗衣机此前零调用方，本次直接修正语义（verify-3-workspace-switch P1 在案）。

### 3.2 接线范围（按工作区分桶的抽屉清单，读写删三侧同形）

| 抽屉 | 接线点 |
| --- | --- |
| `repoKeys`（owner/name 按 cwd 缓存） | `getRepoKey` 首行 |
| `repoRoots`（git 根按 cwd 缓存） | `getRepoRoot` 首行 |
| `chainCache`（30s 单槽，per cwd+backendId+lang） | `wf.chain` 入口 |
| 探测结果缓存 | `wf.detect` 入口 + `detectionService.detect` 入口（handle.cwd 洗后再进 store） |
| 快照单槽 `cache`（60s，per cwd） | `wf.snapshot` 入口 |
| `workspaceStore` 失效路径 | `wf.bind` 入口（bind 句柄与 invalidate 同形） |
| 建仓流程（`wf.initPublish`）缓存失效 | 三处删除点全部先洗钥匙再删 |

不接的：`panelSyncByKey` / `panelSyncCwdOfRepo` / `panelSyncRepoTriedAt` / `panelDirtySince`（面板同步族）——它们内部对原始串自洽（写入方与比较方同源），且仓库身份经 `getRepoKey`（已自洗）产出 owner/name，跨写法天然同桶。客户端侧 `snapshotByCwd` 等已有 `normKeyClient` 自洽，不在本次范围。

### 3.3 纪律

- **回退不破坏同形**：`canonicalKey` 异常时回退原串；回退发生在读写删共同入口，三侧仍同形。
- **空 cwd 语义不变**：`args.cwd` 缺失仍回退 `DEFAULT_CWD`（#179 回切自愈口径），规整发生在回退之后，保证默认目录也拿到稳定钥匙。
- **性能**：绝对路径短路零 fs 调用；`getPlatform` 是惰性单例；30s/60s 缓存 TTL 不变，快速切换场景每次至多一次纯字符串规整，无需再加记忆缓存。
- **已知边界（留档不修）**：客户端 `normKeyClient` 在全平台无条件小写折叠——POSIX 上仅大小写不同的两个真实目录会在客户端 LRU 里同桶。用户场景（Windows 盘符路径）不受影响；POSIX 大小写区分目录如成为真实场景，另开票把客户端钥匙也接到按平台折叠的规整器。

## 4. 验收

- `tests/verify-3-workspace-switch.js`（已接入 `npm run verify`）：
  - P1 洗衣机数学：大小写折叠、尾斜杠、根白名单、三级回退、空值回退；
  - P2 三区五轮推演：旧钥匙必然分裂（缺陷在案），新钥匙每区恰一桶且三区互不合并；
  - P3 接线在场守卫：3.2 表中全部接线点必须在场（门禁扫描先例同 `verify-client-hardcode-gate`）。
- 全量 `npm run verify` 绿后合入。
