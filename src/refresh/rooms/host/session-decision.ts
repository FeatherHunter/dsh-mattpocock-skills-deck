// src/refresh/rooms/host/session-decision.ts —— 开会话时“用哪个后端”的唯一来源（#1555）。
//
// 为什么要有它：开会话的人（详情、评论、薄行、探针、写回）不该各自再问一遍注册表。
// 同一个问题“这个工作区用哪个后端”只有一份答案：统一判定出口（工作区文件 > 声明文件 > 自动识别）。
// 这个文件把宿主侧那份统一判定包成开会话能用的一个函数；判定服务缺席或抛错时回 null，
// 由开会话那一侧退回改动前的行为（裸问注册表）。
//
// 四条不能改的约定（改之前先读 #1555 的结论与 ADR 20260921）：
//  1. 只借结论，不重发判定轨迹：判定出口自己会发 detection.detect 结论线；开会话在高频路径上
//     （探针每拍都可能开一次），照发就是重复心跳。所以这里传 logCtx: null —— 判定层的常规轨迹
//     仍由探测、快照那几条路负责记。
//  2. 自动识别那一层用调用方交进来的后端上下文（platform / fs / exec / timers 与改动前
//     registry.select 同一份）：判定出口新增的 autodetectContext 就是为这件事留的入口。
//     本文件不许自己调注册表选择 —— 宿主与刷新机制里选后端只有一个入口（#1443 的静态门禁）。
//  3. 判定自己带着 multiHit 时原样交回：不许在开会话这一层替人挑赢家（与 openTracker 的拒绝口径一致）。
//  4. 判定这一趟不可用（没接线、抛错）一律回 null，由调用方退回旧行为 —— 绝不让“选谁”把会话开成失败。
//
// 反例：为了“省一次判定”而在这一层按匹配名单挑第一个 —— 那正是 #1444 之后详情读不到的原因：
// 各家 matches 只是候选，谁算数由判定出口说了算。
export function createSessionDecisionResolver(deps: any): (cwd: string) => Promise<any> {
  const d: any = deps || {}
  return async function decideSelection(cwd: string): Promise<any> {
    try {
      const dir = String(cwd || '')
      if (!dir) return null
      if (typeof d.getDecisionFn !== 'function') return null
      const mod: any = await d.getDecisionFn()
      const decide: any = mod && mod.decideBackend
      if (typeof decide !== 'function') return null
      const registry: any = await (typeof d.getTrackerRegistry === 'function' ? d.getTrackerRegistry() : null)
      if (!registry || typeof registry.select !== 'function') return null
      const backendCtx: any = (typeof d.backendCtx === 'function') ? (d.backendCtx() || {}) : {}
      const decision: any = await decide(dir, {
        registry: registry,
        platform: backendCtx.platform || null,
        fs: backendCtx.fs || null,
        caller: 'refresh-session',
        // 自动识别那一步要的现场能力（exec / timers 等）由判定出口合并使用；本文件不自己调 select。
        autodetectContext: backendCtx,
        logCtx: null,
      })
      if (!decision || typeof decision !== 'object') return null
      return {
        backendId: decision.backendId,
        source: decision.source,
        ref: decision.ref || null,
        multiHit: decision.multiHit,
        pending: decision.pending,
      }
    } catch (e) {
      // 判定这一趟不可用：回 null 让调用方退回旧行为，绝不让“选谁”把会话开成失败。
      return null
    }
  }
}
