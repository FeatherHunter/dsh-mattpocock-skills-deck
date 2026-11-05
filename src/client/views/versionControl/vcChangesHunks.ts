// views/versionControl/vcChangesHunks.ts —— 展开一行之后那块逐行差异怎么拆、怎么排、哪一块已经进了索引
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 为什么单开一叶：改动页的行视图（vcChangesRow）已经贴着 350 有效行的上限，逐块暂存要在这里回答三件事，
// 全是纯规则、可以直接喂假读数断言，不碰 DOM 也不发电话：
//   ① 一份补丁按 @@ 头拆成「文件头 + 若干块」，块号按各自那一份补丁的顺序从 0 数；
//   ② 同一个文件可能同时有「已进索引的块」与「还在工作区的块」，要把两份补丁合成一条按文件顺序排的清单；
//   ③ 行的分组：只暂存了一部分的文件不是「已暂存」，也不算「整份未暂存」，它留在未暂存里并标出进度。
//
// 两边坐标为什么能直接排序：已暂存那一份读的是「索引相对 HEAD」，它的新侧行号就是块在索引里的位置；
// 未暂存那一份读的是「索引相对工作区」，它的旧侧行号也是块在索引里的位置。两者都在「索引这份文件」里数，
// 所以按 已暂存.startNew 与 未暂存.startOld 排出来的顺序就是文件里的真实顺序，不需要再做任何匹配。

/** 一条差异的缓存键：已暂存那一侧与未暂存那一侧各一份，同一个文件的两行不会互相顶掉。
 *  规则只在这里一处：界面读缓存、处理器写后重读、门禁对键，都调它。 */
export const vcChangesSideKeyOf = function (side: any, path: any): string {
  return (String(side || '') === 'staged' ? 'staged:' : 'worktree:') + String(path || '')
}

/** 一块：来自哪一侧、在这一侧补丁里的序号、以及画出来要的那几样。 */
export interface VcChangesHunk {
  /** 显示用的序号（从 1 数）；由合并后的顺序决定，不是协议里的块号。 */
  order: number
  /** 'staged' 表示这一块已经在索引里（读的是索引相对 HEAD）；'unstaged' 表示还在工作区。 */
  side: string
  /** 这一块在它那一侧补丁里的序号（从 0 数）：发给宿主的就是它。 */
  hunkIndex: number
  /** 在索引里的起始行：两侧都换算到这同一个坐标，用来排顺序。 */
  at: number
  header: string
  lines: any[]
}

/** 一份补丁拆出来的样子：第一块之前的行（diff --git / index / --- / +++）与逐块正文。 */
export interface VcChangesSideSplit {
  head: any[]
  hunks: VcChangesHunk[]
}

/**
 * 按 @@ 头把 host 回的逐行差异拆开。块头行是 kind === 'hunk'；文件头是它在第一块之前的那些行。
 * 认不出 @@ 头的行就当文件头的一部分原样留着，绝不因为一行看不懂就丢掉整份差异。
 */
export const vcChangesSideSplitOf = function (lines: any, side: any): VcChangesSideSplit {
  const list: any[] = Array.isArray(lines) ? lines : []
  const head: any[] = []
  const hunks: VcChangesHunk[] = []
  const which: string = String(side || 'unstaged') === 'staged' ? 'staged' : 'unstaged'
  for (let i = 0; i < list.length; i += 1) {
    const line: any = list[i] || {}
    if (String(line.kind || '') !== 'hunk') {
      if (hunks.length === 0) head.push(line)
      else hunks[hunks.length - 1].lines.push(line)
      continue
    }
    const text: string = String(line.text || '')
    const m: any = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(text)
    const startOld: number = m ? Number(m[1]) : 0
    const startNew: number = m ? Number(m[3]) : 0
    const at: number = which === 'staged' ? startNew : startOld
    // 块头这一行也算块体的一行：原型与截图 84 里 @@ 头是块里第一行，行号由 CSS 计数器统一往下数。
    hunks.push({ order: 0, side: which, hunkIndex: hunks.length, at: at, header: text, lines: [line] })
  }
  return { head: head, hunks: hunks }
}

/**
 * 把两侧的块合成一份按文件顺序排好的清单。空读数（没读到 / 这一侧本来就没有）当零块处理，
 * 不抛错也不编一块出来。顺序按索引坐标（见文件头），相同位置时已暂存那一块排前面。
 */
export const vcChangesMergedHunksOf = function (stagedLines: any, unstagedLines: any): VcChangesHunk[] {
  const staged: VcChangesHunk[] = vcChangesSideSplitOf(stagedLines, 'staged').hunks
  const unstaged: VcChangesHunk[] = vcChangesSideSplitOf(unstagedLines, 'unstaged').hunks
  const all: VcChangesHunk[] = staged.concat(unstaged)
  all.sort(function (a: VcChangesHunk, b: VcChangesHunk): number {
    if (a.at !== b.at) return a.at - b.at
    if (a.side !== b.side) return a.side === 'staged' ? -1 : 1
    return a.hunkIndex - b.hunkIndex
  })
  all.forEach(function (hunk: VcChangesHunk, i: number) { hunk.order = i + 1 })
  return all
}

/** 行上的进度徽章：只在「有一部分已进索引、还有一部分没进」时才画；整份已暂存的行不需要它。 */
export const vcChangesHunkProgressOf = function (hunks: any): any {
  const list: VcChangesHunk[] = Array.isArray(hunks) ? hunks : []
  let staged: number = 0
  for (let i = 0; i < list.length; i += 1) if (list[i].side === 'staged') staged += 1
  return { staged: staged, total: list.length, partial: staged > 0 && staged < list.length }
}

/**
 * 改动页的分组与统计。规则只有一句：一个文件在「全部」里只画一行。
 *   · 整份都已暂存的（只在已暂存那一份里）进「已暂存」；
 *   · 有未暂存改动的（含只暂存了一部分的）进「未暂存」，部分暂存的带上 partial 给行视图标进度；
 *   · 冲突行照旧单独成组。
 * 统计按分出来的行数算，不另读一份计数：分组头写几行、顶部卡片就该写几。
 */
export const vcChangesGroupsOf = function (files: any): any {
  const f: any = files || {}
  const stagedRows: any[] = Array.isArray(f.staged) ? f.staged : []
  const unstagedRows: any[] = Array.isArray(f.unstaged) ? f.unstaged : []
  const stagedPaths: any = {}
  for (let i = 0; i < stagedRows.length; i += 1) stagedPaths[String((stagedRows[i] || {}).path || '')] = true
  const unstagedPaths: any = {}
  for (let i = 0; i < unstagedRows.length; i += 1) unstagedPaths[String((unstagedRows[i] || {}).path || '')] = true
  const staged: any[] = []
  const partial: any[] = []
  const unstaged: any[] = []
  const conflicts: any[] = []
  for (let i = 0; i < stagedRows.length; i += 1) {
    const row: any = stagedRows[i] || {}
    if (unstagedPaths[String(row.path || '')] === true) continue
    staged.push(row)
  }
  for (let i = 0; i < unstagedRows.length; i += 1) {
    const row: any = unstagedRows[i] || {}
    if (row.conflict === true) { conflicts.push(row); continue }
    const both: boolean = stagedPaths[String(row.path || '')] === true
    const marked: any = both ? Object.assign({}, row, { partial: true }) : row
    if (both) partial.push(marked)
    unstaged.push(marked)
  }
  return {
    staged: staged,
    unstaged: unstaged,
    partial: partial,
    conflicts: conflicts,
    counts: { staged: staged.length, unstaged: unstaged.length, conflicts: conflicts.length },
  }
}
