// views/versionControl/vcPageStyles.ts —— 页面重做新增的样式（#1829 阶段 4）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，运行时由 index.ts 拼进同一个 style 元素。
//
// 本文件只放 #1829 新加的样式，老壳的样式仍在 vcShellStyles.ts；注入顺序在本文件之后，所以同名选择器以后者为准。
// 三条硬规矩：
//   1. 每条规则都以 [data-vc-shell] 开头，样式只作用于版本管理根节点，不外泄到插件的其它界面；
//   2. 颜色一律用 --vcs-* 令牌，不写死色值，浅色皮肤只换令牌、不动这里的规则；
//   3. 四档宽（300 / 380 / 460 / 520）都不许横向溢出：长标题、长路径、长命令一律允许在词内换行，
//      300 宽再把层级、条数这几项次要信息收起来，主要入口一个都不删。
export const VC_PAGE_STYLE_TEXT = [
  // 根节点补定位：命令面板遮罩与分支浮层要贴着整个版本管理界面铺满，不能定位到更外层的页面上去。
  '[data-vc-shell]{position:relative}',
  // 页头：标题行 → 种类与层级 → 导语，竖排三段；外框只留一条底线，宽度交给页面容器。
  '[data-vc-shell] .vcs-page-head{display:flex;flex-direction:column;gap:4px;padding:8px 10px 6px;border-bottom:1px solid var(--vcs-line);margin-bottom:8px;min-width:0}',
  '[data-vc-shell] .vcs-page-title-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}',
  // 返回键画成小号按钮，字号与正文一致，点它的落点由容器的事件委托按 data-vc-back 处理。
  '[data-vc-shell] .vcs-page-back{flex:0 0 auto;padding:2px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .vcs-page-back:hover{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-page-back:focus-visible{outline:1px solid var(--vcs-accent);outline-offset:1px}',
  // 标题允许在词内换行：300 宽时「迁移与备份」这类长页名不会把整行撑横。
  '[data-vc-shell] .vcs-page-title{flex:1 1 auto;min-width:0;margin:0;font-size:15px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-page-count{flex:0 0 auto;padding:1px 6px;border:1px solid var(--vcs-line);border-radius:999px;color:var(--vcs-dim);font-size:12px;white-space:nowrap}',
  '[data-vc-shell] .vcs-page-sub{display:flex;flex-wrap:wrap;gap:2px 8px;margin:0;color:var(--vcs-dim);font-size:12px;min-width:0}',
  '[data-vc-shell] .vcs-page-kind{color:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-page-depth{color:var(--vcs-dim)}',
  '[data-vc-shell] .vcs-page-lede{margin:0;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  // 分区：段与段之间一条细线；危险区在左缘加一条警示竖线，并把整段标成 is-danger。
  '[data-vc-shell] .page-section{padding:8px 0;border-bottom:1px solid var(--vcs-line);min-width:0}',
  '[data-vc-shell] .page-section:last-child{border-bottom:0}',
  '[data-vc-shell] .page-section.is-danger{padding-left:8px;border-left:2px solid var(--vcs-danger)}',
  '[data-vc-shell] .section-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;margin:0 0 4px;min-width:0}',
  '[data-vc-shell] .section-title{margin:0;font-size:13px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .section-count{flex:0 0 auto;padding:0 5px;border-radius:999px;background:var(--vcs-panel);color:var(--vcs-dim);font-size:11px}',
  '[data-vc-shell] .section-danger{flex:0 0 auto;color:var(--vcs-danger);font-size:11px}',
  '[data-vc-shell] .section-note{margin:0 0 4px;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  // 折叠段：外壳与标题行只负责小标题，展开内容放在 fold-body 里，说明在收起时也留在标题行下方。
  '[data-vc-shell] .fold{margin:0 0 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);min-width:0}',
  '[data-vc-shell] .fold-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:4px 8px;font-size:12px;font-weight:600;cursor:pointer;min-width:0}',
  '[data-vc-shell] .fold-head:focus-visible{outline:1px solid var(--vcs-accent);outline-offset:-1px}',
  '[data-vc-shell] .fold-title{min-width:0;overflow-wrap:anywhere}',
  '[data-vc-shell] .fold-count{flex:0 0 auto;padding:0 5px;border-radius:999px;background:var(--vcs-bg);color:var(--vcs-dim);font-size:11px}',
  '[data-vc-shell] .fold-note{margin:0;padding:0 8px 4px;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .fold-body{padding:6px 8px;border-top:1px solid var(--vcs-line);min-width:0}',
  // 事实网格：默认两列，380 与 300 收成一列；每格是「小标题 + 值」的竖排，长值在词内换行。
  '[data-vc-shell] .fact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 8px;margin:0;padding:4px 0}',
  '[data-vc-shell] .fact-cell{display:flex;flex-direction:column;gap:1px;min-width:0;padding:3px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel)}',
  '[data-vc-shell] .fact-key{margin:0;color:var(--vcs-dim);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .fact-value{margin:0;font-size:12px;overflow-wrap:anywhere}',
  '[data-vc-shell] .fact-value.is-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}',
  '[data-vc-shell] .fact-value.is-muted{color:var(--vcs-dim)}',
  '[data-vc-shell] .fact-value.is-warn{color:var(--vcs-warn)}',
  '[data-vc-shell] .fact-value.is-error{color:var(--vcs-danger)}',
  // 对象行：左边主体吃掉剩余宽度，右边次要信息靠右；窄档把两侧叠起来，不做横向滚动。
  '[data-vc-shell] .obj-row{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px;padding:5px 6px;border-bottom:1px solid var(--vcs-line);min-width:0}',
  '[data-vc-shell] .obj-row.is-danger{padding-left:8px;border-left:2px solid var(--vcs-danger)}',
  '[data-vc-shell] .obj-main{flex:1 1 160px;min-width:0;overflow-wrap:anywhere}',
  // 右侧动作区最多占满整行：不允许按 max-content 撑宽（8 个逐行动作排一行会伸出根节点），
  // 也不收缩到看不见（flex-basis auto + min-width 0 负责在行内换行）。
  '[data-vc-shell] .obj-side{flex:0 1 auto;display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;min-width:0;max-width:100%}',
  // 管理索引：齿轮索引里的卡片列表改成网格，宽档两列、最宽三列，窄档一列。
  '[data-vc-shell] .vcs-manage-index{padding:6px 0;min-width:0}',
  '[data-vc-shell] .vcs-manage-index .vcs-gear-list{display:grid;grid-template-columns:minmax(0,1fr);gap:6px}',
  '[data-vc-shell] .vcs-manage-card{display:flex;flex-direction:column;gap:4px;min-width:0;padding:6px 8px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel)}',
  '[data-vc-shell] .vcs-manage-card-title{margin:0;font-size:12px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-manage-card-count{color:var(--vcs-dim);font-size:11px}',
  '[data-vc-shell] .vcs-manage-card-go{color:var(--vcs-accent);font-size:12px;text-decoration:none}',
  '[data-vc-shell] .vcs-manage-card-go:hover{text-decoration:underline}',
  '[data-vc-shell][data-vc-width="460"] .vcs-manage-index .vcs-gear-list{grid-template-columns:repeat(2,minmax(0,1fr))}',
  '[data-vc-shell][data-vc-width="520"] .vcs-manage-index .vcs-gear-list{grid-template-columns:repeat(3,minmax(0,1fr))}',
  // 命令面板遮罩：只有壳直接挂的那一份（浮层用法）才铺满整个版本管理界面贴根定位；
  //   全库搜索页把同一个面板嵌在能力行里画，那份保持普通文档流，不遮住整页（否则搜索页会被自己的遮罩盖住）。
  '[data-vc-shell]>.vcs-palette-backdrop{position:absolute;inset:0;z-index:5;display:flex;align-items:flex-start;justify-content:center;padding:8px;background:var(--vcs-bg);overflow:auto}',
  '[data-vc-shell] .vcs-palette-backdrop{min-width:0}',
  '[data-vc-shell] .vcs-pal-panel{position:relative;display:flex;flex-direction:column;width:100%;max-width:520px;max-height:100%;overflow:auto;border:1px solid var(--vcs-line);border-radius:6px;background:var(--vcs-panel)}',
  '[data-vc-shell] .vcs-pal-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 8px;border-top:1px solid var(--vcs-line);color:var(--vcs-dim);font-size:11px;line-height:1.6}',
  '[data-vc-shell] .vcs-pal-close{margin-left:auto;flex:0 0 auto;padding:1px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-bg);color:var(--vcs-dim);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .vcs-pal-close:hover{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  // 分支浮层头部：标题、事实与关闭键排一行；事实区可换行，窄档整块收起。
  '[data-vc-shell] .vcs-branch-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:4px 8px;border-bottom:1px solid var(--vcs-line);min-width:0}',
  '[data-vc-shell] .vcs-branch-title{min-width:0;font-size:13px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch-facts{display:flex;flex-wrap:wrap;gap:2px 8px;color:var(--vcs-dim);font-size:11px;min-width:0}',
  '[data-vc-shell] .vcs-branch-close{margin-left:auto;flex:0 0 auto;padding:1px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-dim);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .vcs-branch-close:hover{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  // 页面纵向栈：分区与卡片之间的统一间距，所有页面正文都套这一层，避免各页自己算外边距。
  '[data-vc-shell] .page-stack{display:flex;flex-direction:column;gap:8px;min-width:0}',
  // 说明段：排在分区标题下方的一段灰字，长中文与长路径都在词内换行。
  '[data-vc-shell] .page-note{margin:0;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  // 动作卡与读数卡：卡内竖排「标题行 → 命令行 → 说明 → 操作」，危险卡在左缘加警示竖线；
  // 危险卡不从外围整圈描红，避免与页面危险区的左缘红线叠成两道。
  '[data-vc-shell] .page-card{display:flex;flex-direction:column;gap:4px;min-width:0;margin:0 0 6px;padding:6px 8px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel)}',
  '[data-vc-shell] .page-card.is-danger{border-left:3px solid var(--vcs-danger)}',
  '[data-vc-shell] .page-card-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;min-width:0}',
  '[data-vc-shell] .page-card-title{flex:1 1 auto;min-width:0;margin:0;font-size:12px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .page-card-sub{margin:0;color:var(--vcs-dim);font-size:11px;line-height:1.6;overflow-wrap:anywhere}',
  // 命令行条：git 命令原样显示，等宽字体、允许在词内断行，窄档也不会撑出横向滚动。
  '[data-vc-shell] .cmd-line{display:block;margin:0;padding:1px 4px;border-radius:3px;background:var(--vcs-bg);color:var(--vcs-dim);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}',
  // 类型徽章：读 / 写 / 毁 / 警告 / 正常五种语气，靠令牌换肤，不在规则里写颜色。
  '[data-vc-shell] .badge{flex:0 0 auto;display:inline-block;padding:0 5px;border:1px solid var(--vcs-line);border-radius:999px;font-size:10.5px;line-height:1.6;white-space:nowrap}',
  '[data-vc-shell] .badge.is-read{color:var(--vcs-dim)}',
  '[data-vc-shell] .badge.is-write{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  '[data-vc-shell] .badge.is-danger{color:var(--vcs-danger);border-color:var(--vcs-danger)}',
  '[data-vc-shell] .badge.is-warn{color:var(--vcs-warn);border-color:var(--vcs-warn)}',
  '[data-vc-shell] .badge.is-ok{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  // 一行里的动作组：靠右排，窄档由外层 obj-side 统一换行到左。
  '[data-vc-shell] .page-row-actions{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;min-width:0}',
  // 行内表单：路径与地址两栏并排，窄档各占一整行；输入框宽度只受容器约束，不写固定像素。
  '[data-vc-shell] .inline-form{display:flex;flex-wrap:wrap;align-items:flex-end;gap:6px;min-width:0;margin-top:4px}',
  '[data-vc-shell] .inline-field{display:flex;flex:1 1 140px;flex-direction:column;gap:2px;min-width:0}',
  '[data-vc-shell] .inline-label{color:var(--vcs-dim);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .inline-input{box-sizing:border-box;width:100%;min-width:0;padding:3px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-bg);color:var(--vcs-fg);font:inherit;font-size:12px}',
  '[data-vc-shell] .inline-input:focus-visible{outline:1px solid var(--vcs-accent);outline-offset:0}',
  // 主操作按钮：整页只留一个「现在就做」的入口用主色实底，其余按钮沿用壳里的普通按钮样式。
  '[data-vc-shell] .btn-primary{flex:0 0 auto;padding:3px 8px;border:1px solid var(--vcs-accent);border-radius:4px;background:var(--vcs-accent);color:var(--vcs-bg);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .btn-primary:disabled{opacity:.6;cursor:default}',
  // 空态块：虚线框 + 居中标题与说明，空态也要能评审，所以保留真实结构而不是拿演示行填满。
  '[data-vc-shell] .empty-block{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;padding:10px 8px;border:1px dashed var(--vcs-line);border-radius:6px;text-align:center}',
  '[data-vc-shell] .empty-title{margin:0;font-size:13px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .empty-hint{margin:0;max-width:100%;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  // 300 宽：行内表单每栏独占一行，避免两个输入框挤成一条细缝看不清标签。
  '[data-vc-shell][data-vc-width="300"] .inline-field{flex-basis:100%}',
  '[data-vc-shell][data-vc-width="300"] .page-row-actions{justify-content:flex-start}',
  // 380 与 300 两档：事实网格收成一列；300 档再收起层级、条数与分支事实这几项次要信息，入口不删。
  '[data-vc-shell][data-vc-width="380"] .fact-grid{grid-template-columns:minmax(0,1fr)}',
  '[data-vc-shell][data-vc-width="300"] .fact-grid{grid-template-columns:minmax(0,1fr)}',
  '[data-vc-shell][data-vc-width="300"] .vcs-page-depth{display:none}',
  '[data-vc-shell][data-vc-width="300"] .vcs-manage-card-count{display:none}',
  '[data-vc-shell][data-vc-width="300"] .vcs-branch-facts{display:none}',
  '[data-vc-shell][data-vc-width="300"] .vcs-page-title{font-size:14px}',
  '[data-vc-shell][data-vc-width="300"] .obj-side{flex:1 1 100%;justify-content:flex-start}',
].join('\n')
