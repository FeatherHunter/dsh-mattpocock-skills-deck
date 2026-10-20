/**
 * src/client/kernel/prompts.ts — 内核模块（阶段 2 内核迁移 · #96 T3）。
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mts 在构建时去掉每行行首 export 关键字，
 * 把声明体拼回 src/client/index.ts 的拼接标记处（apply 闭包内原位），与 ctx.js/seam 同模式，
 * 源码树里只有这一份真源、src 零复制；接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 * 改 src 后必跑 node scripts/build.mts，生成 client.js / package/lib/client.js，勿手改产物。
 *
 * #1292：本文件的 PROMPTS / NEW_BUG_FIELDS_BODY / NEW_WAYFINDER_DEFAULT_WIRING / VOCABULARY_DEFAULT 等提示词
 *   字面量已全部搬到 config/prompts/ 下的五份 YAML + config/languages.yaml；生成器是
 *   scripts/generate-prompt-config.mts，产物是同目录的 prompt-data.ts（不入库、构建期生成）。
 *   改文案只改 YAML；改骨架（增减模板、改占位符）只改 scripts/lib/prompt-config.mts 的
 *   PROMPT_TEMPLATE_IDS / PROMPT_FRAGMENT_IDS。改完必跑 npm run typecheck（--check 挂在最前面）。
 *
 * 客户端闭包里 PROMPT_TEMPLATE_DATA / PROMPT_FRAGMENT_DATA / LANGUAGES_YAML 这三个名字由
 *   kernel:promptData 那一片（见 src/client/index.ts 的 marker 注释）拼在 kernel:prompts 之前提供。
 *   客户端闭包不允许 module 级 import，所以本文件用 declare 把「外面有什么、长什么样」写下来 ——
 *   与 localeSvc / getCachedSelection 那些闭包名字同一套写法（见本文件末尾的类型段）。
 *
 * 源码侧向 typecheck / 直接 import 的人暴露「外部接口」（prompt-data.ts 的几种 export type / interface / const），
 *   便于门禁或单测按类型显式 import；闭包侧只消费那三个 const。同一个真源两条路：源码端给类型与门禁用，
 *   客户端端给拼接用。
 */
    // #1292：原文件头 const PROMPTS = {...字面量...} 已经被替换为「读生成物 PROMPT_TEMPLATE_DATA」。
    //   生成物在构建期已深冻（Object.freeze），这里只做一次转手。
    export const PROMPTS: Readonly<Record<string, PromptEntry>> = PROMPT_TEMPLATE_DATA
    // #716：CLI 名字与站点名字（模板里的 {cli} / {cliBrand}）的兜底说法不应写死在提示词里 —— 它们跟具体后端绑在一起。
    //   唯一的来源是后端的 prompts.commandVocabulary 声明；后端没声明时用中性说法兜底（vocabularyParamsFrom 渲染）。
    // #1292：兜底说法搬进 config/prompts/repository-alignment.yaml 的 vocabularyDefaults；下方按当前语言取该语言那一份。
    export const VOCABULARY_DEFAULT = PROMPT_FRAGMENT_DATA['vocabularyDefaults'] as {
      cli: { zh: string; en: string }
      cliBrand: { zh: string; en: string }
    }
    // #1292：语言清单的运行时入口。闭包里要知道「支持哪几门语言、缺省哪门、缺了往哪门退」时都走这里，
    //   不要另抄一份。值来自 config/languages.yaml（生成物里的 LANGUAGES_YAML），改 yaml → 跑生成器 → 重启生效。
    export const promptLanguages = function (): PromptLanguageConfig { return LANGUAGES_YAML }
    /**
     * 当前语言：跟随 DSH 的语言快照 active，按 config/languages.yaml 的语言清单与回退链决定落到哪一门。
     *
     * #1292 之前这里写死「是不是 en，否则 zh」。改成按清单取之后，加一门语言只改数据：
     *   ① 语言快照给的是 en-US 这种「主标签-地区」，所以只取主标签与清单的键对齐；
     *   ② 主标签不在清单里（或快照读不到）就用清单的 default；
     *   ③ 再从这一门出发沿 fallback 链往下走，落到第一门「提示词正文真带了」的语言。
     *      今天正文只有 zh / en 两份（PROMPT_TEXT_LANGS），所以链走到没带正文的语言时继续往下退，
     *      最后一定落在 default 那一门 —— 这就是「英文缺了内容就退到中文」的实现处。
     *   返回值类型仍是 PromptLang（今天正文的两种语言），因为下面所有按语言取正文的地方都用它当下标；
     *   清单里多出来的语言没有正文可给，不是这一段的事（界面多语言另开票 #1284）。
     */
    export const promptLang = function (): PromptLang {
      // 清单本身读不到时（生成物没拼进闭包这种极端情况）连 default 都没有，只能给最保守的一门；
      //   所以 cfg 放在 try 外面 —— 真读到过清单就照它的 default 办，读不到才退回 zh，不写死。
      let cfg: PromptLanguageConfig | null = null
      try {
        cfg = promptLanguages()
        const codes = cfg && cfg.languages ? Object.keys(cfg.languages) : []
        if (!codes.length) return String(cfg && cfg.default || '') === 'en' ? 'en' : 'zh'
        // 语言快照可能整个缺席（服务没装 getSnapshot 方法），也可能服务在但这次快照还没回来（返回 null）；
        //   两种都算「读不到」，交给清单的 default 决定 —— 不能因此掉进下面的 catch 去写死一门语言。
        const snap = (localeSvc && typeof localeSvc.getSnapshot === 'function') ? localeSvc.getSnapshot() : null
        const l = (snap && typeof snap === 'object') ? snap.active : null
        const main = String(l || '').split('-')[0].toLowerCase()
        const start: string = codes.indexOf(main) >= 0 ? main : String(cfg.default || codes[0])
        // 记「这条链走过哪几门」用无原型对象：语言代码若碰巧叫 constructor / __proto__，
        //   普通对象会命中原型链，第一步就退出循环、错落回缺省。
        const visited: Record<string, boolean> = Object.create(null)
        let cur: string | null = start
        while (cur && !visited[cur]) {
          visited[cur] = true
          if (PROMPT_TEXT_LANGS.indexOf(cur as PromptLang) >= 0) return cur as PromptLang
          // 类型标注是必需的：cur 的类型由这条链自己决定，不标注时 TS 判成循环推断（TS7022）。
          const entry: PromptLanguageConfig['languages'][string] | undefined = cfg.languages[cur]
          // fallback 是「接着找的那一门」，只认第一项：今天每门最多一条退路，校验层会拦下多写的项。
          const next: string | null = entry && entry.fallback && entry.fallback.length ? String(entry.fallback[0]) : null
          cur = next && cfg.languages[next] ? next : null
        }
        // 回退链走完都没落到带正文的语言（清单被改坏到这种程度）：退回缺省语言，缺省也不是就退回 zh。
        return String(cfg.default || '') === 'en' ? 'en' : 'zh'
      } catch (e) {
        return String(cfg && cfg.default || '') === 'en' ? 'en' : 'zh'
      }
    }
    // #716：CLI 名字与后端站点名兜底的纯 lookup。按 promptLang() 取该语言那一份，两个 key 都给中性说法；
    //   后端没声明 commandVocabulary 时回落到此处，永远不会让模板里的 {cli} / {cliBrand} 占位符原样进会话。
    export const vocabularyParamsFrom = function (modules: BackendModule[] | null | undefined, backendId: unknown): VocabularyParams {
      const out: VocabularyParams = { cli: VOCABULARY_DEFAULT.cli[promptLang()], cliBrand: VOCABULARY_DEFAULT.cliBrand[promptLang()] }
      try {
        const v = backendPromptFrom(modules, backendId, 'commandVocabulary')
        if (v && typeof v === 'object') {
          const want = v[promptLang()]
          if (typeof want === 'object' && want !== null) {
            const decl = want as Partial<VocabularyParams>
            if (typeof decl.cli === 'string' && decl.cli) out.cli = decl.cli
            if (typeof decl.cliBrand === 'string' && decl.cliBrand) out.cliBrand = decl.cliBrand
          }
        }
      } catch (e) {}
      return out
    }
    // 取 prompt：promptText(id) 或 promptText(id, { 占位符: 值 })
    // #716：词表那几个名字即使没人传值，也落中性说法，绝不把 {cli} 这样的占位符原样注入会话。
    export const promptText = function (id: string, params?: Record<string, unknown> | null): string {
      const p = PROMPTS[id]
      if (!p) return ''
      let s = (promptLang() === 'en' && p.en) ? p.en : (p.zh || '')
      const vals = Object.assign({}, params || {})
      ;(Object.keys({ cli: '', cliBrand: '' }) as (keyof VocabularyParams)[]).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(vals, k)) vals[k] = VOCABULARY_DEFAULT[k][promptLang()]
      })
      s = s.replace(/\{(\w+)\}/g, function (m: string, name: string) { return Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : m })
      return s
    }
    // #1292：取一条片段（不带版本号的纯字面条目）的文本，按当前语言取一份。
    //   端点形态与 promptText 同形（语言选择 + 空串兜底），但片段不带占位符（newBugFields /
    //   newWayfinderWiring 都是字面），vocabularyDefaults 是按 key 取一份中英、不走这里。
    export const promptFragment = function (id: string, lang?: string): string {
      const entry = PROMPT_FRAGMENT_DATA[id]
      if (!entry) return ''
      const wanted = (lang || promptLang())
      const text = (wanted === 'en') ? entry.en : entry.zh
      if (typeof text === 'string' && text) return text
      // 当前语言没写就回落另一种语言（与 templates 同款，后端只声明一种语言时整节不许静默消失）
      const other = (wanted === 'en') ? entry.zh : entry.en
      return typeof other === 'string' ? other : ''
    }
    // #230（D10 · 2026-08-28 生效）setupRun 后端描述数据（键入 locale 方案定版）：
    // 旧 setupTrackerLine/setupTrackerChoice/setupBackendNote 三函数（client 内 backendId 分支硬编码双语值）删除；
    // 后端模块经 BackendModule.setupPrompt 声明「locale 键名」，wf.registry 转发到 st.backendModules，此处只做 键→值 解析与占位符填充 —— client 零 backendId 分支。 #619（2026-09-13 生效）：v10 的 paletteNote 占位符连同「标签调色盘」那节注入文案一并删除 ——
    //   标签颜色改由插件自己放的配色文件（工作区里的 docs/agents/label-colors.json）与面板改色弹窗负责， 初始化注入不再引导任何人去建那张已经没人读的表；四个占位符一律由后端声明数据填充。
    export const SETUP_DEFAULT_PROMPT_KEYS: Record<string, string> = {
      trackerLine: 'setup.default.trackerLine',
      trackerChoice: 'setup.default.trackerChoice',
      backendNote: 'setup.default.backendNote',
      labelReqs: 'setup.default.labelReqs',
    }
    // #655：域文档布局的取值与后端无关，单独一条来源（不塞进上面的后端键表）。
    //   两个取值与卡片上那两个选项一一对应；缺省取 single —— 等值于卡片默认选中的那一项。
    export const SETUP_LAYOUT_TEXT_KEYS = { single: 'setup.layout.single', multi: 'setup.layout.multi' }
    export const SETUP_LAYOUT_DEFAULT = 'single'
    // 会话状态里读这次选的布局；没选过（或值不认识）→ null，由调用处决定是「先问」还是「按缺省走」。
    export const normalizeSetupLayout = function (v: unknown): SetupLayoutValue | null {
      const t = String(v == null ? '' : v).toLowerCase()
      return (t === 'single' || t === 'multi') ? t : null
    }
    export const readSetupLayout = function (st: PromptState | null | undefined): SetupLayoutValue | null { try { return normalizeSetupLayout(st && st.setupLayout) || normalizeSetupLayout((typeof getCachedSetupLayout === 'function') ? getCachedSetupLayout(st && st.cwd) : null) } catch (e) { return null } } // 2026-09-21：会话里没答过就沿用这个工作区记住过的那一份（按工作区持久化，见 store-prefs.js；两份都过一遍取值校验，不认识的取值一律当没答过）
    // 纯函数：modules = wf.registry modules 数组（元素可带 setupPrompt 键表）；dictOverride 供单测直喂 locale 字典（单测不依赖闭包 L）
    // layout 是用户这次选的布局（'single' / 'multi'）；没选过一律按缺省 single 填 —— 这条是兜底，
    //   正常路径由注入决策函数先把用户拦在卡上（见 setupOrRepoPrompt 的 'setup-card' 那一档）。
    export const setupRunParamsFrom = function (modules: BackendModule[] | null | undefined, backendId: unknown, dictOverride: LocaleDict | null | undefined, layout: unknown): Record<string, string> {
      const list = Array.isArray(modules) ? modules : []
      let m = null
      for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(backendId)) { m = list[i]; break } }
      const declared: Record<string, string> = (m && m.setupPrompt) || SETUP_DEFAULT_PROMPT_KEYS
      let dict = dictOverride || null
      if (!dict) { try { dict = (typeof L !== 'undefined' && L && L[promptLang()]) ? L[promptLang()] : null } catch (e) {} }
      const out: Record<string, string> = {}
      ;['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs'].forEach(function (k) {
        try { out[k] = (dict && dict[declared[k]] != null) ? String(dict[declared[k]]) : '' } catch (e) { out[k] = '' }
      })
      const lk = SETUP_LAYOUT_TEXT_KEYS[normalizeSetupLayout(layout) || SETUP_LAYOUT_DEFAULT]
      try { out.contextLayout = (dict && dict[lk] != null) ? String(dict[lk]) : '' } catch (e) { out.contextLayout = '' }
      return out
    }
    // UI 统一入口：显式 backendId 优先（绑定/切换流程）；否则当前 selection；再无 → 缺省键组。所有注入路径一律走这里。
    // 2026-08-28 修复“未指定”回退：显式选择已落在 host + localStorage selectionByCwd，但 prompt 之前只读 s.selection（单会话乐观），
    // 新会话/快照未水合时为 null 导致永远 default。现按权威链 s.selection → snapshot.selection → getCachedSelection(cwd) 取 id，保持 UI 零硬编码。
    // #655：layout 由调用处显式传入（会话状态里的用户选择），不在这里自己读 —— 决策函数与注入路径已把「选没选」判过了。
    export const setupRunPrompt = function (st: PromptState | null | undefined, backendId?: unknown, layout?: unknown): string {
      let sel = null
      try {
        if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
        else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
        else if (st && st.cwd && typeof getCachedSelection === 'function') { const cs = getCachedSelection(st.cwd); if (cs && cs.backendId != null) sel = cs.backendId }
      } catch {}
      const id = backendId != null ? backendId : sel
      return promptText('setupRun', setupRunParamsFrom(st && st.backendModules, id, null, layout))
    }
    // switchAlign v4：模板=V15原文+首句（7占位符），调用处必须一次凑齐，禁止只传from/to（否则5个大括号裸奔）。
    export const switchAlignPrompt = function (st: PromptState | null | undefined, targetId: unknown, fromLabel: unknown, toLabel: unknown, layout?: unknown): string {
      let lay = null
      try { lay = layout != null ? layout : ((typeof readSetupLayout === 'function') ? readSetupLayout(st) : null) } catch (e) { lay = null }
      let params = null
      try { params = setupRunParamsFrom(st && st.backendModules, targetId, null, lay) } catch (e) { params = {} }
      try { params.from = String(fromLabel != null ? fromLabel : ''); params.to = String(toLabel != null ? toLabel : '') } catch (e) {}
      return promptText('switchAlign', params)
    }
    // #661/#662：仓库没就绪时一个字都不注入；判据看 guide-steps.js 里 blocksSetup 那一步是否已过。
    //   返回 {kind:'setup'|'blocked', text, layout}；blocked 时 text 是空串。
    // 链快照步骤：与状态栏横幅同一口径，界面只读宿主快照，不自己算状态。
    const setupChainSteps = function (st: PromptState | null | undefined): ChainStep[] {
      try { if (typeof chainSteps === 'function') return chainSteps(st) } catch (e) {}
      try { return (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : [] } catch (e2) { return [] }
    }
    // 清单里这个后端有没有一步标着 blocksSetup 而它没过（没过 = 那一步的检查项在链快照里不全是 done）。
    export const setupBlockedByGuide = function (st: PromptState | null | undefined, backendId?: unknown): boolean {
      try {
        if (typeof guideStepsFor !== 'function' || typeof guideStepDone !== 'function') return false
        let sel = backendId
        if (sel == null && typeof currentBackendId === 'function') sel = currentBackendId(st)
        const steps: ChainStep[] | null | undefined = guideStepsFor(sel)
        const snapshot = setupChainSteps(st)
        const arr: ChainStep[] | null = steps ? steps : null
        for (let i = 0; i < (arr ? arr.length : 0); i++) {
          const step = arr![i]
          if (!step || step.blocksSetup !== true) continue
          if (!guideStepDone(step, snapshot)) return true
        }
        return false
      } catch (e) { return false }
    }
    export const setupOrRepoPrompt = function (st: PromptState | null | undefined, backendId?: unknown): SetupOrRepoDecision {
      const decLayout = readSetupLayout(st) || SETUP_LAYOUT_DEFAULT
      const setupText = function () {
        try { return (typeof setupRunPrompt === 'function') ? setupRunPrompt(st, backendId, decLayout) : '' } catch (e) { return '' }
      }
      try {
        let sel = backendId
        try {
          if (sel == null) {
            if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
            else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
          }
        } catch (e) {}
        const blocked = setupBlockedByGuide(st, sel)
        try { console.log('[MattSkillsDeck] setup-inject decision blocked=' + (blocked ? '1' : '0') + ' layout=' + (readSetupLayout(st) || 'unset')) } catch (e) {}
        if (blocked) return { kind: 'blocked', text: '', layout: decLayout }
      } catch (e) {
        try { console.warn('[MattSkillsDeck] setup-inject decision fallback: ' + String(((e as AnyError | null | undefined) && (e as AnyError).message) || e).slice(0, 120)) } catch (_) {}
      }
      return { kind: 'setup', text: setupText(), layout: decLayout }
    }
    // 注入这条路只有一份判据：kernel/prompts-setup.js 的 injectSetupDecision。
    // #664：null = 什么都不该注入；与空串是两件事 —— 空串分发器会按 action.prompt 原样注入（实测会把 setupRun 当文案塞进会话）。
    export const setupRunTextForClick = function (st: PromptState | null | undefined): string | null {
      try {
        if (typeof injectSetupDecision !== 'function') return (typeof setupRunPrompt === 'function') ? setupRunPrompt(st) : null
        const kind = injectSetupDecision(st, undefined, { injectNow: false, allowCard: true })
        if (kind !== 'setup') return null
        return (typeof setupRunPrompt === 'function') ? setupRunPrompt(st) : ''
      } catch (e) { return null }
    }
    // Q2 #496：建仓成功处消费标记，补发一次初始化全文（标记按工作区键核对，不跨区）。
    // #655：这条路径没有界面可弹卡，所以不传 allowCard —— 沿用会话里已选的布局，没选过就按缺省布局填（用户故事 13）。
    // #664：会置真那个标记的缺仓档已按新流程退役（见 injectSetupDecision 里的说明），今天没有任何一处把它置真，
    //   这条补发路径因此走不到；本票不动它，理由与那里同一条。
    export const consumePendingSetup = function (st: PromptState | null | undefined): boolean {
      try {
        if (st && st.pendingSetupAfterPublish && (!st.pendingSetupCwd || st.pendingSetupCwd === st.cwd)) {
          st.pendingSetupAfterPublish = false; st.pendingSetupCwd = ''
          const kind = (typeof injectSetupDecision === 'function') ? injectSetupDecision(st, undefined, undefined) : ''
          if (kind === 'setup') {
            try { console.log('[MattSkillsDeck] setup-inject reissued after repo ready (once)') } catch (e) {}
            return true
          }
        }
      } catch (e) {}
      return false
    }
    // v13 新增：newWayfinder 后端无关片段注入（与 setupRun 同构，UI 零分支）
    // #1292：旧版 NEW_WAYFINDER_DEFAULT_WIRING 字面对象（{ zh, en }）的真源现在住在
    //   PROMPT_FRAGMENT_DATA['newWayfinderWiring']；这里只是一个转一道的导出。
    export const NEW_WAYFINDER_DEFAULT_WIRING: DeclaredText = (function () {
      const fr = PROMPT_FRAGMENT_DATA['newWayfinderWiring']
      return { zh: fr.zh || '', en: fr.en || '' }
    })()
    export const newWayfinderParamsFrom = function (modules: BackendModule[] | null | undefined, backendId: unknown, dictOverride?: unknown): { subIssue: string } {
      const list = Array.isArray(modules) ? modules : []
      let m = null
      for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(backendId)) { m = list[i]; break } }
      const wiringObj = (m && m.prompts && m.prompts.subIssue) || NEW_WAYFINDER_DEFAULT_WIRING
      let dict = dictOverride || null
      if (!dict) { try { dict = wiringObj } catch (e) {} } else dict = wiringObj
      const lang = promptLang()
      // #595：先按当前语言取；只声明了另一种语言时就回落另一种语言，最后才落通用默认（整节不许静默消失）
      const subIssue = declaredLangPick(dict, lang) || declaredLangPick(NEW_WAYFINDER_DEFAULT_WIRING, lang)
      return { subIssue }
    }
    // 后端声明那条边的所有导出（currentBackendId / backendPromptFrom / declaredLangPick / backendParamsFor /
    //   promptTextFor / newWayfinderPrompt / MAP_EXECUTE_PROMPT / COMPLETE_PROMPT / FIXATE_PROMPT /
    //   newSpecPrompt / inspectPrompt / completePrompt / promptLanguages）已搬到
    //   kernel/prompts-backend.ts（同一个闭包、不走 import），避免 prompts.ts 涨破 350 行上限。
    // 后端的 NEW_BUG_FIELDS_BODY / NEW_BUG_FIELDS_BODY_EN 两个相邻函数现收成
    //   PROMPT_FRAGMENT_DATA['newBugFields'] 之下的 zh / en 两份。导出形态保留：返回时按 lang 取值。
    export const NEW_BUG_FIELDS_BODY = function (): string { return promptFragment('newBugFields', 'zh') }
    export const NEW_BUG_FIELDS_BODY_EN = function (): string { return promptFragment('newBugFields', 'en') }



// ---------------------------------------------------------------------------
// 类型与「闭包提供的名字」（#1209 转 TypeScript 时补）
//
//   本文件是拼进客户端闭包的一段，不是一个能被 import 的模块：localeSvc、L、guideStepsFor 这些
//   名字都由闭包提供，本文件不定义它们。所以用一层 declare 把「外面有什么、长什么样」写下来 ——
//   这是仓库既定做法（先例见 src/client/kernel/link.ts 与 statusbar/StatusBackend.ts 开头）。
//   declare 只活在类型检查里，esbuild 转译时整条删掉，拼进闭包的产物与转换前逐字一致。
//
//   登记表为什么收成 PromptRegistry 而不是让 TS 自己推：下面每一条的键就是模板 id，正文与
//   placeholders 是它的全部契约。写成一份带类型的注册表之后，新增一条时漏掉 en/zh、把
//   placeholders 写成字符串、或者版本号写成 '15' 这种字符串，都会在 tsc 那一关当场红，
//   而不是等到某次注入会话时才以「占位符原样出现在提示词里」的形式暴露出来。
// ---------------------------------------------------------------------------

/**
 * 提示词的语言：跟随 DSH 的语言快照，按 config/languages.yaml 的清单与回退链落定（见 promptLang）。
 * 只有这两门——今天每条模板的正文就只写了 zh / en 两份，清单里多出来的语言没有正文可给。
 */
type PromptLang = 'zh' | 'en'

/** 提示词正文今天真带了哪几门语言；promptLang 沿回退链找的就是这个集合里的第一门。 */
const PROMPT_TEXT_LANGS: ReadonlyArray<PromptLang> = ['zh', 'en']

/**
 * 语言清单的形状（config/languages.yaml，生成物里的 LANGUAGES_YAML 就长这样）。
 * default 是缺省语言；languages 的键是语言代码，label 是选择器上 zh/en 各一份的叫法，
 * fallback 是「这门语言缺了内容时接着找哪几门」，空数组表示它没有上一级、是回退链的终点。
 */
type PromptLanguageConfig = {
  default: string
  languages: Readonly<Record<string, {
    label: { readonly zh: string; readonly en: string }
    fallback: ReadonlyArray<string>
  }>>
}

/** 域文档布局的两个取值，与 statusbar/StatusBackend.ts 的 SETUP_LAYOUT_VALUES 是同一套取值。 */
type SetupLayoutValue = 'single' | 'multi'

/**
 * 登记表的形状——生成物 prompt-data.ts 已经按键联合类型校验过（详见 generate-prompt-config.mts 的
 * PromptTemplateId / PromptTemplatePlaceholders），这里只对外说「一条模板」长什么样，不再用 satisfies
 * 套在字面量上（生成物不可被 satisfies 直套）。
 *
 * 注意这里没有 use 字段：「这条模板什么时候用」是给读代码的人看的一句话，住在 config/prompts/ 的
 * YAML 里，不进客户端产物（#1290 的验收明说「use 不出现在客户端产物」）。
 */
type PromptEntry = {
  /** 这条模板改到第几版；改了正文就要升版（改版记录写在条目上方的注释里）。 */
  version: number
  /** 正文里会用到的占位符名（花括号里那些）。空数组表示这条模板不填空。 */
  placeholders: ReadonlyArray<string>
  zh: string
  en: string
}

/**
 * 片段的形状：要么是一段双语文字（newBugFields / newWayfinderWiring），要么是一组按 key 分的双语说法
 * （vocabularyDefaults 的 cli / cliBrand）。两种都从 YAML 来，生成物里是同一个表。
 */
type PromptFragmentEntry = {
  zh?: string
  en?: string
  cli?: { zh: string; en: string }
  cliBrand?: { zh: string; en: string }
}

/** 整张登记表：键就是模板 id（promptText / promptTextFor 按它取）。 */
type PromptRegistry = Record<string, PromptEntry>

/** 后端声明的一段中英文本（后端模块的 prompts.* 或 setupPrompt 键表里的值）。 */
type DeclaredText = { zh?: unknown; en?: unknown } & Record<string, unknown>

/**
 * 一份词条字典（L 里按语言取出来的那一份，或单测直喂的那一份）：键 → 该语言的正文。
 * setupRunParamsFrom 拿它把「后端声明的 locale 键名」解析成实际文案，所以必须能按任意键名取。
 */
type LocaleDict = Record<string, string | undefined>

/** wf.registry 里的一个后端模块（本文件只读 id / setupPrompt / prompts 三处）。 */
type BackendModule = { id?: unknown; setupPrompt?: Record<string, string>; prompts?: Record<string, DeclaredText> } & Record<string, unknown>

/** 闭包里的链快照步骤（与状态栏那条横幅同一口径）。 */
type ChainStep = { id?: string; blocksSetup?: boolean; checks?: { done?: unknown }[] } & Record<string, unknown>

/** #716：命令行名与站点名（模板里的 {cli} / {cliBrand}）的运行时返回。 */
type VocabularyParams = { cli: string; cliBrand: string }

/**
 * setupOrRepoPrompt 的返回：给不给文字、给哪一类。
 *   'setup' 有全文可注入；'blocked' 一个字都不注入（仓库那一步还没过）。
 */
type SetupOrRepoDecision = { kind: 'setup' | 'blocked'; text: string; layout: string }

/**
 * 会话状态对象。**故意不立全字段接口**：它由闭包各处共用、随用随加，在这里抄一份必然与别处走岔。
 * 下面列的只是本文件真正读过的那些字段，全部可选 —— 本文件对它们的访问本来就包在 try 里。
 */
type PromptState = {
  cwd?: string
  setupLayout?: unknown
  selection?: { backendId?: unknown } | null
  snapshot?: { selection?: { backendId?: unknown } } | null
  backendModules?: BackendModule[]
  chainSnapshot?: { steps?: ChainStep[] } | null
  pendingSetupAfterPublish?: boolean
  pendingSetupCwd?: string
  repo?: unknown
  [key: string]: unknown
}

/**
 * 从登记表的键推导出来的「动作模板 id」名单。
 *
 *   为什么要推：{@link NEW_WAYFINDER_DEFAULT_WIRING} 这一段要判断「后端声明里有没有一个叫 subIssue 的
 *   动作模板」，而这份名单的真源就是登记表本身。另抄一份常量出来，新增模板时就多了一处要同步的地方，
 *   漏同步不会报错、只会让那段回落文本悄悄走错分支；这里用类型挂到键上，登记表一改它跟着改。
 *   运行时的形状与手写一份常量完全一样（这个推导只活在类型层），所以拼进闭包的行为没有变化。
 */
type TemplateId = Extract<keyof typeof PROMPTS, `tpl.${string}`>

/**
 * 闭包里 catch 接到的值（throw 什么都有可能，包括字符串）。
 * 只在这里、只为了读 .message 而收一层 —— 别的写法（把它收窄成 Error）会让 catch(err) 的位置
 * 在类型上不再成立，等于对运行时形状撒谎。
 */
type AnyError = { message?: unknown }

// 下面这些名字由闭包提供，本文件只调用它们。参数一律 any：它们的实现住在同一次构建拼进来的别的
// 片段里，在这里替它们立契约等于在第二处写一遍签名，两边会慢慢走岔。
declare const localeSvc: { getSnapshot(): { active?: unknown } } | null | undefined
declare const L: Record<string, Record<string, string>> | null | undefined
// #1292：提示词数据由 kernel:promptData 那一片（生成物 src/client/kernel/prompt-data.ts）拼在闭包里，
//   名字在这里声明一下——闭包里没有 module 级 import，declare 只活在类型检查里，转译时整条删掉。
declare const PROMPT_TEMPLATE_DATA: Readonly<Record<string, PromptEntry>>
declare const PROMPT_FRAGMENT_DATA: Readonly<Record<string, PromptFragmentEntry>>
// #1292：语言清单（config/languages.yaml）的运行时值也由那一片提供，promptLanguages / promptLang 读它。
declare const LANGUAGES_YAML: PromptLanguageConfig
// #1292：「按当前后端渲染」那一族搬到 kernel/prompts-backend.ts 了（同一个闭包、不走 import），
//   本文件还要用其中两个，所以在这里声明一下（写法与上面那些闭包名字同款）。
declare function currentBackendId(...args: any[]): any
declare function declaredLangPick(...args: any[]): any
declare function backendPromptFrom(...args: any[]): any
declare function getCachedSetupLayout(cwd?: string | null): unknown
declare function getCachedSelection(cwd: unknown): { backendId?: unknown } | null | undefined
declare function chainSteps(st: unknown): ChainStep[]
declare function guideStepsFor(backendId: unknown): ChainStep[] | null | undefined
declare function guideStepDone(step: unknown, steps: unknown): boolean
declare function injectSetupDecision(st: unknown, backendId: unknown, opts?: unknown): string
declare function inject(st: unknown, text: unknown): void
declare function repoUrlFor(st: unknown): string
declare function issueUrlFor(st: unknown, num: unknown): string

// （promptLanguages 与后端一族的导出已搬到 kernel/prompts-backend.ts —— 同一闭包、不走 import）
