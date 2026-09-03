// src/host/mapBody.js —— 地图正文解析（H2 #446 从 host/index.js 98–189 搬出，纯结构、行为零变化）。
// 以后谁改它：改地图正文五区块结构或票字段映射的人。预估约 120 行，超 350 打回。
// 接线：由 index.js 动态 import 加载；纯函数、零外部依赖；本文件不引用其他新文件。
export function createMapBody() {
    // ============ 数据流 ============
    // T16：正文预处理 —— 剥 BOM + 字面 \n 还原为真实换行（历史坏格式 body 也能解析）
    //   触发条件：真实换行极少而字面 \n 大量存在（整篇被压成一行）；避免误伤正常正文
    function normalizeBody(raw) {
      let s = String(raw || '').replace(/^\uFEFF/, '')
      const realNL = (s.match(/\n/g) || []).length
      const literalNL = (s.match(/\\n/g) || []).length
      if (realNL < 2 && literalNL > 0) {
        s = s.replace(/\\n/g, '\n')
      }
      return s
    }
    function parseMapBody(body) {
      const out = { destination: '', notes: '', decisions: [], fog: [], outOfScope: [] }
      if (!body) return out
      const sec = {}
      const lines = normalizeBody(body).split(/\r?\n/)
      let cur = null
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^##\s+(.+?)\s*$/)
        if (m) { cur = m[1]; sec[cur] = sec[cur] || []; continue }
        if (cur) sec[cur].push(lines[i])
      }
      const clean = function (arr) { return (arr || []).map(function (s) { return s.trim() }).filter(Boolean) }
      out.destination = clean(sec['Destination']).join(' ')
      out.notes = clean(sec['Notes']).join(' ')
      out.decisions = clean(sec['Decisions so far']).filter(function (l) { return l.indexOf('- [') === 0 }).map(function (l) {
        const t = l.match(/\[(.+?)\]\((.+?)\)/)
        const g = l.replace(/^-\s*\[.+?\]\(.+?\)\s*[-–—]?\s*/, '')
        return { title: t ? t[1] : l, url: t ? t[2] : '', gist: g }
      })
      out.fog = clean(sec['Not yet specified']).filter(function (l) { return l.indexOf('<!--') !== 0 })
      out.outOfScope = clean(sec['Out of scope']).filter(function (l) { return l.indexOf('<!--') !== 0 })
      return out
    }

    // v1.5 T12 修订（B4）：进度块解析三级锚定 —— 进度区 = 契约固定章节「## 进度：N%」，先锚定标题行，防正文示例/规则文本劫持（#459/#460 实证）
    //   1) 标题行：## 进度：90%（行首 markdown 标题 · 进度区正形）
    //   2) 行首变体：进度：90% / Progress: 90%（无标题符号 · 兑现注释承诺）
    //   3) 全文兜底：任意出现（兼容老票随手格式 · 放最后不劫持前两层）
    function parseProgress(body) {
      if (!body) return null
      const s = String(body)
      const m = s.match(/^\s*#{1,6}\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
        || s.match(/^\s*(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/im)
        || s.match(/(?:进度|Progress)\s*[：:]\s*(\d{1,3})\s*%/i)
      if (!m) return null
      const n = parseInt(m[1], 10)
      if (isNaN(n)) return null
      return Math.max(0, Math.min(100, n))
    }

    function mapTicket(raw) {
      const labels = ((raw.labels && raw.labels.nodes) || []).map(function (x) { return x.name })
      let type = 'other'
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].indexOf('wayfinder:') === 0) { type = labels[i].slice('wayfinder:'.length) || 'other'; break }
      }
      const as = (raw.assignees && raw.assignees.nodes) || []
      return {
        number: raw.number, title: raw.title, type: type,
        state: raw.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
        claimedBy: as.length ? as[0].login : '',
        blockedBy: ((raw.blockedBy && raw.blockedBy.nodes) || []).map(function (b) { return b.number }),
        blocks: ((raw.blocking && raw.blocking.nodes) || []).map(function (b) { return b.number }),
        labels: labels, url: raw.url,
        progress: parseProgress(raw.body),  // v1.5 T12：issue 正文进度块（## 进度：N%），null = 未表达
        author: (raw.author && raw.author.login) ? { login: raw.author.login, name: (raw.author.name || ''), avatarUrl: (raw.author.avatarUrl || raw.author.avatar_url || '') } : (raw.user && raw.user.login ? { login: raw.user.login, avatarUrl: raw.user.avatar_url || '' } : undefined),
      }
    }

    // v1.4（T1 #442）：blockedBy DAG 最长路径深度分层
    //   level(root) = 0（无依赖）；level(x) = 1 + max(level(所有直接阻塞者))
    //   同层 = 无依赖互斥 → 可并行；层间 = 必须串行（上层全 closed 才解锁）
    //   返回 { byNumber: {n: level}, levels: [{level, open, closed, total, frontier, claimed, blocked, numbers:[]}] }
  return { normalizeBody, parseMapBody, parseProgress, mapTicket }
}
