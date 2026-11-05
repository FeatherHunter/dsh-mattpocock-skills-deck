/**
 * rooms/gitlab/model/repo-identity.ts —— 从仓库引用或识别句柄里取仓库标识，全房唯一一处。
 *
 * 为什么收进 model（#1910）：房间里有九份同形不同名的 repoId（issues / comments / labels / maps /
 * repo/permissions / idempotency / graph/write / preflight / counts）、两处 fullPathOf（counts / pages）、
 * 一处 repoRefOf（labels/list.ts 与 labels/colors.ts）。它们回答的是同一件事——「这次要问哪个仓库」——而实现各住一个文件，
 * 回落规则改一次要改近十处，漏一处就会让某条读路径拿显示名当项目路径去问远端。
 *
 * 为什么保留四个导出、不硬并成一个：各处要的口径本来就不一样，合并必然改掉某一处的行为。
 *   1. repoRefId：refId 原样优先，缺了用 name 原样顶上。票、评论、标签、关系、预检、计数的失败消息
 *      都用它；这里不 trim，因为值随后经 encodeURIComponent 拼进 API 路径，trim 会改变发出去的请求。
 *   2. repoRefOf：只认 refId，trim 之后为空或含空白就回空串。标签改色在起进程之前把关，
 *      宁可整条不做也不拿一个不像项目全路径的值去问远端；refId 缺了不拿 name 顶——name 是显示名，
 *      拿它问远端会在仓库改名后指向别的东西。
 *   3. repoFullPath：只认 refId，trim 之后按 GitLab 能认的两种写法判形状（完整路径，或纯数字项目 ID）。
 *      计数与分页在拼 URL 前用它判「入参合格」：形状不对就按入参错误回，不冒充「仓库不存在」。
 *   4. repoHandleId：识别句柄上的 refId 优先，缺了回落到 cwd，再缺回空串。这是入口识别一条既有规则，
 *      今天没有运行时调用者（#1910 核对过：入口里原来的同名函数没有任何调用）；保留它是因为这条
 *      回落规则应有唯一出处，以后哪条识别路径要用不必再抄。不要为了让它「有用」去改 matches / describe：
 *      那两处产出的是仓库身份与识别结论，属于行为，不归本文件管。
 *
 * 不能改的约定：上面四个优先级与空白处理各不相同，都是既有行为；改任何一个，都会改变某条请求的
 * 目标仓库，或把「入参没给全」说成「仓库不存在」。本文件只做纯字符串取值：不 import 契约类型，
 * 不发请求，不记日志。
 */

/** 仓库引用里与标识有关的两个格；name 只给 repoRefId 兜底，别的函数不看它。宽收 unknown 是为了让预检那种半份仓库身份也能用同一个函数。 */
type RepoRefLike = { refId?: unknown; name?: unknown } | null | undefined

/** 识别句柄只看 refId 与 cwd 两格。 */
type RepoHandleLike = { refId?: unknown; cwd?: unknown } | null | undefined

/**
 * 从仓库引用取标识：refId 优先，缺了用 name，都没有回空串。
 *
 * 不 trim 是有意的：值随后原样拼进 API 路径（查询拼装处统一 encodeURIComponent），
 * trim 会把「带前后空白的 refId」换成另一个值，等于悄悄改请求。
 */
export function repoRefId(repo: RepoRefLike): string {
  if (!repo) return ''
  if (typeof repo.refId === 'string' && repo.refId) return repo.refId
  if (typeof repo.name === 'string' && repo.name) return repo.name
  return ''
}

/**
 * 从仓库引用取「修剪过的 refId」：trim 之后为空、或仍含空白，一律回空串。
 *
 * 与 repoRefId 的差别只在「要不要把修剪后的值当目标」：标签改色在起进程之前把关，
 * 形状不像 GitLab 项目全路径就不发请求，所以这里宁缺毋滥；refId 缺了也不拿 name 顶
 * （理由见文件头第 2 条）。
 */
export function repoRefOf(repo: { refId?: unknown } | null | undefined): string {
  const raw = repo && typeof repo.refId === 'string' ? repo.refId.trim() : ''
  if (!raw) return ''
  // 含空白的全路径不可能是 GitLab 的项目路径：这一条判的是「形状不对」，不是「可能对但这次没试成」。
  if (/\s/.test(raw)) return ''
  return raw
}

/**
 * 从仓库引用取 GitLab 的项目全路径（形如 group/sub/project），拿不到或形状不对回 null。
 *
 * 只认 refId、不拿 name 当标识：name 是给界面看的显示名，refId 缺时它就是目录名，
 * 拿显示名当远端路径会打到一个不存在的仓库上。
 *
 * 「形状对不对」按远端真能认的两种写法判（projects/:id 既收完整路径也收数字项目 ID）：
 *  · 完整路径：至少带一段命名空间（含 /），且不以 / 开头结尾、不出现 //、不含空白；
 *  · 纯数字的项目 ID（例如 42）也放行。
 * 单段的名字（例如 myproject）不是 GitLab 能定位的标识，在这里就按不合格回：早点说清
 * 「入参不合格」比让它跑成一次 404 之后说「仓库不在」更接近实情。
 */
export function repoFullPath(repo: { refId?: unknown } | null | undefined): string | null {
  const refId = typeof repo?.refId === 'string' ? repo.refId.trim() : ''
  if (!refId) return null
  if (/\s/.test(refId)) return null
  if (refId.startsWith('/') || refId.endsWith('/') || refId.includes('//')) return null
  if (/^[0-9]+$/.test(refId)) return refId
  return refId.includes('/') ? refId : null
}

/**
 * 从识别句柄取标识：refId 优先，缺了回落到 cwd，再缺回空串。
 *
 * 今天没有运行时调用者（#1910 核对过：入口里原来的同名函数没有任何调用）。保留它，是因为
 * 「识别句柄回落到 cwd」是识别这一层的既有规则，应该有唯一出处；不是叫谁去改 matches / describe
 * 来「用上」它——那两处的输出是行为，不在本票范围内。
 */
export function repoHandleId(handle: RepoHandleLike): string {
  if (!handle) return ''
  if (typeof handle.refId === 'string' && handle.refId) return handle.refId
  if (typeof handle.cwd === 'string' && handle.cwd) return handle.cwd
  return ''
}
