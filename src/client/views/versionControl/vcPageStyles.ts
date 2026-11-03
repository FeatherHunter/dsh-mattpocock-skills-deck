// views/versionControl/vcPageStyles.ts —— 页面重做新增的样式（#1829 阶段 4；#1840 按定稿原型对齐）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回同一个闭包，运行时由 index.ts 拼进同一个 style 元素。
//
// 本文件只放 #1829 / #1840 新加的样式，老壳的样式仍在 vcShellStyles.ts；注入顺序在本文件之后，所以同名选择器以后者为准。
// 四条硬规矩：
//   1. 每条规则都以 [data-vc-shell] 开头，样式只作用于版本管理根节点，不外泄到插件的其它界面；
//   2. 颜色一律用 --vcs-* 令牌，不写死色值，浅色皮肤只换令牌、不动这里的规则；
//   3. 数值照定稿原型 docs/prototype/vc-redesign/styles/app.css（页头 8px 12px 7px、标题 13.5px/750、
//      导语 10.5px、管理卡 9px 内边距、卡片网格 auto-fit minmax(148px,1fr)），不自己发明尺寸；
//   4. 四档宽（300 / 380 / 460 / 520）都不许横向溢出：长标题、长路径、长命令一律允许在词内换行，
//      300 宽按原型把页头与正文的左右内边距收到 10px，卡片的条数与「打开」一个都不删。
// MOTION 由构建拼进同一个闭包（kernel:motion 片排在视图片之前）：动效时长只有 motion.ts 一份真源，
declare const MOTION: any

export const VC_PAGE_STYLE_TEXT = [
  // 根节点补定位：命令面板遮罩与分支浮层要贴着整个版本管理界面铺满，不能定位到更外层去。
  '[data-vc-shell]{position:relative}',
  // 页面骨架：section.vcs-page-body 竖排「固定页头 + 可滚动正文」，正文区自己带内边距。
  //   原型里页头与正文分属 .page-head / .page-scroll 两块；插件不另做内层滚动容器（高度链不由本页掌握），
  //   只把两块的间距与内边距照原型给足，视觉顶边与原型一致。
  '[data-vc-shell] .vcs-page-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;padding:0;background:var(--vcs-bg)}',
  '[data-vc-shell] .vcs-page-scroll{flex:1 1 auto;min-height:0;min-width:0;padding:10px 12px 18px}',
  // 页头：标题行（返回键 + 标题 + 计数）与导语两段，外框只留一条底线。
  '[data-vc-shell] .vcs-page-head{display:flex;flex-direction:column;gap:4px;flex:none;padding:8px 12px 7px;border-bottom:1px solid var(--vcs-line);min-width:0;background:var(--vcs-bg)}',
  '[data-vc-shell] .vcs-page-title-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
  // 返回键：透明底、灰字，悬停才浮出背景与描边；原型 11px/650，图标 14px，文字 10.5px。
  //   上面的全局按钮规则会把它画成面板色小按钮，所以这里把背景、边框、内边距全部覆盖回原型。
  '[data-vc-shell] .vcs-page-back{display:inline-flex;align-items:center;gap:4px;flex:none;min-height:22px;padding:0 6px 0 2px;border:1px solid transparent;border-radius:var(--vcs-r-btn);background:transparent;color:var(--vcs-dim);font:inherit;font-size:11px;font-weight:650;cursor:pointer;max-width:none;overflow:visible;text-overflow:clip;white-space:nowrap}',
  '[data-vc-shell] .vcs-page-back:hover{background:var(--vcs-hover);border-color:var(--vcs-line-2);color:var(--vcs-fg)}',
  '[data-vc-shell] .vcs-page-back:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:1px}',
  '[data-vc-shell] .vcs-page-back-label{font-size:10.5px}',
  // 标题允许在词内换行：300 宽时「迁移与备份」这类长页名不会把整行撑横。
  '[data-vc-shell] .vcs-page-title{margin:0;font-size:13.5px;font-weight:750;line-height:1.35;color:var(--vcs-fg);overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-page-title:focus{outline:none}',
  // 计数画成原型的小号 chip（chip-sm 尺寸：16px 高、9.5px 字），不再用大圆角胶囊。
  '[data-vc-shell] .vcs-page-count{display:inline-flex;align-items:center;min-height:16px;padding:0 4px;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-sm);background:var(--vcs-raised);color:var(--vcs-dim);font-size:9.5px;line-height:1.5;white-space:nowrap}',
  '[data-vc-shell] .vcs-page-lede{margin:0;color:var(--vcs-dim);font-size:10.5px;line-height:1.6;overflow-wrap:anywhere}',
  // 分区：段与段之间靠 12px 间距分开（原型 .page-section 不画分隔线），危险区只靠标题旁的 chip 提示。
  '[data-vc-shell] .page-section{display:flex;flex-direction:column;gap:5px;margin:0 0 12px;padding:0;border:0;min-width:0}',
  '[data-vc-shell] .section-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:7px;min-width:0}',
  '[data-vc-shell] .section-title{margin:0;font-size:12px;font-weight:700;color:var(--vcs-fg);overflow-wrap:anywhere}',
  '[data-vc-shell] .section-count{flex:0 0 auto;font-family:var(--vcs-mono);font-size:9.5px;color:var(--vcs-faint)}',
  '[data-vc-shell] .section-danger{flex:0 0 auto;display:inline-flex;align-items:center;min-height:16px;padding:0 4px;border:1px solid color-mix(in srgb,var(--vcs-danger) 40%,transparent);border-radius:var(--vcs-r-sm);background:var(--vcs-danger-soft);color:var(--vcs-danger);font-size:9.5px;line-height:1.5;white-space:nowrap}',
  '[data-vc-shell] .section-note{margin:0 0 2px;color:var(--vcs-faint);font-size:10px;line-height:1.6;overflow-wrap:anywhere}',
  // 折叠段：原型是一个带描边的圆角盒子，标题行里 chevron 收起时朝右、展开时朝下；
  //   不存在原生的 details 三角（marker 一律收起），点击整行切换。
  '[data-vc-shell] .fold{margin:0;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-md);background:var(--vcs-inset);overflow:hidden;min-width:0}',
  '[data-vc-shell] .fold-head{display:flex;align-items:center;gap:6px;width:100%;padding:7px 9px;border:0;background:transparent;color:var(--vcs-ink2);font:inherit;font-size:11px;font-weight:650;line-height:1.4;text-align:left;cursor:pointer;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;max-width:none;list-style:none}',
  '[data-vc-shell] .fold-head::-webkit-details-marker{display:none}',
  '[data-vc-shell] .fold-head:hover{background:var(--vcs-hover);color:var(--vcs-fg)}',
  '[data-vc-shell] .fold-head:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:-1px}',
  '[data-vc-shell] .fold-chevron{flex:none;display:inline-flex;color:var(--vcs-faint)}',
  '[data-vc-shell] .fold-chevron svg{transform:rotate(-90deg);transition:transform ' + MOTION.hoverFadeMs + 'ms ease}',
  '[data-vc-shell] .fold[open] .fold-chevron svg{transform:none}',
  '[data-vc-shell] .fold-title{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
  '[data-vc-shell] .fold-count{flex:0 0 auto;margin-left:auto;font-family:var(--vcs-mono);font-size:9.5px;color:var(--vcs-faint)}',
  '[data-vc-shell] .fold-note{margin:0;padding:0 9px 7px;color:var(--vcs-faint);font-size:10px;line-height:1.55;overflow-wrap:anywhere}',
  '[data-vc-shell] .fold-body{display:flex;flex-direction:column;gap:6px;padding:8px 9px 9px;border-top:1px dashed var(--vcs-line);min-width:0}',
  // 事实网格：原型按容器宽度自动排 150px 一格的列；每格是「小标题 + 值」的竖排，不画边框与底色。
  '[data-vc-shell] .fact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px 10px;margin:0;min-width:0}',
  '[data-vc-shell] .fact-cell{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '[data-vc-shell] .fact-key{margin:0;font-family:var(--vcs-mono);font-size:9.5px;color:var(--vcs-faint);overflow-wrap:anywhere}',
  '[data-vc-shell] .fact-value{margin:0;font-size:11px;line-height:1.5;color:var(--vcs-ink2);overflow-wrap:anywhere}',
  '[data-vc-shell] .fact-value.is-mono{font-family:var(--vcs-mono);font-size:11px}',
  '[data-vc-shell] .fact-value.is-muted{color:var(--vcs-dim)}',
  '[data-vc-shell] .fact-value.is-warn{color:var(--vcs-warn)}',
  '[data-vc-shell] .fact-value.is-error{color:var(--vcs-danger)}',
  // 对象行：原型是浅底圆角行，左边主体吃掉剩余宽度，右边次要信息靠右；危险行换成警示色描边。
  '[data-vc-shell] .obj-row{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border:1px solid var(--vcs-line);border-radius:var(--vcs-r-btn);background:color-mix(in srgb,var(--vcs-inset) 55%,transparent);min-width:0}',
  '[data-vc-shell] .obj-row.is-danger{border-color:color-mix(in srgb,var(--vcs-danger) 45%,var(--vcs-line));background:color-mix(in srgb,var(--vcs-danger-soft) 45%,transparent)}',
  '[data-vc-shell] .obj-main{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}',
  '[data-vc-shell] .obj-side{flex:none;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:5px;max-width:55%;min-width:0}',
  // 管理索引屏：原型是 .page-stack 竖排，块与块之间 12px；九张卡是 auto-fit 网格，卡内 9px 内边距。
  '[data-vc-shell] .vcs-manage-page{display:flex;flex-direction:column;gap:12px;min-width:0;padding:0}',
  '[data-vc-shell] .vcs-manage-note{margin:0;color:var(--vcs-dim);font-size:10.5px;line-height:1.6;overflow-wrap:anywhere}',
  // 索引本体不再带壳的底色、描边与内边距：它现在是一屏内容，不是身份行下面的小面板。
  '[data-vc-shell] .vcs-manage-index{padding:0;border:0;background:transparent;min-width:0}',
  '[data-vc-shell] .vcs-manage-index .vcs-gear-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:7px;margin:0;padding:0;list-style:none}',
  '[data-vc-shell] .vcs-manage-index .vcs-gear-li{list-style:none;min-width:0}',
  // 管理卡与两条跨区入口都是 <button>，而全局按钮规则把它们定成单行省略；
  // 卡片上的覆盖口径是整句话，单行放不下就会被裁掉，所以这三处都改回换行并允许溢出的正常布局。
  '[data-vc-shell] .vcs-manage-card{display:flex;flex-direction:column;gap:5px;width:100%;min-width:0;padding:9px;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-md);background:var(--vcs-inset);color:inherit;text-align:left;cursor:pointer;transition:background ' + MOTION.hoverFadeMs + 'ms ease,border-color ' + MOTION.hoverFadeMs + 'ms ease;white-space:normal;overflow:visible;text-overflow:clip;max-width:none}',
  '[data-vc-shell] .vcs-manage-card:hover{border-color:var(--vcs-accent);background:color-mix(in srgb,var(--vcs-accent-soft) 45%,var(--vcs-inset))}',
  '[data-vc-shell] .vcs-manage-card:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:1px}',
  '[data-vc-shell] .vcs-manage-card.is-danger{border-color:color-mix(in srgb,var(--vcs-danger) 35%,var(--vcs-line-2))}',
  '[data-vc-shell] .vcs-manage-card.is-danger:hover{border-color:var(--vcs-danger);background:color-mix(in srgb,var(--vcs-danger-soft) 40%,var(--vcs-inset))}',
  '[data-vc-shell] .vcs-manage-card-head{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}',
  '[data-vc-shell] .vcs-manage-card-title{margin:0;font-size:12px;font-weight:700;color:var(--vcs-fg);overflow-wrap:anywhere}',
  // 卡头右上角是范围摘要：等宽 9px、右对齐，和原型一样靠 margin-left:auto 顶到行尾。
  '[data-vc-shell] .vcs-manage-card-count{margin-left:auto;font-family:var(--vcs-mono);font-size:9px;line-height:1.45;color:var(--vcs-faint);text-align:right}',
  '[data-vc-shell] .vcs-manage-card-danger{flex:0 0 auto;display:inline-flex;align-items:center;min-height:16px;padding:0 4px;border:1px solid color-mix(in srgb,var(--vcs-danger) 40%,transparent);border-radius:var(--vcs-r-sm);background:var(--vcs-danger-soft);color:var(--vcs-danger);font-size:9.5px;line-height:1.5;white-space:nowrap}',
  '[data-vc-shell] .vcs-manage-card-text{font-size:10px;line-height:1.55;color:var(--vcs-dim);overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-manage-card-foot{display:flex;align-items:center;gap:6px;margin-top:auto;min-width:0}',
  '[data-vc-shell] .vcs-manage-card-caps{font-family:var(--vcs-mono);font-size:9px;color:var(--vcs-faint)}',
  // 「打开」始终贴在卡片脚部右侧（margin-left:auto），后面跟一枚 11px 的 chevron。
  '[data-vc-shell] .vcs-manage-card-go{display:inline-flex;align-items:center;gap:1px;margin-left:auto;font-size:10px;font-weight:650;color:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-manage-card-chevron{display:inline-flex}',
  // 两条跨区入口：原型是虚线框整行按钮，左边一枚小箭头，悬停浮出强调色。
  '[data-vc-shell] .vcs-manage-shortcuts{display:flex;flex-direction:column;gap:5px;min-width:0}',
  '[data-vc-shell] .vcs-manage-shortcut{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:1px dashed var(--vcs-line-2);border-radius:var(--vcs-r-btn);background:transparent;color:var(--vcs-dim);font:inherit;font-size:10.5px;text-align:left;cursor:pointer;transition:background ' + MOTION.hoverFadeMs + 'ms ease,border-color ' + MOTION.hoverFadeMs + 'ms ease,color ' + MOTION.hoverFadeMs + 'ms ease;white-space:normal;overflow:visible;text-overflow:clip;max-width:none}',
  '[data-vc-shell] .vcs-manage-shortcut:hover{border-color:var(--vcs-accent);background:var(--vcs-accent-soft);color:var(--vcs-fg)}',
  '[data-vc-shell] .vcs-manage-shortcut:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:1px}',
  '[data-vc-shell] .vcs-manage-shortcut-chevron{flex:none;display:inline-flex;color:var(--vcs-faint)}',
  '[data-vc-shell] .vcs-manage-shortcut-label{min-width:0;overflow-wrap:anywhere}',
  // 覆盖口径：整行虚线框，左边一枚 info 色小 chip，中间一句说明，右边四个计数。
  '[data-vc-shell] .vcs-coverage-note{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0;padding:8px 9px;border:1px dashed var(--vcs-line-2);border-radius:var(--vcs-r-md);color:var(--vcs-dim);font-size:10px;line-height:1.55;min-width:0}',
  '[data-vc-shell] .vcs-coverage-chip{flex:0 0 auto;display:inline-flex;align-items:center;min-height:16px;padding:0 4px;border:1px solid color-mix(in srgb,var(--vcs-info) 38%,transparent);border-radius:var(--vcs-r-sm);background:var(--vcs-info-soft);color:var(--vcs-info);font-size:9.5px;line-height:1.5;white-space:nowrap}',
  '[data-vc-shell] .vcs-coverage-text{flex:1 1 160px;min-width:0;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-coverage-count{flex:0 0 auto;font-family:var(--vcs-mono);font-size:9.5px;color:var(--vcs-faint)}',
  // 命令面板遮罩：只有壳直接挂的那一份（浮层用法）才铺满整个版本管理界面贴根定位；
  // 命令面板遮罩：只作为浮层出现（#1846 起全库搜索页自己画输入框与结果，不再把面板嵌在能力行里），
  //   由壳直接挂在页面根下，铺满整个版本管理界面、贴着触发它的那颗放大镜定位。
  '[data-vc-shell]>.vcs-palette-backdrop{position:absolute;inset:0;z-index:5;display:flex;align-items:flex-start;justify-content:center;padding:8px;background:var(--vcs-bg);overflow:auto}',
  '[data-vc-shell] .vcs-palette-backdrop{min-width:0}',
  '[data-vc-shell] .vcs-pal-panel{position:relative;display:flex;flex-direction:column;width:100%;max-width:520px;max-height:100%;overflow:auto;border:1px solid var(--vcs-line);border-radius:6px;background:var(--vcs-panel)}',
  '[data-vc-shell] .vcs-pal-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 8px;border-top:1px solid var(--vcs-line);color:var(--vcs-dim);font-size:11px;line-height:1.6}',
  '[data-vc-shell] .vcs-pal-close{margin-left:auto;flex:0 0 auto;padding:1px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-bg);color:var(--vcs-dim);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .vcs-pal-close:hover{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  // 全库搜索页自己的版式（#1846）：输入框在首屏，结果按能力所属页面分组；行内字段排不下就换行。
  //   300 宽一档靠 flex-wrap 与 overflow-wrap 兜住，不加横向滚动条。
  '[data-vc-shell] .vcs-search{display:flex;flex-direction:column;gap:6px;min-width:0;padding:6px 0}',
  '[data-vc-shell] .vcs-search-note{margin:0;color:var(--vcs-dim);font-size:11px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-search-box{display:flex;min-width:0}',
  '[data-vc-shell] .vcs-search-input{width:100%;min-width:0;padding:4px 8px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:13px}',
  '[data-vc-shell] .vcs-search-empty{margin:0;padding:6px 8px;border:1px dashed var(--vcs-line);border-radius:4px;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-search-count{margin:0;color:var(--vcs-dim);font-size:11px}',
  '[data-vc-shell] .vcs-search-group{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '[data-vc-shell] .vcs-search-group-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;min-width:0}',
  '[data-vc-shell] .vcs-search-group-title{margin:0;font-size:12px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-search-group-count{color:var(--vcs-dim);font-size:11px}',
  '[data-vc-shell] .vcs-search-rows{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;min-width:0}',
  '[data-vc-shell] .vcs-search-li{min-width:0}',
  '[data-vc-shell] .vcs-search-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 6px;width:100%;min-width:0;padding:3px 8px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
  '[data-vc-shell] .vcs-search-row:hover{border-color:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-search-row[data-vc-search-hit="1"]{border-color:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-search-id{flex:0 0 auto;color:var(--vcs-dim);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}',
  '[data-vc-shell] .vcs-search-name{flex:1 1 120px;min-width:0;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-search-where{flex:0 1 auto;color:var(--vcs-accent);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-search-cmd{flex:1 1 100%;min-width:0;color:var(--vcs-dim);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-search-need{flex:1 1 100%;color:var(--vcs-warn);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-search-more{margin:0;color:var(--vcs-dim);font-size:11px;line-height:1.6}',
  // 分支浮层头部：标题、事实与关闭键排一行；事实区可换行，窄档整块收起。
  '[data-vc-shell] .vcs-branch-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;padding:4px 8px;border-bottom:1px solid var(--vcs-line);min-width:0}',
  '[data-vc-shell] .vcs-branch-title{min-width:0;font-size:13px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch-facts{display:flex;flex-wrap:wrap;gap:2px 8px;color:var(--vcs-dim);font-size:11px;min-width:0}',
  '[data-vc-shell] .vcs-branch-close{margin-left:auto;flex:0 0 auto;padding:1px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-dim);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .vcs-branch-close:hover{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  // 流程页小部件（#1845）：状态芯片、进度条、贴触发点的提示。颜色一律走令牌，浅色只换令牌。
  //   vcs-flow-btn 家族（基础、禁用、危险）给任务页的取消按钮用，不另起一套按钮样式。
  '[data-vc-shell] .vcs-flow-chip{display:inline-block;flex:0 0 auto;padding:0 6px;border:1px solid var(--vcs-line);border-radius:999px;color:var(--vcs-dim);font-size:11px;line-height:1.7;white-space:nowrap}',
  '[data-vc-shell] .vcs-flow-chip-ok{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-flow-chip-warn{color:var(--vcs-warn);border-color:var(--vcs-warn)}',
  '[data-vc-shell] .vcs-flow-chip-danger{color:var(--vcs-danger);border-color:var(--vcs-danger)}',
  '[data-vc-shell] .vcs-flow-btn{flex:0 1 auto;padding:2px 10px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:12px;cursor:pointer;overflow-wrap:anywhere;white-space:normal}',
  '[data-vc-shell] .vcs-flow-btn:disabled{color:var(--vcs-dim);cursor:default}',
  '[data-vc-shell] .vcs-flow-btn-danger{border-color:var(--vcs-danger);color:var(--vcs-danger)}',
  '[data-vc-shell] .vcs-flow-meter{position:relative;display:flex;align-items:center;gap:6px;margin:4px 0;min-width:0;height:20px;border:1px solid var(--vcs-line);border-radius:999px;background:var(--vcs-panel);overflow:hidden}',
  '[data-vc-shell] .vcs-flow-meter-bar{height:100%;min-width:2px;border-radius:999px;background:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-flow-meter-label{position:absolute;right:8px;top:50%;transform:translateY(-50%);color:var(--vcs-fg);font-size:11px;font-variant-numeric:tabular-nums}',
  '[data-vc-shell] .vcs-flow-hint{margin:4px 0;padding:4px 8px;border-left:3px solid var(--vcs-warn);border-radius:0 4px 4px 0;background:var(--vcs-panel);min-width:0}',
  '[data-vc-shell] .vcs-flow-hint-text{margin:0;color:var(--vcs-warn);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-flow-hint-go{margin-top:4px;padding:1px 8px;border:1px solid var(--vcs-warn);border-radius:4px;background:transparent;color:var(--vcs-warn);font:inherit;font-size:12px;cursor:pointer}',
  // 三个流程页都要给 git 命令一行等宽灰底（原型 48/49/50 的同一处细节）：类名叫 vcs-flow-cmd，任务页与冲突页共用。
  '[data-vc-shell] .vcs-flow-cmd{margin:2px 0 0;padding:2px 6px;display:inline-block;max-width:100%;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-bg);color:var(--vcs-dim);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;line-height:1.6;overflow-wrap:anywhere}',
  // 配置页（#1842）：页头下的一行元信息、身份可编辑行、只读读数行、两个查询行、确认卡与结果条。
  // 可写与只读的差别落在结构上：只有身份组里出现输入框与保存/删除按钮，只读三组只画事实格。
  '[data-vc-shell] .vcs-config-meta{display:flex;flex-wrap:wrap;gap:2px 8px;margin:0 0 4px;color:var(--vcs-dim);font-size:11px;min-width:0}',
  '[data-vc-shell] .vcs-config-meta-key{color:var(--vcs-dim)}',
  '[data-vc-shell] .vcs-config-meta-value{min-width:0;color:var(--vcs-fg);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-id-rows{display:flex;flex-direction:column;gap:6px;margin-top:6px}',
  '[data-vc-shell] .vcs-config-id-row{display:flex;flex-direction:column;gap:3px;min-width:0;padding:5px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-bg)}',
  '[data-vc-shell] .vcs-config-id-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;min-width:0}',
  '[data-vc-shell] .vcs-config-id-key{font-size:12px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-old{color:var(--vcs-dim);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-id-controls{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}',
  '[data-vc-shell] .vcs-config-input{flex:1 1 140px;min-width:0;padding:2px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:12px}',
  '[data-vc-shell] .vcs-config-input:focus-visible{outline:1px solid var(--vcs-accent);outline-offset:1px}',
  '[data-vc-shell] .vcs-config-select{flex:0 1 auto;max-width:100%;padding:2px 6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:12px}',
  '[data-vc-shell] .vcs-config-btn{flex:0 0 auto;padding:2px 8px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .vcs-config-btn:disabled{color:var(--vcs-dim);cursor:default}',
  '[data-vc-shell] .vcs-config-danger{border-color:var(--vcs-danger);color:var(--vcs-danger)}',
  '[data-vc-shell] .vcs-config-group-empty{margin:4px 0;color:var(--vcs-dim);font-size:12px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-read-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:4px 0;min-width:0}',
  '[data-vc-shell] .vcs-config-read-label{font-size:12px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-read-state{color:var(--vcs-dim);font-size:12px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-read-err{color:var(--vcs-danger);font-size:12px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-query{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;padding:4px 0;border-top:1px solid var(--vcs-line);min-width:0}',
  '[data-vc-shell] .vcs-config-query-label{flex:0 0 auto;font-size:12px;font-weight:600;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-query .vcs-config-input{flex:1 1 180px}',
  '[data-vc-shell] .vcs-config-query-result{flex:1 1 100%;color:var(--vcs-dim);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-result{margin:6px 0;padding:4px 8px;border-left:3px solid var(--vcs-accent);background:var(--vcs-panel);font-size:12px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-config-result-fail{border-left-color:var(--vcs-danger);color:var(--vcs-danger)}',
  '[data-vc-shell] .vcs-config-confirm-wrap{margin:6px 0;padding:6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);min-width:0}',
  '[data-vc-shell] .vcs-config-confirm-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}',
  // 钩子页（#1842）：目录段的事实格、清单段的每文件一行（名字 + 标记 + 说明 + 运行入口）、手动运行段与结果输出。
  '[data-vc-shell] .vcs-hooks-install-note{margin:0 0 4px;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hooks-list{display:flex;flex-direction:column;padding:2px 0;gap:6px}',
  '[data-vc-shell] .vcs-hook-name-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 6px;min-width:0}',
  '[data-vc-shell] .vcs-hook-name{min-width:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hook-chip{flex:0 0 auto;padding:0 6px;border:1px solid var(--vcs-line);border-radius:999px;color:var(--vcs-dim);font-size:11px;line-height:1.7;white-space:nowrap}',
  '[data-vc-shell] .vcs-hook-chip.is-enabled{color:var(--vcs-accent);border-color:var(--vcs-accent)}',
  '[data-vc-shell] .vcs-hook-note{margin:2px 0 0;color:var(--vcs-dim);font-size:11px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hook-warn{display:inline-block;margin-top:2px;color:var(--vcs-warn);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hook-run-btn{flex:0 0 auto;padding:2px 8px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);color:var(--vcs-fg);font:inherit;font-size:12px;cursor:pointer}',
  '[data-vc-shell] .vcs-hook-run-btn:disabled{color:var(--vcs-dim);cursor:default}',
  '[data-vc-shell] .vcs-hooks-run-note{margin:0 0 4px;color:var(--vcs-dim);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hooks-gate{margin:4px 0;padding:4px 8px;border-left:3px solid var(--vcs-warn);background:var(--vcs-panel);color:var(--vcs-warn);font-size:12px;line-height:1.6;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hooks-gate span{display:block}',
  '[data-vc-shell] .vcs-hooks-result{margin:6px 0;padding:4px 8px;border-left:3px solid var(--vcs-accent);background:var(--vcs-panel);font-size:12px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hooks-result-fail{border-left-color:var(--vcs-danger);color:var(--vcs-danger)}',
  '[data-vc-shell] .vcs-hooks-output{margin:4px 0;padding:4px 6px;max-height:180px;overflow:auto;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-bg);color:var(--vcs-fg);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-hooks-confirm-wrap{margin:6px 0;padding:6px;border:1px solid var(--vcs-line);border-radius:4px;background:var(--vcs-panel);min-width:0}',
  '[data-vc-shell] .vcs-hooks-confirm-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}',
  // 窄档：输入框各占一整行，按钮换行不挤在一起；清单右侧的运行入口在 300 宽变成整行（.obj-side 的全宽规则在下面统一给）。
  '[data-vc-shell][data-vc-width="380"] .vcs-config-id-controls .vcs-config-input{flex:1 1 100%}',
  '[data-vc-shell][data-vc-width="300"] .vcs-config-id-controls .vcs-config-input{flex:1 1 100%}',
  '[data-vc-shell][data-vc-width="300"] .vcs-config-id-controls .vcs-config-btn{flex:1 1 auto}',
  '[data-vc-shell][data-vc-width="380"] .vcs-config-query .vcs-config-input{flex:1 1 100%}',
  '[data-vc-shell][data-vc-width="300"] .vcs-config-query .vcs-config-input{flex:1 1 100%}',
  '[data-vc-shell][data-vc-width="300"] .vcs-hook-run-btn{width:100%}',
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
  // 300 档（原型 @container panel max-width:359px）：页头与正文左右内边距收到 10px，事实网格单列，
  //   管理卡单列，返回键只留图标（原型 max-width:339px 的规则）。条数与「打开」不删。
  '[data-vc-shell][data-vc-width="300"] .vcs-page-head{padding-left:10px;padding-right:10px}',
  '[data-vc-shell][data-vc-width="300"] .vcs-page-scroll{padding-left:10px;padding-right:10px}',
  '[data-vc-shell][data-vc-width="300"] .vcs-page-back-label{display:none}',
  '[data-vc-shell][data-vc-width="300"] .fact-grid{grid-template-columns:minmax(0,1fr)}',
  '[data-vc-shell][data-vc-width="300"] .vcs-manage-index .vcs-gear-list{grid-template-columns:minmax(0,1fr)}',
  '[data-vc-shell][data-vc-width="300"] .obj-side{flex:1 1 100%;justify-content:flex-start;max-width:100%}',
].join('\n')
