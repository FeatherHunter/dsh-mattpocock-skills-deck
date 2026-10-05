/**
 * src/client/views/versionControl/vcStyles.js — 版本管理页签的皮肤（#853：深色 A 工程台账 / 浅色 C 纸质便签）
 *
 * 契约：本文件是一段 CSS 文本（ESM 导出）；scripts/build.mjs 去掉行首 export 后拼进 src/client/index.js
 *   的拼接标记处，与 kernel/styles.js 同一套做法（一源两物）。注入仍走同一个 styles.insert 接缝
 *   （index.js 里紧接着再 insert 一次），没有第二个 <style>，也没有新的注入机制。
 * 为什么是独立叶子：kernel/styles.js 已经 350/350 行、在 tests/verify-file-granularity.js 里是冻结基线。
 *
 * 这一版换的是**皮肤**（颜色、圆角、行距、字距），布局那一层是 #854 的「视图切换」。
 *
 * 两套皮肤各自对应哪一份原型：
 *   深色 = #853 的 A「工程台账」（UI UX Pro Max 的 Data-Dense Dashboard：深蓝灰、4px 圆角、
 *         细行高、发丝线分段、绿色强调）；
 *   浅色 = #853 的 C「纸质便签」（纸面底色、2px 圆角 + 1px 实线、稍宽的行距、深绿强调、贴纸式标签）。
 *
 * 为什么不用 DSH 自己的 --dsw-alias-* 颜色：那些令牌会让这一页跟着宿主主题走，看起来是「宿主的页面」
 *   而不是「一块设计过的面板」—— 而人验收时说的正是「看着像没生效 CSS / 不好看」。所以这一页自己定令牌，
 *   但**判据仍然用宿主的主题开关**（body[data-ds-dark-theme]），这样人在 DSH 里切一次主题就整体换肤，
 *   不在面板里另做一个开关（人明说要「一键换肤」那种感觉）。
 *   令牌全部以 --vc- 开头，只在 [data-vc-root] 这一棵子树里生效，不外溢到面板其它页签。
 *
 * 一键换肤（能力支持、不向用户提供开关）：平时跟随宿主主题自动切换；需要强制预览某一套皮肤时，
 *   在面板控制台执行一行即可，不经过构建、不改任何文件：
 *   document.querySelector('[data-vc-root]').setAttribute('data-vc-theme', 'light')（或 'dark'）；
 *   去掉强制就恢复跟随：document.querySelector('[data-vc-root]').removeAttribute('data-vc-theme')。
 *   下面导出的 vcSetTheme / vcClearTheme 只是把这两行包成函数，行为与手写属性完全一致。
 */
export const VC_STYLE_TEXT = [
  // ---- 皮肤令牌：深色（A 工程台账，原型 853-vc-styles.css 的 [data-style="A"] 一字不差） ----
  "body[data-ds-dark-theme] [data-vc-root]{--vc-paper:#131c2f;--vc-inset:#0b1120;--vc-elevated:#1a2438;--vc-hover:color-mix(in srgb,#f8fafc 6%,transparent)" +
    ";--vc-ink:#f8fafc;--vc-ink2:#cbd5e1;--vc-mut:#94a3b8;--vc-faint:#64748b" +
    ";--vc-line:rgba(148,163,184,.22);--vc-line2:rgba(148,163,184,.40)" +
    ";--vc-accent:#22c55e;--vc-accent-ink:#052e16;--vc-danger:#ef4444;--vc-warn:#f59e0b;--vc-info:#38bdf8" +
    ";--vc-radius:4px;--vc-shell-radius:6px;--vc-btn-h:26px" +
    ";--vc-row-h:30px;--vc-row-py:6px;--vc-row-px:8px;--vc-row-font:12.5px;--vc-sec-font:10.5px;--vc-sec-track:.16em;--vc-shadow:none}",
  // ---- 皮肤令牌：浅色（C 纸质便签，原型 [data-style="C"] 一字不差；强调色是深绿不是亮绿） ----
  "body:not([data-ds-dark-theme]) [data-vc-root]{--vc-paper:#f6f1e6;--vc-inset:#efe8d9;--vc-elevated:#fffdf8;--vc-hover:color-mix(in srgb,#221d15 6%,transparent)" +
    ";--vc-ink:#221d15;--vc-ink2:#4a4034;--vc-mut:#6f6252;--vc-faint:#948875" +
    ";--vc-line:rgba(34,29,21,.22);--vc-line2:rgba(34,29,21,.45)" +
    ";--vc-accent:#15803d;--vc-accent-ink:#f0fdf4;--vc-danger:#b91c1c;--vc-warn:#b45309;--vc-info:#1d4ed8" +
    ";--vc-radius:2px;--vc-shell-radius:3px;--vc-btn-h:28px" +
    ";--vc-row-h:32px;--vc-row-py:7px;--vc-row-px:9px;--vc-row-font:13px;--vc-sec-font:11px;--vc-sec-track:.1em;--vc-shadow:0 2px 0 rgba(0,0,0,.4)}",
  // ---- 一键换肤的手动挡：根上写 data-vc-theme 就不再看 body 开关（只给调试与验收用，不向用户提供开关） ----
  // 选择器前面带 body 是为了与上面两条自动档同级（同级时后写的赢），不带 body 会被自动档盖掉。
  "body [data-vc-root][data-vc-theme=\"dark\"]{--vc-paper:#131c2f;--vc-inset:#0b1120;--vc-elevated:#1a2438;--vc-hover:color-mix(in srgb,#f8fafc 6%,transparent)" +
    ";--vc-ink:#f8fafc;--vc-ink2:#cbd5e1;--vc-mut:#94a3b8;--vc-faint:#64748b" +
    ";--vc-line:rgba(148,163,184,.22);--vc-line2:rgba(148,163,184,.40)" +
    ";--vc-accent:#22c55e;--vc-accent-ink:#052e16;--vc-danger:#ef4444;--vc-warn:#f59e0b;--vc-info:#38bdf8" +
    ";--vc-radius:4px;--vc-shell-radius:6px;--vc-btn-h:26px" +
    ";--vc-row-h:30px;--vc-row-py:6px;--vc-row-px:8px;--vc-row-font:12.5px;--vc-sec-font:10.5px;--vc-sec-track:.16em;--vc-shadow:none}",
  "body [data-vc-root][data-vc-theme=\"light\"]{--vc-paper:#f6f1e6;--vc-inset:#efe8d9;--vc-elevated:#fffdf8;--vc-hover:color-mix(in srgb,#221d15 6%,transparent)" +
    ";--vc-ink:#221d15;--vc-ink2:#4a4034;--vc-mut:#6f6252;--vc-faint:#948875" +
    ";--vc-line:rgba(34,29,21,.22);--vc-line2:rgba(34,29,21,.45)" +
    ";--vc-accent:#15803d;--vc-accent-ink:#f0fdf4;--vc-danger:#b91c1c;--vc-warn:#b45309;--vc-info:#1d4ed8" +
    ";--vc-radius:2px;--vc-shell-radius:3px;--vc-btn-h:28px" +
    ";--vc-row-h:32px;--vc-row-py:7px;--vc-row-px:9px;--vc-row-font:13px;--vc-sec-font:11px;--vc-sec-track:.1em;--vc-shadow:0 2px 0 rgba(0,0,0,.4)}",
  // ---- 皮肤容器：这一页自己是一块面板（圆角与内边距按原型：深色 6px、浅色 3px，统一 12px 内边距） ----
  "[data-vc-root]{background:var(--vc-paper);color:var(--vc-ink);border:1px solid var(--vc-line);border-radius:var(--vc-shell-radius,6px);padding:12px;box-shadow:var(--vc-shadow);font-size:var(--vc-row-font);line-height:1.5}",
  // ---- 文件行：等宽路径、表格数字、悬停抬一层、行高按皮肤 ----
  ".dsws-vc-row{min-height:var(--vc-row-h);padding:var(--vc-row-py) var(--vc-row-px);border-radius:calc(var(--vc-radius) * 2);font-size:var(--vc-row-font)}",
  "[data-vc-root] [data-vc-file]{border-top-color:var(--vc-line) !important}",
  "[data-vc-root] [data-vc-file]>.dsws-vc-row:hover{background:var(--vc-hover)}",
  "[data-vc-open]>.dsws-vc-row{background:var(--vc-hover);box-shadow:inset 2px 0 0 var(--vc-accent,transparent)}",
  // ---- 状态字母徽章 ----
  ".dsws-vc-badge{min-width:18px;height:18px;padding:0 4px;border:1px solid var(--vc-line2);border-radius:var(--vc-radius);font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:10.5px;font-weight:700;line-height:1}",
  ".dsws-vc-badge.is-added{color:var(--vc-accent,#22c55e);border-color:var(--vc-accent,#22c55e)}",
  ".dsws-vc-badge.is-modified{color:var(--vc-info,#38bdf8);border-color:var(--vc-info,#38bdf8)}",
  ".dsws-vc-badge.is-deleted{color:var(--vc-danger,#ef4444);border-color:var(--vc-danger,#ef4444)}",
  ".dsws-vc-badge.is-renamed,.dsws-vc-badge.is-typechange{color:var(--vc-warn,#f59e0b);border-color:var(--vc-warn,#f59e0b)}",
  ".dsws-vc-badge.is-untracked{color:var(--vc-mut,#94a3b8)}",
  // 浅色那套是「贴纸」：加一层实底，与深色那套的描边方框刻意不同手（两套判据各写一遍：跟随主题与手动强制）
  "body:not([data-ds-dark-theme]) .dsws-vc-badge,body [data-vc-root][data-vc-theme=\"light\"] .dsws-vc-badge{box-shadow:0 1px 0 rgba(0,0,0,.25)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-added,body [data-vc-root][data-vc-theme=\"light\"] .dsws-vc-badge.is-added{background:rgba(21,128,61,.16)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-modified,body [data-vc-root][data-vc-theme=\"light\"] .dsws-vc-badge.is-modified{background:rgba(29,78,216,.14)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-deleted,body [data-vc-root][data-vc-theme=\"light\"] .dsws-vc-badge.is-deleted{background:rgba(185,28,28,.14)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-renamed,body:not([data-ds-dark-theme]) .dsws-vc-badge.is-typechange," +
    "body [data-vc-root][data-vc-theme=\"light\"] .dsws-vc-badge.is-renamed,body [data-vc-root][data-vc-theme=\"light\"] .dsws-vc-badge.is-typechange{background:rgba(180,83,9,.14)}",
  // 浅色身份行大一号（原型 C 的 v3-id 16px），手动强制那一档同样生效
  "body:not([data-ds-dark-theme]) .dsws-vc-id,body [data-vc-root][data-vc-theme=\"light\"] .dsws-vc-id{font-size:16px}",
  // 手动强制深色时，即使 body 处在浅色，也要撕掉纸面那层贴纸与大字（与上一条同级、后写胜出）
  "body [data-vc-root][data-vc-theme=\"dark\"] .dsws-vc-badge{box-shadow:none;background:transparent}",
  "body [data-vc-root][data-vc-theme=\"dark\"] .dsws-vc-id{font-size:15px}",
  // ---- 正负行数 ----
  ".dsws-vc-add,.dsws-vc-del{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-variant-numeric:tabular-nums}",
  ".dsws-vc-add{color:var(--vc-accent,#22c55e)}",
  ".dsws-vc-del{color:var(--vc-danger,#ef4444)}",
  // ---- 段小标题 ----
  ".dsws-vc-sec{font-size:var(--vc-sec-font);letter-spacing:var(--vc-sec-track);padding:0 0 5px;margin:14px 0 0;border-bottom:1px solid var(--vc-line)}",
  // ---- 身份行与计数行（原型 v3-id：深色 15px、浅色 16px；浅色那条在徽章段已写两套判据） ----
  ".dsws-vc-id{font-size:15px;font-weight:700;letter-spacing:-.01em}",
  ".dsws-vc-count{font-size:11px;font-variant-numeric:tabular-nums}",
  // ---- 补丁块 ----
  ".dsws-vc-card{background:var(--vc-inset);border:1px solid var(--vc-line);border-radius:calc(var(--vc-radius) * 2);padding:10px 12px}",
  ".dsws-vc-diff{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:11.5px;line-height:1.6;overflow:auto;max-height:320px}",
  // ---- 提示带、错误块、空态 ----
  "[data-vc-root] [data-vc-hint]{background:var(--vc-inset) !important;border-color:var(--vc-line) !important;border-radius:var(--vc-radius)}",
  "[data-vc-root] [data-vc-error]{border-color:var(--vc-line2) !important;border-radius:calc(var(--vc-radius) * 2)}",
  "[data-vc-root] [data-vc-empty]{color:var(--vc-mut,inherit)}",
  // ---- 链接：原型是强调色常驻（不是继承色），悬停才加下划线 ----
  ".dsws-vc-link{color:var(--vc-accent);text-decoration:none;border-bottom:1px solid transparent;cursor:pointer}",
  ".dsws-vc-link:hover{border-bottom-color:currentColor;text-decoration:underline}",
  // ---- 按钮与输入框：普通按钮透明底（原型 v3-btn），悬停是 8% 提亮；主按钮用皮肤强调色与对应墨色 ----
  "[data-vc-root] .dsws-btn{background:transparent;border:1px solid var(--vc-line2);border-radius:var(--vc-radius);min-height:var(--vc-btn-h,26px)}",
  "[data-vc-root] .dsws-btn:hover{border-color:var(--vc-ink2);background:var(--vc-hover)}",
  "[data-vc-root] .dsws-btn.primary{background:var(--vc-accent);border-color:var(--vc-accent);color:var(--vc-accent-ink)}",
  "[data-vc-root] .dsws-btn:disabled{opacity:.4;cursor:not-allowed}",
  "[data-vc-root] textarea,[data-vc-root] input{background:var(--vc-inset);border:1px solid var(--vc-line2);border-radius:var(--vc-radius);color:var(--vc-ink)}",
  "[data-vc-root] textarea::placeholder,[data-vc-root] input::placeholder{color:var(--vc-faint)}",
  "[data-vc-root] textarea:focus,[data-vc-root] input:focus{outline:2px solid var(--vc-accent);outline-offset:1px}",
  ".dsws-vc-caption{font-size:11.5px;color:var(--vc-faint,inherit)}",
  // 提交输入框吃原型的输入尺寸（两套皮肤各自的行字号，内边距 7px 9px）。
  "[data-vc-commit-area] input{font-size:var(--vc-row-font);padding:7px 9px}",
  // ---- 身份区（原型 v3-id 加 v3-sub）：重新读一次是同行最右的绿色链接，不是描边按钮 ----
  "[data-vc-readat]{margin-top:4px}",
  "[data-vc-root] button[data-vc-reload]{margin-left:auto;background:transparent;border-color:transparent;color:var(--vc-accent);min-height:0;font-size:12px;padding:0}",
  "[data-vc-root] button[data-vc-reload]:hover{border-color:transparent;background:transparent;text-decoration:underline}",
  // 身份区三行按原型收紧：路径与同步是次级灰小字，分支保持大字重
  "[data-vc-path],[data-vc-sync]{font-size:11.5px;color:var(--vc-mut)}",
  "[data-vc-sync]{margin-top:4px}",
  ".dsws-vc-sep{border-color:var(--vc-line)}",
  // #853 第三步：视图页签——平时是三个并排的词，选中的那一档下面压一条强调色；窄了就换行，不断字。
  // 字号与内边距照抄原型 lay-views（12.5px / 8px 13px），分隔线用 line2。
  ".dsws-vc-views{display:flex;gap:0;flex-wrap:wrap;border-bottom:1px solid var(--vc-line2);margin:10px 0 12px}",
  ".dsws-vc-view{appearance:none;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--vc-mut);font:inherit;font-size:12.5px;padding:8px 13px;cursor:pointer;display:inline-flex;gap:6px;align-items:baseline}",
  ".dsws-vc-view .dsws-vc-mono{font-size:11px}",
  ".dsws-vc-view.is-on{color:var(--vc-ink);border-bottom-color:var(--vc-accent);font-weight:650}",
  // 数字条（854 布局 C 原型的 stat 三格：冲突红、已暂存绿、未暂存蓝，浅色纸面加一层实影）。
  ".dsws-vc-stats{display:flex;gap:7px;margin:10px 0 12px}",
  ".dsws-vc-stat{flex:1;min-width:0;padding:7px 9px;border:1px solid var(--vc-line);border-radius:var(--vc-radius);background:var(--vc-inset)}",
  ".dsws-vc-stat-n{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-variant-numeric:tabular-nums;font-size:19px;font-weight:700;line-height:1.15}",
  ".dsws-vc-stat-t{font-size:10.5px;color:var(--vc-mut);margin-top:1px}",
  ".dsws-vc-stat[data-vc-stat=conflict] .dsws-vc-stat-n{color:var(--vc-danger)}",
  ".dsws-vc-stat[data-vc-stat=staged] .dsws-vc-stat-n{color:var(--vc-accent)}",
  ".dsws-vc-stat[data-vc-stat=unstaged] .dsws-vc-stat-n{color:var(--vc-info)}",
  // 视图条（854 布局 C 原型的 viewbar：虚线框里横排提交动作 inline 输入与提交按钮）。
  ".dsws-vc-viewbar{display:flex;flex-direction:column;gap:8px;margin:0 0 10px;padding:7px 8px;border:1px dashed var(--vc-line2);border-radius:var(--vc-radius)}",
  ".dsws-vc-viewbar-row{display:flex;gap:7px;align-items:center;flex-wrap:wrap}",
  // 根取消统一 gap 后块间节奏按原型走：提示与异常带下留 10px，执行结果与确认框上留 10px。
  "[data-vc-root] [data-vc-hint],[data-vc-root] [data-vc-band]{margin-bottom:10px}",
  "[data-vc-root] [data-vc-op-result],[data-vc-root] [data-vc-confirm],[data-vc-root] [data-vc-remote-choice]{margin-top:10px}",
  ".dsws-vc-viewbar-lbl{font-size:10.5px;color:var(--vc-faint);font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace}",
  // #857 P5/P6：骨架条——固定高度占位，不跳；减弱动态偏好下静止。
  ".dsws-vc-skel{border-radius:4px;background:linear-gradient(90deg,var(--vc-hover,rgba(127,127,160,.12)) 25%,var(--vc-elevated,#16181d) 50%,var(--vc-hover,rgba(127,127,160,.12)) 75%);background-size:200% 100%;animation:dsws-vc-shimmer 1.4s linear infinite;margin:7px 0}",
  "@keyframes dsws-vc-shimmer{to{background-position:-200% 0}}",
  "@media (prefers-reduced-motion:reduce){.dsws-vc-skel{animation:none}}",
].join('')
// 一键换肤的两个小函数（只包属性读写，不碰样式表；面板里不提供开关，验收与调试时在控制台调用）。
// 用法：vcSetTheme('light') 强制纸面皮肤，vcSetTheme('dark') 强制台账皮肤，vcClearTheme() 恢复跟随宿主。
export const vcSetTheme = function (theme) {
  try {
    const root = typeof document !== 'undefined' ? document.querySelector('[data-vc-root]') : null
    if (!root) return theme
    if (theme === 'dark' || theme === 'light') root.setAttribute('data-vc-theme', theme)
    else root.removeAttribute('data-vc-theme')
    return theme
  } catch (e) { return theme }
}
export const vcClearTheme = function () { return vcSetTheme('') }
