// views/ListTabRow.ts — 主列表单行渲染（从 ListTab.js 拆出，V3 #463，纯结构、行为零变化）
// 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
// src/client/index.ts 的 leaf 标记处（源码树里只有这一份真源，标记 id 与本文件名一致）。
// 以后谁改它：改行两行结构、行动作按钮组、迷你圆环进度、阻塞徽标的人改它。
// 接线：行组装三处（open/closed/折叠）调 listIssueRow；表级派生（blockOf/colorOf）由调用方当参数传，
//   本文件不引用 ListTab.ts（同闭包拼回，调用方向见 ListTab.js 行组装三处）。
// 参数：h = 行内创建函数；st = 列表 store；x = 本行票据；blockOf/colorOf = 表级派生。

// 本文件由同名 .js 转写为 TypeScript（#1253「界面视图层整批转 TypeScript」）：只加类型标注与中文注释，
//   逻辑、分支条件、字符串、数字、对象键与次序、函数名与导出名一字未改，行为零变化。
// 两条不能再改的约定：①模块说明符仍写 .js（scripts/ts-hook.mts 会把 .js 改指同目录同名 .ts）；
//   ②写法限「可剥离的 TypeScript」——不用 enum、不用构造函数参数属性，因为测试链路上 Node 只删类型、不做语法转换。
// 下面这些名字本文件里没有 import、也不是本文件定义的：它们由构建按 scripts/build.mts 的次序，
//   把各叶子拼进同一个函数作用域后提供（真机上有值）。类型检查时本文件是独立看的，所以这里只声明形状、
//   不参与转译：declare 是纯类型语法，esbuild 转译时会整句删掉，产物里不留痕。
declare function Ic(...args: any[]): any;
declare function actionColorOf(...args: any[]): any;
declare function authorColor(...args: any[]): any;
declare function chipKeyDown(...args: any[]): any;
declare function chipProps(...args: any[]): any;
// #1286：容器（探索地图 / 规格）的身份色、三态、提示语一律取自内核 container-view.ts，本文件不再各写一份。
declare function containerKindOf(...args: any[]): any;
declare function containerNumberColor(...args: any[]): any;
declare function containerPromptText(...args: any[]): any;
declare function containerStateOf(...args: any[]): any;
declare function containerTitleKey(...args: any[]): any;
declare function containerTriState(...args: any[]): any;
declare function completePrompt(...args: any[]): any;
declare function copyText(...args: any[]): any;
declare function darken(...args: any[]): any;
declare function effortOf(...args: any[]): any;
declare function findMapByIdentity(...args: any[]): any;
declare function hexA(...args: any[]): any;
declare function idOf(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function inspectPrompt(...args: any[]): any;
declare function isLightHex(...args: any[]): any;
declare function mkRowAction(...args: any[]): any;
declare function openInNewSession(...args: any[]): any;
declare function promptTextFor(...args: any[]): any;
declare function renderTemplate(...args: any[]): any;
declare function setActiveIssue(...args: any[]): any;
declare function setActiveMap(...args: any[]): any;
declare function showPop(...args: any[]): any;
declare function truthWriteWindowOpen(...args: any[]): any;
declare const COPY_FLASH_MS: any;
declare const CONTAINER_ACCENT: any;
declare const CONTAINER_CHIP_CLASS: any;
declare const CONTAINER_CHIP_LABEL_KEY: any;
declare const CONTAINER_CHIP_MARKER_CLASS: any;
// #1343：容器三态里的两枚固定色（空态橙、完成态绿）同样只从中央色表取，本文件不再写同值兜底。
//   空串只可能出现在门禁单独求值、中央色表没被拼进闭包的时候；真机里它一定在，别拿空串当同值兜底用。
declare const CONTAINER_DONE_COLOR: any;
declare const CONTAINER_EMPTY_COLOR: any;
declare const CONTAINER_TINT: any;
declare const Tip: any;
declare const issueUrlFor: any;

// #1302：列表加载时的行形占位。这个文件定义「一票一行长什么样」，所以行形状的真源也放在这里：
// 真实行与加载占位都从 LIST_ROW_SHAPE 取尺寸，改一处两边一起变；不会出现「真实行改了间距、
// 骨架还照旧」那种用户首屏先看到错形状、加载完才突然变样的事。
// 只放真实行也确实在用的数（行1/行2 的间距与上边距、迷你圆环的边长），外加占位块自己的实测尺寸
//（编号块、标题条、标签块、按钮块）。内边距、圆角、底色这类纯样式走 CSS 类名，与真实行共用，不在这里重复。
export const LIST_ROW_SHAPE = {
  // 行1：编号列（竖排，上）+ 标题（占满）+ 迷你圆环（右上），三块横排
  line1: { gap: 8 },
  // 行2：标签行（左，占满）+ 按钮组（右，贴边），两块横排
  line2: { marginTop: 2, gap: 6 },
  // 迷你圆环：真实行是 18×18 的 svg；占位画同样大的圆，右边留一条进度文字位
  ring: { size: 18, text: { width: 35, height: 12 } },
  // 编号列里的两种块：编号块对应 .dsws-idnum（11px 字两行高的药丸），角标块对应容器徽章
  idcol: { idnum: { width: 49, height: 21 }, badge: { width: 52, height: 19 } },
  // 标题条高度照单行标题的行高（13px 字 × 1.6）
  title: { height: 21 },
  // 行2 的两块：标签 chip 与行尾按钮
  tag: { width: 44, height: 19, count: 3 },
  button: { width: 64, height: 21, count: 2 },
  // 一次画几行；前几行按容器行画（列表排序把探索地图、规格排在普通票前面，编号列多一枚角标）
  list: { count: 8, containerRows: 2 },
}

// #1302：列表加载态的行形占位，遮罩里画的就是它。
// 画法与真实行共用一套 CSS 类：外层框 .dsws-aggrow、编号列 .dsws-idcol、标签行 .dsws-tags、
// 圆环组 .dsws-ring，所以内边距、行距、圆角与真实行天然一致；各块尺寸与间距从 LIST_ROW_SHAPE 取。
// 门禁 tests/verify-1302-panel-list-skeleton.ts 按下面三条约定比对（改这里要一起看那扇门禁）：
//   ① 每行带 data-dsws-row-skeleton="1"，行内五个部件带 data-dsws-row-part（idcol/title/ring/tags/buttons）；
//   ② 占位行 style 只加 pointerEvents:'none'：不接鼠标、不触发悬停高亮，点击落到底下的遮罩；
//   ③ 小条一律 class dsws-fb-skel，微光由 feedback-styles.ts 提供，时长不在本文件改。
export const listSkeletonNode = function (h: any, count: any) {
  const n: number = count == null ? LIST_ROW_SHAPE.list.count : count
  const rows: any[] = []
  // 每条小条带 data-dsws-skel-block：门禁按这个数「一行里该有哪几块」，不看宽度猜。
  const bar = function (style: any, block: any) { return h('div', { className: 'dsws-fb-skel', 'data-dsws-skel-block': block, style: style }) }
  for (let i = 0; i < n; i++) {
    const idcol: any[] = []
    if (i < LIST_ROW_SHAPE.list.containerRows) {
      idcol.push(bar({ width: LIST_ROW_SHAPE.idcol.badge.width, height: LIST_ROW_SHAPE.idcol.badge.height, borderRadius: 10, flex: 'none' }, 'badge'))
    }
    idcol.push(bar({ width: LIST_ROW_SHAPE.idcol.idnum.width, height: LIST_ROW_SHAPE.idcol.idnum.height, borderRadius: 6, flex: 'none' }, 'idnum'))
    const tagBars: any[] = []
    for (let t = 0; t < LIST_ROW_SHAPE.tag.count; t++) tagBars.push(bar({ width: LIST_ROW_SHAPE.tag.width, height: LIST_ROW_SHAPE.tag.height, borderRadius: 10, flex: 'none' }, 'tag'))
    const buttonBars: any[] = []
    for (let b = 0; b < LIST_ROW_SHAPE.button.count; b++) buttonBars.push(bar({ width: LIST_ROW_SHAPE.button.width, height: LIST_ROW_SHAPE.button.height, borderRadius: 6, flex: 'none' }, 'button'))
    rows.push(h('div', {
      key: i,
      className: 'dsws-aggrow dsws-row-skel',
      'data-dsws-row-skeleton': '1',
      'aria-hidden': 'true',
      style: { pointerEvents: 'none' },
    }, [
      // 行1：编号列 + 标题条 + 圆环位（横排间距与真实行同一份值）
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: LIST_ROW_SHAPE.line1.gap, width: '100%' } }, [
        h('span', { className: 'dsws-idcol', 'data-dsws-row-part': 'idcol' }, idcol),
        h('div', { className: 'dsws-fb-skel', 'data-dsws-row-part': 'title', 'data-dsws-skel-block': 'title', style: { flex: 1, minWidth: 0, height: LIST_ROW_SHAPE.title.height, borderRadius: 4 } }),
        h('span', { className: 'dsws-ring', 'data-dsws-row-part': 'ring' }, [
          bar({ width: LIST_ROW_SHAPE.ring.size, height: LIST_ROW_SHAPE.ring.size, borderRadius: '50%', flex: 'none' }, 'ring'),
          bar({ width: LIST_ROW_SHAPE.ring.text.width, height: LIST_ROW_SHAPE.ring.text.height, borderRadius: 4, flex: 'none' }, 'ring-text'),
        ]),
      ]),
      // 行2：标签块 + 行尾按钮块（上边距与横排间距与真实行同一份值）
      h('div', { style: { marginTop: LIST_ROW_SHAPE.line2.marginTop, display: 'flex', alignItems: 'center', gap: LIST_ROW_SHAPE.line2.gap, width: '100%' } }, [
        h('div', { className: 'dsws-tags', 'data-dsws-row-part': 'tags' }, tagBars),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', marginLeft: 'auto' }, 'data-dsws-row-part': 'buttons' }, buttonBars),
      ]),
    ]))
  }
  return h('div', { className: 'dsws-list-skel', 'data-dsws-list-skeleton': '1', 'aria-hidden': 'true', style: { display: 'flex', flexDirection: 'column', gap: 0, width: '100%' } }, rows)
}

export const listIssueRow = function (h: any, st: any, x: any, isOpen: any, narrow: any, blockOf: any, colorOf: any, multiEffort: any) {
      const has = function (x: any, nm: any) { return (x.labels || []).some(function (l: any) { return l.name === nm }) }
      // #949 瞬间底座：行内可点小药丸（+N 更多、被阻塞跳转）也要能被键盘走到。
      //   #956 评审修正：本地那份键盘处理退役，改调共享层的 chipKeyDown（同图收敛只留一处）；
      //   整行本体的键盘处理见下面 aggrow。
      const openBlocked = function (blk: any) { setActiveMap(st, blk.map, blk.mapEffort) }
      // #951：复制是瞬间动作，不套转圈；按剪贴板真实结果换对勾叉号（同 13 像素）加闪光，
      //   成功 1.3 秒自退，失败留到下一次操作（下一次点复制先清掉）。
      const copyUrl = function (x: any) {
        const key = idOf(x)
        st.copyFlash = null
        emit(st)
        const done = function (ok: any) {
          st.copyFlash = { key: key, kind: ok === true ? 'ok' : 'fail', at: Date.now() }
          emit(st)
          // 复制成功提示的停留时间：对勾闪光亮这么久就自己退掉（失败不设时限，留到下一次操作才换）。
          // 数值写在 config/ttl.yaml 的 copyFlashMs，构建时由生成器变成常量拼进界面闭包。
          if (ok === true) { try { setTimeout(function () { if (st.copyFlash && st.copyFlash.key === key && st.copyFlash.kind === 'ok') { st.copyFlash = null; try { emit(st) } catch (eR) {} } }, COPY_FLASH_MS) } catch (eT) {} }
        }
        try {
          const r = copyText(st, issueUrlFor(st, x.number, effortOf(x)), tr('toast.copiedLink', { n: x.number }))
          if (r && typeof r.then === 'function') r.then(done, function () { done(false) })
          else done(!!r)
        } catch (eC) { done(false) }
      }
      const copyRes = (st.copyFlash && st.copyFlash.key === idOf(x)) ? st.copyFlash.kind : ''
      // v14-4：行级动作按 label 四选一（诊断/修复/讨论/执行），全部预填输入框；
      // v19：共享 mkRowAction（列表与 map 详情同逻辑，按钮色动态取 label 配置色）；v14-3 按钮 80%；v14-19 窄屏折叠为纯图标
      // v1.3.3 UI 定稿（用户逐版确认）：两行结构 · 卡片风（C）· 编号/map 竖排（idcol）·
      //   行1 = 编号(上)+map徽章(下) 竖排 + 标题(占满,限2行) + 迷你圆环进度(右上)；
      //   行2 = 标签单行贪心折叠（宽多窄少,最少1个,放不下进 +N 弹窗）+ 按钮组（执行/完成/新会话常显,复制/外链 hover）
      //   +N 弹窗：fixed 定位,基准=面板容器,clamp 左右不越界,内容完整可见（用户验收 A 方案）
      const ringOf = function (stats: any, kind: any) {
        const total = stats.total || 0, closed = stats.closed || 0
        const pct = total ? Math.round(closed / total * 100) : 0
        const C = 2 * Math.PI * 7
        const off = C * (1 - pct / 100)
        // #1286：环色跟着容器身份走（探索紫 / 规格贵族蓝），全关时一律绿
        const color = pct >= 100 ? '#4ade80' : accentOf(kind)
        return h('span', { className: 'dsws-ring', 'data-dsws-row-part': 'ring' }, [
          h('svg', { width: LIST_ROW_SHAPE.ring.size, height: LIST_ROW_SHAPE.ring.size, viewBox: '0 0 18 18' }, [
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: 'rgba(255,255,255,.12)', strokeWidth: 2.4 }),
            h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round', strokeDasharray: String(C), strokeDashoffset: String(off) }),
          ]),
          h('span', { className: 'dsws-ring-txt', style: { color: color } }, closed + '/' + total),
        ])
      }
      // #1286：这一行是哪种容器。探索地图 = type==='map' 或带 wayfinder:map 标签；规格 = type==='spec'。
      //   判定口径归内核 container-view.ts（唯一真源）；但门禁 tests/verify-multi-effort-panel.ts 会把本文件
      //   单独取出来求值，那时闭包里没有内核那几件东西，所以先问「在不在」，不在就退回本文件内同口径的退化判定。
      const kindOf = (typeof containerKindOf === 'function') ? containerKindOf : function (x: any) {
        if (!x) return null
        if (x.type === 'spec') return 'spec'
        if (x.type === 'map' || has(x, 'wayfinder:map')) return 'map'
        return null
      }
      const kind = kindOf(x)
      const isContainer = !!kind
      const isMap = kind === 'map'
      const isSpec = kind === 'spec'
      // 容器对象：探索地图与规格都从同一份快照容器表里按身份找（规格也在里面，不是另一张表）
      const containerObj = isContainer ? findMapByIdentity(st.snapshot && st.snapshot.maps, x.number, effortOf(x)) : null
      // v15-26：被阻塞判定（open 阻塞者）→ 隐藏动作按钮 + 红色「被阻塞」标签（地图子票点击跳所属 map 详情；#544 独立票无所属地图，只展示不跳转）
      const blk = blockOf[idOf(x)]
      const blocked = !!(blk && blk.by && blk.by.length)
      const blockedTip = blocked ? blk.by.map(function (b: any) { return '#' + b }).join('、') : ''
      // #691（阶段 3）：已关闭的地图行不带子票（打开那张地图时才按需取，见 views/MapDetailHead.js），
      //   所以既不画进度环、也不把它当「空地图」上橙色 —— 没有子票不等于一张子票都没有。
      const mapClosed=!!(isMap&&containerObj&&String(containerObj.state||'').toUpperCase()==='CLOSED')
      const mapDone=!!(isMap&&containerObj&&containerObj.stats&&containerObj.stats.total>0&&containerObj.stats.closed===containerObj.stats.total)
      const mapEmpty=!!(isMap&&containerObj&&containerObj.stats&&containerObj.stats.total===0&&!mapClosed)
      // #1286：容器三态。探索地图沿用旧三态（没有子票=空、子票全关=完成、其余=进行中）；
      //   规格按内核 containerStateOf 的口径取（没有子票=空、有未关=进行中、全关=完成）。
      const cState = isSpec
        ? ((typeof containerStateOf === 'function') ? containerStateOf(containerObj)
            : (containerObj && containerObj.stats && containerObj.stats.total ? (containerObj.stats.closed === containerObj.stats.total ? 'done' : 'open') : 'empty'))
        : (mapDone ? 'done' : (mapEmpty ? 'empty' : 'open'))
      // #1343：容器三态里的两枚固定色（空态橙、完成态绿）只从中央色表取；门禁单独求值本文件时
      //   那份常量不在，取色退回空串。不在这里再写一份同值兜底——写第二份，中央色表就不再是唯一真源。
      const emptyColor = function () {
        return (typeof CONTAINER_EMPTY_COLOR === 'string' && CONTAINER_EMPTY_COLOR) ? CONTAINER_EMPTY_COLOR : ''
      }
      const doneColor = function () {
        return (typeof CONTAINER_DONE_COLOR === 'string' && CONTAINER_DONE_COLOR) ? CONTAINER_DONE_COLOR : ''
      }
      // #1286：编号徽章色。探索地图照旧（完成绿 / 空态橙 / 否则取行级动作色）；
      //   规格：空态橙、有未关蓝（中央色表）、全关绿。
      const numColor = isSpec
        ? ((typeof containerNumberColor === 'function') ? containerNumberColor('spec', cState, actionColorOf(x, colorOf))
            : (cState === 'done' ? doneColor() : cState === 'empty' ? emptyColor() : (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT ? CONTAINER_ACCENT.spec : '')))
        : (mapDone ? doneColor() : mapEmpty ? emptyColor() : actionColorOf(x, colorOf))
      // #1286：容器的身份色、行底色、角标样式与角标文案都从内核 container-view.ts 取；
      //   门禁单独求值本文件时那份常量不在：颜色（身份色与两枚状态色）退回空串，
      //   角标类与文案键退回本文件里的退化兜底（那几样不是颜色副本。真机走不到这条路）。
      const accentOf = function (k: any) {
        const table: any = (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT : {}
        return table[k] || ''
      }
      // #1343：行底色同样只认真源，真源不在时退回空串；不再抄一份同值 rgba 兜底。
      const tintOf = function (k: any) {
        const table: any = (typeof CONTAINER_TINT === 'object' && CONTAINER_TINT) ? CONTAINER_TINT : {}
        return table[k] || ''
      }
      const chipClassOf = function (k: any) {
        const table: any = (typeof CONTAINER_CHIP_CLASS === 'object' && CONTAINER_CHIP_CLASS) ? CONTAINER_CHIP_CLASS : { map: 'dsws-chip-m', spec: 'dsws-chip-s' }
        return table[k] || 'dsws-chip-m'
      }
      const chipLabelKeyOf = function (k: any) {
        const table: any = (typeof CONTAINER_CHIP_LABEL_KEY === 'object' && CONTAINER_CHIP_LABEL_KEY) ? CONTAINER_CHIP_LABEL_KEY : { map: 'list.mapChip', spec: 'list.specChip' }
        return table[k] || 'list.mapChip'
      }
      // 容器标记类：列表页按它认出「这一行是容器」（两种容器共用一个类名，不按颜色猜）
      const containerMarkerClass = (typeof CONTAINER_CHIP_MARKER_CLASS === 'string' && CONTAINER_CHIP_MARKER_CLASS) ? CONTAINER_CHIP_MARKER_CLASS : 'dsws-chip-container'
      // #1286：主按钮。
      //   探索地图照旧：没有子票=检查（橙）、子票全关=完成（绿）、其余走行级动作那一族（执行紫，与行级动作色一致）。
      //   规格按三态：拆票（橙）/ 执行（蓝）/ 完成（绿）——文案、颜色、提示语取自内核 container-view.ts 的三态表。
      const containerTri = (isContainer && typeof containerTriState === 'function') ? containerTriState(kind, cState) : null
      // 规格的注入文本：拆票=给 /to-tickets 链接，执行=给 /implement-spec 链接，完成=复用完成模板。
      //   执行态为什么不用通用「执行这张票」模板：那个模板正文首行是 /wayfinder，用在规格上不对（§3.4）。
      //   真源是 container-view.ts 的 containerPromptText；门禁单独求值本文件时那份函数不在，按同口径退化。
      const specPromptText = function () {
        const url = (typeof issueUrlFor === 'function') ? (issueUrlFor(st, x.number, effortOf(x)) || '') : ''
        if (typeof containerPromptText === 'function') {
          try { return containerPromptText(st, containerObj, kind, cState, url) } catch (e) { /* 落回下面那份同口径文本 */ }
        }
        if (cState === 'done') {
          const s = (containerObj && containerObj.stats) ? containerObj.stats : { total: 0, closed: 0 }
          return (typeof completePrompt === 'function') ? completePrompt(st, x.number, x.title, s.total, s.closed) : ''
        }
        if (cState === 'empty') return '/to-tickets ' + url
        return '/implement-spec ' + url
      }
      const primaryBtn = (function () {
        // 规格：拆票 / 执行 / 完成 三态
        if (isSpec && containerTri) {
          const c = containerTri.color
          return h(Tip, { content: tr(containerTri.titleKey) }, h('button', {
            // 本次界面反馈需求：规格主按钮自己带按压态与点击日志 —— 它在整行里面，
            //   只靠整行那条日志的话，点了它与点了行里别处记的是同一条，看不出点了哪颗。
            className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : '') + ' dsws-hov',
            'data-press': 'button',
            'data-log': 'list.row.spec.' + (x.key != null ? x.key : x.number),
            onClick: function (e: any) { e.stopPropagation(); inject(st, specPromptText()) },
            style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: c, borderColor: 'transparent', color: isLightHex(c) ? '#140a1e' : '#ffffff', fontWeight: 600 },
          }, [Ic({ n: containerTri.icon, size: 10 }), narrow ? null : h('span', null, tr(containerTri.labelKey))]))
        }
        if (mapEmpty) {
          // 探索地图：没有子票 → 检查（这段逻辑照旧，行为不变）
          // 本次界面反馈需求：这颗按钮自己带按压态与点击日志，否则点它记的是整行那条。
          return h(Tip, { content: tr('map.inspectTitle') }, h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : '') + ' dsws-hov', 'data-press': 'button', 'data-log': 'list.row.inspect.' + (x.key != null ? x.key : x.number), onClick: function (e: any) { e.stopPropagation(); let t = ''; try { t = inspectPrompt(st, x.number, x.title) } catch { const u = typeof issueUrlFor === 'function' ? (function () { try { return issueUrlFor(st, x.number, effortOf(x)) } catch (_) { return '' } })() : '', uu = u || (x.number != null ? '#' + String(x.number) : ''); t = uu ? '/wayfinder ' + uu : '/wayfinder'; try { t = promptTextFor(st, 'mapInspect', { n: String(x.number || ''), ['title']: String(x.title || ''), url: u }); if (u) t = '/wayfinder ' + u + '\n\n' + t } catch (_) {} } inject(st, t) }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: emptyColor(), borderColor: 'transparent', color: '#140a1e', fontWeight: 600 } }, [Ic({ n: 'search', size: 10 }), narrow ? null : h('span', null, tr('act.inspect'))]))
        }
        if (mapDone) {
          // 探索地图：子票全关 → 完成（这段逻辑照旧，行为不变）
          // 本次界面反馈需求：这颗按钮自己带按压态与点击日志，否则点它记的是整行那条。
          return h(Tip, { content: tr('map.doneTitle') }, h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : '') + ' dsws-hov', 'data-press': 'button', 'data-log': 'list.row.done.' + (x.key != null ? x.key : x.number), onClick: function (e: any) { e.stopPropagation(); const t = completePrompt(st, x.number, x.title, containerObj.stats.total, containerObj.stats.closed); inject(st, t) }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: doneColor(), borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [Ic({ n: 'check', size: 10 }), narrow ? null: h('span', null, tr('act.done'))]))
        }
        return mkRowAction(st, x, narrow, colorOf)
      })()
      // #1286：新会话按钮与主按钮永远同色实心（背景色取主按钮那个色，字色按对比度择优）。
      const primaryColor = (isSpec && containerTri) ? containerTri.color : (mapEmpty ? emptyColor() : mapDone ? doneColor() : actionColorOf(x, colorOf))
      const primaryText = (isSpec && containerTri) ? (isLightHex(primaryColor) ? '#140a1e' : '#ffffff')
        : (mapEmpty ? '#140a1e' : mapDone ? '#0c1a10' : (isLightHex(actionColorOf(x, colorOf)) ? '#140a1e' : '#ffffff'))
      // v1.3.3 UI：全部标签渲染（渲染后贪心折叠，放不下的隐藏进 +N；+N 弹窗显示全部）
      const labels = x.labels || []
      const allNames = labels.map(function (l: any) { return l.name }).join('、')
      const openPop = function (e: any) {
        e.stopPropagation()
        const trig = e.currentTarget
        // #646：面板容器现在在右侧边栏里（Dock 的根节点带 data-dsws-host），页内浮窗已退役
        const host = trig.closest('[data-dsws-host]')
        showPop(trig, host, labels, x.title)
      }
      // R5：变化行视觉（变更琥珀渐隐 / 新增绿闪）
      const _flashCls = (st.rowFlash && st.rowFlash[idOf(x)]) ? (st.rowFlash[idOf(x)] === 'added' ? ' dsws-row-added' : ' dsws-row-changed') : ''
      return h(Tip, { content: (isContainer && containerObj) ? tr((typeof containerTitleKey === 'function') ? containerTitleKey(kind) : (isSpec ? 'list.specTitle' : 'list.mapTitle')) : tr('list.issueDetailTitle') }, h('div', {
        key: idOf(x),
        className: 'dsws-aggrow' + _flashCls,
        // #949 瞬间底座：整行可点就要能被键盘走到。tabIndex 让 Tab 停留，
        //   焦点环走反馈样式叶子里的统一 :focus-visible 规则（DSH 焦点 token，往控件里面画），不占布局；
        //   回车与空格沿用鼠标同一条路（调起 click），不另写分支。
        tabIndex: 0,
        role: 'button',
        'aria-label': '#' + (x.key != null ? x.key : x.number) + ' ' + (x.title || ''),
        // 本次界面反馈需求：整行按下变暗、点击写一条调试日志（target 带票号，读日志能定位到点了哪一行）。
        'data-press': 'row',
        'data-log': 'list.row.' + (x.key != null ? x.key : x.number),
        onClick: function () {
          // #1286：容器行（探索地图与规格）点开都进容器详情，走地图那条路；普通票进票详情。
          if (isContainer && containerObj) { setActiveMap(st, x.number, effortOf(x)) }
          else { setActiveIssue(st, x.number, effortOf(x)) }
        },
        onKeyDown: function (e: any) {
          // #956 评审修正：事件从子孙冒上来时不重复触发 —— 行内还有小药丸与复制、外链、新会话等真按钮，
          //   不拦的话「在复制按钮上按回车」会既复制又打开这张票。只认落在整行自己身上的那一次。
          if (!e || e.target !== e.currentTarget) return
          chipKeyDown(e)
        },
        style: isContainer ? { cursor: 'pointer', borderLeft: '3px solid ' + accentOf(kind), background: tintOf(kind) } : { cursor: 'pointer' },
      }, [
        // 行1：idcol 竖排（编号上 map 徽章下）+ 标题 + 圆环进度（T1 Map #120：gap 6→8，idcol↔标题 8、标题↔圆环 8）
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: LIST_ROW_SHAPE.line1.gap, width: '100%' } }, [
          h('span', { className: 'dsws-idcol', 'data-dsws-row-part': 'idcol' }, [
            // #1286：容器角标 —— 地图图标 + 「地图」/「规格」两行字，底色随容器种类（探索紫 / 规格贵族蓝）；
            //   末尾那个标记类让列表页认出「这一行是容器」（两种容器共用一个类名，不按颜色猜）。
            isContainer ? h('span', { className: 'dsws-chip ' + chipClassOf(kind) + ' ' + containerMarkerClass, style: { fontSize: 11, fontWeight: 600, lineHeight: 1.7, padding: '0 8px' } }, [Ic({ n: 'map', size: 11 }), h('span', null, tr(chipLabelKeyOf(kind)))]) : null,
            // effort 维度：一个仓库多个 effort 时，每行标出它属于哪个 effort（同号票靠这一眼区分）
            (multiEffort && effortOf(x)) ? h(Tip, { content: effortOf(x) }, h('span', { className: 'dsws-chip dsws-eff', 'aria-label': effortOf(x), style: { fontSize: 10, lineHeight: 1.6, padding: '0 6px', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'rgba(88,166,255,.14)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.45)' } }, effortOf(x))) : null,
            h('span', { className: 'dsws-idnum', style: { color: numColor, borderColor: numColor } }, '#' + (x.key != null ? x.key : x.number)),
            // #715：写入窗口期给这一行加一枚极轻的「更新中」标记 —— 不改状态、不改布局：
            //   只是编号下面多一小片虚边框的字，窗口一过（host-budget.ts 的 PATCH_MERGE_WINDOW_MS）自己就不画了。
            //   事实来源：写入成功那一处记下的时刻（kernel/api-io.js 的 markRowWrite → st.writeAt）。
            truthWriteWindowOpen(st.writeAt && (st.writeAt[String(x.number)] || st.writeAt[idOf(x)]), Date.now()) ? h('span', { className: 'dsws-chip dsws-writing', style: { fontSize: 9, lineHeight: 1.5, padding: '0 4px', flex: 'none', opacity: 0.75, background: 'rgba(88,166,255,.10)', color: '#58a6ff', border: '1px dashed rgba(88,166,255,.45)' } }, tr('truth.writing')) : null,
          ]),
          h('span', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 } }, [h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, x.title)]) }, h('span', { className: 'dsws-tt-wrap', 'data-dsws-row-part': 'title', style: { flex: 1, minWidth: 0, fontWeight: isContainer ? 600 : undefined, color: isOpen ? undefined : 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, x.title)), (x.author && x.author.login && x.author.login !== ((st.snapshot && (st.snapshot.viewer && st.snapshot.viewer.login || st.snapshot.viewerLogin)) || '')) ? (x.author.avatarUrl ? h(Tip, { content: (x.author.name ? x.author.name + ' (@' + x.author.login + ')' : '@' + x.author.login) }, h('img', { src: x.author.avatarUrl, style: { width: 16, height: 16, borderRadius: '50%', border: '2px solid ' + authorColor(x.author.login), flex: 'none' }, alt: x.author.login })) : h(Tip, { content: (x.author.name ? x.author.name + ' (@' + x.author.login + ')' : '@' + x.author.login) }, h('span', { style: { width: 16, height: 16, borderRadius: '50%', background: hexA(authorColor(x.author.login), 0.18), border: '2px solid ' + authorColor(x.author.login), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' } }, [Ic({ n: 'person', size: 10 })]))) : null]),
          (isContainer && containerObj && containerObj.stats && !mapClosed) ? ringOf(containerObj.stats, kind) : null,
          !isOpen ? h('span', { className: 'dsws-chip', style: { fontSize: 10, marginRight: 0, flex: 'none', background: 'rgba(139,139,149,.12)', color: '#8b8b95', border: '1px solid rgba(139,139,149,.35)' } }, [Ic({ n: 'check', size: 9 }), h('span', null, tr('map.subClosed'))]) : null,
        ]),
        // 行2：标签贪心折叠（单行不换行）+ 按钮组（常显）（T1 Map #120：marginTop 8→2，全局收紧至 8px = gap6+mt2，所有行一致）
        h('div', { style: { marginTop: LIST_ROW_SHAPE.line2.marginTop, display: 'flex', alignItems: 'center', gap: LIST_ROW_SHAPE.line2.gap, width: '100%' } }, [
          h('div', { className: 'dsws-tags', 'data-dsws-row-part': 'tags', 'data-dsws-labels': JSON.stringify(labels.map(function (l: any) { return l.name })) }, [
            labels.map(function (l: any, i: any) {
              return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA(l.color, 0.18) || 'rgba(188,140,255,.16)', color: l.color ? '#' + l.color : '#bc8cff', border: '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)') } }, l.name)
            }),
            labels.length > 0 ? h(Tip, { content: tr('list.tagsTitle', { names: allNames }) }, h('span', chipProps({ key: 'more', className: 'dsws-chip dsws-more dsws-hov', 'data-press': 'chip', 'data-log': 'list.row.more.' + (x.key != null ? x.key : x.number), onClick: openPop }), '+0')) : null,
            // 本次界面反馈需求：带所属地图的「被阻塞」药丸能点（点开看谁挡着），给它自己的按压态与点击日志；
            //   没有所属地图的那一颗只是显示，同样点不动，不接线。
            blocked ? ((blk.map === null || blk.map === undefined)
              ? h(Tip, { content: tr('map.subBlocked', { who: blockedTip }) }, h('span', { key: 'blk', className: 'dsws-chip dsws-blocked', style: { fontSize: 10, background: 'rgba(248,113,113,.16)', color: '#f87171', border: '1px solid rgba(248,113,113,.55)' } }, [Ic({ n: 'lock', size: 10 }), h('span', null, tr('list.blocked'))]))
              : h(Tip, { content: tr('list.blockedTitle', { by: blockedTip }) }, h('span', chipProps({ key: 'blk', className: 'dsws-chip dsws-blocked dsws-hov', 'data-press': 'chip', 'data-log': 'list.row.blocked.' + (x.key != null ? x.key : x.number), onClick: function (e: any) { e.stopPropagation(); openBlocked(blk) }, style: { fontSize: 10, background: 'rgba(248,113,113,.16)', color: '#f87171', border: '1px solid rgba(248,113,113,.55)', cursor: 'pointer' } }), [Ic({ n: 'lock', size: 10 }), h('span', null, tr('list.blocked'))]))) : null,
          ]),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', marginLeft: 'auto' }, 'data-dsws-row-part': 'buttons' }, [
            isOpen && !blocked ? h('div', { style: { display: 'flex', gap: 3, alignItems: 'center', flex: 'none' } }, [
              // #1286：主按钮按容器三态取（上面算好的 primaryBtn）；新会话按钮与它永远同色实心。
              primaryBtn,
              h(Tip, { content: tr('tip.newSession', { n: x.number }) }, h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''), 'data-press': 'button', 'data-log': 'list.row.newsession.' + (x.key != null ? x.key : x.number), onClick: function (e: any) { e.stopPropagation(); openInNewSession(st, x) }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: primaryColor, borderColor: 'transparent', color: primaryText } }, [Ic({ n: 'external-link', size: 10 }), narrow ? null : h('span', null, tr('list.newSessionLabel'))])),
            ]) : null,
            isOpen ? h('div', { className: 'dsws-aux', style: { display: 'flex', gap: 2, alignItems: 'center', flex: 'none' } }, [
              // v1.3.3：复制/外链图标增大 11 → 13；Q6 解耦：复制=绝对路径/链接，跳转=按 url 前缀分流（https 开网页，file 盘符调 wf.openPath）
              h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost' + (copyRes === 'ok' ? ' dsws-fb-okflash dsws-fb-success-ring dsws-fb-pop' : '') + (copyRes === 'fail' ? ' dsws-fb-errflash dsws-fb-shake' : ''), 'data-press': 'icon', 'data-log': 'list.row.copy.' + (x.key != null ? x.key : x.number), onClick: function (e: any) { e.stopPropagation(); copyUrl(x) }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, copyRes === 'ok' ? Ic({ n: 'check', size: 13 }) : (copyRes === 'fail' ? Ic({ n: 'x', size: 13 }) : Ic({ n: 'clipboard', size: 13 })))),
              (function(){
                const _u = issueUrlFor(st, x.number, effortOf(x));
                const _isHttp = /^https?:\/\//i.test(String(_u||''));
                const _openLocal = function(e: any){ e.stopPropagation(); const u=issueUrlFor(st, x.number, effortOf(x)); if(!u) return; if(/^https?:\/\//i.test(String(u))) { try{ window.open(u,'_blank','noreferrer') }catch{} } else { try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openPath',{path:u}) }catch{} } };
                return _isHttp ? h(Tip, { content: tr('tip.openInTracker', { n: x.number }) }, h('a', { className: 'dsws-btn ghost', href: _u, target: '_blank', rel: 'noreferrer', 'data-press': 'icon', 'data-log': 'list.row.link.' + x.number, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 }))) : h(Tip, { content: tr('tip.openInTracker', { n: x.number }) }, h('button', { className: 'dsws-btn ghost', onClick: _openLocal, 'data-press': 'icon', 'data-log': 'list.row.link.' + x.number, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 })));
              })(),
            ]) : null,
          ]),
        ]),
      ]))
}
