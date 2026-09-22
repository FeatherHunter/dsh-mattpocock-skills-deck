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
      // #529：附带当前语言与绑定后端（与 loadChain 同口径；否则英文界面下明细恒为中文）
      const criT0 = Date.now()
      const criLang = (typeof promptLang === 'function' ? promptLang() : 'zh')
      const criArgs = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, (typeof userHintOf === 'function' && userHintOf(st.selection)) ? { backendId: userHintOf(st.selection), baseRev: (typeof baseRevOf === 'function' ? baseRevOf(st.selection) : 0) } : {}, { lang: criLang })
      host.call('wf.chain', criArgs).then(function (res) {
        try { if (res && res.ok) log('info', 'host.call', { method: 'wf.chain', latencyMs: Date.now() - criT0, ok: true, kind: 'chain-cri' }); else log('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain-cri', errorHash: dswsLogHash(dswsLogTrunc(String((res && res.error) || 'chain-not-ok'), 120, 'error')) }) } catch (eL) {}
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
      }).catch(function (e) {
        try { log('warn', 'host.call.fail', { method: 'wf.chain', kind: 'chain-cri', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
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
      // #669 第 6 件（ADR 20260921）：这是**用户亲手选**的那一条 —— 盖上 userPicked 标记，此后
      //   只有带这个标记的选择才会当 hint 上报给宿主（宿主那边带 hint 就压过锚文件）。
      const optimistic = (typeof userPickSelection === 'function') ? userPickSelection(targetId, repoRef, prevSel) : { backendId: targetId, source: 'explicit', ref: repoRef, userPicked: true }
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
      // #669 第 5 件：这条跨边界电话以前一个字都不记 —— 真机上出现「点确认切换没反应」时，
      //   日志里既没有成功那一行也没有失败那一行，事后只能靠猜。补上与其它跨边界调用同形的两行
      //   （事件名沿用现成的 host.call / host.call.fail，不新增事件名）。
      const bindT0 = Date.now()
      host.call('wf.bind', { cwd: st.cwd || '', backendId: targetId }).then(function (res) {
        const ok = res && (res.ok === true || (res.value && res.value.ok === true) || res.ok)
        try {
          if (ok) log('info', 'host.call', { method: 'wf.bind', latencyMs: Date.now() - bindT0, ok: true, kind: 'switch-bind' })
          else log('warn', 'host.call.fail', { method: 'wf.bind', kind: 'switch-bind', errorHash: dswsLogHash(dswsLogTrunc(String((res && (res.error || res.message)) || 'bind-not-ok'), 120, 'error')) })
        } catch (eL) {}
        if (!ok) { doFail((res && (res.error || res.message)) || 'unknown'); return }
        // #683（F1 · ADR 20260921 的 R2）：宿主这一通接受了用户的选择之后会回一个新修订号，
        //   把它落到本地这条上 —— 此后这个壳上报的都带着它，宿主才判得出这份是不是最新那一版。
        try { if (typeof adoptBoundRev === 'function') adoptBoundRev(st, res) } catch (eRev) {}
        // #683 R7c：绑定成了、但宿主侧那份记忆没写进去（persisted:false）—— 按现成的 bindFail 那条路如实说一句。
        try { var _np=res&&(res.persisted===false||(res.value&&res.value.persisted===false)); if(_np) flash(st,tr('switch.bindFail',{err:'已切换，但宿主侧这次没能记住：下次重启或换个地址打开可能要再选一次'}),'warn') } catch (eP) {}
        // —— 切换成功之后按「这个工作区初始化过没有」分两条路（#669 第 6 件 / ADR 20260921）——
        //   判据是链上那一步 `tracker:initialized`（它的检查项就是「工作区根有没有 docs/agents/issue-tracker.md」），
        //   与状态栏横幅读的是同一份清单、同一条链快照。**链里根本没有这一步时不许猜**：那一档既不能当
        //   「没初始化」（会把初始化全文注进已经初始化过的仓库 = 让 AI 重跑 setup，正是本票要结束的那件事），
        //   也不能当「已初始化」（会往新仓库里发一条对齐指令）。做法：先强制重取一次链，拿到证据再决定。
        const _label = (typeof labelOf === 'function' ? labelOf(targetId) : String(targetId))
        const _fromLabel = (typeof labelOf === 'function' ? labelOf(sc.curBackendId) : String(sc.curBackendId || ''))
        const _mine = (typeof guideStepsFor === 'function') ? guideStepsFor(targetId) : []
        const _stepsNow = function () { return (typeof chainSteps === 'function') ? chainSteps(st) : [] }
        const _hasInitStep = function (steps) { return (Array.isArray(steps) ? steps : []).some(function (x) { return x && String(x.id) === 'tracker:initialized' }) }
        const _done = function (id) {
          try {
            const step = _mine.filter(function (x) { return x && x.id === id })[0]
            return !!(step && typeof guideStepDone === 'function' && guideStepDone(step, _stepsNow()))
          } catch (eD) { return false }
        }
        const _route = function () {
          if (_done('tracker:initialized')) {
            // 已初始化：注入「切换后对齐」那条 —— 让 AI 把仓库里记录后端的那几处改成新后端（并回读自证）。
            //   插件自己不写用户仓库的文件（Q4 既有决定），这件事交给 AI（它就是初始化那只手）。
            try {
              const _txt = (typeof promptText === 'function') ? promptText('switchAlign', { from: _fromLabel, to: _label }) : ''
              if (_txt && typeof inject === 'function') inject(st, _txt)
              // 日志点（按需 #64 inject.decision，沿用初始化那条的字段与开关纪律）：切换之后到底给出去的是什么。
              //   此前这一段没有任何轨迹，真机出现「切完没有任何指令」时只能靠猜；这里只记三个枚举，不记文案与路径。
              try { if (isEnabled('debug')) log('debug', 'inject.decision', { prompt: 'switchAlign', kind: 'align', layout: 'unset' }) } catch (eL) {}
            } catch (eInj) {}
            try { flash(st, tr('switch.bindOk', { label: _label }), 'ok') } catch (eF) {}
            return
          }
          if (!_hasInitStep(_stepsNow())) {
            // 链里连「初始化过没有」这一步都没有（还没取到链、或取链失败）：一个字都不注入，只把下一步指向状态栏
            try { flash(st, tr('switch.bindOkNotReady', { label: _label }), 'warn') } catch (eF0) {}
            return
          }
          // 还没初始化：走与黄条那颗按钮**同一个**决策器 —— 「仓库那一步过没过」这条判据在它里面（没过返回
          //   blocked：一个字不注入、也不开卡），本文件不再自己判一遍，判据只有那一份（#668 单源口径）。
          //   提示条按它这次实际给出的东西选：blocked 说「先按状态栏那条提示处理」，其余说「按提示完成初始化」
          //   （它的 'setup-card' 就是先问域文档布局那一问，答完才注入全文）。
          let _kind = 'blocked'
          try { if (typeof injectSetupDecision === 'function') _kind = injectSetupDecision(st, targetId, { allowCard: true }) } catch (eDec) {}
          try { flash(st, tr(_kind === 'blocked' ? 'switch.bindOkNotReady' : 'switch.bindOkFresh', { label: _label }), _kind === 'blocked' ? 'warn' : 'ok') } catch (eF3) {}
        }
        const _hadEvidence = _hasInitStep(_stepsNow())
        closeSwitchConfirm(st)
        let _chainP = null
        try {
          if (typeof loadSnapshot === 'function') loadSnapshot(st, true, true)
          _chainP = (typeof loadChain === 'function') ? loadChain(st, true) : null
        } catch (eLoad) {}
        // 有证据就当场决定；没有就等这次强制重取回来的链（上面那一取，同时也是状态栏要用的那一取）再决定
        if (_hadEvidence) _route()
        else if (_chainP && typeof _chainP.then === 'function') _chainP.then(_route, _route)
        else _route()
      }).catch(function (e) {
        try { log('warn', 'host.call.fail', { method: 'wf.bind', kind: 'switch-bind', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}
        doFail(e && e.message || e)
      })
    }
    // 「清除后端选择」（显式无后端 `wf.bind(null)`）2026-09-21 随 ADR 20260921 退役：
    //   它与「切换后端」那张卡表达的是两件事（那张卡问「换成哪个」，这个按钮说「我不要了」），
    //   混在一起没人读得懂；而本次定下的优先级里，「用户的手动选择」只指「切到某个后端」这一件事。
    //   要回到未选择状态，用户直接换一个别的后端即可；本函数连同调用它的那颗按钮一起删除
    //   （门禁 tests/verify-kernel.js / verify-leaves.js / verify-repo-switch-chip.js 的清单同步收）。