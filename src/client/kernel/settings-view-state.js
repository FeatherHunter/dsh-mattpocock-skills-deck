/**
 * src/client/kernel/settings-view-state.js — 内核模块（#1012 后续修复：设置文档的加载状态，以及「问完真源了没有」）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，把声明体文本
 *   拼回 src/client/index.js 里那一行 kernel:settingsViewState 拼接标记处（apply 闭包内原位），与
 *   ctx.js/seam 同模式，一源两物，src 零复制。这一行标记必须排在 kernel:settingsView 之前：
 *   下面这一个状态对象与两个公开口子，正是那一份的使用方。
 *
 * 为什么单独一个文件：客户端读设置文档是异步的，界面挂载那一刻文档往往还在路上。谁要按文档下判断，
 *   都必须先问一句「现在手上这个判断，问过真源了没有」，问不到就等下一次。原先这三样东西
 *   （状态对象、就绪查询、问完通知）住在 kernel/settings-view.js 里，而那份文件在拆出这一片之前
 *   按门禁算法已经 349 行（文件粒度门禁上限 350 行，见 tests/verify-file-granularity.ts），
 *   再添两个公开口子就超；所以照仓库惯例把「加载状态与订阅」这一块拆成自包含的内核片段，
 *   settings-view.js 只留「键与文档、读、把文档交给界面」，写这一趟另住 kernel/settings-view-write.js。
 *
 * 就绪的确切意思（本次修复的要点，改之前先读懂）：viewFlagReadyNow() 回答的是「现在给出的那个判断，
 *   是不是已经问过真源了」。还没有人开始问（status 为 idle）、或正问着（loading）都算没就绪；
 *   问到了文档（ready）、问不到（unavailable：没有宿主可问、读电话失败、或文件内容坏了）、
 *   文件是更高版本插件写的读不懂（readonly）都算这一次问话已经结束，也就是就绪。
 *   失败也算就绪是故意的：那三种情形下读口会回退旧 localStorage 键，调用方照旧表判断就行，
 *   不必再等一个不会来的答复；老用户「同一个工作区只自动展开一次」的记录正是记在旧表里的，
 *   这一档要是判成没就绪，那个承诺就丢了（退回「每进一次子目录会话白弹一次」）。
 */
// 这一族的状态对象：status 是这一次问话走到哪一步（五个取值见文件头那段「就绪的确切意思」），
//   doc 是内存里的那份设置文档，deferred 是文档还在路上时进来的那几笔写，journal 是已改进内存文档、
//   还没被某次成功落盘确认的那几笔，timer 是那一次防抖排期，retryLeft 是「写失败后还允许自己再试几趟」
//   的额度（#1012 后续修复：写失败不把那一笔从队列里划掉，靠下一趟写把它落进文件；成功一趟额度就恢复，
//   故障持续存在时额度耗尽就不再自己排，免得长成自续的循环）。它们与「问到哪一步了」是同一件事的
//   不同侧面，所以跟着状态一起住在这里，不另立第二处。
const viewFlagState = { status: 'idle', doc: null, deferred: {}, journal: {}, timer: 0, retryLeft: 1 }
// 登记过「问完了叫我一声」的回调名单。一次问话只有一个终点，所以通知过就把名单清空。
const viewFlagWaiters = []
// 现在给出的判断问过真源了没有：语义见文件头那段「就绪的确切意思」。
export const viewFlagReadyNow = function () {
  try { return viewFlagState.status !== 'idle' && viewFlagState.status !== 'loading' } catch (e) { return false }
}
// 登记一个回调，这一次问话结束（成功或失败都算）时调它一次，返回值是取消登记的函数。
//   已经结束时登记就立刻调一次 —— 文档早就到手之后才挂上来的调用方不该永远等不到那一声。
export const viewFlagSubscribe = function (fn) {
  const noop = function () {}
  try {
    if (typeof fn !== 'function') return noop
    if (viewFlagReadyNow()) {
      try { fn() } catch (e0) {}
      return noop
    }
    viewFlagWaiters.push(fn)
    return function () {
      try { const i = viewFlagWaiters.indexOf(fn); if (i >= 0) viewFlagWaiters.splice(i, 1) } catch (e1) {}
    }
  } catch (e) { return noop }
}
// 这一次问话收口了：kernel/settings-view.js 的 viewFlagSettle 记下终点状态、把收口该做的都做完之后调这里一次。
//   名单先整批取走再逐个调，某个回调里又登记或又取消登记都不会影响这一轮要叫的那几位；
//   单个回调抛错不许打断其余几位，也不许把已经写进状态的终点改回去。
const viewFlagNotifySettled = function () {
  try {
    const ws = viewFlagWaiters.splice(0, viewFlagWaiters.length)
    for (let i = 0; i < ws.length; i++) { try { ws[i]() } catch (e) {} }
  } catch (e) {}
}
