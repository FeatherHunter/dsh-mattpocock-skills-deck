/**
 * src/client/kernel/settings-view-write.js — 内核模块（#1012 后续修复：写这一趟）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.js 里那一行 kernel:settingsViewWrite 拼接标记处（apply 闭包内原位），
 *   与 ctx.js/seam 同模式，一源两物，src 零复制。这一行标记必须排在 kernel:settingsView 之后：
 *   本片要用那一片的键与文档工具（viewFlagWriteKeyOf / viewFlagSetInDoc / viewFlagJournalKeyOf /
 *   viewFlagLegacyWrite / viewFlagLogDocFail），以及 kernel/settings-view-state.js 的状态对象。
 *
 * 本片管「写这一趟」：待写队列（journal）、500 毫秒防抖、真正要写之前先重读文件再合并、
 *   回包按值划队列、写失败后留队并重试一趟。
 *
 * 接线：store-prefs.js 的 isBannerFolded / setBannerFolded 与 views/SubworkspaceMark.js 的「自动展开过没有」
 *   那一段改调这一族（导出名与签名一字不变），旧表那几行原地留着当过渡；本片不在（老产物、渲染替身里）
 *   或回 false 时，调用方照改动前的老办法写旧表。
 *
 * 为什么单独一片：settings-view.js 在拆出这一片之前按门禁算法已经 349 行（文件粒度门禁上限 350 行，
 *   见 tests/verify-file-granularity.js），而本次修复的四个必修点里有三个都落在写这条路上，塞不进去。
 *
 * 这一趟的四条约定，改之前先读懂（都是 #1012 后续修复按探针实测定下来的）：
 *   一、队列里一笔「出队」只有一个理由：某次写成功回包，而且这一格从发出去那一刻起没被改过。
 *       这一趟飞在天上的几百毫秒里，用户完全可能把同一格又改一次（收起之后马上又点开），那一笔已经在
 *       队列里换成了新值；按名字盲删会把新值一起划掉，于是队列空了、第二趟再也不会来 —— 盘上留旧值、
 *       内存是新值，两边从此不一致。所以回包只划「值没被改过」的那些，被改过的留在队列里再排一趟。
 *   二、写失败不把这一笔从队列里划掉：下一趟写（用户再动一下，或下面那一次自动重试）会带着它再试一次，
 *       一次瞬时故障这样就自愈了。自动重试只给一趟（成功一次就恢复额度）：故障持续存在时不许变成
 *       自续的循环（#709 已经把全库的自续定时器拆掉，这里不重新长一个出来）。
 *   三、真正要写之前先重读一次文件，把本窗改过的那几格合并进刚读回来的那一份再写出去。不这么做，
 *       每一笔写都是整份覆盖，而后写的窗会把先写那扇窗刚写进去的别的格整节顶掉（先写那扇窗还以为
 *       自己成功了）。做不到原子这一点如实写下：重读与写回是两条电话，中间隔着一次往返，浏览器里也
 *       没有文件锁或事务，所以两扇窗同时改**同一格**时仍可能丢掉后落盘的那一次。重读把「整节被顶掉」
 *       的窗口从「上一趟写到现在」缩到「重读→写回」这一个来回，但缩不到零：重读之后、写回之前别人
 *       写进去的别的格，照样可能被这一趟整份顶掉（实测），不许说成不会。
 *   四、认不出工作区根时这一片直接返回失败、一个字都不写文件（见 settings-view.js 的 viewFlagWriteKeyOf）：
 *       会话目录当键写下去会留下永远合并不到一起的孤儿记录。
 */
    // 防抖窗口取 500 毫秒，理由有三条。第一条：一次收起或展开在界面上往往连着来两下（点按钮那一下，
    //   加同一个工作区别的会话跟着重渲染那一趟），而每一次落盘都是宿主先读整份文件、再整份写回。
    // 第二条：与仓库既有的写合并窗口同一量级（日志转发的 1000 毫秒、交接的 800 毫秒），比它们略短。
    // 第三条：观看状态是人点一下就期待下次打开还在的东西，窗口太长，点完立刻关掉整个窗口那一下
    //   （页面卸载之后定时器不再有机会跑）就会把最后一次改动丢掉。
    export const VIEW_FLAG_WRITE_DEBOUNCE_MS = 500
    // 把这一趟要写的整份文档备好：先重读一次文件，再把本窗改过的那几格合并进刚读回来的那一份。
    //   重读不回来（手机不通、文件是更高版本、内容坏了、还没建出来）就照内存里那一份写：内存那一份至少
    //   带着本窗的改动，比什么都不写强；顶掉别人别的格的风险与改动前一样，不会更差。
    //   返回值是一个 Promise，值是这次要写出去的文档。
    const viewFlagFreshDocFor = function (sentKeys) {
      const useMemory = function () { return viewFlagState.doc }
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return Promise.resolve(useMemory())
        const t0 = Date.now()
        return host.call('wf.getSettings', {}).then(function (res) {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.getSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.getSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'get-not-ok')) })
          } catch (eL) {}
          // 只认能整份写回去的那一份：更高版本（readonly）与形状不对的都退回内存那一份，别拿读不懂的内容去覆盖。
          if (!okRes || res.readonly === true || !res.value || typeof res.value !== 'object') return useMemory()
          const fresh = res.value
          for (let i = 0; i < sentKeys.length; i++) {
            const d = viewFlagState.journal[sentKeys[i]]
            if (!d) continue
            // 用队列里这一笔自带的键，不重算（#1012 后续修复的建议 2）：本会话若在排期与落盘之间跟丢了根，
            //   重算出来的键会换成会话目录那一条，文件里就长出同一工作区的第二条记录、根那条还是旧值。
            const key = d.key || viewFlagDocKeyOf(d.cwd)
            if (key) viewFlagSetInDoc(fresh, d.cwd, key, d.name, d.value)
          }
          // 内存那一份换成刚读回来的那一份：这样界面接下来读到的，与盘上那一份是同一份（含别人写进去的格）。
          viewFlagState.doc = fresh
          return fresh
        }, function () { return useMemory() })
      } catch (e) { return Promise.resolve(useMemory()) }
    }
    // 写成功回包：只划掉「发出去之后值没被改过」的那几笔，被改过的留在队列里再排一趟（文件头第一条）。
    //   顺带把自动重试的额度恢复一次：这一趟成功了，下一次真失败时还值得自动再试一趟。
    const viewFlagConfirmSent = function (sentKeys, sentVals) {
      try {
        let again = false
        for (let i = 0; i < sentKeys.length; i++) {
          const k = sentKeys[i]
          const cur = viewFlagState.journal[k]
          if (!cur) continue
          if (cur.value === sentVals[k]) { delete viewFlagState.journal[k]; continue }
          again = true
        }
        viewFlagState.retryLeft = 1
        if (again) viewFlagScheduleWrite()
      } catch (e) {}
    }
    // 这一笔没写进文件时的过渡兜底 + 留队：
    //   ① 按旧表的老办法记下来（键与记法与改动前逐字一致）；
    //   ② 队列里不划掉 —— 下一趟写（用户再动一下，或下面那次自动重试）会带着它们再试一次；
    //   ③ 自动重试只给一趟：额度为 0 就不再自己排，只等用户下一次动作（故障持续时不许自续）。
    //   诚实说明这一手兜底兜得住什么：文件里已经有这个工作区的记录时，写进旧键的这一份读不回来
    //   （读侧「文件里这条记录有值就以它为准」），它只在本窗口内充当记性；页面一关就只剩文件里那一份。
    //   真正让这次改动不丢的是上面第 ② 条：这一格还在队列里，下一趟写会把它落进文件。
    const viewFlagFallbackToLegacy = function (sentKeys) {
      try {
        for (let i = 0; i < sentKeys.length; i++) {
          const d = viewFlagState.journal[sentKeys[i]]
          if (d) viewFlagLegacyWrite(d.cwd, d.name, d.value)
        }
        if (viewFlagState.retryLeft > 0) { viewFlagState.retryLeft -= 1; viewFlagScheduleWrite() }
      } catch (e) {}
    }
    // 发出去的那一份要先照一张相：交给手机之后本窗口随时可能再改内存里那份文档（用户又点了一下），
    //   引用同一个对象的话，手机上序列化出来的内容会跟着变 —— 于是「这一趟发的是哪个值」就说不清了，
    //   回包按值划队列那一条（文件头第一条）也会跟着失准。照一张相，这一趟发出去的就是这一刻的样子。
    const viewFlagSnapshotDoc = function (doc) {
      try { return JSON.parse(JSON.stringify(doc)) } catch (e) { return doc }
    }
    // 这一趟真正写出去的值：从交给宿主的那份快照里按格取，不是从队列里取「发出前那一刻的值」。
    //   为什么必须这样（#1012 后续修复的 M1 残留）：重读那一个来回里用户又改了值，合并用的是「合并那一刻」
    //   的值、快照里落的也是它；判据若仍比发出前的值，用户在回包前又改回发出前那个值就会被判成「没改过」，
    //   这一笔被划掉 —— 盘上留中间值、内存是最后那一下，两边从此不一致（要等用户再点这一格才可能修回来）。
    //   按格取值时先按折算键找那条记录（同一工作区的两种写法算同一条），找不到就退回队列里的值。
    const viewFlagSentValIn = function (snap, d) {
      try {
        const key = d.key || viewFlagDocKeyOf(d.cwd)
        if (!key || !snap || !snap.workspaces || typeof snap.workspaces !== 'object') return d.value
        const ek = viewFlagEntryKeyOf(snap, key)
        const v = ek ? (snap.workspaces[ek] || {})[d.name] : undefined
        return (typeof v === 'boolean') ? v : d.value
      } catch (e) { return d.value }
    }
    const viewFlagSentValsOf = function (snap, sentKeys) {
      const out = {}
      for (let i = 0; i < sentKeys.length; i++) {
        const d = viewFlagState.journal[sentKeys[i]]
        if (d) out[sentKeys[i]] = viewFlagSentValIn(snap, d)
      }
      return out
    }
    // 把这一份已经照过相的文档交给宿主（wf.setSettings 收的是整份文档），回包按上面那两条约定处理。
    //   sentVals 必须是对着同一份快照算出来的（见 viewFlagSentValIn）：这一趟发的是哪个值只有一个答案。
    const viewFlagSendDoc = function (snap, sentKeys, sentVals, t0) {
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { viewFlagFallbackToLegacy(sentKeys); return }
        host.call('wf.setSettings', { value: snap }).then(function (res) {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.setSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.setSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'set-not-ok')) })
          } catch (eL) {}
          if (okRes) { viewFlagConfirmSent(sentKeys, sentVals); return }
          // 写失败（含文件只读被拒、手机说不行）：写回旧键做过渡，并把这几个还留在队列里。
          viewFlagFallbackToLegacy(sentKeys)
        }, function () { viewFlagFallbackToLegacy(sentKeys) })
      } catch (e) { viewFlagFallbackToLegacy(sentKeys) }
    }
    // 真写一趟：先重读合并，再把「真正要发出去的那一份」照一张相，按这一份记下这一趟发出去的值，最后整份写出去。
    const viewFlagWriteNow = function () {
      try {
        viewFlagState.timer = 0
        if (viewFlagState.status !== 'ready' || !viewFlagState.doc) return
        const sentKeys = Object.keys(viewFlagState.journal)
        if (!sentKeys.length) return
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { viewFlagFallbackToLegacy(sentKeys); return }
        const t0 = Date.now()
        // 照相与记值必须对着同一份：先照相，再从这份相里按格取出「这一趟发出去的值」（文件头那一条判据）。
        const sendOf = function (doc) {
          const snap = viewFlagSnapshotDoc(doc)
          viewFlagSendDoc(snap, sentKeys, viewFlagSentValsOf(snap, sentKeys), t0)
        }
        viewFlagFreshDocFor(sentKeys).then(function (fresh) {
          const value = fresh || viewFlagState.doc
          if (!value) { viewFlagFallbackToLegacy(sentKeys); return }
          sendOf(value)
        }, function () {
          if (viewFlagState.doc) sendOf(viewFlagState.doc)
          else viewFlagFallbackToLegacy(sentKeys)
        })
      } catch (e) { try { viewFlagFallbackToLegacy(Object.keys(viewFlagState.journal)) } catch (e2) {} }
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
    // 写一格。返回值是给调用方看的两种意思：
    //   true ＝ 这一次交给本机设置文件这条路了（可能还在防抖窗口里没落盘），调用方不要再写旧表；
    //   false ＝ 这条路接不下（认不出工作区根，或文档问不到、是更高版本），调用方按老办法写旧表。
    export const setViewFlag = function (cwd, name, value) {
      try {
        const on = value === true
        settingsViewLoad()
        const key = viewFlagWriteKeyOf(cwd)
        // 认不出工作区根就不写文件（文件头第四条）：返回 false 让调用方照改动前的老办法写旧表，
        //   行为与搬迁前一致，只是这一次暂时不落新家 —— 总比在文件里留下一条永远合并不到一起的记录强。
        if (!key) return false
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这一笔，等它落地再并进文档（此刻先写旧键的话，文档一到手就会拿文件里的
          //   旧值把「刚点的那一下」顶掉，横幅会当着人的面自己弹回来）。
          viewFlagState.deferred[viewFlagJournalKeyOf(key, name)] = { cwd: cwd, name: name, value: on }
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        if (!viewFlagSetInDoc(viewFlagState.doc, cwd, key, name, on)) {
          // 文档在手却写不进这一格（形状对不上）：记一行再交回调用方写旧表 —— 从前这一档不写也不记，
          //   排查时只看到「用户点了、什么都没发生」（#1012 后续修复的 A5）。
          viewFlagLogDocFail()
          return false
        }
        viewFlagState.journal[viewFlagJournalKeyOf(key, name)] = { cwd: cwd, name: name, value: on, key: key }
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
