// src/host/handoffClaim.js —— 交接文档扫描与认领（H6 #450 从 host/index.js 324–477 搬出电话体，纯结构、行为零变化）。
// 以后谁改它：改交接文档扫描排序或认领流程的人。预估约170行，超 350 打回。
// 接线：由 index.js 动态 import 加载；normCwd 经 index 转供给复用（H5 模块）；本文件不引用其他新文件。
export function createHandoffClaim(deps) {
  const { fs, DEFAULT_CWD, normCwd, getDetectionService, getTrackerRegistry, getPlatform, ctx, getRepoKey, runGh, setCache } = deps
  // ============ 交接文档（issue #12 BUG4 · 双重防御 · 副路径）============
  // DSH 沙箱里 fs.stat 返回的 info.mtime 形态不可控（Date / ISO 串 / 秒级 Unix / 本地化串 / null / NaN）；
  // 原 `typeof number ? mt : Date.parse(String(mt))` 在 Date 对象或不可 parse 形态都得 NaN；
  // 原 sort 单键 `b.mtime - a.mtime` 在 mtime 相等/NaN 时 Array.sort 视为 equal → 原顺序保留 →
  // fs.listDir 按名字典序返回 → 老文件天然排第一 → mds[0].name = 字典序最小 = 上一次写入（BUG）。
  //
  // 加固（副路径 · 治本）：
  //   - parseHandoffMtime：isFinite 严格校验 + Date 实例 getTime 优先；任何无法 parse 的形态安全归 0
  //     （NaN/null/undefined/0/不可 parse 串 → 0）
  //   - pickLatestHandoff：mtime desc 主键 + name desc 兜底（时间戳文件名 = 字典序 = 时间序）；
  //     mtime 退化为 0 的退化形态（NaN/null/全 0/全等 finite）一律走 name desc 返回字典序最大
  //
  // 注：混合退化形态（new=NaN+old=valid）的 mtime 倒挂，sort 加固无法区分 —— 由主路径
  //     `wf.handoffResolve(args.name)` 在客户端已点过第一击时直接返回该 name 保障。
  const parseHandoffMtime = function (raw) {
    if (typeof raw === 'number') return isFinite(raw) ? raw : 0
    if (raw instanceof Date) { const t = raw.getTime(); return isFinite(t) ? t : 0 }
    if (raw) { const p = Date.parse(String(raw)); return isFinite(p) ? p : 0 }
    return 0
  }
  const pickLatestHandoff = function (mds) {
    if (!Array.isArray(mds) || !mds.length) return null
    const sorted = mds.slice().sort(function (a, b) {
      const dt = (b.mtime || 0) - (a.mtime || 0)
      if (dt !== 0) return dt
      // name desc 兜底：时间戳文件名（YYYYMMDD-HHMMSS）字典序 = 时间序
      if (b.name < a.name) return -1
      if (b.name > a.name) return 1
      return 0
    })
    return sorted[0].name
  }
  // 共享目录扫描（handoffLatest + handoffResolve 共用）—— 任何 fs 调用异常都降级为空数组
  const scanHandoffDir = async function (cwd) {
    if (fs === undefined) return { error: 'fs 服务不可用', mds: [] }
    try {
      const dir = await fs.resolve('.scratch/handoff', { cwd: cwd })
      const entries = await fs.listDir(dir)
      const mds = []
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        const name = (e && (e.name || e.path || '')) || ''
        if (!name || !/\.md$/i.test(name)) continue
        let mtime = 0
        try {
          const info = await fs.stat(await fs.resolve('.scratch/handoff/' + name, { cwd: cwd }))
          if (info) mtime = parseHandoffMtime(info.mtime)
        } catch (e2) { mtime = 0 }
        mds.push({ name: name, mtime: mtime })
      }
      return { mds: mds }
    } catch (e) {
      return { mds: [] }  // 目录不存在/不可读 = 还没有交接文档
    }
  }

  // v19：查询 .scratch/handoff/ 下最新的交接文档（按 mtime 倒序 + name desc 兜底 · 加固后），供「交接给新会话」预填 + 复制
  async function handleHandoffLatest(args) {
    const cwd = (args && args.cwd) || DEFAULT_CWD
    const r = await scanHandoffDir(cwd)
    if (r.error) return { ok: false, error: r.error }
    return { ok: true, file: pickLatestHandoff(r.mds) }
  }

  // issue #12 BUG4 · 主路径：客户端带期望文件名（第一击模板渲染出的 handoffFile）时严格返回该文件：
  //   在目录里 → 返回它；不在 → 返回 null（不退回 mtime 最新，避免 fallback 到老文件误导用户）。
  //   无 args.name（用户从未点过第一击，如刷新后 / 直接点右半）→ 走 mtime 最新（与 handoffLatest 同语义）。
  // 区别于初版：初版「name 不在目录也 fallback 到 mtime 最新」在实际场景下被验证为反模式 —— 当 AI 还没写完
  // 文档时（handoffFile 设了但文件未落盘），fallback 会让右半亮蓝且点开后错误引用上次的老文档，与修复目标相悖。
  async function handleHandoffResolve(args) {
    const cwd = (args && args.cwd) || DEFAULT_CWD
    const r = await scanHandoffDir(cwd)
    if (r.error) return { ok: false, error: r.error }
    const want = args && args.name
    if (!want) return { ok: true, file: pickLatestHandoff(r.mds) }
    // 前缀匹配（#71 短标题文件名：{ts}-<短标题>.md）：want 以 * 结尾 → 匹配 name 以该前缀开头，取最新
    if (want.slice(-1) === '*') {
      const prefix = want.slice(0, -1)
      const m = r.mds.filter(function (x) { return x.name.indexOf(prefix) === 0 })
      if (m.length) return { ok: true, file: pickLatestHandoff(m) }
      return { ok: true, file: null }
    }
    // 精确匹配：在目录里 → 返回它；不在 → 返回 null（不退回 mtime 最新，避免 fallback 到老文件误导用户）。
    if (r.mds.some(function (m) { return m.name === want })) return { ok: true, file: want }
    return { ok: true, file: null }
  }

  // ============ 认领（开始此 Issue 流程 · T5 #347）============
  // 用户在 UI 点击「确认开始」且勾选认领后调用：gh issue edit <n> --add-assignee @me。
  // 写操作前 UI 已二次确认（用户点击即同意），不走 approval 服务（RESEARCH-NOTES §3 结论）。
  async function handleClaim(args) {
    const n = args && args.number
    const cwd = await normCwd((args && args.cwd) || DEFAULT_CWD)
    if (!n) return { ok: false, error: '缺少参数 number（ticket 号）' }
    // 第一性原理分发
    let _sel = null
    try {
      const svc = await getDetectionService()
      if (svc && typeof svc.detect === 'function') {
        const det = await svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: (args && args.backendId) || undefined })
        if (det && det.selection) _sel = det.selection
      }
    } catch {}
    if (!_sel || (_sel.backendId == null && (!_sel.source || _sel.source !== 'explicit'))) {
      try {
        const regTmp = await getTrackerRegistry()
        const tmpHandle = { cwd }
        const tmpCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
        const sel2 = await regTmp.select(tmpHandle, tmpCtx)
        if (sel2) _sel = sel2
      } catch {}
    }
    const useTracker = _sel && _sel.backendId && _sel.backendId !== 'github' && _sel.backendId !== '' && _sel.backendId !== 'other'
    if (useTracker) {
      const reg = await getTrackerRegistry()
      const backendId = _sel.backendId
      const tracker = reg.get(backendId)
      if (!tracker || typeof tracker.setAssignees !== 'function') return { ok: false, error: { kind: 'unsupported', message: "backend '" + backendId + "' 未实现 setAssignees" } }
      let repoRef = null
      try { repoRef = reg.describe({ cwd }, backendId) } catch {}
      if (!repoRef) repoRef = { backend: backendId, refId: cwd, name: String(cwd).split(/[\\/]/).pop() || backendId, url: '' }
      const opCtx = { cwd, platform: await getPlatform(), fs: ctx.get('fs') }
      const key = String(n).padStart(2, '0')
      // 尝试取当前用户
      let assignee = 'me'
      try {
        if (tracker.getCurrentUser) {
          const ur = await tracker.getCurrentUser(repoRef, opCtx)
          if (ur && ur.ok && ur.data && ur.data.login) assignee = String(ur.data.login)
        }
      } catch {}
      // 若仍为 me，尝试 gh
      if (assignee === 'me') {
        try {
          const u = await runGh(['api', 'user', '-q', '.login'])
          if (u.ok && u.text.trim()) assignee = u.text.trim()
        } catch {}
      }
      const r = await tracker.setAssignees(repoRef, key, [assignee], {}, opCtx)
      if (!r || !r.ok) return r
      setCache({ ts: 0, snapshot: null, error: null })
      return { ok: true, number: n, assignedTo: assignee, url: '' }
    }
    const repo = await getRepoKey(cwd)
    if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
    const r = await runGh(['issue', 'edit', String(n), '--add-assignee', '@me'], cwd)
    if (!r.ok) return { ok: false, error: r }
    // 认领成功 → 取当前用户 login 供面板展示；失效快照缓存，让下次 wf.snapshot 拉到新 assignee
    let assignedTo = ''
    const u = await runGh(['api', 'user', '-q', '.login'])
    if (u.ok) assignedTo = u.text.trim()
    setCache({ ts: 0, snapshot: null, error: null })
    return { ok: true, number: n, assignedTo: assignedTo, url: 'https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + String(n) }
  }
  return { handleHandoffLatest, handleHandoffResolve, handleClaim }
}