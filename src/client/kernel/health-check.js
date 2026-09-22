/**
 * src/client/kernel/health-check.js — 内核模块（#685：「体检」按钮的件数派生与开新会话注入）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼进 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 store-derived.js / link.js 同模式，一源两物，src 零复制。
 *
 * 三样东西只此一份（界面只按结果渲染，自己不算、不拼、不识别后端）：
 *   1) healthCheckCountOf —— 游离票的件数（口径见 #678）；
 *   2) healthCheckVisible —— 这颗按钮显不显示（#681 定版：三种情况整颗不渲染）；
 *   3) openHealthCheck —— 按当前后端取体检提示词并开一个新会话（按钮点一下走这里）。
 *
 * 数据全部来自契约快照与后端声明，不新增宿主电话、不新增取数。
 */
    // 游离票的件数（#678 定版的三条结构事实：未关闭 + 不是地图 + 不在任何地图的子票里）。
    //   「不在任何地图的子票里」用的是快照自己的分组口径 —— 宿主按 parentKey 分组时，已经挂到
    //   某张地图下的票进了 maps[].tickets，没挂上的才留在 issues 里（破链票也算留下，节点在
    //   src/host/tracker/snapshot.js 的 assembleSnapshot）。所以只数 issues，件数永远与列表里
    //   「独立票」的行数一致，不会出现「数字说有 11 张、列表里只看见 9 行」。
    //   算不出来时返回 null（不是 0）—— 0 会被读成「一张都没有」，两件事必须分得开（#681 定版）。
    export const healthCheckCountOf = function (st) {
      try {
        const issues = (st && st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : null
        if (!issues) return null
        let n = 0
        for (let i = 0; i < issues.length; i++) {
          const x = issues[i]
          if (!x || String(x.state || '').toUpperCase() === 'CLOSED') continue
          if (x.type === 'map') continue
          if ((x.labels || []).some(function (l) { return l && l.name === 'wayfinder:map' })) continue
          n += 1
        }
        return n
      } catch (e) { return null }
    }
    // 这颗按钮显不显示（#681 定版：三种情况整颗不渲染，第一性原理是「不许点出一颗空按钮」）。
    //   ① 没绑定后端 —— 没有后端就没有任何体检科目可注入；
    //   ② 工作区还没初始化 —— 还没有远端关联，体检无从谈起（快照的 repository 一项就是那个判据，
    //      与面板头部「未关联远端」那枚红章同源）；
    //   ③ 当前后端没有声明体检科目 —— 点了只会开一个空会话（#679 定版把「没有科目」归到这里）。
    //   三条都只读现成的快照与后端声明，界面不自己造状态、不按后端 id 分支。
    export const healthCheckVisible = function (st) {
      try {
        if (!st) return false
        const sel = st.selection || (st.snapshot && st.snapshot.selection) || null
        const backendId = sel ? sel.backendId : null
        if (backendId == null || String(backendId) === '') return false
        if (!(st.snapshot && st.snapshot.repository)) return false
        const list = (st.backendModules && st.backendModules.length) ? st.backendModules
          : ((st.snapshot && Array.isArray(st.snapshot.backendModules)) ? st.snapshot.backendModules : [])
        for (let i = 0; i < list.length; i++) {
          const m = list[i]
          if (m && String(m.id) === String(backendId) && m.prompts && m.prompts.healthCheck) return true
        }
        return false
      } catch (e) { return false }
    }
    // 题面：当前后端有几个游离票。算不出来时回 null，由界面自己决定少显示什么（本函数只报事实）。
    export const healthCheckSubjectOf = function (st) { return healthCheckCountOf(st) }
    // 按钮点一下：按当前后端取体检提示词，开一个新会话把它带过去（走页签行「+ 新建需求」同一条路）。
    //   记一条常驻日志（照 #662 为横幅注入定的先例）：用户点一下、插件往会话里写字，成败都要留痕。
    //   落点在本文件（内核目录）而不是渲染目录：渲染目录（views / panel / statusbar / floating）里
    //   能写日志的文件是一张点名白名单，ListTab.js 不在里面 —— 把这一行写在渲染文件里就得连改
    //   tests/verify-log-truncate.js 的门禁；落在内核就不碰那条判据，也与「界面只分发、不自己拼」
    //   的分层一致（同先例见 views/labels/labelColorPatch.js 与 statusbar/bannerChain.js）。
    //   字段只两个短枚举：哪个后端、注入成功还是失败 —— 提示词正文一个字都不记。
    export const healthCheckLogEvent = 'healthCheck.inject'
    export const openHealthCheck = function (st) {
      let backend = ''
      try {
        const sel = st && (st.selection || (st.snapshot && st.snapshot.selection))
        backend = (sel && sel.backendId != null) ? String(sel.backendId) : ''
      } catch (eSel) { backend = '' }
      let text = ''
      // 取不到（渲染抛错）就算没注成。注意「当前后端没声明体检科目」不是失败 —— 那种情况 {subject} 会被替换掉，
      //   注入给会话的仍是完整的体检总纲（#684 把这条行为写进了它的落地记录），只是少了后端那一节；
      //   而且界面那颗按钮在「后端没有科目」时整颗不渲染（见 healthCheckVisible），根本点不到。
      let injected = false
      try { text = promptTextFor(st, 'healthCheck'); injected = !!text } catch (e) { injected = false }
      try { openTextInNewSession(st, text, tr('list.healthCheckTitle')) } catch (eOpen) {}
      try {
        log('info', 'healthCheck.inject', { backend: backend, outcome: (injected ? 'ok' : 'fail') })
      } catch (eL) {}
      return injected
    }
