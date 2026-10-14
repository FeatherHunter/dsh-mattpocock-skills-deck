// src/host/remotePredicates.ts —— H3 #447 从 host/index.js 242-309 搬出，纯结构、行为零变化。
// 2026-10-14（#1161）从 .js 转成 .ts：只加类型标注与注释，逻辑一行未动。
// 以后谁改它：改本地关卡地图谓词或候选规则的人。预估约80行，超 350 打回。
// 接线：由 index.js 动态 import 加载；本文件除装配点（src/tracker/registry/builtins.ts）外不引其他新文件。

/** 谓词结果：status 三态 + 一句给人看的 detail（沿用搬出前的形状，不改）。 */
type PredicateResult = { status: 'pass' | 'fail' | 'pending'; detail: string }

/** 平台抽象里本文件用到的那几件（宿主注入；形状按实际调用点收窄，不用 any）。 */
type PlatformFs = {
  resolve(rel: string, opts?: { cwd?: string }): Promise<unknown>
  readText(target: unknown): Promise<string>
  listDir?(target: unknown): Promise<unknown[]>
  exists?(target: unknown): Promise<unknown>
  lstat?(target: unknown): Promise<unknown>
}
type Platform = { fs: PlatformFs; path: { dirname(p: string): string; basename(p: string): string } }

/** 从捕获到的任意值里取一句错误原文（原写法 `String((e && e.message) || e)` 的类型安全版本）。 */
function errText(e: unknown): string {
  const msg = (e as { message?: unknown } | null | undefined)?.message
  return String(msg || e)
}

export function createRemotePredicates() {
    // #284：markdown 后端谓词：本地图谱可解析（解析件经装配点从 markdown 房公开面取，见下方调用处）
    // 2026-08-28 修复：本函数与 fileExistsChainRel 曾被误嵌套在 parseGithubRepo 函数体内，
    //   作用域外（wf.chain 谓词注册处）不可见 → 运行时 ReferenceError「mdParseOkPredicate is not defined」。
    async function mdParseOkPredicate(platform: Platform, cwd: string, lang: string): Promise<PredicateResult> {
      try {
        // 2026-08-29 修复（用户实证：图谱落在 .scratch/<图谱名>/map.md；原只查根 .scratch/map.md 必然误报 missing）：
        //   与 backends/markdown matches() 数据模型同构——候选 = 根谱 .scratch/map.md + 各子谱 .scratch/*/map.md；
        //   全部缺失 = 图谱未初始化（fail，指引先做 Markdown 初始化）；存在但解析抛错 = 格式损坏（fail，附错误原文）。
        //   用户可见 detail 一律人话（无黑话：目录叫「本地数据目录」、文件叫「关卡地图」、.scratch/map.md 只括注）。
        const zh = lang === 'zh'
        const cands = await mdMapCandidates(platform, cwd)
        if (cands.length === 0) {
          return { status: 'fail', detail: zh ? '尚未生成关卡地图（先执行本地 Markdown 初始化）' : 'No map file yet — run Local Markdown setup first' }
        }
        // #1161：宿主不再直接深引房间实现（规则 rooms-imported-only-by-assembly），本地图谱解析
        //   经装配点 src/tracker/registry/builtins.ts 从 markdown 房的公开面取。
        const { loadBuiltinRoom } = await import('../tracker/registry/builtins.js')
        const mdRoom = await loadBuiltinRoom('markdown')
        // 只当「文本进、结果出」的函数用：这一层不关心解析结果的形状（meta 由房间自己解释）。
        //   注：这里不再给 parseMd 另写一套宽签名——房间的签名就是契约，自己写一份宽签名等于把
        //   房间的接口在宿主侧又抄一遍（#1161 要消灭的正是这种第二份口径）。
        const parseMd = mdRoom.parseMd
        if (typeof parseMd !== 'function') return { status: 'pending', detail: 'parseMd not exported' }
        let lastErr = ''
        for (const rel of cands) {
          try {
            // target-shaped 配对：readText 必须 receive resolve 的返回值（2026-08-29 实机修复：曾直接 readText(字符串) 且对 resolve 输出做 join 致 TypeError）
            const tgt = await platform.fs.resolve(rel, { cwd: cwd })
            const text = await platform.fs.readText(tgt)
            parseMd(String(text || ''), {})
            const dir = platform.path.dirname(rel)
            const slug = dir === '.scratch' ? 'root' : platform.path.basename(dir)
            return { status: 'pass', detail: zh ? ('关卡地图已就绪（' + slug + '）') : ('local map parses OK (' + slug + ')') }
          } catch (e) {
            lastErr = errText(e).slice(0, 200)
          }
        }
        return { status: 'fail', detail: zh ? ('关卡地图无法解析：' + lastErr) : ('local map parse failed: ' + lastErr) }
      } catch (e) { return { status: 'fail', detail: (lang === 'zh' ? '关卡地图检查出错：' : 'local map check failed: ') + errText(e).slice(0, 200) } }
    }
    /** 关卡地图候选（与 matches() 数据模型同构）：根地图 .scratch/map.md + 各关子目录 .scratch/<name>/map.md。
     * 2026-08-29 实机修复：候选存【相对路径字符串】（供 dirname/basename 与 display），存在性经
     *   fileExistsChainRel(相对路径) 判定；绝不做 platform.path.join(resolve输出)（resolve 返回 target 对象，join 必 TypeError）。 */
    async function mdMapCandidates(platform: Platform, cwd: string): Promise<string[]> {
      const out: string[] = []
      try {
        if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function') return out
        let dirT: unknown = null
        try { dirT = await platform.fs.resolve('.scratch', { cwd: cwd }) } catch (eR) { return out }
        if (await fileExistsChainRel(platform, cwd, '.scratch/map.md')) out.push('.scratch/map.md')
        if (typeof platform.fs.listDir === 'function') {
          try {
            const entries = await platform.fs.listDir(dirT)
            for (const e of entries) {
              const name = typeof e === 'string' ? e : String((e as { name?: unknown } | null | undefined)?.name || '')
              if (!name || name.startsWith('.')) continue
              const candRel = '.scratch/' + name + '/map.md'
              if (await fileExistsChainRel(platform, cwd, candRel)) out.push(candRel)
            }
          } catch (eL) {}
        }
      } catch (e) {}
      return out
    }
    async function fileExistsChainRel(platform: Platform, cwd: string, rel: string): Promise<boolean | null> {
      try {
        if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function') return null
        const abs = await platform.fs.resolve(rel, { cwd: cwd })
        if (typeof platform.fs.exists === 'function') return (await platform.fs.exists(abs)) === true
        if (typeof platform.fs.readText === 'function') { try { await platform.fs.readText(abs); return true } catch { return false } }
        if (typeof platform.fs.lstat === 'function') { try { const info = await platform.fs.lstat(abs); return !!info } catch { return false } }
        return null
      } catch (e) { return false }
    }
    return { mdParseOkPredicate, mdMapCandidates, fileExistsChainRel }
}
