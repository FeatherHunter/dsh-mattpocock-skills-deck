// src/host/tracker/snapshotAssemble.ts —— 快照纯组装：池内标识、瘦身行与整份装配（#1255 从 snapshot.ts 拆出）
//
// 为什么单列：assembleSnapshot 是纯函数 —— 同样的票池进来，同样的快照出去，不碰缓存、不问后端、
//   不记时间；调用它的编排器（snapshot.ts 的 createSnapshotComposer）管缓存、版号、降级与 304，
//   两边的变化原因不同（组装口径变 vs 缓存策略变），测试策略也不同（纯组装可直接断言，编排要注夹具）。
// 什么约定不能改：
//   1. 组装只做直通，不补默认值；同池不分片，拉取请求与普通工单各算各的，BAD 单独隔离。
//   2. 已关闭地图的子票不进首屏但留瘦身行（#691/#907 口径，见函数内注释）。
//   3. 行为与拆分前逐行一致：本文件内容即原来 snapshot.ts 的对应段落原样搬运，只加 export，不改逻辑。
// 跨文件边只有两条（snapshot.ts → 本文件，被依赖方）：assembleSnapshot（编排器每趟重建调它）与
//   failKindOfListError（list 失败分类）；poolIdOf/thinRowOf 只在本文件内用，不导出。

import { ERROR_KIND } from '../../tracker/contract/vocabulary.js'
import { effortOf, idOfParts } from '../../tracker/kernel/identity-keys.js'
import { parseMapBody, parseSpecBody } from '../../tracker/body-parse.js'
// #1277 B 兜底（视图兜底）：行上的类型没标对时，票面文件头那行隐藏标记仍是唯一真源（ADR 2.5）。
import { markerKindInHeader } from '../../shared/issue-file/src/marker.js'
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

// #1277 B 兜底（视图兜底）：后端没把类型标成规格时，票面文件头那行隐藏标记仍是唯一真源（ADR 2.5）。
//   为什么放在组装层而不是房间里：GitHub 写侧今天把标记挤到正文第二行（幂等锚占了第一行），GitHub 房
//   只认首行，而 #326 一次改动只许动一个房间，本票不能改那个房 —— 界面不能因此把规格降级成普通票。
//   这里只补「行说是普通票、票面文件头却写着 spec」这一种；已经标成 map/spec 的行一个字不动。
//   浅拷贝一份改 type，后续容器判定、池过滤、sections 解析全用归一后的行，别的字段原样透传。
function withNormalizedType(it: any): any {
  if (!it) return it
  const declared = String((it && it.type) || '')
  if (declared === 'map' || declared === 'spec') return it
  const body = (it && typeof it.body === 'string') ? it.body : ''
  if (!body) return it
  if (markerKindInHeader(body) !== 'spec') return it
  return Object.assign({}, it, { type: 'spec' })
}

// 组装（纯函数）：maps（挂一层 tickets）+ 未挂图票（孤儿：破链 / 根票；map 节点本身不算孤儿——它已在 maps[] 作为容器）。
// 同池：拉取请求与普通工单都进 tickets/issues，不分片；拷贝原样带字段（EMPTY 保持空值，MISSING 保持省略）。
//
// #691（阶段 3）：已关闭地图的子票不进首屏 —— 用户点开那张地图时才按需抓（宿主电话 wf.mapTickets）。
//   为什么：首屏那份行数据是「打开面板就要看的东西」，而一张已关闭地图的子票属于历史，不必每次重建都付它的
//   取数与体积（规格第 6.4 节）。地图行本身照旧留着（它是容器），只是不带子票；列表上那个进度环也因此不画
//   （环要靠子票算，见 views/ListTabRow.js）。
//   一处要紧的细节：这些子票既不算「挂在图上的行」，也不算「未挂图的票」—— 否则它们会从 issues 那条路
//   悄悄漏回首屏，等于白改。
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
  // 已关闭地图的子票：按池内身份收在一处，供下面算 issues 时排除（见本函数开头的说明）。
  const closedMapTickets = new Set<string>()
  // #907：这些子票虽然不进首屏，但要留一份瘦身行（见 thinRowOf）供工作路线查标题 ——
  //   它们本来就在手上（取数那一趟已经回来了），丢掉的是正文与评论（体积的大头）。
  const thinTickets: Record<string, any>[] = []
  // 容器有两种：探索地图（type='map'）与规格/实施地图（type='spec'）。
  // 两类容器共用这一份数组（快照里仍叫 maps），客户端靠 type 字段分辨种类，不另开一个数组。
  // 规格的识别：正常情况下由各房归一层把 type 标成 spec（GitHub 房认正文首行的隐藏标记，
  // 本地 Markdown 房认文件头标记，见 rooms/markdown/parse.ts）；房没标对时由本文件上面的
  // withNormalizedType 按票面标记兜底（#1277 的 B 视图兜底；GitLab 房这一版还没接，见 #1286 设计文档 §4.1）。
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
      // 大写的 CLOSED 是本仓库的统一口径（upcaseSnapStates 在电话层再盖一次），这里自己也认小写，免得看后端脸色。
      const isClosed = String((m && m.state) || '').toUpperCase() === 'CLOSED'
      if (isClosed) for (const t of own) {
        closedMapTickets.add(poolIdOf(t))
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
    .filter((i) => i && i.type !== 'map' && i.type !== 'spec' && !attached.has(poolIdOf(i)) && !closedMapTickets.has(poolIdOf(i)))
    .map((t) => Object.assign({}, t))
  return { repository: repo, maps, issues, thinTickets, deck: null }
}
