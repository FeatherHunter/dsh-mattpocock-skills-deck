/**
 * views/skillDetail/PixelStyles.ts — 技能详情像素风皮肤的 TS 真源（887 TS 化）。
 * 契约：本文件为真源；构建经 esbuild 转译出同名 .js（AUTO-GENERATED 头），再剥行首 export
 * 拼回 src/client/index.js 的样式标记处，与 kernel/styles.js、vcStyles.js 同一套做法。
 * 注入仍走同一个 styles.insert 接缝（index.js 里紧接着再 insert 一次）。
 * 类名前缀一律 pixel-，只被本目录的组件引用，不外溢；令牌 --pixel-* 挂 :root。
 * 固定一套配色（原型定版那套纸面深框），跟随宿主主题换肤是 888 的活，本票不定。
 */
export const PIXEL_STYLE_TEXT: string[] = [
  ":root{--pixel-frame:#3a2c14;--pixel-paper:#f2e4c0;--pixel-card:#fffdf4;--pixel-ink:#2b2113;--pixel-ink2:#6b5b3e;--pixel-shadow:#241a0c;--pixel-gold:#e3a92f;--pixel-acc:#8b5cf6;--pixel-ok:#0e8a16;--pixel-bad:#a3231a;--pixel-warn:#f59e0b;--pixel-stripe:#ddcda1;--pixel-popline:#e8d9ae;--pixel-hi:#ffe1a1;--pixel-link:#5b3df0}",
  ".pixel-btn{font:700 12px ui-monospace,Menlo,Consolas,monospace;border:3px solid var(--pixel-frame);background:var(--pixel-paper);color:var(--pixel-ink);padding:4px 12px;cursor:pointer;box-shadow:2px 2px 0 var(--pixel-shadow);transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)}",
  ".pixel-btn:hover{transform:translate(-2px,-2px);box-shadow:4px 4px 0 var(--pixel-shadow);outline:2px solid var(--pixel-gold);outline-offset:1px}",
  ".pixel-btn:active{transform:translate(2px,2px);box-shadow:0 0 0 var(--pixel-shadow)}",
  ".pixel-btn:focus-visible{outline:2px dashed var(--pixel-gold);outline-offset:2px}",
  ".pixel-btn:disabled{opacity:.6;cursor:wait}",
  ".pixel-btn.hot{background:var(--pixel-acc);color:#fff}",
  ".pixel-btn.mini{padding:1px 8px;font-size:11px}",
  ".pixel-spin{display:none;width:10px;height:10px;background:var(--pixel-acc);margin-right:6px;vertical-align:-1px;animation:pixel-blk .6s steps(2,end) infinite}",
  ".pixel-btn.loading .pixel-spin{display:inline-block}",
  "@keyframes pixel-blk{50%{opacity:.15}}",
  ".pixel-dot{flex:none;width:10px;height:10px;border:2px solid var(--pixel-frame);background:var(--pixel-dc,#0e8a16)}",
  ".pixel-num{flex:none;font:700 11px ui-monospace,monospace;background:var(--pixel-frame);color:var(--pixel-paper);padding:0 6px;min-width:26px;text-align:center}",
  ".pixel-ic{display:inline-flex;width:20px;height:20px;align-items:center;justify-content:center;border:2px solid var(--pixel-frame);font-weight:800;font-size:12px;margin-right:6px;vertical-align:-3px}",
  ".pixel-ic-ok{background:#d9f2dc;color:var(--pixel-ok)}.pixel-ic-err{background:#fbe3e1;color:var(--pixel-bad)}.pixel-ic-warn{background:#fdf0d3;color:#9a6a00}.pixel-ic-idle{background:var(--pixel-stripe);color:var(--pixel-ink2)}",
  ".pixel-seal{position:absolute;left:50%;top:-13px;margin-left:-11px;width:22px;height:22px;background:#c9503f;border:3px solid var(--pixel-frame)}",
  ".pixel-skel{height:14px;background:var(--pixel-stripe);border:2px solid var(--pixel-frame);margin:8px 0;animation:pixel-blk 1s steps(2,end) infinite}",
  ".pixel-banner{background:#fbe3e1;border:3px solid var(--pixel-frame);border-left:10px solid var(--pixel-bad);box-shadow:3px 3px 0 var(--pixel-shadow);padding:8px 10px;font-size:13px;margin:10px 0;display:flex;gap:8px;align-items:center}",
  ".pixel-banner.warn{background:#fdf0d3;border-left-color:var(--pixel-warn)}",
  ".pixel-banner .grow{flex:1}",
  ".pixel-statusline{font-size:12.5px;background:var(--pixel-card);border:3px solid var(--pixel-frame);border-top:8px solid #9a8f78;box-shadow:2px 2px 0 var(--pixel-shadow);padding:5px 8px;margin:0 0 10px}",
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
  ".pixel-doc blockquote{border-left:8px solid var(--pixel-acc);background:#efe8fb;margin:10px 0;padding:6px 12px}",
  ".pixel-doc pre{background:#241a0c;color:#f2e4c0;padding:10px 12px;font:12px/1.7 ui-monospace,monospace;overflow:auto;white-space:pre-wrap;border:3px solid var(--pixel-frame);box-shadow:3px 3px 0 var(--pixel-shadow)}",
  ".pixel-doc code{font:700 12px ui-monospace,Menlo,Consolas,monospace;background:var(--pixel-card);color:var(--pixel-ink);padding:1px 6px;border:2px solid var(--pixel-frame);box-shadow:2px 2px 0 var(--pixel-shadow);white-space:nowrap}",
  ".pixel-doc pre code{background:none;border:none;box-shadow:none;padding:0;color:inherit;font:inherit;white-space:pre-wrap}",
  ".pixel-doc a{color:var(--pixel-link)}",
  // 粗体要真的更重：代码徽章自己写着 font-weight:700，会把外层 <strong> 的加粗盖掉，
  // 于是 `**\`/grill-with-docs\`**` 看起来跟普通代码一样。这里把两层字重分开钉住（2026-10-10 人反馈）。
  ".pixel-doc strong{font-weight:800}",
  ".pixel-doc strong code{font-weight:900}",
  ".pixel-doc em{font-style:normal;font-weight:700;color:var(--pixel-ink);background:var(--pixel-hi);padding:0 3px;border-bottom:3px solid var(--pixel-gold)}",
  ".pixel-doc hr{border:none;border-top:3px solid var(--pixel-frame);margin:10px 0}",
  ".pixel-doc img{max-width:100%;max-height:220px;object-fit:contain;display:block;margin:8px 0;border:3px solid var(--pixel-frame);background:var(--pixel-card);cursor:zoom-in}",
  ".pixel-doc label.pixel-task{display:flex;gap:8px;align-items:flex-start;margin:5px 0}",
  ".pixel-skillrow{display:flex;gap:8px;align-items:center;background:var(--pixel-card);border:3px solid var(--pixel-frame);box-shadow:3px 3px 0 var(--pixel-shadow);padding:6px 10px;margin:8px 0;transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)}",
  ".pixel-skillrow.rec{background:#efe8fb}",
  ".pixel-skillrow:hover,.pixel-skillrow:focus-within{transform:translate(-2px,-2px);box-shadow:5px 5px 0 var(--pixel-shadow);outline:2px solid var(--pixel-dc,#e3a92f);outline-offset:1px}",
  ".pixel-sname{font:700 13px ui-monospace,Menlo,Consolas,monospace;min-width:120px}",
  ".pixel-sname .pixel-star{color:var(--pixel-acc)}",
  ".pixel-suse{flex:1;font-size:12px;color:var(--pixel-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".pixel-overlay{position:absolute;inset:0;background:rgba(28,16,4,.55);display:flex;align-items:center;justify-content:center;z-index:200;padding:14px}",
  ".pixel-modal{background:var(--pixel-paper);border:4px solid var(--pixel-frame);box-shadow:8px 8px 0 var(--pixel-shadow);width:min(680px,94vw);max-height:86vh;display:flex;flex-direction:column;position:relative}",
  ".pixel-top{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:3px solid var(--pixel-frame);font:700 13px ui-monospace,Menlo,Consolas,Microsoft YaHei,sans-serif}",
  ".pixel-body{padding:12px 16px;overflow:auto;flex:1;min-height:120px}",
  ".pixel-bot{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:3px solid var(--pixel-frame)}",
  ".pixel-f-ok{animation:pixel-fok .5s steps(3,end)}",
  ".pixel-f-err{animation:pixel-ferr .5s steps(3,end)}",
  "@keyframes pixel-fok{0%{background:#d9f2dc}100%{background:var(--pixel-paper)}}",
  "@keyframes pixel-ferr{0%{background:#fbe3e1}100%{background:var(--pixel-paper)}}",
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
  ".pixel-tab{position:relative;background-color:#8a6f4d;background-image:repeating-conic-gradient(#93764f 0% 25%,#8a6f4d 0% 50%);background-size:8px 8px;border:4px solid var(--pixel-frame);box-shadow:6px 6px 0 var(--pixel-shadow);padding:10px}",
  ".pixel-tab .dsws-grp{color:var(--pixel-paper);font-weight:700;letter-spacing:1px}",
  ".pixel-tab .dsws-grp svg{color:var(--pixel-paper)}",
  ".pixel-tab .dsws-seg{font:700 11px ui-monospace,Menlo,Consolas,monospace;background:var(--pixel-paper);color:var(--pixel-ink);border:2px solid var(--pixel-frame);box-shadow:2px 2px 0 var(--pixel-shadow);padding:1px 8px;border-radius:0;cursor:pointer}",
  ".pixel-tab .dsws-seg.on{background:var(--pixel-acc);color:#fff}",
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
  "@media (prefers-reduced-motion:reduce){.pixel-btn,.pixel-skillrow,.pixel-skel,.pixel-f-ok,.pixel-f-err,.pixel-shake,.pixel-spin{animation:none!important;transition:none!important}}",
]
