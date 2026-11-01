/**
 * 第三方工具 filter-repo 的参数语法（#1750 T15）：面板五张表单需要的选项，开关与带值选项分开认。
 *
 * 为什么单独成一个文件：长任务协议层 task-protocol.ts 已经贴着单文件有效行上限，而这份语法只服务一个动作；
 * 拆出来的同时保持它零依赖，方便以后单独审。
 *
 * 为什么不能「凡是短横线开头就放行」：这等于把任务通道做成通用执行器；第三方工具能收的选项里有改远端、
 * 改仓库配置一类破坏性开关，面板只放自己算得清的参数。带值选项的值在这里再校验一遍——任务通道是独立入口，
 * 不能假设调用方（宿主写层）一定校验过。
 */
/**
 * filter-repo 的参数语法：只接受面板五张表单需要的选项，开关与带值选项分开认。
 * 为什么不能「凡是短横线开头就放行」：这等于把通道做成通用执行器，第三方工具能收的选项里
 * 有改远端、改配置一类破坏性开关，面板必须只放自己算得清的参数。带值选项的值在这里再校验一遍，
 * 因为任务通道是独立入口，不能假设调用方（宿主写层）一定校验过。
 */
export function filterRepoArgs(input: any): any {
  if (!Array.isArray(input)) return { ok: false, reason: 'bad-args', message: '外部工具参数必须是数组' }
  const switches: string[] = ['--invert-paths', '--replace-refs']
  const relativeValued: string[] = ['--path']
  const renameValued: string[] = ['--path-rename']
  const thresholdValued: string[] = ['--strip-blobs-bigger-than']
  const fileValued: string[] = ['--mailmap', '--replace-text']
  const out: string[] = []
  for (let i = 0; i < input.length; i += 1) {
    const item: any = input[i]
    if (typeof item !== 'string' || item.length === 0 || item.charAt(0) !== '-') return { ok: false, reason: 'bad-args', message: '外部工具参数只接受登记过的选项', hint: '选项必须以短横线开头且在白名单里' }
    if (switches.indexOf(item) >= 0) { out.push(item); continue }
    const valued: boolean = relativeValued.indexOf(item) >= 0 || renameValued.indexOf(item) >= 0 || thresholdValued.indexOf(item) >= 0 || fileValued.indexOf(item) >= 0
    if (!valued) return { ok: false, reason: 'bad-args', message: '外部工具参数只接受登记过的选项', hint: '这个选项不在白名单里' }
    const value: any = input[i + 1]
    if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'bad-args', message: '带值的选项后面必须跟一个非空值', hint: '检查 ' + item + ' 后面有没有漏写值' }
    if (relativeValued.indexOf(item) >= 0) {
      const problem: any = relativeRepoPathProblem(value)
      if (problem) return { ok: false, reason: 'bad-path', message: problem, hint: '路径写成仓库里的相对路径（正斜杠），不能含 ..、反斜杠或盘符' }
    } else if (renameValued.indexOf(item) >= 0) {
      const cut: number = value.indexOf(':')
      if (cut <= 0 || cut >= value.length - 1) return { ok: false, reason: 'bad-path', message: '重命名要写成 旧路径:新路径', hint: '中间用英文冒号分隔，两边都是仓库里的相对路径' }
      const fromProblem: any = relativeRepoPathProblem(value.slice(0, cut))
      const toProblem: any = relativeRepoPathProblem(value.slice(cut + 1))
      if (fromProblem || toProblem) return { ok: false, reason: 'bad-path', message: '重命名的来源或目标不是合法的仓库内相对路径', hint: '两边都写成相对路径，不能含 ..、反斜杠或盘符' }
    } else if (thresholdValued.indexOf(item) >= 0) {
      if (!/^[1-9][0-9]{0,6}[kKmMgG]?$/.test(value)) return { ok: false, reason: 'bad-args', message: '大小阈值要写成 10M、500k、1G 这样的正整数加单位', hint: '不写单位按字节算' }
    } else {
      const fileProblem: any = materialFileProblem(value)
      if (fileProblem) return { ok: false, reason: 'bad-path', message: fileProblem, hint: '这两个选项只接受绝对路径的普通文件（面板自己生成的临时说明文件）' }
    }
    out.push(item)
    out.push(value)
    i += 1
  }
  return { ok: true, args: out }
}

/** 仓库内相对路径的守卫：只放普通相对路径，挡掉绝对路径、反斜杠、.. 段与控制字符。 */
function relativeRepoPathProblem(path: any): string | null {
  if (typeof path !== 'string' || path.length === 0) return '路径是空的'
  if (path.length > 1024) return '路径太长'
  if (/^[A-Za-z]:/.test(path) || path.charAt(0) === '/' || path.charAt(0) === '\\') return '路径必须是相对路径，不能是绝对路径'
  if (path.indexOf('\\') >= 0) return '路径要用正斜杠'
  if (/[\u0000-\u001f]/.test(path)) return '路径里有控制字符'
  const parts: string[] = path.split('/')
  for (const part of parts) { if (part === '..' || part === '.') return '路径里不能有 . 或 .. 段' }
  return null
}

/** 临时说明文件的守卫：只接受绝对路径（面板写在系统临时目录里），挡掉 .. 段与控制字符。 */
function materialFileProblem(path: any): string | null {
  if (typeof path !== 'string' || path.length === 0) return '文件路径是空的'
  if (path.length > 4096) return '文件路径太长'
  if (/[\u0000\u001f]/.test(path)) return '文件路径里有控制字符'
  const absolute: boolean = /^[A-Za-z]:[\\/]/.test(path) || path.charAt(0) === '/'
  if (!absolute) return '文件路径必须是绝对路径'
  if (path.indexOf('..') >= 0) return '文件路径里不能有 .. 段'
  return null
}
