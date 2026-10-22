/**
 * views/cards/PixelCardsStyles.ts - S1/S6/S7 skin truth.
 * Same insert seam as vcStyles. Class prefix cd-. Values pixel-equal to p101/p102/p2.
 *
 * 配置归属（docs/adr/20261021-config-ownership.md）：本文件是按文本拼进客户端闭包的样式叶子，
 *   与 skillDetail 的 PixelStyles.ts 之间不能 import，所以同一套浅色纸色两份皮肤各写一份；
 *   防分叉不靠导入，靠 tests/verify-cards-dir.ts 里那几条跨文件逐值比对。
 */
export const PIXEL_CARDS_STYLE_TEXT: string[] = [
  ':root{--cd-frame:#3a2c14;--cd-card:#f2e4c0;--cd-old:#e4d5b0;--cd-ink:#2b2113;--cd-ink2:#6b5b3e;--cd-shadow:#241a0c;--cd-gold:#e3a92f;--cd-map:#8b5cf6;--cd-ok:#0e8a16;--cd-sel:#0ea5e9;--cd-warn:#f59e0b;--cd-bad:#a3231a;--cd-dim:#9a8f78;--cd-paper:#fffdf4;--cd-take:#4a86c8;}',
  // #1380 浅色纸面：浅色下必须换一套的装饰色（棋盘底、点亮的墙格、红字、三种角标）先收成令牌。
  // 深色这一行就是原来写死在下面规则里的字面量，一个值、一个字节都没改；浅色覆盖靠它换色。
  ':root{--cd-stripe:#ddcda1;--cd-lit:#ffd97a;--cd-note:#8b241a;--cd-mark-bug:#d73a4a;--cd-mark-ready:#10b981;--cd-mark-doing:#2b62b0;}',
  // 浅色（纸面便签：原型里选定的纸面底、卡片白、深色描边、深绿强调）只认宿主有没有挂深色标记，面板里没有第二个开关；这一段只写 --cd-* 令牌，不写结构。
  // 纸色与技能列表（PixelStyles.ts 的 .pixel-tab）同一套：卡片底 = 纸面 #f6f1e6、纸底 = 卡片白 #fffdf8，
  // 描边同 #3a2c14；强调绿 #15803d 与技能列表的 --pixel-acc 同值，跨文件门禁会逐条对。
  // 地图身份色保留紫色一系：深色是亮紫 #8b5cf6，浅色纸上用深一档的墨紫 #6d28d9（对纸面 6.31:1），
  // 不换成强调绿——地图卡与票卡要在同一屏上分得开，身份色不能跟着纸色一起变成绿色。
  // 旧卡（old）用纸面下沉 #efe8d9；--cd-card2 只给浅色的棋盘墙当底，深色不定义，墙面保持透明。
  'body:not([data-ds-dark-theme]) .cd-card{--cd-frame:#3a2c14;--cd-card:#f6f1e6;--cd-paper:#fffdf8;--cd-old:#efe8d9;--cd-ink:#221d15;--cd-ink2:#6f6252;--cd-shadow:#241a0c;--cd-gold:#15803d;--cd-ok:#15803d;--cd-sel:#1e40af;--cd-warn:#b45309;--cd-bad:#b91c1c;--cd-dim:#7d7061;--cd-take:#2456c9;--cd-map:#6d28d9;--cd-stripe:#e7ddc8;--cd-card2:#efe8d9;--cd-lit:#b45309;--cd-note:#b91c1c;--cd-mark-bug:#b91c1c;--cd-mark-ready:#15803d;--cd-mark-doing:#1e40af;}',
  '.cd-card{width:300px;background:var(--cd-card);border:4px solid var(--cd-frame);box-shadow:inset 2px 2px 0 rgba(255,255,255,.45),inset -2px -2px 0 var(--cd-shadow),6px 6px 0 var(--cd-shadow);padding:10px 11px;position:relative;display:flex;flex-direction:column;gap:6px;transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)}',
  '.cd-card.old{background:var(--cd-old);box-shadow:inset 2px 2px 0 #f7edd3,inset -2px -2px 0 #7d5730,6px 6px 0 var(--cd-shadow)}',
  '.cd-card.wide{width:340px;padding:11px 13px;gap:8px;min-height:230px;cursor:pointer}',
  '.cd-card.mapcard{width:404px;padding:11px 13px;gap:8px}',
  '.cd-card:hover{transform:translate(-2px,-2px);box-shadow:inset 2px 2px 0 rgba(255,255,255,.45),inset -2px -2px 0 var(--cd-shadow),7px 8px 0 var(--cd-shadow)}',
  // 按压态走委托挂的 .dsws-pressing（#1335 界面反馈）：不用 CSS 的 :active，
  // 因为按住后把指针拖走 :active 会粘住，祖先元素还会跟着一起匹配。
  '.cd-card.dsws-pressing{transform:translate(2px,2px);box-shadow:inset 2px 2px 0 rgba(255,255,255,.45),inset -2px -2px 0 var(--cd-shadow),0 0 0 2px var(--cd-frame),1px 1px 0 var(--cd-shadow)}',
  // 点亮的卡片另有一条更重的悬停规则（层级更高），压下去时要压过它，否则按了看不出变化。
  '.cd-card.lit.dsws-pressing,.cd-card.dim.lit.dsws-pressing{transform:translate(2px,2px)}',
  'body[data-ds-dark-theme] .cd-card:focus-visible{outline:2px dashed var(--cd-gold);outline-offset:4px}',
  '.cd-card.lit,.cd-card.dim.lit{box-shadow:inset 2px 2px 0 rgba(255,255,255,.45),inset -2px -2px 0 var(--cd-shadow),0 0 0 2px var(--cd-frame),0 0 0 6px var(--cd-gold),6px 6px 0 var(--cd-shadow)}',
  '.cd-card.lit:hover,.cd-card.dim.lit:hover{transform:translate(-2px,-2px);box-shadow:inset 2px 2px 0 rgba(255,255,255,.45),inset -2px -2px 0 var(--cd-shadow),0 0 0 2px var(--cd-frame),0 0 0 6px var(--cd-gold),7px 8px 0 var(--cd-shadow)}',
  '.cd-pin{position:absolute;left:50%;top:-10px;margin-left:-8px;width:16px;height:16px;background:#c0392b;border:2px solid var(--cd-frame);box-shadow:inset 2px 2px 0 rgba(255,255,255,.5),inset -2px -2px 0 var(--cd-shadow)}',
  '.cd-pin.big{margin-left:-10px;width:20px;height:20px;border-radius:50%}',
  '.cd-tape{position:absolute;left:50%;top:-8px;margin-left:-26px;width:52px;height:14px;background:#d9c48a;transform:rotate(-4deg);box-shadow:inset 0 2px 0 rgba(255,255,255,.45),inset 0 -2px 0 rgba(0,0,0,.18),0 2px 0 rgba(0,0,0,.35)}',
  '.cd-hd{display:flex;gap:6px;align-items:center;font-size:11px;color:var(--cd-ink2);font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.cd-nonum{font-size:13px;font-weight:800;letter-spacing:1px;padding:2px 10px;border:2px solid var(--cd-frame);box-shadow:2px 2px 0 var(--cd-shadow);font-family:ui-monospace,Menlo,Consolas,monospace;white-space:nowrap}',
  '.cd-nonum.line{background:transparent;color:var(--cd-ink)}',
  '.cd-tt{margin:2px 0;font-size:13px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:38px}',
  '.cd-tt.tall{-webkit-line-clamp:3;min-height:0}',
  '.cd-take{font-size:11px;color:var(--cd-take)}',
  '.cd-lbrow{margin:2px 0;display:flex;flex-wrap:wrap}',
  '.cd-chip{display:inline-block;font-size:11px;font-weight:700;line-height:20px;padding:0 8px;white-space:nowrap;border:2px solid var(--cd-frame);box-shadow:inset 2px 2px 0 rgba(255,255,255,.35),inset -2px -2px 0 rgba(0,0,0,.28),2px 2px 0 var(--cd-shadow);font-family:ui-monospace,Menlo,Consolas,monospace;margin-right:6px;letter-spacing:1px}',
  '.cd-note{font-size:11px;color:var(--cd-note)}',
  '.cd-ft{border-top:3px solid var(--cd-frame);padding-top:5px;margin-top:auto;font-size:11px;color:var(--cd-ink2);display:flex;justify-content:space-between;font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.cd-sealcn{background:#a3231a;color:#fff9ec;opacity:1;border:2px solid #7d1a12;box-shadow:inset 0 0 0 2px #fff9ec,2px 2px 0 var(--cd-shadow);font-family:SimSun,NSimSun,STZhongsong,serif;letter-spacing:4px;padding:3px 10px;min-width:64px;text-align:center;font-size:13px;line-height:1.3;white-space:nowrap;position:relative;z-index:5;margin-left:auto}',
  '.cd-card.closed::after{content:"";position:absolute;inset:-14px;background:rgba(28,16,4,.45);pointer-events:none}',
  '.cd-corner,.cd-ckj,.cd-ckb{position:absolute;right:0;top:0;width:0;height:0;border-style:solid;border-width:0 38px 38px 0;pointer-events:none}',
  '.cd-corner{border-color:transparent var(--cd-mark-bug) transparent transparent;border-width:0 34px 34px 0}',
  '.cd-ckj{border-color:transparent var(--cd-mark-ready) transparent transparent}',
  '.cd-ckb{border-color:transparent var(--cd-mark-doing) transparent transparent}',
  '.cd-corner b,.cd-ckj b,.cd-ckb b{position:absolute;right:-36px;top:4px;font-size:9px;color:#fff;transform:rotate(45deg);font-weight:700;white-space:nowrap}',
  '.cd-corner b{right:-32px;top:2px}',
  '.cd-actions{display:flex;gap:6px;margin-top:2px}',
  '.cd-abtn{border:3px solid var(--cd-frame);cursor:pointer;box-shadow:2px 2px 0 var(--cd-shadow);display:inline-flex;align-items:center;justify-content:center;gap:4px;font-family:ui-monospace,Menlo,Consolas,monospace;transition:transform .12s steps(2,end),box-shadow .12s steps(2,end)}',
  '.cd-abtn.label{flex:1;font-size:12px;padding:5px 8px}',
  '.cd-abtn.icon{flex:none;width:40px;padding:5px 0}',
  '.cd-abtn.paper{background:var(--cd-card);color:var(--cd-ink)}',
  '.cd-abtn:hover{transform:translate(-2px,-2px);box-shadow:4px 4px 0 var(--cd-shadow);outline:2px solid var(--cd-act,var(--cd-gold));outline-offset:1px}',
  'body[data-ds-dark-theme] .cd-abtn:focus-visible{outline:2px dashed var(--cd-act,var(--cd-gold));outline-offset:2px}',
  '.cd-abtn.dsws-pressing{transform:translate(2px,2px);box-shadow:0 0 0 var(--cd-shadow)}',
  '.cd-abtn svg{flex:none;display:block}',
  '.cd-bseal{position:absolute;left:-10px;top:64px;right:-10px;background:#a3231a;color:#fff;text-align:center;font-size:12px;letter-spacing:2px;padding:2px 0;border-top:3px solid var(--cd-frame);border-bottom:3px solid var(--cd-frame);transform:rotate(-6deg);box-shadow:3px 3px 0 var(--cd-shadow);pointer-events:none}',
  '.cd-dimveil{position:absolute;inset:-12px;background:rgba(58,36,19,.42);color:#fff9ec;display:flex;align-items:center;justify-content:center;font-size:12px;letter-spacing:2px;pointer-events:none;z-index:5}',
  '.cd-card.lit .cd-dimveil{display:none}',
  '.cd-card .cd-bchip{display:none;position:absolute;left:8px;top:8px;z-index:8;max-width:240px}',
  '.cd-card.lit .cd-bchip{display:block}',
  '.cd-bchip b{display:block;background:#a3231a;color:#fff;font-weight:700;font-size:12px;padding:3px 10px;border:2px solid #241a0c;box-shadow:3px 3px 0 var(--cd-shadow);text-shadow:1px 1px 0 #000;white-space:nowrap}',
  '.cd-bchip i{display:block;font-style:normal;font-size:11px;background:var(--cd-card);border:2px solid var(--cd-frame);border-top:0;padding:2px 6px;box-shadow:3px 3px 0 var(--cd-shadow)}',
  '.cd-mapcorner{position:absolute;right:0;top:0;width:0;height:0;border-style:solid;border-width:0 36px 36px 0;border-color:transparent var(--cd-map) transparent transparent;pointer-events:none;z-index:4}',
  '.cd-mapcorner b{position:absolute;right:-34px;top:3px;font-size:9px;color:#fff;transform:rotate(45deg);font-weight:700;letter-spacing:1px}',
  '.cd-grid2{display:grid;grid-template-columns:repeat(15,1fr);gap:2px;background:var(--cd-stripe);border:3px solid var(--cd-frame);padding:4px}',
  '.cd-grid2 i{aspect-ratio:1/1;border:1px solid #0f0b05}',
  '.cd-mstats{display:flex;gap:6px}',
  '.cd-mstats span{flex:1;background:#e8dbf8;border:2px solid var(--cd-frame);font-size:10px;text-align:center;padding:2px 0;color:#4a3a8a;box-shadow:2px 2px 0 var(--cd-shadow)}',
  '.cd-mstats b{font-size:13px;color:var(--cd-ink)}',
  '.cd-mstate{font-size:10px;font-weight:700;padding:1px 8px;border:2px solid var(--cd-frame);box-shadow:2px 2px 0 var(--cd-shadow);color:#fff;white-space:nowrap}',
  '.cd-sealtop{position:absolute;left:50%;top:-12px;margin-left:-10px;width:20px;height:20px;background:#c9503f;border:2px solid var(--cd-frame);box-shadow:inset 2px 2px 0 rgba(255,255,255,.4),inset -2px -2px 0 rgba(0,0,0,.4),2px 2px 0 var(--cd-shadow)}',
  '.cd-wall{background:var(--cd-card2);border:4px solid var(--cd-frame);padding:6px;display:grid;grid-template-columns:repeat(15,1fr);gap:3px}',
  '.cd-wall i{aspect-ratio:1/1;border:2px solid #0f0b05;cursor:default}',
  '.cd-wall i.f{background:var(--cd-sel)}.cd-wall i.b{background:var(--cd-bad)}.cd-wall i.w{background:var(--cd-warn)}.cd-wall i.c{background:var(--cd-ok)}',
  '.cd-wall i.lit{outline:3px solid var(--cd-lit)}',
  '.cd-legend{display:flex;gap:8px;font-size:11px;color:var(--cd-ink2);font-family:ui-monospace,Menlo,Consolas,monospace}',
  '.cd-legend i{display:inline-block;width:10px;height:10px;border:2px solid #0f0b05;margin-right:4px;vertical-align:-1px}',
  '.cd-readout{font-size:12px;border:3px solid var(--cd-frame);border-top:10px solid var(--cd-dim);background:var(--cd-paper);color:var(--cd-ink);padding:5px 8px;min-height:60px;box-shadow:3px 3px 0 var(--cd-shadow)}',
  '.cd-readout.f{border-top-color:var(--cd-sel)}.cd-readout.b{border-top-color:var(--cd-bad)}.cd-readout.w{border-top-color:var(--cd-warn)}.cd-readout.c{border-top-color:var(--cd-ok)}',
  '.cd-readout .ro-k{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700}',
  '.cd-readout .ro-s{margin-left:6px;padding:0 6px;color:#fff;font-size:11px;border:2px solid var(--cd-frame)}',
  '.cd-readout.f .ro-s{background:var(--cd-sel)}.cd-readout.b .ro-s{background:var(--cd-bad)}.cd-readout.w .ro-s{background:var(--cd-warn)}.cd-readout.c .ro-s{background:var(--cd-ok)}',
  '.cd-readout .ro-t{display:block;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4}',
  '.cd-readout.idle{border-top-color:var(--cd-dim);color:var(--cd-ink2)}',  '.cd-hd b{font-size:13px;color:var(--cd-ink)}',
  '.cd-st{margin-left:auto;padding:1px 8px;background:var(--cd-ok);color:#fff;font-size:11px;border:2px solid var(--cd-frame);transform:rotate(-6deg);box-shadow:2px 2px 0 var(--cd-shadow)}',
  '.cd-st.open{background:var(--cd-sel)}',
  '.cd-card.mapcard h3{margin:2px 0;font-size:13.5px;line-height:1.4}',
];
