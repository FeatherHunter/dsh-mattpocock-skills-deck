/**
 * src/refresh/rooms/host/gitea-chain-predicates.ts — Gitea 检查链的三条谓词注册（2026-11-11 拆出）。
 *
 * 为什么单独一份文件：检查链求值主文件（check-chain-evaluation.ts）受行数颗粒度门禁
 * （tests/verify-file-granularity.ts，350 有效行上限）约束，gitea 后端补齐四项环境检查时
 * 在那里加不下；这三条注册自成一坨、不与 GitHub/GitLab 的注册共享变量，拆出来最干净。
 *
 * 三个键对应检查目录 GITEA_CATALOG 的三项 backend/preflight 检查：
 *   · preflight:teaAuth        —— 「已登录 Gitea」（问会话 preflight 的前两关结论）；
 *   · backend:gitea:repoAccess —— 「仓库在 Gitea 上可访问」（同一份 preflight 的第三关结论）；
 *   · backend:gitea:repoRemote —— 「已关联 Gitea 仓库」（读本地远端证据，判据 /gitea|forgejo/i）。
 * 注册表里缺键的后果是面板显示「predicate not registered」的 pending（票面修的原始现象），所以
 * tests/verify-gitea-chain-predicates.ts 第一节直接扫主文件与新文件的注册键防漏。
 *
 * 依赖形状：registry 是链求值的谓词注册表（register 键 + 处理器）；envProbe 的 preflightOnce()
 * 一次求值只问一次会话 preflight；giteaRemote 是 chain-env-map 的远端证据口。判断逻辑全部
 * 委托 chain-env-map 的 verdict 与证据函数，本文件不做第二遍解释。
 */
import { teaAuthVerdict, teaRepoAccessVerdict } from './chain-env-map.js'
import type { ChainEnvProbeReply, GiteaRemoteEvidence } from './chain-env-map.js'

/** 谓词注册表只需 register 一格；处理器回 {status, detail?}，异常一律收成 pending。 */
type RegisterLike = { register(key: string, fn: (check: unknown, pctx: PctxLike) => Promise<unknown>): void }

/** 谓词上下文里本文件用到的两格：界面语言（非 'en' 一律按中文）与本次求值目录。 */
type PctxLike = { lang?: string; cwd?: string }

/**
 * 把 Gitea 三条谓词挂进注册表。只在链求值建好 envProbe 与远端证据之后调用一次；
 * 重复注册同键会顶掉旧处理器，所以不要在每次求值里多调。
 */
export function registerGiteaChainPredicates(registry: RegisterLike, envProbe: { preflightOnce(): Promise<ChainEnvProbeReply> }, giteaRemote: { read(at: string): Promise<GiteaRemoteEvidence | null>; failDetail(ev: GiteaRemoteEvidence, zh: boolean): string; unknownDetail(zh: boolean): string }, fallbackCwd: string): void {
  try { registry.register('preflight:teaAuth', async function (_check, rawPctx: PctxLike) {
    try {
      const zh = (rawPctx && rawPctx.lang) !== 'en'
      // 前两关：tea 找没找到、登录态是什么；一次 preflight 的结果两个谓词共用。
      return teaAuthVerdict(await envProbe.preflightOnce(), zh)
    } catch (e) { return { status: 'pending', detail: String((e && (e as Error).message) || e) } }
  }) } catch (e) {}
  try { registry.register('backend:gitea:repoAccess', async function (_check, rawPctx: PctxLike) {
    try {
      const zh = (rawPctx && rawPctx.lang) !== 'en'
      // 第三关：拿会话认出来的仓库地址去问 Gitea 实例；没认出地址时房间跳过这一关回成功，
      //   谓词按 pending 说明「暂时确认不了」，不冒充可达（与 GitLab 同一口径）。
      return teaRepoAccessVerdict(await envProbe.preflightOnce(), zh)
    } catch (e) { return { status: 'pending', detail: String((e && (e as Error).message) || e) } }
  }) } catch (e) {}
  try { registry.register('backend:gitea:repoRemote', async function (_check, rawPctx: PctxLike) {
    try {
      const zh = (rawPctx && rawPctx.lang) !== 'en'
      // 判据是「远端地址里有指向 gitea/forgejo 的那一条」（与房间 matches 同源）；读不到远端列表
      //   时如实 pending「读不到本地仓库信息」，不把它说成「没有远端」。
      const ev = await giteaRemote.read((rawPctx && rawPctx.cwd) || fallbackCwd)
      if (!ev) return { status: 'pending', detail: giteaRemote.unknownDetail(zh) }
      if (ev.kind === 'identity') return { status: 'pass', detail: ev.owner + '/' + ev.name }
      return { status: 'fail', detail: giteaRemote.failDetail(ev, zh) }
    } catch (e) { return { status: 'pending', detail: String((e && (e as Error).message) || e) } }
  }) } catch (e) {}
}
