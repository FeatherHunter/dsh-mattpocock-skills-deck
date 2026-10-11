/**
 * src/client/kernel/settings-ui.js — 内核模块（#1012 第 3 步：界面偏好搬进本机设置文件）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.js 里那一行 kernel:settingsUi 拼接标记处（apply 闭包内原位），与 ctx.js/seam
 *   同模式，一源两物，src 零复制。这一行标记必须排在 kernel:settingsViewWrite 之后：本片要用那一片的
 *   待写队列（viewFlagState.journal / viewFlagState.deferred / viewFlagScheduleWrite），以及设置视图
 *   那一份的文档工具与状态对象（kernel/settings-view.js、kernel/settings-view-state.js）。
 *
 * 本片管「界面偏好」这三格：列表面板的状态筛选（stateFilter）、排序键（sortKey）、排序方向（sortDir）。
 *   它们从前只活在 localStorage 的 dsws.listPrefs 里，现在新家是本机设置文件的 ui 节 —— #1012 要改的
 *   三份配置之一。旧键那一条留着当过渡，读先看文件、写进文件成功就不写旧键，与观看状态（settings-view.js
 *   那一族）同一套先立后破的办法；等界面偏好这一趟稳了，旧键再单独立票退役。
 *
 * 与观看状态的两处不同，改之前先读懂：
 *   一、这三格不是按工作区记的，整台机器只有一份（文件里就是 ui 节那三格）。所以队列里 ui 那几笔没有
 *      工作区路径，只有格名；它在队列里的记号以 \u0000ui\u0000 开头，与工作区那几笔（根路径 + \u0000 +
 *      格名）区分开 —— 工作区路径里不可能出现 \u0000，两族记号不会撞上。
 *   二、读这一侧不能只答「文件里写过没有」：文件里这三格可能是空的（空串＝这台机器还没写过这一格），
 *      那时候仍然照旧表里那一份答；文件写过的格以文件为准。文件里的空串不是「用户选了空」，是「没写过」。
 *
 * 文件里那一份到手时，界面已经按旧表那一份画过一次了（排序与筛选是建会话时就定下的）。所以文档到手
 *   那一刻要把文件里那一份搬进内存（settingsUiAdoptFromDoc），而且只搬「本次会话还没动过」的那些面板：
 *   面板上这一格若与旧表那一份不同，说明用户在这一次开着的窗口里点过它，不能拿文件里的旧值把它顶回去。
 *   搬完重画一次，界面跟着换成文件里那一份。
 *
 * 加载时机与观看状态同例（惰性，一次会话只问一次文件）：本机第一次有人读观看状态或写界面偏好时才问。
 *   实测那条读口每次会话渲染都会走到（statusbar/StatusBar.js 的 isBannerFolded），所以这一次问话在
 *   会话一画出来就开始了；问不到就全程照旧表走，不反复重试。
 */
    // 这三格的名字与核（config-store-core/src/settings.ts 的 UI_KEYS）同一份。labelClicks 不在此列：
    //   维护者 2026-10-12 拍板它不落盘（见 kernel/store-prefs.js 里那一段注释），核也不写它。
    const UI_PREF_NAMES = ['stateFilter', 'sortKey', 'sortDir']
    // 文件里那一份搬进内存这件事只做一次（一次问话只有一个终点，做完就放下，后续以内存这一份为准）。
    let uiPrefAdopted = false
    // 队列里 ui 那几笔的记号：见文件头第一条（工作区路径里不可能出现 \u0000，所以两族不会撞）。
    const settingsUiJournalKeyOf = function (name) { return '\u0000ui\u0000' + name }
    // 把一格界面偏好改进内存文档的 ui 节：别的节与别的格一律不动；ui 节缺失或形状不对就新建一份空的。
    const settingsUiSetInDoc = function (doc, name, value) {
      try {
        if (!doc || typeof doc !== 'object') return false
        if (!doc.ui || typeof doc.ui !== 'object' || Array.isArray(doc.ui)) doc.ui = {}
        doc.ui[name] = value
        return true
      } catch (e) { return false }
    }
    // 一笔界面偏好写不进内存文档时记一行（沿用既有的 storage.fail，不新开事件名；key 记一个固定的记号，
    //   与同文件另一处 viewFlagLogDocFail 的写法一致，日志纪律不许把用户数据写进日志）。
    const settingsUiLogDocFail = function () {
      try { log('warn', 'storage.fail', { key: 'settings.ui', op: 'write' }) } catch (eL) {}
    }
    // 这一笔没能进文件时的过渡兜底：照改动前的老办法把整份三格写回旧键。旧键那一份住在 store-prefs.js
    //   （saveListPrefsLegacy），本片不自己拼那把键，免得同一把键的写法长出第二处。
    const settingsUiLegacyWrite = function () {
      try { if (typeof saveListPrefsLegacy === 'function') saveListPrefsLegacy() } catch (e) {}
    }
    // 文档到手（或判定问不到）时，把还在路上的 ui 那几笔接上：能进文档就进待写队列，进不去就走旧表兜底。
    //   由 kernel/settings-view.js 的 viewFlagSettle 在清空 deferred 那一趟里按 section 分派过来；返回 true
    //   表示这一笔已经处理完（调用方不必再按工作区那条路处理它，那条路会拿 undefined 当工作区根）。
    const settingsUiDrainDeferred = function (d, status) {
      try {
        if (status === 'ready' && settingsUiSetInDoc(viewFlagState.doc, d.name, d.value)) {
          viewFlagState.journal[settingsUiJournalKeyOf(d.name)] = { section: 'ui', name: d.name, value: d.value }
          return true
        }
        settingsUiLegacyWrite()
        if (status === 'ready') settingsUiLogDocFail()
      } catch (e) {}
      return true
    }
    // 文件里那一份搬进内存这一份偏好：只搬文件写过（非空串）且与旧表那一份不同的格。
    //   面板上已经动过的会话不覆盖（文件头那一段）：判据是「这一格还等于旧表那一份」，等于就没被动过。
    //   搬完重画一次 —— 这一次问话的收口本来也会重画一遍（viewFlagSettle 里那一趟），但那一趟排在通知
    //   之前，搬完再画一遍才能让界面用上文件里那一份，所以这里自己画，不指望别人。
    const settingsUiAdoptFromDoc = function () {
      try {
        if (uiPrefAdopted) return
        uiPrefAdopted = true
        const doc = viewFlagState.doc
        const ui = (doc && typeof doc === 'object' && doc.ui && typeof doc.ui === 'object' && !Array.isArray(doc.ui)) ? doc.ui : null
        if (!ui) return
        const before = {}
        for (let i = 0; i < UI_PREF_NAMES.length; i++) before[UI_PREF_NAMES[i]] = listPrefs[UI_PREF_NAMES[i]]
        let changed = false
        for (let i = 0; i < UI_PREF_NAMES.length; i++) {
          const name = UI_PREF_NAMES[i]
          const v = ui[name]
          if (typeof v !== 'string' || v === '') continue
          if (v === before[name]) continue
          try {
            if (typeof stores !== 'undefined' && stores) {
              const ks = Object.keys(stores)
              for (let j = 0; j < ks.length; j++) {
                const st = stores[ks[j]]
                if (st && st[name] === before[name]) st[name] = v
              }
            }
          } catch (eS) {}
          listPrefs[name] = v
          changed = true
        }
        if (changed) viewFlagEmitAll()
      } catch (e) {}
    }
    // 登记到「这一次问话收口了」那一趟上（kernel/settings-view-state.js 的 viewFlagSubscribe）：现在还没问
    //   就等着，问完了立刻叫一次。登记放在本片末尾的初始化语句里，那时状态对象一定已经在（拼接顺序）。
    // 写一格界面偏好进文件。返回值与 setViewFlag 同义，给调用方看两种意思：
    //   true ＝ 这一次交给本机设置文件这条路了（可能还在防抖窗口里没落盘），调用方不要再写旧表；
    //   false ＝ 这条路接不下（文档问不到、是更高版本、或形状对不上），调用方按老办法写旧表。
    export const setUiPref = function (name, value) {
      try {
        if (UI_PREF_NAMES.indexOf(name) < 0) return false
        const v = String(value == null ? '' : value)
        if (v === '') return false
        settingsViewLoad()
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这一笔，等它落地再并进文档（此刻先写旧键的话，文档一到手就会拿文件里的
          //   旧值把「刚点的那一下」顶掉，用户会看见列表自己跳回上一次的顺序）。
          viewFlagState.deferred[settingsUiJournalKeyOf(name)] = { section: 'ui', name: name, value: v }
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        if (!settingsUiSetInDoc(viewFlagState.doc, name, v)) {
          // 文档在手却写不进这一格（形状对不上）：记一行再交回调用方写旧表，别让用户那一下静默消失。
          settingsUiLogDocFail()
          return false
        }
        viewFlagState.journal[settingsUiJournalKeyOf(name)] = { section: 'ui', name: name, value: v }
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
    // 把当前这三格整体交给文件（列表面板点一下筛选或排序时调的就是这里，见 views/ListTab.js）。
    //   三格里只要有一格接不下就返回 false，让调用方照改动前的老办法整份写回旧键 —— 不写两份互相打架的
    //   真相，也不半途而废（三格里写进去一格、剩下两格还在旧键上，下次启动就会一半新一半旧）。
    export const saveUiPrefs = function () {
      try {
        settingsViewLoad()
        for (let i = 0; i < UI_PREF_NAMES.length; i++) {
          if (!setUiPref(UI_PREF_NAMES[i], listPrefs[UI_PREF_NAMES[i]])) return false
        }
        return true
      } catch (e) { return false }
    }
    // 初始化：把「文件到手就搬进内存」登记上去（见上面 settingsUiAdoptFromDoc 与 viewFlagSubscribe 的说明）。
    try { viewFlagSubscribe(settingsUiAdoptFromDoc) } catch (e0) {}
