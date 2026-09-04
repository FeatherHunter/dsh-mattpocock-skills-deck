# 研究：配置面板 8 块现状全量调研与画像

> Ticket: #408 — 研究：配置面板 8 块现状全量调研与画像
> 日期: 2026-09-02
> 范围: 只读一手源码，不改行为；所有结论都回到文件与行号，可按路径复核
> 主源: `src/client/views/SettingsPage.js`（319 行，25,533 字节）`src/client/kernel/config.js`（157 行）`src/client/kernel/locale.js`（790 行）`src/client/kernel/styles.js`（309 行）`src/client/index.js`（`settings.plugins.tab` / `settings.section` 双入口）`package/cordis.patch.yml`（4 行）`scripts/build.mjs`（LEAF/KERNEL/SHARED 三表拼接）`tests/verify-config-scroll.html`（24,048 字节，真实渲染样板）
> 方法: 高可信主源直读 → 抓取文件证据 → 落盘可追溯（本文件即落盘物）

---

## 摘要（一句话）

配置面板是一个单页纵向表单，顶端是标题与 Matt 技能导流，中间是两块只读/即时生效的全局控制（打开位置、后端总览、面板宽度），底部是两块模板编辑（开始模板单条 + 动作模板 6 卡）与保存栏；持久化只有两把钥匙 `dsws.cfg` 与 `dsws.templates`，入口有两条（设置页左侧栏与插件页标签共用同一组件），样式全部走 `STYLE_TEXT` 注入，门禁靠 `build.mjs` 三表拼接与 `verify-config-scroll.html` 人眼样板兜住。

---

## 1 证据总览

| 文件 | 作用 | 关键行 | 长度 |
| --- | --- | --- | --- |
| `src/client/views/SettingsPage.js` | 8 块真源 ESM，build 去 `export` 后拼回 `src/client/index.js` | 1-319 全量；入口见下表 | 25,533 B |
| `src/client/kernel/config.js` | 持久化与模板引擎真源 | 9-38 `CFG_KEY/TPL_KEY`；59-105 `TPL_PH/TPL_REQUIRED/TPL_DEFAULT` | 5,642 B |
| `src/client/kernel/locale.js` | 文案真源（`cfg.* / tpl.* / matte.* / panel.title`） | zh 333-374，en 722-763，共 790 行 | 49,019 B |
| `src/client/kernel/styles.js` | 样式真源（`STYLE_TEXT` 数组） | 252-292 `dsws-cfg*` 41 处 | 34,662 B |
| `src/client/index.js` | 注册点（双入口）与拼接锚点 | 114 `kernel:locale` 175 `kernel:config` 264 `leaf:settingsPage` 346-353 双注册 | 17,012 B |
| `package/cordis.patch.yml` | 插件装配声明 | 全文件 4 行，`id: dsh-mattpocock-skills-deck` | 4 行 |
| `scripts/build.mjs` | 拼接逻辑（去行首 `export` → 贴到标记处） | 185-212 三表定义；249-270 `extractModuleBlock/wireModules`；283-290 反向检查 | 24,726 B |
| `tests/verify-config-scroll.html` | 真实渲染样板（滚动与排版门禁） | 体积 24,048 B，含 `.dsws-cfg{max-width:720px}` 等 9 段样式 | 24,048 B |

`cfg/matte` 在仓库中无独立目录；`matte.*` 实为 `locale.js` 中 `L.zh/en` 的一组键（`matte.title/desc/openRepo/copyPrompt`），历史说明中的 `cfg/matte` 即指这两组键。已按实际文件标注，不虚构路径。

---

## 2 双入口与装配

| 项目 | 证据 |
| --- | --- |
| 人口 | 左侧设置栏 `settings.section` 与插件页标签 `settings.plugins.tab` 共用同一组件 `SettingsPage` |
| 注册代码 | `src/client/index.js:346-347` `slots.register({ name: 'settings.plugins.tab', id: 'dsws-settings', order: 40, label: () => tr('panel.title') }, withCx(SettingsPage))` |
| 第二入口 | `src/client/index.js:351-352` `slots.register({ name: 'settings.section', id: 'dsws-settings-section', order: 18, label: () => tr('panel.title') }, withCx(SettingsPage))`，order 18 注释 `"15 < 18 < AgentPresets20 < better-sidebar100"` |
| 装配声明 | `package/cordis.patch.yml:1-4` `insert: { id: dsh-mattpocock-skills-deck, name, config:{} }`，由 `dsh plugin add` 自动装配，无需手改；`dsh plugin remove` 自动移除 |
| 构建拼接 | `scripts/build.mjs:219-246` `LEAF_MODULES` 含 `{id:'settingsPage', file:'src/client/views/SettingsPage.js'}`；`KERNEL_MODULES` 含 `config/locale`；`SHARED_SPLICE` 5 项；`wireModules` 按标记 `// ==== leaf:settingsPage (spliced by build) ====` 原位替换，做去行首 `export` 处理，行为零变化 |

---

## 3 8 块画像（按页面从上到下）

> 计数口径：页面纵向共 8 个视觉块。含头（标题+副标题）1、`dsws-cfg-group` 5 个、`details.dsws-cfg-details` 1 个、底部保存栏 1 个＝8。底栏虽无 `dsws-cfg-group` 类，但在视觉上占一行，计为一块。

### 块 1 — 标题与状态头

- **功能**: 说明这是 MattSkills 配置页，并用状态位反馈保存结果
- **DOM**: `src/client/views/SettingsPage.js:181-189` `div.dsws-cfg > div.dsws-cfg-head（Icon compass + span.t + span.s）` + `div.dsws-cfg-sub`
- **文案**: `locale.js:333-335` `cfg.status='配置'` `cfg.saved='已保存'` `cfg.sub='配置面板与动作提示词：静态文本可自由编辑，占位符由系统注入真值，点击即可插入。'`；对英文 `locale.js:722-724` `Config / Saved / Configure the panel...`
- **交互**: 纯展示；右侧状态随 `saved` 布尔切换，图标 `check/dot` 与颜色 `#4ade80 / #8b8b95`
- **持久化键**: 无（瞬时 UI 状态）
- **样式**: `styles.js:253-256` `.dsws-cfg{max-width:720px;flex column gap12}` `.dsws-cfg-head{flex gap10}` `.dsws-cfg-head .t{15px 700}` `.dsws-cfg-sub{12px #a1a1aa 1.7行高}`
- **门禁覆盖**: 汇总在块 8 的滚动样板中可视化检查；`build.mjs:313` 单声明门禁覆盖 `SettingsPage`（禁止在一个产物中声明两次）

### 块 2 — Matt 技能集导流卡

- **功能**: 让新用户知道这块面板背后是 25 个 Matt Pocock 技能，去仓库或一键复制安装 prompt
- **入口**: 同块 1，位于配置页第二行
- **DOM**: `SettingsPage.js:191-198` `div.dsws-cfg-group > gtitle(star)+gdesc+row(a+button)`
- **文案**: `locale.js:336-339` `matte.title/desc/openRepo/copyPrompt`（中文 `"Matt Pocock 技能集 / 工程领域+通用领域…25 个核心技能"`）
- **持久化键**: 无
- **交互**: `a.href=MATT_REPO target _blank`（常量定义见 `src/shared/matt-skills.js` 与 `src/client/kernel/prompts.js` 的 `installSkills`）；`button.onClick = copyText(sharedSt, promptText('installSkills', installSkillsParams()), tr('toast.copied'))`
- **样式**: 复用 `dsws-cfg-group/gtitle/gdesc/row`；按钮为 `dsws-btn`（`styles.js` 通用边框 `#2a2d35` + hover `#3a3f4a`）
- **门禁覆盖**: 无专用门禁；依赖 `scripts/generate-github-fixtures.js` 等对 `matt-skills.js` 的间接覆盖

### 块 3 — 打开位置

- **功能**: 决定控制面板在何处打开
- **入口**: 同上；检测宿主服务 `ctx.get('betterSidebar')` 是否提供 `registerTab`
- **DOM**: `SettingsPage.js:200-212` `div.dsws-cfg-group > gtitle(map) + gdesc + row(label+seg+hint)`；段控为 `div.dsws-cfg-seg > button dock/sidebar`
- **持久化键**: `CFG_KEY='dsws.cfg'`（`config.js:9`）中的 `openIn: 'dock'|'sidebar'`，默认值按是否装 better-sidebar 决定（`config.js:13-26`）
- **文案**: `locale.js:340-345` `cfg.openIn/openInDesc/openInLabel/openInDock/openInSidebar/openInHint`（中文 `"打开位置 / 面板在哪个区域打开…已即时生效：下次打开面板时按新位置打开"`）
- **交互**: 特殊——点段控即时生效（`SettingsPage.js:39-43` `pickOpenIn(v){ cfg.openIn=v; saveCfg(); broadcastCfg(); openInNote=true; timer 2600ms 熄 }`），无需滚到底部点保存全部；未装 better-sidebar 时只展示 dock，sidebar 按钮不渲染（`SettingsPage.js:207-208` 三元）
- **样式**: `styles.js:262-265` `.dsws-cfg-seg{inline-flex border #2a2d35 radius8 bg #16181d pad3 gap2}` `.dsws-cfg-seg button.on{background:#c084fc;color:#140a1e 600}`；提示为内联 `font 11 color #4ade80`
- **门禁覆盖**: `config.js:13-26` 的默认分支在 `tests/verify-build-artifacts.js` 间接覆盖；本块无独立滚动门禁

### 块 4 — 工作区后端总览（只读）

- **功能**: 汇总当前可见的全部工作区及其 Tracker 后端绑定，供人类快速确认是否已绑定
- **DOM**: `SettingsPage.js:215-262` `div#dsws-cfg-backend.dsws-cfg-group > gtitle(compass)+gdesc + details[open false]{summary(共N 已绑定M 刷新 点击展开/收起) + div{ wsOverview.loading/err/ordered.map(row) } }`；每行 `div[gap8 borderBottom #2a2d35 minHeight28]{ HoverTip(cwd) baseName + span(colorDot+label) + HoverTip(srcTitle) srcLabel }`
- **入口**: 自动加载（`useEffect` 零依赖，`loadRef` 承载）；数据经 `host.call('wf.bindings')` + `host.call('wf.registry')` + `workspaces.list` + 对每个 cwd 调 `host.call('wf.selection')` 聚合
- **持久化键**: 无写（只读）。读到的三源：`wf.bindings`（显式绑定）`wf.registry`（可用后端与配色）`wf.selection`（三级联选择结果 `source in {explicit,matches,fallback}`）与 `localStorage dsws.selectionByCwd`（见 `store.js:155-167`）
- **文案**: 固定中文 `"工作区后端总览 / 各工作区的 Tracker 后端绑定总览（只读，显式覆盖在右侧面板完成）"`（未走 `tr`）；summary 中 `"共 N 个工作区 / 已绑定 M"` 与按钮 `"刷新"` + tip `tr('tip.refreshWs')` + `"点击展开/收起"`
- **交互**: `details/summary` 原生折叠；刷新按钮阻止冒泡后重调 `loadRef.current()` 并 `flash` 提示；行内 HoverTip 显示完整 cwd 与 source 说明（`explicit→显式：…已写入 byHandle` `matches→自动：…自动命中` `fallback→未指定：…回退 Other`）
- **样式**: 组外同 `dsws-cfg-group`；details 内联 `border #2a2d35 radius8 bg rgba(255,255,255,.02)`；行 `borderBottom #2a2d35`；色点 `7px 圆 dot bg=backendColorOf`；badge `10px border 1px radius4`；summary `11px 600` + 已绑定计数 `#4ade80 / #8b8b95`
- **门禁覆盖**: 无专用视觉门禁；行为靠 `host.call` 的空值兜底（`try/catch` 静默）覆盖，未纳入 `verify-config-scroll.html`

### 块 5 — 面板宽度重置

- **功能**: 清掉拖拽记忆，让下次打开回到 layout 默认宽度
- **DOM**: `SettingsPage.js:263-278` `div.dsws-cfg-group > gtitle(refresh)+gdesc+row(button+note)`
- **文案**: `locale.js:346-348` `cfg.panelWidth/resetPanelWidth/resetPanelWidthDesc + toast.resetPanelWidthDone/Fail`（中文 `"面板宽度 / 重置面板宽度 / 下次打开面板时使用 layout 服务默认宽度（清掉上次的拖拽记忆）"`）
- **持久化键**: 无 localStorage；调用宿主侧 `ctx.get('layout').resetDetails()`（若缺则 `warn` 提示）
- **交互**: `button.dsws-cfg-btn.onClick` 尝试 `ls.resetDetails()`，成功 `ok #4ade80` 失败 `warn #fbbf24`，2800ms 后自清（`timer.timeout`）
- **样式**: 同组样式；按钮为 `dsws-cfg-btn{transparent border #2a2d35 radius7 11.5px pad 3 10}`；提示为行内 `11px`
- **门禁覆盖**: 无；依赖宿主 layout 服务是否存在（build 时不校验）

### 块 6 — 开始模板（执行）

- **功能**: 编辑 `execute` 动作（`/wayfinder`）的注入提示词；留空回退内置默认
- **DOM**: `SettingsPage.js:281-296` `div#dsws-cfg-exec-group.dsws-cfg-group > gtitle(play)+gdesc+row(switch)+textarea+chips+preview`；锚点 `id='dsws-cfg-exec-group'` 供块 7 的 `"→"` 跳转
- **持久化键**: `TPL_KEY='dsws.templates'`（`config.js:29`）中的 `execute` 字段；开关 `withWayfinder` 存于 `CFG_KEY='dsws.cfg'`
- **文案**: `locale.js:349-351` `cfg.startTpl/startTplDesc/withPrefix`（中文 `"开始模板（执行动作）/ 「执行」按钮注入的提示词；留空使用默认模板。/ 带 /wayfinder 前缀"`）；chips 文案 `cfg.chipReq/chipInsert/must`；预览标签 `cfg.preview`；错误 `tpl.missing/unknown` 与保存 `cfg.saveRejected`
- **交互**: `textarea.dsws-cfg-ta`（`autoGrowTa` 自适应，`onChange` 即时 `setTpl` + 调高）；chips `{number,url,title}` 点击在光标处插入 `{name}`（`insertPh` 读 `selectionStart/End`）；右侧 `"恢复默认"` 清空即回退 `TPL_DEFAULT.execute()`；预览区实时 `renderTemplate('execute', PREVIEW_VALUES)`（ `PREVIEW_VALUES={url:'…/365', number:'365', title: tr('cfg.previewTitle'), ts:'20260814-172113', file:'20260814-172113.md'}`）；开关 `checkbox withWayfinder` 即时改 `wf` state（保存时才落盘）
- **样式**: `styles.js:272-276` `.dsws-cfg-ta{100% min-height56 bg #16181d border #2a2d35 radius8 12px code font}` `:focus border rgba(192,132,252,.6)`；`.dsws-cfg-chips{flex wrap gap6 m6 0}` `.dsws-cfg-chip{inline-flex gap4 pad2 10 radius99 11px code bg rgba(188,140,255,.18)}` `.req{bg rgba(248,113,113,.14) color #f87171}`；`.dsws-cfg-preview{dashed #3a3f4a radius8 bg #0c0e12 pad7 10 code}`
- **门禁覆盖**: `config.js:44-69` 的占位符校验（`validateTemplate`）在保存时调用；视觉样板中 textarea 与 preview 的排版由 `verify-config-scroll.html` 人眼覆盖

### 块 7 — 动作模板编辑器（6 卡 + 跳转）

- **功能**: 编辑除 `execute` 外的 6 个动作模板（诊断/修复/讨论/交接两击/沉淀），默认展开，可折叠
- **DOM**: `SettingsPage.js:299-306` `details.dsws-cfg-details.dsws-cfg-group[open true] > summary(note) + gdesc(execHint link) + 6×tplCard`；每卡 `div.dsws-cfg-card > head(name+spacer+恢复默认) + desc + chips + textarea + preview`
- **入口**: 与块 6 同页，卡片循环 `TPL_EDIT_IDS.map(tplCard)`
- **持久化键**: 同 `TPL_KEY` 中的 `diagnose/fix/discuss/handoff1/handoff2/fixate`（注意：`config.js:30` 的 `templates` 初始对象含 9 键 `diagnose/fix/discuss/research/prototype/execute/handoff1/handoff2/fixate`，但本块只渲染 6 键，见下文冗余 1）
- **文案**: `locale.js:352-374` `cfg.tplEditor/tplEditorDesc/execHint`（中文 `"动作模板编辑器 / 「执行」外的六个动作按钮注入的提示词…红色「必填」占位符删除后无法保存。"`）+ 指向块 6 的 `"「执行」模板在开始模板节编辑 →"`；每卡 `tpl.name.* / tpl.desc.*`（如 `诊断 / needs-triage 票的行级动作`）
- **交互**: 与块 6 同：chips 插入、textarea 自适应、预览实时渲染、单卡 `"恢复默认"` 清空；`execHint` 为 `javascript:void(0)` + `scrollIntoView({behavior:smooth, block:start})` 跳到 `#dsws-cfg-exec-group`；外层 `details/summary` 控制折叠
- **样式**: `styles.js:281-286` `.dsws-cfg-card{border #2a2d35 radius12 bg #16181d pad12 14 mb10}` `.dsws-cfg-card-head{flex gap8}` `.dsws-cfg-card-name{13px 650}` `.dsws-cfg-card-desc{11.5px #8b8b95}`
- **门禁覆盖**: 6 卡的必填占位符由 `config.js:59-67` 的 `TPL_REQUIRED` 驱动，保存前 `validateAll` 校验并在块 8 展示错误；单卡数量未纳入 build 门禁（见冗余 1）

### 块 8 — 保存栏（含校验错误与即时提示）

- **功能**: 汇总保存全部模板与开关，展示校验失败原因，提供一键恢复默认
- **DOM**: `SettingsPage.js:307-317` `errs.length ? div.dsws-cfg-err > t(alert+saveRejected) + errs.map( · message) : null` + `div{flex gap10 alignSelf flex-end} > button.dsws-cfg-btn(恢复全部默认) + button.dsws-cfg-save(保存全部)`；页顶另有 `sharedSt.notice` 的 `div.dsws-note{position absolute left14 top10}` 与块 3/5 的行内 note（`openInNote #4ade80` / `resetNote #4ade80/#fbbf24`）
- **持久化键**: 点击保存时 `SettingsPage.js:120-126` `validateAll(custom) → setErrs 或 cfg.openIn/wf + templates.* → saveCfg()+saveTemplates()+broadcastCfg()`；恢复全部默认 `resetAll` 将 `templates` 6 键与 `execute` 清空并 `wf=true`（不落盘，待下一次保存）
- **文案**: `locale.js:355-358` `cfg.saveRejected/saveAll/resetAll/reset`（中文 `"保存被拒绝 / 保存全部 / 恢复全部默认 / 恢复默认"`）；成功后 `saved=true → tr('cfg.saved')` 2000ms 回落；错误拼接 `'「'+tr('tpl.name.'+id)+'」'+bits`，bits 来自 `tr('tpl.missing', {list:'{x}、{y}'}) / tr('tpl.unknown')`
- **交互**: 保存前校验全部 7 个模板（`execute` + 6 卡，`SettingsPage.js:102-115`），缺必填或有未知占位符则拒存并展示错误；通过后写两把 key 并广播；恢复全部默认不自动保存，需再点保存
- **样式**: `styles.js:287-292` `.dsws-cfg-err{border rgba(248,113,113,.5) bg rgba(248,113,113,.1) radius10 pad10 12 12px #f87171}` `.dsws-cfg-save{alignSelf flex-end bg #c084fc #140a1e radius8 13px 650 pad8 28}` `.dsws-cfg-btn{transparent border #2a2d35 radius7 11.5px}`；toast `dsws-note{absolute left14 top10 bg #22252c border #2a2d35 12px}`（`styles.js:287 附近`）
- **门禁覆盖**: `verify-config-scroll.html` 样板验证纵向滚动与底部按钮可达性（见下文可优 3）；保存逻辑无自动化单测门禁（仅靠 `tests/verify-prompts.js` 对 `PROMPTS` 占位符契约的间接校验）

---

## 4 持久化键与迁移

| 键 | 文件 | 形态 | 初始值 | 迁移 |
| --- | --- | --- | --- | --- |
| `CFG_KEY='dsws.cfg'` | `config.js:9` | `JSON.stringify({withWayfinder, openIn})` | `withWayfinder:true`；`openIn` 按是否装 better-sidebar 默认为 `sidebar/dock`（`config.js:13-26`） | 若 `localStorage.dsws.startCfg` 存在则迁 `withWayfinder/custom→execute` 并删旧键（`config.js:39-52`） |
| `TPL_KEY='dsws.templates'` | `config.js:29` | `JSON.stringify({diagnose,fix,discuss,research,prototype,execute,handoff1,handoff2,fixate})` | 9 键全 `''`（空即回退 `TPL_DEFAULT`） | 同上 |
| `dsws.selectionByCwd` | `store.js:155-167` | per-cwd 后端选择记忆（非本面板写入，只读） | `{}` | 旧键按 `keyOf` 归一迁移 |
| `layout.resetDetails` | 宿主服务 | 拖拽宽度记忆 | 无本键 | 调用宿主服务清除 |

广播：`saveCfg/saveTemplates` 后由 `SettingsPage.js:40/123` 的 `broadcastCfg()` 同步所有会话 store（实现见 `store.js` 与 `src/client/index.js` 的 `storeSvc`，本页仅消费其结果经 `cx.storeSvc.useStore(sessionId)` 取 `sharedSt`）。

---

## 5 文案与占位符

- 顶栏与组标题全走 `tr('cfg.* / matte.*')`，双语字典在 `locale.js`（zh 336-374 与 en 725-763 一一对应，未翻译的后备读 zh 并做 `{name}` 替换）
- 动作模板占位符白名单 `PH=['url','number','title','ts','file','path']`（`config.js:57`）；每模板可用集 `TPL_PH` 与必填集 `TPL_REQUIRED`（`config.js:59-67`）；默认文本 `TPL_DEFAULT[id]=()=>promptText('tpl.'+id)`（`config.js:69-78`），真源在 `prompts.js:18-25` 的 `PROMPTS['tpl.*'].zh/en`
- 预览值 `PREVIEW_VALUES` 固定（`SettingsPage.js:7`）`{url:'…/365', number:'365', title: tr('cfg.previewTitle'), ts:'20260814-172113', file:'20260814-172113.md'}`

---

## 6 样式与布局

- 容器 `dsws-cfg{max-width:720px gap12}`，组 `dsws-cfg-group{border #2a2d35 radius12 bg #10131a pad10 14}`，标题 `gtitle{13px 650 gap7}`，说明 `gdesc{11.5px #8b8b95 1.65}`，段控 `cfg-seg{border #2a2d35 radius8 bg #16181d}`（`styles.js:252-292` 共 41 处 `dsws-cfg` 规则）
- 文本域 `dsws-cfg-ta{100% min-height56 bg #16181d border #2a2d35 radius8 code font; focus border rgba(192,132,252,.6)}`；chips `cfg-chip{99px pill 11px code; req 背景 #f87171}`；卡片 `cfg-card{border #2a2d35 radius12 bg #16181d pad12 14 mb10}`；错误 `cfg-err{border rgba(248,113,113,.5) bg .1 radius10}`；保存按钮 `cfg-save{bg #c084fc #140a1e radius8 13px 650}`
- 滚动样板 `tests/verify-config-scroll.html` 复刻上述样式，外层 `dsh-options{flex1 min-height0 overflow-y:auto pad 0 24 24}`，设计上支持长表单纵向滚动，但未设粘性底部（见可优 3）

---

## 7 门禁与构建

| 门禁 | 文件 | 覆盖块 |
| --- | --- | --- |
| 拼接三表 | `scripts/build.mjs:185-212` `KERNEL_MODULES 13 项 + LEAF_MODULES 28 项 + SHARED_SPLICE 5 项` | 全部 8 块（漏登记即抛 `[build] 缺 marker` 或 `未在 LEAF_MODULES 登记`） |
| 单声明 | `scripts/build.mjs:313` `gateSingleDeclaration('SettingsPage' 等)` | 块 1-8 的组件名（防重复声明） |
| 语法 | `scripts/build.mjs:304-310` `gatePrecheck/gateSyntax` | 全量（E2E 编译失败即阻） |
| 滚动样板 | `tests/verify-config-scroll.html` | 块 1/6/7 的纵向排版与溢出（人眼门禁，非自动化断言） |
| 占位符契约 | `tests/verify-prompts.js`（间接） | 块 6/7 的 `PROMPTS['tpl.*'].placeholders` 与 `PH/TPL_REQUIRED` 一致性 |

---

## 8 三处可疑冗余（初筛证据）

### 冗余 1 — 两套模板清单不一致：9 键落盘，6 键编辑

- **现象**: `config.js:30` `templates` 初始对象含 9 键（含 `research/prototype`），`TPL_PH/TPL_REQUIRED/TPL_DEFAULT` 亦为 8 键含这两项（`config.js:59-78`）；但 `SettingsPage.js:5` `TPL_EDIT_IDS=['diagnose','fix','discuss','handoff1','handoff2','fixate']` 仅 6 键，未包含 `research/prototype`，块 7 的 `TPL_EDIT_IDS.map(tplCard)` 因此永远不渲染这两条
- **证据**: `src/client/kernel/config.js:30` 行长 98 字符含 `research: ''`；`src/client/views/SettingsPage.js:5` 行长 68 字符无此两项；`locale.js:365/370-371` 却有 `tpl.name.research/prototype` 与 `tpl.desc.*` 的完整双语；`prompts.js:21-22` 有 `tpl.research/tpl.prototype` 的默认文本真源
- **影响**: 这两条模板已持久化但无编辑入口，成为死键；重置与校验也绕过它们（`validateAll` 遍历 `TPL_EDIT_IDS` 仅 6 项，`resetAll` 同）
- **处置建议**: 要么在块 7 补两卡，要么在 `config.js` 明确标记这两项已废弃并做迁移清理

### 冗余 2 — 打开位置双重保存路径

- **现象**: 块 3 的段控点击即走 `pickOpenIn → saveCfg + broadcastCfg + 2600ms 提示`（`SettingsPage.js:39-43`）；块 8 的保存全部亦含 `cfg.openIn/wf → saveCfg/broadcastCfg`（`SettingsPage.js:120-126`）。同一键有两条落盘路径，且即时路径已持久化，底部保存对 `openIn` 实为重复写
- **证据**: `SettingsPage.js:39` `saveCfg()` 出现两次，`grep saveCfg SettingsPage.js` 命中行 39 与 123；`broadcastCfg` 同理 40 与 123；用户改打开位置后再改模板，底部保存会再次覆盖同一 `openIn` 值
- **影响**: 功能正确但增加一次本地存储写与广播；新人易误以为底部保存是打开位置的唯一入口
- **处置建议**: 保留即时生效语义，在块 8 文案或块 3 提示中明确 `"打开位置已即时保存，无需再次点击保存"`（现已有 `cfg.openInHint`，可加强为常驻说明而非 2.6s 闪现）

### 冗余 3 — 通知双通道叠加

- **现象**: 页面同时使用两套提示：全局 `sharedSt.notice`（经 `store.js:566-568` `flash(st,msg,kind)` 2800ms 自清，渲染于页顶 `div.dsws-note{left14 top10}`）与局部 `openInNote/resetNote/saved` 三个 `useState`（分别 2600/2800/2000ms 自清，渲染于各自组内行内）。刷新后端总览亦走 `flash(sharedSt,'已刷新','ok')`，与行内 note 同屏出现
- **证据**: `SettingsPage.js:8-10` `useStore(sessionId)` 订阅；`SettingsPage.js:39/123/238/270` 四处混用；`styles.js` 中 `dsws-note{absolute left14 top10 bg #22252c}` 与块 3/5 的行内 `style:{fontSize11 color#4ade80}` 并存；同一动作可能出现两个 toast 堆叠
- **影响**: 视觉冗余，信息重复；全局 toast 绝对定位可能遮挡标题
- **处置建议**: 统一收敛为一种（建议保留行内提示用于即时反馈，全局仅用于跨页广播），或在文档中明确各自职责

---

## 9 三处可优体验（初筛证据）

### 可优 1 — 文本域无上限生长，长表单越写越长

- **现象**: `SettingsPage.js:143-146` `autoGrowTa(el){ el.style.height='auto'; el.style.height=(el.scrollHeight+2)+'px' }` 无 `maxHeight`，随内容线性增高；页面本身 `dsws-cfg{gap12}` + 6 卡各一 textarea + 1 个开始模板 textarea，共 7 个可无限增高的输入区
- **证据**: `SettingsPage.js:144-145` 两行；`styles.js:272` `.dsws-cfg-ta{min-height56}` 未设 `max-height/overflow`；`tests/verify-config-scroll.html` 的样板高度 `height:min(800px,100vh-48px)` 固定 800px，外层 `dsh-options{overflow-y:auto}` 说明预期是容器滚动而非无限撑高
- **建议**: 加 `max-height ~ 40vh` + `overflow-y:auto`，超限后域内滚动，避免整页被单个超长 prompt 撑到数屏

### 可优 2 — 后端总览长路径截断，hover 仍可能看不全

- **现象**: 行内只显示 `baseName`（末段），完整 cwd 藏于 `HoverTip maxWidth 220`；Windows 绝对路径常 80+ 字符，220px 仍会截断；行高 `minHeight28 + gap8` 偏紧，指点与复制不便
- **证据**: `SettingsPage.js:246-254` `base=cwd.split(/[\\/]/).pop()` 与 `HoverTip{content:cwd, maxWidth:220}`；行样式 `padding 7 8 borderBottom #2a2d35 whiteSpace nowrap overflow hidden`；样板中无该块的长路径用例
- **建议**: 超长路径改为两行或提供点击复制完整 cwd（复用块 2 的 `copyText`），HoverTip 宽度放宽到 360 或改 `mode='fixed'`，行高增至 32 并加复制按钮

### 可优 3 — 保存按钮不在视口，需滚到底部才可见

- **现象**: 保存栏位于页面最底部（`alignSelf flex-end`），7 个 textarea 纵向堆叠后总高度远超首屏；用户改完首个开始模板必须滚动数屏才能保存，无粘底或快捷保存
- **证据**: `SettingsPage.js:313-314` 按钮容器 `display:flex alignSelf flex-end`（非 `sticky`）；`tests/verify-config-scroll.html` 场景 `dsh-options{overflow-y:auto}` 明确长表单需滚动，标题 `修复后（v1.3.3）真实渲染验证` 说明滚动曾是已知问题域；块 3 的即时保存仅覆盖 `openIn`，模板仍依赖底栏
- **建议**: 底栏加 `position:sticky bottom 0 bg + borderTop` 保持始终可见，或在每卡右上角加单卡保存，或全局监听 `Ctrl+S` 快捷保存

---

## 10 追问与下一步

- 块 4 的文案未走 `tr`（硬编码中文），是否需补双语键并纳入 `verify-locale-completeness.js` 检查？
- 冗余 1 的 `research/prototype` 是否有意隐藏（仅作后端能力探测，不给人改）？若是，需在 `config.js` 注释中显式说明，避免后人误补卡片
- 三处可优是否纳入后续原型票，分别对应哪块的迭代？

---

## 11 文件追溯清单

- `src/client/views/SettingsPage.js` — 8 块真源（319 行）
- `src/client/kernel/config.js` — 持久化与校验（`CFG_KEY/TPL_KEY/TPL_PH/TPL_REQUIRED/TPL_DEFAULT/renderTemplate/validateTemplate`）
- `src/client/kernel/locale.js` — 文案（zh 333-374 / en 722-763；`cfg.* 28 键 / tpl.* 16 键 / matte.* 4 键`）
- `src/client/kernel/styles.js:252-292` — 样式 41 处
- `src/client/index.js:346-353` — 双入口注册
- `package/cordis.patch.yml` — 装配声明
- `scripts/build.mjs:185-313` — 拼接与门禁
- `tests/verify-config-scroll.html` — 滚动样板

> 本调研不改行为，仅画像；后续改动需另起任务票并走门禁。

