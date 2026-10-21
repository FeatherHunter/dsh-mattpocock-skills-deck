/**
 * src/host/mapBody.ts —— 地图正文解析（来源：src/host/mapBody.js，issue #1247 转写，本次只加类型标注与注释，逻辑一行未动）。
 *
 * 为什么要有它（一句话）：正文预处理、五区块解析与票行映射；纯函数。
 *
 * 约定（改之前先看原 mapBody.js 头注释与调用点 index.ts）：
 * 1. 行为零变化：逻辑逐行对应，只加类型标注与中文注释，不改任何运行时语义；相对导入保留 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。
 * 2. 只写可剥离 TypeScript：不新增运行时语法（禁用 enum 与构造函数参数属性），类型一律 import type 或内联标注，转译后与原 .js 逐行同义。
 * 3. 依赖只留一条（#1090 起）：进度解析统一走 src/tracker/body-parse.ts，本文件不再留内联副本；
 *    其余仍不引用别的文件，也不装 @types/node（Node 内建模块的类型缺席由文件内局部声明与 @ts-expect-error 承接）。
 */

import { parseProgress } from '../tracker/body-parse.js'

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

// src/host/mapBody.js —— 地图正文解析（H2 #446 从 host/index.js 98–189 搬出，纯结构、行为零变化）。
// 以后谁改它：改地图正文五区块结构或票字段映射的人。预估约 120 行，超 350 打回。
// 接线：由 index.js 动态 import 加载；纯函数。进度解析自 #1090 起引用 tracker 叶子，不再内联第三份。
export function createMapBody(): any {
    // ============ 数据流 ============
    // T16：正文预处理 —— 剥 BOM + 字面 \n 还原为真实换行（历史坏格式 body 也能解析）
    //   触发条件：真实换行极少而字面 \n 大量存在（整篇被压成一行）；避免误伤正常正文
    function normalizeBody(raw?: any) {
      let s = String(raw || '').replace(/^\uFEFF/, '')
      const realNL = (s.match(/\n/g) || []).length
      const literalNL = (s.match(/\\n/g) || []).length
      if (realNL < 2 && literalNL > 0) {
        s = s.replace(/\\n/g, '\n')
      }
      return s
    }
    function parseMapBody(body?: any) {
      // #1184：粘在行中的规范标题不再静默丢掉整节；决策行收第二种写法 `- **…**：…`。
      // 与 src/tracker/body-parse.ts 的 splitGluedHeadings / parseDecisionLine 同一套，
      // 写成内层函数是因为门禁按函数名抽取 parseMapBody 文本求值（tests/verify-parse-leaf.js），
      // 抽出去的兄弟函数在求值作用域里不存在。本文件是宿主侧内联副本，真源在叶子那一份，
      // 改这里必须两边一起改（输出差分由那道门禁钉住）。
      var MAP_SECTION_TITLES = ['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope']
      function splitGluedHeadings(text?: any) {
        var splitLines = String(text || '').split(/\r?\n/)
        var splitOut: any[] = []
        var fence: any = null
        var titles = MAP_SECTION_TITLES.map(function(t?: any) { return t.replace(/ /g, '\\s+') }).join('|')
        var gluedRe = new RegExp('^(.*\\S)\\s*##\\s*(' + titles + ')\\s*$')
        for (var i = 0; i < splitLines.length; i++) {
          var line = splitLines[i]
          var fm = line.match(/^\s*(`{3,}|~{3,})/)
          if (fm) {
            var marker = fm[1][0]
            if (fence === null) fence = marker
            else if (marker === fence) fence = null
            splitOut.push(line)
            continue
          }
          if (fence !== null) { splitOut.push(line); continue }
          var m = line.match(gluedRe)
          if (m) { splitOut.push(m[1]); splitOut.push('## ' + m[2].replace(/\s+/g, ' ').trim()); continue }
          splitOut.push(line)
        }
        return splitOut.join('\n')
      }
      function truncateGist(gist?: any) {
        // 与叶子 truncateGist 同一套：240 字不断词截断，省略号粘在最后一个完整词后。
        var LIMIT = 240
        var s = String(gist || '')
        if (s.length <= LIMIT) return s
        var head = s.slice(0, LIMIT)
        var lastBlank = head.search(/\s+\S*$/)
        var kept = (lastBlank > 0 ? head.slice(0, lastBlank) : head).replace(/\s+$/, '')
        return (kept === '' ? head : kept) + '…'
      }
      function parseDecisionLine(l?: any) {
        if (l.indexOf('- [') === 0) {
          var t = l.match(/\[(.+?)\]\((.+?)\)/)
          var g = l.replace(/^-\s*\[.+?\]\(.+?\)\s*[-–—]?\s*/, '')
          return { title: t ? t[1] : l, url: t ? t[2] : '', gist: truncateGist(g) }
        }
        var b = l.match(/^-\s*\*\*(.+?)\*\*\s*[:：-]?\s*(.*)$/)
        if (b) {
          var inner = b[1]
          var bt = inner.match(/\[(.+?)\]\((.+?)\)/)
          var title = bt ? inner.replace('[' + bt[1] + '](' + bt[2] + ')', bt[1]) : inner
          return { title: title, url: bt ? bt[2] : '', gist: truncateGist(b[2]) }
        }
        return null
      }
      const out = { destination: '', notes: '', decisions: [], fog: [], outOfScope: [] }
      if (!body) return out
      const sec: any = {}
      const lines = splitGluedHeadings(normalizeBody(body)).split(/\r?\n/)
      let cur: any = null
      for (let i = 0; i < lines.length; i++) {
        // #1184：`##` 后无空格也认（`##Notes`），与叶子、写回守门同一口径。
        const m = lines[i].match(/^##\s*(.+?)\s*$/)
        if (m) { cur = m[1]; sec[cur] = sec[cur] || []; continue }
        if (cur) sec[cur].push(lines[i])
      }
      const clean = function(arr?: any) { return (arr || []).map(function(s?: any) { return s.trim() }).filter(Boolean) }
      out.destination = clean(sec['Destination']).join(' ')
      out.notes = clean(sec['Notes']).join(' ')
      out.decisions = clean(sec['Decisions so far']).map(parseDecisionLine).filter(function(d?: any) { return d !== null })
      out.fog = clean(sec['Not yet specified']).filter(function(l?: any) { return l.indexOf('<!--') !== 0 })
      out.outOfScope = clean(sec['Out of scope']).filter(function(l?: any) { return l.indexOf('<!--') !== 0 })
      return out
    }

    // 进度解析：自 #1090 起统一走 src/tracker/body-parse.ts 的 parseProgress（文件顶部 import），
    // 本文件不再保留内联副本。口径（顶层 `## 进度` 区、老票两种兼容写法、删全文兜底）见那个叶子。

    function mapTicket(raw?: any) {
      const labels = ((raw.labels && raw.labels.nodes) || []).map(function(x?: any) { return x.name })
      let type = 'other'
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].indexOf('wayfinder:') === 0) { type = labels[i].slice('wayfinder:'.length) || 'other'; break }
      }
      const as = (raw.assignees && raw.assignees.nodes) || []
      return {
        number: raw.number, title: raw.title, type: type,
        state: raw.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
        claimedBy: as.length ? as[0].login : '',
        blockedBy: ((raw.blockedBy && raw.blockedBy.nodes) || []).map(function(b?: any) { return b.number }),
        blocks: ((raw.blocking && raw.blocking.nodes) || []).map(function(b?: any) { return b.number }),
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
