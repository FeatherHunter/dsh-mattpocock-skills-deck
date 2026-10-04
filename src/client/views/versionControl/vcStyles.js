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
 */
export const VC_STYLE_TEXT = [
  // ---- 皮肤令牌：深色（A 工程台账） ----
  "body[data-ds-dark-theme] [data-vc-root]{--vc-paper:#131c2f;--vc-inset:#0b1120;--vc-elevated:#1a2438;--vc-hover:rgba(148,163,184,.10)" +
    ";--vc-line:rgba(148,163,184,.20);--vc-line2:rgba(148,163,184,.36)" +
    ";--vc-radius:4px;--vc-row-h:30px;--vc-row-py:6px;--vc-row-px:8px;--vc-row-font:12.5px;--vc-sec-font:10.5px;--vc-sec-track:.16em;--vc-shadow:none}",
  // ---- 皮肤令牌：浅色（C 纸质便签） ----
  "body:not([data-ds-dark-theme]) [data-vc-root]{--vc-paper:#f6f1e6;--vc-inset:#efe8d9;--vc-elevated:#fffdf8;--vc-hover:rgba(34,29,21,.06)" +
    ";--vc-line:rgba(34,29,21,.22);--vc-line2:rgba(34,29,21,.42)" +
    ";--vc-radius:2px;--vc-row-h:32px;--vc-row-py:7px;--vc-row-px:9px;--vc-row-font:13px;--vc-sec-font:11px;--vc-sec-track:.1em;--vc-shadow:0 1px 0 rgba(0,0,0,.30)}",
  // ---- 皮肤容器：这一页自己是一块面板 ----
  "[data-vc-root]{background:var(--vc-paper);border:1px solid var(--vc-line);border-radius:10px;padding:10px;box-shadow:var(--vc-shadow);font-size:var(--vc-row-font);line-height:1.5}",
  // ---- 文件行：等宽路径、表格数字、悬停抬一层、行高按皮肤 ----
  ".dsws-vc-row{min-height:var(--vc-row-h);padding:var(--vc-row-py) var(--vc-row-px);border-radius:calc(var(--vc-radius) * 2);font-size:var(--vc-row-font)}",
  "[data-vc-root] [data-vc-file]{border-top-color:var(--vc-line) !important}",
  "[data-vc-root] [data-vc-file]>.dsws-vc-row:hover{background:var(--vc-hover)}",
  "[data-vc-open]>.dsws-vc-row{background:var(--vc-hover);box-shadow:inset 2px 0 0 var(--vc-accent,transparent)}",
  // ---- 状态字母徽章 ----
  ".dsws-vc-badge{min-width:18px;height:18px;padding:0 3px;border:1px solid var(--vc-line2);border-radius:calc(var(--vc-radius) + 1px);font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:10.5px;font-weight:700;line-height:1}",
  ".dsws-vc-badge.is-added{color:var(--vc-accent,#22c55e);border-color:var(--vc-accent,#22c55e)}",
  ".dsws-vc-badge.is-modified{color:var(--vc-info,#38bdf8);border-color:var(--vc-info,#38bdf8)}",
  ".dsws-vc-badge.is-deleted{color:var(--vc-danger,#ef4444);border-color:var(--vc-danger,#ef4444)}",
  ".dsws-vc-badge.is-renamed,.dsws-vc-badge.is-typechange{color:var(--vc-warn,#f59e0b);border-color:var(--vc-warn,#f59e0b)}",
  ".dsws-vc-badge.is-untracked{color:var(--vc-mut,#94a3b8)}",
  // 浅色那套是「贴纸」：加一层实底，与深色那套的描边方框刻意不同手
  "body:not([data-ds-dark-theme]) .dsws-vc-badge{box-shadow:0 1px 0 rgba(0,0,0,.25)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-added{background:rgba(21,128,61,.16)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-modified{background:rgba(29,78,216,.14)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-deleted{background:rgba(185,28,28,.14)}",
  "body:not([data-ds-dark-theme]) .dsws-vc-badge.is-renamed,body:not([data-ds-dark-theme]) .dsws-vc-badge.is-typechange{background:rgba(180,83,9,.14)}",
  // ---- 正负行数 ----
  ".dsws-vc-add,.dsws-vc-del{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-variant-numeric:tabular-nums}",
  ".dsws-vc-add{color:var(--vc-accent,#22c55e)}",
  ".dsws-vc-del{color:var(--vc-danger,#ef4444)}",
  // ---- 段小标题 ----
  ".dsws-vc-sec{font-size:var(--vc-sec-font);letter-spacing:var(--vc-sec-track);padding:10px 0 6px;margin:12px 0 0;border-bottom:1px solid var(--vc-line)}",
  // ---- 身份行与计数行 ----
  ".dsws-vc-id{font-size:15px;font-weight:680;letter-spacing:-.01em}",
  "body:not([data-ds-dark-theme]) .dsws-vc-id{font-size:16px}",
  ".dsws-vc-count{font-size:11px;font-variant-numeric:tabular-nums}",
  // ---- 补丁块 ----
  ".dsws-vc-card{background:var(--vc-inset);border:1px solid var(--vc-line);border-radius:calc(var(--vc-radius) * 2);padding:10px 12px}",
  ".dsws-vc-diff{font-family:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;font-size:11.5px;line-height:1.6;overflow:auto;max-height:320px}",
  // ---- 提示带、错误块、空态 ----
  "[data-vc-root] [data-vc-hint],[data-vc-root] [data-vc-band-item]{background:var(--vc-inset) !important;border-color:var(--vc-line) !important;border-radius:var(--vc-radius)}",
  "[data-vc-root] [data-vc-error]{border-color:var(--vc-line2) !important;border-radius:calc(var(--vc-radius) * 2)}",
  "[data-vc-root] [data-vc-empty]{color:var(--vc-mut,inherit)}",
  // ---- 链接：平时去下划线，悬停才加 ----
  ".dsws-vc-link{text-decoration:none;border-bottom:1px solid transparent}",
  ".dsws-vc-link:hover{border-bottom-color:currentColor}",
  // ---- 按钮与输入框：吃皮肤的底与线 ----
  "[data-vc-root] .dsws-btn{background:var(--vc-inset);border:1px solid var(--vc-line2);border-radius:var(--vc-radius)}",
  "[data-vc-root] .dsws-btn:hover{background:var(--vc-elevated)}",
  "[data-vc-root] .dsws-btn.primary{background:var(--vc-accent,#22c55e);border-color:var(--vc-accent,#22c55e);color:#052e16}",
  "[data-vc-root] .dsws-btn:disabled{opacity:.45}",
  "[data-vc-root] textarea,[data-vc-root] input{background:var(--vc-inset);border:1px solid var(--vc-line2);border-radius:var(--vc-radius);color:inherit}",
  "[data-vc-root] textarea:focus,[data-vc-root] input:focus{outline:2px solid var(--vc-accent,transparent);outline-offset:1px}",
  ".dsws-vc-caption{color:var(--vc-faint,inherit)}",
  ".dsws-vc-sep{border-color:var(--vc-line)}",
  // #853 第三步：视图页签——平时是三个并排的词，选中的那一档下面压一条强调色；窄了就换行，不断字。
  ".dsws-vc-views{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid var(--vc-line);margin:2px 0}",
  ".dsws-vc-view{appearance:none;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--vc-mut,inherit);font:inherit;font-size:12px;padding:7px 10px;cursor:pointer;display:inline-flex;gap:6px;align-items:baseline}",
  ".dsws-vc-view .dsws-vc-mono{font-size:11px}",
  ".dsws-vc-view.is-on{color:var(--vc-ink,inherit);border-bottom-color:var(--vc-accent,#22c55e);font-weight:650}",
  // #857 P5/P6：骨架条——固定高度占位，不跳；减弱动态偏好下静止。
  ".dsws-vc-skel{border-radius:4px;background:linear-gradient(90deg,var(--vc-hover,rgba(127,127,160,.12)) 25%,var(--vc-elevated,#16181d) 50%,var(--vc-hover,rgba(127,127,160,.12)) 75%);background-size:200% 100%;animation:dsws-vc-shimmer 1.4s linear infinite;margin:7px 0}",
  "@keyframes dsws-vc-shimmer{to{background-position:-200% 0}}",
  "@media (prefers-reduced-motion:reduce){.dsws-vc-skel{animation:none}}",
].join('')
