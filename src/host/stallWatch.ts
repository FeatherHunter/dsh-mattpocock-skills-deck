/**
 * src/host/stallWatch.ts —— 字节增长看门狗（#847，从 src/host/versionControl.js 拆出来的自包含叶子）。
 *
 * 来源与零变化：本文件由同目录 stallWatch.js 逐行转写而来，只加类型标注与注释，
 * 没有改任何运行时语义。原来的 .js 文件保留不动，引用方继续写 `./stallWatch.js`，
 * 由 scripts/ts-hook.mjs 在加载时改指到同名 .ts。
 *
 * 干什么：跑一条 git 命令期间盯着收集器读到的字节数，一个窗口内不再增长就判「传输停住」：先 terminate，
 * 再回 { signal: 'stalled', stallMs }（形状与超时同形，调用方当成同一种「这不是命令的真实结局」处理）。
 * 补的是 #839 留下的缺口：那里只有两种兜底 —— git 自己的 GIT_HTTP_LOW_SPEED_*（对端彻底不回包时有效）
 * 与预算强杀（会把「只是慢」也杀掉）；看门狗是第三种：比预算更早，又不会被「一直慢慢喂字节」骗过去。
 *
 * 为什么单独一个文件：versionControl.js 贴着 350 行上限（tests/verify-file-granularity.ts 的零增长基线），
 * 照仓库先例（#500 logStore→logPhones、#821 versionControl→versionControlFiles）把整段搬成自包含叶子，
 * 依赖从参数进来、本文件不 import 任何别的宿主文件（单向引用，同层互引那条基线记在 versionControl.js 那一侧）。
 *
 * 采样来源：收集器自己的计数 —— DSH 的 OutputCollector 有 total（整条流收到的字节总数，首选）与
 * bytes（内存里保留的尾部字节数，退一步）；两个都没有就算「一直没有增长」，调用方应当避免这种收集器
 * （本文件不猜、也不假装看得见）。判据是「窗口内一次都没增长」，不是「总时长超过窗口」——后者会把
 * 「慢但一直有字节」的正常传输误杀，正是这张票要避免的事。采样周期取窗口的四分之一，夹在 200-1000ms。
 * 采样对象是**子进程自己的输出**（stdout+stderr），不是网络收包量：对「一声不吭慢慢收」的命令
 * （git ls-remote 就是，应答收全之前一个字节都不吐），它会把「慢」判成「停」——这是判据的已知边界，
 * 不是误判；写路径要用它，命令得吐进度（git fetch/pull/push 加 --progress 才有）。门禁 ②b 真跑钉着这一条。
 * 命令自己结束（handle.done 落定）时看门狗自己退出，不需要调用方额外收尾。
 * 默认不开：只有显式传 stallMs 的调用（runGit 的 opts）才会创建它。轮询次数按命令预算封顶（见下）。
 *
 * 为什么参数按 `any` 收：子进程句柄与计时器都是宿主框架注入的能力，它们的形状由接线处决定，
 * 本文件只读 `collected`、`done`、`terminate` 与 `timeout` 这几个成员，不拥有它们的完整类型，
 * 所以类型只做“存在性”约束，不替代运行时的能力检测。
 */

/** 采样周期：窗口的四分之一，夹在 200-1000ms 之间。 */
function tickOf(stallMs: number): number { return Math.max(200, Math.min(1000, Math.floor(stallMs / 4))) }

/** 看门狗句柄与计时器的最小形状：本文件实际用到的只有这几个成员，其余一律不读。 */
export interface StallHandle {
  collected?: any
  terminate?: () => void
  done: Promise<any>
}

/** 计时器服务的最小形状：只用 `timeout` 等一小段，其余一律不碰。 */
export interface StallTimer {
  timeout(ms: number): Promise<any>
}

/**
 * 轮询次数上限按这条命令自己的预算封顶（budgetMs）：预算到点那一条竞速自然会收尾，看门狗没必要再数下去。
 * 这一条也是仓库门禁 verify-709 的要求 —— 宿主里不许出现「没有次数上限的轮询」。
 */
export function makeStallWatch(handle: any, stallMs: any, budgetMs: any, timer: any): Promise<any> {
  // 读字节数的那一小段闭包：两个收集器都没有计数时按零算，调用方应当避免这种收集器。
  const bytes = function (): number { const c: any = (handle as any).collected || {}; let n: number = 0; for (const s of [c.stdout, c.stderr]) { if (s) n += (typeof (s as any).total === 'number') ? (s as any).total : ((typeof (s as any).bytes === 'number') ? (s as any).bytes : 0) } return n }
  const budget: number = (typeof budgetMs === 'number' && budgetMs > 0) ? budgetMs : (stallMs as number) * 3
  const maxTicks: number = Math.max(1, Math.ceil(budget / tickOf(stallMs as number)) + 2)
  return (async function (): Promise<any> {
    let last: number = bytes(), changedAt: number = Date.now()
    for (let tick: number = 0; tick < maxTicks; tick += 1) {
      const settled: any = await Promise.race([(timer as any).timeout(tickOf(stallMs as number)), (handle as any).done.then(function () { return true }, function () { return true })])
      if (settled === true) return null
      const now: number = bytes()
      if (now !== last) { last = now; changedAt = Date.now() } else if (Date.now() - changedAt >= (stallMs as number)) { try { (handle as any).terminate() } catch (e) {} return { signal: 'stalled', stallMs: stallMs } }
    }
    return null
  })()
}
