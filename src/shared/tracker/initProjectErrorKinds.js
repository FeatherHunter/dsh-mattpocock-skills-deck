// src/shared/tracker/initProjectErrorKinds.js —— 「创建并发布」出错时把 git / gh 的报错归一成档位的唯一一份。
//
// 为什么要有这个文件（票 #993）：这段判断原先是两份**逐字符相同**的复刻，分别住在
//   src/host/publishFlow.js（面板「创建并发布」走这条）与
//   src/host/tracker/backends/github/init-project.js（契约 op initProject 走这条）。
//   两份的兜底都是「认不出来就归 permission」，于是 git 的属主不符、提交身份缺失、钩子拒绝、
//   磁盘满都被显示成「权限不足，请检查登录账号」。同一份判断放两处，改一处必然漏一处。
//   收成一份之后，两处只负责调它。
//
// 本文件零依赖：住在 src/shared/tracker/ 下，按 tests/verify-no-cross-import.js 的白名单，
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
 * @param {Object} deps
 * @param {(errText: string) => boolean} deps.isOwnership 这段文本是不是「属主与运行用户不一致」
 * @returns {(errText: string, kind?: string|null) => string} 归一后的档位
 */
export function makeCreateErrorClassifier(deps) {
  const isOwnership = (deps && deps.isOwnership) || function () { return false }
  return function classifyCreateError(errText, kind) {
    const low = String(errText || '').toLowerCase()
    // 属主不一致必须先判：它的原文里既有路径又有命令，不能让后面的规则先认走。
    if (isOwnership(errText)) return KIND_GIT_OWNERSHIP
    if (/already exists|name already exists|already exists on github|repository.*already exists/i.test(low)) return 'already-exists'
    if (kind === 'network' || /network|econn|timed out|timeout|enotfound|getaddrinfo|connect etimedout|unable to access|failed to connect|could not resolve host/i.test(low)) return 'network'
    if (/not logged in|auth failed|bad credentials|authentication required|gh auth login/i.test(low)) return 'not-logged-in'
    if (/permission|forbidden|403|401|insufficient|not authorized|resource not accessible|must be.*admin/i.test(low)) return 'permission'
    if (kind === 'auth') return 'not-logged-in'
    // 兜底：#993 之前这里是 'permission'。认不出来就说认不出来（unknown），并且界面必须把
    //   git 的原始报错给用户看到 —— 把「不知道」翻译成「没权限」会把人的排查方向整体带偏。
    return KIND_UNKNOWN
  }
}
