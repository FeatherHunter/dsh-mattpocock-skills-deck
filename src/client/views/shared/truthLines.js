// views/shared/truthLines.js — 「这份数据多新、上次刷新成不成、现在是不是降级」那几句话（#715 T11）
//
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
// 的 leaf 标记处（一源两物）。本文件是纯函数，不画界面、不碰 React：吃的是一份事实，吐的是
// 「要显示哪几条词条、各带什么参数、用哪一种颜色轻重」。真正画出来在 views/ListTab.js 头部那两行。
//
// 为什么单独一个文件：这几句话的判据（新鲜度阈值、降档承诺）必须只有一份实现，而且要能在门禁里
// 不开浏览器、直接拿两组输入跑出来对比（tests/verify-visible-truth.js 就是这么验的）。
//
// 三条纪律，改这个文件的人先看这三条：
//   1. **刷新阈值不在这里**：5000 / 300000 / 1800000 这类数字全部来自 refresh-core 的 budget.ts，
//      构建时把 src/shared/refresh/budget.js 拼进界面闭包（见 scripts/build.mjs 的 shared:refreshBudget）。
//      本文件里不写任何一个刷新阈值 —— 写了就是第二份数字，改一处漏一处。
//      唯一的例外是下面那个「一分钟」的刻度常量 TRUTH_MINUTE_MS：它只把「离现在多久」折成人话
//      （刚刚 / N 分钟前 / N 小时前 / N 天前），不参与也不影响新鲜度判定 —— 新鲜度仍只由
//      budget.ts 的 freshnessLevel 判（见 truthFreshnessBox 把 tone 原样带出去）。
//   2. **降级标记不在这里**：`fallback`（'rest' 之类）只由宿主快照组装处按真实降级事实写入
//      （src/host/tracker/snapshot.js）。界面这一侧只读不写：谁在这里补一句赋值让横幅亮起来，
//      就是把诚实做成了假装。tests/verify-visible-truth.js 有一条静态断言盯着这件事。
//   3. **判据不在界面**：两种失败（插件自己的取数失败 / 配额已被其他使用者耗尽）是宿主看真实读数
//      分好类之后，作为事实（st.snapFail.kind）送进来的；界面只把两种事实翻成两句不同的话，
//      不许自己按错误文本猜。
//
// 事实从哪儿来（三个都是别人写好的，这里只读）：
//   · 快照取数时刻：st.snapshot.generatedMs（宿主组装快照时写下的一刻，不是界面渲染的一刻）
//   · 上次刷新成不成：st.snapMode / st.snapError / st.snapFail（客户端这一侧观察到的真实结果）
//   · 降级与推迟：st.snapshot.refresh（宿主写的读数：tier / deferred / paused / notRefreshing；
//     宿主还不知道的事实留空，界面就一个字都不显示，绝不编）
export const truthFreshnessAt = function (st) {
  const snap = st && st.snapshot
  const at = snap && typeof snap.generatedMs === 'number' ? snap.generatedMs : 0
  return at > 0 ? at : 0
}
export const truthFreshnessLine = function (st, nowMs) {
  const at = truthFreshnessAt(st)
  if (!at) return null
  const now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now()
  const d = new Date(at)
  const pad = function (n) { return (n < 10 ? '0' : '') + n }
  return { at: at, key: 'truth.updatedAt', params: { time: pad(d.getHours()) + ':' + pad(d.getMinutes()) }, tone: freshnessLevel(now - at), kind: 'freshness' }
}
// 「一分钟」这个刻度：只用来把「离现在多久」折成一句人话，不是刷新阈值（见文件头第 1 条的例外说明）。
const TRUTH_MINUTE_MS = 60000
/**
 * 头部那个小时间控件要说的话（2026-09-22 维护者定：这条信息从面板正文那一行搬到头部，做成一个独立控件）。
 * 它把上面那条判据（truthFreshnessLine）再读一遍，所以「取数时刻取哪一刻、新鲜度按什么阈值判」仍然只有一份：
 *   · `agoKey`/`agoParams` 是控件默认画的那一句相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）；
 *   · `time` 是精确时刻（'22:41'），调用方把它拼进悬停提示那一句（那条 truth.updatedTip，
 *     完整说法只在悬停时出现，版面上不出现「上次更新」四个字）；
 *   · `tone` 是新鲜度那三档（fresh / yellow / red），调用方据此上色 —— 颜色由调用方定，这里不带颜色。
 * 没有取数时刻（还没拿到快照）时返回 null：调用方那时一个时间的字都不画，而不是画一个猜的。
 */
export const truthFreshnessBox = function (st, nowMs) {
  const line = truthFreshnessLine(st, nowMs)
  if (!line) return null
  const now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now()
  const age = Math.max(0, now - line.at)
  const hour = 60 * TRUTH_MINUTE_MS
  const day = 24 * hour
  const agoKey = age >= day ? 'truth.updatedDayAgo' : (age >= hour ? 'truth.updatedHourAgo' : (age >= TRUTH_MINUTE_MS ? 'truth.updatedMinAgo' : 'truth.updatedJustNow'))
  const n = agoKey === 'truth.updatedDayAgo' ? Math.floor(age / day) : (agoKey === 'truth.updatedHourAgo' ? Math.floor(age / hour) : Math.floor(age / TRUTH_MINUTE_MS))
  return {
    at: line.at,
    tone: line.tone,
    agoKey: agoKey,
    agoParams: agoKey === 'truth.updatedJustNow' ? {} : { n: n },
    time: line.params.time,
  }
}
export const truthNoticeLines = function (st, nowMs) {
  const lines = []
  const push = function (ln) {
    for (let i = 0; i < lines.length; i++) if (lines[i].key === ln.key) return
    lines.push(ln)
  }
  const snap = (st && st.snapshot) || null
  const refresh = (snap && snap.refresh) || null
  const tierPaused = !!(refresh && refresh.tier && lagPromiseFor(refresh.tier).paused)
  const paused = !!(refresh && refresh.paused === true) || tierPaused
  if (!snap) return lines
  // 一、上次刷新失败。有旧数据也照说：老数据配一句「刷新失败」，才说得清「你现在看的这份是旧的」。
  //   三种情形三句话，判据全是宿主送进来的事实：
  //   ① 配额已被其他使用者耗尽（重试也没用，等整点恢复）
  //   ② 插件自己的取数失败、但已经暂停（配额紧张，先不再打请求）
  //   ③ 插件自己的取数失败、还在重试
  if (st && st.snapMode === 'err' && st.snapError) {
    const byOthers = ((st.snapFail && st.snapFail.kind) || '') === 'quota-exhausted'
    push({ key: byOthers ? 'truth.failQuota' : (paused ? 'truth.failPaused' : 'truth.failRetry'), params: {}, tone: 'red', kind: 'fail' })
  }
  // 二、降档时把延迟承诺说出来：黄档说「数据可能落后 X 分钟」。绿档（承诺还是 5 秒）不说，
  //   因为那时候没有任何东西变长；红档不说「落后多久」——它说的是下面那句「已暂停」。
  if (refresh && refresh.tier) {
    const p = lagPromiseFor(refresh.tier)
    if (typeof p.maxLagMs === 'number' && p.maxLagMs > PROBE_INTERVAL_MS) push({ key: 'truth.lag', params: { min: Math.round(p.maxLagMs / 60000) }, tone: 'yellow', kind: 'lag' })
  }
  // 三、自动刷新确实停了：可见却断流（宿主报 paused）或额度降档到红档（自动刷新全停）。
  //   已经因为失败说过一次的那句就不重复说（push 按键去重，上面先说的算）。
  if (paused) push({ key: 'truth.paused', params: {}, tone: 'yellow', kind: 'paused' })
  // 四、有更新但被推后了；五、这个窗口没在刷新（同时活跃上限 2 个窗口，第 3 个在这里明说）。
  if (refresh && refresh.deferred === true) push({ key: 'truth.deferred', params: {}, tone: 'yellow', kind: 'deferred' })
  if (refresh && refresh.notRefreshing === true) push({ key: 'truth.notRefreshing', params: {}, tone: 'fresh', kind: 'notRefreshing' })
  return lines
}
// 行上那个「更新中」标记的窗口：一次写入成功之后，这一行在合并窗口内还算「正在更新」。
// 窗口长度就是 budget.ts 的 PATCH_MERGE_WINDOW_MS（10 秒），这里不另写一个数字。
export const truthWriteWindowOpen = function (atMs, nowMs) {
  const at = (typeof atMs === 'number' && isFinite(atMs)) ? atMs : 0
  if (!at) return false
  const now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now()
  return (now - at) >= 0 && (now - at) <= PATCH_MERGE_WINDOW_MS
}
// 记一笔「这一行刚写过」：调用方是发起写入那些地方（今天接的是评论提交成功后那一处）。
// 键同时记「编号」与「编号加 effort 的身份」，行渲染那边两把都查，免得两边键算法不一样导致标记不亮。
export const markRowWrite = function (st, number, effortId) {
  if (!st || number === undefined || number === null) return
  const at = Date.now()
  const map = st.writeAt || (st.writeAt = {})
  const n = String(number)
  map[n] = at
  try { map[idOfParts(effortId === undefined || effortId === null ? '' : String(effortId), n)] = at } catch (e) { /* 只留按编号那一把 */ }
}

// ── 降级横幅该不该画、画哪一句（2026-09-24，维护者反馈「这条在某些工作区出现过后就常驻」）──
//
// 那条横幅说的是**当下**的事（「已切换 REST 通道」），而快照里那个标记说的是**那一次构建**的事。
//   两件事之间隔着缓存：标记随快照被写进宿主缓存、磁盘缓存、客户端内存 LRU，之后每一次取用都会把它
//   原样带回来，于是横幅会一直挂着 —— 哪怕此刻配额早恢复了、取数早就走回 GraphQL。
//
// 判据（纯函数，界面只调用它，不自己判断）：
//   ① 没有降级标记 → 不画（一个字都不说）；
//   ② 本次会话已经关掉这一档（关闭时刻 >= 这次降级的时刻）→ 不画；新的一次降级时刻更晚，会重新出现；
//   ③ 知道降级时刻且在一小时以内 → 说当下：原因 quota 才说「配额已耗尽」，other 与未知说中性那句（这次取数走了 REST 通道），一个字不许提配额 —— 不真耗尽不许说耗尽（#734 硬规矩）；
//   ④ 时刻缺失、或已经超过一小时 → 改口成「上次…」，同样按原因分岔：quota 走原来那句，other 与未知走中性那句，
//      不再把一件历史事实说成现在（与本项目其他「不知道就不说、不许编」的口径一致）。
// 为什么没有定时器：横幅只在新快照到来重渲染时重算；恢复后它靠一份干净的新快照（fallback 置空）
//   消失，而不是靠时间自己撤 —— 缩时限与藏横幅都是把信号藏起来，#734 明确不许。
export const REST_FALLBACK_STALE_MS = 60 * 60 * 1000
export const restFallbackView = function (st, nowMs, dismissedAtMs) {
  const snap = st && st.snapshot
  if (!snap || snap.fallback !== 'rest') return null
  const at = (typeof snap.fallbackAt === 'number' && snap.fallbackAt > 0) ? snap.fallbackAt : 0
  if (at > 0 && typeof dismissedAtMs === 'number' && dismissedAtMs >= at) return null
  const now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now()
  const ageMs = at > 0 ? Math.max(0, now - at) : -1
  const stale = (at === 0) || (ageMs >= REST_FALLBACK_STALE_MS)
  const minutes = ageMs >= 0 ? Math.floor(ageMs / TRUTH_MINUTE_MS) : 0
  // #734：只有宿主说是 quota 才许提配额；other 与未知（null / 缺失）一律走中性句。
  const isQuota = (snap.fallbackReason === 'quota')
  return {
    stale: stale,
    at: at,
    ageMs: ageMs,
    minutes: minutes,
    key: stale ? (isQuota ? 'list.restFallbackStale' : 'list.restFallbackStaleNonQuota') : (isQuota ? 'list.restFallback' : 'list.restFallbackNonQuota'),
    params: { n: minutes },
  }
}
