/**
 * 留存量的两条线（30 天、2MB）与两种存档形状共用的裁剪算法。
 *
 * 两种存档形状各自序列化，但留存口径是同一套，所以数字与能共用的算法只写在这里：
 *   - 链（ChainState，src/shared/refresh/src/chain.ts）：一个会话一格，按会话分格的缓存；
 *   - 工作路线存档（RootLedger，src/deck/shell/work-path-ledger.ts）：工作区根一份，按会话分页。
 * 两边的差别只在「怎么拼成准备落盘的 JSON」，怎么判断「留多少条」共用本文件。
 *
 * 为什么这里只有两个数字、一个字节算法、一个二分：.dependency-cruiser.ts 的 same-layer-import-shared
 * 规定共享层的每个文件都是自包含的纯模块，不许引用同层的另一个文件 —— 一旦引用，这一层就会
 * 退化成互相咬合的一团。链那一侧的裁剪实现要用 chain.js 里的键构造与形状校验，所以它住在唯一
 * 旧链的调用方是 src/host/refresh/workRoute.ts（#1271 已删；宿主层引用共享层是正常方向）；本文件只管「留多少条」
 * 这个与形状无关的问题。
 *
 * 两条线，顺序是先时间、后体积：
 *   1. 超过 30 天（CHAIN_KEEP_MS）的条目直接清掉 —— 缓存是为了让界面看得见「最近在办什么」，
 *      一个月前的处理动作对这件事已经没有意义。
 *   2. 清完仍超过 2MB（CHAIN_MAX_BYTES）就按时间从旧到新裁，裁到 2MB 以下为止，最新的条目一定还在。
 *      体积按落盘那份序列化后的 UTF-8 字节数算，不是按条数估。
 *
 * 为什么不按「每个会话留 20 张」：会话长短差得很远，20 张对一次长会话不够、对一次短会话又太多；
 * 而且那个上限把「时间」这个真正的判据排除在外，一个三天没动的会话和一个刚开五分钟的会话被同样对待。
 *
 * 本文件是纯工具：不读时钟（时间由调用方传进来）、不碰磁盘、不发日志。数字要改只改这里。
 */

/** 留存量的一条线：超过 30 天的条目在下一次落盘时清掉。 */
export const CHAIN_KEEP_MS = 30 * 24 * 60 * 60 * 1000

/** 留存量的另一条线：整份落盘超过 2MB 就按时间从旧到新裁，裁到 2MB 以下为止。 */
export const CHAIN_MAX_BYTES = 2 * 1024 * 1024

/** UTF-8 字节数：落盘体积按字节算，不按字符算（中文票键一个字符占 3 字节，按字符算会低估）。 */
export function utf8Bytes(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      n += 4
      i += 1
    } else n += 3
  }
  return n
}

/**
 * 按「最新在前」的顺序，最多能留下前多少条而不超体积。
 *
 * 两个调用方（链与工作路线存档）都是把条目按时间倒序排好再裁的：留得越多体积越大，
 * 所以「能放下多少条」随条数单调不减，可以二分。bytesOf(n) 要算「只留前 n 条时整份落盘的字节数」，
 * 它必须也是随 n 单调不减的（同一份序列化，多一条只会更大）。
 *
 * 为什么单独提出来：两处裁剪都要做同一个二分，抄两遍就成了两个会漂移的算法。
 */
export function newestPrefixThatFits(total: number, bytesOf: (count: number) => number, maxBytes: number): number {
  if (!(total > 0)) return 0
  if (bytesOf(total) <= maxBytes) return total
  let lo = 0
  let hi = total
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (bytesOf(mid) <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return lo
}
