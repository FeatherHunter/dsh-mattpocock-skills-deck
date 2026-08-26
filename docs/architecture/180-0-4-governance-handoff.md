# 多后端治理 0-4 决策纪要（Map #180 已确认，供后续 AI 继承）

> 来源：2026-08-25 Wayfinder Map #180 与用户 0-4 流程逐轮 Grilling 拍板（仅 UI 前端，契约/后端零改动，跨层需单列报批）

## 0-4 完整流程（Destination 已重写）

0. **入口感知（前提）**：用户打开 DSH 任一会话后，通过明确 UI 形式知道该选后端（何种入口、何种呈现）
1. **后端选择与初始化**：选 GitHub/Markdown/GitLab/Other 能正确初始化（GitHub 含提醒建仓 + 按 setup 模板 wayfinder 规则标签完整性）
2. **前置环境检查与指引**：帮用户做好所选后端的前置检查，缺失时可执行指引直至配好（CRI = gh CLI / gh auth / git 为一级门禁）
3. **回到主线流程**：后端已选且初始化就绪后，回主线（状态栏与右侧面板列表正常可用，交用户自用）
4. **支持后端切换**：允许显式切换（弹窗含 prompt 可编辑，保留/迁移/清空三选一，默认保留）

判完成 5 段可验：① 入口感知可感知 ② 选择初始化正确 ③ 检查指引闭环 ④ 主线回归正常 ⑤ 切换落地

## 已拍板设计（供 Grilling 定版引用）

### G1 入口感知（#184）
- **触发**：进入工作区后底层 `Banner`（类似 setup 提示条“该工作区还没有设置”）→ 用户**点 Banner 才弹 Modal**
- **选项**：Modal 内**动态列表** `wf.registry` 取（现 3 项 GitHub/Markdown/GitLab，**不含 Other**，未来动态增自动多一项），确认后 `wf.bind` + `wf.getSetupPrompt` 注入
- **交互**：Modal 有 **取消/确认** 两按钮；取消=允许先不选
- **隐藏粒度（Q2）**：未选择时 **状态栏整条不渲染、Dock/Overlay 容器不挂载（不可打开）**，仅设置页与 Banner/Modal 可见
- **两态区分（Q3）**：`pending`（探测中 3s）→ 等待卡 spinner + 重试/去选择；`isOther`（显式未选择）→ 引导卡选择器；两态分离

### 多态与动态（Q1 补充）
- UI 不知后端是谁：列表 `wf.registry`、确认 `wf.bind`、提示词 `wf.getSetupPrompt`、检测 `mod.checkRequirements(ctx)`、仓库 `mod.ensureRepo` 均多态
- 新增后端只需 `register({id, checkRequirements, ensureRepo, getSetupPrompt})`，UI 自动多一项

### 人机协作指引（装 CLI / 登录）
- **装 CLI 与登录统一走 `prompt:` 注入**，宿主仅检测不自动装/登
- 底层经 `preflight.prompt` 透传完整 prompt 文本（多态，`hint` 即完整文本，UI 直接 `inject(hint)`）；`gh` 缺失时后端 `ghPreflight` 返回 `GH_INSTALL_PROMPT`（`winget/brew/apt` + `gh --version`），UI 单按钮“AI 引导安装”直注后端文案（`prompt:installGh` key 已废止，`openUrl('https://cli.github.com/')` 副按钮已移除）；`gh auth` 仍 `prompt:ghAuthLogin` 待迁（#59）
- 分两阶段链式：`gh` 缺 → 只显安装卡；装好重检才显登录卡

## 约束
- 仅 UI 前端（`src/client/*` + 现有 `wf.*` 胶水复用），Tracker 契约与三后端适配器零改动，跨层（host 自动打标签等）需单列报批（见 #181 A vs B）

## 后续 AI 必读
- Map：#180；Research：#181/#182/#183（已 closed，产物 `.scratch/research-18*.md`）；Grilling：#184/#185/#186（#184 已 claim）
- 真源：`src/client/views/shared/BackendSelector.js`、`src/client/panel/Dock.js`、`src/host/tracker/registry.js`、`src/host/tracker/detection/detectionService.js`、`src/host/index.js:wf.status/bind/detect`

## 对未来新增底层的“限制到人机协作”

- **硬限制**：UI 已写死只认 `checkRequirements[].hint` 以 `prompt:` 开头的卡才给主按钮“注入指引”；若后端不按此返回，`wf.status` 可跑但 UI 卡无主按钮，环境检测走不完（天然卡点）
- **软帮扶**：契约测试 G4 + `verify-labels-sync` 已为模板，新增 `verify-requirements-prompt` 校验 `hint` 须 `prompt:` 或 `https:`，`docs/third-party-tracker.md` 增加一节“人机协作提示词规范”与 `demo-mini` 示例 `getSetupPrompt` / `checkRequirements` 模板，PR 门禁即拦