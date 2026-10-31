/**
 * src/host/versionControlRewriteMount.ts —— 维护页整仓重写三片叶子的装配外壳（#1750 T15）
 *
 * 为什么单独一个文件：父文件 src/host/versionControl.ts 已经顶到有效行上限，新装配不能再往里堆逻辑，
 * 只留一个懒加载入口（const rewrites = createRewriteMount({...})）。三片叶子互相依赖：
 * 现场读取层被预检与执行共用，执行层要复用预检的票表与结果表（同一张票只能被同一族电话看见）。
 *
 * 约定：装配失败时三个电话都回明确失败信封，票表回 null；绝不因为装配失败而假装成功。
 */
export function createRewriteMount(host: any): any {
  const h: any = host || {}
  let assembling: any = null

  /** 懒组装三片：第一次调用电话时才 import，装配失败只记一次并复用同一个失败对象。 */
  function pieces(): any {
    if (!assembling) {
      assembling = Promise.all([
        import('./versionControlRewriteScene.js'),
        import('./versionControlRewriteCheck.js'),
        import('./versionControlRewriteWrite.js'),
      ]).then(function (mods: any): any {
        const scene: any = mods[0].createRewriteScene(h)
        const check: any = mods[1].createRewriteCheck({ scene: scene, failPhone: h.failPhone, now: h.now, randomId: h.randomId })
        const write: any = mods[2].createRewriteWrite({
          scene: scene,
          failPhone: h.failPhone,
          runPinned: h.runPinned,
          taskStart: h.taskStart,
          now: h.now,
          tickets: check.tickets,
          results: check.results,
          fs: h.fs,
        })
        return { scene: scene, check: check, write: write, tickets: check.tickets }
      }).catch(function (e: any): any {
        const said: string = String((e && e.message) || e)
        const failed: any = {
          handleRewritePreview: function (): any { return h.failPhone('env', '维护页整仓重写这一层装配失败：' + said) },
          handleRewriteCheck: function (): any { return h.failPhone('env', '维护页整仓重写这一层装配失败：' + said) },
          handleRewriteRun: function (): any { return h.failPhone('env', '维护页整仓重写这一层装配失败：' + said) },
        }
        return { check: failed, write: failed, tickets: null }
      })
    }
    return assembling
  }

  return {
    preview: h.loggedPhone('wf.gitRewritePreview', 'git-rewrite-preview', function (args: any): any { return pieces().then(function (p: any) { return p.check.handleRewritePreview(args) }) }),
    check: h.loggedPhone('wf.gitRewriteCheck', 'git-rewrite-check', function (args: any): any { return pieces().then(function (p: any) { return p.check.handleRewriteCheck(args) }) }),
    run: h.loggedPhone('wf.gitRewriteRun', 'git-rewrite-run', function (args: any): any { return pieces().then(function (p: any) { return p.write.handleRewriteRun(args) }) }),
    tickets: async function (): Promise<any> { const p: any = await pieces(); return p.tickets || null },
  }
}
