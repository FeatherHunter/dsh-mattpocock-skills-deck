/**
 * src/client/kernel/locale.ts —— 界面词表的合并器与取词助手（#1294 重写；原来是十份 locale-*.ts 片段的合并器）。
 *
 * 本文件的三个职责
 *   1. 把生成物里的合并词表 LOCALE_COPY 暴露成 L（与旧代码里 register('dsws', L) 的接口同形），
 *      并负责把 dsws 命名空间按 config/languages.yaml 的语言清单注册进宿主 locale 服务。
 *   2. 提供「按语言清单取词」的一组函数：语言链、当前语言、按链取后端声明的双语内容、取界面词。
 *      以前散在各处的 `promptLang() === 'en' ? en : zh` 二元判断，现在都改成调用这里，
 *      加一门语言不用再逐个调用点改（#1290 的实施决定：注册与取词都由语言清单驱动）。
 *   3. 注册这趟边界的 dsh-log 轨迹（见下面「日志」一节）。
 *
 * 为什么语言清单与词表都不在本文件里
 *   真源是 config/languages.yaml 与 config/copy/*.yaml，生成器 scripts/generate-locale-config.mts
 *   把它们写成 src/client/kernel/locale-data.ts（不入库），构建时排在 kernel:locale 之前拼进闭包。
 *   本文件只消费生成物，不写死任何语言 id、也不写死任何界面文案 —— 这是 #1294 的核心判据。
 *
 * 回退链怎么走（与宿主的回退语义对齐，但这里自己算一份给「取后端声明的双语内容」用）
 *   从当前活动语言（宿主快照 active 的主标签，例如 zh-CN → zh）出发，沿该语言在清单里的
 *   fallback[0] 往下走，走不动时落到缺省语言；结果是一条去重后的语言 id 列表。
 *   宿主那边 register 的每门语言也必须有一条能走到终点的回退链，否则 register 会抛错 ——
 *   本文件注册前先把「宿主缺的语言」按回退深度排序再 addLanguage，保证链底先存在。
 *
 * 日志（dsh-log 客户端半边，纪律见 docs/design/335-logging-contract.md 与 research/489-appendix.md）
 *   两类事件，都发生在「按语言清单注册 dsws 命名空间」这一趟：
 *     · locale.registration       info / 按需：登记语言数、本次新增/跳过数、缺省语言、耗时；
 *     · locale.registration.fail  warn / 常驻：哪一步（快照 / 新增语言 / 注册词表）、哪门语言、
 *       回退目标、错误摘要的散列值。
 *   为什么要刻意晚一拍记（emitLog 里的 queueMicrotask）：本文件在闭包里排在 kernel:log 之前，
 *   注册动作可能在 apply 执行到一半时就发生，那时日志模块的 log 还没初始化；晚一拍到微任务，
 *   闭包整段执行完、log 已就位，事件不会丢。失败仍然不重抛：界面退化到缺省语言还能用，
 *   把宿主 locale 服务不合约这条原因留在日志里比让整个面板加载失败更有用。
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mts 在构建时去掉每行行首 export 关键字，
 * 把声明体文本拼回 src/client/index.ts 的拼接标记处（apply 闭包内原位），与 ctx.js/seam 同模式。
 * 接口冻结清单见 docs/architecture/kernel-contract.md。
 */
declare const LANG_CONFIG: {
  default: string
  languages: Record<string, { label: { zh: string; en: string }; fallback: ReadonlyArray<string> }>
};
declare const LOCALE_LANGS: ReadonlyArray<string>;
declare const LOCALE_COPY: Record<string, Record<string, string>>;
/** 宿主 locale 服务的形状（只在运行时存在；本文件是闭包片段，不能 import）。 */
declare const localeSvc: {
  getSnapshot?: () => { active?: unknown; locales?: ReadonlyArray<{ id?: string; fallback?: string }> } | null
  bind?: (ns: string) => (key: string, params?: any) => string
  register?: (ns: string, locale: string, dict: Record<string, string>) => (() => void) | undefined
  addLanguage?: (input: { id: string; label: string; fallback: string }) => (() => void) | undefined
} | null | undefined;
/** dsh-log 客户端半边的写入口（kernel:log 提供，kernel:locale 之后才初始化，见文件头「日志」一节）。 */
declare const log: ((level: string, event: string, fields: any) => void) | undefined;
declare const dswsLogHash: ((text: string) => string) | undefined;
declare const dswsLogTrunc: ((text: string) => string) | undefined;

    /** 合并词表：每门语言一份「全部词族并起来」的字典（生成物 LOCALE_COPY 的同一份引用）。 */
    export const L = LOCALE_COPY as Readonly<Record<string, Readonly<Record<string, string>>>>;

    /**
     * 语言清单里的全部语言 id（按 config/languages.yaml 的顺序）。
     * 读的是生成物里的 LANG_CONFIG，不在代码里写死 zh / en。
     * LOCALE_LANGS 是生成器按同一份清单产出的定序数组（#1294 的注册顺序），优先用它；
     * 它缺席时（手写测试桩只给了 LANG_CONFIG）退回按 LANG_CONFIG.languages 的键序算。
     */
    export const languageIds = function (): string[] {
      try {
        if (LOCALE_LANGS && typeof LOCALE_LANGS.length === 'number' && LOCALE_LANGS.length) {
          return Array.prototype.slice.call(LOCALE_LANGS) as string[]
        }
      } catch (e) { /* 落到下面的清单键 */ }
      const table = LANG_CONFIG && LANG_CONFIG.languages ? LANG_CONFIG.languages : {}
      return Object.keys(table)
    };

    /**
     * 把宿主活动语言值折成语言 id 的主标签：'zh-CN' → 'zh'，'en-US' → 'en'。
     * 空值、非字符串一律返回空串，由调用方落到缺省语言。
     */
    export const localeMainTagOf = function (raw: any): string {
      return String(raw === null || raw === undefined ? '' : raw).split('-')[0].toLowerCase()
    };

    /**
     * 从指定语言开始算一条「回退链」：沿清单里各语言的 fallback[0] 往下走，走不动时落到缺省语言；
     * 链上每门语言只出现一次（清单本身有环时也不会原地打转）。id 不在清单里时从缺省语言起算。
     */
    export const langChainFrom = function (id: string): string[] {
      const ids = languageIds()
      const def = LANG_CONFIG && LANG_CONFIG.default ? String(LANG_CONFIG.default) : ''
      let cur: string = ids.indexOf(String(id)) >= 0 ? String(id) : def
      const chain: string[] = []
      const seen: Record<string, boolean> = Object.create(null)
      while (cur && !seen[cur]) {
        seen[cur] = true
        chain.push(cur)
        const entry = LANG_CONFIG.languages[cur]
        const next = entry && entry.fallback && entry.fallback.length ? String(entry.fallback[0]) : ''
        cur = next && ids.indexOf(next) >= 0 ? next : ''
      }
      if (def && ids.indexOf(def) >= 0 && !seen[def]) chain.push(def)
      return chain.length ? chain : [def]
    };

    /** 宿主当前活动语言 id 算出的回退链（取词一律走它，保证加语言时不用改调用点）。 */
    export const langChainOf = function (): string[] {
      let active = ''
      try {
        if (localeSvc && typeof localeSvc.getSnapshot === 'function') {
          const snapshot = localeSvc.getSnapshot()
          active = localeMainTagOf(snapshot && snapshot.active)
        }
      } catch (e) {
        active = ''
      }
      return langChainFrom(active || String(LANG_CONFIG && LANG_CONFIG.default ? LANG_CONFIG.default : ''))
    };

    /** 当前界面语言 id（回退链的头一项；清单里没有这门语言时是缺省语言）。 */
    export const uiLang = function (): string {
      return langChainOf()[0]
    };

    /**
     * 按语言链在一份「语言 id → 文本」的字典里取第一个非空字符串。
     *
     * 这是以前那十几处 `(lang === 'en' && x.en) ? x.en : (x.zh || '')` 的统一替代：
     *   · 后端声明的双语内容（{zh, en} 形状）用它；
     *   · 命名域的内容表（{zh, en} 键）用它；
     *   · 语言链没给到任何可用语言时，退到这字典里任意一个非空字符串（今天等价于 zh 兜底）。
     * chain 参数是给「明确要从某门语言开始找」的调用点用的（例如 promptFragment 指定语言）。
     */
    export const pickLangText = function (dict: any, chain?: ReadonlyArray<string>): string {
      if (!dict || typeof dict !== 'object') return ''
      const order: ReadonlyArray<string> = chain && chain.length ? chain : langChainOf()
      for (let i = 0; i < order.length; i++) {
        const v = (dict as Record<string, unknown>)[order[i]]
        if (typeof v === 'string' && v) return v
      }
      const keys = Object.keys(dict)
      for (let i = 0; i < keys.length; i++) {
        const v = (dict as Record<string, unknown>)[keys[i]]
        if (typeof v === 'string' && v) return v
      }
      return ''
    };

    /**
     * 取一条界面词（LOCALE_COPY 里按语言链找）。
     * 找不到时返回键名本身 —— 与 tr() 退化、宿主「查不到就显示键名」的行为一致，
     * 这样界面漏词能一眼看出来，而不是显示空白。
     */
    export const uiText = function (key: string): string {
      const order = langChainOf()
      for (let i = 0; i < order.length; i++) {
        const table = LOCALE_COPY[order[i]]
        if (!table) continue
        const v = table[key]
        if (typeof v === 'string') return v
      }
      return String(key)
    };

    /**
     * 一门语言在界面上的显示名：取这门语言 label 的 zh / en 两份说法里与当前界面语言一致的那份，
     * 没有就用 zh、再没有用 en、最后退回语言 id（理论上不会走到，生成器已保证 label 双份齐全）。
     */
    export const languageLabelOf = function (id: string): string {
      const entry = LANG_CONFIG.languages[id]
      if (!entry || !entry.label) return String(id)
      const order = langChainOf()
      for (let i = 0; i < order.length; i++) {
        const v = (entry.label as Record<string, unknown>)[order[i]]
        if (typeof v === 'string' && v) return v
      }
      // 链上一门都没有时，用这份 label 里任意一份非空说法（不写死语言 id：语言清单换语言时这里不用改）。
      const labelKeys = Object.keys(entry.label)
      for (let i = 0; i < labelKeys.length; i++) {
        const v = (entry.label as Record<string, unknown>)[labelKeys[i]]
        if (typeof v === 'string' && v) return v
      }
      return String(id)
    };

    /**
     * 晚一拍再写日志：本文件排在 kernel:log 之前，注册动作可能在 apply 执行到一半时发生，
     * 那时闭包里的 log 还没初始化（const 暂时性死区）。推到微任务后整段 apply 已跑完，log 就位。
     */
    const localeLogEmit = function (level: string, event: string, fields: any): void {
      const run = function (): void {
        try {
          if (typeof log !== 'function') return
          log(level, event, fields)
        } catch (e) {
          // 日志失败不影响界面：这条边界宁可少一条记录，也不能让注册流程失败。
        }
      }
      try {
        if (typeof queueMicrotask === 'function') queueMicrotask(run)
        else if (typeof setTimeout === 'function') setTimeout(run, 0)
        else run()
      } catch (e) {
        try { run() } catch (e2) { /* 同上：日志永不向上抛 */ }
      }
    };

    /**
     * 按语言清单把 dsws 命名空间注册进宿主 locale 服务。
     *
     * 步骤（顺序不能换，宿主契约要求回退目标先存在）：
     *   1. 读宿主快照：哪些语言它已经有（内置 zh / en 在），哪一门是回退链终点（没有 fallback 的那门，
     *      今天 en —— 不写死，宿主要是换了终点这门函数也照样对）；
     *   2. 清单里宿主还没有的语言按「回退目标先于自己」排序，逐个 addLanguage({id, label, fallback})；
     *   3. 再对清单里每一门语言 register('dsws', id, 该语言词表)；
     *   4. 返回清理函数（ctx.effect 的清理）：把所有 register / addLanguage 的 disposer 依次调用。
     *
     * 任何一步失败都只记日志、不向上抛：界面还有缺省语言与 tr() 的宿主兜底，整块面板不该因此不加载。
     */
    export const localeAdopt = function (svc: any): () => void {
      const disposed: Array<() => void> = []
      const ids = languageIds()
      const startedAt = Date.now()
      let stage = 'snapshot'
      let addedCount = 0
      let failCount = 0
      const failure = function (lang: string, fallback: string, err: any): void {
        failCount += 1
        const raw = err instanceof Error ? err.message : String(err === null || err === undefined ? '' : err)
        let errorHash = ''
        try {
          if (typeof dswsLogHash === 'function' && typeof dswsLogTrunc === 'function') {
            errorHash = String(dswsLogHash(dswsLogTrunc(raw)))
          }
        } catch (e) {
          errorHash = ''
        }
        localeLogEmit('warn', 'locale.registration.fail', {
          stage: stage,
          lang: String(lang || ''),
          fallback: String(fallback || ''),
          errorHash: errorHash,
        })
      }
      try {
        // 1) 宿主已有语言 + 终点语言
        let snapshot: any = null
        try {
          if (svc && typeof svc.getSnapshot === 'function') snapshot = svc.getSnapshot()
        } catch (eSnap) {
          failure('', '', eSnap)
          snapshot = null
        }
        const known: Record<string, boolean> = Object.create(null)
        const hostLocales: ReadonlyArray<any> = snapshot && Array.isArray(snapshot.locales) ? snapshot.locales : []
        for (let i = 0; i < hostLocales.length; i++) {
          const one = hostLocales[i]
          if (one && one.id) known[String(one.id)] = true
        }
        const def = String(LANG_CONFIG && LANG_CONFIG.default ? LANG_CONFIG.default : '')
        let terminal = ''
        for (let i = 0; i < hostLocales.length; i++) {
          const one = hostLocales[i]
          if (one && one.id && !one.fallback) { terminal = String(one.id); break }
        }
        if (!terminal) terminal = def
        const fallbackOf = function (id: string): string {
          const entry = LANG_CONFIG.languages[id]
          const first = entry && entry.fallback && entry.fallback.length ? String(entry.fallback[0]) : ''
          return first || terminal
        }

        // 2) 宿主缺的语言：按「回退目标先注册」的顺序 addLanguage
        stage = 'addLanguage'
        const pending: string[] = []
        for (let i = 0; i < ids.length; i++) {
          if (!known[ids[i]]) pending.push(ids[i])
        }
        // 宿主本来就有、只补注册词表的语言数（加语言时这一项等于「清单比宿主多几门」的反面）。
        //   失败的语言不并进这一项：失败另发 #113，结论行里用 ok=false 表示这趟没全成。
        const existingCount: number = ids.length - pending.length
        const ordered: string[] = []
        while (pending.length) {
          let picked = -1
          for (let i = 0; i < pending.length; i++) {
            const fb = fallbackOf(pending[i])
            if (known[fb] || ordered.indexOf(fb) >= 0) { picked = i; break }
          }
          // 追加链本身在清单校验阶段已经保证无环、能走到终点；真遇到异常清单时按原顺序兜底，不让死循环挡住注册。
          if (picked < 0) picked = 0
          const id = pending.splice(picked, 1)[0]
          ordered.push(id)
          try {
            if (svc && typeof svc.addLanguage === 'function') {
              const dispose = svc.addLanguage({ id: id, label: languageLabelOf(id), fallback: fallbackOf(id) })
              if (typeof dispose === 'function') disposed.push(dispose)
              addedCount += 1
            }
          } catch (eAdd) {
            failure(id, fallbackOf(id), eAdd)
          }
        }

        // 3) 每门语言注册词表（清单里有、宿主也有的语言同样要注册）
        stage = 'register'
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i]
          const table = LOCALE_COPY[id]
          if (!table) continue
          try {
            if (svc && typeof svc.register === 'function') {
              const dispose = svc.register('dsws', id, table)
              if (typeof dispose === 'function') disposed.push(dispose)
            }
          } catch (eReg) {
            failure(id, '', eReg)
          }
        }

        // 4) 这一趟的结论（按需事件：只有调试开关打开时才会落盘，见 335 契约）
        localeLogEmit('info', 'locale.registration', {
          langCount: ids.length,
          addedCount: addedCount,
          skippedCount: existingCount,
          defaultLang: def,
          latencyMs: Date.now() - startedAt,
          // ok 不是恒 true：这一步有语言 addLanguage / register 抛过错时记 false（错误细节在 #113）。
          ok: failCount === 0,
        })
      } catch (err) {
        failure('', '', err)
      }
      return function (): void {
        for (let i = disposed.length - 1; i >= 0; i--) {
          try { disposed[i]() } catch (e) { /* 清理失败不向上抛：卸载路径不再需要界面状态 */ }
        }
      }
    };
