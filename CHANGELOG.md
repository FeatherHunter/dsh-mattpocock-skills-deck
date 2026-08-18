# dsh-mattpocock-skills-deck 变更历史

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
- **修复**：`newBugWayfinder` v1→v2，注册表模板从「流程说明 + 7 字段」收敛为「流程说明 + 末尾指引」；7 字段空白 body 抽出为 `NEW_BUG_FIELDS_BODY()`，由 `newBugWayfinderText` 在 `promptText + BODY_FORMAT` **之后**追加，落在真正的模板末尾
- 验收：7 字段保持在 BODY_FORMAT 之后；`tests/verify-bug-entry.js` v2 适配（注册表禁中途输入位 + NEW_BUG_FIELDS_BODY 7 字段齐备 + 拼接契约断言）
- 双源镜像同步（client.js ↔ package/lib/client.js）· 已同步 DSH 安装目录（hash 校验 True）

## 2026-08-18 · 新增BUG单入口（issue #4）

- **需求**：「+ 新增BUG单」按钮（右侧面板 tabs 行「+ 新建需求」旁，dock + sidebar 两处渲染）+ 状态栏「BUG 2」悬停菜单「新增」——点击都在新会话（同 cwd）打开并预填 /wayfinder 的 BUG 专用 prompt（新注册表条目 `newBugWayfinder`）
- **模板**：7 字段中英双语（背景 / 场景 / 现象 / 复现步骤 / 期望行为 / 实际行为 / 影响范围，每行一项 + 冒号）；按用户拍板不硬编码平台——写「新建带 bug 标签的 ISSUE」，不写死 gh issue create（未来用户未必在 GitHub 平台）
- **交互**：BUG 计数段点击仍开 bug 过滤列表（行为不破坏）；悬停弹「新增」菜单（React 容器包含关系，跨 4px 间隔无悬停闪烁）
- 新增 Ic `bug` 虫形图标 / i18n 键 panel.newBug / panel.newBugTitle / nav.bugNew / nav.bugNewTitle（zh/en）/ store 状态 bugMenuOpen
- 新增回归测试 tests/verify-bug-entry.js（注册表字段齐备 / 双语 / 平台中立 / 接线次数 / 双源一致）
- 双源镜像同步（client.js ↔ package/lib/client.js）· 已同步 DSH 安装目录

## 2026-08-18 · 修复当前 DSH 插件发现的问题（issue #1）

- **BUG1/3**：`newWayfinder` prompt 的「需求描述：」输入位移到模板**末尾**（v5→v6，中英同步；全量审计确认仅此模板有中途输入位）
- **BUG2**：「+ 新建需求」点击改为**在当前工作区新开会话并预填 prompt**（复用 `openTextInNewSession`，失败降级为当前会话注入）
- **需求1**：交接按钮右侧新增「新会话交接」SVG 小按钮（handoff-open 图标）——点击 = 原「第二击」：复制交接读取 prompt + 开新会话；交接按钮本体不再变字（中英适配）
- **需求2**：状态栏末尾新增技能列表 SVG 按钮（2×2 网格）——点击**向上展开** 20 个技能名列表，点击技能名插入 /<技能名> 到当前会话，悬停显示一句话作用（skilldesc 双语）
- **契约回归修复**：`verify-progress` / `verify-b2-map-newsession` 适配 prompt 常量函数化形态（`BODY_FORMAT()` / `FIXATE_PROMPT()`）
- 一并落库工作区既有未提交 i18n 双语改造（host 环境检查 lang 参数 + client prompt 函数化 + 安装引导 prompt 修订）
- 双源镜像同步（client.js ↔ package/lib/client.js）· 已同步 DSH 安装目录

### 技能浮层体验优化（同日 · issue #1）

- 移除浮层顶部「技能」标题，列表保持纯技能名
- 滚动条改为跟随主题（WebKit + Firefox 双写法）
- 自研快速悬浮提示（即时、行右侧、右溢出翻转；替代原生 title 的慢延迟），内容=一句话 skilldesc
- 行 hover 视觉反馈：背景高亮 + 文字变亮 + 左侧紫色 accent
- 底部常驻操作提示「点击技能名 → 插入到当前会话」（中英）

### 交接分割按钮 + 状态传达（同日 · issue #1 · 需求1 二阶段）

- 交接段由「交接」+「新会话交接」两个独立胶囊合并为**分割按钮**：共外框 + 细分隔线（1px×14px，bg=var(--dsw-alias-border-l1)），左半「交接」（Icon handoff + 文字）/ 右半「交接出去」（Icon handoff-open），左右各自点击区与 tooltip 保留，hover 沿用 seg 背景
- **灰/亮双态**：store 新增 handoffReady（默认 false）；第一击生成成功 → 右半亮蓝 #58a6ff + tooltip「开新会话并预填交接文档路径」；未 ready → 半透明灰（opacity .6 / 文字色 #8b8b95）+ 新 tooltip「尚未生成交接文档：先点「交接」生成」
- **引导门**：未点过第一击时点击右半 → 先探测磁盘 .scratch/handoff/ 最新文档（host wf.handoffLatest 按 mtime 取最新）→ 有 latest 才置 ready + 开新会话并预填 /read；没有 → toast 引导「请先点「交接」生成交接文档」且**不再开空会话**（删除原「无文档仍开新会话」的糊涂分支，含宿主通道不可用 / 探测失败兜底）
- 新增 i18n 键：nav.handoffGreyTitle / toast.handoffGrey（zh/en）；同时移除被引导门取代的 3 个已无引用的历史 toast 键（toast.copiedHandoffNoLatest / toast.handoffNotFound / toast.copiedHandoffFail），t3-locale 净增 -1 → 232 键 × zh/en
- 新增回归测试 tests/verify-handoff-split.js（静态契约 + 引导门行为沙箱：双源 × 5 场景）
- 双源镜像同步（client.js ↔ package/lib/client.js）· 已同步 DSH 安装目录

### 交接按钮 rev（同日 · #1 · 用户 UI 反馈两处）

- **无文档即禁止开新会话**：删除「本会话点过第一击即放行」的旁路——doHandoffOpen 任何情况下都先探测磁盘 .scratch/handoff/ 真实文档，有 latest 才置 ready + 开新会话；没有 → toast 引导且**绝不打开空会话**；右半未就绪呈禁用态（灰 + opacity .55 + 自定义 SVG「文档+斜杠」禁用图标 handoff-off + cursor default，替换系统红圈光标，tooltip 引导）
- **灰/亮依据改为「磁盘真实文档」**：新增 probeHandoffReady（探测 → 写 st.handoffReady + emit 重渲染）；StatusBar 挂载即探测；第一击只注入模板并触发立即 + 10s 延迟再探测，文档一成文右半自动亮蓝可点（不再仅凭第一击就亮）
- **边框/分隔线 hover 才显**：分割按钮外框边框与细分隔线改为常驻透明、hover 时浮现（与 沉淀/诊断/bug 等 seg 按钮一致），hover 背景沿用 seg
- verify-handoff-split.js 升级为 rev 契约（22 静态 + 8 行为场景 × 双源）

## v1.0.0 正式发布（2026-08-17 · 新包名首发）

- 插件更名为 **dsh-mattpocock-skills-deck**（Matt Skills Deck），仓库迁移至 https://github.com/FeatherHunter/dsh-mattpocock-skills-deck
- 插件 id：dsh-waystation → dsh-mattpocock-skills-deck（cordis.patch.yml / client 注册 / export name / data-plugin / 会话标题前缀）
- 显示名：Waystation → Matt Skills Deck（胶囊 / 面板标题 / 设置页 / 配置页）
- 内部契约保留：/dsws RPC 通道 · dsws- CSS 前缀 · waystation:map tab type · .dsh-waystation-cache 缓存目录
- 版本从旧包 dsh-waystation@1.5.0 语义继承，新包以 1.0.0 首发；旧包 dsh-waystation@1.5.0（npm）仍可用，不再迭代

---
