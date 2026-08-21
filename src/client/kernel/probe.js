/**
 * src/client/kernel/probe.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const CHECKS_TOTAL = 9   // v1.5 T11 起 9 项检测（含核心技能套件）
    export const loadChecks = (st, force, silent) => {
      if (st.checking) return Promise.resolve()
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        st.checksMode = 'err'
        st.checksError = tr('err.hostUnavailable')
        emit(st)
        return Promise.resolve()
      }
      st.checking = true
      // v1.5 T10 R7：silent（手动刷新走静默路径）不切 loading 态
      if (force && !silent) st.checksMode = 'loading'
      emit(st)
      const args = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, force ? { force: true } : {}, { lang: promptLang() })
      return host.call('wf.status', args).then(function (res) {
        st.checking = false
        if (res && res.checks && res.checks.length) {
          st.checks = res.checks
          st.checksUpdatedAt = nowStr()
          st.checksMode = 'real'
          st.checksError = null
        } else {
          st.checksMode = 'err'
          st.checksError = (res && res.error) ? String(res.error).slice(0, 160) : tr('err.statusEmpty')
        }
        emit(st)
      }).catch(function (e) {
        st.checking = false
        st.checksMode = 'err'
        st.checksError = String((e && e.message) || e).slice(0, 160)
        emit(st)
      })
    }
    export const activeChecks = (st) => (st.checksMode === 'real' && st.checks && st.checks.length) ? st.checks : []
    export const readyCount = (st) => { const cs = activeChecks(st); return cs.length ? cs.filter(function (c) { return c.level === 'ok' }).length : -1 }
    // v14-22：返回纯数字串（'6/9' / '--/9'），由状态栏 num() 固定宽度渲染；分母 = 实际检查项数（动态，不再硬编码）
    export const envTotal = (st) => { const cs = activeChecks(st); return cs.length || CHECKS_TOTAL }
    export const envLabel = (st) => { const n = readyCount(st); const t = envTotal(st); return n < 0 ? '--/' + t : n + '/' + t }
    export const setupCheck = (st) => (st.checks || []).find(function (c) { return c.id === 2 })

    // #370：blockerNames 只列「仍 OPEN」的阻塞者（GitHub 依赖边在阻塞者关闭后仍保留，需按状态过滤）
    export const openBlockers = (t, m) => t.blockedBy.filter(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt !== undefined && bt.state === 'OPEN'
    })
    export const blockerNames = (t, m) => openBlockers(t, m).map(function (b) {
      const bt = m.tickets.find(function (x) { return x.number === b })
      return bt ? bt.title : ('#' + b)
    }).join('；')

    // v10：从会话快照探测当前工作目录（ConversationSnapshot 字段名多探几个）
    export const detectCwd = function (ss) {
      try {
        if (ss && typeof ss === 'object') {
          for (const k of ['cwd', 'workspacePath', 'projectPath', 'path', 'dir', 'root']) {
            if (typeof ss[k] === 'string' && ss[k]) return ss[k]
          }
        }
      } catch (e) { /* 探测失败走 host 默认 */ }
      return ''
    }
    // v11：label 用 GitHub 配置色渲染 —— hex → rgba（.18 背景），无效 hex 返回 null 走兜底
    export const hexA = function (hex, a) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
        const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
      } catch (e) { return null }
    }
    // v14-18：hex → HSL 亮度下调 amt（0-1）→ hex（chips 边框比 label 色深一档）
    export const darken = function (hex, amt) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
        const r = parseInt(hh.slice(0, 2), 16) / 255, g = parseInt(hh.slice(2, 4), 16) / 255, b = parseInt(hh.slice(4, 6), 16) / 255
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
        const l = (mx + mn) / 2
        let hue = 0, sat = 0
        if (mx !== mn) {
          const d = mx - mn
          sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
          if (mx === r) hue = ((g - b) / d + (g < b ? 6 : 0))
          else if (mx === g) hue = ((b - r) / d + 2)
          else hue = ((r - g) / d + 4)
          hue *= 60
        }
        const l2 = Math.max(0, l - amt)
        const hue2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }
        const q2 = l2 < 0.5 ? l2 * (1 + sat) : l2 + sat - l2 * sat
        const p2 = 2 * l2 - q2
        const rr = Math.round(hue2rgb(p2, q2, hue / 360 + 1 / 3) * 255)
        const gg = Math.round(hue2rgb(p2, q2, hue / 360) * 255)
        const bb = Math.round(hue2rgb(p2, q2, hue / 360 - 1 / 3) * 255)
        return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1)
      } catch (e) { return null }
    }

    // ============================================================
    // 4. 文本生成 + 复制/注入
    // ============================================================
    export const nowStr = () => {
      try { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (e) { return '' }
    }
    // 定稿 1A：时间固定格式 MM-DD HH:MM（本地）
    export const timeOf = (snap) => {
      if (!snap) return ''
      try {
        const ms = (typeof snap.generatedMs === 'number' && snap.generatedMs) || Date.parse(snap.updatedAt || '')
        if (!ms) return ''
        const d = new Date(ms)
        return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
      } catch (e) { return '' }
    }
    // ============================================================
    // 4. 配置广播（v25-50：配置保存后同步所有会话 store 的面板尺寸；外观定死不广播）
    // ============================================================
    export const broadcastCfg = function () {
      const applyTo = function (st) {
        if (!st) return
        st.size = { w: st.size ? st.size.w : 460, h: Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) }
        emit(st)
      }
      applyTo(shared)
      Object.keys(stores).forEach(function (k) { applyTo(stores[k]) })
    }

    // v1.5 T10 R4（用户拍板）：数据层增量 diff —— 变更/新增/删除 按票号对比（含 map 子票级变化），
    //   多视图（列表/map详情/状态栏计数/过滤结果）数据驱动自动增量；diff 结果供 R5 视觉消费
    export const diffSnapshots = function (oldS, newS) {
      const out = { added: [], removed: [], changed: [], issueFlash: {}, ts: Date.now() }
      if (!oldS || !oldS.ok || !Array.isArray(oldS.maps)) return out
      if (!newS || !newS.ok || !Array.isArray(newS.maps)) return out
      const lbl = function (x) { return (x.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name }).sort().join(',') }
      const idx = function (snap) { const m = {}; snap.maps.forEach(function (x) { m[x.number] = x }); return m }
      const a = idx(oldS), b = idx(newS)
      // 子票级变化：逐票对比（新增/变更标 issueFlash；任一变化 → 该 map 计入 changed，map 详情视图增量）
      //   字段实证（#458 核验）：map 子票在快照里是 tickets（非 issues）；票级变化 = state/progress/claimedBy/labels
      Object.keys(b).forEach(function (n) {
        if (!a[n]) { out.added.push(Number(n)); return }
        var x = a[n], y = b[n]
        var sub = false
        var ix = {}; (x.tickets || []).forEach(function (i) { ix[i.number] = i })
        var iy = {}; (y.tickets || []).forEach(function (i) { iy[i.number] = i })
        Object.keys(iy).forEach(function (k) {
          if (!ix[k]) { sub = true; out.issueFlash[Number(k)] = 'added'; return }
          var a2 = ix[k], b2 = iy[k]
          if (a2.state !== b2.state || a2.progress !== b2.progress || a2.claimedBy !== b2.claimedBy || lbl(a2) !== lbl(b2)) { sub = true; out.issueFlash[Number(k)] = 'changed' }
        })
        if (Object.keys(ix).length !== Object.keys(iy).length) sub = true
        if (x.state !== y.state || x.title !== y.title || lbl(x) !== lbl(y) || sub) out.changed.push(Number(n))
      })
      Object.keys(a).forEach(function (n) { if (!b[n]) out.removed.push(Number(n)) })
      return out
    }
    // R5：高亮定时清除（防堆积；一次只排一个 timer）
    export let _flashClearPending = false
    export const scheduleFlashClear = function (st) {
      if (_flashClearPending) return
      _flashClearPending = true
      if (timer === undefined) { _flashClearPending = false; return }
      timer.timeout(function () {
        _flashClearPending = false
        st.rowFlash = {}
        st.issueFlash = {}
        emit(st)
      }, 2600)
    }
    // 快照（#346：面板数据源；force 走 wf.refresh 全量重建；wf.snapshot 侧 5s 缓存）
    // #58 缓存优先：按 cwd 内存快照 + 空 cwd 同步，避免首开空 cwd 探路 miss 缓存导致 100-400ms 闪 loading
    export const loadSnapshot = function (st, force, silent) {
      const doLoad = function () {
        // #370 次要观察：force 刷新时跳过 snapLoading 守卫（加载中点击「刷新」不再 no-op）
        if (st.snapLoading && !force) return Promise.resolve()
        if (typeof host === 'undefined' || typeof host.call !== 'function') {
          st.snapMode = 'err'
          st.snapError = tr('err.hostUnavailable')
          emit(st)
          return Promise.resolve()
        }
        // #58 先水合 per-cwd 缓存，实现秒开
        hydrateFromCache(st)
        const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
        st.snapLoading = true
        // v1.5 T9：silent（后台静默刷新）不显示加载遮罩、不弹错误 toast
        // #58 缓存优先：已有缓存时不显示全屏 loading，静默刷新
        if (force && !silent && !hasCache) st.snapMode = 'loading'
        emit(st)
        const args = st.cwd ? { cwd: st.cwd } : {}
        const p = force ? host.call('wf.refresh', args) : host.call('wf.snapshot', args)
        return p.then(function (snap) {
          st.snapLoading = false
          if (snap && snap.ok === true && Array.isArray(snap.maps)) {
            // v1.5 T10 R4：数据层增量 diff（新旧快照对比）—— 供多视图增量与 R5 视觉
            st.lastDiff = diffSnapshots(st.snapshot, snap)
            st.rowFlash = {}
            st.issueFlash = {}
            var _df = st.lastDiff
            _df.added.forEach(function (n) { st.rowFlash[n] = 'added' })
            _df.changed.forEach(function (n) { st.rowFlash[n] = 'changed' })
            if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k) { st.issueFlash[Number(k)] = _df.issueFlash[k] })
            // R5 视觉：有变化才提示 + 定时清除高亮（防堆积）
            if (_df.removed.length) flash(st, tr('panel.diffRemoved', { n: _df.removed.length }), 'info')
            scheduleFlashClear(st)
            st.snapshot = snap
            st.snapMode = 'real'
            st.snapError = null
            // #58 缓存优先：落 per-cwd 内存表，供新 store 秒开
            try { const c = snap.repoRoot || st.cwd; if (c) setCachedSnapshot(c, snap) } catch (e) { /* 忽略 */ }
            try { if (st.cwd) setCachedSnapshot(st.cwd, snap) } catch (e) { /* 忽略 */ }
            // v1.5 T10：启动自动变化探测（幂等；快照就绪后生效）
            startAutoProbe()
            // v1.5 B5 修订：磁盘缓存秒开（fromCache）→ 不再 400ms 强制全量刷新。
            //   原逻辑每次打开面板 = 1 次额外 wf.refresh（aliases 大查询 ≈ 18 GraphQL 点），
            //   多仓库会话下成倍放大；变化检测已由低频 probe（5min + focus 限流）接管，
            //   磁盘缓存本身是最新全量快照，秒开直接展示即可，无需立即重建。
          } else {
            st.snapMode = 'err'
            st.snapError = (snap && snap.error) ? String(snap.error).slice(0, 160) : tr('err.snapshotEmpty')
            if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
          }
          emit(st)
        }).catch(function (e) {
          st.snapLoading = false
          st.snapMode = 'err'
          st.snapError = String((e && e.message) || e).slice(0, 160)
          if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
          emit(st)
        })
      }
      // #58 若 cwd 仍空且可同步补齐，先补 cwd 再加载，避免空 cwd miss 磁盘缓存
      if (!st.cwd) {
        const sync = getCwdSync(st.sessionId)
        if (sync) { st.cwd = sync; hydrateFromCache(st) }
      }
      if (!st.cwd && st.sessionId && typeof host !== 'undefined' && typeof host.call === 'function') {
        return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
          if (res && res.ok && res.cwd && !st.cwd) { st.cwd = res.cwd; hydrateFromCache(st); emit(st) }
          return doLoad()
        }).catch(function () { return doLoad() })
      }
      return doLoad()
    }

    // v1.5 R2（#2 MVP · 2026-08-18）：自动刷新 — probe 走 since 时间戳探测全 issue 增量
    //   （#348 + v1.5 T10 B5「配额止血 · 第一性原理」延续）：① probe 降到 60s（用户感知阈值 · R1 是 5min）；
    //   ② changed 只刷新与本次探测 cwd 相同的 store（多仓库会话并发不互串）；
    //   ③ focus 触发限流 ≥60s（窗口来回切换不再疯狂烧）。
    //   与 R1 区别：probe 范围从 `labels=wayfinder:map`（仅地图）扩到 `since=<ISO>`（全 issue，含子票）—— 见 host 侧 `case 'probe'`。
    export const PROBE_MS = 60000
    export const FOCUS_PROBE_MIN_MS = 60000
    export let lastFocusProbe = 0
    // v1.5 T10 R9（Q4 拍板 · DESIGN.md 12.2）：关键动作后延迟探测 —— 完成/执行/交接后面板尽快反映 GitHub 变化；
    //   防抖（一次只排一个）+ 探测本身 1 次轻量 REST，配额安全
    export let _actionProbePending = false
    export const probeNow = function (fromFocus) {
      if (typeof host === 'undefined' || typeof host.call !== 'function') return
      if (fromFocus) {
        const now = Date.now()
        if (now - lastFocusProbe < FOCUS_PROBE_MIN_MS) return
        lastFocusProbe = now
      }
      // #45 修复（2026-08-20）：多工作区异步回调导致右侧面板串台
      // 根因：原实现经 shared（单例）广播新快照到所有 stores（Object.keys(stores).forEach），且 shared.cwd 仅首写，
      //   导致工作区 A 的异步变更（probe changed）把 A 的快照写入 B 的 store，右侧面板“串台”显示非当前工作区内容。
      // 修复：按 cwd 分组隔离 —— 同 cwd 组内共享 1 次 GraphQL（primary load → 余下拷贝），组间零污染；
      //   兜底路径按 sessionId→cwd 精确映射赋值，避免把任意首个 cwd 错绑到所有空 store。
      const refreshGroup = function (cwd) {
        return host.call('wf.probe', { cwd: cwd }).then(function (res) {
          if (!(res && res.ok && res.changed)) return
          const group = []
          if (shared.cwd === cwd) group.push(shared)
          Object.keys(stores).forEach(function (k) {
            const st = stores[k]
            if (st.cwd === cwd) group.push(st)
          })
          if (!group.length) {
            if (typeof host !== 'undefined' && typeof host.call === 'function') {
              host.call('wf.refresh', { cwd: cwd }).catch(function () {})
            }
            return
          }
          const primary = group[0]
          if (!primary.cwd) primary.cwd = cwd
          const rest = group.slice(1)
          return loadSnapshot(primary, true, true).then(function () {
            const newSnap = primary.snapshot
            if (!newSnap || newSnap.ok !== true || !Array.isArray(newSnap.maps)) return
            rest.forEach(function (st2) {
              st2.lastDiff = diffSnapshots(st2.snapshot, newSnap)
              st2.rowFlash = {}
              st2.issueFlash = {}
              var _df = st2.lastDiff
              _df.added.forEach(function (n) { st2.rowFlash[n] = 'added' })
              _df.changed.forEach(function (n) { st2.rowFlash[n] = 'changed' })
              if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (ki) { st2.issueFlash[Number(ki)] = _df.issueFlash[ki] })
              st2.snapshot = newSnap
              st2.snapMode = 'real'
              st2.snapError = null
              scheduleFlashClear(st2)
              emit(st2)
            })
          }).catch(function () { /* 忽略 */ })
        }).catch(function () { /* 探测失败忽略 */ })
      }
      const cwds = []
      if (shared.cwd) cwds.push(shared.cwd)
      Object.keys(stores).forEach(function (k) {
        const c = stores[k] && stores[k].cwd
        if (c && cwds.indexOf(c) < 0) cwds.push(c)
      })
      if (!cwds.length) {
        const sids = []
        if (shared.sessionId) sids.push(shared.sessionId)
        Object.keys(stores).forEach(function (k) { if (stores[k].sessionId && sids.indexOf(stores[k].sessionId) < 0) sids.push(stores[k].sessionId) })
        if (!sids.length) return
        Promise.all(sids.map(function (sid) { return host.call('wf.cwd', { sessionId: sid }).catch(function () { return null }) })).then(function (results) {
          const sidToCwd = {}
          const foundCwds = []
          for (let i = 0; i < sids.length; i++) {
            const r = results[i]
            if (r && r.ok && r.cwd) {
              sidToCwd[sids[i]] = r.cwd
              if (foundCwds.indexOf(r.cwd) < 0) foundCwds.push(r.cwd)
            }
          }
          if (!foundCwds.length) return
          Object.keys(stores).forEach(function (k) {
            const st = stores[k]
            if (!st.cwd && st.sessionId && sidToCwd[st.sessionId]) {
              st.cwd = sidToCwd[st.sessionId]
              // #58 空 cwd 补齐后立即水合 per-cwd 缓存，秒开
              if (hydrateFromCache(st)) emit(st)
            }
          })
          if (!shared.cwd && foundCwds.length) {
            shared.cwd = foundCwds[0]
            if (hydrateFromCache(shared)) emit(shared)
          }
          foundCwds.forEach(function (cwd) { refreshGroup(cwd) })
        })
        return
      }
      cwds.forEach(function (cwd) { refreshGroup(cwd) })
    }
    export const scheduleActionProbe = function () {
      if (_actionProbePending) return
      _actionProbePending = true
      if (timer === undefined) { _actionProbePending = false; return }
      timer.timeout(function () {
        _actionProbePending = false
        probeNow(false)
      }, 8000)
    }
    export const startAutoProbe = function () {
      if (shared._probeTimer) return
      // v1.5 R2-fix：跨 reload 清理旧 timer（dev_reload_package 后 JS setInterval 不自动清理，
      //   多个 timer 并行触发 probe 浪费配额）
      if (typeof globalThis !== 'undefined' && globalThis.__dswsOldProbeTimer) {
        try { clearInterval(globalThis.__dswsOldProbeTimer) } catch (e) { /* 忽略 */ }
        globalThis.__dswsOldProbeTimer = null
      }
      shared._probeTimer = setInterval(function () { probeNow(false) }, PROBE_MS)
      if (typeof globalThis !== 'undefined') globalThis.__dswsOldProbeTimer = shared._probeTimer
      if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', function () { probeNow(true) })
    }

    // v1.5 T10 R7（用户拍板）：手动刷新（状态栏「更新」/ 列表「刷新」/ 检查页「重新检查」）
    //   走静默路径 —— 无全屏遮罩、不禁点；按钮 spinner 即时反馈（命令式 DOM 直操作，不等 React 重渲染）
    //   CSS 动画走合成线程：即使主线程被重渲染占用，转圈照常可见
    export const spinAll = function (on) {
      if (typeof document === 'undefined') return
      try {
        const els = document.querySelectorAll('[data-dsws-host] .dsws-rficon')
        for (let i = 0; i < els.length; i++) els[i].classList.toggle('dsws-spin', on)
      } catch (e) { /* 忽略 */ }
    }
    export const refreshAll = function (st) {
      if (st.refreshing) return
      st.refreshing = true
      // 先发 RPC（异步即返回），再触发渲染 —— 避免重渲染挡住数据请求
      var p1 = loadChecks(st, true, true)
      var p2 = loadSnapshot(st, true, true)
      spinAll(true)
      emit(st)
      Promise.all([p1, p2]).then(function () {
        st.refreshing = false
        spinAll(false)
        emit(st)
      }).catch(function () { st.refreshing = false; spinAll(false); emit(st) })
    }

    // #376：打开面板即保证新鲜 —— 未就绪/失败 → force 加载（有「加载中」反馈）；
    //   已就绪但过期（>60s）→ 触发加载；已就绪且新鲜（≤60s）→ 直接展示不重复请求（配额友好）。
    //   force 不被 snapLoading 守卫丢弃（#370 已修），加载中打开面板最终也会完成并展示。
    export const SNAP_FRESH_MS = 60000
    export const snapFresh = function (st) {
      if (!st.snapshot || !st.snapshot.generatedMs) return false
      try { return (Date.now() - st.snapshot.generatedMs) <= SNAP_FRESH_MS } catch (e) { return false }
    }
