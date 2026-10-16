/**
 * src/client/kernel/settings-debug.ts — 内核模块（#1012 第 8 条：调试开关的真源搬进本机设置文件的 debug 节）
 * （原来是 .js：按「动到哪里转到哪里」转成 TypeScript，行为零变化。真源是这份 .ts，同名 .js 是构建产物。）
 *
 * 契约：scripts/build.mjs 去掉行首 export 后把声明体拼进 src/client/index.js 的 kernel:settingsDebug 标记处（apply 闭包内原位）；次序必须在
 *   kernel:log 与 kernel:settingsTemplates 之后 —— 运行时那份日志内核在 npm 包 dsh-log 里（log.js 只是 #564 留而不搬的旧真源，改它既不进产物、
 *   还会让 verify-client-no-undef 变红）。本片与界面偏好、动作模板共用同一个待写队列与同一份文档。
 * 维护者 2026-10-12 拍板（#1012 评论 6113252694）：真源是本机设置文件 <用户主目录>/.dsh/mattskillsdeck/settings.yaml 的 debug 节
 *   { enabled, sampleRate }；宿主那份 log-switch.json 只是副本。本地开关快照（开机秒显用）走包的 persist，
 *   日志包 0.3.x 起落在 dsws.debug.wf（包按插件标识派生键，不按前缀）；裸键 dsws.debug 只剩一个用处：「升级前
 *   用户选过什么」的线索，加载那一刻搬一次（采样率一并带进证据，做法见 settingsDebugLegacy 头上那段迁移注释）。
 *   一条缺口：宿主副本眼下仍是「日志记不记」的实际闸门（宿主那份 log-switch.json 副本），副本没
 *   接上就记不下调试行；改宿主不在本票范围，本片只能把结果回给界面（文案带限定语）并在下一次机会自己重推一次。
 *
 * 写这一侧：先写设置文件，写进去了就算成功（内存、旧键快照、广播，顺手把宿主副本推成一样）；这条路接不下（文档问不到、更高
 *   版本、形状对不上）才退回包里的 setLogSwitch，错误码、超时、代际、失败分类一字不改；老路真成功了才把这一笔记进队列（记早了
 *   会留下「界面说失败、文件里却写着那个值」的假象）。队列里那两笔同形：section 'debug'，记号 \u0000debug\u0000 + 格名（见
 *   settingsDebugJournalKeyOf），kernel/settings-view.js 的 viewFlagSettle 与 settings-view-write.js 的三处分派。
 */
// 跨闭包的值引用按仓里规矩写模块级 declare（实现只在拼好的闭包里有一份，类型检查各看各的）：
// host 与 log 走全局已声明的那一份，这里只声明本片实际用到的其余名字。文档与内存快照一律按 any 接收，
// 形状是 config-store 与日志包那两家的事，本片只照契约读格不造形（与 kernel/link.ts 同例）。
declare const viewFlagState: any;
declare function viewFlagSubscribe(fn: (...args: any[]) => any): void;
declare function viewFlagScheduleWrite(): void;
declare function settingsViewLoad(): void;
declare const logSwitch: any;
declare function debugStorageKey(pluginId: string): string;
declare const LOG_DEBUG_KEY: string;
declare function readLocalDebugSwitch(): any;
declare function persistLocalDebugSwitch(sw: any): void;
declare function broadcastLogSwitch(): void;
declare function setLogSwitch(enabled: any, sampleRate: any): any;
declare function hash8(text: string): string;
declare const localStorage: any;
declare function setTimeout(fn: (...args: any[]) => void, ms: number): unknown;
    // 这一节的格名与核（src/shared/config-store/settings.js 第 102–111 行）同一份：enabled 是布尔开关，sampleRate 是 0 到 1 之间的数字（越界会被核整份拒绝）；本片是唯一的写入方，所以名字在这里钉死。
    const SETTINGS_DEBUG_NAMES = ['enabled', 'sampleRate']
    // 宿主一直不回话时不许把界面吊在那里（包里的老路也是靠一个五秒守护收口）：等够这么久就按「没接上」回。文件里那一份搬进内存
    //   这件事只做一次（一次问话只有一个终点，搬完就放下，后续以内存这一份为准）。
    // 等待时长住中央 YAML（调时间改 config/timeouts.yaml）：界面闭包由构建把产物拼进来，本文件只声明名字。
    declare const SETTINGS_DEBUG_PUSH_WAIT_MS: number
    let debugAdopted = false
    // 宿主那份副本跟没跟上：接不上就记下来，等下一次机会自愈（见 settingsDebugPushToHost）。settingsDebugHostPush 是最近一次推送
    //   的结果（Promise<boolean>）：拨开关那一趟要把它回给界面，界面才知道要不要说限定语。下面三格是在途去重（2026-10-12 复核第三轮
    //   建议 1）：busy ＝ 最近一趟还在飞；next ＝ 飞行期间又来过的最后一笔请求；last ＝ 整条链尾的 promise（排队那一趟拿它当自己的结果）。
    let settingsDebugHostStale = false
    let settingsDebugHostPush: Promise<unknown> | null = null
    let settingsDebugPushBusy = false
    let settingsDebugPushNext: { on: boolean } | null = null
    let settingsDebugPushLast = Promise.resolve(true)
    // 旧键在模块加载那一刻的样子：必须在包的 reconcileLogSwitch（它会用宿主副本覆盖本地）之前读，否则读到的不是升级前的选择。
    // 存储键迁移（日志包 0.3.x）：开关从 dsws.debug 搬到 dsws.debug.wf（包的 debugStorageKey 按插件标识派生，本插件标识即 wf），
    // 形状里也不再带 sampleRate。新键有值就认新键；新键没有、旧键有，才是刚升级——把旧选择搬过去（走包的 persist，
    // 写出的形状与新版一致），采样率只留在这份证据里给设置文件采纳（包的新形状里没有它的位置，文件才是它此后的真源）。
    // 旧键写坏了（不是一组名字→值）就当没见过：读新键的默认值，升级证据按「没见过」处理，不拿坏值顶掉文件。
    const settingsDebugLegacy = (function () {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return { seen: false, enabled: false, sampleRate: 1 }
        const newKey = debugStorageKey('wf')
        let migratedRate = null
        try {
          if (!localStorage.getItem(newKey)) {
            const saved = JSON.parse(localStorage.getItem(LOG_DEBUG_KEY) || 'null')
            if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
              if (typeof saved.sampleRate === 'number' && isFinite(saved.sampleRate) && saved.sampleRate >= 0 && saved.sampleRate <= 1) migratedRate = saved.sampleRate
              persistLocalDebugSwitch({ enabled: saved.enabled === true })
            }
          }
        } catch (eM) {}
        if (!localStorage.getItem(newKey) && !localStorage.getItem(LOG_DEBUG_KEY)) return { seen: false, enabled: false, sampleRate: 1 }
        const v = readLocalDebugSwitch()
        return { seen: true, enabled: !!(v && v.enabled === true), sampleRate: (migratedRate !== null) ? migratedRate : 1 }
      } catch (e) { return { seen: false, enabled: false, sampleRate: 1 } }
    })()
    // 队列里 debug 那两笔的记号：固定段名 + \u0000 + 格名（工作区路径里不可能出现 \u0000，三族记号不会撞上）。一笔的形状（待写、
    //   journal、「还没定论」三处共用一份）：section 记 'debug'，键用那个记号，值就是用户拨的那一个。
    const settingsDebugJournalKeyOf = function (name: string): string { return '\u0000debug\u0000' + name }
    const settingsDebugItem = function (name: string, value: unknown): { section: string; name: string; value: unknown; key: string } { return { section: 'debug', name: name, value: value, key: settingsDebugJournalKeyOf(name) } }
    // idle 档那一笔「还没定论」的簿子：用户拨开关时文档从没问过（这一拨自己把它问起来）、老路还没回话 —— 这一刻既不能记进待写队列
    //   （老路可能被拒，文件里一个字都不许留），又不能不留痕迹：采纳只看待写队列与 journal，看不见这一笔就会照文件里的旧值把内存与宿主
    //   副本顶回去（2026-10-12 复核实得：用户从开拨到关、文档先到手时，宿主最后停在开）。老路定了论就清空（成了交给 rememberChoice 落进文件，被拒就撤掉）。
    let settingsDebugUndecided: Record<string, { section: string; name: string; value: unknown; key: string }> = {}
    const settingsDebugUndecidedClear = function (): void { settingsDebugUndecided = {} }
    // 文档里的 debug 节：形状对不上（更高版本插件写的文件、或不是一组「名字 → 值」）时回 null。
    const settingsDebugSectionOf = function (doc: any): any {
      try {
        if (!doc || typeof doc !== 'object') return null
        const dbg = doc.debug
        if (!dbg || typeof dbg !== 'object' || Array.isArray(dbg)) return null
        return dbg
      } catch (e) { return null }
    }
    // 问回来的那一份到底像不像一份设置文档，两档口径。为什么要判：设置这两条电话是后加的，老宿主、别的插件占位的同号电话都可能回
    //   一个「ok 但没有文档」的东西，当成文档接着写会把这一笔写进不存在的地方。默认档：带版本号，或至少带一个已知的节，判不出来按
    //   「这条路接不下」退回老路（用户那一下照样有效，下一次采纳再搬进文件）。严格档（第二参数 true，要拿它当「整份写回文件的基底」时用）还得五节齐全：
    //   只有 {version: 1} 的半份文档过得了默认档，核归一后会把别的节写成空值。
    const settingsDebugDocLooksReal = function (doc: any, needAllSections?: unknown): boolean {
      try {
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false
        const isObj = function (v: unknown): boolean { return !!v && typeof v === 'object' && !Array.isArray(v) }
        const whole = (typeof doc.version === 'number' && isObj(doc.ui) && isObj(doc.workspaces) && isObj(doc.debug) && isObj(doc.templates))
        if (needAllSections === true) return whole
        return whole || (typeof doc.version === 'number') || (doc.ui !== undefined || doc.workspaces !== undefined || doc.debug !== undefined || doc.templates !== undefined)
      } catch (e) { return false }
    }
    // 文件里的开关值：只有布尔才算「文件里写了这一格」，否则回 null（＝文件没说这一格，走升级迁移那条路）。采样率：只有 0 到 1
    //   之间的数字才算（越界的值核根本不会让它进文件，这里只是照核的口径判一遍）。
    const settingsDebugEnabledInDoc = function (): boolean | null {
      try {
        const dbg = settingsDebugSectionOf(viewFlagState.doc)
        const v = dbg ? dbg.enabled : undefined
        return (typeof v === 'boolean') ? v : null
      } catch (e) { return null }
    }
    const settingsDebugRateInDoc = function (): number | null {
      try {
        const dbg = settingsDebugSectionOf(viewFlagState.doc)
        const v = dbg ? dbg.sampleRate : undefined
        return (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1) ? v : null
      } catch (e) { return null }
    }
    // 调用方递进来的采样率：不在 0 到 1 之间就退回内存里现在这一个（核会整份拒绝越界值，不许把坏值写进文件）。升级前那份证据里的
    //   采样率：旧键见过就用旧键，否则用此刻内存里这一份，都没有就 1。
    const settingsDebugRateOf = function (sampleRate: unknown): number {
      try {
        if (typeof sampleRate === 'number' && isFinite(sampleRate) && sampleRate >= 0 && sampleRate <= 1) return sampleRate
        const cur = logSwitch ? logSwitch.sampleRate : 1
        return (typeof cur === 'number' && isFinite(cur) && cur >= 0 && cur <= 1) ? cur : 1
      } catch (e) { return 1 }
    }
    const settingsDebugEvidenceRate = function (): number {
      try {
        if (settingsDebugLegacy.seen === true) return settingsDebugLegacy.sampleRate
        const cur = logSwitch ? logSwitch.sampleRate : 1
        return (typeof cur === 'number' && isFinite(cur) && cur >= 0 && cur <= 1) ? cur : 1
      } catch (e) { return 1 }
    }
    // 把一格改进内存文档的 debug 节：别的节与别的格一律不动；这一节缺失或形状不对就新建一份空的。值本身照核的形状判一遍（enabled 必须是布尔、sampleRate 必须是 0 到 1 的数字），对不上就回 false，让调用方走旧键兜底。
    export const settingsDebugSetInDoc = function (doc: any, name: string, value: unknown): boolean {
      try {
        if (!settingsDebugDocLooksReal(doc)) return false
        if (SETTINGS_DEBUG_NAMES.indexOf(name) < 0) return false
        if (name === 'enabled' && typeof value !== 'boolean') return false
        if (name === 'sampleRate' && !(typeof value === 'number' && isFinite(value) && value >= 0 && value <= 1)) return false
        if (!doc.debug || typeof doc.debug !== 'object' || Array.isArray(doc.debug)) doc.debug = {}
        doc.debug[name] = value
        return true
      } catch (e) { return false }
    }
    // 一笔开关写不进内存文档时记一行（沿用既有的 storage.fail，不新开事件名；key 记固定记号，与同库另两处 viewFlagLogDocFail / settingsUiLogDocFail 一致，日志纪律不许把用户数据写进日志）。
    const settingsDebugLogDocFail = function (): void {
      try { log('warn', 'storage.fail', { key: 'settings.debug', op: 'write' }) } catch (eL) {}
    }
    // 文件这条路走不通时的旧键兜底（settings-view-write.js 的写失败那一趟按 section 分派到这里）：把此刻的真值写进旧键 dsws.debug 当秒显快照 —— 下次开机秒显读它，那趟采纳会照「旧键见过」把这份选择排队写回文件，这一次拨动就这么活到下一趟。
    export const settingsDebugLegacyWrite = function (): boolean {
      try { persistLocalDebugSwitch(logSwitch); return true } catch (e) { return false }
    }
    // 与包里 logSwitchSetFail 同一档错误分类（那份代码没导出，这里照抄一遍判据）：日志事件名、字段名、kind 前缀都与包一致，不新增事件名（tests/verify-log-fields.js 的字段白名单钉着 method/kind/errorHash）。
    const settingsDebugThrowKind = function (e: any): string {
      const msg = String((e && typeof e === 'object' && ('code' in e || 'message' in e) ? e.code || e.message : e) || '')
      if (/unknown endpoint/i.test(msg)) return 'throw-unknown-endpoint'
      if (/connection|host\.call 不可用|unavailable/i.test(msg)) return 'throw-connection'
      return 'throw'
    }
    const settingsDebugHostFailLog = function (kind: string, hint: unknown): void {
      try {
        if (typeof log !== 'function') return
        const text = String(hint === undefined || hint === null ? kind : hint).slice(0, 120)
        const hashed = (typeof hash8 === 'function') ? hash8(text) : '00000000'
        log('warn', 'host.call.fail', { method: 'wf.logSetSwitch', kind: 'set-switch-' + kind, errorHash: hashed })
      } catch (eL) {}
    }
    // 把真源推给宿主那份副本（best-effort，回 Promise<boolean>：副本接上了没有）。失败只记一行分类告警并标成「没接上」，
    //   等下一次机会自己再推（settingsDebugRetryHost 与 adopt 开头那一趟）—— 副本跟不上不是用户的错，真源已经定了。在途去重
    //   （2026-10-12 复核第三轮建议 1）：最近一趟还在飞时不再发新电话，只留最后一趟等它落地再发 —— 慢宿主下每一帧都发会堆出
    //   好几趟同时在途、还带着新旧不同的值，谁先到全看回话顺序；返回链尾的 promise，排队那一趟拿到的是它自己那一趟的结果。
    //   发出去的只有 enabled 一格：宿主开关电话的契约就是 { enabled }（日志包 0.3.x 起多余字段直接忽略），采样率的真源
    //   是设置文件，不在这趟电话里带死字段。
    const settingsDebugPushToHost = function (on: unknown): any {
      const want = { on: on === true }
      if (settingsDebugPushBusy) { settingsDebugPushNext = want; return settingsDebugPushLast }
      settingsDebugPushBusy = true
      let p = null
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') {
          settingsDebugHostFailLog('host-unavailable', 'host-unavailable')
        } else {
          const pending = host.call('wf.logSetSwitch', { enabled: want.on })
          if (!pending || typeof pending.then !== 'function') settingsDebugHostFailLog('host-unavailable', 'bad-reply')
          else p = pending.then(function (res: any): boolean {
            if (res && res.ok === true) { settingsDebugHostStale = false; return true }
            settingsDebugHostFailLog('host-rejected', 'host-rejected')
            return false
          }, function (e: any): boolean { settingsDebugHostFailLog(settingsDebugThrowKind(e), (e && e.message) || e); return false })
        }
      } catch (e) { const eAny: any = e; settingsDebugHostFailLog(settingsDebugThrowKind(eAny), (eAny && eAny.message) || eAny) }
      // 宿主一直不回话时不许把界面吊在那里：等够五秒（与包里那条老路的守护同一量级）就按「没接上」回。
      if (!p) { settingsDebugHostStale = true; p = Promise.resolve(false) }
      else p = Promise.race([p, new Promise(function (r) { setTimeout(function () { r(false) }, SETTINGS_DEBUG_PUSH_WAIT_MS) })])
      settingsDebugPushLast = p.then(function (took: unknown): any {
        settingsDebugPushBusy = false
        if (took !== true) settingsDebugHostStale = true
        const n = settingsDebugPushNext; settingsDebugPushNext = null
        return n ? settingsDebugPushToHost(n.on) : took === true
      })
      return settingsDebugPushLast
    }
    // 真值落地那一趟（拨开关与文档到手后采纳都走它）：内存 → 旧键秒显快照 → 广播给界面 → 推给宿主副本。先改内存再广播，
    //   界面拿到的就是已经稳下来的世界；skipPush 那一档给「老路刚推过同一个值」的补记用，省一次重复的宿主电话。
    const settingsDebugApplyTruth = function (on: unknown, rate: unknown, skipPush?: unknown): { enabled: boolean; sampleRate: number } {
      const next = { enabled: on === true, sampleRate: settingsDebugRateOf(rate) }
      try {
        logSwitch.enabled = next.enabled
        logSwitch.sampleRate = next.sampleRate
      } catch (e) {}
      settingsDebugLegacyWrite()
      try { if (typeof broadcastLogSwitch === 'function') broadcastLogSwitch() } catch (eB) {}
      if (skipPush !== true) settingsDebugHostPush = settingsDebugPushToHost(next.enabled)
      return next
    }
    // 把这一份真源排队写进设置文件。返回值与 setViewFlag / setUiPref 同义：true ＝ 交给本机设置文件这条路了
    //   （可能还在防抖窗口里没落盘）；false ＝ 这条路接不下，调用方按老办法兜底。两格一起写：拨的是开关，但采样率
    //   是同一节里的另一格，只写一格会让核归一之后那一格变成默认值。
    export const settingsDebugSet = function (enabled: unknown, sampleRate: unknown): boolean {
      try {
        const on = enabled === true
        const rate = settingsDebugRateOf(sampleRate)
        // 文档从没问过这一档（新会话第一次打开设置页）：先把这一笔记进「还没定论」的簿子，再交给包里的老路并把文档问起来。
        //   为什么必须记：这个拨动自己把文档问起来，同一趟采纳紧跟着就跑；队列里没有痕迹的话，那趟采纳会照文件里的旧值
        //   把老路刚写好的内存与宿主副本顶回去，而这一次选择此后没有机会再进文件 —— 用户在 idle 下拨的那一下永久丢失。
        //   为什么不能直接记待写队列：老路可能被拒，那时文件里一个字都不许留（留了就成不了「界面说没成」的假象）。
        if (viewFlagState.status === 'idle') {
          settingsDebugUndecided[settingsDebugJournalKeyOf('enabled')] = settingsDebugItem('enabled', on)
          settingsDebugUndecided[settingsDebugJournalKeyOf('sampleRate')] = settingsDebugItem('sampleRate', rate)
          settingsViewLoad()
          return false
        }
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这两笔，等它落地再并进文档（此刻若走旧路写文件，文档一到手就会拿文件里的旧值把
          //   「刚拨的这一下」顶掉，用户会看见自己刚拨开的开关又弹回去）。
          viewFlagState.deferred[settingsDebugJournalKeyOf('enabled')] = settingsDebugItem('enabled', on)
          viewFlagState.deferred[settingsDebugJournalKeyOf('sampleRate')] = settingsDebugItem('sampleRate', rate)
          return true
        }
        if (viewFlagState.status !== 'ready') return false
        // 形状对不上（老宿主、占位电话答上来的东西）：按「这条路接不下」处理，退回老路，不往它上面写。
        if (!settingsDebugDocLooksReal(viewFlagState.doc)) return false
        if (!settingsDebugSetInDoc(viewFlagState.doc, 'enabled', on) || !settingsDebugSetInDoc(viewFlagState.doc, 'sampleRate', rate)) {
          settingsDebugLogDocFail()
          return false
        }
        viewFlagState.journal[settingsDebugJournalKeyOf('enabled')] = { section: 'debug', name: 'enabled', value: on, key: settingsDebugJournalKeyOf('enabled') }
        viewFlagState.journal[settingsDebugJournalKeyOf('sampleRate')] = { section: 'debug', name: 'sampleRate', value: rate, key: settingsDebugJournalKeyOf('sampleRate') }
        viewFlagScheduleWrite()
        return true
      } catch (e) { return false }
    }
    // 老路（包里的 setLogSwitch）成功之后补记这一下：这一刻才知道用户的选择真的生效了。落点直接借 settingsDebugSet 的
    //   状态判断（文档在路上 → 记待写，文档到手时由 settingsDebugDrainDeferred 并进文件与 journal；文档在手上 → 记
    //   journal 并排期落盘），文档在手上那一种次序里内存那一份还要按老路的真值重落一遍（采纳已经拿文件里的值覆盖过
    //   内存，不落一遍就会「内存说开、文件说关」）；两种都接不下就只写旧键快照，等下一次开机采纳把它搬进文件。调用
    //   这一刻 status 不可能是 idle（拨之前先把文档问了起来），所以不会又走一遍问文档那一支。
    const settingsDebugRememberChoice = function (on: unknown, rate: unknown): boolean {
      try {
        settingsDebugUndecidedClear()
        if (settingsDebugSet(on, rate) === true) {
          if (viewFlagState.status === 'ready') settingsDebugApplyTruth(on, rate, true)
          return true
        }
        settingsDebugLegacyWrite()
      } catch (e) {}
      return false
    }
    // 用户在诊断日志分组拨开关走这一个（跑腿 settingsDebugToggle 经开关写入笔调它）。返回形状在包里的 setLogSwitch 之上多一格
    //   hostPushed：只说宿主那份副本接上没有（false 时界面要把话说全），ok 仍是「真源落地了没有」。文件这条路接得
    //   下：真源当场就定了 —— 改内存、写旧键快照、广播、推宿主副本，宿主失败也回 ok: true。接不下：原样调包里的
    //   setLogSwitch（老路：宿主是真源，错误码与分类一字不改），返回原样交给界面。
    export const settingsDebugToggle = function (enabled: unknown, sampleRate: unknown): any {
      let took = false
      try { took = settingsDebugSet(enabled, sampleRate) === true } catch (e) { took = false }
      if (took) {
        const next = settingsDebugApplyTruth(enabled, sampleRate)
        return Promise.resolve(settingsDebugHostPush).then(function (pushed: unknown): { ok: boolean; enabled: boolean; sampleRate: number; hostPushed: boolean } {
          return { ok: true, enabled: next.enabled, sampleRate: next.sampleRate, hostPushed: pushed === true }
        })
      }
      try {
        if (typeof setLogSwitch === 'function') {
          const rate = settingsDebugRateOf(sampleRate)
          const pend = setLogSwitch(enabled, sampleRate)
          if (pend && typeof pend.then === 'function') return pend.then(function (res: any): unknown {
            // 老路这一笔有了定论：「还没定论」的簿子立刻撤掉 —— 成了由 rememberChoice 落进文件，被拒则一个字都不留。
            settingsDebugUndecidedClear()
            if (res && res.ok === true) settingsDebugRememberChoice(enabled === true, rate)
            return res
          })
          settingsDebugUndecidedClear()
          return pend
        }
      } catch (e2) { const e2any: any = e2; settingsDebugUndecidedClear(); settingsDebugHostFailLog(settingsDebugThrowKind(e2any), (e2any && e2any.message) || e2any) }
      // 连包里的老路都不在（不该发生：这一份是同一个产物里的名字）：回一个与老路同类形的失败，不静默。
      settingsDebugUndecidedClear()
      settingsDebugHostFailLog('host-unavailable', 'set-switch-missing')
      try { return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: 'host-unavailable' }) } catch (e3) { return Promise.resolve({ ok: false, enabled: false, error: 'host-unavailable' }) }
    }
    // 队列里还压着用户刚拨的那一笔时，采纳这一步什么都不做：用户这一下发生在文件读回来之后、落盘之前，文件里那份
    //   还是旧值，照文件覆盖内存会让用户看见自己刚拨的开关又弹回去。此刻内存、旧键快照、宿主副本都已经在拨的那一下
    //   落好了，落盘那一趟会把这笔写进文件（同一个队列）。
    const settingsDebugHasPending = function (): boolean {
      try {
        const groups = [viewFlagState.journal, viewFlagState.deferred, settingsDebugUndecided]
        for (let g = 0; g < groups.length; g++) {
          const ks = Object.keys(groups[g] || {})
          for (let i = 0; i < ks.length; i++) {
            const d = groups[g][ks[i]]
            if (d && d.section === 'debug') return true
          }
        }
      } catch (e) {}
      return false
    }
    // 副本没接上时的自愈口子：诊断日志分组每次重新画一遍就由界面调它一次（views/diagnosticLog/DiagnosticLogSection.ts 里的 React.useEffect），只在这一份确实
    //   没接上时才推。为什么不能只挂在「文档到手」那一趟上：viewFlagSubscribe 是一次性订阅（kernel/settings-view-state.js 的整批
    //   清空），一个会话只到手一趟，挂那一趟等于永远不重推（2026-10-12 复核指出）。
    export const settingsDebugRetryHost = function (): boolean {
      try {
        if (!settingsDebugHostStale) return false
        settingsDebugPushToHost(logSwitch.enabled === true)
        return true
      } catch (e) { return false }
    }
    // 文档到手（或判定问不到）时定真值，并把它落到内存、旧键快照、界面与宿主副本上，只做一次。开头那一段也是自愈口子
    //   之一（另一处是上面那个导出件：文档比拨动晚到时，那一趟就能把上一次没推上去的副本补上）。
    export const settingsDebugAdoptFromDoc = function (): void {
      try {
        if (settingsDebugHostStale) settingsDebugPushToHost(logSwitch.enabled === true)
        if (debugAdopted) return
        debugAdopted = true
        if (settingsDebugHasPending()) return
        // 问回来的那一份不像设置文档（老宿主、占位电话答上来的东西）：没有文件这一份真源可采，保持原样 —— 这里绝不
        //   许照着它改内存或推宿主副本，采纳的每一个分支都要以「文件里那一份」为据。
        if (!settingsDebugDocLooksReal(viewFlagState.doc)) return
        const inDoc = settingsDebugEnabledInDoc()
        const rateInDoc = settingsDebugRateInDoc()
        const legacyOn = settingsDebugLegacy.seen === true && settingsDebugLegacy.enabled === true
        let memOn = false
        try { memOn = !!(logSwitch && logSwitch.enabled === true) } catch (eM) {}
        const evidenceOn = legacyOn || memOn
        let truthOn = false
        let queueWrite = false
        if (inDoc === true) {
          truthOn = true
        } else if (inDoc === false) {
          // 文件说关、升级前那份证据说开：认开（用户升级前的选择），并排队写回文件（分支③）。
          truthOn = evidenceOn
          queueWrite = evidenceOn
        } else {
          // 文件里没有这一节：用升级前那份证据（分支②）。旧键见过，或证据说是开，都算一份用户的选择，要排队写进
          //   文件；两样都没有就不写（用户从没碰过这个开关，不给文件添一笔默认值）。
          truthOn = evidenceOn
          queueWrite = settingsDebugLegacy.seen === true || evidenceOn
        }
        const truthRate = (inDoc === true && rateInDoc !== null) ? rateInDoc : settingsDebugEvidenceRate()
        if (queueWrite) settingsDebugSet(truthOn, truthRate)
        settingsDebugApplyTruth(truthOn, truthRate)
      } catch (e) {}
    }
    // 文档到手（或判定问不到）时，把还在路上的 debug 那两笔接上：能进文档就进待写队列，进不去就走旧键兜底。由
    //   kernel/settings-view.js 的 viewFlagSettle 在清空 deferred 那一趟里按 section 分派过来；返回 true 表示这一笔
    //   已经处理完（调用方不必再按工作区那条路处理它，那条路会拿 undefined 当工作区根）。
    export const settingsDebugDrainDeferred = function (d: any, status: unknown): boolean {
      try {
        if (status === 'ready' && settingsDebugSetInDoc(viewFlagState.doc, d.name, d.value)) {
          viewFlagState.journal[settingsDebugJournalKeyOf(d.name)] = { section: 'debug', name: d.name, value: d.value, key: settingsDebugJournalKeyOf(d.name) }
          return true
        }
        settingsDebugLegacyWrite()
        if (status === 'ready') settingsDebugLogDocFail()
      } catch (e) {}
      return true
    }
    // 初始化一件事（与 kernel/settings-ui.js、settings-templates.js 末尾同例）：把「文件到手就把文件那一份定成真值」
    //   登记上去（文档早已到手时它会立刻调一次）。
    try { viewFlagSubscribe(settingsDebugAdoptFromDoc) } catch (e0) {}
