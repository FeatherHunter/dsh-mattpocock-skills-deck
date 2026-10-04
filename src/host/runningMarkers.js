// src/host/runningMarkers.js —— 「正在合并 / 变基 / 拣选 / 回退」四个标记的探测（#858）
//
// 为什么要单独成叶并加一条 git 兜底：文件服务不可用时，原先直接回 kind='env' 的「文件服务用不了」，
// 界面上那句话被读成「找不到 git 程序」——**真因不是 git**。现在两条路：
//   ① 文件服务（快）：问 <gitDir>/<标记名> 在不在；
//   ② git 兜底（只在①拿不到结论时走）：`git rev-parse -q --verify <标记名>`——真机实测
//      不存在 exit 1、合并中 MERGE_HEAD exit 0、变基停住 REBASE_HEAD exit 0；
// 两条都不通时回新种类 `env-fs` 并**带上文件服务的具体错误**，让界面能把话说明白。
//
// 依赖全由装配点显式传入（照 #500 / #821 的叶子先例）：existsViaFs(path) → true/false/null、
// runProbe(标记名, ctx) → true/false/null、paths 是四个标记文件名。
export function createRunningMarkers(deps) {
  const existsViaFs = deps.existsViaFs
  const runProbe = deps.runProbe
  const paths = Array.isArray(deps.paths) ? deps.paths : []
  /** 读四个标记。ok:true 时给 markers；ok:false 时给 kind 与 detail（文件服务的原话）。 */
  async function read(gitDir, probeCtx) {
    const dir = String(gitDir || '').replace(/[\\/]+$/, '')
    const out = { merging: false, rebasing: false, cherryPicking: false, reverting: false }
    let fsDetail = ''
    for (const rel of paths) {
      let hit = null
      try { hit = await existsViaFs(dir + '/' + rel) } catch (e) { fsDetail = String((e && e.message) || e); hit = null }
      if (hit === null) {
        // 文件服务拿不到结论 → git 兜底。兜底也说不出所以然，才认输。
        let viaGit = null
        try { viaGit = await runProbe(rel, probeCtx) } catch (e) { if (fsDetail === '') fsDetail = String((e && e.message) || e) }
        if (viaGit === true) hit = true
        else if (viaGit === false) hit = false
        else return { ok: false, kind: 'env-fs', detail: fsDetail || (typeof deps.getFsDetail === 'function' ? String(deps.getFsDetail() || '') : '') || '文件服务与 git 兜底都没给出结论' }
      }
      if (!hit) continue
      if (rel === 'MERGE_HEAD') out.merging = true
      else if (rel === 'CHERRY_PICK_HEAD') out.cherryPicking = true
      else if (rel === 'REVERT_HEAD') out.reverting = true
      else out.rebasing = true
    }
    return { ok: true, markers: out }
  }
  return { read: read }
}

export const RUNNING_MARKERS_SOURCE = 'src/host/runningMarkers.js'
