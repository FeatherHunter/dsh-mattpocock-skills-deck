// src/host/refresh/fetchThinRows.ts —— 行级增量的取数三件套（#1255 从 patch.ts 拆出）
//
// 为什么单列：取数（发请求、拼行）与合并（水印、待办、世代）是两件事。
// 取数这边只认三样：发请求的宿主句柄、计数表、工作区标识，全由调用方以参数注入；
// 合并那边的状态（快照、水印、待办）一件都不碰。调用方（patch.ts 的 run）只认回包形状：
//   回 { ok:true, rows, queries }，或 { ok:false, outcome:'deferred'|'dropped'|'failed', keys }。
// 本文件不 import 宿主其它模块，免得接出环（patch.ts 头注释里的那条分工仍在）。
//
// 口径（从 patch.ts 原样搬来，行为一字未动）：
//   · 一条薄查询：只问这一张票的行数据（一条出站请求），字段与全量取数那份同形，
//     免得并进列表之后同一行有两种形状（界面在两种形状之间摇摆是最难查的一类错）；
//   · 一条没取到就整批不并（定稿第十一章点名的那个静默漏报）：只并进去一半、却把水印推走，
//     剩下那几条变化就再也发现不了了；
//   · 这是 REST 那一路（每张票一条 `gh api repos/.../issues/N`），桶明确写 rest：
//     闸的 BUCKET_OF_KIND 把 kind=patch 归在 graphql（那是「一条带别名的薄查询」那种实现）——
//     本实现走的是每票一条 REST，如实报 rest 才不会把「几条请求」记成「几点」（两桶互不折算）。

/**
 * 取数要用的三样：发请求的宿主句柄（runGh/send，原样透传调用语义）、
 * 计数表（门禁与现场排查都读它）、工作区标识。全部由 patch.ts 接线处传入。
 */
export interface ThinFetchEnv {
  host: { runGh: (args: string[], cwd: string) => any; send?: (req: any, perform: () => Promise<any>) => any }
  stats: { thinQueries: number }
  wsKeyOf: (cwd: string) => string
}

/**
 * 一条薄查询：只问这一张票的行数据（一条出站请求）。字段与全量取数那份同形，
 * 免得并进列表之后同一行有两种形状（界面在两种形状之间摇摆是最难查的一类错）。
 */
function thinArgs(repo: any, number: any): string[] {
  return ['api', 'repos/' + repo.owner + '/' + repo.name + '/issues/' + number,
    '--jq', '{number: .number, title: .title, state: .state, labels: .labels, assignees: .assignees, user: .user, updated_at: .updated_at, created_at: .created_at}']
}

/** 把一条薄查询的回包转成列表里那一行的形状（与 src/host/issueList.js 的 fetchIssues 同口径）。 */
function rowOf(x: any): any {
  return {
    number: x.number,
    title: x.title,
    state: (String(x.state).toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN'),
    assignees: (x.assignees || []).map(function (a: any): any { return a.login }),
    labels: (x.labels || []).map(function (l: any): any { return { name: l.name, color: l.color || '' } }),
    author: (x.user && x.user.login) ? { login: x.user.login, name: (x.user.name || ''), avatarUrl: x.user.avatar_url || '' } : undefined,
    updatedAt: x.updated_at,
    createdAt: x.created_at,
  }
}

/**
 * 取那几条：一条一请求，多条同时发（闸那边不再排队，见 gate.js）。
 * 回 { ok:true, rows, queries }，或 { ok:false, outcome:'deferred'|'dropped'|'failed', keys }。
 *
 * 一条没取到就整批不并 —— 这是本文件最要紧的一条判断：只并进去一半、却把水印推走，
 * 剩下那几条变化就再也发现不了了（正是定稿第十一章点名的那个静默漏报）。
 * 并行只管取数，并不并由同一条判断决定：有任何一条没取到，整批都不并、水印不动。
 */
export async function fetchThinRows(env: ThinFetchEnv, cwd: any, repo: any, keys: any): Promise<any> {
  // 一次薄查询的计数进这一条路的账（门禁与现场排查读 stats.thinQueries）。
  const one = async (k: any): Promise<any> => {
    let captured: any = null
    const perform = async function (): Promise<any> {
      env.stats.thinQueries += 1
      captured = await Promise.resolve(env.host.runGh(thinArgs(repo, k), cwd))
      return captured && captured.report ? captured.report : { requests: 1, points: 0 }
    }
    if (typeof env.host.send === 'function') {
      const sent: any = await Promise.resolve(env.host.send({ source: 'patch.apply', kind: 'patch', bucket: 'rest', workspaceKey: env.wsKeyOf(cwd) }, perform))
      if (!sent || sent.sent !== true) return { k: k, bad: { outcome: sent && sent.verdict === 'defer' ? 'deferred' : 'dropped', reason: (sent && sent.reason) || 'deferred' } }
    } else {
      await perform()
    }
    const r: any = await Promise.resolve(captured)
    if (!r || r.ok !== true || !r.text) return { k: k, bad: { outcome: 'failed', reason: 'thin-query-failed' } }
    let parsed: any = null
    try { parsed = JSON.parse(r.text) } catch (e: any) { parsed = null }
    if (!parsed || parsed.number === undefined || parsed.number === null) return { k: k, bad: { outcome: 'failed', reason: 'thin-query-parse' } }
    return { k: k, row: rowOf(parsed) }
  }
  const got: any[] = await Promise.all(keys.map(one))
  const rows: any[] = new Array(keys.length)
  const failedKeys: any[] = []
  let firstBad: any = null
  for (let i = 0; i < got.length; i++) {
    if (got[i].bad) { failedKeys.push(keys[i]); if (!firstBad) firstBad = got[i].bad }
    else rows[i] = got[i].row
  }
  if (firstBad) return { ok: false, outcome: firstBad.outcome, keys: failedKeys, reason: firstBad.reason }
  return { ok: true, rows: rows, queries: keys.length }
}
