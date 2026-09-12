/**
 * src/client/kernel/router.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    // #606 面板打开各阶段计时的唯一状态。一次「点开面板」的调用链上只写读这几个数：
    //   kernel/router.js 的 openPanel 记下点击那一刻与走哪条路；panel/Dock.js 记下进入渲染那一刻与提交完成；
    //   views/ListTab.js 把提交阶段里做折叠测量花掉的毫秒累加进来；panel/DockSync.js 在副作用里把各段落成日志。
    // 刻意不挂在会话状态对象上（那会被当成业务状态、参与相等比较与持久化），也不挂到 globalThis 上
    //   （那会污染全局并在会话之间残留）。构建时这四个文件拼进同一个 apply 闭包，共享这个对象不需要任何导入。
    export const panelClock = { t0: 0, mode: '', renderT0: 0, commitMs: -1, fitMs: 0 }
    // 计时用的时钟：优先高精度性能计时，没有就用墙上时间。四处共用同一个函数，免得两段相减跨了两种时钟。
    export const panelNow = function () {
      try { if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now() } catch (e) {}
      return Date.now()
    }
    // 打开面板各阶段写一行日志（按需级）：只在调试开关打开时才组装字段，关着时连字段对象都不建。
    //   为什么毫秒放在 ms 字段、而不是编进 mode 取值：日志的 ts 是宿主收到批次那一刻盖的章，
    //   同一批内所有行共享同一毫秒、批内先后顺序不可信；可信的是每行自带的毫秒数，所以耗时必须有正规字段装。
    export const logPanelStage = function (stage, ms) {
      try { if (isEnabled('debug')) log('debug', 'panel.render', { stage: String(stage || ''), ms: Math.round(Number(ms) || 0), mode: String(panelClock.mode || '') }) } catch (e) {}
    }
    export const openPagePanel = function (st) {
      // #58 缓存优先：先同步补 cwd + 水合 per-cwd 缓存，实现切换面板秒开（无 loading 遮罩）
      if (!st.cwd) {
        const sync = getCwdSync(st.sessionId)
        if (sync) { st.cwd = sync; hydrateFromCache(st) }
      } else {
        hydrateFromCache(st)
      }
      const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
      const isReal = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
      st.open = true
      if (isReal && snapFresh(st)) {
        // v1.3.3 #5：数据新鲜直接展示，不 loading 不刷新（用户不再白等）
        // #58 若本 store 尚未设置 snapshot 但 per-cwd 缓存存在，已在 hydrateFromCache 秒开
        if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
        emit(st)
      } else if (isReal || hasCache) {
        // v1.3.3 #5：数据过期 → 保留旧数据展示 + 后台静默刷新（非 force · 走 5s 缓存），不弹全屏遮罩
        // #58 过期也秒开 + 后台静默，不闪 loading
        if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
        emit(st)
        loadSnapshot(st, false)
      } else {
        // 首开无数据且无 per-cwd 缓存 → 加载态 + 非 force 拉取
        st.snapMode = 'loading'
        emit(st)
        loadSnapshot(st, false)
      }
    }
    // 打开面板：一律右侧停靠（details 列）；layout 服务不可用 → 页内兜底
    export const openDockPanel = function (st) {
      const ls = ctx.get('layout')
      if (ls && typeof ls.openDetails === 'function') {
        ls.openDetails()
        // #58 缓存优先：与 openPagePanel 同逻辑，避免切面板闪 loading
        if (!st.cwd) {
          const sync = getCwdSync(st.sessionId)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        } else { hydrateFromCache(st) }
        const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
        const isReal = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
        if (isReal && snapFresh(st)) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
        } else if (isReal || hasCache) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
          loadSnapshot(st, false)
        } else {
          loadSnapshot(st, false)
        }
        return
      }
      openPagePanel(st)  // layout 服务不可用 → 退回悬浮
    }
    // v1.4：打开位置可选 —— cfg.openIn: 'dock'（details 列，默认）/ 'sidebar'（dsh-better-sidebar tab）
    //   better-sidebar 已装时可用；未装或服务不可用 → 回退 details 列
    // v1.4.1 修复「切侧边栏没反应」：
    //   ① ensureSidebarTab 幂等注册 —— better-sidebar 的 client 可能晚于本模块加载（未声明 inject 依赖），
    //      注册必须可重试；openTab 前 ensure 一次保证已注册（否则 openTab 静默 no-op）。
    //   ② 打开时只给类型，不给 path（#594 修复）。
    //      早先为了让折叠的侧边栏自动展开，这里给 openTab 传了一个假的 path（'deck:map'）。
    //      better-sidebar 0.19 起，带 path 的打开会被当成「打开一个真实文件」，转发给 DSH 原生
    //      右侧栏并按文件地址解析；宿主于是拿 deck:map 这个字符串去文件系统里 realpath，
    //      找不到就抛 cannot resolve target "...\deck:map"，面板打不开，用户只看到这条报错。
    //      不传 path 才是这个版本的正确用法：better-sidebar 会把 deck:map 当成我们注册的面板
    //      类型（registerTab 的 id 就是它的 kind），落到 DSH 原生右侧栏；展开由它自己按描述符做
    //      ——本面板没有 createTab，所以 revealIfOpened 恒为真，折叠状态下也会展开。
    export let sidebarTabDisposer = null
    export let sidebarTabRetry = null
    export const ensureSidebarTab = function () {
      if (sidebarTabDisposer) return true
      try {
        const bs = ctx.get('betterSidebar')
        if (!(bs && typeof bs.registerTab === 'function')) return false
        // 先出空壳、内容随后（本轮修复）：面板侧边栏的「打开」是在点击处理器里同步跑完的，
        //   若把整个面板内容放在同一次同步渲染里，浏览器在处理器返回前没机会画第一帧 ——
        //   用户看到的就是「点了半天面板不出来」。实测首次挂载要 5.6 秒（节点多、一次建完），
        //   而收起再打开只要一瞬间（那时 DOM 已存在，只是显示/隐藏）。
        //   所以这里先只画一个空壳，等浏览器把这一帧画出来（内层 requestAnimationFrame）
        //   再把真正的内容挂上去：点击立刻返回、外壳立即可见，那 5.6 秒退到随后的帧里跑。
        //   代价如实说明：总工作量没减少，只是把「点击后白等」换成「外壳先出来、内容随后填」。
        const DeckSidebarTab = function (props) {
          const scope = props && props.scope
          const sessionId = scope ? scope.sessionId : undefined
          const [ready, setReady] = React.useState(false)
          React.useEffect(function () {
            if (ready) return
            // 两跳：第一跳让本次渲染提交、浏览器有机会画外壳；第二跳才挂内容。
            const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function (fn) { return setTimeout(fn, 0) }
            let id2 = null
            const id1 = raf(function () { id2 = raf(function () { setReady(true) }) })
            return function () { try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id1) } catch (eC1) {} try { if (id2 !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id2) } catch (eC2) {} }
          }, [ready])
          if (!ready) return h('div', { style: { height: '100%', overflow: 'hidden' } })
          return h('div', { style: { height: '100%', overflow: 'hidden' } }, h(DetailsDock, { sessionId: sessionId }))
        }
        // 第一性原理：对外品牌为 MattSkillsDeck，单一 tab id = deck:map —— 只注册这一个面板类型，不注册任何旧名别名。
        // #fix-two-sliders：旧版同时注册 deck:map + waystation:map 两份同 component、同 order、同 single 的注册器，
        //   better-sidebar 按 id 区分 tab 条目，结果 better-sidebar 显示两条 slider（用户报告「MattSkills slider 两个」）。
        // #598：旧名别名那行注册已整段删除，不再注册。要害在于 hidden: true 只管「+」菜单，管不到
        //   better-sidebar 自己的设置页 —— 那一页在本机 node_modules/dsh-better-sidebar 的
        //   src/client/SideCardSection.tsx，它按「已注册的面板类型」逐张画卡片，标了 hidden 的也照画
        //   （只按同文件的 tabOrder 排到最后），所以别名会让同一个面板在设置里多出一张卡片、多一个开关。
        //   代价（#598 已接受的处置方式：直接删别名、不做迁移）：旧布局里若还开着这个旧名标签，会渲染成
        //   better-sidebar 的占位页（它内部叫 OrphanedTab，显示「插件未加载」加类型 id），点关即消失，不影响 deck:map。
        //   教训：以后想让某个注册「在界面上看不见」，先确认目标界面的过滤规则，别默认 hidden 在哪儿都管用。
        sidebarTabDisposer = bs.registerTab({
          id: 'deck:map',
          title: function () { return tr('panel.title') },
          icon: function () { return Ic({ n: 'map', size: 14 }) },
          order: 60,
          single: true,
          component: DeckSidebarTab,
        })
  return true
      } catch (e) { return false }
    }
    export const openInSidebar = function (st) {
      const bs = ctx.get('betterSidebar')
      if (bs && typeof bs.openTab === 'function') {
        // 常规测点（按需）：把「插件把面板交给 better-sidebar」与「它交还控制」两段分别记一行。
        //   为什么量这两段：外层渲染期的分段已证明「点开到画面出来」那几秒不在插件的渲染体里，
        //   所以它要么在 better-sidebar 内部的开签流程里，要么在下一次 React 渲染的提交阶段。
        //   两行都从点击那一刻算起，各自带毫秒，不靠批内先后顺序判断。
        if (!ensureSidebarTab()) { openDockPanel(st); return }  // 注册失败 → 回退 details 列
        if (isEnabled('debug')) logPanelStage('sidebar-registered', panelNow() - panelClock.t0)
        // #2-fix（2026-08-19 用户反馈「新会话点状态栏面板不开」）：必须传 scope={sessionId}。
        //   better-sidebar 的 openTab(seed, scope) 内部 `targetSessionId = scope?.sessionId ?? store.getSnapshot().sessionId`；
        //   新会话时宿主尚未 setSession(setId) → store sessionId 为 undefined → openTab 静默 return，面板不开。
        //   显式传当前 store 的 sessionId 后走 reduceFor(scope.sessionId) 路径（按给定 id 初始化布局），面板正常展开。
        //   仅当 st.sessionId 有值时传 scope（无值时传 {sessionId:undefined} 会令 targetsInactiveSession=true 走错分支）。
        // #594：只给类型。带上 path 会被 better-sidebar 当成真实文件路径转发给原生右侧栏，
        // 宿主 realpath 失败即报 cannot resolve target；展开由 better-sidebar 按描述符自己做。
        bs.openTab({ type: 'deck:map' }, st.sessionId ? { sessionId: st.sessionId } : undefined)
        if (isEnabled('debug')) logPanelStage('sidebar-opened', panelNow() - panelClock.t0)
        // 打开 tab 即视为面板已开（数据新鲜直接展示）
        // #58 缓存优先：与 openPagePanel 同逻辑，含 per-cwd 水合
        if (!st.cwd) {
          const sync = getCwdSync(st.sessionId)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        } else { hydrateFromCache(st) }
        const hasCache2 = !!(st.snapshot || getCachedSnapshot(st.cwd))
        const isReal2 = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
        if (isReal2 && snapFresh(st)) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st); return
        }
        if (isReal2 || hasCache2) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st); loadSnapshot(st, false); return
        }
        loadSnapshot(st, false)
        return
      }
      openDockPanel(st)  // better-sidebar 不可用 → 回退 details 列
    }
    export const openPanel = function (st) {
      // #2-fix（2026-08-19 用户反馈「新会话点状态栏按钮右侧面板不开」）：
      //   cfg.openIn 在 apply 时固化；装配竞态（better-sidebar 晚于本模块加载）会令 bsInstalled=false → openIn 误判为 'dock'，
      //   点击永远走 openDockPanel（宿主 details 列），better-sidebar 面板不展开 → 用户看不到列表（数据其实一直在渲染）。
      //   实时检测：better-sidebar 当前可用（openTab 存在）且用户未显式选过 dock → 走 sidebar 展开 better-sidebar。
      const bs = ctx.get('betterSidebar')
      const bsReady = !!(bs && typeof bs.openTab === 'function')
      const explicitDock = (function () {
        try {
          const raw = localStorage.getItem(CFG_KEY)
          if (!raw) return false
          return JSON.parse(raw).openIn === 'dock'
        } catch (e) { return false }
      })()
      try { const m = (cfg.openIn === 'sidebar' || (bsReady && cfg.openIn === 'dock' && !explicitDock)) ? 'sidebar' : 'dock'; const _keyHash = dswsLogHash((typeof keyOf === 'function' ? keyOf(st.cwd || '') : String(st.cwd || ''))); const _snapVer = (typeof getSnapshotVersion === 'function' ? getSnapshotVersion(st.cwd) : '') || (st.snapshot && st.snapshot.version) || ''; const _bid = String((st.selection && st.selection.backendId) || ''); log('info', 'panel.open', { mode: m, hasCache: !!(st.snapshot || (typeof getCachedSnapshot === 'function' && getCachedSnapshot(st.cwd))), snapFresh: (typeof snapFresh === 'function' ? snapFresh(st) : false), keyHash: _keyHash, snapVersion: _snapVer, backendId: _bid }) } catch (eL) {} // 串门自证（#495）：单行 #36 即可定罪——工作区键散列对上哪家、快照是哪个版本、后端是哪一个
      // #606 常规测点起点：记下「点开面板」这一刻与走哪条路，供后面各段算出各自耗时（按需级，日志在 DockSync 收口）。
      //   起点与各段都归 panelClock 一个对象管，用完即清；不挂在会话状态对象上，也不挂到 globalThis 上。
      //   调试开关关着时这一整段跳过：连时钟都不读，后面各段也就没有起点可算，唯一代价是读一次开关。
      if (isEnabled('debug')) {
        panelClock.t0 = panelNow()
        panelClock.mode = (cfg.openIn === 'sidebar' || (bsReady && cfg.openIn === 'dock' && !explicitDock)) ? 'sidebar' : 'dock'
        panelClock.renderT0 = 0
        panelClock.commitMs = -1
        panelClock.fitMs = 0
      }
      if (cfg.openIn === 'sidebar' || (bsReady && cfg.openIn === 'dock' && !explicitDock)) openInSidebar(st)
      else openDockPanel(st)
    }
    export const togglePanel = function (st) {
      if (st.open) { st.open = false; emit(st); return }
      openPanel(st)
    }

    // #227 迁移：repoStr 改由后端 describe 供给（repository.refId 优先，兼容旧 repo），通用占位不再硬编码 FeatherHunter/SKILLS
    export const repoStr = (st) => {
      const repo = st.snapshot && (st.snapshot.repository || st.snapshot.repo)
      if (repo && typeof repo.refId === 'string' && repo.refId) return repo.refId
      if (repo && repo.owner && repo.name) return repo.owner + '/' + repo.name
      if (st.snapshot && st.snapshot.repo) return st.snapshot.repo.owner + '/' + st.snapshot.repo.name
      return 'owner/repo'
    }

    // v21：开始 prompt 精简 —— /wayfinder + URL + 统一引导句（技能内部细节自带，不再重复灌输）
    // v25 · T2b：execute 走模板渲染（templates.execute 或默认），前缀开关 = cfg.withWayfinder
    // v1.3.3 #10：前缀去重 —— 模板（含用户自定义旧模板）若已以 /wayfinder 开头则不再重复拼接
    export const withWayfinderPrefix = function (body) {
      if (!cfg.withWayfinder) return body
      if (/^\/wayfinder\b/.test(String(body || '').trim())) return body
      return '/wayfinder\n' + body
    }
    export const startText = (st, t) => {
      const url = issueUrlFor(st, t.number, effortOf(t)) // #231 清尾：链接一律后端声明模板；无元数据即空（诚实）
      // v1.4（T2 #443）：map 用推进式 prompt（加载技能→分析map→挑下一个issue→执行）；普通 issue 用 execute 模板
      const isMap = (t.labels || []).some(function (l) { return (typeof l === 'string') ? l === 'wayfinder:map' : l.name === 'wayfinder:map' })
      // v1.5 B2 修订（用户拍板）：新会话/执行 prompt 跟随行状态 —— map 完成态 → 完成确认 prompt（与左「完成」按钮同语义）；
      //   未完成 → 推进式；统一带 map 标识（编号/标题/链接），新会话不再「找不到对应 ISSUE」
      if (isMap) {
        const stats = t.stats || (function () {
          const mo = ((st.snapshot && st.snapshot.maps) || []).find(function (m) { return idOf(m) === idOf(t) }) || ((st.snapshot && st.snapshot.maps) || []).find(function (m) { return m.number === t.number })
          return mo ? mo.stats : null
        })()
        const empty = !!(stats && stats.total === 0)
        if (empty) {
          try { return inspectPrompt(st, t.number, t.title) } catch(e) { return '/wayfinder ' + url + '\n\n' + promptTextFor(st, 'mapInspect', { n: String(t.number || ''), title: (t.title || ''), url: url }) }
        }
        const done = !!(stats && stats.total > 0 && stats.closed === stats.total)
        if (done) {
          // #77 定版：mapHead 自包含化 —— 标识头已内联 complete v5，head 外挂删除
          return completePrompt(st, t.number, t.title, stats.total, stats.closed)
        }
        // v1.5：技能 + 链接前置（用户规则：具体操作 prompt 开头 = /wayfinder + ISSUE 链接，单行空格分隔）
        // v5（#68 grilling 定版）：mapExecute 自包含（map 标识头 + 闸门引用 + 正文格式已内嵌）→ gateText/BODY_FORMAT/head 外挂全删
        return '/wayfinder ' + url + '\n\n' + promptTextFor(st, 'mapExecute', { n: String(t.number || ''), title: (t.title || ''), url: url })
      }
      const body = renderTemplate('execute', { number: String(t.number), url: url, title: t.title }, st)
      return withWayfinderPrefix(body)
    }
    // 契约 #205 会话标题（[#n] + 清洗/截断 120 bytes 预算）与占位四式判定已迁至命名守护共享核心
    // src/shared/naming-titles.js 等 3 个文件（#265 · 单一真源；构建时经 shared:namingTitles 等 3 个 splice 拼入本闭包）。
    // 本文件不再声明任何命名真源：SESSION_TITLE_* / isNewPlaceholderTitle / newSessionTitleNew /
    // cleanTitleText / utf8Bytes / truncateTitleUtf8 / newSessionTitle 均以上述共享核心为准。
    // v1.5 T6：新增 wayfinder prompt —— /wayfinder + 仓库信息 + 需求引导（用户拍板：prompt 带仓库信息）
    // T16 补强（#463 复核 F2）：建图入口同样挂正文格式契约（新建 map 正文从源头防字面 \\n / BOM）
    // v7（#62 grill）：输入位绝对末尾 —— BODY_FORMAT 在中段，末尾追加 需求描述：/ Requirement:（满足 Q4）
    export const newWayfinderText = (st) => newWayfinderPrompt(st) + (BODY_FORMAT(st) ? '\n\n' + BODY_FORMAT(st) : '') + (promptLang() === 'en' ? '\n\nRequirement: ' : '\n\n需求描述：')
    // issue #4：新增 BUG 单 —— 与「+ 新建需求」同构（新会话 + 预填 /wayfinder prompt + 正文格式契约）
    // v2（#1 BUG3 补强）：输入位挪到 BODY_FORMAT 之后，模板末尾（避免中途输入位）
    // v3（#14 决议 #13 [T7]）：字段集精简为 4 项 + 例行指引（v3.4：每字段「字段名：」行 + 下方「例：示例」行紧贴，zh/en 分离跟随语言）；EN locale 切换（NEW_BUG_FIELDS_BODY_EN）
    // v4（#63 grilling 定版 2026-08-20）：去内部规则复述 + 字段括号单行 + 顺序实际→期望（hit #63 决议）
    export const newBugWayfinderText = (st) => promptText('newBugWayfinder', { repo: repoUrlFor(st) }) + (BODY_FORMAT(st) ? '\n\n' + BODY_FORMAT(st) : '') + (promptLang() === 'en' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY())