/**
 * src/client/kernel/api-handoff.ts — 内核模块（#1251 由 api-new-session.ts 拆出之交接执行）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.ts/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 *
 * 为什么从 api-new-session.ts 拆出来（#1251）：那份文件转成 TypeScript 之后有效行超过
 * 350 行的文件粒度上限，而它里面装着两件互不相干的事——「交接执行」（生成与探测交接文档、
 * 在开新会话之前先把交接文档路径递过去）与「新会话创建」（openTextInNewSession 那条主链路）。
 * 照 #636 拆 api-workspace.ts 的同一口径，把交接执行整块搬到这里；两边的导出名与调用点一个不动。
 *
 * 约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；
 * 不许 export default；只写可剥离类型。
 */
// 从中央时间参数目录真引用（与转写前的 .js 一致）：构建拼接时 stripTimeConfigRefs 会删掉这一行、
// 名字由闭包里的 timeConfig 片提供；门禁直接 import 本模块时它是真引用。这一族只被交接执行用到，
// 所以这条 import 跟着搬过来（#1251）。
import { CLIENT_SESSION_TICK_MS, CLIENT_HANDOFF_DELAY_MS } from '../../shared/time-config/values.js'
declare const wsKeyOf: any;
declare const keyOf: any;
declare const emit: any;
declare const host: any;
declare const timeStampStr: any;
declare const handoffPrompt: any;
declare const inject: any;
declare const flash: any;
declare const tr: any;
declare const timer: any;
declare const copyText: any;
declare const ctx: any;
declare const storeOf: any;
declare const buildCreateOpts: any;
declare const createPTCSession: any;
// 拆开之后这里少了一个同文件里就有的名字：交接开新会话那条路要调用「新会话创建」那一族，
// 而它住在兄弟片段 api-new-session.ts 里。两个片段拼进同一个闭包，运行时是同一个作用域里的
// 绑定，所以照别的跨片段名字一样声明成 ambient 即可；调用点本来就有 typeof 守卫。
declare const openTextInNewSession: any;
declare const handoffReadText: any;
    // #787 交接目录校验：记下那一刻的目录与当前目录是否同属一个工作区。
    //   比的是归一后的工作区键（宿主锚到工作区根那一步优先，拿不到就退回会话侧归一，最后比原文）；
    //   任一为空直接判不同（fail-closed）。typeof 守卫保证缺谁都不抛。
    const handoffCwdMatches = function (recorded: any, current: any) {
      try {
        if (!recorded || !current) return false
        if (typeof wsKeyOf === 'function') {
          const a = wsKeyOf(recorded)
          const b = wsKeyOf(current)
          if (a && b) return a === b
        }
        if (typeof keyOf === 'function') {
          const a = keyOf(recorded)
          const b = keyOf(current)
          if (a && b) return a === b
        }
        return String(recorded) === String(current)
      } catch (e) { return false }
    }
    export const probeHandoffReady = function (st: any) {
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const done = function (file: any) {
        const ready = !!file
        // #787：找到文件即把当时目录一起记下（刷新后走最新也一样），下次读时校验；
        //   只记当前非空目录，空目录不覆盖旧值（水合到达前不污染记忆）。
        if (ready) { st.handoffFile = file; if (st.cwd) st.handoffCwd = st.cwd }
        if (st.handoffReady !== ready) { st.handoffReady = ready; emit(st) }  // 状态变了才重渲染（长轮询免重复绘）
        return file
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { done(null); return Promise.resolve(null) }
      // #787 会话隔离 + fail-closed：记忆只属于记下它的那个会话与那个目录。
      //   本会话没记过，或记下时的目录与当前目录已不是同一工作区，一律视为无记忆
      //   —— 灰加引导，绝不拿当前目录的最新来顶。
      const handoffMemoryValid = function () { return !!(st.handoffTs || st.handoffFile) && handoffCwdMatches(st.handoffCwd, st.cwd) }
      // 主路径：本会话已发现真实文件名 → 直接返回（prompt 与第一击 {ts}-*.md 一致）
      if (st.handoffFile) {
        if (!handoffMemoryValid()) { done(null); return Promise.resolve(null) }
        return Promise.resolve(done(st.handoffFile))
      }
      // 副路径 A：本会话刚点过第一击 → 按本会话 {ts}-*.md 前缀匹配真实文件名（含 AI 短标题）
      if (st.handoffTs) {
        if (!handoffMemoryValid()) { done(null); return Promise.resolve(null) }
        return host.call('wf.handoffResolve', Object.assign({ name: st.handoffTs + '*' }, cwdArg)).then(function (res: any) {
          if (res && res.ok && res.file) return done(res.file)
          // 前缀未命中 → 回退取最新，但仅当最新文件名确实以本会话时间戳开头才引用（避免引用无关的旧文档）
          return host.call('wf.handoffLatest', cwdArg).then(function (r2: any) {
            const f = (r2 && r2.ok && r2.file) ? r2.file : null
            return done((f && f.indexOf(st.handoffTs) === 0) ? f : null)
          }).catch(function () { return done(null) })
        }).catch(function () { return done(null) })
      }
      // 副路径 B：刷新后 / 从未点第一击 → 走 wf.handoffLatest 探磁盘最新
      return host.call('wf.handoffLatest', cwdArg).then(function (res: any) {
        return done((res && res.ok && res.file) ? res.file : null)
      }).catch(function () { return done(null) })
    }
    export const doHandoff = function (st: any) {
      st.handoffTs = timeStampStr()
      const text = handoffPrompt(st.handoffTs)
      st.handoffFile = null  // 真实文件名由探测按 {ts}-*.md 前缀发现（含 AI 短标题），不再从模板解析
      st.handoffCwd = st.cwd || ''  // #787：记下那一刻的目录，读时校验，跨目录不串
      inject(st, text)
      flash(st, tr('toast.injectedHandoff'), 'ok')
      // 轮询探测：AI 写成文档后右半亮蓝（真实文件名 = {ts}-<短标题>.md，按前缀匹配）；1s 间隔、~10min 窗口覆盖复杂文档
      probeHandoffReady(st)
      let tries = 0
      // 交接文档轮询的节拍：点完「交接」之后每隔这么久就去磁盘看一眼，AI 是不是把交接文档写出来了。
      //   一篇复杂文档要写上好几分钟，所以是「隔一会儿看一次」，不是等一次就完。
      // 数值写在 config/intervals.yaml 的 clientSessionTickMs，由 tests/verify-time-config.ts 看守，
      // 本文件顶部 import 真引用；构建拼闭包时剥掉那一行 import，名字由闭包里的时间片段提供。本层不留回落。
      const tick = function () {
        if (st.handoffFile) return  // 本会话已发现真实文件名 → 停本会话轮询（不影响别的会话）
        if (++tries > 600) return  // 上限 ~10min（5min+ 复杂文档也覆盖）
        probeHandoffReady(st)
        if (timer !== undefined) timer.timeout(tick, CLIENT_SESSION_TICK_MS)
      }
      if (timer !== undefined) timer.timeout(tick, CLIENT_SESSION_TICK_MS)
    }
    export const doHandoffOpen = function (st: any) {
      const now = Date.now()
      if (now - st._lastHandoffOpenTs < 800) return  // #787：防抖计时住会话自己身上；800ms 内本会话重复点击忽略，不影响别的会话
      st._lastHandoffOpenTs = now
      st.handoffSearching = true; emit(st)  // 搜索动画：右半转圈
      const doneSearch = function () { st.handoffSearching = false; emit(st) }  // 2s 后恢复，避免闪烁
      const finish = function (file: any, msg: any) {
        const text = handoffReadText(file, st.cwd)
        // 复制到剪贴板仍保留，便于粘贴；主路径经统一单点工厂开新 PTC 会话并原子化写入目标会话自己的首条草稿
        try { copyText(st, text, msg || tr('toast.copiedHandoff')) } catch (e) {}
        const handoffTitle = (function(){ try{ var base = (typeof tr==='function'? tr('nav.handoff') : 'Handoff'); return '[New] ' + base; }catch(e){ return '[New] Handoff' } })()
        if (typeof openTextInNewSession === 'function') {
          openTextInNewSession(st, text, handoffTitle)
        } else {
          // 兜底：无工厂时仍尝试 sessions.create 显式 ptc
          try {
            const sessions = ctx.get('sessions')
            const cwd = st.cwd || ''
            if (sessions && typeof sessions.create === 'function') {
              const createOpts = (typeof buildCreateOpts === 'function') ? buildCreateOpts(null, cwd) : { cwd: cwd, agentPreset: 'ptc' }
              const p = (typeof createPTCSession === 'function') ? createPTCSession(sessions, null, cwd, text) : sessions.create(createOpts).then(function(sid: any){ try { if (sid) storeOf(sid).incomingDraft = text } catch (eDraft) { try { inject(st, text) } catch (e2) {} } return sid })
              p.then(function(sid: any){ try{ sessions.open(sid) }catch(e){} }).catch(function(){ try{ inject(st,text) }catch(e2){} })
            } else { inject(st, text) }
          } catch(e3){ try{ inject(st,text)}catch(e4){} }
        }
        // 收尾的等待时间：找到交接文档、新会话也开起来之后，右半那颗转圈还要再转这么久才停下 ——
        //   这段是留给眼睛的，让人看见「已经切到新会话了」，不至于一点交代都没有就跳走。
        // 数值写在 config/intervals.yaml 的 clientHandoffDelayMs，由 tests/verify-time-config.ts 看守，
        // 本文件顶部 import 真引用；与上面同一个道理。本层不留回落。
        setTimeout(doneSearch, CLIENT_HANDOFF_DELAY_MS)  // 至少转 2s
      }
      // 引导门 v3（2026-08-18 rev）：无论本会话是否点过第一击，一律先探测磁盘真实文档——
      //   有 latest → 置 ready + 放行开新会话；没有 → toast 引导「请先点「交接」生成交接文档」，绝不打开空会话
      probeHandoffReady(st).then(function (file: any) {
        if (file) finish(file, tr('toast.copiedHandoffFile', { file: file }))
        // 没找到交接文档、只弹了一句提醒的那一趟，转圈也按上面同一个等待时间收尾（两处共用一个常量，改一处两边一起变）。
        else { flash(st, tr('toast.handoffGrey'), 'warn'); setTimeout(doneSearch, CLIENT_HANDOFF_DELAY_MS) }
      })
    }
