/**
 * src/refresh/rooms/host/snapshot-reply-version.ts —— 快照电话的库版本读数与 304 回包（#1885 评审修复）
 *
 * 为什么单列：session-snapshot-cache.ts 贴着 350 有效行上限；「这一趟的库版本」「304 的判据」
 * 「304 回包形状」与电话分支无关，搬出来之后两条组装支路共用同一份实现（规格 §9 / I2）。
 *
 * 三条约定：
 *  1. 版本只认非负整数；读不到回 null（不知道版本，不拿 0 冒充——0 是合法库版本）。
 *  2. 304 只看库版本：客户端把上次见到的库版本放在 ifNoneMatch / version 里带上来，一致才回 304。
 *  3. 304 回包与整份回包同形地带上工作区根、布局答案与选择；客户端不因为「没变化」而丢上下文。
 */
/** 这一趟的库版本：库门面没接、没这一口、读失败或版本不是非负整数时回 null。 */
export async function libraryVersionOf(first: any): Promise<number | null> {
  if (!first || typeof first.readVersion !== 'function') return null
  try {
    const version = await first.readVersion()
    return (typeof version === 'number' && Number.isInteger(version) && version >= 0) ? version : null
  } catch (e) { return null }
}

/** 客户端带上来的「上次见到的库版本」；没有这一格时回空串（不做版本 304）。 */
export function ifNoneMatchOf(args: any): string {
  const raw = args && (args.ifNoneMatch || args.version)
  return (raw === undefined || raw === null) ? '' : String(raw)
}

/**
 * 这一趟该不该回 304：库版本读得到、客户端带了同一个版本、且不是强制重建。该回就回整条 304 回包，
 * 否则回 null。两条组装支路共用这一个判据（规格 §9）。
 */
export async function notModifiedForVersion(first: any, args: any, cwd: string, selection: any, layout: any, isForce: boolean): Promise<any | null> {
  if (isForce) return null
  const version = await libraryVersionOf(first)
  if (version === null) return null
  const ifNone = ifNoneMatchOf(args)
  if (!ifNone || ifNone !== String(version)) return null
  return notModifiedReply(cwd, version, selection, layout)
}

/**
 * 304 回包。version 是库版本（不是内容散列）；selection / setupLayout 由调用方从这一趟的早选结果
 * 与布局答案原样传进来——客户端删掉浏览器那份布局表以后，只能靠这条回包清空旧答案。
 */
export function notModifiedReply(cwd: string, version: number, selection: any, layout: any): any {
  const pair: { selection?: any; rev?: unknown; setupLayout?: any } = (selection && selection.backendId)
    ? { selection: selection, rev: (Number.isInteger(selection.rev) ? selection.rev : 0) }
    : {}
  pair.setupLayout = layout
  return Object.assign({ ok: true, workspaceRoot: cwd, notModified: true, status: 304, version: version, cached: true, generatedMs: Date.now() }, pair)
}
