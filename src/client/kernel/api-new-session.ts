/**
 * src/client/kernel/api-new-session.ts — 内核模块（#457 由 api.js 拆出之新会话创建）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.ts/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 *
 * （#1251：本文件由同名 .js 转成 .ts，只补类型标注与环境声明，运行时行为一字不动；
 * 同一趟把「交接执行」那一族（probeHandoffReady / doHandoff / doHandoffOpen）搬去
 * api-handoff.ts —— 原文件有效行超 350 上限，拆法与 #636 拆 api-workspace.ts 一致。
 * 约束不变：不许加运行时 import、不许 export default、只写可剥离类型。）
 */
declare const keyOf: any;
declare const emit: any;
declare const host: any;
declare const inject: any;
declare const flash: any;
declare const tr: any;
declare const newSessionTitleNew: any;
declare const ctx: any;
declare const getCwdSync: any;
declare const resolveWorkspaceEntry: any;
declare const storeOf: any;
declare const hydrateFromCache: any;
declare const getCachedSnapshot: any;
declare const isReusableBlank: any;
declare const buildCreateOpts: any;
declare const createPTCSession: any;
declare const createVerifiedPTCSession: any;
declare const isNewPlaceholderTitle: any;
declare const parseNumberedTitle: any;
declare const namingHintOf: any;
declare const namingGuardianKick: any;
declare const log: any;
declare const dswsLogHash: any;
declare const dswsLogTrunc: any;
declare const namingCurrentTitleOf: any;
declare const withTrailingNewline: any;
declare const ensureInjectFocusAtEnd: any;
    // #361：在新会话中打开 —— 同 cwd + 自动命名 + 预填指令
    //   契约（dsh-client-runtime ISessions）：create({cwd}) → SessionId；scope(sid) → AgentContext；
    //   sessionOf(ctx) → SessionFace.rename(title)；open(sid) 切换。任一步失败降级为当前会话注入 + 提醒。
    export const openTextInNewSession = function (st: any, text: any, title: any, opts?: any) {
      // 七动作分形：首条是动作模板时，起步占位跟动作走（如 /triage → [New] 诊断），
      // 编号会话（[#n] 开头）不动，只动通用占位，保证初步名字一眼可分。
      // #746 Knife1：动作种类优先用调用方显式传的 opts.kind（行级入口下单时已知，不反推）；
      // 文本前缀推断只留作未知调用方的回退（Tabs/状态栏等直接传具体占位，本来就不进这段）。
      try {
        const t = String(text || '')
        const cur = String(title || '')
        const isGeneric = cur === '[New] 新建需求' || cur === '[New] 新建 Bug' || cur === '[New] New Requirement' || cur === '[New] New Bug'
        let actFromOpts: any = null
        try {
          const k = (opts && typeof opts.kind === 'string') ? opts.kind : null
          if (k === 'diagnose') actFromOpts = 'diagnose'
          else if (k === 'fix') actFromOpts = 'fix'
          else if (k === 'discuss') actFromOpts = 'discuss'
          else if (k === 'research') actFromOpts = 'research'
          else if (k === 'prototype') actFromOpts = 'prototype'
          else if (k === 'takeover') actFromOpts = 'handoff'
          else if (k === 'supplement') actFromOpts = 'supplement'
          else if (k === 'health') actFromOpts = 'health'
        } catch (eK) {}
        if (isGeneric && typeof newSessionTitleNew === 'function') {
          let act = actFromOpts
          if (!act) {
            if (/^\s*\/triage\b/.test(t)) act = 'diagnose'
            else if (/^\s*\/implement\b/.test(t)) act = 'fix'
            else if (/^\s*\/grill-with-docs\b/.test(t)) act = 'discuss'
            else if (/^\s*\/research\b/.test(t)) act = 'research'
            else if (/^\s*\/prototype\b/.test(t)) act = 'prototype'
            else if (/^\s*\/handoff\b/.test(t)) act = 'handoff'
            else if (t.indexOf('思维对齐') >= 0 || t.indexOf('成果沉淀') >= 0) act = 'supplement'
            else if (/^\s*##\s*体检/.test(t) || t.indexOf('把游离的开放票归位') >= 0) act = 'health'
          }
          if (act) { try { title = newSessionTitleNew(act) } catch (eA) {} }
        }
      } catch (eInfer) {}
      const sessions = ctx.get('sessions')
      const workspaces = ctx.get('workspaces')
      const doFallback = function () {
        inject(st, text)
        flash(st, tr('toast.newSessionManual', { title: title }), 'warn')
      }
      if (!sessions || typeof sessions.create !== 'function') { doFallback(); return }
      // v1.5：新会话默认继承「点击时所在会话」的工作区（st.cwd）；
      //   缺失时：1) 同步读 sessions.list（权威 cwd，避免 host 异步窗口）2) 再向 host 解析兜底
      const ensureCwd = function () {
        const sync = getCwdSync(st.sessionId)
        if (sync) {
          if (sync !== st.cwd) st.cwd = sync
          return Promise.resolve(sync)
        }
        if (st.cwd) return Promise.resolve(st.cwd)
        if (typeof host !== 'undefined' && typeof host.call === 'function' && st.sessionId) {
          return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res: any) {
            if (res && res.ok && res.cwd) { st.cwd = res.cwd; return res.cwd }
            return null
          }).catch(function () { return null })
        }
        return Promise.resolve(null)
      }
      // #60 修复：cwd → workspaceId 解析（session.create({cwd}) 不会自动归属工作区，需显式 workspaceId）
      // #364 工作区回退与首条注入保真（兼容 alpha 新参）：
      //   矩阵：cwd 缺失 → null→ 上层 doFallback；有 cwd 时优先复用已登记工作区；未命中则按需创建；
      //   创建失败（异常/bad-request/返回无效）→ 回落 null，使上层走 {cwd,ptc} 而非阻断；全程捕获永不抛；
      //   workspaces.create 入参以 {path:cwd} 为主，alpha 若已更名为 {cwd} 则自动回退试探，避免因参数更名导致创建链中断；
      //   显式携带 agentPreset:'ptc' 由 buildCreateOpts 保障，此处只负责 workspaceId 的有无，回退后仍走 ptc 分支，判据 P 不漂移。
      // #364 工作区回退矩阵：实际查找由 kernel/api-workspace.js 的 resolveWorkspaceEntry 承担
      // （#636 拆分：快照形状兼容、创建别名试探、编号与登记项同路返回都在那边），
      // 此处只做薄转发，保持调用点与门禁提取锚点不变；失败一律回落空，不抛错阻断上层。
      const ensureWorkspaceId = function (cwd: any) {
        if (typeof resolveWorkspaceEntry === 'function') return resolveWorkspaceEntry(workspaces, cwd)
        return Promise.resolve({ wid: null, entry: null })
      }
      ensureCwd().then(function (cwd: any) {
        if (!cwd) { doFallback(); return }
        ensureWorkspaceId(cwd).then(function (found: any) {
          const workspaceId = found && found.wid ? found.wid : null
          const wsEntry = found && found.entry ? found.entry : null
          // 复用门：候选须已归属目标工作区（凭登记项名单验），防僵尸空白复活后顶栏空工作区；
          // 名单不可验时沿旧行为放行，未拿到编号时沿旧行为放行（反正都是按目录建）。
          const allowReuse = function (sid: any) { try { if (!workspaceId || !wsEntry || !Array.isArray(wsEntry.sessionIds)) return true; return wsEntry.sessionIds.indexOf(sid) >= 0 } catch (eG) { return true } }
          let reuseSid: any = null
          try {
            if (sessions.list && typeof sessions.list.getSnapshot === 'function') {
              const snap = sessions.list.getSnapshot()
              const normCwd2 = typeof keyOf === 'function' ? keyOf(cwd) : String(cwd).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()
              const curSid = st.sessionId
              if (curSid) {
                const curRow = snap.byId[curSid]
                // #361 闸门：当前会话空白仅当满足复用闸门才可复用，空永不复用、code 幽灵永不复用（两级同形、被拒必新建）
                if (typeof isReusableBlank === 'function') {
                  if (isReusableBlank(curRow, normCwd2) && allowReuse(curSid)) reuseSid = curSid
                } else if (curRow && curRow.blank) {
                  const rowCwd = curRow.cwd || ''
                  const normRow = typeof keyOf === 'function' ? keyOf(rowCwd) : String(rowCwd).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()
                  if ((normRow === normCwd2 || !normRow) && allowReuse(curSid)) reuseSid = curSid
                }
              }
              if (!reuseSid) {
                let best: any = null
                let bestTime = -1
                for (const sid in snap.byId) {
                  const row = snap.byId[sid]
                  if (row.id === curSid) continue
                  if (typeof isReusableBlank === 'function') {
                    if (!isReusableBlank(row, normCwd2)) continue
                  } else {
                    if (!row || !row.blank) continue
                    const rowCwd = row.cwd || ''
                    const normRow = typeof keyOf === 'function' ? keyOf(rowCwd) : String(rowCwd).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()
                    if (normRow !== normCwd2 && normRow) continue
                  }
                  if (!allowReuse(sid)) continue
                  const t = row.updatedAt || 0
                  if (t > bestTime) { bestTime = t; best = sid }
                }
                if (best) reuseSid = best
              }
            }
          } catch(eReuse) {}
          if (reuseSid) {
            const sid = reuseSid
            const ns = storeOf(sid)
            if (ns) {
              ns.cwd = cwd
              const hydrated = (typeof hydrateFromCache === 'function' ? hydrateFromCache(ns) : false)
              if (!hydrated) {
                try {
                  const hasShared = (typeof getCachedSnapshot === 'function' ? getCachedSnapshot(cwd) : null)
                  if (!hasShared && st.snapshot && st.cwd && (typeof keyOf === 'function' ? keyOf(st.cwd) : String(st.cwd||'')) === (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||''))) {
                    ns.snapshot = st.snapshot
                    ns.snapMode = 'real'
                  }
                } catch(eFb){ if (st.snapshot) { ns.snapshot = st.snapshot; ns.snapMode='real'; } }
              }
              try {
                const sharedSnap = (typeof getCachedSnapshot === 'function' ? getCachedSnapshot(cwd) : null)
                if (sharedSnap && ns.snapshot && sharedSnap.generatedMs && ns.snapshot.generatedMs && sharedSnap.generatedMs > ns.snapshot.generatedMs) {
                  ns.snapshot = sharedSnap
                }
              } catch(eVer){}
            }
            // 彻底移除：issuePath 锚点记账已移除（#345）
            const __placeholderTitle = title
            const registerTracked = function (acceptedTitle: any) {
                try {
                  const name0 = acceptedTitle || __placeholderTitle
                  const isPlaceholder = (typeof isNewPlaceholderTitle === 'function' ? isNewPlaceholderTitle(name0) : /^\[New\] /.test(String(name0)))
                  // 编号档同样收编（「在新会话打开」那条路）：不收的话底座首句名会把 [#n] 名盖掉且无人守。
                  if (!isPlaceholder && !(typeof parseNumberedTitle === 'function' && parseNumberedTitle(name0))) return
                  if (typeof host !== 'undefined' && typeof host.call === 'function') {
                    host.call('wf.registerNewSessionWatcher', { sessionId: sid, baselineTitle: name0, cwd: cwd || '', wroteTitle: !!acceptedTitle, hint: (ns ? namingHintOf(ns, name0) : null) }).then(function () { namingGuardianKick() }).catch(function (e: any) { try { log('warn', 'host.call.fail', { method: 'wf.registerNewSessionWatcher', kind: 'naming-register', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {} })
                  }
                } catch (eReg) {}
              }
              // #746 Knife2：先打开后改名（面在打开后才保留）。打开成功后重读快照再改名记账；
              // 改名成败都记账（accepted 为空即 wrote=false 走没写成，不误判手改）。
              // 对抗 K1：改名调用同步抛错也必须记账（旧外层 try 的兜底），否则会话永不进台账。
              const doRenameRegister = function () {
                let face: any = null
                try { const scopeCtx = sessions.scope(sid); face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined } catch (eFace) {}
                let curTitle: any = null
                try { curTitle = (typeof namingCurrentTitleOf === 'function' ? namingCurrentTitleOf(sid) : null) } catch (eCur) {}
                let runRename: any = null
                try { runRename = (curTitle !== title && face && typeof face.rename === 'function') ? Promise.resolve(face.rename(title)) : Promise.resolve(null) } catch (eSync) { runRename = Promise.resolve(null) }
                runRename.then(function (rRename: any) {
                  const accepted = (rRename && rRename.ok && rRename.value && rRename.value.title) ? rRename.value.title : null
                  registerTracked(accepted)
                }).catch(function () { registerTracked(null) })
              }
              if (sid === st.sessionId) {
                try {
                  if (ns && typeof ns.injector === 'function') {
                    var directText = text
                    try { if (typeof withTrailingNewline === 'function') directText = withTrailingNewline(text) } catch (eNl) {}
                    ns.injector(directText)
                    try { if (typeof ensureInjectFocusAtEnd === 'function') ensureInjectFocusAtEnd() } catch (eFocus) {}
                  } else if (typeof inject === 'function') {
                    inject(ns || st, text)
                  } else {
                    // #787：首条写进目标会话自己的 store（storeOf 永返对象，ns 必为目标会话那份，不会落到源会话）
                    ns.incomingDraft = text
                    try { emit(ns) } catch(eEmit){}
                  }
                } catch(eDirect){
                  ns.incomingDraft = text
                }
              } else {
                ns.incomingDraft = text
              }
            // #742：0.1.7 注册表无 open(会话号)，优先走工作区打开通道，旧方法留回退。
            // #746 Knife2/V7：打开成功才改名记账；打开失败记账不断（守护仍可兜底），提示如实报失败。
            const __ok742a = function () { try { doRenameRegister() } catch (eRR) {} flash(st, tr('toast.newSessionOpened'), 'ok') }
            const __fail742a = function () { try { registerTracked(null) } catch (eRG) {} try { if (typeof namingGuardianKick === 'function') namingGuardianKick() } catch (eKG) {} flash(st, tr('toast.newSessionOpenFailed', { title: title }), 'warn') }
            const __go742a = function () { try {
              let __u: any = null
              try { if (typeof ctx !== 'undefined' && ctx) { __u = (typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : null) || ctx.uiWorkspace || null } } catch (eG) {}
              if (__u && typeof __u.openSession === 'function') { const __r = __u.openSession(sid); if (__r && typeof __r.then === 'function') { __r.then(__ok742a, __fail742a); return } __ok742a(); return }
              if (sessions && typeof sessions.open === 'function') { const __o = sessions.open(sid); if (__o && typeof __o.then === 'function') { __o.then(__ok742a, __fail742a); return } }
              __ok742a()
            } catch (eS742a) { try { __fail742a() } catch (eF) {} } }
            __go742a()
            return
          }
          // #363 单点工厂：显式 ptc + 工作区 + 首条原子化（唯一出口，显式 agentPreset）
          const createOpts = typeof buildCreateOpts === 'function' ? buildCreateOpts(workspaceId, cwd) : (workspaceId ? { workspaceId: workspaceId, agentPreset: 'ptc' } : { cwd: cwd, agentPreset: 'ptc' })
          const __createOnce = function () { return (typeof createPTCSession === 'function') ? createPTCSession(sessions, workspaceId, cwd, text) : sessions.create(createOpts).then(function(__sid: any){ try { if (__sid) storeOf(__sid).incomingDraft = text } catch (eD) { try { inject(st, text) } catch (e2) {} } return __sid; }) }
          // #478：经创建后验编排建会话（首建 code 则隔离重建；双 code 抛错，大声失败，绝不 open code）；旧闭包无编排时回退直建。
          const __createPTC = (typeof createVerifiedPTCSession === 'function') ? createVerifiedPTCSession(__createOnce, sessions) : __createOnce()
          __createPTC.then(function (sid: any) {
          // 新会话秒显共享缓存为唯一来源（#301 / #324）：同工作区共享缓存在 storeOf 已尝试水合，此处 cwd 刚赋值需再次水合
          // 移除“继承打开它的会话 snapshot”作为版本来源；无共享缓存时可作兜底
          const ns = storeOf(sid)
          if (ns) {
            ns.cwd = cwd
            const hydrated = (typeof hydrateFromCache === 'function' ? hydrateFromCache(ns) : false)
            if (!hydrated) {
              // 无共享缓存且源会话有快照且同工作区：临时兜底（避免首开无数据转圈）
              try {
                const hasShared = (typeof getCachedSnapshot === 'function' ? getCachedSnapshot(cwd) : null)
                if (!hasShared && st.snapshot && st.cwd && (typeof keyOf === 'function' ? keyOf(st.cwd) : String(st.cwd||'')) === (typeof keyOf === 'function' ? keyOf(cwd) : String(cwd||''))) {
                  ns.snapshot = st.snapshot
                  ns.snapMode = 'real'
                }
              } catch(eFb){ if (st.snapshot) { ns.snapshot = st.snapshot; ns.snapMode='real'; } }
            }
            // 版本以最新 generatedMs 者胜：若源快照更新，则以最新者为准（hydrate 已处理，但兜底后需校正）
            try {
              const sharedSnap = (typeof getCachedSnapshot === 'function' ? getCachedSnapshot(cwd) : null)
              if (sharedSnap && ns.snapshot && sharedSnap.generatedMs && ns.snapshot.generatedMs && sharedSnap.generatedMs > ns.snapshot.generatedMs) {
                ns.snapshot = sharedSnap
              }
            } catch(eVer){}
          }
          // 彻底移除：issuePath 新会话锚点已移除（#345）
          // 自动命名（失败不阻塞打开）：占位标题在创建前已确定，跟随 harness 语言；改名落定后把会话交给命名守护
          // （#265）——以宿主实际接受的那个标题为基准注册，附语义线索；此后按计划单升级，值比对锁守护手改。
          const __placeholderTitle = title
          const registerTracked = function (acceptedTitle: any) {
            try {
              const name0 = acceptedTitle || __placeholderTitle
              const isPlaceholder = (typeof isNewPlaceholderTitle === 'function' ? isNewPlaceholderTitle(name0) : /^\[New\] /.test(String(name0)))
              // 编号档同样收编（「在新会话打开」那条路）：不收的话底座首句名会把 [#n] 名盖掉且无人守。
              if (!isPlaceholder && !(typeof parseNumberedTitle === 'function' && parseNumberedTitle(name0))) return
              if (typeof host !== 'undefined' && typeof host.call === 'function') {
                // #266：注册走 #211 复原名「注册监视」（wf.registerNewSessionWatcher，host 侧为收编跟踪态 + 索引基线）；
                // wf.namingRegister 为 #265 兼容别名，双名同本体，守卫钉死。
                // #746：线索随占位标题同行（语义段由 namingHintOf 从 name0 取），占位不再裸奔。
                host.call('wf.registerNewSessionWatcher', { sessionId: sid, baselineTitle: name0, cwd: cwd || '', wroteTitle: !!acceptedTitle, hint: (ns ? namingHintOf(ns, name0) : null) }).then(function () { namingGuardianKick() }).catch(function (e: any) { try { log('warn', 'host.call.fail', { method: 'wf.registerNewSessionWatcher', kind: 'naming-register', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {} })
              }
            } catch (eReg) {}
          }
          // #746 Knife2：先打开后改名（同复用分支）。打开成功后重读快照再改名记账。
          // 对抗 K1：改名调用同步抛错也必须记账。
          const doRenameRegister = function () {
            let face: any = null
            try { const scopeCtx = sessions.scope(sid); face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined } catch (eFace) {}
            let curTitle: any = null
            try { curTitle = (typeof namingCurrentTitleOf === 'function' ? namingCurrentTitleOf(sid) : null) } catch (eCur) {}
            let runRename: any = null
            try { runRename = (curTitle !== title && face && typeof face.rename === 'function') ? Promise.resolve(face.rename(title)) : Promise.resolve(null) } catch (eSync) { runRename = Promise.resolve(null) }
            runRename.then(function (rRename: any) {
              const accepted = (rRename && rRename.ok && rRename.value && rRename.value.title) ? rRename.value.title : null
              registerTracked(accepted)
            }).catch(function () { registerTracked(null) })
          }
          // prefill (#787 会话隔离): write into the new session's own store; only that session consumes, avoiding old session race.
          // #315 回滚 (2026-08-30 user constraint): keep draft-first UX (先填草稿、让用户自己输入再发送), no auto-send via face.prompt;
          //   blank-reuse risk is mitigated by naming-guardian bare-session never gets numbered (path B fixed) rather than auto-send
          //   (see handoff 20260830-014242).
          // 建号失败（下链 catch）走 doFallback 时此行没跑过，目标 store 无残留；新编号为空不写（不污染共用）。
          if (sid) ns.incomingDraft = text
          // #739：建号成功（sid 已到手）后只报成功，打开失败不再进 doFallback ——
          //   兜底会谎称没建会话并把指令塞回当前会话，而带草稿的新会话其实已被丢在后台成幽灵；
          // #742：0.1.7 注册表无 open(会话号)，优先走工作区打开通道，旧方法留回退。
          // #746 Knife2/V7：打开成功才改名记账；打开失败记账不断，提示如实报失败。
          const __ok742b = function () { try { doRenameRegister() } catch (eRR) {} flash(st, tr('toast.newSessionOpened'), 'ok') }
          const __fail742b = function () { try { registerTracked(null) } catch (eRG) {} try { if (typeof namingGuardianKick === 'function') namingGuardianKick() } catch (eKG) {} flash(st, tr('toast.newSessionOpenFailed', { title: title }), 'warn') }
          const __go742b = function () { try {
            let __u: any = null
            try { if (typeof ctx !== 'undefined' && ctx) { __u = (typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : null) || ctx.uiWorkspace || null } } catch (eG) {}
            if (__u && typeof __u.openSession === 'function') { const __r = __u.openSession(sid); if (__r && typeof __r.then === 'function') { __r.then(__ok742b, __fail742b); return } __ok742b(); return }
            if (sessions && typeof sessions.open === 'function') { const __o = sessions.open(sid); if (__o && typeof __o.then === 'function') { __o.then(__ok742b, __fail742b); return } }
            __ok742b()
          } catch (eS742b) { try { __fail742b() } catch (eF) {} } }
          __go742b()
        }).catch(function (err: any) { try { if (String((err && err.message) || '').indexOf('preset-blocked') >= 0) flash(st, tr('toast.newSessionPresetBlocked'), 'warn') } catch (eF) {} doFallback() })
        })
      })
    }

