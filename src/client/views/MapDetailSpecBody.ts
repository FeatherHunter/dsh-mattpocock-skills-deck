/**
 * views/MapDetailSpecBody.ts —— 规格（实施地图）详情页的正文内容段（#1286）
 *
 * 规格的正文形状与探索地图不一样：探索地图是 Destination + Notes 两段，规格是七段
 *   （问题陈述 / 解决方案 / 用户故事 / 实现决策 / 测试决策 / 不在范围内 / 补充说明），
 *   中英各一套（package/bundled-skills/to-spec/SKILL.md 规定了这份形状）。
 *   两类容器共用同一套详情页骨架，差别就在这一段。
 *
 * 为什么单独一份文件：MapDetail.ts 贴着仓库 350 有效行的上限，再往里塞七段渲染就超了
 *   （与 #807 拆 MapDetailTop、#691 拆 MapDetailHead 同一理由）。
 *
 * 数据从哪来（宿主怎么把这些段装进容器对象归 #1274/#1275，本文件只消费结果）：
 * 1) 容器对象上的 sections：数组 [{ title/name/label, body/text/content/markdown }]，
 *    或对象 { problem, solution, userStories, implDecisions, testDecisions, outOfScope, notes }
 *    （键名认中英与常见别名）。
 * 2) 容器对象上的 body：一整篇 markdown，按「## 标题」切段（切法与 src/host/mapBody.ts 一致）。
 * 3) 都没有就渲染空 —— 不编内容。空段一律不显示。
 */
declare function mdToHtml(...args: any[]): any;
declare function Ic(...args: any[]): any;

// 七段的定义与别名。键名顺序就是显示顺序（问题陈述在最前，补充说明在最后）。
const SPEC_SECTIONS: any[] = [
  { key: 'problem', zh: '问题陈述', en: 'Problem Statement', aliases: ['problem', 'problemStatement', '问题陈述', '问题'] },
  { key: 'solution', zh: '解决方案', en: 'Solution', aliases: ['solution', '解决方案'] },
  { key: 'userStories', zh: '用户故事', en: 'User Stories', aliases: ['userStories', 'userstories', 'user_stories', 'stories', '用户故事'] },
  { key: 'implDecisions', zh: '实现决策', en: 'Implementation Decisions', aliases: ['implDecisions', 'implementationDecisions', 'impl-decisions', '实现决策', '实现决定'] },
  { key: 'testDecisions', zh: '测试决策', en: 'Testing Decisions', aliases: ['testDecisions', 'testingDecisions', 'test-decisions', '测试决策', '测试决定'] },
  { key: 'outOfScope', zh: '不在范围内', en: 'Out of Scope', aliases: ['outOfScope', 'out-of-scope', 'notInScope', '不在范围内', '范围外'] },
  { key: 'notes', zh: '补充说明', en: 'Further Notes', aliases: ['notes', 'furtherNotes', 'further-notes', '补充说明', '备注'] },
];

export const MapDetailSpecBody = ({ st, m }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const lang = (typeof promptLang === 'function' && promptLang() === 'en') ? 'en' : 'zh'
  // 段标题：先问词表（spec.section.*），词表里没有就退回这里写死的中英名。
  const titleOf = function (sec: any): string {
    const key = 'spec.section.' + sec.key
    let t = ''
    try { t = tr(key) } catch (e) { t = '' }
    if (!t || t === key) return lang === 'en' ? sec.en : sec.zh
    return t
  }
  // 段内容统一收成一段文字。
  const bodyToText = function (v: any): string {
    if (v == null) return ''
    if (typeof v === 'string') return v.trim()
    if (Array.isArray(v)) return v.map(function (x: any) { return bodyToText(x) }).filter(function (x: string) { return !!x }).join('\n\n')
    if (typeof v === 'object') {
      const t = v.body != null ? v.body : (v.text != null ? v.text : (v.content != null ? v.content : (v.markdown != null ? v.markdown : '')))
      return bodyToText(t)
    }
    return String(v).trim()
  }
  const ownTitle = function (v: any): string {
    if (!v || typeof v !== 'object') return ''
    const t = v.title != null ? v.title : (v.name != null ? v.name : (v.label != null ? v.label : (v.heading != null ? v.heading : '')))
    return String(t || '').trim()
  }
  const collected: any[] = []
  const src: any = (m && (m.sections || m.specSections || (m.spec && m.spec.sections))) || null
  if (Array.isArray(src)) {
    src.forEach(function (item: any, i: number) {
      const sec = SPEC_SECTIONS[i] || null
      const title = ownTitle(item) || (sec ? titleOf(sec) : '')
      collected.push({ title: title, text: bodyToText(item), key: sec ? sec.key : '' })
    })
  } else if (src && typeof src === 'object') {
    const used: any = {}
    SPEC_SECTIONS.forEach(function (sec: any) {
      let val: any = null
      let found = false
      sec.aliases.forEach(function (a: string) {
        if (found) return
        if (src[a] != null) { val = src[a]; found = true; used[a] = true }
      })
      if (found) collected.push({ title: titleOf(sec), text: bodyToText(val), key: sec.key })
    })
    // 没被认领的键也画出来：宿主若换了键名，至少不让内容白丢。
    Object.keys(src).forEach(function (k: string) {
      if (used[k]) return
      const text = bodyToText(src[k])
      if (!text) return
      collected.push({ title: ownTitle(src[k]) || k, text: text, key: '' })
    })
  } else if (m && typeof m.body === 'string' && m.body) {
    // 按「## 标题」切段（切法与 src/host/mapBody.ts 一致：split 出来是 [前文, 标题, 内容, 标题, 内容…]）
    const parts = m.body.split(/^##\s*(.+?)\s*$/m)
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const head = String(parts[i] || '').trim()
      const text = String(parts[i + 1] || '').trim()
      if (!text) continue
      let hit: any = null
      for (let j = 0; j < SPEC_SECTIONS.length; j++) {
        const sec = SPEC_SECTIONS[j]
        if (sec.aliases.indexOf(head) >= 0 || sec.zh === head || sec.en === head || sec.key === head) { hit = sec; break }
      }
      collected.push({ title: hit ? titleOf(hit) : head, text: text, key: hit ? hit.key : '' })
    }
  }
  const items = collected.filter(function (c: any) { return !!c.text })
  if (!items.length) return null
  return h('div', { style: { margin: '2px 0 4px' } }, items.map(function (c: any, i: number) {
    return h('details', { key: i, style: { margin: '2px 0 4px' } }, [
      h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
        Ic({ n: 'note', size: 11 }),
        h('span', null, c.title),
      ]),
      h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } },
        (typeof mdToHtml === 'function') ? mdToHtml(c.text, { st: st }) : c.text),
    ])
  }))
}
