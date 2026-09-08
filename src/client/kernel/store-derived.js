/**
 * src/client/kernel/store-derived.js — 内核模块（#455 由 store.js 拆出之派生统计与行级动作全家）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    // 派生：票务分组（frontier/claimed/blocked/closed）
    export const compute = (st) => {
      const maps = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
      return maps.map(function (m) {
        const byNum = {}; m.tickets.forEach(function (t) { byNum[t.number] = t })
        const openBlocker = (b) => { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
        const open = m.tickets.filter(function (t) { return t.state === 'OPEN' })
        const closed = m.tickets.filter(function (t) { return t.state === 'CLOSED' })
        const frontier = open.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
        const claimed = open.filter(function (t) { return t.claimedBy })
        const blocked = open.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
        return { m: m, open: open, closed: closed, frontier: frontier, claimed: claimed, blocked: blocked }
      })
    }
    export const frontierAll = (st) => compute(st).reduce(function (n, g) { return n + g.frontier.length }, 0)

    // v18-30：状态栏可接/占用改用「列表 open issue」口径（与面板列表一致）：
    //   可接 = open issue 中未认领且未被 open 阻塞；占用 = 已认领 + 被阻塞；两者之和 = 全部 open issue
    export const openIssuesOf = (st) => ((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).filter(function (x) { return x.state !== 'CLOSED' })
    // #544 独立票阻塞边共用小函数（isOccupied 回落与 applyStandaloneBlocks 共用）：
    //   standaloneKeyOfRef 把数字/字符串/{key}/{number} 等形状归一成 key 字符串；
    //   standaloneStateMapOf 把快照里全部票（issues + 各地图子票）的状态按数字与 key 双键收成大写表。
    const standaloneKeyOfRef = function (b) {
      if (b === undefined || b === null) return ''
      if (typeof b === 'number' || typeof b === 'string') return String(b)
      if (typeof b === 'object') {
        if (b.key !== undefined && b.key !== null && b.key !== '') return String(b.key)
        if (b.number !== undefined && b.number !== null) return String(b.number)
      }
      return ''
    }
    const standaloneStateMapOf = function (st) {
      const stateOf = {}
      const put = function (k, s) { if (k === undefined || k === null || k === '') return; stateOf[String(k)] = String(s || '').toUpperCase() }
      const snap = (st && st.snapshot) || {}
      const issues = Array.isArray(snap.issues) ? snap.issues : []
      const maps = Array.isArray(snap.maps) ? snap.maps : []
      issues.forEach(function (it) { if (!it) return; put(it.number, it.state); if (it.key !== undefined && it.key !== null) put(it.key, it.state) })
      maps.forEach(function (m) { (m.tickets || []).forEach(function (t) { if (!t) return; put(t.number, t.state); if (t.key !== undefined && t.key !== null) put(t.key, t.state) }) })
      return stateOf
    }
    // #544 独立票阻塞边判定：一条阻塞边算数，当且仅当按 live 状态表查到阻塞者为 open；
    // 查不到 live 状态时，用边自带 state 回落（open 才算数），都没有则不算。
    const standaloneHasOpenBlocker = function (stateOf, arr) {
      if (!Array.isArray(arr)) return false
      for (let i = 0; i < arr.length; i++) {
        const k = standaloneKeyOfRef(arr[i])
        if (!k) continue
        const live = stateOf[k]
        if (live === 'OPEN') return true
        if ((live === undefined || live === '') && arr[i] && typeof arr[i] === 'object' && String(arr[i].state || '').toUpperCase() === 'OPEN') return true
      }
      return false
    }
    export const isOccupied = function (st, x) {
      if (!x || x.state === 'CLOSED') return false
      if (x.assignees && x.assignees.length) return true
      const maps = (st.snapshot && st.snapshot.maps) || []
      let inMap = false
      for (let mi = 0; mi < maps.length; mi++) {
        const m = maps[mi]
        if (!m.tickets || !m.tickets.length) continue
        const byNum = {}
        m.tickets.forEach(function (t) { byNum[t.number] = t })
        const t = byNum[x.number]
        if (t) {
          inMap = true
          if (t.blockedBy && t.blockedBy.length) {
            const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
            if (openBlockers.length) return true
          }
        }
      }
      if (inMap) return false
      // #544 独立票合并：不属于任何地图子票的行，看自己身上的阻塞边；
      // 地图票的判定以上循环为准，这里不碰，保证地图分层与计数一字不差。
      try {
        return standaloneHasOpenBlocker(standaloneStateMapOf(st), x.blockedBy)
      } catch (e) { return false }
    }
    export const occCount = (st) => openIssuesOf(st).filter(function (x) { return isOccupied(st, x) }).length
    export const frontierCount = (st) => openIssuesOf(st).length - occCount(st)
    // #544 独立票阻塞边合并：把快照 issues 里独立票自身的 blockedBy 合并进表级 blockOf；
    // 只挂自己身上（已是地图子票的行、地图节点行、已关闭行、已有关联的行一律跳过，不碰地图层级与计数）。
    // 数据来自列表查询已有的阻塞边片段（零请求）；单票边解析失败只跳过当票，不抛，不影响整表。
    export const applyStandaloneBlocks = function (st, blockOf) {
      const snap = (st && st.snapshot) || {}
      const issues = Array.isArray(snap.issues) ? snap.issues : []
      if (!issues.length || !blockOf) return blockOf
      const maps = Array.isArray(snap.maps) ? snap.maps : []
      const inMap = {}
      maps.forEach(function (m) {
        (m.tickets || []).forEach(function (t) {
          if (!t) return
          if (t.number !== undefined && t.number !== null) inMap[String(t.number)] = true
          if (t.key !== undefined && t.key !== null) inMap[String(t.key)] = true
        })
      })
      const stateOf = standaloneStateMapOf(st)
      const isMapRow = function (x) { return x.type === 'map' || ((x.labels || []).some(function (l) { return l && l.name === 'wayfinder:map' })) }
      issues.forEach(function (x) {
        try {
          if (!x || x.state === 'CLOSED' || isMapRow(x)) return
          const id = (x.number !== undefined && x.number !== null) ? x.number : ((x.key !== undefined && x.key !== null) ? x.key : null)
          if (id === null || id === undefined || blockOf[id] !== undefined) return
          if (inMap[String(id)] || (x.key !== undefined && x.key !== null && inMap[String(x.key)])) return
          const arr = Array.isArray(x.blockedBy) ? x.blockedBy : []
          if (!arr.length) return
          const openBlockers = []
          arr.forEach(function (b) {
            const k = standaloneKeyOfRef(b)
            if (!k) return
            const live = stateOf[k]
            if (live === 'OPEN') { openBlockers.push(k); return }
            if ((live === undefined || live === '') && b && typeof b === 'object' && String(b.state || '').toUpperCase() === 'OPEN') openBlockers.push(k)
          })
          if (openBlockers.length) blockOf[id] = { map: null, mapTitle: '', by: openBlockers }
        } catch (e) { /* 单票边解析失败只跳过当票，不崩整表 */ }
      })
      return blockOf
    }
    // v1.5 T1：BUG / 诊断计数（open 且带对应标签，与「可接」同口径）
    export const hasLabelOf = function (x, nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
    export const isTriageLike = function (x) { const labs = (x && x.labels) || []; if (!Array.isArray(labs) || labs.length === 0) return true; return labs.some(function (l) { return (typeof l === 'string' ? l : l.name) === 'needs-triage' }) }
    export const bugCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'bug') }).length
    export const triageCount = (st) => openIssuesOf(st).filter(function (x) { return isTriageLike(x) }).length

    // v19：共享 —— 标签配置色映射（聚合：快照全量 labels + 票面最终色；票面色已是“查 triage-labels.md 再兜底默认 11 色”后的最终色，不直读 labelPalette）
    export const buildColorOf = function (st) {
      const colorOf = {}
      const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : []
      snapLabels.forEach(function (l) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') })
      const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
      issues.forEach(function (x) { (x.labels || []).forEach(function (l) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') }) })
      const maps = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
      maps.forEach(function (m) { (m.tickets || []).forEach(function (t) { (t.labels || []).forEach(function (l) { if (l && l.name && l.color) colorOf[String(l.name).trim()] = String(l.color).trim().replace(/^#/, '') }) }) })
      return colorOf
    }
    // T9：行级动作主色计算（与 mkRowAction 共享 · 给新会话按钮复用：与执行按钮同 label 主色）
    export const isLightHex = function (hex) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
        const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
        return (299 * r + 587 * g + 114 * b) / 1000 > 160
      } catch (e) { return false }
    }
    export const actionColorOf = function (x, colorOf) {
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const bc = function (nm, fb) { const cc = colorOf[nm]; return cc ? '#' + cc : fb }
      const _isTriageLike = !(x.labels && x.labels.length) || has('needs-triage')
      if (_isTriageLike) return bc('needs-triage', '#f59e0b')
      if (has('bug')) return bc('bug', '#f87171')
      if (has('wayfinder:grilling')) return bc('wayfinder:grilling', '#d93f0b')
      if (has('wayfinder:research')) return bc('wayfinder:research', '#0ea5e9')
      if (has('wayfinder:prototype')) return bc('wayfinder:prototype', '#f59e0b')
      return '#c084fc'
    }
    // #361：行级动作注入文本的单一真源（诊断/修复/讨论/执行）—— 新会话打开与行内动作共用
    export const rowActionText = function (st, x) {
      let url = ''
      try { url = issueUrlFor(st, x.number) } catch(e) { url = '' }
      if (!url) {
        const fallbackKey = (x && (x.number != null ? x.number : x.key != null ? x.key : ''))
        if (fallbackKey !== '') url = '#' + String(fallbackKey)
      }
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const _isTriageLike = !(x.labels && x.labels.length) || has('needs-triage')
      if (_isTriageLike) return renderTemplate('diagnose', { url: url })
      if (has('bug')) return renderTemplate('fix', { url: url })
      if (has('wayfinder:grilling')) return renderTemplate('discuss', { url: url })
      if (has('wayfinder:research')) return renderTemplate('research', { url: url })
      if (has('wayfinder:prototype')) return renderTemplate('prototype', { url: url })
      try { return startText(st, x) } catch(e) { return renderTemplate('diagnose', { url: url }) }
    }
    // v19：共享 —— 行级动作（列表与 map 详情共用）：按 label 四选一（诊断/修复/讨论/执行），预填输入框；
    // 按钮主体色 = 对应 label 的 GitHub 配置色（YIQ 感知亮度定文字色）
    export const mkRowAction = function (st, x, narrow, colorOf) {
      const url = issueUrlFor(st, x.number)
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const _isTriageLike = !(x.labels && x.labels.length) || has('needs-triage')
      const isLight = function (hex) {
        try {
          const hh = String(hex || '').replace('#', '')
          if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
          const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
          return (299 * r + 587 * g + 114 * b) / 1000 > 160
        } catch (e) { return false }
      }
      const btnColor = function (nm, fb) { const c = colorOf[nm]; return c ? '#' + c : fb }
      const mk = (icon, label, text, colorHex) => {
        const light = isLight(colorHex)
        const tipByLabel = (function(){
          try {
            if (label === tr('act.diagnose')) return tr('tip.diagnose')
            if (label === tr('act.fix')) return tr('tip.fix')
            if (label === tr('act.discuss')) return tr('tip.discuss')
            if (label === tr('act.research')) return tr('tip.research')
            if (label === tr('act.prototype')) return tr('tip.prototype')
            if (label === tr('act.execute')) return tr('tip.execute')
          } catch(e){}
          return label
        })()
        return h(Tip, { content: tipByLabel }, h('button', {
          className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''),
          onClick: function (e) { e.stopPropagation(); inject(st, text) },
          style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: colorHex, borderColor: 'transparent', color: light ? '#140a1e' : '#ffffff' },
        }, [Ic({ n: icon, size: icon === 'prototype' ? 12 : 10 }), narrow ? null : h('span', null, label)]))
      }
      // v21：技能命令 + URL + 统一引导句（不再重复灌输技能内部流程）
      // v25 · T2b：诊断/修复/讨论走模板渲染（用户可自定义静态文本，{url} 注入）
      if (_isTriageLike) return mk('chat', tr('act.diagnose'), rowActionText(st, x), btnColor('needs-triage', '#f59e0b'))
      if (has('bug')) return mk('hammer', tr('act.fix'), rowActionText(st, x), btnColor('bug', '#f87171'))
      if (has('wayfinder:grilling')) return mk('chat', tr('act.discuss'), rowActionText(st, x), btnColor('wayfinder:grilling', '#d93f0b'))
      if (has('wayfinder:research')) return mk('search', tr('act.research'), rowActionText(st, x), btnColor('wayfinder:research', '#0ea5e9'))
      if (has('wayfinder:prototype')) return mk('prototype', tr('act.prototype'), rowActionText(st, x), btnColor('wayfinder:prototype', '#f59e0b'))
      return mk('play', tr('act.execute'), rowActionText(st, x), '#c084fc')
    }
    // #506 拉取请求页签门控与列表派生（前端房纯函数，无日志点：无跨边界调用、无新缓存、无定时器，复用既有快照链路）
    // 门控只读后端模块的能力位，不写后端名字；快照组装全留，过滤归前端。
    // ListFilter 登记（前端房登记，后端按此实现过滤；示例见 #504 正文）：
    //   const res = await listIssues({ refId: 'owner/name' }, { state: 'open', isPullRequest: true }, ctx)
    // 成功时只返回拉取请求，同池逐票仍必带三个扩展字段。
    export const prTabVisible = function (st) {
      try {
        var sel = (st && (st.selection || (st.snapshot && st.snapshot.selection))) || null
        var bid = sel ? sel.backendId : null
        if (bid == null) return false
        var meta = null
        try { meta = (typeof moduleMetaOf === 'function') ? moduleMetaOf(st, bid) : null } catch (eM) { meta = null }
        if (meta && meta.capabilities && meta.capabilities.pullRequests === true) return true
        var ms = (st && Array.isArray(st.backendModules)) ? st.backendModules : null
        if (ms) for (var i = 0; i < ms.length; i++) { var m = ms[i]; if (m && m.id === bid && m.capabilities && m.capabilities.pullRequests === true) return true }
        return false
      } catch (e) { return false }
    }
    export const prIssuesOf = function (st) {
      try {
        var snap = (st && st.snapshot) || null
        if (!snap) return []
        var out = []
        var seen = {}
        var push = function (x) {
          if (!x || x.isPullRequest !== true) return
          var k = (x.key != null ? String(x.key) : (x.number != null ? String(x.number) : ''))
          if (!k) return
          var pid = k + '\0pr'
          if (seen[pid]) return
          seen[pid] = true
          out.push(x)
        }
        if (Array.isArray(snap.issues)) snap.issues.forEach(push)
        if (Array.isArray(snap.maps)) snap.maps.forEach(function (m) { if (m && Array.isArray(m.tickets)) m.tickets.forEach(push) })
        return out
      } catch (e2) { return [] }
    }
    export const prFilterForList = function () { return { isPullRequest: true } }
    // v19：交接文档时间戳文件名（YYYYMMDD-HHMMSS）
    export const timeStampStr = () => {
      try {
        const d = new Date()
        const p = function (n) { return String(n).padStart(2, '0') }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
      } catch (e) { return 'latest' }
    }