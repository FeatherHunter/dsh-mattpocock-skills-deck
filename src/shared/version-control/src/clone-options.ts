// shared/version-control/src/clone-options.ts —— 域 8 克隆向导的选项口径（#1756 T20，能力 8.16）
//
// 这一片只放「地址与选项怎么算合法、怎么给用户看」：不读盘、不起进程、不 import 别的文件
//   （shared 同层互相 import 会被依赖门禁拦下，而且克隆向导要在界面与宿主两边用同一套判断）。
//
// 为什么单独一片：克隆的选项比别的写动作多（深度、分支、子模块、离线），每一条都既要能拦、
//   又要能解释「为什么拦」；把这些判断摊到宿主里，界面就没法在点「开始克隆」之前先给人看一遍。
//
// 三条硬口径（票面与规格第 8 节）：
//   1) 离线模式只接受本机路径或 .bundle 离线包；远端地址在离线模式下直接拦，不装作能连。
//   2) 地址里的账号口令与令牌一律掩码后再展示，原样只进执行层，不进界面、不进日志。
//   3) 本机路径离线克隆默认走硬链接（省盘、快），所以要提示「源仓库删了会影响这份克隆」，
//      这一点是警告不是拦截：用户明确了就可以继续。

/** 地址的三种来源：远端服务器、本机路径（含 file://）、离线包（.bundle 文件）。 */
export type CloneSourceKind = 'remote' | 'local-path' | 'bundle'

/** 深度上限与 git 的范围一致：正整数，最多十万层。 */
export const CLONE_DEPTH_MAX = 100000

/** 选项的缺省值：不浅克隆、不指定分支、不递归子模块、在线。 */
export const CLONE_OPTION_DEFAULTS: { depth: number | null; branch: string | null; recurseSubmodules: boolean; shallowSubmodules: boolean; offline: boolean } = {
  depth: null,
  branch: null,
  recurseSubmodules: false,
  shallowSubmodules: false,
  offline: false,
}

/** 本机路径的样子：以 / 或 ./ 或 ../ 或盘符开头，或 file:// 协议。
 *  只认这几种，避免把 ssh://host/path 与 git@host:path 误判成本机路径（离线模式会因此放行一个连不上的地址）。 */
export function cloneIsLocalPath(value: any): boolean {
  const s = value === undefined || value === null ? '' : String(value).trim()
  if (s === '') return false
  if (/^file:\/\//i.test(s)) return true
  if (s.indexOf('./') === 0 || s.indexOf('../') === 0) return true
  if (s.charAt(0) === '/' || s.charAt(0) === '\\') return true
  return /^[A-Za-z]:[\\/]/.test(s)
}

/** 地址来源：先认 .bundle 文件，再认本机路径，剩下的都当远端地址。
 *  .bundle 判定放在本机路径前面：bundle 一定是文件，但本机路径的判定更宽，顺序反了 bundle 会被当普通本机仓库。 */
export function cloneSourceKindOf(url: any): CloneSourceKind {
  const s = url === undefined || url === null ? '' : String(url).trim()
  if (/\.bundle$/i.test(s)) return 'bundle'
  return cloneIsLocalPath(s) ? 'local-path' : 'remote'
}

/** 地址里的账号口令与令牌掩码：user:secret@host → user:***@host；查询参数里的 token/access_token/password 也盖住。
 *  只用于展示与日志；执行层拿到的仍是原值。掩码失败（形状看不懂）就整段替换成一句说明，绝不原样漏出去。 */
export function cloneMaskedUrl(url: any): string {
  const s = url === undefined || url === null ? '' : String(url).trim()
  if (s === '') return ''
  let out = s
  try {
    const at = out.lastIndexOf('@')
    const scheme = out.indexOf('://')
    if (at > 0 && scheme > 0) {
      const head = out.slice(0, scheme + 3)
      const userinfo = out.slice(scheme + 3, at)
      const colon = userinfo.indexOf(':')
      const tail = out.slice(at)
      out = head + (colon >= 0 ? userinfo.slice(0, colon) + ':***' : userinfo) + tail
    }
    out = out.replace(/([?&](?:token|access_token|password|passwd|auth)=)[^&#]*/gi, '$1***')
  } catch (e) {
    return '（地址形状无法安全展示，已隐藏）'
  }
  return out
}

/** 深度：空值合法（= 不浅克隆）；给值就必须是 1..CLONE_DEPTH_MAX 的整数。
 *  字符串 "3" 也接受（表单输入天然是字符串），但 "3.5"、0、负数、超上限一律给出人话原因。 */
export function cloneDepthProblem(depth: any): string | null {
  if (depth === undefined || depth === null || String(depth).trim() === '') return null
  const n = Number(depth)
  if (!isFinite(n) || Math.floor(n) !== n) return '深度必须是整数（留空表示完整历史）'
  if (n < 1 || n > CLONE_DEPTH_MAX) return '深度必须在 1 到 ' + CLONE_DEPTH_MAX + ' 之间（留空表示完整历史）'
  return null
}

/** 分支名：与共享层其它地方同一套形状规则（这里不能 import 那些文件）。
 *  空值合法（= 用远端默认分支）；非空必须不是选项、不含空白与 git 禁止的字符、不以 / 结尾、不以 .lock 结尾。 */
export function cloneBranchProblem(branch: any): string | null {
  if (branch === undefined || branch === null || String(branch).trim() === '') return null
  const s = String(branch).trim()
  if (s.length > 255) return '分支名太长（最多 255 个字符）'
  if (s.charAt(0) === '-' || s.charAt(0) === '+') return '分支名不能以短横线或加号开头'
  if (/[\u0000-\u0020\u007f~^:?*\[\\]/.test(s)) return '分支名里不能有空白或 ~ ^ : ? * [ \\ 这些字符'
  if (s.indexOf('..') >= 0) return '分支名里不能有连续两个点'
  if (s.charAt(s.length - 1) === '/' || s.charAt(s.length - 1) === '.') return '分支名不能以 / 或 . 结尾'
  if (s.indexOf('//') >= 0) return '分支名里不能有连续两个斜杠'
  if (/\.lock$/.test(s)) return '分支名不能以 .lock 结尾'
  return null
}

/** 目标目录：空串直接拦（克隆必须落到一个明确目录）；不许 NUL；不许 ..；不许以短横线开头。
 *  绝对路径与相对路径都接受——相对路径由 git 按当前目录解释，这里只判形状不判存在。 */
export function clonePathProblem(dir: any): string | null {
  const s = dir === undefined || dir === null ? '' : String(dir).trim()
  if (s === '') return '目标目录不能为空'
  if (s.length > 4096) return '目标目录太长（最多 4096 个字符）'
  if (s.indexOf('\u0000') >= 0) return '目标目录里不能有 NUL 字符'
  if (s.charAt(0) === '-') return '目标目录不能以短横线开头'
  const parts = s.split(/[\\/]+/)
  for (let i = 0; i < parts.length; i += 1) if (parts[i] === '..') return '目标目录里不能有 .. 段'
  return null
}

/** 从地址推一个缺省目录名：取最后一段、去掉 .git / .bundle 尾巴。
 *  只在界面上当「建议值」用；推不出来就给空串，让人自己填，不瞎猜。 */
export function cloneDefaultDirOf(url: any): string {
  const s = url === undefined || url === null ? '' : String(url).trim()
  if (s === '') return ''
  let tail = s
  const fileLike = /^[A-Za-z]:[\\/]/.test(s) || cloneIsLocalPath(s) || s.indexOf('://') >= 0
  if (!fileLike) {
    const colon = s.lastIndexOf(':')
    if (colon >= 0) tail = s.slice(colon + 1)
  }
  tail = tail.replace(/[\\/]+$/, '')
  const cut = tail.lastIndexOf('/') >= 0 ? tail.lastIndexOf('/') : tail.lastIndexOf('\\')
  if (cut >= 0) tail = tail.slice(cut + 1)
  tail = tail.replace(/\.git$/i, '').replace(/\.bundle$/i, '')
  return tail
}

/** 把表单输入收敛成一份选项：字符串布尔统一成真布尔，深度数字化，空串统一成 null。
 *  预检与执行两边都用这一份，避免「界面送 true、宿主当字符串」这类只有真机才暴露的不一致。 */
export function cloneOptionsOf(input: any): { ok: true; options: any } | { ok: false; reason: string; message: string } {
  const a: any = input || {}
  const depthProblem = cloneDepthProblem(a.depth)
  if (depthProblem) return { ok: false, reason: 'bad-depth', message: depthProblem }
  const branchProblem = cloneBranchProblem(a.branch)
  if (branchProblem) return { ok: false, reason: 'bad-branch', message: branchProblem }
  const n = a.depth === undefined || a.depth === null || String(a.depth).trim() === '' ? null : Number(a.depth)
  return {
    ok: true,
    options: {
      depth: n,
      branch: a.branch === undefined || a.branch === null || String(a.branch).trim() === '' ? null : String(a.branch).trim(),
      recurseSubmodules: a.recurseSubmodules === true,
      shallowSubmodules: a.shallowSubmodules === true && n !== null,
      offline: a.offline === true,
    },
  }
}

/** 地址的硬性问题：空、太长、NUL、以短横线开头（会被 git 当成选项）。
 *  不在这里判「连不上」——那是执行层的事，预检只判能提前判死的那几条。 */
export function cloneUrlProblem(url: any): string | null {
  const s = url === undefined || url === null ? '' : String(url).trim()
  if (s === '') return '要克隆的地址不能为空'
  if (s.length > 4096) return '地址太长（最多 4096 个字符）'
  if (s.indexOf('\u0000') >= 0) return '地址里不能有 NUL 字符'
  if (s.charAt(0) === '-') return '地址不能以短横线开头'
  return null
}

/** 离线模式的硬性限制：远端地址直接拦，本机路径与 .bundle 放行。
 *  放行时返回 null；拦的时候给出「离线模式只接受本机路径或 .bundle 离线包」的人话。 */
export function cloneOfflineProblem(url: any): string | null {
  if (cloneSourceKindOf(url) !== 'remote') return null
  return '离线模式只接受本机路径或 .bundle 离线包；要克隆远端地址请先联网'
}

/** 本机路径离线克隆会走硬链接：给出提示句（警告用，不拦截）。
 *  只有「离线 + 本机仓库」这一种组合会走硬链接；离线包不硬链接（它是打包过的文件），
 *  远端地址也走不到这里（离线模式在 cloneOfflineProblem 就拦了）。 */
export function cloneHardlinkNote(url: any, options: any): string | null {
  const o: any = options || {}
  if (o.offline !== true) return null
  if (cloneSourceKindOf(url) !== 'local-path') return null
  return '离线克隆本机仓库默认走硬链接：这份克隆与源仓库共享对象文件，源仓库被删或大改后这里可能读不出来；要独立副本，取消离线后再克隆'
}

export const CLONE_OPTIONS_SOURCE = 'src/shared/version-control/src/clone-options.ts'