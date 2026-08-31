/**
 * src/client/kernel/styles.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 */
    export const STYLE_TEXT = [
      '.dsws-panel{position:fixed;left:16px;top:76px;width:460px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.45);z-index:9999;font-family:var(--dsw-font-family);font-size:13px;color:var(--dsw-alias-label-primary,#e6edf3);line-height:1.6;overflow:hidden}',
      '.dsws-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2d35);cursor:move;user-select:none}',
      '.dsws-tabs{display:flex;flex-wrap:nowrap;gap:4px;padding:8px 12px 0;overflow:hidden;white-space:nowrap}',
      '.dsws-tab{padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;white-space:nowrap;flex:none;line-height:1.5}',
      '.dsws-tab.on{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // v0.3 渐进式折叠：按钮按 data-priority 逐个折叠（priority 小=重要=晚折叠），max-width 动画平滑过渡
      '.dsws-tabs .dsws-tab > span:last-child,.dsws-tabs .dsws-btn > span:last-child{max-width:120px;overflow:hidden;white-space:nowrap;transition:max-width .25s ease,opacity .2s ease,margin .25s ease}',
      '.dsws-tabs .dsws-tab.collapsed > span:last-child,.dsws-tabs .dsws-btn.collapsed > span:last-child{max-width:0;opacity:0;margin-left:-4px;margin-right:-4px}',
      '.dsws-tabs > span:last-child,.dsws-tabs > a:last-child{transition:max-width .25s ease,opacity .2s ease;overflow:hidden;white-space:nowrap}',
      // #repo-link：版本号为链接（span→a）——基线色与去 UA 下划线移入样式表（内联设 color 会盖住 :hover），hover 提亮+下划线
      '.dsws-tabs .dsws-ver{color:var(--dsw-alias-label-caption,#8b8b95);text-decoration:none;cursor:pointer}',
      '.dsws-tabs .dsws-ver:hover{color:var(--dsw-alias-label-secondary,#a1a1aa);text-decoration:underline}',
      '.dsws-tabs .dsws-tab.collapsed,.dsws-tabs .dsws-btn.collapsed{padding-left:6px;padding-right:6px;transition:padding .25s ease}',
      '.dsws-tabs.dsws-no-anim *,.dsws-tabs.dsws-no-anim{transition:none!important}',
      '.dsws-body{flex:1;overflow-y:auto;padding:10px 12px}',
      '.dsws-rz{position:absolute;z-index:6}',
      '.dsws-rz-n{top:0;left:8px;right:8px;height:5px;cursor:ns-resize}',
      '.dsws-rz-s{bottom:0;left:8px;right:8px;height:5px;cursor:ns-resize}',
      '.dsws-rz-e{right:0;top:8px;bottom:8px;width:5px;cursor:ew-resize}',
      '.dsws-rz-w{left:0;top:8px;bottom:8px;width:5px;cursor:ew-resize}',
      '.dsws-rz-ne{top:0;right:0;width:10px;height:10px;cursor:nesw-resize}',
      '.dsws-rz-nw{top:0;left:0;width:10px;height:10px;cursor:nwse-resize}',
      '.dsws-rz-se{bottom:0;right:0;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-label-caption,#8b8b95) 50%);opacity:.5;border-radius:0 0 12px 0}',
      '.dsws-rz-se:hover{opacity:1}',
      '.dsws-rz-sw{bottom:0;left:0;width:10px;height:10px;cursor:nesw-resize}',
      '.dsws-maprow{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;padding:9px 12px;margin-bottom:8px;cursor:pointer;background:var(--dsw-alias-bg-layer-1,#10131a)}',
      '.dsws-maprow:hover{border-color:var(--dsw-alias-border-l2,#3a3f4a)}',
      '.dsws-mtitle{font-weight:600;font-size:13px}',
      '.dsws-prog{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3,#0c0e12);overflow:hidden;margin-top:4px}',
      '.dsws-prog>i{display:block;height:100%;background:var(--dsw-alias-state-success-primary,#4ade80);border-radius:2px}',
      '.dsws-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 8px;border-radius:99px;font-size:11px;line-height:1.7;margin-right:4px;white-space:nowrap}',
      '.dsws-chip-r{background:rgba(88,166,255,.18);color:#58a6ff}',
      '.dsws-chip-p{background:rgba(247,120,186,.16);color:#f778ba}',
      '.dsws-chip-g{background:rgba(63,185,80,.16);color:#3fb950}',
      '.dsws-chip-t{background:rgba(240,136,62,.16);color:#f0883e}',
      '.dsws-chip-m{background:rgba(188,140,255,.16);color:#bc8cff}',
      '.dsws-trow{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:6px;border:1px solid transparent}',
      '.dsws-trow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      '.dsws-trow .dsws-tt{flex:1;min-width:0}',
      // v27（#396）：标题渲染策略。
      // 历史：word-break:break-all + 子 span 的 .dsws-ellip{white-space:nowrap} 导致长标题被静默省略号截断。
      // 现在：父 .dsws-tt-name 不再强制 break-all；标题 span 用 .dsws-tt-wrap（替换 .dsws-ellip），
      //   允许按空格/中文标点换行；hover 通过现有 title=... 兜底显示完整文本。
      '.dsws-tt-name{font-size:12.5px;display:flex;align-items:center;gap:5px}',
      '.dsws-tt-wrap{min-width:0;overflow-wrap:break-word;word-break:normal;line-break:auto;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dsws-tt-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-btn{padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);background:var(--dsw-alias-bg-layer-1,#10131a);color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;cursor:pointer}',
      '.dsws-btn:hover{border-color:var(--dsw-alias-border-l2,#3a3f4a)}',
      // v14-5：主色按钮固定主题安全色（不再依赖 alias 变量，当前主题下会解析成深色导致黑底黑字）
      '.dsws-btn.primary{background:#c084fc;border-color:transparent;color:#140a1e;font-weight:600}',
      '.dsws-btn.primary:hover{border-color:rgba(20,10,30,.55)}',
      // v1.3.3：窄屏只剩图标时保持按钮高度、画成正方形（高=宽=按钮高），图标居中
      '.dsws-btn.narrow-icon{width:20px;height:20px;padding:0;justify-content:center;align-items:center;gap:0}',
      '.dsws-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-grp{margin:12px 0 4px;font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);display:flex;align-items:center;gap:6px}',
      '.dsws-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}',
      '.dsws-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000}',
      '.dsws-modalbox{width:460px;max-width:94vw;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;padding:14px 16px;font-family:var(--dsw-font-family);font-size:13px;color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-ta{width:100%;min-height:90px;background:var(--dsw-alias-bg-layer-1,#10131a);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:6px;color:var(--dsw-alias-label-primary,#e6edf3);font-family:var(--ds-font-family-code,monospace);font-size:12px;padding:8px;box-sizing:border-box}',
      '.dsws-note{position:absolute;left:14px;bottom:14px;top:auto;right:auto;padding:6px 12px;border-radius:6px;background:#f6f8fa;border:1px solid #e5e7eb;color:#0f1115;font-size:12px;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.4)}',
      'body[data-ds-dark-theme] .dsws-note{background:#22252c;border-color:#2a2d35;color:#e6edf3}',
      '.dsws-skill{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px}',
      '.dsws-skill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}',
      '.dsws-skill .dsws-tt{flex:1;min-width:0}',
      // 需求2（2026-08-18）：技能浮层主题化滚动条
      '.dsws-skillpop{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#3a3f4a) transparent}',
      '.dsws-skillpop::-webkit-scrollbar{width:8px}',
      '.dsws-skillpop::-webkit-scrollbar-track{background:transparent}',
      '.dsws-skillpop::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,#3a3f4a);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
      '.dsws-skillpop::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-label-caption,#8b8b95);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
      '.dsws-seg{cursor:pointer;padding:2px 7px;border-radius:99px;border:1px solid transparent;display:inline-flex;align-items:center;gap:4px}',
      '.dsws-seg:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // 需求1·二阶段 rev（2026-08-18）：交接分割按钮 —— 外框边框/细分隔线 hover 时才显示（与 seg 常驻透明一致）；左右半各自点击区 + hover 沿用 seg 背景
      '.dsws-split{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:99px;flex:none;overflow:hidden}',
      '.dsws-split:hover{border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      '.dsws-split .dsws-split-part{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;cursor:pointer}',
      '.dsws-split .dsws-split-part:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsws-split .dsws-split-div{width:1px;height:14px;background:var(--dsw-alias-border-l1,#2a2d35);flex:none;opacity:0;transition:opacity .12s}',
      '.dsws-split:hover .dsws-split-div{opacity:1}',
      '.dsws-timebtn{cursor:pointer;padding:2px 7px;border-radius:99px;border:1px dashed transparent;color:var(--dsw-alias-label-caption,#8b8b95);white-space:nowrap;font-variant-numeric:tabular-nums;flex:none}',
      '.dsws-timebtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));border-color:var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-uirow{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap}',
      '.dsws-uirow .dsws-btn.on{border-color:var(--dsw-alias-state-success-primary,#4ade80);color:var(--dsw-alias-state-success-primary,#4ade80)}',
      // v14-22：数字区固定两位数等宽（98/99 5 字符；--/8 等宽；未来 9/10 不变宽）
      '.dsws-num{display:inline-block;min-width:5ch;text-align:center;font-variant-numeric:tabular-nums;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:11px;line-height:1.5;white-space:nowrap}',
      // v15-24：胶囊宽度适配内容（fit-content 不压缩不换行；上限放宽）
      // #372 修复（2026-08-14 英文态溢出）：原上限 min(92vw,640px) 在英文长文案（如「Handoff · new session」）下触顶，
      //   内容从背景右缘溢出。放宽到 min(96vw,1400px)：width:fit-content + margin:0 auto → 胶囊始终
      //   以状态栏中心为轴向两边生长（背景完整包裹内容），不再截断/溢出。
      // #16 修复（2026-08-18 窄屏换行）：v15 修了 white-space:nowrap + flex:none + width:fit-content 但漏改 flex-wrap:wrap；
      //   窗口 < 920px 时胶囊自然宽 > 96vw → children 被强行换行成两/三行，破坏单行居中观感。
      //   改为 flex-wrap:nowrap + white-space:nowrap 兜底；胶囊始终单行。
      //   配合下方 5 级 [data-narrow] 属性选择器：JSX 在 renderStatusBar 写 data-narrow={dn||null}，
      //   按视口宽逐级隐藏 children 文字 span，保留图标+数字；children 全部 flex:none + nowrap 禁止换行。
      // #16 用户验收反馈（2026-08-18 R2）：胶囊宽应跟随输入区左右边（不再是按视口 96vw 撑）——
      //   max-width 改成 max-width:100% 让外层输入区容器能封顶；保留 max-width:1400px 防超宽屏溢出；
      //   去掉 margin:0 auto（外层 wrapper 负责居中）。
      // #16 v1.6.3 调试钩子（仅 v1.6.3 临时开启，下个版本移除）：
      //   给 .dsws-capsule 加 border:2px dashed magenta + 外层 wrapper background:rgba(255,0,255,.08)，
      //   让用户能直接看到「胶囊本身」和「外层 wrapper」的实际边界，确认是哪一层没缩到。
      //   排查 R2 反馈「看不到变化」用，1-2 个 issue 周期内拆掉。
      // #16 v1.6.7 R7 修复（用户验收反馈 2026-08-18）：magenta 框远小于 cyan 框，左右没跟输入区对齐。
      //   之前 capsule width:fit-content → 默认按内容自然宽（约 700px），小于 wrapper 1300px，居中后左右各300px空白。
      //   改为条件式宽度：dn=0 (宽视口) → width:100% 撑满 wrapper，左右边 = 输入区边；
      //                  dn>=1 → width:fit-content 自然宽居中（用户之前已接受「dn=4 时 capsule 不再缩」方案 B）。
      //   max-width:min(100%,1400px) 仍保留（防超宽屏溢出）。
      // #16 R10（用户验收反馈 2026-08-18 R9 后）：capsule 内容宽 = textarea 宽（iw px），但 capsule 自带
      //   padding:3px 6px + border:1px（CSS 默认 content-box）→ capsule border-box 外框 = iw + 9 + 2 = iw + 11，
      //   比 textarea 外框（iw）宽 11px（左右各 5.5px）。改为 box-sizing:border-box，让 capsule border-box = textarea 外框。
      // #16 R11（用户验收反馈 2026-08-18 R10 后）：capsule 固定宽 = iw → children 居中后左右空白随 children 缩小而变大。
      //   改为 CSS width:fit-content（默认 children 自然宽）；inline maxWidth:iw 防止 capsule 比输入框宽（pixel 对齐 R10 保留）。
      '.dsws-capsule{max-width:min(100%,1400px);width:100%;box-sizing:border-box;display:flex;flex-wrap:nowrap;white-space:nowrap;justify-content:center;align-items:center;gap:2px 6px;background:var(--dsw-alias-bg-layer-1,#10131a);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:14px;padding:3px 6px;font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);cursor:pointer;user-select:none}',
      // DSH Alpha 对齐修复（2026-08-31）：新版输入区卡片宽度由 --dsh-composer-card-max-width + --dsh-composer-side-clearance 驱动，
      // 旧版仅用 textarea 宽度。胶囊与卡片同源变量，保证“外框=卡片外框”在任意版本下像素级对齐；变量不存在时回退到 min(100%,1400px)。
      '.dsws-capsule{max-width:var(--dsh-composer-card-max-width, min(100%,1400px))}',
      // dn>=1 时 capsule 变 fit-content 自然宽居中（用户 B 方案：dn=4 后 capsule 不再缩）
      '',
      // 外层 wrapper 调试钩子见 StatusBar render 处 inline style 注释
      '.dsws-capsule .dsws-capsule-word{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:99px;font-weight:600;color:var(--dsw-alias-label-primary,#e6edf3);flex:none}',
      '.dsws-capsule .dsws-capsule-word:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsws-capsule .dsws-seg{flex:none}',
      '.dsws-capsule .dsws-timebtn{flex:none}',
      // #16 V2（2026-08-18 复现后重设计）：5 级 [data-narrow-N] 阈值体系有结构性 bug——
      //   dn 信号源 R5 起改为输入区（wrapper）宽，默认 1280 视口下输入区仅 812px → dn=0 永不出现，
      //   宽屏默认缺品牌字；且 .dsws-seg.note 选择器引用不存在的 class（seg() 首参是图标名不是 class），
      //   「无数字段」级从未生效。改为内容自适应渐进收缩（仿 #15）：
      //   每个可收缩文字 span 打 data-fold-priority（1=最先收…9=最后收），applyFold 在
      //   全展开基础上按 priority 升序逐个加 .dsws-folded，直到 scrollWidth ≤ clientWidth。
      //   优先级 = 信息价值：品牌(1) → 沉淀(2)/交接(3)/刷新字(4) → 可接(5)/BUG(6)/诊断(7)/环境(8) → 时间(9)。
      //   图标+数字永不收缩；最窄态 = 图标+数字紧凑条（wrapper overflow:hidden 截右缘，禁止换行）。
      '.dsws-capsule [data-fold-priority].dsws-folded{display:none}',
      '.dsws-banner{display:flex;align-items:center;gap:8px;border-radius:8px;padding:6px 10px;font-size:12px;margin:6px 0;cursor:pointer}',
      '.dsws-banner.bad{background:rgba(248,113,113,.12);border:1px solid rgba(248,113,113,.45);color:#f87171}',
      '.dsws-banner.warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.45);color:#fbbf24}',
      '.dsws-banner.ok{background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.35);color:#4ade80}',
      // v1.3.3 UI 修复：aggrow 现含两行子块（行1 idcol+标题+圆环 / 行2 标签+按钮），必须纵向堆叠
      // v1.3.3：左侧预留空白减 20%（8px → 6.4px，map 行/普通行一致更紧凑）
      '.dsws-aggrow{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:6px 6.4px;border-radius:6px;border:1px solid transparent}',
      '.dsws-aggrow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // v1.3.3 UI：辅助按钮（复制/外链）常显（用户要求一直显示，不 hover）
      '.dsws-aggrow .dsws-aux{display:inline-flex;align-items:center;gap:2px;flex:none}',
      // v1.3.3 UI：行2 标签贪心折叠（单行不换行，宽多窄少，+N 弹窗展开）
      '.dsws-tags{display:flex;align-items:center;gap:3px;flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap}',
      '.dsws-tags .dsws-chip{flex:none}',
      // v1.3.3：+N 展开符号整体缩小 20%（padding 8→6px · font 11→9px · line-height 1.7→1.8）
      '.dsws-more{background:rgba(188,140,255,.1);color:#bc8cff;border:1px dashed rgba(188,140,255,.55);cursor:pointer;flex:none;transition:background .12s,border-color .12s;padding:0 6px;font-size:9px;line-height:1.8}',
      '.dsws-more:hover{background:rgba(188,140,255,.22);border-color:rgba(188,140,255,.8)}',
      // v1.3.3 UI：行1 编号 + map 徽章竖排（标题获得更宽展示区）
      '.dsws-idcol{display:flex;flex-direction:column;align-items:flex-start;gap:3px;flex:none}',
      // T1 [Map #120] Map 行响应式：编号横排到地图右侧（标题一行放得下→横排）· 极窄竖排 · 护栏 320/440
      '.dsws-idcol.h{display:flex;flex-direction:row;align-items:center;gap:6px}',
      // 测量态：临时取消 clamp 测单行是否放得下（scrollWidth ≤ clientWidth），用后即移除
      '.dsws-tt-wrap.measure,.dsws-tt-wrap.dsws-measure{white-space:nowrap!important;display:block!important;-webkit-line-clamp:unset!important;overflow:visible!important}',
      '.dsws-idnum{display:inline-block;font-family:Consolas,Menlo,monospace;font-weight:700;font-size:11px;line-height:1.4;padding:2px 7px;border-radius:6px;border:1px solid;font-variant-numeric:tabular-nums}',
      // v1.3.3 UI：map 行迷你圆环进度（替代长条 + ✓）
      // v1.3.3 对齐修复：圆环与数字零间隙（gap 0 + 文本左对齐紧贴），
      //   文本固定最小宽度（5 字符容 26/27）→ 各行右缘对齐；
      //   v1.3.3 微调：min-width 38 → 35px（26/27 右侧空隙减半）
      '.dsws-ring{flex:none;display:inline-flex;align-items:center;gap:0}',
      '.dsws-ring svg{transform:rotate(-90deg)}',
      '.dsws-ring-txt{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.5;flex:none;letter-spacing:.2px;min-width:35px;text-align:left}',
      // v1.3.3 UI：+N 弹窗（fixed 定位，自适应面板左右边界）
      '.dsws-pop{position:fixed;z-index:1000;background:#1c1f26;border:1px solid var(--dsw-alias-border-l2,#3a3f4a);border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.55);padding:10px 12px;display:none}',
      '.dsws-pop .caret{position:absolute;width:10px;height:10px;background:#1c1f26;border-left:1px solid var(--dsw-alias-border-l2,#3a3f4a);border-top:1px solid var(--dsw-alias-border-l2,#3a3f4a);transform:rotate(45deg)}',
      '.dsws-pop .pt{font-size:10px;color:var(--dsw-alias-label-caption,#8b8b95);letter-spacing:1px;margin-bottom:6px;text-transform:uppercase}',
      '.dsws-pop .pl{display:flex;flex-wrap:wrap;gap:4px}',
      '.dsws-pop .ptitle{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1,#2a2d35);padding-top:7px;line-height:1.55;overflow-wrap:break-word;word-break:break-word}',
      '.dsws-pop .ptitle b{color:var(--dsw-alias-label-primary,#e6edf3);font-weight:600}',
      // v1.4（T2 #443）：Map 详情页漏斗分层形态（D1-D8 规格）
      '.dsws-layers{display:flex;flex-direction:column;gap:4px;margin:10px 0;padding:8px 10px;border-radius:10px;background:linear-gradient(90deg,rgba(74,222,128,.05),rgba(255,255,255,.015));border:1px solid rgba(74,222,128,.2)}',
      '.dsws-layers .row1{display:flex;align-items:center;gap:8px}',
      '.dsws-layers .cap{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);letter-spacing:.5px;text-transform:uppercase;flex:none}',
      '.dsws-layers .segs{flex:1;display:flex;gap:3px;height:12px}',
      '.dsws-layers .seg{flex:1;border-radius:3px;position:relative;background:rgba(255,255,255,.06);border:1px dashed rgba(255,255,255,.14)}',
      '.dsws-layers .seg.past{background:linear-gradient(180deg,rgba(74,222,128,.7),rgba(74,222,128,.4));border:none}',
      '.dsws-layers .seg.past::after{content:"✓";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:7px;color:#04120a;font-weight:700}',
      '.dsws-layers .seg.curr{background:linear-gradient(180deg,#4ade80,#2dd45f);border:none;box-shadow:0 0 8px rgba(74,222,128,.5)}',
      '.dsws-layers .row2{display:flex;justify-content:space-between;font-size:8.5px;color:var(--dsw-alias-label-caption,#8b8b95);align-items:center}',
      '.dsws-layers .row2 .cur{color:#4ade80;font-weight:700;display:inline-flex;align-items:center;gap:4px}',
      '.dsws-start{display:flex;gap:8px;align-items:flex-start;margin:6px 0 2px}',
      '.dsws-start .cap{font-size:13px;font-weight:700;color:#fff;line-height:1.1}',
      '.dsws-start .desc{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);font-style:italic;line-height:1.3}',
      // T15：层容器 + 明显层号（当前层高亮）；层内网格自适应列数；卡片高度恒定
      '.dsws-layerbox{border-radius:12px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.008));padding:8px 10px 10px;margin-top:6px}',
      '.dsws-layerbox.cur{border-color:rgba(74,222,128,.5);box-shadow:0 0 16px rgba(74,222,128,.14);background:linear-gradient(180deg,rgba(74,222,128,.05),rgba(255,255,255,.008))}',
      '.dsws-layerTag{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:700;color:var(--dsw-alias-label-primary,#e6edf3);letter-spacing:.5px;margin:0 0 8px}',
      '.dsws-layerTag .layerNo{width:22px;height:22px;flex:none;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);background:rgba(255,255,255,.08);border:1.5px solid var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-secondary,#a1a1aa);font-variant-numeric:tabular-nums}',
      '.dsws-layerbox.cur .dsws-layerNo{background:rgba(74,222,128,.16);border-color:rgba(74,222,128,.7);color:#4ade80}',
      '.dsws-layerTag .layerTitle{flex:none}',
      '.dsws-layerTag .sp{flex:1;height:1px;background:linear-gradient(90deg,var(--dsw-alias-border-l1,#2a2d35),transparent)}',
      // T15：层内网格 —— 宽度变宽自动多列（minmax 190px 保证最窄 ≥1 列）；不再横向滚动
      '.dsws-layer{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;padding:0 0 2px}',
      // 窄面板（<380px）列宽下限降到 150px，仍保证 ≥1 列
      '.dsws-narrow .dsws-layer{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}',
      // T15：卡片宽度随列伸缩（不再固定 200px）；内部行固定占位保证高度恒定
      '.dsws-node{display:flex;flex-direction:column;gap:4px;border-radius:10px;padding:7px 8px;min-width:0;width:auto;position:relative;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));border:1.5px solid var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-node .row1{display:flex;align-items:center;gap:6px}',
      '.dsws-node .icbox{width:22px;height:22px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;border:1.5px solid;background:rgba(0,0,0,.5);color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-node .meta{display:flex;align-items:center;gap:5px;margin-bottom:1px}',
      '.dsws-node .no{font-size:9px;color:var(--dsw-alias-label-caption,#8b8b95);font-family:var(--ds-font-family-code,Consolas,Menlo,monospace)}',
      '.dsws-node .tag{font-size:8px;padding:0 4px;border-radius:3px;border:1px solid;opacity:.85;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace)}',
      '.dsws-node .tt{font-size:11px;font-weight:600;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all;min-height:30.8px}',
      '.dsws-node .acts{display:flex;gap:4px;flex-wrap:wrap;align-items:center;min-height:24px}',
      '.dsws-node.done{opacity:.55}',
      '.dsws-node.now{border-color:rgba(74,222,128,.9);box-shadow:0 0 14px rgba(74,222,128,.3)}',
      '.dsws-node.wait{border-color:rgba(240,136,62,.5);border-style:dashed;opacity:.8}',
      '.dsws-node.fog{filter:blur(2.4px) brightness(.45);opacity:.6;cursor:pointer;border-color:rgba(192,132,252,.4)}',
      '.dsws-node.fog.revealed{filter:none;opacity:1;cursor:default}',
      '.dsws-node.fog .acts{pointer-events:none;filter:blur(1px)}',
      '.dsws-node.fog.revealed .acts{pointer-events:auto;filter:none}',
      '.dsws-node .qmark{position:absolute;right:7px;bottom:7px;width:12px;height:12px;color:rgba(192,132,252,.8);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
      '.dsws-gate{height:26px;display:flex;align-items:center;justify-content:center;position:relative}',
      '.dsws-gate::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;background:linear-gradient(180deg,transparent,rgba(255,255,255,.15),transparent)}',
      '.dsws-gate .g{width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-2,#16181d);border:2px solid;display:flex;align-items:center;justify-content:center;z-index:1;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-gate .g.lock{border-color:rgba(240,136,62,.55);color:#f0883e}',
      '.dsws-gate .g.open{border-color:rgba(74,222,128,.75);color:#4ade80;box-shadow:0 0 8px rgba(74,222,128,.3)}',
      '.dsws-dest{position:relative;margin-top:14px;border-radius:14px;padding:14px 12px 12px;text-align:center;background:linear-gradient(180deg,rgba(192,132,252,.1),rgba(88,166,255,.03) 70%,transparent);border:1.5px solid rgba(192,132,252,.35)}',
      '.dsws-dest .ring{width:72px;height:72px;margin:0 auto;position:relative}',
      // v1.4 修复：rotate(-90deg) 只作用于进度环 svg（直接子元素），不波及 core 旗帜（旗帜保持竖直）
      '.dsws-dest .ring > svg{transform:rotate(-90deg)}',
      '.dsws-dest .ring .track{stroke:rgba(255,255,255,.07);fill:none;stroke-width:6}',
      '.dsws-dest .ring .prog{fill:none;stroke-width:6;stroke-linecap:round;stroke:rgba(192,132,252,.7)}',
      '.dsws-dest .core{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}',
      '.dsws-dest .core svg{width:22px;height:22px;fill:none;stroke:#c084fc;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
      '.dsws-dest .title{font-size:15px;font-weight:700;margin-top:4px;color:#e6edf3}',
      '.dsws-dest .acts{display:flex;justify-content:center;gap:8px;margin-top:8px}',
      '.dsws-ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsws-cgroup{margin:10px 0 2px;font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);display:flex;align-items:center;gap:6px}',
      '.dsws-ccard{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1,#10131a)}',
      '.dsws-ccard .nm{font-size:12.5px;font-weight:600}',
      '.dsws-ccard .dt{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-ccard .act{margin-top:5px;display:flex;gap:6px}',
      // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径）；spinner 仅首开 loading 用
      '.dsws-spinner{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#c084fc;animation:dsws-spin .8s linear infinite;flex:none}',
      '@keyframes dsws-spin{to{transform:rotate(360deg)}}',
      // v1.5 T10：刷新入口按钮内联转圈（非阻塞反馈 · R7 反馈半）+ R5 变化行高亮（变更琥珀渐隐 / 新增绿闪）
      '.dsws-spin{display:inline-flex;animation:dsws-spin .8s linear infinite}',
      '@keyframes dsws-flash-amber{0%{background-color:rgba(251,191,36,.20)}100%{background-color:transparent}}',
      '@keyframes dsws-flash-green{0%{background-color:rgba(74,222,128,.20)}100%{background-color:transparent}}',
      '.dsws-row-changed{animation:dsws-flash-amber 2.4s ease-out 1}',
      '.dsws-row-added{animation:dsws-flash-green 2.4s ease-out 1}',
      // v25 · T2b：配置页（settings.plugins.tab）专用样式
      '.dsws-cfg{max-width:720px;display:flex;flex-direction:column;gap:12px;padding:2px 2px 4px}',
      '.dsws-cfg-head{display:flex;align-items:center;gap:10px}',
      '.dsws-cfg-head .t{font-size:15px;font-weight:700;letter-spacing:.2px}',
      '.dsws-cfg-head .s{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:12px}',
      '.dsws-cfg-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);line-height:1.7}',
      '.dsws-cfg-group{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#10131a);padding:10px 14px}',
      '.dsws-cfg-gtitle{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:650;margin-bottom:4px}',
      '.dsws-cfg-gdesc{font-size:11.5px;color:var(--dsw-alias-label-caption,#8b8b95);margin-bottom:10px;line-height:1.65}',
      '.dsws-cfg-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}',
      '.dsws-cfg-label{font-size:12px;color:var(--dsw-alias-label-secondary,#a1a1aa);flex:none}',
      '.dsws-cfg-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#16181d);padding:3px;gap:2px}',
      '.dsws-cfg-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;padding:4px 14px;border-radius:6px;cursor:pointer;font-family:var(--dsw-font-family)}',
      '.dsws-cfg-seg button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}',
      '.dsws-cfg-seg button.on{background:#c084fc;color:#140a1e;font-weight:600}',
      '.dsws-cfg-sw{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12px}',
      '.dsws-cfg-sw input{display:none}',
      '.dsws-cfg-sw .tr{width:34px;height:19px;border-radius:99px;background:var(--dsw-alias-bg-layer-3,#0c0e12);border:1px solid var(--dsw-alias-border-l1,#2a2d35);position:relative;flex:none;transition:background .15s,border-color .15s}',
      '.dsws-cfg-sw .tr::after{content:"";position:absolute;left:2px;top:2px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-label-caption,#8b8b95);transition:transform .15s,background .15s}',
      '.dsws-cfg-sw input:checked + .tr{background:rgba(192,132,252,.22);border-color:rgba(192,132,252,.55)}',
      '.dsws-cfg-sw input:checked + .tr::after{transform:translateX(15px);background:#c084fc}',
      '.dsws-cfg-ta{width:100%;min-height:56px;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;color:var(--dsw-alias-label-primary,#e6edf3);font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:11.5px;line-height:1.6;padding:7px 9px;box-sizing:border-box;resize:none;overflow:hidden}',
      '.dsws-cfg-ta:focus{outline:none;border-color:rgba(192,132,252,.6)}',
      '.dsws-cfg-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0}',
      '.dsws-cfg-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:99px;font-size:11px;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);cursor:pointer;background:rgba(188,140,255,.14);color:#bc8cff;border:1px solid rgba(188,140,255,.35);transition:background .12s}',
      '.dsws-cfg-chip:hover{background:rgba(188,140,255,.26)}',
      '.dsws-cfg-chip.req{background:rgba(248,113,113,.14);color:#f87171;border-color:rgba(248,113,113,.45)}',
      '.dsws-cfg-chip.req:hover{background:rgba(248,113,113,.26)}',
      '.dsws-cfg-chip .must{font-family:var(--dsw-font-family);font-size:10px;opacity:.85}',
      '.dsws-cfg-legend{font-size:11px;color:var(--dsw-alias-label-caption,#8b8b95);display:flex;align-items:center;gap:12px;margin-top:2px}',
      '.dsws-cfg-card{border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#16181d);padding:12px 14px;margin-bottom:10px}',
      '.dsws-cfg-card-head{display:flex;align-items:center;gap:8px;margin-bottom:2px}',
      '.dsws-cfg-card-name{font-size:13px;font-weight:650}',
      '.dsws-cfg-card-desc{font-size:11.5px;color:var(--dsw-alias-label-caption,#8b8b95);margin-bottom:4px;line-height:1.6}',
      '.dsws-cfg-preview{border:1px dashed var(--dsw-alias-border-l2,#3a3f4a);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#0c0e12);padding:7px 10px;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#a1a1aa);white-space:pre-wrap;word-break:break-all;margin-top:5px}',
      '.dsws-cfg-preview .pv-label{display:block;font-family:var(--dsw-font-family);font-size:10px;letter-spacing:.5px;color:var(--dsw-alias-label-caption,#8b8b95);margin-bottom:3px}',
      '.dsws-cfg-err{border:1px solid rgba(248,113,113,.5);background:rgba(248,113,113,.1);border-radius:10px;padding:10px 12px;font-size:12px;color:#f87171;line-height:1.7}',
      '.dsws-cfg-err .t{font-weight:650;display:flex;align-items:center;gap:6px;margin-bottom:2px}',
      '.dsws-cfg-save{align-self:flex-end;background:#c084fc;color:#140a1e;border:none;border-radius:8px;font-size:13px;font-weight:650;padding:8px 28px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
      '.dsws-cfg-save:hover{filter:brightness(1.08)}',
      '.dsws-cfg-btn{background:transparent;border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:7px;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:11.5px;padding:3px 10px;cursor:pointer}',
      '.dsws-cfg-btn:hover{border-color:var(--dsw-alias-border-l2,#3a3f4a);color:var(--dsw-alias-label-primary,#e6edf3)}',
      // T2 #35 · 无仓库红卡（ListTab 首屏最优先）· 样式复用 dsws-banner bad 视觉语言
      '.dsws-no-repo-card{border:1px solid rgba(248,113,113,.45);background:rgba(248,113,113,.12);border-radius:8px;padding:10px 12px;margin-bottom:8px}',
      '.dsws-no-repo-card .head{display:flex;align-items:flex-start;gap:8px}',
      '.dsws-no-repo-card .ttl{font-weight:600;color:#f87171;font-size:12.5px;line-height:1.4}',
      '.dsws-no-repo-card .desc{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);margin-top:2px;line-height:1.5}',
      '.dsws-no-repo-card .acts{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap}',
      '.dsws-no-repo-card .ghost{background:transparent;border:1px solid rgba(248,113,113,.35);color:var(--dsw-alias-label-secondary,#a1a1aa)}',
      '.dsws-no-repo-card .ghost:hover{border-color:rgba(248,113,113,.55);color:var(--dsw-alias-label-primary,#e6edf3)}',
      '.dsws-no-repo-form{margin-top:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#10131a)}',
      '.dsws-no-repo-form .row{display:flex;align-items:center;gap:8px;margin:6px 0}',
      '.dsws-no-repo-form label{font-size:11px;color:var(--dsw-alias-label-secondary,#a1a1aa);flex:none;min-width:52px}',
      '.dsws-no-repo-form input[type="text"]{flex:1;min-width:0;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:6px;color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;padding:4px 8px}',
      '.dsws-no-repo-form input[type="text"]:focus{outline:none;border-color:rgba(192,132,252,.55)}',
      '.dsws-no-repo-form .err{font-size:11px;color:#f87171;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.35);border-radius:6px;padding:5px 8px;margin-top:6px}',
      '.dsws-no-repo-form .hint{font-size:10px;color:var(--dsw-alias-label-caption,#8b8b95);margin-top:2px}',
      '.dsws-no-repo-form .radio{display:inline-flex;align-items:center;gap:4px;font-size:11px;cursor:pointer}',
    ].join('')