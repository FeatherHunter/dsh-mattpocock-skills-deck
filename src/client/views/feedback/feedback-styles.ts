/**
 * views/feedback/feedback-styles.ts — 交互反馈三批的视觉语言（948 图 949/950/951 落地）。
 *
 * 契约：本文件是一段 CSS 文本（ESM 导出）；scripts/build.mts 去掉行首 export 后拼进
 * src/client/index.ts 的拼接标记处，与 kernel/styles.ts、vcStyles.ts、pxSkillStyles.js
 * 同一套做法（源码树里只有这一份真源）。注入仍走同一个 styles.insert 接缝（index.js 里紧接着再
 * insert 一次），没有第二个 <style>，也没有新的注入机制。
 * 另起叶子的原因：kernel/styles.ts 已贴 350 行上限（#851 同款先例），反馈规则只许
 * 叠加不许顶布局，单独成叶后 952 到 956 的新反馈样式也加在这里，不再回 styles.ts。
 * 规则只用滤镜、外圈描边、阴影、透明度、小位移，不动宽高边距；颜色只复用既有色，
 * 原型里的占位红一个字面量都不许进生产（门禁逐字盯）。
 *
 * 本文件由同名 .js 转成 TypeScript（#1253）：只加类型标注与这段说明，字符串、次序、
 * 导出名一字未动。契约照旧不能改：本文件是模块真源（ESM 导出），构建时剥行首 export 拼进闭包；
 * 模块说明符保持 .js 后缀，由 scripts/ts-hook.mts 改指同名 .ts。这里没有自由变量要声明——
 * 整份文件只是一串 CSS 文本，不引用闭包里任何别的叶子。
 * 一处提醒：数组元素次序就是样式注入次序，改次序可能改层叠结果，转写时一个字都没动。
 */
export const FEEDBACK_STYLE_TEXT: string = [
      // #948 首批（#949 瞬间底座）：只叠加不顶布局，只用滤镜、外圈描边、阴影（描边蓝复用 #58a6ff）；ghost 整类与 .dsws-fb-dark 走外圈描边代替加深；悬停浮起挂既有 .dsws-btn 只加阴影。
      '.dsws-chip.dsws-pressing,.dsws-chip-fb.dsws-pressing{filter:brightness(.82)}.dsws-trow.dsws-pressing,.dsws-aggrow.dsws-pressing{filter:brightness(.9)}',
      // 键盘焦点环统一走 DSH 主题自己的两个 token（DSH 应用包 ui-theme 的 focus.css 就是这么写的）：
      //   颜色 --dsw-focus-ring-color，缺省回落 --dsw-alias-state-business-primary（主题主色，深色主题下是
      //   #7aaaff 那一档蓝）；宽度 --dsw-focus-ring-width。不再写死 #58a6ff，换主题时焦点环跟着变。
      //   关键在 outline-offset 取负值（往控件里面画）：外扩的环会被页签行、按钮组这类 overflow:hidden
      //   的容器裁断——用户实测过页签顶部、地图顶部复制/链接按钮的上下两截都断过。往内画永远裁不到。
      //   选择器按根节点圈定：停靠面板里所有可聚焦控件（含设置页输入框）走 [data-dsws-host]；
      //   独立挂在状态栏与浮层里的药丸、菜单、弹窗各有自己的根，逐个列上。
      //   胶囊根（.dsws-capsule）自己不在列表里：用户 2026-10-21 要求整条胶囊的焦点效果去掉，
      //   里面每一颗子控件（胶囊字、分段药丸、交接两段、会话链、刷新、时间）照旧有环。
      '[data-dsws-host] :focus-visible,.dsws-modal :focus-visible,.dsws-capsule-word:focus-visible,.dsws-capsule-chain:focus-visible,[data-dsws-logdot]:focus-visible,[data-dsws-logmenu] :focus-visible,.dsws-takemenu :focus-visible,.dsws-bugmenu :focus-visible,.dsws-chainmenu :focus-visible,.dsws-skillpop :focus-visible,.dsws-skillpop-bridge :focus-visible,.dsws-hov:focus-visible,.dsws-btn:focus-visible,.dsws-tab:focus-visible,.dsws-chip:focus-visible,.dsws-workroute:focus-visible,.dsws-node:focus-visible,.dsws-aggrow:focus-visible,.dsws-trow:focus-visible,[data-press]:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)));outline-offset:-2px}',
      '.dsws-btn:hover{box-shadow:0 6px 16px rgba(0,0,0,.45)}',
      // 按下时的确认圈也走主题焦点色（原来是一圈白，暗色面板上看着发灰）：ghost 按钮与大号暗面按钮各一条。
      //   圈照样往控件里面画（负 offset），否则会被按钮组的 overflow:hidden 裁掉上下两截——2026-10-21 用户实测过。
      '.dsws-btn.ghost.dsws-pressing{outline:2px solid var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)));outline-offset:-2px}',
      '.dsws-fb-dark.dsws-pressing,.dsws-fb-dark.fb-pressed{outline:2px solid var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)));outline-offset:-2px}',
      '@media (prefers-reduced-motion: reduce){.dsws-chip.dsws-pressing,.dsws-chip-fb.dsws-pressing,.dsws-trow.dsws-pressing,.dsws-aggrow.dsws-pressing{filter:brightness(.82)}}',
      // #948 第二批（#950 瞬间点缀）：全部覆盖层实现，不占布局，不动宽高边距。
      //   大按钮涟漪与小图标外扩环二选一：涟漪只挂 .primary（::after 水波层，
      //   按钮先立相对定位并裁掉溢出），外扩环只挂 .ghost（阴影向外扩一圈，
      //   图标本身不动）；两类类名互斥，同一控件不会同时开。
      //   缩小下沉只大按钮用且幅度减半（缩到九十八、沉一像素，变形不占布局）；
      //   倾斜只弹窗里的大按钮用（.dsws-modalbox 前缀），别处不用。
      //   光泽是备用（加 .dsws-fb-sheen 才开），高光只取现有的白半透明
      //   （转圈同款的白、描边同款的白五成五），本批零十六进制色。
      //   小图标（.ghost）整批无变形，只靠描边（首批）与外扩环确认。
      //   减少动态下动画变形全关，只剩图标加文字（悬浮气泡与底部小提示不受影响）。
      '.dsws-btn.primary{position:relative;overflow:hidden}',
      '.dsws-btn.primary.dsws-pressing::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,.55),transparent 70%);opacity:0;animation:dsws-ripple .55s ease-out}',
      '@keyframes dsws-ripple{0%{opacity:.8;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}',
      '.dsws-btn.ghost.dsws-pressing{animation:dsws-ringout .6s ease-out}',
      // ghost 按下时的外扩环同样取主题焦点色：写死的蓝换主题不跟（2026-10-21 用户要求所有高亮边框统一走焦点 token）。
      // 确认圈也画在控件里面：原来是一圈向外扩 12px 的光环，在详情页顶栏那种没有内边距的按钮组里
      //   上下两截会被 overflow:hidden 切掉（2026-10-21 用户实测就是这种「圈被截断」）。内画的环不会出门，
      //   跟着按钮自己的 6px 圆角走，扩到 2px 再淡出。
      '@keyframes dsws-ringout{0%{box-shadow:inset 0 0 0 0 var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}45%{box-shadow:inset 0 0 0 2px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}100%{box-shadow:inset 0 0 0 2px transparent}}',
      '.dsws-btn.primary.dsws-pressing{transform:scale(.98) translateY(1px)}',
      '.dsws-modalbox .dsws-btn.primary.dsws-pressing{transform:scale(.98) translateY(1px) rotate(-1.2deg)}',
      '.dsws-modalbox .dsws-btn.primary.dsws-fb-sheen.dsws-pressing::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);opacity:0;animation:dsws-sheen .5s ease}',
      '@keyframes dsws-sheen{0%{opacity:0;transform:translateX(-30%)}100%{opacity:.9;transform:translateX(30%)}}',
      '.dsws-seg.dsws-pressing,.dsws-skillbtn.dsws-pressing,.dsws-cfg-btn.dsws-pressing,.dsws-skillpop-row.dsws-pressing{filter:brightness(.85)}',
      '@media (prefers-reduced-motion: reduce){.dsws-btn.primary.dsws-pressing::after,.dsws-modalbox .dsws-btn.primary.dsws-fb-sheen.dsws-pressing::before{animation:none;opacity:0}.dsws-btn.ghost.dsws-pressing{animation:none}.dsws-btn.primary.dsws-pressing,.dsws-modalbox .dsws-btn.primary.dsws-pressing{transform:none}}',
      // #951 短等待核心：转圈 overlay（宽高不动，文字占位、圈盖在上面）+ 结果闪光抖动（半秒自退）+ 减少动态降级只剩图标。
      //   绿跟提示条 ok 同色，红跟横幅 bad 同色，琥珀跟提示条 warn 同色，不设全局硬值，不引入占位红。
      '.dsws-fb-busy{position:relative}.dsws-fb-busy .fb-t{visibility:hidden}.dsws-fb-busy .fb-spin{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}.dsws-fb-okflash{animation:dsws-fb-okflash .45s ease-out forwards}.dsws-fb-errflash{animation:dsws-fb-errflash .45s ease-out forwards}.dsws-fb-warnflash{animation:dsws-fb-warnflash .45s ease-out forwards}.dsws-fb-shake{animation:dsws-fb-shake .4s ease-out 1}@keyframes dsws-fb-okflash{0%{box-shadow:0 0 0 0 rgba(74,222,128,.55)}100%{box-shadow:0 0 0 10px rgba(74,222,128,0)}}@keyframes dsws-fb-errflash{0%{box-shadow:0 0 0 0 rgba(248,113,113,.55)}100%{box-shadow:0 0 0 10px rgba(248,113,113,0)}}@keyframes dsws-fb-warnflash{0%{box-shadow:0 0 0 0 rgba(251,191,36,.55)}100%{box-shadow:0 0 0 10px rgba(251,191,36,0)}}@keyframes dsws-fb-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}55%{transform:translateX(3px)}80%{transform:translateX(-2px)}}@media (prefers-reduced-motion: reduce){.dsws-fb-okflash,.dsws-fb-errflash,.dsws-fb-warnflash,.dsws-fb-shake{animation:none}}',
      // #948 第三批（#952 短等待文字与轻效果）：换字只宽按钮（留死宽度只这一个类，按最长一句，已提交三字为准）；成功圈弹跳只复制类；圆点呼吸是备用（永不与转圈同开，各有无转圈的归宿）；窄按钮与状态栏小段不换字；本批样式零色值字面量（圆点跟按钮字色走 currentColor，成功圈跟提示条 ok 同色系，呼吸弹跳不动颜色）。
      '.dsws-fb-result{min-width:6.5ch}',
      '.dsws-fb-dots{display:inline-block;min-width:14px;text-align:left}',
      '.dsws-fb-dots i{display:inline-block;width:3px;height:3px;border-radius:50%;background:currentColor;margin-left:2px;vertical-align:baseline;animation:dsws-fb-dots .9s ease-in-out infinite}',
      '.dsws-fb-dots i:nth-child(2){animation-delay:.15s}.dsws-fb-dots i:nth-child(3){animation-delay:.3s}',
      '@keyframes dsws-fb-dots{0%,100%{opacity:.25}50%{opacity:1}}',
      '.dsws-fb-breath{animation:dsws-fb-breath 1.6s ease-in-out infinite}',
      '@keyframes dsws-fb-breath{0%,100%{opacity:1}50%{opacity:.45}}',
      '.dsws-fb-success-ring{animation:dsws-fb-success-ring .6s ease-out}',
      '@keyframes dsws-fb-success-ring{0%{box-shadow:0 0 0 0 rgba(74,222,128,.55)}100%{box-shadow:0 0 0 10px rgba(74,222,128,0)}}',
      '.dsws-fb-pop{animation:dsws-fb-pop .35s ease-out}',
      '@keyframes dsws-fb-pop{0%{transform:scale(1)}40%{transform:scale(1.1)}100%{transform:scale(1)}}',
      '@media (prefers-reduced-motion: reduce){.dsws-fb-dots i,.dsws-fb-breath,.dsws-fb-success-ring,.dsws-fb-pop{animation:none}}',
      // #948 第四批（#953 中长等待）：面板列表加载骨架（只列表用，行形占位；每条的宽高圆角走调用点内联，叶子只管微光）。
      //   微光只用现成的白半透明，本批零十六进制色；减少动态下微光停，只剩静态灰条。
      '.dsws-fb-skel{background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.13),rgba(255,255,255,.05));background-size:200% 100%;animation:dsws-fb-skel 1.1s linear infinite}',
      '@keyframes dsws-fb-skel{to{background-position:-200% 0}}',
      '@media (prefers-reduced-motion: reduce){.dsws-fb-skel{animation:none;background:rgba(255,255,255,.07)}}',
      // 本次界面反馈需求里的液态墨块与全控件按压/悬停：第 32 种反馈「选中块迁移」。
      //   位置：墨块只在 transform 上做过渡（宽度/高度只在选项换行或折叠时变一次），位移的过冲靠 linear() 缓动。
      //   形变：拉伸回弹单独走 scale 属性的关键帧（dsws-ink-squash）。scale 是与 transform 独立的属性，
      //   两边同时写不会互相覆盖：位移由 transform 过渡负责，形变由动画负责，合起来就是「滑过去时略微拉长、落定回弹」。
      //   形变不引起版面重排，也不新增颜色。
      //   容器由 leaf:liquidInk 补 position:relative；墨块此刻盖住的那一颗把底色/描边让给它（避免双底），
      //   文字颜色照旧。盖住哪一颗由 leaf 动态标在元素上（data-ink-cover），不是选中态标记——多选标签组里
      //   同时选中的可能有好多颗，只有被墨块盖住的那颗让位，其余的保留自己的描边，才看得出选了哪几个。
      '.dsws-ink-host{position:relative}',
      '.dsws-ink-host .dsws-tab,.dsws-ink-host .dsws-chip{position:relative;z-index:1}',
      '.dsws-ink{position:absolute;left:0;top:0;width:var(--dsws-ink-w,0px);height:var(--dsws-ink-h,0px);border-radius:var(--dsws-ink-radius,6px);background:var(--dsws-ink-bg,rgba(255,255,255,.14));border:1px solid var(--dsws-ink-bd,transparent);box-sizing:border-box;pointer-events:none;z-index:0;will-change:transform;transform:translate3d(var(--dsws-ink-x,0px),var(--dsws-ink-y,0px),0);transition:transform .24s linear(0,.55 30%,1.06 62%,.99 84%,1),width .16s ease,height .16s ease,opacity .12s ease}',
      '.dsws-ink.dsws-ink-instant{transition:none!important}',
      '.dsws-ink.dsws-ink-squash{animation:dsws-ink-squash .3s ease-out}',
      '@keyframes dsws-ink-squash{0%{scale:1.05 .94}55%{scale:1.015 .985}100%{scale:1 1}}',
      '.dsws-ink-host .dsws-tab.on{background:transparent;border-color:transparent}',
      '.dsws-ink-host [data-ink-cover="1"]{background:transparent!important;border-color:transparent!important}',
      // 悬停高亮圈一律画在控件里面（box-shadow 用 inset）：外画的圈会被页签行、详情页顶栏按钮组、
      //   状态栏胶囊外层这几处 overflow:hidden 的容器把头、尾、左右两端切掉——2026-10-21 用户逐处实测报过
      //   「顶部被截断」「上下两截被截断」「胶囊左右不全」。内画跟着控件自己的圆角走，既不裁也自带圆角。
      // 页签只有悬停变色（原来连这个都没有）；药丸加一层轻微提亮，按下由通用按压态负责。
      // 药丸（.dsws-chip）里混着两种东西：能点的筛选药丸，和只是长得像药丸的静态角标（地图详情的「地图」、
      //   状态章、label、effort 章）。悬停提亮只能给能点的那种——判据就是接线契约里的 data-press：挂了它才是控件。
      //   2026-10-21 用户实测「地图详情顶部那个『地图』不能点却会亮」，就是因为这条规则只认类名。
      '@media (hover:hover) and (pointer:fine){.dsws-tab:hover:not(.on){background:rgba(255,255,255,.07);color:var(--dsw-alias-label-primary,#e6edf3)}[data-press].dsws-chip:hover:not(.dsws-pressing){filter:brightness(1.12);box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}}',
      // 选中的那一颗悬停时墨块已经在它底下，再补一档提亮，保证「悬停有反馈」对五颗页签每一颗都成立。
      '@media (hover:hover) and (pointer:fine){.dsws-ink-host .dsws-tab:hover:not(.dsws-pressing){filter:brightness(1.12)}}',
      // 通用按压/悬停：给清单里原来没有任何反馈的控件（仓库名、切后端、调色板、新建需求、+bug、
      //   workroute、地图卡片、折叠条、父链接、设置页按钮与插件行等）同一套语言；只用亮度与小位移。
      '.dsws-pressing{filter:brightness(.85)}',
      '.dsws-tab.dsws-pressing,.dsws-chip.dsws-pressing{filter:brightness(.8)}',
      '@media (hover:hover) and (pointer:fine){.dsws-hov:hover:not(.dsws-pressing){box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff))),0 2px 10px rgba(0,0,0,.25);filter:brightness(1.06)}}',
      '.dsws-hov.dsws-pressing{filter:brightness(.82);transform:translateY(1px);box-shadow:none;transition:transform .08s ease}',
      '.dsws-hov{transition:transform .12s ease,filter .12s ease,box-shadow .12s ease}',
      '@media (hover:hover) and (pointer:fine){.dsws-workroute:hover:not(.dsws-pressing){filter:brightness(1.18)}}',
      // 通用悬停与按下：接线契约只有 data-press 一个属性——凡是挂了它的控件，不必再逐颗挂 dsws-hov。
      //   2026-10-21 用户实测漏掉的那批（列表行内四颗按钮、地图/工单详情顶栏、地图底部动作区、父链接）
      //   全都是「按压属性接上了、悬停类忘了挂」，逐个补类只会再漏一次，所以改成按属性给反馈。
      //   形状分的依据是 data-press 的取值（button/icon/link/switch 是按钮类，chip/tab 是药丸与页签，row 是整行/整卡）：
      //   按钮类悬停提亮加一圈亮描边，按下压暗并下沉一像素；小图标按下不位移（圆点会糊），整行/整卡只压暗
      //   （整块下沉会把同行其它元素带着错位，这也和规格里「小图标不位移」一致）。
      //   行容器（.dsws-aggrow/.dsws-trow/.dsws-node）原有自己的悬停底色与更轻的按压，这里排除，不互相顶掉。
      //   胶囊根同样排除（用户 2026-10-21 要求整条胶囊的悬停环去掉，里面每颗子控件保留）。
      //   入口浮层的整张卡也排除（2026-10-22 用户实测 #1359：这张卡自己按焦点画 2px outline，通用环又从卡框
      //   底下透出来，焦点圈与卡框之间多出一条橘黄细线；根因是同一张卡叠了两套环，不是环色配错）。
      //   入口卡改挂专门的类 .dsws-entrycard：卡自己的焦点圈与悬停提亮照旧，按下压暗单独写在下面一条
      //   （卡的内联 style 里有提亮用的 filter，内联样式压得过通用按压规则，不抬 !important 就看不见压暗）。
      //   全仓只有入口浮层这两张卡挂 .dsws-entrycard，其它控件（含按 data-press="row" 接线的整行/整卡）
      //   不受影响。
      '@media (hover:hover) and (pointer:fine){[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node):not(.dsws-capsule):not(.dsws-entrycard):hover:not(.dsws-pressing){filter:brightness(1.14);box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff))),0 2px 10px rgba(0,0,0,.3)}}',
      '[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node).dsws-pressing{filter:brightness(.82)}',
      // 入口卡是一整张卡，按下只压暗、不下沉（同上面 data-press="row" 的约定）；它不挂 dsws-hov，上面那条
      //   通用按压规则虽然命中，却会被卡的内联 filter 压住，所以单独写一条并抬 !important。这里的 .82
      //   与上面那条通用按压是同一个压暗值，两处要一起改，否则两种控件的按下深浅会不一致。
      '.dsws-entrycard.dsws-pressing{filter:brightness(.82)!important}',
      '[data-press="button"].dsws-pressing,[data-press="link"].dsws-pressing,[data-press="switch"].dsws-pressing{transform:translateY(1px)}',
      '.dsws-btn[data-press],[data-press="link"],[data-press="switch"]{transition:filter .12s ease,box-shadow .12s ease,transform .08s ease}',
      // 地图详情的工单卡：整张卡热与按下；卡片内部按钮各自还有自己的反馈，不互相顶掉。
      // 地图工单卡整张卡热起来时边框跟主题主色走（用户实测原来变灰白，跟「获得焦点」的语义对不上）：
      //   颜色与下面的焦点环同一个 token，换主题时一起变；外圈阴影保留，卡片还是浮起来一点。
      '@media (hover:hover) and (pointer:fine){.dsws-node:hover{border-color:var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))!important;box-shadow:0 4px 14px rgba(0,0,0,.3)}}',
      '.dsws-node.dsws-pressing{filter:brightness(.9)}',
      // 战雾（未揭晓）卡片靠整张 blur 表示「还没揭晓」。通用按压规则是纯亮度滤镜，特异度一样但注入更晚，
      //   按住时会把 blur 顶掉、卡片一下子变清晰，等于提前剧透。这里单给一条：模糊照旧，只把亮度压得更暗；
      //   :not(.revealed) 是因为已揭晓的卡片 filter 本来是 none，不能又给它糊回去。
      '.dsws-node.fog:not(.revealed).dsws-pressing{filter:blur(2.4px) brightness(.28)}',
      // 悬停边框：内核样式里原来只把边框从深灰调到浅灰（.dsws-btn/.dsws-seg/.dsws-cfg-btn/.dsws-maprow/.dsws-trow/.dsws-aggrow
      //   各写一条），在深色面板上就是一圈灰边，和「获得焦点」的语义对不上。2026-10-21 用户要求：所有获得焦点/高亮
      //   边框的灰色都换成主题的焦点颜色。本叶子注入在内核样式之后、同特异度按次序胜出，所以在这里统一覆盖；
      //   主色按钮（.dsws-btn.primary:hover）那条边框是深色描边、不是灰边，排除掉不动。
      '@media (hover:hover) and (pointer:fine){.dsws-btn:not(.primary):hover:not(.dsws-pressing),.dsws-seg:hover:not(.dsws-pressing),.dsws-cfg-btn:hover:not(.dsws-pressing),.dsws-maprow:hover:not(.dsws-pressing),.dsws-trow:hover:not(.dsws-pressing),.dsws-aggrow:hover:not(.dsws-pressing){border-color:var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}}',
      // 列表整行（工单列表、PR 列表里的行）的悬停高亮原来只是把行自带的 1px 透明边框换成主题色：
      //   整个行一大片面积上只有一道 1px 细线，看起来比按钮、药丸上的环淡一半（2026-10-21 用户实测
      //   追问「ISSUE 列表的 ITEM 焦点框好像比较淡，是因为宽度不够吗」）。整行不能提亮、不能位移
      //   （会把同行内容带着变），所以在 1px 主题色边框之内再补一圈 1px 的内画阴影，合起来 2px，
      //   与键盘焦点环同宽；阴影不占布局，行还是不会跳。
      '@media (hover:hover) and (pointer:fine){.dsws-aggrow:hover:not(.dsws-pressing),.dsws-trow:hover:not(.dsws-pressing){box-shadow:inset 0 0 0 1px var(--dsws-ring-color,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)))}}',
      // 键盘焦点环统一规则在上面（DSH 焦点 token + 负 offset 往内画），这里不再另写一套。
      //   注：2026-10-21 用户先要求胶囊里所有环淡五成，随后又要求「胶囊状态栏的焦点效果可以去掉（内部胶囊的不用去）」——
      //   所以整条胶囊自己的环已经从焦点选择器与通用悬停规则里摘掉，这一条只负责让里面每颗子控件的环继续淡五成。
      // 状态栏胶囊与胶囊里每一颗控件：键盘焦点环、悬停高亮环、按下确认圈统一淡到五成（用户 2026-10-21 要求
      //   「胶囊状态栏的焦点和整行胶囊的焦点效果轻 50%」）。做法不另写一套样式：上面的环色全部经过
      //   --dsws-ring-color 这一层可继承的自定义属性，胶囊里把这层设成焦点色掺一半透明，环的形状、粗细、
      //   位置一概不变，只是淡下去；自定义属性会继承给胶囊里每一颗子控件（交接两段、分段药丸、刷新、时间），
      //   所以整条胶囊只声明一次。掺透明用 color-mix：环色是主题 token，换肤时自动跟着变。
      '.dsws-capsule{--dsws-ring-color:color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#58a6ff)) 50%,transparent)}',
      // #1379 浅色个例修复层（开始）
      // 只修浅色下证明不达标的个例：每条选择器都以 body:not([data-ds-dark-theme]) 开头，深色一个字节都不碰。
      // 组件里那些写死的色值没有改源码——它们被别的门禁按字符串钉着（verify-1286-* 断言按钮底色、verify-1295-dual-panel 断言源码里有 #f87171），
      // 所以在这里用 CSS 覆盖；值一律走宿主变量，需要深一档时用 color-mix 往主字色上掺，换肤时自动跟着变。
      // 浅色层反复用到的四个派生色只在这里算一次：错误红掺 20% 主字色、警告色掺 35% 主字色、
      //   链接蓝掺 18% 主字色、成功绿掺 45% 主字色。下面每条规则改用 var(--dsws-light-deep-*)，
      //   免得同一个 color-mix 抄七八遍、改一处漏一处（自定义属性会往下继承；选择器只认浅色）。
      'body:not([data-ds-dark-theme]){--dsws-light-deep-err:color-mix(in srgb,var(--dsw-alias-state-error-primary) 80%,var(--dsw-alias-label-primary));--dsws-light-deep-warn:color-mix(in srgb,var(--dsw-alias-state-warn-label) 65%,var(--dsw-alias-label-primary));--dsws-light-deep-link:color-mix(in srgb,var(--dsw-alias-link) 82%,var(--dsw-alias-label-primary));--dsws-light-deep-ok:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-label-primary))}',
      // 多行提示浮层（地图详情头、票详情、环境检查的 Tip）：第一行小标签原色 #8b8b95，白底 3.38:1，浅色下看不清；改成次要字色 5.80:1。
      'body:not([data-ds-dark-theme]) .dsws-tip>div>div:first-child{color:var(--dsw-alias-label-secondary)!important}',
      // 同一浮层的第二行标题原色 #e6edf3，白底约 1.1:1，等于看不见；改成主字色。
      // 两条都认 Tip 调用点自己挂的 .dsws-tip（HoverTip 把它转到最外层浮层节点），不再依赖内联样式文本与内容层级：
      // 内联样式改一个字节、内容多包一层，规则都会默默失效，而 CSS 与门禁都不会报错。
      'body:not([data-ds-dark-theme]) .dsws-tip>div>div:nth-child(2){color:var(--dsw-alias-label-primary)!important}',
      // 紧凑力度药丸（地图详情头、票列表行、票详情共用）：原色 #58a6ff 压 14% 蓝底只有 2.54:1；文字与边框改用深一档的蓝 4.75:1，底色换宿主浅蓝。
      'body:not([data-ds-dark-theme]) .dsws-chip.dsws-eff{color:var(--dsws-light-deep-link)!important;background:var(--dsw-alias-state-business-tertiary)!important;border-color:var(--dsws-light-deep-link)!important}',
      // 写入中标记与力度药丸同一个形状、同一套原色，按同一条规则修。
      'body:not([data-ds-dark-theme]) .dsws-chip.dsws-writing{color:var(--dsws-light-deep-link)!important;background:var(--dsw-alias-state-business-tertiary)!important;border-color:var(--dsws-light-deep-link)!important}',
      // 无仓库提示卡的标题：待重试卡原色是警告橙（白底 2.15:1）、无权访问卡 #6e7681，浅色下压在自己的浅色底上更淡；标题统一改主字色。
      'body:not([data-ds-dark-theme]) .dsws-no-repo-card .ttl[style]{color:var(--dsw-alias-label-primary)!important}',
      // 同一提示卡的说明文字原色是警告橙、#8b8b95（白底 3.38:1）或 #6e7681，改成次要字色 5.27:1。
      'body:not([data-ds-dark-theme]) .dsws-no-repo-card .desc[style]{color:var(--dsw-alias-label-secondary)!important}',
      // 待重试卡的重试按钮：琥珀底上压白字只有 2.15:1；底色保留（它是警告语义），字改成深字色 8.8:1。
      'body:not([data-ds-dark-theme]) [data-log="norepo.pending.retry"]{color:var(--dsw-alias-label-primary)!important}',
      // 红卡的「展开建仓表单」按钮：原底色 #f87171 上白字 2.77:1；换成深一档的红 6.28:1。
      'body:not([data-ds-dark-theme]) [data-log="norepo.card.expand"]{background:var(--dsws-light-deep-err)!important;color:var(--dsw-alias-label-primary-foreground)!important}',
      // 新增工作区的提交按钮：原底色 #f87171 上白字 2.77:1，按同一条改成深红。
      'body:not([data-ds-dark-theme]) [data-log="norepo.form.submit"]{background:var(--dsws-light-deep-err)!important;color:var(--dsw-alias-label-primary-foreground)!important}',
      // 票详情顶部错误块的重试按钮：原底色 #f87171 上白字 2.77:1，按同一条改成深红。
      'body:not([data-ds-dark-theme]) [data-log="detail.err.retry"]{background:var(--dsws-light-deep-err)!important;color:var(--dsw-alias-label-primary-foreground)!important}',
      // 无仓库表单错误行里的链接：原色 #58a6ff 压 12% 红底只有 2.54:1，改成深蓝。
      'body:not([data-ds-dark-theme]) .dsws-no-repo-form .err a{color:var(--dsws-light-deep-link)!important}',
      // 同一错误行里的按钮（去设置）：同一个原色，按同一条修。
      'body:not([data-ds-dark-theme]) .dsws-no-repo-form .err button{color:var(--dsws-light-deep-link)!important}',
      // 接口降级提示条：警告橙文字压在 8% 琥珀底上 2.15:1，改成深琥珀 5.10:1（65% 警告色掺 35% 主字色）。
      'body:not([data-ds-dark-theme]) [data-rest-fallback]{color:var(--dsws-light-deep-warn)!important}',
      // 同一提示条的关闭按钮自己写着琥珀色，改成继承上一行的深琥珀。
      'body:not([data-ds-dark-theme]) [data-rest-fallback] button{color:inherit!important}',
      // 列表加载遮罩里的提示文字：原色 #e6edf3 压在 45% 黑遮罩上约 1.1:1，改成主字色 5.62:1。
      'body:not([data-ds-dark-theme]) .dsws-loading-shade>span:first-child{color:var(--dsw-alias-label-primary)!important}',
      // 链路横幅（警告级）：警告橙文字压在 12% 琥珀底上 2.15:1，改成深琥珀 4.94:1。
      'body:not([data-ds-dark-theme]) .dsws-chain-banner--warn{color:var(--dsws-light-deep-warn)!important}',
      // 链路横幅（错误级）：原色是写死的错误红，压 12% 红底 2.77:1，改成深红 5.59:1。
      'body:not([data-ds-dark-theme]) .dsws-chain-banner--bad{color:var(--dsws-light-deep-err)!important}',
      // 链路横幅（信息级）：原色 #58a6ff 压 12% 蓝底 2.54:1，改成深蓝 5.01:1。
      'body:not([data-ds-dark-theme]) .dsws-chain-banner--info{color:var(--dsws-light-deep-link)!important}',
      // 链路渲染器顶部「不支持的前置」小字：原色 #8b8b95 白底 3.38:1，改成次要字色 5.80:1。
      'body:not([data-ds-dark-theme]) .dsws-chain-unsupported{color:var(--dsw-alias-label-secondary)!important}',
      // 链路表单的字段名：原色 #a1a1aa 白底约 2.4:1，改成次要字色 5.80:1。
      'body:not([data-ds-dark-theme]) .dsws-chain-form label{color:var(--dsw-alias-label-secondary)!important}',
      // 无仓库提示卡里那条错误说明：警告级原色 #fbbf24（琥珀底上 1.48:1）、错误级 #f87171（红底上约 2.9:1），都读不清；
      // 语义色已经由左侧图标与重试按钮的边框承担，正文改主字色（15:1 上下）保证可读。
      'body:not([data-ds-dark-theme]) .dsws-no-repo-form .err{color:var(--dsw-alias-label-primary)!important}',

      // 环境检查页签每条检查项下面的提示字（.dsws-ccard .dt）：原色 #d97706，白底 3.19:1，12px 小字看不清；改成深琥珀 5.43:1。
      'body:not([data-ds-dark-theme]) .dsws-ccard .dt{color:var(--dsws-light-deep-warn)!important}',

      // #1379 收口：五处个例的组件侧已挂稳定类名 / data-state，下面按状态给浅色值。
      // 票详情顶部错误横幅的正文（IssueDetail.ts 的 .dsws-detail-err）：原色是写死的错误红，压在 8% 红底上只有 2.56:1；改用宿主错误色掺 20% 主字色后 5.82:1——语义仍是错误红，掺主字色只为压深一档保证可读，换肤时跟着宿主走。
      'body:not([data-ds-dark-theme]) .dsws-detail-err{color:var(--dsws-light-deep-err)!important}',
      // 同一横幅里的「（显示快照降级）」小字（.dsws-detail-err-degraded）：原色是写死的警告橙，压在同一条 8% 红底上只有 1.99:1；改成宿主警告标签色掺 35% 主字色后 5.03:1——警告语义由 --dsw-alias-state-warn-label 承担，不再用写死的橙。
      'body:not([data-ds-dark-theme]) .dsws-detail-err-degraded{color:var(--dsws-light-deep-warn)!important}',
      // 已关闭列表的「在网页上看全部 / 游标已失效」两条提示（.dsws-closed-note[data-state="warn"]）：原色是写死的警告橙，白底 2.15:1；改成宿主警告标签色掺 35% 主字色后 5.43:1。
      'body:not([data-ds-dark-theme]) .dsws-closed-note[data-state="warn"]{color:var(--dsws-light-deep-warn)!important}',
      // 已关闭列表的「取不到下一页」提示（.dsws-closed-note[data-state="bad"]）：原色是写死的错误红，白底 2.77:1；改成宿主错误色掺 20% 主字色后 6.28:1。
      'body:not([data-ds-dark-theme]) .dsws-closed-note[data-state="bad"]{color:var(--dsws-light-deep-err)!important}',
      // 拉取请求页签「打开」那一行的票号与状态药丸（.dsws-aggrow[data-state="open"]）：原色是写死的完成绿，白底 2.54:1、药丸压 15% 绿底 2.23:1；改成宿主成功色掺 45% 主字色后 5.82:1 / 5.11:1——绿色本身比琥珀亮，掺得比警告色更深才有余量。
      'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="open"] .dsws-idnum,body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="open"] .dsws-pr-state{color:var(--dsws-light-deep-ok)!important;border-color:var(--dsws-light-deep-ok)!important}',
      // 拉取请求页签「已关闭」那一行（.dsws-aggrow[data-state="closed"]）：原色是写死的次要灰，白底 3.08:1、药丸压 15% 灰底 2.67:1；改成宿主次要字色后 5.80:1 / 5.04:1——它本来就是「中性灰」的意思，次要字色正是宿主里同一语义的 token。
      'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="closed"] .dsws-idnum,body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="closed"] .dsws-pr-state{color:var(--dsw-alias-label-secondary)!important;border-color:var(--dsw-alias-label-secondary)!important}',
      // 拉取请求页签「已合并」那一行（.dsws-aggrow[data-state="merged"]）：原色是中央色表里的探索紫，白底 2.64:1、药丸压 16% 紫底 2.29:1；改成宿主成功色掺 45% 主字色后 5.82:1 / 5.05:1——已合并是「成功收尾」，浅色下用宿主成功色比紫色更贴语义，也不与地图卡的紫撞色。
      'body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="merged"] .dsws-idnum,body:not([data-ds-dark-theme]) .dsws-aggrow[data-state="merged"] .dsws-pr-state{color:var(--dsws-light-deep-ok)!important;border-color:var(--dsws-light-deep-ok)!important}',
      // 无仓库提示卡「未选后端」的罗盘图标（.dsws-no-repo-card[data-state="other"]>.head>svg）：原色是写死的次要灰，压 8% 灰底 4.17:1（图形 3:1 本来够，但它是写死的十六进制、不跟主题）；改成宿主次要字色后 5.27:1——图标颜色内联在 svg 上，只有 !important 盖得住。
      'body:not([data-ds-dark-theme]) .dsws-no-repo-card[data-state="other"]>.head>svg{color:var(--dsw-alias-label-secondary)!important}',
      // 无仓库提示卡「建仓失败」的警告三角（.dsws-no-repo-card[data-state="bad"]>.head>svg）：原色是写死的错误红，白底 2.77:1，图形要 3:1 也不够；改成宿主错误色掺 20% 主字色后 6.28:1。
      'body:not([data-ds-dark-theme]) .dsws-no-repo-card[data-state="bad"]>.head>svg{color:var(--dsws-light-deep-err)!important}',
      // 环境检查页签「已完成」那条检查项的名字（.dsws-ccard[data-state="done"] .nm）：原色是写死的浅绿，白底 1.74:1；改成宿主成功色掺 45% 主字色后 5.82:1。
      'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="done"] .nm{color:var(--dsws-light-deep-ok)!important}',
      // 环境检查页签「进行中」那条检查项的名字（.dsws-ccard[data-state="current"] .nm）：原色是写死的警告橙，白底 2.15:1；改成宿主警告标签色掺 35% 主字色后 5.43:1。
      'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="current"] .nm{color:var(--dsws-light-deep-warn)!important}',
      // 环境检查页签「失败」那条检查项的名字（.dsws-ccard[data-state="fail"] .nm）：原色是写死的错误红，白底 2.77:1；改成宿主错误色掺 20% 主字色后 6.28:1。
      'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="fail"] .nm{color:var(--dsws-light-deep-err)!important}',
      // 环境检查页签「还没轮到」那条检查项的名字（.dsws-ccard[data-state="pending"] .nm）：原色是写死的浅灰，白底 2.56:1；改成宿主次要字色后 5.80:1。
      'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="pending"] .nm{color:var(--dsw-alias-label-secondary)!important}',
      // 环境检查页签「进行中」那条的状态圆点（.dsws-ccard[data-state="current"] .dsws-ccard-dot）：原底色是写死的警告橙，白底 2.15:1，图形要 3:1 不够；改成宿主警告标签色掺 35% 主字色后 5.43:1，圆点里的白字仍读得清。
      'body:not([data-ds-dark-theme]) .dsws-ccard[data-state="current"] .dsws-ccard-dot{background:var(--dsws-light-deep-warn)!important}',

      // #1388：宿主说明文字（caption）在浅色下只有 2.13:1。插件不写死颜色，
  //   把 caption 令牌本身换成宿主更深一档的次要文字（浅色约 5.8:1）；深色不受这条影响。
  'body:not([data-ds-dark-theme]){--dsw-alias-label-caption:var(--dsw-alias-label-secondary)!important}',
  // #1388：环境检查页顶的后端徽标（ChecksTab.ts 的 .dsws-env-badge）：原色 #9a9aff 白底 2.49:1；
  //   徽标是后端身份，改用宿主链接深蓝（约 5.0:1），边框同色，换肤时跟着宿主走。
  'body:not([data-ds-dark-theme]) .dsws-env-badge{color:var(--dsws-light-deep-link)!important;border-color:var(--dsws-light-deep-link)!important}',
  // #1388：环境检查页的检测中提示（ChecksTab.ts 的 .dsws-env-detecting）：原色 #8b8b95 白底 3.37:1；
  //   改用宿主次要文字（浅色约 5.8:1）。
  'body:not([data-ds-dark-theme]) .dsws-env-detecting{color:var(--dsw-alias-label-secondary)!important}',
  // #1388：表单字段预览行（modal-fields.ts 的 .dsws-modal-preview）：原色 #58a6ff 白底约 2.5:1；
  //   预览是算出来的目标名，归链接语义，改用宿主链接深蓝（约 5.0:1）。
  'body:not([data-ds-dark-theme]) .dsws-modal-preview{color:var(--dsws-light-deep-link)!important}',
  // #1388：横幅坏态（kernel/styles.ts 的 .dsws-banner.bad）：原字色 #f87171 压浅红底 2.46:1；
  //   改用宿主错误深红（约 6.3:1），底与边框不动，错误语义不变。
  'body:not([data-ds-dark-theme]) .dsws-banner.bad{color:var(--dsws-light-deep-err)!important}',
  // #1388：版本控制页的弱说明字（vcStyles.ts 的 --vc-faint）：浅色值 #948875 压纸面 3.09:1；
  //   直接把令牌换成宿主次要文字（浅色约 5.8:1），占位符、说明、栏目标题三处一起好；深色令牌不动。
  'body:not([data-ds-dark-theme]) [data-vc-root]{--vc-faint:var(--dsw-alias-label-secondary)!important}',
  // #1388：票卡片彩色标签里白字深字都到不了 4.5 的底（动作紫 #8b5cf6 一带，组件按 data-cd-boost 标出来）：
  //   字换宿主浅字（接近纯白），底上加一层 18% 深墨罩纱（约到 5.4:1）；
  //   像素描边照原样保留，只是把写死的白黑换成令牌，换肤时不断。
  'body:not([data-ds-dark-theme]) .cd-chip[data-cd-boost="1"]{color:var(--dsw-alias-label-primary-foreground)!important;box-shadow:inset 2px 2px 0 color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 35%, transparent),inset -2px -2px 0 color-mix(in srgb, var(--cd-ink) 28%, transparent),2px 2px 0 var(--cd-shadow),inset 0 0 0 999px color-mix(in srgb, var(--cd-ink) 18%, transparent)!important}',
  // #1388：票卡片彩色动作按钮同上（PixelCardBtns.ts 同一标记）：字换浅字，底加 18% 深墨罩纱；常态阴影保留。
  'body:not([data-ds-dark-theme]) .cd-abtn[data-cd-boost="1"]{color:var(--dsw-alias-label-primary-foreground)!important;box-shadow:2px 2px 0 var(--cd-shadow),inset 0 0 0 999px color-mix(in srgb, var(--cd-ink) 18%, transparent)!important}',
  // #1388：票卡片票号徽标同上（PixelCardNo.ts 实心款同一标记）：字换浅字，底加 18% 深墨罩纱；常态阴影保留。
  'body:not([data-ds-dark-theme]) .cd-nonum[data-cd-boost="1"]{color:var(--dsw-alias-label-primary-foreground)!important;box-shadow:2px 2px 0 var(--cd-shadow),inset 0 0 0 999px color-mix(in srgb, var(--cd-ink) 18%, transparent)!important}',
  // #1379 浅色个例修复层（结束）
      '@media (prefers-reduced-motion: reduce){.dsws-ink{transition:none!important}.dsws-ink.dsws-ink-squash{animation:none!important}.dsws-hov,.dsws-hov.dsws-pressing{transition:none!important;transform:none}[data-press].dsws-pressing{transform:none!important}}',
    ].join('')
