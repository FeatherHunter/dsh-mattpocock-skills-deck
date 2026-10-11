/**
 * src/client/kernel/settings-view.js — 内核模块（#1012：把客户端「按工作区的观看状态」从 localStorage 搬到本机设置文件）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.js 里那一行 kernel:settingsView 拼接标记处（apply 闭包内原位），
 *   与 ctx.js/seam 同模式，一源两物，src 零复制。
 *
 * 为什么单独一个文件：这一族读写原先住在 kernel/store-prefs.js 里，那份文件已经 315 行（文件粒度门禁上限
 *   350 行，见 tests/verify-file-granularity.js），本票要加的「读文档、合并着写、旧表兜底」三件事塞不进去，
 *   所以照仓库惯例搬成一个自包含的内核片段；store-prefs.js 只留调用与旧表兜底。
 * 为什么写成 JavaScript 而不是 TypeScript：内核模块的运行时形状来自拼接 —— scripts/build.mjs 把本文件的
 *   声明体拼进 src/client/index.js 的闭包，tsconfig 不覆盖内核这几片；写成 TypeScript 既进不了类型检查也
 *   进不了产物，是静默失效。仓库现行口径是「动到哪里转哪里」，内核这几片的转写另立一票。
 *
 * 真相只有一份：本机设置文件（用户主目录下的 .dsh/mattskillsdeck/settings.yaml，核校验见
 *   src/shared/config-store/settings.js）里 workspaces 那一节，是按工作区记住的观看状态的唯一真源。
 *   localStorage 那两个旧键（dsws.bannerFold、dsws.subwsAutoShown）从此只当兜底：文档缺席、读失败、
 *   手机不通这三种情况才读它；只有写不进文件（或文件是更高版本、不许写回去）时才把这一次的值写回旧键
 *   做过渡；写成功那条路上一个字都不写旧键 —— 那不是双写，是过渡。
 *
 * 键用工作区根的可读路径（设置文件是写给人看的，人在里面要认得出这是哪个工作区），不用那个折叠散列
 *   （noRepoDismissKey 那种「前缀 + 折叠后算出来的数字」，人看不懂）。可读路径的来源按序取：
 *   ① 会话状态上的工作区根：src/client/kernel/store-snapshot.js 第 29 行的 sessionWorkspaceRoot，由
 *      src/client/kernel/probe-snapshot.js 第 83–90 行的 rememberSessionWorkspaceRoot 从 wf.cwd 回包里
 *      收下；它是折算过的键（Windows 上小写），所以按本会话所选目录的写法还原一遍（与
 *      src/client/views/SubworkspaceMark.js 第 45–67 行同一条规矩：比对用折算键、给人看用原样写法）。
 *   ② 会话状态上没有根时退到内核那把工作区键 wsKeyOf（store-snapshot.js 第 69 行）：已认出根就是根、
 *      只认出会话目录就是会话目录，正是本票要的口径。
 *   ③ 两条都拿不到（cwd 为空）时回空串：这一笔只读旧表、也只写旧表，绝不猜一把键。
 * 同一个工作区的不同写法落到同一条记录上（找条目时两边都折算过再比），换一种写法不会在文件里长出第二条。
 * 写是整份写回：wf.setSettings 收的是整份文档，所以只改内存文档里「这一个工作区的这一格」，
 *   别的节与别的字段原样带回去。防抖窗口见 VIEW_FLAG_WRITE_DEBOUNCE_MS。
 */
    // 防抖窗口取 500 毫秒，理由有三条。第一条：一次收起或展开在界面上往往连着来两下（点按钮那一下，
    //   加同一个工作区别的会话跟着重渲染那一趟），而每一次落盘都是宿主先读整份文件、再整份写回。
    // 第二条：与仓库既有的写合并窗口同一量级（日志转发的 1000 毫秒、交接的 800 毫秒），比它们略短。
    // 第三条：观看状态是人点一下就期待下次打开还在的东西，窗口太长，点完立刻关掉整个窗口那一下
    //   （页面卸载之后定时器不再有机会跑）就会把最后一次改动丢掉。
    export const VIEW_FLAG_WRITE_DEBOUNCE_MS = 500
    // 旧键登记表：本模块管的名字 → 旧 localStorage 键名，以及旧表里那一把键是按哪条路径记的。
    //   「按哪条路径记」不能省：横幅折叠按会话所选目录记（store-prefs.js 第 191–206 行，键是 keyOf(cwd)），
    //   红文件夹标志按工作区根记（SubworkspaceMark.js 第 138–157 行，键是 subwsMarkCmpKey(root)）。
    //   照原样读，行为才与改动前一致。
    const VIEW_FLAG_LEGACY = {
      bannerFolded: { key: 'dsws.bannerFold', by: 'cwd' },
      subwsMarkAutoShown: { key: 'dsws.subwsAutoShown', by: 'root' },
    }
    // 一条记录长成什么样：与核（src/shared/config-store/settings.js 第 16 行的 WS_KEYS 与第 93 行的默认值）
    //   一字对齐。noRepoDismissed 这一票不接线（无仓库红卡那张票还没搬过来），写它只为让每一条都长成核认得的形状。
    const VIEW_FLAG_ENTRY_DEFAULTS = { bannerFolded: false, noRepoDismissed: false, subwsMarkAutoShown: false }
    // 内存文档与这条路的状态机，五个取值各决定读走哪条路、写走哪条路：idle 还没有人用过（第一次读或写时
    //   才去问宿主一次）、loading 正问着、ready 文档在内存里、unavailable 这次问不出结果（环境问题、内容
    //   坏了、或根本没有宿主可问）、readonly 文件在但它是更高版本插件写的（读得回却读不懂字段，也绝不许写
    //   回去）。deferred 是文档还在路上时进来的那几笔写，journal 是已改进内存文档、还没被某次成功落盘确认
    //   的那几笔（写失败时按它写回旧键做过渡）。
    const viewFlagState = { status: 'idle', doc: null, deferred: {}, journal: {}, timer: 0 }
    // 折算到同一把键再比较：这一片一律走闭包里那把 keyOf（与仓库其余位置同口径），拿不到时才退回本地写法。
    const viewFlagNormOf = function (p) {
      try { if (typeof keyOf === 'function') return String(keyOf(p) || '') } catch (e) {}
      try { return String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() } catch (e1) { return '' }
    }
    // 一条路径按[\\/]切成几段（空段丢掉）：还原写法按段取前缀，绝不按字符切（`D:\ilife-other` 的前几个字符
    //   恰好是 `D:\ilife` 的写法，按字符切会切出看不出所以然的东西）。
    const viewFlagSegsOf = function (v) { return String(v == null ? '' : v).split(/[\\/]+/).filter(function (x) { return !!x }) }
    // 把「折算过的根」还原成本会话所选目录的那一种写法：拿会话目录的前 N 段（N＝根有几段）拼一条候选，
    //   折算回来等于根就是它。还原不出来（两侧不是同一条目录、或写法对不齐）就原样交回那一份折算键 ——
    //   它仍是一条路径而不是散列，写进设置文件照样认得出是哪个盘哪条目录。
    const viewFlagShownRootOf = function (known, cwd) {
      try {
        const rootKey = viewFlagNormOf(known)
        if (!rootKey) return ''
        const cs = viewFlagSegsOf(cwd)
        const rs = viewFlagSegsOf(known)
        if (rs.length > 0 && cs.length >= rs.length) {
          const sep = String(cwd == null ? '' : cwd).indexOf('\\') >= 0 ? '\\' : '/'
          const cand = cs.slice(0, rs.length).join(sep)
          if (viewFlagNormOf(cand) === rootKey) return cand
        }
        return String(known == null ? '' : known)
      } catch (e) { return String(known == null ? '' : known) }
    }
    // 会话状态里与本会话目录相同的那一条会话（同一工作区的会话共享同一个根，找到任意一条就够）：
    //   扫法与 store-prefs.js 第 210–216 行同例，先 shared 再 stores，按折算键比。
    const viewFlagStoreOf = function (cwd) {
      try {
        const want = viewFlagNormOf(cwd)
        if (!want) return null
        if (typeof shared !== 'undefined' && shared && shared.cwd && viewFlagNormOf(shared.cwd) === want) return shared
        if (typeof stores !== 'undefined' && stores) {
          const ks = Object.keys(stores)
          for (let i = 0; i < ks.length; i++) {
            const st = stores[ks[i]]
            if (st && st.cwd && viewFlagNormOf(st.cwd) === want) return st
          }
        }
      } catch (e) {}
      return null
    }
    // 这一次要落到设置文件里的那把键：已认出工作区根就用根的可读写法，只认出会话目录就用会话目录本身，
    //   两条都没有就回空串（调用方据此只走旧表，不猜一把键）。
    export const viewFlagDocKeyOf = function (cwd) {
      try {
        const raw = String(cwd == null ? '' : cwd).trim()
        if (!raw) return ''
        const st = viewFlagStoreOf(raw)
        const fromSession = (st && st.sessionWorkspaceRoot) ? String(st.sessionWorkspaceRoot).trim() : ''
        const known = fromSession || ((typeof wsKeyOf === 'function') ? String(wsKeyOf(raw) || '') : '')
        if (!known) return ''
        return viewFlagShownRootOf(known, raw)
      } catch (e) { return '' }
    }
    // 文档里这一条记录的那把键：已经有同一条工作区的记录就沿用它原来那把键（人的写法不同也算同一条），
    //   于是同一个工作区只留一条，也不会因为某次会话的写法不同而长出第二条。
    const viewFlagEntryKeyOf = function (doc, key) {
      try {
        const ws = doc && doc.workspaces
        if (!ws || typeof ws !== 'object') return ''
        if (Object.prototype.hasOwnProperty.call(ws, key)) return key
        const want = viewFlagNormOf(key)
        const ks = Object.keys(ws)
        for (let i = 0; i < ks.length; i++) { if (viewFlagNormOf(ks[i]) === want) return ks[i] }
      } catch (e) {}
      return ''
    }
    // 一份空文档：形状与核归一之后那一份逐字一致（version 1、ui 三格加 labelClicks、workspaces 空、
    //   debug 两格、templates 空）。照抄形状不是照抄校验：写成别的样子，核会按「多出来的名字」拒绝整份写入。
    const viewFlagEmptyDoc = function () {
      return { version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }
    }
    // 旧表里那把键（按折算键记，与旧写法一致）：横幅折叠按会话目录，红文件夹标志按工作区根。
    const viewFlagLegacyKeyOf = function (cwd, name) {
      try {
        const meta = VIEW_FLAG_LEGACY[name]
        if (!meta) return ''
        return viewFlagNormOf(meta.by === 'root' ? viewFlagDocKeyOf(cwd) : cwd)
      } catch (e) { return '' }
    }
    // 读旧表：旧表两种记法都是「归一键 → 1」，读的时候两边都折算过再比（旧版本可能把原样路径写进去过）。
    const viewFlagLegacyRead = function (cwd, name) {
      try {
        const meta = VIEW_FLAG_LEGACY[name]
        if (!meta) return false
        if (typeof localStorage === 'undefined' || !localStorage) return false
        const raw = localStorage.getItem(meta.key)
        if (!raw) return false
        const map = JSON.parse(raw)
        if (!map || typeof map !== 'object' || Array.isArray(map)) return false
        const key = viewFlagLegacyKeyOf(cwd, name)
        if (!key) return false
        if (map[key]) return true
        const ks = Object.keys(map)
        for (let i = 0; i < ks.length; i++) { if (viewFlagNormOf(ks[i]) === key && map[ks[i]]) return true }
      } catch (e) { return false }
      return false
    }
    // 写旧表：只在这一条路接不下这一次改动时才走（写文件失败、文件只读、或认不出可读路径）。
    //   置上就是那把键记 1，取消就是把它删掉（与 store-prefs.js 第 205–206 行同一种做法）；
    //   表里别的键原样保留，所以只动这一次涉及的那一条。
    const viewFlagLegacyWrite = function (cwd, name, on) {
      try {
        const meta = VIEW_FLAG_LEGACY[name]
        if (!meta) return false
        if (typeof localStorage === 'undefined' || !localStorage) return false
        const key = viewFlagLegacyKeyOf(cwd, name)
        if (!key) return false
        let map = null
        try {
          const raw = localStorage.getItem(meta.key)
          const m = raw ? JSON.parse(raw) : null
          if (m && typeof m === 'object' && !Array.isArray(m)) map = m
        } catch (eR) { map = null }
        if (!map) map = {}
        let hit = Object.prototype.hasOwnProperty.call(map, key) ? key : ''
        if (!hit) { const ks = Object.keys(map); for (let i = 0; i < ks.length; i++) { if (viewFlagNormOf(ks[i]) === key) { hit = ks[i]; break } } }
        if (on) map[hit || key] = 1
        else if (hit) delete map[hit]
        localStorage.setItem(meta.key, JSON.stringify(map))
        return true
      } catch (e) { return false }
    }
    // 把这一格改进内存文档：别的节与别的字段一律不动；新建这一条记录时，另外两格按旧表里还知道的那一份
    //   填上 —— 这不是双写，也不是搬运工具，只是新建的那一刻别顺手把用户原来收起过的横幅重新展开。
    const viewFlagSetInDoc = function (doc, cwd, key, name, on) {
      try {
        if (!doc || typeof doc !== 'object') return false
        if (!doc.workspaces || typeof doc.workspaces !== 'object' || Array.isArray(doc.workspaces)) doc.workspaces = {}
        let entryKey = viewFlagEntryKeyOf(doc, key)
        if (!entryKey) {
          const seed = {}
          const names = Object.keys(VIEW_FLAG_ENTRY_DEFAULTS)
          for (let i = 0; i < names.length; i++) {
            const n = names[i]
            seed[n] = (n === name) ? on : (VIEW_FLAG_LEGACY[n] ? viewFlagLegacyRead(cwd, n) : VIEW_FLAG_ENTRY_DEFAULTS[n])
          }
          doc.workspaces[key] = seed
          entryKey = key
        }
        doc.workspaces[entryKey][name] = on
        return true
      } catch (e) { return false }
    }
    // 整份写回：宿主那条写电话收的是整份文档（value），所以这里把内存文档原样交出去。
    //   写成功只要做一件事——把这一次被确认的那几笔从 journal 里划掉（它们已经落进文件了）；
    //   写这一趟期间又改过的那些还留在 journal 里，自然会再排一次写。
    const viewFlagWriteNow = function () {
      try {
        viewFlagState.timer = 0
        if (viewFlagState.status !== 'ready' || !viewFlagState.doc) return
        const sentKeys = Object.keys(viewFlagState.journal)
        if (!sentKeys.length) return
        // 文档在手但手机不通（宿主不在，或这条电话不在）：同样按兜底处理，不能让这一笔就这么没了。
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { viewFlagFallbackToLegacy(sentKeys); return }
        const t0 = Date.now()
        host.call('wf.setSettings', { value: viewFlagState.doc }).then(function (res) {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.setSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.setSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'set-not-ok')) })
          } catch (eL) {}
          if (okRes) {
            // 写成功之后一个字都不写旧键：新后端这条路成了，两处都写就是两份真相。
            for (let i = 0; i < sentKeys.length; i++) delete viewFlagState.journal[sentKeys[i]]
            return
          }
          // 写失败（含文件只读被拒）才把这几笔写回旧键做过渡兜底 —— 是兜底，不是双写。
          viewFlagFallbackToLegacy(sentKeys)
        }, function () { viewFlagFallbackToLegacy(sentKeys) })
      } catch (e) { try { viewFlagFallbackToLegacy(Object.keys(viewFlagState.journal)) } catch (e2) {} }
    }
    // 兜底：把这一次没写进文件的那几笔按旧表的老办法记下来，然后从 journal 里划掉（已经交代过了）。
    const viewFlagFallbackToLegacy = function (sentKeys) {
      try {
        for (let i = 0; i < sentKeys.length; i++) {
          const d = viewFlagState.journal[sentKeys[i]]
          if (d) viewFlagLegacyWrite(d.cwd, d.name, d.value)
          delete viewFlagState.journal[sentKeys[i]]
        }
      } catch (e) {}
    }
    // 排一次落盘（一次只排一个：连着来的几下会并进同一个窗口）。只排一次、跑完就停，不是自续的定时器，
    //   与 log.js / store-snapshot.js 用 timer 的写法同例（拿不到宿主那只 timer 就退回页面自己的 setTimeout）。
    const viewFlagScheduleWrite = function () {
      try {
        let arm = null
        try { if (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') arm = function (fn, ms) { return timer.timeout(fn, ms) } } catch (eT) {}
        if (!arm && typeof setTimeout === 'function') arm = function (fn, ms) { return setTimeout(fn, ms) }
        if (!arm) { viewFlagWriteNow(); return }
        if (viewFlagState.timer) { try { clearTimeout(viewFlagState.timer) } catch (eC) {} }
        viewFlagState.timer = arm(viewFlagWriteNow, VIEW_FLAG_WRITE_DEBOUNCE_MS)
      } catch (e) {}
    }
    // 文档到手那一刻重画一次（与 touchProbeAt / setBannerFolded 同例：同一个工作区的各会话都跟着重画）。
    const viewFlagEmitAll = function () {
      try { if (typeof emit === 'function' && typeof shared !== 'undefined' && shared) emit(shared) } catch (e) {}
      try {
        if (typeof emit === 'function' && typeof stores !== 'undefined' && stores) {
          const ks = Object.keys(stores)
          for (let i = 0; i < ks.length; i++) { if (stores[ks[i]]) emit(stores[ks[i]]) }
        }
      } catch (e1) {}
    }
    // 文档到手（或判定问不到）时收口：把还在路上的那几笔接上，并重画一次。
    //   排在排期与重画那两件之后，是为了让这一片读起来是「先有工具、再有收口」，调用时都在同一闭包里。
    const viewFlagSettle = function (status) {
      try {
        viewFlagState.status = status
        const keys = Object.keys(viewFlagState.deferred)
        for (let i = 0; i < keys.length; i++) {
          const d = viewFlagState.deferred[keys[i]]
          const key = (status === 'ready') ? viewFlagDocKeyOf(d.cwd) : ''
          if (key && viewFlagSetInDoc(viewFlagState.doc, d.cwd, key, d.name, d.value)) viewFlagState.journal[key + '\u0000' + d.name] = d
          else if (status !== 'ready' || !key) viewFlagLegacyWrite(d.cwd, d.name, d.value)
        }
        viewFlagState.deferred = {}
        if (status === 'ready') {
          // 文档刚到手要重画一次：不然「上次收起过横幅」这件事得等下一次别的重渲染才生效，
          //   用户会先看见横幅自己弹回来一下。只在真拿到文档时重画（问不到那条路上界面本来就照旧表画着）。
          viewFlagEmitAll()
          viewFlagScheduleWrite()
        }
      } catch (e) {}
    }
    // 惰性读一次文档：第一次有人读或写时才问宿主，只问一次 —— 问不到就标成不可用并全程走旧表，不反复重试。
    export const settingsViewLoad = function () {
      if (viewFlagState.status !== 'idle') return
      viewFlagState.status = 'loading'
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { viewFlagSettle('unavailable'); return }
        const t0 = Date.now()
        host.call('wf.getSettings', {}).then(function (res) {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.getSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.getSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'get-not-ok')) })
          } catch (eL) {}
          if (okRes) {
            // 更高版本的文件：核只认到版本 1，里面的字段读不懂，所以既不照着它答（宁可回旧表），
            //   也绝不写回去（写回去会把新版本的字段抹掉）。
            if (res.readonly === true) { viewFlagSettle('readonly'); return }
            if (!res.value || typeof res.value !== 'object') { viewFlagSettle('unavailable'); return }
            viewFlagState.doc = res.value
            viewFlagSettle('ready')
            return
          }
          // 文件还没建（种类是没有）不算故障：后端通着，第一次写入会把它建出来，所以按一份空文档起步；
          //   读的时候这一节是空的，照样落到旧表兜底（文档缺席时回退读旧键，行为与改动前一致）。
          if (res && res.error && res.error.kind === 'absent') { viewFlagState.doc = viewFlagEmptyDoc(); viewFlagSettle('ready'); return }
          viewFlagSettle('unavailable')
        }, function () { viewFlagSettle('unavailable') })
      } catch (e) { viewFlagSettle('unavailable') }
    }
    // 读一格：先看内存文档里这个工作区这一格（查到就回布尔，文档里已经有这一条就以它为准）；
    //   文档缺席、读失败、手机不通、或文档里还没有这一条时，回退读旧 localStorage 键。
    export const viewFlagOf = function (cwd, name) {
      try {
        settingsViewLoad()
        const key = viewFlagDocKeyOf(cwd)
        if (key && viewFlagState.doc) {
          const hit = viewFlagEntryKeyOf(viewFlagState.doc, key)
          const entry = hit ? viewFlagState.doc.workspaces[hit] : null
          // 只认真正的真假值：形状对不上（例如更高版本插件写的文件）时当「文档答不出」，回旧表兜底，不猜。
          if (entry && typeof entry === 'object' && typeof entry[name] === 'boolean') return entry[name]
        }
        return viewFlagLegacyRead(cwd, name)
      } catch (e) { return false }
    }
    // 写一格。返回值是给调用方看的两种意思：
    //   true ＝ 这一次交给本机设置文件这条路了（可能还在防抖窗口里没落盘），调用方不要再写旧表；
    //   false ＝ 这条路接不下（认不出可读路径，或文档问不到、是更高版本），调用方按老办法写旧表。
    export const setViewFlag = function (cwd, name, value) {
      try {
        const on = value === true
        settingsViewLoad()
        const key = viewFlagDocKeyOf(cwd)
        if (!key) return false
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这一笔，等它落地再并进文档（此刻先写旧键的话，文档一到手就会拿文件里的
          //   旧值把「刚点的那一下」顶掉，横幅会当着人的面自己弹回来）。
          viewFlagState.deferred[key + '\u0000' + name] = { cwd: cwd, name: name, value: on }
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        if (!viewFlagSetInDoc(viewFlagState.doc, cwd, key, name, on)) return false
        viewFlagState.journal[key + '\u0000' + name] = { cwd: cwd, name: name, value: on }
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
