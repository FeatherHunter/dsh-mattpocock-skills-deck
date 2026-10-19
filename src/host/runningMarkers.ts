/**
 * src/host/runningMarkers.ts —— 正在合并、变基、拣选与回退四个标记的探测（来源：src/host/runningMarkers.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：文件服务优先、git 兜底；两条路都不通时回 env-fs 并带上文件服务的原话。
 *
 * 三条不能改的约定（改之前先看原 runningMarkers.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 不新增任何 import 边：只给已有引用加类型，不引入新模块依赖；Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接，不装 @types/node。
 */

// ---------------------------------------------------------------------------
// 类型（#1247 转 TypeScript：只写类型不写实现）。
//
// 为什么标成这样：进来的依赖全部由装配点显式传入，形状按本文件实际用到的成员写成最小；
// 从外面进来的东西（客户端参数、后端行数据、文件里读出的 JSON）一律按 any 或 unknown 收，
// 收窄发生在运行时的 typeof 与 Array.isArray 判断里 —— 类型不替代那些运行时判断。
// ---------------------------------------------------------------------------

/** 本文件组装函数的依赖：全部由调用方显式传入，缺席时按原逻辑默认处理。 */
type Deps = any;

/** 客户端调电话时送进来的参数：JSON 边界，形状由调用方保证，本文件只做运行时判空。 */
type WfArgs = any;

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
export function createRunningMarkers(deps?: any): any {
  const existsViaFs = deps.existsViaFs
  const runProbe = deps.runProbe
  const paths = Array.isArray(deps.paths) ? deps.paths : []
  /** 读四个标记。ok:true 时给 markers；ok:false 时给 kind 与 detail（文件服务的原话）。 */
  async function read(gitDir?: any, probeCtx?: any) {
    const dir = String(gitDir || '').replace(/[\\/]+$/, '')
    const out = { merging: false, rebasing: false, cherryPicking: false, reverting: false }
    let fsDetail = ''
    for (const rel of paths) {
      let hit: any = null
      try { hit = await existsViaFs(dir + '/' + rel) } catch (e) { fsDetail = String((e && (e as any).message) || e); hit = null }
      if (hit === null) {
        // 文件服务拿不到结论 → git 兜底。兜底也说不出所以然，才认输。
        let viaGit: any = null
        try { viaGit = await runProbe(rel, probeCtx) } catch (e) { if (fsDetail === '') fsDetail = String((e && (e as any).message) || e) }
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
