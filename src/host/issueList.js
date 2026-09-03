// src/host/issueList.js —— 列表与地图降级拉取（H2 #446 从 host/index.js 246–455/475–488/491–536 搬出，纯结构、行为零变化）。
// 以后谁改它：改列表拉取分页策略、全量索引或缓存有效性的人。预估约 300 行，超 350 打回。
// 接线：由 index.js 动态 import 加载；getRepoKey/runGh/setCache 与三个索引小函数显式注入；本文件不引用其他新文件。
export function createIssueList(deps) {
  const { getRepoKey, runGh, setCache, issueIndexFromSnapshot, issueIndexChanged, rememberIssueIndex } = deps
    async function fetchMaps(cwd) {
      // #44 T2-fix（map#37）：显式 --repo 绕过 gh 在 Fork 上的多远程推断（upstream 优先）
      const repo = await getRepoKey(cwd)
      const argsMap = ['issue', 'list', '--state', 'open', '--label', 'wayfinder:map', '--json', 'number,title,body,labels,assignees,state,updatedAt']
      if (repo) argsMap.push('--repo', repo.owner + '/' + repo.name)
      const r = await runGh(argsMap, cwd)
      if (!r.ok) return { ok: false, error: r }
      try { return { ok: true, maps: JSON.parse(r.text) } } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }

    // 手动分页兜底：gh api --paginate 在本机偶发 unexpected EOF 时，按页拉取避免单页失败拖垮全量
    // 首选 --paginate 成功即走快路径；失败则按 page=1..N 逐页拉，单页失败若有 text 则解析该页部分数据，否则中断
    // 该路径在 4c6508c 的 100 截断基础上补全全量，避免 100 截断导致旧票丢失（回归风险）
    async function fetchAllIssuesManual(cwd, repo) {
      if (!repo) return { ok: false, error: { kind: 'env', error: 'missing repo' } };
      let all = [];
      for (let page = 1; page <= 10; page++) {
        const url = 'repos/' + repo.owner + '/' + repo.name + '/issues?state=all&per_page=100&page=' + page;
        const r = await runGh(['api', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}'], cwd);
        const raw = r && (r.ok ? r.text : (r.text || ''));
        if (!raw || !String(raw).trim()) { if (page === 1) return { ok: false, error: r }; break; }
        try {
          const txt = String(raw).trim();
          let arr = [];
          if (txt.startsWith('[')) { try { arr = JSON.parse(txt); } catch {} }
          if (!arr.length && txt) {
            const lines = txt.split('\n').filter(function(s){return s.trim();});
            for (let i=0;i<lines.length;i++) { try { const o=JSON.parse(lines[i]); if(o && typeof o.number==='number') arr.push(o); } catch(e){} }
            if (!arr.length) { try { arr = JSON.parse('['+lines.join(',')+']'); } catch(e){} }
          }
          if (!arr.length) { if (page===1) return { ok:false, error: r }; break; }
          const issues = arr.map(function(x){ return { number:x.number, title:x.title, state:(String(x.state).toLowerCase()==='closed'?'CLOSED':'OPEN'), assignees:(x.assignees||[]).map(function(a){return a.login;}), labels:(x.labels||[]).map(function(l){return {name:l.name,color:l.color||''};}), author:(x.user&&x.user.login)?{login:x.user.login,name:(x.user.name||''),avatarUrl:(x.user.avatar_url||'')}:undefined, updatedAt:x.updated_at, createdAt:x.created_at }; });
          all = all.concat(issues);
          if (arr.length < 100) break;
        } catch (e) { if (page===1) return { ok:false, error: r }; break; }
        if (!r.ok) break;
      }
      if (all.length) { all.sort(function(a,b){ return String(b.updatedAt).localeCompare(String(a.updatedAt)); }); return { ok:true, issues: all }; }
      return { ok:false, error:{kind:'empty', error:'manual paginate empty'} };
    }
    async function fetchAllIndexManual(cwd, repo) {
      if (!repo) return { ok:false, error:{kind:'env', error:'missing repo'} };
      let idx = {};
      for (let page=1; page<=10; page++) {
        const url = 'repos/' + repo.owner + '/' + repo.name + '/issues?state=all&per_page=100&page=' + page;
        const r = await runGh(['api', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, state: .state, updatedAt: .updated_at}'], cwd);
        const raw = r && (r.ok ? r.text : (r.text||''));
        if (!raw || !String(raw).trim()) { if(page===1) return {ok:false, error:r}; break; }
        try {
          const txt = String(raw).trim();
          let arr = [];
          if (txt.startsWith('[')) { try{ arr=JSON.parse(txt);}catch{} }
          if (!arr.length && txt) {
            const lines = txt.split('\n').filter(Boolean);
            for(let i=0;i<lines.length;i++){ try{ const o=JSON.parse(lines[i]); if(o&&o.number!=null) arr.push(o);}catch(e){} }
            if(!arr.length){ try{ arr=JSON.parse('['+lines.join(',')+']');}catch(e){} }
          }
          if (!arr.length) { if(page===1) return {ok:false, error:r}; break; }
          for(let i=0;i<arr.length;i++){ const it=arr[i]; if(it&&it.number!=null) { idx[String(it.number)] = String(it.state||'').toUpperCase() + '|' + String(it.updatedAt||''); } }
          if (arr.length < 100) break;
        } catch(e){ if(page===1) return {ok:false, error:r}; break; }
        if (!r.ok) break;
      }
      if (Object.keys(idx).length) return { ok:true, repo:repo, index:idx, count:Object.keys(idx).length };
      return { ok:false, error:{kind:'empty', error:'manual index empty'} };
    }
    // 全部 issue（open + closed，Client 列表 open 常显、底部「已关闭」折叠行），
    // 按 updatedAt 倒序；labels 带 name + color（GitHub 配置色）；state 区分 open/closed；
    // v18：assignees 带出（状态栏「占用」按列表 issue 口径：已认领 + 被阻塞）
    async function fetchIssues(cwd) {
      // #374/#375：--limit 500 覆盖仓库全量，并带出 createdAt；为取 author.avatarUrl 改用 gh api（gh issue list 的 author 不含 avatarUrl，见 b7442da 后用户反馈“未显示真人头像”）
      //   gh api repos/.../issues?state=all&per_page=100 --paginate 直接给出 user.avatar_url，零额外 user 查询
      // #44 T2-fix：显式 --repo 绕过多远程推断
      const repo2 = await getRepoKey(cwd)
      // 优先 gh api（带 avatar）
      if (repo2) {
        const apiUrl = 'repos/' + repo2.owner + '/' + repo2.name + '/issues?state=all&per_page=100'
        const r2 = await runGh(['api', '--paginate', apiUrl, '--jq', '.[] | select(.pull_request == null) | {number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}'], cwd)
        if (r2.ok) {
          try {
            const text = String(r2.text || '').trim()
            // --jq 输出为 JSON Lines（每行一个对象），非数组；兼容数组与单对象两种
            let arr = []
            if (text.startsWith('[')) arr = JSON.parse(text)
            else if (text) {
              const lines = text.split('\n').filter(function(s){return s.trim()})
              for (let i=0;i<lines.length;i++) { try{ const o=JSON.parse(lines[i]); if(o && typeof o.number==='number') arr.push(o)}catch(e){} }
              if (!arr.length) { try{ arr = JSON.parse('['+lines.join(',')+']')}catch(e){} }
            }
            const issues = arr.map(function (x) {
              return {
                number: x.number,
                title: x.title,
                state: (String(x.state).toLowerCase()==='closed' ? 'CLOSED' : 'OPEN'),
                assignees: (x.assignees || []).map(function (a) { return a.login }),
                labels: (x.labels || []).map(function (l) { return { name: l.name, color: l.color || '' } }),
                author: (x.user && x.user.login) ? { login: x.user.login, name: (x.user.name || ''), avatarUrl: (x.user.avatar_url || '') } : undefined,
                updatedAt: x.updated_at,
                createdAt: x.created_at,
              }
            })
            issues.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)) })
            if (issues.length) return { ok: true, issues: issues }
          } catch (e) { /* fall through to gh issue list */ }
        }
      }
      // 手动分页兜底：--paginate 失败时按页拉取全量，避免 100 截断丢失旧票
      if (repo2) {
        try {
          const manual = await fetchAllIssuesManual(cwd, repo2);
          if (manual.ok && manual.issues && manual.issues.length) return manual;
        } catch (e) {}
      }
      // 回退：gh issue list（无 avatar，仅 login；UI 将回退为 person SVG）
      // 修复 unexpected EOF：500 在部分网络下触发 GraphQL 大查询 EOF，回退改用 100 并重试一次
      const tryList = async function(limit) {
        const a = ['issue', 'list', '--state', 'all', '--limit', String(limit), '--json', 'number,title,labels,state,assignees,author,updatedAt,createdAt']
        if (repo2) a.push('--repo', repo2.owner + '/' + repo2.name)
        return runGh(a, cwd)
      }
      let r = await tryList(100)
      if (!r.ok && String(r.error||'').toLowerCase().includes('unexpected eof')) {
        r = await tryList(100)
      }
      if (!r.ok) {
        // 500 回退已不可靠，改用 open 100 再 all 100 的分段拉取（open 100 必含 414 这类新 open 票）
        const rOpen = await runGh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,labels,state,assignees,author,updatedAt,createdAt', '--repo', repo2.owner + '/' + repo2.name], cwd)
        if (rOpen.ok) r = rOpen
      }
      if (!r.ok) return { ok: false, error: r }
      try {
        const all = JSON.parse(r.text)
        const issues = all.map(function (x) {
          return {
            number: x.number,
            title: x.title,
            state: x.state,
            assignees: (x.assignees || []).map(function (a) { return a.login }),
            labels: (x.labels || []).map(function (l) { return { name: l.name, color: l.color || '' } }),
            author: (x.author && x.author.login) ? { login: x.author.login, name: (x.author.name || ''), avatarUrl: (x.author.avatarUrl || x.author.avatar_url || '') } : undefined,
            updatedAt: x.updatedAt,
            createdAt: x.createdAt,
          }
        })
        issues.sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)) })
        return { ok: true, issues: issues }
      } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }

    // #2 deletion fix：轻量全量索引用于发现删除、关闭和重开。
    async function fetchIssueIndex(cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo' } }
      const url = 'repos/' + repo.owner + '/' + repo.name + '/issues?state=all&per_page=100'
      const r = await runGh(['api', '--paginate', url, '--jq', '.[] | select(.pull_request == null) | {number: .number, state: .state, updatedAt: .updated_at}'], cwd)
      // 优先解析 gh api 的输出，即使 r.ok===false 但 text 中已有部分数据（如 414/415 在前两页已返回，仅第3页 unexpected EOF 导致 exit 1），也尝试解析，避免因单页网络抖动就判 unknown 回旧
      const tryParseIndex = function(text) {
        try {
          const index = {}
          const lines = String(text || '').split(/\r?\n/).filter(Boolean)
          lines.forEach(function (line) {
            try { const item = JSON.parse(line); if (item && item.number !== undefined && item.number !== null) index[String(item.number)] = String(item.state || '').toUpperCase() + '|' + String(item.updatedAt || '') } catch {}
          })
          if (Object.keys(index).length) return { ok: true, repo: repo, index: index, count: Object.keys(index).length }
        } catch {}
        return null
      }
      if (r && r.text) {
        const parsed = tryParseIndex(r.text)
        if (parsed) return parsed
      }
      if (!r.ok) {
        // 手动分页兜底：优先按页拉全量索引，避免 100 截断丢失旧票（如删除检测）
        try {
          const manualIdx = await fetchAllIndexManual(cwd, repo);
          if (manualIdx.ok && manualIdx.index && Object.keys(manualIdx.index).length) return manualIdx;
        } catch (e) {}
        // 回退：gh api 整体失败时，用 gh issue list 全量兜底（与 fetchIssues 同策略），确保外部建票 60s 内可被发现
        // 500 在部分网络下触发 unexpected EOF，改用 100 并重试
        let fallback = await runGh(['issue', 'list', '--state', 'all', '--limit', '100', '--json', 'number,state,updatedAt'], cwd)
        if (!fallback.ok && String(fallback.error||'').toLowerCase().includes('unexpected eof')) {
          fallback = await runGh(['issue', 'list', '--state', 'all', '--limit', '100', '--json', 'number,state,updatedAt'], cwd)
        }
        if (!fallback.ok) {
          fallback = await runGh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,state,updatedAt'], cwd)
        }
        const fbParsed = fallback && fallback.text ? tryParseIndex(fallback.text.replace(/\[|\]/g, '').split('},').join('}\n')) : null
        // 更稳妥的 fallback 解析：直接 JSON 数组
        try {
          if (fallback && fallback.ok && fallback.text) {
            const arr = JSON.parse(fallback.text)
            if (Array.isArray(arr) && arr.length) {
              const idx = {}
              arr.forEach(function(it){ if(it && it.number!=null) idx[String(it.number)] = String(it.state||'').toUpperCase() + '|' + String(it.updatedAt||'') })
              if (Object.keys(idx).length) return { ok: true, repo: repo, index: idx, count: Object.keys(idx).length }
            }
          }
        } catch {}
        return { ok: false, error: r }
      }
      try {
        const index = {}
        const lines = String(r.text || '').split(/\r?\n/).filter(Boolean)
        lines.forEach(function (line) {
          const item = JSON.parse(line)
          if (item && item.number !== undefined && item.number !== null) index[String(item.number)] = String(item.state || '').toUpperCase() + '|' + String(item.updatedAt || '')
        })
        return { ok: true, repo: repo, index: index, count: Object.keys(index).length }
      } catch (e) { return { ok: false, error: { kind: 'parse', error: String(e) } } }
    }
    // ---- 原 index.js 475–488：缓存有效性判断与快照落盘收纳 ----
    const cacheSnapshotIsCurrent = async function (snap, cwd) {
      try {
        const remote = await fetchIssueIndex(cwd)
        if (!remote.ok) return null
        const current = !issueIndexChanged(issueIndexFromSnapshot(snap), remote.index)
        if (current) rememberIssueIndex(remote.repo, remote.index)
        return current
      } catch (e) { return null }
    }
    const adoptSnapshot = function (snap, cwd) {
      setCache({ ts: Date.now(), snapshot: snap, error: null, cwd: cwd })
      if (snap && snap.repo) rememberIssueIndex(snap.repo, issueIndexFromSnapshot(snap))
      return snap
    }
    // ---- 原 index.js 491–536：配额耗尽时地图详情 REST 降级通道 ----
    // v1.5 B5（配额止血 · 第一性原理）：GraphQL 配额耗尽时的 REST 降级通道 ——
    //   GraphQL 按复杂度计点（5000 点/h，aliases 大查询一次可数百点），REST 按请求计次
    //   （5000 次/h，与复杂度无关）。配额耗尽时 GraphQL 全挂，REST 仍可用 → 面板不空白。
    //   逐 map：issue 详情 + sub_issues + 每子票 blocked_by（client 只消费 blockedBy，
    //   blocking 不组装省一半请求）；输出与 GraphQL 同构的 { 'm<i>': {...} }，下游 mapTicket 零改动。
    async function fetchMapsDetailREST(numbers, cwd) {
      const repo = await getRepoKey(cwd)
      if (!repo) return { ok: false, error: { kind: 'env', error: '无法解析 owner/repo' } }
      if (!numbers || !numbers.length) return { ok: true, issues: {} }
      const issues = {}
      for (let i = 0; i < numbers.length; i++) {
        const n = numbers[i]
        try {
          const d = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n], cwd)
          if (!d.ok) { issues['m' + i] = null; continue }
          const m = JSON.parse(d.text)
          const sub = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + n + '/sub_issues?per_page=100'], cwd)
          const subs = sub.ok ? (JSON.parse(sub.text) || []) : []
          const nodes = []
          for (let k = 0; k < subs.length; k++) {
            const s = subs[k]
            let blockedBy = []
            try {
              const bb = await runGh(['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + s.number + '/dependencies/blocked_by'], cwd)
              if (bb.ok) blockedBy = (JSON.parse(bb.text) || []).map(function (x) { return x.number })
            } catch (e2) { /* 依赖查询失败该票 blockedBy 置空，不阻塞整体 */ }
            nodes.push({
              number: s.number, title: s.title, state: (s.state === 'closed' ? 'CLOSED' : 'OPEN'),
              body: s.body || '', url: s.html_url || ('https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + s.number),
              labels: { nodes: (s.labels || []).map(function (l) { return { name: l.name } }) },
              assignees: { nodes: (s.assignees || []).map(function (a) { return { login: a.login } }) },
              author: (s.user && s.user.login) ? { login: s.user.login, name: (s.user.name || ''), avatarUrl: (s.user.avatar_url || '') } : undefined,
              blockedBy: { nodes: blockedBy.map(function (b) { return { number: b } }) },
            })
          }
          issues['m' + i] = {
            number: m.number, title: m.title, state: (m.state === 'closed' ? 'CLOSED' : 'OPEN'),
            body: m.body || '', url: m.html_url || ('https://github.com/' + repo.owner + '/' + repo.name + '/issues/' + m.number),
            labels: { nodes: (m.labels || []).map(function (l) { return { name: l.name } }) },
            author: (m.user && m.user.login) ? { login: m.user.login, name: (m.user.name || ''), avatarUrl: (m.user.avatar_url || '') } : undefined,
            subIssues: { totalCount: nodes.length, nodes: nodes },
          }
        } catch (e) { issues['m' + i] = null }
      }
      return { ok: true, issues: issues, fallback: 'rest' }
    }
  return { fetchMaps, fetchAllIssuesManual, fetchAllIndexManual, fetchIssues, fetchIssueIndex, cacheSnapshotIsCurrent, adoptSnapshot, fetchMapsDetailREST }
}
