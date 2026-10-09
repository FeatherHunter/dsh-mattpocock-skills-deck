// src/host/platform/deckSandbox.js —— deck 工具与检查链共用的按调用现算许可（935）
// 住在平台装配扇出层，供宿主层两处复用（refresh/wiring.js 的工具接线、index.js 的检查链接线），
// 同层互引门禁把本目录排除在宿主层之外，所以两处引用本文件不新增宿主层内部边。
// 口径与电话侧 resolveSandboxPolicy 同源：显式会话号优先，否则按工作区根找唯一归属会话；
// 无归属回空，不自己拼宽松政策。
export function createSandboxPolicyFor(ctx) {
  return function (info) {
    try {
      const cwd = String((info && info.cwd) || ''); const sid = String((info && info.sessionId) || '')
      let svc = null; try { svc = ctx.get('sandboxPolicy') } catch (eG) { svc = null }
      if (!svc || typeof svc.resolve !== 'function') return Promise.resolve({ policy: undefined, sessionId: sid })
      let sessionsSvc = null; try { sessionsSvc = ctx.get('sessions') } catch (eS) { sessionsSvc = null }
      let session = null; try { if (sid && sessionsSvc && typeof sessionsSvc.get === 'function') session = sessionsSvc.get(sid) || null } catch (eG2) { session = null }
      if (!session && sessionsSvc && typeof sessionsSvc.list === 'function' && cwd) {
        const keyOf = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
        const want = keyOf(cwd); const prefix = want + '/'; let all = []
        try { all = sessionsSvc.list() || [] } catch (eL) { all = [] }
        const cwdOf = (s) => { try { if (!s || typeof s !== 'object') return ''; if (typeof s.cwd === 'string' && s.cwd) return s.cwd; if (s.header && typeof s.header.cwd === 'string' && s.header.cwd) return s.header.cwd; if (s.workspace && typeof s.workspace.cwd === 'string' && s.workspace.cwd) return s.workspace.cwd; if (s.workspaceRoot && typeof s.workspaceRoot === 'string') return s.workspaceRoot } catch (eC) {} return '' }
        const exact = []; const inside = []
        for (const item of all) { const c = cwdOf(item); if (!c) continue; const k = keyOf(c); if (!k) continue; if (k === want) exact.push(item); else if (k.indexOf(prefix) === 0) inside.push(item) }
        if (exact.length === 1) session = exact[0]; else if (exact.length === 0 && inside.length === 1) session = inside[0]
      }
      if (!session) return Promise.resolve({ policy: undefined, sessionId: sid })
      let policy = undefined; try { policy = svc.resolve({ session }) } catch (eR) { policy = undefined }
      let realId = sid; try { if (session && session.id) realId = String(session.id) } catch (eI) {}
      return Promise.resolve({ policy, sessionId: realId })
    } catch (e) { return Promise.resolve({ policy: undefined, sessionId: String((info && info.sessionId) || '') }) }
  }
}
