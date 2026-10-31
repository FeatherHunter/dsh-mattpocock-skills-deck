/**
 * src/refresh/rooms/host/gh-run-report.ts —— 宿主 runGh 跑完一趟之后，把结局回报给出站准入桶（#1007）。
 *
 * 为什么单独一份：冷却窗口的「设」与「清」只有两处真源 —— 房间客户端（src/tracker/rooms/github/transport/client.ts）
 * 与宿主这一路（src/refresh/rooms/host/gh-execution.ts）。宿主文件已经贴着 350 有效行的门禁上限，
 * 把这套分类口径搬出来，也方便以后加新结局时只改一处。
 *
 * #1007 复核起这一份只做转发：三条口径（谁能清零、谁算 transport 失败、aborted 不算失败）已经在
 * src/tracker/kernel/outbound-tiers.ts 的 reportGhOutcome 里写了一份，宿主平台通道与房间 client
 * 都走那一份；这里再手写一遍会出现两处口径分叉（复核就抓到「本文件没排除 aborted、头注释却说排除了」）。
 * 唯一的翻译是 timedOut：宿主那只表到点是自己判出来的事实，交回共享口径前写成 signal=timeout 的形状。
 */
import { reportGhOutcome } from '../../../tracker/kernel/outbound-tiers.js'
import type { OutboundTransportLane } from '../../../tracker/kernel/outbound-tiers.js'

/** 一趟 runGh 结束时交给准入桶的全部事实；outcome 就是子进程收尾对象。 */
export interface GhRunReportInfo {
  lane: OutboundTransportLane
  bucket: string
  cmd: string
  timedOut: boolean
  outcome: { exitCode?: number; signal?: string } | null | undefined
  text: string
}

/**
 * 按共享口径把这一趟的结局回写给同一只准入桶。
 * 包一层 try/catch：上报失败绝不能反过来毁掉这一笔命令的真实结果（和宿主原来那圈 catch 同一个理由）。
 */
export function reportGhRunOutcome(info: GhRunReportInfo): void {
  try {
    // 宿主到点那一趟的收尾对象本来就带 signal=timeout；这里再写一次是为了让「判到点」与「拿到收尾对象」
    // 两条路都落到同一个形状上，调用方不必关心 outcome 里到底带了什么。
    const outcome = info.timedOut ? { exitCode: -1, signal: 'timeout' } : info.outcome
    reportGhOutcome(info.lane, { bucket: info.bucket, cmd: info.cmd, outcome: outcome, stdout: info.text, stderr: '' })
  } catch (eReport) {}
}
