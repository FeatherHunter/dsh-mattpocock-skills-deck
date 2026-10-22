/**
 * views/mapDetailV2/view/skin/MapDetailV2Styles.ts —— V2 地图详情页「页面外壳」的样式（第 4 个样式叶子）。
 *
 * 铺到哪一层（维护者 2026-10-22 答 Q6=A）：只有 ISSUE 卡片有深浅两套像素皮肤（views/cards 已做完），
 * 页面外壳跟随宿主的主题变量，不另铺一套纸面皮肤——外壳再铺一次会与宿主割裂，也是 #1366 定版之外的活。
 *
 * 2026-10-23 维护者看演示页后补了一条要求：深色底不要纯黑、浅色底不要纯白，视觉上要舒适。
 * 所以只有「内容区的地」与「地图档案那张信息卡」这两层改用自己固定的两档中性色（炭灰 / 暖白），
 * 这也是本文件唯一认 body[data-ds-dark-theme] 的地方；文字、按钮、状态色、卡片皮肤仍取宿主的
 * --dsw-alias-* 令牌（带一个回退值），顶栏那一行完全没动。
 *
 * 注入方式与其它样式叶子同一条缝（src/client/index.ts 里 styles.insert）。
 */
export const MAP_DETAIL_V2_STYLE_TEXT: string[] = [
  // 整页：一列。地图档案区一块，卡片流一块，已完成就接在卡片流最下面（维护者定的连续一条流）。
  // 三档中性色只在 .m2v2-page 上定义、由子元素继承：炭灰底 + 亮一档的面板 + 一档描边，避免纯黑纯白。
  '.m2v2-page{--m2v2-ground:#1e2023;--m2v2-panel:#272a2e;--m2v2-line:#3b3e43;--m2v2-card-min:208px;display:flex;flex-direction:column;gap:10px;padding-bottom:24px;min-width:0;background:var(--m2v2-ground)}',
  // #1402 接入真实入口后：Dock 的内容区是 .dsws-body（内边距 10px 12px，见 panel/Dock.ts:401 与 kernel/styles.ts:46），
  // 页面的底色如果只铺在自己的盒子里，会在面板四周留一圈宿主底色，看起来像一张内嵌的色卡。
  // 这一条只对 Dock 里的直接子元素生效（演示页没有 .dsws-body，不受影响）：抵消那圈内边距、补回内容缩进，并撑满可视高度。
  '.dsws-body>.m2v2-page{margin:-10px -12px;min-height:100%;padding:10px 12px 24px}',
  // 浅色主题：暖白底 + 纸白面板 + 浅描边。判断方式与卡片皮肤一致（宿主浅色时 body 上没有 data-ds-dark-theme）。
  'body:not([data-ds-dark-theme]) .m2v2-page{--m2v2-ground:#ece6d8;--m2v2-panel:#f7f4ea;--m2v2-line:#d8cfbd}',

  // 档案区（MAP 自身内容）：普通信息卡，用同一族的中性面板色，比「地」亮一档。
  '.m2v2-profile{border:1px solid var(--m2v2-line,var(--dsw-alias-border-l1,#2a2d35));border-radius:12px;padding:12px 14px;background:var(--m2v2-panel,var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03)));min-width:0}',
  '.m2v2-id{display:flex;align-items:center;gap:8px;min-width:0}',
  '.m2v2-chip{flex:none;font-size:10px;line-height:16px;letter-spacing:.08em;padding:0 6px;border-radius:6px;border:1px solid currentColor;color:var(--dsw-alias-label-caption,#8b8b95)}',
  '.m2v2-no{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary,#e6edf3)}',
  '.m2v2-title{margin:6px 0 0;font-size:15px;line-height:1.4;font-weight:600;color:var(--dsw-alias-label-primary,#e6edf3);word-break:break-word}',

  // 目的地：一句话说清「要去哪」。老页用绿色目标图标，这里沿用同一语义与色。
  '.m2v2-dest{display:flex;align-items:flex-start;gap:4px;margin-top:6px;font-size:12px;line-height:1.55;color:var(--dsw-alias-state-success-primary,#3fb950);word-break:break-word}',
  '.m2v2-dest-ic{flex:none;margin-top:2px}',
  '.m2v2-dest-empty{color:var(--dsw-alias-label-caption,#8b8b95)}',

  // 档案区的「计数 / 完成度 / 子票那句」三行固定成一块（维护者 2026-10-23：进入时「正在取子票」独占一行、
  // 随后消失，卡片跟着抖一下；后来又明确这一行不要）。三行永远在位：取数中显示占位、子票那句留空、
  // 「正在取数」交给下面进度条上的流动斜纹，取到后原地换数字；确实没有子票时整块 visibility:hidden——
  // 位置留着，卡片不会被这块消失往上拽。
  '.m2v2-meta{display:flex;flex-direction:column}',
  '.m2v2-meta[data-empty="1"]{visibility:hidden}',

  // 四个计数（可接 / 已认领 / 被阻塞 / 已关闭）：子票总数与已完成由进度条那一行交代，这里不重复。
  '.m2v2-counts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
  '.m2v2-count{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#a1a1aa)}',
  '.m2v2-count[data-status="ready"]{color:var(--dsw-alias-state-success-primary,#3fb950)}',
  '.m2v2-count[data-status="doing"]{color:#58a6ff}',
  '.m2v2-count[data-status="blocked"]{color:var(--dsw-alias-state-error-primary,#f87171)}',
  '.m2v2-count[data-status="closed"]{color:var(--dsw-alias-label-caption,#8b8b95)}',

  // 完成度：一条细进度条（按已完成张数算，替代老页的「层级进度」）。
  // 取数中（data-busy="1"）轨道上画流动斜纹：这句话已经从档案区删掉，把「正在取数」放进这条已有的轨道，
  // 既不新增行、也不改变任何一块的高度。颜色取中性灰，深浅两套底色上都看得见；系统要求减少动效时停掉动画，
  // 只留静态斜纹，仍然是「还没取到」的样子。
  '.m2v2-prog{display:flex;align-items:center;gap:8px;margin-top:10px}',
  '.m2v2-prog-cap{flex:none;font-size:11px;color:var(--dsw-alias-label-caption,#8b8b95)}',
  '.m2v2-track{flex:1;height:6px;min-width:80px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));overflow:hidden}',
  '.m2v2-prog[data-busy="1"] .m2v2-track{background-image:repeating-linear-gradient(135deg,rgba(128,128,128,.55) 0,rgba(128,128,128,.55) 6px,transparent 6px,transparent 12px);background-size:24px 24px;animation:m2v2-stripes .9s linear infinite}',
  '@keyframes m2v2-stripes{from{background-position:0 0}to{background-position:24px 0}}',
  '@media (prefers-reduced-motion: reduce){.m2v2-prog[data-busy="1"] .m2v2-track{animation:none}}',
  '.m2v2-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#3fb950);transition:width .2s ease}',
  '.m2v2-prog-num{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);font-variant-numeric:tabular-nums}',

  // 「子票那句」：本图 N 张子票 / 没取到 / 被截断 / 有差额，都在这一个元素里说。
  // 取数中它说的是同一句话、数字换成短横占位（不再写「正在取子票」，也不会空出一行），
  // 永远占一行的高度：换字不改变高度。
  '.m2v2-feed{margin-top:6px;font-size:11px;line-height:1.55;min-height:17px;color:var(--dsw-alias-label-caption,#8b8b95);word-break:break-word}',
  '.m2v2-feed[data-state="failed"]{color:var(--dsw-alias-state-error-primary,#f87171)}',
  '.m2v2-err{display:flex;align-items:center;gap:4px;margin-top:6px;font-size:11px;color:var(--dsw-alias-state-error-primary,#f87171);word-break:break-word}',

  // 档案抽屉：正文详情 / 已定决策 / 战雾 / 范围外（规格是另外七节），默认收起，点标题展开。
  '.m2v2-drawers{display:flex;flex-direction:column;gap:2px;margin-top:10px}',
  '.m2v2-drawer>summary{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);cursor:pointer;border-radius:4px;list-style:none}',
  '.m2v2-drawer>summary::-webkit-details-marker{display:none}',
  '.m2v2-drawer>summary::before{content:"▸";font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);transition:transform .12s ease}',
  '.m2v2-drawer[open]>summary::before{transform:rotate(90deg)}',
  '.m2v2-drawer>summary:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff));outline-offset:2px}',
  '.m2v2-drawer-body{margin-top:4px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l1,#2a2d35);font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,#a1a1aa);word-break:break-word}',
  '.m2v2-drawer-item{margin:2px 0}',
  '.m2v2-drawer-item a{color:inherit;text-decoration:underline}',

  // 卡片流：卡片自带像素皮肤（含深浅两套），这里只负责排法，不再给卡片套第二层皮肤。
  // 排法（维护者 2026-10-23）：一张卡有一个「最小宽度」——四颗按钮缩到只剩图标时的宽度，算下来
  // 两颗图标按钮 40×2 + 两颗文字按钮各 38（图标 12 + 缝 4 + 内边距 16 + 边框 6）+ 三处按钮缝 18 = 174，
  // 加卡片描边与内边距 30，最小 204px；取 208px 留 2px 余量，即 --m2v2-card-min。
  // 用栅格（grid + auto-fit）：一行先按最小宽度 208 尽量多排几列（列数 = 可用宽度 ÷（208 + 列间距）向下取整），
  // 再把这一行剩下的宽度平均分给各列；每张卡最多保留原型定下的自然宽度 300px（只剩一张时不会被拉成一条长条）。
  // 为什么不用 flex-wrap：flex 是逐行决定张数的，最后一行不足时卡片会被撑到 300px，出现「第一行五张窄卡、
  // 第二行三张宽卡」这种同一页里卡片宽窄不一的情况；栅格一次算出列数，所有行共用同一套列宽。
  // 卡片自己的样式默认按 content-box 算宽度，这里必须改成 border-box：否则最小宽度 208 只是内容宽，
  // 加上 4px 描边与左右内边距会变成 234px，一行能塞的张数就比算好的少一张。
  // 实际手感：面板 565px → 2 列、每列约 274px（按钮文字完整）；520px → 2 列、约 244px（文字开始逐字收）；
  // 480px → 2 列、208px（按钮只剩图标，这就是最小宽度）；1200px → 5 列、约 220px。
  '.m2v2-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(var(--m2v2-card-min,208px),100%),1fr));gap:18px 16px;margin-top:6px;min-width:0}',
  // 面板本身比最小宽度还窄时（极窄侧栏），min(…,100%) 让卡片跟着面板继续缩，不要横向溢出。
  '.m2v2-flow .cd-card{box-sizing:border-box;width:100%;max-width:300px}',
  '.m2v2-empty{font-size:12px;color:var(--dsw-alias-label-caption,#8b8b95);padding:8px 2px}',
]
