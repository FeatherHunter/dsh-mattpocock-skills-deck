// views/versionControl/vcBranchStyles.ts —— 「分支与标签」页自己的样式（#1858）
// 契约：模块真源（ESM 导出）；构建时剥行首 export 拼回闭包，经同一个 styles.insert 接缝注入 ——
// 不是第二个 <style>，也没有新的注入机制。
//
// 为什么单独一片：本页按定稿原型 38 重排之后用到的一组类（对象行 .obj-* 的三行结构、筛选与搜索框、
// 行尾动作、段内空态与失败条）只服务这一页。按 #1858 票面的边界，这些规则写进本页自己的样式文件，
// 不往 vcPageStyles / vcShellStyles 这类多页共用的样式文件里加。
//
// 三条硬规矩：
//   1. 每条规则都以 [data-vc-shell] .vcs-branch2 开头：只作用于本页根节点，
//      别处（钩子页、配置页、子模块页）的 .obj-* 一行都不受影响；
//   2. 颜色一律用 --vcs-* 令牌，不写死色值；浅色皮肤只换令牌、不动这里的规则；
//   3. 数值照原型 docs/prototype/vc-redesign/styles/app.css：对象行 7px 8px、行内三行
//      11.5 / 9.5 / 10px、搜索框 28px 高与 11.5px 字、次要按钮 24px 高与 11px 字。
//      四档宽都不许横向溢出：长分支名、长上游一律允许在词内换行。
// MOTION 由构建拼进同一个闭包（kernel:motion 片排在视图片之前）：动效时长只有 motion.ts 一份真源。
declare const MOTION: any

export const VC_BRANCH_STYLE_TEXT: string[] = [
  // 页面根：三段之间 12px（原型 .page-stack），每段自己的下外边距归零，避免叠加成 24px。
  '[data-vc-shell] .vcs-branch2{display:flex;flex-direction:column;gap:12px;padding:0;min-width:0}',
  '[data-vc-shell] .vcs-branch2 .page-section{margin:0}',
  // 筛选与搜索：原型把三颗筛选胶囊排一行、搜索框单独占一行（.page-filters + .page-search）。
  '[data-vc-shell] .vcs-branch2 .page-filters{display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0}',
  '[data-vc-shell] .vcs-branch2 .page-search{display:block;min-width:0}',
  '[data-vc-shell] .vcs-branch2 .page-search-input{width:100%;min-height:28px;padding:0 9px;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-btn);background:var(--vcs-inset);color:var(--vcs-fg);font:inherit;font-size:11.5px;transition:border-color ' + MOTION.hoverFadeMs + 'ms ease,background ' + MOTION.hoverFadeMs + 'ms ease}',
  '[data-vc-shell] .vcs-branch2 .page-search-input::placeholder{color:var(--vcs-faint)}',
  '[data-vc-shell] .vcs-branch2 .page-search-input:hover{border-color:var(--vcs-dim)}',
  '[data-vc-shell] .vcs-branch2 .page-search-input:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:0;border-color:var(--vcs-accent)}',
  // 行列表：一条行一条描边卡片，行与行之间 5px（原型 .obj-list）。
  '[data-vc-shell] .vcs-branch2-list{display:flex;flex-direction:column;gap:5px;min-width:0}',
  // 对象行：一行三件事——它是什么（标题行）、现在什么状态（等宽事实行）、最近发生了什么（说明行）。
  //   .obj-row / .obj-side 的外框与左右分栏由共用样式给；这里只补本页用到的三行结构与原型尺寸。
  '[data-vc-shell] .vcs-branch2 .obj-list{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none;min-width:0}',
  '[data-vc-shell] .vcs-branch2 .obj-main{display:flex;flex-direction:column;gap:2px}',
  '[data-vc-shell] .vcs-branch2 .obj-title{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:11.5px;font-weight:650;line-height:1.45;color:var(--vcs-fg);overflow-wrap:anywhere;min-width:0}',
  '[data-vc-shell] .vcs-branch2 .obj-sub{font-size:10px;line-height:1.55;color:var(--vcs-dim);overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch2 .obj-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-family:var(--vcs-mono);font-size:9.5px;line-height:1.5;color:var(--vcs-faint);overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch2 .obj-oid{font-family:var(--vcs-mono);font-size:9.5px;color:var(--vcs-faint)}',
  '[data-vc-shell] .vcs-branch2 .obj-side{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:5px;flex-wrap:wrap;max-width:55%;min-width:0}',
  // 分支名与标签名用等宽字体，长名字在词内换行（300 宽不许撑破行）。
  '[data-vc-shell] .vcs-branch2-name{font-family:var(--vcs-mono);font-size:11.5px;color:var(--vcs-fg);overflow-wrap:anywhere;min-width:0}',
  // 两枚小标记：当前分支（info 色）与附注标签（中性色）。尺寸照原型的 chip-sm。
  '[data-vc-shell] .vcs-branch2-current{display:inline-flex;align-items:center;min-height:16px;padding:0 4px;border:1px solid color-mix(in srgb,var(--vcs-info) 40%,transparent);border-radius:var(--vcs-r-sm);background:var(--vcs-info-soft);color:var(--vcs-info);font-size:9.5px;line-height:1.5;white-space:nowrap}',
  '[data-vc-shell] .vcs-branch2-tag{display:inline-flex;align-items:center;min-height:16px;padding:0 4px;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-sm);background:var(--vcs-raised);color:var(--vcs-dim);font-size:9.5px;line-height:1.5;white-space:nowrap}',
  // 行尾动作与行内表单里的按钮：次要按钮的尺寸（原型 .btn.btn-sm 24px 高、11px 字）。
  //   全局按钮规则会把字级与单行省略带进来，这里把字号、内边距与换行口径覆盖回原型。
  '[data-vc-shell] .vcs-branch2-act{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:0 9px;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-btn);background:var(--vcs-raised);color:var(--vcs-ink2);font:inherit;font-size:11px;font-weight:650;line-height:1.4;white-space:nowrap;cursor:pointer;max-width:none;overflow:visible;text-overflow:clip}',
  '[data-vc-shell] .vcs-branch2-act:hover{background:var(--vcs-hover);border-color:var(--vcs-dim);color:var(--vcs-fg)}',
  '[data-vc-shell] .vcs-branch2-act:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:1px}',
  // 删除分支 / 删除标签这一颗是危险动作：红边红字，但形状与别的按钮一致（不让它靠大小抢注意力）。
  '[data-vc-shell] .vcs-branch2-danger{border-color:color-mix(in srgb,var(--vcs-danger) 55%,var(--vcs-line-2));background:color-mix(in srgb,var(--vcs-danger) 7%,var(--vcs-raised));color:var(--vcs-danger)}',
  '[data-vc-shell] .vcs-branch2-danger:hover{background:var(--vcs-danger-soft);border-color:var(--vcs-danger);color:var(--vcs-danger)}',
  // 行内展开的动作块（#1881 的行尾「⋯」菜单）：summary 画成一颗次要按钮，展开后在行内铺满一整行。
  //   .obj-side 平时最多占 55%，菜单若被关在这半行里，五条动作每条都要折成两三行；所以有菜单展开的那一行
  //   把侧栏放宽到整行。:has 不支持的宿主会忽略这一条，退回 55% 的旧样子，不影响菜单本身可用。
  '[data-vc-shell] .vcs-branch2 .obj-row:has(.vcs-branch2-more[open]) .obj-side{max-width:100%;flex:1 1 100%}',
  '[data-vc-shell] .vcs-branch2-more{display:inline-block;min-width:0}',
  '[data-vc-shell] .vcs-branch2-more[open]{flex:1 1 100%}',
  '[data-vc-shell] .vcs-branch2-more>summary{display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:0 9px;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-btn);background:var(--vcs-raised);color:var(--vcs-ink2);font-size:11px;font-weight:650;line-height:1.4;white-space:nowrap;cursor:pointer;list-style:none}',
  '[data-vc-shell] .vcs-branch2-more>summary::-webkit-details-marker{display:none}',
  '[data-vc-shell] .vcs-branch2-more>summary:hover{background:var(--vcs-hover);border-color:var(--vcs-dim);color:var(--vcs-fg)}',
  '[data-vc-shell] .vcs-branch2-more>summary:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:1px}',
  // 一个动作一行：一句说明 +（需要输入时）一格文本框 + 一颗执行按钮。
  '[data-vc-shell] .vcs-branch2-op{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;min-width:0}',
  '[data-vc-shell] .vcs-branch2-op-label{color:var(--vcs-dim);font-size:11px}',
  // 页尾两段折叠（名单与十个写动作）在段落里面，不再带页面级的左右外边距；summary 同样是次要按钮。
  '[data-vc-shell] .vcs-branch2 .vcs-branch2-lists{margin:0}',
  '[data-vc-shell] .vcs-branch2-forms{margin:0}',
  '[data-vc-shell] .vcs-branch2-summary{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 9px;border:1px solid var(--vcs-line-2);border-radius:var(--vcs-r-btn);background:var(--vcs-raised);color:var(--vcs-ink2);font-size:11px;font-weight:650;cursor:pointer;list-style:none;min-width:0;white-space:normal;overflow:visible;text-overflow:clip;max-width:none}',
  '[data-vc-shell] .vcs-branch2-summary::-webkit-details-marker{display:none}',
  '[data-vc-shell] .vcs-branch2-summary:hover{background:var(--vcs-hover);border-color:var(--vcs-dim);color:var(--vcs-fg)}',
  '[data-vc-shell] .vcs-branch2-summary:focus-visible{outline:2px solid var(--vcs-accent);outline-offset:1px}',
  '[data-vc-shell] .vcs-branch2-names{margin:2px 0;color:var(--vcs-dim);font-size:11px;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch2 .vcs-branch2-h{margin:4px 0 0;color:var(--vcs-dim);font-size:11px;font-weight:650}',
  // 页内三句说明：筛选口径、读取失败、版本门。都允许换行，左右不加外边距（段落已经给了内边距）。
  '[data-vc-shell] .vcs-branch2-note{margin:0;color:var(--vcs-faint);font-size:10px;line-height:1.55;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch2-warn{margin:0;padding:6px 8px;border:1px solid color-mix(in srgb,var(--vcs-warn) 40%,var(--vcs-line-2));border-radius:var(--vcs-r-btn);background:color-mix(in srgb,var(--vcs-warn) 8%,transparent);color:var(--vcs-warn);font-size:10px;line-height:1.55;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch2-error{margin:0;padding:6px 8px;border:1px solid color-mix(in srgb,var(--vcs-danger) 45%,var(--vcs-line-2));border-radius:var(--vcs-r-btn);background:var(--vcs-danger-soft);color:var(--vcs-danger);font-size:10px;line-height:1.55;overflow-wrap:anywhere}',
  // 失败条与空态都是「几行字 + 一颗按钮」的竖排：按钮在下一行，不跟句子挤在一起。
  '[data-vc-shell] .vcs-branch2-error,[data-vc-shell] .vcs-branch2-warn{display:flex;flex-direction:column;gap:5px;align-items:flex-start}',
  '[data-vc-shell] .vcs-branch2-nodata{display:flex;flex-direction:column;gap:6px;align-items:flex-start;padding:8px 9px;border:1px dashed var(--vcs-line-2);border-radius:var(--vcs-r-md);min-width:0}',
  // 段内空态：标题一句、下一步一句；不画假行、不留空白。
  '[data-vc-shell] .vcs-branch2-empty,[data-vc-shell] .vcs-branch2-empty-filter{display:flex;flex-direction:column;gap:2px;margin:0;padding:7px 8px;border:1px dashed var(--vcs-line-2);border-radius:var(--vcs-r-btn);color:var(--vcs-dim);font-size:10.5px;line-height:1.55;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch2-empty-title{font-weight:650;color:var(--vcs-ink2)}',
  '[data-vc-shell] .vcs-branch2-empty-next{color:var(--vcs-faint);font-size:10px}',
  '[data-vc-shell] .vcs-branch2-error-text{color:var(--vcs-danger);font-size:10.5px;line-height:1.55;overflow-wrap:anywhere}',
  '[data-vc-shell] .vcs-branch2-scope{margin:0;color:var(--vcs-faint);font-size:9.5px;font-family:var(--vcs-mono)}',
  // 窄档（300 / 380）：原型在 440 以下把对象行从「左边正文、右边动作」改成「正文一行、动作一行」
  //   （app.css 的 @container panel (max-width: 439px)：.obj-row 换列、.obj-side 放开宽度并左对齐）——
  //   55% 的宽度放不下两颗按钮加一行字，硬并排会把分支名挤成三四列窄条。这里照同一条规则写。
  '[data-vc-shell][data-vc-width="300"] .vcs-branch2 .obj-row,[data-vc-shell][data-vc-width="380"] .vcs-branch2 .obj-row{flex-direction:column;align-items:stretch}',
  '[data-vc-shell][data-vc-width="300"] .vcs-branch2 .obj-side,[data-vc-shell][data-vc-width="380"] .vcs-branch2 .obj-side{max-width:100%;justify-content:flex-start}',
  // 行内表单的说明在窄档独占一行，不再跟输入框挤成两三列。
  '[data-vc-shell][data-vc-width="300"] .vcs-branch2 .vcs-branch2-op-label{flex:1 1 100%}',
]
