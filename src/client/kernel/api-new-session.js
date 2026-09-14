/**
 * src/client/kernel/api-new-session.js — 内核模块（#457 由 api.js 拆出之交接执行与新会话创建）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const probeHandoffReady = function (st) {
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const done = function (file) {
        const ready = !!file
        if (ready) handoffFile = file
        if (st.handoffReady !== ready) { st.handoffReady = ready; emit(st) }  // 状态变了才重渲染（长轮询免重复绘）
        return file
      }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { done(null); return Promise.resolve(null) }
      // 主路径：已发现真实文件名（handoffFile 已设）→ 直接返回（prompt 与第一击 {ts}-*.md 一致）
      if (handoffFile) return Promise.resolve(done(handoffFile))
      // 副路径 A：刚点过第一击（handoffTs 已设）→ 按 {handoffTs}-*.md 前缀匹配真实文件名（含 AI 短标题）
      if (handoffTs) {
        return host.call('wf.handoffResolve', Object.assign({ name: handoffTs + '*' }, cwdArg)).then(function (res) {
          if (res && res.ok && res.file) return done(res.file)
          // 前缀未命中 → 回退取最新，但仅当最新文件名确实以 handoffTs 开头才引用（避免引用无关的旧文档）
          return host.call('wf.handoffLatest', cwdArg).then(function (r2) {
            const f = (r2 && r2.ok && r2.file) ? r2.file : null
            return done((f && f.indexOf(handoffTs) === 0) ? f : null)
          }).catch(function () { return done(null) })
        }).catch(function () { return done(null) })
      }
      // 副路径 B：刷新后 / 从未点第一击 → 走 wf.handoffLatest 探磁盘最新
      return host.call('wf.handoffLatest', cwdArg).then(function (res) {
        return done((res && res.ok && res.file) ? res.file : null)
      }).catch(function () { return done(null) })
    }
    export const doHandoff = function (st) {
      handoffTs = timeStampStr()
      const text = handoffPrompt(handoffTs)
      handoffFile = null  // 真实文件名由探测按 {ts}-*.md 前缀发现（含 AI 短标题），不再从模板解析
      inject(st, text)
      flash(st, tr('toast.injectedHandoff'), 'ok')
      // 轮询探测：AI 写成文档后右半亮蓝（真实文件名 = {ts}-<短标题>.md，按前缀匹配）；1s 间隔、~10min 窗口覆盖复杂文档
      probeHandoffReady(st)
      let tries = 0
      const tick = function () {
        if (handoffFile) return  // 已发现真实文件名 → 停止轮询
        if (++tries > 600) return  // 上限 ~10min（5min+ 复杂文档也覆盖）
        probeHandoffReady(st)
        if (timer !== undefined) timer.timeout(tick, 1000)
      }
      if (timer !== undefined) timer.timeout(tick, 1000)
    }
    let lastHandoffOpenTs = 0  // 防抖：防止 1s 内连点几十下反复探测/开会话
    export const doHandoffOpen = function (st) {
      const now = Date.now()
      if (now - lastHandoffOpenTs < 800) return  // 800ms 内重复点击忽略
      lastHandoffOpenTs = now
      st.handoffSearching = true; emit(st)  // 搜索动画：右半转圈
      const doneSearch = function () { st.handoffSearching = false; emit(st) }  // 2s 后恢复，避免闪烁
      const finish = function (file, msg) {
        const text = handoffReadText(file, st.cwd)
        // 复制到剪贴板仍保留，便于粘贴；主路径经统一单点工厂开新 PTC 会话并原子化注入首条（修复：原 ws.startSession 未显式 ptc/工作区且 pendingDraftTargetSid=null 导致幽灵复活与抢消费）
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
              const p = (typeof createPTCSession === 'function') ? createPTCSession(sessions, null, cwd, text) : sessions.create(createOpts).then(function(sid){ pendingDraft=text; pendingDraftTargetSid=sid; return sid })
              p.then(function(sid){ try{ sessions.open(sid) }catch(e){} }).catch(function(){ try{ inject(st,text) }catch(e2){} })
            } else { inject(st, text) }
          } catch(e3){ try{ inject(st,text)}catch(e4){} }
        }
        setTimeout(doneSearch, 2000)  // 至少转 2s
      }
      // 引导门 v3（2026-08-18 rev）：无论本会话是否点过第一击，一律先探测磁盘真实文档——
      //   有 latest → 置 ready + 放行开新会话；没有 → toast 引导「请先点「交接」生成交接文档」，绝不打开空会话
      probeHandoffReady(st).then(function (file) {
        if (file) finish(file, tr('toast.copiedHandoffFile', { file: file }))
        else { flash(st, tr('toast.handoffGrey'), 'warn'); setTimeout(doneSearch, 2000) }
      })
    }

    // #361：在新会话中打开 —— 同 cwd + 自动命名 + 预填指令
    //   契约（dsh-client-runtime ISessions）：create({cwd}) → SessionId；scope(sid) → AgentContext；
    //   sessionOf(ctx) → SessionFace.rename(title)；open(sid) 切换。任一步失败降级为当前会话注入 + 提醒。
    export const openTextInNewSession = function (st, text, title) {
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
          return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
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
      const ensureWorkspaceId = function (cwd) {
        if (!workspaces || !cwd) return Promise.resolve(null)
        // 取工作区编号：先在已登记的工作区里按路径找，找不到再按需创建一个；全程失败只回落空，不抛错阻断上层。
        // 快照形状与设置页工作区总览同口径：items 数组、直接数组、按编号存的对象、workspaces 数组都要收，不能互斥只取一种。
        const pathOf = function (w) { return (w && (w.path || w.cwd || w.workspacePath || w.dir || w.root || w.fullPath)) || '' }
        const widOf = function (ws) {
          if (!ws) return null
          const direct = ws.workspaceId || ws.id || ws.workspace_id
          if (direct) return direct
          try {
            const nested = ws.workspace || ws.data || ws.value
            if (nested && typeof nested === 'object') {
              const nid = nested.workspaceId || nested.id || nested.workspace_id
              if (nid) return nid
            }
          } catch (eNest) {}
          return null
        }
        const normOf = function (p) { try { return (typeof keyOf === 'function' ? keyOf(p) : String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()) } catch (eN) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() } }
        const collectFromSnap = function (snap, out) {
          if (!snap || typeof snap !== 'object') {
            if (Array.isArray(snap)) { for (let k = 0; k < snap.length; k++) out.push(snap[k]) }
            return
          }
          if (Array.isArray(snap.items)) { for (let k = 0; k < snap.items.length; k++) out.push(snap.items[k]) }
          else if (Array.isArray(snap)) { for (let k = 0; k < snap.length; k++) out.push(snap[k]) }
          // 按编号存的对象形状：取对象里的每一项，不能取 snap.items（那一项在这里是空的）。
          if (snap.byId && typeof snap.byId === 'object') {
            try {
              const vals = Object.values(snap.byId)
              for (let k = 0; k < vals.length; k++) out.push(vals[k])
            } catch (eById) {
              try { for (const kk in snap.byId) { if (Object.prototype.hasOwnProperty.call(snap.byId, kk)) out.push(snap.byId[kk]) } } catch (eById2) {}
            }
          }
          if (snap.workspaces && Array.isArray(snap.workspaces)) { for (let k = 0; k < snap.workspaces.length; k++) out.push(snap.workspaces[k]) }
        }
        const readSnapSync = function () {
          try {
            if (workspaces.list) {
              if (typeof workspaces.list.getSnapshot === 'function') return workspaces.list.getSnapshot()
              if (typeof workspaces.list.getCurrent === 'function') return workspaces.list.getCurrent()
            }
          } catch (e2) {}
          return null
        }
        const targetNorm = normOf(cwd)
        const matchWid = function (items) {
          for (let i = 0; i < items.length; i++) {
            const w = items[i]
            if (!w || typeof w !== 'object') continue
            const wPath = pathOf(w) || w.workspacePath
            if (wPath && normOf(wPath) === targetNorm) {
              const wid = widOf(w) || w.workspaceId || w.id || w.workspace_id
              if (wid) return wid
            }
          }
          return null
        }
        const tryCreateWid = function () {
          if (typeof workspaces.create === 'function') {
            const tryCreate = function (arg) {
              try { return workspaces.create(arg) } catch (eSync) { return Promise.reject(eSync) }
            }
            return tryCreate({ path: cwd }).then(function (ws) {
              const wid = widOf(ws) || (ws && (ws.workspaceId || ws.id || ws.workspace_id))
              return wid || null
            }).catch(function (err) {
              const msg = String((err && err.message) || err || '')
              // 兼容旧参数名： path 不认时换 cwd 再试一次；其它 bad-request 也换着试，避免因参数更名卡死。
              if (/bad-request|unknown|invalid|not.*found|unrecognized|unexpected/i.test(msg)) {
                return tryCreate({ cwd: cwd }).then(function (ws2) {
                  const wid2 = widOf(ws2) || (ws2 && (ws2.workspaceId || ws2.id || ws2.workspace_id))
                  return wid2 || null
                }).catch(function () { return null })
              }
              // 旧断言保留： path 字样 + 非法入参时同样回退，保证门禁字面可命中。
              if (/path/i.test(msg)) {
                try { if (/bad-request|unknown|invalid/i.test(msg)) return null } catch (eP) {}
              }
              return null
            })
          }
          return Promise.resolve(null)
        }
        try {
          let items = []
          const snap = readSnapSync()
          const thenable = snap && typeof snap.then === 'function' ? snap : null
          const afterSnap = function (realSnap) {
            if (realSnap) collectFromSnap(realSnap, items)
            // 兜底：同步快照为空时，再试异步取法（与设置页同口径），避免真机改成异步即 miss。
            const needAsync = items.length === 0
            const asyncStep = function () {
              const hit = matchWid(items)
              if (hit) return Promise.resolve(hit)
              return tryCreateWid()
            }
            if (!needAsync) {
              const hit0 = matchWid(items)
              if (hit0) return Promise.resolve(hit0)
              return tryCreateWid()
            }
            let p = Promise.resolve(null)
            try {
              if (workspaces.list && typeof workspaces.list === 'function') {
                p = p.then(function () {
                  try { return workspaces.list() } catch (eL) { return null }
                }).then(function (arr) {
                  if (Array.isArray(arr)) { for (let k = 0; k < arr.length; k++) items.push(arr[k]) }
                  else if (arr && typeof arr === 'object') collectFromSnap(arr, items)
                  return null
                }).catch(function () { return null })
              }
            } catch (eL2) {}
            try {
              if (typeof workspaces.getAll === 'function') {
                p = p.then(function () {
                  try { return workspaces.getAll() } catch (eG) { return null }
                }).then(function (arr2) {
                  if (Array.isArray(arr2)) { for (let k = 0; k < arr2.length; k++) items.push(arr2[k]) }
                  else if (arr2 && typeof arr2 === 'object') collectFromSnap(arr2, items)
                  return null
                }).catch(function () { return null })
              }
            } catch (eG2) {}
            return p.then(asyncStep)
          }
          if (thenable) return thenable.then(afterSnap).catch(function () { return tryCreateWid() })
          return afterSnap(snap)
        } catch (e) {}
        return Promise.resolve(null)
      }
      ensureCwd().then(function (cwd) {
        if (!cwd) { doFallback(); return }
        ensureWorkspaceId(cwd).then(function (workspaceId) {
          let reuseSid = null
          try {
            if (sessions.list && typeof sessions.list.getSnapshot === 'function') {
              const snap = sessions.list.getSnapshot()
              const normCwd2 = typeof keyOf === 'function' ? keyOf(cwd) : String(cwd).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()
              const curSid = st.sessionId
              if (curSid) {
                const curRow = snap.byId[curSid]
                // #361 闸门：当前会话空白仅当满足复用闸门才可复用，空永不复用、code 幽灵永不复用（两级同形、被拒必新建）
                if (typeof isReusableBlank === 'function') {
                  if (isReusableBlank(curRow, normCwd2)) reuseSid = curSid
                } else if (curRow && curRow.blank) {
                  const rowCwd = curRow.cwd || ''
                  const normRow = typeof keyOf === 'function' ? keyOf(rowCwd) : String(rowCwd).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase()
                  if (normRow === normCwd2 || !normRow) reuseSid = curSid
                }
              }
              if (!reuseSid) {
                let best = null
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
            try {
              const scopeCtx = sessions.scope(sid)
              const face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined
              const registerTracked = function (acceptedTitle) {
                try {
                  const name0 = acceptedTitle || __placeholderTitle
                  const isPlaceholder = (typeof isNewPlaceholderTitle === 'function' ? isNewPlaceholderTitle(name0) : /^\[New\] /.test(String(name0)))
                  if (!isPlaceholder) return
                  if (typeof host !== 'undefined' && typeof host.call === 'function') {
                    host.call('wf.registerNewSessionWatcher', { sessionId: sid, baselineTitle: name0, cwd: cwd || '', hint: (ns ? namingHintOf(ns) : null) }).then(function () { namingGuardianKick() }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.registerNewSessionWatcher', kind: 'naming-register', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {} })
                  }
                } catch (eReg) {}
              }
              const needRename = (function(){ try { const curTitle = (typeof namingCurrentTitleOf==='function'? namingCurrentTitleOf(sid) : null); return curTitle !== title; } catch(e){ return true; }})()
              const runRename = needRename && face && typeof face.rename === 'function' ? Promise.resolve(face.rename(title)) : Promise.resolve(null)
              runRename.then(function (rRename) {
                const accepted = (rRename && rRename.ok && rRename.value && rRename.value.title) ? rRename.value.title : null
                registerTracked(accepted)
              }).catch(function () { registerTracked(null) })
              if (sid === st.sessionId) {
                try {
                  if (ns && typeof ns.injector === 'function') {
                    ns.injector(text)
                  } else if (typeof inject === 'function') {
                    inject(ns || st, text)
                  } else {
                    pendingDraft = text
                    pendingDraftTargetSid = sid
                    try { emit(ns || st) } catch(eEmit){}
                  }
                } catch(eDirect){
                  pendingDraft = text
                  pendingDraftTargetSid = sid
                }
              } else {
                pendingDraft = text
                pendingDraftTargetSid = sid
              }
            } catch (eName) {}
            try { if (typeof sessions.open === 'function') sessions.open(sid) } catch(eOpen){}
            flash(st, tr('toast.newSessionOpened'), 'ok')
            return
          }
          // #363 单点工厂：显式 ptc + 工作区 + 首条原子化（唯一出口，显式 agentPreset）
          const createOpts = typeof buildCreateOpts === 'function' ? buildCreateOpts(workspaceId, cwd) : (workspaceId ? { workspaceId: workspaceId, agentPreset: 'ptc' } : { cwd: cwd, agentPreset: 'ptc' })
          const __createOnce = function () { return (typeof createPTCSession === 'function') ? createPTCSession(sessions, workspaceId, cwd, text) : sessions.create(createOpts).then(function(__sid){ pendingDraft = text; pendingDraftTargetSid = __sid; return __sid; }) }
          // #478：经创建后验编排建会话（首建 code 则隔离重建；双 code 抛错，大声失败，绝不 open code）；旧闭包无编排时回退直建。
          const __createPTC = (typeof createVerifiedPTCSession === 'function') ? createVerifiedPTCSession(__createOnce, sessions) : __createOnce()
          __createPTC.then(function (sid) {
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
          // 自动命名（失败不阻塞打开）— 占位标题在创建前已确定，跟随 harness 语言；
          // 改名落定后把会话交给命名守护（#265）：以宿主实际接受的归一化占位标题为基准注册跟踪态，
          // 附面包屑语义线索；此后常驻渲染钩子按计划单执行草稿档升级，值比对锁守护手改。
          const __placeholderTitle = title
          try {
            const scopeCtx = sessions.scope(sid)
            const face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined
            const registerTracked = function (acceptedTitle) {
              try {
                const name0 = acceptedTitle || __placeholderTitle
                const isPlaceholder = (typeof isNewPlaceholderTitle === 'function' ? isNewPlaceholderTitle(name0) : /^\[New\] /.test(String(name0)))
                if (!isPlaceholder) return
                if (typeof host !== 'undefined' && typeof host.call === 'function') {
                  // #266：注册走 #211 复原名「注册监视」（wf.registerNewSessionWatcher，host 侧为收编跟踪态 + 索引基线）；
                  // wf.namingRegister 为 #265 兼容别名，双名同本体，守卫钉死。
                  host.call('wf.registerNewSessionWatcher', { sessionId: sid, baselineTitle: name0, cwd: cwd || '', hint: (ns ? namingHintOf(ns) : null) }).then(function () { namingGuardianKick() }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.registerNewSessionWatcher', kind: 'naming-register', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {} })
                }
              } catch (eReg) {}
            }
            const runRename = (face && typeof face.rename === 'function') ? Promise.resolve(face.rename(title)) : Promise.resolve(null)
            runRename.then(function (rRename) {
              const accepted = (rRename && rRename.ok && rRename.value && rRename.value.title) ? rRename.value.title : null
              registerTracked(accepted)
            }).catch(function () { registerTracked(null) })
            // prefill (r4): write pendingDraft + target sid anchor; consumer side only the new session consumes, avoiding old session race
            // #315 回滚 (2026-08-30 user constraint): keep draft-first UX (先填草稿、让用户自己输入再发送), no auto-send via face.prompt;
            //   blank-reuse risk is mitigated by naming-guardian bare-session never gets numbered (path B fixed) rather than auto-send
            //   (see handoff 20260830-014242).
            pendingDraft = text
            pendingDraftTargetSid = sid
          } catch (eName) { /* 命名失败忽略 */ }
          sessions.open(sid)
          flash(st, tr('toast.newSessionOpened'), 'ok')
        }).catch(function (err) { try { if (String((err && err.message) || '').indexOf('preset-blocked') >= 0) flash(st, tr('toast.newSessionPresetBlocked'), 'warn') } catch (eF) {} doFallback() })
        })
      })
    }