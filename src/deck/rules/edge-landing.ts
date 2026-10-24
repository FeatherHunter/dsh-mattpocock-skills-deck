// src/deck/rules/edge-landing.ts —— 边的落点判定（纯规则侧）
//
// 本文件由 src/deck/shell/edge-landing.ts 拆出（#1039 按 #1038 定版：纯侧收
// landingOf / classifyEdgeLanding / bodyRefersTo / hasCycleInAdj 四件里的前三件；
// hasCycleInAdj 是依赖图的算法，搬去同目录的 dependency-graph.ts）。
//
// 这个文件只回答一个问题：**这条关系落在哪里？** 它是票面「每条边在返回里标出落点
//（原生层级 / 平级链接 / 正文行 / 票文件注释）；做不到如实说」那条硬要求的落地处。
//
// 一条铁律：只看证据，不看是哪个后端。纯规则里不许出现「后端 id 等于 github 就怎样」这种判断，
// 所以这里的每一档都由「契约返回的结构字段里有没有、票的正文里有没有那一行」推出来，
// 推不出来就说「说不好」，绝不默认升成「原生层级」。
//
// 纯在哪：只读传进来的对象与字符串，不取会话、不起进程、不读写文件、不读钟。
// 这里没有「类型从契约层拿」的 import：契约（src/tracker/contract/）对 deck 层公开的是
// 运行时常量，没有可导出的类型；而纯规则目录按 #1038 的口径只许引用契约公开面，
// 于是本文件按「我真正会读的那几个字段」收口，抛掉其它一切字段（这正是它好单测的原因）。

/** 拿不准是不是字符串时统一收口成字符串：不是字符串就当空串（调用方各自判空）。 */
function str(v: unknown): string {
  return (typeof v === 'string') ? v : ''
}

/** 按名字取一个未知对象的字段（形状不可信时先收口成对象再读）。 */
function obj(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object') ? v as Record<string, unknown> : {}
}

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
  READ_BACK_MISSING: '读回来了，这条边不在票上（别当它已经建好）',
})

/**
 * 一条边到底落上了没有：只有三种答案，不许用布尔值糊过去。
 *
 * 为什么要有它（#790 的教训）：判断「落上了」曾经是三处各自拼的或表达式 ——
 * 读回里的字段、写动作返回的对象、正文里出现过票号，任意一个成立就算落上。
 * 于是「写成功但读不回来」「正文里作者自己写了一句归属 #78」都会被报成落上。
 * 这里把判据收成一条：**只有写后读回的结构字段能确认一条边落上了**。
 * 写动作的返回值、建票回包里的字段、正文里的字都不是「盘上有这条边」的证据：
 * 它们只允许出现在证据行里（给人看的原话），不许参与三档判决。
 * 读回本身没成（读失败、没读）时一律 unconfirmed —— 既不许报成功，也不许说没落上。
 *
 * 三档的含义：
 *   landed       写后读回的结构字段里确实有这条边（父子的 parentKey、阻塞的 blockedBy）。
 *   not-landed   读回来了，结构字段里确实没有这条边。
 *   unconfirmed  没读到（读失败、没读、或没给目标），所以不知道落上了没有 —— 既不许报成功，也不许说没落上。
 */
export type EdgeVerdict = 'landed' | 'not-landed' | 'unconfirmed'

/**
 * 判一条边落上了没有。`after` 是写后读回的那份结果（`{issue, dependencies}` 形状，也可以直接给票本身）；
 * 传 null / undefined 表示这次没读到，一律回 unconfirmed。
 */
export function edgeVerdict(op: string, target: unknown, after: unknown): EdgeVerdict {
  if (after === null || after === undefined) return 'unconfirmed'
  const want = str(target).trim()
  if (!want) return 'unconfirmed'
  const a = obj(after)
  // 「读回来了」的判据是「这份结果里带着要判的那种结构字段」：读回来的整份结果（{issue, dependencies}）
  // 算读过，直接给票本身（带 parentKey / blockedBy 的行）也算读过 —— 后者是调用方最省事的传法，
  // 漏掉它会把字段明明对得上的读回判成「没读到」（#790 审查指出）。
  const readHappened = (a.issue !== undefined && a.issue !== null)
    || (a.dependencies !== undefined && a.dependencies !== null)
    || (typeof a.body === 'string')
    || (a.parentKey !== undefined && a.parentKey !== null)
    || (a.blockedBy !== undefined && a.blockedBy !== null)
  if (!readHappened) return 'unconfirmed'
  const issueObj = (a.issue !== undefined && a.issue !== null) ? obj(a.issue) : null
  const rel = relationsOf(issueObj || a, a.dependencies)
  if (op === 'block') return rel.blockedBy.indexOf(want) >= 0 ? 'landed' : 'not-landed'
  return rel.parentKey === want ? 'landed' : 'not-landed'
}

/** 判落点用的证据：`kind` 是证据的档次，`ok:false` 表示这一步没成，`text` 是给人看的原话。 */
export interface EdgeEvidence {
  kind?: string
  ok?: boolean
  text?: string
}

/**
 * 落点判定：证据分五档，从最硬到最软：
 *   native      后端把这条关系放进了**它自己的原生结构**里（GitHub 的 sub-issues 层级、原生依赖边）。
 *   peer-link   写进去的是**平级链接**（GitLab 的 relates_to 就是这一档）。
 *   body-line   落在票的**正文**里（本地 Markdown 的 Blocked by 那一行、以及远端后端的兜底写法）。
 *   file-note   落在**票文件的注释/清单**里（本地 Markdown 的单根工作区就是这样表达归属的）。
 *   contract    只知道「契约返回的结构字段里有这条关系」，分不出上面哪一档 —— 这时如实说分不出。
 * 反证方向：把 evidence 里那一档去掉，落点就必须从具体档退到 contract 或说不好，绝不许默认升成原生。
 */
export function landingOf(op: string, evidence: unknown): string {
  const kind = str(obj(evidence).kind)
  if (kind === 'unsupported') return EDGE_LANDING.UNSUPPORTED
  if (kind === 'native') return op === 'block' ? EDGE_LANDING.NATIVE_BLOCK : EDGE_LANDING.NATIVE_PARENT
  if (kind === 'peer-link') return EDGE_LANDING.PEER_LINK
  if (kind === 'body-line') return EDGE_LANDING.BODY_LINE
  if (kind === 'file-note') return EDGE_LANDING.FILE_NOTE
  if (kind === 'contract') return op === 'block' ? EDGE_LANDING.CONTRACT_BLOCK_FIELD : EDGE_LANDING.CONTRACT_PARENT_FIELD
  if (kind === 'missing') return EDGE_LANDING.READ_BACK_MISSING
  return EDGE_LANDING.UNKNOWN
}

/** 票上读出来的关系三格：父票、我阻塞了谁的对偶（blockedBy）、以及反向投影（这里只做投影，不当判据）。 */
export interface Relations {
  parentKey: string
  blockedBy: string[]
  blocking: string[]
}

/** 把一张清单里的票号抠出来（元素可能是 `{key}` 对象、也可能是裸票号）。 */
function keys(list: unknown): string[] {
  return Array.isArray(list)
    ? list.map((r) => (r && typeof (r as { key?: unknown }).key === 'string' ? (r as { key: string }).key : String(r || ''))).filter(Boolean)
    : []
}

/** 从票的返回里读出关系所在的字段（只看字段有没有，不看后端是谁）。 */
export function relationsOf(issue: unknown, dependencies: unknown): Relations {
  const i = obj(issue)
  const dep = obj(dependencies)
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
export function bodyRefersTo(body: unknown, key: unknown): boolean {
  const text = str(body)
  const k = str(key).trim()
  if (!text || !k) return false
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    return new RegExp('(?:#|issues/|/issues/|票\\s*|第\\s*)' + esc + '(?![0-9])').test(text)
  } catch (e) {
    return false
  }
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
 *
 * 返回的 `ok` 只表示「判出来了」，未知也回 true（有证据可判这件事）；这条边到底有没有落上，
 * 由调用方按读回的 parentKey / blockedBy 是否等于目标另外判（#790 的教训）。
 *
 * 第四个形参 from 是「这条边写进的那张票」（#1421）：有值时正文里点名双方与方向，回执能自证；
 * 没值时退回不点名的老文案，老调用方的文案逐字不变。
 */
export function classifyEdgeLanding(op: string, target: unknown, after: unknown, from?: unknown): { kind: string; ok: boolean; text: string } {
  const a = obj(after)
  const want = str(target)
  const owner = (from === undefined || from === null) ? '' : str(from)
  const issueObj = (a.issue !== undefined && a.issue !== null) ? obj(a.issue) : null
  const rel = relationsOf(issueObj || a, a.dependencies)
  // 「没读回来」与「读回来了、没有」是两件事，不许混成一句「说不好」：
  //   unknown  这次根本没读到（读失败 / 没传结果），落点与落没落都不知道；
  //   missing  读回来了，结构字段里确实没有这条边（正文里有没有提到是另一件事，见下面）。
  const readHappened = (a.issue !== undefined && a.issue !== null)
    || (a.dependencies !== undefined && a.dependencies !== null)
    || (typeof a.body === 'string')
  if (!readHappened) return { kind: 'unknown', ok: true, text: '写后没读回来，判不了这条边的落点' }
  // #829：读回失败时 after.issue 为 null，旧写法 (a.issue && a.issue.body) !== undefined
  // 在 null 上仍进真分支并读 .body 直接抛错，把「读失败」变成工具崩溃（backend-threw）。
  // 这里先判空：没读到票正文按空串处理，落点判 unknown，真正的读错误由调用方在证据里另带原话。
  let body = ''
  try {
    if (issueObj !== null && typeof issueObj.body === 'string') body = issueObj.body
    else if (typeof a.body === 'string') body = a.body
  } catch (e) {
    body = ''
  }
  const bodyHas = bodyRefersTo(body, want)
  if (op === 'block') {
    const inField = rel.blockedBy.indexOf(want) >= 0
    if (inField && !bodyHas) return { kind: 'native', ok: true, text: owner
      ? '写后读回：票 #' + owner + ' 的 blockedBy 里有 #' + want + '，也就是 #' + owner + ' 被 #' + want + ' 阻塞；后端的结构字段里有这条依赖、正文里没有那一行（后端把它放在自己的原生边上）'
      : '写后读回：结构字段里有这条依赖、正文里没有那一行（后端把它放在自己的原生边上）' }
    if (inField && bodyHas) return { kind: 'body-line', ok: true, text: owner
      ? '写后读回：票 #' + owner + ' 的 blockedBy 里有 #' + want + '，也就是 #' + owner + ' 被 #' + want + ' 阻塞；正文里也写着指向 #' + want + ' 的一行（这是把关系写进正文的那种落法）'
      : '写后读回：结构字段里有这条依赖，正文里也写着指向 #' + want + ' 的一行（这是把关系写进正文的那种落法）' }
    // 字段里没有、正文里有：正文里出现票号只是「作者写了这行字」，不是「这条边在盘上」的证据（#790）。
    if (!inField && bodyHas) return { kind: 'missing', ok: true, text: owner
      ? '写后读回：票 #' + owner + ' 的 blockedBy 里没有 #' + want + '（正文里出现了指向 #' + want + ' 的一行，但正文提到票号不等于这条边落上了）'
      : '写后读回：结构字段里没有这条依赖（正文里出现了指向 #' + want + ' 的一行，但正文提到票号不等于这条边落上了）' }
    return { kind: 'missing', ok: true, text: owner
      ? '写后读回：票 #' + owner + ' 的 blockedBy 里没有 #' + want + '，正文里也没找到指向 #' + want + ' 的一行'
      : '写后读回：结构字段与正文里都没找到指向 #' + want + ' 的这条依赖' }
  }
  if (rel.parentKey === want) return { kind: 'contract', ok: true, text: owner
    ? '写后读回：票 #' + owner + ' 的父票是 #' + want + '（契约把父子放在 parentKey 这一列，分不出原生层级还是平级链接）'
    : '写后读回：票的 parentKey = ' + want + '（契约把父子放在这一列，分不出原生层级还是平级链接）' }
  // 父子边同理：正文里写「归属 #78」不是这条边落上的证据（#790 里正是这一条把没挂上的边报成了挂上）。
  if (bodyHas) return { kind: 'missing', ok: true, text: owner
    ? '写后读回：票 #' + owner + ' 的父票不是 #' + want + '（正文里出现了指向 #' + want + ' 的一行，但正文提到票号不等于这条边落上了）'
    : '写后读回：结构字段里没有这条父子关系（正文里出现了指向 #' + want + ' 的一行，但正文提到票号不等于这条边落上了）' }
  return { kind: 'missing', ok: true, text: owner
    ? '写后读回：票 #' + owner + ' 上没有父票 #' + want + '，正文里也没找到指向它的一行'
    : '写后读回：结构字段与正文里都没找到这条父子关系' }
}
