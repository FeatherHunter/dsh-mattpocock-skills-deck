/**
 * src/tracker/fix-contract.ts — 修复契约纯函数：把后端声明的「修复知识」附到检查项上。
 *
 * ── 为什么这份文件住在这里 ──────────────────────────────────────────────────
 * 它原来住在契约目录（`src/tracker/contract/fixContract.ts`）。契约目录只许放类型与
 * 契约自己的数据（门禁 `tests/verify-contract-types.ts` 守着这条），而这份文件整份都是
 * **行为**，所以按地图02开发票（#1026）的裁决搬到这里：不在契约目录、两个后端都能引用。
 * 调用方（`src/refresh/rooms/host/check-chain-evaluation.ts`）的引用已同步改到这里。
 *
 * ── 搬家纪律 ────────────────────────────────────────────────────────────────
 * 函数体与搬家前逐字一致（点号取值、`catch (e)` 都没动：三扇门禁按字面断言这里的写法，
 * `a.type === 'form'` 这一行就是其中一扇的断言）。只加了四样东西，全是类型标注层面：
 * 三个函数签名的参数与返回类型、文件头这组接口、`normField` 参数的一个 `any`、
 * `subs` 的一行类型。行为一个字没改。
 *
 * 第一性原理（承接 #217 动作词汇表 + UI 零派生 2026-08-28）：
 *  - UI 不知道「这个检查失败怎么修」——它不识别后端、不分支后端名、不推导修复步骤；
 *  - 「为什么失败、怎么修、修完怎么验」是后端知识，必须由后端声明（后端模块的 fixes），与后端 prompts 同源；
 *  - host 在组装检查链时把 fixes 按链语言解析成最终形状：
 *      item.onFail.show.hint  = 人读修复指引文案（一句话/几步）
 *      item.onFail.actions    = 修复动作数组（词汇表类型，UI 只分发）
 *  - UI 层只渲染 hint 文本 + 动作按钮，动作执行后走既有刷新重求值闭环——动作不承诺修复，检查才判定状态。
 *
 * fixes 形状（后端声明，双语与 prompts 同风格）：
 *   fixes: {
 *     [checkId]: {
 *       hint: { zh, en } | string,     // 修复指引（人类可读，一行或几步）
 *       actions: [{ type: 'inject-prompt', prompt: '后端prompts键' | 文案, label: { zh, en }, ... }, ...]
 *     }
 *   }
 *
 * 解析规则：
 *  - hint 为 {zh,en} 对象 → 按 lang 取；string → 原样
 *  - action.prompt 命中 module.prompts 键（值为 {zh,en}）→ 解析成最终文案（分发器直接注入全文，不依赖界面词表）
 *  - action.prompt 未命中 → 保留原值（视为界面词表键或已是文案）
 *  - action.label 为 {zh,en} → 解析成按钮短标签；string → 原样
 *
 * 纯函数：输入检查项数组 + 后端模块 + 语言，输出新数组（不改入参），可单测直喂。
 * 本文件零引用（不 import 任何模块）：形状只按结构读，运行时取值前一律先判类型，
 * 所以后端声明缺字段、多字段、写错类型都只会“保持原样”，不会抛异常。
 */

/** 双语一句话能来的样子：现成文案、`{zh,en}`、缺席或空（缺席按“没有”处理，不抛异常）。 */
export type LangValue = string | { readonly [k: string]: unknown } | null | undefined

/** 一个检查项的修复知识（后端声明的那一份；运行时可能缺字段，函数体里取值前都有类型守卫）。 */
export interface FixDecl {
  readonly hint?: LangValue
  readonly actions?: unknown
}

/**
 * 后端模块（本函数只读 `fixes` 与 `prompts` 两格；其余一律不看）。
 * 与契约 `BackendModule` 的对应字段兼容（赋值方向：真后端模块能直接传进来，不用转一道）。
 */
export interface FixSourceModule {
  readonly fixes?: { readonly [checkId: string]: FixDecl }
  readonly prompts?: { readonly [k: string]: LangValue }
  readonly [extra: string]: unknown
}

/** 附加选项：cwd 供表单动作注入，owner 供预览模板替换占位。 */
export interface AttachFixOptions {
  /** 工作区目录（表单提交参数缺 cwd 时注入；字段名为 name 时顺手给占位符）。 */
  readonly cwd?: unknown
  /** 当前登录用户名（host 预解析；替换预览模板里的 {owner}，未知时保留占位不冒充）。 */
  readonly owner?: unknown
  readonly [extra: string]: unknown
}

export const FIX_CONTRACT_VERSION = 1

function pickLang(value: LangValue, lang: string): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const l = lang === 'en' ? 'en' : 'zh'
    if (typeof value[l] === 'string') return value[l]
    if (l === 'en' && typeof value.zh === 'string') return value.zh
  }
  return undefined
}

/** 解析动作 prompt：命中后端 prompts 键（{zh,en}）→ 取最终文案；否则保留原名（client promptText 兜底）。 */
function resolvePrompt(promptValue: unknown, mod: FixSourceModule | null | undefined, lang: string): string {
  const pk = String(promptValue || '')
  if (!pk) return pk
  try {
    if (mod && mod.prompts && typeof mod.prompts[pk] === 'object' && mod.prompts[pk] !== null) {
      const resolved = pickLang(mod.prompts[pk], lang)
      if (typeof resolved === 'string' && resolved) return resolved
    }
  } catch (e) {}
  return pk
}

/**
 * 把修复契约附到检查项序列（后端目录项；未声明 fixes 的项保持原样）。
 * @param items 检查项数组（不是数组就原样返回；元素形状不设防，坏元素原样透传）
 * @param mod 后端模块（fixes/prompts 单源；缺席或形状不对就原样返回）
 * @param lang 语言（只认 'en'，其余一律按中文取）
 * @param opts cwd 供 form 动作注入：submitAction.params.cwd + 仓库名字段 placeholder；
 *   owner = 当前 GitHub 登录用户名（host 预解析），用于替换 preview 模板 {owner}——避免 UI 层显示占位字面量
 */
export function attachFixContract(items: unknown, mod: FixSourceModule | null | undefined, lang: string, opts: AttachFixOptions = {}): unknown {
  if (!Array.isArray(items)) return items
  if (!mod || !mod.fixes || typeof mod.fixes !== 'object' || Array.isArray(mod.fixes)) return items
  // 属性收窄进不了闭包（`items.map` 的回调里 `mod.fixes` 会丢掉“已判空”）：
  // 先收进一个常量，回调里读它。行为与原来一样（同一份引用）。
  const fixes = mod.fixes
  const cwd = (opts && typeof opts.cwd === 'string' && opts.cwd) ? String(opts.cwd) : ''
  const owner = (opts && typeof opts.owner === 'string' && opts.owner) ? String(opts.owner).trim() : ''
  return items.map(function (it) {
    if (!it || !it.id) return it
    const fix = fixes[it.id]
    if (!fix || typeof fix !== 'object' || Array.isArray(fix)) return it
    const hint = pickLang(fix.hint, lang)
    const fixActions = Array.isArray(fix.actions) ? fix.actions.map(function (a) {
      if (!a || typeof a !== 'object' || typeof a.type !== 'string') return a
      const out = Object.assign({}, a)
      if (a.type === 'inject-prompt' && typeof a.prompt === 'string') {
        out.prompt = resolvePrompt(a.prompt, mod, lang)
      }
      if (a.label) {
        const lb = pickLang(a.label, lang)
        if (typeof lb === 'string') out.label = lb
      }
      // form/wizard 动作：字段 label/placeholder/optionSubs/preview 双语解析 + cwd 注入（submitAction.params.cwd、name 字段 placeholder）
      const normField = function (f: any) {
        if (!f || typeof f !== 'object') return f
        const nf = Object.assign({}, f)
        if (f.label) { const fl = pickLang(f.label, lang); if (typeof fl === 'string') nf.label = fl }
        if (f.placeholder) { const fp = pickLang(f.placeholder, lang); if (typeof fp === 'string') nf.placeholder = fp }
        if (f.optionSubs && typeof f.optionSubs === 'object' && !Array.isArray(f.optionSubs)) {
          const subs: { [k: string]: string } = {}
          for (const k in f.optionSubs) { const sv = pickLang(f.optionSubs[k], lang); if (typeof sv === 'string') subs[k] = sv }
          nf.optionSubs = subs
        }
        if (f.preview && typeof f.preview === 'object' && !Array.isArray(f.preview)) {
          const pv = pickLang(f.preview, lang)
          if (typeof pv === 'string') nf.preview = pv
        }
        // owner 真值化（2026-08-28 用户反馈「owner/... 占位」）：host 已解析登录用户名则替换 {owner}；
        //   未提供（未登录/网络失败）保留 {owner} 占位，UI 层兜底显示（诚实：未知不冒充）
        if (typeof nf.preview === 'string' && owner && nf.preview.indexOf('{owner}') >= 0) {
          nf.preview = nf.preview.split('{owner}').join(owner)
        }
        if (cwd && f.name === 'name') {
          const bs = String(cwd).split(/[\\/]/).filter(Boolean).pop()
          if (bs && !nf.placeholder) nf.placeholder = bs
          // defaultFrom（2026-08-28 用户反馈）：预填默认仓库名 = 工作区尾段（清洗为合法名），
          //   提交后预览立即显示真实名字（不再出现 '...'）；清洗不通过则回落 placeholder（不预填）
          if (f.defaultFrom === 'cwd-basename' && nf.defaultValue == null) {
            const clean = String(bs || '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
            if (/^[A-Za-z0-9._-]{1,100}$/.test(clean)) nf.defaultValue = clean
          }
        }
        return nf
      }
      // form/wizard 动作：schema 字段双语解析 + submitAction cwd 注入
      if ((a.type === 'form' && Array.isArray(a.schema)) || (a.type === 'wizard' && Array.isArray(a.steps) && a.steps.length)) {
        if (a.type === 'form') {
          out.schema = a.schema.map(normField)
        } else {
          out.steps = a.steps.map(function (step: any) {
            const ns = Object.assign({}, step)
            if (step.schema && Array.isArray(step.schema)) ns.schema = step.schema.map(normField)
            if (step.title) { const st = pickLang(step.title, lang); if (typeof st === 'string') ns.title = st }
            return ns
          })
        }
        if (a.submitAction && typeof a.submitAction === 'object' && cwd) {
          const sa = Object.assign({}, a.submitAction)
          const base = sa.params || {}
          if (base.cwd == null) sa.params = Object.assign({}, base, { cwd: cwd })
          out.submitAction = sa
        }
      }
      return out
    }) : []
    const baseActions = (it.onFail && Array.isArray(it.onFail.actions)) ? it.onFail.actions : []
    const hasRefresh = fixActions.some(function (a) { return a && a.type === 'refresh' }) || baseActions.some(function (a: any) { return a && a.type === 'refresh' })
    // fixes 声明全权：含 refresh 则弃默认动作（防双「重查」按钮）；否则保留（默认 refresh 兜底）
    const extra = hasRefresh ? [] : baseActions
    const show = Object.assign({}, (it.onFail && it.onFail.show) || {}, typeof hint === 'string' && hint ? { hint: hint } : {})
    return Object.assign({}, it, {
      onFail: Object.assign({}, it.onFail || {}, { show: show, actions: fixActions.concat(extra) }),
    })
  })
}
