/**
 * views/SkillsTab.ts — 技能视图（5.6）的 TS 真源（888 落地：列表换成像素风组件）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的 `// ==== leaf:skillsTab (spliced by build) ====` 标记处。
 * 列表与详情都交给 views/skillDetail 下的像素风组件画；本文件只做三件事：
 * ①算推荐组（老逻辑一字不动）；②把 SKILLS 转成组件要的 items；③把加载与详情两个动作接上
 * （加载＝老行为 inject，详情＝pixelOpenDetail 取原文）。详情弹窗就地盖在本页签上（父容器 relative）。
 */
import type { PixelSkillItem } from './pixelProps';
declare function inject(st: any, name: string): void;
declare function compute(st: any): any;
declare function findGroupByIdentity(groups: any, n: number, effort: string): any;
declare const SKILLS: any[];
declare function Ic(props?: any): any;
declare const RingSkills: (props?: any) => any;
declare const PixelSkillList: (props?: any) => any;
declare const PixelSkillDetailModal: (props?: any) => any;
declare function pixelOpenDetail(st: any, name?: string, item?: any): void;
declare function pixelRetryDetail(st: any): void;
export const SkillsTab = ({ st }: any): any => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const groups = compute(st)
      let rec: string[] = []
      let recTitle = tr('skill.generic')
      // T4 #554：推荐源取最近的地图祖先（从栈顶往下找第一个地图层）。栈顶是地图时就是它自己，
      // 与原来读当前地图一致；栈顶是工单（从地图下钻进来）时取把它带进来的那张地图；
      // 栈里没有地图（纯工单栈或空栈）则置空，回通用推荐。先后经过同一编号不合并，找最近的即可。
      const recMapNum = (function () {
        try {
          if (st && Array.isArray(st.navStack)) {
            for (let i = st.navStack.length - 1; i >= 0; i--) {
              const e = st.navStack[i]
              if (e && e.kind === 'map' && typeof e.n === 'number' && !isNaN(e.n)) return e.n
            }
            return null
          }
        } catch (e) { /* 读不到就回通用推荐 */ }
        if (st && st.activeMap !== null && st.activeMap !== undefined) {
          const v = Number(st.activeMap)
          if (!isNaN(v)) return v
        }
        return null
      })()
      if (recMapNum !== null) {
        const g = findGroupByIdentity(groups, recMapNum, st.activeEffortId || '')
        if (g && /research/.test(g.m.notes)) rec = ['research']
        if (g && /grill/.test(g.m.notes)) rec = ['grilling', 'domain-modeling']
        if (g) recTitle = tr('skill.notes', { m: g.m.title })
      }
      if (!rec.length) rec = ['ask-matt']
      // 组件要的 items：描述走词条（跟随 DSH 语言），推荐行带 recommended 标记（老逻辑：紫色高亮那几行）。
      const items: PixelSkillItem[] = SKILLS.map(function (sk: any) {
        return {
          name: sk.name,
          level: sk.level,
          use: tr('skilldesc.' + sk.name),
          recommended: rec.indexOf(sk.name) >= 0,
        }
      })
      const itemOf = function (name: string): PixelSkillItem | null {
        for (let i = 0; i < items.length; i++) if (items[i].name === name) return items[i]
        return null
      }
      const d = st && st.pixelDetail ? st.pixelDetail : null
      const loadingName = (d && d.phase === 'loading') ? d.name : null
      const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, [
        h('div', { className: 'dsws-grp', style: { margin: 0 } }, [Ic({ n: 'compass', size: 12 }), h('span', null, recTitle)]),
        h('span', { style: { flex: 1 } }),
        h('span', { className: 'dsws-seg' + (st.skillView === 'list' ? ' on' : ''), onClick: function () { st.skillView = 'list'; emit(st) }, style: { fontSize: 11 } }, tr('skill.list')),
        h('span', { className: 'dsws-seg' + (st.skillView === 'ring' ? ' on' : ''), onClick: function () { st.skillView = 'ring'; emit(st) }, style: { fontSize: 11 } }, tr('skill.ring')),
      ])
      const detail = h(PixelSkillDetailModal, {
        st: st,
        onRetry: function () { if (typeof pixelRetryDetail === 'function') pixelRetryDetail(st) },
      })
      // 整个页签（头行 + 推荐 + 列表/圆环 + 详情）都包在 .pixel-tab 里：原型那一页的底色与像素语言
      if (st.skillView === 'ring') {
        return h('div', { className: 'pixel-tab' }, [head, h(RingSkills, { st: st, rec: rec, list: SKILLS }), detail])
      }
      return h('div', { className: 'pixel-tab' }, [
        head,
        h('div', { style: { marginBottom: 8 } }, rec.map(function (r, i) {
          return h('span', { key: i, className: 'dsws-chip dsws-chip-m' }, '/' + r)
        })),
        h(PixelSkillList, {
          items: items,
          onDetail: function (name: string) { if (typeof pixelOpenDetail === 'function') pixelOpenDetail(st, name, itemOf(name)) },
          onLoad: function (name: string) { inject(st, '/' + name) },
          loadingName: loadingName,
        }),
        detail,
      ])
    }
