/**
 * src/shared/tracker/indexWindow.js —— 增量索引的时间窗与水印（纯逻辑，无副作用、无 import）
 *
 * 以后谁改它：改「判断远端有没有变」这套口径的人。纯函数，不持有状态、不读磁盘、不打印日志；
 * 状态由调用方（src/host/issueList.js）持有，这样本文件可以单独测。
 * 宿主经动态 import 引用（D7 禁止静态 import），测试直接引用。
 *
 * 为什么需要它：
 *   宿主判断「远端有没有变」时，原来每次都把全仓库 issue 扫一遍（本仓库 585 条、6 页、约 7 秒）。
 *   GitHub 的 issues 接口支持 since 参数，只返回该时刻之后有变动的 issue —— 实测同一仓库
 *   「最近 1 天」只要 24 条、1.2 秒，且 state=all 合并 since 后已关闭的票照样返回，
 *   所以「删除/关闭检测」不会因为缩小窗口而瞎掉。
 *
 * 缩小窗口带来的两个必须处理的问题（本文件就是处理它们的）：
 *   ① 光看「窗口内这回拿到了什么」会误判：上一次拿到的是全量、这一次只有增量，
 *      两个集合大小天然不同，若直接整体比对，每次都会得出「变了」的假结论。
 *      解法：把增量合并进上一次存下的全量基线，再拿合并结果与基线比对。
 *   ② 窗口起点不能取「上一次扫描的时刻」，否则这段时间里发生的改动会落在窗口外永远看不到。
 *      解法：水印取「本次扫描发起之前」的时刻，宁可重叠一点，也不漏。
 *      再退一小段（SKEW_MS）抹掉本机与 GitHub 时钟的偏差。
 *
 * 契约：本文件为纯函数集合，不持有状态、不读磁盘、不打印日志。
 *   状态由调用方（src/host/issueList.js）持有，这样本文件可以单独测。
 *   宿主侧「新文件禁止静态引入」的规约由引入方负责，本文件不引入任何其他文件。
 */

// 单次增量窗口的上限：窗口过宽会让 GitHub 返回几乎全量，等于没省。
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// 本机与 GitHub 时钟可能有偏差，水印往前多退这么多，避免边界的改动被漏掉。
const SKEW_MS = 60000

/**
 * 算出本次扫描的时间窗起点。
 *
 * @param {number|null} watermarkMs 上一次成功扫描的起点时刻（毫秒）；从未扫过传 null/0
 * @param {number} nowMs 本次扫描发起的时刻（毫秒）
 * @returns {{sinceIso: string, sinceMs: number, full: boolean}}
 *   sinceIso 传给接口的 since 参数；full 为真表示这次必须整扫（没有可用水印），调用方应把结果当作全量基线
 */
function scanWindow(watermarkMs, nowMs) {
  const now = Number(nowMs) || Date.now()
  const wm = Number(watermarkMs) || 0
  // 没有水印：第一次探测无法知道「何时起变了」，只能整扫一遍立基线
  if (!wm || wm <= 0 || wm > now) return { sinceIso: '', sinceMs: 0, full: true }
  // 超长间隙（例如机器睡了很久、或很久没开面板）：窗口会过宽，退化成整扫，避免一次拉回几乎全量
  if (now - wm > MAX_WINDOW_MS) return { sinceIso: '', sinceMs: 0, full: true }
  const sinceMs = wm - SKEW_MS
  return { sinceIso: new Date(sinceMs).toISOString(), sinceMs: sinceMs, full: false }
}

/**
 * 把本次增量合并进上一次的全量基线，得到「此刻应有的完整索引」。
 *
 * @param {object} baseline 上一次的完整索引：编号 → '状态|更新时间'
 * @param {object} delta 本次窗口内拿到的索引：同上口径，只含窗口内变动过的票
 * @returns {object} 合并后的完整索引（新对象，不改动入参）
 */
function mergeDelta(baseline, delta) {
  const out = {}
  const b = baseline && typeof baseline === 'object' ? baseline : {}
  for (const k of Object.keys(b)) out[k] = b[k]
  const d = delta && typeof delta === 'object' ? delta : {}
  for (const k of Object.keys(d)) out[k] = d[k]
  return out
}

/**
 * 两个索引是否有实质差异。
 *
 * 与「整体比对」的区别：这里只要求「合并后的完整索引」与「基线」同口径，
 * 所以不会因为增量窗口小而把每次探测都判成「变了」。
 *
 * @param {object} before 基线（合并之前）
 * @param {object} after 合并之后的完整索引
 * @returns {boolean} true 表示远端确有变动
 */
function indexDiffers(before, after) {
  if (!before) return true
  const a = before && typeof before === 'object' ? before : {}
  const b = after && typeof after === 'object' ? after : {}
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  // 条数不同 = 有新增或删除
  if (ak.length !== bk.length) return true
  for (let i = 0; i < bk.length; i++) {
    const k = bk[i]
    if (a[k] !== b[k]) return true
  }
  return false
}

/**
 * 从一份快照里取出「完整索引」，用作增量扫描的基线。
 *
 * 用途：DSH 每次重启后内存里的水印与基线都会清空，若只能整扫一遍来重新立基线，
 *   用户重启后第一次点开面板就要白等一次全量扫描（实测本仓库约 7 秒）。
 *   磁盘上其实存着上一次的快照，里面就带着完整的票与状态，可以直接当基线用。
 *
 * 为什么必须把地图与地图子票也算进来：快照里的 issues 数组并不保证包含全部票，
 *   地图容器与它的子票可能只挂在地图下面。少算了哪一条，那条票的「关闭/删除」
 *   就永远不会被检出——属于静默漏报，比慢一点严重得多，所以宁可多算不可少算。
 *
 * @param {object} snap 快照对象（磁盘缓存里的形状）
 * @returns {object|null} 完整索引：编号 → '状态|更新时间'；取不出任何票时返回 null
 */
function indexFromSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return null
  const index = {}
  const put = function (item) {
    if (!item || item.number === undefined || item.number === null) return
    index[String(item.number)] = String(item.state || '').toUpperCase() + '|' + String(item.updatedAt || '')
  }
  if (Array.isArray(snap.issues)) snap.issues.forEach(put)
  if (Array.isArray(snap.maps)) {
    snap.maps.forEach(function (m) {
      put(m)
      if (m && Array.isArray(m.tickets)) m.tickets.forEach(put)
    })
  }
  return Object.keys(index).length ? index : null
}

/**
 * 本次扫描结束后应当记下的新水印。
 * 取「扫描发起之前」的那个时刻（而不是此刻），让下一轮的窗口与这一轮重叠，
 * 保证两轮之间发生的改动不会掉进缝里。
 *
 * @param {number} scanStartedMs 本次扫描发起的时刻
 * @returns {number} 新水印
 */
function nextWatermark(scanStartedMs) {
  return Number(scanStartedMs) || Date.now()
}

/**
 * 用磁盘快照给「重启后的第一次扫描」立一个可用的起点。
 *
 * @param {object} snap 磁盘上取到的快照
 * @param {number} nowMs 当前时刻
 * @returns {{baseline: object, watermarkMs: number}|null}
 *   可取用时返回基线与水印；快照陈旧到超出窗口上限（此时缩窗无意义，不如整扫）则返回 null
 */
function seedFromSnapshot(snap, nowMs) {
  const now = Number(nowMs) || Date.now()
  const baseline = indexFromSnapshot(snap)
  if (!baseline) return null
  const gen = Number(snap && snap.generatedMs) || 0
  if (!gen || gen <= 0 || gen > now) return null
  if (now - gen > MAX_WINDOW_MS) return null
  // 水印取快照生成时刻：快照就是那个时刻的真实状态，从它往后问增量即可
  return { baseline: baseline, watermarkMs: gen }
}

export { scanWindow, mergeDelta, indexDiffers, nextWatermark, indexFromSnapshot, seedFromSnapshot, MAX_WINDOW_MS, SKEW_MS }
