/**
 * src/tracker/session/repo-ref.ts —— 会话的仓库身份补齐（#1581 的直接修法归位，本文件是 #1583 的收口）。
 *
 * 为什么单开一个文件：开会话之后补仓库身份这件事有两条调用方——刷新后台的会话装配口
 * （src/refresh/rooms/host/session-opener.ts）与九个 deck 工具的接线层
 * （src/deck/tools/tracker-session.ts）。两边各写一份的后果已经发生过：刷新那份把远端定位
 * 写死成「只给 GitHub 问」（GitLab 工作区因此拿不到 refId，#1583）；deck 那份只问远端定位口，
 * 连后端自己回答的 describe 都不走。身份只该由后端回答，装配层不替后端拼域名。
 *
 * 补齐顺序（每一步都记进 steps；本文件永不抛，调用方照 steps 决定打不打日志、怎么降级）：
 *  1. 判定出口已经带了 refId 的，原样交回（不花任何额外动作）。
 *  2. 问会话的 describe（同步定位口，不花额度、不碰远端）。会话装配已按「模块优先、实例兜底」
 *     拼好这条口，所以本地 Markdown 在这里就能拿到工作区路径；GitHub / GitLab 只给目录时
 *     拿不到 refId，得到的只是一个只有显示名的壳。
 *  3. 仍缺 refId 时问会话的 getRepoKey（远端定位口，可能起 git / gh / glab，会走管线裁决与记账）。
 *     只有该后端真的提供这条能力时才问——不按后端名写死，谁提供谁回答。
 *  4. 拿到 owner/name 后，把它当 handle.refId 再问一次 describe：url、显示名、backend 格都由
 *     后端自己写。为什么必须再问一次：`RepositoryRef.url` 是后端的口径，GitHub 与 GitLab 的
 *     域名不同，装配层写死哪个都会给另一种后端拼出假身份。
 *
 * 与宿主那份 getRepoKey 无关（#1453）：远端定位那一问必须走会话能力——先过裁决、再按后端口径
 * 记账；宿主那一份只读本地证据，不在这里兜底。
 *
 * 本文件不碰注册表、不碰日志：它只回答「这个会话的仓库身份补齐到哪一步了」，把
 * 「谁在什么场景下调它、失败怎么记」留给两条调用方各自决定（它们各有各的日志与超时口径）。
 */
import type { RepositoryRef } from '../contract/entities.js'
import type { OpContext } from '../contract/contexts.js'
import type { Tracker } from '../contract/operations.js'

/**
 * 补齐身份只需要两条定位口（describe 同步问后端、getRepoKey 远端定位），
 * 所以这里按契约收窄成 Pick，而不是引同层的会话装配文件：
 *  - 同层互引由 same-layer-import-tracker 门禁拦着（src/tracker 干活文件之间不许互相 import）；
 *  - 本文件也只该依赖契约上写明的能力，不该知道会话是怎么装配出来的。
 * TrackerSession 继承 Tracker，两条调用方传进来的会话都可以直接赋值。
 */
type SessionLocatorSource = Pick<Tracker, 'describe' | 'getRepoKey'>

/** 补齐动作里的环节名（诊断用，顺序与文件头四步一致）。 */
export type RepoRefStepName = 'describe' | 'remote-locate' | 'describe-after-remote'

/** 一步的结局：成功与否，失败时带一句人话。 */
export interface RepoRefStep {
  step: RepoRefStepName
  ok: boolean
  /** 这一步失败的原因（异常收成一句）；成功时不带这一格。 */
  error?: string
}

/** 补齐结果：身份（可能仍是不带 refId 的壳）、这次从哪一步拿到、每一步的诊断。 */
export interface RepoRefResolution {
  /** 补齐到的身份；连壳都没有时是 null。下游按 refId 是否为空决定能不能用。 */
  ref: RepositoryRef | null
  /** 这次身份从哪来：判定自带 / describe / 远端定位 / 没补全。 */
  via: 'selection' | 'describe' | 'remote-locate' | 'none'
  /** 每一步的结局（按执行顺序）；只用于诊断，不改变结果。 */
  steps: RepoRefStep[]
}

/** 补齐要的输入。 */
export interface ResolveSessionRepoRefInput {
  /** 已经开好的会话（describe 与 getRepoKey 都从它上面问；只要求这两条定位口）。 */
  session: SessionLocatorSource
  /** 工作区目录（describe 与 getRepoKey 的第一格都是它）。 */
  cwd: string
  /** 这次选中的后端编号（describe 的第二格缺省值，也是最小身份的 backend 格）。 */
  backendId: string
  /** 判定出口带来那份身份（可能只带部分字段，也可能没有）。 */
  fromSelection?: RepositoryRef | null
  /** 会话操作的基础上下文（平台 / 文件 / 起进程 / 计时器…）；cwd 与 caller 由本文件补。 */
  baseCtx?: Record<string, unknown> | null
  /** 远端定位那一笔的调用方标签（刷新是 'refresh'，deck 工具是它自己的调用类型）。 */
  caller: string
}

/** 把任意异常收成一句人话：不抛、也不把异常吞成空串。 */
function errorText(e: unknown): string {
  try {
    const message = (e as { message?: unknown } | null | undefined)?.message
    return (typeof message === 'string' && message) ? message : String(e)
  } catch {
    return '未知错误'
  }
}

/** 读一个身份里的 refId（缺格、非字符串都按空串；下游只认这一个判据）。 */
function refIdOf(ref: RepositoryRef | null | undefined): string {
  try {
    const value = (ref as { refId?: unknown } | null | undefined)?.refId
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/** 把一份后端回的身份收成可交出去的副本（调用方可能继续往上写 effortId，不改后端那份）。 */
function copyRef(ref: RepositoryRef | null | undefined): RepositoryRef | null {
  return ref ? (Object.assign({}, ref) as RepositoryRef) : null
}

/**
 * 补齐会话的仓库身份。永远回值、不抛；失败与缺席都写在 steps / refId 里，由调用方决定怎么说话。
 */
export async function resolveSessionRepoRef(input: ResolveSessionRepoRefInput): Promise<RepoRefResolution> {
  const steps: RepoRefStep[] = []
  const fromSelection = input.fromSelection || null
  // 第一步：判定出口已经带了 refId，直接用（这是最省事、也最可信的一份）。
  if (refIdOf(fromSelection)) {
    return { ref: fromSelection, via: 'selection', steps: steps }
  }
  // 第二步：问后端的 describe 定位口。它可能答不上 refId（GitHub / GitLab 只给目录时），
  // 也可能抛错（后端实现坏了）；两种都收成壳或 null，继续往下走。
  let candidate: RepositoryRef | null = null
  try {
    const described = (input.session.describe as (handle: { cwd: string }, backendId: string) => RepositoryRef | null | undefined)
      .call(input.session, { cwd: input.cwd }, input.backendId)
    candidate = copyRef(described)
    steps.push({ step: 'describe', ok: refIdOf(candidate) !== '' })
  } catch (e) {
    candidate = null
    steps.push({ step: 'describe', ok: false, error: errorText(e) })
  }
  if (refIdOf(candidate)) return { ref: candidate, via: 'describe', steps: steps }
  // 第三步：问会话的远端定位口。只有后端提供了 getRepoKey 才问；它回 { owner, name } 或 null，
  // 管线拒绝时回带 ok:false 的失败形状——两种都按「没定位到」处理。
  // 这一格也用 try 包住：本文件对调用方承诺「永不抛」，连会话对象是坏代理（读属性就炸）时也一样。
  let remote: unknown = undefined
  try {
    remote = (input.session as unknown as Record<string, unknown>).getRepoKey
  } catch {
    remote = undefined
  }
  if (typeof remote === 'function') {
    type RemoteAnswer = { owner?: unknown; name?: unknown; ok?: unknown }
    let located: RemoteAnswer | null = null
    try {
      const opCtx = Object.assign({}, input.baseCtx || {}, { cwd: input.cwd, caller: input.caller }) as unknown as OpContext
      located = (await (remote as (cwd: string, ctx: OpContext) => Promise<RemoteAnswer | null>)
        .call(input.session, input.cwd, opCtx)) as RemoteAnswer | null
    } catch (e) {
      located = null
      steps.push({ step: 'remote-locate', ok: false, error: errorText(e) })
    }
    const owner = (located && located.ok !== false && typeof located.owner === 'string') ? located.owner : ''
    const name = (located && located.ok !== false && typeof located.name === 'string') ? located.name : ''
    if (!steps.some(function (s) { return s.step === 'remote-locate' })) {
      steps.push({ step: 'remote-locate', ok: !!(owner && name) })
    }
    if (owner && name) {
      const refId = owner + '/' + name
      // 第四步：把 owner/name 当 handle.refId 再问一次 describe，让后端自己写 url 与显示名。
      let complete: RepositoryRef | null = null
      try {
        const described = (input.session.describe as (handle: { cwd: string; refId: string }, backendId: string) => RepositoryRef | null | undefined)
          .call(input.session, { cwd: input.cwd, refId: refId }, input.backendId)
        complete = copyRef(described)
        steps.push({ step: 'describe-after-remote', ok: refIdOf(complete) !== '' })
      } catch (e) {
        complete = null
        steps.push({ step: 'describe-after-remote', ok: false, error: errorText(e) })
      }
      if (refIdOf(complete)) return { ref: complete, via: 'remote-locate', steps: steps }
      // 后端答不上完整身份时退最小身份：refId 已是最稳的 owner/name，url 留空，
      // 不拿别的后端域名冒充（拼错域名比空串更坏：写操作会朝错的地址发请求）。
      return {
        ref: { backend: (candidate && candidate.backend) || input.backendId, refId: refId, name: refId, url: '' } as RepositoryRef,
        via: 'remote-locate',
        steps: steps,
      }
    }
  }
  // 没补全：把 describe 拿到的壳交回去（可能带显示名），refId 仍为空；调用方照旧诚实失败。
  return { ref: candidate, via: 'none', steps: steps }
}

// ===== 给「手上没有会话、只有工作区目录」的取数电话用（#1584） =====

/**
 * 注册表视图的 describe 形状（`registry.describe(handle, backendId)`，模块优先那一份）。
 * 宿主与刷新两侧手上都有它；这里只声明用到的两格，不引注册表实现。
 * 返回值收成 unknown：调用方手上的那份类型各写各的（有的只声明四个可选字段），
 * 这里只按 refId 是不是非空字符串来判断「答出来了没有」。
 */
export type RegistryDescribe = (handle: { cwd: string; refId?: string }, backendId: string) => unknown

/** 宿主注入的只读会话口（与 session-opener 的 openSession 同一个签名的一小部分）。 */
export type OpenReadSession = (cwd: string, options?: { write?: boolean }) => Promise<unknown>

/** 「给一个目录、问它是哪个仓库」的输入。 */
export interface ResolveRepoRefForCwdInput {
  /** 工作区目录。 */
  cwd: string
  /** 这次选中的后端编号（会话回包的 backend 格要与它一致才算数）。 */
  backendId: string
  /** 注册表视图的 describe；给得出非空 refId 就直接用（便宜、不花额度）。 */
  describe?: RegistryDescribe | null
  /** 宿主注入的只读会话口；它开出的会话语义与 #1583 收口后的补齐链一致，是身份的真源。 */
  openSession?: OpenReadSession | null
}

/** 把任意来源的身份收成「带非空 refId 的那一份」；只有显示名、没有 refId 的空壳一律当没答上来。 */
function refWithId(value: unknown): RepositoryRef | null {
  try {
    const refId = (value as { refId?: unknown } | null | undefined)?.refId
    return (typeof refId === 'string' && refId) ? copyRef(value as RepositoryRef) : null
  } catch {
    return null
  }
}

/** 会话回包这份形状里本文件只认三格（可用性、后端编号、身份）。 */
type OpenedSession = { ok?: unknown; backendId?: unknown; repoRef?: RepositoryRef | null }

/**
 * 从一次会话回包里取身份：只认「会话开成了、后端就是这个后端、refId 非空」的那一份。
 * 其余情况（没会话、开失败、开成别的后端、只有显示名没有 refId）都按「这次拿不到」处理——
 * 空 refId 不是身份，不能被调用方当成「已经答出来了」（#1584 的教训）。
 */
function repoRefOfOpenedSession(opened: unknown, backendId: string): RepositoryRef | null {
  try {
    const o = opened as OpenedSession | null | undefined
    if (!o || o.ok !== true) return null
    if (typeof o.backendId === 'string' && o.backendId !== '' && o.backendId !== backendId) return null
    return refWithId(o.repoRef || null)
  } catch {
    return null
  }
}

/**
 * 给四条「自己造仓库身份」的取数电话用：先问注册表 describe，给不出 refId 再向会话要。
 *
 * 为什么要有这一步：GitHub 的 describe 只认已带 owner/name 的 handle，GitLab 的 describe 也只认
 * handle.refId；只拿工作区目录去问，它们会回一个 refId 为空的壳。调用方如果只判「回包里有没有对象」，
 * 空壳就会被当成身份送进后端操作，最终在房间内部以「refId missing」失败（#1584 的 F1–F4）。
 *
 * 返回值约定：拿到非空 refId 才回对象；否则回 null，调用方保持自己原来的兜底/报错（不在这一层编造
 * 「refId=cwd」这种糊弄下游的身份）。本函数永不抛，开会话失败等同于「这次拿不到」。
 */
export async function resolveRepoRefForCwd(input: ResolveRepoRefForCwdInput): Promise<RepositoryRef | null> {
  // 第一步：注册表 describe。宿主与刷新手里直接就有它，且它已是「模块优先」口径；
  // GitHub / Markdown 在这里通常就能给出完整身份，不花额度、不碰远端。
  if (typeof input.describe === 'function') {
    try {
      const described = (input.describe as RegistryDescribe)({ cwd: input.cwd }, input.backendId)
      const parsed = refWithId(described)
      if (parsed) return parsed
    } catch {
      // describe 是本地读；抛错等同于「答不上」，交给下一步的会话再问一次。
    }
  }
  // 第二步：向会话要。会话装配已按 #1581 补齐两条定位口、按 #1583 补齐远端坐标，
  // 这是仓库身份的真源；这里只借用它的答案，不重复实现一遍补齐链。
  if (typeof input.openSession === 'function') {
    try {
      const opened = await (input.openSession as OpenReadSession)(input.cwd, { write: false })
      const ref = repoRefOfOpenedSession(opened, input.backendId)
      if (ref) return ref
    } catch {
      // 开会话失败按「这次拿不到身份」处理；调用方照旧走自己的兜底或诚实报错。
    }
  }
  return null
}
