/** 认领（改认领人）写完之后，回执里要补的那一句话。
 *
 * 为什么需要它：同一个「认领」动作在两个地方落盘不一样 —— 地图子票会把可见状态标成 claimed，
 * 普通实施票与普通票只把认领人记进文件头的隐藏注释、可见状态一个字不动（#1788）。
 * 回执如果只说「成了」，读回执的人会以为可见状态也被改过，于是下一次看到 triage 状态时以为写丢了。
 *
 * 判据只看写后读回来的正文，不看后端是谁：正文里有可见的 `Status: claimed`（加粗写法一样算），
 * 就说明这张票按地图子票的写法标了 claimed；没有这一行，就如实说可见状态没有改。
 * 这样同一句话对本地 Markdown 与远端后端都成立：远端后端认领本来就不改状态。
 */

/** 票文件正文里有没有可见的 `Status: claimed`（`**Status:** claimed` 这种加粗写法也算）。
 *
 * 只认第一个二级标题之前的那一段：可见状态字段写在文件头，评论区里抄一句同样的文字不算数。 */
function visibleStatusClaimed(body: unknown): boolean {
  const head = String(body || '').split(/\n##[ \t]/)[0]
  return head.split(/\r?\n/).some((line) => /^[ \t]*Status[ \t]*[:：][ \t]*claimed[ \t]*$/.test(line.replace(/\*/g, '')))
}

/** 回执里那句「认领人记到哪了、可见状态有没有改」；给不出确定结论时回空串，调用方不补这句。 */
export function claimNoteOf(body: unknown): string {
  if (visibleStatusClaimed(body)) return '认领人已记录；这张票所在目录里有 map.md，按地图子票的写法把可见状态标成了 claimed。'
  return '认领人已记录，可见状态没有改：本地 Markdown 的普通实施票与普通票只记认领人，别的后端认领本来就不改状态。'
}
