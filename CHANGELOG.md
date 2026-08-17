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

## v1.0.0 正式发布（2026-08-17 · 新包名首发）

- 插件更名为 **dsh-mattpocock-skills-deck**（Matt Skills Deck），仓库迁移至 https://github.com/FeatherHunter/dsh-mattpocock-skills-deck
- 插件 id：dsh-waystation → dsh-mattpocock-skills-deck（cordis.patch.yml / client 注册 / export name / data-plugin / 会话标题前缀）
- 显示名：Waystation → Matt Skills Deck（胶囊 / 面板标题 / 设置页 / 配置页）
- 内部契约保留：/dsws RPC 通道 · dsws- CSS 前缀 · waystation:map tab type · .dsh-waystation-cache 缓存目录
- 版本从旧包 dsh-waystation@1.5.0 语义继承，新包以 1.0.0 首发；旧包 dsh-waystation@1.5.0（npm）仍可用，不再迭代

---
