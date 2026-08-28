/**
 * tracker/fixContract.js — 修复契约（Fix Contract）纯函数：把后端声明的「修复知识」附到检查项上。
 *
 * 第一性原理（承接 #217 动作词汇表 + UI 零派生 2026-08-28）：
 *  - UI 不知道「这个检查失败怎么修」——它不识别后端、不分支 backendId、不推导修复步骤；
 *  - 「为什么失败、怎么修、修完怎么验」是后端知识，必须由后端声明（BackendModule.fixes），与后端 prompts 同源；
 *  - host 在 wf.chain 组装时把 fixes 按链语言解析成最终形状：
 *      item.onFail.show.hint  = 人读修复指引文案（一句话/几步）
 *      item.onFail.actions    = 修复动作数组（词汇表类型，UI 只分发）
 *  - UI 层只渲染 hint 文本 + 动作按钮，动作执行后走既有 refresh 重求值闭环——动作不承诺修复，检查才判定状态。
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
 *  - action.prompt 命中 module.prompts 键（值为 {zh,en}）→ 解析成最终文案（dispatcher 直接注入全文，不依赖 client PROMPTS 表）
 *  - action.prompt 未命中 → 保留原值（视为 client PROMPTS 键或已是文案）
 *  - action.label 为 {zh,en} → 解析成按钮短标签；string → 原样
 *
 * 纯函数：输入 CheckItem[] + BackendModule + lang，输出新 CheckItem[]（不变异入参），可单测直喂。
 */

function pickLang(value, lang) {
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
function resolvePrompt(promptValue, mod, lang) {
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
 * @param {import('../../shared/tracker/chain.js').CheckItem[]} items
 * @param {{id?: string, fixes?: Object, prompts?: Object}} mod 后端模块（fixes/prompts 单源）
 * @param {'zh'|'en'} lang
 * @param {{cwd?: string}} [opts] cwd 供 form 动作注入：submitAction.params.cwd + 仓库名字段 placeholder
 * @returns {import('../../shared/tracker/chain.js').CheckItem[]}
 */
export function attachFixContract(items, mod, lang, opts = {}) {
  if (!Array.isArray(items)) return items
  if (!mod || !mod.fixes || typeof mod.fixes !== 'object' || Array.isArray(mod.fixes)) return items
  const cwd = (opts && typeof opts.cwd === 'string' && opts.cwd) ? String(opts.cwd) : ''
  return items.map(function (it) {
    if (!it || !it.id) return it
    const fix = mod.fixes[it.id]
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
      // form 动作：字段 label/placeholder 双语解析 + cwd 注入（submitAction.params.cwd、name 字段 placeholder）
      if (a.type === 'form' && Array.isArray(a.schema)) {
        out.schema = a.schema.map(function (f) {
          if (!f || typeof f !== 'object') return f
          const nf = Object.assign({}, f)
          if (f.label) { const fl = pickLang(f.label, lang); if (typeof fl === 'string') nf.label = fl }
          if (f.placeholder) { const fp = pickLang(f.placeholder, lang); if (typeof fp === 'string') nf.placeholder = fp }
          if (cwd && f.name === 'name' && !nf.placeholder) {
            const bs = String(cwd).split(/[\\/]/).filter(Boolean).pop()
            if (bs) nf.placeholder = bs
          }
          return nf
        })
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
    const hasRefresh = fixActions.some(function (a) { return a && a.type === 'refresh' }) || baseActions.some(function (a) { return a && a.type === 'refresh' })
    // fixes 声明全权：含 refresh 则弃默认动作（防双「重查」按钮）；否则保留（默认 refresh 兜底）
    const extra = hasRefresh ? [] : baseActions
    const show = Object.assign({}, (it.onFail && it.onFail.show) || {}, typeof hint === 'string' && hint ? { hint: hint } : {})
    return Object.assign({}, it, {
      onFail: Object.assign({}, it.onFail || {}, { show: show, actions: fixActions.concat(extra) }),
    })
  })
}

export const FIX_CONTRACT_VERSION = 1
