// views/versionControl/vcHistoryQuery.ts —— 提交历史页四条能力的纯判定：搜索范围、命中文件、只看单个文件、比较两端
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，跨叶用 declare。
//
// 这一叶只算、不画也不发电话（读数与动作在 vcHistoryOps，画法在 vcHistoryExtra / vcHistory）：
//   · 搜索范围两种（说明 / 代码变化）各自该怎么判「这次命中」；
//   · 「只看某个文件」时列表该从哪一份读数取、空态说哪一句；
//   · 比较两个引用时结果头要写的那一行摘要。
//
// 为什么「代码变化」按改到的文件路径找、而不是按补丁正文找：入口上写的是「按这次提交改到的文件找」，
// 命中行上要写出「命中 <文件>」—— 只有路径本身参与匹配时，这句话才是真的。
// 想按补丁正文找是另一条能力（git log -S/-G，账本 3.7 的命令原文），这里不冒充它。

// 两种搜索范围（说明 / 代码变化）。值同时写进 data 属性，委托层按它认；按钮的次序也按它排。
export const VC_HISTORY_SCOPES: string[] = ['message', 'code']

/** 搜索范围归一：认不出的值一律回「说明」，不造第三种范围。 */
export const vcHistoryScopeOf = function (scope: any): string {
  return String(scope || '') === 'code' ? 'code' : 'message'
}

/** 一条提交改到的文件路径（宿主补上的那一份；没读到就是空数组）。 */
export const vcHistoryPathsOf = function (commit: any): string[] {
  const list: any = commit && commit.paths
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (let i = 0; i < list.length; i += 1) out.push(String(list[i]))
  return out
}

/**
 * 代码范围里这条提交命中了哪份文件：命中回那条路径，没命中回 ''。
 * 搜的词为空时不算命中（空词不该把所有行都标成命中）。
 */
export const vcHistoryHitPathOf = function (commit: any, needle: any): string {
  const q: string = String(needle === undefined || needle === null ? '' : needle).trim().toLowerCase()
  if (q === '') return ''
  const paths: string[] = vcHistoryPathsOf(commit)
  for (let i = 0; i < paths.length; i += 1) {
    if (paths[i].toLowerCase().indexOf(q) >= 0) return paths[i]
  }
  return ''
}

/** 只看合并的判据：两个父提交的才是合并提交（与图形视图同一判据）。 */
export const vcHistoryIsMergeCommitOf = function (commit: any): boolean {
  return Array.isArray(commit && commit.parents) && commit.parents.length >= 2
}

/**
 * 列表要画哪几行：先把范围（说明 / 代码变化）、搜索词、只看合并叠上去，再按「只看某个文件」过滤。
 * fileOnly 非空时只留改过那个文件的提交（宿主那一侧用 git log --follow 读回来的历史已经筛过一遍，
 * 这里再按路径核一次，两道都过才留下）。
 */
export const vcHistoryFilterOf = function (commits: any, query: any, mergeOnly: any, scope?: any, fileOnly?: any) {
  const list: any[] = Array.isArray(commits) ? commits : []
  const q: string = String(query === undefined || query === null ? '' : query).trim().toLowerCase()
  const only: boolean = mergeOnly === true
  const code: boolean = vcHistoryScopeOf(scope) === 'code'
  const oneFile: string = String(fileOnly === undefined || fileOnly === null ? '' : fileOnly)
  const out: any[] = []
  for (let i = 0; i < list.length; i += 1) {
    const c: any = list[i] || {}
    if (oneFile !== '' && vcHistoryPathsOf(c).indexOf(oneFile) < 0) continue
    if (only && !vcHistoryIsMergeCommitOf(c)) continue
    if (q !== '') {
      const hit: string = code ? vcHistoryHitPathOf(c, q) : ''
      if (code) {
        if (hit === '') continue
      } else {
        const hay: string = (String(c.subject || '') + ' ' + String(c.author || '') + ' ' + String(c.short || '') + ' ' + String(c.oid || '')).toLowerCase()
        if (hay.indexOf(q) < 0) continue
      }
    }
    out.push(c)
  }
  return out
}

/** 空态说哪一句：只看文件 → 没提交改过它；代码范围 → 没有提交改到匹配这些文字的文件；其余照旧。 */
export const vcHistoryEmptyKeyOf = function (opts: any): string {
  const o: any = opts || {}
  if (String(o.fileOnly || '') !== '') return 'vc.shell.history.fileOnlyEmpty'
  if (vcHistoryScopeOf(o.scope) === 'code' && String(o.query || '').trim() !== '') return 'vc.shell.history.emptyCode'
  return 'vc.shell.history.filterEmpty'
}

/** 比较结果头的那一行摘要：几个文件，加上增删行数（没有数字就不写，不补 0）。 */
export const vcHistoryCompareSummaryOf = function (files: any, t: any): string {
  const list: any[] = Array.isArray(files) ? files : []
  let added: number = 0
  let deleted: number = 0
  for (let i = 0; i < list.length; i += 1) {
    const f: any = list[i] || {}
    if (typeof f.added === 'number' && isFinite(f.added)) added += f.added
    if (typeof f.deleted === 'number' && isFinite(f.deleted)) deleted += f.deleted
  }
  const parts: string[] = [t('vc.shell.history.compareFiles', { n: String(list.length) })]
  if (added > 0) parts.push('+' + String(added))
  if (deleted > 0) parts.push('−' + String(deleted))
  return parts.join('，')
}

export const VC_HISTORY_QUERY_SOURCE = 'src/client/views/versionControl/vcHistoryQuery.ts'
