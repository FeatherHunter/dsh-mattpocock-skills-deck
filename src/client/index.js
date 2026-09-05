/**
 * dsh-mattpocock-skills-deck · Client 半（UX v25 · 2026-08-14 T2a 配置页骨架）
 *
 * v27 变更（#95 · 阶段 2 步骤 1 Ctx 接线）：src/client/kernel/ctx.js（createCx + DswsCtx，
 *   G3 冻结 8 字段 #91）经构建注入 apply 闭包顶部；插槽组件注册处包 DswsCtx.Provider（withCx）。
 *   不搬任何组件，行为零变化。
 *
 * v26 变更（#373 用户拍板 2026-08-14）：
 *   打开形式收敛为「仅右侧 details 列」——移除 Document PiP 独立小窗（Electron 不可用、
 *   曾致桌面卡死）、停靠/悬浮双模式记忆（PANEL_MODE_KEY）、状态栏「停靠」seg、右栏「悬浮」按钮；
 *   状态栏胶囊允许换行（窄栏不再截断）。
 *
 * v25 变更（map #364）：
 *   T2a：配置页骨架（settings.plugins.tab「MattSkillsDeck」+ 持久化 + 广播）；
 *   T2b：动作模板编辑器 + 占位符保护；
 *   T3（#366）：dsws locale 命名空间 zh/en 字典，全控件文字双语跟随 harness 语言（GitHub 数据不翻译）。
 *
 * v25 变更（map #364 · T2a）：
 *   50. 配置页骨架：settings.plugins.tab「MattSkillsDeck」注册（设置 → 插件可见）；
 *       三组既有配置迁入（面板默认高度三档 / 开始模板 / 外观）；
 *       配置持久化 dsws.cfg + dsws.templates（旧 dsws.startCfg 自动迁移）；
 *       保存后广播同步所有会话 store（修复外观/尺寸不持久化隐性 bug）；
 *       面板内 StartCfgModal 移除，Run 卡保留「打开配置」引导按钮。
 *
 * v24 变更（用户反馈）：
 *   48. 交接第二击文件名修复：记忆第一击模板的时间戳，第二击读同一个文件
 *       （模板写什么名就读什么名；不再因目录无文档而兜底旧 latest.md；未点第一击才回退查最新）
 *   49. 面板默认高度 1/4 → 1/2（用户反馈 1/4 太小）
 *
 * v23：面板默认高度 = 屏幕约 1/4。
 * v22：引导句「从第一性原理出发完成任务，并对抗式审查。」；交接第一击恢复注入时间戳模板；
 * 第二击预填优化+复制。
 * v21：动作按钮 prompt 精简 + 统一引导句。
 * v20：标签「+N」点击展开全部标签/收起。
 * v19：grilling→讨论 / 头部 repo 名 / 环境段末尾 / map 详情执行+任务动作 / map 行进度 /
 * 交接时间戳+查最新+复制。
 * v18：可接/占用列表口径 / 按钮去开始（诊断/执行/修复）/ 点击预填输入框。
 * v17：isLight 改 YIQ 感知亮度。v16：按钮色 = label 配置色。
 * v15：状态栏防换行自适应 / map 置顶 / 被阻塞标签 / 会话 cwd 改 SessionSummary.cwd。
 * v14：全部执行批次（三选一动作 / map 行突出 / 已关闭折叠 / chips 深边框 / 窄屏折叠 /
 * 刷新遮罩 / 主题安全色 / 交接按钮 / 状态栏等宽 / 按会话 store）。
 * v13：cwd 权威反查（wf.cwd）+ sessionId 变化重探测。v12：repoKey 按 cwd 缓存 /
 * 失败不兜假数据 / 三视图收敛 / 沉淀=注入快照模板。
 * v11：label 颜色 = GitHub 配置色。v10：cwd 关联 / 标签视图 / 圆形技能环。
 * v9：DESIGN.md §12.2 Round 3 定稿 1A-7A 落实。
 *
 * 本文件内容 = cordis_define 的 code.client（纯 JS 函数体，返回 Cordis Plugin）。
 */

// ===== 规范方言（dynamic dialect）：host/styles/React/timer 为自由变量；pkg entry 提供 shim =====
export default {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    // ==== leaf:hostShim (spliced by build) ====
    // ==== kernel:portal (spliced by build) ====
    // v1.3.3：面板版本号（tabs 行最右侧显示，便于核对已更新）
    const DSW_VERSION = __DSW_VERSION__
    // #repo-link：版本号可点，新窗打开插件仓库主页；URL 构建期从 package/package.json 的 repository 字段
    // 注入（客户端源码零 URL 字面量，过硬编码门禁 F2；产物字面量已在门禁 RE_LICENSED 登记）。
    const DSW_REPO_URL = __DSW_REPO_URL__

    // ============================================================
    // 0. 样式
    // ============================================================
    // ==== kernel:backendList (spliced by build) ====
    // ==== kernel:link (spliced by build) ====

    // ==== kernel:styles (spliced by build) ====
    styles.insert(STYLE_TEXT)

    // ============================================================
    // 0.5 locale（T3 #366 · dsws 命名空间 zh/en；跟随 harness 语言；GitHub 数据不翻译）
    // 契约：ctx.locale（dsh-client-locale）：register(ns, {zh, en}) + bind(ns) 稳定引用，调用时读当前语言；
    // 所有 outlet 在 locale 切换时自动重渲染（useLocaleRevision），模块级 t 即可生效。
    // v1.5：全部 prompt（GUIDE_LINE/MAP_EXECUTE/COMPLETE/FIXATE/TPL_DEFAULT/setup/newWayfinder/mapHead）
    //   集中为 L 字典 prompt.*（zh/en 双语跟随 DSH 语言），审阅与优化见 docs/prompts-review.md。
    // ============================================================
    // ==== kernel:localePanel (spliced by build) ====
    // ==== kernel:localeFlow (spliced by build) ====
    // ==== kernel:localeWord (spliced by build) ====
    // ==== kernel:locale (spliced by build) ====
    const localeSvc = ctx.get('locale')
    if (localeSvc && typeof localeSvc.register === 'function') {
      ctx.effect(function () {
        return localeSvc.register('dsws', L)
      }, 'dsws: locale')
    }
    // tr：locale 绑定（稳定引用，调用时读当前语言；命名 tr 避免与票务参数 t 冲突）；服务缺失时退化 zh 字典（与 locale 同语义：{name} 参数替换）
    const tr = (localeSvc && typeof localeSvc.bind === 'function')
      ? localeSvc.bind('dsws')
      : function (key, params) {
          let s = (L.zh[key] !== undefined) ? L.zh[key] : key
          if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return name in params ? String(params[name]) : m })
          return s
        }

    // ============================================================
    // 1. 技能目录 + 场景推荐映射
    // ============================================================
    // T3：描述在渲染时 tr('skilldesc.<name>')（此处 use 字段为中文静态参考）
    // ==== shared:mattSkills (spliced by build) ====
    // #fix-banner：动态占位供 installSkills prompt 使用；probeList/probeCount 由 SKILLS 派生（与 host MATT_SKILL_PROBE_NAMES 同源）
    const installSkillsParams = function () {
      const names = (Array.isArray(SKILLS) ? SKILLS : []).map(function (s) { return s && s.name }).filter(Boolean)
      return { probeList: names.join(' / '), probeCount: String(names.length) }
    }
    const TYPE_SKILLS = {
      research: ['research'],
      prototype: ['prototype'],
      grilling: ['grilling', 'domain-modeling'],
      task: ['implement'],
    }
    const TYPE_LABEL = {
      research: ['research', 'r', '研究'],
      prototype: ['prototype', 'p', '原型'],
      grilling: ['grilling', 'g', '对齐'],
      task: ['task', 't', '任务'],
      map: ['map', 'm', '地图'],
    }
    const TYPE_ICON = { research: 'search', prototype: 'hammer', grilling: 'chat', task: 'gear', map: 'map' }

    // ============================================================
    // 2. 外观方案（图标 + 动作词，可切换）
    // ============================================================
    // ==== shared:namingTitles (spliced by build) ==== // ==== shared:namingTracking (spliced by build) ==== // ==== shared:namingAttribution (spliced by build) ====
    // ==== shared:trackerSync (spliced by build) ====
    // ==== shared:slots (spliced by build) ====
    // ==== kernel:icons (spliced by build) ====

    // ============================================================
    // 2.5 配置模型（v25 · T2a：dsws.cfg + dsws.templates；旧 dsws.startCfg 自动迁移）
    // 必须位于 §3 store 之前（DEFAULT_PANEL_H 固定 1/2）
    // ============================================================
    // ============================================================
    // §prompts：prompt 注册表（内容层 · 独立于 UI 文案 i18n）—— 方案 A
    //   每条：{ version, placeholders, use, zh, en }；运行时按当前语言经 promptText(id, params) 取用
    //   占位符契约：文本内 {x} 必须声明在 placeholders；promptText 只替换已声明参数（未知保留）
    //   原则：所有 prompt 相对所引用技能（wayfinder/grilling/triage 等）只做「追加扩展要求」，绝不覆盖技能自身规则。
    //   审阅：docs/reviews/prompts-review-v1.5.html / .md · 契约校验：tests/verify-prompts.js
    // ============================================================
    // ==== kernel:prompts (spliced by build) ====
    // ==== kernel:config (spliced by build) ====
    // ==== kernel:log (spliced by build) ====

    // ============================================================
    // 3. store（v14：按会话隔离；无 sid 时用 shared）
    // ============================================================
    // v24-48：面板默认高度 = 屏幕约 1/2
    // v1.5 T3：面板默认高度固定 1/2（用户拍板彻底移除 panelHeight 配置 —— details 列高度与它无关，配置不生效）
    // ==== shared:workspaceKey (spliced by build) ====
    // ==== kernel:storePrefs (spliced by build) ====
    // ==== kernel:storeSwitch (spliced by build) ====
    // ==== kernel:storeSnapshot (spliced by build) ====
    // ==== kernel:storeDerived (spliced by build) ====

    // ---- 环境检查链（#228/#284 · host.call('wf.chain')；通用链 + 后端链全链快照）----
    // #284：九格目录视图（wf.status/checks）退役，读数点位全部改从链快照派生
    // ==== kernel:probeChain (spliced by build) ====
    // ==== kernel:probeSnapshot (spliced by build) ====
    // ==== kernel:probeAuto (spliced by build) ====
    // 打开形式（#373 用户拍板 2026-08-14）：仅右侧 details 列（停靠）一种形式。
    //   已移除：① Document PiP 独立小窗（Electron 无法创建 PiP 窗口、曾致桌面卡死 —— 代码不再含 pip 形态）；
    //   ② 停靠/悬浮双模式记忆（PANEL_MODE_KEY）；③ 状态栏「停靠」seg 与右栏「悬浮」按钮。
    //   打开一律走 layout.openDetails()；layout 服务不可用时退回页内悬浮面板（仅兜底，无任何入口按钮）。
    // ==== kernel:router (spliced by build) ====

    // v10：沉淀 = 会话级动作 —— 注入「零丢失快照」prompt（默认文本见 §2.5 FIXATE_PROMPT，T2b 可编辑）
    // ==== kernel:apiNaming (spliced by build) ====
    // ==== kernel:apiPresetGuard (spliced by build) ====
    // ==== kernel:apiNewSession (spliced by build) ====
    // ==== kernel:apiIo (spliced by build) ====

    // ==== kernel:actions (spliced by build) ====
    // ==== kernel:slots (spliced by build) ====
    // ==== kernel:slotRendererQueue (spliced by build) ====
    // ==== kernel:slotRendererRepoSync (spliced by build) ====
    // ==== kernel:slotRendererModalView (spliced by build) ====

    // ==== leaf:chips (spliced by build) ====
    // ==== leaf:hoverTip (spliced by build) ====
    // ==== leaf:tip (spliced by build) ====
    // ==== leaf:backendSelector (spliced by build) ====
    // ==== leaf:switchConfirmModal (spliced by build) ====

    // ==== leaf:seg (spliced by build) ====
    // ==== leaf:checksums (spliced by build) ====
    // ==== leaf:chainRenderer (spliced by build) ====
    // ==== leaf:skillFloatList (spliced by build) ====
    // ==== leaf:tabs (spliced by build) ====

    // ==== leaf:StatusMenus (spliced by build) ==== // ==== leaf:StatusBackend (spliced by build) ==== // ==== leaf:StatusLogMenu (spliced by build) ==== // ==== leaf:statusBar (spliced by build) ====

    // ==== leaf:md (spliced by build) ====
    // ==== leaf:ticket (spliced by build) ====

    // ==== leaf:ticketRow (spliced by build) ====

    // ==== leaf:mapDetail (spliced by build) ====

    // ==== leaf:IssueDetailComments (spliced by build) ==== // ==== leaf:IssueDetail (spliced by build) ====

    // ==== leaf:tagsFit (spliced by build) ====
    // ==== leaf:pop (spliced by build) ====
    // ==== leaf:noRepoCard (spliced by build) ====
    // ==== leaf:ListTabRow (spliced by build) ==== // ==== leaf:listTab (spliced by build) ====

    // ==== leaf:ringSkills (spliced by build) ====

    // ==== leaf:skillsTab (spliced by build) ====

    // ==== leaf:checksTab (spliced by build) ====

    const TABS_FOLD_HYST = 4
    const TABS_LEVELS = 3
    const tabsLevelDecide = function (level, avail, nats) {
      if (!Array.isArray(nats) || !nats.length) return 0
      let cur = level < 0 ? 0 : level
      while (cur < nats.length - 1 && nats[cur] > avail + 1) cur++
      while (cur > 0 && avail >= nats[cur - 1] + TABS_FOLD_HYST) cur--
      return cur
    }
    // issue#15 修复：scrollWidth 会被容器宽度钳制（容器宽于内容时 scrollWidth===clientWidth），
    // 导致折叠后展开判定 avail>=nats[cur-1]+4 永不成立（死锁）。改测内容 children 的真实横跨宽。
    const measureContentWidth = function (t) {
      if (!t || !t.children || t.children.length === 0) return 0
      const tr = t.getBoundingClientRect()
      let minX = Infinity, maxX = -Infinity
      for (let i = 0; i < t.children.length; i++) {
        const c = t.children[i]
        const r = c.getBoundingClientRect()
        if (r.width > 0) { if (r.x < minX) minX = r.x; if (r.x + r.width > maxX) maxX = r.x + r.width }
      }
      if (minX === Infinity) return 0
      return maxX - tr.x
    }
    // ==== leaf:namingFailBanner (spliced by build) ====

    // ==== leaf:DockSync (spliced by build) ==== // ==== leaf:dock (spliced by build) ====

    // ==== leaf:OverlayGate (spliced by build) ==== // ==== leaf:overlay (spliced by build) ====

    // ==== leaf:SettingsWorkspaces (spliced by build) ==== // ==== leaf:settingsPage (spliced by build) ====

    // ==== leaf:runPanel (spliced by build) ====

    // ==== leaf:panelAssembly (spliced by build) ====
  },
}