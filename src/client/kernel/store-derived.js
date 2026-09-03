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
    export const isOccupied = function (st, x) {
      if (x.assignees && x.assignees.length) return true
      const maps = (st.snapshot && st.snapshot.maps) || []
      for (let mi = 0; mi < maps.length; mi++) {
        const m = maps[mi]
        if (!m.tickets || !m.tickets.length) continue
        const byNum = {}
        m.tickets.forEach(function (t) { byNum[t.number] = t })
        const t = byNum[x.number]
        if (t && t.blockedBy && t.blockedBy.length) {
          const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
          if (openBlockers.length) return true
        }
      }
      return false
    }
    export const occCount = (st) => openIssuesOf(st).filter(function (x) { return isOccupied(st, x) }).length
    export const frontierCount = (st) => openIssuesOf(st).length - occCount(st)
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
    // v19：交接文档时间戳文件名（YYYYMMDD-HHMMSS）
    export const timeStampStr = () => {
      try {
        const d = new Date()
        const p = function (n) { return String(n).padStart(2, '0') }
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
      } catch (e) { return 'latest' }
    }