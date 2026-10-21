/**
 * views/skillDetail/PixelSkillRow.ts — 技能行的 TS 真源（887 TS 化，中组件）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的 `// ==== leaf:pixelSkillRow (spliced by build) ====` 标记处。
 * 用法：PixelSkillRow({name, level, use, recommended, onDetail, onLoad, loading})，纯展示，数据全由外层给。
 * 给了 onLoad 就在详情按钮前面再摆一颗加载按钮（生产页签的老行为）；loading 挂在详情按钮上（取数是异步的那一步），只转圈不换字。
 * level ∈ 'ok' | 'warn' | 'bad'；行写 --px-dc 变量，方点与悬停描边同色；
 * 整行浮起只在悬停与框内聚焦时出现（键盘 Tab 到按钮上整行也亮）。
 */
import type { PixelSkillRowProps, PixelDotProps, PixelBtnProps } from '../pixelProps';
declare const PixelDot: (props?: PixelDotProps) => any;
declare const PixelBtn: (props?: PixelBtnProps) => any;
declare const Tip: (props?: any) => any;
export const PixelSkillRow = function (props?: PixelSkillRowProps): any {
  const p = props || ({} as PixelSkillRowProps)
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const level = p.level === 'warn' ? 'warn' : p.level === 'bad' ? 'bad' : 'ok'
  // 技能名清洗成能放进定位串的短标识：名字是标识不是给人读的话，清洗后同一屏两行也不会撞名。
  const nameKey = String(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unnamed'
  const dc = level === 'bad' ? '#a3231a' : level === 'warn' ? '#f59e0b' : '#0e8a16'
  return h('div', { className: 'pixel-skillrow' + (p.recommended ? ' rec' : ''), style: { '--pixel-dc': dc } }, [
    h(PixelDot, { key: 'd', level: level }),
    h('div', { key: 'n', className: 'pixel-sname' }, [
      '/' + p.name,
      p.recommended ? h('span', { key: 's', className: 'pixel-star' }, ' ★') : null,
    ]),
    // 副标题超宽会被省略号裁掉，悬停给全文——走 Tip，不用原生 title（T2/T3 纪律）。
    h(Tip, { key: 'u', content: p.use || '' }, h('div', { className: 'pixel-suse' }, p.use)),
    p.onLoad ? h(PixelBtn, {
      key: 'l',
      // 按压形状写明是 button 档（这两颗带字）；定位名后缀是清洗过的技能名，同屏两行不会撞名。
      'data-press': 'button',
      'data-log': 'sd.skillrow.load.' + nameKey,
      onClick: function () { if (typeof p.onLoad === 'function') p.onLoad(p.name as string) },
    }, tr('act.load')) : null,
    h(PixelBtn, {
      key: 'b',
      loading: p.loading,
      'data-press': 'button',
      'data-log': 'sd.skillrow.detail.' + nameKey,
      onClick: function () { if (typeof p.onDetail === 'function') p.onDetail(p.name as string) },
    }, tr('sd.detailBtn')),
  ])
}
