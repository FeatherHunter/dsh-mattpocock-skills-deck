// src/host/snapshotInflight.js —— 快照两条电话路共用的在途协调器（#729 一次性方案）。
// 为什么单开一个文件：去重只能发生在“看得见钥匙”（工作区根 + 后端 + 语言 + 修订号 + 版本）的电话层；
//   sessionSnapshot.js 已 348/350 行装不下新表，index.js 350 行冻结零增长动不得；两张表拦不住跨路组合
//   （快照路在途 + 刷新路到达照样另起一趟），所以必须是一张表。两处电话路都用动态引入接它
//   （D7 禁止静态 import，与 _dedupe() 同模式）；同层互引基线里记两条边（owner #729）。
// 非对称复用规则（只拦该拦的）：强制只搭强制的车（#366：强制恒等于真重建，磁盘回放与 304 都不许冒充新鲜）；
//   非强制搭任何车（顺风车只会更新鲜，且与客户端 probe-stale.js 的口径同构）。
// 键里不带强制标记，条目上记 isForce；删键只删自己登记的那一条（强制盖掉非强制条目时，先到的那一趟
// 不能把后到的条目顺手删掉），这一步由 Leave 保证，调用方只管在 finally 里调它。
const inflightByKey = new Map() // 去重键 -> { promise: 同一趟重建的承诺, isForce: 这一趟是不是强制 }
// 去重键：与 #696 同形状，只是拿掉了强制标记（强制与非强制同键才能相遇，相遇后按下面的 Take 规则决定搭不搭车）。
export function snapshotDedupKeyOf({ cwd, backendId, lang, baseRev, version }) {
  return String(cwd || '') + '|' + String(backendId || '') + '|' + String(lang || '') + '|' + String(baseRev || 0) + '|' + String(version || '')
}
// 搭车：有同键在途且规则允许就返回那一趟的承诺（命中时调 onHit 记日志），否则返回 null，调用方自己发车。
export function snapshotInflightTake(key, isForce, onHit) {
  const ongoing = inflightByKey.get(key)
  if (ongoing && (ongoing.isForce === true || !isForce)) {
    try { if (typeof onHit === 'function') onHit() } catch (eHit) {}
    return ongoing.promise
  }
  return null
}
// 发车登记：返回条目，跑完后凭它调 Leave。
export function snapshotInflightPark(key, isForce, promise) {
  const entry = { promise: promise, isForce: !!isForce }
  inflightByKey.set(key, entry)
  return entry
}
// 收车：只删自己登记的那一条。
export function snapshotInflightLeave(key, entry) {
  try { if (inflightByKey.get(key) === entry) inflightByKey.delete(key) } catch (eDel) {}
}
