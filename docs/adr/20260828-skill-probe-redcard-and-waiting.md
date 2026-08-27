# ADR：红牌分拣与启动等待合同（#281 落纸，交付块①后半）

> 日期：2026-08-28 定版（承接 #276 规格与 #280 前半）
> 地位：承接 #276 图纸的“五条推论”中第三、五条，作为 #276 后续六个交付块中首块的后半落地约束；与 #276 冲突以本文件为准，未来改动以更新日期者为准（CONTEXT.md 同款两条规则）。
> 关联：#276（规格父票）· #281（落地）· #280（前置：唯一尺）· #279（统一路径入口）

---

## 1. 背景（第一性原理与证据链）

- **平行尺子已退，红牌仍哑**：#280 把判装退到一行注册表查询，`probeSkill` 不再触盘即绿。但“红”只有一种说法——用户无法区分“目录压根没有”与“有目录但名片不合格（SKILL.md 损坏/缺失/ frontmatter 错）”。活体证明 DSH 发现层对坏名片静默丢弃，插件若只看注册表，两种缺失在红牌上混同，用户只能反复重装碰运气。
- **B 语义放行的信息缺口**：注册表的 B 语义天然放行“标准根之外的有效同名副本”（六级来源中数字小者胜）。若只报“已安装”，用户不知道实际生效的副本藏在何处，日后想归位无从下手。
- **启动期的瞬时不可用被当永久坏**：宿主启动瞬间 `ctx.get('skills')` 可能尚未就绪（或抛错）。旧实现直接报红“未安装”，既不诚实（把瞬时当永久），也不给系统自愈机会（不听失效广播、不重试、无上限地转圈或吞错均不可接受）。

这三点不是文案润色，而是“转述与注释”姿态的剩余债：唯一尺解决“谁说了算”，本块解决“红怎么说、绿怎么注、等怎么等”。

---

## 2. 目标

为“红怎么说、绿怎么注、等怎么等”定**可被验收**的契约：

1. **看一眼文件只用于解释原因纪律**：辅助的磁盘轻探只在红牌上区分“缺失 vs 名片无效”，永不产生绿色；放行权仍唯一归注册表。
2. **异处副本的绿牌注释**：注册表命中且来源非标准根时，绿牌附一行实际来源路径（只读注释，不影响放行）。
3. **启动等待合同**：依赖不可用时显式 pending；订阅 DSH 核心的技能目录失效广播后有界推进重判；封顶后如实转为失败并附错误原文——绝不无限转圈，也绝不吞错误报。

---

## 3. 决策

### 3.1 看一眼文件只用于解释原因（One Glance for Reason Only）

- **时机**：仅当 `await ctx.get('skills').get(name)` 返回空（未命中）且服务本身可用时，才触发一次目标根轻探。
- **探什么**：以平台标准根为唯一靶点（`home/.agents/skills/<name>/SKILL.md`），现取现用的 `ctx.get('fs')` 读一次：
  - 目录/名片均不见 → 判“缺失”；
  - 见到目录/名片但 `SKILL.md` 缺失、不可读、或 frontmatter 中 `name:` 与期望不符 → 判“名片无效”。
- **纪律**：
  - 轻探结果只改红牌的 `detail` 文案（中/英双语：“未安装（缺失）/ Not installed (missing)” vs “名片无效 / Invalid skill card”），`level` 仍为 `bad`，`hint` 仍为 `prompt:installSkills`；
  - 轻探永不返回 `ok`，永不产生绿；绿的唯一来源仍是注册表的命中。
- **B 语义注释（绿牌来源行）**：
  - 命中时若 `skills.get` 返回的记录携带 `path/dir/location`，与标准根规整后比对；
  - 不一致即视为异处副本，绿牌 `detail` 追加一行来源（中文“（来源：xxx）”/英文“ (source: xxx)”），供归位时定位；
  - 命中但无路径字段，或路径与标准根一致，则绿牌保持纯“已安装”。

### 3.2 启动等待合同（Waiting Contract）

- **进入条件**：`ctx.get('skills')` 为 `undefined/null`，或 `skills.get(name)` 抛错。此时不报“未安装”，而是显式 `pending`：
  - `level: 'pending'`，`detail`: “等待技能服务就绪…（a/3）”，`hint`: `pending:skills-unavailable:a`，并记录 `error` 原文。
- **推进信号（首选广播，刷新兜底）**：
  - 启动时即尝试订阅核心的技能目录失效广播（探测期 `(skills.onDidInvalidate || skills.on('invalidate') || skills.subscribe)`，任一可用即订阅；无则退化为刷新兜底）；
  - 广播到达时清空该技能的重试计数并失效 `statusCache`，下一次 `wf.status`（显式刷新或下一次探针）立即重判；
  - 不依赖“安睡等待”推进，断言经由事件与显式 `wf.refresh / wf.status force` 驱动（吸收门闪复现脚本经验）。
- **有界与封顶**：
  - 每技能独立计数，`SKILL_PENDING_MAX = 3`；
  - 前 3 次探针均不可用 → 持续 `pending`；
  - 第 4 次仍不可用 → 转为 `bad`，`detail` 携带错误原文（“技能服务不可用：xxx”），`hint` 回到 `prompt:installSkills`，绝不无限转圈；
  - 命中或轻探解释成功时立即清零计数（不跨技能污染）。
- **套件聚合口径**：
  - 聚合检查（`Core skill suite`）若任一成员 `pending`，则聚合亦 `pending`（不计入 `ready/total` 的 pending 分母口径）；
  - 全部非 `pending` 时再按“缺失列表”判 `ok/bad`。

---

## 4. 非目标

- 对 `.claude/.minimax` 等非 DSH 目录的任何识别支持（已在 #280 退役，本块不回潮）；
- 依赖真实网络的端到端用例；
- 六步作业指导书与 10 技能名单的单一真源化（#282）；
- 统一路径入口之外的跨工作区串味（已在 #279 落地）。

---

## 5. 后果

- **正**：红牌从“哑红”变为“会说话的红”——用户一次即可知是该补目录还是该修名片；绿牌从“裸绿”变为“带出处注释的绿”——B 语义的可追溯性落地。
- **正**：启动瞬时的服务未就绪不再被误判为永久损坏；有界等待让面板在“诚实的等待态”与“诚实的失败态”之间收敛，无限转圈与吞错被结构性排除。
- **负**：轻探引入一次额外的 `fs` 读（仅红牌路径，且现取现用，不缓存）； pending 态在 UI 层需渲染等待样式（已按 #229 计数口径剔除出分母，不影响 ready/total）。
- **迁移**：旧的双源探测分支已在 #280 删除，本块不新增任何“文件存在即绿”的分支；`SKILL_PROBE_DIRS` 保持零出现。

---

## 6. 验证

- **源码门禁**：
  - `src/host/index.js` 中 `SKILL_PENDING_MAX`、`lightProbeReason`、`isSkillCardValid`、`ensureSkillsInvalidateSubscription` 均存在；`SKILL_PROBE_DIRS` 仍零出现；轻探路径仅涉及 `home/.agents/skills`。
  - `src/host/tracker/predicateRegistry.js` 中 SKILL_PROBE 原语仅探标准根（无 `.claude`）。
  - `src/host/tracker/statusDerive.js` 中 `setup-matt-pocock-skills` 拼写已纠正。
- **集成缝（构造临时家目录注入的宿主实例，真件同构）**：
  - 放入坏名片（SKILL.md 非法）→ 红·名片无效；移走目录 → 红·缺失；
  - 标准根外有效同名副本（`skills.get` 返回异处路径）→ 绿 + 来源路径提示行；
  - `skills` 服务不可用时前 3 次 `probeSkill` → `pending`，第 4 次 → `bad` 且携带错误原文；
  - 失效广播到达（触发 `skills.on('invalidate')` 或 `onDidInvalidate`）→ 计数清零，下一次 `probeSkill` 若服务已恢复则转绿（断言经由显式刷新与事件，不安睡）。
- **回归**：
  - `node tests/verify-skill-probe-redcard-and-waiting.js` 47 例全绿（分拣/异处/等待/封顶/广播；含 path-shaped 契约回归与广播断链回归——见下）
  - 对抗复核补强两点：① 轻探存在性探测严格区分 path-shaped（lstat/exists 吃裸路径）与 target-shaped（readText 吃 resolve 返回值），避免真机「目录在、SKILL.md 缺」误判为缺失；② 失效广播收口同时失效 workspaceStore 检测级联缓存，保证广播后**无需 force** 的下一轮 wf.status 即全量重判转绿（否则 detect 的 store 快照会冻住旧 skillProbes）；
  - `npm run verify` 全链仍绿；`npm run build` 产物字节一致。

---

## 7. 参考

- #276 规格六块中“①判装改为以 DSH 回答为准”后半与“③启动等待规则”
- #274 根因 6（名录拼写）与 #280 前置修复
- #279 ADR 第四条（统一路径入口）作为同期结构前提
- DSH 技能发现层六级来源与静默丢弃行为（Further Notes 实证）
