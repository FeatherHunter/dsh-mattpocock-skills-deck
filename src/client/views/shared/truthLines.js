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
//   1. **阈值不在这里**：5000 / 300000 / 1800000 这类数字全部来自 refresh-core 的 budget.ts，
//      构建时把 src/shared/refresh/budget.js 拼进界面闭包（见 scripts/build.mjs 的 shared:refreshBudget）。
//      本文件里一个毫秒字面量都不许写 —— 写了就是第二份数字，改一处漏一处。
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
  return { key: 'truth.updatedAt', params: { time: pad(d.getHours()) + ':' + pad(d.getMinutes()) }, tone: freshnessLevel(now - at), kind: 'freshness' }
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
