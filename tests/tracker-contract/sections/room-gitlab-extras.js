/**
 * tests/tracker-contract/sections/room-gitlab-extras.js — GitLab 房九条新能力里「全仓没有一条断言验过」的那五条。
 *
 * ── 这一段为什么存在 ──────────────────────────────────────────────────────────
 * 对抗式审查（`research/1063-adversarial-review.md`）发现 10 说：九条新能力里，`getCurrentUser`、
 * `getRepoPermissions`、`listSubIssues`、`initProject`、`getRepoKey` 五条**在整个仓库里没有任何一条断言
 * 真去要过一次数据** —— 有可能是函数在、逻辑对，也有可能明天被人改坏而门禁不响。这一段补的就是这件事。
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
 *   1）`getCurrentUser`：问的是「当前登录人」那条命令（`glab api user`）一次；回的是身份标识
 *      （`login` 取回包的 `username`，不是显示名）与显示名；回包没说 bot 时 `kind` 必须省略；
 *      问不出来时如实失败，**不许编一个人**；仓库坐标认不出来时一个请求都不发。
 *   2）`getRepoPermissions`：按官方档位一手来源（见下）喂 `access_level`，两个布尔都要算对 ——
 *      Guest(10) 两个 false、Planner(15) 能整理票不能推、Reporter(20) 同上、
 *      Security Manager(25) 同上、Developer(30) 能推；两格都有时取高的那一档；
 *      拿不到档位（没有 `permissions`、两格都 null）时如实失败，**不许拿 false 顶上**。
 *   3）`listSubIssues`：读的是**平级链接资源**（`.../issues/7/links`）；只算 `link_type === 'relates_to'`
 *      的行（`blocks` 既不算子票也不算 dropped，连明细都不去读）；逐行回读明细用的是列表行的
 *      `issue_link_id`（不是 `id`）；对面在 `source_issue` 才算子票，在 `target_issue` 的是地图自己的父票
 *      （不画、也不算 dropped）；分不出方向的记 `dropped`；一行都没能算进去时如实失败，
 *      **不许回一张空表**（「读不出来」与「真的没有子票」必须长得不一样）。
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
 * 检查器 → 清单必须非空」，坏样本就是审查报告点名的那些坏法：只取前两段路径、按 `id` 查明细、
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
 *   · 人手工在界面上加的「关联」链接与程序写下的链接在远端长得一样，这一段按房的既有约定判读，
 *     判不了「手工链接该不该算子票」。
 */

import * as nodePath from 'node:path'
import { createRegistry } from '../../../src/tracker/registry/core.ts'
import { ERROR_KIND } from '../../../src/tracker/contract/vocabulary.ts'
import { gitlabBackend } from '../../../src/tracker/rooms/gitlab/index.ts'

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

  // ── 三、listSubIssues：读的是平级链接资源，方向分不出来记 dropped、一行都算不进去就失败 ──
  {
    const MAP_KEY = '7'
    // 五行各代表一种情形（顺序即调用顺序）：
    //   9001 方向是 peer（对面在 source_issue）→ 画出来
    //   9002 方向是 parent（对面在 target_issue）→ 是地图自己的父票，不画、也不算 dropped
    //   9003 link_type 是 blocks（不是 relates_to，且没写 link_type 时按接口默认值 relates_to 办）→ 跳过
    //   55   只有列表行的 id、没有 issue_link_id → 拿不到链接编号，记 dropped
    //   9005 没写 link_type → 按接口默认值 relates_to 办 → 画出来
    const LINKS = [
      { iid: 21, project_id: 100, link_type: 'relates_to', issue_link_id: 9001, title: '子票甲', state: 'opened', description: '' },
      { iid: 30, project_id: 100, link_type: 'relates_to', issue_link_id: 9002, title: '地图自己的父票', state: 'opened', description: '' },
      { iid: 40, project_id: 100, link_type: 'blocks', issue_link_id: 9003, title: '阻塞票（不是子票）', state: 'opened', description: '' },
      { iid: 55, id: 55, project_id: 100, link_type: 'relates_to', title: '缺链接编号的行', state: 'opened', description: '' },
      { iid: 22, project_id: 100, issue_link_id: 9005, title: '没写 link_type 的行', state: 'opened', description: '' },
    ]
    // 明细里 source_issue 是「认地图为父」的那一头（房的写路径永远 POST 到子票那一头）。
    const PEER_DETAIL = (iid) => JSON.stringify({ source_issue: { iid: iid, project_id: 100 }, target_issue: { iid: 7, project_id: 100 } })
    const PARENT_DETAIL = JSON.stringify({ source_issue: { iid: 7, project_id: 100 }, target_issue: { iid: 30, project_id: 100 } })
    const linksPath = 'projects/acme%2Fdemo/issues/7/links'

    const script = (cmd, args) => {
      if (cmd !== 'glab' || args[0] !== 'api') return { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + args.join(' ') }
      const path = String(args[1] || '')
      if (path === linksPath) return { code: 0, stdout: JSON.stringify(LINKS), stderr: '' }
      if (path === linksPath + '/9001') return { code: 0, stdout: PEER_DETAIL(21), stderr: '' }
      if (path === linksPath + '/9002') return { code: 0, stdout: PARENT_DETAIL, stderr: '' }
      if (path === linksPath + '/9005') return { code: 0, stdout: PEER_DETAIL(22), stderr: '' }
      // 下面两条是给「做坏了的实现」准备的：真去读 blocks 行、或真拿列表行的 id 当链接编号，
      // 就会查到这里，并因此多画出一张子票（40 / 55），检查器随即逮住。
      if (path === linksPath + '/9003') return { code: 0, stdout: PEER_DETAIL(40), stderr: '' }
      if (path === linksPath + '/55') return { code: 0, stdout: PEER_DETAIL(55), stderr: '' }
      return { code: 1, stdout: '', stderr: 'probe 没脚本化这条链接明细: ' + path }
    }

    const sc = scriptedCtx({ script })
    const r = await withGitlabTracker((t) => t.listSubIssues(GL_REPO, MAP_KEY, undefined, sc.ctx))
    const expect = { keys: ['21', '22'], dropped: 1 }
    await assert(
      'listSubIssues：只画「对面在 source_issue」的行；地图自己的父票不画、也不算 dropped；缺链接编号的行记 dropped',
      subIssuesCheck(r, expect).length === 0,
      subIssuesCheck(r, expect).join('；') || JSON.stringify(r).slice(0, 500),
    )
    const detailIds = sc.calls.filter((c) => c.indexOf('/links/') >= 0).map((c) => c.slice(c.indexOf('/links/') + 7))
    await assert(
      'listSubIssues：读的是平级链接资源，逐行回读明细用的是列表行的 issue_link_id（不是 id）',
      sc.calls[0] === 'glab api ' + linksPath &&
        JSON.stringify(detailIds) === JSON.stringify(['9001', '9002', '9005']),
      JSON.stringify(sc.calls),
    )
    await assert(
      'listSubIssues：不是 relates_to 的行（blocks）既不画也不算 dropped —— 连明细都不去读',
      sc.calls.filter((c) => c.indexOf('/links/9003') >= 0).length === 0 &&
        sc.calls.filter((c) => c.indexOf('/links/55') >= 0).length === 0,
      JSON.stringify(sc.calls),
    )

    // ✗ 反例：同一个检查器对上四种做坏了的结论，必须都非空。
    const sample = r.ok ? r.data : {}
    const doctored = (patch) => ({ ok: true, data: Object.assign({}, sample, patch) })
    await assert(
      '✗ probe: 把 blocks 行也算成子票的结论必须被逮住',
      subIssuesCheck(doctored({ items: [{ key: '21' }, { key: '22' }, { key: '40' }] }), expect).length > 0,
      '检查器放过了不是 relates_to 的行',
    )
    await assert(
      '✗ probe: 把地图自己的父票也算成子票的结论必须被逮住',
      subIssuesCheck(doctored({ items: [{ key: '21' }, { key: '22' }, { key: '30' }] }), expect).length > 0,
      '检查器放过了方向是 parent 的那一头',
    )
    await assert(
      '✗ probe: 拿列表行的 id 当链接编号（多画一张 55）的结论必须被逮住',
      subIssuesCheck(doctored({ items: [{ key: '21' }, { key: '22' }, { key: '55' }] }), expect).length > 0,
      '检查器放过了按 id 查出来的行',
    )
    await assert(
      '✗ probe: 把方向分不出来的行抹掉（dropped 记 0）的结论必须被逮住',
      subIssuesCheck(doctored({ dropped: 0 }), expect).length > 0,
      '检查器放过了被抹掉的 dropped',
    )

    // 有候选行、却一行都没能算进去 → 如实失败，不许回一张空表。
    const undecidableSc = scriptedCtx({
      script: (cmd, args) => {
        const path = String((args || [])[1] || '')
        if (cmd === 'glab' && path === linksPath) {
          return { code: 0, stdout: JSON.stringify([{ iid: 21, project_id: 100, link_type: 'relates_to', issue_link_id: 9004, title: '分不出方向的行', state: 'opened' }]), stderr: '' }
        }
        if (cmd === 'glab' && path.indexOf('/9004') >= 0) {
          return { code: 0, stdout: JSON.stringify({ note: '明细里没有 source_issue / target_issue' }), stderr: '' }
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

    // 真的没有关联行 → 照常回空表，这不是失败（与上一条正好是一对）。
    const emptySc = scriptedCtx({
      script: (cmd, args) => (cmd === 'glab' && String((args || [])[1] || '') === linksPath
        ? { code: 0, stdout: '[]', stderr: '' }
        : { code: 1, stdout: '', stderr: 'probe 没脚本化: ' + cmd + ' ' + (args || []).join(' ') }),
    })
    const none = await withGitlabTracker((t) => t.listSubIssues(GL_REPO, MAP_KEY, undefined, emptySc.ctx))
    await assert(
      'listSubIssues：真的没有关联行时照常回空表（「没有子票」不是失败）',
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

  // ── 六、这一段故意不判的东西（与文件头那段是同一件事，放在收尾便于读）──
  //   全部断言跑的都是脚本化的命令行：真 GitLab 实例上的回包形状、真建仓与真推送的副作用、
  //   真机上各档角色的 `permissions`，这一段一条都判不了 —— 那是远端行为，不是实现行为。

  return out
}

export default { name: 'room-gitlab-extras', run }
