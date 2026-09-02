# dsh-mattpocock-skills-deck 变更历史

## 2026-09-02 · v1.7.12 发布：悬浮体系收口（44 处 title 迁移为 Tip500 薄预设 + 单例互斥 + 门禁成型）

- **薄预设与门禁定版（T1 #403）**：新增 `src/client/views/primitives/Tip.js` 与 `Tip500` 薄封装（`pending 500ms + 薄样式 padding 7px 12px`），并落地 `tests/verify-no-title.js` 轻量门禁（一源两物：注释/字符串去误报、// 截断修复、白名单 PREVIEW_VALUES 豁免）；该门禁与 `verify-t3-locale` 等并入 `npm run verify` 全绿（对应提交 a96ebef）。
- **壳层 24 处清零（T2 #404）**：`Dock / Overlay / StatusBar / SkillFloat` 等壳层 24 处 `title` 统一迁移为 `Tip500`，统一鼠标手柄与跟随气泡，构建与全量校验全绿（对应提交 2dd938f）。
- **内容区 27 处清零与 44 处一次性闭环（T3 #405 承接 #402 收尾）**：`ListTab 9 + MapDetail 9 + IssueDetail 7 + ChecksTab 2` 及关联 14 文件共 60 处变更，`MapDetail` 三元闭合与 `SettingsPage` 逗号修复，`Tip.js` 注释去误报，`verify-no-title 2/3/5` 三档门禁全绿，全局 `title` 残留 0，全量 44 处一次性清零（对应提交 77f7a36、18dd54e 漏迁补齐）。
- **交互加固与体验收口（T3 溢出与回补）**：`HoverTip` 按内容长度动态估宽防过度 flip 远左、外层行 `Tip` 在子按钮悬停时抑制消除双气泡（4824f39）、新会话与查看地图双气泡全局 `pending` 互斥（a2f4aaf）、行级动作 `mkRowAction` 统一 `Tip500` 消除原生提示（632794f）、`Tip` 样式透传与薄厚不冲突（886061f）、气泡文案避免复读可见文字并补充解释（1eff0f7）、A+B 格式去圆点（26b38e9），以及 `MapDetail` 漏迁与门禁误判的健壮性修复（18dd54e）。
- **原型与悬浮底座前置（G1/G2）**：悬浮底座与 `HoverTip` 基础、复用门禁、小三角翻转与独立验证（89f5623、55ab2bf、8b7a02c、96b83da），以及原型按钮体系（e02f84b、4f53f40、7e1d9ef、56e746d、fb7ea30、f5103d1）为本版悬浮收口的前置能力，已随版合入验证。
- **验证**：`node scripts/build.mjs` OK，双产物 `client.js / package/lib/client.js` 同源，`DSW_VERSION=v1.7.12`；`npm pack --dry-run` 64 文件清洁（`lib/shared/cordis.patch.yml` 白名单）；`npm run verify` 全绿（含 `verify-no-title`、`verify-hovertip`、`verify-t3-locale`、双产物一致性、平台契约等）；`npm run test:smoke` 5/5。
- **影响**：所有原生 `title` 提示已替换为跟随式 `Tip` 气泡，悬停 500ms 触发、单例互斥不重叠、长标题按 `maxWidth` 换行；窄屏与行内按钮不再双显；为后续配置面板等新视图提供统一悬浮契约。


## 2026-09-01 · v1.7.11 发布：技能随包可用（mattpocock/skills@v1.2.3 零代码 bundled）

- **随包兜底（#388/#389/#390 承接 #385/#386/#387 定版，R1 结论“首通道已绿”）**：插件内置 **mattpocock/skills v1.2.3** 的 25 个技能（engineering 18 + productivity 7，`package/bundled-skills/` 含 `LICENSE` 与 `VERSION=v1.2.3`），经 `ctx.skills.registerProvider` 以 `rank 600（bundled）` 兜底发现——用户在 `~/.agents/skills` 手装的 `rank 500` 优先覆盖；新增同步纪律 `node scripts/sync-matt-skills.mjs --pin v1.2.3 --verify`（纯手动，不挂 prepare）与双门禁 `verify-matt-skills-sync` / `verify-bundled-skills`（5 MB 硬卡）、`verify-bundled-discovery` / `verify-bundled-trio-matrix` 三态回归；`package/package.json:files` 增 `bundled-skills`，`npm pack --dry-run` 增量 ≤ 5 MB，`node scripts/build.mjs` 双产物同源。
- **三态回归（T3 此票）**：空 HOME（bundled 兜底绿）/ 有 HOME 有效（user 500 覆盖 600）/ 有无效名片（红牌分拣 + evidenceSummary）三种工作区在 `wf.detect / wf.chain` 的技能三检查（`skill:wayfinder / skill:setup-matt-pocock-skills / skill:ask-matt`）均已回归——新增 `tests/verify-bundled-trio-matrix.js`（33 项）固化“首通道已绿，无需在 `lightProbeReason` 回退分支补 bundled”的 R1 结论；真机矩阵截图与日志归档 `docs/reviews/390-bundled-trio-matrix.md`。
- **默认零污染**：默认不写 `~/.agents/skills`；“复制到 ~/.agents/skills”显式动作（`copyBundledToHome`）首版暂缓，需用户确认才写，留待后续评估（R1 已定版首版不做）。
- **文档与合规**：README `INSTALL` 章新增“技能随包可用”说明（兜底、覆盖、同步、零污染）；MIT 合规保留 `package/bundled-skills/LICENSE`。快照来源：`https://github.com/mattpocock/skills/tree/v1.2.3/skills`（2026-08-06 patch，仍 25 个，无新增 skill 名）。
- **验证**：`node scripts/build.mjs` OK，`npm run verify` 全绿（含新增 `verify-bundled-trio-matrix`），`verify-bundled-skills` 与 `verify-bundled-discovery` 同步绿，`dsh plugin remove` 后随包消失无残留。

## 2026-09-01 · v1.7.10 发布：新建会话 PTC 门禁与工作区回退及交接链路收口

- **单点工厂与复用闸门（#363 承接 #361/#362 的可判定门禁）**：新增 buildCreateOpts 与 createPTCSession 单点工厂，显式携带 agentPreset:'ptc' 并原子化挂载 pendingDraft 为唯一会话创建出口，防 default 漂移；新增 isReusableBlank/getRowPreset/isHealthyPreset 两级同形复用闸门，空会话永不复用且字面 code 判不健康，被拒必走新建分支仅隔离不清理；改造 openTextInNewSession 的 reuseSid 两级判定与创建分支，经工厂保证显式 ptc 与首条同次原子化，满足 #362 三判据 P+A，新增门禁 tests/verify-newsession-preset-guard.js（68 项，双源一致）并并入 npm run verify（对应提交 9d90ce4）。
- **工作区回退与首条保真及 alpha 兼容（#364）**：工作区回退矩阵显式化——ensureWorkspaceId 优先复用已登记工作区，未命中则按需创建并兼容多形态快照，创建失败或无效回落 null 使上层走 {cwd,ptc} 而非阻断；针对 alpha 入参更名，path 抛 bad-request 时自动重试 {cwd}；buildCreateOpts 两分支互斥必带 ptc，createPTCSession 对 workspaceId / agentPreset 更名做兼容回退，保证首条不丢；复用与创建分支均以 sid 锚定，空 cwd 时直接回退注入当前会话，新增门禁 tests/verify-newsession-workspace-fallback.js（84 项，双源一致）并并入 npm run verify，构建双源同步，verify 全绿（对应提交 c8e0a8c）。
- **交接链路统一经单点工厂（#364 续 · handoff 收口）**：doHandoffOpen 的 finish 改走统一单点工厂 openTextInNewSession（带 handoff 标题）原子化注入首条并保留剪贴板复制；兜底分支经 sessions.create 显式 ptc + 工作区，修复原 ws.startSession 未显式 ptc/工作区且 pendingDraftTargetSid=null 导致的幽灵复活与抢消费；同步更新 tests/verify-handoff-split.js 门禁，校验 openTextInNewSession 调用与不再裸调 ws.startSession（对应本次未提交改动，随版合入）。
- **文档同步**：README 安装指引中锁定版本全量由 1.7.9 同步为 1.7.10，对齐已合入的新建会话门禁与工作区回退；英文文档与包内说明同步更新。
- **验证**：node scripts/build.mjs OK，双产物 client.js / package/lib/client.js 同源，DSW_VERSION=v1.7.10；npm pack --dry-run 67 文件清洁（lib/shared/cordis.patch.yml 白名单）；npm run verify 全绿（含双产物一致性、平台契约、新会话预设门禁、工作区回退门禁、交接分割门禁、发布契约）。

## 2026-08-31 · v1.7.9 发布：状态栏胶囊在新版对话框中变窄问题的收口

- **状态栏胶囊修复**：从第一性原理改用同源 CSS 变量驱动——外框改为 width:100% + max-width:var(--dsh-composer-card-max-width)，外层 wrapper 改用 var(--dsh-composer-side-clearance) 回退 8px，与宿主输入卡同源；移除 iw/inputRef 状态与 textarea.uV2eYG_input 硬编码查询，折叠仅观察胶囊及其父容器尺寸变化触发 applyFold，确保在 DSH Alpha 新版 Lexical 输入区（[data-composer-card]/.krUYjW_card）中胶囊外框随对话框同源伸缩且不再卡死 780（对应提交 ac94af5）。
- **空地图检查**：新增 map 空态 0/0 诊断与一键修复入口——当 map 统计为 0/0 时编号徽章与动作按钮切琥珀色检查态，注入空地图修复提示词，复用 wayfinder 技能完成子议题关联修复（对应 prompts 新增 mapInspect、router 空态分支、ListTab/MapDetail 联动、locale 双语）。
- **文档同步**：README 安装指引中锁定版本全量由 1.7.8 同步为 1.7.9，对齐已合入的状态栏修复与空地图检查；英文文档与包内说明同步更新。
- **验证**：node scripts/build.mjs OK，双产物 client.js / package/lib/client.js 同源，DSW_VERSION=v1.7.9；npm pack --dry-run 67 文件清洁（lib/shared/cordis.patch.yml 白名单）；npm run verify 全绿（含双产物一致性、平台契约、胶囊窄态、发布契约）。

## 2026-08-31 · v1.7.8 发布：状态栏胶囊修复与文档收尾

- **状态栏胶囊修复**：纠正 f09ce91 合入时 psule 拼写错误导致的 skills 横幅抛错，并修复输入框宽度探测在工作区切换后因旧节点宽度为 0 而将胶囊压扁的问题，确保在 matt-demo-github 与多工作区切换后胶囊保持可见且宽度非 0（对应提交 7e217b0、13a4606）。
- **文档收尾**：README 安装指引中锁定版本全量由 1.7.7 同步为 1.7.8，对齐已合入的状态栏修复；Star History 每日更新追加。
- **验证**：`node scripts/build.mjs` OK，双产物 `client.js` / `package/lib/client.js` 同源，`DSW_VERSION=v1.7.8`；`npm pack --dry-run` 69 文件清洁（lib/shared/cordis.patch.yml 白名单）；`npm run verify` 全绿（含双产物一致性与平台契约）。

## 2026-08-30 · v1.7.7 发布：Star History 视口与内嵌加固、技能名片 BOM 兼容

- **Star History 视口加固**：多轮扩大卡片与图表四周留白（64px→80px）、卡片与图表容器解耦（图表独占固定高度、统计区网格独立）、手绘风格与数据分离，动态 xTickCount 与 SVG 响应式自适应，确保 README 与独立页在窄/宽视口下均无裁切，标签与曲线完整可见（对应提交 5d36c0e、b4e3f2b、2fe18d2、c46764b、0908fe5）。
- **Star History 内嵌与缓存修复**：README 内嵌由 Pages 代理切换为 `raw.githubusercontent.com` 直链、改用 PNG 直链并追加 `v=2` 缓存刷新参数、移除图表冗余标题使页面仅保留单一 Star History、修正 fetch 为基于 location 的绝对路径以兼容 Pages 与 GitHub 预览，实现聚合纯函数与增量更新脚本及每日自动更新 Action，生成的手绘 PNG 确保 GitHub camo 稳定渲染（对应提交 d3244c4、b7989ad、79a15c1、113304b、9df8c69、a149ba5、ea285e1、e2ba839 等）。
- **Star History 自建链路补全**：新增 `docs/star-history.*` 纯函数聚合、`scripts/star-history.mjs` 与 `update-star-history.mjs` 增量更新、`.github/workflows/star-history.yml` 每日自动更新，手绘图表与静态预览增加每日新增曲线与图例，系统性解决破图与 Failed to fetch（对应提交 8ad4a56、5e5f2a7）。
- **技能名片 BOM 兼容**：SKILL.md 带 UTF-8 BOM 时不再误报`名片无效`，环境检查红牌准确性提升（对应提交 b459deb）。
- **验证**：`node scripts/build.mjs` OK，双产物 `client.js` / `package/lib/client.js` 同源，`DSW_VERSION=v1.7.7`；`npm pack --dry-run` 67 文件清洁；`npm run verify` 全绿。

## 2026-08-30 · v1.7.6 发布：GitHub 地图与 Markdown 跳转加固、状态栏与多级缓存增强

- **GitHub 地图详情修复**：补齐 map 正文五区块解析（`parseMapBody` 统一落盘）与详情页空值兜底，`cacheFormat` 2→3 强制旧缓存重建；修复 `#00` 点击与 `setActiveMap` 判空、GitHub 快照 GraphQL 字段（`Actor.name` / `IssueComment.editedAt`）失配、composer 小写 state 误判等，导致详情页 `Cannot read properties of undefined` 的系列回归（对应提交 9b8d989、4a9c6be、b6d796e、b0a9857、604d9ca）。
- **Markdown 跳转解耦**：`issueUrl` 改算本地绝对路径（盘符路径）、`links` 仅保留提及正则，宿主 `wf.openPath` 按 OS 打开，UI 按 `url` 前缀分流 `https`/`file`；兼容单数 `Label:`、阻塞链标题回填与全量标签常驻（`blockedBy` 标题、graph 依赖标题、调色盘 11 色融合）；修复 `exists` 按 DSH fs 形状误用导致枚举为零（对应提交 5d684a9、b72a96d、0870ec2）。
- **多级缓存与状态栏**：状态栏时间改为上次探测时间（数据不变也走针）与快照多级缓存（内存→磁盘→网络，重启秒显）；多级缓存门禁与标签取色聚合、空指针保护、按后端隔离等完善（对应提交 84c6594、c893f6c、0452afa、092d7c6）。
- **会话与命名**：空白新会话壳复用导致自动改名修复（创建即注入首条消息、收紧编号归属）；非 Git 工作区声明为 GitHub 时避免伪造 `cwd` 为 `refId` 致快照超时（对应提交 121626f、311f5c6）。
- **地图类型与编号**：GitHub 地图票号与 `wayfinder` 类型按 `labels` 派生、编号用 `key` 兜底，修复列表行点击详情异常（对应提交 205c547）。
- **验证**：`verify-tracker-contract` 384 项、`verify-mapdetail-fields`、`verify-multilevel-cache`、`verify-no-cross-import` 等全量回归；`npm run test:smoke` 5/5；`DSW_VERSION=v1.7.6`，双产物同源。


## 2026-08-29 · v1.7.5 发布：修复 GitHub 后端点击 Map 行进详情页报 Cannot read properties of undefined (reading 'length')

- **根因**：wf.snapshot 对 GitHub 后端改为统一走编排器（composeSnapshot，[#309](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/309) 双后端解耦）后，map 正文五区块（Destination / Notes / Decisions so far / Not yet specified / Out of scope）不再解析——旧 gh 直连路径（buildSnapshot）的 parseMapBody 成了死代码，快照里的 map 缺 decisions/fog/outOfScope 字段；列表页 Map 行仍可点击，详情页 MapDetail 直接读 m.decisions.length 等，即抛 Cannot read properties of undefined (reading 'length')。
- **修复**：①组装层 src/host/tracker/snapshot.js 在 assembleSnapshot 统一用 shared/parser.js::parseMapBody 解析 map 正文并恒填五区块（EMPTY 数组/字符串，不 MISSING），所有后端（GitHub/Markdown/GitLab）行为一致；②客户端 src/client/views/MapDetail.js 对三个区块做 Array.isArray 兜底，旧磁盘缓存/异常数据也不会崩。
- **验证**：verify-tracker-contract 新增 map 区块解析 + EMPTY 兜底两类断言（384 通过）；新增 verify-mapdetail-fields（src 与双产物文本门禁，已挂入 npm run verify 链）；npm run test:smoke 通过；版本 1.7.4 → 1.7.5。
- **缓存**：磁盘快照 cacheFormat 2→3，旧格式一律视为陈旧强制重建（防详情页从旧缓存读到空区块）。
- **影响**：GitHub 后端点击 map 行正常进入漏斗详情页，Destination/Notes/Decisions/迷雾/Out of scope 恢复展示。

## 2026-08-27 · v1.7.3 发布：修复“装了却提示未检测到核心技能套件”六步全链收口（规格 #276 · 地图 #278）

- **交付链**：六个独立验收块随块落纸 ADR，1 票 1 会话推进——“一处真相、零误报”。
- **第一步 · 统一路径入口（#279）**：原始描述进、规整键出；全部读数命令与分桶缓存经 `toWorkspaceKey`，同目录三种合法写法快照逐字节一致；ADR 第四条（路径入口统一）落纸。
- **第二步 · 判装只问 DSH（#280）**：判装退到一行注册表查询（B 语义：目录里有名字即绿，含异处副本绿+来源路径提示），`SKILL_PROBE_DIRS` 及 `.claude/.minimax` 分支退役；`fs` 全量现取现用（含并发不同门面），平台层动态 getter；名录拼写 `setup-matt-pocock-skills` 纠正；ADR 1·2（唯一尺、现取现用）落纸。
- **第三步 · 红牌会说话 + 启动等待规则（#281）**：红牌分拣「缺失」/「名片无效」（轻探仅标准根、永不产生绿），异处副本绿牌附来源路径；等待态 `pending` 有界 3 次后附原文转失败；失效广播事件驱动推进（不安睡、不转圈、不吞错）；ADR 3·5（看一眼文件只用于解释原因、等待规则）落纸；门禁 47/47。
- **引导词 v3（#282）**：六步作业指导书（找准目标目录·平台中立零盘符零波浪线→按名单逐个按三条标准核对→只装缺失项→覆盖半坏项→复检闭环至全绿→一行清单回报）；十技能名单改为构建期从契约层目录单一真源生成；检查项短文案键名化与双语补齐；硬编码门禁扩展“提示词禁盘符、禁波浪线”；25 项（engineering 18 + productivity 7）来源 https://github.com/mattpocock/skills/tree/main/skills/engineering 与 https://github.com/mattpocock/skills/tree/main/skills/productivity。
- **三平台自动测试（#283）**：仓库新增三矩阵流水线（每日 02:00 UTC，ubuntu/windows/macos），锁精确组件版本 0.3.1 单一真源，真件组装+临时家目录隔离+离线桩；216/216 与 552/552 与 47/47 三结论自证（放入必绿、移走必缺、坏名片报无效），公开仓免费。
- **第五步 · 旧轨退役（#284）**：旧九格目录视图（`wf.status/statusDerive`）整体退役，`wf.chain` 升级为通用+后端链全链快照（谓词注入判装原语），七处客户端读点迁移、渲染适配层瘦身、两只旧视图验证脚本移除；链上检查项改逐项独立求值消除阻塞吞判定与假依赖 + 30s 缓存与并发门。
- **发版收尾（#286）**：产物预检通过（`package/lib` 与 `src/host` 双向差集 0 + sha256 一致、`package/shared` 双向差集 0、import 卫生、入口冒烟）、三 OS 矩阵与 smoke 全绿；版本号 1.7.2 → 1.7.3，`DSW_VERSION=v1.7.3`，`npm pack --dry-run` 63 文件与历史互证；Git tag v1.7.3 与 GitHub Release 公开发布，回链 #276 与 #278；四案票致谢材料就绪移交 #285 执行关闭。
- **影响**：多工作区串味、红牌不解释原因、等待无限转圈、提示词含盘符/波浪线、旧视图死代码等结构性缺陷一次性收口；Windows/macOS/Linux 三端一致。



## 2026-08-21 · 状态栏 issuePath 胶囊右移至环境按钮左侧（map #101 · v1.7.0）

- **位置**：`src/client/statusbar/StatusBar.js` `issuePathAnchorRef` 段（`pin SVG + #N/--`）从 `word → issuePath → 可接` 右移至 `split(交接) → issuePath → env(dot)` 左侧（`timebtn` 前），保持 `data-fold-priority:10` 最末收，hover 弹层、点击路由、会话持久化、空态 `--`、pin 图标零变化。
- **定版（G1）**：`grilling` 三问拍板 — 保持 10 最末收（最保留）/ 不加竖线靠 `gap 2px 6px` + `border` / 保持 `left` 加右溢 clamp（`Math.max(8, innerWidth-320)`），R1 布局探查已验证 `applyFold` 对 10 正常、`verify` 位置不敏感。
- **实现（T1）**：`placeIssuePathPop` 加 clamp（`StatusBar.js:118-121`，`client.js:2869-2872`），`capsule` 顺序 `word1 → 可接5 → BUG6 → 诊断7 → 沉淀2/交接3 → issuePath10 → env8 → time4/9 → skills`，`node scripts/build.mjs` 一源两物，profile 同步 hash 校验通过。
- **验证（T2）**：`verify-capsule-narrow.js` 双源全绿（48+48 + Part C/D）/ `verify-status.js 23/23` / `verify-build-artifacts` / `verify-t3-locale` / `npm run test:smoke 4/4`（render 含 dsws-capsule）全绿；真机 Chrome（1707px）capsule 顺序 `word → 可接 → BUG → 诊断 → 沉淀 → 交接 → #59 → 环境6/9 → 更新` 且 `#59` 紧邻环境左侧（`issue=6 env=7`），hover 弹层 `389×85` 于 `left 1040` 无右溢，800px 窄屏 `fold=3`（`1,2,3` 已收，`10` 仍保留）。
- **版本**：`1.6.19 → 1.7.0`（`package.json` / `package/package.json` / `client.js DSW_VERSION` / `package/lib/client.js`）。

## 2026-08-21 · 阶段 3 收尾（#98 T5）：运行时冒烟 + 删镜像断言 + 构建流（v1.6.19）

- **运行时冒烟上线（R3 第二步）**：新增 `tests/smoke-render.test.js`（jsdom + React 19 + DswsCtx），覆盖面板（DetailsDock 含 dsws-tabs/dsws-body）、状态栏（dsws-capsule）、悬浮层 6 插槽注册 + slotted 组件挂载；`npm run test:smoke` 现 4 项（client/host/dispatch/render）<2s 可进 CI，取代「文本含 .dsws-panel ≠ 能挂载」的自欺式断言。
- **删除双源文本镜像断言（对抗审查 BUG 4 修复落地）**：`verify-bug-entry P2`、`verify-b5-quota 双源段`、`verify-b3-done-color`、`verify-t14`、`verify-probe-since`、`verify-prompts P2`、`verify-skill-tooltip P2`、`verify-capsule-narrow Part B`、`verify-tabs-narrow Part C`、`verify-parse-leaf Part D`、`verify-tabsfold-leaf` 等 11 处双源逐字/指纹一致性已删除；保留单产物行为特征校验（src↔产物逐字由 T1 已落地，build.mjs 文本组合保证双产物同构）。
- **DEV-WORKFLOW 重写（G1 三段式）**：`DEV-WORKFLOW.md` 从「双源镜像同步」重写为 `src/ 唯一真源 → 构建（一源两物）→ 冒烟/契约 → 同步 profile`，含新鲜度门禁、产物 gitignore、发布前 `prepare` 自动构建进 tgz；旧 §4 双源 grep 检查已废弃。
- **产物策略落地（G1 决策 A）**：`.gitignore` 已含 `/client.js` `/host.js` `/package/lib/`（T0 落地），`package.json` `prepare: node scripts/build.mjs`（安装时兜底），`scripts/build.sh` 三段式（构建→门禁→同步），根产物头部追加 `AUTO-GENERATED` 声明；`README` 新增「开发（贡献者）」一节指向 `DEV-WORKFLOW.md`。
- **验证**：`npm run test:smoke` 4/4（client/host/dispatch/render 含面板/状态栏/tab）+ `npm run verify` 9/9（t3-locale/skill-tooltip/bug-entry/no-repo-redcard/kernel/leaves/ctx/parse-leaf/tabsfold-leaf）全绿；`src/` 为唯一真源，产物全由构建生成。

## 2026-08-20 · 双源漏同步回归修复 — Fork 归属发版包未带 --repo（#37 回归 #78 · v1.6.16）

- **回归**：fork 工作区（`D:\dsh-plugin\dsh-im` `origin=FeatherHunter/dsh-im + upstream=xmanrui/dsh-im`）右侧面板仍显上游 `xmanrui/dsh-im` Issue（17/16/15）而非 Fork 自身（11/10/9），用户报“老 BUG 又复现”。根因非后续改回，是 **双源手写镜像漏同步**：`host.js` 已在 `b0e8368`（`getRepoKey` 三级降级）+ `a1341ab`（`fetchMaps/fetchIssues` 显式 `--repo` #44）完整修复，`package/lib/index.js` 发版包仅同步了 `getRepoKey`，`fetchMaps/fetchIssues` 仍为无参旧版，导致 DSH 实际加载的 `profile/lib/index.js` 仍走 `gh` 的 `upstream` 优先。
- **修复**：`package/lib/index.js` 补齐 `fetchMaps`/`fetchIssues` 的 `#44 T2-fix`（`await getRepoKey(cwd)` + `args.push('--repo', repo.owner+'/'+repo.name)`），与 `host.js` 完全对齐；`DSW_VERSION v1.6.15 → v1.6.16`、`package.json 1.6.15 → 1.6.16` 双源同步；`profiles/web` 已本地覆盖。
- **验证**：`verify-t1-getrepokey 11/11` + `verify-status 23/23` + `verify-b5-quota 54/54` + `verify-probe-since 34/34` 全绿；`git diff host ↔ package` 对 `getRepoKey`/`fetchMaps`/`fetchIssues` 已一致；`profile/lib/index.js` 复核 `#44` 两处命中。

## 2026-08-20 · 工作区隔离与首屏体验加固（#45/#58/#43/#41/#35/#34 · v1.6.15）

- **工作区隔离（#45）**：面板 probe 快照按 cwd 隔离，防止跨工作区污染；DetailsDock 切换绘画等工作区时跟随当前会话 cwd，并自愈残留污染（`repro-detailsdock-painting-switch.js`/`verify-panel-workspace-isolation.js`）。
- **首屏无闪烁（#58）**：cache-first 面板（per-cwd 内存表 + empty cwd 同步），消除 loading 闪烁；ChecksTab banner 计数改用 displayBad。
- **数据链路修复（#43）**：`fetchMapsDetail` GraphQL 透传 cwd（host.js:502）。
- **仓库身份（#41）**：`getRepoKey` 显式解析 origin，多远程下命中 Fork 自身，避免误判。
- **发布链路（T1 #34）**：Host 新增 `wf.initPublish`（`git init + gh repo create --push`），配套 18/18 全分支 mock 验证（`verify-t1-initpublish.js`）与 `verify-t1-getrepokey.js` 216 行。
- **首屏红卡（T2 #35）**：Client 首屏错误分级与重试 + 双源镜像对齐，新增 `verify-no-repo-redcard.js` 真机验证；DSH GUI 真机验证脚本（workspace 切换 + capsule 点击 + DOM 断言，`verify-t2-repokey-ui.js` 268 行）。
- **文档**：补 `minimumReleaseAge` 与完全重启 DSH 说明（中英同步）。
- **验证**：新增 6 个验证脚本 + 双源镜像一致性，75+ 断言全绿。

## 2026-08-19 · 状态栏 BUG / 技能浮层脱离裁剪（#22 · v1.6.14）

- **根因**：状态栏正常分支的 layout wrapper 需要 `overflow:hidden` 保护窄态胶囊横向溢出；BUG「新增」菜单与技能列表却仍是该 wrapper 的 `position:absolute; bottom:100%` 后代，因此同时被裁掉绘制和鼠标命中。
- **修复**：两个交互浮层统一通过 `portalTop → document.body` 渲染，使用锚点 `getBoundingClientRect()` 的 viewport 坐标和全局 z-index；监听 capture scroll、resize 与锚点 ResizeObserver 重定位，保留 160ms 悬停桥接。
- **交互加固**：BUG 菜单与技能列表互斥打开；点击技能注入命令后关闭列表；没有 `ReactDOM` 时 wrapper 改为 `overflow:visible` 的可用降级。
- **验证**：新增 `verify-issue22-popovers.js` 静态双源契约与 `verify-issue22-ui.js` 真实 Chrome 回归，验证菜单文案、body-level 渲染、可点击命中、桥接、技能注入和互斥关闭。

## 2026-08-18 · 状态栏胶囊 V2：内容自适应渐进收缩（#16 重设计 · v1.6.13）

- **复现结论**（真机 1280→400 逐档）：R1-R13 的 `data-narrow` 阈值体系有**结构性 bug**——
  dn 信号源 R5 起改为输入区（wrapper）宽，默认 1280 视口下输入区仅 812px，
  **dn=0 永不出现** → 宽屏默认就缺品牌字（实测 1280/1100/950/880 全 dn=2）；
  且 `.dsws-seg.note` 选择器引用了不存在的 class（seg() 首参是图标名不是 class），
  「无数字段」级从未生效（沉淀字实际落到 dn=3 才收）。
- **重设计（V2）**：废弃 dn/dw/`data-narrow-N` 阈值体系，改为**内容自适应渐进收缩**（仿 #15 tabs）：
  - 每个可收缩文字 span 打 `data-fold-priority`（1=最先收…9=最后收），信息价值排序：
    品牌(1) → 沉淀(2)/交接(3)/刷新字(4) → 可接(5)/BUG(6)/诊断(7)/环境(8) → 时间(9)；
    **图标+数字永不收缩**，最窄态 = 图标+数字紧凑条。
  - `applyFold()`：全展开→reflow→按 priority 升序逐个加 `.dsws-folded`（`display:none`），
    直到 `scrollWidth ≤ clientWidth+1`；挂 ResizeObserver（监听 capsule=iw 宽）+
    window resize + `fonts.ready` 重测；`dsws-no-anim` 禁动画测量，无闪烁无死锁。
  - 保留 R1-R13 已验证成果：`flex-wrap:nowrap` 单行、`width=iw px` 对齐输入框、
    wrapper `overflow:hidden` 截右缘、点击契约全保留。
- **真机验证**（真实 Chrome，1280→400 逐档）：1280-880 **fold=0 全文字**（修复原 bug）；
  800→fold=1（品牌字收）；720→3（+沉淀/交接）；600→8（只剩时间字，数字全在）；
  500/400→9（仅图标+数字）；**全部单行 capH=29，胶囊宽始终 = 输入框宽**。
- **测试**：`tests/verify-capsule-narrow.js` 重写为 V2 契约（单行/对齐/priority 语义表 1-9
  唯一且绑定正确/applyFold 模式/旧体系清除/点击契约/i18n/双源镜像）全绿；
  `verify-tabs-narrow.js` applyFold 计数断言放宽为 ≥2（胶囊新增第 3 个合法定义）。
- **双源**：client.js ↔ package/lib/client.js CSS 块 + capsule JSX 块 byte-for-byte 一致。
- 已知：verify-b5-quota 6 项漂移失败为既有（probe 同步已重构为 diff 同步，测试未更新，另案处理）。

## 2026-08-18 · 阶段 1：源码拆分——纯函数叶子落 src/（架构拆分路线首步）

- **背景**：为多 session 并发开发趋零冲突，落地 `ARCHITECTURE-SPLIT.md` 拆分路线阶段 1（先抽零依赖纯函数叶子，不引入构建、不搬逻辑）。
- **新增**：
  - `src/shared/parser.js` —— host 纯函数叶子（`normalizeBody/parseMapBody/parseProgress/computeLevels/groupTickets`，ESM 命名导出），自 host.js 内联定义原样抽取；
  - `src/client/kernel/tabsfold.js` —— #15 折叠机器纯函数（`tabsLevelDecide + TABS_FOLD_HYST + TABS_LEVELS`）；
  - `tests/verify-parse-leaf.js` + `tests/verify-tabsfold-leaf.js` —— **差分测试**（叶子 === host.js/package/lib 内联版，同输入逐字节一致）+ 真值表 + 双源镜像断言。
- **状态**：生产文件（host.js/client.js/package/*）**未**改为 import 叶子（保持内联，行为零变化）；叶子暂为「真源+测试基准」，阶段 2 引入构建 + Ctx 注入时接管。
- **验证**：两个新测试全 PASS；既有回归 verify-progress / verify-tabs-narrow / verify-status(23/23) / verify-panel(14/14) / verify-t3-locale 全绿。

## 2026-08-18 · 状态栏胶囊 wrapper flex:none 防压缩（#16 R12 · v1.6.12）

- **用户验收反馈**：v1.6.11 实测 DSH 功能仍坏——胶囊被压扁成 ~16px 高、文字顶部笔画被 `overflow:hidden` 切掉（「字被切一半/贴底」）
- **根因**（CDP 实测 live DSH，非 headless 环境产物）：
  - 宿主 `conversation.input.dock` 插槽 = `composerStack`（`display:flex; flex-direction:column`），wrapper（胶囊容器）是它的 flex item
  - wrapper 没设 `flex:none`，默认 `flex-shrink:1` → 输入区高度被压缩时（hero 元素/输入框占位）flex-shrink 把 wrapper 压扁（wrapper 19px → capsule 16px）
  - capsule `overflow:hidden` 截掉上下越界文字 → 视觉「胶囊扁、文字被切」
  - **R6 教训**：R6b 只删了 `alignItems:'stretch'`（防「被父级拉高」），没防「被压矮」——flex 压缩的另一半
- **修复**（两个 wrapper 分支都加 `flex:'none'` = `flex:0 0 auto`）：
  - `!firstBlock` 单胶囊行分支 + `firstBlock` 横幅列分支
  - composerStack 再也无法 flex-shrink 压扁 wrapper
- **CDP 验证**：
  - capH：16px → **29px**；wrapH 19→32px；flex 由 `0 1 auto` → `0 0 auto`
  - 文字完整（top 411→427 未裁），zoom 1.0 / 1.25 / 1.5 均正常
- **测试**：`verify-capsule-narrow` 新增 2 项 R12 断言（两分支 flex:'none'）+ 兼容 R12 的 wrapper 断言，全部通过；既有回归全 PASS

## 2026-08-18 · 面板 tabs 行窄屏单行 + 内容自适应折叠为纯图标（#15 · v1.7.0）

- **BUG**（reporter）：面板 tabs 行 6 按钮（列表 / 技能 / 环境检查 / + 新建需求 / + 新增BUG单 / 刷新）面板变窄时文字换行（CJK 任意断行），行高跳变，`flex:none` 动作按钮溢出右缘
- **根因**：
  - 标签按钮无 `white-space:nowrap` + `flex-shrink` 默认 1 → 被压缩时文字折行（实测 dock tabs 行 82px 高、按钮 42-74px 高；全文字自然宽 ≈ 470px）
  - `+ 新建需求 / + 新增BUG单 / 刷新` 三按钮 `flex:none` 拒绝收缩 → spacer 归零后溢出右缘
  - 既有 `narrow`（<380px）只作用到列表行内动作，从未作用到 tabs 行（#16 CHANGELOG 明示为「另一种 narrow 形态」的遗留）
- **修复**（内容自适应 + 滞回防抖，不用固定像素阈值）：
  - CSS：`.dsws-tabs` 加 `flex-wrap:nowrap + overflow:hidden + white-space:nowrap`；`.dsws-tab` 加 `white-space:nowrap + flex:none + line-height:1.5`
  - 折叠：`.dsws-tabs-fold` 隐藏 tab/按钮/版本号 的文字 span（图标 + title 保留）
  - 判定：`tabsFoldDecide(fold, avail, natural)` —— 未折叠以 `scrollWidth > clientWidth+1` 判「放不下」→ 折叠；折叠态需 `avail ≥ natural+4`（滞回）才展开，防临界抖动；两处渲染（dock + 漂浮面板）各挂 `tabsRef` + ResizeObserver + window.resize + fonts.ready 重算
  - OverlayPanel 的 tabsRef/effect 移到 `if (!s.open) return null` 之前（hooks 顺序合法化），effect 依赖 `[s.open]` 打开时重算
  - **阈值选型**：中文全文字自然宽 470px、英文更宽 → 固定 <380px 会在 380-470 间留「文字放不下」带；grilling 改拍板为**内容自适应折叠**
- **测试**：新增 `tests/verify-tabs-narrow.js`（CSS 契约 / 装配 + hook 合法性 / tabsFoldDecide 真值表 11 项 / 双源 CSS + tabs JSX 镜像）—— 双源全绿
- **实测（live GUI CDP）**：宽 620/520 → 文本单行显示；460/400/340/300 → 折叠为纯图标；任何宽度行高恒 ≤36px 不再换行
- **附带发现**：`tests/verify-b5-quota.js` 2 项断言（`sr === rep` / `loadSnapshot(st2, false, true)`）在 HEAD 即已漂移失败（probe 同步已重构为 diff 同步，测试未更新）—— 与本次改动无关，另案处理

## 2026-08-18 · 状态栏胶囊 R11 padding 恒定（#16 R11 · v1.6.11）

- **用户验收反馈**：R10 后 capsule 固定宽 = iw 时 children 缩小后左右空白反而变大（不是等比例往中间靠）
- **根因**：capsule width = iw（固定 = 输入框宽），children fit-content 居中后左右空白 = (iw - children宽) / 2，children 越小空白越多
  - CDP 实测：viewport=800 时左右空白=51px（偏大），viewport=600 时左右空白=125px（很大）
- **修复**（commit `b540a73`）：
  - CSS `.dsws-capsule { width:fit-content }`（默认跟随 children 自然宽）
  - inline `maxWidth: iw + 'px'`（防止 capsule 比输入框宽）
  - children 比 iw 宽：capsule = children
  - children 比 iw 窄：capsule = iw（pixel 对齐保留）
- **CDP 实测 R11**：所有 viewport 下 leftEmpty = rightEmpty = **6px（padding）恒定** ✓
- **权衡**：解决了 padding 变大；代价是 children 比输入框窄时 capsule 居中显示（左右各有一段空白，距输入框左右边不像素级对齐——R10 部分失效）
- **测试**：移除 R7/R9/R10 旧 width:100% + width:iw px 断言；加 3 项 R11 断言
- **75+ 项断言全绿**；既有回归全 PASS

## 2026-08-18 · 状态栏胶囊 R10 box-sizing 像素级对齐（#16 R10 · v1.6.10）

- **用户验收反馈**：R9 后 capsule 左右边距输入框左右边「多一点距离」，用户怀疑是 padding
- **根因**（CDP 实测）：
  - R9：capsule 外框 791.99px vs textarea 外框 778.75px（差 13.24px，左右各 6.62px）
  - capsule CSS 默认 box-sizing:content-box，iw=778.75 (textarea border-box 外宽) → content-box 778.75 + padding:3px 6px + border:1px = border-box 外 791.99
- **修复**（commit `504cc0b`）：capsule CSS 加 `box-sizing:border-box`
- **CDP 实测 R10**：
  - capsule 外框 = textarea 外框 = 778.75px
  - deltaLeft = 0, deltaRight = 0 ✓ **像素级对齐**
- **测试**：加 1 项 R10 断言（box-sizing:border-box 命中）
- **75+ 项断言全绿**；既有回归全 PASS

## 2026-08-18 · 状态栏胶囊 R9 跟随输入框宽（#16 R9 · v1.6.9）

- **用户验收反馈**：R7 让 capsule width:100% 撑满 wrapper 后，capsule 左右超出输入框左右边（状态栏到了整个面板最左最右）
- **根因**（CDP 实测）：
  - capsule wrapper = `wSkVaW_composerStack` = DSH 整个对话区下半部分宽（1280px viewport 时 1536px）
  - textarea 输入框实际宽 780px（居中容器，左右各缩进 378px）
  - capsule `width:100%` 撑满 wrapper → 比输入框左右各宽 378px
- **修复**（commit `539c082`）：
  - StatusBar 顶部加 `inputRef = document.querySelector('textarea.uV2eYG_input')`
  - `useEffect` + ResizeObserver 监听 inputRef → `setIw(textarea 实际宽)`
  - capsule 内联 style `width: iw + 'px'`（CSS `width:100%` 仅作 fallback）
  - dockRef 仍监听 composerStack 宽（dn 缩放阈值仍反映 dock 缩放）
  - 2 秒轮询兜底：DSH shell 切换对话时 textarea 重新挂载
- **CDP 验证**：
  - 1280px viewport：capsule 宽 780px = 输入框宽，左右边对齐输入框左右边 ✓
  - 500px viewport：capsule 居中在 composerStack 内，宽 ≈ 输入框宽 ✓
- **测试**：加 5 项 R9 断言（querySelector / 双 ResizeObserver / 内联 width / disconnect / 轮询兜底）
- **75+ 项断言全绿**；既有回归全 PASS

## 2026-08-18 · 状态栏胶囊 R8 拆调试钩子（#16 R8 · v1.6.8）

- 用户验收 R7 后要求去掉 R3 加的 magenta/cyan outline 调试钩子（v1.6.3 临时开启）
- 拆掉 `.dsws-capsule { outline:2px dashed #ff00aa }` 和外层 wrapper `outline:'2px dashed #00aaff'`
- **不影响任何修复行为**（R7 对齐输入区 + R6 CSS 累加 + R5 ResizeObserver + R4 wrapper overflow:hidden + R2 max-width:100% 全部保留）
- **CDP 验证**：截图里**无粉色/蓝色虚线框**，状态栏胶囊显示干净
- 测试 + 既有回归 + CDP 截图验证全部 PASS

## 2026-08-18 · 状态栏胶囊 R7 对齐输入区（#16 R7 · v1.6.7）

- **用户验收反馈**：1280px viewport 下 magenta 框（capsule）远小于 cyan 框（wrapper），capsule 左右边没跟输入框左右边对齐，中间一段空白
- **根因**：R1 CSS `width:fit-content` → capsule 默认按内容自然宽（约700px），小于 wrapper 1300px，居中后左右各300px空白
- **修复**（commit `9485e15`）：
  - **条件式宽度**：默认 `width:100%`（dn=0 时撑满 wrapper 对齐输入区）
  - `[data-narrow-1..4] .dsws-capsule { width:fit-content }`（dn>=1 时切回自然宽居中，保留用户 B 方案：dn=4 后 capsule 不再缩）
- **CDP 验证**：
  - 1280px：magenta = cyan = 整个对话区下半部分宽 ✓
  - 500px (dn=4)：magenta fit-content 自然宽在 cyan 内居中，内容仅图标 + 数字 ✓
- **测试**：加 3 项 R7 断言（默认 width:100% + dn>=1 切回 fit-content + 旧无条件 fit-content 反向守护）
- **70+ 项断言全绿**；既有回归全 PASS

## 2026-08-18 · 状态栏胶囊 R6 CSS 累加 + 高度修复（#16 R6 · v1.6.6）

- **用户反馈 1**：缩小过程中文字「先消失再出现」（dn=4 时 seg文字还在）
  - **根因**：旧 CSS `[data-narrow="3"]` 等值匹配，dn=4 时不命中 → seg文字不消失
- **用户反馈 2**：capsule 高度被压扁到 7px，文字溢出被截
  - **根因**：wrapper `alignItems:'stretch'`（R2 误加）让父级 composerHero 297px 高反向拉伸 wrapper 到 9.5px，capsule 被跟着压成 7px
- **修复**（commit `474ebe5`）：
  - **CSS 累加语义**：旧 `[data-narrow="N"]` 等值匹配 → 新 `[data-narrow-N]` 属性存在性匹配
  - **JSX 累加属性**：capsule 同时写 `data-narrow-1/2/3/4`（`dn >= N || null`），dn=4 时 4 个 attribute 都存在
  - **R6b**：删 wrapper `alignItems:'stretch'`
- **CDP 实测验证**（500x800px viewport）：
  - cyan 框 = 输入框宽（500px） ✓
  - magenta 框 = cyan 框（重叠） ✓
  - 内容仅图标 + 数字（可接9 / BUG 3 / 诊断 2 / 沉淀 9 / 环境 9/9），**所有文字消失** ✓
  - timebtn 仅刷新图标 ✓
  - capsuleH: 7px → 29px ✓
- **测试**：加 10 项 R6 断言（CSS 累加 4 项 + JSX 属性 4 项 + 旧等值匹配反向守护 1 项 + R6b 无 stretch 1 项）
- **70+ 项断言全绿**；既有回归全 PASS

## 2026-08-18 · 状态栏胶囊 R5 dock 宽实时监听（#16 R5 · v1.6.5）

- **用户反馈**：R4 实施后缩小窗口时「可接」/「可接 11」文字不消失
- **根因**：R1-R4 用 `window.innerWidth` 计算 dn 阈值，DSH shell 里有 sidebar / dock 占位时 `window.innerWidth` ≠ 输入区实际宽（视口宽但输入区更窄），导致 5 级 CSS 选择器全部不命中
- **修复**（commit `22753d4`）：
  - StatusBar 顶部加 `dockRef = React.useRef(null)` + `dw` state
  - `useEffect` + `ResizeObserver` 监听外层 wrapper 元素（cyan 框），宽变化触发 `setDw` → React 重渲染
  - 保留 `window.resize` 事件监听（双保险，覆盖 body 层级缩放）
  - `dw` 替换 `vw` 作为 dn 阈值信号（dw < 960/880/800/720 → dn=1/2/3/4）
  - wrapper 两分支（`!firstBlock` 和有 firstBlock 横幅）都挂 `ref={dockRef}`
- **测试**：加 7 项 R5 断言（dw 阈值 / useRef / useState / ResizeObserver / window resize / 两个分支都挂 ref）
- **62+ 项断言全绿**；既有回归全 PASS

## 2026-08-18 · 状态栏胶囊 R4 截溢出（#16 R4 · v1.6.4）

- **用户反馈**：R3 调试钩子确认 R2 max-width:min(100%,1400px) 生效（capsule 跟着 wrapper 缩），但 children 内容 fit-content 自然宽 > capsule 宽时**从 capsule background 框左右捅出**呈「棍子」
- **根因**：capsule `width:fit-content + max-width:min(100%,1400px)` + children `flex:none + nowrap` 不缩 → children 溢出 capsule 边界
- **修复**（commit `0b1baca`）：
  - **wrapper 加 `overflow:hidden`** 截掉 capsule 溢出 wrapper 部分
  - 选 wrapper 截，不用 capsule overflow:hidden：capsule 圆角 + 背景完整保留（capsule 自己 overflow:hidden 会让 border-radius 圆角处露白）
  - dn=4 时 capsule fit-content ≈ 200px，几乎所有 wrapper 装得下，**不裁切**（满足用户「dn=4 后保持自然宽」诉求）
  - dn=0..3 中间状态：children 居中后左右对称裁切，保留中间可识别内容（最左/最右可能被截的是 capsule-word「MattSkills」品牌段和 dsws-skillbtn 末尾技能图标，感知不强）
- **测试**：加 2 项 R4 断言（wrapper overflow:hidden 命中 + capsule CSS 不再加 overflow:hidden 反向守护）
- **验收路径**：
  - 1280px 视口：胶囊单行居中，宽 = 内容自然宽
  - 输入区被压到 600px 时：胶囊被 wrapper 压到 = 输入区宽 - 16px，children 居中后左右溢出被 wrapper overflow:hidden 截掉
  - < 640px dn=4 触发：capsule 自然宽 ≈ 200px，wrapper 装得下，不裁

## 2026-08-18 · 状态栏胶囊 R3 调试钩子（#16 R3 · v1.6.3）

- **用户反馈**：R2 实施后用户实测「胶囊还是没缩」，怀疑版本没生效。
- **根因**：v1.6.2 (R2 后的版本) 在源文件里实际已含 `max-width:min(100%,1400px)` + wrapper `width:100%` 改动 ——**代码层是对的**，但浏览器加载的是缓存里的旧 bundle (dev:web 的 `?rev=` hash 没变 或 service worker 缓存)，CSS/JSX 改动没机会跑。需要让用户能直接看到 R2 改动实际生效，定位是「缓存问题」还是「外层 wrapper 没拿到宽」还是「胶囊本身的 maxWidth 没生效」。
- **临时调试钩子**（仅 v1.6.3，1-2 个 issue 周期内拆掉）：
  - `.dsws-capsule` 加 `outline:2px dashed #ff00aa` (magenta)
  - 外层 wrapper 加 `outline:2px dashed #00aaff` (cyan)
  - 升 `DSW_VERSION` v1.6.2 → v1.6.3（让用户从浏览器看到的版本号区分缓存版本 vs 新版本）
- **用户验证步骤**：刷新页面后看胶囊 + wrapper 是否有虚线边框
  - 都没有 → bundle 没刷新（清缓存或重启 dev:web）
  - 只有胶囊 magenta → wrapper JSX 没生效（外层 wrapper 没拿到 `width:100%`，胶囊本身的 CSS 是对的）
  - 只有 wrapper cyan → 胶囊 CSS 没生效（看是不是 bundle 里的 styles.insert 没跑）
  - 两个都有 → R2 改动实际生效；问题在更外层父级

## 2026-08-18 · 状态栏胶囊宽度跟随输入区左右边（#16 R2 · v1.6.1）

- **用户验收反馈**：R1 实现里胶囊按 `max-width:min(96vw,1400px)` 撑出 → 输入区被压到很窄时胶囊左右溢出超过输入框左右边，视觉上「状态栏宽度像被固定了」
- **修复**（与 R1 同一 issue，不开新 ticket；commit `bfe29ac`）：
  - CSS：`.dsws-capsule { max-width:min(100%,1400px) }` 替代 `min(96vw,1400px)`，让外层输入区容器能封顶；去掉 `margin:0 auto`（外层 wrapper 负责居中）
  - JSX：胶囊外层 wrapper 加 `width:100% + boxSizing:border-box + alignItems:stretch`，让 wrapper 真正跟输入区宽走（之前 wrapper width:auto，按内容互锁放大）
- **测试**：`tests/verify-capsule-narrow.js` 加 5 项新断言（胶囊 max-width 用 100% 不用 96vw；胶囊不再有 margin:0 auto；外层 wrapper width:100% + boxSizing:border-box；旧 R1 残留反向守护）—— **60 项断言全绿**
- **验收路径**：
  - 1280px 视口：胶囊单行居中，宽 = 内容自然宽（不超过 1400px）
  - 输入区被压到 600px 时：胶囊被压到 = 输入区宽 - 16px（8px padding × 2），左右边缘对齐输入框左右边
  - < 640px 兜底：胶囊宽 = 输入区宽，文字按 dn 阈值只剩图标 + 数字，不再左右溢出超过输入区
- **保留不变**：5 级文字→图标收缩 dn=0..4 / 禁止换行 / click 契约 / 双源镜像同步

## 2026-08-18 · 状态栏胶囊禁止换行 + 窄屏 5 级文字→图标收缩（#16 · v1.6.1）

- **BUG**（reporter 反馈）：状态栏 `.dsws-capsule` 在对话窗口变窄（< ~920px）时按钮被强行换行成两/三行，破坏单行居中胶囊观感；「MattSkills」字常显，数字段（可接/BUG/诊断/环境）文字不收敛，时间「MM-DD HH:MM」整体不收敛
- **根因**（v15 历史修复尾巴）：
  - v15（issues-checklist 24）已修 `white-space:nowrap` + `flex:none` + `width:fit-content`，但**漏改 `flex-wrap:wrap`** → 窗口 < 920px 时胶囊自然宽 > 96vw，children 被强制换行
  - children 文字 span 没有任何阈值切换逻辑，文字只会被动让位给换行
  - 体系缺口：胶囊的「视口度量」完全缺失（与面板 tabs 行的「容器宽度度量 s.size.w」是两种不同形态的 narrow）
- **修复**（与既有 `.dsws-btn.narrow-icon` 模式同形态）：
  - **CSS**（`.dsws-capsule`）：`flex-wrap:wrap` → `flex-wrap:nowrap`，加 `white-space:nowrap` 兜底；新增 4 条 `[data-narrow="N"]` 属性选择器，逐级 `display:none` 文字 span
  - **JSX**（renderStatusBar）：渲染时读 `window.innerWidth` → 算 `dn ∈ {0,1,2,3,4}` 阈值 → 写 `'data-narrow': dn || null` 到 capsule 根 div
  - **JSX 微调**（让选择器稳定命中）：note 段 / 交接左半 / 刷新按钮的文字用 `h('span', null, ...)` 包裹；timebtn 文字拆为 word + time 两段 span
- **5 级阈值**（视口宽）：
  - `dn=1` vw < 960：品牌段「MattSkills」字消失（图标保留）
  - `dn=2` vw < 880：无数字段文字消失（沉淀/交接/刷新字）—— timebtn 末段时间保留
  - `dn=3` vw < 800：有数字段文字消失（可接/BUG/诊断/环境）—— 图标+数字保留
  - `dn=4` vw < 720：timebtn 时间文字消失（仅刷新图标）
  - 兜底 vw < 640：维持 dn=4，children `flex:none` + `nowrap` 拒绝换行，胶囊允许右缘溢出
- **EN locale**：同 `data-narrow` 阈值；`panel.title` 中英同字「MattSkills」，EN 下 dn=1 为 no-op
- **点击事件契约**（保留 + 新增守护）：
  - 点击 `dsws-capsule-word` → `togglePanel(s)`（stopPropagation）
  - 点击胶囊空白 → `openPanel(s)`（冒泡到 capsule root）
  - 各 `seg` / `dsws-split` / `dsws-timebtn` / `dsws-skillbtn` 走各自具名 handler + stopPropagation
- **验收**：
  - 新增 `tests/verify-capsule-narrow.js`：22 项静态契约（CSS 选择器 + JSX data-narrow + click handler + i18n 键齐）+ 11 项行为契约（5 级阈值 vw=1280/1000/950/900/870/850/790/750/700/600）+ 1 项双源 CSS 块 byte-for-byte + 1 项双源 JSX 块 byte-for-byte（去缩进）= 共 35 项断言，**全部通过**
  - 既有回归 `verify-handoff-split` / `verify-t3-locale` / `verify-status` / `verify-blocked-filter` / `verify-bug-entry` 全部 PASS
- **双源镜像同步**（client.js ↔ package/lib/client.js）· 已加版本号 v1.6.1（DSW_VERSION 双源）
- **风险点**：`vw` 在 render 时一次性读取，浏览器 resize 不触发重渲染（status bar 实际在 probe 等状态下会重渲染；纯 resize 暂未加 listener，按 issue 范围属 out-of-scope）

## 2026-08-18 · 修复右侧面板漏检子票变化（#2 MVP · v1.5 R2）

- **BUG**（reporter 反馈）：右侧面板（列表 / 技能 / 环境检查）长时间不更新 GitHub 状态，必须手动点「刷新」—— **不是「5min 太慢」那么简单**，子票（wayfinder:task / research / prototype / grilling）变化根本不被检测。
- **根因**（两轮 grill 拍板）：
  - **Round 1**：probe `PROBE_MS = 300000`（5min）+ 60s 缓存体感不更新；
  - **Round 2（用户补充观察后重诊断）**：probe REST 查询 `?labels=wayfinder:map` **只匹配地图本身**，漏检所有子票变化 —— 面板绝大多数内容（可接 / 阻塞 / 已认领 / 已关闭分组，DESIGN.md §5.2）都是子票。
- **MVP 修复**（按 maintainer 拍板的 MVP-first 原则）：
  - **probe 范围扩到 since 时间戳**：`package/lib/index.js` + `host.js` `case 'probe'` / `harness.handle('wf.probe', ...)` 改为 `gh api repos/.../issues?state=open&per_page=100&since=<ISO>`，1 次 REST 覆盖全 issue 增量（地图 + 子票 + 其他）；
  - **新增** 模块级 `lastProbeAtByRepo`（按 repoKey 隔离，多仓库会话并发不互串），`buildSnapshot` 末尾初始化为 `new Date().toISOString()`；probe 命中时滑动基准线；
  - **`PROBE_MS`** 默认 300000 → **60000**（1min，用户感知阈值；REST 5000/h 池 60s × 10 repos = 600/h，12% 占用，安全）；
  - **保留** `FOCUS_PROBE_MIN_MS = 60000` + 关键动作 8s 延迟探测 + 错误静默 + `SNAP_FRESH_MS = 60000` 缓存；
  - **移除** 已死代码 `lastMapsUpdatedAtByRepo`（probe 改用 since 后不再需要）。
- **验证**：
  - 双源 `host.js ↔ package/lib/index.js` ↔ `client.js ↔ package/lib/client.js` 关键特征逐字一致；
  - `tests/verify-b5-quota.js` 适配新机制：46 项 PASS（原 32 项 + 14 项 R2 新增 / 适配）；
  - 新增 `tests/verify-probe-since.js`：24 项 PASS（since 参数 / `lastProbeAtByRepo` 隔离 / buildSnapshot 初始化 / `PROBE_MS = 60000` / 双源一致）；
  - 其他回归测试 `verify-status / prompts / markdown / bug-entry / handoff-split / t2a-config / t2b-templates / t3-locale` 全部 PASS。
- **方法论沉淀（issue body）**：MVP-first / UI/UX 反向校验原则应用于本 issue —— 任何用于支撑 UI/UX 的契约层都应接受 UI/UX 验收的反向校验，不当作 UI/UX 开工前不可动摇的终点；phase 2（配置 UI / UI 时间戳 / 错误可视化）由 UI/UX 验收反馈决定。
- **端到端验收（人工 / maintainer 实测）**：在指定仓库新发一张带 `wayfinder:task` 标签的子票 → 等 ≤60s → 不点刷新 → 面板「可接」或对应分组应自动出现新行（带高亮 / 绿闪，R5 视觉反馈）。

## 2026-08-18 · BUG 悬停菜单 UX 优化（#4 v3 · 宽度自适应 + 按钮 hover 反馈）

- **需求**（#4 收尾时细化）：状态栏 BUG 悬停菜单的「新增」按钮——① hover 时整体颜色需变化（按钮感）；② 弹层右侧空白过多，需按内容自适应宽度
- **修复**：
  - 去掉弹层 `minWidth: 96`（强制宽度），让 menu 按内容收缩；按钮 `display: 'flex'` → `'inline-flex'` 保证 shrink-to-fit
  - store 新增 `bugMenuHover: false`（仿 `s.skillHover` 既有模式）；按钮加 `onMouseEnter`/`onMouseLeave` 切换；hover 时背景 `rgba(248,113,113,.15)` 红染 + 文字 `#f87171` + 图标 `#fca5a5` 亮红
  - 菜单 `onMouseLeave` 与按钮点击时均重置 `bugMenuHover=false`，避免下次打开残留状态
- 校验：弹层 DOM 结构未变、无新 timer、无新 CSS 类；视觉 8px 间距保留；菜单按内容收缩（预计 zh "新增" 约 58px 宽，en 文案更窄）
- 新增 `tests/verify-bug-entry.js` 第 9/10 项契约（宽度自适应守护 + hover 反馈守护）；反证测试 4/4 通过
- 双源镜像同步（client.js ↔ package/lib/client.js）· 已同步 DSH 安装目录（hash 96B1350...）

## 2026-08-18 · 修复状态栏 BUG 悬停菜单死区（#4 验收 BUG）

- **BUG**：用户实测「状态栏 BUG 段悬停菜单」——弹出后，鼠标经过弹层与 BUG 段之间的 4px 空隙触发 `onMouseLeave`，菜单立刻关闭，鼠标到不了「新增」按钮
- **根因**（第一性原理）：弹层 `marginBottom: 4` + `bottom: '100%'` 在 menu 与 span 之间留出 4px 真空带，该带既不在 span 后代集内、也不在 menu 节点内，光标路过触发 `mouseleave` 即关闭（`mouseleave` 基于 DOM 后代判定而非像素盒区）
- **修复**：去掉 `marginBottom: 4`，把视觉间距挪到 `paddingTop: 8`（4 margin + 4 padding → 0 margin + 8 padding，**视觉 8px 不变**）；弹层紧贴 BUG 段，光标路径全在 span 后代集内
- 校验：弹层 DOM 结构未变（menu 仍是 span 后代）、无新状态、无 timer、无新 DOM
- 新增 `tests/verify-bug-entry.js` 第 8 项契约（死区回归守护：BUG 弹层 marginBottom > 0 即失败）；反证测试通过
- 双源镜像同步（client.js ↔ package/lib/client.js）· 已同步 DSH 安装目录（hash 三方一致 958D5664...）

## 2026-08-18 · newBugWayfinder 7 字段挪到 prompt 末尾（#1 BUG3 补强 · #4 v2）

- **BUG**：用户报告「+ 新增BUG单」预填的 prompt 中 7 字段（背景 / 场景 / 现象 / 复现步骤 / 期望行为 / 实际行为 / 影响范围）位于流程说明之后、正文格式契约之前——属于中途输入位，违反 #1 BUG3「输入位一律末尾」原则（v5 同款反模式）