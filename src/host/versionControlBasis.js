// src/host/versionControlBasis.js —— 「依据时间」那一小段的实现（#817 落地，#819 复审补回退路）
//
// 为什么单独成一个文件：src/host/versionControl.js 贴着文件粒度门禁的 350 行上限，这一段要补「刚克隆、
// 还没 fetch 过、没有 reflog」的回退路就放不下了；照 #500（logStore→logPhones）与 #821（versionControl→
// versionControlFiles）同一条先例搬成自包含叶子，父文件只留一行加载器。起进程的唯一出口 runPinned 与
// 文件服务 fs 都由父文件显式传入，本文件不引用父文件（单向引用），也不另起一套起进程的代码。
//
// 「依据时间」是什么：领先落后旁边那句「远端信息是什么时候更新的」（ADR 第 3 条）。两个来源，按可靠性排：
//   1. 远端跟踪引用的 reflog 末条时间戳（fetch 过的仓库都有）；
//   2. 这个上游自己的松散引用文件的落盘时间（只在它真以松散文件存在时用；打包了或不存在都给 null）。
// 两条路都拿不到就回 null：界面已有「读不到」那一档，绝不拿现在几点、也绝不拿全仓库共用的 packed-refs
// 的 mtime 冒充这个上游的依据时间（#819 复审再修：gc 一次就会让那个时间往后跳）。
/** 造这一段；runPinned 与 fs 都由父文件传入，本文件不自取任何环境。 */
export function createBasisReader(deps) {
  const { runPinned, fs } = deps
  /** fs.stat 回的落盘时间形态不可控（mtimeMs / Date / ISO 串 / 秒级数字 / null，见 handoffClaim.js 的教训）：
   *  解析不出给 null（拿不到就如实说拿不到，不拿现在几点冒充）。 */
  function mtimeMsOf(info) {
    if (!info) return null
    const direct = info.mtimeMs
    if (typeof direct === 'number' && isFinite(direct) && direct > 0) return direct
    const m = info.mtime
    if (m === null || m === undefined) return null
    if (m instanceof Date) { const t = m.getTime(); return Number.isNaN(t) ? null : t }
    if (typeof m === 'number') { if (!isFinite(m) || m <= 0) return null; return m > 100000000000 ? m : m * 1000 }
    const t = Date.parse(String(m))
    return Number.isNaN(t) ? null : t
  }
  /** 这个上游**自己的**松散引用文件的落盘时间：那是「本地记着的这个远端引用最后一次被写入」的真时刻。
   *  只在它真以松散文件存在时用；引用被打包（只剩 packed-refs）或压根不存在就给 null——packed-refs 是
   *  全仓库共用的一个文件，它的 mtime 跟这个上游没有任何关系，拿它当依据时间就是给未知凑一个好看的时刻
   *  （#819 复审再修：实测只跑一次 git gc 就会让「依据时间」往后跳约 1.2 秒，且上游已删的仓库也会凭空
   *  得到一个时间）；上游是本地分支（不在 refs/remotes/ 下）时这条路同样给 null，界面照旧说读不到。 */
  async function readRefFileMs(gitDir, upstream) {
    if (!upstream || upstream.indexOf('\u0000') >= 0) return null
    if (!fs || typeof fs.stat !== 'function') return null
    const dir = String(gitDir || '').replace(/[\\/]+$/, '')
    try {
      // #858：fs.stat 吃的是 fs.resolve() 给的 target 对象，不是路径——老写法喂路径会抛 TypeError 被下面 catch 吞掉，
      // 于是「依据时间」永远读不到（用户可见的降级）。正确形状：先 resolve 成 target；没有 resolve 就退路径式 lstat。
      const loose = dir + '/refs/remotes/' + upstream
      let st = null
      if (typeof fs.resolve === 'function') { try { st = await fs.stat(await fs.resolve(loose)) } catch (e) { st = null } }
      if (!st && typeof fs.lstat === 'function') { try { st = await fs.lstat(loose) } catch (e) { st = null } }
      if (!st && typeof fs.stat === 'function') { try { st = await fs.stat(loose) } catch (e) { st = null } } // 兜底：有些实现仍吃路径（真服务不吃，抛错就回 null）
      const ms = mtimeMsOf(st)
      return (ms !== null && ms > 0) ? ms : null
    } catch (e) { return null }
  }
  /** 依据时间：先取 reflog 末条时间（ADR 第 3 条要显示的正是这个时刻），没有再退回引用文件落盘时间，
   *  两条路都拿不到才给 null。 */
  async function readBasisMs(exe, root, gitDir, upstream) {
    if (!upstream) return null
    const res = await runPinned(exe, root, ['reflog', 'show', '--date=iso-strict', '--format=%gD', '-1', upstream], { stdoutLimit: 65536 })
    if (res.kind === 'ok') {
      const m = /\{([^}]*)\}/.exec(res.stdout)
      if (m) { const ms = Date.parse(m[1]); if (!Number.isNaN(ms)) return ms }
    }
    return await readRefFileMs(gitDir, upstream)
  }
  return { readBasisMs: readBasisMs }
}
