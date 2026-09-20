/**
 * src/client/kernel/router.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    // #606 面板打开各阶段计时的唯一状态。一次「点开面板」的调用链上只写读这几个数：
    //   kernel/router.js 的 openPanel 记下点击那一刻；panel/Dock.js 记下进入渲染那一刻与提交完成；
    //   views/ListTab.js 把提交阶段里做折叠测量花掉的毫秒累加进来；panel/DockSync.js 在副作用里把各段落成日志。
    // 刻意不挂在会话状态对象上（那会被当成业务状态、参与相等比较与持久化），也不挂到 globalThis 上
    //   （那会污染全局并在会话之间残留）。构建时这四个文件拼进同一个 apply 闭包，共享这个对象不需要任何导入。
    export const panelClock = { t0: 0, renderT0: 0, commitMs: -1, fitMs: 0 }
    // 计时用的时钟：优先高精度性能计时，没有就用墙上时间。四处共用同一个函数，免得两段相减跨了两种时钟。
    export const panelNow = function () {
      try { if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now() } catch (e) {}
      return Date.now()
    }
    // 打开面板各阶段写一行日志（按需级）：只在调试开关打开时才组装字段，关着时连字段对象都不建。
    //   为什么毫秒放在 ms 字段、而不是编进 stage 取值：日志的 ts 是宿主收到批次那一刻盖的章，
    //   同一批内所有行共享同一毫秒、批内先后顺序不可信；可信的是每行自带的毫秒数，所以耗时必须有正规字段装。
    //   （2026-09-21：原有一个 mode 字段记「走哪个入口」。现在面板只有一条路，那个字段随之删除。）
    export const logPanelStage = function (stage, ms) {
      try { if (isEnabled('debug')) log('debug', 'panel.render', { stage: String(stage || ''), ms: Math.round(Number(ms) || 0) }) } catch (e) {}
    }
    // 面板只有一条路（2026-09-21 定）：本插件自己在 DSH 原生右侧边栏的类型登记表里注册一个类型，右栏里那一格由我们渲染。
    //   拿不到原生控制器就不算打开 —— 记一行日志并给用户一句可见提示，不再悄悄退回别的形态（页内浮窗已退役）。
    //   这里两个标识必须成对：kind 是打开请求上带的类型名，id 是类型在登记表里的身份，右栏按 id 找内容体与标题。
    export const DECK_NATIVE_TAB_KIND = 'dsh-mattpocock-skills-deck:deck-map'
    export const DECK_NATIVE_TYPE_ID = 'dsh-mattpocock-skills-deck/deck:map'
    // 右侧边栏里那张标签的内容体（面板本体）。
    //   先出空壳、下一帧再挂内容（#603）：打开是在点击处理器里同步跑完的，一次把整棵树建完会让浏览器
    //   在处理器返回前画不出第一帧 —— 用户看到的就是「点了半天面板不出来」。实测首挂 5.6 秒 → 0.19 秒。
    // #670：空壳自己必须是「面板本人」，不能是一块透亮的空块。挂载这一路上有两个时刻会画空壳
    //   （刷新页面时右栏恢复、右栏被收起再展开、进会话时右栏重建），空壳没有背景的话，那几帧里
    //   这一格显示的是底下透出来的东西（宿主页面/右栏自己的底色），紧接着才被面板整块盖住 ——
    //   用户看到的就是「先黑一下」。所以空壳与面板根节点共用同一档底色（.dsws-hold，样式表里与
    //   Dock.js 的 background 是同一个令牌同一个兜底值）：从第一帧起就是「面板已经在、内容还没到」。
    //   注意这里改的是「第一帧画什么」，那两跳是为了不让点击白等（#603），不要顺手删。
    export const DeckSidebarTab = function (props) {
      // 会话号由原生右栏就近给：注册内容体槽位时写了 inject(sessionId)，宿主在渲染这一格时把它交进来。
      const sessionId = (props && props.sessionId) || undefined
      const [ready, setReady] = React.useState(false)
      React.useEffect(function () {
        if (ready) return
        // 两跳：第一跳让本次渲染提交、浏览器有机会画外壳；第二跳才挂内容。
        const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function (fn) { return setTimeout(fn, 0) }
        let id2 = null
        const id1 = raf(function () { id2 = raf(function () { setReady(true) }) })
        return function () { try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id1) } catch (eC1) {} try { if (id2 !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id2) } catch (eC2) {} }
      }, [ready])
      if (!ready) return h('div', { className: 'dsws-hold' })
      return h('div', { className: 'dsws-hold' }, h(DetailsDock, { sessionId: sessionId }))
    }
    // 右栏标签条上那枚标题：内容就是面板名。
    export const DeckNativeTabTitle = function () { return h('span', null, tr('panel.title')) }
    // 打开面板的收尾：把这次打开记成「面板已开」，并按 #58 的规矩缓存优先（已水合就直接展示，否则后台拉）。
    export const afterPanelOpened = function (st) {
      if (!st.cwd) {
        const sync = getCwdSync(st.sessionId)
        if (sync) { st.cwd = sync; hydrateFromCache(st) }
      } else { hydrateFromCache(st) }
      st.open = true
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
        st.snapMode = 'loading'
        emit(st)
        loadSnapshot(st, false)
      }
    }
    // 打开面板：把面板交进 DSH 原生右侧边栏，类型见上方 DECK_NATIVE_TAB_KIND。
    //   拿不到原生控制器就返回 false，由调用处决定下一步 —— 不再悄悄退回别的形态：
    //   维护者 2026-09-19 定：页内浮窗这个形态不做了，面板只有右侧边栏一个落点。
    export const openInNativeRight = function (st) {
      const api = ctx.get('sidebarRight')
      if (!(api && typeof api.openTab === 'function')) return false
      try {
        if (isEnabled('debug')) logPanelStage('native-open', panelNow() - panelClock.t0)
        if (st.sessionId && typeof api.openTabIn === 'function') api.openTabIn(st.sessionId, DECK_NATIVE_TAB_KIND, { revealIfOpened: true })
        else api.openTab(DECK_NATIVE_TAB_KIND, { revealIfOpened: true })
        if (isEnabled('debug')) logPanelStage('native-opened', panelNow() - panelClock.t0)
      } catch (e) { return false }
      afterPanelOpened(st)
      return true
    }
    export const openPanel = function (st) {
      // 面板只有一条路（2026-09-21 定）：本插件注册的类型，开进 DSH 原生右侧边栏，右栏里那一格由我们渲染。
      //   原来这里还有一个二选一（把面板交给 dsh-better-sidebar 打开）。两条路并存时，那个插件会把面板
      //   画进同一列，于是原生右栏的引导页里出现两枚同名入口（用户看到的就是「两个 MattSkills」），
      //   所以那条路连同它的注册整段删除，本插件不再依赖任何第三方插件。
      try { const _keyHash = dswsLogHash((typeof keyOf === 'function' ? keyOf(st.cwd || '') : String(st.cwd || ''))); const _snapVer = (typeof getSnapshotVersion === 'function' ? getSnapshotVersion(st.cwd) : '') || (st.snapshot && st.snapshot.version) || ''; const _bid = String((st.selection && st.selection.backendId) || ''); log('info', 'panel.open', { hasCache: !!(st.snapshot || (typeof getCachedSnapshot === 'function' && getCachedSnapshot(st.cwd))), snapFresh: (typeof snapFresh === 'function' ? snapFresh(st) : false), keyHash: _keyHash, snapVersion: _snapVer, backendId: _bid }) } catch (eL) {} // 串门自证（#495）：单行 #36 即可定罪——工作区键散列对上哪家、快照是哪个版本、后端是哪一个
      // #606 常规测点起点：记下「点开面板」这一刻，供后面各段算出各自耗时（按需级，日志在 DockSync 收口）。
      //   起点与各段都归 panelClock 一个对象管，用完即清；不挂在会话状态对象上，也不挂到 globalThis 上。
      //   调试开关关着时这一整段跳过：连时钟都不读，后面各段也就没有起点可算，唯一代价是读一次开关。
      if (isEnabled('debug')) {
        panelClock.t0 = panelNow()
        panelClock.renderT0 = 0
        panelClock.commitMs = -1
        panelClock.fitMs = 0
      }
      if (openInNativeRight(st)) return
      logPanelStage('entry-unavailable', panelNow() - panelClock.t0)
      try { flash(st, tr('panel.openUnavailable'), 'warn') } catch (e) {}
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