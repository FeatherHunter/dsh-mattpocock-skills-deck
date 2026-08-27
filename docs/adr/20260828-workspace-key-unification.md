# ADR：统一路径入口（规整键唯一真相）

日期：2026-08-28 生效（效力规则见 CONTEXT.md「版本与效力」，后续冲突以更新日期者为准）

状态：已采纳

关联：#276（规格父票，交付块②）· #279（落地）· Wayfinder 地图 #278

## 背景（第一性原理）

多工作区并行时，宿主以 `cwd` 为分桶键的全部状态（快照缓存、repoKey 缓存、per-workspace 内存表、探测编排、状态派生）曾直接使用客户端传入的原始字符串。同一仓库以三种合法写法到达时——

- 绝对路径尾杠有无（`D:\\repo\\proj` vs `D:\\repo\\proj\\` vs `D:\\repo\\proj\\.`）
- 斜杠风格（`D:/repo/proj` vs `D:\\repo\\proj`，仅 win32）
- 大小写（`D:\\Repo\\Proj` vs `d:\\repo\\proj`，仅 win32，文件系统不敏感）

——会产生不同键，导致跨工作区分桶串味：隔壁工作区的“尚未设置”横幅出现在当前工作区，或反之消失。`platform.path.normalize` 本身不做大小写折叠、尾杠不稳定，且调用点分散在 15+ 处宿主命令，未形成单一真相。

历史缺陷证据：旧 `normCwd` 仅在 `wf.bind / wf.selection / wf.commentIssue` 三处收口，其余 12+ 读数通道（`wf.snapshot / wf.refresh / wf.status / wf.detect / wf.chain / wf.probe / wf.registry / wf.issueDetail / wf.issueComments / wf.handoff* / wf.claim / wf.issuePathPoll`）裸用原值；`repoKeys / repoRoots / cache / statusCache / workspaceStore` 等按 `cwd` 分桶的缓存亦裸用原值。

## 目标

- 单一规整键：同一语义目录无论以何种合法写法到达，规整后字节一致；
- 单一入口：所有需读工作区的宿主命令经同一助手取值，缓存键只允许使用规整键；
- 可验收：三种写法 -> 两次快照字符串逐字节相等，为结构承诺而非巧合。

## 非目标

- 改变用户可见行为（本块为纯加固，UI 不变）；
- 改变安装根或引入第二安装根（沿用 #276 单一用户级标准根裁决）；
- 对第三方工具技能目录提供识别支持。

## 决策

### D1 规整函数 `normalizeWorkspacePath(raw, platform)`

- 输入 trimmed，空串直返；
- 委托 `platform.path.normalize`（win32 用 `node:path.win32`，darwin/linux 用 `node:path.posix`，零自实现）；
- 根外去尾杠（`sep` 与异种 `sep` 均剥，根 `C:\\` / `/` / UNC `\\\\server\\share\\` 例外）；
- win32 小写折叠（`toLowerCase`），posix 保持大小写敏感；
- 同步纯函数，可单元直测。

### D2 统一入口 `toWorkspaceKey(raw)`（async，原子）

`原始描述进、规整键出`：

1. 空/空白 -> `DEFAULT_CWD`（进程 cwd）兜底；
2. 若 `platform.path.isAbsolute(raw)` -> 直规整返回；
3. 否则尝试 `ctx.get('fs').resolve(raw)`（DSH 感知 workspaces 根的相对名，如 `matt-demo-markdown`），得绝对目标则规整返回；
4. 否则尝试 `platform.path.join(await platform.getHome(), raw)`（裸名按 home 归一）；
5. 兜底按当前语义规整。

该函数是宿主内唯一合法的 `cwd` 取值点；所有 `harness.handle('wf.*')` 的 `args.cwd` 首行必为 `const cwd = await toWorkspaceKey((args && args.cwd) || DEFAULT_CWD)`，旧 `normCwd` 保留为 `toWorkspaceKey` 别名以兼容存量调用。

### D3 缓存键审计

- `repoKeys` / `repoRoots`：入口首行 `await toWorkspaceKey` 后再查表；
- `cache` / `statusCache`：存取均以规整 `cwd` 为键，命中比较 `=== `;
- `workspaceStore` / `registry byHandle`：`handle.cwd` 来自入口规整键，`handleKey` 不再裸用；
- `panelSyncEvaluate`：`cwdList[i]` 入口规整后再参与 `getRepoKey` 与 `panelSync` 分桶；
- `lastProbeAtByRepo / lastIssueIndexByRepo` 等派生键由 `repoKey` 间接规整。

### D4 回归门禁

- `tests/verify-workspace-key.js`：15+ 项审计（无裸用、入口存在、规整单测三写法、canonical 三写法、快照字符串相等、异工作区隔离）；
- `package.json:verify` 接入该门禁；
- 三端一致性：win32 侧大小写/斜杠/尾杠坍缩，posix 侧仅尾杠与 `./` 坍缩，大小写敏感保持。

## 后果

- **正**：同一仓库三种写法快照逐字节相等，跨工作区串味在结构上失去立足点；调用点收敛至一处，后续重构零遗漏；
- **正**：大小写折叠仅 win32 生效，不影响 posix 大小写敏感语义；根路径保留；
- **负**：宿主命令入口由同步取参变为 async 取参（需 `await`），调用方必须在 async  handler 中使用；
- **负**：裸名经 `home` 归一后路径变长，日志中可见完整 `/home/.../name` 而非裸名，需接受。

## 备选

- 备选 A：仅在 `getRepoKey` 内规整，不收口宿主命令 -> 仍有 12+ 裸用点，审计无法闭合，否决；
- 备选 B：同步 `normalize` 后大小写折叠推迟到比较时 -> 键仍分桶，缓存仍串味，否决；
- 备选 C：引入第三方规范化库（如 `normalize-path`）-> 引入第二真相、与 `platform.path` 语义分叉，否决。

## 验证

- `node tests/verify-workspace-key.js` 全部通过（22 项，含三写法字节相等）；
- `npm run verify` 全绿（含新增门禁）；
- `node scripts/build.mjs` 产物新鲜且 hash 校验通过。
