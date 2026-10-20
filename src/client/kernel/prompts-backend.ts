/**
 * src/client/kernel/prompts-backend.ts — 「按当前后端渲染一条 prompt」那一族导出（#1292 由 prompts.ts 拆出）。
 *
 * 为什么拆：拆前 prompts.ts 在 #595 加了「后端声明的 bodyFormat / subIssue / healthCheck 走 prompts.*」之后
 *   长到了 350 行上限附近；本次 #1292 把登记表的真源搬到 config/prompts/ 下的 YAML 之后又涨了一截，本票先顶着。
 *   后端声明那条边的导出（currentBackendId / backendPromptFrom / declaredLangPick / backendParamsFor
 *   / promptTextFor / newWayfinderPrompt / MAP_EXECUTE_PROMPT / COMPLETE_PROMPT / FIXATE_PROMPT /
 *   newSpecPrompt / inspectPrompt / completePrompt）单独成片，给 350 行棘轮留呼吸空间。
 *
 * 本文件与 prompts.ts 是同一闭包，互相调用不走 import：
 *   读端：promptText / promptTextFor 经 PROMPTS 走（PROMPTS 现在由 prompt-data.ts 生成）。
 *   设置端（setupRun 一系）是 prompts.ts 的另一条线，留在那里不动 —— 它与「按后端渲染」完全是两条线。
 *   语言清单（config/languages.yaml）的解读者也在 prompts.ts（promptLanguages / promptLang）：
 *   它属于「取一条提示词时先定语言」这一步，跟后端声明无关，所以没跟着这一族搬过来。
 *
 * 闭包内调用面（写代码时谁会动到这一族）：main ran each selected backend's `prompts.subIssue / bodyFormat /
 * commandVocabulary / healthCheck` declarations · #595 之前散在视图层用 promptText 取值，#595 把那四把
 * 抽到这里。
 */
/** 后端声明的一段中英文本（后端模块的 prompts.* 键的值）。 */
type DeclaredText = { zh?: unknown; en?: unknown } & Record<string, unknown>

/** #716：命令行名与站点名（模板里的 {cli} / {cliBrand}）的运行时返回。 */
type VocabularyParams = { cli: string; cliBrand: string }

// 跨闭包的值引用按仓里规矩写模块级 declare（与 kernel/prompts-setup.ts、kernel/store-prefs.ts 同款）：
// 这些名字的真源在闭包里别的片段（prompts.ts 的模板表与设置端、store-prefs 的选择缓存、router 的取址函数），
// 本片只在调用时求值；类型一律写 any 是刻意的：在这里凭记忆写窄，只会把那边正常的改动变成这里的假报错。
declare function promptText(...args: any[]): any
declare function promptLang(...args: any[]): any
// #1294：语言链与按链取词。生产运行时走 kernel/locale.ts 的助手；门禁沙箱不只拼本文件，
//   所以这里调用的是 kernel/prompts.ts 里的同名兜底助手（promptChainOf / promptChainFrom / promptPickText）——
//   助手在场时它们转给 locale.ts，不在场（沙箱）时按同一份语言清单现算。本文件不写死任何语言代码。
declare function promptChainOf(...args: any[]): any
declare function promptChainFrom(...args: any[]): any
declare function promptPickText(...args: any[]): any
declare function newWayfinderParamsFrom(...args: any[]): any
declare function vocabularyParamsFrom(...args: any[]): any
declare function getCachedSelection(...args: any[]): any
declare function repoUrlFor(...args: any[]): any
declare function issueUrlFor(...args: any[]): any
    // 当前后端 id：st.selection → snapshot.selection → 按工作区缓存（**只在宿主还没回过任何一次之前**），三档都取不到就 null。#683（F1 · ADR 的 R6b）：第三档读的是本地那份镜像，而本次裁决把它降级成「本壳的临时镜像」（权威在宿主侧那份记录里），所以这道前提必须留着 —— 只有一份快照都还没有（宿主一次都没回过话）时才拿它垫一下（免得刷新页面先闪「还没有设置」）；宿主一旦回过话（哪怕回的是「这个工作区没有后端」）就以宿主的答复为准。
    export const currentBackendId = function (st: any): unknown {
      let sel = null
      try {
        if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
        else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
        else if (!(st && st.snapshot) && st && st.cwd && typeof getCachedSelection === 'function') { const cs = getCachedSelection(st.cwd); if (cs && cs.backendId != null) sel = cs.backendId }
      } catch (e) {}
      return sel
    }
    // 按后端查一条声明文本（{zh,en}）；后端没声明该键返回 null
    export const backendPromptFrom = function (modules: any, backendId: unknown, key: string): DeclaredText | null {
      try {
        const list = Array.isArray(modules) ? modules : []
        for (let i = 0; i < list.length; i++) {
          const m = list[i]
          if (m && String(m.id) === String(backendId) && m.prompts && m.prompts[key]) return m.prompts[key]
        }
      } catch (e) {}
      return null
    }
    // 按语言链取一条后端声明文本：链头是当前语言（或调用方指定的那门），链上都没有时
    //   用声明里任意一条兜底 —— 后端只声明一种语言时，整节不许静默消失成空串。
    // #1294：参数可以是「从哪门语言开始」（string），也可以直接给整条回退链（string[]）；
    //   都不给就从当前活动语言开始。它不再依赖「是不是 en」这种二选一判断。
    export const declaredLangPick = function (dict: unknown, lang?: string | ReadonlyArray<string>): string {
      try {
        if (!dict || typeof dict !== 'object') return ''
        const declared = dict as DeclaredText
        let chain: ReadonlyArray<string>
        if (Array.isArray(lang)) chain = lang
        else if (typeof lang === 'string' && lang) chain = promptChainFrom(lang)
        else chain = promptChainOf()
        return promptPickText(declared, chain)
      } catch (e) { return '' }
    }
    // #684：渲染参数 —— 注册表里的 {subIssue} / {subject} 都按当前后端解析填入，模板只留占位符名。
    //   {subject} 取后端在 prompts.healthCheck 里声明的体检科目；后端没声明该键时是空串（总纲照旧完整）。
    //   取这三行值都用本文件里的查表函数、不跨文件调用：本文件这一段会被门禁单独求值校验（门禁的渲染面）。
    export const backendParamsFor = function (st: any, params?: Record<string, unknown> | null): Record<string, unknown> {
      const p: Record<string, unknown> = Object.assign({}, params || {})
      if (!Object.prototype.hasOwnProperty.call(p, 'subIssue')) p.subIssue = newWayfinderParamsFrom(st && st.backendModules, currentBackendId(st)).subIssue
      if (!Object.prototype.hasOwnProperty.call(p, 'subject')) p.subject = declaredLangPick(backendPromptFrom(st && st.backendModules, currentBackendId(st), 'healthCheck'), promptLang())
      // #716：{cli} / {cliBrand} 由当前后端的词表声明填 —— 模板里一个命令行名字都不写死。
      const vocab = vocabularyParamsFrom(st && st.backendModules, currentBackendId(st))
      ;(Object.keys({ cli: '', cliBrand: '' }) as (keyof VocabularyParams)[]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(p, k)) p[k] = vocab[k] })
      // #684：只替换一遍不够 —— 后端那条科目文本（{subject} 的值）里还会引用别的占位符（GitHub 用它引出
      //   {subIssue} 那段原生关联文本），不补这一遍就会把嵌套占位符原样注入会话。只补 {subject} 这一个值就够。
      p.subject = String(p.subject).replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m })
      return p
    }
    // 按当前后端渲染一条 prompt（正文格式/子议题关联方式由后端声明注入口）
    export const promptTextFor = function (st: any, id: string, params?: Record<string, unknown> | null): string { return promptText(id, backendParamsFor(st, params)) }
    export const newWayfinderPrompt = function (st: any, backendId?: unknown): string {
      const id = backendId != null ? backendId : currentBackendId(st)
      const params = Object.assign({ repo: (typeof repoUrlFor === 'function' ? repoUrlFor(st) : (st && st.repo ? String(st.repo) : '')) }, newWayfinderParamsFrom(st && st.backendModules, id))
      return promptText('newWayfinder', params)
    }
    // v1.5 T4/T5：Matt 技能仓库（介绍卡 GitHub 链接）
    export const MATT_REPO = 'https://github.com/mattpocock/skills'
    export const MAP_EXECUTE_PROMPT = function (st: any): string { return promptTextFor(st, 'mapExecute') }
    export const COMPLETE_PROMPT = function (st: any): string { return promptTextFor(st, 'complete') }
    export const FIXATE_PROMPT = function (st: any): string { return promptTextFor(st, 'fixate') }
    // #1297：「实施地图」卡的提示词取用口（原来是蓝入口，与 newWayfinderPrompt 同形，{repo} 由当前工作区填）。
    export const newSpecPrompt = function (st: any): string {
      const params = { repo: (typeof repoUrlFor === 'function' ? repoUrlFor(st) : (st && st.repo ? String(st.repo) : '')) }
      return promptText('newSpec', params)
    }
    // v5（#77 grilling 定版 2026-08-21）：mapHead 自包含化 —— 标识头三字段内联 complete 顶部，completePrompt 补 title 参数并填 {n}/{title}/{url}
    // #1281：完成提示词改成自包含（首行 /wayfinder、次行链接都写在正文里），这三个占位符一次填完；
    //   n/title 两个参数保留是为了不动各处调用点，正文不再使用它们。
    export const completePrompt = function (st: any, num: unknown, title: unknown, total: unknown, closed: unknown): string {
      void title
      const url = issueUrlFor(st, String(num || '')) // #231：后端声明模板单源；元数据未达即空（诚实缺形态）
      return COMPLETE_PROMPT(st).split('{url}').join(url).split('{total}').join(String(total)).split('{closed}').join(String(closed))
    }
    export const inspectPrompt = function (st: any, num: unknown, title: unknown): string {
      const url = issueUrlFor(st, String(num || ''))
      return '/wayfinder ' + url + '\n\n' + promptTextFor(st, 'mapInspect', { n: String(num || ''), title: String(title || ''), url: url })
    }
