/**
 * views/SkillsTab.ts — 技能视图（5.6）的 TS 真源（888 落地：列表换成像素风组件）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:skillsTab (spliced by build) ====` 标记处。
 * 列表与详情都交给 views/skillDetail 下的像素风组件画；本文件只做三件事：
 * ①算推荐组（老逻辑一字不动）；②把 SKILLS 转成组件要的 items；③把加载与详情两个动作接上
 * （加载＝老行为 inject，详情＝pixelOpenDetail 取原文）。
 * 2026-10-10 人拍板两处：①不再有「列表／圆环」切换，技能页只列表这一种（圆环那个入口撤了）；
 * ②点开详情后，详情占满页签的中间区域（就是列表原来占的那块），不再是浮在列表上的小窗。
 */
import type { PixelSkillItem } from './pixelProps';
declare function inject(st: any, name: string): void;
declare const SKILLS: any[];
declare function Ic(props?: any): any;
declare const PixelSkillList: (props?: any) => any;
declare const PixelSkillDetailModal: (props?: any) => any;
declare function pixelOpenDetail(st: any, name?: string, item?: any): void;
declare function pixelRetryDetail(st: any): void;
export const SkillsTab = ({ st }: any): any => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // #1201 方案一：技能页不再读地图导航栈，推荐固定为通用建议加 `/ask-matt`。
      //   之前这里从导航栈里找最近的地图，找到就把标题换成该地图的标题。
      //   切页签不会清空导航栈，于是在地图里待过、直接切到技能页，标题会被残留的地图顶掉；
      //   地图正文里没有推荐关键字时推荐还回落到 `/ask-matt`，只剩标题在变，看着像乱跳。
      //   地图的要求本来就写在地图正文的 `## Notes` 里，需要时点开地图就能看到，技能页不再代劳。
      const rec: string[] = ['ask-matt']
      const recTitle = tr('skill.generic')
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
      const detailOpen = !!(d && d.open)
      const loadingName = (d && d.phase === 'loading') ? d.name : null
      // 头行只留推荐组标题：人拍板撤掉「列表／圆环」那对切换，技能页只有列表这一种。
      const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, [
        h('div', { className: 'dsws-grp', style: { margin: 0 } }, [Ic({ n: 'compass', size: 12 }), h('span', null, recTitle)]),
      ])
      // 推荐条也能点开（2026-10-10 人拍板）：详情开着时它就在详情上方，点一下再压一层，看的还是详情。
      const openSkill = function (name: string): void {
        if (typeof pixelOpenDetail === 'function') pixelOpenDetail(st, name, itemOf(name))
      }
      const chips = h('div', { style: { marginBottom: 8 } }, rec.map(function (r, i) {
        // 本次界面反馈需求：推荐药丸能点开技能详情，给它按压态、悬停反馈与自己的点击日志；
        //   定位串用序号（技能名可能带斜杠等字符，定位串只收小写字母数字与点横线下划线）。
        return h('span', {
          key: i,
          className: 'dsws-chip dsws-chip-m pixel-chipref dsws-hov',
          role: 'button',
          tabIndex: 0,
          'data-press': 'chip',
          'data-log': 'skill.chip.' + i,
          onClick: function () { openSkill(r) },
        }, '/' + r)
      }))
      // 详情占满中间区域：列表换成详情本体（不再叠一层遮罩小窗），关闭即回到列表。
      const detail = h(PixelSkillDetailModal, {
        st: st,
        full: true,
        onRetry: function () { if (typeof pixelRetryDetail === 'function') pixelRetryDetail(st) },
        // 正文里的 /技能名 点一下就压一层新的详情（2026-10-10 人拍板）。
        onOpenSkill: openSkill,
        skillNames: items.map(function (it: PixelSkillItem) { return it.name }),
      })
      const list = h(PixelSkillList, {
        items: items,
        onDetail: function (name: string) { if (typeof pixelOpenDetail === 'function') pixelOpenDetail(st, name, itemOf(name)) },
        onLoad: function (name: string) { inject(st, '/' + name) },
        loadingName: loadingName,
      })
      // 整个页签（头行 + 推荐 + 列表或详情）都包在 .pixel-tab 里：原型那一页的底色与像素语言
      // 详情打开时页签自己按父容器可见高定高（面板内容区是定高滚动容器）：底栏才会停在可见底部
      return h('div', { className: 'pixel-tab' + (detailOpen ? ' pixel-tab-detail' : '') }, [head, chips, detailOpen ? detail : list])
    }
