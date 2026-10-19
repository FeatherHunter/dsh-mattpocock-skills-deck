/**
 * src/client/kernel/settings-ui.ts — 内核模块（#1012 第 3 步：界面偏好搬进本机设置文件）
 * （原来是 .js：按「动到哪里转哪里」转成 TypeScript，行为零变化。本文件是模块真源，同名 .js 已改由构建生成（会被覆盖，不要去改），本 .ts 既进类型检查也进拼接与 ts-hook 测试。）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mts 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里那一行 kernel:settingsUi 拼接标记处（apply 闭包内原位），与 ctx.ts/seam
 *   同模式，源码树里只有这一份真源。这一行标记必须排在 kernel:settingsViewWrite 之后：本片要用那一片的
 *   待写队列（viewFlagState.journal / viewFlagState.deferred / viewFlagScheduleWrite），以及设置视图
 *   那一份的文档工具与状态对象（kernel/settings-view.ts、kernel/settings-view-state.ts）。
 *
 * 本片管「界面偏好」这三格：列表面板的状态筛选（stateFilter）、排序键（sortKey）、排序方向（sortDir）。
 *   它们从前只活在 localStorage 的 dsws.listPrefs 里，现在新家是本机设置文件的 ui 节 —— #1012 要改的
 *   三份配置之一。旧键那一条留着当过渡，读先看文件、写进文件成功就不写旧键，与观看状态（settings-view.ts
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
 *   实测那条读口每次会话渲染都会走到（statusbar/StatusBar.ts 的 isBannerFolded），所以这一次问话在
 *   会话一画出来就开始了；问不到就全程照旧表走，不反复重试。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）：
// listPrefs 与 saveListPrefsLegacy 的真源在 kernel/store-prefs.ts，shared/stores 的真源在
//   kernel/store-snapshot.ts，viewFlagState 与 viewFlagSubscribe 的真源在 kernel/settings-view-state.ts，
//   settingsViewLoad 与 viewFlagEmitAll 的真源在 kernel/settings-view.ts，viewFlagScheduleWrite 的真源在
//   kernel/settings-view-write.ts；本片只在调用时求值，初始化期不碰；类型一律写 any 是刻意的：
//   在这里凭记忆写窄，只会把那边正常的改动变成这里的假报错（与 kernel/link.ts 同例）。
//   log 走全局已声明的那一份，这里不重复。
declare const listPrefs: any;
declare function saveListPrefsLegacy(...args: any[]): any;
declare const shared: any;
declare const stores: any;
declare const viewFlagState: any;
declare function viewFlagEmitAll(...args: any[]): any;
declare function settingsViewLoad(...args: any[]): any;
declare function viewFlagScheduleWrite(...args: any[]): any;
declare function viewFlagSubscribe(...args: any[]): any;
    // 这三格的名字与核（config-store-core/src/settings.ts 的 UI_KEYS）同一份。labelClicks 不在此列：
    //   维护者 2026-10-12 拍板它不落盘（见 kernel/store-prefs.js 里那一段注释），核也不写它。
    const UI_PREF_NAMES = ['stateFilter', 'sortKey', 'sortDir']
    // 文件里那一份搬进内存这件事只做一次（一次问话只有一个终点，做完就放下，后续以内存这一份为准）。
    let uiPrefAdopted = false
    // 「上一次我们确认过的这一格是什么」—— 只用来在提交时判断用户到底动过哪几格（见 saveUiPrefs）。
    //   起点是旧表那一份：文档还没到手时旧表就是唯一知道的真相；文档到手搬完之后内存这一份就是真相，
    //   跟着更新；每交出去一笔也跟着更新。它记的是「上次确认过的值」，不是「文件里现在是什么」。
    const uiPrefKnown: any = { stateFilter: listPrefs.stateFilter, sortKey: listPrefs.sortKey, sortDir: listPrefs.sortDir }
    // 队列里 ui 那几笔的记号：见文件头第一条（工作区路径里不可能出现 \u0000，所以两族不会撞）。
    const settingsUiJournalKeyOf = function (name: any): any { return '\u0000ui\u0000' + name }
    // 把一格界面偏好改进内存文档的 ui 节：别的节与别的格一律不动；ui 节缺失或形状不对就新建一份空的。
    const settingsUiSetInDoc = function (doc: any, name: any, value: any): any {
      try {
        if (!doc || typeof doc !== 'object') return false
        if (!doc.ui || typeof doc.ui !== 'object' || Array.isArray(doc.ui)) doc.ui = {}
        doc.ui[name] = value
        return true
      } catch (e) { return false }
    }
    // 一笔界面偏好写不进内存文档时记一行（沿用既有的 storage.fail，不新开事件名；key 记一个固定的记号，
    //   与同文件另一处 viewFlagLogDocFail 的写法一致，日志纪律不许把用户数据写进日志）。
    const settingsUiLogDocFail = function (): void {
      try { log('warn', 'storage.fail', { key: 'settings.ui', op: 'write' }) } catch (eL) {}
    }
    // 这一笔没能进文件时的过渡兜底：照改动前的老办法把整份三格写回旧键。旧键那一份住在 store-prefs.js
    //   （saveListPrefsLegacy），本片不自己拼那把键，免得同一把键的写法长出第二处。
    const settingsUiLegacyWrite = function (): void {
      try { if (typeof saveListPrefsLegacy === 'function') saveListPrefsLegacy() } catch (e) {}
    }
    // 文档到手（或判定问不到）时，把还在路上的 ui 那几笔接上：能进文档就进待写队列，进不去就走旧表兜底。
    //   由 kernel/settings-view.js 的 viewFlagSettle 在清空 deferred 那一趟里按 section 分派过来；返回 true
    //   表示这一笔已经处理完（调用方不必再按工作区那条路处理它，那条路会拿 undefined 当工作区根）。
    const settingsUiDrainDeferred = function (d: any, status: any): any {
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
    const settingsUiAdoptFromDoc = function (): void {
      try {
        if (uiPrefAdopted) return
        uiPrefAdopted = true
        const doc = viewFlagState.doc
        const ui = (doc && typeof doc === 'object' && doc.ui && typeof doc.ui === 'object' && !Array.isArray(doc.ui)) ? doc.ui : null
        if (!ui) return
        const before: any = {}
        for (let i = 0; i < UI_PREF_NAMES.length; i++) before[UI_PREF_NAMES[i]] = listPrefs[UI_PREF_NAMES[i]]
        let changed = false
        for (let i = 0; i < UI_PREF_NAMES.length; i++) {
          const name = UI_PREF_NAMES[i]
          const v = ui[name]
          if (typeof v !== 'string' || v === '') continue
          if (v === before[name]) continue
          // 面板状态有两处，都要换：单例 shared（还没有会话落定、面板先拿它画的那一份）与 stores 里
          //   每个会话各一份。store-snapshot.js 里 shared 是 makeStore() 单独造的对象，不在 stores 里，
          //   只换 stores 会让那块面板一直停在旧表那一份（2026-10-12 复核实测：shared 停在 'all'，
          //   stores 里已经是 'blocked'）。判据与 stores 同一套：这一格还等于旧表那一份才算没被动过。
          try {
            if (typeof shared !== 'undefined' && shared && shared[name] === before[name]) shared[name] = v
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
        // 搬完之后内存这一份就是真相：记账跟着改成内存这一份，后面提交时才判得准「用户动过哪几格」。
        for (let i = 0; i < UI_PREF_NAMES.length; i++) uiPrefKnown[UI_PREF_NAMES[i]] = listPrefs[UI_PREF_NAMES[i]]
        if (changed) viewFlagEmitAll()
      } catch (e) {}
    }
    // 登记到「这一次问话收口了」那一趟上（kernel/settings-view-state.js 的 viewFlagSubscribe）：现在还没问
    //   就等着，问完了立刻叫一次。登记放在本片末尾的初始化语句里，那时状态对象一定已经在（拼接顺序）。
    // 写一格界面偏好进文件。返回值与 setViewFlag 同义，给调用方看两种意思：
    //   true ＝ 这一次交给本机设置文件这条路了（可能还在防抖窗口里没落盘），调用方不要再写旧表；
    //   false ＝ 这条路接不下（文档问不到、是更高版本、或形状对不上），调用方按老办法写旧表。
    export const setUiPref = function (name: any, value: any): any {
      try {
        if (UI_PREF_NAMES.indexOf(name) < 0) return false
        const v = String(value == null ? '' : value)
        if (v === '') return false
        settingsViewLoad()
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这一笔，等它落地再并进文档（此刻先写旧键的话，文档一到手就会拿文件里的
          //   旧值把「刚点的那一下」顶掉，用户会看见列表自己跳回上一次的顺序）。
          viewFlagState.deferred[settingsUiJournalKeyOf(name)] = { section: 'ui', name: name, value: v }
          uiPrefKnown[name] = v
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        if (!settingsUiSetInDoc(viewFlagState.doc, name, v)) {
          // 文档在手却写不进这一格（形状对不上）：记一行再交回调用方写旧表，别让用户那一下静默消失。
          settingsUiLogDocFail()
          return false
        }
        viewFlagState.journal[settingsUiJournalKeyOf(name)] = { section: 'ui', name: name, value: v }
        uiPrefKnown[name] = v
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
    // 这一趟要交出去哪几格。调用方点名的优先（列表面板点一下改的就是它写的那几格，见 views/ListTab.js：
    //   点筛选改 stateFilter，点排序一次改 sortKey 与 sortDir 两格）；没点名时按「与上次确认过的值不同」推。
    //   为什么绝不能整份三格都交：文档还在路上时，没被动过的那两格带的是旧表那一份（这一刻内存还没被文件里
    //   那一份换过），文档一到手就会把文件里另外两格较新的值顶掉并落盘 —— 用户在另一个窗口刚选好的排序
    //   会被静默改回默认（2026-10-12 复核 Q4 用两个窗口复现：窗口 A 选 name/desc，窗口 B 开窗那一刻点筛选，
    //   文件里的 sortKey 被写成 number）。没点名的调用方按记账推，同样只交动过的格。
    const settingsUiNamesToSubmit = function (changed: any): any {
      const want = (changed == null) ? null : (Array.isArray(changed) ? changed : [changed])
      const out = []
      for (let i = 0; i < UI_PREF_NAMES.length; i++) {
        const name = UI_PREF_NAMES[i]
        if (want) { if (want.indexOf(name) >= 0) out.push(name) }
        else if (listPrefs[name] !== uiPrefKnown[name]) out.push(name)
      }
      return out
    }
    // 把用户动过的那几格交给文件（列表面板点一下筛选或排序时调的就是这里，见 views/ListTab.js）。
    //   整批先验一遍再动：三格里有一格接不下（名字不在列、值是空串、文档形状对不上）就一格都不写，
    //   返回 false 让调用方整份写回旧键 —— 免得出现「文件里有 A、旧键里有 A+B」两份打架的真相。
    //   传参 changed 可以是格名或格名数组；不传时按记账推（见上面那个函数）。
    export const saveUiPrefs = function (changed: any): any {
      try {
        settingsViewLoad()
        const names = settingsUiNamesToSubmit(changed)
        if (names.length === 0) return true
        for (let i = 0; i < names.length; i++) {
          const name = names[i]
          if (UI_PREF_NAMES.indexOf(name) < 0) return false
          if (String(listPrefs[name] == null ? '' : listPrefs[name]) === '') return false
        }
        // 文档还在路上时这一批全进 deferred（setUiPref 自己处理）；已经问完却拿不到文档对象，整批接不下。
        if (viewFlagState.status !== 'loading' && (viewFlagState.status !== 'ready' || !viewFlagState.doc || typeof viewFlagState.doc !== 'object')) return false
        for (let i = 0; i < names.length; i++) {
          if (!setUiPref(names[i], listPrefs[names[i]])) return false
        }
        return true
      } catch (e) { return false }
    }
    // 初始化：把「文件到手就搬进内存」登记上去（见上面 settingsUiAdoptFromDoc 与 viewFlagSubscribe 的说明）。
    try { viewFlagSubscribe(settingsUiAdoptFromDoc) } catch (e0) {}
