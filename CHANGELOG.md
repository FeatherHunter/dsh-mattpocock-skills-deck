# dsh-mattpocock-skills-deck 变更历史

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

- **无文档即禁止开新会话**：删除「本会话点过第一击即放行」的旁路——doHandoffOpen 任何情况下都先探测磁盘 .scratch/handoff/ 真实文档，有 latest 才置 ready + 开新会话；没有 → toast 引导且**绝不打开空会话**；右半未就绪呈禁用态（灰 + opacity .6 + cursor not-allowed + tooltip 引导）
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
