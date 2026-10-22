/**
 * views/skillDetail/PixelStyles.ts — 技能详情像素风皮肤的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建直接读这份 .ts 真源、用 esbuild 当场转译，再剥行首 export
 * 拼回 src/client/index.ts 的样式标记处，与 kernel/styles.js、vcStyles.js 同一套做法。
 * 注入仍走同一个 styles.insert 接缝（index.js 里紧接着再 insert 一次）。
 * 类名前缀一律 pixel-，只被本目录的组件引用，不外溢；令牌 --pixel-* 挂 :root。
 *
 * 两套皮肤（#1378）：深色是今天定版的「纸面深框」，下面的 :root 原值一个字没动；
 *   浅色是 A 纸面便签，与版本管理页签的浅色同一张纸（纸面 #f6f1e6、卡片 #fffdf8、描边 #3a2c14、
 *   强调深绿 #15803d）。切换只认宿主的深色标记（body[data-ds-dark-theme]）：人在 DSH 里切一次
 *   主题就整体换肤，面板里不另做开关。做法与 src/client/views/versionControl/vcStyles.ts:31-43
 *   的自动档一致——深色值留在 :root 不动，浅色只在 body:not([data-ds-dark-theme]) .pixel-tab 上换令牌。
 *   为什么挂在 .pixel-tab 而不是 :root：像素家族全部画在这棵子树里（列表、详情弹窗、图片放大层、
 *   遮罩），令牌靠继承往下走；挂到 :root 会漏进别的页签，那不是这次的范围。
 *   装饰色（棋盘两色、图标底色、印章、状态行上边框、块引用与推荐行底、代码块、遮罩）以前写死在
 *   规则里，现在收成 --pixel-* 令牌：深色值就是今天的字面量（深色零变化），浅色值按 A 纸面便签给。
 */
export const PIXEL_STYLE_TEXT: string[] = [
  ":root{--pixel-frame:#3a2c14;--pixel-paper:#f2e4c0;--pixel-card:#fffdf4;--pixel-ink:#2b2113;--pixel-ink2:#6b5b3e;--pixel-shadow:#241a0c;--pixel-gold:#e3a92f;--pixel-acc:#8b5cf6;--pixel-ok:#0e8a16;--pixel-bad:#a3231a;--pixel-warn:#f59e0b;--pixel-stripe:#ddcda1;--pixel-popline:#e8d9ae;--pixel-hi:#ffe1a1;--pixel-link:#5b3df0}",
  // ---- 装饰色令牌：深色值就是以前写在各条规则里的那些字面量，一个不差（深色零变化的底线）----
  // 收成令牌只为让浅色能整套换掉。每一对「令牌:值」都对应今天规则里的同一个字面量：
  //   棋盘两色（tab1 / tab2）、棋盘上的字（tab-ink，原来是 paper 色）、三颗图标的底色与警告字色、
  //   印章、状态行上边框、块引用底、推荐行底、代码块前景/背景、遮罩、强调色上的字、提交成功/失败闪的底色。
  ":root{--pixel-tab1:#93764f;--pixel-tab2:#8a6f4d;--pixel-tab-ink:#f2e4c0;--pixel-ok-bg:#d9f2dc;--pixel-bad-bg:#fbe3e1;--pixel-warn-bg:#fdf0d3;--pixel-ic-warn-ink:#9a6a00;--pixel-seal:#c9503f;--pixel-statusline-edge:#9a8f78;--pixel-quote-bg:#efe8fb;--pixel-rec-bg:#efe8fb;--pixel-pre-bg:#241a0c;--pixel-pre-ink:#f2e4c0;--pixel-overlay:rgba(28,16,4,.55);--pixel-acc-ink:#fff}",
  // ---- 浅色（A 纸面便签）：只认宿主有没有挂深色标记，面板里没有第二个开关 ----
  // 挂在 .pixel-tab 上：像素家族全在这棵子树里（列表、详情弹窗、图片放大层、遮罩），令牌靠继承往下走，
  // 不会漏到别的页签。这一段只写令牌，不写别的属性——浅色换的是色，不是结构。
  // 几处定版值的理由：
  //   link 用 #2563eb（深绿留给强调色）：链接要能和强调绿分开，否则正文里的链接看起来像强调；
  //     设计文档里给出的那档信息蓝不能用——它是容器身份蓝，verify-container-colors 全仓零容忍；
  //     #2563eb 是同一色系里更深一档，纸面底对比过 4.5:1，过正文线。
  //   quote 用纸面下沉 #efe8d9、rec 用浅绿 #eef7ef（原型 .row.rec 的浅色值），两者不同，浅色下分得开。
  //   pre 保持墨块（深底浅字）：纸面上的代码块是一块压上去的墨，比浅底更清楚，对比 14:1。
  //   overlay 用描边色压 45%：浅色下面板后面的东西还看得见轮廓，又不至于抢戏。
  "body:not([data-ds-dark-theme]) .pixel-tab{--pixel-frame:#3a2c14;--pixel-paper:#f6f1e6;--pixel-card:#fffdf8;--pixel-ink:#221d15;--pixel-ink2:#6f6252;--pixel-shadow:#241a0c;--pixel-gold:#a16207;--pixel-acc:#15803d;--pixel-ok:#15803d;--pixel-bad:#b91c1c;--pixel-warn:#b45309;--pixel-stripe:#e7ddc8;--pixel-popline:#e7ddc8;--pixel-hi:#dff2e3;--pixel-link:#2563eb;--pixel-tab1:#efe8d9;--pixel-tab2:#e7ddc8;--pixel-tab-ink:#3a2c14;--pixel-ok-bg:#d9f2dc;--pixel-bad-bg:#fbe3e1;--pixel-warn-bg:#fdf0d3;--pixel-ic-warn-ink:#b45309;--pixel-seal:#c9503f;--pixel-statusline-edge:#b9ab90;--pixel-quote-bg:#efe8d9;--pixel-rec-bg:#eef7ef;--pixel-pre-bg:#241a0c;--pixel-pre-ink:#f6f1e6;--pixel-overlay:rgba(58,44,20,.45);--pixel-acc-ink:#fff}",
  ".pixel-btn{font:700 12px ui-monospace,Menlo,Consolas,monospace;border:3px solid var(--pixel-frame);background:var(--pixel-paper);color:var(--pixel-ink);padding:4px 12px;cursor:pointer;box-shadow:2px 2px 0 var(--pixel-shadow);transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)}",
  ".pixel-btn:hover{transform:translate(-2px,-2px);box-shadow:4px 4px 0 var(--pixel-shadow);outline:2px solid var(--pixel-gold);outline-offset:1px}",
  // 按压态走委托挂的 .dsws-pressing（#1335 界面反馈）：不用 CSS 的 :active，
  // 因为按住后把指针拖走 :active 会粘住，祖先元素还会跟着一起匹配。
  ".pixel-btn.dsws-pressing{transform:translate(2px,2px);box-shadow:0 0 0 var(--pixel-shadow)}",
  ".pixel-btn:focus-visible{outline:2px dashed var(--pixel-gold);outline-offset:2px}",
  ".pixel-btn:disabled{opacity:.6;cursor:wait}",
  ".pixel-btn.hot{background:var(--pixel-acc);color:var(--pixel-acc-ink)}",
  ".pixel-btn.mini{padding:1px 8px;font-size:11px}",
  ".pixel-spin{display:none;width:10px;height:10px;background:var(--pixel-acc);margin-right:6px;vertical-align:-1px;animation:pixel-blk .6s steps(2,end) infinite}",
  ".pixel-btn.loading .pixel-spin{display:inline-block}",
  "@keyframes pixel-blk{50%{opacity:.15}}",
  ".pixel-dot{flex:none;width:10px;height:10px;border:2px solid var(--pixel-frame);background:var(--pixel-dc,var(--pixel-ok))}",
  ".pixel-num{flex:none;font:700 11px ui-monospace,monospace;background:var(--pixel-frame);color:var(--pixel-paper);padding:0 6px;min-width:26px;text-align:center}",
  ".pixel-ic{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border:2px solid var(--pixel-frame);font-weight:800;font-size:12px;margin-right:6px;vertical-align:-3px}",
  ".pixel-ic-ok{background:var(--pixel-ok-bg);color:var(--pixel-ok)}.pixel-ic-err{background:var(--pixel-bad-bg);color:var(--pixel-bad)}.pixel-ic-warn{background:var(--pixel-warn-bg);color:var(--pixel-ic-warn-ink)}.pixel-ic-idle{background:var(--pixel-stripe);color:var(--pixel-ink2)}",
  ".pixel-seal{position:absolute;left:50%;top:-13px;margin-left:-11px;width:22px;height:22px;background:var(--pixel-seal);border:3px solid var(--pixel-frame)}",
  // 加载中的三句节奏话（2026-10-10 人拍板放回）：按顺序 1 秒一句。
  // 纯 CSS 轮播，客户端不排任何定时器：三句叠在网格的同一格里，各自错开一秒显示。
  ".pixel-statusline .pixel-seq{display:grid;align-items:center}",
  ".pixel-statusline .pixel-seq>span{grid-area:1/1;opacity:0;animation:pixel-seq 3s step-end infinite both}",
  "@keyframes pixel-seq{0%{opacity:0}1%,33.3%{opacity:1}33.4%,100%{opacity:0}}",
  ".pixel-skel{height:14px;background:var(--pixel-stripe);border:2px solid var(--pixel-frame);margin:8px 0;animation:pixel-blk 1s steps(2,end) infinite}",
  ".pixel-banner{background:var(--pixel-bad-bg);border:3px solid var(--pixel-frame);border-left:10px solid var(--pixel-bad);box-shadow:3px 3px 0 var(--pixel-shadow);padding:8px 10px;font-size:13px;margin:10px 0;display:flex;gap:8px;align-items:center}",
  ".pixel-banner.warn{background:var(--pixel-warn-bg);border-left-color:var(--pixel-warn)}",
  ".pixel-banner .grow{flex:1}",
  ".pixel-statusline{font-size:12.5px;background:var(--pixel-card);border:3px solid var(--pixel-frame);border-top:8px solid var(--pixel-statusline-edge);box-shadow:2px 2px 0 var(--pixel-shadow);padding:5px 8px;margin:0 0 10px}",
  ".pixel-toc{background:var(--pixel-card);border:3px solid var(--pixel-frame);box-shadow:3px 3px 0 var(--pixel-shadow);margin:0 0 10px;font-size:12.5px}",
  ".pixel-toc b{display:block;background:var(--pixel-frame);color:var(--pixel-paper);font:700 12px ui-monospace,monospace;letter-spacing:2px;padding:4px 10px}",
  ".pixel-toc a{display:flex;gap:8px;align-items:center;color:var(--pixel-ink);text-decoration:none;font-weight:700;padding:6px 10px;cursor:pointer}",
  ".pixel-toc a+a{border-top:2px solid var(--pixel-stripe)}",
  ".pixel-toc a:hover{background:var(--pixel-frame);color:var(--pixel-paper)}",
  ".pixel-toc a:hover .pixel-num{background:var(--pixel-paper);color:var(--pixel-ink)}",
  ".pixel-doc{line-height:1.85;font-size:13.5px}",
  ".pixel-doc[data-lang=zh]{line-height:2.05}",
  ".pixel-doc h1,.pixel-doc h2,.pixel-doc h3{font-family:ui-monospace,Menlo,Consolas,Microsoft YaHei,sans-serif}",
  ".pixel-doc h1{font-size:19px;letter-spacing:1px;border-bottom:4px solid var(--pixel-frame);padding-bottom:4px}",
  ".pixel-doc h2{font-size:15px;background:var(--pixel-popline);border:3px solid var(--pixel-frame);box-shadow:3px 3px 0 var(--pixel-shadow);padding:2px 10px;display:inline-block;margin:14px 0 6px}",
  ".pixel-doc h3{font-size:14px;border-left:8px solid var(--pixel-gold);padding-left:8px}",
  ".pixel-doc p{margin:8px 0}",
  ".pixel-doc ul,.pixel-doc ol{margin:8px 0;padding-left:0;list-style:none}",
  ".pixel-doc ul>li{position:relative;padding-left:18px;margin:5px 0}",
  ".pixel-doc ul>li::before{content:'';position:absolute;left:0;top:.62em;width:8px;height:8px;background:var(--pixel-acc)}",
  ".pixel-doc ul ul>li::before{background:var(--pixel-gold)}",
  ".pixel-doc ul ul,.pixel-doc ol ol,.pixel-doc ul ol,.pixel-doc ol ul{margin:3px 0}",
  ".pixel-doc ol{counter-reset:pixel-it}",
  ".pixel-doc ol>li{counter-increment:pixel-it;position:relative;padding-left:38px;margin:7px 0}",
  ".pixel-doc ol>li::before{content:counter(pixel-it);position:absolute;left:0;top:2px;font:700 12px ui-monospace,monospace;background:var(--pixel-frame);color:var(--pixel-paper);padding:0 6px;border:2px solid var(--pixel-frame);box-shadow:2px 2px 0 var(--pixel-shadow)}",
  ".pixel-doc blockquote{border-left:8px solid var(--pixel-acc);background:var(--pixel-quote-bg);margin:10px 0;padding:6px 12px}",
  ".pixel-doc pre{background:var(--pixel-pre-bg);color:var(--pixel-pre-ink);padding:10px 12px;font:12px/1.7 ui-monospace,monospace;overflow:auto;white-space:pre-wrap;border:3px solid var(--pixel-frame);box-shadow:3px 3px 0 var(--pixel-shadow)}",
  ".pixel-doc code{font:400 12px ui-monospace,Menlo,Consolas,monospace;background:var(--pixel-card);color:var(--pixel-ink);padding:1px 6px;border:2px solid var(--pixel-frame);box-shadow:2px 2px 0 var(--pixel-shadow);white-space:nowrap}",
  ".pixel-doc pre code{background:none;border:none;box-shadow:none;padding:0;color:inherit;font:inherit;white-space:pre-wrap}",
  ".pixel-doc a{color:var(--pixel-link)}",
  // 正文里能点开的技能名（2026-10-10 人拍板）：平时跟普通代码一模一样，指上去才亮出焦点色边框，
  // 免得整篇正文到处是彩色。推荐条那几颗 chip 同理。
  ".pixel-doc code.pixel-skillref{cursor:pointer}",
  ".pixel-doc code.pixel-skillref:hover,.pixel-doc code.pixel-skillref:focus-visible{background:var(--pixel-hi);border-color:var(--pixel-acc);box-shadow:2px 2px 0 var(--pixel-acc);outline:none}",
  ".pixel-tab .dsws-chip.pixel-chipref{cursor:pointer}",
  ".pixel-tab .dsws-chip.pixel-chipref:hover,.pixel-tab .dsws-chip.pixel-chipref:focus-visible{background:var(--pixel-hi);border-color:var(--pixel-acc);box-shadow:2px 2px 0 var(--pixel-acc);outline:none}",
  // 顶栏在窄面板里不许挤成两行：标题一行（放不下就省略号），按钮与层号牌各自不换行。
  ".pixel-top>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}",
  ".pixel-top .pixel-btn{white-space:nowrap;flex:none}",
  ".pixel-top .pixel-stack{flex:none}",
  // 栈深牌：第 n 层 / 共 m 层（详情栈最多三层，超过就把最深的挤掉）
  ".pixel-stack{font:700 11px ui-monospace,Menlo,Consolas,monospace;background:var(--pixel-card);color:var(--pixel-ink2);border:2px solid var(--pixel-frame);padding:0 6px;white-space:nowrap}",
  // 粗体要真的更重：代码徽章自己写着 font-weight:700，会把外层 <strong> 的加粗盖掉，
  // 于是 `**\`/grill-with-docs\`**` 看起来跟普通代码一样。
  ".pixel-doc strong{font-weight:800}",
  // 但光调字重看不出区别（2026-10-10 人反馈两个徽章一模一样）：等宽字体 ui-monospace / Menlo /
  // Consolas 都没有 800、900 这两档字面，浏览器把它们归到最近的 700，于是「普通代码 700、强调代码 900」
  // 其实都是同一个 700，长得一模一样。
  // 人拍板（同日三轮）：反色不好看、描边加粗发虚，要**清晰的加粗**。于是把两档字重拉开用字体自带的真字面：
  // 普通代码用常规字重（400），强调代码用真粗体（700）。字形是字体本身画出来的，不描边、不发虚。
  // 实测同一串 /grill-me：实心像素 1661 → 2438（+47%），边缘灰像素占比 0.777 → 0.875（比描边那版更干净）。
  ".pixel-doc strong code{font-weight:700}",
  ".pixel-doc em{font-style:normal;font-weight:700;color:var(--pixel-ink);background:var(--pixel-hi);padding:0 3px;border-bottom:3px solid var(--pixel-gold)}",
  ".pixel-doc hr{border:none;border-top:3px solid var(--pixel-frame);margin:10px 0}",
  ".pixel-doc img{max-width:100%;max-height:220px;object-fit:contain;display:block;margin:8px 0;border:3px solid var(--pixel-frame);background:var(--pixel-card);cursor:zoom-in}",
  ".pixel-doc label.pixel-task{display:flex;gap:8px;align-items:flex-start;margin:5px 0}",
  ".pixel-skillrow{display:flex;gap:8px;align-items:center;background:var(--pixel-card);border:3px solid var(--pixel-frame);box-shadow:3px 3px 0 var(--pixel-shadow);padding:6px 10px;margin:8px 0;transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)}",
  ".pixel-skillrow.rec{background:var(--pixel-rec-bg)}",
  ".pixel-skillrow:hover,.pixel-skillrow:focus-within{transform:translate(-2px,-2px);box-shadow:5px 5px 0 var(--pixel-shadow);outline:2px solid var(--pixel-dc,var(--pixel-gold));outline-offset:1px}",
  ".pixel-sname{font:700 13px ui-monospace,Menlo,Consolas,monospace;min-width:120px}",
  ".pixel-sname .pixel-star{color:var(--pixel-acc)}",
  ".pixel-suse{flex:1;font-size:12px;color:var(--pixel-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".pixel-overlay{position:absolute;inset:0;background:var(--pixel-overlay);display:flex;align-items:center;justify-content:center;z-index:200;padding:14px}",
  ".pixel-modal{background:var(--pixel-paper);border:4px solid var(--pixel-frame);box-shadow:8px 8px 0 var(--pixel-shadow);width:min(680px,94vw);max-height:86vh;display:flex;flex-direction:column;position:relative}",
  ".pixel-top{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:3px solid var(--pixel-frame);font:700 13px ui-monospace,Menlo,Consolas,Microsoft YaHei,sans-serif}",
  ".pixel-body{padding:12px 16px;overflow:auto;flex:1;min-height:120px}",
  ".pixel-bot{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:3px solid var(--pixel-frame)}",
  ".pixel-f-ok{animation:pixel-fok .5s steps(3,end)}",
  ".pixel-f-err{animation:pixel-ferr .5s steps(3,end)}",
  "@keyframes pixel-fok{0%{background:var(--pixel-ok-bg)}100%{background:var(--pixel-paper)}}",
  "@keyframes pixel-ferr{0%{background:var(--pixel-bad-bg)}100%{background:var(--pixel-paper)}}",
  ".pixel-shake{animation:pixel-shk .4s steps(4,end)}",
  "@keyframes pixel-shk{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}",
  // ---- 文字色兜底（2026-10-10 真机修复）----
  // 面板走深色主题，宿主给正文的默认字色是浅色（#e6edf3）。原型的纸面上是深字，但那些元素
  // 只在原型页面的 body 上设过一次 color，搬进面板后没人给容器钉字色，浅色就渗进来 ——
  // 真机表现就是「弹窗里字都发白看不清」。这里把 ink 钉在每一层容器上，里层再各自覆盖。
  ".pixel-skillrow,.pixel-modal,.pixel-top,.pixel-statusline,.pixel-doc,.pixel-banner,.pixel-toc,.pixel-body,.pixel-bot{color:var(--pixel-ink)}",
  ".pixel-doc h1,.pixel-doc h2,.pixel-doc h3,.pixel-doc strong,.pixel-doc li,.pixel-doc p{color:var(--pixel-ink)}",
  ".pixel-doc blockquote{color:var(--pixel-ink2)}",
  ".pixel-top span,.pixel-statusline span,.pixel-bot span{color:inherit}",
  // ---- 整个技能页签（不只是列表块）----
  // 原型那一页的底是棕色棋盘纸，卡片压在纸上。页签根节点自己铺这个底，头行、段选与推荐徽章
  // 都改成像素语言；类名一律以 .pixel-tab 起头，避免影响别的页签（.dsws-* 是共用的）。
  ".pixel-tab{position:relative;background-color:var(--pixel-tab2);background-image:repeating-conic-gradient(var(--pixel-tab1) 0% 25%,var(--pixel-tab2) 0% 50%);background-size:8px 8px;border:4px solid var(--pixel-frame);box-shadow:6px 6px 0 var(--pixel-shadow);padding:10px}",
  ".pixel-tab .dsws-grp{color:var(--pixel-tab-ink);font-weight:700;letter-spacing:1px}",
  ".pixel-tab .dsws-grp svg{color:var(--pixel-tab-ink)}",
  ".pixel-tab .dsws-seg{font:700 11px ui-monospace,Menlo,Consolas,monospace;background:var(--pixel-paper);color:var(--pixel-ink);border:2px solid var(--pixel-frame);box-shadow:2px 2px 0 var(--pixel-shadow);padding:1px 8px;border-radius:0;cursor:pointer}",
  ".pixel-tab .dsws-seg.on{background:var(--pixel-acc);color:var(--pixel-acc-ink)}",
  ".pixel-tab .dsws-chip{font:700 11px ui-monospace,Menlo,Consolas,monospace;background:var(--pixel-card);color:var(--pixel-ink);border:2px solid var(--pixel-frame);box-shadow:2px 2px 0 var(--pixel-shadow);border-radius:0;padding:0 7px}",
  // ---- 详情占满可见区域（2026-10-10 人拍板，两轮真机反馈后改成量父容器）----
  // 列表让位、详情本体就是内容；正文在盒子里自己滚，底栏那两颗按钮停在**用户可见区域的底部**。
  // 高度不再靠"面板外框大概多高"去减：面板内容区本身是定高的滚动容器，页签取它的高度（height:100%），
  // 详情再撑满页签剩下的部分。万一某层拿不到定高（height:100% 退化成 auto），
  // 还有 max-height: calc(100vh - 120px) 兜底 —— 最坏情况也只是一屏以内，底栏不会掉出屏幕。
  ".pixel-tab-detail{height:100%;display:flex;flex-direction:column;box-sizing:border-box}",
  ".pixel-detail-full{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;max-height:calc(100vh - 118px)}",
  ".pixel-modal-full{flex:1;min-height:0;width:100%;max-width:none;max-height:none;box-shadow:4px 4px 0 var(--pixel-shadow)}",
  ".pixel-modal-full .pixel-body{flex:1;min-height:0;overflow:auto}",
  "@media (prefers-reduced-motion:reduce){.pixel-btn,.pixel-skillrow,.pixel-skel,.pixel-f-ok,.pixel-f-err,.pixel-shake,.pixel-spin{animation:none!important;transition:none!important}.pixel-statusline .pixel-seq>span{animation:none!important}.pixel-statusline .pixel-seq>span:not(:first-child){display:none}}",
]
