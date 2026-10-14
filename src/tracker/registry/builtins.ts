/**
 * src/tracker/registry/builtins.ts —— 内置房间的装配点（唯一）
 *
 * 这份文件回答一个问题：插件内置了哪几个后端房间、每个房间怎么加载、注册表要的是哪一份模块。
 * 在这之前，这份清单实际散在宿主侧：`src/host/platformChannel.js` 里三段 try 块各自 import 一间房。
 * 于是「有几间内置房间」有两个家，宿主也因此直接认识了每一间房的实现细节（#1161）。
 *
 * 三条约定，改这里之前先读：
 *
 *  1. 一律用动态 `import()`。加载时机必须与从前一致 —— 只有真正要用某个房间时才加载它，
 *     插件启动时不许多加载任何一间房。谁把它改成顶层静态 import，谁就改了启动行为。
 *  2. 这里只登记「有哪几个内置房间」和「怎么把房间的模块交给注册表」。能力清单不在这里
 *     （那是契约层 `CAPABILITIES` 那条线）；房间内部共用的判定件也不在这里（那是共享内核 #1159 的事）。
 *  3. 宿主侧不许再直接 import `src/tracker/rooms/**`（规则 `rooms-imported-only-by-assembly` 盯着）。
 *     宿主今天还需要房间里的少数几个件（GitHub 的超时值、单票状态归一、建仓错误分档、本地图谱解析），
 *     一律经 `loadBuiltinRoom()` 从房间的公开面取；房间里对应的那几行 re-export 就是为这件事写的，
 *     等宿主那几条路改走注册表之后，它们连同这里的取件口一起收回。
 */
import type { BackendModule } from '../contract/backend-module.js'

/** 内置房间的编号。房间名是数据：依赖规则的起点判据不写房名，房间清单只有这里一处。 */
export type BuiltinRoomId = 'github' | 'gitlab' | 'markdown'

/** 三间内置房间的公开面（房间 `index.ts` 导出什么，这里就是什么）。宿主取件时用它的字段类型。 */
export type BuiltinRoomNamespace = {
  github: typeof import('../rooms/github/index.js')
  gitlab: typeof import('../rooms/gitlab/index.js')
  markdown: typeof import('../rooms/markdown/index.js')
}

/**
 * 内置房间的名单与注册顺序：github → markdown → gitlab。
 *
 * 顺序有意义：注册表按注册序仲裁平局，而这个顺序必须与判定层那份明文裁剪顺序
 * （src/tracker/detection/backendDecision.ts 的 MULTI_CLAIM_ORDER，同样是 github → markdown → gitlab）
 * 逐位一致 —— 两处不一致时，同一组多命中会得出两种结论。门禁 tests/verify-detection-evidence.ts
 * 的 D 节读的就是这里，改名单就得同时看那两处。
 */
export const BUILTIN_ROOM_IDS: readonly BuiltinRoomId[] = ['github', 'markdown', 'gitlab']

/**
 * 加载一间内置房间的公开面。同一个房间第二次调用命中模块缓存，不会重复求值。
 *
 * 房间编号写成字面量时返回对应的精确类型（宿主拿到的件因此有类型）；写成变量时返回三者的联合。
 */
export function loadBuiltinRoom(id: 'github'): Promise<BuiltinRoomNamespace['github']>
export function loadBuiltinRoom(id: 'gitlab'): Promise<BuiltinRoomNamespace['gitlab']>
export function loadBuiltinRoom(id: 'markdown'): Promise<BuiltinRoomNamespace['markdown']>
export function loadBuiltinRoom(id: BuiltinRoomId): Promise<BuiltinRoomNamespace[BuiltinRoomId]>
export function loadBuiltinRoom(id: BuiltinRoomId): Promise<BuiltinRoomNamespace[BuiltinRoomId]> {
  if (id === 'github') return import('../rooms/github/index.js')
  if (id === 'gitlab') return import('../rooms/gitlab/index.js')
  return import('../rooms/markdown/index.js')
}

/**
 * 挑出注册表要的那一份模块对象。
 *
 * github / gitlab 取模块对象本身；markdown 必须整份取 `markdownModule` —— 它的 `setupPrompt`
 * （setup 提示词的 locale 键名）挂在模块对象上，自己拼一份 create/matches 会把它丢掉，
 * 于是弹窗里选 Markdown 之后注入的 setup 提示词会落进 GitHub 的键组（#230 D10 实测过的故障）。
 */
async function backendModuleOf(id: BuiltinRoomId): Promise<BackendModule> {
  if (id === 'github') {
    const ns = await import('../rooms/github/index.js')
    // githubModule 恒在（房间 index.ts 里写着）；`|| ns.default` 只是照搬搬家前的容错写法。
    return (ns.githubModule || ns.default) as unknown as BackendModule
  }
  if (id === 'gitlab') {
    const ns = await import('../rooms/gitlab/index.js')
    return (ns.gitlabBackend || ns.default) as unknown as BackendModule
  }
  const ns = await import('../rooms/markdown/index.js')
  return (ns.markdownModule || ns.default) as unknown as BackendModule
}

/**
 * 按注册序给出「要注册进注册表的内置后端模块」。
 *
 * 某一间房加载失败就跳过它，其余房间照常注册 —— 与搬家前 `platformChannel.js` 里逐间 try/catch 同义：
 * 一间房坏掉不该让整个注册表建不起来。形状校验仍由注册表自己做（`registry/shape.ts` 的 `validateMod`）。
 */
export async function loadBuiltinBackendModules(): Promise<BackendModule[]> {
  const out: BackendModule[] = []
  for (const id of BUILTIN_ROOM_IDS) {
    try {
      out.push(await backendModuleOf(id))
    } catch {
      // 一间房加载失败不拖累其余两间；失败原因由调用方按需记录（这里不做日志，避免启动期噪音）。
    }
  }
  return out
}

// ── 房间形状的类型出口（#1161）────────────────────────────────────────────────────────
// 契约能力的编译期断言（src/tracker/capability-assertions.ts）要用三个房间的「成员集合」与
// 「工厂返回类型」。它同样不许直接 import 房间（规则 rooms-imported-only-by-assembly），
// 所以形状经装配点转出 —— 全仓允许 import 房间的地方只有本文件一处，别处的取用一律走这里。
export type { GithubBackendMembers, GithubBackendShape, createGithubBackend } from '../rooms/github/backend.js'
export type { GitlabBackendMembers, GitlabBackendShape, createGitlabBackend } from '../rooms/gitlab/index.js'
export type { MarkdownBackendMembers, MarkdownBackendShape, createMarkdownBackend } from '../rooms/markdown/index.js'
