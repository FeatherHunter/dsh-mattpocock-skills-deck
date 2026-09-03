// src/host/remotePredicates.js —— H3 #447 从 host/index.js 242-309 搬出，纯结构、行为零变化。
// 以后谁改它：改本地关卡地图谓词或候选规则的人。预估约80行，超 350 打回。
// 接线：由 index.js 动态 import 加载；纯函数、零外部依赖；本文件不引用其他新文件。
export function createRemotePredicates() {
    // #284：markdown 后端谓词：本地图谱可解析（复用 backends/markdown/parse.js parseMd）
    // 2026-08-28 修复：本函数与 fileExistsChainRel 曾被误嵌套在 parseGithubRepo 函数体内，
    //   作用域外（wf.chain 谓词注册处）不可见 → 运行时 ReferenceError「mdParseOkPredicate is not defined」。
    async function mdParseOkPredicate(platform, cwd, lang) {
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
        const mod = await import('./tracker/backends/markdown/parse.js')
        const parseMd = mod.parseMd || mod.default
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
            lastErr = String((e && e.message) || e).slice(0, 200)
          }
        }
        return { status: 'fail', detail: zh ? ('关卡地图无法解析：' + lastErr) : ('local map parse failed: ' + lastErr) }
      } catch (e) { return { status: 'fail', detail: (lang === 'zh' ? '关卡地图检查出错：' : 'local map check failed: ') + String((e && e.message) || e).slice(0, 200) } }
    }
    /** 关卡地图候选（与 matches() 数据模型同构）：根地图 .scratch/map.md + 各关子目录 .scratch/<name>/map.md。
     * 2026-08-29 实机修复：候选存【相对路径字符串】（供 dirname/basename 与 display），存在性经
     *   fileExistsChainRel(相对路径) 判定；绝不做 platform.path.join(resolve输出)（resolve 返回 target 对象，join 必 TypeError）。 */
    async function mdMapCandidates(platform, cwd) {
      const out = []
      try {
        if (!platform || !platform.fs || typeof platform.fs.resolve !== 'function') return out
        let dirT = null
        try { dirT = await platform.fs.resolve('.scratch', { cwd: cwd }) } catch (eR) { return out }
        if (await fileExistsChainRel(platform, cwd, '.scratch/map.md')) out.push('.scratch/map.md')
        if (typeof platform.fs.listDir === 'function') {
          try {
            const entries = await platform.fs.listDir(dirT)
            for (const e of entries) {
              const name = typeof e === 'string' ? e : (e && e.name) || ''
              if (!name || name.startsWith('.')) continue
              const candRel = '.scratch/' + name + '/map.md'
              if (await fileExistsChainRel(platform, cwd, candRel)) out.push(candRel)
            }
          } catch (eL) {}
        }
      } catch (e) {}
      return out
    }
    async function fileExistsChainRel(platform, cwd, rel) {
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
