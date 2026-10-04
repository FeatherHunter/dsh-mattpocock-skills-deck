// src/host/stallWatch.js —— 字节增长看门狗（#847，从 src/host/versionControl.js 拆出来的自包含叶子）
//
// 干什么：跑一条 git 命令期间盯着收集器读到的字节数，一个窗口内不再增长就判「传输停住」：先 terminate，
// 再回 { signal: 'stalled', stallMs }（形状与超时同形，调用方当成同一种「这不是命令的真实结局」处理）。
// 补的是 #839 留下的缺口：那里只有两种兜底 —— git 自己的 GIT_HTTP_LOW_SPEED_*（对端彻底不回包时有效）
// 与预算强杀（会把「只是慢」也杀掉）；看门狗是第三种：比预算更早，又不会被「一直慢慢喂字节」骗过去。
//
// 为什么单独一个文件：versionControl.js 贴着 350 行上限（tests/verify-file-granularity.js 的零增长基线），
// 照仓库先例（#500 logStore→logPhones、#821 versionControl→versionControlFiles）把整段搬成自包含叶子，
// 依赖从参数进来、本文件不 import 任何别的宿主文件（单向引用，同层互引那条基线记在 versionControl.js 那一侧）。
//
// 采样来源：收集器自己的计数 —— DSH 的 OutputCollector 有 total（整条流收到的字节总数，首选）与
// bytes（内存里保留的尾部字节数，退一步）；两个都没有就算「一直没有增长」，调用方应当避免这种收集器
// （本文件不猜、也不假装看得见）。判据是「窗口内一次都没增长」，不是「总时长超过窗口」——后者会把
// 「慢但一直有字节」的正常传输误杀，正是这张票要避免的事。采样周期取窗口的四分之一，夹在 200-1000ms。
// 采样对象是**子进程自己的输出**（stdout+stderr），不是网络收包量：对「一声不吭慢慢收」的命令
// （git ls-remote 就是，应答收全之前一个字节都不吐），它会把「慢」判成「停」——这是判据的已知边界，
// 不是误判；写路径要用它，命令得吐进度（git fetch/pull/push 加 --progress 才有）。门禁 ②b 真跑钉着这一条。
// 命令自己结束（handle.done 落定）时看门狗自己退出，不需要调用方额外收尾。
// 默认不开：只有显式传 stallMs 的调用（runGit 的 opts）才会创建它。
export function makeStallWatch(handle, stallMs, timer) {
  const bytes = function () { const c = handle.collected || {}; let n = 0; for (const s of [c.stdout, c.stderr]) { if (s) n += (typeof s.total === 'number') ? s.total : ((typeof s.bytes === 'number') ? s.bytes : 0) } return n }
  const step = Math.max(200, Math.min(1000, Math.floor(stallMs / 4)))
  return (async function () {
    let last = bytes(), changedAt = Date.now()
    for (;;) {
      const settled = await Promise.race([timer.timeout(step).then(function () { return false }), handle.done.then(function () { return true }, function () { return true })])
      if (settled) return null
      const now = bytes()
      if (now !== last) { last = now; changedAt = Date.now() } else if (Date.now() - changedAt >= stallMs) { try { handle.terminate() } catch (e) {} return { signal: 'stalled', stallMs: stallMs } }
    }
  })()
}
