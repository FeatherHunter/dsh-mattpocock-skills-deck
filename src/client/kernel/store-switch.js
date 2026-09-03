/**
 * src/client/kernel/store-switch.js — 内核模块（#455 由 store.js 拆出之后端颜色与切换确认全家）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const labelOf = function (backendId) {
      if (backendId == null) return 'Other'
      try {
        const ms = (typeof shared !== 'undefined' && shared && Array.isArray(shared.backendModules)) ? shared.backendModules : null
        if (ms) { for (let _i = 0; _i < ms.length; _i++) { const m = ms[_i]; if (m && m.id === backendId && m.label) return m.label } }
      } catch (_e) {}
      const b = builtinLabelOf(backendId)
      return b || String(backendId)
    }
    // 契约：后端是颜色的单一真源（presentation.color 单值），UI 只做 light-dark 与透明度派生
    export const presentationById = {}
    export const setPresentationMap = function (mods) {
      if (!Array.isArray(mods)) return
      mods.forEach(function (m) {
        if (m && m.id && m.presentation && m.presentation.color) {
          presentationById[m.id] = m.presentation
        }
      })
    }
    // #191：toAdaptive(light, dark) —— dark 缺省按主色勾 oklCH 75% 白派生（机制，非硬编码）
    const toAdaptive = function (light, dark) {
      const l = String(light || '').trim()
      if (!l) return 'light-dark(#57606a, #8b949e)'
      if (l.includes('light-dark')) return l
      const d = String(dark || '').trim()
      if (d.includes('light-dark')) return d
      return 'light-dark(' + l + ', ' + (d || ('color-mix(in oklch, ' + l + ' 75%, white)')) + ')'
    }
    const bgFor = function (adaptiveColor) {
      // 从 adaptive 中取 light 部分派生 bg（12% / 14%），若后端已显式给 bg 则直接用
      // 简化：用 color-mix 派生，保持与 light-dark 同步
      return 'light-dark(color-mix(in srgb, ' + adaptiveColor.replace(/light-dark\(([^,]+),.*\)/, '$1') + ' 12%, transparent), color-mix(in srgb, ' + adaptiveColor.replace(/.*,\s*([^\)]+)\)/, '$1') + ' 14%, transparent))'
    }
    // #191：品牌色纯机制派生——后端经协议层提供 presentation.color（单一真源），
    //   UI 仅做 light-dark 与透明度派生，禁止任何品牌色硬编码（含 github/markdown/gitlab 特判）。
    //   后端未提供品牌色时统一用中性灰（机制兜底，非品牌特判）。
    export const backendColorOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.color) return toAdaptive(p.color, p.darkColor)
      return toAdaptive('') // 中性灰兜底
    }
    export const backendBgOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.bg) return p.bg
      const ad = toAdaptive(p && p.color ? p.color : '', p && p.darkColor ? p.darkColor : '')
      const light = ad.replace(/light-dark\(([^,]+),.*\)/, '$1')
      const dark = ad.replace(/.*,\s*([^\)]+)\)/, '$1')
      return 'light-dark(color-mix(in srgb, ' + light + ' 12%, transparent), color-mix(in srgb, ' + dark + ' 14%, transparent))'
    }
    export const backendBorderOf = function (backendId) {
      const p = presentationById[backendId]
      if (p && p.border) return p.border
      const ad = toAdaptive(p && p.color ? p.color : '', p && p.darkColor ? p.darkColor : '')
      const light = ad.replace(/light-dark\(([^,]+),.*\)/, '$1')
      const dark = ad.replace(/.*,\s*([^\)]+)\)/, '$1')
      return 'light-dark(color-mix(in srgb, ' + light + ' 30%, transparent), color-mix(in srgb, ' + dark + ' 35%, transparent))'
    }
    export const repoShortName = function (repoRef) {
      if (!repoRef || !repoRef.name) return ''
      const n = String(repoRef.name)
      const parts = n.split(/[\\/]/)
      return parts[parts.length-1] || n
    }
    // #189 · 切换三选一确认态（全局 per-store，复用 wf.bind + 三缓存失效）
    export const DEFAULT_SWITCH_PROMPT_ZH = '现有 issues 保留在原后端，切换后不可见，切回可见'
    // #191 · targetId=null 进入"目标待选"态（仓库名右侧按钮直弹 Modal，target 由 Modal 内 radio 选）
    export const openSwitchConfirm = function (st, targetId) {
      const cur = st.selection ? st.selection.backendId : null
      if (cur == null) return false
      if (targetId != null && cur === targetId) return false
      st.switchConfirm = {
        open: true,
        curBackendId: cur,
        targetBackendId: targetId == null ? null : targetId,
        prompt: DEFAULT_SWITCH_PROMPT_ZH,
        // #191（用户反馈）：打开时不默认选中任何三选一（option=null），
        //   用户选 keep/migrate/clear 任一才可点确认。isTargetPending 已阻断 target 未选。
        option: null,
        clearInput: '',
        criChecks: null,
        criLoading: true,
        confirming: false,
      }
      emit(st)
      if (typeof loadSwitchCri === 'function') loadSwitchCri(st)
      return true
    }
    export const closeSwitchConfirm = function (st) {
      if (!st.switchConfirm) return
      st.switchConfirm.open = false
      emit(st)
      const sc = st.switchConfirm
      setTimeout(function () { if (st.switchConfirm === sc) { st.switchConfirm = null; emit(st) } }, 220)
    }
    export const loadSwitchCri = function (st) {
      const sc = st.switchConfirm
      if (!sc) return
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        sc.criLoading = false; sc.criChecks = { allOk: false, c1: null, c4: null, c5: null }; emit(st); return
      }
      // #284：CRI 迁移到链快照（wf.chain 全链步骤一步取齐）
      host.call('wf.chain', { cwd: st.cwd || '' }).then(function (res) {
        if (!st.switchConfirm) return
        const snap = (res && (res.fullSnapshot || res.snapshot)) || null
        const steps = (snap && Array.isArray(snap.steps)) ? snap.steps : []
        const byId = function (id) { return steps.find(function (s) { return String(s.id) === String(id) }) || null }
        const c1 = byId('gh:remote')
        const c4 = byId('gh:installed')
        const c5 = byId('gh:authed')
        const ok = function (x) { return !!(x && x.status === 'done') }
        const allOk = ok(c1) && ok(c4) && ok(c5)
        st.switchConfirm.criChecks = { c1: c1, c4: c4, c5: c5, allOk: allOk }
        st.switchConfirm.criLoading = false
        emit(st)
      }).catch(function () {
        if (!st.switchConfirm) return
        st.switchConfirm.criLoading = false
        st.switchConfirm.criChecks = { allOk: false, c1: null, c4: null, c5: null }
        emit(st)
      })
    }
    export const confirmSwitchConfirm = function (st) {
      const sc = st.switchConfirm
      if (!sc || sc.confirming) return
      // #191：目标待选态时 Modal 内未选 target，确认按钮禁用（与 isTargetPending 共用阻断语义）
      if (sc.targetBackendId == null) return
      if (sc.option === 'migrate' && sc.criChecks && !sc.criChecks.allOk) return
      if (sc.option === 'clear' && sc.clearInput !== '确认清空') return
      sc.confirming = true; emit(st)
      const targetId = sc.targetBackendId
      const prevSel = st.selection
      const repoRef = st.repository || (st.snapshot && st.snapshot.repository) || null
      const optimistic = { backendId: targetId, source: 'explicit', ref: repoRef }
      st.selection = optimistic
      try { if (st.cwd) setCachedSelection(st.cwd, optimistic) } catch {}
      emit(st)
      const doFail = function (msg) {
        st.selection = prevSel
        try { if (st.cwd) setCachedSelection(st.cwd, prevSel) } catch {}
        sc.confirming = false; emit(st)
        try { flash(st, tr('switch.bindFail', { err: String(msg).slice(0, 120) }), 'warn') } catch {}
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { doFail('host.call 不可用'); return }
      host.call('wf.bind', { cwd: st.cwd || '', backendId: targetId }).then(function (res) {
        const ok = res && (res.ok === true || (res.value && res.value.ok === true) || res.ok)
        if (!ok) { doFail((res && (res.error || res.message)) || 'unknown'); return }
        try { flash(st, tr('switch.bindOk', { label: (typeof labelOf === 'function' ? labelOf(targetId) : String(targetId)) }), 'ok') } catch {}
        // #191（用户反馈修正）：切换后端的本质 = 按新后端初始化，注入 setupRun prompt（与横幅 setup 按钮同源）
        //   让 AI 加载 /setup-matt-pocock-skills 技能；#230（D10）：占位符改由后端描述数据（setupPrompt 键入 locale）填充，UI 不拼装
        try {
          if (typeof setupRunPrompt === 'function') {
            const p = setupRunPrompt(st, targetId)
            if (p && typeof inject === 'function') inject(st, p)
          }
        } catch {}
        closeSwitchConfirm(st)
        try {
          if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true)
          if (typeof loadChain === 'function') loadChain(st, true)
        } catch {}
      }).catch(function (e) { doFail(e && e.message || e) })
    }
    // 方案3（2026-08-28 拍板）：清除后端选择 —— 删除主锚/想重新走选择流程时的逃生舱。
    //   wf.bind(null) = 显式无后端（registry 契约：byHandle 记 null，select ① 回 explicit null），
    //   客户端经 mergeSelection 的 explicit-null 分支覆盖（S6），此后 gate「还没有设置」重新引导。
    export const clearBackendBinding = function (st) {
      if (!st || !st.cwd) return false
      const prev = st.selection
      const nxt = { backendId: null, source: 'explicit' }
      st.selection = nxt
      try { if (st.cwd) setCachedSelection(st.cwd, nxt) } catch {}
      try { if (typeof closeSwitchConfirm === 'function') closeSwitchConfirm(st) } catch {}
      emit(st)
      if (typeof host === 'undefined' || typeof host.call !== 'function') { try { flash(st, tr('switch.bindFail', { err: 'host.call 不可用' }), 'warn') } catch {}; return true }
      host.call('wf.bind', { cwd: st.cwd || '', backendId: null }).then(function (res) {
        const ok = res && (res.ok === true || (res.value && res.value.ok === true) || res.ok)
        if (ok) { try { flash(st, tr('switch.clearBindOk'), 'ok') } catch {} }
        else {
          st.selection = prev
          try { if (st.cwd) setCachedSelection(st.cwd, prev) } catch {}
          emit(st)
          try { flash(st, tr('switch.bindFail', { err: String((res && (res.error || res.message)) || 'unknown') }), 'warn') } catch {}
        }
        try { if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true) } catch {}
        try { if (typeof loadChain === 'function') loadChain(st, true) } catch {}
      }).catch(function (e) {
        st.selection = prev
        try { if (st.cwd) setCachedSelection(st.cwd, prev) } catch {}
        emit(st)
        try { flash(st, '清除失败:' + String((e && e.message) || e).slice(0, 120), 'warn') } catch {}
      })
      return true
    }