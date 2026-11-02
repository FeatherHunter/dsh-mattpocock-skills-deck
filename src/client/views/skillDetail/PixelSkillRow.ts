/**
 * views/skillDetail/PixelSkillRow.ts — 技能行的 TS 真源（887 TS 化，中组件）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelSkillRow (spliced by build) ====` 标记处。
 * 用法：PixelSkillRow({name, importance, use, recommended, onDetail, onLoad, loading})，纯展示，数据全由外层给。
 * 给了 onLoad 就在详情按钮前面再摆一颗注入按钮（生产页签的老行为）；loading 挂在详情按钮上（取数是异步的那一步），只转圈不换字。
 * importance ∈ 'core' | 'common' | 'rare'（#1837）：档位对应的颜色与空心态在 shared/matt-skills.ts 的
 *   SKILL_IMPORTANCE_STYLES 一处定义，本文件只查表、不写色值——这样行里画的颜色与图例说明的颜色
 *   永远是同一份，改档位只改数据表。行写 --pixel-dc 变量：它给方点的底色，也给整行的悬停外框上色；
 *   方点自己的 2px 描边固定是皮肤边框色 --pixel-frame，空心档就靠这条描边撑住形状，所以备用档的
 *   --pixel-dc 用次要字色，让悬停外框仍看得见。
 * 整行浮起只在悬停与框内聚焦时出现（键盘 Tab 到按钮上整行也亮）。
 */
import type { PixelSkillRowProps, PixelDotProps, PixelBtnProps, MattSkillImportance, PixelImportanceStyle } from '../pixelProps';
declare const PixelDot: (props?: PixelDotProps) => any;
declare const PixelBtn: (props?: PixelBtnProps) => any;
declare const Tip: (props?: any) => any;
// 外观表由 shared/matt-skills.ts 在客户端闭包里提供（构建按 SHARED_SPLICE 拼在同作用域），这里只声明形状。
declare const SKILL_IMPORTANCE_STYLES: Record<MattSkillImportance, PixelImportanceStyle>;
export const PixelSkillRow = function (props?: PixelSkillRowProps): any {
  const p = props || ({} as PixelSkillRowProps)
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  // 查不到档位时按「常用」画：数据表写错一个字也不会让整行失去颜色；数据本身的合法性由
  // tests/verify-1837-skill-importance.ts 钉住，不在渲染里抛错。props 已经限定成三个字面量，
  // 这里的兜底是给运行时数据（来自 shared 的 SKILLS）留的最后一道，不在类型层做静默降级。
  const imp = p.importance || 'common'
  const style = SKILL_IMPORTANCE_STYLES[imp] || SKILL_IMPORTANCE_STYLES.common
  // 技能名清洗成能放进定位串的短标识：名字是标识不是给人读的话，清洗后同一屏两行也不会撞名。
  const nameKey = String(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unnamed'
  const dc = style.hollow ? 'var(--pixel-ink2)' : style.color
  // 两颗按钮装进同一组（.pixel-sbtns）：面板被拖窄时整组一起换到下一行，不把「注入」「详情」拆开，
  // 也不会撑出横向滚动条；460 宽时它们仍在描述右边右对齐（样式见 PixelStyles 的 .pixel-sbtns）。
  const btns: any[] = []
  if (p.onLoad) btns.push(h(PixelBtn, {
    key: 'l',
    // 按压形状写明是 button 档（这两颗带字）；定位名后缀是清洗过的技能名，同屏两行不会撞名。
    'data-press': 'button',
    'data-log': 'sd.skillrow.inject.' + nameKey,
    onClick: function () { if (typeof p.onLoad === 'function') p.onLoad(p.name as string) },
  }, tr('sd.injectChat')))
  btns.push(h(PixelBtn, {
    key: 'b',
    loading: p.loading,
    'data-press': 'button',
    'data-log': 'sd.skillrow.detail.' + nameKey,
    onClick: function () { if (typeof p.onDetail === 'function') p.onDetail(p.name as string) },
  }, tr('sd.detailBtn')))
  return h('div', { className: 'pixel-skillrow' + (p.recommended ? ' rec' : ''), style: { '--pixel-dc': dc } }, [
    h(PixelDot, { key: 'd', color: style.color, hollow: style.hollow }),
    h('div', { key: 'n', className: 'pixel-sname' }, [
      '/' + p.name,
      p.recommended ? h('span', { key: 's', className: 'pixel-star' }, ' ★') : null,
    ]),
    // 副标题超宽会被省略号裁掉，悬停给全文——走 Tip，不用原生 title（T2/T3 纪律）。
    h(Tip, { key: 'u', content: p.use || '' }, h('div', { className: 'pixel-suse' }, p.use)),
    h('span', { key: 'b', className: 'pixel-sbtns' }, btns),
  ])
}
