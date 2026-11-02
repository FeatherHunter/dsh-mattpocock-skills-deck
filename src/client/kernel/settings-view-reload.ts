/**
 * src/client/kernel/settings-view-reload.ts — 内核模块（#1802：设置页每次打开时重读一次文档，写只发改动格）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mts 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里那一行 kernel:settingsViewReload 拼接标记处（apply 闭包内原位）。
 *   这一行标记必须排在 kernel:settingsViewWrite 之后：本片要复用写那一片的合并与快照工具，
 *   并给写那一片提供按「最新一份 + 本窗待写格」算补丁要用的几件工具。
 *
 * 为什么单独一片：settings-view-write.ts 按文件粒度门禁已经贴着 350 行上限，
 *   本次要把「重读」与「补丁」两件事塞进写那一趟，只能照仓库惯例搬成自包含内核片段。
 *   本片没有真实 import（构建会拒绝残留的模块级 import/export），跨片引用一律写 declare。
 *
 * 本片管五件事：
 *   一、设置页打开时重读一次文件（settingsViewReload）：每个窗口平时只在第一次需要时读一次文档，
 *       重开设置页不再读，于是别的窗口刚写进去的值看不到（#1802 的读侧那一层）。重读后先合并本窗
 *       尚未落盘的待写格与临时记录，再替换内存文档 —— 重读不能把本窗刚点的那几下冲掉。
 *   二、把待写队列里的格合进一份文档（viewFlagApplyJournalToDoc）：重读路径与写路径共用一份实现。
 *   三、按「写之前读到的最新一份」与「本窗要写成的目标」算补丁（viewFlagDiffDocOf）：
 *       写只送改动的格，不送整份文档，别的窗口同时间写进去的格就不会被这一窗整份顶掉。
 *   四、从补丁/目标里按格取「这一趟发出去的值」（viewFlagSentValIn / viewFlagSentValsOf）：
 *       写成功回包只划掉值没被改过的那几笔，判据用的就是这一份。
 *   五、把「新建普通记录」的第一笔补丁裁到只含用户点过的格（写侧调用；名单路径上的临时记录保住 unopened 标记）。
 */
    // 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）：
    //   viewFlagState 的真源在 kernel/settings-view-state.ts；viewFlagMergeDoc 与 viewFlagScheduleWrite 的
    //   真源在 kernel/settings-view-write.ts；viewFlagEmptyDoc / viewFlagEmitAll / settingsViewLoad /
    //   viewFlagSetInDoc / viewFlagEntryKeyOf / viewFlagDocKeyOf / viewFlagIsTextNameOf / viewFlagTextValuesOf /
    //   log / dswsLogHash 的真源在 kernel/settings-view.ts 与全局声明里；settingsDebugDocLooksReal 的真源在
    //   kernel/settings-debug.ts。本片只在调用时求值，初始化期不碰；类型一律写 any 是刻意的。
    declare const viewFlagState: any;
    declare function viewFlagMergeDoc(...args: any[]): any;
    declare function viewFlagEmptyDoc(...args: any[]): any;
    declare function viewFlagEmitAll(...args: any[]): any;
    declare function settingsViewLoad(...args: any[]): any;
    declare function viewFlagScheduleWrite(...args: any[]): any;
    declare function viewFlagSetInDoc(...args: any[]): any;
    declare function viewFlagEntryKeyOf(...args: any[]): any;
    declare function viewFlagDocKeyOf(...args: any[]): any;
    declare function viewFlagIsTextNameOf(...args: any[]): any;
    declare function viewFlagTextValuesOf(...args: any[]): any;
    declare function settingsDebugDocLooksReal(...args: any[]): any;
    // 把待写队列里的格合进一份文档。sentKeys 为 null 或未给时合全部 —— 重读路径要合全部（本窗所有待写都要
    //   保住），写路径只合这一趟点名的那几笔（其余的下一次写再带）。
    //   每一笔按队列条目自带的键落，不重算：重算可能换成会话目录那一条，文件里会长出同一工作区的第二条记录。
    export const viewFlagApplyJournalToDoc = function (doc: any, sentKeys?: any): any {
      try {
        if (!doc || typeof doc !== 'object') return doc
        const keys = Array.isArray(sentKeys) ? sentKeys : Object.keys(viewFlagState.journal)
        for (let i = 0; i < keys.length; i++) {
          const d = viewFlagState.journal[keys[i]]
          if (!d) continue
          if (d.section === 'ui') { settingsUiSetInDoc(doc, d.name, d.value); continue }
          if (d.section === 'templates') { settingsTemplatesSetInDoc(doc, d.name, d.value); continue }
          if (d.section === 'debug') { settingsDebugSetInDoc(doc, d.name, d.value); continue }
          const key = d.key || viewFlagDocKeyOf(d.cwd)
          if (key) viewFlagSetInDoc(doc, d.cwd, key, d.name, d.value, d.unopened)
        }
      } catch (e) {}
      return doc
    }
    // 三族只有格名、没有工作区路径的待写格（界面偏好、动作模板、调试开关）在这里声明它们的写入口。
    declare function settingsUiSetInDoc(...args: any[]): any;
    declare function settingsTemplatesSetInDoc(...args: any[]): any;
    declare function settingsDebugSetInDoc(...args: any[]): any;
    // 按「基底」与「目标」算补丁：只收两边不一样的格；目标里已经没有、基底里还留着的键写成 null（表示删掉）。
    //   对象逐键递归（设置文档最多三层：节 → 工作区记录 → 格），数组与其它值当整体比较。
    //   为什么只送改动格：宿主会把补丁合并进它刚读到的最新一份，别的窗口同时间写进去的格因此不会被顶掉。
    const viewFlagIsPlainObject = function (v: any): any { return !!v && typeof v === 'object' && !Array.isArray(v) }
    export const viewFlagDiffDocOf = function (base: any, target: any): any {
      const out: any = {}
      try {
        if (!viewFlagIsPlainObject(target)) return out
        const b = viewFlagIsPlainObject(base) ? base : {}
        const keys = Object.keys(target)
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i]
          const tv = target[k]
          const bv = b[k]
          if (viewFlagIsPlainObject(tv)) {
            if (!viewFlagIsPlainObject(bv)) { out[k] = tv; continue }
            const sub = viewFlagDiffDocOf(bv, tv)
            if (Object.keys(sub).length > 0) out[k] = sub
            continue
          }
          if (JSON.stringify(bv) !== JSON.stringify(tv) || bv === undefined) out[k] = tv
        }
        const bkeys = Object.keys(b)
        for (let i = 0; i < bkeys.length; i++) {
          if (!Object.prototype.hasOwnProperty.call(target, bkeys[i])) out[bkeys[i]] = null
        }
      } catch (e) { return out }
      return out
    }
    // 把「新建普通工作区记录」那一笔的补丁裁到只含用户真正点过的格（#1802 评审修正，写侧调用）。
    //   为什么需要：新建普通记录时 viewFlagSetInDoc 会先种三格缺省（胶囊状态栏、deck 工具箱、子工作区自动展开标记），
    //   直接拿「盘上那份」对「内存那份」求差，会把这三格缺省一起送出去，违背「只提交真正改动的那几格」。
    //   已有记录不裁：基线上没有、内存里有的键才是这一趟的改动，本来只剩待写格。
    //   unopened 只属于名单路径上的临时记录：队列条目带这个标记时把标记留在补丁里（它是记录形状，不是用户点的格），
    //   普通新记录不带，免得把一条正式记录写成临时记录（两种记录在核里的归一规矩不同）。
    export const viewFlagTrimNewRecordPatch = function (patch: any, base: any, sentKeys: any): any {
      try {
        if (!patch || typeof patch !== 'object' || !patch.workspaces || typeof patch.workspaces !== 'object' || Array.isArray(patch.workspaces)) return patch
        const allowByKey: any = {}
        for (let i = 0; i < sentKeys.length; i++) {
          const k = String(sentKeys[i])
          const cut = k.lastIndexOf('\u0000')
          if (cut <= 0) continue
          const entryKey = k.slice(0, cut)
          const name = k.slice(cut + 1)
          if (!name) continue
          const baseKey = String(viewFlagEntryKeyOf(base, entryKey) || entryKey)
          const d = viewFlagState.journal[k]
          if (!allowByKey[baseKey]) allowByKey[baseKey] = { cells: {}, unopened: true }
          if (!d || d.unopened !== true) allowByKey[baseKey].unopened = false
          allowByKey[baseKey].cells[name] = true
        }
        const ws = patch.workspaces
        const keys = Object.keys(ws)
        for (let i = 0; i < keys.length; i++) {
          const pk = keys[i]
          const val = ws[pk]
          if (!val || typeof val !== 'object' || Array.isArray(val)) continue
          if (viewFlagEntryKeyOf(base, pk)) continue
          const allow = allowByKey[String(pk)]
          if (!allow) continue
          const cellNames = Object.keys(val)
          for (let j = 0; j < cellNames.length; j++) {
            if (allow.cells[cellNames[j]] !== true) delete val[cellNames[j]]
          }
          if (allow.unopened === true) val.unopened = true
        }
        return patch
      } catch (e) { return patch }
    }
    // 这一趟真正写出去的值：从交给宿主的那份目标文档里按格取，不是从队列里取「发出前那一刻的值」（#1012 后续修复的 M1 残留）。
    //   按格取值时先按折算键找那条记录（同一工作区的两种写法算同一条），找不到就退回队列里的值。
    export const viewFlagSentValIn = function (snap: any, d: any): any {
      try {
        if (d.section === 'ui') {
          const uv = (snap && snap.ui && typeof snap.ui === 'object') ? snap.ui[d.name] : undefined
          return (typeof uv === 'string' && uv !== '') ? uv : d.value
        }
        if (d.section === 'templates') {
          const tv = (snap && snap.templates && typeof snap.templates === 'object') ? snap.templates[d.name] : undefined
          return (typeof tv === 'string' && tv !== '') ? tv : d.value
        }
        if (d.section === 'debug') {
          const dv = (snap && snap.debug && typeof snap.debug === 'object') ? snap.debug[d.name] : undefined
          if (d.name === 'enabled') return (typeof dv === 'boolean') ? dv : d.value
          return (typeof dv === 'number' && isFinite(dv)) ? dv : d.value
        }
        const key = d.key || viewFlagDocKeyOf(d.cwd)
        if (!key || !snap || !snap.workspaces || typeof snap.workspaces !== 'object') return d.value
        const ek = viewFlagEntryKeyOf(snap, key)
        const v = ek ? (snap.workspaces[ek] || {})[d.name] : undefined
        if (viewFlagIsTextNameOf(d.name)) {
          const allowed: any = viewFlagTextValuesOf(d.name)
          return (typeof v === 'string' && allowed.indexOf(v) >= 0) ? v : d.value
        }
        return (typeof v === 'boolean') ? v : d.value
      } catch (e) { return d.value }
    }
    export const viewFlagSentValsOf = function (snap: any, sentKeys: any): any {
      const out: any = {}
      for (let i = 0; i < sentKeys.length; i++) {
        const d = viewFlagState.journal[sentKeys[i]]
        if (d) out[sentKeys[i]] = viewFlagSentValIn(snap, d)
      }
      return out
    }
    // 设置页每次打开时重读一次文件（#1802 的读侧）：重开设置页要看到别的窗口刚写进去的值。
    //   设置页每次打开都走这一趟：文档从没问过（idle）时交给既有的惰性加载 settingsViewLoad，
    //   它读到的本来就是盘上最新一份；已经问过（ready / readonly / unavailable）时在这里重读，
    //   让别窗刚写进文件的值进到本窗内存文档里。读失败保持原来的内存文档与状态不动。
    //   正在读（loading）时不叠第二次；重读成功先合并临时记录、再把本窗所有待写格合进去，最后才替换内存文档：
    //   重读不能把本窗刚点的那几下冲掉。只读或读失败时保持原来的内存文档与状态不动，绝不拿内存旧文档去顶别窗的新值。
    export const settingsViewReload = function (): void {
      try {
        if (viewFlagState.status === 'idle') { settingsViewLoad(); return }
        if (viewFlagState.status === 'loading') return
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return
        const t0 = Date.now()
        host.call('wf.getSettings', {}).then(function (res: any): any {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.getSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.getSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'reload-not-ok')) })
          } catch (eL) {}
          try {
            if (okRes) {
              // 只读与形状不对都不收：更高版本的文件读不懂，半份文档会把别的节写成空值。
              if (res.readonly === true) return
              if (!res.value || typeof res.value !== 'object') return
              if (typeof settingsDebugDocLooksReal === 'function' && !settingsDebugDocLooksReal(res.value, true)) return
              const fresh = res.value
              try { viewFlagMergeDoc(fresh, 'load') } catch (eM) {}
              viewFlagApplyJournalToDoc(fresh)
              viewFlagState.doc = fresh
              viewFlagState.contentHash = String(res.contentHash || '')
              viewFlagState.status = 'ready'
              viewFlagEmitAll()
              if (Object.keys(viewFlagState.journal).length > 0 || viewFlagState.mergePending === true) viewFlagScheduleWrite()
              return
            }
            // 文件还没建不算故障：按五节齐全的空文档起步，第一次写入会把它建出来。
            if (res && res.error && res.error.kind === 'absent') {
              const fresh = viewFlagEmptyDoc()
              viewFlagApplyJournalToDoc(fresh)
              viewFlagState.doc = fresh
              viewFlagState.contentHash = String(res.contentHash || '')
              viewFlagState.status = 'ready'
              viewFlagEmitAll()
              if (Object.keys(viewFlagState.journal).length > 0 || viewFlagState.mergePending === true) viewFlagScheduleWrite()
            }
          } catch (eR) {}
        }, function (): void {})
      } catch (e) {}
    }
