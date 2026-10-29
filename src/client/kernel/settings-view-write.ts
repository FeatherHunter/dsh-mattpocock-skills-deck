/**
 * src/client/kernel/settings-view-write.ts — 内核模块（#1012 后续修复：写这一趟）
 * （原来是 .js：按「动到哪里转哪里」转成 TypeScript，行为零变化。本文件是模块真源，同名 .js 已改由构建生成（会被覆盖，不要去改），本 .ts 既进类型检查也进拼接与 ts-hook 测试。）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mts 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里那一行 kernel:settingsViewWrite 拼接标记处（apply 闭包内原位），
 *   与 ctx.ts/seam 同模式，源码树里只有这一份真源。这一行标记必须排在 kernel:settingsView 之后：
 *   本片要用那一片的键与文档工具（viewFlagWriteKeyOf / viewFlagSetInDoc / viewFlagJournalKeyOf /
 *   viewFlagLegacyWrite / viewFlagLogDocFail），以及 kernel/settings-view-state.ts 的状态对象。
 *
 * 本片管「写这一趟」：待写队列（journal）、500 毫秒防抖、真正要写之前先重读文件再合并、
 *   回包按值划队列、写失败后留队并重试一趟。
 *
 * 接线：views/SubworkspaceMark.js 的「自动展开过没有」那一段改调这一族（导出名与签名一字不变），
 *   旧表那几行原地留着当过渡；本片不在（老产物、渲染替身里）或回 false 时，调用方照改动前的老办法写旧表。
 *   胶囊状态栏与 deck 工具箱（#1612）不走旧表：它们只有设置文件一份真源，没有旧 localStorage 键可兜。
 *   #1612 起多一个写口 setViewFlagValue：它不改写值（不做真假值转换），只负责把字符串原样交给
 *   「改内存文档 → 进队列 → 防抖 → 写前重读合并」这一条路，给 kernel/deck-state.ts 的
 *   setDeckStatusBar / setDeckTools 用；返回值含义与 setViewFlag 一致（true ＝ 交给文件这条路了）。
 *
 * 为什么单独一片：settings-view.js 在拆出这一片之前按门禁算法已经 349 行（文件粒度门禁上限 350 行，
 *   见 tests/verify-file-granularity.ts），而本次修复的四个必修点里有三个都落在写这条路上，塞不进去。
 *
 * 这一趟的四条约定，改之前先读懂（都是 #1012 后续修复按探针实测定下来的）：
 *   一、队列里一笔「出队」只有一个理由：某次写成功回包，而且这一格从发出去那一刻起没被改过。
 *       这一趟飞在天上的几百毫秒里，用户完全可能把同一格又改一次（收起之后马上又点开），那一笔已经在
 *       队列里换成了新值；按名字盲删会把新值一起划掉，于是队列空了、第二趟再也不会来 —— 盘上留旧值、
 *       内存是新值，两边从此不一致。所以回包只划「值没被改过」的那几笔，被改过的留在队列里再排一趟。
 *   二、写失败不把这一笔从队列里划掉：下一趟写（用户再动一下，或下面那次自动重试）会带着它再试一次，
 *       一次瞬时故障这样就自愈了。自动重试只给一趟（成功一次就恢复额度）：故障持续存在时不许变成
 *       自续的循环（#709 已经把全库的自续定时器拆掉，这里不重新长一个出来）。
 *   三、真正要写之前先重读一次文件，把本窗改过的那几格合并进刚读回来的那一份再写出去。不这么做，
 *       每一笔写都是整份覆盖，而后写的窗会把先写那扇窗刚写进去的别的格整节顶掉（先写那扇窗还以为
 *       自己成功了）。做不到原子这一点如实写下：重读与写回是两条电话，中间隔着一次往返，浏览器里也
 *       没有文件锁或事务，所以两扇窗同时改**同一格**时仍可能丢掉后落盘的那一次。重读把「整节被顶掉」
 *       的窗口从「上一趟写到现在」缩到「重读→写回」这一个来回，但缩不到零：重读之后、写回之前别人
 *       写进去的别的格，照样可能被这一趟整份顶掉（实测），不许说成不会。
 *   四、认不出工作区根时这一片直接返回失败、一个字都不写文件（见 settings-view.ts 的 viewFlagWriteKeyOf）：
 *       会话目录当键写下去会留下永远合并不到一起的孤儿记录。
 *       只有一个例外（#1641）：设置页总览的行来自工作区名单，调用方明确说这一行在名单上（listed）时，
 *       名单上的路径就是用户看得见的那条目录、不是会话里的猜测，可以按它先记一条带 unopened 标记的临时
 *       记录；等工作区打开、认出根以后由 #1640 合并到根那一条。
 */
    import { VIEW_FLAG_WRITE_DEBOUNCE_MS } from '../../shared/time-config/values.js'
    // 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）：
    // viewFlagState 的真源在 kernel/settings-view-state.js，viewFlagJournalKeyOf/viewFlagDocKeyOf/
    //   viewFlagSetInDoc/viewFlagEntryKeyOf/viewFlagLegacyWrite/viewFlagLogDocFail 的真源在
    //   kernel/settings-view.js，settingsUiSetInDoc 的真源在 kernel/settings-ui.js，
    //   settingsTemplatesSetInDoc 的真源在 kernel/settings-templates.js，
    //   settingsDebugSetInDoc/settingsDebugDocLooksReal/settingsDebugLegacyWrite 的真源在
    //   kernel/settings-debug.js，saveListPrefsLegacy 的真源在 kernel/store-prefs.js，
    //   tplLegacyWriteAll 的真源在 config.js，timer 的真源在 kernel/hostShim.js；
    //   本片只在调用时求值，初始化期不碰；类型一律写 any 是刻意的：在这里凭记忆写窄，
    //   只会把那边正常的改动变成这里的假报错（与 kernel/link.ts 同例）。
    //   host/log 走全局已声明的那一份，这里不重复。VIEW_FLAG_WRITE_DEBOUNCE_MS 走上面那一行真引用：
    //   宿主与门禁把它当模块 import 跑，拼进闭包时构建会把那一行删掉、名字由闭包里的时间片段提供。
    declare const viewFlagState: any;
    declare function viewFlagJournalKeyOf(...args: any[]): any;
    declare function viewFlagDocKeyOf(...args: any[]): any;
    declare function viewFlagSetInDoc(...args: any[]): any;
    declare function viewFlagEntryKeyOf(...args: any[]): any;
    declare function viewFlagLegacyWrite(...args: any[]): any;
    declare function viewFlagLogDocFail(...args: any[]): any;
    declare function settingsUiSetInDoc(...args: any[]): any;
    declare function settingsTemplatesSetInDoc(...args: any[]): any;
    declare function settingsDebugSetInDoc(...args: any[]): any;
    declare function settingsDebugDocLooksReal(...args: any[]): any;
    declare function settingsDebugLegacyWrite(...args: any[]): any;
    declare function saveListPrefsLegacy(...args: any[]): any;
    declare function tplLegacyWriteAll(...args: any[]): any;
    declare function settingsViewLoad(...args: any[]): any;
    declare function viewFlagWriteKeyOf(...args: any[]): any;
    declare function viewFlagNormOf(...args: any[]): any;
    declare function viewFlagSeedValueOf(...args: any[]): any;
    declare const VIEW_FLAG_SEED_NAMES: any;
    // #1612 两个文字开关（statusBar、deckTools）的名字表与允许值表住在 kernel/settings-view.js，
    //   这里按仓里跨片规矩声明一句（实现只在拼好的闭包里有一份），用来判「这一笔在文件里写进去了没有」。
    declare function viewFlagIsTextNameOf(...args: any[]): any;
    declare function viewFlagTextValuesOf(...args: any[]): any;
    declare const timer: any;
    // 防抖窗口取 500 毫秒，理由有三条。第一条：一次收起或展开在界面上往往连着来两下（点按钮那一下，
    //   加同一个工作区别的会话跟着重渲染那一趟），而每一次落盘都是宿主先读整份文件、再整份写回。
    // 第二条：与仓库既有的写合并窗口同一量级（日志转发的 1000 毫秒、交接的 800 毫秒），比它们略短。
    // 第三条：观看状态是人点一下就期待下次打开还在的东西，窗口太长，点完立刻关掉整个窗口那一下
    //   （页面卸载之后定时器不再有机会跑）就会把最后一次改动丢掉。
    // 这个合并窗住中央：config/intervals.yaml 的 viewFlagWriteDebounceMs，值由 tests/verify-time-config.ts 看守（本文件顶部 import 真引用）。
    // #1640：认出工作区根以后，把「按名单路径先记下」的临时记录合并到根那一条，文件里不留两处分家。
    //   判据只有一条：临时记录里写下来的格就是用户真点过的格（#1640 起临时记录不再种缺省，见 settings-view.ts
    //   的 viewFlagSetInDoc）；合并时把这些格搬到根记录上，用户最后一次明确点过的选择覆盖根记录里更早的值，
    //   没点过的格一个都不碰，根记录原来的选择（或它自己的缺省）原样留着。
    //   旧格式（#1641 版临时记录把三格缺省一并种进去了）分不出点过没点过，只能按「值与种子缺省不同才算点过」
    //   近似处理；那个格式没发布过，这里只兜底，不让它把根记录里用户真正的选择盖成缺省。
    const viewFlagMergeCarryOf = function (entry: any, tempKey: any): any {
      const out: any = {}
      try {
        if (!entry || typeof entry !== 'object') return out
        const legacy = entry['noRepoDismissed'] !== undefined || entry['subwsMarkAutoShown'] !== undefined
        for (let i = 0; i < VIEW_FLAG_SEED_NAMES.length; i++) {
          const name = VIEW_FLAG_SEED_NAMES[i]
          const allowed: any = viewFlagTextValuesOf(name)
          if (!allowed || !allowed.length) continue
          const v = entry[name]
          if (typeof v !== 'string' || allowed.indexOf(v) < 0) continue
          if (legacy && v === viewFlagSeedValueOf(tempKey, name)) continue
          out[name] = v
        }
      } catch (e) {}
      return out
    }
    // 队列里按临时键记着的那几笔挪到根键上：值已经搬进根记录了，再按临时键写一遍会在文件里重新长出
    //   临时记录（写前重读合并按 d.key 落）。目标格已经在队列里（更新的一笔）时不覆盖，只把旧那笔划掉。
    const viewFlagMergeMoveJournal = function (tempKey: any, rootKey: any): void {
      try {
        if (rootKey === tempKey) return
        const jks = Object.keys(viewFlagState.journal)
        for (let i = 0; i < jks.length; i++) {
          const d = viewFlagState.journal[jks[i]]
          if (!d || !d.key || viewFlagNormOf(d.key) !== viewFlagNormOf(tempKey)) continue
          delete viewFlagState.journal[jks[i]]
          const nk = viewFlagJournalKeyOf(rootKey, d.name)
          if (viewFlagState.journal[nk]) continue
          d.key = rootKey
          delete d.unopened
          viewFlagState.journal[nk] = d
        }
      } catch (e) {}
    }
    // 把内存文档里所有「已经认得出根」的临时记录合并掉：返回这次合并了几条（0 = 没有可合的）。
    //   同一条路径的写法不同（大小写、末尾斜杠、分隔符）折算成同一个根时算「原地毕业」：那条记录本来就是
    //   根那一条，只需清掉标记、补齐普通记录该有的几格，不搬值。
    //   合并成功（值已经改进内存文档）时记下待落盘标记与一条待写日志：日志等这一趟写成功才发，
    //   写失败时不留一行「合了」的假话。
    const viewFlagMergeDoc = function (doc: any, via: any): any {
      let merged = 0
      try {
        if (!doc || typeof doc !== 'object' || !doc.workspaces || typeof doc.workspaces !== 'object') return 0
        const tempKeys = Object.keys(doc.workspaces)
        for (let i = 0; i < tempKeys.length; i++) {
          const tempKey = tempKeys[i]
          const rec = doc.workspaces[tempKey]
          if (!rec || typeof rec !== 'object' || rec.unopened !== true) continue
          const rootKey = viewFlagDocKeyOf(tempKey)
          if (!rootKey) continue
          const carried = viewFlagMergeCarryOf(rec, tempKey)
          let fields = 0
          const existing = viewFlagEntryKeyOf(doc, rootKey)
          if (existing && existing !== tempKey) {
            // 根那一条已经在：把用户点过的格逐格搬上去，临时记录删掉。
            for (const name of Object.keys(carried)) {
              if (viewFlagSetInDoc(doc, rootKey, rootKey, name, carried[name])) fields += 1
            }
            delete doc.workspaces[tempKey]
          } else {
            // 根那一条还不在（或它就是这条临时记录，只是写法不同）：原地毕业 —— 补齐普通记录该有的几格、
            //   清掉标记，键换成根的写法（写法相同就不用换）。
            for (let j = 0; j < VIEW_FLAG_SEED_NAMES.length; j++) {
              const n = VIEW_FLAG_SEED_NAMES[j]
              if (rec[n] === undefined) rec[n] = viewFlagSeedValueOf(tempKey, n)
            }
            delete rec.unopened
            if (rootKey !== tempKey) { doc.workspaces[rootKey] = rec; delete doc.workspaces[tempKey] }
            fields = Object.keys(carried).length
          }
          viewFlagMergeMoveJournal(tempKey, rootKey)
          merged += 1
          try {
            if (viewFlagState.mergePending !== true) viewFlagState.mergePending = true
            if (!viewFlagState.mergeLog || typeof viewFlagState.mergeLog !== 'object') viewFlagState.mergeLog = {}
            const h = dswsLogHash(String(tempKey))
            if (!viewFlagState.mergeLog[h]) {
              viewFlagState.mergeLog[h] = { via: String(via || ''), rootHash: dswsLogHash(String(rootKey)), fields: fields }
            }
          } catch (eL) {}
        }
      } catch (e) {}
      return merged
    }
    // 试合并一次，合到了就排一次落盘（合并结果写进文件才算数）。设置文档还没到手时什么都不做。
    //   供 kernel/settings-view.ts 的收口（文档到手那一下）与 snapshot-cache-store.ts 的「刚认出工作区根」
    //   那一下调用；两条路都可能先到，重复调没有副作用（没有临时记录时直接回 0）。
    export const viewFlagMergeNow = function (via: any): any {
      try {
        if (viewFlagState.status !== 'ready' || !viewFlagState.doc) return 0
        const merged = viewFlagMergeDoc(viewFlagState.doc, via)
        if (merged > 0) viewFlagScheduleWrite()
        return merged
      } catch (e) { return 0 }
    }
    // 这一趟写成功之后才发合并日志：每条临时记录一行，说明是哪条路带起来的、归到哪个根、搬了几格。
    //   工作区原始路径不进日志，键只记短散列；写失败时这行不发，等下一趟写成功再发。
    const viewFlagMergeFlushLog = function (): void {
      try {
        if (viewFlagState.mergePending !== true) return
        const hashes = Object.keys(viewFlagState.mergeLog || {})
        for (let i = 0; i < hashes.length; i++) {
          const m = viewFlagState.mergeLog[hashes[i]]
          if (!m) continue
          try { log('info', 'settings.merge', { via: String(m.via || ''), keyHash: String(hashes[i]), rootHash: String(m.rootHash || ''), fields: Number(m.fields) || 0 }) } catch (eL) {}
        }
        viewFlagState.mergeLog = {}
        viewFlagState.mergePending = false
      } catch (e) {}
    }
    // 把这一趟要写的整份文档备好：先重读一次文件，再把本窗改过的那几格合并进刚读回来的那一份。
    //   重读不回来（手机不通、文件是更高版本、内容坏了、还没建出来）就照内存里那一份写：内存那一份至少
    //   带着本窗的改动，比什么都不写强；顶掉别人别的格的风险与改动前一样，不会更差。
    //   返回值是一个 Promise，值是这次要写出去的文档。
    const viewFlagFreshDocFor = function (sentKeys: any): any {
      const useMemory = function (): any { return viewFlagState.doc }
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return Promise.resolve(useMemory())
        const t0 = Date.now()
        return host.call('wf.getSettings', {}).then(function (res: any): any {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.getSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.getSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'get-not-ok')) })
          } catch (eL) {}
          // 只认能整份写回去的那一份：更高版本（readonly）与形状不对的都退回内存那一份，别拿读不懂的内容去覆盖。
          if (!okRes || res.readonly === true || !res.value || typeof res.value !== 'object') return useMemory()
          // 再拦一道形状：一份「半份文档」（比如占位电话答上来的 {version: 1}，或少了某几节的东西）当基底整份
          //   写回去，核会按「缺的那几节是空的」归一之后落盘，用户本来的 ui / workspaces / templates 就被写成
          //   空值 —— 这是纵深防御（真核归一之后五节齐全，正常路径到不了这里），但代价只是一次形状判断。
          //   判据取自 kernel/settings-debug.js 同一个产物里的名字；老产物里没有这个函数时按改动前的行为走。
          if (typeof settingsDebugDocLooksReal === 'function' && !settingsDebugDocLooksReal(res.value, true)) return useMemory()
          const fresh = res.value
          // #1640：盘上那份里可能还留着别窗写进去、本窗内存里没有的临时记录，先按同一套规则合并掉 ——
          //   这一趟写出去的就是合并后的一份，文件里不留两处分家。
          try { viewFlagMergeDoc(fresh, 'write') } catch (eM) {}
          for (let i = 0; i < sentKeys.length; i++) {
            const d = viewFlagState.journal[sentKeys[i]]
            if (!d) continue
            // 界面偏好那一族（kernel/settings-ui.js）只有格名、没有工作区路径，直接改进 ui 节。
            if (d.section === 'ui') { settingsUiSetInDoc(fresh, d.name, d.value); continue }
            // 动作模板那一族（kernel/settings-templates.js）同样只有格名、没有工作区路径，直接改进 templates 节。
            if (d.section === 'templates') { settingsTemplatesSetInDoc(fresh, d.name, d.value); continue }
            // 调试开关那一族（kernel/settings-debug.js）同 ui 与 templates：只有格名，直接改进 debug 节。
            if (d.section === 'debug') { settingsDebugSetInDoc(fresh, d.name, d.value); continue }
            // 用队列里这一笔自带的键，不重算（#1012 后续修复的建议 2）：本会话若在排期与落盘之间跟丢了根，
            //   重算出来的键会换成会话目录那一条，文件里就长出同一工作区的第二条记录、根那条还是旧值。
            const key = d.key || viewFlagDocKeyOf(d.cwd)
            if (key) viewFlagSetInDoc(fresh, d.cwd, key, d.name, d.value, d.unopened)
          }
          // 内存那一份换成刚读回来的那一份：这样界面接下来读到的，与盘上那一份是同一份（含别人写进去的格）。
          viewFlagState.doc = fresh
          return fresh
        }, function (): any { return useMemory() })
      } catch (e) { return Promise.resolve(useMemory()) }
    }
    // 写成功回包：只划掉「发出去之后值没被改过」的那几笔，被改过的留在队列里再排一趟（文件头第一条）。
    //   顺带把自动重试的额度恢复一次：这一趟成功了，下一次真失败时还值得自动再试一趟。
    const viewFlagConfirmSent = function (sentKeys: any, sentVals: any): void {
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
        // #1640：合并结果这一趟真写进了文件，才把合并日志发出去（写失败时不发「合了」的假话）。
        if (viewFlagState.mergePending === true) viewFlagMergeFlushLog()
        if (again) viewFlagScheduleWrite()
        // 合并可能把队列里的那几笔挪到了新键上（不在这一趟的 sentKeys 里）：还有没确认的就再排一趟。
        else if (Object.keys(viewFlagState.journal).length > 0) viewFlagScheduleWrite()
      } catch (e) {}
    }
    // 这一笔没写进文件时的过渡兜底 + 留队：
    //   ① 有旧表的几族按老办法记下来（键与记法与改动前逐字一致）：界面偏好、模板、调试开关、红文件夹标志；
    //      #1612 的 statusBar 与 deckTools 没有旧键可退，不写旧表，只留在队列里等下一趟；
    //   ② 队列里不划掉 —— 下一趟写（用户再动一下，或下面那次自动重试）会带着它们再试一次；
    //   ③ 自动重试只给一趟：额度为 0 就不再自己排，只等用户下一次动作（故障持续时不许自续）。
    //   诚实说明这一手兜底兜得住什么：文件里已经有这个工作区的记录时，写进旧键的这一份读不回来
    //   （读侧「文件里这条记录有值就以它为准」），它只在本窗口内充当记性；页面一关就只剩文件里那一份。
    //   真正让这次改动不丢的是上面第 ② 条：这一格还在队列里，下一趟写会把它落进文件。
    const viewFlagFallbackToLegacy = function (sentKeys: any): void {
      try {
        for (let i = 0; i < sentKeys.length; i++) {
          const d = viewFlagState.journal[sentKeys[i]]
          if (!d) continue
          // 界面偏好那一族照改动前的老办法兜底：整份三格写回旧键 dsws.listPrefs（由 store-prefs.js 管那把键）。
          if (d.section === 'ui') { saveListPrefsLegacy(); continue }
          // 动作模板那一族照改动前的老办法兜底：整份写回旧键 dsws.templates（由 config.js 那一份管那把键）。
          if (d.section === 'templates') { tplLegacyWriteAll(); continue }
          // 调试开关那一族兜底：把内存这一份（＝真值）写回旧键 dsws.debug 当秒显快照，理由见 settings-debug.js。
          if (d.section === 'debug') { settingsDebugLegacyWrite(); continue }
          // #1612 的两个文字开关没有对应的旧 localStorage 键（旧版根本没有这两件事），也不再有旧字段可换算：
          //   写不进文件就留在队列里等下一趟（下一趟会再试），这里只补一行日志说明这一笔没落地。
          if (viewFlagIsTextNameOf(d.name)) { viewFlagLogDocFail(); continue }
          viewFlagLegacyWrite(d.cwd, d.name, d.value)
        }
        if (viewFlagState.retryLeft > 0) { viewFlagState.retryLeft -= 1; viewFlagScheduleWrite() }
      } catch (e) {}
    }
    // 发出去的那一份要先照一张相：交给手机之后本窗口随时可能再改内存里那份文档（用户又点了一下），
    //   引用同一个对象的话，手机上序列化出来的内容会跟着变 —— 于是「这一趟发的是哪个值」就说不清了，
    //   回包按值划队列那一条（文件头第一条）也会跟着失准。照一张相，这一趟发出去的就是这一刻的样子。
    const viewFlagSnapshotDoc = function (doc: any): any {
      try { return JSON.parse(JSON.stringify(doc)) } catch (e) { return doc }
    }
    // 这一趟真正写出去的值：从交给宿主的那份快照里按格取，不是从队列里取「发出前那一刻的值」。
    //   为什么必须这样（#1012 后续修复的 M1 残留）：重读那一个来回里用户又改了值，合并用的是「合并那一刻」
    //   的值、快照里落的也是它；判据若仍比发出前的值，用户在回包前又改回发出前那个值就会被判成「没改过」，
    //   这一笔被划掉 —— 盘上留中间值、内存是最后那一下，两边从此不一致（要等用户再点这一格才可能修回来）。
    //   按格取值时先按折算键找那条记录（同一工作区的两种写法算同一条），找不到就退回队列里的值。
    const viewFlagSentValIn = function (snap: any, d: any): any {
      try {
        // 界面偏好那一格发出去的值就在 ui 节里（同一个格名）；文件那一份里没写进去时退回队列里的值。
        if (d.section === 'ui') {
          const uv = (snap && snap.ui && typeof snap.ui === 'object') ? snap.ui[d.name] : undefined
          return (typeof uv === 'string' && uv !== '') ? uv : d.value
        }
        // 动作模板那一格发出去的值就在 templates 节里（同一个格名）；文件那一份里没写进去时退回队列里的值。
        if (d.section === 'templates') {
          const tv = (snap && snap.templates && typeof snap.templates === 'object') ? snap.templates[d.name] : undefined
          return (typeof tv === 'string' && tv !== '') ? tv : d.value
        }
        // 调试开关那两格发出去的值就在 debug 节里（同一个格名）：enabled 是布尔、sampleRate 是数字，
        //   按格各自的类型判「文件里写进去了没有」，判不出来就退回队列里的值（判据与上面两族同一条思路）。
        if (d.section === 'debug') {
          const dv = (snap && snap.debug && typeof snap.debug === 'object') ? snap.debug[d.name] : undefined
          if (d.name === 'enabled') return (typeof dv === 'boolean') ? dv : d.value
          return (typeof dv === 'number' && isFinite(dv)) ? dv : d.value
        }
        const key = d.key || viewFlagDocKeyOf(d.cwd)
        if (!key || !snap || !snap.workspaces || typeof snap.workspaces !== 'object') return d.value
        const ek = viewFlagEntryKeyOf(snap, key)
        const v = ek ? (snap.workspaces[ek] || {})[d.name] : undefined
        // #1612 的两个文字开关：文件里是各自允许的字符串才算「这一笔写进去了」，读不懂就退回队列里的值。
        if (viewFlagIsTextNameOf(d.name)) {
          const allowed: any = viewFlagTextValuesOf(d.name)
          return (typeof v === 'string' && allowed.indexOf(v) >= 0) ? v : d.value
        }
        return (typeof v === 'boolean') ? v : d.value
      } catch (e) { return d.value }
    }
    const viewFlagSentValsOf = function (snap: any, sentKeys: any): any {
      const out: any = {}
      for (let i = 0; i < sentKeys.length; i++) {
        const d = viewFlagState.journal[sentKeys[i]]
        if (d) out[sentKeys[i]] = viewFlagSentValIn(snap, d)
      }
      return out
    }
    // 把这一份已经照过相的文档交给宿主（wf.setSettings 收的是整份文档），回包按上面那两条约定处理。
    //   sentVals 必须是对着同一份快照算出来的（见 viewFlagSentValIn）：这一趟发的是哪个值只有一个答案。
    const viewFlagSendDoc = function (snap: any, sentKeys: any, sentVals: any, t0: any): void {
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { viewFlagFallbackToLegacy(sentKeys); return }
        host.call('wf.setSettings', { value: snap }).then(function (res: any): any {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.setSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.setSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'set-not-ok')) })
          } catch (eL) {}
          if (okRes) { viewFlagConfirmSent(sentKeys, sentVals); return }
          // 写失败（含文件只读被拒、手机说不行）：写回旧键做过渡，并把这几个还留在队列里。
          viewFlagFallbackToLegacy(sentKeys)
        }, function (): void { viewFlagFallbackToLegacy(sentKeys) })
      } catch (e) { viewFlagFallbackToLegacy(sentKeys) }
    }
    // 真写一趟：先重读合并，再把「真正要发出去的那一份」照一张相，按这一份记下这一趟发出去的值，最后整份写出去。
    const viewFlagWriteNow = function (): void {
      try {
        viewFlagState.timer = 0
        if (viewFlagState.status !== 'ready' || !viewFlagState.doc) return
        // #1640：写之前先合并一次内存文档里已经认得出根的临时记录 —— 合并会把队列里的那几笔挪到根键上，
        //   所以必须在取 sentKeys 之前做。只有合并结果、没有待写格子时也要走一趟（结果要落盘才算数）。
        try { viewFlagMergeDoc(viewFlagState.doc, 'write') } catch (eM) {}
        const sentKeys = Object.keys(viewFlagState.journal)
        if (!sentKeys.length && viewFlagState.mergePending !== true) return
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { viewFlagFallbackToLegacy(sentKeys); return }
        const t0 = Date.now()
        // 照相与记值必须对着同一份：先照相，再从这份相里按格取出「这一趟发出去的值」（文件头那一条判据）。
        const sendOf = function (doc: any): void {
          const snap = viewFlagSnapshotDoc(doc)
          viewFlagSendDoc(snap, sentKeys, viewFlagSentValsOf(snap, sentKeys), t0)
        }
        viewFlagFreshDocFor(sentKeys).then(function (fresh: any): any {
          const value = fresh || viewFlagState.doc
          if (!value) { viewFlagFallbackToLegacy(sentKeys); return }
          sendOf(value)
        }, function (): void {
          if (viewFlagState.doc) sendOf(viewFlagState.doc)
          else viewFlagFallbackToLegacy(sentKeys)
        })
      } catch (e) { try { viewFlagFallbackToLegacy(Object.keys(viewFlagState.journal)) } catch (e2) {} }
    }
    // 撤销上一次排的那支等待。宿主那只 timer 交回的是可调用的撤销器函数，对它调全局 clearTimeout 是
    //   空操作（不报错、也撤不掉，见 #1115），所以句柄一律交给 hostShim 的 timer.clearTimeout 按形状处理；
    //   拿不到宿主那只 timer 时（页面自己排的数字句柄）才走全局 clearTimeout。
    const viewFlagCancelTimer = function (h: any): void {
      try { if (typeof timer !== 'undefined' && timer && typeof timer.clearTimeout === 'function') { timer.clearTimeout(h); return } } catch (eS) {}
      try { clearTimeout(h) } catch (eC) {}
    }
    // 排一次落盘（一次只排一个：连着来的几下会并进同一个窗口）。只排一次、跑完就停，不是自续的定时器，
    //   与 log.js / store-snapshot.js 用 timer 的写法同例（拿不到宿主那只 timer 就退回页面自己的 setTimeout）。
    const viewFlagScheduleWrite = function (): void {
      try {
        let arm: any = null
        try { if (typeof timer !== 'undefined' && timer && typeof timer.timeout === 'function') arm = function (fn: any, ms: any): any { return timer.timeout(fn, ms) } } catch (eT) {}
        if (!arm && typeof setTimeout === 'function') arm = function (fn: any, ms: any): any { return setTimeout(fn, ms) }
        if (!arm) { viewFlagWriteNow(); return }
        if (viewFlagState.timer) viewFlagCancelTimer(viewFlagState.timer)
        viewFlagState.timer = arm(viewFlagWriteNow, VIEW_FLAG_WRITE_DEBOUNCE_MS)
      } catch (e) {}
    }
    // 写一格，键由调用方点名（2026-10-12 复核 Q2）：调用方自己认得出工作区根时（views/SubworkspaceMark.js
    //   的 subwsMarkRootOf 那一路），读写都按它手上这把根走 —— 内核那把「所选目录 → 工作区根」的表是快照
    //   缓存，同一条目录的根变过时可能还留着旧条目，按目录算出来的键会落到另一条记录上（同一份状态读在一
    //   把键、写在另一把键）。第四个参数是会话目录，只用来新建这条记录时从旧表种上另外那几格（横幅折叠那
    //   一格按会话目录记，不传它就种不准）。返回值与 setViewFlag 同义：true ＝ 交给文件这条路了（可能还在
    //   防抖窗口里没落盘），false ＝ 接不下（根是空串、文档问不到、是更高版本、形状对不上），调用方写旧表。
    export const setViewFlagRoot = function (root: any, name: any, value: any, cwd: any): any {
      try {
        const on = value === true
        const key = String(root == null ? '' : root).trim()
        if (!key) return false
        settingsViewLoad()
        const dir = String(cwd == null ? '' : cwd)
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这一笔，队列里连键一起带着（settle 收口时按 d.key 落，不重算 —— 重算可能
          //   换成会话目录那一条，文件里就长出同一工作区的第二条记录、根那条还是旧值）。
          viewFlagState.deferred[viewFlagJournalKeyOf(key, name)] = { cwd: dir, name: name, value: on, key: key }
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        if (!viewFlagSetInDoc(viewFlagState.doc, dir, key, name, on)) {
          // 文档在手却写不进这一格（形状对不上）：记一行再交回调用方写旧表，别让用户那一下静默消失。
          viewFlagLogDocFail()
          return false
        }
        viewFlagState.journal[viewFlagJournalKeyOf(key, name)] = { cwd: dir, name: name, value: on, key: key }
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
    // 写一格。返回值是给调用方看的两种意思：
    //   true ＝ 这一次交给本机设置文件这条路了（可能还在防抖窗口里没落盘），调用方不要再写旧表；
    //   false ＝ 这条路接不下（认不出工作区根，或文档问不到、是更高版本），调用方按老办法写旧表。
    export const setViewFlag = function (cwd: any, name: any, value: any): any {
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
    // #1612 写一格文字开关：与 setViewFlag 同一条路（loading 先进 deferred、ready 后改内存文档 + 进队列 + 防抖，
    //   写前重读合并、写失败留队重试都在同一条路上），只是不做真假值转换 —— 值原样放进去（statusBar 写
    //   'show'/'hide'，deckTools 写 'on'/'off'）。返回值与 setViewFlag 同义：true ＝ 交给文件这条路了
    //   （可能还在防抖窗口里），false ＝ 接不下（认不出工作区根、文档问不到、是更高版本，或者名字/值不是这两个
    //   开关认得出的那几种之一），调用方据此提示。
    //   第四个参数 listed 只有设置页总览会传（#1641）：这一行来自工作区名单时，认不出根也可以按名单上的路径
    //   先存一条带 unopened 标记的临时记录；别的调用方不传，口径仍是文件头第四条「认不出根一个字不写」。
    export const setViewFlagValue = function (cwd: any, name: any, value: any, listed: any): any {
      try {
        const raw = value
        // 只接这两个文字名字、只认各自的那几个字面量：别的名字或值的调用直接回 false，调用方据此知道这一笔没接。
        //   为什么先挡一道、不交给写盘那一趟去发现：核写盘时会按字面量校验整份文档，认不出的值会让整份写失败，
        //   然后走旧表兜底 —— 而旧表只有横幅折叠一个布尔键，兜底时只能按「hide」猜，猜出来的那一格与用户点的那一下
        //   没有关系，等于静默写错。挡在这里，错值一步都进不了内存文档，也就不会有任何一格被猜着写到别处。
        if (!viewFlagIsTextNameOf(name)) return false
        if (viewFlagTextValuesOf(name).indexOf(raw) < 0) return false
        settingsViewLoad()
        let key = viewFlagWriteKeyOf(cwd)
        // #1641：名单上的行认不出根时，名单路径本身就可以当临时键 —— 它是用户看得见的目录，不是会话里的猜测。
        //   这样存下来的记录带 unopened 标记，等工作区打开、认出根以后合并到根那一条（#1640）。
        let unopened = false
        if (!key && listed === true) {
          key = String(cwd == null ? '' : cwd).trim()
          unopened = key !== ''
        }
        if (!key) return false
        if (viewFlagState.status === 'loading') {
          viewFlagState.deferred[viewFlagJournalKeyOf(key, name)] = (unopened
            ? { cwd: cwd, name: name, value: raw, key: key, unopened: true }
            : { cwd: cwd, name: name, value: raw, key: key })
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        if (!viewFlagSetInDoc(viewFlagState.doc, cwd, key, name, raw, unopened)) {
          viewFlagLogDocFail()
          return false
        }
        viewFlagState.journal[viewFlagJournalKeyOf(key, name)] = (unopened
          ? { cwd: cwd, name: name, value: raw, key: key, unopened: true }
          : { cwd: cwd, name: name, value: raw, key: key })
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
