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
  '.m2v2-page{--m2v2-ground:#1e2023;--m2v2-panel:#272a2e;--m2v2-line:#3b3e43;display:flex;flex-direction:column;gap:10px;padding-bottom:24px;min-width:0;background:var(--m2v2-ground)}',
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

  // 四个计数（可接 / 已认领 / 被阻塞 / 已关闭）：子票总数与已完成由进度条那一行交代，这里不重复。
  '.m2v2-counts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}',
  '.m2v2-count{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#a1a1aa)}',
  '.m2v2-count[data-status="ready"]{color:var(--dsw-alias-state-success-primary,#3fb950)}',
  '.m2v2-count[data-status="doing"]{color:#58a6ff}',
  '.m2v2-count[data-status="blocked"]{color:var(--dsw-alias-state-error-primary,#f87171)}',
  '.m2v2-count[data-status="closed"]{color:var(--dsw-alias-label-caption,#8b8b95)}',

  // 完成度：一条细进度条（按已完成张数算，替代老页的「层级进度」）。
  '.m2v2-prog{display:flex;align-items:center;gap:8px;margin-top:10px}',
  '.m2v2-prog-cap{flex:none;font-size:11px;color:var(--dsw-alias-label-caption,#8b8b95)}',
  '.m2v2-track{flex:1;height:6px;min-width:80px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));overflow:hidden}',
  '.m2v2-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#3fb950);transition:width .2s ease}',
  '.m2v2-prog-num{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);font-variant-numeric:tabular-nums}',

  // 「子票那句」：本图 N 张子票 / 正在取 / 没取到 / 被截断 / 有差额，都在这一个元素里说。
  '.m2v2-feed{margin-top:6px;font-size:11px;color:var(--dsw-alias-label-caption,#8b8b95);word-break:break-word}',
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

  // 卡片流：卡片自带固定宽度与像素皮肤（含深浅两套），这里只负责排列，不再给卡片套第二层皮肤。
  '.m2v2-flow{display:flex;flex-wrap:wrap;gap:18px 16px;align-items:flex-start;margin-top:6px}',
  '.m2v2-empty{font-size:12px;color:var(--dsw-alias-label-caption,#8b8b95);padding:8px 2px}',
]
