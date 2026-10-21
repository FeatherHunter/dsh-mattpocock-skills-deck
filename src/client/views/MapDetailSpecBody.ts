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
// #1294：段标题不再是本文件写死的中英名，而是 config/copy/spec.yaml 的 spec.section.* 词条。
//   宿主闭包里这些词条由 locale.ts 的 tr/uiText 取；LOCALE_COPY 是生成物 locale-data.ts 的全量词表，
//   这里只在 Node 单测（没有闭包助手）里用不到 —— 声明成可能缺席，用 typeof 守卫。
declare const LOCALE_COPY: Record<string, Record<string, string>> | undefined;

// 七段的定义与别名。键名顺序就是显示顺序（问题陈述在最前，补充说明在最后）。
// 段名必须来自 config/copy/spec.yaml 的 spec.section.*；这里只留「拿什么键去查」与「宿主可能写的别名」，
// 不再抄一份中文/英文段名（抄了就会与词表慢慢走岔）。
const SPEC_SECTIONS: any[] = [
  { key: 'problem', aliases: ['problem', 'problemStatement', '问题陈述', '问题'] },
  { key: 'solution', aliases: ['solution', '解决方案'] },
  { key: 'userStories', aliases: ['userStories', 'userstories', 'user_stories', 'stories', '用户故事'] },
  { key: 'implDecisions', aliases: ['implDecisions', 'implementationDecisions', 'impl-decisions', '实现决策', '实现决定'] },
  { key: 'testDecisions', aliases: ['testDecisions', 'testingDecisions', 'test-decisions', '测试决策', '测试决定'] },
  { key: 'outOfScope', aliases: ['outOfScope', 'out-of-scope', 'notInScope', '不在范围内', '范围外'] },
  { key: 'notes', aliases: ['notes', 'furtherNotes', 'further-notes', '补充说明', '备注'] },
];

export const MapDetailSpecBody = ({ st, m }: any) => {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  // 段标题统一问词表（spec.section.*）：先问宿主取的 tr，取不到再问按语言链取词的 uiText。
  // 两处都没有（单测环境没有闭包取词助手、或词表缺键）就返回空串，由调用方决定怎么显示。
  const titleOf = function (sec: any): string {
    const key = 'spec.section.' + sec.key
    let t = ''
    try { t = tr(key) } catch (e) { t = '' }
    if (t && t !== key) return t
    try {
      if (typeof uiText === 'function') {
        const u = String(uiText(key) || '')
        if (u && u !== key) return u
      }
    } catch (e) {}
    return ''
  }
  // 按「## 标题」切段时，标题可能是宿主写的别名、段键，或词表里的中英段名。
  // 词表那一份按生成的全量词表逐语言比对，不在本文件再写死中文/英文段名。
  const sectionByHeading = function (head: string): any {
    for (let j = 0; j < SPEC_SECTIONS.length; j++) {
      const sec = SPEC_SECTIONS[j]
      if (sec.aliases.indexOf(head) >= 0 || sec.key === head) return sec
    }
    try {
      if (typeof LOCALE_COPY !== 'undefined' && LOCALE_COPY) {
        const langs = Object.keys(LOCALE_COPY)
        for (let j = 0; j < SPEC_SECTIONS.length; j++) {
          const key = 'spec.section.' + SPEC_SECTIONS[j].key
          for (let i = 0; i < langs.length; i++) {
            const dict = LOCALE_COPY[langs[i]]
            if (dict && dict[key] === head) return SPEC_SECTIONS[j]
          }
        }
      }
    } catch (e) {}
    return null
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
      const hit: any = sectionByHeading(head)
      collected.push({ title: hit ? titleOf(hit) : head, text: text, key: hit ? hit.key : '' })
    }
  }
  const items = collected.filter(function (c: any) { return !!c.text })
  if (!items.length) return null
  return h('div', { style: { margin: '2px 0 4px' } }, items.map(function (c: any, i: number) {
    return h('details', { key: i, style: { margin: '2px 0 4px' } }, [
      // 本次界面反馈需求：规格地图页的折叠标题也要能点，口径与探索地图页的折叠条一致（悬停、按下、点击日志三样齐全）。
      //   定位串用段键（小写）或序号，段标题不进定位串（自由文本不进定位串）。
      h('summary', { className: 'dsws-hov', 'data-press': 'button', 'data-log': 'map.spec.section.' + (c.key ? String(c.key).toLowerCase() : String(i)), style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
        Ic({ n: 'note', size: 11 }),
        h('span', null, c.title),
      ]),
      h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } },
        (typeof mdToHtml === 'function') ? mdToHtml(c.text, { st: st }) : c.text),
    ])
  }))
}
