/**
 * src/client/kernel/settings-view.ts — 内核模块（#1012：把客户端「按工作区的观看状态」从 localStorage 搬到本机设置文件）
 * （原来是 .js：按「动到哪里转哪里」转成 TypeScript，行为零变化。本文件是模块真源，同名 .js 已改由构建生成（会被覆盖，不要去改），本 .ts 既进类型检查也进拼接与 ts-hook 测试。）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mts 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.ts 里那一行 kernel:settingsView 拼接标记处（apply 闭包内原位），
 *   与 ctx.ts/seam 同模式，源码树里只有这一份真源。
 *
 * 本片管四件事：这把键怎么认（viewFlagDocKeyOf，读与写共用同一把）、文档里这一条记录怎么找、
 *   读一格（viewFlagOf）、把读回来的文档交给界面（settingsViewLoad 与 viewFlagSettle）。
 *   「写这一趟」（待写队列、防抖、写前重读合并、写失败重试）住在 kernel/settings-view-write.ts，
 *   拼在本文之后 —— 它要用本文这几个键与文档工具。两片共用的状态对象与「问完真源了没有」那两个口子
 *   住在 kernel/settings-view-state.ts，拼在本文之前。
 *
 * 为什么单独一个文件：这一族读写原先住在 kernel/store-prefs.js 里，那份文件在搬出这一族之前
 *   （父提交 3a7063b9，即 #1012 落地那次提交的上一提交）按门禁算法已经 317 行（文件粒度门禁上限 350 行，
 *   见 tests/verify-file-granularity.ts），本票要加的「读文档、合并着写、旧表过渡」三件事塞不进去，
 *   所以照仓库惯例搬成一个自包含的内核片段；store-prefs.ts 只留调用与旧表那几行。
 *
 * 真相只有一份：本机设置文件（用户主目录下的 .dsh/mattskillsdeck/settings.yaml，核校验见
 *   src/shared/config-store/settings.js）里 workspaces 那一节，是按工作区记住的观看状态的唯一真源。
 *   localStorage 那两个旧键（dsws.bannerFold、dsws.subwsAutoShown）从此只是过渡：文档缺席、读失败、
 *   手机不通这三种情况才读它；只有写不进文件（或文件是更高版本、不许写回去）时才把这一次的值写回旧键；
 *   写成功那条路上一个字都不写旧键 —— 那不是双写，是过渡。
 *   这一手过渡能兜住什么、兜不住什么必须说准（#1012 后续修复按实测改准）：文件里**已经有**这个工作区的
 *   记录时，写进旧键的这一份读不回来 —— 读侧的口径是「文件里这条记录有值就以它为准」，所以它只在本次
 *   窗口内充当记性（用户当场再点一下，看到的是刚点的那一下），页面一关就只剩文件里那一份。真正让一次改动
 *   不丢的是写这一趟：写失败时把这一格留在待写队列里、下一趟写再试一次（见 kernel/settings-view-write.ts）。
 *
 * 键用工作区根的可读路径（设置文件是写给人看的，人在里面要认得出这是哪个工作区），不用那个折叠散列
 *   （noRepoDismissKey 那种「前缀 + 折叠后算出来的数字」，人看不懂）。可读路径的来源按序取：
 *   ① 本会话（或同目录别的会话）状态上的工作区根：src/refresh/rooms/client/snapshot-cache-store.ts 里那条名为
 *      sessionWorkspaceRoot 的状态字段，由
 *      src/refresh/rooms/client/snapshot-sync.ts 里的 rememberSessionWorkspaceRoot 从 wf.cwd 回包里
 *      收下；它是折算过的键，所以按本会话所选目录的写法还原一遍（与
 *      src/client/views/SubworkspaceMark.js 第 45–67 行同一条规矩：比对用折算键、给人看用原样写法）。
 *      这一手还原在 Windows 上成立（盘符自己占一段）；在 POSIX 上还原不出来 —— 绝对路径开头那个斜杠
 *      按段拼不回来（/home/u/p 切出来是 home/u/p，前面那个斜杠没了），于是写进文件的就是那份折算键。
 *      这是如实写下的边界，不是待修的缺陷：POSIX 上文件里的键是折算键，它仍是一条人认得出的路径，不是散列。
 *   ② 会话状态上没有根时看内核那把工作区键 wsKeyOf（src/refresh/rooms/client/snapshot-cache-store.ts 里的那个函数）：它折出了另一条目录，
 *      或那张表里记着「这条键就是某个工作区根」（表里那条 root → root 的自指，所选目录本身就是工作区根
 *      时折不出区别），都算真认得根；两样都不是，就是谁都没认出来。
 *   ③ 谁都没认出来（或 cwd 为空）时回空串：**读与写共用这一把键、都在这一个口子上判**，两边对「这把键
 *      有没有」答案必然一致，这一刻只读旧表、也只写旧表，绝不猜一把键。从前读这一侧还会退到会话目录
 *      （写这一侧不退），于是出现「读口已按文件里那条根记录答、写口却判成认不出」的错位：用户点一下
 *      等于没反应、浮层「自动展开过没有」退化成每进一次子目录会话白弹一次（#1012 后续修复的 M5）。
 * 同一个工作区的不同写法落到同一条记录上（找条目时两边都折算过再比），换一种写法不会在文件里长出第二条。
 * 写是整份写回：wf.setSettings 收的是整份文档，所以只改内存文档里「这一个工作区的这一格」，
 *   别的节与别的字段原样带回去。写之前的重读合并、防抖窗口与失败重试见 kernel/settings-view-write.ts。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）：
// keyOf/currentOs 的真源在共享工作区键那一片，wsKeyOf/workspaceRootByCwd/shared/stores 的真源在
//   refresh/rooms/client/snapshot-cache-store.ts，viewFlagState 与 viewFlagNotifySettled 的真源在 kernel/settings-view-state.ts，
//   settingsUiDrainDeferred 的真源在 kernel/settings-ui.ts，settingsTemplatesDrainDeferred 的真源在
//   kernel/settings-templates.ts，settingsDebugDrainDeferred 与 settingsDebugDocLooksReal 的真源在
//   kernel/settings-debug.ts，viewFlagScheduleWrite 的真源在 kernel/settings-view-write.ts；
//   本片只在调用时求值，初始化期不碰；类型一律写 any 是刻意的：在这里凭记忆写窄，
//   只会把那边正常的改动变成这里的假报错（与 kernel/link.ts 同例）。
//   host/emit/log 走全局已声明的那一份，这里不重复。process 只在 typeof 里判平台，
//   声明一句免得 tsc 按 Node 类型去找（本片跑在浏览器闭包里，判不到就退回 POSIX 默认）。
declare function keyOf(...args: any[]): any;
declare function currentOs(...args: any[]): any;
declare const shared: any;
declare const stores: any;
declare function wsKeyOf(...args: any[]): any;
declare const workspaceRootByCwd: any;
declare const viewFlagState: any;
declare function viewFlagNotifySettled(...args: any[]): any;
declare function settingsUiDrainDeferred(...args: any[]): any;
declare function settingsTemplatesDrainDeferred(...args: any[]): any;
declare function settingsDebugDrainDeferred(...args: any[]): any;
declare function settingsDebugDocLooksReal(...args: any[]): any;
declare function viewFlagScheduleWrite(...args: any[]): any;
declare const process: any;
    // 旧键登记表：本模块管的名字 → 旧 localStorage 键名，以及旧表里那一把键是按哪条路径记的。
    //   「按哪条路径记」不能省：横幅折叠按会话所选目录记（读写在 src/client/kernel/store-prefs.ts 的
    //   bannerFoldByCwd，键是 keyOf(cwd)），
    //   红文件夹标志按工作区根记（SubworkspaceMark.js 第 138–157 行，键是 subwsMarkCmpKey(root)）。
    //   照原样读，行为才与改动前一致。
    const VIEW_FLAG_LEGACY: any = {
      bannerFolded: { key: 'dsws.bannerFold', by: 'cwd' },
      subwsMarkAutoShown: { key: 'dsws.subwsAutoShown', by: 'root' },
    }
    // 新建一条工作区记录时要顺手种上的那两格：与核（src/shared/config-store/settings.js 第 16 行的 WS_KEYS
    //   与第 93 行的默认值）一字对齐，值取旧表里还知道的那一份 —— 新建的那一刻别顺手把用户原来收起过的
    //   横幅重新展开，那不是双写，只是别把已经知道的事忘掉。
    //   为什么这张表里没有 noRepoDismissed（#1012 后续修复的 A4）：无仓库红卡那张卡要退役，本窗口替它写一个
    //   false，等以后红卡的记录也搬进这份文件时，就会拿这个 false 当「用户没收起过」，把人家早就收起的红卡
    //   重新弹出来。所以这一格不由本窗口种。
    //   说清这一手管得到哪，不许夸大：核在写盘时会把缺的那一格按 false 补上（settings.js 第 93 行的默认值，
    //   stringifySettings 每次都写全三格），所以文件里那一行照旧出现 —— 这里改掉的只是「本窗口不主动替用户
    //   答这一格」。真正决定以后红卡弹不弹的是核里那个默认值，不在这里；要真治它得动核或等红卡搬过来那票。
    const VIEW_FLAG_SEED_NAMES = ['bannerFolded', 'subwsMarkAutoShown']
    // 折算到同一把键再比较：这一片一律走闭包里那把 keyOf（与仓库其余位置同口径），拿不到时才退回本地写法。
    const viewFlagNormOf = function (p: any): any {
      try { if (typeof keyOf === 'function') return String(keyOf(p) || '') } catch (e) {}
      try { return String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() } catch (e1) { return '' }
    }
    // 一条路径按[\\/]切成几段（空段丢掉）：还原写法按段取前缀，绝不按字符切（`D:\ilife-other` 的前几个字符
    //   恰好是 `D:\ilife` 的写法，按字符切会切出看不出所以然的东西）。
    const viewFlagSegsOf = function (v: any): any { return String(v == null ? '' : v).split(/[\\/]+/).filter(function (x: any): any { return !!x }) }
    // 拼回可读写法时用哪个分隔符：按平台判，不按「这一条路径里有没有反斜杠」判（#1012 后续修复的 A7）。
    //   反斜杠在 POSIX 上也是合法的文件名字符（/home/u/a\b 就是一个目录名），拿它当「这台机器是 Windows」
    //   的证据会判错平台。平台的唯一真源是 src/shared/workspaceKey.js 的 currentOs()（与 keyOf 判平台同一处
    //   口径，已随 shared:workspaceKey 拼进界面闭包）；真闭包里拿不到它（老产物、渲染替身）时退回进程平台；
    //   两条都没有就按 POSIX 拼 —— 与 currentOs() 认不出平台时给的默认值一致，不另立一套默认。
    const viewFlagSepOf = function (): any {
      try { if (typeof currentOs === 'function') return (currentOs() === 'win32') ? '\\' : '/' } catch (e) {}
      try { if (typeof process !== 'undefined' && process && process.platform) return (process.platform === 'win32') ? '\\' : '/' } catch (e1) {}
      return '/'
    }
    // 把「折算过的根」还原成本会话所选目录的那一种写法：拿会话目录的前 N 段（N＝根有几段）拼一条候选，
    //   折算回来等于根就是它。还原不出来（两侧不是同一条目录、或写法对不齐）就原样交回那一份折算键 ——
    //   它仍是一条路径而不是散列，写进设置文件照样认得出是哪个盘哪条目录。
    //   POSIX 上按段拼不回开头那个斜杠，所以这条还原在 POSIX 上永远不成立，落盘的就是折算键（见文件头）。
    const viewFlagShownRootOf = function (known: any, cwd: any): any {
      try {
        const rootKey = viewFlagNormOf(known)
        if (!rootKey) return ''
        const cs = viewFlagSegsOf(cwd)
        const rs = viewFlagSegsOf(known)
        if (rs.length > 0 && cs.length >= rs.length) {
          const cand = cs.slice(0, rs.length).join(viewFlagSepOf())
          if (viewFlagNormOf(cand) === rootKey) return cand
        }
        return String(known == null ? '' : known)
      } catch (e) { return String(known == null ? '' : known) }
    }
    // 这个所选目录确实认得工作区根吗：认得就回那把根（折算过的键），认不出回空串。
    //   读与写共用这一个口子 —— 两边对「这把键有没有」必须给出同一个答案，否则会出现「读口已按文件里那条
    //   记录答、写口却判成认不出」的错位：用户点一下等于没反应，浮层「自动展开过没有」也会退化成每进
    //   一次子目录会话白弹一次（#1012 后续修复的 M5；父提交 335bbd20 上同一现场是有效的，所以是新引入的）。
    //   三个来源任一成立就算认得根：①同目录任一条会话状态上写着根 —— 不只「先命中」那一条：shared
    //   这条会话没有会话号、永远不问根，而同一目录另一条 store 可能早就知道；②内核那把工作区键
    //   wsKeyOf（src/refresh/rooms/client/snapshot-cache-store.ts 里那个函数）折出了另一条目录，说明表里记着这条键属于某个根；
    //   ③表里记着「这条键就是某个根」那一份自指（表里那条 root → root），此时它折回来还是自己。
    //   三条都不成立就是谁都没认出来：回空串，这一笔只走旧表 —— 绝不猜一把会话目录键，等根认出来
    //   键就变了，文件里会留下一条既读不回来、也永远合并不到的孤儿记录（M3 的口径，仍然照旧守着）。
    const viewFlagKnownRootOf = function (raw: any): any {
      try {
        const want = viewFlagNormOf(raw)
        if (!want) return ''
        const pick = function (st: any): any {
          return (st && st.cwd && viewFlagNormOf(st.cwd) === want && st.sessionWorkspaceRoot) ? String(st.sessionWorkspaceRoot).trim() : ''
        }
        let hit = ''
        try { if (typeof shared !== 'undefined' && shared) hit = pick(shared) } catch (e0) {}
        if (!hit && typeof stores !== 'undefined' && stores) {
          const ks = Object.keys(stores)
          for (let i = 0; i < ks.length; i++) { hit = pick(stores[ks[i]]); if (hit) break }
        }
        if (hit) return hit
        if (typeof wsKeyOf !== 'function') return ''
        const folded = String(wsKeyOf(raw) || '')
        if (!folded) return ''
        if (folded !== want) return folded
        try { if (typeof workspaceRootByCwd !== 'undefined' && workspaceRootByCwd && workspaceRootByCwd[want]) return folded } catch (e1) {}
        return ''
      } catch (e) { return '' }
    }
    // 读这一侧要用的那把键：与写侧同一个口子，只多一手「还原成本会话自己的写法」。
    export const viewFlagDocKeyOf = function (cwd: any): any {
      try { return viewFlagShownRootOf(viewFlagKnownRootOf(cwd), cwd) } catch (e) { return '' }
    }
    // 写这一侧要用的那把键：同一把键 —— 空串就表示认不出根，写这一趟据此一个字都不写文件。
    export const viewFlagWriteKeyOf = function (cwd: any): any { return viewFlagDocKeyOf(cwd) }
    // 文档里这一条记录的那把键：已经有同一条工作区的记录就沿用它原来那把键（人的写法不同也算同一条），
    //   于是同一个工作区只留一条，也不会因为某次会话的写法不同而长出第二条。
    const viewFlagEntryKeyOf = function (doc: any, key: any): any {
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
    const viewFlagEmptyDoc = function (): any {
      return { version: 1, ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} }, workspaces: {}, debug: { enabled: false, sampleRate: 1 }, templates: {} }
    }
    // 旧表里那把键（按折算键记，与旧写法一致）：横幅折叠按会话目录，红文件夹标志按工作区根。
    const viewFlagLegacyKeyOf = function (cwd: any, name: any): any {
      try {
        const meta = VIEW_FLAG_LEGACY[name]
        if (!meta) return ''
        return viewFlagNormOf(meta.by === 'root' ? viewFlagDocKeyOf(cwd) : cwd)
      } catch (e) { return '' }
    }
    // 读旧表：旧表两种记法都是「归一键 → 1」，读的时候两边都折算过再比（旧版本可能把原样路径写进去过）。
    const viewFlagLegacyRead = function (cwd: any, name: any): any {
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
    // 写旧表：只在这一条路接不下这一次改动时才走（写文件失败、文件只读、或认不出工作区根）。
    //   置上就是那把键记 1，取消就是把它删掉（与 src/client/kernel/store-prefs.ts 的横幅折叠表同一种做法）；
    //   表里别的键原样保留，所以只动这一次涉及的那一条。
    //   写旧表本身失败时补一行 storage.fail（既有事件名，字段只有 key 与 op 两个，与全库其余位置一致），
    //   不再一口吞掉：兜不住这件事要在日志里看见，不然排查时只剩「用户点了、什么都没发生」。
    //   再说一遍这一手兜不住什么：文件里已经有这个工作区的记录时，写进旧键的这一份读不回来（见文件头），
    //   它只在本窗口内充当记性。
    const viewFlagLegacyWrite = function (cwd: any, name: any, on: any): any {
      const meta = VIEW_FLAG_LEGACY[name]
      try {
        if (!meta) return false
        if (typeof localStorage === 'undefined' || !localStorage) return false
        const key = viewFlagLegacyKeyOf(cwd, name)
        if (!key) return false
        let map: any = null
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
      } catch (e) {
        try { log('warn', 'storage.fail', { key: (meta && meta.key) || String(name || ''), op: 'write' }) } catch (eL) {}
        return false
      }
    }
    // 把这一格改进内存文档：别的节与别的字段一律不动；新建这一条记录时，按上面 VIEW_FLAG_SEED_NAMES 种上
    //   另外那两格（值取旧表里还知道的那一份）。这一格自己照旧写在最后一行，所以不管名字是哪一个都落得下。
    const viewFlagSetInDoc = function (doc: any, cwd: any, key: any, name: any, on: any): any {
      try {
        if (!doc || typeof doc !== 'object') return false
        if (!doc.workspaces || typeof doc.workspaces !== 'object' || Array.isArray(doc.workspaces)) doc.workspaces = {}
        let entryKey = viewFlagEntryKeyOf(doc, key)
        if (!entryKey) {
          const seed: any = {}
          for (let i = 0; i < VIEW_FLAG_SEED_NAMES.length; i++) {
            const n = VIEW_FLAG_SEED_NAMES[i]
            seed[n] = (n === name) ? on : viewFlagLegacyRead(cwd, n)
          }
          doc.workspaces[key] = seed
          entryKey = key
        }
        doc.workspaces[entryKey][name] = on
        return true
      } catch (e) { return false }
    }
    // 待写队列里那一笔的键：文档里那条记录的键 + 一个不会出现在路径或格子名里的分隔符 + 这一格的名字。
    //   队列本身（进队、出队、防抖、重试）住在 kernel/settings-view-write.js；这里只放这把键的算法 ——
    //   读这一侧收口（viewFlagSettle）也要按同一个算法，把等在路上的那几笔放进队列。
    const viewFlagJournalKeyOf = function (key: any, name: any): any { return key + '\u0000' + name }
    // 一笔值写不进内存文档时记一行（沿用既有的 storage.fail，不新开事件名；字段只有 key 与 op 两个，
    //   与全库其余 storage.fail 一致，见 tests/verify-log-fields.ts 的字段白名单）。
    //   key 记一个固定的记号，不记工作区路径：日志纪律不许把工作区原始路径写进日志。
    const viewFlagLogDocFail = function (): void {
      try { log('warn', 'storage.fail', { key: 'settings.workspaces', op: 'write' }) } catch (eL) {}
    }
    // 文档到手那一刻重画一次（与 touchProbeAt / setBannerFolded 同例：同一个工作区的各会话都跟着重画）。
    const viewFlagEmitAll = function (): void {
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
    const viewFlagSettle = function (status: any): void {
      try {
        viewFlagState.status = status
        const keys = Object.keys(viewFlagState.deferred)
        for (let i = 0; i < keys.length; i++) {
          const d = viewFlagState.deferred[keys[i]]
          // 界面偏好那一族（kernel/settings-ui.js）在队列里没有工作区路径，交给它自己收口；按下面那条路处理会拿 undefined 当工作区根，往旧键里写出一条谁也读不回来的记录。
          if (d.section === 'ui') { settingsUiDrainDeferred(d, status); continue }
          // 动作模板与调试开关那两族（settings-templates.js、settings-debug.js）同 ui：队列里都没有工作区路径。
          if (d.section === 'templates') { settingsTemplatesDrainDeferred(d, status); continue }
          if (d.section === 'debug') { settingsDebugDrainDeferred(d, status); continue }
          const key = (status === 'ready') ? (d.key || viewFlagWriteKeyOf(d.cwd)) : ''
          if (key && viewFlagSetInDoc(viewFlagState.doc, d.cwd, key, d.name, d.value)) {
            viewFlagState.journal[viewFlagJournalKeyOf(key, d.name)] = { cwd: d.cwd, name: d.name, value: d.value, key: key }
            continue
          }
          // 这一笔没能进文档：文档没到手、认不出工作区根、或文档形状对不上写不进去 —— 三种都走同一条
          //   过渡兜底（写旧键），后一种再补一行日志。从前「文档到手、键也有、却写不进文档」这一档
          //   既不写也不记，用户在界面上点的那一下就这么静默消失（#1012 后续修复的 A5）。
          viewFlagLegacyWrite(d.cwd, d.name, d.value)
          if (status === 'ready' && key) viewFlagLogDocFail()
        }
        viewFlagState.deferred = {}
        if (status === 'ready') {
          // 文档刚到手要重画一次：不然「上次收起过横幅」这件事得等下一次别的重渲染才生效，
          //   用户会先看见横幅自己弹回来一下。只在真拿到文档时重画（问不到那条路上界面本来就照旧表画着）。
          viewFlagEmitAll()
          viewFlagScheduleWrite()
        }
      } catch (e) {}
      // 这一次问话到此结束（成功或失败都算）：通知那些等着「问过真源了」的调用方，让他们把手上的判断重做一遍。
      //   放在收口全部做完之后调 —— 被叫醒的人看到的应当是一个已经稳下来的世界（状态、文档、待并的写都落地了）。
      viewFlagNotifySettled()
    }
    // 惰性读一次文档：第一次有人读或写时才问宿主，只问一次 —— 问不到就标成不可用并全程走旧表，不反复重试。
    export const settingsViewLoad = function (): void {
      if (viewFlagState.status !== 'idle') return
      viewFlagState.status = 'loading'
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') { viewFlagSettle('unavailable'); return }
        const t0 = Date.now()
        host.call('wf.getSettings', {}).then(function (res: any): any {
          const okRes = !!(res && res.ok === true)
          try {
            if (okRes) log('info', 'host.call', { method: 'wf.getSettings', latencyMs: Date.now() - t0, ok: true, kind: 'settings' })
            else log('warn', 'host.call.fail', { method: 'wf.getSettings', kind: 'settings', errorHash: dswsLogHash(String((res && res.error && (res.error.message || res.error.kind)) || 'get-not-ok')) })
          } catch (eL) {}
          if (okRes) {
            // 更高版本的文件：核只认到版本 1，里面的字段读不懂，所以既不照着它答（宁可回旧表），也绝不写回去（会抹掉新字段）。
            if (res.readonly === true) { viewFlagSettle('readonly'); return }
            // 形状对不上（「ok 但没有文档」的半份回复）不许当文档收下：拿它当基底整份写回会把别的节写成空值（严格档：五节齐全才算能用的文档；缺席那一档的 viewFlagEmptyDoc 五节齐全，过得了）。
            if (!res.value || typeof res.value !== 'object' || (typeof settingsDebugDocLooksReal === 'function' && !settingsDebugDocLooksReal(res.value, true))) { viewFlagSettle('unavailable'); return }
            viewFlagState.doc = res.value
            viewFlagSettle('ready')
            return
          }
          // 文件还没建（种类是没有）不算故障：后端通着，第一次写入会把它建出来，所以按一份空文档起步；
          //   读的时候这一节是空的，照样落到旧表兜底（文档缺席时回退读旧键，行为与改动前一致）。
          if (res && res.error && res.error.kind === 'absent') { viewFlagState.doc = viewFlagEmptyDoc(); viewFlagSettle('ready'); return }
          viewFlagSettle('unavailable')
        }, function (): void { viewFlagSettle('unavailable') })
      } catch (e) { viewFlagSettle('unavailable') }
    }
    // 按调用方手上那个工作区根读一格（2026-10-12 复核 Q2）：返回 { known, value }。known=true ＝ 文件里查得到
    //   这个工作区这一条记录、且这一格是真假值（以文件为准）；known=false ＝ 问不出（还没写过、读失败、更高
    //   版本、形状对不上），调用方退回旧表那一份。为什么要按根读：本组件自己认得出根（subwsMarkRootOf），
    //   而内核那把「所选目录 → 工作区根」的表是快照缓存，同一条目录的根变过时可能还留着旧条目 —— 按会话
    //   目录读会落到另一把键上，文件里明明记过却判成问不出，用户每开一次窗就白弹一次浮层（比搬迁前差）。
    export const viewFlagOfRoot = function (root: any, name: any): any {
      try {
        settingsViewLoad()
        const key = String(root == null ? '' : root).trim()
        const hit = (key && viewFlagState.doc) ? viewFlagEntryKeyOf(viewFlagState.doc, key) : ''
        const entry = hit ? viewFlagState.doc.workspaces[hit] : null
        if (entry && typeof entry === 'object' && typeof entry[name] === 'boolean') return { known: true, value: entry[name] }
      } catch (e) {}
      return { known: false, value: false }
    }
    // 按所选目录那条路读一格：先按认出来的根问上面那个口子，问不出才回退旧 localStorage 键（这一手兜不住
    //   「文件里已经有这个工作区的记录」那种情形，见文件头那段）。
    export const viewFlagOf = function (cwd: any, name: any): any {
      try {
        const ans = viewFlagOfRoot(viewFlagDocKeyOf(cwd), name)
        if (ans.known) return ans.value
        return viewFlagLegacyRead(cwd, name)
      } catch (e) { return false }
    }
