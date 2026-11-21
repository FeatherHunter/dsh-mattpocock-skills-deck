// src/tracker/rooms/github/support/init-project-error-kinds.ts —— 「创建并发布」出错时把 git / gh 的报错归一成档位的唯一一份（#1686 阶段 1 从房间根迁入 support/；更早的 #993 时期它住在 src/shared/tracker/initProjectErrorKinds.js）。
//
// 为什么要有这个文件（票 #993）：这段判断原先是两份**逐字符相同**的复刻，分别住在
//   src/host/publishFlow.js（面板「创建并发布」走这条）与
//   src/host/tracker/backends/github/init-project.js（契约 op initProject 走这条）。
//   两份的兜底都是「认不出来就归 permission」，于是 git 的属主不符、提交身份缺失、钩子拒绝、
//   磁盘满都被显示成「权限不足，请检查登录账号」。同一份判断放两处，改一处必然漏一处。
//   收成一份之后，两处只负责调它。
//
// 本文件零依赖：住在 src/shared/tracker/ 下，按 tests/verify-dependency-rules.ts 的房间白名单
// （那份名单写在根目录 .dependency-cruiser.cjs），
//   三个后端房间与宿主都能引用它；它自己不许引用任何房间。
//
// 「属主不一致」这一档不在这里判断：那是 git 输出文本的判断，归同目录的 workspaceOwnership.js，
//   由调用方以 isOwnership 注入。这样分工是刻意的 —— 这里答「这是哪一类失败」，那里答
//   「这段文本说的是不是属主不一致」，两票（#993 解释、#994 预防）共用的正是后者。

/** git 命令失败时用到的两个档位（与 GitHub 后端 prompts.errorKinds 的键同名）。 */
export const KIND_GIT_OWNERSHIP = 'git-ownership'
export const KIND_UNKNOWN = 'unknown'

/**
 * 造一个「创建并发布」的错误分类器。
 * 为什么自定这两个小形状：调用方只传是否属主不一致的判断，返回的分类器只收文本与可选档位，契约里没有这一家的专有形状。
 * @param deps 依赖：判断文本是否属主不一致
 */
interface CreateErrorClassifierDeps {
  isOwnership?: (errText: string) => boolean;
}

/** 创建并发布错误分类器的函数形状：收错误文本与可选上游档位，回归一后的档位串。 */
type CreateErrorClassifier = (errText: string, kind?: string | null) => string;

export function makeCreateErrorClassifier(deps: CreateErrorClassifierDeps): CreateErrorClassifier {
  const isOwnership = (deps && deps.isOwnership) || function (): boolean { return false }
  return function classifyCreateError(errText: string, kind?: string | null): string {
    const low = String(errText || '').toLowerCase()
    // 属主不一致必须先判：它的原文里既有路径又有命令，不能让后面的规则先认走。
    if (isOwnership(errText)) return KIND_GIT_OWNERSHIP
    // 「同名仓库已存在」必须留在权限判定之前：GitHub 对这事也回 HTTP 403，
    //   一旦下面那条按状态码判权限，用户就会被引导去核对登录账号，而不是去处理重名。
    if (/already exists|name already exists|already exists on github|repository.*already exists/i.test(low)) return 'already-exists'
    // 限流同样必须先于权限判定：GitHub 的限流（含 secondary rate limit）也回 HTTP 403，
    //   原文里既没有「already exists」也没有网络词，旧版会被按状态码吞成「权限不足」。
    //   这里归到 network 档，界面文案是「网络异常，请重试」——正确的下一步本就是稍后重试，
    //   而不是去改权限或重新登录；不新增档位是为了不牵动面板文案与判档单源门禁。
    if (/rate ?limit|too many requests|abuse detection|请求过频/i.test(low)) return 'network'
    if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect etimedout|unable to access|failed to connect|could not resolve host/i.test(low)) return 'network'
    if (/not logged in|auth failed|bad credentials|authentication required|gh auth login/i.test(low)) return 'not-logged-in'
    // 不再匹配裸 403/401：它们是 HTTP 状态码，重名、限流、组织策略拦截都可能回 403，
    //   光凭状态码就判「权限不足」会把排查方向整体带偏。只认真正的权限措辞；
    //   只剩状态码、认不出来的原文落到底部 unknown，把原文交回给用户自己判断。
    if (/permission|forbidden|insufficient|not authorized|resource not accessible|must be.*admin/i.test(low)) return 'permission'
    if (kind === 'auth') return 'not-logged-in'
    // 兜底：#993 之前这里是 'permission'。认不出来就说认不出来（unknown），并且界面必须把
    //   git 的原始报错给用户看到 —— 把「不知道」翻译成「没权限」会把人的排查方向整体带偏。
    return KIND_UNKNOWN
  }
}
