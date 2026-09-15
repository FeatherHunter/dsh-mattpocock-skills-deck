/**
 * src/client/kernel/api-workspace.js — 内核模块（#636 由 api-new-session.js 拆出之工作区编号查找）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 * 依赖同闭包的 keyOf（shared:workspaceKey，调用时），仅在运行时调用，初始化期不求值。
 */
    // 取工作区路径：先读登记项常见路径字段，再读 handle 里的路径（DSH 升级兼容）。
    export const workspacePathOf = function (w) { try { const h = w && w.handle && typeof w.handle === 'object' ? w.handle : null; return (w && (w.path || w.cwd || w.workspacePath || w.dir || w.directory || w.root || w.fullPath || w.uri || w.fsPath || w.location)) || (h && (h.cwd || h.path || h.workspacePath)) || '' } catch (eP) { return '' } }
    // 取工作区编号：先读直接编号（含大小写变体与 handleId），再读嵌套对象与 handle 嵌套（DSH 升级兼容）。
    export const workspaceIdOf = function (ws) {
      if (!ws) return null
      const direct = ws.workspaceId || ws.workspaceID || ws.id || ws.workspace_id || ws.handleId
      if (direct) return direct
      try {
        const nested = ws.workspace || ws.data || ws.value || (ws.handle && typeof ws.handle === 'object' ? ws.handle : null)
        if (nested && typeof nested === 'object') {
          const nid = nested.workspaceId || nested.workspaceID || nested.id || nested.workspace_id
          if (nid) return nid
        }
      } catch (eNest) {}
      return null
    }
    // 工作区路径归一：有 keyOf 时走它（与客户端其余位置同口径），没有时走本地回退。
    export const workspaceNormOf = function (p) { try { return (typeof keyOf === 'function' ? keyOf(p) : String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()) } catch (eN) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() } }
    // 从工作区快照里收齐登记项：items 数组、直接数组、按编号存的对象、workspaces 数组都要收，
    // 不能互斥只取一种；DSH 升级别名（行数组、映射表、data 包裹、entries）同样要收，
    // 否则新版快照形状一变就按空处理，直接掉进创建分支。
    export const workspaceCollectFromSnap = function (snap, out) {
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
      if (snap.rows && Array.isArray(snap.rows)) { for (let k = 0; k < snap.rows.length; k++) out.push(snap.rows[k]) }
      if (snap.data && Array.isArray(snap.data)) { for (let k = 0; k < snap.data.length; k++) out.push(snap.data[k]) }
      else if (snap.data && typeof snap.data === 'object') workspaceCollectFromSnap(snap.data, out)
      if (snap.workspacesById && typeof snap.workspacesById === 'object') { try { const vs = Object.values(snap.workspacesById); for (let k = 0; k < vs.length; k++) out.push(vs[k]) } catch (eW) {} }
      if (snap.entries && Array.isArray(snap.entries)) { for (let k = 0; k < snap.entries.length; k++) out.push(snap.entries[k]) }
    }
    // 按路径找工作区登记项：命中即带回整项，后续复用空白会话时凭它验归属，
    // 防止复活历史上没归属的空白僵尸（有同目录无归属 → 新会话顶栏空工作区）。
    export const workspaceMatchEntry = function (items, targetNorm) {
      for (let i = 0; i < items.length; i++) {
        const w = items[i]
        if (!w || typeof w !== 'object') continue
        const wPath = workspacePathOf(w) || w.workspacePath
        if (wPath && workspaceNormOf(wPath) === targetNorm) {
          const wid = workspaceIdOf(w) || w.workspaceId || w.id || w.workspace_id
          if (wid) return w
        }
      }
      return null
    }
    // 按需创建工作区并取编号：创建别名按序试探（DSH 升级若给创建参数改名，按此序逐个试，
    // 命中即停，全败才回落空）；返回字符串编号也接受。
    export const workspaceTryCreateWid = function (workspaces, cwd) {
      if (typeof workspaces.create === 'function') {
        const tryCreate = function (arg) {
          try { return workspaces.create(arg) } catch (eSync) { return Promise.reject(eSync) }
        }
        const widOfAny = function (ws) { try { return workspaceIdOf(ws) || (ws && (ws.workspaceId || ws.workspaceID || ws.id || ws.workspace_id)) || (typeof ws === 'string' && ws ? ws : null) } catch (eW) { return null } }
        const attempts = [{ path: cwd }, { cwd: cwd }, { workspacePath: cwd }, { directory: cwd }, { dir: cwd }]
        const runAt = function (i) {
          if (i >= attempts.length) return Promise.resolve(null)
          return tryCreate(attempts[i]).then(function (ws) {
            return widOfAny(ws) || null
          }).catch(function (err) {
            const msg = String((err && err.message) || err || '')
            if (/bad-request|unknown|invalid|not.*found|unrecognized|unexpected/i.test(msg)) return runAt(i + 1)
            if (/path/i.test(msg)) return runAt(i + 1)
            return null
          })
        }
        return runAt(0)
      }
      return Promise.resolve(null)
    }
    // #364 工作区回退矩阵：取工作区编号——先在已登记的工作区里按路径找，
    // 找不到再按需创建一个；全程失败只回落空，不抛错阻断上层。
    // 快照形状与设置页工作区总览同口径收集；命中时把编号与登记项同路返回，
    // 供调用方凭登记项名单验复用归属。
    export const resolveWorkspaceEntry = function (workspaces, cwd) {
      if (!workspaces || !cwd) return Promise.resolve({ wid: null, entry: null })
      const readSnapSync = function () {
        try {
          if (workspaces.list) {
            if (typeof workspaces.list.getSnapshot === 'function') return workspaces.list.getSnapshot()
            if (typeof workspaces.list.getCurrent === 'function') return workspaces.list.getCurrent()
          }
        } catch (e2) {}
        return null
      }
      const targetNorm = workspaceNormOf(cwd)
      try {
        let items = []
        const snap = readSnapSync()
        const thenable = snap && typeof snap.then === 'function' ? snap : null
        const afterSnap = function (realSnap) {
          if (realSnap) workspaceCollectFromSnap(realSnap, items)
          // 兜底：同步快照为空时，再试异步取法（与设置页同口径），避免真机改成异步即 miss。
          const needAsync = items.length === 0
          const widOfEntry = function (e) { try { return workspaceIdOf(e) || e.workspaceId || e.id || e.workspace_id } catch (eW) { return null } }
          const asyncStep = function () {
            const found = workspaceMatchEntry(items, targetNorm)
            if (found) return Promise.resolve({ wid: widOfEntry(found), entry: found })
            return workspaceTryCreateWid(workspaces, cwd).then(function (w) { return { wid: w, entry: null } })
          }
          if (!needAsync) {
            const found0 = workspaceMatchEntry(items, targetNorm)
            if (found0) return Promise.resolve({ wid: widOfEntry(found0), entry: found0 })
            return workspaceTryCreateWid(workspaces, cwd).then(function (w0) { return { wid: w0, entry: null } })
          }
          let p = Promise.resolve(null)
          try {
            if (workspaces.list && typeof workspaces.list === 'function') {
              p = p.then(function () {
                try { return workspaces.list() } catch (eL) { return null }
              }).then(function (arr) {
                if (Array.isArray(arr)) { for (let k = 0; k < arr.length; k++) items.push(arr[k]) }
                else if (arr && typeof arr === 'object') workspaceCollectFromSnap(arr, items)
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
                else if (arr2 && typeof arr2 === 'object') workspaceCollectFromSnap(arr2, items)
                return null
              }).catch(function () { return null })
            }
          } catch (eG2) {}
          return p.then(asyncStep)
        }
        if (thenable) return thenable.then(afterSnap).catch(function () { return workspaceTryCreateWid(workspaces, cwd).then(function (wC) { return { wid: wC, entry: null } }) })
        return afterSnap(snap)
      } catch (e) {}
      return Promise.resolve({ wid: null, entry: null })
    }
