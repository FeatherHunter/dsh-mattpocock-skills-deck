/**
 * src/client/kernel/router.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
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
    //   ② openTab 带 path seed 走「内容型打开」→ 侧边栏面板折叠时自动展开
    //      （类型型打开不展开面板，侧边栏收着就「看不见 = 没反应」）。
    export let sidebarTabDisposer = null
    export let sidebarTabRetry = null
    export const ensureSidebarTab = function () {
      if (sidebarTabDisposer) return true
      try {
        const bs = ctx.get('betterSidebar')
        if (!(bs && typeof bs.registerTab === 'function')) return false
        const DeckSidebarTab = function (props) {
          const scope = props && props.scope
          const sessionId = scope ? scope.sessionId : undefined
          return h('div', { style: { height: '100%', overflow: 'hidden' } }, h(DetailsDock, { sessionId: sessionId }))
        }
        // 第一性原理：对外品牌为 MattSkillsDeck，单一 tab id = deck:map。
        // #fix-two-sliders：旧版同时注册 deck:map + waystation:map 两份同 component、同 order、同 single 的注册器，
        //   better-sidebar 按 id 区分 tab 条目，结果 better-sidebar 显示两条 slider（用户报告「MattSkills slider 两个」）。
        //   修复：只注册 deck:map；旧会话中存的 waystation:map 打开记录由下方 normalizeLegacyTabId() 改写到 deck:map 后再 open。
        sidebarTabDisposer = bs.registerTab({
          id: 'deck:map',
          title: function () { return tr('panel.title') },
          icon: function () { return Ic({ n: 'map', size: 14 }) },
          order: 60,
          single: true,
          component: DeckSidebarTab,
        })
        // LEGACY 别名：兼容已存的 waystation:map 打开记录（不额外 disposer，单注册器以新 id 为主）
        // #298 补充：该别名仅为旧会话/旧布局的兼容打开，不应在 better-sidebar 的「+」添加菜单中单独出现；设 hidden:true 隐藏
        try { bs.registerTab({ id: 'waystation:map', title: function () { return tr('panel.title') }, icon: function () { return Ic({ n: 'map', size: 14 }) }, order: 60, single: true, hidden: true, component: DeckSidebarTab }) } catch (e) {}
  return true
      } catch (e) { return false }
    }
    export const openInSidebar = function (st) {
      const bs = ctx.get('betterSidebar')
      if (bs && typeof bs.openTab === 'function') {
        if (!ensureSidebarTab()) { openDockPanel(st); return }  // 注册失败 → 回退 details 列
        // #2-fix（2026-08-19 用户反馈「新会话点状态栏面板不开」）：必须传 scope={sessionId}。
        //   better-sidebar 的 openTab(seed, scope) 内部 `targetSessionId = scope?.sessionId ?? store.getSnapshot().sessionId`；
        //   新会话时宿主尚未 setSession(该 id) → store sessionId 为 undefined → openTab 静默 return，面板不开。
        //   显式传当前 store 的 sessionId 后走 reduceFor(scope.sessionId) 路径（按给定 id 初始化布局），面板正常展开。
        //   仅当 st.sessionId 有值时传 scope（无值时传 {sessionId:undefined} 会令 targetsInactiveSession=true 走错分支）。
        bs.openTab({ type: 'deck:map', path: 'deck:map' }, st.sessionId ? { sessionId: st.sessionId } : undefined)  // path seed → 内容型打开 → 自动展开面板
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
      const url = issueUrlFor(st, t.number) // #231 清尾：链接一律后端声明模板；无元数据即空（诚实）
      // v1.4（T2 #443）：map 用推进式 prompt（加载技能→分析map→挑下一个issue→执行）；普通 issue 用 execute 模板
      const isMap = (t.labels || []).some(function (l) { return (typeof l === 'string') ? l === 'wayfinder:map' : l.name === 'wayfinder:map' })
      // v1.5 B2 修订（用户拍板）：新会话/执行 prompt 跟随行状态 —— map 完成态 → 完成确认 prompt（与左「完成」按钮同语义）；
      //   未完成 → 推进式；统一带 map 标识（编号/标题/链接），新会话不再「找不到对应 ISSUE」
      if (isMap) {
        const stats = t.stats || (function () {
          const mo = ((st.snapshot && st.snapshot.maps) || []).find(function (m) { return m.number === t.number })
          return mo ? mo.stats : null
        })()
        const empty = !!(stats && stats.total === 0)
        if (empty) {
          try { return inspectPrompt(st, t.number, t.title) } catch(e) { return '/wayfinder ' + url + '\n\n' + promptText('mapInspect', { n: String(t.number || ''), title: (t.title || ''), url: url }) }
        }
        const done = !!(stats && stats.total > 0 && stats.closed === stats.total)
        if (done) {
          // #77 定版：mapHead 自包含化 —— 标识头已内联 complete v5，head 外挂删除
          return completePrompt(st, t.number, t.title, stats.total, stats.closed)
        }
        // v1.5：技能 + 链接前置（用户规则：具体操作 prompt 开头 = /wayfinder + ISSUE 链接，单行空格分隔）
        // v5（#68 grilling 定版）：mapExecute 自包含（map 标识头 + 闸门引用 + 正文格式已内嵌）→ gateText/BODY_FORMAT/head 外挂全删
        return '/wayfinder ' + url + '\n\n' + promptText('mapExecute', { n: String(t.number || ''), title: (t.title || ''), url: url })
      }
      const body = renderTemplate('execute', { number: String(t.number), url: url, title: t.title })
      return withWayfinderPrefix(body)
    }
    // 契约 #205 会话标题（[#n] + 清洗/截断 120 bytes 预算）与占位四式判定已迁至命名守护共享核心
    // src/shared/naming-guardian.js（#265 · 单一真源；构建时经 shared:namingGuardian splice 拼入本闭包）。
    // 本文件不再声明任何命名真源：SESSION_TITLE_* / isNewPlaceholderTitle / newSessionTitleNew /
    // cleanTitleText / utf8Bytes / truncateTitleUtf8 / newSessionTitle 均以上述共享核心为准。
    // v1.5 T6：新增 wayfinder prompt —— /wayfinder + 仓库信息 + 需求引导（用户拍板：prompt 带仓库信息）
    // T16 补强（#463 复核 F2）：建图入口同样挂正文格式契约（新建 map 正文从源头防字面 \\n / BOM）
    // v7（#62 grill）：输入位绝对末尾 —— BODY_FORMAT 在中段，末尾追加 需求描述：/ Requirement:（满足 Q4）
    export const newWayfinderText = (st) => newWayfinderPrompt(st) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + (promptLang() === 'en' ? '\n\nRequirement: ' : '\n\n需求描述：')
    // issue #4：新增 BUG 单 —— 与「+ 新建需求」同构（新会话 + 预填 /wayfinder prompt + 正文格式契约）
    // v2（#1 BUG3 补强）：输入位挪到 BODY_FORMAT 之后，模板末尾（避免中途输入位）
    // v3（#14 决议 #13 [T7]）：字段集精简为 4 项 + 例行指引（v3.4：每字段「字段名：」行 + 下方「例：示例」行紧贴，zh/en 分离跟随语言）；EN locale 切换（NEW_BUG_FIELDS_BODY_EN）
    // v4（#63 grilling 定版 2026-08-20）：去内部规则复述 + 字段括号单行 + 顺序实际→期望（hit #63 决议）
    export const newBugWayfinderText = (st) => promptText('newBugWayfinder', { repo: repoUrlFor(st) }) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + (promptLang() === 'en' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY())