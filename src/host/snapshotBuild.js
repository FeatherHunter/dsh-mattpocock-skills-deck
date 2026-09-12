// src/host/snapshotBuild.js —— 面板快照组装与地图详情拉取（从 issueDetail.js 拆出，#599）。
//
// 为什么拆：issueDetail.js 当时 349 行，紧贴「src 文件 ≤350 行」的门禁（tests/verify-file-granularity.js），
// 而本票要在那张文件里给「已合并」补状态归一，加不进去。按仓库既有做法（拆分管线的先例见
// tests/same-layer-baseline.json：入口 src/host/index.js 引用同层模块共 25 条）把两件事分开：
//   本文件 = 「按工作区组装整份快照」：拉地图详情与子票、拼 maps/issues/labels、报选择与仓库身份；
//   issueDetail.js = 「单张票的详情读取」：GraphQL 与 REST 两路，含已合并的状态归一。
// 两半的改动理由不同：前者随卡片字段与选择/仓库身份变，后者随单票字段与降级路变。
//
// 接线：同层互引门禁（tests/verify-no-same-layer-import.js）不许两个「干活的」文件互相引用 ——
// 组合点放在宿主入口 src/host/index.js：地图详情拉取与 buildSnapshot 都产自本文件，
// issueDetail.js 要的那份也由入口转交。
export function createSnapshotBuilder(deps) {
  const { getRepoKey, runGh, fetchIssues, getTrackerRegistry, getPlatform, execProc } = deps
  const { fetchMapsDetailREST, mapTicket, parseMapBody, computeLevels, groupTickets, isRateLimitError } = deps
  const { getRepoRoot, ctx, timer, getGhPath, getGhLastError } = deps
    async function fetchMapsDetail(numbers, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo（git remote 或 gh repo view 失败）' } }
      if (!numbers || !numbers.length) return { ok: true, issues: {} }
      // 构造 aliases 查询：query($owner:String!,$name:String!){repository(...){m0:issue(number:409){...} m1:issue(...){...}}}
      const frag = 'number title state body url author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:20){nodes{name}} subIssues(first:100){totalCount nodes{number title state body url author{login avatarUrl ... on User{name} ... on Organization{name}} labels(first:10){nodes{name}} assignees(first:10){nodes{login}} blockedBy(first:20){nodes{number title state}}}}'
      const sel = numbers.map(function (n, i) { return 'm' + i + ':issue(number:' + n + '){' + frag + '}' }).join(' ')
      const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){' + sel + '}}'
      let last = null
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await runGh(['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + repo.owner, '-F', 'name=' + repo.name], cwd)
        if (!r.ok) {
          last = r
          // v1.5 B5：GraphQL 配额耗尽（RATE_LIMIT）→ 自动降级 REST 通道（不重试 2 次白烧，直接降级）
          if (isRateLimitError(r)) return fetchMapsDetailREST(numbers, cwd)
          if (r.kind !== 'network') return { ok: false, error: r }
          continue
        }
        try {
          const j = JSON.parse(r.text)
          if (j.errors) {
            // v1.5 B5：GraphQL 返回 errors（含 RATE_LIMIT）→ REST 降级
            if (isRateLimitError({ error: JSON.stringify(j.errors) })) return fetchMapsDetailREST(numbers, cwd)
            return { ok: false, error: { kind: 'graphql', error: JSON.stringify(j.errors).slice(0, 300) } }
          }
          return { ok: true, issues: j.data.repository }
        } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
      }
      return { ok: false, error: last || { kind: 'network', error: 'GraphQL aliases 请求失败（重试后仍失败）' } }
    }


    async function buildSnapshot(cwd, hintBackendId) {
      let viewerLogin = null // 由 Tracker.getCurrentUser 填充（后端接口返回当前用户，UI 仅对比，不直调 gh）
      let viewer = null
      const repo = await getRepoKey(cwd)
      // v1.3.3 提速：map 列表直接从全量 issues 过滤（fetchMaps 单独调用省去 —— 原 11 次 → 9 次 gh 调用）
      const fi = await fetchIssues(cwd)
      const issues = fi.ok ? fi.issues : []
      const mapsMeta = fi.ok ? fi.issues.filter(function (x) {
        return x.state === 'OPEN' && (x.labels || []).some(function (l) { return l.name === 'wayfinder:map' })
      }) : []
      // #375：全量 label 列表（含空 label；获取失败容错置空，不阻塞快照构建，client 降级）
      let labels = []
      const fl = await runGh(['label', 'list', '--json', 'name,color'], cwd)
      if (fl.ok) {
        try {
          const ls = JSON.parse(fl.text)
          if (Array.isArray(ls)) labels = ls.map(function (l) { return { name: l.name, color: l.color || '' } })
        } catch (e) { labels = [] }
      }
      // v1.3.3 提速：GraphQL aliases 一次查全部 map 详情（原每 map 一次 GraphQL，8 次串行 ~19s → 1 次 ~4s）
      const d = await fetchMapsDetail(mapsMeta.map(function (m) { return m.number }), cwd)
      const detailOk = d.ok
      const maps = []
      for (let i = 0; i < mapsMeta.length; i++) {
        const m = mapsMeta[i]
        const issue = detailOk ? (d.issues['m' + i] || null) : null
        if (!detailOk || !issue) {
          maps.push({ number: m.number, title: m.title, state: 'OPEN', error: detailOk ? undefined : d.error, tickets: [], stats: { total: 0, open: 0, closed: 0, frontier: 0, claimed: 0, blocked: 0 } })
          continue
        }
        const subs = (issue.subIssues && issue.subIssues.nodes) || []
        const tickets = subs.map(mapTicket)
        const bp = parseMapBody(issue.body)
        // v1.4（T1 #442）：每张票挂 level（DAG 最长路径深度），client 渲染漏斗分层直接取
        const lvInfo = computeLevels(tickets)
        tickets.forEach(function (t) { t.level = lvInfo.byNumber[t.number] })
        const stats = groupTickets(tickets)
        const labels2 = ((issue.labels && issue.labels.nodes) || []).map(function (x) { return x.name })
        maps.push({
          number: issue.number, title: issue.title, state: issue.state, url: issue.url, labels: labels2,
          destination: bp.destination, notes: bp.notes,
          decisions: bp.decisions, fog: bp.fog, outOfScope: bp.outOfScope,
          tickets: tickets, stats: stats,
        })
      }
      // v1.5 R2 + R2-fix-6（#2 MVP E2E 实证 2026-08-18）：probe since 基线**不得**在 buildSnapshot 里初始化/推进。
      //   原实现「buildSnapshot 末尾 lastProbeAtByRepo[rk]=now」有个致命竞态：面板任一 snapshot build（cache-miss/
      //    refresh）若发生在某次编辑**之后**，会把基线推到编辑时刻**之后** → 下次 probe since=基线 查不到该编辑
      //   （count=0 → changed=false），且基线只在 changed=true 时才滑动 → 编辑被**永久吞掉**，UI 永不刷新。
      //   正确语义：基线只能由 probe 自己推进（检测到 change 时置为「本次探测时刻」）；build 完成 ≠ client 已渲染该
      //   快照，无权动基线。首次 probe（since=undefined）自然走全量返回 → 视为 changed → 建立基线（符合原注释意图）。
      // B 方案：viewerLogin 经 Tracker.getCurrentUser（后端接口）获取，UI 仅做 login 对比，不直调 gh，不硬编码 backendId
      // #155：Selection/RepositoryRef 增量（registry.select/describe → wf.snapshot {repository, selection}）
      let selection = null
      let repository = null
      try {
        const reg = await getTrackerRegistry()
        // 预取 viewer（供 UI “本人不显”对比），失败则保持 null（全显）
        try {
          const tmpReg = reg
          const tmpHandle = { cwd: cwd }
          const tmpCtx = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'issue-detail-viewer', timers: { setTimeout: (fn,ms)=>timer.timeout(fn,ms), clearTimeout: (id)=>{try{clearTimeout(id)}catch{}} }, exec: async function(cmd, args, opts){ const argv=[String(cmd)].concat(args||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c, 'viewer-lookup'); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:r.code } } }
          const selForViewer = await tmpReg.select(tmpHandle, tmpCtx)
          const vid = selForViewer && selForViewer.backendId
          if (vid) {
            const tr = tmpReg.get(vid)
            if (tr && typeof tr.getCurrentUser === 'function') {
              const vr = await tr.getCurrentUser({ backend: vid, refId: (tmpHandle.refId||''), name: '', url: '' }, tmpCtx)
              if (vr && vr.ok && vr.data && vr.data.login) { viewerLogin = String(vr.data.login).trim(); viewer = vr.data }
            }
          }
        } catch (e) {}
        if (reg && typeof reg.select === 'function') {
          const handle = { cwd: cwd }
          const ctxSel = { cwd: cwd, platform: await getPlatform(), fs: ctx.get('fs'), caller: 'issue-detail-select', timers: { setTimeout: (fn,ms)=>timer.timeout(fn,ms), clearTimeout: (id)=>{try{clearTimeout(id)}catch{}} }, exec: async function(cmd, args, opts){ const argv=[String(cmd)].concat(args||[]); const c=(opts&&opts.cwd)||cwd; const r=await execProc(argv, c, 'snapshot-select'); if(!r.ok) throw new Error(r.error||String(r.code||'exec failed')); return { stdout:r.text, text:r.text, ok:true, code:r.code } } }
          // 能力诊断计数（G5 仅诊断，不驱动隐藏）——按 host 视角 fill 统计
          const capCount = (function(iss){
            let present=0, emptyCnt=0, missing=0
            // 简易：以 labels 为例，其余字段按 shape 能力字段集计数
            const fields=['author','assignees','labels','milestone','customFields','reason','blockedBy','comments','closedAt']
            iss.forEach(function(it){
              fields.forEach(function(f){
                if (it[f] === undefined) missing++
                else if (Array.isArray(it[f]) && it[f].length===0) emptyCnt++
                else if (it[f]===null || it[f]==='') emptyCnt++
                else present++
              })
            })
            return {present, empty: emptyCnt, missing}
          })(issues)
          // select 三级联（2026-08-28 真源统一）：快照 selection 与 wf.chain/wf.detect 同构——
          //   经 detectionService 判定（explicit 主锚 → matches → fallback），主锚是权威。
          //   此前快照裸 registry.select 不读主锚：「GitHub 版锚 + 非 git 目录」在快照侧判 fallback null，
          //   客户端保留旧 markdown 意向 → 头部 chip=Markdown 与环境检查=github（链按锚判定）互相矛盾（用户观察）。
          const selMod = await deps.getDetectionService().then(function(svc){ return svc.detect({ cwd }, { skipSkillProbes: true, hintBackendId: hintBackendId || undefined }) }).catch(function(){ return null })
          let sel = selMod && selMod.selection
          // #297 失效维度：显式空（source explicit + null）是权威“无后端”（空目录 stale），不退回裸 select，否则旧绑定会复活
          if (!sel || (sel.backendId == null && (!sel.source || sel.source !== 'explicit'))) {
            // detect 无结论（fallback null / 服务不可用）：退回裸 select（bind 记忆 → matches）兼容旧行为
            try { sel = await reg.select(handle, ctxSel) } catch (eSel) { sel = null }
          }
          selection = sel
          if (sel && sel.backendId) {
            try { repository = reg.describe(handle, sel.backendId) } catch {}
            // 2026-08-28 加固（Dock「后端名 · 目录名」兜底根因）：describe 以 handle.refId 为准，handle 无 refId 时退化为
            //   「目录名 + 无 url」——正常 GitHub 仓库也会因临时 fs/git 读取差异落入该弱结果，UI 头部只剩兜底形态。
            //   refId/name 是身份真相（url 才受 links.repoUrlTemplate 意愿位约束）：getRepoKey 可解析即无条件补全 owner/name。
            if ((!repository || !repository.refId) && repo && repo.owner) {
              try { repository = reg.describe({ cwd: cwd, refId: repo.owner + '/' + repo.name }, sel.backendId) } catch (eDesc2) {}
            }
            if ((!repository || !repository.refId) && repo && repo.owner) {
              try { repository = { backend: sel.backendId, refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: '' } } catch (eD2) {}
            }
            // 2026-08-28 契约修正（用户复核）：仓库名一律由后端 describe 经契约层产出，UI 层零派生——
            //   markdown 本地形态（目录即仓库）同样经 describe 给出 name=目录名；describe 异常/弱结果时
            //   host 侧按目录名兜底（数据产生在半，UI 直显），绝不把「前端拼装」当作仓库身份来源。
            if (!repository) {
              try { repository = reg.describe({ cwd: cwd, refId: cwd }, sel.backendId) } catch (eNa) {}
            }
            if (!repository) {
              try {
                const nm = String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || sel.backendId
                repository = { backend: sel.backendId, refId: String(cwd || ''), name: nm, url: '' }
              } catch (eNb) {}
            }
            // #231：后端特判删除 —— 是否补链由该后端 links.repoUrlTemplate 意愿位声明；补全走其自身 describe（单源产出 refId/name/url）
            if (repository && !repository.url && sel.backendId && repo && repo.owner) {
              var wantsUrlSeed = false
              try {
                var modsHere = (reg && typeof reg.modules === 'function') ? reg.modules() : []
                for (var mi = 0; mi < modsHere.length; mi++) {
                  if (modsHere[mi] && modsHere[mi].id === sel.backendId && modsHere[mi].links && modsHere[mi].links.repoUrlTemplate) { wantsUrlSeed = true; break }
                }
              } catch (eSeed) {}
              if (wantsUrlSeed) { try { repository = reg.describe({ cwd: cwd, refId: repo.owner + '/' + repo.name }, sel.backendId) } catch (eDesc) {} }
            }
          } else {
            // fallback（无选择）时诚实占位：不带任何品牌 url，UI 按「无链接」渲染
            if (repo) repository = { backend: '', refId: repo.owner + '/' + repo.name, name: repo.owner + '/' + repo.name, url: '' }
            else repository = null
          }
          // 能力计数挂到 snapshot 供 ChecksTab 诊断卡
          var _capDiag = capCount
        }
      } catch (e) { /* 保持 null，不阻塞快照 */ }
      // #191: backendModules 透传（presentation 色板）—— 修复 ReferenceError: backendModules is not defined (#195 遗漏)
      let backendModules = null
      try {
        const regM = await getTrackerRegistry()
        if (regM && typeof regM.modules === 'function') {
          // 2026-08-28 修复：快照 backendModules 必须与 wf.registry 上报同构（含 setupPrompt 键表）——
          //   缺 setupPrompt 时 setupRunParamsFrom 匹配不到该后端 → 注入的 setup 提示词落回默认键组（GitHub 版），
          //   表现为「选了 gitlab/markdown，点初始化按钮注入的却还是默认 GitHub」（用户观察）。
          backendModules = regM.modules().map(function (m) { return Object.assign({ id: m.id, label: m.label, presentation: m.presentation }, m.links ? { links: m.links } : {}, m.capabilities ? { capabilities: m.capabilities } : {}, m.prompts ? { prompts: m.prompts } : {}, m.setupPrompt ? { setupPrompt: m.setupPrompt } : {}, m.labelPalette ? { labelPalette: m.labelPalette } : {}, m.openRepository ? { openRepository: m.openRepository } : {}) })
        }
      } catch (e2) {}
      return {
        ok: true,
        repo: repo,
        repoRoot: await getRepoRoot(cwd),  // v1.5 T9：git 根路径（供仓库身份组件与 setup 检查）
        updatedAt: new Date().toISOString(),
        generatedMs: Date.now(),
        env: { ghPath: getGhPath(), ghError: getGhLastError() },
        maps: maps,
        issues: issues,
        labels: labels,
        fallback: d.fallback || null,  // v1.5 B5：'rest' = GraphQL 配额耗尽已降级 REST（client 可提示）
        repository: repository,
        backendModules: backendModules,
        selection: selection,
        capabilities: (typeof _capDiag !== 'undefined' ? _capDiag : null),
        viewer: viewer, // 后端接口返回当前用户（Actor），UI 据此做“本人不显”对比
        viewerLogin: viewerLogin, // 兼容旧 UI（string），与 viewer.login 同步
      }
    }


  return { fetchMapsDetail, buildSnapshot }
}
