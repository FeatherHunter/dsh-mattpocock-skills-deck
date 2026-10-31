// src/shared/version-control/src/platform-inspect.ts —— 平台与边界页（#1762 T26，规格域 14）的纯判定
//
// 这里只放「不用起进程、不用读文件就能算出来」的东西，宿主与界面共用同一份口径：
//   - 凭据助手链：git config --null --get-all credential.helper 的 NUL 分隔输出怎么拆，链里有没有
//     store（明文落盘）。有 store 就由界面标红并建议换 credential manager —— 但面板绝不读、不存、
//     不落盘任何令牌（规格第 1 节永久例外二）。
//   - rebase.updateRefs：读到的值算不算开（true / yes / on / 1 算开）。开了平台页要说清面板不做
//     --update-refs、交互变基的预检会拒绝、要挪指针去终端明确执行（规格 5.9 更正）。
//   - git request-pull 的参数：起点、仓库地址、终点逐项检查后拼成 argv，绝不把一段命令行原样交给 git。
//   - 输出目录里的补丁文件怎么认（.patch / .mbox / .diff），以及「其它文件不算」的计数 —— 14.1
//     生成补丁之后要如实说目录里有什么，不能拿 0 冒充。
//
// 零 import：构建时整份拼进客户端闭包（scripts/build.mts 的 SHARED_SPLICE），宿主侧直接 import。
// 不读环境、不碰文件、不取时钟；所有输入都是字符串或字符串数组，所有输出都是普通对象。

export const VC_PLATFORM_INSPECT_SOURCE: string = 'platform-inspect'

/** 凭据助手链最多显示多少条（超出的如实说还有几条没显示）。 */
export const PLATFORM_CREDENTIAL_MAX: number = 20

/** 补丁文件列表最多留多少个（14.1 的输出目录通常只有几十个）。 */
export const PLATFORM_PATCH_MAX: number = 200

/** 参数长度上限：git 引用与路径都远短于它，超过一律按「太长」拒绝。 */
export const PLATFORM_ARG_MAX: number = 1024

/** 凭据助手链里出现这串（不区分大小写）就按明文落盘助手处理。 */
export const PLATFORM_STORE_HELPER: string = 'store'

/** git config 的「开」写法；与 commitForm 的 configTruthy 同一口径（true/yes/on/1）。 */
export const vcConfigTruthyOf = function (value: any): boolean {
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
  return text === 'true' || text === 'yes' || text === 'on' || text === '1'
}

/** 把 git config --null 的输出拆成值列表：按 NUL 拆、去空白、去空串、最多留 max 条。 */
export const vcNulValuesOf = function (text: any, max?: any): string[] {
  const limit = typeof max === 'number' && isFinite(max) && max > 0 ? Math.floor(max) : PLATFORM_CREDENTIAL_MAX
  const raw = String(text === undefined || text === null ? '' : text)
  if (raw === '') return []
  return raw.split('\u0000').map(function (one: string) { return one.trim() }).filter(function (one: string) { return one !== '' }).slice(0, limit)
}

/** credential.helper 的值列表（一个值可能自带参数，例如 "store --file=/tmp/x"）。 */
export const vcCredentialHelpersOf = function (text: any): string[] { return vcNulValuesOf(text, PLATFORM_CREDENTIAL_MAX) }

/** 链里第一条含 store 的助手原文；没有就回空串（界面据此决定标不标红）。 */
export const vcCredentialStoreOf = function (helpers: any): string {
  const list = Array.isArray(helpers) ? helpers : []
  for (let i = 0; i < list.length; i += 1) {
    const one = String(list[i] === undefined || list[i] === null ? '' : list[i])
    if (one.toLowerCase().indexOf(PLATFORM_STORE_HELPER) >= 0) return one
  }
  return ''
}

/**
 * 凭据风险判定：只有一条规则 —— 链里出现 store 就是明文落盘。
 * advice 是稳定标识（不是文案）：'replace-store' 时界面去词表取那句「建议改用 credential manager」。
 */
export const vcCredentialRiskOf = function (helpers: any): any {
  const storeHelper = vcCredentialStoreOf(helpers)
  return { risk: storeHelper !== '', storeHelper: storeHelper, advice: storeHelper !== '' ? 'replace-store' : 'ok' }
}

/** rebase.updateRefs 的读法：空串/未设置回 enabled=false；true/yes/on/1 算开；其它值原样显示但不当作开。 */
export const vcUpdateRefsOf = function (value: any): any {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return { value: text, enabled: text !== '' && vcConfigTruthyOf(text) }
}

const vcArgProblemOf = function (value: any, what: string): string {
  const text = String(value === undefined || value === null ? '' : value)
  if (text.trim() === '') return what + '不能为空'
  if (text.length > PLATFORM_ARG_MAX) return what + '太长（最多 ' + PLATFORM_ARG_MAX + ' 个字符）'
  if (text.indexOf('\u0000') >= 0) return what + '里不能有 NUL 字符'
  if (/\s/.test(text)) return what + '里不能有空白字符'
  if (text.charAt(0) === '-' || text.charAt(0) === '+') return what + '不能以短横线或加号开头'
  return ''
}

/**
 * git request-pull 的 argv 拼装（14.3，只读）。起点、地址必填，终点可空（git 默认 HEAD）。
 * 失败回 {ok:false, reason, message}：reason 是稳定标识（bad-range / bad-url），宿主拿它去
 * write-reasons 取同一句提示，界面不自己编话。
 */
export const vcRequestPullArgsOf = function (input: any): any {
  const args = input && typeof input === 'object' ? input : {}
  const start = String(args.start === undefined || args.start === null ? '' : args.start).trim()
  const url = String(args.url === undefined || args.url === null ? '' : args.url).trim()
  const end = String(args.end === undefined || args.end === null ? '' : args.end).trim()
  const startProblem = vcArgProblemOf(start, '起点')
  if (startProblem) return { ok: false, reason: 'bad-range', message: startProblem }
  const urlProblem = vcArgProblemOf(url, '仓库地址')
  if (urlProblem) return { ok: false, reason: 'bad-url', message: urlProblem }
  const endProblem = end === '' ? '' : vcArgProblemOf(end, '终点')
  if (endProblem) return { ok: false, reason: 'bad-range', message: endProblem }
  return { ok: true, args: ['request-pull', '-p', start, url].concat(end === '' ? [] : [end]) }
}

/**
 * 输出目录里的补丁文件摘要：认 .patch / .mbox / .diff（不区分大小写），其余算 other。
 * entries 既接受字符串数组，也接受 fs.listDir 那种 {name} 对象数组。补丁列表最多留
 * PLATFORM_PATCH_MAX 条；truncated 给界面说「还有没列出来的」。
 */
export const vcPatchSummaryOf = function (entries: any): any {
  const list = Array.isArray(entries) ? entries : []
  const patches: string[] = []
  let others = 0
  for (let i = 0; i < list.length; i += 1) {
    const one = list[i]
    const name = String(one && typeof one === 'object' ? (one.name === undefined || one.name === null ? '' : one.name) : (one === undefined || one === null ? '' : one))
    if (name === '') continue
    if (/\.(patch|mbox|diff)$/i.test(name)) {
      if (patches.length < PLATFORM_PATCH_MAX) patches.push(name)
    } else {
      others += 1
    }
  }
  return { patches: patches, others: others, total: patches.length, truncated: patches.length >= PLATFORM_PATCH_MAX }
}
