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
 *   T2a：配置页骨架（settings.plugins.tab「Waystation」+ 持久化 + 广播）；
 *   T2b：动作模板编辑器 + 占位符保护；
 *   T3（#366）：dsws locale 命名空间 zh/en 字典，全控件文字双语跟随 harness 语言（GitHub 数据不翻译）。
 *
 * v25 变更（map #364 · T2a）：
 *   50. 配置页骨架：settings.plugins.tab「Waystation」注册（设置 → 插件可见）；
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
    const timer = ctx.get('timer')
    const h = React.createElement
    // issue #3：浮层挂顶层 —— createPortal 到 document.body，让 position:fixed 的视口坐标与
    //   z-index 真正全局生效。宿主输入区祖先若带 transform / filter / backdrop-filter /
    //   will-change / contain，fixed 的包含块会降级为该祖先（坐标偏移 + 被 overflow 裁剪），
    //   这正是技能 tooltip 被遮挡/截断的根因。取不到 react-dom 时退化为原地渲染（不劣于现状）。
    const RDOM = (function () {
      try { if (typeof ReactDOM !== 'undefined' && ReactDOM && ReactDOM.createPortal) return ReactDOM } catch (e) { /* noop */ }
      try { if (typeof window !== 'undefined' && window.ReactDOM && window.ReactDOM.createPortal) return window.ReactDOM } catch (e) { /* noop */ }
      try { if (typeof require === 'function') { const m = require('react-dom'); if (m && m.createPortal) return m } } catch (e) { /* noop */ }
      return null
    })()
    const portalTop = function (node) {
      if (RDOM && typeof document !== 'undefined' && document.body) return RDOM.createPortal(node, document.body)
      return node
    }
    // v1.3.3：面板版本号（tabs 行最右侧显示，便于核对已更新）
    // issue #22：交互弹层统一挂到 body，避免被状态栏布局 wrapper 裁剪。
    const PortalOverlay = function (props, children) {
      return portalTop(h('div', props || {}, children))
    }
    const DSW_VERSION = __DSW_VERSION__

    // ============================================================
    // 0. 样式
    // ============================================================
    // ==== kernel:styles (spliced by build) ====
    styles.insert(STYLE_TEXT)

    // ============================================================
    // 0.5 locale（T3 #366 · dsws 命名空间 zh/en；跟随 harness 语言；GitHub 数据不翻译）
    // 契约：ctx.locale（dsh-client-locale）：register(ns, {zh, en}) + bind(ns) 稳定引用，调用时读当前语言；
    // 所有 outlet 在 locale 切换时自动重渲染（useLocaleRevision），模块级 t 即可生效。
    // v1.5：全部 prompt（GUIDE_LINE/MAP_EXECUTE/COMPLETE/FIXATE/TPL_DEFAULT/setup/newWayfinder/mapHead）
    //   集中为 L 字典 prompt.*（zh/en 双语跟随 DSH 语言），审阅与优化见 docs/prompts-review.md。
    // ============================================================
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
    const SKILLS = [
      { name: 'ask-matt', level: 'warn', use: '技能路由器：不知道该用哪个 skill 时问它' },
      { name: 'setup-matt-pocock-skills', level: 'ok', use: '仓库初始化：issue tracker / 标签 / 文档路径' },
      { name: 'wayfinder', level: 'warn', use: '巨型项目决策地图（本插件服务的对象）' },
      { name: 'triage', level: 'ok', use: 'issue 状态机流转：categorise→verify→grill' },
      { name: 'grilling', level: 'ok', use: '穷追不舍的对齐提问（设计树）' },
      { name: 'domain-modeling', level: 'ok', use: '领域术语与统一语言' },
      { name: 'research', level: 'ok', use: '后台调研，写进 repo 内 markdown 并引源' },
      { name: 'prototype', level: 'ok', use: '一次性原型回答设计问题' },
      { name: 'implement', level: 'warn', use: '把规格落成代码（task 型 ticket）' },
      { name: 'code-review', level: 'ok', use: '按标准 + 规格双轴审查改动' },
      { name: 'codebase-design', level: 'ok', use: '深模块设计词汇' },
      { name: 'diagnosing-bugs', level: 'ok', use: '硬 bug 与性能回归诊断循环' },
      { name: 'improve-codebase-architecture', level: 'ok', use: '扫 deepening opportunities 出 HTML 报告' },
      { name: 'tdd', level: 'ok', use: '红-绿-重构' },
      { name: 'handoff', level: 'warn', use: '把当前对话压缩成交接文档' },
      { name: 'teach', level: 'ok', use: '跨 session 教你新技能' },
      { name: 'to-spec', level: 'warn', use: '把讨论固化成规格' },
      { name: 'to-tickets', level: 'warn', use: '把规格拆成 tickets' },
      { name: 'resolving-merge-conflicts', level: 'ok', use: '解决合并冲突' },
      { name: 'writing-great-skills', level: 'warn', use: '写出优秀技能' },
    ]
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
    }
    const TYPE_ICON = { research: 'search', prototype: 'hammer', grilling: 'chat', task: 'gear' }

    // ============================================================
    // 2. 外观方案（图标 + 动作词，可切换）
    // ============================================================
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
    //   审阅：docs/prompts-review.html / .md · 契约校验：tests/verify-prompts.js
    // ============================================================
    // ==== kernel:prompts (spliced by build) ====
    // ==== kernel:config (spliced by build) ====

    // ============================================================
    // 3. store（v14：按会话隔离；无 sid 时用 shared）
    // ============================================================
    // v24-48：面板默认高度 = 屏幕约 1/2
    // v1.5 T3：面板默认高度固定 1/2（用户拍板彻底移除 panelHeight 配置 —— details 列高度与它无关，配置不生效）
    // ==== kernel:store (spliced by build) ====

    // ---- 环境检查（#344 · host.call('wf.status')；host 侧 30s 缓存 / force 重查）----
    // v12：失败不再兜假数据 —— 非 real 状态一律视为未知（--/8），不展示假绿点
    // ==== kernel:probe (spliced by build) ====
    // 打开形式（#373 用户拍板 2026-08-14）：仅右侧 details 列（停靠）一种形式。
    //   已移除：① Document PiP 独立小窗（Electron 无法创建 PiP 窗口、曾致桌面卡死 —— 代码不再含 pip 形态）；
    //   ② 停靠/悬浮双模式记忆（PANEL_MODE_KEY）；③ 状态栏「停靠」seg 与右栏「悬浮」按钮。
    //   打开一律走 layout.openDetails()；layout 服务不可用时退回页内悬浮面板（仅兜底，无任何入口按钮）。
    // ==== kernel:router (spliced by build) ====

    // v10：沉淀 = 会话级动作 —— 注入「零丢失快照」prompt（默认文本见 §2.5 FIXATE_PROMPT，T2b 可编辑）
    // ==== kernel:api (spliced by build) ====

    // ============================================================
    // 5. 组件
    // ============================================================
    const Dot = ({ level }) => h('span', { className: 'dsws-dot', style: { background: level === 'ok' ? '#4ade80' : level === 'warn' ? '#f59e0b' : level === 'bad' ? '#f87171' : '#52525b' } })
    const TypeChip = ({ type }) => {
      const t = TYPE_LABEL[type] || [type, '', type]
      const cls = { research: 'dsws-chip-r', prototype: 'dsws-chip-p', grilling: 'dsws-chip-g', task: 'dsws-chip-t' }[type] || ''
      return h('span', { className: 'dsws-chip ' + cls }, [
        Ic({ n: TYPE_ICON[type] || 'dot', size: 11 }),
        h('span', null, tr('type.' + type)),
      ])
    }

    // ---- 5.2 输入区状态栏（定稿 1A 居中胶囊 · 反馈不进状态栏 · cwd 关联 · v14 数字区等宽 + 交接段）----
    const StatusBar = (props) => {
      const sid = props && props.sessionId
      const s = useStore(sid)
      // v15-27：宿主权威 cwd —— SessionSummary.cwd（会话列表工作区标题同源），替换字段名猜测链
      const summaryCwd = props.useSessions(function (x) {
        return (sid && x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined
      })
      // v14-20 → r3：跨会话预填（交接开新会话后，新 dock 挂载即消费）。
      // issue #12 BUG4 r3 终极修复（最简形式）：
      //   关键改动：effect deps 从 [props] 改为 [props.sessionId]。
      //   旧实现 [props] 依赖会因 ws.startSession 触发父级重渲染 → 当前会话的 props 引用变 → 当前会话 effect 重跑 → 抢先消费 pendingDraft。
      //   新实现 [props.sessionId] 只在 sid 变化时跑（即每个会话只在初次 mount 跑一次），
      //     · 当前会话：sid 长期不变 → effect 不重跑 → 不抢先消费
      //     · 新会话：sid 初次设置 → effect 跑一次 → 消费 pendingDraft
      //   consumedDraftRef 守卫保留作为 belt-and-suspenders：即使组件 remount（同 sid 字符串），
      //     ref 仍能防止 effect 重入。
      // r4：consumedDraftRef 按 sid 存储 + pendingDraftTargetSid 锚定新会话，防止 boolean 常驻阻断后续注入
      const consumedDraftRef = React.useRef(null)
      // 注入器常驻：只要 inputActions 就位就挂到 s.injector（不依赖 pendingDraft）
      React.useEffect(function () {
        if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
          s.injector = props.inputActions.setDraft
        }
      }, [props.sessionId, props.inputActions])
      React.useEffect(function () {
        if (!props || !props.sessionId) return
        if (consumedDraftRef.current === props.sessionId) return
        if (!props.inputActions || typeof props.inputActions.setDraft !== 'function') return
        s.injector = props.inputActions.setDraft
        if (pendingDraft) {
          // 若有目标 sid 锚定，则仅目标会话消费；无锚定（handoff 兼容）则任意新会话可消费
          if (pendingDraftTargetSid && pendingDraftTargetSid !== props.sessionId) return
          consumedDraftRef.current = props.sessionId
          const text = pendingDraft
          pendingDraft = null
          pendingDraftTargetSid = null
          props.inputActions.setDraft(text)
        }
      }, [props.sessionId, props.inputActions])
      React.useEffect(function () {
        probeHandoffReady(s)  // 需求1·二阶段 rev：挂载即探测 .scratch/handoff/，以真实文档有无决定右半灰/亮
        ensureIssuePath(s); startIssuePathPoll(s)
      }, [])
      // v13：会话工作目录探测 —— 依赖 sessionId 变化重跑（切换对话必触发）。
      // v15-27：优先 SessionSummary.cwd（宿主权威）；次选 props.session 直取；最后 host wf.cwd 兜底。
      // cwd 变化后主动重拉快照与检查（否则面板/状态栏仍显示旧仓库数据）。
      React.useEffect(function () {
        const apply = function (cwd) {
          if (cwd && cwd !== s.cwd) {
            s.cwd = cwd
            // #58 缓存优先：同步水合 per-cwd 内存快照，秒开
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChecks(s, false)
            // #58 已水合且新鲜则无需再 load，保持秒开；过期则后台静默刷新
            if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
          }
        }
        if (summaryCwd) { apply(summaryCwd); return }
        const cwd0 = detectCwd(props && props.session)
        if (cwd0) { apply(cwd0); return }
        if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.cwd', { sessionId: sid }).then(function (res) {
            if (res && res.ok && res.cwd) apply(res.cwd)
          }).catch(function () { /* 保持现有 cwd */ })
        }
      }, [sid, summaryCwd])
      // v1.5：挂载时新鲜数据（≤60s，含新会话继承的快照）跳过重载，避免冷缓存全量重建卡顿
      React.useEffect(function () { loadChecks(s, false); if (!snapFresh(s)) loadSnapshot(s, false) }, [])
      // v18-30：可接/占用 = 列表 open issue 口径（与面板列表一致）
      const fr = frontierCount(s)
      const bugN = bugCount(s)
      const triageN = triageCount(s)
      const n = readyCount(s)
      const timeStr = timeOf(s.snapshot) || (s.checksUpdatedAt ? s.checksUpdatedAt.slice(5, 16) : '') || '-- --:--'
      const setup = setupCheck(s)
      const amber = s.checksMode === 'real' && setup && setup.level !== 'ok'
      // v1.5 T11：核心技能套件检测（检查 9）
      const skillsCheck = (s.checks || []).find(function (c) { return c.id === 9 })
      const skillsBad = s.checksMode === 'real' && skillsCheck && skillsCheck.level !== 'ok'
      // v1.5 引导依赖链（用户拍板 2026-08-17）：gh CLI → gh 登录 → setup → 技能 —— banner 显示依赖链上第一个缺失项
      const ghCliCheck = (s.checks || []).find(function (c) { return c.id === 4 })
      const ghAuthCheck = (s.checks || []).find(function (c) { return c.id === 5 })
      const ghCliBad = s.checksMode === 'real' && ghCliCheck && ghCliCheck.level !== 'ok'
      const ghAuthBad = s.checksMode === 'real' && ghAuthCheck && ghAuthCheck.level !== 'ok'
      const go = function (tab) { s.tab = tab; openPanel(s) }
      // v14-22：数字区固定两位数等宽（环境 5ch 容 '98/99'；可接/占用 2ch）
      const num = (txt, minW) => h('span', { className: 'dsws-num', style: minW ? { minWidth: minW } : null }, txt)
      const seg = (icon, label, color, onGo, title) => h('span', { className: 'dsws-seg', onClick: function (e) { e.stopPropagation(); onGo() }, title: title || '', style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: color } }, [
        Ic({ n: icon, size: 12 }),
        label,
      ])
      // #16 V2（2026-08-18 复现后重设计）：dn/dw 阈值体系废弃——dn 信号源 R5 起改为输入区（wrapper）宽，
      //   默认 1280 视口下输入区仅 812px，dn=0 永不出现 → 宽屏默认缺品牌字。
      //   改为内容自适应渐进收缩（仿 #15 tabs）：applyFold 全展开后按 data-fold-priority 升序
      //   逐个折叠文字 span（.dsws-folded → display:none），直到 scrollWidth ≤ clientWidth。
      //   优先级 = 信息价值：品牌(1) → 沉淀(2)/交接(3)/刷新字(4) → 可接(5)/BUG(6)/诊断(7)/环境(8) → 时间(9)。
      //   折叠由 React 外部 DOM class 驱动（React 重渲染时 className prop 不变 → classList 手动变化保留）。
      const inputRef = React.useRef(null)
      const foldRef = React.useRef(null)
      const bugAnchorRef = React.useRef(null)
      const skillAnchorRef = React.useRef(null)
      const bugCloseRef = React.useRef(null)
      const skillCloseRef = React.useRef(null)
      const issuePathAnchorRef = React.useRef(null)
      const issuePathCloseRef = React.useRef(null)
      const [iw, setIw] = React.useState(780)
      // issue #22：布局 wrapper 保持裁剪职责；浮层位置以锚点 viewport rect 表示。
      const placeOverlay = function (el, align) {
        if (!el || typeof window === 'undefined') return null
        const r = el.getBoundingClientRect()
        if (!r || (!r.width && !r.height)) return null
        const p = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
        if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
        else p.left = Math.max(0, Math.round(r.left))
        return p
      }
      const placeBugMenu = function () {
        const p = placeOverlay(bugAnchorRef.current, 'left')
        if (!p) return false
        const old = s.bugMenuPos
        if (old && old.left === p.left && old.bottom === p.bottom) return false
        s.bugMenuPos = p
        return true
      }
      const placeSkillPop = function () {
        const p = placeOverlay(skillAnchorRef.current, 'right')
        if (!p) return false
        const old = s.skillPopPos
        if (old && old.right === p.right && old.bottom === p.bottom) return false
        s.skillPopPos = p
        return true
      }
      const placeIssuePathPop = function () {
        const p = placeOverlay(issuePathAnchorRef.current, 'left')
        if (!p) return false
        const old = s.issuePathPos
        if (old && old.left === p.left && old.bottom === p.bottom) return false
        s.issuePathPos = p
        return true
      }
      const clearClose = function (ref) {
        if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
      }
      const closeBugMenu = function () {
        clearClose(bugCloseRef)
        if (!s.bugMenuOpen && !s.bugMenuPos && !s.bugMenuHover) return
        s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; emit(s)
      }
      const closeSkillPop = function () {
        clearClose(skillCloseRef)
        if (!s.skillsOpen && !s.skillPopPos && !s.skillHover && !s.skillTip) return
        s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; emit(s)
      }
      const closeIssuePath = function () {
        clearClose(issuePathCloseRef)
        if (!s.issuePathHover && !s.issuePathPos) return
        s.issuePathHover = false; s.issuePathPos = null; emit(s)
      }
      const scheduleClose = function (ref, fn) {
        clearClose(ref)
        ref.current = setTimeout(function () { ref.current = null; fn() }, 160)
      }
      const showBugMenu = function () {
        clearClose(bugCloseRef); clearClose(skillCloseRef)
        let changed = false
        if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
        if (!s.bugMenuOpen) { s.bugMenuOpen = true; changed = true }
        if (placeBugMenu()) changed = true
        if (changed) emit(s)
      }
      const showSkillPop = function () {
        clearClose(skillCloseRef); clearClose(bugCloseRef); clearClose(issuePathCloseRef)
        let changed = false
        if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
        if (s.issuePathHover || s.issuePathPos) { s.issuePathHover = false; s.issuePathPos = null; changed = true }
        if (!s.skillsOpen) { s.skillsOpen = true; changed = true }
        if (placeSkillPop()) changed = true
        if (changed) emit(s)
      }
      const showIssuePath = function () {
        clearClose(issuePathCloseRef); clearClose(bugCloseRef); clearClose(skillCloseRef)
        let changed = false
        if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
        if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
        if (!s.issuePathHover) { s.issuePathHover = true; changed = true }
        if (placeIssuePathPop()) changed = true
        if (changed) emit(s)
      }
      React.useEffect(function () {
        if (!s.bugMenuOpen && !s.skillsOpen && !s.issuePathHover) return undefined
        let raf = null
        let disposed = false
        const reposition = function () {
          if (disposed || raf !== null) return
          const run = function () {
            raf = null
            if (disposed) return
            let changed = false
            if (s.bugMenuOpen && placeBugMenu()) changed = true
            if (s.skillsOpen && placeSkillPop()) changed = true
            if (s.issuePathHover && placeIssuePathPop()) changed = true
            if (changed) emit(s)
          }
          if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(run)
          else raf = setTimeout(run, 0)
        }
        document.addEventListener('scroll', reposition, { capture: true, passive: true })
        window.addEventListener('resize', reposition)
        const ro = new ResizeObserver(reposition)
        if (bugAnchorRef.current) ro.observe(bugAnchorRef.current)
        if (skillAnchorRef.current) ro.observe(skillAnchorRef.current)
        if (issuePathAnchorRef.current) ro.observe(issuePathAnchorRef.current)
        reposition()
        return function () {
          disposed = true
          ro.disconnect()
          if (raf !== null) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
            else clearTimeout(raf)
          }
          document.removeEventListener('scroll', reposition, true)
          window.removeEventListener('resize', reposition)
          clearClose(bugCloseRef); clearClose(skillCloseRef); clearClose(issuePathCloseRef)
        }
      }, [s.bugMenuOpen, s.skillsOpen, s.issuePathHover])
      const applyFold = function () {
        const cap = foldRef.current
        if (!cap) return
        const targets = Array.from(cap.querySelectorAll('[data-fold-priority]'))
        if (!targets.length) return
        cap.classList.add('dsws-no-anim')
        targets.forEach(function (el) { el.classList.remove('dsws-folded') })
        void cap.offsetWidth
        const items = targets.map(function (el) {
          return { el: el, p: Number(el.getAttribute('data-fold-priority') || 99) }
        }).sort(function (a, b) { return a.p - b.p })
        for (const it of items) {
          if (cap.scrollWidth <= cap.clientWidth + 1) break
          it.el.classList.add('dsws-folded')
          void cap.offsetWidth
        }
        cap.dataset.fold = String(targets.filter(function (el) {
          return el.classList.contains('dsws-folded')
        }).length)
        cap.classList.remove('dsws-no-anim')
      }
      React.useEffect(function () {
        const ta = document.querySelector('textarea.uV2eYG_input')
        if (ta) inputRef.current = ta
        const applyInput = function () {
          if (!inputRef.current) return
          try { setIw(inputRef.current.getBoundingClientRect().width) } catch (e) { /* 忽略 */ }
        }
        applyInput()
        const roInput = new ResizeObserver(applyInput)
        if (inputRef.current) roInput.observe(inputRef.current)
        // 折叠重算：capsule 宽（=iw）变化 / 窗口 resize / 字体加载后（防字体宽差误判）
        const roFold = new ResizeObserver(function () { applyFold() })
        const applyAll = function () { applyInput(); applyFold() }
        applyFold()
        if (foldRef.current) roFold.observe(foldRef.current)
        window.addEventListener('resize', applyAll)
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyFold)
        // DSH shell 偶尔会在对话切换时重新挂载 textarea，轮询兜底重读
        const poll = setInterval(applyAll, 2000)
        return function () {
          try { roInput.disconnect() } catch (e) { /* 忽略 */ }
          try { roFold.disconnect() } catch (e) { /* 忽略 */ }
          window.removeEventListener('resize', applyAll)
          clearInterval(poll)
        }
      }, [])
      const capsule = h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { openPanel(s) }, style: { position: 'relative', width: iw + 'px', maxWidth: iw + 'px' } }, [
        h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
          Icon({ scheme: s.ui.icon, size: 14 }),
          h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
        ]),
        // issuePath · 状态栏当前 Issue 胶囊主段（v1.7.0 map #79 · 为主要目的）—— 常驻显示当前 #N，hover 向上弹层展示路径
        h('span', { ref: issuePathAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showIssuePath, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) } }, [
          h('span', { className: 'dsws-seg' + (s.issuePathHover ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.issuePath && s.issuePath.current) { s.tab='list'; openPanel(s) } }, title: s.issuePath && s.issuePath.current ? '当前处理 #' + s.issuePath.current + ' · hover 查看路径 · 点击打开列表' : '尚未选择当前 Issue · 点击操作会自动记录', style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: s.issuePath && s.issuePath.current ? '#4ade80' : '#6b7280', border: s.issuePathHover ? '1px solid rgba(74,222,128,.45)' : '1px solid transparent', background: s.issuePathHover ? 'rgba(74,222,128,.12)' : 'transparent', borderRadius: 99, padding: '2px 7px' } }, [
            Ic({ n: 'pin', size: 12 }),
            h('span', { 'data-fold-priority': 10 }, s.issuePath && s.issuePath.current ? '#' + s.issuePath.current : '--'),
          ]),
          s.issuePathHover ? PortalOverlay({ className: 'dsws-issuepath-pop', onMouseEnter: function () { clearClose(issuePathCloseRef) }, onMouseLeave: function () { scheduleClose(issuePathCloseRef, closeIssuePath) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.issuePathPos ? s.issuePathPos.left : 0, bottom: s.issuePathPos ? s.issuePathPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.45)', minWidth: 260, maxWidth: 380 } }, [
            h('div', { style: { fontSize: 11, fontWeight: 700, color: 'var(--dsw-alias-label-primary,#e6edf3)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 } }, [
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'pin', size: 12 }), h('span', null, '当前路径')]),
              h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', fontWeight: 400 } }, s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length ? 'anchor #' + s.issuePath.anchor + ' · ' + s.issuePath.nodes.length + ' 节点' : '空'),
              h('span', { style: { marginLeft: 'auto', display: 'inline-flex', gap: 4 } }, [
                h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); clearIssuePath(s); closeIssuePath() }, style: { fontSize: 10, padding: '2px 6px' } }, '清空'),
              ]),
            ]),
            (s.issuePath && s.issuePath.nodes && s.issuePath.nodes.length) ? h('div', { style: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } }, s.issuePath.nodes.slice(-20).reverse().map(function (nd) {
              const isCur = nd.ref === s.issuePath.current
              const isAnchor = nd.ref === s.issuePath.anchor
              const t = new Date(nd.ts || Date.now()); const tm = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0')
              const srcColor = nd.source === 'claim' ? '#4ade80' : nd.source === 'gh-edit' ? '#58a6ff' : nd.source === 'mention' ? '#f59e0b' : '#8b8b95'
              const srcLabel = nd.source === 'claim' ? 'claim' : nd.source === 'gh-edit' ? 'gh-edit' : nd.source === 'mention' ? 'mention' : nd.source
              return h('div', { key: nd.ts + '-' + nd.ref, onClick: function (e) { e.stopPropagation(); reanchorIssuePath(s, nd.ref) }, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: isCur ? 'rgba(74,222,128,.14)' : 'transparent', border: isCur ? '1px solid rgba(74,222,128,.35)' : '1px solid transparent', cursor: 'pointer' } }, [
                h('span', { style: { fontSize: 11, fontFamily: 'Consolas,Menlo,monospace', color: isCur ? '#4ade80' : 'var(--dsw-alias-label-primary,#e6edf3)', fontWeight: isCur ? 700 : 500 } }, '#' + nd.ref + (isAnchor ? ' ⚓' : '')),
                h('span', { style: { fontSize: 10, color: srcColor, border: '1px solid ' + srcColor, borderRadius: 4, padding: '0 4px', lineHeight: 1.6 } }, srcLabel),
                h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, tm),
                nd.title ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 } }, nd.title) : null,
                isCur ? h('span', { style: { fontSize: 10, color: '#4ade80', fontWeight: 700 } }, '← 当前') : null,
              ])
            })) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '6px 0' } }, '暂无路径 · 点击任意 issue 行的“执行/诊断/修复”或在新会话中打开 issue 会自动记录'),
            h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 6, paddingTop: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [
              h('span', null, '点击节点可重锚起点'),
              h('span', { style: { marginLeft: 'auto' } }, '上限 100 · 本地持久'),
            ]),
          ]) : null,
        ]),
        seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; go('list') }, tr('nav.takeableTitle')),
        // issue #4：BUG 计数段 —— 点击仍开 bug 过滤列表；悬停弹「新增」菜单（新会话预填 /wayfinder 新增 BUG 单 prompt）
        h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
          seg('alert', [h('span', { 'data-fold-priority': 6 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') }, tr('nav.bugTitle')),
          s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
            h('div', { onClick: function (e) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
              Ic({ n: 'bug', size: 12, color: s.bugMenuHover ? '#fca5a5' : '#f87171' }),
              h('span', null, tr('nav.bugNew')),
            ]),
          ]) : null,
        ]),
        seg('search', [h('span', { 'data-fold-priority': 7 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') }, tr('nav.triageTitle')),
        // #16 V2：note 段（沉淀 / Consolidate）文字 span 打 data-fold-priority=2（无数字操作段，信息价值低，早收）
        seg('note', h('span', { 'data-fold-priority': 2 }, tr('nav.word')), '#c084fc', function () { injectFixate(s) }, tr('nav.fixateTitle')),
        // 需求1·二阶段（2026-08-18）：交接分割按钮 —— 共外框 + 细分隔线；左半「交接」= 第一击生成、
        //   右半「交接出去」= 原第二击（探测磁盘最新文档 → 预填 + 开新会话）。各自点击区/tooltip 保留，hover 沿用 seg 背景。
        //   右半灰/亮双态：handoffReady → 亮蓝 #58a6ff（tooltip nav.handoffReadyTitle）；未 ready → 半透明灰（tooltip nav.handoffGreyTitle）
        // #16 V2：split-part 左半「交接」文字 span 打 data-fold-priority=3（无数字操作段）
        h('span', { className: 'dsws-split' }, [
          h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoff(s) }, title: tr('nav.handoffTitle'), style: { color: '#58a6ff' } }, [
            Ic({ n: 'handoff', size: 12 }),
            h('span', { 'data-fold-priority': 3 }, tr('nav.handoff')),
          ]),
          h('span', { className: 'dsws-split-div' }),
          h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }, title: s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'), style: s.handoffReady ? { color: '#58a6ff' } : { color: '#8b8b95', opacity: 0.55, cursor: 'default' } }, [
            Ic({ n: s.handoffReady ? 'handoff-open' : 'handoff-off', size: 12 }),
          ]),
        ]),
        // v19-36：环境段移至末尾（更新左侧），用户少点
        seg('dot', [h('span', { 'data-fold-priority': 8 }, tr('nav.env')), num(envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') }, tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) })),
        // v1.5 T10：刷新反馈 = 图标转圈（文字恒定不换 · 控件宽度零变化）
        // #16 V2：timebtn 两段文字各打 priority（刷新字=4 无数字操作段 / 时间=9 纯参考时间戳最后收）
        h('span', { className: 'dsws-timebtn', onClick: function (e) { e.stopPropagation(); refreshAll(s) }, title: tr('nav.refreshTitle') }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 4 }, tr('nav.refresh')), h('span', { 'data-fold-priority': 9 }, ' ' + timeStr)]),
        // 需求2（2026-08-18）：状态栏末尾技能列表按钮 —— 向上展开技能名列表，点击技能名插入 /<技能名> 到当前会话
        // issue #3（D2）：对齐 BUG 段悬浮菜单 —— 悬停即展开、移出「按钮 + 列表」整体区域即关闭；
        //   按钮与列表之间的 4px 间隙由外层 paddingTop 桥接（不再用 marginBottom），鼠标穿越不误关。
        h('span', {
          style: { position: 'relative', display: 'inline-flex' },
          ref: skillAnchorRef, onMouseEnter: showSkillPop,
          onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) },
        }, [
          h('span', { className: 'dsws-skillbtn' + (s.skillsOpen ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.skillsOpen) closeSkillPop(); else showSkillPop() }, title: tr('nav.skillsTitle'), style: { display: 'inline-flex', alignItems: 'center', padding: '1px 4px', borderRadius: 4, cursor: 'pointer', color: s.skillsOpen ? '#c084fc' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [Ic({ n: 'skills', size: 12 })]),
          s.skillsOpen ? PortalOverlay({ className: 'dsws-skillpop-bridge', onMouseEnter: function () { clearClose(skillCloseRef) }, onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) }, style: { position: 'fixed', right: s.skillPopPos ? s.skillPopPos.right : 0, bottom: s.skillPopPos ? s.skillPopPos.bottom : 0, paddingTop: 4, paddingBottom: 4, zIndex: 2147483000 }, onClick: function (e) { e.stopPropagation() } }, [
            h('div', { className: 'dsws-skillpop', style: { minWidth: 150, maxHeight: 'min(300px, calc(100vh - 24px))', overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)', padding: 4 } }, [
              // 悬浮记忆：鼠标移到行上立即出现浮层（替代浏览器原生 title 的慢延迟）
              SKILLS.map(function (sk) {
                return h('div', {
                  key: sk.name,
                  onClick: function (e) { e.stopPropagation(); inject(s, '/' + sk.name); closeSkillPop() },
                  onMouseEnter: function (e) {
                    const r = e.currentTarget.getBoundingClientRect()
                    // 浮层实宽 = maxWidth 220 + 左右内边距 16 + 边框 2 = 238（翻转阈值与实宽对齐，避免贴边）
                    let tip = { x: r.right + 8, y: r.top + r.height / 2, name: sk.name }
                    if (typeof window !== 'undefined' && tip.x + 238 > window.innerWidth) tip = { x: r.left - 8 - 238, y: r.top + r.height / 2, name: sk.name }
                    s.skillHover = sk.name
                    s.skillTip = tip
                    emit(s)
                  },
                  onMouseLeave: function () { if (s.skillHover !== null) { s.skillHover = null; s.skillTip = null; emit(s) } },
                  style: { padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.skillHover === sk.name ? 'var(--dsw-alias-label-primary,#e6edf3)' : 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace', background: s.skillHover === sk.name ? 'var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))' : 'transparent', borderLeft: s.skillHover === sk.name ? '2px solid #c084fc' : '2px solid transparent' }
                }, sk.name)
              }),
              // 底部操作提示（替代被移除的列表标题位，保持顶部纯技能名）
              h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '5px 8px 2px', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 2, whiteSpace: 'nowrap' } }, tr('nav.skillHint')),
            ]),
          ]) : null,
        ]),
        // 快速悬浮提示：portal 到 document.body（issue #3·D1）——脱离状态栏子树，position:fixed 的
        //   视口坐标与 z-index 全局生效，不再被宿主输入区容器裁剪或压层
        s.skillTip && s.skillHover ? portalTop(h('div', { style: { position: 'fixed', left: s.skillTip.x, top: s.skillTip.y, transform: 'translateY(-50%)', maxWidth: 220, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)' } }, tr('skilldesc.' + s.skillTip.name))) : null,
      ])
      // 用户拍板 2026-08-16 + 2026-08-17：横幅移到状态栏上方；依赖链 gh → 登录 → setup → 技能，显示第一个缺失项
      const firstBlock = ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
      // #16 v1.6.4 R4：wrapper 加 overflow:hidden 截掉 capsule 溢出 wrapper 部分（dn=0..3 中间状态时 children 居中后左右可能溢出 wrapper）
      // #16 R6b：去掉 alignItems:'stretch'（之前为了拉伸 capsule 撑满 wrapper 高度，反而让父级
//   composerHero 297px 高传给 wrapper 后，capsule 被拉成与 wrapper 同高 ≈9.5px，文字被截掉）
      // #16 R12（本次）：宿主 conversation.input.dock 插槽 = composerStack（column flex），wrapper 是 flex item，
//   默认 flex-shrink:1 → 输入区高度被压缩时 wrapper 被压扁（wrapper 11px → capsule 8px → overflow:hidden 裁文字）。
//   R6b 只防了「被拉高」，没防「被压矮」；故加 flex:'none'（flex:0 0 auto）双保险。
// #22：正常路径由 portal 脱离裁剪；若 ReactDOM 不可用，退化节点必须不再被本 wrapper 立即裁掉。
      if (!firstBlock) return h('div', { style: { display: 'flex', flex: 'none', justifyContent: 'center', width: '100%', boxSizing: 'border-box', padding: '3px 8px 0', overflow: RDOM ? 'hidden' : 'visible' } }, [capsule])
      const bann = function (text, btnLabel, onBtn) {
        return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
          Ic({ n: 'alert', size: 13 }),
          h('span', { style: { flex: 1 } }, text),
          h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: onBtn }, btnLabel),
        ])
      }
      return h('div', { style: { display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '3px 8px 0' } }, [
        firstBlock === 'ghcli'
          ? bann(tr('banner.ghcli'), tr('banner.ghcliBtn'), function () { openUrl('https://cli.github.com/') })
          : firstBlock === 'ghauth'
            ? bann(tr('banner.ghauth'), tr('banner.ghauthBtn'), function () { openUrl('https://cli.github.com/manual/gh_auth_login') })
            : firstBlock === 'setup'
              ? bann(tr('banner.setup'), tr('banner.setupBtn'), function () { inject(s, promptText('setupRun')) })
              : bann(tr('banner.skills', { list: (skillsCheck && skillsCheck.detail) || '' }), tr('banner.skillsBtn'), function () { inject(s, promptText('installSkills')) }),
        capsule,
      ])
    }

    // ============================================================
    // T17：issue 正文 markdown 白名单渲染（mdToHtml）
    //   只认白名单语法，其余一律纯文本（不渲染原始 HTML，防 XSS）
    //   输出标准 HTML 标签 → opencode-palette 主题自动上色（markdownHeading/Link/Code/Emph/Strong）
    //   返回值：React 元素数组（可直接作为 h(...) children）
    // ============================================================
    const MD_LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/g
    const MD_TASK_RE = /^- \[([ xX])\]\s*(.*)$/
    const mdEsc = function (s) { return String(s == null ? '' : s) }
    const mdInline = function (text, keyBase) {
      const out = []
      let rest = mdEsc(text)
      let k = 0
      // 先提取链接（防内部 ** 混淆；URL 协议白名单防 javascript:/data: 等危险协议）
      const linkParts = []
      const mdSafeUrl = function (u) {
        const s = String(u == null ? '' : u).trim()
        if (!s) return null
        if (/^(https?:|mailto:)/i.test(s)) return s
        if (/^[#/]/.test(s) || /^\.\.?\//.test(s)) return s
        if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s
        return null
      }
      rest = rest.replace(MD_LINK_RE, function (m, label, url) {
        const u = mdSafeUrl(url)
        if (u === null) return label
        linkParts.push(h('a', { key: 'l' + (k++), href: u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, mdInline(label, 'll' + k)))
        return '\u0001L' + (linkParts.length - 1) + '\u0001'
      })
      // 再处理加粗 / 斜体 / 行内代码（先解析段内链接占位符——链接可嵌在文本任意位置）
      rest.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60)/g).forEach(function (seg, si) {
        if (!seg) return
        if (seg.indexOf('\u0001') >= 0) {
          const re = /\u0001L(\d+)\u0001/g
          let last = 0
          let m
          while ((m = re.exec(seg)) !== null) {
            if (m.index > last) out.push(seg.slice(last, m.index))
            const n = parseInt(m[1], 10)
            if (!isNaN(n) && linkParts[n]) out.push(linkParts[n])
            else out.push(m[0])
            last = m.index + m[0].length
          }
          if (last < seg.length) out.push(seg.slice(last))
          return
        }
        const em = /^\*\*([^*]+)\*\*$/.exec(seg)
        if (em) { out.push(h('strong', { key: (keyBase || '') + 's' + (si) }, em[1])); return }
        const it = /^\*([^*]+)\*$/.exec(seg)
        if (it) { out.push(h('em', { key: (keyBase || '') + 'i' + (si) }, it[1])); return }
        const cd = /^\x60([^\x60]+)\x60$/.exec(seg)
        if (cd) { out.push(h('code', { key: (keyBase || '') + 'c' + (si), style: { fontFamily: 'var(--ds-font-family-code,Consolas,Menlo,monospace)', fontSize: '0.92em', padding: '0 3px', borderRadius: 4, background: 'var(--dsw-alias-markdown-code-block,rgba(255,255,255,.07))' } }, cd[1])); return }
        out.push(seg)
      })
      return out
    }
    const mdToHtml = function (md, opts) {
      const o = opts || {}
      const nodes = []
      const lines = String(md == null ? '' : md).split(/\r?\n/)
      let i = 0
      let k = 0
      const pushList = function (items) {
        if (!items.length) return
        nodes.push(h('ul', { key: 'ul' + (k++), style: { margin: '2px 0', paddingLeft: 16 } }, items.map(function (it, ii) {
          if (it.task !== null) {
            return h('li', { key: 'li' + ii, style: { listStyle: 'none', marginLeft: -14 } }, [
              h('input', { type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true, style: { marginRight: 5, verticalAlign: 'middle' } }),
              h('span', null, mdInline(it.text, 't' + ii)),
            ])
          }
          return h('li', { key: 'li' + ii }, mdInline(it.text, 't' + ii))
        })))
      }
      while (i < lines.length) {
        const line = lines[i]
        const trim = line.trim()
        const h2 = /^##\s+(.+)$/.exec(trim)
        if (h2) { nodes.push(h('div', { key: 'h' + (k++), style: { fontSize: 14, fontWeight: 700, margin: '6px 0 3px', color: 'var(--dsw-alias-markdown-heading,var(--dsw-alias-label-primary,#e6edf3))', fontFamily: 'var(--dsw-font-markdown-h2,var(--dsw-font-family))' } }, mdInline(h2[1], 'h' + k))); i++; continue }
        const hr = /^---+$/.test(trim) || /^\*\*\*+$/.test(trim)
        if (hr) { nodes.push(h('hr', { key: 'hr' + (k++), style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', margin: '4px 0' } })); i++; continue }
        const q = /^>\s?(.*)$/.exec(trim)
        if (q) { nodes.push(h('blockquote', { key: 'bq' + (k++), style: { margin: '2px 0', paddingLeft: 8, borderLeft: '3px solid var(--dsw-alias-border-l1,#2a2d35)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, mdInline(q[1], 'q' + k))); i++; continue }
        // 列表（连续行归组）
        const listItems = []
        let j = i
        while (j < lines.length) {
          const lt = lines[j].trim()
          const taskM = MD_TASK_RE.exec(lt)
          const bullet = /^-\s+(.+)$/.exec(lt) || /^\*\s+(.+)$/.exec(lt)
          if (taskM) { listItems.push({ task: taskM[1], text: taskM[2] }); j++; continue }
          if (bullet) { listItems.push({ task: null, text: bullet[1] }); j++; continue }
          break
        }
        if (listItems.length) { pushList(listItems); i = j; continue }
        // 空行 / 普通段落
        if (trim === '') { i++; continue }
        nodes.push(h('div', { key: 'p' + (k++), style: { margin: '1px 0' } }, mdInline(line, 'p' + k)))
        i++
      }
      if (o.single) return nodes[0] || null
      return nodes
    }
    // ============================================================
    // v1.5 T12：票进度渲染（状态徽章 + 进度条）—— open/close 原生 + 进度自评
    const tStatus = function (t) {
      if (t.state === 'CLOSED') return { key: 'done', color: '#3fb950', icon: 'check' }
      if (t.progress === null || t.progress === undefined || t.progress <= 0) return { key: 'todo', color: '#8b8b95', icon: 'dot' } // B4：0% = 未动工（契约），不进 doing
      if (t.progress >= 100) return { key: 'accept', color: '#f59e0b', icon: 'alert' }
      if (t.progress >= 95) return { key: 'confirm', color: '#f59e0b', icon: 'alert' }
      return { key: 'doing', color: '#58a6ff', icon: 'dot' }
    }
    const tStatusLabel = function (t) {
      const s = tStatus(t)
      if (s.key === 'done') return tr('progress.done')
      if (s.key === 'accept') return tr('progress.accept')
      if (s.key === 'confirm') return tr('progress.confirm')
      if (s.key === 'doing') return tr('progress.doing', { n: t.progress })
      return tr('progress.todo')
    }
    const tProgressBar = function (t) {
      const p = (t.state === 'CLOSED') ? 100 : (t.progress === null || t.progress === undefined ? 0 : t.progress)
      const color = (t.state === 'CLOSED') ? '#3fb950' : (t.progress === null || t.progress === undefined ? '#52525b' : '#58a6ff')
      const label = (t.state === 'CLOSED') ? '100%' : (t.progress === null || t.progress === undefined ? '—' : t.progress + '%')
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 } }, [
        h('div', { style: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' } }, [
          h('div', { style: { width: String(p) + '%', height: '100%', background: color, borderRadius: 2 } }),
        ]),
        h('span', { style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right' } }, label),
      ])
    }
    const tStatusBadge = function (t) {
      if (t.state === 'CLOSED') return null
      const s = tStatus(t)
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 2, color: s.color, fontSize: 9, flex: 'none' } }, [
        Ic({ n: s.icon, size: 8 }),
        h('span', null, tStatusLabel(t)),
      ])
    }

    // ---- 5.3 票务行（地图详情内：标题/阻塞来源 ellipsis；v19：按标签给 诊断/修复/讨论/执行 动作，预填输入框）----
    const TicketRow = ({ st, g, t, indent, colorOf }) => {
      const openBlocker = function (b) { const bt = g.m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' }
      const blocked = t.state === 'OPEN' && t.blockedBy.some(openBlocker)
      const subItem = (icon, color, text) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, color: color, minWidth: 0 } }, [
        Ic({ n: icon, size: 11 }),
        h('span', { className: 'dsws-ellip', style: { maxWidth: 200 }, title: text }, text),
      ])
      return h('div', { className: 'dsws-trow', style: indent ? { paddingLeft: 18 } : null }, [
        h('div', { className: 'dsws-tt' }, [
          h('div', { className: 'dsws-tt-name' }, [
            // T2 #3：编号前置
            h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, flex: 'none' } }, '#' + t.number),
            TypeChip({ type: t.type }),
            h('span', { className: 'dsws-tt-wrap', style: { flex: 1 }, title: t.title }, t.title),
          ]),
          h('div', { className: 'dsws-tt-sub', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
            t.claimedBy ? subItem('person', '#58a6ff', tr('map.subClaimed', { who: t.claimedBy })) : null,
            // #370：被阻塞 chip 只显示仍 OPEN 的阻塞者（与 compute/主列表/按钮抑制口径一致）
            blocked ? subItem('lock', '#f0883e', tr('map.subBlocked', { who: blockerNames(t, g.m) })) : null,
            t.state === 'CLOSED' ? subItem('check', '#3fb950', tr('map.subClosed')) : null,
            tStatusBadge(t),
          ]),
          (t.state === 'OPEN') ? tProgressBar(t) : null,
        ]),
        t.state === 'OPEN' ? h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: 'none' } }, [
          blocked ? null : mkRowAction(st, t, false, colorOf),
          // #361 能力保留（同 cwd + 自动命名 + 预填指令）；#394：去 ghost/icon-only，与 nav.handoff 解耦
          //   marginLeft:4 与左侧 mkRowAction 形成隐式分组（动作组 vs 辅助组）
          h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, t) }, title: tr('list.newSessionLabel'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: actionColorOf(t, colorOf), borderColor: 'transparent', color: isLightHex(actionColorOf(t, colorOf)) ? '#140a1e' : '#ffffff' } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))]),
          h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 6px' } }, Ic({ n: 'link', size: 12 })),
        ]) : h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' } }, tr('act.view')),
      ])
    }

    // ---- 5.4 地图详情（v1.4 · T2 #443：漏斗分层 + 战争迷雾 + 72px 仪式环 + 四态动作，D1-D8 规格）----
    //   层 = blockedBy DAG 最长路径深度（T1 #442 已算 stats.levels + 每票 t.level）
    const MapDetail = ({ st, g }) => {
      const m = g.m
      const colorOf = buildColorOf(st)
      const tickets = m.tickets || []
      const levels = (m.stats && m.stats.levels) || []
      const totalLayers = levels.length
      // 当前层 = 第一个含 open 票的层（无 open 全 done → 最后一层）
      const curLevel = (function () {
        for (let i = 0; i < levels.length; i++) { if (levels[i].open > 0) return i }
        return Math.max(0, levels.length - 1)
      })()
      const passedLayers = levels.filter(function (l, i) { return i < curLevel }).length
      const byLevel = {}
      tickets.forEach(function (t) { const lv = (typeof t.level === 'number') ? t.level : 0; (byLevel[lv] = byLevel[lv] || []).push(t) })
      // 迷雾：fog 票（Not yet specified）+ 被阻塞且其阻塞者 open 的票（半雾）；D7 视觉遮蔽
      const isFog = function (t) {
        if (t.state !== 'OPEN') return false
        const blk = (t.blockedBy || []).map(function (b) { return tickets.find(function (x) { return x.number === b }) }).filter(Boolean)
        return blk.some(function (b) { return b.state === 'OPEN' })
      }
      const fogTitles = (m.fog || []).map(function (f) { return String(f).trim() })
      const isFogTitle = function (t) { return fogTitles.some(function (f) { return f && t.title && t.title.indexOf(f) >= 0 }) }
      // v1.4：同层内排序 —— 可执行（open 且非迷雾）最左 → open 被阻塞 → 已关闭靠右（一眼看到当前能做什么）
      Object.keys(byLevel).forEach(function (lv) {
        byLevel[lv].sort(function (a, b) {
          const rank = function (t) {
            if (t.state === 'OPEN') return isFog(t) || isFogTitle(t) ? 1 : 0
            return 2
          }
          return rank(a) - rank(b) || a.number - b.number
        })
      })
      // 迷雾点击去雾状态（st 上按 map 存）
      st.reveal = st.reveal || {}
      const nodeCls = function (t) {
        let cls = 'dsws-node'
        if (t.state === 'CLOSED') cls += ' done'
        else if (t.level === curLevel) cls += ' now'
        const fog = isFog(t) || isFogTitle(t)
        if (fog) { cls += ' fog'; if (st.reveal[m.number] && st.reveal[m.number][t.number]) cls += ' revealed' }
        // R5：子票级变化高亮（issueFlash）
        if (st.issueFlash && st.issueFlash[t.number]) cls += st.issueFlash[t.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed'
        return cls
      }
      const toggleReveal = function (t) {
        st.reveal[m.number] = st.reveal[m.number] || {}
        st.reveal[m.number][t.number] = !(st.reveal[m.number][t.number])
        emit(st)
      }
      const gateState = function (layerIndex) {
        // 闸门：该层全 closed → open(绿✓)；层含 open 且在其之前层全 closed → open；否则 lock
        const lv = levels[layerIndex]
        if (!lv) return 'open'
        if (lv.closed === lv.total && lv.total > 0) return 'open'
        const prevAllClosed = levels.slice(0, layerIndex).every(function (p) { return p.closed === p.total })
        return prevAllClosed ? 'open' : 'lock'
      }
      const node = function (t) {
        const blocked = isFog(t)
        // T15：acts 恒渲染容器（CLOSED/fog 空占位）→ 卡片高度恒定
        const acts = h('div', { className: 'acts' }, (t.state === 'OPEN' && !blocked) ? [
          mkRowAction(st, t, false, colorOf),
          h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' } }, Ic({ n: 'link', size: 11 })),
        ] : [])
        // v1.4 修复：图标名必须用 Ic 支持的（search/hammer/chat/gear），原 mag/bolt/wrench 不存在 → 节点图标空白
        const ic = t.type === 'research' ? 'search' : t.type === 'prototype' ? 'hammer' : t.type === 'grilling' ? 'chat' : 'gear'
        return h('div', {
          key: t.number,
          className: nodeCls(t),
          onClick: (isFog(t) || isFogTitle(t)) ? function (e) { e.stopPropagation(); toggleReveal(t) } : undefined,
        }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'icbox' }, Ic({ n: ic, size: 12 })),
            h('div', { style: { flex: 1, minWidth: 0 } }, [
              h('div', { className: 'meta' }, [
                h('span', { className: 'no' }, '#' + t.number),
                TypeChip({ type: t.type }),
              ]),
              h('div', { className: 'tt', title: t.title }, t.title),
              h('div', { className: 'sub', style: { fontSize: 8, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 1, minHeight: 12, display: 'flex', gap: 5, flexWrap: 'wrap' } }, [
                t.state === 'CLOSED' ? h('span', { style: { color: '#3fb950', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'check', size: 8 }), h('span', null, tr('map.subClosed'))]) : null,
                t.claimedBy ? h('span', { style: { color: '#58a6ff', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'person', size: 8 }), h('span', null, t.claimedBy)]) : null,
                blocked ? h('span', { style: { color: '#f0883e', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'lock', size: 8 }), h('span', null, tr('map.subBlocked', { who: blockerNames(t, m) }))]) : null,
              ]),
              // v1.5 T12：进度条 + 状态徽章（open 票显示真实进度 · 修 0/13）
              tProgressBar(t),
              h('div', { style: { marginTop: 2, minHeight: 14, display: 'flex', alignItems: 'center', gap: 2 } }, [tStatusBadge(t)]),
            ]),
          ]),
          acts,
          (isFog(t) || isFogTitle(t)) ? h('svg', { className: 'qmark', viewBox: '0 0 24 24' }, [h('path', { d: 'M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.9.4-1.2 1-1.2 1.8' }), h('circle', { cx: '12', cy: '18', r: '.6' })]) : null,
        ])
      }
      const layerBlock = function (layerIndex) {
        const lv = levels[layerIndex]
        if (!lv) return null
        const layerTickets = byLevel[layerIndex] || []
        const gate = gateState(layerIndex)
        const isCur = layerIndex === curLevel
        // T15：层容器 + 明显层号（当前层高亮）；层内网格自适应
        return [
          h('div', { className: 'dsws-layerbox' + (isCur ? ' cur' : '') }, [
            h('div', { className: 'dsws-layerTag' }, [
              h('span', { className: 'dsws-layerNo' }, String(layerIndex + 1)),
              h('span', { className: 'dsws-layerTitle' }, tr('map.layer', { n: layerIndex + 1 }) + ' · ' + lv.open + ' open'),
              h('span', { className: 'sp' }),
            ]),
            h('div', { className: 'dsws-layer' }, layerTickets.map(function (t) { return node(t) })),
          ]),
          h('div', { className: 'dsws-gate' }, [
            h('span', { className: 'g ' + gate }, Ic({ n: gate === 'open' ? 'check' : 'lock', size: 12 })),
          ]),
        ]
      }
      // 完成态：全 closed → 进度条全绿 + 环满圈
      const allClosed = m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total
      const ringPct = allClosed ? 1 : (totalLayers ? Math.min(1, (passedLayers + 1) / totalLayers) : 0)
      const C = 2 * Math.PI * 31
      const ringOff = C * (1 - ringPct)
      return h('div', null, [
        // 顶部操作行：返回 + map chip + 执行/完成
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, [
          h('button', { className: 'dsws-btn', onClick: function () { st.activeMap = null; emit(st) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            Ic({ n: 'back', size: 12 }),
            h('span', null, tr('list.back')),
          ]),
          h('span', { className: 'dsws-chip dsws-chip-m' }, [Ic({ n: 'map', size: 11 }), h('span', null, 'wayfinder:map')]),
          h('span', { style: { flex: 1 } }),
          (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
            ? h('button', { className: 'dsws-btn primary', title: tr('map.doneTitle'), onClick: function () {
                const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                inject(st, text)
              }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [
                Ic({ n: 'check', size: 10 }),
                h('span', null, tr('act.done')),
              ])
            : h('button', { className: 'dsws-btn primary', title: tr('map.executeTitle'), onClick: function () {
                // v1.4：map 推进式执行（startText 检测 wayfinder:map → MAP_EXECUTE_PROMPT）
                inject(st, startText(st, m))
              }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11 } }, [
                Ic({ n: 'play', size: 10 }),
                h('span', null, tr('act.execute')),
              ]),
          // v1.5 B2（O5）：详情页「在新会话打开」—— 与 执行/完成 同语义，开新会话推进该 map
          h('button', { className: 'dsws-btn ghost', title: tr('map.newSessionTitle'), onClick: function () { openInNewSession(st, m) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, flex: 'none' } }, [
            Ic({ n: 'external-link', size: 10 }),
            h('span', null, tr('list.newSessionLabel')),
          ]),
        ]),
        // T14：map 编号徽章 —— 标题前方、紫色、与列表 map 行同款（dsws-idnum）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 } }, [
          h('span', { className: 'dsws-idnum', style: { color: '#c084fc', borderColor: '#c084fc', flex: 'none' } }, '#' + m.number),
          h('div', { className: 'dsws-mtitle dsws-tt-wrap', style: { flex: 1, minWidth: 0 }, title: m.title }, m.title),
        ]),
        m.error ? h('div', { style: { color: '#f87171', fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, String((m.error && m.error.error) || tr('list.loadFail')).slice(0, 160))]) : null,
        // D2：分段静态进度条 = 地图层缩略图（无动画，唯一真相源）
        (levels.length > 0) ? h('div', { className: 'dsws-layers' }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'cap' }, tr('map.progressCap')),
            h('div', { className: 'segs' }, levels.map(function (l, i) {
              const segCls = i < curLevel ? 'seg past' : (i === curLevel ? 'seg curr' : 'seg future')
              return h('div', { key: i, className: segCls, title: tr('map.layer', { n: i + 1 }) })
            })),
          ]),
          h('div', { className: 'row2' }, [
            h('span', { className: 'cur' }, [Ic({ n: 'play', size: 9 }), h('span', null, tr('map.curLayer', { n: curLevel + 1 }))]),
            h('span', { className: 'pos' }, tr('map.layersPassed', { n: passedLayers, t: totalLayers })),
          ]),
        ]) : null,
        // T17 修订：Destination 走 markdown 渲染（**加粗** 等不再裸露；去 ellip 允许换行）
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }, [Ic({ n: 'target', size: 12, style: { marginTop: 2, flex: 'none' } }), h('div', { style: { flex: 1, minWidth: 0 } }, m.destination ? mdToHtml(m.destination) : tr('list.noDest'))]),
        // T17 修订：正文详情（Notes）默认折叠 —— <details> 收起，点击展开
        h('details', { style: { margin: '2px 0 4px' } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
            Ic({ n: 'note', size: 11 }),
            h('span', null, tr('map.notesCap')),
          ]),
          m.notes ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } }, mdToHtml(m.notes)) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 4, paddingLeft: 8 } }, tr('list.noNotes')),
        ]),
        // 漏斗分层主体
        h('div', { style: { marginTop: 2 } }, [
          h('div', { className: 'dsws-start' }, [
            h('span', { className: 'cap' }, tr('map.startCap')),
          ]),
          levels.map(function (l, i) { return layerBlock(i) }),
          // D3：Destination 72px 仪式环（环心旗帜，无数字）
          h('div', { className: 'dsws-dest' }, [
            h('div', { className: 'ring' }, [
              h('svg', { width: 72, height: 72, viewBox: '0 0 72 72' }, [
                h('circle', { className: 'track', cx: 36, cy: 36, r: 31 }),
                h('circle', { className: 'prog', cx: 36, cy: 36, r: 31, strokeDasharray: String(C), strokeDashoffset: String(ringOff) }),
              ]),
              h('div', { className: 'core' }, h('svg', { viewBox: '0 0 24 24' }, [h('path', { d: 'M5 3v18' }), h('path', { d: 'M5 4c4-2 6 2 12 0v9c-6 2-8-2-12 0' })])),
            ]),
            h('div', { className: 'title' }, tr('map.destCap')),
            h('div', { className: 'acts' }, [
              // v1.4：底部按钮与顶部同语义 —— 完成态「完成」（COMPLETE_PROMPT 同列表）/ 未完成「执行」（execute 模板）
              (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
                ? h('button', { className: 'dsws-btn primary', title: tr('map.doneTitle'), onClick: function () {
                    const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                    inject(st, text)
                  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 700 } }, [
                    Ic({ n: 'check', size: 11 }),
                    h('span', null, tr('act.done')),
                  ])
                : h('button', { className: 'dsws-btn primary', title: tr('map.executeTitle'), onClick: function () {
                    // v1.4：map 推进式执行（startText 检测 wayfinder:map → MAP_EXECUTE_PROMPT）
                    inject(st, startText(st, m))
                  }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#4ade80', borderColor: 'transparent', color: '#04120a', fontWeight: 700 } }, [
                    Ic({ n: 'play', size: 11 }),
                    h('span', null, tr('act.execute')),
                  ]),
              h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + m.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))]),
            ]),
          ]),
        ]),
        // 折叠块：Decisions / Fog / Out of scope（保留信息展示）
        h('details', { style: { marginTop: 10, marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.decisions', { n: m.decisions.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.decisions.map(function (d, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, [
              h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '· '),
              (d.url ? h('a', { href: d.url, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, d.title) : h('span', null, d.title)),
              d.gist ? h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, ' — ' + d.gist) : null,
            ])
          })),
        ]),
        h('details', { style: { marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.fog', { n: m.fog.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.fog.map(function (f, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + f))
          })),
        ]),
        h('details', { style: { marginBottom: 4 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.outOfScope', { n: m.outOfScope.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.outOfScope.map(function (o, i) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + o))
          })),
        ]),
      ])
    }

    // ---- 5.5 主列表（v14：三选一动作 / map 行突出 + 开始执行 / 已关闭折叠行 / chips 深边框 / 窄屏双栏）----
    // v1.3.3 UI：行2 标签贪心折叠 —— 渲染后测量可用宽度，逐个放标签，放不下的隐藏进 +N（单行不换行）
    const _tagsFpOf = (typeof WeakMap !== 'undefined') ? new WeakMap() : { get: function () { return undefined }, set: function () { } }
    const fitAllTags = function () {
      if (typeof document === 'undefined') return
      document.querySelectorAll('.dsws-tags').forEach(function (tags) {
        const more = tags.querySelector('.dsws-more')
        if (!more) return
        const chips = Array.prototype.slice.call(tags.querySelectorAll('.dsws-chip:not(.dsws-more):not(.dsws-blocked)'))
        chips.forEach(function (c) { c.style.display = 'inline-flex' })
        more.style.display = 'inline-flex'
        const avail = tags.clientWidth
        const moreW = more.offsetWidth
        const gap = 3
        const room = avail - moreW - gap
        let used = 0, shown = 0
        chips.forEach(function (c, i) {
          const w = c.offsetWidth
          if (used + w <= room || i === 0) { c.style.display = 'inline-flex'; used += w + gap; shown++ }
          else c.style.display = 'none'
        })
        const hidden = chips.length - shown
        more.textContent = '+' + hidden
        more.style.display = hidden > 0 ? 'inline-flex' : 'none'
      })
    }
    // v1.3.3 UI：+N 弹窗 —— fixed 定位，基准 = 面板容器 rect（左右 clamp 不越界，上下自动翻转避让）
    const showPop = function (trig, host, labels, title) {
      if (typeof document === 'undefined') return
      const old = document.getElementById('dsws-pop')
      if (old && old.parentNode) old.parentNode.removeChild(old)
      const pop = document.createElement('div')
      pop.id = 'dsws-pop'
      pop.className = 'dsws-pop'
      const pt = document.createElement('div'); pt.className = 'pt'
      pt.textContent = tr('list.tagsCount', { n: labels.length })
      const pl = document.createElement('div'); pl.className = 'pl'
      labels.forEach(function (l) {
        const s = document.createElement('span')
        s.className = 'dsws-chip'
        s.style.background = hexA(l.color, 0.18) || 'rgba(188,140,255,.16)'
        s.style.color = l.color ? '#' + l.color : '#bc8cff'
        s.style.border = '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)')
        s.textContent = l.name
        pl.appendChild(s)
      })
      const ptitle = document.createElement('div'); ptitle.className = 'ptitle'
      ptitle.innerHTML = '<b>' + tr('list.popTitle') + '：</b>' + String(title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      pop.appendChild(pt); pop.appendChild(pl); pop.appendChild(ptitle)
      document.body.appendChild(pop)
      const pr = host ? host.getBoundingClientRect() : { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 }
      const pad = 8
      const maxW = Math.max(120, pr.right - pr.left - pad * 2)
      pop.style.maxWidth = maxW + 'px'
      pop.style.display = 'block'
      const r = trig.getBoundingClientRect()
      const pw = pop.offsetWidth, ph = pop.offsetHeight
      let left = Math.max(pr.left + pad, Math.min(r.left, pr.right - pw - pad))
      let top = r.bottom + 10, flip = false
      if (top + ph > window.innerHeight - 8) { top = r.top - ph - 10; flip = true }
      if (top < 8) { top = r.bottom + 10; flip = false }
      if (top < pr.top + pad && !flip) { top = pr.top + pad }
      pop.style.left = left + 'px'
      pop.style.top = top + 'px'
      const caret = document.createElement('div'); caret.className = 'caret'
      const cx = r.left + r.width / 2 - left
      caret.style.left = Math.max(6, Math.min(cx - 5, pw - 16)) + 'px'
      caret.style.top = flip ? 'auto' : '-6px'
      caret.style.bottom = flip ? '-6px' : 'auto'
      if (flip) {
        caret.style.borderLeft = 'none'; caret.style.borderTop = 'none'
        caret.style.borderRight = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderBottom = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
        caret.style.transform = 'rotate(225deg)'
      } else {
        caret.style.borderLeft = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderTop = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
        caret.style.borderRight = 'none'; caret.style.borderBottom = 'none'
        caret.style.transform = 'rotate(45deg)'
      }
      pop.appendChild(caret)
      const close = function () { if (pop.parentNode) pop.parentNode.removeChild(pop); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('scroll', onScroll, true) }
      const onDoc = function (ev) { if (pop.contains(ev.target)) return; close() }
      const onScroll = function () { close() }
      document.addEventListener('mousedown', onDoc, true)
      document.addEventListener('scroll', onScroll, true)
      pop._close = close
    }
    // ============ T2 #35 · NoRepo 红卡 + 表单（ListTab 首屏最优先 · 触发= checkRepo:bad && !dismissed）============
    const NoRepoCard = function (props) {
      const st = props.st
      const card = ensureNoRepoCard(st)
      const cs = activeChecks(st)
      const checkRepo = cs.find(function (c) { return c.id === 1 })
      const repoBad = !!(checkRepo && checkRepo.level === 'bad')
      const dismissed = isNoRepoDismissed(st.cwd)
      const show = repoBad && !dismissed
      if (!show) return null
      const isValid = isNoRepoNameValid(card.name)
      const doDismiss = function () { setNoRepoDismissed(st.cwd, true); card.expanded = false; emit(st) }
      const doExpand = function () { if (!card.name) card.name = cwdBasename(st.cwd); card.expanded = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doCollapse = function () { card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
      const doSubmit = function () {
        if (!isNoRepoNameValid(card.name)) { card.errorKind = 'bad-name'; card.error = tr('panel.noRepoErr.bad-name'); card.errorRepoUrl = ''; emit(st); return }
        if (typeof host === 'undefined' || typeof host.call !== 'function') { card.errorKind = 'unknown'; card.error = tr('err.hostUnavailable'); card.errorRepoUrl = ''; emit(st); return }
        card.loading = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
        host.call('wf.initPublish', { cwd: st.cwd, name: card.name, visibility: card.visibility }).then(function (res) {
          card.loading = false
          if (res && res.ok) {
            const repoStr2 = res.repo && res.repo.owner ? res.repo.owner + '/' + res.repo.name : (res.repo && res.repo.name ? res.repo.name : card.name)
            flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
            card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
            loadSnapshot(st, true, true); loadChecks(st, true, true)
          } else {
            const kind = (res && res.errorKind) || 'unknown'
            const raw = (res && res.error) || ''
            card.errorKind = kind
            card.errorRepoUrl = (res && res.repoUrl) || ''
            const key = 'panel.noRepoErr.' + kind
            const mapped = tr(key)
            const base = (mapped !== key) ? mapped : (raw ? String(raw).slice(0, 160) : tr('panel.noRepoErr.unknown'))
            card.error = base + (raw && base !== String(raw).slice(0, 160) && mapped !== raw ? ' · ' + String(raw).slice(0, 120) : '')
            emit(st)
          }
        }).catch(function (e) {
          card.loading = false; card.errorKind = 'unknown'; card.error = String((e && e.message) || e).slice(0, 200); card.errorRepoUrl = ''; emit(st)
        })
      }
      return h('div', { className: 'dsws-no-repo-card' }, [
        h('div', { className: 'head' }, [
          Ic({ n: 'alert', size: 13, color: '#f87171' }),
          h('div', { style: { flex: 1, minWidth: 0 } }, [
            h('div', { className: 'ttl' }, tr('panel.noRepoCardTitle')),
            h('div', { className: 'desc' }, tr('panel.noRepoCardDesc')),
          ]),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.noRepoCardDismiss'), onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { padding: '2px 6px', flex: 'none' } }, Ic({ n: 'x', size: 12 })),
        ]),
        h('div', { className: 'acts' }, !card.expanded ? [
          h('button', { className: 'dsws-btn primary', onClick: doExpand, style: { background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardAction')),
          h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardDismiss')),
        ] : null),
        card.expanded ? h('div', { className: 'dsws-no-repo-form' }, [
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormName')),
            h('input', { type: 'text', value: card.name, placeholder: cwdBasename(st.cwd), onChange: function (e) { card.name = e.target.value; if (card.errorKind === 'bad-name') { card.error = ''; card.errorKind = '' } emit(st) } }),
          ]),
          h('div', { className: 'hint', style: (!isValid && card.name) ? { color: '#f87171' } : null }, tr('panel.noRepoFormNameHint')),
          h('div', { className: 'row' }, [
            h('label', null, tr('panel.noRepoFormVisibility')),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'private', onChange: function () { card.visibility = 'private'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPrivate')),
            ]),
            h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 12 } }, [
              h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'public', onChange: function () { card.visibility = 'public'; emit(st) } }),
              h('span', null, tr('panel.noRepoFormPublic')),
            ]),
          ]),
          card.error ? (function () {
            const kind = card.errorKind || 'unknown'
            const isWarn = kind === 'no-git' || kind === 'no-gh' || kind === 'not-logged-in' || kind === 'network'
            const bg = isWarn ? 'rgba(245,158,11,.12)' : 'rgba(248,113,113,.12)'
            const bd = isWarn ? 'rgba(245,158,11,.45)' : 'rgba(248,113,113,.45)'
            const col = isWarn ? '#fbbf24' : '#f87171'
            return h('div', { className: 'err', style: { background: bg, border: '1px solid ' + bd, color: col, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
              Ic({ n: 'alert', size: 11, color: col }),
              h('span', { style: { marginLeft: 4, flex: '1 1 auto' } }, card.error),
              kind === 'no-git' ? h('a', { href: 'https://git-scm.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '下载') : null,
              kind === 'no-gh' ? h('a', { href: 'https://cli.github.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '下载') : null,
              kind === 'not-logged-in' ? h('a', { href: 'https://cli.github.com/manual/gh_auth_login', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去登录') : null,
              kind === 'already-exists' ? h('a', { href: card.errorRepoUrl || ('https://github.com/search?q=' + encodeURIComponent(card.name)), target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去查看') : null,
              kind === 'network' ? h('button', { onClick: doSubmit, disabled: card.loading, style: { marginLeft: 8, background: 'transparent', color: col, border: '1px solid ' + col, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, '重试') : null,
            ])
          })() : null,
          h('div', { className: 'row', style: { marginTop: 8 } }, [
            h('button', { className: 'dsws-btn primary', disabled: card.loading || !isValid, onClick: doSubmit, style: { opacity: (!isValid || card.loading) ? 0.6 : 1, background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
              card.loading ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, display: 'inline-block', verticalAlign: '-2px' } }) : null,
              h('span', null, card.loading ? tr('panel.noRepoFormSubmitting') : tr('panel.noRepoFormSubmit')),
            ]),
            h('button', { className: 'dsws-btn', onClick: doCollapse, disabled: card.loading, style: { marginLeft: 6, fontSize: 11, padding: '4px 10px' } }, tr('panel.noRepoFormCancel')),
          ]),
        ]) : null,
      ])
    }
    const ListTab = ({ st, narrow }) => {
      // v1.3.3 UI：每次渲染后执行贪心折叠（含窗口/列宽变化后的重渲染）
      // v1.5 T10 提速：按内容指纹跳过 —— 仅快照内容/tab/过滤变化才重排（refreshing 态等无关渲染不触发布局测量）
      React.useLayoutEffect(function () {
        const fp = String((st.snapshot && st.snapshot.generatedMs) || '') + '|' + st.tab + '|' + st.stateFilter + '|' + (st.lblFilters || []).join(',')
        if (_tagsFpOf.get(st) === fp) return
        _tagsFpOf.set(st, fp)
        fitAllTags()
      })
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' })
      const closedIssues = issues.filter(function (x) { return x.state === 'CLOSED' })
      // #374：多维排序 —— map 行恒置顶，map 组与普通组各自按所选维度排序；默认 更新时间↓（与现状一致）
      const sortIssues = function (arr) {
        const dir = st.sortDir === 'asc' ? 1 : -1
        return arr.slice().sort(function (a, b) {
          let c
          if (st.sortKey === 'number') { c = a.number - b.number; if (c !== 0) return dir * c }
          else if (st.sortKey === 'title') {
            c = String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase())
            if (c !== 0) return dir * c
          } else {
            c = String(a[st.sortKey] || '').localeCompare(String(b[st.sortKey] || ''))
            if (c !== 0) return dir * c
          }
          return a.number - b.number  // 同键兜底：编号升序（稳定）
        })
      }
      const isMapIssue = function (x) { return (x.labels || []).some(function (l) { return l.name === 'wayfinder:map' }) }
      const sortedMaps = sortIssues(openIssues.filter(isMapIssue))
      const sortedOpen = sortIssues(openIssues.filter(function (x) { return !isMapIssue(x) }))
      const closedSorted = sortIssues(closedIssues)
      const groups = compute(st)
      const occ = groups.reduce(function (n, g) { return n + g.blocked.length + g.claimed.length }, 0)
      const cs = activeChecks(st)
      const nBad = cs.filter(function (c) { return c.level === 'bad' }).length
      // 标签统计（open + closed 全量）与配色
      const stat = {}
      const colorOf = {}
      issues.forEach(function (x) {
        (x.labels || []).forEach(function (l) {
          stat[l.name] = (stat[l.name] || 0) + 1
          if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color
        })
      })
      const tagNames = Object.keys(stat).sort(function (a, b) { return stat[b] - stat[a] })
      // #375：全量 label（快照 labels 字段优先；旧快照无该字段降级 issue 统计）；配色并入 label 列表色
      const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : null
      if (snapLabels) snapLabels.forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
      const labelNames = snapLabels ? snapLabels.map(function (l) { return l.name }) : tagNames.slice()
      // 点击记忆双键排序：次数降序 → 最近点击降序 → 出现频次降序 → 名称序
      const sortedLabels = labelNames.slice().sort(function (a, b) {
        const ca = labelClicks[a], cb = labelClicks[b]
        const na = ca ? ca.n : 0, nb = cb ? cb.n : 0
        if (na !== nb) return nb - na
        const ta = ca ? ca.ts : 0, tb = cb ? cb.ts : 0
        if (ta !== tb) return tb - ta
        const fa = stat[a] || 0, fb = stat[b] || 0
        if (fa !== fb) return fb - fa
        return String(a).localeCompare(String(b))
      })
      // v15-26：主列表关联 map 子票阻塞信息（open 阻塞者才算阻塞；数据来自快照 maps.tickets.blockedBy，无需额外请求）
      const blockOf = {}
      ;(st.snapshot && st.snapshot.maps || []).forEach(function (m) {
        const byNum = {}
        m.tickets.forEach(function (t) { byNum[t.number] = t })
        m.tickets.forEach(function (t) {
          if (!t.blockedBy || !t.blockedBy.length) return
          const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
          if (openBlockers.length) blockOf[t.number] = { map: m.number, mapTitle: m.title, by: openBlockers }
        })
      })
      // #374：状态过滤（全部/Open/阻塞/已关闭）与 label 过滤叠加
      // v1.3.3 T3：blocked 过滤真正实现 —— open 且存在 open 阻塞者（blockOf 命中）
      const showOpen = st.stateFilter !== 'closed'
      const showClosedList = st.stateFilter === 'closed'
      // v1.5：多选标签过滤（OR 语义：命中任一选中标签即显示）
      const byLabel = function (x) {
        const ls = st.lblFilters || []
        if (!ls.length) return true
        return (x.labels || []).some(function (l) { return ls.indexOf(l.name) >= 0 })
      }
      const openRows = sortedMaps.concat(sortedOpen)
      const openFiltered = (st.lblFilters && st.lblFilters.length) ? openRows.filter(byLabel) : openRows
      // v1.3.3 #6：阻塞 = 被占用口径（isOccupied：有 assignee 或存在 open 阻塞者）——与 KPI「占用 N」一致，
      //   用户点「阻塞」应筛出全部被占用项（此前 blockOf 只覆盖 map 子票的 blockedBy，漏掉 assignee 占用的）
      const filteredOpen = showOpen ? (st.stateFilter === 'blocked' ? openFiltered.filter(function (x) { return isOccupied(st, x) })
        : (st.stateFilter === 'frontier' ? openFiltered.filter(function (x) { return !isOccupied(st, x) }) : openFiltered)) : []
      const filteredClosed = showClosedList ? ((st.lblFilters && st.lblFilters.length) ? closedSorted.filter(byLabel) : closedSorted) : []
      const has = function (x, nm) { return (x.labels || []).some(function (l) { return l.name === nm }) }
      const findMap = function (num) { return (st.snapshot && st.snapshot.maps || []).find(function (m) { return m.number === num }) }
      const openBlocked = function (blk) { st.activeMap = blk.map; emit(st) }
      // v14-18：chips 常显深一档边框（边框色 = label 色 HSL 亮度 -16%）
      const chip = (nm, withCount, on, isAll) => {
        const c = colorOf[nm]
        const borderColor = isAll ? 'rgba(255,255,255,.35)' : (darken(c, 0.16) || 'rgba(188,140,255,.6)')
        const selColor = isAll ? 'rgba(255,255,255,.65)' : (c ? '#' + c : '#bc8cff')
        return h('span', {
          key: nm,
          className: 'dsws-chip',
          // v14-1：「全部」恒清空过滤并保持选中，与普通标签 toggle 语义分离
          // #375：点选即记点击记忆（次数 + 最近点击时间，双键排序）
          onClick: function (e) {
            e.stopPropagation()
            // v1.5：多选 toggle —— 选中/取消单个标签，互不覆盖
            const cur = st.lblFilters || []
            st.lblFilters = isAll ? [] : (cur.indexOf(nm) >= 0 ? cur.filter(function (x) { return x !== nm }) : cur.concat([nm]))
            if (!isAll) {
              const c = labelClicks[nm] || { n: 0, ts: 0 }
              labelClicks[nm] = { n: c.n + 1, ts: Date.now() }
              saveLabelClicks()
            }
            emit(st)
          },
          style: {
            cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10,
            background: isAll ? 'rgba(255,255,255,.08)' : (hexA(c, 0.18) || 'rgba(188,140,255,.16)'),
            color: isAll ? 'var(--dsw-alias-label-secondary,#a1a1aa)' : (c ? '#' + c : '#bc8cff'),
            border: '1px solid ' + (on ? selColor : borderColor),
          },
        }, nm)
      }
      const copyUrl = function (x) { copyText(st, 'https://github.com/' + repoStr(st) + '/issues/' + x.number, tr('toast.copiedLink', { n: x.number })) }
      // v14-4：行级动作按 label 四选一（诊断/修复/讨论/执行），全部预填输入框；
      // v19：共享 mkRowAction（列表与 map 详情同逻辑，按钮色动态取 label 配置色）；v14-3 按钮 80%；v14-19 窄屏折叠为纯图标
      // v1.3.3 UI 定稿（用户逐版确认）：两行结构 · 卡片风（C）· 编号/map 竖排（idcol）·
      //   行1 = 编号(上)+map徽章(下) 竖排 + 标题(占满,限2行) + 迷你圆环进度(右上)；
      //   行2 = 标签单行贪心折叠（宽多窄少,最少1个,放不下进 +N 弹窗）+ 按钮组（执行/完成/新会话常显,复制/外链 hover）
      //   +N 弹窗：fixed 定位,基准=面板容器,clamp 左右不越界,内容完整可见（用户验收 A 方案）
      const ringOf = function (stats) {
        const total = stats.total || 0, closed = stats.closed || 0
        const pct = total ? Math.round(closed / total * 100) : 0
        const C = 2 * Math.PI * 7
        const off = C * (1 - pct / 100)
        const color = pct >= 100 ? '#4ade80' : '#bc8cff'
        return h('span', { className: 'dsws-ring' }, [
          h('svg', { width: 18, height: 18, viewBox: '0 0 18 18' }, [
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: 'rgba(255,255,255,.12)', strokeWidth: 2.4 }),
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round', strokeDasharray: String(C), strokeDashoffset: String(off) }),
          ]),
          h('span', { className: 'dsws-ring-txt', style: { color: color } }, closed + '/' + total),
        ])
      }
      const issueRow = function (x, isOpen, narrow) {
        const isMap = has(x, 'wayfinder:map')
        const mapObj = isMap ? findMap(x.number) : null
        // v15-26：被阻塞判定（open 阻塞者）→ 隐藏动作按钮 + 红色「被阻塞」标签（点击跳所属 map 详情）
        const blk = blockOf[x.number]
        const blocked = !!(blk && blk.by && blk.by.length)
        // v1.3.3 #8：map 行完成态 —— 子票全关（total>0 且 closed===total）→ 主按钮切「完成」（绿），注入收尾确认 prompt
        const mapDone = !!(isMap && mapObj && mapObj.stats && mapObj.stats.total > 0 && mapObj.stats.closed === mapObj.stats.total)
        // v1.5：编号徽章颜色 = 右侧动作按钮同一逻辑（label 色；map 完成态绿）
        const numColor = mapDone ? '#3fb950' : actionColorOf(x, colorOf)
        // v1.3.3 UI：全部标签渲染（渲染后贪心折叠，放不下的隐藏进 +N；+N 弹窗显示全部）
        const labels = x.labels || []
        const allNames = labels.map(function (l) { return l.name }).join('、')
        const openPop = function (e) {
          e.stopPropagation()
          const trig = e.currentTarget
          const host = trig.closest('.dsws-panel') || trig.closest('[data-dsws-host]')
          showPop(trig, host, labels, x.title)
        }
        // R5：变化行视觉（变更琥珀渐隐 / 新增绿闪）
        const _flashCls = (st.rowFlash && st.rowFlash[x.number]) ? (st.rowFlash[x.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed') : ''
        return h('div', {
          key: x.number,
          className: 'dsws-aggrow' + _flashCls,
          onClick: function () { if (isMap && mapObj) { st.activeMap = x.number; emit(st) } },
          title: (isMap && mapObj) ? tr('list.mapTitle') : undefined,
          style: isMap ? { cursor: 'pointer', borderLeft: '3px solid #c084fc', background: 'rgba(188,140,255,.07)' } : undefined,
        }, [
          // 行1：idcol 竖排（编号上 map 徽章下）+ 标题 + 圆环进度
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%' } }, [
            h('span', { className: 'dsws-idcol' }, [
              isMap ? h('span', { className: 'dsws-chip dsws-chip-m', style: { fontSize: 11, fontWeight: 600, lineHeight: 1.7, padding: '0 8px' } }, [Ic({ n: 'map', size: 11 }), h('span', null, tr('list.mapChip'))]) : null,
              h('span', { className: 'dsws-idnum', style: { color: numColor, borderColor: numColor } }, '#' + x.number),
            ]),
            h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontWeight: isMap ? 600 : undefined, color: isOpen ? undefined : 'var(--dsw-alias-label-secondary,#a1a1aa)' }, title: x.title }, x.title),
            (isMap && mapObj && mapObj.stats) ? ringOf(mapObj.stats) : null,
            !isOpen ? h('span', { className: 'dsws-chip', style: { fontSize: 10, marginRight: 0, flex: 'none', background: 'rgba(139,139,149,.12)', color: '#8b8b95', border: '1px solid rgba(139,139,149,.35)' } }, [Ic({ n: 'check', size: 9 }), h('span', null, tr('map.subClosed'))]) : null,
          ]),
          // 行2：标签贪心折叠（单行不换行）+ 按钮组（常显）
          h('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, width: '100%' } }, [
            h('div', { className: 'dsws-tags', 'data-dsws-labels': JSON.stringify(labels.map(function (l) { return l.name })) }, [
              labels.map(function (l, i) {
                return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA(l.color, 0.18) || 'rgba(188,140,255,.16)', color: l.color ? '#' + l.color : '#bc8cff', border: '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)') } }, l.name)
              }),
              labels.length > 0 ? h('span', { key: 'more', className: 'dsws-chip dsws-more', onClick: openPop, title: tr('list.tagsTitle', { names: allNames }) }, '+0') : null,
              blocked ? h('span', { key: 'blk', className: 'dsws-chip dsws-blocked', onClick: function (e) { e.stopPropagation(); openBlocked(blk) }, title: tr('list.blockedTitle', { by: blk.by.map(function (b) { return '#' + b }).join('、') }), style: { fontSize: 10, background: 'rgba(248,113,113,.16)', color: '#f87171', border: '1px solid rgba(248,113,113,.55)', cursor: 'pointer' } }, [Ic({ n: 'lock', size: 10 }), h('span', null, tr('list.blocked'))]) : null,
            ]),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', marginLeft: 'auto' } }, [
              isOpen && !blocked ? h('div', { style: { display: 'flex', gap: 3, alignItems: 'center', flex: 'none' } }, [
                mapDone
                  ? h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''), title: tr('map.doneTitle'), onClick: function (e) {
                      e.stopPropagation()
                      const text = completePrompt(st, x.number, mapObj.stats.total, mapObj.stats.closed)
                      inject(st, text)
                    }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [Ic({ n: 'check', size: 10 }), narrow ? null : h('span', null, tr('act.done'))])
                  : mkRowAction(st, x, narrow, colorOf),
                h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''), onClick: function (e) { e.stopPropagation(); openInNewSession(st, x) }, title: tr('list.newSessionLabel'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: mapDone ? '#3fb950' : actionColorOf(x, colorOf), borderColor: 'transparent', color: mapDone ? '#0c1a10' : (isLightHex(actionColorOf(x, colorOf)) ? '#140a1e' : '#ffffff') } }, [Ic({ n: 'external-link', size: 10 }), narrow ? null : h('span', null, tr('list.newSessionLabel'))]),
              ]) : null,
              isOpen ? h('div', { className: 'dsws-aux', style: { display: 'flex', gap: 2, alignItems: 'center', flex: 'none' } }, [
                // v1.3.3：复制/外链图标增大 11 → 13
                h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); copyUrl(x) }, title: tr('list.copyLinkTitle'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 })),
                h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: x.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + x.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 })),
              ]) : null,
            ]),
          ]),
        ])
      }
      const kpi = (num, lab, icon, color) => h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [Ic({ n: icon, size: 11, color: color }), h('span', null, String(num) + ' ' + lab)])
      return h('div', null, [
        // v1.5：已选标签过滤条（仅标签 · 颜色 = 该标签配置色 · 点 ✕ 关闭）
        (st.lblFilters && st.lblFilters.length) ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 } }, [
          h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none' } }, tr('list.filterActive')),
          (st.lblFilters || []).map(function (nm) {
            const c = colorOf[nm]
            const hex = c ? '#' + c : '#bc8cff'
            return h('span', { key: 'f-label-' + nm, className: 'dsws-chip', style: { fontSize: 10, background: hexA(c, 0.18) || 'rgba(188,140,255,.16)', color: hex, border: '1px solid ' + (darken(c, 0.16) || 'rgba(188,140,255,.6)') } }, [
              nm,
              h('span', { onClick: function (e) { e.stopPropagation(); st.lblFilters = (st.lblFilters || []).filter(function (x) { return x !== nm }); emit(st) }, style: { cursor: 'pointer', marginLeft: 4, fontWeight: 700 } }, '✕'),
            ])
          }),
          h('span', { key: 'f-label-clear', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.lblFilters = []; emit(st) }, style: { fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid rgba(255,255,255,.15)' } }, tr('list.filterClear')),
        ]) : null,
        // T2 #35 · 首屏最优先红卡（ListTab 顶部 · KPI 之上 · 唯一闸门 checkRepo:bad && !dismissed）
        h(NoRepoCard, { st: st }),
        // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap', position: 'relative' } }, [
          kpi(frontierCount(st), tr('list.kpi.takeable'), 'target', '#4ade80'),
          kpi(occCount(st), tr('list.kpi.occupied'), 'lock', '#f0883e'),
          kpi(closedIssues.length, tr('list.kpi.closed'), 'check', '#52525b'),
          h('span', { style: { flex: 1 } }),
          // T2 #2：刷新按钮已上移至 OverlayPanel tabs 行（L1932）
        ]),
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); if (cr && cr.level === 'bad' && !isNoRepoDismissed(st.cwd)) return null; return nBad > 0 ? h('div', { className: 'dsws-banner bad', onClick: function () { st.tab = 'checks'; emit(st) } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('list.envWarn', { n: nBad }))]) : null })(),
        // #374/#375：状态过滤 + 排序 + label 过滤 chips（全部小号紧凑同排，窄屏换行不增高；展开态点选 label 不收起）
        h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0, marginBottom: 6 } }, [
          ['all', 'open', 'closed', 'blocked', 'frontier'].map(function (k) {
            const on = st.stateFilter === k
            return h('span', { key: 'stf-' + k, className: 'dsws-chip', onClick: function (e) {
              e.stopPropagation(); st.stateFilter = k; listPrefs.stateFilter = k; saveListPrefs(); emit(st)
            }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(188,140,255,.18)' : 'rgba(255,255,255,.06)', color: on ? '#c084fc' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(188,140,255,.6)' : 'rgba(255,255,255,.15)') } }, tr('list.state.' + k))
          }),
          h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
          ['updatedAt', 'createdAt', 'number', 'title'].map(function (k) {
            const on = st.sortKey === k
            const arrow = on ? (st.sortDir === 'asc' ? '↑' : '↓') : ''
            return h('span', { key: 'srt-' + k, className: 'dsws-chip', onClick: function (e) {
              e.stopPropagation()
              if (st.sortKey === k) { st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc' }
              else { st.sortKey = k; st.sortDir = (k === 'title') ? 'asc' : 'desc' }
              listPrefs.sortKey = st.sortKey; listPrefs.sortDir = st.sortDir; saveListPrefs(); emit(st)
            }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(88,166,255,.16)' : 'rgba(255,255,255,.06)', color: on ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(88,166,255,.55)' : 'rgba(255,255,255,.15)') } }, tr('list.sort.' + k) + arrow)
          }),
          h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
          chip(tr('list.all'), false, !st.lblFilters || !st.lblFilters.length, true),
          // #405：filter row 默认可见数 9 → 4（与 per-row 一致）；+N 触发条件 + 数字同步
          (st.expLabels ? sortedLabels : sortedLabels.slice(0, 4)).map(function (nm) { return chip(nm, true, (st.lblFilters || []).indexOf(nm) >= 0, false) }),
          (!st.expLabels && sortedLabels.length > 4) ? h('span', { key: 'lbl-more', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = true; emit(st) }, title: tr('list.tagsTitle', { names: sortedLabels.join('、') }), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px dashed rgba(188,140,255,.55)', cursor: 'pointer' } }, '+' + (sortedLabels.length - 4)) : null,
          st.expLabels ? h('span', { key: 'lbl-less', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = false; emit(st) }, title: tr('list.tagsCollapseTitle'), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-caption,#8b8b95)', border: '1px dashed rgba(255,255,255,.3)', cursor: 'pointer' } }, tr('list.collapse')) : null,
        ]),
        // T3 #5：加载遮罩（替代单行文本，全屏遮罩 + 转圈 + 禁点）
        // v1.3.3 修复：加载遮罩仅首开无数据时显示（手动刷新已走静默路径，不再叠加）
        // #58 缓存优先：已有快照（本 store 或 per-cwd 缓存）时不显示全屏 loading，秒开旧列表 + 后台静默刷新
        (st.snapMode === 'loading' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { className: 'dsws-loading-shade', style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 5, pointerEvents: 'auto' } }, [
          h('div', { className: 'dsws-spinner' }),
          h('span', { style: { fontSize: 12, color: '#e6edf3' } }, tr('list.loading')),
        ]) : null,
        (st.snapMode === 'err' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { style: { color: '#f87171', fontSize: 12, padding: '14px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 12 }), h('span', null, tr('list.errFull', { err: st.snapError }))]) : null,
        st.snapMode === 'real' && st.snapshot && st.snapshot.fallback === 'rest' ? h('div', { style: { color: '#f59e0b', fontSize: 11, padding: '6px 12px', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, background: 'rgba(245,158,11,.08)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('list.restFallback'))]) : null,
        // #374：状态过滤渲染 —— open 主体 / closed 列表 / 「全部」态保留已关闭折叠行
        showOpen ? (filteredOpen.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredOpen.map(function (x) { return issueRow(x, true, narrow) })) : null,
        showClosedList ? (filteredClosed.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredClosed.map(function (x) { return issueRow(x, false, narrow) })) : null,
        // v14-4⑤：列表底部「已关闭 (N)」折叠行（仅「全部」状态显示；默认收起，只占一行，展开可见）
        (st.stateFilter === 'all' && closedIssues.length) ? h('details', { style: { marginTop: 8 } }, [
          h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 2px', userSelect: 'none' } }, [
            Ic({ n: 'check', size: 11 }),
            h('span', null, tr('list.closedN', { n: closedIssues.length })),
          ]),
          h('div', null, closedSorted.map(function (x) { return issueRow(x, false, narrow) })),
        ]) : null,
      ])
    }

    // ---- 5.6 技能雷达（定稿 4A 推荐+列表 · 4B 圆形技能环，A/B 切换）----
    const RingSkills = ({ st, rec, list }) => {
      const cx = 110, cy = 108, R2 = 88
      const center = rec[0] || 'ask-matt'
      const ring = list.filter(function (sk) { return sk.name !== center }).slice(0, 8)
      const nodes = ring.map(function (sk, i) {
        const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2
        const x = cx + R2 * Math.cos(a), y = cy + R2 * Math.sin(a)
        const filled = sk.level === 'ok'
        return h('div', { key: sk.name, title: tr('skilldesc.' + sk.name), onClick: function () { inject(st, '/' + sk.name) }, style: { position: 'absolute', left: x - 15, top: y - 15, width: 30, height: 30, borderRadius: '50%', border: filled ? '2px solid #4ade80' : '2px solid #52525b', background: filled ? 'rgba(74,222,128,.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, cursor: 'pointer', color: filled ? '#4ade80' : '#8b8b95', lineHeight: 1.2, textAlign: 'center' } }, sk.name.length > 4 ? sk.name.slice(0, 4) + '…' : sk.name)
      })
      return h('div', null, [
        h('div', { style: { position: 'relative', width: 220, height: 220, margin: '0 auto 6px' } }, [
          h('div', { onClick: function () { inject(st, '/' + center) }, title: tr('skill.centerTitle', { skill: center }), style: { position: 'absolute', left: cx - 30, top: cy - 30, width: 60, height: 60, borderRadius: '50%', background: 'rgba(188,140,255,.18)', border: '2px solid #c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#c084fc', cursor: 'pointer', textAlign: 'center', lineHeight: 1.3 } }, '/' + center),
          nodes,
        ]),
        h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', textAlign: 'center', marginBottom: 8 } }, tr('skill.centerRing')),
        h('div', { className: 'dsws-grp' }, [Ic({ n: 'compass', size: 12 }), h('span', null, tr('skill.all'))]),
        list.map(function (sk) {
          const on = rec.indexOf(sk.name) >= 0
          return h('div', { key: sk.name, className: 'dsws-skill', style: on ? { background: 'rgba(188,140,255,.12)', borderRadius: 6 } : null }, [
            Dot({ level: sk.level }),
            h('div', { className: 'dsws-tt' }, [
              h('div', { className: 'dsws-tt-name', style: on ? { color: '#c084fc' } : null }, [h('span', null, '/' + sk.name), on ? Ic({ n: 'star', size: 11, color: '#c084fc' }) : null]),
              h('div', { className: 'dsws-tt-sub dsws-ellip', title: tr('skilldesc.' + sk.name) }, tr('skilldesc.' + sk.name)),
            ]),
            h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + sk.name) } }, tr('act.load')),
          ])
        }),
      ])
    }

    const SkillsTab = ({ st }) => {
      const groups = compute(st)
      let rec = []
      let recTitle = tr('skill.generic')
      if (st.activeMap !== null) {
        const g = groups.find(function (x) { return x.m.number === st.activeMap })
        if (g && /research/.test(g.m.notes)) rec = ['research']
        if (g && /grill/.test(g.m.notes)) rec = ['grilling', 'domain-modeling']
        recTitle = tr('skill.notes', { m: g.m.title })
      }
      if (!rec.length) rec = ['ask-matt']
      const list = SKILLS.map(function (sk) {
        const on = rec.indexOf(sk.name) >= 0
        return h('div', { key: sk.name, className: 'dsws-skill', style: on ? { background: 'rgba(188,140,255,.12)', borderRadius: 6 } : null }, [
          Dot({ level: sk.level }),
          h('div', { className: 'dsws-tt' }, [
            h('div', { className: 'dsws-tt-name', style: on ? { color: '#c084fc' } : null }, [
              h('span', null, '/' + sk.name),
              on ? Ic({ n: 'star', size: 11, color: '#c084fc' }) : null,
            ]),
            h('div', { className: 'dsws-tt-sub dsws-ellip', title: sk.use }, sk.use),
          ]),
          h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + sk.name) } }, tr('act.load')),
        ])
      })
      const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, [
        h('div', { className: 'dsws-grp', style: { margin: 0 } }, [Ic({ n: 'compass', size: 12 }), h('span', null, recTitle)]),
        h('span', { style: { flex: 1 } }),
        h('span', { className: 'dsws-seg' + (st.skillView === 'list' ? ' on' : ''), onClick: function () { st.skillView = 'list'; emit(st) }, style: { fontSize: 11 } }, tr('skill.list')),
        h('span', { className: 'dsws-seg' + (st.skillView === 'ring' ? ' on' : ''), onClick: function () { st.skillView = 'ring'; emit(st) }, style: { fontSize: 11 } }, tr('skill.ring')),
      ])
      if (st.skillView === 'ring') return h('div', null, [head, h(RingSkills, { st: st, rec: rec, list: SKILLS })])
      return h('div', null, [
        head,
        h('div', { style: { marginBottom: 8 } }, rec.map(function (r, i) {
          return h('span', { key: i, className: 'dsws-chip dsws-chip-m' }, '/' + r)
        })),
        list,
      ])
    }

    // ---- 5.7 环境检查（定稿 5A：横幅 + 红/黄/绿分组卡；v12 失败不兜假数据）----
    const ChecksTab = ({ st }) => {
      React.useEffect(function () { loadChecks(st, false) }, [])
      const cs = activeChecks(st)
      const bad = cs.filter(function (c) { return c.level === 'bad' })
      const warn = cs.filter(function (c) { return c.level === 'warn' })
      const ok = cs.filter(function (c) { return c.level === 'ok' })
      // #373：hint 支持两种形态 —— URL（可打开/复制）或 /命令（「用 /xxx 处理」按钮，保留兼容）
      const actBtn = (c) => {
        const hint = c.hint || ''
        // v1.5：prompt: 协议 —— 复制/注入一段引导 prompt 让 AI 执行（如技能安装引导）
        if (hint.indexOf('prompt:') === 0) {
          const ptext = hint.slice(7)
            // v1.6：prompt: 键名协议 —— 优先从 PROMPTS 注册表取双语文本（跟随语言），未知键回退原文
            const resolved = promptText(ptext) || ptext
          return h('button', { className: 'dsws-btn', onClick: function () { inject(st, resolved) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('env.installBtn'))
        }
        if (/^https?:\/\//i.test(hint)) {
          return h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
            h('a', { href: hint, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('env.openUrl'))]),
            h('button', { className: 'dsws-btn', onClick: function () { copyText(st, hint, tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('env.copyUrl'))]),
          ])
        }
        const m = hint.match(/\/([a-z0-9-]+)/i)
        if (!m) return null
        return h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + m[1]) } }, tr('skill.treat', { s: m[1] }))
      }
      const card = (c) => h('div', { key: c.id, className: 'dsws-ccard' }, [
        h('div', { className: 'nm' }, c.name),
        h('div', { className: 'dt dsws-ellip', title: c.detail }, c.detail),
        c.hint ? h('div', { className: 'act' }, [actBtn(c)]) : null,
      ])
      const grp = (title, color, items) => items.length ? h('div', null, [
        h('div', { className: 'dsws-cgroup' }, [h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' } }), h('span', null, title + ' ' + items.length)]),
        items.map(card),
      ]) : null
      // 环境检查页顶部横幅（用户拍板 2026-08-16 + 2026-08-17：依赖链 gh → 登录 → setup → 技能，显示第一个缺失项）
      const ghCli2 = activeChecks(st).find(function (c) { return c.id === 4 })
      const ghAuth2 = activeChecks(st).find(function (c) { return c.id === 5 })
      const skillsCheck2 = activeChecks(st).find(function (c) { return c.id === 9 })
      const setupCheck2 = activeChecks(st).find(function (c) { return c.id === 2 })
      const skillsOk = !skillsCheck2 || skillsCheck2.level === 'ok'
      const setupOk = !setupCheck2 || setupCheck2.level === 'ok'
      const ghCliOk2 = !ghCli2 || ghCli2.level === 'ok'
      const ghAuthOk2 = !ghAuth2 || ghAuth2.level === 'ok'
      const topBanner = (!ghCliOk2)
        ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
            Ic({ n: 'alert', size: 13 }),
            h('span', { style: { flex: 1 } }, tr('banner.ghcli')),
            h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { openUrl('https://cli.github.com/') } }, tr('banner.ghcliBtn')),
          ])
        : (!ghAuthOk2)
          ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
              Ic({ n: 'alert', size: 13 }),
              h('span', { style: { flex: 1 } }, tr('banner.ghauth')),
              h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { openUrl('https://cli.github.com/manual/gh_auth_login') } }, tr('banner.ghauthBtn')),
            ])
          : (!setupOk)
            ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                Ic({ n: 'alert', size: 13 }),
                h('span', { style: { flex: 1 } }, tr('banner.setup')),
                h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { inject(st, promptText('setupRun')) } }, tr('banner.setupBtn')),
              ])
            : (!skillsOk)
              ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                  Ic({ n: 'star', size: 13 }),
                  h('span', { style: { flex: 1 } }, tr('banner.skills', { list: (skillsCheck2 && skillsCheck2.detail) || '' })),
                  h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(188,140,255,.55)' }, onClick: function () { inject(st, promptText('installSkills')) } }, tr('banner.skillsBtn')),
                ])
              : null
      // v1.5 配置引导顺序区（用户拍板 2026-08-17）：依赖链 1-2-3-4，完成自动勾选
      const okOf = function (c) { return !c || c.level === 'ok' }
      const guideSteps = [
        { done: okOf(ghCli2), label: tr('env.g1'), act: function () { openUrl('https://cli.github.com/') }, btn: tr('banner.ghcliBtn') },
        { done: okOf(ghAuth2), label: tr('env.g2'), act: function () { openUrl('https://cli.github.com/manual/gh_auth_login') }, btn: tr('banner.ghauthBtn') },
        { done: okOf(setupCheck2), label: tr('env.g3'), act: function () { inject(st, promptText('setupRun')) }, btn: tr('banner.setupBtn') },
        { done: okOf(skillsCheck2), label: tr('env.g4'), act: function () { inject(st, promptText('installSkills')) }, btn: tr('banner.skillsBtn') },
      ]
      const guideAll = guideSteps.every(function (s) { return s.done })
      const guideBlock = guideAll ? null : h('div', { className: 'dsws-ccard', style: { marginBottom: 8 } }, [
        h('div', { className: 'dsws-cgroup' }, [h('span', { style: { fontWeight: 600 } }, tr('env.guide'))]),
        guideSteps.map(function (s, i) {
          return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' } }, [
            h('span', { style: { width: 16, height: 16, borderRadius: '50%', border: '1px solid ' + (s.done ? '#4ade80' : '#8b8b95'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: s.done ? '#4ade80' : 'transparent', flex: 'none' } }, s.done ? '\u2713' : String(i + 1)),
            h('span', { style: { flex: 1 } }, s.label),
            s.done ? null : h('button', { className: 'dsws-btn', onClick: s.act, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, s.btn),
          ])
        }),
      ])
      return h('div', null, [
        topBanner,
        guideBlock,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 } }, [
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'gear', size: 12 }), h('span', null, tr('env.title', { n: envLabel(st) }))]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn', disabled: st.checking || st.refreshing, onClick: function () { refreshAll(st) }, style: { fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            h('span', { className: 'dsws-rficon' + ((st.checking || st.refreshing) ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]),
            h('span', null, tr('env.recheck')),
          ]),
        ]),
        // T2 #35 · ChecksTab 弱化：红卡显示时 checkRepo:bad 行弱化为“已在首屏引导 · 切换到 ListTab 完成”；dismiss 后提供“重置忽略”入口
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); if (!showRed) return null; return h('div', { className: 'dsws-ccard', style: { opacity: 0.85, borderColor: 'rgba(139,139,149,.35)', background: 'rgba(139,139,149,.08)', marginBottom: 6 } }, [h('div', { className: 'nm', style: { color: '#8b8b95' } }, cr.name), h('div', { className: 'dt', style: { color: '#8b8b95' } }, tr('panel.noRepoCardDone')), h('div', { className: 'act' }, [h('button', { className: 'dsws-btn', onClick: function () { st.tab = 'list'; emit(st) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('panel.tabList'))])]) })(),
        (function () { const dismissed = isNoRepoDismissed(st.cwd); if (!dismissed) return null; const cr = cs.find(function (c) { return c.id === 1 }); if (!cr || cr.level !== 'bad') return null; return h('div', { className: 'dsws-ccard', style: { borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.06)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 } }, [h('span', { style: { fontSize: 11, color: '#f87171', flex: 1 } }, tr('panel.noRepoCardDismiss') + ' · ' + (cr.detail || '')), h('button', { className: 'dsws-btn', onClick: function () { setNoRepoDismissed(st.cwd, false); emit(st) }, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, tr('panel.noRepoReset'))]) })(),
        st.checksMode === 'err' ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.failFull', { err: st.checksError }))]) : null,
        st.checksMode === 'loading' ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, marginBottom: 6 } }, tr('env.detecting')) : null,
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; const cnt = displayBad.length; return cnt ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.missingBanner', { n: cnt }))]) : null })(),
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; return grp(tr('env.missing'), '#f87171', displayBad) })(),
        grp(tr('env.partial'), '#f59e0b', warn),
        grp(tr('env.ready'), '#4ade80', ok),
      ])
    }

    // ---- 5.8b 右侧停靠（details 槽位 · 三视图完整内容；开合/拖拽/宽度记忆由壳管理）----
    // 契约：details 槽 = 壳右侧第三列（AppFrame grid），scope session；关闭 = ctx.layout.closeDetails()
    //   （占位者 props 亦注入 closeDetails）；宽度 300-520px 可拖拽；关闭时子树不卸载（状态保留）。
    // issue #15：tabs 行内容放不下时折叠为纯图标（内容自适应 + 滞回防抖）
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
    const DetailsDock = (props) => {
      // #45 回归（2026-08-20 续）：切绘画/工作区后右面板串台
      // 根因：原 DetailsDock 仅在挂载时跑一次副作用（deps []），且直接取 props.sessionId（details 槽位在宿主里常为空 → 退回 shared 单例），
      //   导致：① 切绘画（sessionId 变化）不重跑水合/加载，旧绘画的 polluted snapshot 常驻；② 非 current 工作区的 snapshot 经 shared 广播后，details 常显 shared.cwd（首工作区）快照。
      // 修复：① 用 props.useSessions 权威信号跟随当前会话（hookCurrent）与精确 cwd（summaryCwd），props.sessionId / scope.sessionId 优先；② 副作用 deps 改为 [sid]/[sid,summaryCwd]，切绘画即触发 cwd 同步 + 水合；③ 空 deps 根除。
      const hookCurrent = (props && typeof props.useSessions === 'function') ? props.useSessions(function (x) { return x.current }) : undefined
      const propSid = props && (props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id))
      const sid = propSid || hookCurrent
      const summaryCwd = (props && typeof props.useSessions === 'function' && sid) ? props.useSessions(function (x) { return (x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined }) : undefined
      const s = useStore(sid)
      const layoutSvc = ctx.get('layout')
      const dockRef = React.useRef(null)
      const [dw, setDw] = React.useState(460)
      // 列宽感知：details 列 300-520px；窄于 380 时动作按钮折叠为纯图标（与悬浮面板同阈值）
      React.useEffect(function () {
        if (!dockRef.current) return
        const el = dockRef.current
        const ro = new ResizeObserver(function (entries) {
          try { setDw(entries[0].contentRect.width) } catch (e) { /* 忽略 */ }
        })
        ro.observe(el)
        return function () { try { ro.disconnect() } catch (e) { /* 忽略 */ } }
      }, [])
      // 响应式工作区同步（对齐 StatusBar）：当 host 权威的 summaryCwd / session 变化，立即把 s.cwd 切到正确工作区并水合 per-cwd 缓存
      React.useEffect(function () {
        const apply = function (cwd) {
          if (cwd && cwd !== s.cwd) {
            s.cwd = cwd
            const hydrated = hydrateFromCache(s)
            emit(s)
            loadChecks(s, false)
            if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
          }
        }
        if (summaryCwd) { apply(summaryCwd); return }
        const cwd0 = detectCwd(props && props.session)
        if (cwd0) { apply(cwd0); return }
        if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
          host.call('wf.cwd', { sessionId: sid }).then(function (res) {
            if (res && res.ok && res.cwd) apply(res.cwd)
          }).catch(function () { /* 保持现有 cwd */ })
        }
      }, [sid, summaryCwd])
      // 初始数据：随 sid 变化重跑（修复空 deps 导致切绘画不刷新；含 per-cwd 水合秒开 + 污染残留自愈）
      React.useEffect(function () {
        if (!s.cwd) {
          const sync = getCwdSync(sid)
          if (sync) { s.cwd = sync; hydrateFromCache(s) }
        } else { hydrateFromCache(s) }
        // 污染自愈：若当前 store 的 snapshot 仍是之前工作区串台残留（repoRoot 与 cwd 前缀不匹配，或 repo 名与 cwd 尾段不一致），强制后台刷新
        const isPolluted = (function(){
          if (!s.snapshot || !s.cwd) return false
          const snap = s.snapshot
          if (snap.repoRoot) {
            const rr = String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,'')
            const cw = String(s.cwd).replace(/\\/g,'/').replace(/\/+$/,'')
            if (cw === rr) return false
            if (cw.startsWith(rr + '/')) return false
            if (rr.startsWith(cw + '/')) return false
            return true
          }
          if (snap.repo && snap.repo.name) {
            const base = cwdBasename(s.cwd)
            if (base && snap.repo.name !== base) {
              // 仅当 repoRoot 缺失时用 basename 辅助判断，避免子目录 repo 名与目录名不一致误判；此处放宽：不同名且不同 cwd 即视为可疑
              // 保守：若 cwdBasename 与 repo.name 完全不同且 snapshot 非空，视为污染
              return true
            }
          }
          return false
        })()
        if (isPolluted) { loadSnapshot(s, false); loadChecks(s, false); return }
        if (!snapFresh(s)) loadSnapshot(s, false); loadChecks(s, false)
      }, [sid])
      const closeDock = function () {
        if (props && typeof props.closeDetails === 'function') props.closeDetails()
        else if (layoutSvc && typeof layoutSvc.closeDetails === 'function') layoutSvc.closeDetails()
      }
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      const narrow = dw < 380
      const tabsRef = React.useRef(null)
      const headRef = React.useRef(null)
      const [tabTip, setTabTip] = React.useState(null)
      React.useEffect(function () {
        const applyFold = function () {
          const t = tabsRef.current
          if (!t) return
          const btns = t.querySelectorAll('[data-priority]')
          const ver = t.querySelector('.dsws-ver')
          // 测量阶段临时禁用 transition（max-width 动画会污染 scrollWidth 测量 → 0/6 抖动）
          t.classList.add('dsws-no-anim')
          // 1) 全展开 + 强制 reflow（拿到"内容真实放得下"的基准）
          for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
          if (ver) ver.classList.remove('collapsed')
          void t.offsetWidth
          // 2) 从最不重要（priority 大）逐个折叠，直到放得下（scrollWidth 溢出判定）
          const items = Array.from(btns)
            .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
            .sort(function (a, b) { return b.p - a.p })
          for (const it of items) {
            if (t.scrollWidth <= t.clientWidth + 1) break
            it.el.classList.add('collapsed')
            void t.offsetWidth
          }
          // 3) 版本号跟随「刷新」(priority=3) 折叠；记录折叠数供 tooltip 门控
          if (ver) {
            const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
            ver.classList.toggle('collapsed', !!refreshCollapsed)
          }
          t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
          t.classList.remove('dsws-no-anim')
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
        let observed = null
        const apply = function () {
          const t = tabsRef.current
          if (!t) return
          if (ro && observed !== t) {
            if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
            ro.observe(t)
            observed = t
          }
          applyFold()
        }
        apply()
        if (typeof window !== 'undefined') window.addEventListener('resize', apply)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
        return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
      }, [])
      // 头部自适应：空间充足时完整，挤压时先隐藏 MATT skills 文字（保留图标），最后仅留 repo（#28）
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : ''
          const short = repo ? repo.name : ''
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          // 基准：标题可见 + 完整仓库名（固宽测自然宽）
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 阶段1：隐藏标题，优先保仓库名
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 阶段2：极窄时仅留 repo
          if (full && short) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          // 仍放不下：允许 chip 弹性 ellipsis 收缩
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try {
          ro2 = new ResizeObserver(function () { applyHead() })
          if (headRef.current) ro2.observe(headRef.current)
        } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), dw])
      const tabsTip = function (e, text, priority) {
        const t = tabsRef && tabsRef.current
        setTabTip(null)
        if (!t || !text || typeof e === 'undefined') return
        // 门控：仅当该 priority 的按钮自身已折叠时才显示 tooltip（文字被藏、需悬浮提示）
        const btn = t.querySelector('[data-priority="' + priority + '"]')
        if (!btn || !btn.classList.contains('collapsed')) return
        if (typeof window === 'undefined') return
        const W = 238
        let x = e.clientX + 12, y = e.clientY + 12
        if (x + W > window.innerWidth) x = e.clientX - 12 - W
        setTabTip({ x: x, y: y, text: text })
      }
      const tabsTipOff = function () { setTabTip(null) }
      const tabBtn = (id, icon, label, priority) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
        Ic({ n: icon, size: 12 }),
        h('span', null, label),
      ])
      return h('div', { ref: dockRef, 'data-dsws-host': '1', className: narrow ? 'dsws-narrow' : undefined, style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--dsw-font-family)', fontSize: 12, color: 'var(--dsw-alias-label-primary,#e6edf3)', background: 'var(--dsw-alias-bg-layer-1,#10131a)' } }, [
        // 头部（标题 + 关闭）：横线不放在这行，下移到标签行下方与对话/轨迹对齐
        // #28 自适应：flex 容器 minWidth 0 + 芯片 flex 自适应，标题优先隐藏，极窄仅留 repo
        h('div', { ref: headRef, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px', flex: 'none', minWidth: 0 } }, [
          Icon({ scheme: 'compass', size: 15 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, fontSize: 13, flex: 'none', whiteSpace: 'nowrap' } }, tr('panel.title')),
          // v1.5 T7：仓库身份组件 —— 当前检测到的 git 仓库（owner/name），点击打开 GitHub
          (s.snapshot && s.snapshot.repo) ? h('a', { href: 'https://github.com/' + s.snapshot.repo.owner + '/' + s.snapshot.repo.name, target: '_blank', rel: 'noreferrer', title: tr('panel.repoTitle'), 'data-repo-chip': 1, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#58a6ff', background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.45)', borderRadius: 6, padding: '1px 8px', flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace' } }, [
            h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'currentColor', style: { flex: 'none' } }, [h('path', { d: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 8h8.5V1.5z' })]),
            h('span', { 'data-repo-text': 1, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapshot.repo.owner + '/' + s.snapshot.repo.name),
          ]) : h('span', { title: tr('panel.noRepoTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [
            Ic({ n: 'alert', size: 11 }),
            h('span', null, tr('panel.noRepo')),
          ]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: closeDock, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 6px', fontSize: 11 } }, Ic({ n: 'x', size: 12 })),
        ]),
        // 标签行下沿 = 与对话/轨迹一致的横线；右侧：刷新按钮 + 版本号（v1.3.3）
        h('div', { className: 'dsws-tabs', ref: tabsRef, style: { padding: '0 12px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', flex: 'none', display: 'flex', alignItems: 'center', gap: 4 } }, [
          tabBtn('list', 'list', tr('panel.tabList'), 4),
          tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
          tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
          h('span', { style: { flex: 1 } }),
          // v1.5 T6 修订（V2 描边紫 · 刷新左侧）：新增 wayfinder —— 注入 /wayfinder + 仓库信息 + 需求引导
          // issue #4：新增 BUG 单 —— 同构按钮（新会话预填 /wayfinder 新增 BUG 单 prompt）
          h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
            Ic({ n: 'map', size: 11 }),
            h('span', null, tr('panel.newWayfinder')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
            Ic({ n: 'bug', size: 11 }),
            h('span', null, tr('panel.newBug')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 3, onMouseMove: function (e) { tabsTip(e, tr('list.refresh'), 3) }, onMouseLeave: tabsTipOff, onClick: function () { refreshAll(s) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' } }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', null, tr('list.refresh'))]),
          (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
          h('span', { className: 'dsws-ver', style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION),
        ]),
        h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '10px 12px' } }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }

    // ---- 5.8 主面板（可拖动 · 8 向缩放 · 三视图 · v14 跟随当前会话 + 刷新遮罩）----
    const OverlayPanel = (props) => {
      const cur = props.useSessions((x) => x.current)
      const s = useStore(cur)
      const panelRef = React.useRef(null)
      const tabsRef = React.useRef(null)
      const headRef = React.useRef(null)
      const [tabTip, setTabTip] = React.useState(null)
      React.useEffect(function () {
        const applyFold = function () {
          const t = tabsRef.current
          if (!t) return
          const btns = t.querySelectorAll('[data-priority]')
          const ver = t.querySelector('.dsws-ver')
          // 测量阶段临时禁用 transition（max-width 动画会污染 scrollWidth 测量 → 0/6 抖动）
          t.classList.add('dsws-no-anim')
          // 1) 全展开 + 强制 reflow（拿到"内容真实放得下"的基准）
          for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
          if (ver) ver.classList.remove('collapsed')
          void t.offsetWidth
          // 2) 从最不重要（priority 大）逐个折叠，直到放得下（scrollWidth 溢出判定）
          const items = Array.from(btns)
            .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
            .sort(function (a, b) { return b.p - a.p })
          for (const it of items) {
            if (t.scrollWidth <= t.clientWidth + 1) break
            it.el.classList.add('collapsed')
            void t.offsetWidth
          }
          // 3) 版本号跟随「刷新」(priority=3) 折叠；记录折叠数供 tooltip 门控
          if (ver) {
            const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
            ver.classList.toggle('collapsed', !!refreshCollapsed)
          }
          t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
          t.classList.remove('dsws-no-anim')
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
        let observed = null
        const apply = function () {
          const t = tabsRef.current
          if (!t) return
          if (ro && observed !== t) {
            if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
            ro.observe(t)
            observed = t
          }
          applyFold()
        }
        apply()
        if (typeof window !== 'undefined') window.addEventListener('resize', apply)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
        return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
      }, [s.open])
      // 头部自适应（Overlay）：同 Dock 逻辑，空间充足完整，挤压先藏标题文字，最后仅留 repo（#28）
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd) return
          const titleEl = hd.querySelector('[data-head-title]')
          const chip = hd.querySelector('[data-repo-chip]')
          const txt = chip && chip.querySelector('[data-repo-text]')
          if (!titleEl || !chip || !txt) return
          const repo = s.snapshot && s.snapshot.repo
          const full = repo ? repo.owner + '/' + repo.name : (s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : '')
          const short = repo ? repo.name : full
          const isRepo = !!(repo && repo.owner && repo.name)
          const naturalFits = function () {
            try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
            return hd.scrollWidth <= hd.clientWidth + 1
          }
          titleEl.style.display = ''
          if (full) txt.textContent = full
          chip.style.flex = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          titleEl.style.display = 'none'
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          if (isRepo) txt.textContent = short
          void hd.offsetWidth
          if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
          chip.style.flex = '0 1 auto'
        }
        applyHead()
        let ro2 = null
        try { ro2 = new ResizeObserver(function () { applyHead() }); if (headRef.current) ro2.observe(headRef.current) } catch (e) {}
        const onWin = function () { applyHead() }
        if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
        return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
      }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), s.snapMode, s.size && s.size.w, s.open])
      // #376：加载由 openPanel 统一分派（未就绪/过期 force，新鲜直接展示）；此处不再重复加载
      if (!s.open) return null
      const groups = compute(s)
      const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
      // v14-19：窄屏阈值（面板宽 <380px 时动作按钮折叠为纯图标）
      const narrow = s.size.w < 380
      const tabsTip = function (e, text, priority) {
        const t = tabsRef && tabsRef.current
        setTabTip(null)
        if (!t || !text || typeof e === 'undefined') return
        // 门控：仅当该 priority 的按钮自身已折叠时才显示 tooltip（文字被藏、需悬浮提示）
        const btn = t.querySelector('[data-priority="' + priority + '"]')
        if (!btn || !btn.classList.contains('collapsed')) return
        if (typeof window === 'undefined') return
        const W = 238
        let x = e.clientX + 12, y = e.clientY + 12
        if (x + W > window.innerWidth) x = e.clientX - 12 - W
        setTabTip({ x: x, y: y, text: text })
      }
      const tabsTipOff = function () { setTabTip(null) }
      const tabBtn = (id, icon, label, priority) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
        Ic({ n: icon, size: 12 }),
        h('span', null, label),
      ])

      const startDrag = function (e) {
        if (typeof document === 'undefined' || typeof window === 'undefined') return
        if (!panelRef.current) return
        e.preventDefault()
        const rect = panelRef.current.getBoundingClientRect()
        const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, sx: e.clientX, sy: e.clientY }
        const mm = function (ev) { s.pos = { x: r0.x + ev.clientX - r0.sx, y: r0.y + ev.clientY - r0.sy }; emit(s) }
        const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
        document.addEventListener('mousemove', mm)
        document.addEventListener('mouseup', mu)
      }
      const onBodyDown = function (e) {
        if (e.target === e.currentTarget) startDrag(e)
      }

      const onResizeDown = function (dir) {
        return function (e) {
          e.stopPropagation()
          e.preventDefault()
          if (typeof document === 'undefined' || typeof window === 'undefined' || !panelRef.current) return
          const rect = panelRef.current.getBoundingClientRect()
          const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, w: s.size.w || rect.width, h: s.size.h || rect.height, sx: e.clientX, sy: e.clientY }
          const mm = function (ev) {
            const dx = ev.clientX - r0.sx, dy = ev.clientY - r0.sy
            let w = r0.w, h = r0.h
            if (dir.indexOf('e') >= 0) w = r0.w + dx
            if (dir.indexOf('s') >= 0) h = r0.h + dy
            if (dir.indexOf('w') >= 0) w = r0.w - dx
            if (dir.indexOf('n') >= 0) h = r0.h - dy
            w = Math.min(900, Math.max(340, w))
            h = Math.min(920, Math.max(240, h))
            let x = r0.x, y = r0.y
            if (dir.indexOf('w') >= 0) x = r0.x + (r0.w - w)
            if (dir.indexOf('n') >= 0) y = r0.y + (r0.h - h)
            s.pos = { x: x, y: y }
            s.size = { w: w, h: h }
            emit(s)
          }
          const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
          document.addEventListener('mousemove', mm)
          document.addEventListener('mouseup', mu)
        }
      }

      const panelStyle = { width: s.size.w, ...(s.size.h ? { height: s.size.h } : {}), ...(s.pos ? { left: s.pos.x, top: s.pos.y, right: 'auto' } : { left: 16, top: 76, right: 'auto' }) }
      return h('div', { ref: panelRef, className: 'dsws-panel', style: panelStyle }, [
        // #28 自适应头部：minWidth 0 允许收缩，先藏标题文字（留图标），最后仅留 repo
        h('div', { ref: headRef, className: 'dsws-head', onMouseDown: startDrag, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
          Icon({ scheme: s.ui.icon, size: 17 }),
          h('span', { 'data-head-title': 1, style: { fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' } }, tr('panel.title')),
          // v19-35：「真数据」→ 显示 repo 名（对未来用户更有意义；异常时红色提示）
          h('span', { 'data-repo-chip': 1, className: 'dsws-chip ' + (s.snapMode === 'err' ? 'dsws-chip-t' : 'dsws-chip-m'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [
            Ic({ n: s.snapMode === 'err' ? 'alert' : 'info', size: 11 }),
            h('span', { 'data-repo-text': 1, className: 'dsws-ellip', title: repoStr(s), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : repoStr(s)),
          ]),
          h('span', { style: { flex: 1 } }),
          h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: function () { s.open = false; emit(s) }, style: { display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 12 })),
        ]),
                h('div', { className: 'dsws-tabs', ref: tabsRef, style: { display: 'flex', alignItems: 'center', gap: 4 } }, [
          tabBtn('list', 'list', tr('panel.tabList'), 4),
          tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
          tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
          h('span', { style: { flex: 1 } }),
          // v1.5 T6 修订（V2 描边紫 · 刷新左侧）：新增 wayfinder
          // issue #4：新增 BUG 单 —— 同构按钮（新会话预填 /wayfinder 新增 BUG 单 prompt）
          h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
            Ic({ n: 'map', size: 11 }),
            h('span', null, tr('panel.newWayfinder')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
            Ic({ n: 'bug', size: 11 }),
            h('span', null, tr('panel.newBug')),
          ]),
          // T2 #2：刷新按钮上移至 tabs 行 · 紧贴环境检查右边（用户需求：列表 / 技能 / 环境检查 / 刷新）
          h('button', { className: 'dsws-btn', 'data-priority': 3, onMouseMove: function (e) { tabsTip(e, tr('list.refresh'), 3) }, onMouseLeave: tabsTipOff, onClick: function () { refreshAll(s) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' } }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', null, tr('list.refresh'))]),
          (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
          h('span', { className: 'dsws-ver', style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION),
        ]),
        h('div', { className: 'dsws-body', onMouseDown: onBodyDown }, [
          s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        h('div', { className: 'dsws-rz dsws-rz-n', onMouseDown: onResizeDown('n'), title: tr('rz.n') }),
        h('div', { className: 'dsws-rz dsws-rz-s', onMouseDown: onResizeDown('s'), title: tr('rz.s') }),
        h('div', { className: 'dsws-rz dsws-rz-e', onMouseDown: onResizeDown('e'), title: tr('rz.e') }),
        h('div', { className: 'dsws-rz dsws-rz-w', onMouseDown: onResizeDown('w'), title: tr('rz.w') }),
        h('div', { className: 'dsws-rz dsws-rz-ne', onMouseDown: onResizeDown('ne'), title: tr('rz.ne') }),
        h('div', { className: 'dsws-rz dsws-rz-nw', onMouseDown: onResizeDown('nw'), title: tr('rz.nw') }),
        h('div', { className: 'dsws-rz dsws-rz-se', onMouseDown: onResizeDown('se'), title: tr('rz.se') }),
        h('div', { className: 'dsws-rz dsws-rz-sw', onMouseDown: onResizeDown('sw'), title: tr('rz.sw') }),
        // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }

    // ---- 5.9 配置页（v25 · settings.plugins.tab「Waystation」：功能配置 + 动作模板编辑器）----
    // 开始模板（前缀开关 + execute 模板）/ 动作模板编辑器（其余 6 动作）
    // T3：模板名/描述在渲染时 tr('tpl.name.*')/tr('tpl.desc.*')（此处保留中文静态表供默认文案参考）
    const TPL_NAMES = {
      diagnose: '诊断', fix: '修复', discuss: '讨论', handoff1: '交接第一击', handoff2: '交接第二击', fixate: '沉淀',
    }
    const TPL_DESC = {
      diagnose: 'needs-triage 票的行级动作',
      fix: 'bug 票的行级动作',
      discuss: 'wayfinder:grilling 票的行级动作',
      handoff1: '生成交接文档（含时间戳，两击文件名一致）',
      handoff2: '读取交接文档',
      fixate: '零丢失快照 prompt',
    }
    const TPL_EDIT_IDS = ['diagnose', 'fix', 'discuss', 'handoff1', 'handoff2', 'fixate']  // execute 在「开始模板」节
    const PREVIEW_VALUES = { url: 'https://github.com/FeatherHunter/SKILLS/issues/365', number: '365', title: tr('cfg.previewTitle'), ts: '20260814-172113', file: '20260814-172113.md' }
    const SettingsPage = (props) => {
      // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
      const sharedSt = useStore(props && props.sessionId)
      const [openIn, setOpenIn] = React.useState(cfg.openIn || 'dock')
      const [openInNote, setOpenInNote] = React.useState(false)
      const [wf, setWf] = React.useState(cfg.withWayfinder)
      const [tpls, setTpls] = React.useState(function () {
        const o = {}
        o.execute = templates.execute || ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = templates[id] || '' })
        return o
      })
      const [saved, setSaved] = React.useState(false)
      const [errs, setErrs] = React.useState([])
      const [resetNote, setResetNote] = React.useState(null)
      const taRefs = React.useRef({})
      // v1.4.1：打开位置即时生效 —— seg 点击即写入 cfg + localStorage + 广播（无需滚到底部点保存全部）
      const pickOpenIn = function (v) {
        setOpenIn(v)
        cfg.openIn = v
        saveCfg()
        broadcastCfg()
        setOpenInNote(true)
        if (timer !== undefined) timer.timeout(function () { setOpenInNote(false) }, 2600)
      }
      // v1.3.3 T1：模板 textarea 自适应高度（内容全展开 · 无内层滚动 · 最外层滑动）
      const autoGrowTa = function (el) {
        if (!el) return
        el.style.height = 'auto'
        el.style.height = (el.scrollHeight + 2) + 'px'
      }
      // 校验全部 7 个模板（生效文本 = 自定义 || 默认）
      const validateAll = function (executeText) {
        const errList = []
        const check = function (id, text) {
          const v = validateTemplate(id, text || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''))
          if (!v.ok) {
            const bits = []
            if (v.missing.length) bits.push(tr('tpl.missing', { list: v.missing.map(function (n) { return '{' + n + '}' }).join('、') }))
            if (v.unknown.length) bits.push(tr('tpl.unknown', { list: v.unknown.map(function (n) { return '{' + n + '}' }).join('、') }))
            errList.push('「' + tr('tpl.name.' + id) + '」' + bits.join('；'))
          }
        }
        check('execute', executeText)
        TPL_EDIT_IDS.forEach(function (id) { check(id, tpls[id]) })
        return errList
      }
      const save = function () {
        const errList = validateAll(custom)
        if (errList.length) { setErrs(errList); return }
        setErrs([])
        cfg.openIn = openIn
        cfg.withWayfinder = wf
        templates.execute = custom
        TPL_EDIT_IDS.forEach(function (id) { templates[id] = tpls[id] })
        saveCfg(); saveTemplates(); broadcastCfg()
        setSaved(true)
        if (timer !== undefined) timer.timeout(function () { setSaved(false) }, 2000)
      }
      const setTpl = function (id, val) { setTpls(function (p) { const o = Object.assign({}, p); o[id] = val; return o }) }
      const resetExecute = function () { setTpl('execute', ''); setErrs([]) }
      const resetTpl = function (id) { setTpl(id, ''); setErrs([]) }
      // 页面级恢复全部默认（T1 规格 §5：清空 = 注入时走内置默认文本）
      const resetAll = function () {
        const o = {}
        o.execute = ''
        TPL_EDIT_IDS.forEach(function (id) { o[id] = '' })
        setTpls(o)
        setWf(true)
        setErrs([])
      }
      // 点击占位符 chip 在光标处插入
      const insertPh = function (id, name) {
        const ta = taRefs.current[id]
        const cur = tpls[id] || ''
        if (!ta) { setTpl(id, cur + '{' + name + '}'); return }
        const start = (ta.selectionStart != null) ? ta.selectionStart : cur.length
        const end = (ta.selectionEnd != null) ? ta.selectionEnd : cur.length
        const next = cur.slice(0, start) + '{' + name + '}' + cur.slice(end)
        setTpl(id, next)
        const pos = start + name.length + 2
        setTimeout(function () { try { ta.focus(); ta.setSelectionRange(pos, pos) } catch (e) { /* 忽略 */ } }, 0)
      }
      const chip = function (id, n, req) {
        return h('span', { key: n, className: 'dsws-cfg-chip' + (req ? ' req' : ''), title: req ? tr('cfg.chipReq') : tr('cfg.chipInsert'), onClick: function () { insertPh(id, n) } }, [
          h('span', null, '{' + n + '}'),
          req ? h('span', { className: 'must' }, tr('cfg.must')) : null,
        ])
      }
      const tplCard = function (id) {
        const val = tpls[id] || ''
        const preview = renderTemplate(id, PREVIEW_VALUES)
        const req = (TPL_REQUIRED[id] || []).slice()
        return h('div', { key: id, className: 'dsws-cfg-card' }, [
          h('div', { className: 'dsws-cfg-card-head' }, [
            h('span', { className: 'dsws-cfg-card-name' }, tr('tpl.name.' + id)),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-cfg-btn', onClick: function () { resetTpl(id) } }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-card-desc' }, tr('tpl.desc.' + id)),
          h('div', { className: 'dsws-cfg-chips' }, (TPL_PH[id] || []).map(function (n) { return chip(id, n, req.indexOf(n) >= 0) })),
          h('textarea', { ref: function (el) { taRefs.current[id] = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''), value: val, onChange: function (e) { setTpl(id, e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), preview]),
        ])
      }
      const custom = tpls.execute || ''
      // T5 修订：设置页内 toast（独立于面板 dock 的 notice 渲染）
      const cfgNotice = sharedSt.notice
      return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
        cfgNotice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
          Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
          h('span', null, cfgNotice.text),
        ]) : null,
        h('div', { className: 'dsws-cfg-head' }, [
          Icon({ scheme: 'compass', size: 20 }),
          h('span', { className: 't' }, tr('panel.title')),
          h('span', { className: 's', style: { color: saved ? 'var(--dsw-alias-state-success-primary,#4ade80)' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
            Ic({ n: saved ? 'check' : 'dot', size: 12 }),
            h('span', null, saved ? tr('cfg.saved') : tr('cfg.status')),
          ]),
        ]),
        h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
        // v1.5 T4：Matt 技能介绍卡（工程领域 + 通用领域 skills · GitHub 链接 + 安装 prompt 复制/注入）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'star', size: 13 }), h('span', null, tr('matte.title'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('matte.desc')),
          h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6 } }, [
            h('a', { href: MATT_REPO, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('matte.openRepo'))]),
            h('button', { className: 'dsws-btn', onClick: function () { copyText(sharedSt, promptText('installSkills'), tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('matte.copyPrompt'))]),
          ]),
        ]),
        // v1.4：打开位置（details 列 / better-sidebar）—— better-sidebar 未装时仅显示 dock 选项
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'map', size: 13 }), h('span', null, tr('cfg.openIn'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.openInDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('span', { className: 'dsws-cfg-label' }, tr('cfg.openInLabel')),
            h('div', { className: 'dsws-cfg-seg' }, [
              h('button', { key: 'dock', className: openIn === 'dock' ? 'on' : '', onClick: function () { pickOpenIn('dock') } }, tr('cfg.openInDock')),
              (function () { try { return !!ctx.get('betterSidebar') } catch (e) { return false } })()
                ? h('button', { key: 'sidebar', className: openIn === 'sidebar' ? 'on' : '', onClick: function () { pickOpenIn('sidebar') } }, tr('cfg.openInSidebar'))
                : null,
            ]),
            openInNote ? h('div', { style: { fontSize: 11, color: '#4ade80', marginTop: 6 } }, tr('cfg.openInHint')) : null,
          ]),
        ]),
        // 1.5 面板宽度重置（#398 拆票 A · 与 #397 协调 · 等 layoutSvc.resetDetails API；缺失时友好提示不让 UI 崩溃）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'refresh', size: 13 }), h('span', null, tr('cfg.panelWidth'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.resetPanelWidthDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('button', { className: 'dsws-cfg-btn', onClick: function () {
              const ls = ctx.get('layout')
              if (ls && typeof ls.resetDetails === 'function') {
                try { ls.resetDetails(); setResetNote({ kind: 'ok', text: tr('toast.resetPanelWidthDone') }) }
                catch (e) { setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') }) }
              } else {
                setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') })
              }
              if (timer !== undefined) timer.timeout(function () { setResetNote(null) }, 2800)
            } }, tr('cfg.resetPanelWidth')),
            resetNote ? h('span', { style: { marginLeft: 10, fontSize: 11, color: resetNote.kind === 'ok' ? '#4ade80' : '#fbbf24' } }, resetNote.text) : null,
          ]),
        ]),
        // 2. 开始模板（execute 唯一编辑点；id 供动作模板编辑器锚点跳转）
        h('div', { id: 'dsws-cfg-exec-group', className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'play', size: 13 }), h('span', null, tr('cfg.startTpl'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.startTplDesc')),
          h('div', { className: 'dsws-cfg-row' }, [
            h('label', { className: 'dsws-cfg-sw' }, [
              h('input', { type: 'checkbox', checked: wf, onChange: function (e) { setWf(e.target.checked) } }),
              h('span', { className: 'tr' }),
              h('span', null, tr('cfg.withPrefix')),
            ]),
          ]),
          h('textarea', { ref: function (el) { taRefs.current.execute = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT.execute ? TPL_DEFAULT.execute() : ''), value: custom, onChange: function (e) { setTpl('execute', e.target.value); autoGrowTa(e.target) } }),
          h('div', { className: 'dsws-cfg-chips' }, [
            (TPL_PH.execute || []).map(function (n) { return chip('execute', n, (TPL_REQUIRED.execute || []).indexOf(n) >= 0) }),
            h('button', { className: 'dsws-cfg-btn', style: { marginLeft: 'auto' }, onClick: resetExecute }, tr('cfg.reset')),
          ]),
          h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), renderTemplate('execute', PREVIEW_VALUES)]),
        ]),
        // 3. 动作模板编辑器（其余 6 动作 · T1：默认展开可手动折叠）
        h('details', { open: true, className: 'dsws-cfg-group dsws-cfg-details' }, [
          h('summary', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 650, marginBottom: 4, cursor: 'pointer', listStyle: 'none' } }, [Ic({ n: 'note', size: 13 }), h('span', null, tr('cfg.tplEditor'))]),
          h('div', { className: 'dsws-cfg-gdesc' }, [
            h('span', null, tr('cfg.tplEditorDesc')),
            h('a', { href: 'javascript:void(0)', onClick: function () { const el = document.getElementById('dsws-cfg-exec-group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, style: { color: '#bc8cff', cursor: 'pointer', flex: 'none', textDecoration: 'none' } }, tr('cfg.execHint')),
          ]),
          TPL_EDIT_IDS.map(tplCard),
        ]),
        // 校验错误提示
        errs.length ? h('div', { className: 'dsws-cfg-err' }, [
          h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.saveRejected'))]),
          errs.map(function (e, i) { return h('div', { key: i }, '· ' + e) }),
        ]) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-end' } }, [
          h('button', { className: 'dsws-cfg-btn', onClick: resetAll }, tr('cfg.resetAll')),
          h('button', { className: 'dsws-cfg-save', onClick: save }, [Ic({ n: 'check', size: 13 }), h('span', null, tr('cfg.saveAll'))]),
        ]),
      ])
    }

    // ---- 5.10 Run 卡控制面板（v25：状态展示 + 快捷打开配置页；外观切换已迁入设置页）----
    const RunPanel = (props) => {
      const cur = props.useSessions((x) => x.current)
      const s = useStore(cur)
      return h('div', { style: { border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1,#10131a)', fontFamily: 'var(--dsw-font-family)', fontSize: 13, color: 'var(--dsw-alias-label-primary,#e6edf3)', lineHeight: 1.6 } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
          h('strong', null, tr('panel.title')),
          h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, color: '#4ade80', fontSize: 12 } }, [Ic({ n: 'dot', size: 10 }), h('span', null, tr('run.loaded'))]),
        ]),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', margin: '6px 0' } }, tr('run.desc')),
        h('div', { className: 'dsws-uirow' }, [
          h('button', { className: 'dsws-btn', onClick: function () { openPanel(s) } }, tr('run.openPanel')),
          // v25：设置面板为 shell 组件本地状态、无公开打开 API（已查证）→ 按钮引导路径（偏离记录见 T2a resolution）
          h('button', { className: 'dsws-btn', onClick: function () { flash(s, tr('run.cfgGuide'), 'info') } }, tr('run.openCfg')),
        ]),
      ])
    }

    // ============================================================
    // 5.11 Ctx 接线（阶段 2 步骤 1 · #95）：建 cx 单例 + Provider 包住渲染树（行为零变化）
    // ============================================================
    // DswsCtx / createCx 由构建从 src/client/kernel/ctx.js 注入本闭包顶部（双产物同构 · seam 同模式）。
    // cx = { ctx, h, rdom, storeSvc, localeSvc, timer, api, router }（G3 冻结清单 8 字段 · #91 拍板）。
    // 宿主 slots 无全局 wrapper API（实查 dsh-client-ui-slots 0.1.0-rc.7 仅 register/inject），
    // 故 Provider 包在每个插槽组件注册处（渲染树顶层 = 组件根）；此时无任何组件消费 cx，
    // 渲染输出与接线前一致，行为零变化（verify-* 全绿证明）。
    const apiCall = function (endpoint, args) {
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.reject(new Error('host.call 不可用（Host 半未加载）'))
      }
      return host.call(endpoint, args)
    }
    const cx = createCx({
      ctx: ctx,
      h: h,
      rdom: RDOM,
      storeSvc: { shared: shared, stores: stores, makeStore: makeStore, storeOf: storeOf, emit: emit, sub: sub, useStore: useStore },
      localeSvc: localeSvc,
      timer: timer,
      api: { call: apiCall },
      router: { open: openPanel, toggle: togglePanel },
    })
    // Provider 包装器：任意深度组件都可 useContext(DswsCtx) 取 cx；props 原样透传
    const withCx = function (Comp) {
      return function (props) {
        return h(DswsCtx.Provider, { value: cx }, h(Comp, props))
      }
    }

    // ============================================================
    // 6. 插槽注册
    // ============================================================
    slots.inject('shell.overlay', function () {
      return slots.register({ name: 'shell.overlay', id: 'dsws-overlay-v5', order: 10 }, withCx(OverlayPanel))
    })
    slots.inject('conversation.input.dock', function () {
      return slots.register({ name: 'conversation.input.dock', id: 'dsh-mattpocock-skills-deck', order: 40 }, withCx(StatusBar))
    })
    slots.inject('tool.view.cordis', function () {
      return slots.register({ name: 'tool.view.cordis', key: 'self' }, withCx(RunPanel))
    })
    // v25-50：配置页（设置 → 插件 → Waystation；与 opencode 主题同模式）
    slots.inject('settings.plugins.tab', function () {
      return slots.register({ name: 'settings.plugins.tab', id: 'dsws-settings', order: 40, label: function () { return tr('panel.title') } }, withCx(SettingsPage))
    })
    // v1.5 T2：设置左侧直达 —— settings.section 左栏条目（与插件页 tab 双入口，复用同一 SettingsPage）
    //   order 18 = 紧跟 插件页15 之后（用户拍板 2026-08-16：15 < 18 < AgentPresets20 < better-sidebar100）
    slots.inject('settings.section', function () {
      return slots.register({ name: 'settings.section', id: 'dsws-settings-section', order: 18, label: function () { return tr('panel.title') } }, withCx(SettingsPage))
    })
    // 原型：右侧停靠（details 槽位 · 替换内置工具详情面板；single 槽动态注册优先级低 → 胜出）
    // priority: -1 低于内置详情面板的默认 0 → 无冲突且「低者胜出」替换内置面板
    slots.inject('details', function () {
      return slots.register({ name: 'details', id: 'dsws-details', order: 10, priority: -1 }, withCx(DetailsDock))
    })

    // v1.4.1：apply 时尽力注册「Waystation」tab；better-sidebar 服务未就绪（加载晚于本模块）→ 定时重试（最多 10 次）
    //   卸载（HMR / 插件禁用）时清理 disposer + 重试定时器
    if (!ensureSidebarTab()) {
      let tries = 0
      sidebarTabRetry = setInterval(function () {
        tries++
        if (ensureSidebarTab() || tries >= 10) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
      }, 1000)
    }
    ctx.effect(function () {
      return function () {
        try { if (sidebarTabDisposer) sidebarTabDisposer() } catch (e) { /* 忽略 */ }
        sidebarTabDisposer = null
        if (sidebarTabRetry) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
      }
    }, 'dsh-mattpocock-skills-deck: better-sidebar tab')

    // #347：加载真数据快照（repo 链接 + 前置检测兜底），失败静默
    loadSnapshot(shared, false)
  },
}
