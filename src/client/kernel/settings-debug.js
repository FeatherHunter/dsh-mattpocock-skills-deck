/**
 * src/client/kernel/settings-debug.js — 内核模块（#1012 第 8 条：调试开关的真源搬进本机设置文件的 debug 节）
 *
 * 契约：本文件是模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首的 export 关键字，把声明体
 *   文本拼回 src/client/index.js 里 kernel:settingsDebug 拼接标记处（apply 闭包内原位），与其它内核片同模式，
 *   一源两物、src 零复制。拼接次序必须在 kernel:log 与 kernel:settingsTemplates 之后，理由是两条：
 *   ① 本片要用运行时那份日志内核的名字 —— src/client/index.js 第 171 行的 kernel:log 拼进来的是
 *      scripts/generated/logKernel.derived.js，也就是真正在跑的那一份日志内核（scripts/build.mjs 第 500 行）；
 *   ② 本片与界面偏好、动作模板那两族共用同一个待写队列与同一份文档（kernel/settings-view-write.js）。
 *
 * 为什么真源落在本片而不是 src/client/kernel/log.js：运行时那个日志开关住在 npm 包 dsh-log 里，log.js 只是
 *   #564 留而不搬的旧真源，改它既不进产物、还会让 verify-client-no-undef 变红。所以真源这一半落在本片：
 *   本片是设置文件 debug 节唯一的写入方，包里的 readLocalDebugSwitch / persistLocalDebugSwitch / logSwitch /
 *   setLogSwitch / reconcileLogSwitch 都在同一个闭包里，直接拿来用。
 *
 * 维护者 2026-10-12 拍板（#1012 评论 6113252694）：调试开关的真源是本机设置文件
 *   <用户主目录>/.dsh/mattskillsdeck/settings.yaml 的 debug 节（形状 { enabled, sampleRate }）；宿主那份
 *   <用户主目录>/.dsh/mattskillsdeck/log-switch.json 只是当初经 wf.logSetSwitch 设出来的副本，不是真源。
 *   旧 localStorage 键 dsws.debug 从此只剩两个用处：开机秒显的同步快照，以及「升级前用户选过什么」的线索。
 *
 * 读这一侧（settingsDebugAdoptFromDoc，文档到手时只做一次，由 viewFlagSubscribe 叫起）：按文件里有没有
 *   这一节分三条路定出真值，再落到内存 + 旧键快照 + 广播 + 把真源推给宿主那份副本：
 *   ① 文件里这一节有真假值 → 用它；
 *   ② 文件里没有这一节（文件不在、或这一节形状对不上）→ 用升级前那份证据（旧键见过就用旧键，否则看此刻
 *      内存里这一份）；
 *   ③ 文件说关、而升级前那份证据说开 → 认开，并把它排队写回文件。
 *   ②③ 两条要把定下来的真值排队写进文件：文件里没有用户的选择时，旧键里那一份就是唯一的选择记录。
 *   反过来「文件说开」不写文件（文件里已经是那个值），「文件说关、也没有任何证据」也不写（不给用户从没
 *   碰过的文件添一笔默认值）。
 *   升级前那份证据为什么要把「此刻内存里这一份」也算上：开机时包里的 reconcileLogSwitch（panelAssembly.js
 *   第 152 行调）会拿宿主副本覆盖内存、并把旧键也覆盖掉，旧键这条线索会被它抹掉；而宿主副本说开同样是
 *   「用户曾经开着」的证据 —— 宿主那份只可能是经 wf.logSetSwitch 设出来的。
 *   采样率跟着「真值从哪来」走：认文件那一份时用文件里的采样率；认旧键或内存那一份时用那一份的采样率。
 *   为什么不能一律用文件里那个数：文件说关的那一刻，它写的 sampleRate 是核归一之后的默认 1，不是用户选过
 *   的值，拿它去顶掉用户旧存档里调过的 0.5 等于把人家调过的白调。
 *
 * 写这一侧（settingsDebugToggle / settingsDebugSet）：用户在设置页拨开关，先写这个设置文件，写进去了就算
 *   成功 —— 内存、旧键快照、广播，顺手把宿主那份推成一样；宿主那一步失败只记一行 host.call.fail（副本跟
 *   不上不改真源，也不把用户这一下判成失败）。文件这条路接不下（文档问不到、是更高版本、形状对不上）才
 *   退回原来的老路：调包里的 setLogSwitch，错误码、超时、代际、失败分类一字不改。
 *
 * 队列里 debug 那两笔与界面偏好、动作模板同形：没有工作区路径，只有格名。记号固定为
 *   \u0000debug\u0000 + 格名（工作区路径里不可能出现 \u0000，三族记号不会撞上）；section 记 'debug'，
 *   kernel/settings-view.js 的 viewFlagSettle 与 kernel/settings-view-write.js 的三处（写前重读合并、
 *   回包取值、写失败兜底）都按这个 section 分派过来。
 */
    // 这一节的格名与核（src/shared/config-store/settings.js 第 102–111 行的 debug 两格）同一份：
    //   enabled 是布尔开关，sampleRate 是 0 到 1 之间的数字（越界会被核整份拒绝）。本片是唯一的写入方，
    //   所以名字在这里钉死，绝不放任调用方拿任意字符串写进文件。
    const SETTINGS_DEBUG_NAMES = ['enabled', 'sampleRate']
    // 文件里那一份搬进内存这件事只做一次（一次问话只有一个终点，搬完就放下，后续以内存这一份为准）。
    let debugAdopted = false
    // 旧键在模块加载那一刻的样子：见过没有、当时说的是开还是关、采样率多少。必须在包的 reconcileLogSwitch
    //   之前读：那一位会用宿主副本把旧键覆盖掉（见文件头那段「升级前那份证据」），之后再读就不是升级前
    //   用户的选择了。读本地存储照现有写法包 try/catch，读不到就当作「没见过」。
    const settingsDebugLegacy = (function () {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return { seen: false, enabled: false, sampleRate: 1 }
        const raw = localStorage.getItem(LOG_DEBUG_KEY)
        if (!raw) return { seen: false, enabled: false, sampleRate: 1 }
        const v = readLocalDebugSwitch()
        const r = v ? v.sampleRate : 1
        return {
          seen: true,
          enabled: !!(v && v.enabled === true),
          sampleRate: (typeof r === 'number' && isFinite(r) && r >= 0 && r <= 1) ? r : 1
        }
      } catch (e) { return { seen: false, enabled: false, sampleRate: 1 } }
    })()
    // 队列里 debug 那两笔的记号：固定段名 + \u0000 + 格名（见文件头那一段）。
    const settingsDebugJournalKeyOf = function (name) { return '\u0000debug\u0000' + name }
    // 文档里的 debug 节：形状对不上（更高版本插件写的文件、或不是一组「名字 → 值」）时回 null。
    const settingsDebugSectionOf = function (doc) {
      try {
        if (!doc || typeof doc !== 'object') return null
        const dbg = doc.debug
        if (!dbg || typeof dbg !== 'object' || Array.isArray(dbg)) return null
        return dbg
      } catch (e) { return null }
    }
    // 问回来的那一份到底像不像一份设置文档。两档口径：
    //   默认（只给一个参数）：像 ＝ 有一份带版本号的文档，或至少带一个已知的节。为什么要判这一下：设置这两条
    //     电话是后加的，老宿主、别的插件占位的同号电话、以及被别的东西答上来的假回复都可能回一个「ok 但没有
    //     文档」的东西；这种答复要是被当成文档接着写，就会把这一笔写进一个不存在的地方，用户拨的开关从此没了
    //     下落。判不出来就按「这条路接不下」处理，退回包里的老路（老路会把这一笔写进宿主副本与旧键，用户那
    //     一下照样有效），下一次采纳再把它搬进文件。
    //   严格（第二个参数 true）：要拿它当「整份写回文件的基底」，还得与核归一之后那一份同形 —— 五节齐全。
    //     为什么这一档要更严：一份只有 {version: 1} 的半份文档过得了默认那档（它有版本号），却少了其余几节，
    //     核收到会按「缺的那几节是空的」归一之后落盘，用户本来的 ui / workspaces / templates 就被写成空值
    //     （调用点在 kernel/settings-view-write.js 写之前那次重读）。
    const settingsDebugDocLooksReal = function (doc, needAllSections) {
      try {
        if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false
        const isObj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
        const whole = (typeof doc.version === 'number' && isObj(doc.ui) && isObj(doc.workspaces) && isObj(doc.debug) && isObj(doc.templates))
        if (needAllSections === true) return whole
        return whole || (typeof doc.version === 'number') || (doc.ui !== undefined || doc.workspaces !== undefined || doc.debug !== undefined || doc.templates !== undefined)
      } catch (e) { return false }
    }
    // 文件里的开关值：只有布尔才算「文件里写了这一格」，否则回 null（＝文件没说这一格，走升级迁移那条路）。
    const settingsDebugEnabledInDoc = function () {
      try {
        const dbg = settingsDebugSectionOf(viewFlagState.doc)
        const v = dbg ? dbg.enabled : undefined
        return (typeof v === 'boolean') ? v : null
      } catch (e) { return null }
    }
    // 文件里的采样率：只有 0 到 1 之间的数字才算（越界的值核根本不会让它进文件，这里只是照核的口径判一遍）。
    const settingsDebugRateInDoc = function () {
      try {
        const dbg = settingsDebugSectionOf(viewFlagState.doc)
        const v = dbg ? dbg.sampleRate : undefined
        return (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1) ? v : null
      } catch (e) { return null }
    }
    // 调用方递进来的采样率：不在 0 到 1 之间就退回内存里现在这一个（核会整份拒绝越界值，不许把坏值写进文件）。
    const settingsDebugRateOf = function (sampleRate) {
      try {
        if (typeof sampleRate === 'number' && isFinite(sampleRate) && sampleRate >= 0 && sampleRate <= 1) return sampleRate
        const cur = logSwitch ? logSwitch.sampleRate : 1
        return (typeof cur === 'number' && isFinite(cur) && cur >= 0 && cur <= 1) ? cur : 1
      } catch (e) { return 1 }
    }
    // 升级前那份证据里的采样率（旧键见过就用旧键，否则用此刻内存里这一份，都没有就 1）。
    const settingsDebugEvidenceRate = function () {
      try {
        if (settingsDebugLegacy.seen === true) return settingsDebugLegacy.sampleRate
        const cur = logSwitch ? logSwitch.sampleRate : 1
        return (typeof cur === 'number' && isFinite(cur) && cur >= 0 && cur <= 1) ? cur : 1
      } catch (e) { return 1 }
    }
    // 把一格改进内存文档的 debug 节：别的节与别的格一律不动；这一节缺失或形状不对就新建一份空的。
    //   值本身照核的形状判一遍（enabled 必须是布尔、sampleRate 必须是 0 到 1 的数字），对不上就回 false，
    //   让调用方走旧键兜底 —— 比写一份核会整份拒绝的文档强。
    export const settingsDebugSetInDoc = function (doc, name, value) {
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
    // 一笔开关写不进内存文档时记一行（沿用既有的 storage.fail，不新开事件名；key 记一个固定的记号，
    //   与同库另两处 viewFlagLogDocFail / settingsUiLogDocFail 的写法一致，日志纪律不许把用户数据写进日志）。
    const settingsDebugLogDocFail = function () {
      try { log('warn', 'storage.fail', { key: 'settings.debug', op: 'write' }) } catch (eL) {}
    }
    // 文件这条路走不通时的旧键兜底（settings-view-write.js 的写失败那一趟按 section 分派到这里）：
    //   把内存这一份（＝此刻的真值）写进旧键 dsws.debug 当秒显快照。这一手兜得住什么要写清楚：页面一关，
    //   盘上那份设置文件里 debug 节还是旧值，但下一次开机秒显读的是这个旧键，于是下次开机 adoption 会
    //   照「旧键见过」把这份选择排队写回文件 —— 用户这一次拨动就是这么活到下一趟的。
    export const settingsDebugLegacyWrite = function () {
      try { persistLocalDebugSwitch(logSwitch); return true } catch (e) { return false }
    }
    // 与包里 logSwitchSetFail 同一档错误分类（那份代码没导出，这里照抄一遍判据）：日志事件名、字段名、
    //   kind 前缀都与包一致，不新增事件名（tests/verify-log-fields.js 的字段白名单钉着 method/kind/errorHash）。
    const settingsDebugThrowKind = function (e) {
      const msg = String((e && typeof e === 'object' && ('code' in e || 'message' in e) ? e.code || e.message : e) || '')
      if (/unknown endpoint/i.test(msg)) return 'throw-unknown-endpoint'
      if (/connection|host\.call 不可用|unavailable/i.test(msg)) return 'throw-connection'
      return 'throw'
    }
    const settingsDebugHostFailLog = function (kind, hint) {
      try {
        if (typeof log !== 'function') return
        const text = String(hint === undefined || hint === null ? kind : hint).slice(0, 120)
        const hashed = (typeof hash8 === 'function') ? hash8(text) : '00000000'
        log('warn', 'host.call.fail', { method: 'wf.logSetSwitch', kind: 'set-switch-' + kind, errorHash: hashed })
      } catch (eL) {}
    }
    // 把真源推给宿主那份副本（best-effort）：成功后什么都不用做；失败只记一行分类告警 —— 副本跟不上不是
    //   用户的错，真源（设置文件 + 内存）已经定了，这一次拨动不许因此被判成失败。
    const settingsDebugPushToHost = function (on, rate) {
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') {
          settingsDebugHostFailLog('host-unavailable', 'host-unavailable')
          return
        }
        const pending = host.call('wf.logSetSwitch', { enabled: on === true, sampleRate: rate })
        if (!pending || typeof pending.then !== 'function') { settingsDebugHostFailLog('host-unavailable', 'bad-reply'); return }
        pending.then(function (res) {
          if (!res || res.ok !== true) settingsDebugHostFailLog('host-rejected', 'host-rejected')
        }, function (e) { settingsDebugHostFailLog(settingsDebugThrowKind(e), (e && e.message) || e) })
      } catch (e) { settingsDebugHostFailLog(settingsDebugThrowKind(e), (e && e.message) || e) }
    }
    // 真值落地那一趟（拨开关与文档到手后采纳都走它）：内存 → 旧键秒显快照 → 广播给界面 → 推给宿主副本。
    //   次序有讲究：先改内存再广播，界面拿到的就是已经稳下来的世界；旧键快照紧跟内存，任何一次重画或重新
    //   加载读到的都是同一个值。返回落下去的那一份，调用方要回给界面。
    const settingsDebugApplyTruth = function (on, rate) {
      const next = { enabled: on === true, sampleRate: settingsDebugRateOf(rate) }
      try {
        logSwitch.enabled = next.enabled
        logSwitch.sampleRate = next.sampleRate
      } catch (e) {}
      settingsDebugLegacyWrite()
      try { if (typeof broadcastLogSwitch === 'function') broadcastLogSwitch() } catch (eB) {}
      settingsDebugPushToHost(next.enabled, next.sampleRate)
      return next
    }
    // 把这一份真源排队写进设置文件。返回值与 setViewFlag / setUiPref 同义，给调用方看两种意思：
    //   true ＝ 这一次交给本机设置文件这条路了（可能还在防抖窗口里没落盘）；
    //   false ＝ 这条路接不下（文档问不到、是更高版本、形状对不上），调用方按老办法兜底。
    //   两格一起写：拨的是开关，但采样率是同一节里的另一格，只写一格会让核归一之后那一格变成默认值。
    export const settingsDebugSet = function (enabled, sampleRate) {
      try {
        const on = enabled === true
        const rate = settingsDebugRateOf(sampleRate)
        // 文档从没问过这一档：这一下先交给包里的老路，同时把文档问起来。为什么不当场算这条路的账：
        //   设置这两条电话是后加的，老宿主或占位的同号电话都可能答不上来文档；一条还没验过的路先回
        //   「成功」，用户看到的成功就可能是假的（写进一个不存在的文档，开关从此没了下落）。老路这一下
        //   会把选择写进宿主副本与旧键（见文件头那段「升级前那份证据」）—— 两份都只在本机，宿主副本还会
        //   被下一次对账覆盖，光靠它们不构成真源。
        //   为什么必须先把这两笔记进待写队列、再问文档：这一个拨动自己就会把文档问起来，文档到手那一趟采纳
        //   紧跟着就跑；队列里没有痕迹的话，那趟采纳会照文件里的旧值（文件里没有这一节时照默认的关）把用户
        //   刚拨好的内存与宿主副本覆盖回去，而这一次选择此后没有机会再写进文件 —— 用户在 idle 下拨的那一下
        //   会永久丢失。记进 deferred 之后，采纳那趟因「有待写」提前返回；文档到手时由
        //   settingsDebugDrainDeferred 把这笔并进文档与 journal，文档始终答不上时退旧键快照，也不丢。
        if (viewFlagState.status === 'idle') {
          viewFlagState.deferred[settingsDebugJournalKeyOf('enabled')] = { section: 'debug', name: 'enabled', value: on, key: settingsDebugJournalKeyOf('enabled') }
          viewFlagState.deferred[settingsDebugJournalKeyOf('sampleRate')] = { section: 'debug', name: 'sampleRate', value: rate, key: settingsDebugJournalKeyOf('sampleRate') }
          settingsViewLoad()
          return false
        }
        if (viewFlagState.status === 'loading') {
          // 文档还在路上：先记下这两笔，等它落地再并进文档（此刻若走旧路写文件，文档一到手就会拿文件里
          //   的旧值把「刚拨的这一下」顶掉，用户会看见自己刚拨开的开关又弹回去）。
          viewFlagState.deferred[settingsDebugJournalKeyOf('enabled')] = { section: 'debug', name: 'enabled', value: on, key: settingsDebugJournalKeyOf('enabled') }
          viewFlagState.deferred[settingsDebugJournalKeyOf('sampleRate')] = { section: 'debug', name: 'sampleRate', value: rate, key: settingsDebugJournalKeyOf('sampleRate') }
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
    // 用户在设置页拨开关走这一个（views/SettingsPage.js 的 toggleDbg）。返回形状与包里的 setLogSwitch 一致
    //   （{ ok, enabled, sampleRate, error? }），界面那段 .then 一个字都不用改。
    //   文件这条路接得下：真源当场就定了 —— 改内存、写旧键快照、广播、推宿主副本，宿主失败也回 ok: true。
    //   接不下：原样调包里的 setLogSwitch（老路：宿主是真源，错误码与分类一字不改），返回原样交给界面。
    export const settingsDebugToggle = function (enabled, sampleRate) {
      let took = false
      try { took = settingsDebugSet(enabled, sampleRate) === true } catch (e) { took = false }
      if (took) {
        const next = settingsDebugApplyTruth(enabled, sampleRate)
        return Promise.resolve({ ok: true, enabled: next.enabled, sampleRate: next.sampleRate })
      }
      try {
        if (typeof setLogSwitch === 'function') return setLogSwitch(enabled, sampleRate)
      } catch (e2) { settingsDebugHostFailLog(settingsDebugThrowKind(e2), (e2 && e2.message) || e2) }
      // 连包里的老路都不在（不该发生：这一份是同一个产物里的名字）：回一个与老路同类形的失败，不静默。
      settingsDebugHostFailLog('host-unavailable', 'set-switch-missing')
      try { return Promise.resolve({ ok: false, enabled: logSwitch.enabled, error: 'host-unavailable' }) } catch (e3) { return Promise.resolve({ ok: false, enabled: false, error: 'host-unavailable' }) }
    }
    // 队列里还压着用户刚拨的那一笔时，采纳这一步什么都不做：用户这一下发生在文件读回来之后、落盘之前，
    //   文件里那份还是旧值；照文件覆盖内存会让用户看见自己刚拨的开关又弹回去。此刻内存、旧键快照、宿主
    //   副本都已经在拨的那一下落好了，落盘那一趟会把这笔写进文件（同一个队列）。
    const settingsDebugHasPending = function () {
      try {
        const groups = [viewFlagState.journal, viewFlagState.deferred]
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
    // 文档到手（或判定问不到）时定真值，并把它落到内存、旧键快照、界面与宿主副本上。只做一次。
    //   三条分支与采样率的取法见文件头那两段；②③ 两条要把真值排队写进文件（调用 settingsDebugSet）。
    export const settingsDebugAdoptFromDoc = function () {
      try {
        if (debugAdopted) return
        debugAdopted = true
        if (settingsDebugHasPending()) return
        // 问回来的那一份不像设置文档（老宿主、占位电话答上来的东西）：没有文件这一份真源可采，保持原样。
        //   这里绝不许照着它改内存或推宿主副本 —— 采纳的每一个分支都要以「文件里那一份」为据。
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
          // 文件里没有这一节：用升级前那份证据（分支②）。旧键见过，或证据说是开，都算一份用户的选择，
          //   要排队写进文件；两样都没有就不写（用户从没碰过这个开关，不给文件添一笔默认值）。
          truthOn = evidenceOn
          queueWrite = settingsDebugLegacy.seen === true || evidenceOn
        }
        const truthRate = (inDoc === true && rateInDoc !== null) ? rateInDoc : settingsDebugEvidenceRate()
        if (queueWrite) settingsDebugSet(truthOn, truthRate)
        settingsDebugApplyTruth(truthOn, truthRate)
      } catch (e) {}
    }
    // 文档到手（或判定问不到）时，把还在路上的 debug 那两笔接上：能进文档就进待写队列，进不去就走旧键兜底。
    //   由 kernel/settings-view.js 的 viewFlagSettle 在清空 deferred 那一趟里按 section 分派过来；返回 true
    //   表示这一笔已经处理完（调用方不必再按工作区那条路处理它，那条路会拿 undefined 当工作区根）。
    export const settingsDebugDrainDeferred = function (d, status) {
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
    // 初始化一件事（与 kernel/settings-ui.js、settings-templates.js 末尾同例）：把「文件到手就把文件那一份
    //   定成真值」登记上去（文档早已到手时它会立刻调一次）。
    try { viewFlagSubscribe(settingsDebugAdoptFromDoc) } catch (e0) {}
