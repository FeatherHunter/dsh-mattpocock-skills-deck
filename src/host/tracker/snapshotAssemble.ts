// src/host/tracker/snapshotAssemble.ts —— 快照纯组装：池内标识、瘦身行与整份装配（#1255 从 snapshot.ts 拆出）
//
// 为什么单列：assembleSnapshot 是纯函数 —— 同样的票池进来，同样的快照出去，不碰缓存、不问后端、
//   不记时间；调用它的编排器（snapshot.ts 的 createSnapshotComposer）管缓存、版号、降级与 304，
//   两边的变化原因不同（组装口径变 vs 缓存策略变），测试策略也不同（纯组装可直接断言，编排要注夹具）。
// 什么约定不能改：
//   1. 组装只做直通，不补默认值；同池不分片，拉取请求与普通工单各算各的，BAD 单独隔离。
//   2. 已关闭容器（地图或规格）里自己已关闭的子票不进首屏但留瘦身行；还开着的子票照常进 issues（#691/#907/#1291 口径，见函数内注释）。
//   3. 行为与拆分前逐行一致：本文件内容即原来 snapshot.ts 的对应段落原样搬运，只加 export，不改逻辑。
// 跨文件边只有两条（snapshot.ts → 本文件，被依赖方）：assembleSnapshot（编排器每趟重建调它）与
//   failKindOfListError（list 失败分类）；poolIdOf/thinRowOf 只在本文件内用，不导出。
// 地图子票的首帧归一与「来源不完整时补回上次已知」也在这里（carryOverMapTickets / normalizeMapTickets / mergeKnownTickets）：
//   它同样是纯组装，只是输入多了一份上次快照。为什么不另起一份文件：.dependency-cruiser.ts 的
//   same-layer-import-host 写着「接线由装配文件负责，干活的文件之间不许互相引用」，编排器 snapshot.ts
//   已经引本文件，另起一份会让它多出一条同层边；而本文件是纯函数、有效行远不到 350，合在这里不增依赖。

import { ERROR_KIND } from '../../tracker/contract/vocabulary.js'
import { effortOf, idOfParts } from '../../tracker/kernel/identity-keys.js'
import { groupTickets, parseMapBody, parseSpecBody } from '../../tracker/body-parse.js'
// #1277 B 兜底（视图兜底）：行上的类型没标对时，票面文件头那行隐藏标记仍是唯一真源（ADR 2.5）。
import { isSpecHeaderMarked } from '../../shared/issue-file/src/marker.js'
import type { RepositoryRef } from '../../shared/tracker/shape.js'

// 池内标识的输入行：只读 key 与是否为拉取请求等格子，其余原样透传。
type PoolRow = Record<string, any>

// 这一趟 list 失败，是「配额已经被别人用掉」还是「插件自己的取数失败」。
//
// #715（诚实显示）用：两种失败在界面上是两句不同的话，所以判据必须在宿主这一侧有一条，
// 而且只认真实读数 —— 今天能拿到的真实读数就是 gh 回包自报的限流（429 / `API rate limit exceeded` /
// 二级限流 `secondary rate limit`）。闸的账本接进宿主之后，判据换成账本读数（剩余额度掉到保底线以下、
// 而本地几乎没花），界面一个字都不用动：它只认 kind 这个字段。
export function failKindOfListError(error: any): string {
  const t = String((error && (error.message || error.error || error.kind)) || '')
  if (error && (error.kind === (ERROR_KIND as any).RATELIMIT || error.kind === 'rate-limit')) return 'quota-exhausted'
  return /rate.?limit|quota|secondary/i.test(t) ? 'quota-exhausted' : 'fetch-failed'
}

function poolIdOf(it: PoolRow | null | undefined): string {
  const k = idOfParts(effortOf(it as any), (it && (it as any).key) || '')
  // 后缀前面那个 '\u0000'（NUL）是分隔符，不是排版错误：票号与标题里不可能出现这个字符，
  // 用它隔开「身份键」与「类型后缀」，就不会和真实内容撞成一个键。
  // 注意：这几处原文写的是 \0 转义，从 .js 转成 .ts 时曾被展开成真的 NUL 字节（文件因此被 git 当二进制），
  // 这里统一写成 \u0000，读起来看得出是转义、也不会再把文件变成二进制。
  if (!it || !Object.prototype.hasOwnProperty.call(it, 'isPullRequest')) return k // MISSING
  if ((it as any).isPullRequest === true) return k + '\u0000pr'
  if ((it as any).isPullRequest === false) return k + '\u0000issue'
  return k + '\u0000bad' // BAD：非布尔值，孤儿隔离
}

// #907：工作路线那一行要用的瘦身行 —— 只留票号、标题、状态、是不是地图四样。
//   为什么只留这四样：这份清单的唯一读者是工作路线的标题查询（界面按票号查标题与状态、认地图）。
//   谁要在这里多读一样字段，先把这条口径改了再说 —— 这里多一样，就等于把 #691 省下来的体积搬回来一点。
//   没有票号的行返回 null（宁可不留，也不留一份查不到的）。
function thinRowOf(t: any): Record<string, any> | null {
  const key = (t && t.key != null) ? String(t.key) : ''
  if (!key) return null
  return {
    key: key,
    number: (t && t.number != null) ? t.number : (parseInt(key, 10) || 0),
    effortId: effortOf(t),
    type: (t && t.type != null) ? String(t.type) : 'issue',
    state: (t && t.state != null) ? String(t.state) : '',
    title: (t && t.title != null) ? String(t.title) : '',
  }
}

// 大写的 CLOSED 是本仓库的统一口径（upcaseSnapStates 在电话层再盖一次），这里自己也认小写，免得看后端脸色。
// 容器（要不要把子票藏起来）与子票（要不要被藏）两处判据共用这一句 —— 同一条口径只写一遍（#1291 复核）。
function isClosedRow(it: any): boolean {
  return String((it && it.state) || '').toUpperCase() === 'CLOSED'
}

// #1277 B 兜底（视图兜底）：后端没把类型标成规格时，票面文件头那行隐藏标记仍是唯一真源（ADR 2.5）。
//   为什么还留着这一层：老快照缓存、或者将来某个后端漏了这条判据时，界面不能因此把规格降级成普通票——
//   这里按同一个共享判据（isSpecHeaderMarked，第一个标题之前）再兜一次。#1403 T1 之后 GitHub / GitLab /
//   本地 Markdown 三个房都按文件头认规格，正常路径不会走到这里；它只补「行说是普通票、票面文件头却写着
//   spec」这一种，已经标成 map/spec 的行一个字不动。
//   浅拷贝一份改 type，后续容器判定、池过滤、sections 解析全用归一后的行，别的字段原样透传。
function withNormalizedType(it: any): any {
  if (!it) return it
  const declared = String((it && it.type) || '')
  if (declared === 'map' || declared === 'spec') return it
  const body = (it && typeof it.body === 'string') ? it.body : ''
  if (!isSpecHeaderMarked(body)) return it
  return Object.assign({}, it, { type: 'spec' })
}

// 组装（纯函数）：maps（挂一层 tickets）+ 未挂图票（孤儿：破链 / 根票；map 节点本身不算孤儿——它已在 maps[] 作为容器）。
// 同池：拉取请求与普通工单都进 tickets/issues，不分片；拷贝原样带字段（EMPTY 保持空值，MISSING 保持省略）。
//
// #691（阶段 3）：已关闭容器（地图或规格）里已经关闭的子票不进首屏 —— 用户点开那个容器时才按需抓（宿主电话 wf.mapTickets）。
//   为什么：首屏那份行数据是「打开面板就要看的东西」，而一张已关闭容器里的已关闭子票属于历史，不必每次重建都付它的
//   取数与体积（规格第 6.4 节）。容器行本身照旧留着（它是容器），只是不带子票；列表上那个进度环也因此不画
//   （环要靠子票算，见 views/ListTabRow.js）。
//   一处要紧的细节：这些子票既不算「挂在容器上的行」，也不算「未挂容器的票」—— 否则它们会从 issues 那条路
//   悄悄漏回首屏，等于白改。
// #1291：这条取舍的边界是**子票自己的状态**，不是容器的状态。容器关掉了，它下面还开着、没人认领、也没被阻塞的
//   子票仍然是可以直接接活的任务，它不能跟着容器一起隐没：隐没之后它既不在任何容器的 tickets 里、也不进 issues，
//   列表一行都看不到，而状态栏与 KPI 仍按后端 counts.open 说「可接 N 张」—— 数字与列表对不上。
//   所以只把「容器已关闭、子票自己也是 CLOSED」的行藏起来；子票还开着的照常以完整行进 issues（容器行的
//   tickets 仍为空，与 #691 一致）。地图与规格两类容器共用下面这段分支，所以规格收了也一样。
// #907：同一条取舍曾让工作路线那一行查不到标题（标题只从快照给得出的行里查）。所以这些行现在另留一份
//   瘦身行（thinTickets，只有票号、标题、状态、是不是地图）专供查标题：首屏口径不变，取数也不多花一次。
export function assembleSnapshot(repo: RepositoryRef, all: any[]): any {
  // 口径断言：组装层不判定后端能力是否一致（混合返回不断言一致），只做 pass-through；身份区分靠 poolIdOf（三态），BAD 单独隔离。
  // #1277：先按票面标记做一遍种类归一，后面所有过滤与解析都用归一后的行（见 withNormalizedType）。
  const rows: any[] = (Array.isArray(all) ? all : []).map(withNormalizedType)
  // effort 维度：父子分组按 (effortId, parentKey) —— 不同 effort 的地图各自只收本 effort 的票。
  const byParent = new Map<string, any[]>()
  for (const it of rows) {
    if (!it) continue
    if (it.parentKey != null) {
      const pk = idOfParts(effortOf(it), it.parentKey)
      const arr = byParent.get(pk) || []
      arr.push(it)
      byParent.set(pk, arr)
    }
  }
  // 已关闭容器里自己已关闭的子票：按池内身份收在一处，供下面算 issues 时排除（见本函数开头的说明）。
  // 名字里带 ClosedChildren 是提醒后来人：判据落在子票自己的状态上，不是只看容器（#1291）。
  const hiddenClosedChildren = new Set<string>()
  // #907：这些子票虽然不进首屏，但要留一份瘦身行（见 thinRowOf）供工作路线查标题 ——
  //   它们本来就在手上（取数那一趟已经回来了），丢掉的是正文与评论（体积的大头）。
  const thinTickets: Record<string, any>[] = []
  // 容器有两种：探索地图（type='map'）与规格/实施地图（type='spec'）。
  // 两类容器共用这一份数组（快照里仍叫 maps），客户端靠 type 字段分辨种类，不另开一个数组。
  // 规格的识别分两层：各房归一层先按票面文件头标记把 type 标成 spec（GitHub、GitLab、本地 Markdown
  // 三个房同一条判据、同一个共享包函数 markerKindInHeader，见各房 normalize / parse 的 deriveType）；
  // 房没标对时由本文件上面的 withNormalizedType 按同一判据兜底（#1277 的 B 视图兜底）。
  const maps = rows
    .filter((i) => i && (i.type === 'map' || i.type === 'spec'))
    .map((m) => {
      // 探索地图正文五区块（Destination / Notes / Decisions so far / Not yet specified / Out of scope）：
      // 后端形状只保证 body；UI 详情页（MapDetail）直接消费解析结果（m.decisions.length 等），
      // GitHub 切到编排器后曾漏解析，点 Map 行进详情页即报 Cannot read properties of undefined (reading 'length')。
      // 在组装层统一解析补齐（与旧 gh 直连路径一致），无区块也给 EMPTY（'' / []），不 MISSING。
      // 规格容器不填这五个槽，改填规格七段（sections）：正文按二级标题切段，缺段给空，不 MISSING。
      const isSpec = String((m && m.type) || '') === 'spec'
      const bp: any = isSpec ? null : parseMapBody(m.body)
      const sp: any = isSpec ? parseSpecBody(m.body) : null
      const own = byParent.get(idOfParts(effortOf(m), m.key)) || []
      const isClosed = isClosedRow(m)
      if (isClosed) for (const t of own) {
        // #1291：只藏「自己已关闭」的子票。还开着（以及状态缺失、没法当历史票看）的子票不藏，
        //   它们随后会从下面 issues 那条「未挂图的票」通道以完整行回到首屏；容器行的 tickets 照旧为空。
        if (!isClosedRow(t)) continue
        hiddenClosedChildren.add(poolIdOf(t))
        const thin = thinRowOf(t)
        if (thin) thinTickets.push(thin)
      }
      const withTickets = { tickets: (isClosed ? [] : own).map((t) => Object.assign({}, t)) }
      if (isSpec) return Object.assign({}, m, withTickets, { sections: sp })
      return Object.assign({}, m, withTickets, {
        destination: bp.destination,
        notes: bp.notes,
        decisions: bp.decisions,
        fog: bp.fog,
        outOfScope: bp.outOfScope,
      })
    })
  // 已挂载集合按池内身份记：同 key 的普通工单与拉取请求各算各的，已挂载一个不吞掉另一个。
  const attached = new Set<string>()
  for (const m of maps) for (const t of (m as any).tickets) attached.add(poolIdOf(t))
  // issues = 未挂在任何 map 下的「非 map」票（破链票指 parentKey 指向已删/不存在 map；根票 parentKey=null 也在此——它们无 map 归属）
  const issues = rows
    .filter((i) => i && i.type !== 'map' && i.type !== 'spec' && !attached.has(poolIdOf(i)) && !hiddenClosedChildren.has(poolIdOf(i)))
    .map((t) => Object.assign({}, t))
  return { repository: repo, maps, issues, thinTickets, deck: null }
}

// ── 地图子票首帧归一与保底合并（#1696）───────────────────────────────────────────────
/** 合并时要不要把上次已知补回来：来源完整（没截断、没降级）才允许删/缩。 */
export interface MapCarryOptions {
  /** true = 这次列表是完整的（可以删、可以缩）；false = 截断或降级（只补不删）。 */
  sourceComplete: boolean
  /** 补回发生时刻（写进 map.carry.at，界面能说「这是上次数据」）。 */
  nowMs?: number
}

/**
 * 把引用或票号折成字符串键：数字、字符串、{key}、{number} 四种写法都认。
 *
 * 这是宿主装配层自己的一份行身份归一化。全仓另有三处各自处理同一件事：刷新内核按行淘汰、
 * 客户端地图卡片、宿主写回前的淘汰键集合，四处的口径并不相同（这一处会 trim、认对象包装，
 * 另外几处有的不 trim，有的会去掉前导零）。没有抽成一个公共叶子的原因不是分层禁止——
 * host / refresh / client 引用 src/tracker/kernel 本来就允许——而是跨后端票号口径还没定：
 * GitHub 用数字键，Markdown 与本地后端用补零的字符串键，现在合并会把「折不折零」的分歧
 * 藏进共享代码。先各自保留并写清口径，等票号口径统一后再收编；
 * 背景见 docs/design/20261030-panel-snapshot-closeout.md 第 9 节第 7 条与 #1769。
 */
function keyOf(value: any): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'string') return value.trim()
  const inner = value.key !== undefined && value.key !== null ? value.key : value.number
  return inner === undefined || inner === null ? '' : keyOf(inner)
}

/** 阻塞者写成客户端认的数字（数字字符串折成数字，非数字原样保留字符串）。 */
function refNumberOf(value: any): number | string | null {
  const key = keyOf(value)
  if (!key) return null
  return /^\d+$/.test(key) ? Number(key) : key
}

/** 行的身份键：优先 key，其次 number（key 是空串时在这里回落 number；刷新内核那份不回落，属于已知差异）。 */
function rowKeyOf(row: any): string {
  const key = keyOf(row && row.key)
  if (key) return key
  const number = row && row.number
  return number === undefined || number === null ? '' : String(number)
}

/** 认领人：行上已有就用，没有再从 assignees 第一人取（与客户端 claimedPersonOf 同口径）。 */
function claimedByOf(row: any): string {
  const claimed = row && row.claimedBy
  if (claimed) return typeof claimed === 'object' ? String(claimed.login || claimed.name || '') : String(claimed)
  const list = Array.isArray(row && row.assignees) ? row.assignees : []
  for (const person of list) {
    if (typeof person === 'string' && person) return person
    if (person && (person.login || person.name)) return String(person.login || person.name)
  }
  return ''
}

/**
 * 阻塞者引用态旁表（#1768）：`blockedBy` 压成编号之后，编号之外的信息（标题、状态）留在这里。
 *
 * 为什么需要：跨容器的阻塞者不在本批子票里，首帧只剩一个编号，判断不了「那张票关没关」。
 * 读层本来带回来了引用态（GitHub 的 blockedBy.nodes 有 number/title/state），
 * 压成编号时把标题与状态收进旁表，frontier 与被挡计数才有依据；读不到状态表示未知（按挡着收口）。
 *
 * 为什么从旧旁表回填：上一趟快照的行已经压成编号了，降级 / 补回那一趟会重新归一，
 * 不把旧旁表里的标题与状态取回来，已知的 CLOSED 会变成未知，本来可接的票会被错收成被挡。
 */
function blockedByRefsOf(row: any, blockers: any[]): any[] {
  const previous = Array.isArray(row && row.blockedByRefs) ? row.blockedByRefs : []
  const previousByKey: Record<string, any> = {}
  previous.forEach((ref: any) => { const k = keyOf(ref); if (k && previousByKey[k] === undefined) previousByKey[k] = ref })
  const refs: any[] = []
  blockers.forEach((raw: any) => {
    const key = keyOf(raw)
    if (!key) return
    const ref: any = { key: refNumberOf(raw) }
    const old = previousByKey[key]
    const title = raw && typeof raw === 'object' && raw.title != null && String(raw.title) !== '' ? raw.title : (old ? old.title : null)
    const state = raw && typeof raw === 'object' && raw.state != null && String(raw.state) !== '' ? raw.state : (old ? old.state : null)
    if (title != null && String(title) !== '') ref.title = String(title)
    if (state != null && String(state) !== '') ref.state = String(state)
    refs.push(ref)
  })
  return refs
}

/** 单张子票归一化：保留原行全部字段，只补客户端首帧要读的那几格。 */
function normalizeTicket(row: any): any {
  const out = Object.assign({}, row)
  const number = Number(rowKeyOf(row))
  if (Number.isFinite(number)) out.number = number
  const blockers = Array.isArray(row && row.blockedBy) ? row.blockedBy : []
  out.blockedBy = blockers.map(refNumberOf).filter((v: any) => v !== null)
  // #1768：编号语义不动，引用态另放一格（跨容器判定与卡片标题都靠它）。
  out.blockedByRefs = blockedByRefsOf(row, blockers)
  if (!Array.isArray(out.blocks)) out.blocks = []
  const claimed = claimedByOf(row)
  if (claimed) out.claimedBy = claimed
  else if (out.claimedBy === undefined) out.claimedBy = ''
  return out
}

/**
 * 把一批后端行整理成首帧可画的地图子票：数字票号、数字阻塞者、反向「挡住谁」、认领人、逐票层级。
 * 返回 { tickets, stats }；stats 是 groupTickets 同口径的五组计数 + 分层。
 */
export function normalizeMapTickets(rows: any[]): { tickets: any[]; stats: any } {
  const list = Array.isArray(rows) ? rows : []
  const tickets = list.map(normalizeTicket)
  const byNumber: Record<string, any> = {}
  tickets.forEach((t: any) => { if (t && t.number !== undefined && t.number !== null) byNumber[String(t.number)] = t })
  tickets.forEach((t: any) => {
    if (!t || !Array.isArray(t.blockedBy)) return
    t.blockedBy.forEach((blockerNo: any) => {
      const blocker = byNumber[String(blockerNo)]
      if (!blocker || String(blocker.number) === String(t.number)) return
      if (!Array.isArray(blocker.blocks)) blocker.blocks = []
      if (blocker.blocks.indexOf(t.number) < 0) blocker.blocks.push(t.number)
    })
  })
  const stats: any = groupTickets(tickets as any)
  tickets.forEach((t: any) => {
    if (!t || t.number === undefined || t.number === null) return
    const level = stats.levelOf[String(t.number)]
    if (typeof level === 'number') t.level = level
  })
  return { tickets, stats }
}

/** 上次的行 + 本次的行按编号合并：本次优先，本次没表达的字段沿用上次（未知≠空）。 */
export function mergeKnownTickets(prevRows: any[], nextRows: any[]): { tickets: any[]; kept: number } {
  const prevList = Array.isArray(prevRows) ? prevRows : []
  const nextList = Array.isArray(nextRows) ? nextRows : []
  const prevByKey: Record<string, any> = {}
  prevList.forEach((row: any) => { const k = rowKeyOf(row); if (k) prevByKey[k] = row })
  const seen: Record<string, boolean> = {}
  let kept = 0
  const merged: any[] = nextList.map((row: any) => {
    const k = rowKeyOf(row)
    if (!k) return row
    seen[k] = true
    const prev = prevByKey[k]
    if (!prev) return row
    const out = Object.assign({}, prev, row)
    // 本次没表达的字段沿用上次：undefined / null / 空数组 / 空字符串都算「这次没说」。
    const fillIfEmpty = (field: string) => {
      const now = row[field]
      const empty = now === undefined || now === null || now === '' || (Array.isArray(now) && now.length === 0)
      if (empty && prev[field] !== undefined && prev[field] !== null) out[field] = prev[field]
    }
    fillIfEmpty('blockedBy')
    fillIfEmpty('blockedByRefs')
    fillIfEmpty('blocks')
    fillIfEmpty('labels')
    fillIfEmpty('assignees')
    fillIfEmpty('claimedBy')
    fillIfEmpty('body')
    fillIfEmpty('title')
    fillIfEmpty('url')
    fillIfEmpty('progress')
    return out
  })
  prevList.forEach((row: any) => {
    const k = rowKeyOf(row)
    if (!k || seen[k]) return
    merged.push(row)
    kept += 1
  })
  return { tickets: merged, kept }
}

/** 计数：清单已知时按合并后的票算；上次计数更大（清单未取全）时保留上次的已知数字，不缩水。 */
function statsOf(tickets: any[], prevStats: any): any {
  const stats: any = groupTickets(tickets as any)
  if (prevStats && Number.isFinite(prevStats.total) && prevStats.total > stats.total) {
    return Object.assign({}, prevStats)
  }
  return stats
}

/** 容器的身份键（effort + 编号）：跨 effort 的同号容器不是同一张。 */
function containerKeyOf(container: any): string {
  return idOfParts(effortOf(container), rowKeyOf(container))
}

/** 已关闭容器：首帧子票为空是现行口径（#691/#1291），本模块原样放过。 */
function isClosed(container: any): boolean {
  return String((container && container.state) || '').toUpperCase() === 'CLOSED'
}

/**
 * 池内身份键：同一张票已经挂在容器里，就不要再出现在「未挂图票」那份清单里。
 * 判别位与 snapshotAssemble.ts 的 poolIdOf 逐字同口径（#505）：工单 false → issue、拉取请求 true → pr、
 * 没有这个字段 → 光键（MISSING）、非布尔值 → bad。只按编号去重会把同号异类或 MISSING 孤儿吞掉
 * （快照门禁 507 与契约快照段盯着这一条）。
 */
function poolKeyOf(row: any): string {
  const key = idOfParts(effortOf(row), rowKeyOf(row))
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'isPullRequest')) return key
  if (row.isPullRequest === true) return key + '\u0000pr'
  if (row.isPullRequest === false) return key + '\u0000issue'
  return key + '\u0000bad'
}

/**
 * 宿主重建快照时调用：把组装层产出的 maps[].tickets 整理成首帧可画的形状，并在来源不完整时
 * 用上次快照按编号补回已知子票与计数。返回新快照对象（不修改入参）。
 */
export function carryOverMapTickets(prevSnapshot: any, nextSnapshot: any, options: MapCarryOptions): any {
  if (!nextSnapshot || typeof nextSnapshot !== 'object') return nextSnapshot
  const nextMaps: any[] = Array.isArray(nextSnapshot.maps) ? nextSnapshot.maps : []
  const prevMaps: any[] = Array.isArray(prevSnapshot && prevSnapshot.maps) ? prevSnapshot.maps : []
  const prevByKey: Record<string, any> = {}
  prevMaps.forEach((m: any) => { prevByKey[containerKeyOf(m)] = m })
  const nowMs = options.nowMs === undefined ? Date.now() : options.nowMs
  const attached: Record<string, boolean> = {}

  const maps = nextMaps.map((map: any) => {
    if (!map || typeof map !== 'object') return map
    const ownTickets = Array.isArray(map.tickets) ? map.tickets : []
    if (isClosed(map)) {
      // 已关闭容器口径不动；只把子票清单收空（组装层已经这么做，这里再兜一次）。
      return Object.assign({}, map, { tickets: [] })
    }
    const prev = prevByKey[containerKeyOf(map)]
    const prevTickets = prev && Array.isArray(prev.tickets) ? prev.tickets : []
    const merged = options.sourceComplete
      ? { tickets: ownTickets, kept: 0 }
      : mergeKnownTickets(prevTickets, ownTickets)
    const normalized = normalizeMapTickets(merged.tickets)
    const prevStats = prev && prev.stats && typeof prev.stats === 'object' ? prev.stats : null
    const stats = statsOf(normalized.tickets, options.sourceComplete ? null : prevStats)
    const out: any = Object.assign({}, map, { tickets: normalized.tickets, stats })
    if (!options.sourceComplete && merged.kept > 0) out.carry = { at: nowMs, kept: merged.kept }
    normalized.tickets.forEach((t: any) => { const k = poolKeyOf(t); if (k) attached[k] = true })
    return out
  })

  const issues = Array.isArray(nextSnapshot.issues) ? nextSnapshot.issues : []
  const dedupedIssues = issues.filter((row: any) => !attached[poolKeyOf(row)])
  return Object.assign({}, nextSnapshot, { maps, issues: dedupedIssues })
}