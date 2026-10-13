// src/deck/rules/dependency-graph.ts —— 依赖图上的算法：环检测与整批预检的判定（纯规则侧）
//
// 本文件由 src/deck/shell/edge-landing.ts 的 hasCycleInAdj 与 precheckBlockBatch 拆出
//（#1039 按 #1038 定版：hasCycleInAdj 属纯侧四件之一）。
//
// 拆的时候做了一处结构改动，理由记在这里：原实现把「读整张图」与「算哪条边会让图成环」
// 写在一个 async 函数里，于是这条算法没法单独测（要先造一个有 list 能力的后端）。
// 现在拆成两层：
//   纯侧（本文件）只回答「给我一张现成的邻接表与这批要写的边，哪几条会让图成环」，
//   宿主侧（shell 的 precheckBlockBatch）负责把整图读回来、把结果翻译给调用方。
// 判定规则一个字没改，下面的反证方向也照旧。
//
// 纯在哪：只算 Map / Set 与字符串，不取会话、不起进程、不读写文件、不读钟。

/**
 * 依赖图里有没有环。
 * 邻接表的形状：`票号 → 它的阻塞方集合`（「谁挡着我」）。顺着阻塞方走一圈回到自己就是环
 *（`A 被 B 挡着、B 又被 A 挡着`）。自环（自己挡自己）也算环。
 *
 * 算法：三色标记的深度优先搜索。`state` 里 1 表示「这一趟正走在栈上」、2 表示「走完了、
 * 从它出发到得了的节点都查过」；再遇到 1 里的节点就是绕回自己，再遇到 2 里的直接跳过。
 * 为什么不用「记访问过的节点」两色：两色分不出「已经走完的分支」与「当前路径上的节点」，
 * 会把菱形依赖（A→B→D、A→C→D）误判成环。
 * 递归深度等于依赖链长度（几十张票的图远谈不上爆栈），不为几十个节点的图引入显式栈。
 *
 * 邻接表的值同时接受 `Set` 与数组：调用方两处来源不同（现成的图用 Set、这批要写的边用数组），
 * 在这里统一读法，免得调用方各写一份转换。
 */
export function hasCycleInAdj(adj: ReadonlyMap<string, ReadonlySet<string> | readonly string[]>): boolean {
  const state = new Map<string, number>()
  const walk = (node: string): boolean => {
    const s = state.get(node) || 0
    if (s === 1) return true
    if (s === 2) return false
    state.set(node, 1)
    const next = adj.get(node)
    if (next) for (const n of next) { if (walk(n)) return true }
    state.set(node, 2)
    return false
  }
  for (const node of Array.from(adj.keys())) { if (walk(node)) return true }
  return false
}

/** 整批预检的输入：现在盘上的图（票号 → 阻塞方集合），与本批要写的关键帧。 */
export interface BlockBatchInput {
  /**
   * 盘上已有的依赖图，键是票号、值是**它被谁挡着**（`blockedBy`）。
   * 读不回整图时不要调用本函数 —— 拿着一张空图去算只会得出「都不成环」，那是假装判断过了。
   */
  graph: ReadonlyMap<string, readonly string[]>
  /** 本批要写的票，按**实际写出顺序**排：预检要按这个顺序逐条试放，结论才对得上后面真写的结果。 */
  keyOrder: readonly string[]
  /** 本批每张票要写成的阻塞方清单（调用方已按票合并，同一张票只有一份）。 */
  blockedBy: ReadonlyMap<string, readonly string[]>
}

/** 整批预检的结论：`refused` 是「这条边不能写」的那些票，值是一句给人看的原话。 */
export interface BlockBatchVerdict {
  refused: Map<string, string>
}

/**
 * 整批成环预检（#929）：写任何一条边之前，把这一批要写的阻塞边按实际写出顺序逐条试放，
 * 会让依赖图成环的那一条挑出来（`refused`：票号 → 原因）。
 *
 * 为什么要整批一起算：「某一条边单独看不成环」不代表安全 —— 缺的那一段可能就是同批另一条边
 *（两条互不相干的边加上盘上已有的边照样能闭合成环），所以只有把「本批全部意图 + 完整现状」
 * 放在同一张图上才算得出来。
 *
 * 判定顺序也是判据的一部分：从前往后逐条试放，只把成环的那一条退回去、继续试后面的。
 * 于是同一张图、同一批边，谁先谁后决定哪一条被拒 —— 顺序由调用方按写出顺序给，本函数不重排。
 * 自环（`A 被 A 挡着`）在试放前先滤掉：契约层自己拒它，这里算成环会抢它的活。
 */
export function refuseCyclicBlockBatch(input: BlockBatchInput): BlockBatchVerdict {
  const adj = new Map<string, ReadonlySet<string> | readonly string[]>()
  for (const [key, blockers] of input.graph) adj.set(String(key), blockers)
  const refused = new Map<string, string>()
  for (const key of input.keyOrder) {
    const want = (input.blockedBy.get(key) || []).filter((x) => x && String(x) !== String(key))
    if (!want.length) continue
    const before = adj.get(key)
    adj.set(key, want)
    if (hasCycleInAdj(adj)) {
      // 成环的那一条不许留在图上：留着会让后面每一条都被带成环，一次误判变成一片误判。
      if (before === undefined) adj.delete(key)
      else adj.set(key, before)
      refused.set(key, '写前整批预检：这一组阻塞边和同一批里其它边合起来会让依赖图成环（要 ' + want.join('、') + '），所以这条边没写。')
    }
  }
  return { refused: refused }
}
