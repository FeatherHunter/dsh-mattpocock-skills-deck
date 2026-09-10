# ADR：票身份加 effort 维度，寻址范围放 RepositoryRef（2026-09-09 定版）

> 日期：2026-09-09 定版
> 地位：承接本地 Markdown 后端契约（`package/bundled-skills/setup-matt-pocock-skills/issue-tracker-local.md`）与 `docs/architecture/tracker-backend-normalized-model.md`；本决策修订该文件里「`Issue.key` 仓库内唯一、全局身份 = (RepositoryRef, key)」一句。
> 版本与效力：本文件落盘后，凡与本决策冲突的旧方案/契约/讨论，**以本文件（更新日期者）为准**；未来任何讨论若改动本决策，**以未来版本为准**（CONTEXT.md 同款两条规则）。

---

## 1. 背景（第一性原理）

本地 Markdown 后端的数据布局是「一个仓库多个 effort」：`.scratch/<effort>/map.md` + `.scratch/<effort>/issues/NN-<slug>.md`，而契约明确写着**每个 effort 的票各自从 01 编号**。也就是说「编号」在仓库里天然会重复，重复不是异常。

旧实现把这件事当成「一个仓库只有一张地图」：

- 每张地图都解析成 `key='00'`、每张子票都解析成 `parentKey='00'`（`src/host/tracker/backends/markdown/issues-read.js`）；
- 宿主按编号摊平给面板（`src/host/sessionSnapshot.js`），于是两个 effort 的地图编号都是 0、票编号都是 1；
- 面板按编号定位（`src/client/views/MapDetail.js`、`ListTabRow.js`、`src/client/kernel/store-prefs.js` 的导航栈），永远只命中第一个 effort；
- 后端按编号找文件是「按目录顺序取第一个命中」（`comments.js` / `issues-status.js` / `issues-patch.js`），于是**给第二个 effort 的票写评论会落到第一个 effort 的同号文件里**。

诊断复现与证据链见 `tests/verify-multi-effort.js` 的头部注释（该门禁把下面每条症状都变成可执行断言）；这不是显示瑕疵，是数据写错文件。

## 2. 决策

1. **`Issue.effortId` 是核心字段**（永远存在）：本地 Markdown = `.scratch/<effort>/` 的目录名；一个仓库只有一个隐含 effort 的后端（GitHub / GitLab）填 `''`（EMPTY，不是 MISSING）。理由：effort 是身份的一部分，不是「有没有这个能力」；设为 MISSING 会让两个后端走出不同身份分支，且每个调用点都要 `?? ''`。
2. **`RepositoryRef.effortId` 是可选寻址范围**：省略 = 该仓库全部 effort（列表用）；给出 = 只针对这一个 effort 读/写。放在 ref 而不是每个 op 的参数里，因为 `comment / reopen / update` 三个 op 没有 `opts` 形参，硬加参数会把 `OpContext` 挤位、破坏既有后端实现；放在 ref 上则**所有 op 签名零改动**。
3. **身份 = (RepositoryRef, effortId, key)**；`Issue.key` 只在**本 effort 内**唯一。父子关系与阻塞引用都只在同一 effort 内成立：子票 `parentKey='00'` 指本 effort 的地图；`blockedBy` 里的编号只在本票所属 effort 内解析。
4. **写路径安全规则**：没给 `effortId` 且同号票在多个 effort 里都存在时，**读**按目录顺序回落（保住聊天里的 `#01` 链接），**写**返回 `conflict` 诚实失败，绝不猜文件。
5. **身份算法只有一份**：`effortOf / idOfParts / idOf` 住在 `src/shared/tracker/constants.js`（shared 层唯一不引用同层文件的叶子；同层互引门禁禁止 shared 内部新增引用边），宿主与面板共用。**不新增 `Issue.id` 字段**——那会把 (effortId, key) 复制成第三份身份，违背「单 id」纪律。

## 3. 备选与取舍

| 备选 | 否决理由 |
| --- | --- |
| 给 `comment / reopen / update` 加 `opts` 形参 | 会移动 `OpContext` 位置，破坏 GitHub / GitLab 现有实现；三个 op 的签名已经定版 |
| 把 effort 编进 `key`（如 `alpha/01`） | 污染显示（`#${key}`）与文件名约定，`parseMd` 的 `NN-` 正则与各处 `padStart` 都要解串，每个读路径都得学一遍 |
| effort 进 `Selection`（一次只看一个 effort） | 用户要的是「看得清哪个 effort 的票」，不是「一次只能看一个」；且会让面板丢失跨 effort 总览 |
| 新增 `Issue.id` 字段物化身份 | 第三份身份，与「删 `key`+`number` 双 id」的定版纪律冲突 |

## 4. 后果与边界

- GitHub / GitLab 零影响：`effortId` 恒为 `''`，身份退化为 key，老快照与老缓存行为不变。
- 面板必须显示 effort 归属（同一屏里同号票要靠 effort 名区分）；面板按 `idOf` 做 React key / 查找 / 导航栈 / 差异索引。
  呈现方式经四版样张对照后定版：**每行 effort 徽标 + 顶部 effort 筛选**（可多选、可清空，KPI 跟随筛选）；
  「按 effort 分组折叠」「顶部 effort 切换器」两种备选未采纳。样张见 `docs/prototype/effort-display-variants.html`。
- 快照与依赖边缓存键、探针索引、详情缓存都要把 effort 计入，否则两个 effort 会互相顶掉（同一份实现见 `idOfParts`）。
- 跨 effort 的同号引用**不成立**：`Blocked by: #01` 只在同一 effort 内解析；要跨 effort 引用就得先有 effort 标识语法（本期不做，诚实留白）。
- 建票必须指定 effort（多 effort 仓库里不给就 `conflict`），编号在该 effort 内取 `max+1`。

## 6. 房间纪律适配（合入时补记）

GitHub 与 GitLab 的归一化各带一行 `effortId: ''`，合入时曾为遵守“一次会话只改一房”门禁而回退，但契约测试对真机输出断言核心字段恒存在（G4），回退会红契约，所以最终保留这一行。裁决是契约优先：三处缺省兜底（`effortOf`、契约夹具、读写回落）只保行为，字段本身仍由各后端亲手补齐。房间门禁在推主分支时按设计跳过（无对比基准），推送后即绿；推送前本地跑全量会在这一道预期变红，不代表回归。以后跨房契约字段先走多房例外说明，不要静默回退。

## 5. 验证

- `node tests/verify-multi-effort.js`（已进 `npm run verify` 链）：两个 effort 各自成组、按 (effort, 编号) 各自定位、写评论只改目标文件、无 effort 的写操作报 conflict、建票落在目标 effort 并按其取号、单 effort/扁平布局行为不变。
- `node tests/verify-tracker-contract.js`：`effortId` 核心字段断言。
- `node tests/verify-nav-stack.js`：导航栈坐标带 effort，同号不同 effort 是两条坐标。
