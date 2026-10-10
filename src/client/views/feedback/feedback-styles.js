/**
 * views/feedback/feedback-styles.js — 交互反馈三批的视觉语言（948 图 949/950/951 落地）。
 *
 * 契约：本文件是一段 CSS 文本（ESM 导出）；scripts/build.mjs 去掉行首 export 后拼进
 * src/client/index.js 的拼接标记处，与 kernel/styles.js、vcStyles.js、pxSkillStyles.js
 * 同一套做法（一源两物）。注入仍走同一个 styles.insert 接缝（index.js 里紧接着再
 * insert 一次），没有第二个 <style>，也没有新的注入机制。
 * 另起叶子的原因：kernel/styles.js 已贴 350 行上限（#851 同款先例），反馈规则只许
 * 叠加不许顶布局，单独成叶后 952 到 956 的新反馈样式也加在这里，不再回 styles.js。
 * 规则只用滤镜、外圈描边、阴影、透明度、小位移，不动宽高边距；颜色只复用既有色，
 * 原型里的占位红一个字面量都不许进生产（门禁逐字盯）。
 */
export const FEEDBACK_STYLE_TEXT = [
      // #948 首批（#949 瞬间底座）：只叠加不顶布局，只用滤镜、外圈描边、阴影（描边蓝复用 #58a6ff）；ghost 整类与 .dsws-fb-dark 走外圈描边代替加深；悬停浮起挂既有 .dsws-btn 只加阴影。
      '.dsws-chip:active,.dsws-chip-fb:active{filter:brightness(.82)}.dsws-trow:active,.dsws-aggrow:active{filter:brightness(.9)}',
      '.dsws-panel :focus-visible{outline:2px solid #58a6ff;outline-offset:2px}',
      '.dsws-btn:hover{box-shadow:0 6px 16px rgba(0,0,0,.45)}',
      '.dsws-btn.ghost:active{outline:2px solid rgba(255,255,255,.55);outline-offset:1px}',
      '.dsws-fb-dark:active,.dsws-fb-dark.fb-pressed{outline:2px solid rgba(255,255,255,.85);outline-offset:1px}',
      '@media (prefers-reduced-motion: reduce){.dsws-chip:active,.dsws-chip-fb:active,.dsws-trow:active,.dsws-aggrow:active{filter:brightness(.82)}.dsws-panel :focus-visible{outline:2px solid #58a6ff;outline-offset:2px}}',
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
      '.dsws-btn.primary:active::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,.55),transparent 70%);opacity:0;animation:dsws-ripple .55s ease-out}',
      '@keyframes dsws-ripple{0%{opacity:.8;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}',
      '.dsws-btn.ghost:active{animation:dsws-ringout .6s ease-out}',
      '@keyframes dsws-ringout{0%{box-shadow:0 0 0 0 rgba(88,166,255,.7)}100%{box-shadow:0 0 0 12px rgba(88,166,255,0)}}',
      '.dsws-btn.primary:active{transform:scale(.98) translateY(1px)}',
      '.dsws-modalbox .dsws-btn.primary:active{transform:scale(.98) translateY(1px) rotate(-1.2deg)}',
      '.dsws-modalbox .dsws-btn.primary.dsws-fb-sheen:active::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);opacity:0;animation:dsws-sheen .5s ease}',
      '@keyframes dsws-sheen{0%{opacity:0;transform:translateX(-30%)}100%{opacity:.9;transform:translateX(30%)}}',
      '.dsws-seg:active,.dsws-skillbtn:active,.dsws-cfg-btn:active,.dsws-skillpop-row:active{filter:brightness(.85)}',
      '@media (prefers-reduced-motion: reduce){.dsws-btn.primary:active::after,.dsws-modalbox .dsws-btn.primary.dsws-fb-sheen:active::before{animation:none;opacity:0}.dsws-btn.ghost:active{animation:none}.dsws-btn.primary:active,.dsws-modalbox .dsws-btn.primary:active{transform:none}}',
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
    ].join('')
