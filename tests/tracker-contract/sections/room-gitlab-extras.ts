/**
 * tests/tracker-contract/sections/room-gitlab-extras.ts — GitLab 房九条新能力里「全仓没有一条断言验过」的那五条。
 *
 * ── 这一段为什么存在 ──────────────────────────────────────────────────────────
 * 对抗式审查（`research/1063-adversarial-review.md`）的攻击面表第 10 行（`:37`）说：九条新能力里，
 * 只有 `counts` 有一条针对 GitLab 的探针（而它当时刚被放宽），**其余八条在整个仓库里没有任何一条断言
 * 真去要过一次数据** —— 有可能是函数在、逻辑对，也有可能明天被人改坏而门禁不响。这一段补的是其中五条：
 * `getCurrentUser`、`getRepoPermissions`、`listSubIssues`、`initProject`、`getRepoKey`。
 * 另外三条（`listPage`、`listLabels`、`setLabelColors`）与 `counts` 一起补在各自那一段里。
 *
 * ── 走哪条缝（不新建脚手架、不新建 runner）─────────────────────────────────────
 * 与 `sections/idempotency.js` 的第六、七段同一套：经**注册表**拿统一的跟踪器接口
 * （`createRegistry(...).register(gitlabBackend)` → `reg.get('gitlab')`），只调对外那一层方法；
 * 把上下文里的命令行执行器（`ctx.exec`）换成桩，按命令名与参数分派：
 *   · gitlab 的客户端要 `exec('glab', args, opts)`；`initProject` 里的 git、`getRepoKey` 第一层的
 *     `git -C <目录> remote get-url origin` 直接走 `ctx.exec` —— 所以一个 exec 同时伺候两边。
 * 只桩到「远端/进程」这一条边界，房里的判档、归一、回执组装全是真的在跑。
 *
 * ── 五条能力各自钉住什么（每条都带 ✗ 反例自证）────────────────────────────────
 *   （2026-10-15 加第六条：阻塞上限制 —— 原生边真写、回退、读回核对、真实状态、环检。）
 *   1）`getCurrentUser`：问的是「当前登录人」那条命令（`glab api user`）一次；回的是身份标识
 *      （`login` 取回包的 `username`，不是显示名）与显示名；回包没说 bot 时 `kind` 必须省略；
 *      问不出来时如实失败，**不许编一个人**；仓库坐标认不出来时一个请求都不发。
 *   2）`getRepoPermissions`：按官方档位一手来源（见下）喂 `access_level`，两个布尔都要算对 ——
 *      Guest(10) 两个 false、Planner(15) 能整理票不能推、Reporter(20) 同上、
 *      Security Manager(25) 同上、Developer(30) 能推；两格都有时取高的那一档；
 *      拿不到档位（没有 `permissions`、两格都 null）时如实失败，**不许拿 false 顶上**。
 *   3）`listSubIssues`：读的是**翻页列表**（`.../issues?per_page=100&page=N`），子票的唯一判据是文件头里的
 *      隐藏归属标记 `<!-- DSH-PARENT: <地图> -->`（#1599 起；旧 `Part of #<地图>` 可见行过渡期回退认）；
 *      没写这一行的（@ 了地图、别家地图的子票）不画；缺编号、形状不对、归一抛错的
 *      记 `dropped`；有候选行却一行都没能算进去时如实失败，**不许回一张空表**（「读不出来」与「真的没有子票」
 *      必须长得不一样）；links 表一次都不碰（`relates_to` 是对称的平级关联，分不出谁是父）。
 *   4）`initProject`：按名字与可见性建仓，两个可见性值都真的出现在发出去的命令里（省略时显式 `--private`）；
 *      回执是合 `RepositoryRef` 的（`name` 等于全路径 `refId`，与 `describe` 同一口径）；
 *      远端建完之后本地那两步（配 origin、push）失败时**如实失败**并说清「远端仓库已经建好了」；
 *      认不出新仓库地址时停下、不拿猜出来的地址去配 remote。
 *   5）`getRepoKey`：注册表不补这条桩（缺席即 undefined），三层兜底各钉一条 —— 问 git 的 remote、
 *      直读 `.git/config`、问 glab；`group` 套 `group` 的多层全路径不许被切短（`grp/sub/deep/proj`
 *      要落成 `owner='grp/sub/deep'`）；三层都拿不到时回 `null`（不抛、不编一个名字）。
 *
 * ── 反例（✗ probe）怎么自证 ──────────────────────────────────────────────────
 * 五条能力各配一个**检查器**（下面那几个具名导出）：检查器接收「一次调用的结果」，返回违规清单，
 * 空清单 = 这一趟合规。正例是「拿真结果喂检查器 → 清单为空」；✗ 反例是「把故意做坏的样本喂给同一个
 * 检查器 → 清单必须非空」，坏样本就是审查报告点名的那些坏法：只取前两段路径、把没写归属标记的票算进来、
 * 拿旧门槛 20 判 triage、把 read 不出来画成空表/假成功/编一个人等等。
 *
 * ── getRepoPermissions 的档位依据（一手来源，2026-10-15 本机实拉）───────────────
 *   · 各档能做什么：`https://docs.gitlab.com/user/permissions/` 的「Project planning →
 *     Project permissions for issues」表里，「Edit issues, including metadata and item locking」与
 *     「Close and reopen issues」两行的 ✓ 都从 **Planner** 那列开始（Guest 列空）；「Project repositories」
 *     表里「Push to non-protected branches」的 ✓ 从 **Developer** 起。两行原文在本段断言里逐档体现。
 *   · 档位数字：GitLab 官方源码 `lib/gitlab/access.rb`（master）写着 `GUEST = 10`、`PLANNER = 15`、
 *     `REPORTER = 20`、`SECURITY_MANAGER = 25`、`DEVELOPER = 30`、`MAINTAINER = 40`、`OWNER = 50`。
 *   所以本段按「triage 门槛 15、push 门槛 30」写断言。
 *
 * ── 这一段故意不判的东西（写下来，免得以后有人以为已经守住了）──────────────────
 *   · 真机上跑一次 `glab`（本段全部是脚本化桩）：真的 GitLab 实例上各档回包里 `permissions` 的形状、
 *     真的建仓/推送的副作用，本段都判不了；
 *   · `?simple=true` 这个参数在单项目接口上到底认不认（源码级已核实、没真发过请求）—— 本段只钉
 *     「问的是这个项目的这条路径」，不钉远端怎么回；
 *   · 人手工在界面上加的「关联」链接与程序写下的链接在远端长得一样 —— 但归属判据只有文件头的
 *     隐藏标记（旧可见行过渡期回退认），links 表一次都不认，所以「手工链接该不该算子票」这个问题已经不存在，
 *     本段只钉「没写归属标记的票不画」。
 */

import * as nodePath from 'node:path'
import { createRegistry } from '../../../src/tracker/registry/core.ts'
import { ERROR_KIND } from '../../../src/tracker/contract/vocabulary.ts'
import {
  gitlabBackend,
  describe as gitlabDescribe,
  issueAddress as gitlabIssueAddress,
  repoSearchAddress as gitlabRepoSearchAddress,
} from '../../../src/tracker/rooms/gitlab/index.ts'
import { parseGitlabOrigin } from '../../../src/tracker/rooms/gitlab/repo.ts'

const KNOWN_KINDS = Object.values(ERROR_KIND)
const GL_REPO = { backend: 'gitlab', refId: 'acme/demo', name: 'demo', url: '' }

// ─────────────────────────────────────────────────────────────────────────────
// 一、几个检查器：接收一次调用的结果，返回违规清单（空 = 合规）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 「这一趟读不成、必须如实失败」的检查器。
 *
 * 为什么单独有它：这一段最要紧的几条反例全都是同一个坏法 —— 读不出来的时候不肯说读不出来
 * （回一个假成功：编一个人、回一张空表、假装发布成功）。把「失败长什么样」收在一处判，
 * 那几条 ✗ 反例才是在证明同一件事。
 */
export function honestFailureCheck(res) {
  const bad = []
  if (!res || typeof res !== 'object') return ['要回一个 OpResult，实得 ' + JSON.stringify(res)]
  if (res.ok !== false) {
    return ['这一趟读不成，必须如实回失败；实得 ok=' + JSON.stringify(res.ok) + '（把读不出来画成了读到了）']
  }
  const e = res.error || {}
  if (!KNOWN_KINDS.includes(e.kind)) bad.push('失败档位要是契约那八档之一，实得 ' + JSON.stringify(e.kind))
  if (typeof e.message !== 'string' || !e.message.trim()) bad.push('失败要给一句给人看的话，实得 ' + JSON.stringify(e.message))
  if (typeof e.raw !== 'string') bad.push('raw 必须是字符串（确实没有原文时给空串），实得 ' + typeof e.raw)
  return bad
}

/**
 * `getCurrentUser` 的回执检查器。
 *
 * `login` 必须是回包的 `username`（GitLab 里那个全局唯一的短名），不是显示名 —— 拿显示名当身份标识
 * 是这一类读最常见的错，反例就盯它。`kind` 按契约「认不出来就省略」：回包没说 bot 时不许填。
 */
export function actorCheck(res, expected) {
  const bad = []
  if (!res || res.ok !== true) return ['这一条要成功回一个 Actor，实得 ' + JSON.stringify(res).slice(0, 200)]
  const d = res.data || {}
  if (typeof d.login !== 'string' || d.login !== expected.login) {
    bad.push('login 要取回包的 username，应为 ' + JSON.stringify(expected.login) + '，实得 ' + JSON.stringify(d.login))
  }
  if (expected.name !== undefined && d.name !== expected.name) {
    bad.push('name 应是显示名 ' + JSON.stringify(expected.name) + '，实得 ' + JSON.stringify(d.name))
  }
  if (expected.kind === undefined) {
    if ('kind' in d) bad.push('回包没说 bot 时 kind 要省略（不许填 user），实得 ' + JSON.stringify(d.kind))
  } else if (d.kind !== expected.kind) {
    bad.push('kind 应为 ' + JSON.stringify(expected.kind) + '，实得 ' + JSON.stringify(d.kind))
  }
  return bad
}

/** `getRepoPermissions` 的回执检查器：两个布尔按给定档位算出来的期望值逐格比，且不许有多余字段。 */
export function permissionsCheck(res, expected) {
  const bad = []
  if (!res || res.ok !== true) return ['这一条要成功回一个结论，实得 ' + JSON.stringify(res).slice(0, 200)]
  const d = res.data || {}
  if (d.push !== expected.push) bad.push('push 应为 ' + expected.push + '，实得 ' + JSON.stringify(d.push))
  if (d.triage !== expected.triage) bad.push('triage 应为 ' + expected.triage + '，实得 ' + JSON.stringify(d.triage))
  const keys = Object.keys(d).sort().join(',')
  if (keys !== 'push,triage') bad.push('RepoPermissions 只有 push / triage 两格，实得 ' + keys)
  return bad
}

/**
 * `listSubIssues` 的回执检查器。
 *
 * 期望的「画出来的是哪几张」（按顺序）与 dropped 一起比：只多一张或少一张都要逮住，
 * 因为这一段的反例全都是「多画了不该画的那张」（blocks 行、地图自己的父票、按 id 查出来的行）。
 * 另外钉三条契约口径：`total` 取 `fetched`（这个端点没有总数可读）、`missing` 恒为 0、
 * 六个字段一个都不能少。
 */
export function subIssuesCheck(res, expected) {
  const bad = []
  if (!res || res.ok !== true) return ['这一条要成功回一份子票表，实得 ' + JSON.stringify(res).slice(0, 200)]
  const d = res.data || {}
  for (const f of ['items', 'total', 'fetched', 'capped', 'missing', 'dropped']) {
    if (!(f in d)) bad.push('缺字段 ' + f)
  }
  const keys = Array.isArray(d.items) ? d.items.map((x) => String(x && x.key)) : null
  if (keys === null) {
    bad.push('items 要是数组，实得 ' + JSON.stringify(d.items))
  } else if (JSON.stringify(keys) !== JSON.stringify(expected.keys)) {
    bad.push('画出来的子票应是 ' + JSON.stringify(expected.keys) + '，实得 ' + JSON.stringify(keys))
  }
  if (typeof expected.dropped === 'number' && d.dropped !== expected.dropped) {
    bad.push('dropped 应为 ' + expected.dropped + '，实得 ' + JSON.stringify(d.dropped))
  }
  if (typeof d.fetched === 'number' && d.total !== d.fetched) {
    bad.push('本后端没有总数可读，total 要取 fetched，实得 total=' + JSON.stringify(d.total) + ' fetched=' + JSON.stringify(d.fetched))
  }
  if (d.missing !== 0) bad.push('missing 本后端恒为 0，实得 ' + JSON.stringify(d.missing))
  return bad
}

/** `initProject` 的回执检查器：回执必须是合 `RepositoryRef` 的那四格，`name` 与 `describe` 同口径取全路径。 */
export function initProjectCheck(res, expected) {
  const bad = []
  if (!res || res.ok !== true) return ['这一条要成功回一个仓库回执，实得 ' + JSON.stringify(res).slice(0, 200)]
  const d = res.data || {}
  if (d.backend !== 'gitlab') bad.push("backend 应是 'gitlab'，实得 " + JSON.stringify(d.backend))
  if (d.refId !== expected.refId) bad.push('refId 应为 ' + expected.refId + '，实得 ' + JSON.stringify(d.refId))
  if (d.name !== expected.refId) {
    bad.push('GitLab 上显示名就是全路径，name 应等于 refId（' + expected.refId + '），实得 ' + JSON.stringify(d.name))
  }
  if (d.url !== expected.url) bad.push('url 应为 ' + expected.url + '，实得 ' + JSON.stringify(d.url))
  return bad
}

/**
 * `getRepoKey` 的检查器。
 *
 * 期望 `null` 的那一档单独走：认不出来是**答案**，不是异常 —— 编一个名字出来（哪怕形状完全合契约）
 * 也必须被逮住，所以「期望 null 却拿到对象」要有自己的那句话。
 */
export function repoKeyCheck(actual, expected) {
  const bad = []
  if (expected === null) {
    if (actual !== null) bad.push('这里应当认不出来、如实回 null，实得 ' + JSON.stringify(actual))
    return bad
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return ['要回 {owner, name}，实得 ' + JSON.stringify(actual)]
  }
  if (actual.owner !== expected.owner) bad.push('owner 应为 ' + JSON.stringify(expected.owner) + '，实得 ' + JSON.stringify(actual.owner))
  if (actual.name !== expected.name) bad.push('name 应为 ' + JSON.stringify(expected.name) + '，实得 ' + JSON.stringify(actual.name))
  const keys = Object.keys(actual).sort().join(',')
  if (keys !== 'name,owner') bad.push('定位口只回 owner / name 两格，实得 ' + keys)
  return bad
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、脚本化的命令行（照 sections/idempotency.js 的 remoteCtx，多两样开关）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 远端后端探针用的调用上下文。
 *
 * 与 `sections/idempotency.js:301` 的 `remoteCtx` 是同一套缝，多两样这一段才需要的开关：
 *   · `executables`：这台机器上「装了什么」（`resolveExecutable` 只认列进来的那几个），
 *     用来把 git 那一层关掉、逼实现走 `.git/config` 或 glab 兜底；
 *   · `fs`：`getRepoKey` 第 2 层要读 `.git/config`，挂一个只回固定文本的假文件系统。
 * 与那一段一样：一个 exec 同时伺候 git 与 glab（按命令名分派），并把每一次命令原样记进 `calls`。
 */
function scriptedCtx(opts) {
  const o = opts || {}
  const allow = o.executables || ['glab', 'git']
  const calls = []
  const script = o.script || (() => ({ code: 1, stdout: '', stderr: 'probe 没脚本化这条命令' }))
  const ctx = {
    cwd: o.cwd || '/ws/fake',
    platform: {
      resolveExecutable: async (n) => (allow.indexOf(n) >= 0 ? '/usr/local/bin/' + n : null),
      path: nodePath.posix,
      env: { get: () => undefined },
    },
    exec: async (cmd, args, runOpts) => {
      calls.push(String(cmd) + ' ' + (args || []).join(' '))
      return script(String(cmd), args || [], runOpts || {})
    },
    isEnabled: () => false,
    logEvent: () => {},
  }
  if (o.fs) ctx.fs = o.fs
  return { ctx, calls }
}

/** 经注册表拿统一的跟踪器接口；用完释放注册表（与 idempotency 段同一套写法）。 */
async function withGitlabTracker(fn) {
  const reg = createRegistry({ logEvent: () => {}, isEnabled: () => false }, { matchesTimeout: 200 })
  const d = reg.register(gitlabBackend)
  try {
    return await fn(reg.get('gitlab'))
  } finally {
    try { d.dispose() } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、这一段
// ─────────────────────────────────────────────────────────────────────────────

export async function run() {
  const out = []
  const P = 'room-gitlab-extras · '
  const assert = async (name, cond, detail) => {
    let ok = false
    try { ok = !!(await cond) } catch (e) { out.push({ name: P + name, ok: false, detail: String((e && e.stack) || e) }); return }
    out.push({ name: P + name, ok, detail: detail || '' })
  }

  // ── 一、getCurrentUser：问的是「当前登录人」那条命令，回的是身份标识 + 显示名 ──
  {
    const user = { id: 7, username: 'alice', name: 'Alice Zhang', avatar_url: 'https://gitlab.example.com/uploads/a.png', bot: false }
    const sc = scriptedCtx({
      script: (cmd, args) => {
        if (cmd === 'glab' && args.join(' ') === 'api user') return { code: 0, stdout: JSON.stringify(user), stderr: '' }
        return { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }
      },
    })
    let hasOp = false
    const r = await withGitlabTracker(async (t) => {
      hasOp = typeof t.getCurrentUser === 'function'
      return await t.getCurrentUser(GL_REPO, sc.ctx)
    })
    await assert(
      'getCurrentUser：统一接口上这条能力在，且只问了一次「当前登录人」那条命令',
      hasOp && sc.calls.length === 1 && sc.calls[0] === 'glab api user',
      JSON.stringify({ hasOp, calls: sc.calls }),
    )
    await assert(
      'getCurrentUser：login 是回包里的 username（身份标识）、name 是显示名',
      actorCheck(r, { login: 'alice', name: 'Alice Zhang' }).length === 0,
      actorCheck(r, { login: 'alice', name: 'Alice Zhang' }).join('；') || JSON.stringify(r),
    )

    const botSc = scriptedCtx({
      script: (cmd, args) => (cmd === 'glab' && args.join(' ') === 'api user'
        ? { code: 0, stdout: JSON.stringify({ username: 'ci-bot', name: 'CI Bot', bot: true }), stderr: '' }
        : { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }),
    })
    const bot = await withGitlabTracker((t) => t.getCurrentUser(GL_REPO, botSc.ctx))
    await assert(
      'getCurrentUser：回包明说 bot:true 时 kind 填 bot',
      actorCheck(bot, { login: 'ci-bot', name: 'CI Bot', kind: 'bot' }).length === 0,
      actorCheck(bot, { login: 'ci-bot', name: 'CI Bot', kind: 'bot' }).join('；') || JSON.stringify(bot),
    )

    // ✗ 反例：同一个检查器对上三种做坏了的回执，必须都非空。
    await assert(
      '✗ probe: 拿显示名当身份标识（login 填 name）的回执必须被逮住',
      actorCheck({ ok: true, data: { login: 'Alice Zhang', name: 'Alice Zhang' } }, { login: 'alice', name: 'Alice Zhang' }).length > 0,
      '检查器把显示名当成了身份标识',
    )
    await assert(
      '✗ probe: 只有空壳（没有 login、没有显示名）的回执必须被逮住',
      actorCheck({ ok: true, data: {} }, { login: 'alice' }).length > 0,
      '检查器放过了没有身份标识的 Actor',
    )
    await assert(
      '✗ probe: 回包没说 bot 却填上 kind 的回执必须被逮住',
      actorCheck({ ok: true, data: { login: 'alice', name: 'Alice Zhang', kind: 'user' } }, { login: 'alice', name: 'Alice Zhang' }).length > 0,
      '检查器放过了凭空填上的 kind',
    )

    const deadSc = scriptedCtx({
      script: (cmd, args) => (cmd === 'glab' && args.join(' ') === 'api user'
        ? { code: 1, stdout: '', stderr: 'glab: 401 Unauthorized' }
        : { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }),
    })
    const dead = await withGitlabTracker((t) => t.getCurrentUser(GL_REPO, deadSc.ctx))
    await assert(
      'getCurrentUser：问不出来时如实失败（不编一个登录人）',
      honestFailureCheck(dead).length === 0,
      honestFailureCheck(dead).join('；') || JSON.stringify(dead),
    )
    await assert(
      '✗ probe: 问不出来却回一个人（成功壳）必须被逮住',
      honestFailureCheck({ ok: true, data: { login: 'ghost' } }).length > 0,
      '检查器把「编出来的人」当成了成功',
    )

    const noRefSc = scriptedCtx({ script: () => ({ code: 0, stdout: JSON.stringify(user), stderr: '' }) })
    const noRef = await withGitlabTracker((t) => t.getCurrentUser({ backend: 'gitlab', refId: 'demo', name: 'demo', url: '' }, noRefSc.ctx))
    await assert(
      'getCurrentUser：仓库坐标认不出来（只有一段路径）时如实失败，且一个请求都没发出去',
      honestFailureCheck(noRef).length === 0 && noRef.error.kind === 'not-found' && noRefSc.calls.length === 0,
      JSON.stringify({ res: noRef, calls: noRefSc.calls }).slice(0, 300),
    )
  }

  // ── 二、getRepoPermissions：官方档位一手来源两侧各一档，两个布尔都要算对 ──
  {
    /** 按一份造出来的回包走一次这条读；`stdout` 给定时原样当回包文本用（空壳/null 那两条走它）。 */
    async function permissionsAt(opts) {
      const o = opts || {}
      const bag = o.stdout !== undefined
        ? o.stdout
        : JSON.stringify({ id: 1, path_with_namespace: 'acme/demo', permissions: o.permissions })
      const sc = scriptedCtx({
        script: (cmd, args) => {
          if (cmd === 'glab' && args[0] === 'api') return { code: 0, stdout: bag, stderr: '' }
          return { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }
        },
      })
      const res = await withGitlabTracker((t) => t.getRepoPermissions(GL_REPO, sc.ctx))
      return { res, calls: sc.calls }
    }
    const slot = (level) => ({ project_access: { access_level: level, notification_level: 3 } })

    const at15 = await permissionsAt({ permissions: slot(15) })
    await assert(
      'getRepoPermissions：Planner(15) → 能整理票（triage 门槛那一档）、不能推',
      permissionsCheck(at15.res, { push: false, triage: true }).length === 0,
      permissionsCheck(at15.res, { push: false, triage: true }).join('；') || JSON.stringify(at15.res),
    )
    await assert(
      'getRepoPermissions：问的是这个项目那条命令（仓库路径按 refId 编码进 URL）',
      at15.calls.length === 1 && at15.calls[0] === 'glab api projects/acme%2Fdemo?simple=true',
      JSON.stringify(at15.calls),
    )

    const at10 = await permissionsAt({ permissions: slot(10) })
    await assert(
      'getRepoPermissions：Guest(10) → 两个布尔都是 false（triage 门槛下一档）',
      permissionsCheck(at10.res, { push: false, triage: false }).length === 0,
      permissionsCheck(at10.res, { push: false, triage: false }).join('；') || JSON.stringify(at10.res),
    )

    const at20 = await permissionsAt({ permissions: slot(20) })
    await assert(
      'getRepoPermissions：Reporter(20) → 能整理票、仍不能推',
      permissionsCheck(at20.res, { push: false, triage: true }).length === 0,
      permissionsCheck(at20.res, { push: false, triage: true }).join('；') || JSON.stringify(at20.res),
    )

    const at25 = await permissionsAt({ permissions: { group_access: { access_level: 25, notification_level: 3 } } })
    await assert(
      'getRepoPermissions：Security Manager(25，从上层分组继承) → 能整理票、不能推',
      permissionsCheck(at25.res, { push: false, triage: true }).length === 0,
      permissionsCheck(at25.res, { push: false, triage: true }).join('；') || JSON.stringify(at25.res),
    )

    const at30 = await permissionsAt({ permissions: slot(30) })
    await assert(
      'getRepoPermissions：Developer(30) → 能推（push 门槛那一档）、能整理票',
      permissionsCheck(at30.res, { push: true, triage: true }).length === 0,
      permissionsCheck(at30.res, { push: true, triage: true }).join('；') || JSON.stringify(at30.res),
    )

    const merged = await permissionsAt({ permissions: { project_access: { access_level: 10 }, group_access: { access_level: 30 } } })
    await assert(
      'getRepoPermissions：两格都有时取高的那一档（继承来的 Developer 不被更低的直接档位压下去）',
      permissionsCheck(merged.res, { push: true, triage: true }).length === 0,
      permissionsCheck(merged.res, { push: true, triage: true }).join('；') || JSON.stringify(merged.res),
    )

    // ✗ 反例：同一个检查器对上三种坏结论，必须都非空。
    await assert(
      '✗ probe: 按旧门槛 20 判 triage（把 Planner(15) 说成不能整理票）必须被逮住',
      permissionsCheck({ ok: true, data: { push: false, triage: false } }, { push: false, triage: true }).length > 0,
      '检查器放过了按 20 判出来的结论',
    )
    await assert(
      '✗ probe: 门槛写低了（把 Planner(15) 判成能推）必须被逮住',
      permissionsCheck({ ok: true, data: { push: true, triage: true } }, { push: false, triage: true }).length > 0,
      '检查器放过了写低了的 push 门槛',
    )
    await assert(
      '✗ probe: 多回一个契约里没有的字段必须被逮住',
      permissionsCheck({ ok: true, data: { push: false, triage: true, admin: true } }, { push: false, triage: true }).length > 0,
      '检查器放过了多出来的字段',
    )

    const noFields = await permissionsAt({ stdout: JSON.stringify({ id: 1, path_with_namespace: 'acme/demo' }) })
    await assert(
      'getRepoPermissions：回包里没有可用档位时如实失败（十个不准拿 false 顶上）',
      honestFailureCheck(noFields.res).length === 0 && noFields.res.error.kind === 'parse',
      JSON.stringify(noFields.res).slice(0, 300),
    )
    const bothNull = await permissionsAt({ permissions: { project_access: null, group_access: null } })
    await assert(
      'getRepoPermissions：公开项目里的非成员（两格都是 null）如实失败',
      honestFailureCheck(bothNull.res).length === 0 && bothNull.res.error.kind === 'parse',
      JSON.stringify(bothNull.res).slice(0, 300),
    )
    const emptyBag = await permissionsAt({ stdout: 'null' })
    await assert(
      'getRepoPermissions：回包是字面 null 时如实失败',
      honestFailureCheck(emptyBag.res).length === 0,
      JSON.stringify(emptyBag.res).slice(0, 300),
    )
    await assert(
      '✗ probe: 拿不到档位却回 {push:false,triage:false}（把「不知道」画成「没有权限」）必须被逮住',
      honestFailureCheck({ ok: true, data: { push: false, triage: false } }).length > 0,
      '检查器把「不知道」当成了「没有权限」',
    )
  }

  // ── 三、listSubIssues：翻页扫仓、只认文件头的隐藏归属标记（旧可见行回退认），links 表一次都不碰 ──
  {
    const MAP_KEY = '7'
    const LIST_PAGE1 = 'projects/acme%2Fdemo/issues?per_page=100&page=1&with_labels_details=true'
    // 五行各代表一种情形（顺序即列表接口的返回顺序）：
    //   21 写了隐藏归属标记 → 画出来（#1599 起新写的票都是这个形状）
    //   30 正文里 @ 了地图、但没写归属标记 → 不是子票，不画
    //   40 写的是别家地图的旧声明行（`Part of #9`）→ 不画
    //   缺编号那行（只有 id、没有 iid）→ 算不进去，记 dropped
    //   22 只有幂等锚与旧声明行 → 回退认，照样画（存量票双读可用）
    const ROWS = [
      { iid: 21, title: '子票甲', state: 'opened', description: '<!-- DSH-PARENT: 7 -->\n\n子票甲的正文', labels: ['wayfinder:task'] },
      { iid: 30, title: '只是 @ 了地图', state: 'opened', description: '这里 @ 了 #7，但没写声明行', labels: [] },
      { iid: 40, title: '别家地图的子票', state: 'opened', description: 'Part of #9\n\n归属是另一张地图', labels: ['wayfinder:task'] },
      { id: 55, title: '缺编号的行', state: 'opened', description: 'Part of #7\n\n编号这一格是空的' },
      { iid: 22, title: '只有声明行', state: 'opened', description: '<!-- DSH-IDEMPOTENCY-KEY: k22 -->\nPart of #7' },
    ]

    const script = (cmd, args) => {
      if (cmd !== 'glab' || args[0] !== 'api') return { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }
      const path = String(args[1] || '')
      if (path === LIST_PAGE1) return { code: 0, stdout: JSON.stringify(ROWS), stderr: '' }
      // 第一页没装满就停了，正常走不到第二页；备一条空页，免得实现翻页时掉进未脚本化。
      if (path.indexOf('issues?per_page=') >= 0) return { code: 0, stdout: '[]', stderr: '' }
      return { code: 1, stdout: '', stderr: 'probe 没脚本化这条列表页: ' + path }
    }

    const sc = scriptedCtx({ script })
    const r = await withGitlabTracker((t) => t.listSubIssues(GL_REPO, MAP_KEY, undefined, sc.ctx))
    const expect = { keys: ['21', '22'], dropped: 1 }
    await assert(
      'listSubIssues：只画归属是 #7 的行（隐藏标记优先、旧声明行回退认）；@ 了地图、别家地图的子票都不画；缺编号的行记 dropped',
      subIssuesCheck(r, expect).length === 0,
      subIssuesCheck(r, expect).join('；') || JSON.stringify(r).slice(0, 500),
    )
    await assert(
      'listSubIssues：走的是翻页列表接口，links 表一次都不碰（对称的平级关联分不出谁是父）',
      sc.calls.length === 1 && sc.calls[0] === 'glab api ' + LIST_PAGE1,
      JSON.stringify(sc.calls),
    )

    // ✗ 反例：同一个检查器对三种做坏了的结论，必须都非空。
    const sample = r.ok ? r.data : {}
    const doctored = (patch) => ({ ok: true, data: Object.assign({}, sample, patch) })
    await assert(
      '✗ probe: 把没写归属标记的票（30）也算成子票的结论必须被逮住',
      subIssuesCheck(doctored({ items: [{ key: '21' }, { key: '22' }, { key: '30' }] }), expect).length > 0,
      '检查器放过了没写归属标记的行',
    )
    await assert(
      '✗ probe: 把别家地图的子票（40）也算进来的结论必须被逮住',
      subIssuesCheck(doctored({ items: [{ key: '21' }, { key: '22' }, { key: '40' }] }), expect).length > 0,
      '检查器放过了归属别家地图的行',
    )
    await assert(
      '✗ probe: 把缺编号的行抹掉（dropped 记 0）的结论必须被逮住',
      subIssuesCheck(doctored({ dropped: 0 }), expect).length > 0,
      '检查器放过了被抹掉的 dropped',
    )

    // 有候选行、却一行都没能算进去 → 如实失败，不许回一张空表。
    const undecidableSc = scriptedCtx({
      script: (cmd, args) => {
        const path = String((args || [])[1] || '')
        if (cmd === 'glab' && path.indexOf('issues?per_page=') >= 0) {
          return { code: 0, stdout: JSON.stringify([{ id: 1, title: '没编号' }, { id: 2, title: '也没编号' }]), stderr: '' }
        }
        return { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + (args || []).join(' ') }
      },
    })
    const lost = await withGitlabTracker((t) => t.listSubIssues(GL_REPO, MAP_KEY, undefined, undecidableSc.ctx))
    await assert(
      'listSubIssues：有候选行却一行都算不进去时如实失败（不把「读不出来」画成「一张都没有」）',
      honestFailureCheck(lost).length === 0 && lost.error.kind === 'parse' && /一行都没能算进去/.test(lost.error.message),
      JSON.stringify(lost).slice(0, 300),
    )
    await assert(
      '✗ probe: 一行都没算进去却回一张空表（成功壳）必须被逮住',
      honestFailureCheck({ ok: true, data: { items: [], total: 0, fetched: 0, capped: false, missing: 0, dropped: 1 } }).length > 0,
      '检查器把「读不出来」当成了「没有子票」',
    )

    // 真的没有子票（仓里一张都没写声明行）→ 照常回空表，这不是失败（与上一条正好是一对）。
    const emptySc = scriptedCtx({
      script: (cmd, args) => (cmd === 'glab' && String((args || [])[1] || '').indexOf('issues?per_page=') >= 0
        ? { code: 0, stdout: JSON.stringify([{ iid: 1, title: '路人票', state: 'opened', description: '普通正文' }]), stderr: '' }
        : { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + (args || []).join(' ') }),
    })
    const none = await withGitlabTracker((t) => t.listSubIssues(GL_REPO, MAP_KEY, undefined, emptySc.ctx))
    await assert(
      'listSubIssues：仓里没有一张写声明行时照常回空表（「没有子票」不是失败）',
      subIssuesCheck(none, { keys: [], dropped: 0 }).length === 0,
      subIssuesCheck(none, { keys: [], dropped: 0 }).join('；') || JSON.stringify(none).slice(0, 300),
    )
  }

  // ── 四、initProject：按名字与可见性建仓、回执照实说，本地那两步失败不许假报成功 ──
  {
    /** 走一次开仓发布：`opts` 里的开关决定哪一步坏掉；返回回执与每一次命令原文。 */
    async function runInit(opts) {
      const o = opts || {}
      const sc = scriptedCtx({
        script: (cmd, args) => {
          const line = (args || []).join(' ')
          if (cmd === 'glab') {
            if (line === 'api user') return { code: 0, stdout: JSON.stringify({ username: 'alice' }), stderr: '' }
            if (line.indexOf('repo create ') === 0) {
              if (o.createFails) return { code: 1, stdout: '', stderr: 'glab: 建仓被回绝（探针脚本）' }
              const stdout = o.createStdout !== undefined ? o.createStdout : 'https://gitlab.com/alice/' + (args[2] || '') + '.git\n'
              return { code: 0, stdout, stderr: '' }
            }
            if (line.indexOf('api projects/') === 0) return { code: 1, stdout: '', stderr: 'probe 回查接口也没拿到项目' }
            return { code: 1, stdout: '', stderr: 'probe 没脚本化: glab ' + line }
          }
          if (cmd === 'git') {
            if (line === 'rev-parse --is-inside-work-tree') return { code: 1, stdout: '', stderr: 'fatal: not a git repository' }
            if (line === 'init' || line === 'add .') return { code: 0, stdout: '', stderr: '' }
            if (line.indexOf('commit ') === 0) return { code: 0, stdout: '[main (root-commit)] initial commit', stderr: '' }
            if (line === 'remote get-url origin') {
              return o.hasOrigin ? { code: 0, stdout: 'https://gitlab.com/old/repo.git', stderr: '' } : { code: 1, stdout: '', stderr: 'error: No such remote' }
            }
            if (line.indexOf('remote add origin ') === 0 || line.indexOf('remote set-url origin ') === 0) {
              if (!o.wireFails) return { code: 0, stdout: '', stderr: '' }
              return { code: 1, stdout: '', stderr: o.wireStderr || 'error: 配 remote 失败（探针脚本）' }
            }
            if (line.indexOf('push ') === 0) {
              if (!o.pushFails) {
                return { code: 0, stdout: 'To https://gitlab.com/alice/demo-new.git\n * [new branch] HEAD -> main', stderr: '' }
              }
              return { code: 1, stdout: '', stderr: o.pushStderr || 'error: 推不上去（探针脚本）' }
            }
            return { code: 1, stdout: '', stderr: 'probe 没脚本化: git ' + line }
          }
          return { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd }
        },
      })
      const res = await withGitlabTracker((t) => t.initProject({ cwd: '/ws/fake' }, { name: o.name || 'demo-new', visibility: o.visibility }, sc.ctx))
      return { res, calls: sc.calls }
    }

    /**
     * 发出去的建仓命令拆成 token（没发出去就是空数组）。
     *
     * 为什么按 token 比而不是比整串：这条命令上除了名字与可见性，还挂着别的开关
     * （今天是 `--skipGitInit`，房里的注释写了为什么必须带它）。断言要钉的是「名字与可见性真的在参数里」，
     * 多一个不相关的开关不该让这条断言红 —— 那种红会把人的注意力引到开关列表上，而不是可见性有没有生效。
     * 反过来，可见性缺席、或者两个可见性开关同时出现，都必须被逮住。
     */
    const createTokens = (calls, name) => {
      const hit = calls.filter((c) => c.indexOf('glab repo create ' + name + ' ') === 0)[0]
      return hit ? hit.split(' ') : []
    }

    const priv = await runInit({ visibility: 'private' })
    const privExpect = { refId: 'alice/demo-new', url: 'https://gitlab.com/alice/demo-new' }
    await assert(
      'initProject：按名字建起来，回执合 RepositoryRef（name 取全路径）',
      initProjectCheck(priv.res, privExpect).length === 0,
      initProjectCheck(priv.res, privExpect).join('；') || JSON.stringify(priv.res).slice(0, 300),
    )
    await assert(
      'initProject：visible=private 真的出现在发出去的建仓命令里（名字与 --private 都在参数里）',
      createTokens(priv.calls, 'demo-new').indexOf('--private') >= 0 &&
        createTokens(priv.calls, 'demo-new').indexOf('--public') < 0,
      JSON.stringify(priv.calls),
    )
    await assert(
      'initProject：远端建完把 origin 指到刚建的那张仓库（地址取自建仓输出，不猜主机）',
      priv.calls.indexOf('git remote add origin https://gitlab.com/alice/demo-new.git') >= 0,
      JSON.stringify(priv.calls),
    )

    const pub = await runInit({ name: 'demo-pub', visibility: 'public' })
    const pubExpect = { refId: 'alice/demo-pub', url: 'https://gitlab.com/alice/demo-pub' }
    await assert(
      'initProject：visible=public 走另一条参数（--public，且没有 --private），回执同样合契约',
      createTokens(pub.calls, 'demo-pub').indexOf('--public') >= 0 &&
        createTokens(pub.calls, 'demo-pub').indexOf('--private') < 0 &&
        initProjectCheck(pub.res, pubExpect).length === 0,
      JSON.stringify({ calls: pub.calls, res: pub.res }).slice(0, 400),
    )
    const noVis = await runInit({ name: 'demo-vis', visibility: undefined })
    await assert(
      'initProject：不写可见性时显式按私有建（不许交给实例默认值）',
      createTokens(noVis.calls, 'demo-vis').indexOf('--private') >= 0,
      JSON.stringify(noVis.calls),
    )

    // ✗ 反例：同一个检查器对上两种做坏了的回执，必须都非空。
    await assert(
      '✗ probe: 回执里 name 只填项目名（不是全路径）必须被逮住',
      initProjectCheck({ ok: true, data: { backend: 'gitlab', refId: 'alice/demo-new', name: 'demo-new', url: 'https://gitlab.com/alice/demo-new' } }, privExpect).length > 0,
      '检查器放过了与 describe 口径不一致的 name',
    )
    await assert(
      '✗ probe: 回执地址还带着 .git 必须被逮住',
      initProjectCheck({ ok: true, data: { backend: 'gitlab', refId: 'alice/demo-new', name: 'alice/demo-new', url: 'https://gitlab.com/alice/demo-new.git' } }, privExpect).length > 0,
      '检查器放过了带 .git 的浏览地址',
    )

    // 远端建好之后本地那两步失败：如实失败（这是最容易被假报成功的一段）。
    // 这里钉的是两件事，分开写是因为房里的挑话规矩：原因**认得出档位**时用本家那句话
    // （「远端仓库已经建好了…」），认不出来时按全仓统一口径换成通用提示 —— 那时原文仍在 `raw` 里，
    // 所以「世界已经变了」这件事照样查得到，只是不在 message 里。两条路都要钉住，不然哪天假报成功不会响。
    const pushFail = await runInit({ visibility: 'private', pushFails: true })
    await assert(
      'initProject：远端建好之后 push 失败 → 如实失败，原文不丢，且建仓命令确实已经发出去过（世界已经变了）',
      honestFailureCheck(pushFail.res).length === 0 &&
        pushFail.res.error.raw.indexOf('推不上去') >= 0 &&
        createTokens(pushFail.calls, 'demo-new').length > 0,
      JSON.stringify({ res: pushFail.res, calls: pushFail.calls }).slice(0, 400),
    )
    const pushFailKnown = await runInit({
      visibility: 'private',
      pushFails: true,
      pushStderr: "fatal: unable to access 'https://gitlab.com/alice/demo-new.git/': Could not resolve host: gitlab.com",
    })
    await assert(
      'initProject：push 失败的原因认得出档位时，话里说清「远端仓库已经建好了」（只有兜底那一档才换通用提示）',
      honestFailureCheck(pushFailKnown.res).length === 0 &&
        pushFailKnown.res.error.kind === 'network' &&
        /远端仓库已经建好了/.test(pushFailKnown.res.error.message),
      JSON.stringify(pushFailKnown.res).slice(0, 300),
    )
    await assert(
      '✗ probe: 远端建好、push 却失败仍旧回成功必须被逮住',
      honestFailureCheck({ ok: true, data: { backend: 'gitlab', refId: 'alice/demo-new', name: 'alice/demo-new', url: 'https://gitlab.com/alice/demo-new' } }).length > 0,
      '检查器把「没推上去」当成了发布成功',
    )

    const wireFail = await runInit({
      visibility: 'private',
      hasOrigin: true,
      wireFails: true,
      wireStderr: 'error: could not lock config file .git/config: permission denied',
    })
    await assert(
      'initProject：origin 没配上时如实失败，并说清远端已经建好、本地提交还在',
      honestFailureCheck(wireFail.res).length === 0 &&
        /远端仓库已经建好了/.test(wireFail.res.error.message) &&
        /origin 没配上/.test(wireFail.res.error.message) &&
        wireFail.calls.filter((c) => c.indexOf('git remote set-url origin https://gitlab.com/alice/demo-new.git') === 0).length === 1,
      JSON.stringify({ res: wireFail.res, calls: wireFail.calls }).slice(0, 400),
    )

    const noAddr = await runInit({ visibility: 'private', createStdout: 'Created repository demo-new (no url here)\n' })
    await assert(
      'initProject：认不出新仓库地址时停下、不配 remote（宁可不发，也不拿猜出来的地址去配）',
      honestFailureCheck(noAddr.res).length === 0 &&
        /认不出它的地址/.test(noAddr.res.error.message) &&
        noAddr.calls.filter((c) => c.indexOf('remote add') >= 0 || c.indexOf('remote set-url') >= 0).length === 0,
      JSON.stringify({ res: noAddr.res, calls: noAddr.calls }).slice(0, 400),
    )

    const badName = await runInit({ name: '有 空格的仓库名', visibility: 'private' })
    await assert(
      'initProject：名字不合规时当场失败、一个进程都没起',
      honestFailureCheck(badName.res).length === 0 && badName.res.error.kind === 'parse' && badName.calls.length === 0,
      JSON.stringify({ res: badName.res, calls: badName.calls }).slice(0, 300),
    )
  }

  // ── 五、getRepoKey：三层兜底各钉一条，多层全路径不许被切短，认不出来回 null ──
  {
    // 第 1 层：问 git 的 remote。
    const sc1 = scriptedCtx({
      script: (cmd, args) => (cmd === 'git'
        ? { code: 0, stdout: 'git@gitlab.com:group/sub/project.git\n', stderr: '' }
        : { code: 1, stdout: '', stderr: 'probe 第 1 层就该回，不该问到 ' + cmd + ' ' + args.join(' ') }),
    })
    let hasOp = false
    const k1 = await withGitlabTracker(async (t) => {
      hasOp = typeof t.getRepoKey === 'function'
      return await t.getRepoKey('/ws/fake', sc1.ctx)
    })
    await assert(
      'getRepoKey：定位口在统一接口上（注册表不补这条桩，缺席就是 undefined）',
      hasOp,
      '注册表拿到的接口上没有 getRepoKey',
    )
    await assert(
      'getRepoKey 第 1 层：问 git 的 remote（带 -C 与目录），多段分组落成 owner=group/sub',
      repoKeyCheck(k1, { owner: 'group/sub', name: 'project' }).length === 0 &&
        sc1.calls.length === 1 &&
        sc1.calls[0] === 'git -C /ws/fake remote get-url origin',
      JSON.stringify({ k: k1, calls: sc1.calls }),
    )
    await assert(
      '✗ probe: 按 GitHub 那样只取前两段（owner=group、name=sub）必须被逮住',
      repoKeyCheck({ owner: 'group', name: 'sub' }, { owner: 'group/sub', name: 'project' }).length > 0,
      '检查器放过了被切短的路径',
    )
    await assert(
      '✗ probe: 没去掉结尾 .git 必须被逮住',
      repoKeyCheck({ owner: 'group/sub', name: 'project.git' }, { owner: 'group/sub', name: 'project' }).length > 0,
      '检查器放过了没去 .git 的名字',
    )

    // 第 2 层：git 起不来时直读 .git/config（把 git 从这台机器的可执行文件里关掉）。
    const cfg = '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://gitlab.example.com/team/deep/proj.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
    const fsCalls = []
    const sc2 = scriptedCtx({
      executables: ['glab'],
      fs: {
        resolve: async (p, o) => { fsCalls.push(String(p) + ' @ ' + String((o && o.cwd) || '')); return '/ws/fake/' + p },
        readText: async (t) => { fsCalls.push('read ' + t); return cfg },
      },
      script: (cmd, args) => ({ code: 1, stdout: '', stderr: 'probe 第 2 层就该回，不该问到 ' + cmd + ' ' + args.join(' ') }),
    })
    const k2 = await withGitlabTracker((t) => t.getRepoKey('/ws/fake', sc2.ctx))
    await assert(
      'getRepoKey 第 2 层：git 起不来时直读 .git/config 里 origin 的 url（连 glab 都不问）',
      repoKeyCheck(k2, { owner: 'team/deep', name: 'proj' }).length === 0 && sc2.calls.length === 0,
      JSON.stringify({ k: k2, calls: sc2.calls, fsCalls }),
    )
    await assert(
      '✗ probe: 第 2 层丢掉子分组（owner=team、name=deep）必须被逮住',
      repoKeyCheck({ owner: 'team', name: 'deep' }, { owner: 'team/deep', name: 'proj' }).length > 0,
      '检查器放过了丢掉子分组的结论',
    )

    // 第 3 层：本地没配 remote 时问 glab 的 path_with_namespace。
    const sc3 = scriptedCtx({
      executables: ['glab'],
      script: (cmd, args) => (cmd === 'glab' && args.join(' ') === 'repo view --output json'
        ? { code: 0, stdout: JSON.stringify({ path_with_namespace: 'grp/sub/deep/proj' }), stderr: '' }
        : { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }),
    })
    const k3 = await withGitlabTracker((t) => t.getRepoKey('/ws/fake', sc3.ctx))
    await assert(
      'getRepoKey 第 3 层：问 glab，group 套 group 的多层全路径整段落在 owner 里',
      repoKeyCheck(k3, { owner: 'grp/sub/deep', name: 'proj' }).length === 0 &&
        sc3.calls.length === 1 &&
        sc3.calls[0] === 'glab repo view --output json',
      JSON.stringify({ k: k3, calls: sc3.calls }),
    )
    await assert(
      '✗ probe: 第 3 层只取最后两段（owner=deep、name=proj）必须被逮住',
      repoKeyCheck({ owner: 'deep', name: 'proj' }, { owner: 'grp/sub/deep', name: 'proj' }).length > 0,
      '检查器放过了丢掉上层分组的结果',
    )

    // 三层都不成 → null（不抛、不编）。
    const sc4 = scriptedCtx({
      script: (cmd, args) => (cmd === 'git'
        ? { code: 1, stdout: '', stderr: 'fatal: not a git repository' }
        : { code: 1, stdout: '', stderr: 'glab: 当前目录不在任何项目里' }),
    })
    const k4 = await withGitlabTracker((t) => t.getRepoKey('/ws/nowhere', sc4.ctx))
    await assert(
      'getRepoKey：远端地址、本地配置、命令行工具三层都拿不到时回 null（不抛、不编一个名字）',
      repoKeyCheck(k4, null).length === 0,
      JSON.stringify(k4),
    )
    await assert(
      '✗ probe: 认不出来却编一个名字必须被逮住',
      repoKeyCheck({ owner: 'ws', name: 'nowhere' }, null).length > 0,
      '检查器把编出来的名字当成了认出来的结果',
    )

    const sc5 = scriptedCtx({ executables: [], script: () => ({ code: 0, stdout: 'git@gitlab.com:group/project.git', stderr: '' }) })
    const k5 = await withGitlabTracker((t) => t.getRepoKey('/ws/nowhere', sc5.ctx))
    await assert(
      'getRepoKey：这台机器上连 git 与 glab 都没装时也回 null（一个进程都不起、也不抛）',
      repoKeyCheck(k5, null).length === 0 && sc5.calls.length === 0,
      JSON.stringify({ k: k5, calls: sc5.calls }),
    )
  }

  // ── 五之二、自托管链接：主机从远端学到之后，仓库地址与票地址都不再写死 gitlab.com（#435）──
  //   三道题各钉一层：问 git 的 remote（IP 形式）、直读 .git/config（http + 自定义端口）、问 glab（web_url）。
  //   每道题都同时核对「认出的坐标」与「describe 产出的 url / host / issueAddress」，最后拿一条
  //   什么也没学到的路径验默认站点兜底，并用 ✗ 反例自证「写死官网」会被逮住。
  {
    // 第 1 层：IP 形式的自托管 remote（连 gitlab 字样都没有），主机必须被学住。
    const scIp = scriptedCtx({
      script: (cmd, args) => (cmd === 'git'
        ? { code: 0, stdout: 'git@10.1.2.3:group/project.git\n', stderr: '' }
        : { code: 1, stdout: '', stderr: 'probe 第 1 层就该回，不该问到 ' + cmd + ' ' + args.join(' ') }),
    })
    const ip = await withGitlabTracker(async (t) => {
      const k = await t.getRepoKey('/ws/selfhost-ip', scIp.ctx)
      const described = t.describe({ cwd: '/ws/selfhost-ip', refId: 'group/project' }, 'gitlab')
      return { k, described, named: gitlabDescribe({ cwd: '/ws/selfhost-ip', refId: 'group/project' }, 'gitlab') }
    })
    await assert(
      '自托管链接 第 1 层：IP 形式 remote 认出的主机带进仓库地址（url 与 host 都是那台实例，不再写死 gitlab.com）',
      repoKeyCheck(ip.k, { owner: 'group', name: 'project' }).length === 0 &&
        ip.described.url === 'https://10.1.2.3/group/project' &&
        ip.described.host === 'https://10.1.2.3' &&
        ip.named.url === 'https://10.1.2.3/group/project',
      JSON.stringify({ k: ip.k, described: ip.described, named: ip.named }),
    )
    await assert(
      '自托管链接：票地址跟着仓库主机走，拼在那台实例上',
      gitlabIssueAddress(ip.described, '7') === 'https://10.1.2.3/group/project/-/issues/7' &&
        gitlabIssueAddress({ backend: 'gitlab', refId: 'group/project', name: 'project', url: 'https://10.1.2.3/group/project' }, '7') === 'https://10.1.2.3/group/project/-/issues/7',
      JSON.stringify({ byRef: gitlabIssueAddress(ip.described, '7') }),
    )
    await assert(
      '✗ probe: 自托管票地址仍写死 gitlab.com 必须被逮住',
      gitlabIssueAddress(ip.described, '7') !== 'https://gitlab.com/group/project/-/issues/7',
      '自托管实例的票地址被拼到了官网',
    )

    // 第 2 层：.git/config 里的 http + 自定义端口，原样保留 scheme 与端口。
    const portCfg = '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = http://10.1.2.3:8086/team/deep/proj.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
    const scPort = scriptedCtx({
      executables: ['glab'],
      fs: {
        resolve: async (p) => '/ws/selfhost-port/' + p,
        readText: async () => portCfg,
      },
      script: (cmd, args) => ({ code: 1, stdout: '', stderr: 'probe 第 2 层就该回，不该问到 ' + cmd + ' ' + args.join(' ') }),
    })
    const port = await withGitlabTracker(async (t) => {
      const k = await t.getRepoKey('/ws/selfhost-port', scPort.ctx)
      return { k, described: t.describe({ cwd: '/ws/selfhost-port', refId: 'team/deep/proj' }, 'gitlab') }
    })
    await assert(
      '自托管链接 第 2 层：.git/config 的 http 地址带上自定义端口，仓库与票地址都指向 http://10.1.2.3:8086',
      repoKeyCheck(port.k, { owner: 'team/deep', name: 'proj' }).length === 0 &&
        port.described.url === 'http://10.1.2.3:8086/team/deep/proj' &&
        port.described.host === 'http://10.1.2.3:8086' &&
        gitlabIssueAddress(port.described, '12') === 'http://10.1.2.3:8086/team/deep/proj/-/issues/12',
      JSON.stringify({ k: port.k, described: port.described }),
    )

    // 第 3 层：glab 的 web_url 就是这台实例的网页地址。
    const scGlab = scriptedCtx({
      executables: ['glab'],
      script: (cmd, args) => (cmd === 'glab' && args.join(' ') === 'repo view --output json'
        ? { code: 0, stdout: JSON.stringify({ path_with_namespace: 'grp/proj', web_url: 'https://gitlab.corp.example/grp/proj' }), stderr: '' }
        : { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }),
    })
    const viaGlab = await withGitlabTracker(async (t) => {
      const k = await t.getRepoKey('/ws/selfhost-glab', scGlab.ctx)
      return { k, described: t.describe({ cwd: '/ws/selfhost-glab', refId: 'grp/proj' }, 'gitlab') }
    })
    await assert(
      '自托管链接 第 3 层：glab repo view 回的 web_url 决定仓库地址（部署域名不再是 gitlab.com）',
      repoKeyCheck(viaGlab.k, { owner: 'grp', name: 'proj' }).length === 0 &&
        viaGlab.described.url === 'https://gitlab.corp.example/grp/proj' &&
        viaGlab.described.host === 'https://gitlab.corp.example',
      JSON.stringify({ k: viaGlab.k, described: viaGlab.described }),
    )

    // 默认站点兜底：这台工作区什么主机也没学到时，仍然拼 gitlab.com，且不多写 host 那一格。
    const plain = gitlabDescribe({ cwd: '/ws/unknown-host', refId: 'acme/demo' }, 'gitlab')
    await assert(
      '自托管链接：没学到主机的路径仍按 gitlab.com 兜底，且回包不多出 host 一格',
      plain.url === 'https://gitlab.com/acme/demo' && !('host' in plain),
      JSON.stringify(plain),
    )
    await assert(
      '自托管链接：按名搜仓库在给了自托管仓库引用时搜那台实例',
      gitlabRepoSearchAddress('demo', { backend: 'gitlab', refId: 'acme/demo', name: 'demo', url: '', host: 'https://gitlab.corp.example' }) ===
        'https://gitlab.corp.example/search?search=demo',
      gitlabRepoSearchAddress('demo', { backend: 'gitlab', refId: 'acme/demo', name: 'demo', url: '', host: 'https://gitlab.corp.example' }),
    )

    // 解析函数本身的口径：scp / ssh / http 端口 / 认不出。
    await assert(
      'parseGitlabOrigin：scp 写法按 https 取主机，ssh 丢弃 ssh 端口，http(s) 保留自定义端口',
      parseGitlabOrigin('git@10.1.2.3:group/project.git') === 'https://10.1.2.3' &&
        parseGitlabOrigin('ssh://git@gitlab.corp.example:22/grp/proj.git') === 'https://gitlab.corp.example' &&
        parseGitlabOrigin('https://gitlab.corp.example:8443/grp/proj.git') === 'https://gitlab.corp.example:8443' &&
        parseGitlabOrigin('http://10.1.2.3:8086/team/deep/proj.git') === 'http://10.1.2.3:8086' &&
        parseGitlabOrigin('./local/dir') === '' &&
        parseGitlabOrigin('not-a-url') === '',
      JSON.stringify({
        scp: parseGitlabOrigin('git@10.1.2.3:group/project.git'),
        ssh: parseGitlabOrigin('ssh://git@gitlab.corp.example:22/grp/proj.git'),
        port: parseGitlabOrigin('http://10.1.2.3:8086/team/deep/proj.git'),
      }),
    )
    await assert(
      '✗ probe: 把 ssh 端口当成网页端口（ssh://...:22 → https://host:22）必须被逮住',
      parseGitlabOrigin('ssh://git@gitlab.corp.example:22/grp/proj.git') !== 'https://gitlab.corp.example:22',
      'ssh 端口被照搬到了网页地址上',
    )
  }

  // ── 六、阻塞上限路径：原生边真写、没能力回退正文行、两条路写后都读回核对、状态逐张落实、环检共用同一道门 ──
  //   桩里那台假 GitLab：票只能从这张表里来（对端状态落实、环检沿边展开都要读它），links 行带 issue_link_id
  //   （删边只能拿这个编号，真 GitLab 的回包里有它，没有它删不掉 —— 房里拿不到编号时如实失败，不拿 id 顶）。
  {
    const BASE = 'projects/acme%2Fdemo/issues'
    const PREMIUM_MSG = 'Blocked issues not available for current license'
    function makeStore(tickets, opts) {
      const o = opts || {}
      const T = new Map()
      for (const t of tickets) {
        T.set(String(t.iid), {
          iid: t.iid, title: t.title, state: t.state || 'opened',
          description: t.description || '',
          links: (t.links || []).map((l) => Object.assign({}, l)),
        })
      }
      let nextLinkId = 9000
      const row = (t) => ({
        iid: t.iid, title: t.title, state: t.state, description: t.description,
        labels: [], updated_at: '2026-10-15T00:00:00Z', web_url: 'https://gitlab.example/acme/demo/-/issues/' + t.iid,
      })
      const fval = (args, name) => {
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-f' && String(args[i + 1] || '').indexOf(name + '=') === 0) return String(args[i + 1]).slice(name.length + 1)
        }
        return ''
      }
      const script = (cmd, args) => {
        if (cmd !== 'glab' || args[0] !== 'api') return { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + (args || []).join(' ') }
        const path = String(args[1] || '')
        const method = args.indexOf('--method') >= 0 ? String(args[args.indexOf('--method') + 1]) : 'GET'
        let m = new RegExp('^' + BASE + '/(\\d+)/links/(\\d+)$').exec(path)
        if (m && method === 'DELETE') {
          const t = T.get(m[1])
          if (!t) return { code: 1, stdout: '', stderr: '404 Issue Not Found' }
          const at = t.links.findIndex((l) => String(l.issue_link_id) === m[2])
          if (at < 0) return { code: 1, stdout: '', stderr: '404 Link Not Found' }
          t.links.splice(at, 1)
          return { code: 0, stdout: '{}', stderr: '' }
        }
        m = new RegExp('^' + BASE + '/(\\d+)/links$').exec(path)
        if (m) {
          const t = T.get(m[1])
          if (!t) return { code: 1, stdout: '', stderr: '404 Issue Not Found' }
          if (o.links403) return { code: 1, stdout: '', stderr: '403 ' + PREMIUM_MSG }
          if (method === 'POST') {
            // 免费档形状（#1599 真机探针查实）：GET links 通（读回空），POST is_blocked_by 403 点名要 Premium。
            if (o.postBlocked403 && fval(args, 'link_type') === 'is_blocked_by') return { code: 1, stdout: '', stderr: '403 ' + PREMIUM_MSG }
            const target = fval(args, 'target_issue_iid')
            const type = fval(args, 'link_type') || 'relates_to'
            const link = { issue_link_id: ++nextLinkId, iid: Number(target), link_type: type }
            t.links.push(link)
            return { code: 0, stdout: JSON.stringify({ issue_link_id: link.issue_link_id }), stderr: '' }
          }
          if (o.lyingReadback) return { code: 0, stdout: '[]', stderr: '' }
          return { code: 0, stdout: JSON.stringify(t.links), stderr: '' }
        }
        m = new RegExp('^' + BASE + '/(\\d+)(\\?|$)').exec(path)
        if (m) {
          const t = T.get(m[1])
          if (!t) return { code: 1, stdout: '', stderr: '404 Issue Not Found' }
          if (method === 'PUT') {
            const desc = fval(args, 'description')
            t.description = desc
            const echoed = row(t)
            if (o.dropDescriptionEcho) delete echoed.description
            return { code: 0, stdout: JSON.stringify(echoed), stderr: '' }
          }
          return { code: 0, stdout: JSON.stringify(row(t)), stderr: '' }
        }
        if (path.indexOf(BASE + '?') === 0) return { code: 0, stdout: JSON.stringify([...T.values()].map(row)), stderr: '' }
        return { code: 1, stdout: '', stderr: 'probe 没脚本化这条路径: ' + path }
      }
      return { script, get: (iid) => T.get(String(iid)) }
    }
    const writesOf = (sc) => sc.calls.filter((c) => c.indexOf('--method') >= 0)

    // A. 原生加上两条：两次 POST 都是 is_blocked_by，一次 PUT 都没有；返回的阻塞带真实标题与真实开关。
    {
      const store = makeStore([
        { iid: 1, title: '被阻塞的票', description: '正文' },
        { iid: 2, title: '阻塞者甲', state: 'opened', description: '' },
        { iid: 3, title: '阻塞者乙', state: 'closed', description: '' },
      ])
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.setBlockedBy(GL_REPO, '1', ['2', '3'], null, sc.ctx))
      const refs = r.ok ? r.data.blockedBy : null
      await assert(
        'setBlockedBy：原生可达时逐条 POST is_blocked_by（两次），一次 PUT 都不发',
        r.ok === true && writesOf(sc).length === 2 && writesOf(sc).every((c) => c.indexOf('link_type=is_blocked_by') >= 0),
        JSON.stringify(writesOf(sc)),
      )
      await assert(
        'setBlockedBy：原生写后读回对上才算成功，返回的阻塞带对端的真实标题与真实开关（开着/已关）',
        refs !== null && refs.length === 2 && refs[0].key === '2' && refs[0].title === '阻塞者甲' && refs[0].state === 'open' &&
          refs[1].key === '3' && refs[1].title === '阻塞者乙' && refs[1].state === 'closed',
        JSON.stringify(refs),
      )
      await assert(
        '✗ probe: 少 POST 一条（只加上一条阻塞）却报成功的结论必须被逮住',
        writesOf(sc).length !== 1,
        '检查器数不清 POST 的条数',
      )
    }

    // B. 原生删掉一条：DELETE 拿的是链接自己的编号（issue_link_id），不是两头票的编号。
    {
      const store = makeStore([
        { iid: 1, title: '被阻塞的票', description: '' },
        { iid: 2, title: '阻塞者甲', description: '' },
      ])
      store.get(1).links.push({ issue_link_id: 9001, iid: 2, link_type: 'is_blocked_by' })
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.setBlockedBy(GL_REPO, '1', [], null, sc.ctx))
      await assert(
        'setBlockedBy：删原生边调的是 links/<issue_link_id>（9001），不是票编号',
        r.ok === true && r.data.blockedBy.length === 0 && writesOf(sc).length === 1 && writesOf(sc)[0].indexOf('/links/9001') >= 0,
        JSON.stringify(writesOf(sc)),
      )
      await assert(
        '✗ probe: 拿票编号当链接编号删（/links/2）的实现，在这台桩上删不掉、必须失败',
        writesOf(sc).every((c) => c.indexOf('/links/2 ') < 0 && c.indexOf('/links/2 --') < 0),
        JSON.stringify(writesOf(sc)),
      )
    }

    // C. 没能力（403 点名要 Premium）→ 滚回干净 → 正文行回退：PUT 的正文用真换行，多行正文不断行。
    {
      const store = makeStore([
        { iid: 1, title: '被阻塞的票', description: '第一行\n\n第三行' },
        { iid: 2, title: '阻塞者甲', description: '' },
      ], { links403: true })
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.setBlockedBy(GL_REPO, '1', ['2'], null, sc.ctx))
      const putBody = store.get(1).description
      await assert(
        'setBlockedBy：远端说没能力时滑进正文行回退（一次 POST 都没有，一次 PUT 写行）',
        r.ok === true && writesOf(sc).length === 1 && writesOf(sc)[0].indexOf('--method PUT') >= 0 &&
          writesOf(sc).every((c) => c.indexOf('--method POST') < 0),
        JSON.stringify(writesOf(sc)),
      )
      await assert(
        'setBlockedBy：回退写行用真换行（成对两行 `Blocked by: #2` + 机器表，后面跟原来的多行正文，不出现字面反斜杠 n）',
        putBody === 'Blocked by: #2\n<!-- DSH-BLOCKED-BY: 2 -->\n第一行\n\n第三行' && putBody.indexOf('\\n') < 0,
        JSON.stringify(putBody),
      )
    }

    // D. 原生加上了、读回却对不上（远端撒谎）→ 如实失败，且不许滑进正文行（盘上已经动了，写行会留双份）。
    {
      const store = makeStore([
        { iid: 1, title: '被阻塞的票', description: '' },
        { iid: 2, title: '阻塞者甲', description: '' },
      ], { lyingReadback: true })
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.setBlockedBy(GL_REPO, '1', ['2'], null, sc.ctx))
      await assert(
        'setBlockedBy：写后读回对不上时如实失败（不把写丢了包装成成功）',
        honestFailureCheck(r).length === 0 && /读回|readback|mismatch/i.test(r.error.message),
        JSON.stringify(r).slice(0, 300),
      )
      await assert(
        'setBlockedBy：读回对不上时不许滑进正文行回退（一次 PUT 都没有）',
        writesOf(sc).every((c) => c.indexOf('--method PUT') < 0),
        JSON.stringify(writesOf(sc)),
      )
    }

    // E. 成环拦：2 号票的原生边指着 1 号，再让 1 号阻塞于 2 号 → conflict，一个写请求都不发。
    {
      const store = makeStore([
        { iid: 1, title: '票一', description: '' },
        { iid: 2, title: '票二', description: '' },
      ])
      store.get(2).links.push({ issue_link_id: 9001, iid: 1, link_type: 'is_blocked_by' })
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.setBlockedBy(GL_REPO, '1', ['2'], null, sc.ctx))
      await assert(
        'setBlockedBy：原生边织成的环也拦得住（1 ← 2 再连 2 → 1 成环，回 conflict）',
        r.ok === false && r.error.kind === 'conflict' && /成环|环|cycle/i.test(r.error.message),
        JSON.stringify(r).slice(0, 300),
      )
      await assert(
        'setBlockedBy：拦下成环时一个写请求都不发（读可以读，写一次都不许）',
        writesOf(sc).length === 0,
        JSON.stringify(writesOf(sc)),
      )
    }

    // F. 读：原生边优先，relates_to 不算阻塞；行里没写开关的逐张取对端，取不到的按开着记（保守方向）。
    {
      const store = makeStore([
        { iid: 1, title: '被阻塞的票', description: 'Blocked by: #9' },
        { iid: 2, title: '阻塞者甲', state: 'closed', description: '' },
        { iid: 5, title: '关联票（不是阻塞）', description: '' },
      ])
      store.get(1).links.push({ issue_link_id: 9001, iid: 2, link_type: 'is_blocked_by' })
      store.get(1).links.push({ issue_link_id: 9002, iid: 5, link_type: 'relates_to' })
      store.get(1).links.push({ issue_link_id: 9003, iid: 9, link_type: 'is_blocked_by' })
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.getDependencies(GL_REPO, '1', null, sc.ctx))
      const refs = r.ok ? r.data.blockedBy : null
      await assert(
        'getDependencies：原生边优先（正文行被忽略）；relates_to 不算阻塞；已关的对端如实记 closed',
        refs !== null && refs.length === 2 && refs[0].key === '2' && refs[0].title === '阻塞者甲' && refs[0].state === 'closed' &&
          refs[1].key === '9' && refs[1].title === '#9' && refs[1].state === 'open',
        JSON.stringify(refs),
      )
      await assert(
        '✗ probe: 把 relates_to 也算成阻塞的结论必须被逮住（5 号票是关联，不是阻塞）',
        refs !== null && refs.every((b) => b.key !== '5'),
        JSON.stringify(refs),
      )
    }

    // G. 回退写丢了（PUT 回显里没正文）→ 如实失败，不把写丢包装成成功。
    {
      const store = makeStore([
        { iid: 1, title: '被阻塞的票', description: '正文' },
        { iid: 2, title: '阻塞者甲', description: '' },
      ], { links403: true, dropDescriptionEcho: true })
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.setBlockedBy(GL_REPO, '1', ['2'], null, sc.ctx))
      await assert(
        'setBlockedBy：回退 PUT 回显里没有正文（要写的阻塞丢了）时如实失败',
        honestFailureCheck(r).length === 0 && /missing|readback|回/i.test(r.error.message),
        JSON.stringify(r).slice(0, 300),
      )
    }

    // H. 免费档形状（GET 通读回空、POST 403）：滚回核对认 nativeEmpty 为干净 → 滑进正文成对回退。
    // #1599 真机探针查实：旧实现在这里把 nativeEmpty 当成读回失败，免费档永远滑不进回退。
    {
      const store = makeStore([
        { iid: 1, title: '被阻塞的票', description: '第一行\n\n第三行' },
        { iid: 2, title: '阻塞者甲', description: '' },
      ], { postBlocked403: true })
      const sc = scriptedCtx({ script: store.script })
      const r = await withGitlabTracker((t) => t.setBlockedBy(GL_REPO, '1', ['2'], null, sc.ctx))
      const putBody = store.get(1).description
      await assert(
        'setBlockedBy：免费档 POST 403 后滚回核对通过、滑进正文成对回退（仍发 PUT，不报 auth 失败）',
        r.ok === true && writesOf(sc).some((c) => c.indexOf('link_type=is_blocked_by') >= 0) &&
          writesOf(sc).filter((c) => c.indexOf('--method PUT') >= 0).length === 1,
        JSON.stringify({ ok: r.ok, err: r.ok ? null : r.error, writes: writesOf(sc) }).slice(0, 400),
      )
      await assert(
        'setBlockedBy：免费档回退写的是成对两行，读回认得阻塞者甲',
        putBody === 'Blocked by: #2\n<!-- DSH-BLOCKED-BY: 2 -->\n第一行\n\n第三行' &&
          r.ok === true && r.data.blockedBy.length === 1 && r.data.blockedBy[0].key === '2' &&
          r.data.blockedBy[0].title === '阻塞者甲',
        JSON.stringify({ putBody, refs: r.ok ? r.data.blockedBy : null }).slice(0, 400),
      )
    }
  }

  // ── 七、这一段故意不判的东西（与文件头那段是同一件事，放在收尾便于读）──
  //   全部断言跑的都是脚本化的命令行：真 GitLab 实例上的回包形状、真建仓与真推送的副作用、
  //   真机上各档角色的 `permissions`，这一段一条都判不了 —— 那是远端行为，不是实现行为。

  return out
}

export default { name: 'room-gitlab-extras', run }
