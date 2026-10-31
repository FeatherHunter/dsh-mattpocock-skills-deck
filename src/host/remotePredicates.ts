// src/host/remotePredicates.ts —— 宿主检查链里本地 Markdown 那三项判据的取用口（#447 搬出，#1513 拆成三项）。
//
// 这份文件只做一件事：把「链上要算哪一项本地 Markdown 判据」翻译成对房间判据的一次调用，
// 判据本体在 src/tracker/rooms/markdown/workspace-checks.ts（房间 preflight 也调同一份，票面硬条件）。
// 本文件除装配点（src/tracker/registry/builtins.ts）外不引其他新文件。
//
// 什么约定不能改：
//   1. 判据本体必须经装配点 loadMarkdownHostExtras() 获取，不得直接深引 src/tracker/rooms/markdown/*。
//   2. 三项判据的输入只给「宿主手里真有的四格」：platform、cwd、lang、sandboxPolicy。判据内部自己拼
//      最小的房间上下文；宿主不伪造 PredicateContext，也不替判据做路径判断。
//   3. 判据抛错一律收成 pending（诚实未知），不冒充 fail：宿主这一层量不出结论时，界面该看到「没量出来」。
//   4. 给用户看的 detail 由判据按 lang 出中文或英文；这一层只截长度（界面一行放不下整段证据）。

/** 谓词结果：status 三态 + 一句给人看的 detail（沿用搬出前的形状，不改）。 */
type PredicateResult = { status: 'pass' | 'fail' | 'pending'; detail: string; evidence?: string }

/** 检查项 id（带 md: 前缀的目录 id，或链上用的短 id）到 MarkdownHostExtras 里那个成员的映射。 */
const CHECK_NAME_OF: Record<string, 'checkWorkspace' | 'checkScratchWritable' | 'checkContainersReadable'> = {
  'md:workspace': 'checkWorkspace',
  'md:scratchWritable': 'checkScratchWritable',
  'md:containersReadable': 'checkContainersReadable',
  workspace: 'checkWorkspace',
  scratchWritable: 'checkScratchWritable',
  containersReadable: 'checkContainersReadable',
}

/** 从捕获到的任意值里取一句错误原文（原写法 `String((e && e.message) || e)` 的类型安全版本）。 */
function errText(e: unknown): string {
  const msg = (e as { message?: unknown } | null | undefined)?.message
  return String(msg || e)
}

/**
 * 组装本地 Markdown 后端在检查链中使用的三项判据取用口（#284 / #447 / #1161 / #1170 / #1513）。
 *
 * 为什么：检查链要逐项问「这个工作区有没有工作单元、本地数据目录写不写得进去、地图与规格读不读得动」。
 *   三项的判定细节（怎么发现工作单元、沙箱写许可怎么试、容器版本怎么认）全在房间里；宿主只按 id 分派。
 * 反例：如果宿主在这里另写一套「找 map.md」的规则，房间 preflight 与链上三项就会各判各的——
 *   同一个工作区可能房间说能用、链上三项说不行（或反过来），排查时没人分得清哪一份是真的。
 * 返回：mdPredicate（按 id 调一项判据）与 fileExistsChainRel（工作区相对路径存在性，别的调用方也在用）。
 */
export function createRemotePredicates() {
  /**
   * 按检查项 id 算一项本地 Markdown 判据。
   *
   * checkId 收目录 id（'md:workspace'）或短 id（'workspace'）；未登记的 id 回 pending —— 链上出现
   * 一个本文件不认识的本地检查项时，诚实说「没登记这一项」，而不是猜一个 pass。
   */
  async function mdPredicate(platform: unknown, cwd: string, lang: string, checkId: string, sandboxPolicy?: unknown): Promise<PredicateResult> {
    const key = String(checkId || '')
    try {
      const name = CHECK_NAME_OF[key]
      if (!name) return { status: 'pending', detail: 'markdown workspace check is not registered: ' + key }
      // #1161/#1170：宿主不深引房间实现，判据本体经装配点交出来。
      const { loadMarkdownHostExtras } = await import('../tracker/registry/builtins.js')
      const mdExtras = await loadMarkdownHostExtras()
      const fn = mdExtras[name]
      if (typeof fn !== 'function') return { status: 'pending', detail: 'markdown workspace check is not exported: ' + key }
      const r = await fn({ platform: platform, cwd: cwd, lang: lang, sandboxPolicy: sandboxPolicy })
      const status = r && (r.status === 'pass' || r.status === 'fail' || r.status === 'pending') ? r.status : 'pending'
      const detail = String((r && r.detail) || '').slice(0, 600)
      return { status: status, detail: detail, ...(r && r.evidence === 'writability-unverified' ? { evidence: r.evidence } : {}) }
    } catch (e) {
      return { status: 'pending', detail: errText(e).slice(0, 600) }
    }
  }

  /** 工作区相对路径是否存在：resolve → exists / readText / lstat 依次尝试；没有可用能力时回 null（不知道）。 */
  async function fileExistsChainRel(platform: { fs?: Record<string, unknown> } | null | undefined, cwd: string, rel: string): Promise<boolean | null> {
    try {
      if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function') return null
      const fs = platform.fs as {
        resolve(p: string, o?: { cwd?: string }): Promise<unknown>
        exists?(t: unknown): Promise<unknown>
        readText?(t: unknown): Promise<unknown>
        lstat?(t: unknown): Promise<unknown>
      }
      const abs = await fs.resolve(rel, { cwd: cwd })
      if (typeof fs.exists === 'function') return (await fs.exists(abs)) === true
      if (typeof fs.readText === 'function') { try { await fs.readText(abs); return true } catch { return false } }
      if (typeof fs.lstat === 'function') { try { const info = await fs.lstat(abs); return !!info } catch { return false } }
      return null
    } catch (e) { return false }
  }
  return { mdPredicate, fileExistsChainRel }
}
