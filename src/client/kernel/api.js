/**
 * src/client/kernel/api.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const injectFixate = (st) => { inject(st, fixateText()) }

    // v24-48：交接 —— 第一击自动注入 /handoff 模板（带时间戳文件名 + 引导句）并记忆该时间戳；
    // 第二击优先读「第一击模板里的同一个文件」（模板写什么名就读什么名，不再查目录导致旧文件名）；
    // 仅当未点过第一击（如刷新后）才回退 host 查最新实际文档；+ 复制 + 开新空白会话
    // v25 · T2b（F1 修正）：交接两击走模板渲染；{ts} 第一击注入时生成并记忆；
    //   {file} = 第一击模板渲染后解析出的实际文件名（用户改文件名结构也一致），解析失败兜底 handoffTs + '.md'
    export let handoffTs = null  // v24：第一击模板使用的时间戳（第二击优先复用同一文件名）
    export let handoffFile = null  // v25 F1：第一击渲染后解析出的实际交接文件名（含用户自定义结构）
    export const handoffPrompt = function (ts) {
      return renderTemplate('handoff1', { ts: ts })
    }
    // 从第一击注入文本解析 .scratch/handoff/<name>.md 的实际文件名（T1 规格 §2 发现 1）
    export const extractHandoffFile = function (text) {
      const m = String(text || '').match(/\.scratch\/handoff\/([^\s"'`]+\.md)/)
      return m ? m[1] : null
    }
    export const handoffReadText = function (file) {
      return file ? renderTemplate('handoff2', { file: file }) : ''
    }
    // 跨会话预填（issue #12 BUG4 r3 终极修复）：单变量保留，但消费侧彻底锁死 deps 为 [props.sessionId]，
//   当前会话的 props 重渲染不会再触发 effect 重跑，从根本上消除「当前会话 effect 抢先消费」竞态。
// r4（#62/#63 回归 2026-08-21）：旧 r3 用 boolean consumedDraftRef 导致首次消费后 ref=true 常驻，任何新会话 effect 直接 return（62/63 新开会话不注入）；且 pendingDraft 为全局单变量，旧会话重渲染若 deps 含 props 可能抢先消费。r4 改为 sid 锚定：pendingDraftTargetSid 记录新会话 sid，消费侧仅当 pendingDraftTargetSid===props.sessionId 才消费，且 ref 按 sid 存储。
export let pendingDraft = null
export let pendingDraftTargetSid = null
    // 需求1（2026-08-18）：交接按钮 = 第一击（注入 /handoff 模板，不再变字）；「新会话交接」小按钮 = 原第二击逻辑
    // 需求1·二阶段 rev（2026-08-18）：灰/亮双态的真实依据 = 磁盘上确实存在交接文档（wf.handoffLatest 探测）。
    //   probeHandoffReady：探测 → 写 st.handoffReady + emit（右半亮蓝/灰 + 允许/禁止 的开关）；任何路径都不得在无文档时开新会话。
    // issue #12 BUG4 · 主路径（r2 终极形态）：用户刚点过第一击（handoffFile 已设）→ 直接用 handoffFile 作为 prompt
    //   文件名 + 亮蓝，**不查磁盘**。理由：prompt 必须与第一击注入的 `/handoff` 模板时间戳一致（用户视角的「两段文本应该对应同一份文档」），
    //   即便 AI 还没落盘，handoff-open 仍应预填 handoffFile（保证两段 prompt 一致）。若 AI 真没写，新会话 `/read` 会失败 —— 那是 AI 行为问题。
    //   未点过第一击（handoffFile=null，如刷新后 / 直接点右半）→ 调 wf.handoffLatest 探磁盘取 mtime 最新。
    //   始终返回 Promise.resolve(done(...))，让调用方（doHandoffOpen / probe chain）能稳定 .then。
    export const probeHandoffReady = function (st) {
      const cwdArg = st.cwd ? { cwd: st.cwd } : {}
      const done = function (file) { st.handoffReady = !!file; emit(st); return file }
      if (typeof host === 'undefined' || typeof host.call !== 'function') { done(null); return Promise.resolve(null) }
      // 主路径：handoffFile 已设 → 直接返回它（prompt 内容与第一击模板时间戳一致 · r2）
      if (handoffFile) return Promise.resolve(done(handoffFile))
      // 副路径：handoffFile=null（刷新后 / 从未点第一击）→ 走 wf.handoffLatest 探磁盘
      return host.call('wf.handoffLatest', cwdArg).then(function (res) {
        return done((res && res.ok && res.file) ? res.file : null)
      }).catch(function () { return done(null) })
    }
    export const doHandoff = function (st) {
      handoffTs = timeStampStr()
      const text = handoffPrompt(handoffTs)
      handoffFile = extractHandoffFile(text) || (handoffTs + '.md')
      inject(st, text)
      flash(st, tr('toast.injectedHandoff'), 'ok')
      // r2：handoffFile 已设后 probeHandoffReady 直接亮蓝（不再等磁盘落盘）
      probeHandoffReady(st)
    }
    export const doHandoffOpen = function (st) {
      const ws = ctx.get('workspaces')
      const finish = function (file, msg) {
        const text = handoffReadText(file)
        pendingDraft = text
        pendingDraftTargetSid = null
        copyText(st, text, msg || tr('toast.copiedHandoff'))
        if (ws && typeof ws.startSession === 'function') {
          ws.startSession()
        } else {
          pendingDraft = null
          pendingDraftTargetSid = null
        }
      }
      // 引导门 v3（2026-08-18 rev）：无论本会话是否点过第一击，一律先探测磁盘真实文档——
      //   有 latest → 置 ready + 放行开新会话；没有 → toast 引导「请先点「交接」生成交接文档」，绝不打开空会话
      probeHandoffReady(st).then(function (file) {
        if (file) finish(file, tr('toast.copiedHandoffFile', { file: file }))
        else flash(st, tr('toast.handoffGrey'), 'warn')
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
      const ensureWorkspaceId = function (cwd) {
        if (!workspaces || !cwd) return Promise.resolve(null)
        try {
          let items = []
          if (workspaces.list) {
            let snap = null
            try {
              if (typeof workspaces.list.getSnapshot === 'function') snap = workspaces.list.getSnapshot()
              else if (typeof workspaces.list.getCurrent === 'function') snap = workspaces.list.getCurrent()
            } catch (e2) {}
            if (snap) {
              if (Array.isArray(snap.items)) items = snap.items
              else if (Array.isArray(snap)) items = snap
              else if (snap.byId) {
                items = snap.items || []
              }
            }
          }
          const norm = function (p) {
            const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
            const isWin = /\\/.test(String(p || '')) || /^[a-zA-Z]:\//.test(s)
            return isWin ? s.toLowerCase() : s
          }
          const targetNorm = norm(cwd)
          for (let i = 0; i < items.length; i++) {
            const w = items[i]
            const wPath = w.path || w.cwd
            if (wPath && norm(wPath) === targetNorm) {
              const wid = w.workspaceId || w.id
              if (wid) return Promise.resolve(wid)
            }
          }
          if (typeof workspaces.create === 'function') {
            return workspaces.create({ path: cwd }).then(function (ws) {
              const wid = ws && (ws.workspaceId || ws.id)
              return wid || null
            }).catch(function () { return null })
          }
        } catch (e) {}
        return Promise.resolve(null)
      }
      ensureCwd().then(function (cwd) {
        if (!cwd) { doFallback(); return }
        ensureWorkspaceId(cwd).then(function (workspaceId) {
          const createOpts = workspaceId ? { workspaceId: workspaceId } : { cwd: cwd }
          sessions.create(createOpts).then(function (sid) {
          // v1.5：新会话继承当前快照（同仓库同 cwd）—— 面板/状态栏秒显，避免冷缓存全量重建卡顿
          const ns = storeOf(sid)
          if (ns && st.snapshot) { ns.snapshot = st.snapshot; ns.snapMode = 'real'; ns.cwd = cwd }
          // issuePath · 新会话锚点：把本次打开的 issue 记为新会话的起点（Q10 A+B）
          try {
            const __refs = (function (t) { const o=[]; const s=String(t||''); const re=/github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g; let mm; while((mm=re.exec(s))!==null) o.push(Number(mm[1])); return o })(text)
            if (__refs.length && ns) {
              const __tg = String(title || '').slice(0,80)
              recordIssuePath(ns, __refs[0], 'claim', __tg)
              for (let _i=1; _i<__refs.length; _i++) recordIssuePath(ns, __refs[_i], 'mention', '')
            }
          } catch (e) {}
          // 自动命名（失败不阻塞打开）
          try {
            const scopeCtx = sessions.scope(sid)
            const face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined
            if (face && typeof face.rename === 'function') face.rename(title).catch(function () { /* 命名失败忽略 */ })
          } catch (e) { /* 命名失败忽略 */ }
          // 预填（r4）：写入 pendingDraft + 目标 sid 锚定，消费侧仅新会话消费，杜绝旧会话抢先
          pendingDraft = text
          pendingDraftTargetSid = sid
          sessions.open(sid)
          flash(st, tr('toast.newSessionOpened'), 'ok')
        }).catch(function () { doFallback() })
        })
      })
    }
    // #361 原入口：行级「在新会话打开」保留（rowActionText 文本 + 票标题命名）
    export const openInNewSession = function (st, x) {
      openTextInNewSession(st, rowActionText(st, x), newSessionTitle(x))
    }
    export const extractIssueRefs = function (text) {
      const out = []
      const s = String(text || '')
      const urlRe = /github\.com\/[^\/\s]+\/[^\/\s]+\/issues\/(\d+)/g
      let m
      while ((m = urlRe.exec(s)) !== null) out.push(Number(m[1]))
      return out
    }
    export const inject = (st, text) => {
      if (st.injector) { st.injector(text); flash(st, tr('toast.injected'), 'ok') }
      else copyText(st, text, tr('toast.copiedFallback'))
      // issuePath · 1C 提及识别（主路径 URL 扫描，零误判；#\d+ 辅路径待 toast 确认，首版仅 URL 自动记）
      try {
        const refs = extractIssueRefs(text)
        if (refs.length) {
          const titleGuess = (text && text.split('\n').slice(0, 3).join(' ').slice(0, 80)) || ''
          recordIssuePath(st, refs[0], 'mention', titleGuess)
          for (let i = 1; i < refs.length; i++) recordIssuePath(st, refs[i], 'mention', '')
          try { if (typeof host !== 'undefined' && typeof host.call === 'function') host.call('wf.issuePathPush', { number: refs[0], source: 'mention', title: titleGuess }).catch(function () {}) } catch (e) {}
        }
      } catch (e) {}
      // v1.5 T10 R9（Q4 拍板）：关键动作（完成/执行/交接/认领）后延迟探测，面板尽快反映变化
      scheduleActionProbe()
    }
    // v1.6：技能安装引导已收编进 PROMPTS 注册表（installSkills 条目），见下方 promptText('installSkills') 引用
    // v1.5 引导链：打开外部 URL（gh 安装/登录文档）
    export const openUrl = function (url) { try { if (typeof window !== 'undefined' && window.open) window.open(url, '_blank') } catch (e) { /* 忽略 */ } }
    export const copyText = (st, text, okMsg) => {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash(st, okMsg || tr('toast.copied'), 'ok') }).catch(function () { flash(st, tr('toast.copyFailed'), 'warn') })
      } else flash(st, tr('toast.clipboardUnavailable'), 'warn')
    }
