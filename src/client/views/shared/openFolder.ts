/**
 * views/shared/openFolder.ts —— 「打开文件夹」这一动作的共用实现（#1582）。
 *
 * 为什么要有它：面板头部的仓库芯片、子工作区的那枚文件夹图标、状态栏日志菜单的「打开日志目录」、
 * 诊断日志页的「打开目录」四处都要请宿主打开一个文件夹。四处的目录来源、按钮外观、提示文案各不相同，
 * 但下面这四件事必须一样，不然就会重演 #1557 之前那种「有的地方点下去没反应」：
 *   ① 目录为空或只有空白时不发宿主调用（发过去只会换来一条「缺少 cwd」，还不如当场说清）；
 *   ② 一次点击只发一次宿主调用；
 *   ③ 宿主报失败的方式是回 {ok:false,error}，不是抛错 —— 必须读回包，不能只挂 catch；
 *   ④ 失败原因交回调用方去提示（本函数不弹提示、不认识任何文案键）。
 *
 * 返回值只回答「这次有没有真的把调用发出去」（目录为空、宿主不可用、同步抛错都回 false），
 * 方便调用方收尾自己的忙碌态；异步结果走 report 回调。
 *
 * 为什么 report 里除了失败还有 'opened'：诊断日志页打开成功时要弹「已打开」那一句
 * （cfg.dbgOpenedDir），而票面只要求失败回调。多这一个值只为保住那处既有提示，其余调用方忽略即可。
 *
 * 约定：
 *   - 本文件是会被构建拼进客户端闭包的叶子（scripts/build.mts 的 LEAF_MODULES），所以不许写
 *     运行时 import、不许 export default；宿主调用对象与回调都从参数进，不碰闭包里的任何名字。
 *   - 文案不在这里拼：'missing' 与 'open-failed' 各由调用方翻成自己的人话（两句现成词条：
 *     logtoast.openNoDir 与 logtoast.openFailed）。
 */
export type OpenFolderOutcome = 'opened' | 'missing' | 'open-failed'

/** 宿主调用对象只需要 call 一格；没有 call 时按「宿主不可用」处理，不炸。 */
export interface OpenFolderHost {
  call?: (method: string, args: Record<string, unknown>) => Promise<unknown> | unknown
}

/** 结果回调：'opened' 成功；'missing' 目录为空（没发调用）；'open-failed' 发了但失败或发不出去，detail 是原因。 */
export type OpenFolderReport = (outcome: OpenFolderOutcome, detail?: string) => void

/** 失败原因统一转成一句可读文字：没有原因时用兜底那句，对象里带 message 时用 message。 */
function openFolderDetailText(detail: unknown): string {
  if (detail === undefined || detail === null || detail === '') return '打开失败'
  if (typeof detail === 'string') return detail
  try {
    const m = (detail as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  } catch (e) { /* 不是对象、或取 message 时抛错：退回下面的 String */ }
  return String(detail)
}

/**
 * 请宿主打开一个文件夹（wf.openFolder）。
 * @param host 宿主调用对象（真闭包里的 host；单测可给替身）
 * @param dir 要打开的目录（调用方自己取：仓库目录、工作区根、日志目录……）
 * @param report 结果回调（本函数保证一次点击最多调它一次）
 * @returns 这次有没有真的把调用发出去（目录为空、宿主不可用、同步抛错 → false）
 */
export function openFolderAt(host: OpenFolderHost | null | undefined, dir: unknown, report: OpenFolderReport): boolean {
  const fire = function (outcome: OpenFolderOutcome, detail?: string): void {
    try { if (typeof report === 'function') report(outcome, detail) } catch (e) { /* 提示失败不挡主流程 */ }
  }
  const wanted = (dir === null || dir === undefined) ? '' : String(dir)
  if (!wanted.trim()) { fire('missing'); return false }
  const owner = (host || null) as OpenFolderHost | null
  if (!owner || typeof owner.call !== 'function') { fire('open-failed', 'host-unavailable'); return false }
  let pending: Promise<unknown>
  try {
    pending = Promise.resolve(owner.call('wf.openFolder', { cwd: wanted }))
  } catch (e) {
    fire('open-failed', openFolderDetailText(e))
    return false
  }
  pending.then(function (res: unknown) {
    const ok = !!res && typeof res === 'object' && (res as { ok?: unknown }).ok === true
    if (ok) { fire('opened'); return }
    const err = (res && typeof res === 'object') ? (res as { error?: unknown }).error : undefined
    fire('open-failed', openFolderDetailText(err))
  }, function (e: unknown) {
    fire('open-failed', openFolderDetailText(e))
  })
  return true
}
