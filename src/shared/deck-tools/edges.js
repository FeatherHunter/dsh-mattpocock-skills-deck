// src/shared/deck-tools/edges.js —— 边的落点判定与逐项证据（#713 第六批）
//
// 这个文件只回答一个问题：**这条关系落在哪里？** 它是票面「每条边在返回里标出落点（原生层级 /
// 平级链接 / 正文行 / 票文件注释）；做不到如实说」那条硬要求的落地处。
//
// 一条铁律：只看证据，不看是哪个后端。工具层里不许出现「后端 id 等于 github 就怎样」这种判断
//（验收脚本会静态扫描 src/host/tools/** 与 src/shared/deck-tools/**），所以这里的每一档都由
// 「契约返回的结构字段里有没有、票的正文里有没有那一行」推出来，推不出来就说「说不好」。
//
// 为什么和 shell.js 分成两个文件：仓库有一个 350 行的单文件上限（tests/verify-file-granularity.js），
// 而共享层的文件之间不许互相 import（tests/verify-no-same-layer-import.js），所以只能拆成两半、
// 各自自足：规矩（落点、逐项、必备标签）在 edges.js 与 plan.js，机制（会话、过闸、三态信封）在 shell.js。
function str(v) { return (typeof v === 'string') ? v : '' }

/** 一条边落到哪里（票面要求每条边在返回里标出落点）。后四个是「说不好」与「做不到」，不假装知道。 */
export const EDGE_LANDING = Object.freeze({
  NATIVE_PARENT: '原生层级',
  NATIVE_BLOCK: '原生依赖边',
  PEER_LINK: '平级链接',
  BODY_LINE: '正文行',
  FILE_NOTE: '票文件注释',
  CONTRACT_PARENT_FIELD: '契约的父子列（分不出是原生层级还是平级链接，别把它当成原生层级）',
  CONTRACT_BLOCK_FIELD: '契约的依赖列（分不出是原生边还是正文行）',
  UNSUPPORTED: '做不到',
  UNKNOWN: '说不好（这次没读回来，别当它已经建好）',
})

/**
 * 落点判定：证据分五档，从最硬到最软：
 *   native      后端把这条关系放进了**它自己的原生结构**里（GitHub 的 sub-issues 层级、原生依赖边）。
 *   peer-link   写进去的是**平级链接**（GitLab 的 relates_to 就是这一档）。
 *   body-line   落在票的**正文**里（本地 Markdown 的 Blocked by 那一行、以及远端后端的兜底写法）。
 *   file-note   落在**票文件的注释/清单**里（本地 Markdown 的单根工作区就是这样表达归属的）。
 *   contract    只知道「契约返回的结构字段里有这条关系」，分不出上面哪一档 —— 这时如实说分不出。
 * 反证方向：把 evidence 里那一档去掉，落点就必须从具体档退到 contract 或说不好，绝不许默认升成原生。
 */
export function landingOf(op, evidence) {
  const kind = str((evidence || {}).kind)
  if (kind === 'unsupported') return EDGE_LANDING.UNSUPPORTED
  if (kind === 'native') return op === 'block' ? EDGE_LANDING.NATIVE_BLOCK : EDGE_LANDING.NATIVE_PARENT
  if (kind === 'peer-link') return EDGE_LANDING.PEER_LINK
  if (kind === 'body-line') return EDGE_LANDING.BODY_LINE
  if (kind === 'file-note') return EDGE_LANDING.FILE_NOTE
  if (kind === 'contract') return op === 'block' ? EDGE_LANDING.CONTRACT_BLOCK_FIELD : EDGE_LANDING.CONTRACT_PARENT_FIELD
  return EDGE_LANDING.UNKNOWN
}

/** 一条边的证据长什么样（逐条列在返回里，AI 与人都能对账）。 */
export function edgeEvidence(op, target, evidence, extra) {
  const ev = evidence || {}
  return Object.assign({
    op: op,
    target: String(target || ''),
    landing: landingOf(op, ev),
    evidence: str(ev.text) || (str(ev.kind) === 'unsupported' ? '后端原话：做不到' : '这次没有拿到能判落点的证据'),
    ok: ev.ok !== false,
  }, extra || {})
}

/** 从票的返回里读出关系所在的字段（读路径用；只看字段有没有，不看后端是谁）。 */
export function relationsOf(issue, dependencies) {
  const i = issue || {}
  const dep = dependencies || {}
  const keys = (list) => (Array.isArray(list) ? list.map((r) => (r && typeof r.key === 'string') ? r.key : String(r || '')).filter(Boolean) : [])
  return {
    parentKey: (i.parentKey === undefined || i.parentKey === null || i.parentKey === '') ? '' : String(i.parentKey),
    blockedBy: keys(dep.blockedBy || i.blockedBy),
    blocking: keys(dep.blocking || i.blocking),
  }
}

/**
 * 正文里有没有指向某张票的**引用**（本地 Markdown 的 `Blocked by: #03`、远端后端的兜底写法、
 * 以及把父票备注写进正文的那些写法都长这样）。
 *
 * 只认带标记的引用形态（`#3`、`issues/3`），不认「正文里随便出现一个数字 3」：
 * 建票时正文里会带我们自己的幂等锚（一串带数字的随机串），松判会把锚里的数字当成引用，
 * 于是每一条边都会被误判成「落在正文里」——这条线是拿真实返回试出来的，不要放宽。
 */
export function bodyRefersTo(body, key) {
  const text = str(body)
  const k = str(key).trim()
  if (!text || !k) return false
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp('(?:#|issues/|/issues/|票\\s*|第\\s*)' + esc + '(?![0-9])').test(text)
  } catch (e) { return false }
}

/**
 * 写完之后读回一次，判这一条边落在哪一列。判据只有两样：契约返回的结构字段、票的正文。
 *
 * 阻塞边能判得更细，靠的是一条真实的证据：**这条依赖在不在票的正文里**。
 *   结构字段里有、正文里没有 → 后端把它放在自己的原生边上（GitHub 的 dependencies）；
 *   正文里也有那一行        → 后端是把关系写在正文里的（本地 Markdown，以及远端后端的兜底写法）。
 * 父子边就判不到这么细：「原生层级」与「平级链接」在契约返回里长得一模一样（都归一进 parentKey），
 * 所以这一档只报到「契约的父子列」，绝不硬猜成原生层级 —— 精确的落点由验收脚本按真实后端跑出来的
 * 「同一个动作在三种后端上分别落到哪里」那张对照表回答（tests/verify-deck-tools-matrix.js）。
 */
export function classifyEdgeLanding(op, target, after) {
  const a = after || {}
  const want = str(target)
  const rel = relationsOf(a.issue || a, a.dependencies)
  const body = str((a.issue && a.issue.body) !== undefined ? a.issue.body : a.body)
  const bodyHas = bodyRefersTo(body, want)
  if (op === 'block') {
    const inField = rel.blockedBy.indexOf(want) >= 0
    if (inField && !bodyHas) return { kind: 'native', ok: true, text: '写后读回：结构字段里有这条依赖、正文里没有那一行（后端把它放在自己的原生边上）' }
    if (inField && bodyHas) return { kind: 'body-line', ok: true, text: '写后读回：结构字段里有这条依赖，正文里也写着指向 #' + want + ' 的一行（这是把关系写进正文的那种落法）' }
    if (!inField && bodyHas) return { kind: 'body-line', ok: true, text: '写后读回：结构字段里没有这条依赖，正文里有指向 #' + want + ' 的一行 —— 它只落在正文里' }
    return { kind: 'unknown', ok: true, text: '写后读回：结构字段与正文里都没找到指向 #' + want + ' 的这条依赖' }
  }
  if (rel.parentKey === want) return { kind: 'contract', ok: true, text: '写后读回：票的 parentKey = ' + want + '（契约把父子放在这一列，分不出原生层级还是平级链接）' }
  if (bodyHas) return { kind: 'body-line', ok: true, text: '写后读回：结构字段里没有父子，正文里出现了指向 #' + want + ' 的一行' }
  return { kind: 'unknown', ok: true, text: '写后读回：结构字段与正文里都没找到这条父子关系' }
}

/** 后端自己说做不到时，落点那一格照它的原话写，不翻译、不改写。 */
export function unsupportedEvidence(message) {
  return { kind: 'unsupported', ok: false, text: '后端原话：' + (str(message) || '这个后端做不到这条操作') }
}

/**
 * 从一份清单里挑出真属于这张地图的子票。
 *
 * 这一步为什么不能省：契约的 `list(repo, {parentKey})` 在三个后端上并不是「按父票筛」的同一种东西
 * —— 有的后端回的就是全部票（由宿主侧再筛），有的后端要另去取它自己的结构（GitHub 的 sub_issues）。
 * 所以这里按「行上有没有父子信息」判：带了 parentKey 就照它筛，没带就原样用，并把这件事如实说出来。
 * 宁可让调用方知道这份清单不精确，也不要静默地把它当成精确的。
 */
export function childrenOf(rows, mapKey) {
  const list = Array.isArray(rows) ? rows : []
  const anyInfo = list.some((r) => r && r.parentKey !== undefined && r.parentKey !== null && r.parentKey !== '')
  if (!anyInfo) {
    return { children: list, filtered: false, note: '这个后端的清单接口没带父子信息（它回的是一批票、不是按父票筛过的），下面的子票清单是按原文列的：要精确的子票清单，请逐张用 deck_issue_get 看 parentKey。' }
  }
  return { children: list.filter((r) => r && String(r.parentKey) === String(mapKey)), filtered: true, note: '' }
}

/** 一批里有的成、有的没成时，这条总结论是 partial；全成是 ok；全没成是 unsupported。 */
export function statusOfItems(items) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return 'ok'
  const failed = list.filter((i) => i && i.status !== 'ok').length
  if (failed === 0) return 'ok'
  return failed === list.length ? 'unsupported' : 'partial'
}
