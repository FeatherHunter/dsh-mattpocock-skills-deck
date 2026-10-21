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
      '.dsws-panel :focus-visible{outline:2px solid #58a6ff;outline-offset:2px}',
      '.dsws-btn:hover{box-shadow:0 6px 16px rgba(0,0,0,.45)}',
      '.dsws-btn.ghost.dsws-pressing{outline:2px solid rgba(255,255,255,.55);outline-offset:1px}',
      '.dsws-fb-dark.dsws-pressing,.dsws-fb-dark.fb-pressed{outline:2px solid rgba(255,255,255,.85);outline-offset:1px}',
      '@media (prefers-reduced-motion: reduce){.dsws-chip.dsws-pressing,.dsws-chip-fb.dsws-pressing,.dsws-trow.dsws-pressing,.dsws-aggrow.dsws-pressing{filter:brightness(.82)}.dsws-panel :focus-visible{outline:2px solid #58a6ff;outline-offset:2px}}',
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
      '@keyframes dsws-ringout{0%{box-shadow:0 0 0 0 rgba(88,166,255,.7)}100%{box-shadow:0 0 0 12px rgba(88,166,255,0)}}',
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
      // 页签只有悬停变色（原来连这个都没有）；药丸加一层轻微提亮，按下由通用按压态负责。
      '@media (hover:hover) and (pointer:fine){.dsws-tab:hover:not(.on){background:rgba(255,255,255,.07);color:var(--dsw-alias-label-primary,#e6edf3)}.dsws-chip:hover:not(.dsws-pressing){filter:brightness(1.12);box-shadow:0 0 0 1px rgba(255,255,255,.16)}}',
      // 选中的那一颗悬停时墨块已经在它底下，再补一档提亮，保证「悬停有反馈」对五颗页签每一颗都成立。
      '@media (hover:hover) and (pointer:fine){.dsws-ink-host .dsws-tab:hover:not(.dsws-pressing){filter:brightness(1.12)}}',
      // 通用按压/悬停：给清单里原来没有任何反馈的控件（仓库名、切后端、调色板、新建需求、+bug、
      //   workroute、地图卡片、折叠条、父链接、设置页按钮与插件行等）同一套语言；只用亮度与小位移。
      '.dsws-pressing{filter:brightness(.85)}',
      '.dsws-tab.dsws-pressing,.dsws-chip.dsws-pressing{filter:brightness(.8)}',
      '@media (hover:hover) and (pointer:fine){.dsws-hov:hover:not(.dsws-pressing){box-shadow:0 0 0 1px rgba(255,255,255,.2),0 2px 10px rgba(0,0,0,.25);filter:brightness(1.06)}}',
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
      '@media (hover:hover) and (pointer:fine){[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node):hover:not(.dsws-pressing){filter:brightness(1.14);box-shadow:0 0 0 1px rgba(255,255,255,.28),0 2px 10px rgba(0,0,0,.3)}}',
      '[data-press]:not(.dsws-aggrow):not(.dsws-trow):not(.dsws-node).dsws-pressing{filter:brightness(.82)}',
      '[data-press="button"].dsws-pressing,[data-press="link"].dsws-pressing,[data-press="switch"].dsws-pressing{transform:translateY(1px)}',
      '.dsws-btn[data-press],[data-press="link"],[data-press="switch"]{transition:filter .12s ease,box-shadow .12s ease,transform .08s ease}',
      // 地图详情的工单卡：整张卡热与按下；卡片内部按钮各自还有自己的反馈，不互相顶掉。
      '@media (hover:hover) and (pointer:fine){.dsws-node:hover{border-color:rgba(255,255,255,.28)!important;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 4px 14px rgba(0,0,0,.3)}}',
      '.dsws-node.dsws-pressing{filter:brightness(.9)}',
      // 战雾（未揭晓）卡片靠整张 blur 表示「还没揭晓」。通用按压规则是纯亮度滤镜，特异度一样但注入更晚，
      //   按住时会把 blur 顶掉、卡片一下子变清晰，等于提前剧透。这里单给一条：模糊照旧，只把亮度压得更暗；
      //   :not(.revealed) 是因为已揭晓的卡片 filter 本来是 none，不能又给它糊回去。
      '.dsws-node.fog:not(.revealed).dsws-pressing{filter:blur(2.4px) brightness(.28)}',
      // 键盘焦点：面板内已有规则，这里补到页签行、筛选药丸与清单里的小按钮，焦点环不删。
      '.dsws-tab:focus-visible,.dsws-chip:focus-visible,.dsws-hov:focus-visible,.dsws-workroute:focus-visible{outline:1px solid #58a6ff;outline-offset:1px}',
      '@media (prefers-reduced-motion: reduce){.dsws-ink{transition:none!important}.dsws-ink.dsws-ink-squash{animation:none!important}.dsws-hov,.dsws-hov.dsws-pressing{transition:none!important;transform:none}[data-press].dsws-pressing{transform:none!important}}',
    ].join('')
