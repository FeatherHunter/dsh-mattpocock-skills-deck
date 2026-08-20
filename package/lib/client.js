/**
 * dsh-mattpocock-skills-deck 浏览器半（Client bundle · v1.2.0-dev = 动态版 v25 同源）
 *
 * 格式：DSH client-modules 的惰性 CJS bundle —— 经典脚本执行时只注册 factory，
 * 由浏览器内核（vendored Cordis Loader）在挂载该插件条目时物化执行。
 * 导出形状与官方 client 包一致：named exports { inject, apply }。
 *
 * 与动态版 client.js（cordis_define 的 code.client 函数体）差异：
 *   1. React 来自 require('react')（动态版为 runner 注入全局）
 *   2. styles.insert（动态 runner 专属 builtin）→ 手动 <style data-plugin> 注入，
 *      ctx.effect 返回清理器卸载（参考 dsh-opencode-tui-theme v1.1.0 教训：
 *      effect fn 立即执行、返回值才是清理器）
 *   3. host.call('wf.xxx', args)（动态 runner 专属）→ rpcCall('xxx', args)：
 *      ctx.connection.rpc.call('/dsws', endpoint, args) → RpcResult 解包
 *   4. timer 服务不可用时 setTimeout 兜底（动态版 runner 必注入 timer）
 *
 * 功能同动态版 v26：状态栏胶囊 / 右侧 details 列面板（唯一打开形式 · 三视图）/
 * 行级动作（诊断/修复/讨论/执行）/ map 详情 / 交接两段 prompt（时间戳记忆）/
 * 引导句「从第一性原理出发完成任务，并对抗式审查。」/ 配置页（settings.plugins.tab「Waystation」：
 * 面板高度三档 + 开始模板 + 动作模板编辑器，dsws.cfg/dsws.templates 持久化 + 旧 startCfg 迁移）/
 * 中英双语（dsws locale 命名空间 zh/en，跟随 harness 语言）
 * v26（#373 用户拍板 2026-08-14）：打开形式收敛为仅右侧 details 列 —— 移除 Document PiP
 * 独立小窗（Electron 不可用）、停靠/悬浮双模式记忆、状态栏「停靠」seg、右栏「悬浮」按钮。
 */
window.__ModuleLoader__.load({
  id: 'dsh-mattpocock-skills-deck',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let React = require('react')

    // ── 样式（动态版 styles.insert 的等价内容）──
    const STYLE_TEXT = [
      '.dsws-panel{position:fixed;left:16px;top:76px;width:460px;max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,#16181d);border:1px solid var(--dsw-alias-border-l1,#2a2d35);border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.45);z-index:9999;font-family:var(--dsw-font-family);font-size:13px;color:var(--dsw-alias-label-primary,#e6edf3);line-height:1.6;overflow:hidden}',
      '.dsws-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#2a2d35);cursor:move;user-select:none}',
      '.dsws-tabs{display:flex;flex-wrap:nowrap;gap:4px;padding:8px 12px 0;overflow:hidden;white-space:nowrap}',
      '.dsws-tab{padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#a1a1aa);font-size:12px;white-space:nowrap;flex:none;line-height:1.5}',
      '.dsws-tab.on{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-border-l1,#2a2d35)}',
      // v0.3 渐进式折叠：按钮按 data-priority 逐个折叠（priority 小=重要=晚折叠），max-width 动画平滑过渡
      '.dsws-tabs .dsws-tab > span:last-child,.dsws-tabs .dsws-btn > span:last-child{max-width:120px;overflow:hidden;white-space:nowrap;transition:max-width .25s ease,opacity .2s ease,margin .25s ease}',
      '.dsws-tabs .dsws-tab.collapsed > span:last-child,.dsws-tabs .dsws-btn.collapsed > span:last-child{max-width:0;opacity:0;margin-left:-4px;margin-right:-4px}',
      '.dsws-tabs > span:last-child{transition:max-width .25s ease,opacity .2s ease;overflow:hidden;white-space:nowrap}',
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
      // 主色按钮固定主题安全色（不再依赖 alias 变量，当前主题下会解析成深色导致黑底黑字）
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
      '.dsws-note{position:absolute;left:14px;bottom:14px;top:auto;right:auto;padding:6px 12px;border-radius:6px;background:var(--dsw-alias-toast-bg,#22252c);border:1px solid var(--dsw-alias-border-l1,#2a2d35);color:var(--dsw-alias-label-primary,#e6edf3);font-size:12px;z-index:10001;box-shadow:0 4px 20px rgba(0,0,0,.4)}',
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
      // 数字区固定两位数等宽（98/99 5 字符；--/8 等宽；未来 9/10 不变宽）
      '.dsws-num{display:inline-block;min-width:5ch;text-align:center;font-variant-numeric:tabular-nums;font-family:var(--ds-font-family-code,Consolas,Menlo,monospace);font-size:11px;line-height:1.5;white-space:nowrap}',
      // 胶囊宽度适配内容（fit-content 不压缩不换行；上限放宽）
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
      //   给 .dsws-capsule 加 outline:2px dashed magenta + 外层 wrapper outline:2px dashed cyan，
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
      // dn>=1 时 capsule 变 fit-content 自然宽居中（用户 B 方案：dn=4 后 capsule 不再缩）
      '',
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
      '.dsws-idnum{display:inline-block;font-family:Consolas,Menlo,monospace;font-weight:700;font-size:11px;line-height:1.4;padding:2px 7px;border-radius:6px;border:1px solid;font-variant-numeric:tabular-nums}',
      // v1.3.3 UI：map 行迷你圆环进度（替代长条 + ✓）
      '.dsws-ring{flex:none;display:inline-flex;align-items:center;gap:0}',
      '.dsws-ring svg{transform:rotate(-90deg)}',
      // v1.3.3 对齐修复：圆环与数字零间隙（gap 0 + 文本左对齐紧贴），
      //   文本固定最小宽度（5 字符容 26/27）→ 各行右缘对齐；
      //   v1.3.3 微调：min-width 38 → 35px（26/27 右侧空隙减半）
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

    exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions']

    exports.apply = function (ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      const timer = ctx.get('timer')
      const h = React.createElement
      // issue #3：浮层挂顶层 —— createPortal 到 document.body，让 position:fixed 的视口坐标与
      //   z-index 真正全局生效。宿主输入区祖先若带 transform / filter / backdrop-filter /
      //   will-change / contain，fixed 的包含块会降级为该祖先（坐标偏移 + 被 overflow 裁剪），
      //   这正是技能 tooltip 被遮挡/截断的根因。取不到 react-dom 时退化为原地渲染（不劣于现状）。
      const RDOM = (function () {
        try { if (typeof ReactDOM !== 'undefined' && ReactDOM && ReactDOM.createPortal) return ReactDOM } catch (e) { /* noop */ }
        try { if (typeof window !== 'undefined' && window.ReactDOM && window.ReactDOM.createPortal) return window.ReactDOM } catch (e) { /* noop */ }
        try { if (typeof require === 'function') { const m = require('react-dom'); if (m && m.createPortal) return m } } catch (e) { /* noop */ }
        return null
      })()
      const portalTop = function (node) {
        if (RDOM && typeof document !== 'undefined' && document.body) return RDOM.createPortal(node, document.body)
        return node
      }
      // v1.3.3：面板版本号（tabs 行最右侧显示，便于核对已更新）
      // issue #22：交互弹层统一挂到 body，避免被状态栏布局 wrapper 裁剪。
      const PortalOverlay = function (props, children) {
        return portalTop(h('div', props || {}, children))
      }
      const DSW_VERSION = 'v1.6.16'

      // 样式注入（静态插件没有 styles.insert builtin，手动 <style> + ctx.effect 清理）
      const styleEl = document.createElement('style')
      styleEl.setAttribute('data-plugin', 'dsh-mattpocock-skills-deck')
      styleEl.textContent = STYLE_TEXT
      document.head.appendChild(styleEl)
      ctx.effect(function () {
        return function () {
          try { if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch (e) { /* 忽略清理期错误 */ }
        }
      }, 'dsh-mattpocock-skills-deck: styles')

      // RPC 替身：connection.rpc.call('/dsws', endpoint, args) → RpcResult 解包
      const conn = ctx.get('connection')
      const rpcCall = async function (endpoint, args) {
        if (conn === undefined || conn.rpc === undefined) throw new Error('connection 服务不可用')
        const res = await conn.rpc.call('/dsws', endpoint, args)
        if (res && res.ok) return res.value
        throw new Error((res && res.error && res.error.message) || ('RPC 失败：' + endpoint))
      }
      // timer 兜底（client 服务不可用时 setTimeout）
      const later = function (fn, ms) {
        if (timer !== undefined && timer.timeout) return timer.timeout(fn, ms)
        return setTimeout(fn, ms)
      }

      // ============================================================
      // 0.5 locale（T3 #366 · dsws 命名空间 zh/en；跟随 harness 语言；GitHub 数据不翻译）
      // 契约：ctx.locale（dsh-client-locale）：register(ns, {zh, en}) + bind(ns) 稳定引用，调用时读当前语言；
      // 所有 outlet 在 locale 切换时自动重渲染（useLocaleRevision），模块级 t 即可生效。
      // 模板默认文本（GUIDE_LINE/FIXATE_PROMPT/TPL_DEFAULT）= 注入内容而非控件文案，不翻译（T3 决策）。
      // ============================================================
      const L = {
        zh: {
          'nav.word': '沉淀',
          'nav.takeable': '可接',
          'nav.occupied': '阻塞',
          'nav.env': '环境',
          'nav.envTitle': '环境检查 ({n}/{t})',
          'panel.title': 'MattSkills',
          'nav.takeableTitle': '可接 = 未认领可执行的任务数',
          'nav.occupiedTitle': '阻塞 = 已认领未关闭的任务数',
          'nav.bug': 'BUG',
          'nav.bugTitle': '过滤：open + bug 标签',
          'nav.bugNew': '新增',
          'nav.bugNewTitle': '新会话中打开 /wayfinder 新增 BUG 单 prompt',
          'nav.triage': '诊断',
          'nav.triageTitle': '过滤：open + needs-triage 标签',
          'nav.refresh': '更新',
          'nav.refreshing': '更新中…',
          'nav.refreshTitle': '重新检查 + 刷新快照',
          'nav.fixateTitle': '保存进度快照 · 注入零丢失 prompt',
          'nav.handoff': '交接',
          'nav.handoffReady': '交接给新会话',
          'nav.handoffTitle': '交接：发送 /handoff 生成交接文档',
          'nav.handoffReadyTitle': '开新会话并预填交接文档路径',
          'nav.handoffGreyTitle': '尚未生成交接文档：先点「交接」生成',
          'nav.skillsTitle': '技能套件：点击展开技能列表，点击技能名插入当前会话',
          'nav.skillHint': '点击技能名 → 插入到当前会话',
          'banner.setup': 'setup 未执行',
          'banner.skills': '未检测到核心技能套件（wayfinder / triage / grilling / grill-me / implement / ask-matt 等）：{list}。安装后才能使用全流程功能。',
          'banner.skillsBtn': '帮我安装 Matt 技能套件',
          'banner.setupBtn': '帮我执行 /setup-matt-pocock-skills',
          'banner.ghcli': '未安装 GitHub CLI —— 面板所有数据都依赖 gh，请先安装',
          'banner.ghcliBtn': '打开安装页',
          'banner.ghauth': '未登录 GitHub —— 运行 gh auth login（浏览器授权）后再使用',
          'banner.ghauthBtn': '查看登录指南',
          'env.installBtn': '安装引导',
          'env.guide': '配置引导 · 按顺序完成',
          'env.g1': '安装 GitHub CLI',
          'env.g2': '登录 GitHub',
          'env.g3': '运行 setup 初始化（选 GitHub tracker）',
          'env.g4': '安装 Matt skills 技能套件',
          'act.diagnose': '诊断',
          'act.fix': '修复',
          'act.discuss': '讨论',
          'act.execute': '执行',
          'act.view': '查看',
          'act.load': '加载',
          'act.done': '完成',
          'type.research': '研究',
          'type.prototype': '原型',
          'type.grilling': '对齐',
          'type.task': '任务',
          'list.back': '返回列表',
          'list.mapChip': '地图',
          'list.loadFail': '加载失败',
          'list.noDest': '（未填写 Destination）',
          'list.noNotes': '（未填写 Notes）',
          'list.kpi.takeable': '可接',
          'list.kpi.occupied': '阻塞',
          'list.kpi.closed': '已关闭',
          'list.refresh': '刷新',
          'list.refreshing': '刷新中…',
          'list.envWarn': '{n} 项环境未就绪，点此查看',
          'list.all': '全部',
          'list.loading': '加载中…',
          'list.errFull': '快照加载失败：{err}',
          'list.restFallback': '⚠ GraphQL 配额已耗尽，已切换 REST 通道（数据可能略旧，配额恢复后自动回切）',
          'list.none': '暂无',
          'list.closedN': '已关闭 {n}',
          'list.collapse': '收起',
          'list.blocked': '被阻塞',
          'list.blockedTitle': '被 {by} 阻塞（点击查看地图详情）',
          'list.tagsTitle': '全部标签：{names}（点击展开）',
          'list.tagsCount': '全部标签 · {n} 个',
          'list.popTitle': '标题',
          'cfg.previewTitle': '示例 issue 标题',
          'list.tagsCollapseTitle': '收起标签',
          'list.copyLinkTitle': '复制链接',
          'list.openInGithubTitle': '在 GitHub 上查看 #{n}',
          'list.mapTitle': '查看地图详情',
          'list.state.all': '全部', 'list.state.open': 'Open', 'list.state.closed': '已关闭', 'list.state.blocked': '阻塞', 'list.state.frontier': '可接',
          'list.filterActive': '当前过滤：', 'list.filterClear': '清除全部',
          'list.sort.updatedAt': '更新', 'list.sort.createdAt': '创建', 'list.sort.number': '编号', 'list.sort.title': '标题',
          'map.decisions': 'Decisions so far（{n}）',
          'map.fog': 'Not yet specified（战雾 {n}）',
          'map.outOfScope': 'Out of scope（{n}）',
          'map.grpTakeable': '可接 {n}',
          'map.grpClaimed': '已认领 {n}',
          'map.grpBlocked': '被阻塞 {n}',
          'map.grpClosed': '已关闭 {n}',
          'map.layer': '层 {n}',
          'map.progressCap': '地图进度',
          'map.curLayer': '当前：层 {n}',
          'map.layersPassed': '{n}/{t} 层已通过',
          'map.notesCap': '正文详情',
          'map.startCap': 'Start',
          'map.destCap': 'Destination',
          'map.startBtn': '开始 #{n}',
          'map.archive': '档案',
          'map.subClaimed': '已认领 {who}',
          'map.subBlocked': '被阻塞：{who}',
          'map.subClosed': '已关闭',
          'map.executeTitle': '执行 · 注入地图开始提示词',
          'map.doneTitle': '完成 · 注入收尾确认 prompt',
          'skill.centerRing': '中心 = 推荐 · 环绕 = 相关（实心已装/空心未装）· 点击注入 /skill',
          'skill.centerTitle': '推荐 {skill} · 注入 /{skill}',
          'skill.all': '全部技能',
          'skill.generic': '通用建议',
          'skill.notes': '「{m}」Notes 指定',
          'skill.treat': '用 /{s} 处理',
          'skill.list': '列表',
          'skill.ring': '圆环',
          'env.title': '环境检查 {n}',
          'env.recheck': '重新检查',
          'env.checking': '检查中…',
          'env.missing': '缺失',
          'env.partial': '部分就绪',
          'env.ready': '就绪',
          'env.failFull': '环境检查失败：{err}',
          'env.detecting': '检测中…',
          'env.missingBanner': '{n} 项缺失，先补齐再开始 wayfinder 工作',
          'env.openUrl': '打开网址',
          'env.copyUrl': '复制网址',
          'panel.snapErr': '快照异常',
          'panel.loading': '加载中…',
          'panel.tabList': '列表',
          'panel.tabSkills': '技能',
          'panel.tabChecks': '环境检查',
          'panel.refreshing': '刷新中…',
          'panel.closeTitle': '关闭面板',
          'rz.n': '拖上边 = 加高面板', 'rz.s': '拖下边 = 加高面板', 'rz.e': '拖右边 = 加宽面板', 'rz.w': '拖左边 = 加宽面板',
          'rz.ne': '右上角缩放', 'rz.nw': '左上角缩放', 'rz.se': '右下角缩放', 'rz.sw': '左下角缩放',
          'toast.injectedHandoff': '已注入 /handoff 交接模板（含时间戳文件名），确认后发送',
          'toast.copiedHandoff': '已复制交接文档指令',
          'toast.copiedHandoffFile': '已复制交接文档指令：{file}',
          'toast.handoffGrey': '请先点「交接」生成交接文档',
          'toast.injected': '已注入输入框，确认后发送',
          'toast.copiedFallback': '已复制到剪贴板（输入框不可用，兜底）',
          'toast.copied': '已复制',
          'toast.copyFailed': '复制失败，请手动复制',
          'toast.clipboardUnavailable': '剪贴板不可用',
          'toast.snapFail': '快照刷新失败：{err}',
          'toast.copiedLink': '已复制链接 #{n}',
          'toast.newSessionOpened': '已在新会话中打开并预填指令（同 cwd）',
          'toast.newSessionManual': '请手动新建会话并命名为「{title}」；指令已预填当前输入框',
          'toast.resetPanelWidthDone': '面板宽度已重置 · 下次打开生效',
          'toast.resetPanelWidthFail': 'layout 服务暂不支持重置 · 请更新 DSH harness',
          // #394：新会话按钮可见文字 + hover title（去掉冗余 detail，靠 #361 doc + 行为本身解释）
          'list.newSessionLabel': '新会话',
          'panel.newWayfinder': '+ 需求',
          'panel.newWayfinderTitle': '新会话中打开 /wayfinder 新增需求 prompt（继承当前工作区）',
          'panel.newBug': '+ bug',
          'panel.newBugTitle': '新会话中打开 /wayfinder 新增 BUG 单 prompt（继承当前工作区）',
          'panel.diffRemoved': '{n} 个已关闭/移除',
          'panel.repoTitle': '当前仓库，点击打开 GitHub',
          'panel.noRepo': '没有仓库',
          'panel.noRepoTitle': '当前工作区不是 Git 仓库 —— 请先 git init 或进入仓库目录',
          'panel.noRepoCardTitle': '当前工作区不是 Git 仓库 — 点此初始化并发布',
          'panel.noRepoCardDesc': '点击将它变成 GitHub 仓库并发布',
          'panel.noRepoCardAction': '创建并发布',
          'panel.noRepoCardDismiss': '忽略',
          'panel.noRepoCardDone': '已在首屏引导 · 切换到 ListTab 完成',
          'panel.noRepoFormName': '仓库名',
          'panel.noRepoFormNameHint': '仅支持字母、数字、._- · ≤100',
          'panel.noRepoFormVisibility': '可见性',
          'panel.noRepoFormPublic': '公开',
          'panel.noRepoFormPrivate': '私有',
          'panel.noRepoFormSubmit': '创建并发布',
          'panel.noRepoFormCancel': '取消',
          'panel.noRepoFormSubmitting': '创建中…',
          'panel.noRepoErr.bad-name': '仓库名仅支持字母/数字/._- 且 ≤100',
          'panel.noRepoErr.no-git': '未找到 git，请先安装 Git',
          'panel.noRepoErr.no-gh': '未找到 gh，请先安装 GitHub CLI',
          'panel.noRepoErr.not-logged-in': '未登录 GitHub，请先执行 gh auth login',
          'panel.noRepoErr.already-exists': '同名仓库已存在，去 GitHub 查看',
          'panel.noRepoErr.network': '网络异常，请重试',
          'panel.noRepoErr.permission': '权限不足，请检查登录账号',
          'panel.noRepoErr.unknown': '创建失败，请查看错误详情',
          'panel.noRepoErr.git-commit-failed': 'Git 提交失败',
          'panel.noRepoReset': '重置忽略',
          'panel.noRepoCreateSuccess': '已创建 {repo}',
          'map.newSessionTitle': '在新会话打开（推进该 map）',
          'progress.todo': '未动工', 'progress.doing': '进行中 {n}%', 'progress.confirm': '95% · 待确认', 'progress.accept': '100% · 待验收', 'progress.done': '完成',
          'err.hostUnavailable': 'host.call 不可用（Host 半未加载）',
          'err.connUnavailable': 'connection 服务不可用（Host 半未加载）',
          'err.statusEmpty': 'wf.status 返回空结果',
          'err.snapshotEmpty': 'wf.snapshot 返回异常',
          'cfg.status': '配置',
          'cfg.saved': '已保存',
          'cfg.sub': '配置面板与动作提示词：静态文本可自由编辑，占位符由系统注入真值，点击即可插入。',
          'matte.title': 'Matt Pocock 技能集',
          'matte.desc': '工程领域 + 通用领域的 AI agent 技能集（wayfinder / triage / grilling / handoff 等 25 个核心技能）',
          'matte.openRepo': '打开 GitHub',
          'matte.copyPrompt': '复制安装 prompt',
          'cfg.openIn': '打开位置',
          'cfg.openInDesc': '面板在哪个区域打开。better-sidebar 已安装时默认侧边栏；窗口缩小时侧边栏更稳。',
          'cfg.openInLabel': '打开位置',
          'cfg.openInDock': '停靠列',
          'cfg.openInSidebar': '侧边栏',
          'cfg.openInHint': '已即时生效：下次打开面板时按新位置打开',
          'cfg.panelWidth': '面板宽度',
          'cfg.resetPanelWidth': '重置面板宽度',
          'cfg.resetPanelWidthDesc': '下次打开面板时使用 layout 服务默认宽度（清掉上次的拖拽记忆）',
          'cfg.startTpl': '开始模板（执行动作）',
          'cfg.startTplDesc': '「执行」按钮注入的提示词；留空使用默认模板。',
          'cfg.withPrefix': '带 /wayfinder 前缀',
          'cfg.tplEditor': '动作模板编辑器',
          'cfg.tplEditorDesc': '「执行」外的六个动作按钮注入的提示词。点击下方占位符插入到光标处；红色「必填」占位符删除后无法保存。',
          'cfg.execHint': '「执行」模板在开始模板节编辑 →',
          'cfg.saveRejected': '保存被拒绝',
          'cfg.saveAll': '保存全部',
          'cfg.resetAll': '恢复全部默认',
          'cfg.reset': '恢复默认',
          'cfg.preview': '效果预览',
          'cfg.must': '必填',
          'cfg.chipReq': '必填占位符：删除后无法保存',
          'cfg.chipInsert': '点击插入到光标处',
          'tpl.missing': '缺少强制占位符 {list}',
          'tpl.unknown': '未知占位符 {list}',
          'tpl.name.diagnose': '诊断', 'tpl.name.fix': '修复', 'tpl.name.discuss': '讨论',
          'tpl.name.handoff1': '交接第一击', 'tpl.name.handoff2': '交接第二击', 'tpl.name.fixate': '沉淀',
          'tpl.desc.diagnose': 'needs-triage 票的行级动作',
          'tpl.desc.fix': 'bug 票的行级动作',
          'tpl.desc.discuss': 'wayfinder:grilling 票的行级动作',
          'tpl.desc.handoff1': '生成交接文档（含时间戳，两击文件名一致）',
          'tpl.desc.handoff2': '读取交接文档',
          'tpl.desc.fixate': '零丢失快照 prompt',
          'run.loaded': '已加载',
          'run.desc': '环境检查（wf.status）+ 面板（wf.snapshot）均已接真。',
          'run.openPanel': '打开面板',
          'run.openCfg': '打开配置',
          'run.cfgGuide': '配置页：设置 → 插件 → MattSkills',
          'skilldesc.ask-matt': '技能路由器：不知道该用哪个 skill 时问它',
          'skilldesc.setup-matt-pocock-skills': '仓库初始化：issue tracker / 标签 / 文档路径',
          'skilldesc.wayfinder': '为多议题项目建决策地图与子票拆解',
          'skilldesc.triage': 'issue 分流：归类→验证→追问，直至 ready-for-agent',
          'skilldesc.grilling': '在你拍板前反复追问澄清，直到设计落地',
          'skilldesc.domain-modeling': '梳理领域术语，让代码 / 文档 / 对话用同一套词',
          'skilldesc.research': '后台调研，写进 repo 内 markdown 并引源',
          'skilldesc.prototype': '一次性原型回答设计问题',
          'skilldesc.implement': '把规格文档拆成代码任务，逐项实现',
          'skilldesc.code-review': '按仓库规范 + 原规格，双轴审查你的改动',
          'skilldesc.codebase-design': '为代码找清晰的模块边界与接口',
          'skilldesc.diagnosing-bugs': '硬 bug / 性能回归：定位→假设→验证，循环往复',
          'skilldesc.improve-codebase-architecture': '扫出代码库的深化机会，输出 HTML 报告',
          'skilldesc.tdd': '测试驱动开发：先写失败测试，再写最小实现',
          'skilldesc.handoff': '把当前对话压缩成交接文档',
          'skilldesc.teach': '跨 session 教你新技能',
          'skilldesc.to-spec': '把零散讨论固化成可执行的规格文档',
          'skilldesc.to-tickets': '把规格拆成 tickets',
          'skilldesc.resolving-merge-conflicts': '解决合并冲突',
          'skilldesc.writing-great-skills': '为 AI 写出可复用、可测试的技能描述',
        },
        en: {
          'nav.word': 'Consolidate',
          'nav.takeable': 'Ready',
          'nav.occupied': 'Busy',
          'nav.env': 'Env',
          'nav.envTitle': 'Environment checks ({n}/{t})',
          'panel.title': 'MattSkills',
          'nav.takeableTitle': 'Ready = unclaimed, takeable tasks',
          'nav.occupiedTitle': 'Busy = claimed but not yet closed',
          'nav.bug': 'BUG',
          'nav.bugTitle': 'Filter: open + bug label',
          'nav.bugNew': 'New',
          'nav.bugNewTitle': 'Open a /wayfinder new-BUG prompt in a new session (same workspace)',
          'nav.triage': 'Triage',
          'nav.triageTitle': 'Filter: open + needs-triage label',
          'nav.refresh': 'Refresh',
          'nav.refreshing': 'Updating…',
          'nav.refreshTitle': 'Re-check + refresh snapshot',
          'nav.fixateTitle': 'Save a snapshot · inject the zero-loss prompt',
          'nav.handoff': 'Handoff',
          'nav.handoffReady': 'Handoff · new session',
          'nav.handoffTitle': 'Handoff: send /handoff to generate the handoff doc',
          'nav.handoffReadyTitle': 'Open a new session with the handoff doc path prefilled',
          'nav.handoffGreyTitle': 'No handoff doc yet — click Handoff first to generate one',
          'nav.skillsTitle': 'Skill suite: expand the skill list; click a skill to insert it into this session',
          'nav.skillHint': 'Click a skill to insert it into this session',
          'banner.setup': 'setup not run yet',
          'banner.skills': 'Core skill suite missing (wayfinder / triage / grilling / grill-me / implement / ask-matt …): {list}. Install them to use the full workflow.',
          'banner.skillsBtn': 'Install the Matt skill suite for me',
          'banner.setupBtn': 'Run /setup-matt-pocock-skills for me',
          'banner.ghcli': 'GitHub CLI not installed — all panel data depends on gh, install it first',
          'banner.ghcliBtn': 'Open install page',
          'banner.ghauth': 'Not signed in to GitHub — run gh auth login (browser auth) first',
          'banner.ghauthBtn': 'View sign-in guide',
          'env.installBtn': 'Install guide',
          'env.guide': 'Setup guide · complete in order',
          'env.g1': 'Install GitHub CLI',
          'env.g2': 'Sign in to GitHub',
          'env.g3': 'Run skill setup (choose GitHub tracker)',
          'env.g4': 'Install Matt skills suite',
          'act.diagnose': 'Diagnose',
          'act.fix': 'Fix',
          'act.discuss': 'Discuss',
          'act.execute': 'Execute',
          'act.view': 'View',
          'act.load': 'Load',
          'act.done': 'Complete',
          'type.research': 'Research',
          'type.prototype': 'Prototype',
          'type.grilling': 'Align',
          'type.task': 'Task',
          'list.back': 'Back to list',
          'list.mapChip': 'Map',
          'list.loadFail': 'Failed to load',
          'list.noDest': '(no Destination)',
          'list.noNotes': '(no Notes)',
          'list.kpi.takeable': 'Ready',
          'list.kpi.occupied': 'Blocked',
          'list.kpi.closed': 'Closed',
          'list.refresh': 'Refresh',
          'list.refreshing': 'Refreshing…',
          'list.envWarn': '{n} check(s) not ready — click to view',
          'list.all': 'All',
          'list.loading': 'Loading…',
          'list.errFull': 'Snapshot failed: {err}',
          'list.restFallback': '⚠ GraphQL quota exhausted — switched to REST channel (data may be slightly stale; auto-reverts when quota resets)',
          'list.none': 'None',
          'list.closedN': 'Closed {n}',
          'list.collapse': 'Collapse',
          'list.blocked': 'Blocked',
          'list.blockedTitle': 'Blocked by {by} (click for map details)',
          'list.tagsTitle': 'All labels: {names} (click to expand)',
          'list.tagsCount': 'All labels · {n}',
          'list.popTitle': 'Title',
          'cfg.previewTitle': 'Sample issue title',
          'list.tagsCollapseTitle': 'Collapse labels',
          'list.copyLinkTitle': 'Copy link',
          'list.openInGithubTitle': 'Open #{n} on GitHub',
          'list.mapTitle': 'View map details',
          'list.state.all': 'All', 'list.state.open': 'Open', 'list.state.closed': 'Closed', 'list.state.blocked': 'Blocked', 'list.state.frontier': 'Ready',
          'list.filterActive': 'Active filters: ', 'list.filterClear': 'Clear all',
          'list.sort.updatedAt': 'Updated', 'list.sort.createdAt': 'Created', 'list.sort.number': 'Number', 'list.sort.title': 'Title',
          'map.decisions': 'Decisions so far ({n})',
          'map.fog': 'Not yet specified (fog {n})',
          'map.outOfScope': 'Out of scope ({n})',
          'map.grpTakeable': 'Ready {n}',
          'map.grpClaimed': 'Claimed {n}',
          'map.grpBlocked': 'Blocked {n}',
          'map.grpClosed': 'Closed {n}',
          'map.layer': 'Layer {n}',
          'map.progressCap': 'Map progress',
          'map.curLayer': 'Current: layer {n}',
          'map.layersPassed': '{n}/{t} layers passed',
          'map.notesCap': 'Notes',
          'map.startCap': 'Start',
          'map.destCap': 'Destination',
          'map.startBtn': 'Start #{n}',
          'map.archive': 'Archive',
          'map.subClaimed': 'Claimed by {who}',
          'map.subBlocked': 'Blocked by: {who}',
          'map.subClosed': 'Closed',
          'map.executeTitle': 'Execute · inject the map\'s start prompt',
          'map.doneTitle': 'Complete · inject the wrap-up confirmation prompt',
          'skill.centerRing': 'Center = recommended · Ring = related (filled = installed / hollow = not) · click to inject /skill',
          'skill.centerTitle': 'Recommended {skill} · click to inject /{skill}',
          'skill.all': 'All skills',
          'skill.generic': 'General suggestion',
          'skill.notes': 'Specified by "{m}" Notes',
          'skill.treat': 'Handle with /{s}',
          'skill.list': 'List',
          'skill.ring': 'Ring',
          'env.title': 'Environment checks {n}',
          'env.recheck': 'Re-check',
          'env.checking': 'Checking…',
          'env.missing': 'Missing',
          'env.partial': 'Partial',
          'env.ready': 'Ready',
          'env.failFull': 'Environment check failed: {err}',
          'env.detecting': 'Detecting…',
          'env.missingBanner': '{n} missing — fix them before starting wayfinder work',
          'env.openUrl': 'Open URL',
          'env.copyUrl': 'Copy URL',
          'panel.snapErr': 'Snapshot error',
          'panel.loading': 'Loading…',
          'panel.tabList': 'List',
          'panel.tabSkills': 'Skills',
          'panel.tabChecks': 'Checks',
          'panel.refreshing': 'Refreshing…',
          'panel.closeTitle': 'Close panel',
          'rz.n': 'Drag the top edge up = grow taller', 'rz.s': 'Drag the bottom edge down = grow taller', 'rz.e': 'Drag the right edge right = grow wider', 'rz.w': 'Drag the left edge left = grow wider',
          'rz.ne': 'Resize NE', 'rz.nw': 'Resize NW', 'rz.se': 'Resize SE', 'rz.sw': 'Resize SW',
          'toast.injectedHandoff': '/handoff template injected (timestamped filename) — confirm before sending',
          'toast.copiedHandoff': 'Handoff command copied',
          'toast.copiedHandoffFile': 'Handoff command copied: {file}',
          'toast.handoffGrey': 'Click Handoff first to generate the handoff doc',
          'toast.injected': 'Injected into the input box — confirm before sending',
          'toast.copiedFallback': 'Copied to clipboard (input box unavailable)',
          'toast.copied': 'Copied',
          'toast.copyFailed': 'Copy failed — copy manually',
          'toast.clipboardUnavailable': 'Clipboard unavailable',
          'toast.snapFail': 'Snapshot refresh failed: {err}',
          'toast.copiedLink': 'Link # {n} copied',
          'toast.newSessionOpened': 'Opened in a new session with the prompt prefilled (same cwd)',
          'toast.newSessionManual': 'Please create a new session manually and name it "{title}"; the prompt is prefilled in the current input',
          'toast.resetPanelWidthDone': 'Panel width reset · takes effect on next open',
          'toast.resetPanelWidthFail': 'Layout service doesn\'t support reset yet · please update DSH harness',
          // #394：visible label + hover title for new-session button
          'list.newSessionLabel': 'New session',
          'panel.newWayfinder': '+ Requirement',
          'panel.newWayfinderTitle': 'Open a /wayfinder new-requirement prompt in a new session (same workspace)',
          'panel.newBug': '+ BUG',
          'panel.newBugTitle': 'Open a /wayfinder new-BUG prompt in a new session (same workspace)',
          'panel.diffRemoved': '{n} closed/removed',
          'panel.repoTitle': 'Current repo — open on GitHub',
          'panel.noRepo': 'No repo',
          'panel.noRepoTitle': 'Current workspace is not a Git repo — run git init or open a repo directory',
          'panel.noRepoCardTitle': 'Current workspace is not a Git repo — click to init and publish',
          'panel.noRepoCardDesc': 'Turn this workspace into a GitHub repo and publish it',
          'panel.noRepoCardAction': 'Create and publish',
          'panel.noRepoCardDismiss': 'Ignore',
          'panel.noRepoCardDone': 'Already guided on first screen · switch to ListTab',
          'panel.noRepoFormName': 'Repository name',
          'panel.noRepoFormNameHint': 'Letters, digits, ._- only · ≤100',
          'panel.noRepoFormVisibility': 'Visibility',
          'panel.noRepoFormPublic': 'Public',
          'panel.noRepoFormPrivate': 'Private',
          'panel.noRepoFormSubmit': 'Create and publish',
          'panel.noRepoFormCancel': 'Cancel',
          'panel.noRepoFormSubmitting': 'Creating…',
          'panel.noRepoErr.bad-name': 'Name supports only letters/digits/._- ≤100',
          'panel.noRepoErr.no-git': 'git not found — please install Git',
          'panel.noRepoErr.no-gh': 'gh not found — please install GitHub CLI',
          'panel.noRepoErr.not-logged-in': 'Not logged into GitHub — run gh auth login',
          'panel.noRepoErr.already-exists': 'Repository already exists — view on GitHub',
          'panel.noRepoErr.network': 'Network error — please retry',
          'panel.noRepoErr.permission': 'Permission denied — check login account',
          'panel.noRepoErr.unknown': 'Creation failed — see error details',
          'panel.noRepoErr.git-commit-failed': 'Git commit failed',
          'panel.noRepoReset': 'Reset ignore',
          'panel.noRepoCreateSuccess': 'Created {repo}',
          'map.newSessionTitle': 'Open in a new session (advance this map)',
          'progress.todo': 'Not started', 'progress.doing': 'In progress {n}%', 'progress.confirm': '95% · confirming', 'progress.accept': '100% · acceptance', 'progress.done': 'Done',
          'err.hostUnavailable': 'host.call unavailable (host half not loaded)',
          'err.connUnavailable': 'connection service unavailable (host half not loaded)',
          'err.statusEmpty': 'wf.status returned an empty result',
          'err.snapshotEmpty': 'wf.snapshot returned an error',
          'cfg.status': 'Config',
          'cfg.saved': 'Saved',
          'cfg.sub': 'Configure the panel and action prompts: static text is freely editable; placeholders are filled in by the system — click to insert.',
          'matte.title': 'Matt Pocock skills',
          'matte.desc': 'Engineering + general-purpose AI agent skills (25 core skills: wayfinder / triage / grilling / handoff …)',
          'matte.openRepo': 'Open GitHub',
          'matte.copyPrompt': 'Copy install prompt',
          'cfg.openIn': 'Open in',
          'cfg.openInDesc': 'Where the panel opens. Defaults to the sidebar when dsh-better-sidebar is installed; the sidebar stays put when the window shrinks.',
          'cfg.openInLabel': 'Open location',
          'cfg.openInDock': 'Details column',
          'cfg.openInSidebar': 'Sidebar',
          'cfg.openInHint': 'Applied instantly — next panel open uses this location',
          'cfg.panelWidth': 'Panel width',
          'cfg.resetPanelWidth': 'Reset panel width',
          'cfg.resetPanelWidthDesc': 'Next panel open will use the layout service default width (clears the persisted drag memory).',
          'cfg.startTpl': 'Start template (execute)',
          'cfg.startTplDesc': 'Prompt injected by the Execute button; leave empty for the default template.',
          'cfg.withPrefix': 'Prefix with /wayfinder',
          'cfg.tplEditor': 'Action template editor',
          'cfg.tplEditorDesc': 'Prompts for the six action buttons other than Execute. Click a placeholder below to insert at the cursor; deleting a red Required placeholder blocks saving.',
          'cfg.execHint': 'Edit the Execute template in the Start template section →',
          'cfg.saveRejected': 'Save rejected',
          'cfg.saveAll': 'Save all',
          'cfg.resetAll': 'Reset all defaults',
          'cfg.reset': 'Reset default',
          'cfg.preview': 'Preview',
          'cfg.must': 'Required',
          'cfg.chipReq': 'Required placeholder: cannot save without it',
          'cfg.chipInsert': 'Click to insert at cursor',
          'tpl.missing': 'Missing required placeholder(s): {list}',
          'tpl.unknown': 'Unknown placeholder(s): {list}',
          'tpl.name.diagnose': 'Diagnose', 'tpl.name.fix': 'Fix', 'tpl.name.discuss': 'Discuss',
          'tpl.name.handoff1': 'Handoff · first hit', 'tpl.name.handoff2': 'Handoff · second hit', 'tpl.name.fixate': 'Consolidate',
          'tpl.desc.diagnose': 'Row action for needs-triage tickets',
          'tpl.desc.fix': 'Row action for bug tickets',
          'tpl.desc.discuss': 'Row action for wayfinder:grilling tickets',
          'tpl.desc.handoff1': 'Generate the handoff doc (timestamped; both hits share the filename)',
          'tpl.desc.handoff2': 'Read the handoff doc',
          'tpl.desc.fixate': 'Zero-loss snapshot prompt',
          'run.loaded': 'Loaded',
          'run.desc': 'Environment checks (wf.status) and panel (wf.snapshot) are live.',
          'run.openPanel': 'Open panel',
          'run.openCfg': 'Open config',
          'run.cfgGuide': 'Config: Settings → Plugins → MattSkills',
          'skilldesc.ask-matt': 'Skill router: ask it when unsure which skill to use',
          'skilldesc.setup-matt-pocock-skills': 'Repo bootstrap: issue tracker / labels / doc paths',
          'skilldesc.wayfinder': 'Build decision maps + sub-ticket breakdowns for big projects',
          'skilldesc.triage': 'Route issues: classify → verify → grill, until ready-for-agent',
          'skilldesc.grilling': 'Relentlessly question you until the design is locked down',
          'skilldesc.domain-modeling': 'Lock down domain terms so code, docs and chat use one language',
          'skilldesc.research': 'Background research written into repo markdown with sources',
          'skilldesc.prototype': 'One-off prototype answering a design question',
          'skilldesc.implement': 'Break a spec into code tasks and implement them one by one',
          'skilldesc.code-review': 'Review your diff on both repo standards and the originating spec',
          'skilldesc.codebase-design': 'Find clean module boundaries and interfaces for your code',
          'skilldesc.diagnosing-bugs': 'Hard bugs / perf regressions: locate → hypothesize → verify, loop',
          'skilldesc.improve-codebase-architecture': 'Scan the codebase for deepening opportunities, output an HTML report',
          'skilldesc.tdd': 'Test-driven dev: failing test first, then minimal implementation',
          'skilldesc.handoff': 'Compress this conversation into a handoff doc',
          'skilldesc.teach': 'Teach you new skills across sessions',
          'skilldesc.to-spec': 'Turn scattered discussions into an executable spec',
          'skilldesc.to-tickets': 'Split specs into tickets',
          'skilldesc.resolving-merge-conflicts': 'Resolve merge conflicts',
          'skilldesc.writing-great-skills': 'Write reusable, testable skill descriptions for AI',
        },
      }
      const localeSvc = ctx.get('locale')
      if (localeSvc && typeof localeSvc.register === 'function') {
        ctx.effect(function () {
          return localeSvc.register('dsws', L)
        }, 'dsws: locale')
      }
      // tr：locale 绑定（稳定引用，调用时读当前语言；命名 tr 避免与票务参数 t 冲突）；服务缺失时退化 zh 字典（与 locale 同语义：{name} 参数替换）
      const tr = (localeSvc && typeof localeSvc.bind === 'function')
        ? localeSvc.bind('dsws')
        : function (key, params) {
            let s = (L.zh[key] !== undefined) ? L.zh[key] : key
            if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return name in params ? String(params[name]) : m })
            return s
          }

      // ============================================================
      // 1. 技能目录 + 场景推荐映射
      // ============================================================
      // T3：描述在渲染时 tr('skilldesc.<name>')（此处 use 字段为中文静态参考）
      const SKILLS = [
        { name: 'ask-matt', level: 'warn', use: '技能路由器：不知道该用哪个 skill 时问它' },
        { name: 'setup-matt-pocock-skills', level: 'ok', use: '仓库初始化：issue tracker / 标签 / 文档路径' },
        { name: 'wayfinder', level: 'warn', use: '巨型项目决策地图（本插件服务的对象）' },
        { name: 'triage', level: 'ok', use: 'issue 状态机流转：categorise→verify→grill' },
        { name: 'grilling', level: 'ok', use: '穷追不舍的对齐提问（设计树）' },
        { name: 'domain-modeling', level: 'ok', use: '领域术语与统一语言' },
        { name: 'research', level: 'ok', use: '后台调研，写进 repo 内 markdown 并引源' },
        { name: 'prototype', level: 'ok', use: '一次性原型回答设计问题' },
        { name: 'implement', level: 'warn', use: '把规格落成代码（task 型 ticket）' },
        { name: 'code-review', level: 'ok', use: '按标准 + 规格双轴审查改动' },
        { name: 'codebase-design', level: 'ok', use: '深模块设计词汇' },
        { name: 'diagnosing-bugs', level: 'ok', use: '硬 bug 与性能回归诊断循环' },
        { name: 'improve-codebase-architecture', level: 'ok', use: '扫 deepening opportunities 出 HTML 报告' },
        { name: 'tdd', level: 'ok', use: '红-绿-重构' },
        { name: 'handoff', level: 'warn', use: '把当前对话压缩成交接文档' },
        { name: 'teach', level: 'ok', use: '跨 session 教你新技能' },
        { name: 'to-spec', level: 'warn', use: '把讨论固化成规格' },
        { name: 'to-tickets', level: 'warn', use: '把规格拆成 tickets' },
        { name: 'resolving-merge-conflicts', level: 'ok', use: '解决合并冲突' },
        { name: 'writing-great-skills', level: 'warn', use: '写出优秀技能' },
      ]
      const TYPE_SKILLS = {
        research: ['research'],
        prototype: ['prototype'],
        grilling: ['grilling', 'domain-modeling'],
        task: ['implement'],
      }
      const TYPE_LABEL = {
        research: ['research', 'r', '研究'],
        prototype: ['prototype', 'p', '原型'],
        grilling: ['grilling', 'g', '对齐'],
        task: ['task', 't', '任务'],
      }
      const TYPE_ICON = { research: 'search', prototype: 'hammer', grilling: 'chat', task: 'gear' }

      // ============================================================
      // 2. 外观方案（图标 + 动作词，可切换）
      // ============================================================
      const ICON_SCHEMES = [
        { id: 'compass', label: '罗盘' },
        { id: 'beacon', label: '灯塔' },
        { id: 'radar', label: '雷达' },
        { id: 'pin', label: '图钉' },
      ]
      const WORD_SCHEMES = ['沉淀', '落纸', '存档', '快照']

      const Icon = ({ scheme, size }) => {
        const s = size || 16
        const common = { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'inline-block', verticalAlign: '-2px', flex: 'none' } }
        if (scheme === 'beacon') return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 4, fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })])
        if (scheme === 'radar') return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('circle', { cx: 12, cy: 12, r: 5 }), h('circle', { cx: 12, cy: 12, r: 1.2, fill: 'currentColor', stroke: 'none' }), h('path', { d: 'M12 12L19 8' }), h('circle', { cx: 16.5, cy: 6.5, r: 1.1, fill: 'currentColor', stroke: 'none' })])
        if (scheme === 'pin') return h('svg', common, [h('path', { d: 'M12 21s-6-5.1-6-10a6 6 0 1112 0c0 4.9-6 10-6 10z' }), h('circle', { cx: 12, cy: 11, r: 2.2, fill: 'currentColor', stroke: 'none' })])
        return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('polygon', { points: '15.5 8.5 13 13 8.5 15.5 11 11', fill: 'currentColor', stroke: 'none' })])
      }

      // ---- 通用图标集（统一 SVG stroke 风格）----
      const Ic = ({ n, size, color }) => {
        const s = size || 13
        const common = { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'inline-block', verticalAlign: '-2px', flex: 'none' }, color: color || undefined }
        switch (n) {
          case 'dot': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 4.5, fill: 'currentColor', stroke: 'none' })])
          case 'target': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 8 }), h('circle', { cx: 12, cy: 12, r: 2.4, fill: 'currentColor', stroke: 'none' })])
          case 'lock': return h('svg', common, [h('rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }), h('path', { d: 'M8 11V8a4 4 0 018 0v3' })])
          case 'map': return h('svg', common, [h('path', { d: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z' }), h('path', { d: 'M9 3v15M15 6v15' })])
          case 'compass': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('polygon', { points: '15.5 8.5 13 13 8.5 15.5 11 11', fill: 'currentColor', stroke: 'none' })])
          case 'gear': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 3 }), h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })])
          case 'refresh': return h('svg', common, [h('path', { d: 'M21 12a9 9 0 11-2.6-6.4' }), h('polyline', { points: '21 3 21 9 15 9' })])
          case 'note': return h('svg', common, [h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }), h('path', { d: 'M8 9h8M8 13h8M8 17h5' })])
          case 'fog': return h('svg', common, [h('path', { d: 'M8 17a4 4 0 010-8 5 5 0 019.6-1.6A3.5 3.5 0 0118 17z' }), h('path', { d: 'M3 21h18' })])
          case 'ban': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M5.6 5.6l12.8 12.8' })])
          case 'person': return h('svg', common, [h('circle', { cx: 12, cy: 8, r: 3.5 }), h('path', { d: 'M5 20a7 7 0 0114 0' })])
          case 'check': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M8.5 12.5l2.5 2.5 4.5-5' })])
          case 'play': return h('svg', common, [h('path', { d: 'M8 5.5l11 6.5-11 6.5z', fill: 'currentColor', stroke: 'none' })])
          case 'link': return h('svg', common, [h('path', { d: 'M10 14a5 5 0 007.1 0l2.8-2.8a5 5 0 00-7.1-7.1L11 5.9' }), h('path', { d: 'M14 10a5 5 0 00-7.1 0l-2.8 2.8a5 5 0 007.1 7.1L13 18.1' })])
          case 'back': return h('svg', common, [h('path', { d: 'M19 12H5' }), h('polyline', { points: '12 19 5 12 12 5' })])
          case 'alert': return h('svg', common, [h('path', { d: 'M12 3l10 18H2z' }), h('path', { d: 'M12 9.5V14' }), h('circle', { cx: 12, cy: 17, r: 0.7, fill: 'currentColor', stroke: 'none' })])
          case 'x': return h('svg', common, [h('path', { d: 'M6 6l12 12M18 6L6 18' })])
          case 'star': return h('svg', common, [h('path', { d: 'M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2-5.6-3.2-5.6 3.2 1.3-6.2L3 9.5l6.3-.7z', fill: 'currentColor', stroke: 'none' })])
          case 'search': return h('svg', common, [h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'M21 21l-4.3-4.3' })])
          case 'hammer': return h('svg', common, [h('path', { d: 'M14 4l6 6-2.5 2.5-6-6z' }), h('path', { d: 'M3 21l7.5-7.5' }), h('path', { d: 'M12.5 9.5l2 2' })])
          case 'chat': return h('svg', common, [h('path', { d: 'M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z' })])
          case 'clipboard': return h('svg', common, [h('rect', { x: 5, y: 4, width: 14, height: 16, rx: 2 }), h('path', { d: 'M9 2h6v4H9z' }), h('path', { d: 'M9 11h6M9 15h4' })])
          case 'list': return h('svg', common, [h('path', { d: 'M8 6h12M8 12h12M8 18h12' }), h('circle', { cx: 4, cy: 6, r: 0.8, fill: 'currentColor', stroke: 'none' }), h('circle', { cx: 4, cy: 12, r: 0.8, fill: 'currentColor', stroke: 'none' }), h('circle', { cx: 4, cy: 18, r: 0.8, fill: 'currentColor', stroke: 'none' })])
          case 'info': return h('svg', common, [h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 11v5' }), h('circle', { cx: 12, cy: 8, r: 0.7, fill: 'currentColor', stroke: 'none' })])
          case 'handoff': return h('svg', common, [h('path', { d: 'M7 17l-4-4 4-4' }), h('path', { d: 'M3 13h6a6 6 0 016 6' }), h('path', { d: 'M17 7l4 4-4 4' }), h('path', { d: 'M21 11h-6a6 6 0 00-6-6' })])
          // #394：与 nav.handoff 同图标造成「交接 / 新开会话」二义；新会话按钮换 external-link 消歧
          // 需求1（2026-08-18）：交接文档 + 出箭头 —— 「新会话交接」小按钮
        case 'handoff-open': return h('svg', common, [h('path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }), h('path', { d: 'M14 3v5h5' }), h('path', { d: 'M10 15l4-4' }), h('path', { d: 'M11 11h3v3' })])
        // 需求1·rev（2026-08-18）：禁用态“文档暂不可开” —— 交接文档 + 斜杠（未生成时右侧按钮的静止样式）
        case 'handoff-off': return h('svg', common, [h('path', { d: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z' }), h('path', { d: 'M14 3v5h5' }), h('path', { d: 'M8 16l8-8' })])
        // 需求2（2026-08-18）：2×2 网格 —— 技能列表按钮
        case 'skills': return h('svg', common, [h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }), h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 })])
        case 'external-link': return h('svg', common, [h('path', { d: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6' }), h('polyline', { points: '15 3 21 3 21 9' }), h('line', { x1: 10, y1: 14, x2: 21, y2: 3 })])
        // 新增BUG入口（issue #4）：虫形图标 —— 「+ 新增BUG单」按钮 / 状态栏 BUG 悬停菜单「新增」
        case 'bug': return h('svg', common, [h('path', { d: 'M8 2l1.88 1.88' }), h('path', { d: 'M14.12 3.88L16 2' }), h('path', { d: 'M9 7.13v-1a3.003 3.003 0 116 0v1' }), h('path', { d: 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6' }), h('path', { d: 'M12 20v-9' }), h('path', { d: 'M6.53 9C4.6 8.8 3 7.1 3 5' }), h('path', { d: 'M6 13H2' }), h('path', { d: 'M3 21c0-2.1 1.7-3.9 3.8-4' }), h('path', { d: 'M20.97 5c0 2.1-1.6 3.8-3.5 4' }), h('path', { d: 'M22 13h-4' }), h('path', { d: 'M17.2 17c2.1.1 3.8 1.9 3.8 4' })])
          default: return null
        }
      }

      // ============================================================
      // 2.5 配置模型（v25 · T2a：dsws.cfg + dsws.templates；旧 dsws.startCfg 自动迁移）
      // 必须位于 §3 store 之前（DEFAULT_PANEL_H 固定 1/2）
      // ============================================================
      // v22：统一引导句（T1 拍板：普通静态文本，用户可改；不是占位符）
      // §prompts：prompt 注册表（内容层 · 独立于 UI 文案 i18n）—— 方案 A
      //   每条：{ version, placeholders, use, zh, en }；运行时按当前语言经 promptText(id, params) 取用
      //   占位符契约：文本内 {x} 必须声明在 placeholders；promptText 只替换已声明参数（未知保留）
      //   原则：所有 prompt 相对所引用技能（wayfinder/grilling/triage 等）只做「追加扩展要求」，绝不覆盖技能自身规则。
      //   审阅：docs/prompts-review.html / .md · 契约校验：tests/verify-prompts.js
      // ============================================================
          const PROMPTS = {
        "guide": { version: 1, placeholders: [], use: '统一引导句（追加于各动作 prompt 末尾）', zh: '从第一性原理出发完成任务，并对抗式审查。', en: 'Approach tasks from first principles, and review adversarially.' },
        "mapExecute": { version: 4, placeholders: [], use: 'map 执行 / 新会话（未完成态）· 推进式', zh: '请按以下流程推进该 map（遵循 wayfinder 技能规则）：\n1. 加载 wayfinder 技能（如未加载）；\n2. 分析这个 map（Destination / Notes / 阻塞关系 / 当前 frontier）；\n3. 按第一性原理分析当前最适合推进的下一个 issue（frontier 中价值最高、风险最低、最解阻的）；\n4. 去执行它：先认领 → 读该 issue 的 Description / Notes / 阻塞关系 → 制定方案 → 实施 → 验收；\n5. 结束前按进度契约更新该 issue 正文（## 进度：N% + 下一步）；本次推进完成且验收通过 → 100% + close。\n若本次推进有关闭的票：按 wayfinder 规则同步 map 记录（Decisions so far 追加 gist / 迷雾毕业 / Out of scope）。', en: 'Please advance this map:\n1. Load the wayfinder skill (if not loaded);\n2. Analyze this map (Destination / Notes / blocking relationships / current frontier);\n3. From first principles, pick the most valuable next issue on the frontier (highest value, lowest risk, most unblocking);\n4. Go execute it: read the issue Description / Notes / blocking relationships → plan → implement → verify.\n\nApproach tasks from first principles, and review adversarially.\nIf this advance closes any ticket, sync the map records per wayfinder rules (Decisions so far gist / fog graduation / Out of scope).' },
        "complete": { version: 3, placeholders: ['n', 'closed', 'total'], use: 'map 完成态 · 完成确认（收尾 close / 列遗漏）', zh: '## 完成确认 · MAP #{n}\n\n当前地图显示 100% 完成：{closed}/{total} 个 issue 已关闭，但 map 本身仍 open。\n\n请按以下流程处理：\n\n1. 检查完成状态是否真实：{closed}/{total} 已 CLOSED —— 但 map 本身仍 OPEN。请检查：\n   - 子票是否真的解决了原 Destination？\n   - 是否还有 Not yet specified 中未毕业的事项？\n   - 实际已完成却漏标 CLOSED 的 issue（漏关/误开）—— 逐个核对 ticket 的完成状态与关闭状态是否一致；\n   - 是否有 issue 属于该 map 但未建立 sub-issue 关系；\n2. 确认后处理：\n   - 确实全部完成 → 调用 close + 在 Decisions so far 追加总结（每个 closed ticket 一行 gist）；\n   - 发现遗漏 → 列出未完成项，先解决再重新判断；\n   - 不确定 → 询问用户「该地图的全部工作是否已完成，需要做收尾吗？」不要擅自 close；\n3. 最终目标：要么 close map + 写 Decisions so far 总结，要么明确指出未完成项。\n\n从第一性原理出发完成任务，并对抗式审查。\n收尾规则：已实施完成、测试绿、仅差用户确认的票 —— 已确认则 close，未确认则标注「进度 100% · 待验收」，不得显示为未动工。\n维护地图记录（wayfinder 规则）：\n- 关闭一张票时，在所属 map 的 Decisions so far 追加一行 gist（票名 + 链接 + 一句话结论）；\n- 检查 map 的 Not yet specified：可明确的事项毕业为新票（create-then-wire），并从迷雾节清除；\n- 越出目的地范围的票 → 移入 Out of scope（写明原因），不留在 frontier。', en: '## Completion check · MAP #{n}\n\nThe map shows 100% complete: {closed}/{total} issues closed, but the map itself is still open.\n\nHandle it as follows:\n\n1. Verify the completion is real: {closed}/{total} are CLOSED — but the map is still OPEN. Check:\n   - Did the sub-issues really resolve the original Destination?\n   - Are there ungraduated items left in Not yet specified?\n   - Any issue actually completed but missing CLOSED (missed/erroneous) — verify each ticket completion vs close state;\n   - Any issue belonging to this map without a sub-issue relationship;\n2. Then act:\n   - All truly done → close the map + append a summary to Decisions so far (one-line gist per closed ticket);\n   - Gaps found → list the unfinished items, resolve them first, then re-judge;\n   - Unsure → ask the user \\"Has all the work on this map been completed? Should we wrap up?\\" — do not close on your own;\n3. Goal: either close the map + write the Decisions-so-far summary, or clearly list the unfinished items.\n\nApproach tasks from first principles, and review adversarially.\nMaintain map records (wayfinder rules):\n- When closing a ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion);\n- Check the map Not yet specified: graduate specifiable items into new tickets (create-then-wire) and clear them from the fog section;\n- Tickets beyond the destination scope → move to Out of scope (with reason), never left on the frontier.' },
        "fixate": { version: 1, placeholders: [], use: '沉淀 · 零丢失快照', zh: '里程碑固化点。暂停推进，执行「零丢失快照」，从第一性原理出发：\n\n1. 全量复述：把我从会话开始到现在说过的全部信息，按「目的地 / 约束与偏好 / 已确认的决定 / 待决问题 / 雾区（隐约可见但还不清晰）」五类，逐条列出——不压缩、不合并，宁可啰嗦不可省略。\n2. 每条后面标注出处：用我的原话引用，让我知道它来自我哪句话。\n3. 单独列一节「可疑遗漏」：凡是我提过、但你觉得与主线无关、太模糊或像执行细节而没纳入的，全部摆出来，写明你当初不纳入的理由，由我裁决。\n4. 列完后停下等我逐条核对。我确认或修正完毕后，你再把清单落盘：已有地图就写进 map 正文和对应 ISSUE；只有ISSUE就写进对应ISSUE；都没有就先生成一份快照笔记并告诉我存哪，等建图时搬入。', en: 'Milestone checkpoint. Pause progress and take a "zero-loss snapshot", from first principles:\n\n1. Restate everything I have said since the session started, in five categories: "Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)" — list every item, no compression, no merging, rather verbose than omitted.\n2. Annotate each item with its source: quote my original words so I know which sentence it came from.\n3. Add a separate "Suspected omissions" section: everything I mentioned but you deemed off-topic, too vague, or execution detail and did not include — list them all with your reason, and let me decide.\n4. Stop and wait for my item-by-item review after listing. Once I confirm or correct, persist the list: if a map exists, write into the map body and the corresponding ISSUEs; if only ISSUEs, write into those ISSUEs; if neither, create a snapshot note and tell me where it is, to migrate when a map is created.' },
        "progress": { version: 2, placeholders: [], use: '进度契约（所有动作 prompt 引用）', zh: '进度表达（每次动作结束前必须更新 —— 这是动作的一部分，不是可选项）：\n1. issue 正文维护固定进度区：`## 进度：N%`（N 为 0-100 整数，禁止「大概 / 基本」等模糊词）；\n2. 更新前先读正文当前进度，基于最新状态写真实当前值（可上调也可下调）；\n3. 未动工 = 0%；进行中 = 1-94%；95% = 已完成待用户确认（下一步注明「待确认什么」）；确认后立即写 100% 并 close；\n4. 100% = 确认完成（close 后进度区保留为历史）；\n5. 首次接触无进度区的票：先按现状补写一个与实施记录相符的进度。', en: 'Progress expression (must update before finishing every action — it is part of the action, not optional):\n1. Keep a fixed progress section in the issue body: `## Progress: N%` (N is an integer 0-100; no vague words like "about / basically");\n2. Before updating, read the body current progress and write the true current value based on the latest state (can go up or down);\n3. Not started = 0%; in progress = 1-94%; 95% = done, awaiting user confirmation (note "what is pending" in the next step); once confirmed, immediately write 100% and close;\n4. 100% = confirmed done (the section stays as history after close);\n5. On first contact with a ticket lacking the section, write a progress matching its implementation record.' },
        "bodyFormat": { version: 1, placeholders: [], use: '正文格式契约（T16 · 统一追加于 map/ticket 写正文的动作）', zh: '正文格式（写/改 issue 正文时必须遵守）：\n1. 用真实换行书写：`## 章节` 独占一行，段落间留空行；\n2. 禁止字面 \\n 转义（不要把换行写成 \\n 两个字符）、禁止正文以 BOM（\\ufeff）开头；\n3. 写回 issue 正文用 gh issue edit --body-file <文件>（文件内为真实换行），不要用 JSON 转义字符串拼进命令。', en: 'Body format (mandatory when writing/editing an issue body):\n1. Use real newlines: each `## section` on its own line, blank line between paragraphs;\n2. No literal \\n escapes (do not write newlines as the two characters backslash-n), no BOM (\\ufeff) at the start;\n3. Write issue bodies with gh issue edit --body-file <file> (real newlines in the file), never a JSON-escaped string inline in a command.' },
        "grill": { version: 1, placeholders: [], use: '澄清规则（grilling 技能）', zh: '动手前先想一下：我要做的事里，有没有哪部分是「我猜用户想要这样」的？如果有，别猜 —— 用 grilling 技能把猜的地方问清楚再动手。', en: 'Before you start, check: is any part of what you are about to do based on a guess about what the user wants? If so, do not guess — use the grilling skill to settle those guesses before acting.' },
        "newMap": { version: 2, placeholders: [], use: '建图规划契约', zh: '建图前先完成（写入 map body 既有章节，遵循 wayfinder 技能规则）：\n0. 先用 grilling 澄清目的地与范围，不自己定 scope；\n1. 并行 / 串行：在 Notes 用一句话概括「哪些票串行（被阻塞）、哪些可并行」；\n2. 已知 / 待调查 / 迷雾：已确认 → Decisions so far；待调查 → 建票；模糊待定 → Not yet specified（迷雾区，后续毕业为新票）；\n3. 归属：每张票声明建议 owner（agent 或人 · HITL），grilling 类必须标 HITL；\n4. 每张新建票写入 `## 进度：0%` 基准。', en: 'Complete before building a map (write into the map body existing sections, follow the wayfinder skill rules):\n0. Clarify the destination and scope with grilling first; do not set scope yourself;\n1. Parallel / serial: summarize in Notes in one sentence "which tickets are serial (blocked) and which run in parallel";\n2. Known / to-investigate / fog: confirmed → Decisions so far; to investigate → create tickets; vague pending → Not yet specified (the fog zone, later graduating into new tickets);\n3. Ownership: declare a suggested owner per ticket (agent or human · HITL); grilling tickets must be marked HITL;\n4. Write a `## Progress: 0%` baseline into every new ticket.' },
        "tpl.diagnose": { version: 3, placeholders: ['url'], use: '动作按钮「诊断」（needs-triage 票）', zh: '/triage\n{url}\n\n诊断这个 issue（诊断流程遵循 /triage 技能自身规则）：\n1. 先弄清它到底出了什么问题（现象 / 影响范围 / 复现步骤）；\n2. 列出可能的根因（多个候选，标注各自可能性）；\n3. 给分流建议（修复 / 关闭 / 重设计 / 等待）—— 建议是你的判断，不是让你直接执行；\n4. 动手前若有「我猜用户想要这样」的地方，先用 grilling 技能澄清；\n5. 结束前按进度契约更新 issue 正文。', en: '/triage\n{url}\n\nDiagnose this issue (follow the /triage skill own rules):\n1. Pin down what is actually wrong (symptoms / impact / repro steps);\n2. List possible root causes (multiple candidates, with confidence);\n3. Propose triage (fix / close / redesign / wait) — a recommendation for the user, not a license to execute;\n4. Before acting, if any part rests on a guess about what the user wants, settle it with the grilling skill first;\n5. Update the issue body per the progress contract before finishing.' },
        "tpl.fix": { version: 2, placeholders: ['url'], use: '动作按钮「修复」（bug 票）', zh: '/implement\n{url}\n\n修复这个 bug（遵循 wayfinder 技能规则）：\n1. 先复现，再定位根因（修错地方 = 白修）；\n2. 实施修复；\n3. 加测试并跑通；\n4. 对抗式审查自己的改动（我会漏在哪里？）；\n5. 有假设先用 grilling 技能澄清，不默认；\n6. 结束前按进度契约更新（修复完成但未验收 → 95% · 待确认）。', en: '/implement\n{url}\n\nFix this bug (follow the wayfinder skill rules):\n1. Reproduce it first, then find the root cause (fixing the wrong spot is wasted work);\n2. Implement the fix;\n3. Add tests and get them green;\n4. Adversarially review your own change (where did I miss?);\n5. Settle assumptions with the grilling skill first, never assume;\n6. Update per the progress contract before finishing (fix done, unverified → 95% · awaiting confirmation).' },
        "tpl.discuss": { version: 2, placeholders: ['url'], use: '动作按钮「讨论」（grilling 票）', zh: '/grill-me\n{url}\n\n这个 issue 需要讨论定夺，用 grilling 技能和我对话（对话方式遵循 grilling 技能自身规则）：\n1. 讨论围绕目标 / 边界 / 风险 / 选项权衡 / 决策；\n2. 不替我做决定，等我确认结论；\n3. 讨论有结论时，把结论写进 issue 正文（或建议落成票 / 决策记录）；\n4. 结束前按进度契约更新。', en: '/grill-me\n{url}\n\nThis issue needs discussion before a decision — use the grilling skill to talk with me (follow the grilling skill own dialogue rules):\n1. Keep the discussion on goal / boundary / risks / options-tradeoffs / decision;\n2. Do not decide for me; wait for my confirmation of conclusions;\n3. When a conclusion emerges, write it into the issue body (or propose it as a ticket / decision record);\n4. Update per the progress contract before finishing.' },
        "tpl.execute": { version: 4, placeholders: ['url'], use: '动作按钮「执行」（普通票）', zh: '/wayfinder\n{url}\n\n执行这个 issue（遵循 wayfinder 技能规则）：\n1. 先认领（若未认领）；读 Description / Notes / 阻塞关系，确认它到底要交付什么；\n2. 若目标不清或需要用户定夺 → 先用 grilling 技能澄清；\n3. 制定方案 → 实施 → 按验收标准自查；\n4. 完成且通过验收 → 100% + close；未完成 → 按进度契约如实更新（含下一步）。\n若执行后关闭了该票：在所属 map 的 Decisions so far 追加一行 gist（票名 + 链接 + 一句话结论）。', en: '/wayfinder\n{url}\n\nExecute this issue (follow the wayfinder skill rules):\n1. Claim it first (if unclaimed); read Description / Notes / blocking relationships; confirm what it must deliver;\n2. If the goal is unclear or needs the user call, settle it with the grilling skill first;\n3. Plan → implement → self-check against acceptance criteria;\n4. Done and verified → 100% + close; otherwise update honestly per the progress contract (with next step).\nIf this execution closes the ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion).' },
        "tpl.handoff1": { version: 1, placeholders: ['ts'], use: '交接第一击（写交接文档）', zh: '/handoff\n\n请把当前会话生成交接文档，写到 .scratch/handoff/{ts}.md（相对当前工作目录），包含三部分：\n1. 结论：本次会话已确认的决定与成果；\n2. 未完成事项：下一步要继续的事；\n3. 建议 skill：新会话接手时建议加载的技能。\n\n从第一性原理出发完成任务，并对抗式审查。', en: '/handoff\n\nCreate a handoff doc from this session, written to .scratch/handoff/{ts}.md (relative to the current working directory), with three parts:\n1. Conclusion: decisions and outcomes confirmed this session;\n2. Unfinished: what to continue next;\n3. Suggested skills: skills the next session should load.\n\nApproach tasks from first principles, and review adversarially.' },
        "tpl.handoff2": { version: 1, placeholders: ['file'], use: '交接第二击（读交接文档）', zh: '/read .scratch/handoff/{file}\n\n请先阅读这份交接文档并复述确认理解（结论 / 未完成事项 / 建议 skill），然后从第一性原理出发完成任务，并对抗式审查。', en: '/read .scratch/handoff/{file}\n\nRead this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.' },
        "handoffRead": { version: 1, placeholders: [], use: '交接第二击兜底（无文件时）', zh: '/read .scratch/handoff/latest.md\n\n请先阅读这份交接文档并复述确认理解（结论 / 未完成事项 / 建议 skill），然后从第一性原理出发完成任务，并对抗式审查。', en: '/read .scratch/handoff/latest.md\n\nRead this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.' },
        "installSkills": { version: 1, placeholders: [], use: '技能安装引导 · DSH 专用（横幅 / 引导 g4 / 设置页复制）', zh: '请为 DSH 安装 Matt Pocock 的 skills 技能套件（mattpocock/skills）：\n1. 克隆 https://github.com/mattpocock/skills；\n2. 按官方 README 将工程领域与通用领域的全部 skills 安装到 DSH 读取的技能目录：用户主目录下的 ~/.agents/skills（本套件仅用于 DSH，不要安装到其他 AI 工具）；\n3. 安装后验证 wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills 等技能文件已就位；\n4. 完成后汇报安装结果与已装技能清单。', en: 'Install the Matt Pocock skills collection (mattpocock/skills) for DSH:\n1. Clone https://github.com/mattpocock/skills;\n2. Per the official README, install all engineering and general-purpose skills into the skill directory DSH reads: ~/.agents/skills under the user home (this collection is for DSH only — do not install it into other AI tools);\n3. After install, verify wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills are in place;\n4. Report the result and the installed skill list when done.' },
        "setupRun": { version: 6, placeholders: [], use: '环境检查横幅 · setup 未执行按钮（仅初始化，不重装技能）', zh: '/setup-matt-pocock-skills\n\n初始化本仓库（技能套件已安装，无需克隆重装）：\n1. issue tracker 选择 GitHub Issues；\n2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 GitHub Issues；triage 标签保留默认五角色），并确保仓库中技能所需标签齐全（triage 五角色 + wayfinder 标签 wayfinder:map / research / prototype / grilling / task），不要只建少数几个；后续打标签严格遵循技能规则，不额外强制任何标签；\n3. 初始化完成后复查环境检查（setup 变绿即完成）。', en: '/setup-matt-pocock-skills\n\nBootstrap this repo (the skill suite is already installed — no need to clone or reinstall):\n1. Choose GitHub Issues as the issue tracker;\n2. During init, follow the setup-matt-pocock-skills skill own flow (choose GitHub Issues as the tracker; keep the default triage-role labels), and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) — not just a few; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;\n3. After init, re-run the environment check (setup turns green when done).' },
        "newWayfinder": { version: 6, placeholders: ['repo'], use: '「+ 新建需求」按钮', zh: '/wayfinder\n请帮我处理一个需求（严格遵循 wayfinder 技能规则）。\n仓库：{repo}\n\n收到需求后按以下流程：\n1. 先澄清：对目标 / 范围 / 偏好有假设时，先用 grilling 技能澄清，不默认；\n2. 判断分类（需求 / map 维度）——先查仓库已有 wayfinder:map 和 issue，确认是否做过：\n   - 新增：全新需求，之前没做过 → 按建图规划契约新建 map（Destination + Notes + 规划表 + 票）；\n   - 复用：这个需求之前已做过（已有 map / issue）→ 打开复用它，不重复建；\n   - 直接实现：需求很小 → 建一个 issue 直接实现，不建大 map；\n3. 执行后按进度契约更新。\n\n需求描述：', en: '/wayfinder\nPlease handle a requirement (strictly follow the wayfinder skill rules).\nRepo: {repo}\n\nAfter receiving the requirement, follow this flow:\n1. Clarify first: if you hold assumptions about the goal / scope / preferences, settle them with the grilling skill, never assume;\n2. Decide the case (at the requirement / map level) — first check existing wayfinder:map and issues in the repo to confirm whether it has been done:\n   - Add: a brand-new requirement never done before → build a new map per the planning contract (Destination + Notes + plan + tickets);\n   - Reuse: this requirement has been done before (existing map / issue) → open and reuse it, do not build a new one;\n   - Directly implement: the requirement is small → create a single issue and implement it directly, no big map;\n3. Update per the progress contract after execution.\n\nRequirement: ' },
        "newBugWayfinder": { version: 3, placeholders: ['repo'], use: '「+ 新增BUG单」按钮 / 状态栏 BUG 悬停菜单「新增」（issue #4 · v2 修 #1 BUG3：输入位移到模板末尾 · v3 #14：精简为 4 字段）', zh: '/wayfinder\n请帮我新增一个 BUG 单（严格遵循 wayfinder 技能规则）。\n仓库：{repo}\n\n收到需求后按以下流程：\n1. 先澄清：对目标 / 范围 / 偏好有假设时，先用 grilling 技能澄清，不默认；\n2. 判断分类 —— 先查仓库已有 wayfinder:map 和 issue，确认是否已有相同 BUG：\n   - 全新 BUG，之前没建过 → 按下面字段把 BUG 信息填写完整，然后新建一条带 bug 标签的 ISSUE（写入 `## 进度：0%` 基准，后续按进度契约更新）；\n   - 已有相同 BUG（重复）→ 不重复建，在已有的 issue 上补全信息；\n   - 需要先讨论 / 定夺 → 用 grilling 技能与我确认；\n3. 按下面字段逐项填写 BUG 信息（每行一项，冒号后填写内容）—— 4 字段清单在 prompt 模板末尾。', en: '/wayfinder\nPlease help me file a new BUG ticket (strictly follow the wayfinder skill rules).\nRepo: {repo}\n\nAfter receiving the requirement, follow this flow:\n1. Clarify first: if you hold assumptions about the goal / scope / preferences, settle them with the grilling skill, never assume;\n2. Decide the case — first check existing wayfinder:map and issues in the repo to see whether this BUG already exists:\n   - A brand-new BUG never filed before → fill in every field below completely, then create a new ISSUE carrying the bug label (write a `## Progress: 0%` baseline, then keep it updated per the progress contract);\n   - The same BUG already exists (duplicate) → do not file a new one; complete the info on the existing issue;\n   - Needs discussion / a call → settle it with me using the grilling skill;\n3. Fill in each field below (one line per item, content after the colon) — the 4-field checklist lives at the end of the prompt template.' },
        "mapHead": { version: 1, placeholders: ['n', 'title', 'url'], use: '新会话/执行 · map 标识头（B2）', zh: '## 目标 map\n- 编号：#{n}\n- 标题：{title}\n- 链接：{url}', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}' },
        "stageGate": { version: 2, placeholders: [], use: '阶段闸门条款（T13 · 统一追加于 诊断/修复/执行/map推进 动作：needs-triage 必须先诊断并判断现状）', zh: '阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）：\n1. 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段；\n2. 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）；\n3. 诊断时判断当前进展：\n   - 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）；\n   - 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断；\n   - 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）；\n4. 诊断完成摘 needs-triage 后才允许进入实施阶段。', en: 'Stage gate (must read before starting the action — it is part of the action, not optional):\n1. First read the issue current state: progress section (## Progress: N%) / existing implementation record / comments / labels — determine which stage it is in;\n2. If it carries the needs-triage label: diagnosis MUST be completed first (a prerequisite step — do not skip straight to implementation);\n3. During diagnosis, judge current progress:\n   - Existing implementation and it is real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (move to ready-for-agent);\n   - Existing implementation but fake/partial → revise progress back to the true value (e.g. 30%) and continue diagnosing;\n   - Not started → normal diagnosis (reproduce → root cause → plan → write into the issue);\n4. Only after diagnosis is done and needs-triage removed may implementation begin.' },
      }
      // 当前语言（跟随 DSH locale 快照 active；缺省 zh）
      const promptLang = function () {
        try {
          const l = (localeSvc && typeof localeSvc.getSnapshot === 'function') ? localeSvc.getSnapshot().active : null
          return (l === 'en' || String(l || '').indexOf('en') === 0) ? 'en' : 'zh'
        } catch (e) { return 'zh' }
      }
      // 取 prompt：promptText(id) 或 promptText(id, { 占位符: 值 })
      const promptText = function (id, params) {
        const p = PROMPTS[id]
        if (!p) return ''
        let s = (promptLang() === 'en' && p.en) ? p.en : (p.zh || '')
        if (params) s = s.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m })
        return s
      }
      // 常量别名（既有引用不变）
      const GUIDE_LINE = promptText('guide')
      // v1.5 T4/T5：Matt 技能仓库（介绍卡 GitHub 链接）
      const MATT_REPO = 'https://github.com/mattpocock/skills'
      const MAP_EXECUTE_PROMPT = function () { return promptText('mapExecute') }
      const COMPLETE_PROMPT = function () { return promptText('complete') }
      // T16：正文格式契约（写/改 issue 正文的动作统一追加）
      const BODY_FORMAT = function () { return promptText('bodyFormat') }
      // v3.4（#14 2026-08-19 验收反馈）：指引紧贴填写位 —— 每字段「字段名：」行 + 下方一行「例：示例」（v3.2/3.3 独立指引块悬在表单上方被否；例行带「例：」标记，不再像内容）
      //   字段集（第一性原理：Bug = 期望 vs 实际偏差）：期望 / 实际（吸收现象+影响范围）/ 复现步骤（吸收背景+场景 preamble）/ 环境信息（新增）
      //   形态决议（v3.0 文章式 → v3.1 字段行+缩进说明 → v3.2/3.3 指引块+纯表单 → v3.4 例行紧贴字段）；zh 只中文、en 只英文，跟随 DSH 语言一次只出一种
      const NEW_BUG_FIELDS_BODY = function () { return '\n\n期望：\n  例：应发生什么 / 预期结果\n实际：\n  例：看到什么；可含影响范围\n复现步骤：\n  例：[前置 / 场景] + 编号步骤\n环境信息：\n  例：OS + 浏览器 + 插件版本' }
      // v3.4（#14）：EN locale 版 —— 每字段「字段名：」行 + 下方 "e.g." 示例行（DSH 为英文时单独输出）
      const NEW_BUG_FIELDS_BODY_EN = function () { return '\n\nExpected:\n  e.g. What should happen / expected result\nActual:\n  e.g. What actually happened; may include impact notes\nReproduction:\n  e.g. [Preamble / Scenario] + numbered steps\nEnvironment:\n  e.g. OS + browser + plugin version' }
      // v1.5：完成确认 prompt —— 技能+链接前置（/wayfinder + map 链接），再拼完成确认正文（完成 = wayfinder）
      const completePrompt = function (st, num, total, closed) {
        return '/wayfinder\n' + 'https://github.com/' + repoStr(st) + '/issues/' + String(num || '') + '\n\n' +
          COMPLETE_PROMPT().split('{n}').join(String(num || '')).split('{total}').join(String(total)).split('{closed}').join(String(closed)) +
          (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '')
      }
      const FIXATE_PROMPT = function () { return promptText('fixate') }

      const CFG_KEY = 'dsws.cfg'
      // 功能配置（用户拍板 2026-08-14：外观图标/动作词由设计定死，不提供配置项）
      // v1.4：打开位置 cfg.openIn —— 检测到 dsh-better-sidebar 已装则默认 'sidebar'，否则 'dock'；
      //   localStorage 已有值则尊重用户选择（不覆盖）
      const cfg = (function () {
        const bsInstalled = !!(ctx.get('betterSidebar') && typeof ctx.get('betterSidebar').registerTab === 'function')
        const d = { withWayfinder: true, openIn: bsInstalled ? 'sidebar' : 'dock' }
        try {
          const raw = localStorage.getItem(CFG_KEY)
          if (raw) {
            const saved = JSON.parse(raw)
            if (typeof saved.openIn === 'string') d.openIn = saved.openIn  // 用户已选过 → 尊重
            else d.openIn = bsInstalled ? 'sidebar' : 'dock'              // 首次 → 按安装情况默认
          }
          return Object.assign({ withWayfinder: true, openIn: 'dock' }, d)
        } catch (e) { /* 存储不可用用默认 */ }
        return d
      })()
      const saveCfg = function () { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch (e) {} }
      // 模板存储（T2b 扩展全部动作；T2a 先承载 execute = 旧 custom）
      const TPL_KEY = 'dsws.templates'
      const templates = (function () {
        const d = { diagnose: '', fix: '', discuss: '', execute: '', handoff1: '', handoff2: '', fixate: '' }
        try {
          const raw = localStorage.getItem(TPL_KEY)
          if (raw) return Object.assign(d, JSON.parse(raw))
        } catch (e) { /* 存储不可用用默认 */ }
        return d
      })()
      const saveTemplates = function () { try { localStorage.setItem(TPL_KEY, JSON.stringify(templates)) } catch (e) {} }
      // 迁移：旧 dsws.startCfg（{withWayfinder, custom}）→ cfg.withWayfinder + templates.execute，成功后清旧 key
      const migrateStartCfg = function () {
        try {
          const raw = localStorage.getItem('dsws.startCfg')
          if (!raw) return
          const old = JSON.parse(raw)
          if (old && typeof old === 'object') {
            if (typeof old.withWayfinder === 'boolean') cfg.withWayfinder = old.withWayfinder
            if (typeof old.custom === 'string' && old.custom) templates.execute = old.custom
            saveCfg(); saveTemplates()
          }
          localStorage.removeItem('dsws.startCfg')
        } catch (e) { /* 迁移失败保留旧 key，下次再试 */ }
      }
      migrateStartCfg()

      // ---- v25 · T2b：动作模板引擎（T1 规格 §2-§4）----
      // 占位符全集：{url} {number} {title} {ts} {file}（引导句是普通静态文本，不是占位符）
      const PH = ['url', 'number', 'title', 'ts', 'file']
      // 各模板可用占位符（编辑器 chips 展示）
      const TPL_PH = {
        diagnose: ['url'], fix: ['url'], discuss: ['url'], execute: ['number', 'url', 'title'],
        handoff1: ['ts'], handoff2: ['file'], fixate: [],
      }
      // 强制占位符表（T1 规格 §3）：缺失拒绝保存
      const TPL_REQUIRED = {
        diagnose: ['url'], fix: ['url'], discuss: ['url'], execute: ['url'],
        handoff1: ['ts'], handoff2: ['file'], fixate: [],
      }
      // 默认模板文本（空 = 用默认；T1 规格 §3 默认文本 = 现状代码文本）
      const TPL_DEFAULT = {
        // T4 #9-12：4 个动作按钮 prompt 明确化
        diagnose: function () { return promptText('tpl.diagnose') },
        fix: function () { return promptText('tpl.fix') },
        discuss: function () { return promptText('tpl.discuss') },
        execute: function () { return promptText('tpl.execute') },
        handoff1: function () { return promptText('tpl.handoff1') },
        handoff2: function () { return promptText('tpl.handoff2') },
        fixate: function () { return promptText('fixate') },
      }
      const tplText = (id) => templates[id] || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : '')
      // 渲染：转义 {{x}} → 字面 {x}（先替换哨兵防误替换），再替换已知占位符；未知占位符保留原样（保存层已拦截）
      // T13 修订：阶段闸门统一追加 —— 诊断/修复/执行 三类动作**末尾**拼 stageGate（技能命令+链接保持开头，自定义模板也生效，免疫覆盖）
      const STAGE_GATED_IDS = ['diagnose', 'fix', 'execute']
      const renderTemplate = function (id, values) {
        let text = String(tplText(id))
        if (STAGE_GATED_IDS.indexOf(id) >= 0) {
          const gate = promptText('stageGate')
          if (gate) text = text + '\n\n' + gate
        }
        const esc = []
        text = text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, function (m, name) { esc.push('{' + name + '}'); return '\u0001' + (esc.length - 1) + '\u0001' })
        text = text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, function (m, name) {
          return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : m
        })
        esc.forEach(function (s, i) { text = text.replace('\u0001' + i + '\u0001', s) })
        return text
      }
      // 校验：转义预处理 → 未知占位符检测 → 强制占位符缺失检测（T1 规格 §4 顺序）
      const validateTemplate = function (id, text) {
        const found = []
        const scrubbed = String(text || '').replace(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g, '')
        const re = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
        let m
        while ((m = re.exec(scrubbed)) !== null) found.push(m[1])
        const unknown = []
        found.forEach(function (n) { if (PH.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n) })
        const missing = []
        ;(TPL_REQUIRED[id] || []).forEach(function (n) { if (found.indexOf(n) < 0 && missing.indexOf(n) < 0) missing.push(n) })
        return { ok: unknown.length === 0 && missing.length === 0, unknown: unknown, missing: missing }
      }
      const fixateText = () => tplText('fixate')

      // ============================================================
      // 3. store（v14：按会话隔离；无 sid 时用 shared）
      // ============================================================
      // v24-48：面板默认高度 = 屏幕约 1/2
      // v1.5 T3：面板默认高度固定 1/2（用户拍板彻底移除 panelHeight 配置 —— details 列高度与它无关，配置不生效）
      const DEFAULT_PANEL_H = (function () {
        try { return Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) } catch (e) { return 400 }
      })()
      // #374：主列表偏好（排序/状态过滤）持久化（localStorage 不可用时降级默认值）
      const LIST_PREFS_KEY = 'dsws.listPrefs'
      const listPrefs = (function () {
        const d = { sortKey: 'number', sortDir: 'asc', stateFilter: 'all' }
        try {
          const raw = localStorage.getItem(LIST_PREFS_KEY)
          if (raw) return Object.assign(d, JSON.parse(raw))
        } catch (e) { /* 存储不可用用默认 */ }
        return d
      })()
      const saveListPrefs = function () { try { localStorage.setItem(LIST_PREFS_KEY, JSON.stringify(listPrefs)) } catch (e) {} }
      // #375：label 点击记忆（次数 + 最近点击时间，双键排序）
      const LABEL_CLICKS_KEY = 'dsws.labelClicks'
      const labelClicks = (function () {
        try {
          const raw = localStorage.getItem(LABEL_CLICKS_KEY)
          if (raw) { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {} }
        } catch (e) { /* 存储不可用降级纯频次 */ }
        return {}
      })()
      const saveLabelClicks = function () { try { localStorage.setItem(LABEL_CLICKS_KEY, JSON.stringify(labelClicks)) } catch (e) {} }
      // T2 #35 · 无仓库红卡状态机（按 cwd 维度持久化 dismiss；表单态 expanded/name/visibility/loading/error）
      const NOREPO_DISMISS_PREFIX = 'dsws:noRepoDismiss:'
      const cwdHash = function (s) { let h = 0; const t = String(s || ''); for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0; return String(h >>> 0) }
      const noRepoDismissKey = function (cwd) { return NOREPO_DISMISS_PREFIX + cwdHash(cwd || '') }
      const isNoRepoDismissed = function (cwd) { try { return localStorage.getItem(noRepoDismissKey(cwd)) === '1' } catch (e) { return false } }
      const setNoRepoDismissed = function (cwd, v) { try { if (v) localStorage.setItem(noRepoDismissKey(cwd), '1'); else localStorage.removeItem(noRepoDismissKey(cwd)) } catch (e) {} }
      const cwdBasename = function (cwd) { if (!cwd) return 'repo'; const parts = String(cwd).split(/[\\/]/); for (let i = parts.length - 1; i >= 0; i--) if (parts[i]) return parts[i]; return 'repo' }
      const isNoRepoNameValid = function (name) { return typeof name === 'string' && name.length >= 1 && name.length <= 100 && /^[A-Za-z0-9._-]+$/.test(name) }
      const ensureNoRepoCard = function (st) {
        if (!st.noRepoCard) st.noRepoCard = { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' }
        if (!st.noRepoCard.visibility) st.noRepoCard.visibility = 'private'
        if (st.noRepoCard.errorRepoUrl === undefined) st.noRepoCard.errorRepoUrl = ''
        return st.noRepoCard
      }
      const makeStore = () => ({
        open: false, tab: 'list', activeMap: null,
        notice: null, injector: null, tick: 0,
        pos: null, size: { w: 460, h: DEFAULT_PANEL_H },
        // 外观定死（用户拍板：图标/动作词不可配置）
        ui: { icon: 'compass', word: '沉淀' },
        snapshot: null,
        cwd: '', lblFilters: [], skillView: 'list', expLabels: false,
        // #374：状态过滤 + 排序（默认 更新时间↓，与现状一致）
        stateFilter: listPrefs.stateFilter, sortKey: listPrefs.sortKey, sortDir: listPrefs.sortDir,
        checks: null, checksUpdatedAt: '', checksMode: 'loading', checksError: null, checking: false,
        snapMode: 'loading', snapError: null, snapLoading: false,
        refreshing: false, rowFlash: {}, issueFlash: {}, handoffReady: false, skillsOpen: false, skillHover: null, skillTip: null, bugMenuOpen: false, bugMenuHover: false, bugMenuPos: null, skillPopPos: null, expTags: {}, subs: [],
        noRepoCard: { expanded: false, name: '', visibility: 'private', loading: false, error: '', errorKind: '', errorRepoUrl: '' },
      })
      const shared = makeStore()
      const stores = {}
      // #58 缓存优先：按 cwd 的内存快照表（新 store 秒开 + 跨会话同 cwd 共享，避免空 cwd 探路 miss）
      const snapshotByCwd = {}
      const getCachedSnapshot = function (cwd) { return cwd ? snapshotByCwd[cwd] : null }
      const setCachedSnapshot = function (cwd, snap) { if (cwd && snap && snap.ok === true && Array.isArray(snap.maps)) snapshotByCwd[cwd] = snap }
      const hydrateFromCache = function (st) {
        if (!st || !st.cwd) return false
        const c = getCachedSnapshot(st.cwd)
        if (!c) return false
        if (!st.snapshot || c.generatedMs !== st.snapshot.generatedMs) {
          st.snapshot = c
          st.snapMode = 'real'
          st.snapError = null
          st.snapLoading = false
          return true
        }
        if (st.snapMode !== 'real') {
          st.snapMode = 'real'
          st.snapError = null
          return true
        }
        return false
      }
          const getCwdSync = function (sid) {
      try {
        const sessions = ctx.get('sessions')
        if (sessions && sid) {
          try {
            if (sessions.list && typeof sessions.list.getSnapshot === 'function') {
              const snap = sessions.list.getSnapshot()
              const row = snap && snap.byId && snap.byId[sid]
              if (row && typeof row.cwd === 'string' && row.cwd) return row.cwd
            }
          } catch (e2) {}
          if (typeof sessions.get === 'function') {
            const s = sessions.get(sid)
            if (s) {
              const header = s.header || s.meta
              const cwd = header && (header.cwd || header.path || header.worktree || header.projectDir || header.directory)
              if (typeof cwd === 'string' && cwd) return cwd
              const meta = s.meta
              const cwd2 = meta && (meta.cwd || meta.path || meta.worktree || meta.projectDir || meta.directory)
              if (typeof cwd2 === 'string' && cwd2) return cwd2
              if (typeof s.cwd === 'string' && s.cwd) return s.cwd
            }
          }
        }
      } catch (e) { /* 忽略 */ }
      return ''    }
      const storeOf = (sid) => {
        if (!sid) return shared
        let st = stores[sid]
        if (!st) {
          st = makeStore(); st.sessionId = sid; stores[sid] = st
          if (!st.cwd) {
            const sync = getCwdSync(sid)
            if (sync) st.cwd = sync
          }
          if (st.cwd) hydrateFromCache(st)
        } else {
          if (!st.cwd) {
            const sync = getCwdSync(sid)
            if (sync) { st.cwd = sync; hydrateFromCache(st) }
          }
        }
        return st
      }
      const emit = (st) => { st.tick++; (st.subs || []).forEach(function (f) { f(st.tick) }) }
      const sub = (st, f) => { st.subs.push(f); return () => { const i = st.subs.indexOf(f); if (i >= 0) st.subs.splice(i, 1) } }
      const useStore = (sid) => {
        const st = storeOf(sid)
        const [, set] = React.useState(0)
        React.useEffect(() => sub(st, (n) => set(n)), [st])
        return st
      }
      const NOTICE_COLOR = { ok: '#4ade80', warn: '#fbbf24', info: '#a1a1aa' }
      const noticeIcon = (k) => k === 'ok' ? 'check' : k === 'warn' ? 'alert' : 'clipboard'
      const flash = (st, msg, kind) => {
        st.notice = { text: msg, kind: kind || 'info' }; emit(st)
        later(function () { if (st.notice && st.notice.text === msg) { st.notice = null; emit(st) } }, 2800)
      }

      // 派生：票务分组（frontier/claimed/blocked/closed）
      const compute = (st) => {
        const maps = (st.snapshot && Array.isArray(st.snapshot.maps)) ? st.snapshot.maps : []
        return maps.map(function (m) {
          const byNum = {}; m.tickets.forEach(function (t) { byNum[t.number] = t })
          const openBlocker = (b) => { const t = byNum[b]; return t !== undefined && t.state === 'OPEN' }
          const open = m.tickets.filter(function (t) { return t.state === 'OPEN' })
          const closed = m.tickets.filter(function (t) { return t.state === 'CLOSED' })
          const frontier = open.filter(function (t) { return !t.claimedBy && !t.blockedBy.some(openBlocker) })
          const claimed = open.filter(function (t) { return t.claimedBy })
          const blocked = open.filter(function (t) { return !t.claimedBy && t.blockedBy.some(openBlocker) })
          return { m: m, open: open, closed: closed, frontier: frontier, claimed: claimed, blocked: blocked }
        })
      }
      const frontierAll = (st) => compute(st).reduce(function (n, g) { return n + g.frontier.length }, 0)

      // v18-30：状态栏可接/占用改用「列表 open issue」口径（与面板列表一致）：
      //   可接 = open issue 中未认领且未被 open 阻塞；占用 = 已认领 + 被阻塞；两者之和 = 全部 open issue
      const openIssuesOf = (st) => ((st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []).filter(function (x) { return x.state !== 'CLOSED' })
      const isOccupied = function (st, x) {
        if (x.assignees && x.assignees.length) return true
        const maps = (st.snapshot && st.snapshot.maps) || []
        for (let mi = 0; mi < maps.length; mi++) {
          const m = maps[mi]
          if (!m.tickets || !m.tickets.length) continue
          const byNum = {}
          m.tickets.forEach(function (t) { byNum[t.number] = t })
          const t = byNum[x.number]
          if (t && t.blockedBy && t.blockedBy.length) {
            const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
            if (openBlockers.length) return true
          }
        }
        return false
      }
      const occCount = (st) => openIssuesOf(st).filter(function (x) { return isOccupied(st, x) }).length
      const frontierCount = (st) => openIssuesOf(st).length - occCount(st)
      // v1.5 T1：BUG / 诊断计数（open 且带对应标签，与「可接」同口径）
      const hasLabelOf = function (x, nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const bugCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'bug') }).length
      const triageCount = (st) => openIssuesOf(st).filter(function (x) { return hasLabelOf(x, 'needs-triage') }).length

      // v19：共享 —— 标签配置色映射（从快照 issues 收集 GitHub label 配置色，动态查询非写死）
      const buildColorOf = function (st) {
        const colorOf = {}
        const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
        issues.forEach(function (x) {
          (x.labels || []).forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
        })
        return colorOf
      }
    // T9：行级动作主色计算（与 mkRowAction 共享 · 给新会话按钮复用：与执行按钮同 label 主色）
    const isLightHex = function (hex) {
      try {
        const hh = String(hex || '').replace('#', '')
        if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
        const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
        return (299 * r + 587 * g + 114 * b) / 1000 > 160
      } catch (e) { return false }
    }
    const actionColorOf = function (x, colorOf) {
      const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
      const bc = function (nm, fb) { const cc = colorOf[nm]; return cc ? '#' + cc : fb }
      if (has('needs-triage')) return bc('needs-triage', '#f59e0b')
      if (has('bug')) return bc('bug', '#f87171')
      if (has('wayfinder:grilling')) return bc('wayfinder:grilling', '#d93f0b')
      return '#c084fc'
    }
    // #361：行级动作注入文本的单一真源（诊断/修复/讨论/执行）—— 新会话打开与行内动作共用
      const rowActionText = function (st, x) {
        const url = 'https://github.com/' + repoStr(st) + '/issues/' + x.number
        const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
        if (has('needs-triage')) return renderTemplate('diagnose', { url: url })
        if (has('bug')) return renderTemplate('fix', { url: url })
        if (has('wayfinder:grilling')) return renderTemplate('discuss', { url: url })
        return startText(st, x)
      }
      // v19：共享 —— 行级动作（列表与 map 详情共用）：按 label 四选一（诊断/修复/讨论/执行），预填输入框；
      // 按钮主体色 = 对应 label 的 GitHub 配置色（YIQ 感知亮度定文字色）
      const mkRowAction = function (st, x, narrow, colorOf) {
        const url = 'https://github.com/' + repoStr(st) + '/issues/' + x.number
        const has = function (nm) { return (x.labels || []).some(function (l) { return (typeof l === 'string') ? l === nm : l.name === nm }) }
        const isLight = function (hex) {
          try {
            const hh = String(hex || '').replace('#', '')
            if (!/^[0-9a-fA-F]{6}$/.test(hh)) return false
            const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
            return (299 * r + 587 * g + 114 * b) / 1000 > 160
          } catch (e) { return false }
        }
        const btnColor = function (nm, fb) { const c = colorOf[nm]; return c ? '#' + c : fb }
        const mk = (icon, label, text, colorHex) => {
          const light = isLight(colorHex)
          return h('button', {
            className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''),
            onClick: function (e) { e.stopPropagation(); inject(st, text) },
            style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: colorHex, borderColor: 'transparent', color: light ? '#140a1e' : '#ffffff' },
            title: label,
          }, [Ic({ n: icon, size: 10 }), narrow ? null : h('span', null, label)])
        }
        // v21：技能命令 + URL + 统一引导句（不再重复灌输技能内部流程）
        // v25 · T2b：诊断/修复/讨论走模板渲染（用户可自定义静态文本，{url} 注入）
        if (has('needs-triage')) return mk('chat', tr('act.diagnose'), rowActionText(st, x), btnColor('needs-triage', '#f59e0b'))
        if (has('bug')) return mk('hammer', tr('act.fix'), rowActionText(st, x), btnColor('bug', '#f87171'))
        if (has('wayfinder:grilling')) return mk('chat', tr('act.discuss'), rowActionText(st, x), btnColor('wayfinder:grilling', '#d93f0b'))
        return mk('play', tr('act.execute'), rowActionText(st, x), '#c084fc')
      }
      // v19：交接文档时间戳文件名（YYYYMMDD-HHMMSS）
      const timeStampStr = () => {
        try {
          const d = new Date()
          const p = function (n) { return String(n).padStart(2, '0') }
          return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
        } catch (e) { return 'latest' }
      }

      // ---- 环境检查（#344 · rpcCall('status')；host 侧 30s 缓存 / force 重查）----
      // v12：失败不再兜假数据 —— 非 real 状态一律视为未知（--/8），不展示假绿点
      const CHECKS_TOTAL = 9   // v1.5 T11 起 9 项检测（含核心技能套件）
      const loadChecks = (st, force, silent) => {
        if (st.checking) return Promise.resolve()
        if (conn === undefined || conn.rpc === undefined) {
          st.checksMode = 'err'
          st.checksError = tr('err.hostUnavailable')
          emit(st)
          return Promise.resolve()
        }
        st.checking = true
        // v1.5 T10 R7：silent（手动刷新走静默路径）不切 loading 态
        if (force && !silent) st.checksMode = 'loading'
        emit(st)
        const args = Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, force ? { force: true } : {}, { lang: promptLang() })
        return rpcCall('status', args).then(function (res) {
          st.checking = false
          if (res && res.checks && res.checks.length) {
            st.checks = res.checks
            st.checksUpdatedAt = nowStr()
            st.checksMode = 'real'
            st.checksError = null
          } else {
            st.checksMode = 'err'
            st.checksError = (res && res.error) ? String(res.error).slice(0, 160) : tr('err.statusEmpty')
          }
          emit(st)
        }).catch(function (e) {
          st.checking = false
          st.checksMode = 'err'
          st.checksError = String((e && e.message) || e).slice(0, 160)
          emit(st)
        })
      }
      const activeChecks = (st) => (st.checksMode === 'real' && st.checks && st.checks.length) ? st.checks : []
      const readyCount = (st) => { const cs = activeChecks(st); return cs.length ? cs.filter(function (c) { return c.level === 'ok' }).length : -1 }
      // v14-22：返回纯数字串（'6/9' / '--/9'），由状态栏 num() 固定宽度渲染；分母 = 实际检查项数（动态，不再硬编码）
      const envTotal = (st) => { const cs = activeChecks(st); return cs.length || CHECKS_TOTAL }
      const envLabel = (st) => { const n = readyCount(st); const t = envTotal(st); return n < 0 ? '--/' + t : n + '/' + t }
      const setupCheck = (st) => (st.checks || []).find(function (c) { return c.id === 2 })

      // #370：blockerNames 只列「仍 OPEN」的阻塞者（GitHub 依赖边在阻塞者关闭后仍保留，需按状态过滤）
      const openBlockers = (t, m) => t.blockedBy.filter(function (b) {
        const bt = m.tickets.find(function (x) { return x.number === b })
        return bt !== undefined && bt.state === 'OPEN'
      })
      const blockerNames = (t, m) => openBlockers(t, m).map(function (b) {
        const bt = m.tickets.find(function (x) { return x.number === b })
        return bt ? bt.title : ('#' + b)
      }).join('；')

      // v10：从会话快照探测当前工作目录（ConversationSnapshot 字段名多探几个）
      const detectCwd = function (ss) {
        try {
          if (ss && typeof ss === 'object') {
            for (const k of ['cwd', 'workspacePath', 'projectPath', 'path', 'dir', 'root']) {
              if (typeof ss[k] === 'string' && ss[k]) return ss[k]
            }
          }
        } catch (e) { /* 探测失败走 host 默认 */ }
        return ''
      }
      // v11：label 用 GitHub 配置色渲染 —— hex → rgba（.18 背景），无效 hex 返回 null 走兜底
      const hexA = function (hex, a) {
        try {
          const hh = String(hex || '').replace('#', '')
          if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
          const r = parseInt(hh.slice(0, 2), 16), g = parseInt(hh.slice(2, 4), 16), b = parseInt(hh.slice(4, 6), 16)
          return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
        } catch (e) { return null }
      }
      // v14-18：hex → HSL 亮度下调 amt（0-1）→ hex（chips 边框比 label 色深一档）
      const darken = function (hex, amt) {
        try {
          const hh = String(hex || '').replace('#', '')
          if (!/^[0-9a-fA-F]{6}$/.test(hh)) return null
          const r = parseInt(hh.slice(0, 2), 16) / 255, g = parseInt(hh.slice(2, 4), 16) / 255, b = parseInt(hh.slice(4, 6), 16) / 255
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
          const l = (mx + mn) / 2
          let hue = 0, sat = 0
          if (mx !== mn) {
            const d = mx - mn
            sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
            if (mx === r) hue = ((g - b) / d + (g < b ? 6 : 0))
            else if (mx === g) hue = ((b - r) / d + 2)
            else hue = ((r - g) / d + 4)
            hue *= 60
          }
          const l2 = Math.max(0, l - amt)
          const hue2rgb = function (p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p }
          const q2 = l2 < 0.5 ? l2 * (1 + sat) : l2 + sat - l2 * sat
          const p2 = 2 * l2 - q2
          const rr = Math.round(hue2rgb(p2, q2, hue / 360 + 1 / 3) * 255)
          const gg = Math.round(hue2rgb(p2, q2, hue / 360) * 255)
          const bb = Math.round(hue2rgb(p2, q2, hue / 360 - 1 / 3) * 255)
          return '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1)
        } catch (e) { return null }
      }

      // ============================================================
      // 4. 文本生成 + 复制/注入
      // ============================================================
      const nowStr = () => {
        try { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch (e) { return '' }
      }
      // 定稿 1A：时间固定格式 MM-DD HH:MM（本地）
      const timeOf = (snap) => {
        if (!snap) return ''
        try {
          const ms = (typeof snap.generatedMs === 'number' && snap.generatedMs) || Date.parse(snap.updatedAt || '')
          if (!ms) return ''
          const d = new Date(ms)
          return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
        } catch (e) { return '' }
      }
      // ============================================================
      // 4. 配置广播（v25-50：配置保存后同步所有会话 store 的面板尺寸；外观定死不广播）
      // ============================================================
      const broadcastCfg = function () {
        const applyTo = function (st) {
          if (!st) return
          st.size = { w: st.size ? st.size.w : 460, h: Math.max(240, Math.round((window.innerHeight || 800) * 0.5)) }
          emit(st)
        }
        applyTo(shared)
        Object.keys(stores).forEach(function (k) { applyTo(stores[k]) })
      }

      // v1.5 T10 R4（用户拍板）：数据层增量 diff —— 变更/新增/删除 按票号对比（含 map 子票级变化），
      //   多视图（列表/map详情/状态栏计数/过滤结果）数据驱动自动增量；diff 结果供 R5 视觉消费
      const diffSnapshots = function (oldS, newS) {
        const out = { added: [], removed: [], changed: [], issueFlash: {}, ts: Date.now() }
        if (!oldS || !oldS.ok || !Array.isArray(oldS.maps)) return out
        if (!newS || !newS.ok || !Array.isArray(newS.maps)) return out
        const lbl = function (x) { return (x.labels || []).map(function (l) { return typeof l === 'string' ? l : l.name }).sort().join(',') }
        const idx = function (snap) { const m = {}; snap.maps.forEach(function (x) { m[x.number] = x }); return m }
        const a = idx(oldS), b = idx(newS)
        // 子票级变化：逐票对比（新增/变更标 issueFlash；任一变化 → 该 map 计入 changed，map 详情视图增量）
        //   字段实证（#458 核验）：map 子票在快照里是 tickets（非 issues）；票级变化 = state/progress/claimedBy/labels
        Object.keys(b).forEach(function (n) {
          if (!a[n]) { out.added.push(Number(n)); return }
          var x = a[n], y = b[n]
          var sub = false
          var ix = {}; (x.tickets || []).forEach(function (i) { ix[i.number] = i })
          var iy = {}; (y.tickets || []).forEach(function (i) { iy[i.number] = i })
          Object.keys(iy).forEach(function (k) {
            if (!ix[k]) { sub = true; out.issueFlash[Number(k)] = 'added'; return }
            var a2 = ix[k], b2 = iy[k]
            if (a2.state !== b2.state || a2.progress !== b2.progress || a2.claimedBy !== b2.claimedBy || lbl(a2) !== lbl(b2)) { sub = true; out.issueFlash[Number(k)] = 'changed' }
          })
          if (Object.keys(ix).length !== Object.keys(iy).length) sub = true
          if (x.state !== y.state || x.title !== y.title || lbl(x) !== lbl(y) || sub) out.changed.push(Number(n))
        })
        Object.keys(a).forEach(function (n) { if (!b[n]) out.removed.push(Number(n)) })
        return out
      }
      // R5：高亮定时清除（防堆积；一次只排一个 timer）
      let _flashClearPending = false
      const scheduleFlashClear = function (st) {
        if (_flashClearPending) return
        _flashClearPending = true
        if (timer === undefined) { _flashClearPending = false; return }
        timer.timeout(function () {
          _flashClearPending = false
          st.rowFlash = {}
          st.issueFlash = {}
          emit(st)
        }, 2600)
      }
      // 快照（#346：面板数据源；force 走 wf.refresh 全量重建；wf.snapshot 侧 5s 缓存）
      // #58 缓存优先：按 cwd 内存快照 + 空 cwd 同步，避免首开空 cwd 探路 miss 缓存导致 100-400ms 闪 loading
      const loadSnapshot = function (st, force, silent) {
        const doLoad = function () {
          // #370 次要观察：force 刷新时跳过 snapLoading 守卫（加载中点击「刷新」不再 no-op）
          if (st.snapLoading && !force) return Promise.resolve()
          if (conn === undefined || conn.rpc === undefined) {
            st.snapMode = 'err'
            st.snapError = tr('err.hostUnavailable')
            emit(st)
            return Promise.resolve()
          }
          // #58 先水合 per-cwd 缓存，实现秒开
          hydrateFromCache(st)
          const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
          st.snapLoading = true
          // v1.5 T9：silent（后台静默刷新）不显示加载遮罩、不弹错误 toast
          // #58 缓存优先：已有缓存时不显示全屏 loading，静默刷新
          if (force && !silent && !hasCache) st.snapMode = 'loading'
          emit(st)
          const args = st.cwd ? { cwd: st.cwd } : {}
          const p = force ? rpcCall('refresh', args) : rpcCall('snapshot', args)
          return p.then(function (snap) {
            st.snapLoading = false
            if (snap && snap.ok === true && Array.isArray(snap.maps)) {
              // v1.5 T10 R4：数据层增量 diff（新旧快照对比）—— 供多视图增量与 R5 视觉
              st.lastDiff = diffSnapshots(st.snapshot, snap)
              st.rowFlash = {}
              st.issueFlash = {}
              var _df = st.lastDiff
              _df.added.forEach(function (n) { st.rowFlash[n] = 'added' })
              _df.changed.forEach(function (n) { st.rowFlash[n] = 'changed' })
              if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (k) { st.issueFlash[Number(k)] = _df.issueFlash[k] })
              // R5 视觉：有变化才提示 + 定时清除高亮（防堆积）
              if (_df.removed.length) flash(st, tr('panel.diffRemoved', { n: _df.removed.length }), 'info')
              scheduleFlashClear(st)
              st.snapshot = snap
              st.snapMode = 'real'
              st.snapError = null
              try { const c = snap.repoRoot || st.cwd; if (c) setCachedSnapshot(c, snap) } catch (e) { /* 忽略 */ }
              try { if (st.cwd) setCachedSnapshot(st.cwd, snap) } catch (e) { /* 忽略 */ }
              // v1.5 T10：启动自动变化探测（幂等；快照就绪后生效）
              startAutoProbe()
              // v1.5 B5 修订：磁盘缓存秒开（fromCache）→ 不再 400ms 强制全量刷新（原每次打开面板 = 1 次额外 wf.refresh ≈ 18 GraphQL 点，多仓库成倍放大）；变化检测由低频 probe 接管
            } else {
              st.snapMode = 'err'
              st.snapError = (snap && snap.error) ? String(snap.error).slice(0, 160) : tr('err.snapshotEmpty')
              if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
            }
            emit(st)
          }).catch(function (e) {
            st.snapLoading = false
            st.snapMode = 'err'
            st.snapError = String((e && e.message) || e).slice(0, 160)
            if (force && !silent) flash(st, tr('toast.snapFail', { err: st.snapError }), 'warn')
            emit(st)
          })
        }
        if (!st.cwd) {
          const sync = getCwdSync(st.sessionId)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        }
        if (!st.cwd && st.sessionId && typeof conn !== 'undefined' && conn.rpc !== undefined) {
          return rpcCall('cwd', { sessionId: st.sessionId }).then(function (res) {
            if (res && res.ok && res.cwd && !st.cwd) { st.cwd = res.cwd; hydrateFromCache(st); emit(st) }
            return doLoad()
          }).catch(function () { return doLoad() })
        }
        return doLoad()
      }

      // v1.5 R2（#2 MVP · 2026-08-18）：自动刷新 — probe 走 since 时间戳探测全 issue 增量
      //   （#348 + v1.5 T10 B5「配额止血 · 第一性原理」延续）：① probe 降到 60s（用户感知阈值 · R1 是 5min）；
      //   ② changed 只刷新与本次探测 cwd 相同的 store（多仓库会话并发不互串）；
      //   ③ focus 触发限流 ≥60s（窗口来回切换不再疯狂烧）。
      //   与 R1 区别：probe 范围从 `labels=wayfinder:map`（仅地图）扩到 `since=<ISO>`（全 issue，含子票）—— 见 host 侧 `case 'probe'`。
      const PROBE_MS = 60000
      const FOCUS_PROBE_MIN_MS = 60000
      let lastFocusProbe = 0
      // v1.5 T10 R9（Q4 拍板 · DESIGN.md 12.2）：关键动作后延迟探测 —— 完成/执行/交接后面板尽快反映 GitHub 变化；
      //   防抖（一次只排一个）+ 探测本身 1 次轻量 REST，配额安全
      let _actionProbePending = false
      const probeNow = function (fromFocus) {
        if (conn === undefined || conn.rpc === undefined) return
        if (fromFocus) {
          const now = Date.now()
          if (now - lastFocusProbe < FOCUS_PROBE_MIN_MS) return
          lastFocusProbe = now
        }
        // #45 修复（2026-08-20）：多工作区异步回调导致右侧面板串台
        // 根因：原实现经 shared（单例）广播新快照到所有 stores（Object.keys(stores).forEach），且 shared.cwd 仅首写，
        //   导致工作区 A 的异步变更（probe changed）把 A 的快照写入 B 的 store，右侧面板“串台”显示非当前工作区内容。
        // 修复：按 cwd 分组隔离 —— 同 cwd 组内共享 1 次 GraphQL（primary load → 余下拷贝），组间零污染；
        //   兜底路径按 sessionId→cwd 精确映射赋值，避免把任意首个 cwd 错绑到所有空 store。
        const refreshGroup = function (cwd) {
          return rpcCall('probe', { cwd: cwd }).then(function (res) {
            if (!(res && res.ok && res.changed)) return
            const group = []
            if (shared.cwd === cwd) group.push(shared)
            Object.keys(stores).forEach(function (k) {
              const st = stores[k]
              if (st.cwd === cwd) group.push(st)
            })
            if (!group.length) {
              if (typeof conn !== 'undefined' && conn.rpc !== undefined) {
                rpcCall('refresh', { cwd: cwd }).catch(function () {})
              }
              return
            }
            const primary = group[0]
            if (!primary.cwd) primary.cwd = cwd
            const rest = group.slice(1)
            return loadSnapshot(primary, true, true).then(function () {
              const newSnap = primary.snapshot
              if (!newSnap || newSnap.ok !== true || !Array.isArray(newSnap.maps)) return
              rest.forEach(function (st2) {
                st2.lastDiff = diffSnapshots(st2.snapshot, newSnap)
                st2.rowFlash = {}
                st2.issueFlash = {}
                var _df = st2.lastDiff
                _df.added.forEach(function (n) { st2.rowFlash[n] = 'added' })
                _df.changed.forEach(function (n) { st2.rowFlash[n] = 'changed' })
                if (_df.issueFlash) Object.keys(_df.issueFlash).forEach(function (ki) { st2.issueFlash[Number(ki)] = _df.issueFlash[ki] })
                st2.snapshot = newSnap
                st2.snapMode = 'real'
                st2.snapError = null
                scheduleFlashClear(st2)
                emit(st2)
              })
            }).catch(function () { /* 忽略 */ })
          }).catch(function () { /* 探测失败忽略 */ })
        }
        const cwds = []
        if (shared.cwd) cwds.push(shared.cwd)
        Object.keys(stores).forEach(function (k) {
          const c = stores[k] && stores[k].cwd
          if (c && cwds.indexOf(c) < 0) cwds.push(c)
        })
        if (!cwds.length) {
          const sids = []
          if (shared.sessionId) sids.push(shared.sessionId)
          Object.keys(stores).forEach(function (k) { if (stores[k].sessionId && sids.indexOf(stores[k].sessionId) < 0) sids.push(stores[k].sessionId) })
          if (!sids.length) return
          Promise.all(sids.map(function (sid) { return rpcCall('cwd', { sessionId: sid }).catch(function () { return null }) })).then(function (results) {
            const sidToCwd = {}
            const foundCwds = []
            for (let i = 0; i < sids.length; i++) {
              const r = results[i]
              if (r && r.ok && r.cwd) {
                sidToCwd[sids[i]] = r.cwd
                if (foundCwds.indexOf(r.cwd) < 0) foundCwds.push(r.cwd)
              }
            }
            if (!foundCwds.length) return
            Object.keys(stores).forEach(function (k) {
              const st = stores[k]
              if (!st.cwd && st.sessionId && sidToCwd[st.sessionId]) {
                st.cwd = sidToCwd[st.sessionId]
                if (hydrateFromCache(st)) emit(st)
              }
            })
            if (!shared.cwd && foundCwds.length) {
              shared.cwd = foundCwds[0]
              if (hydrateFromCache(shared)) emit(shared)
            }
            foundCwds.forEach(function (cwd) { refreshGroup(cwd) })
          })
          return
        }
        cwds.forEach(function (cwd) { refreshGroup(cwd) })
      }
      const scheduleActionProbe = function () {
        if (_actionProbePending) return
        _actionProbePending = true
        if (timer === undefined) { _actionProbePending = false; return }
        timer.timeout(function () {
          _actionProbePending = false
          probeNow(false)
        }, 8000)
      }
      const startAutoProbe = function () {
        if (shared._probeTimer) return
        // v1.5 R2-fix：跨 reload 清理旧 timer（dev_reload_package 后 JS setInterval 不自动清理，
        //   多个 timer 并行触发 probe 浪费配额）
        if (typeof globalThis !== 'undefined' && globalThis.__dswsOldProbeTimer) {
          try { clearInterval(globalThis.__dswsOldProbeTimer) } catch (e) { /* 忽略 */ }
          globalThis.__dswsOldProbeTimer = null
        }
        shared._probeTimer = setInterval(function () { probeNow(false) }, PROBE_MS)
        if (typeof globalThis !== 'undefined') globalThis.__dswsOldProbeTimer = shared._probeTimer
        if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', function () { probeNow(true) })
      }

      // v1.5 T10 R7（用户拍板）：手动刷新（状态栏「更新」/ 列表「刷新」/ 检查页「重新检查」）
      //   走静默路径 —— 无全屏遮罩、不禁点；按钮 spinner 即时反馈（命令式 DOM 直操作，不等 React 重渲染）
      //   CSS 动画走合成线程：即使主线程被重渲染占用，转圈照常可见
      const spinAll = function (on) {
        if (typeof document === 'undefined') return
        try {
          const els = document.querySelectorAll('[data-dsws-host] .dsws-rficon')
          for (let i = 0; i < els.length; i++) els[i].classList.toggle('dsws-spin', on)
        } catch (e) { /* 忽略 */ }
      }
      const refreshAll = function (st) {
        if (st.refreshing) return
        st.refreshing = true
        // 先发 RPC（异步即返回），再触发渲染 —— 避免重渲染挡住数据请求
        var p1 = loadChecks(st, true, true)
        var p2 = loadSnapshot(st, true, true)
        spinAll(true)
        emit(st)
        Promise.all([p1, p2]).then(function () {
          st.refreshing = false
          spinAll(false)
          emit(st)
        }).catch(function () { st.refreshing = false; spinAll(false); emit(st) })
      }

      // #376：打开面板即保证新鲜 —— 未就绪/失败 → force 加载（有「加载中」反馈）；
      //   已就绪但过期（>60s）→ 触发加载；已就绪且新鲜（≤60s）→ 直接展示不重复请求（配额友好）。
      //   force 不被 snapLoading 守卫丢弃（#370 已修），加载中打开面板最终也会完成并展示。
      const SNAP_FRESH_MS = 60000
      const snapFresh = function (st) {
        if (!st.snapshot || !st.snapshot.generatedMs) return false
        try { return (Date.now() - st.snapshot.generatedMs) <= SNAP_FRESH_MS } catch (e) { return false }
      }
      // 打开形式（#373 用户拍板 2026-08-14）：仅右侧 details 列（停靠）一种形式。
      //   已移除：① Document PiP 独立小窗（Electron 无法创建 PiP 窗口、曾致桌面卡死 —— 代码不再含 pip 形态）；
      //   ② 停靠/悬浮双模式记忆（PANEL_MODE_KEY）；③ 状态栏「停靠」seg 与右栏「悬浮」按钮。
      //   打开一律走 layout.openDetails()；layout 服务不可用时退回页内悬浮面板（仅兜底，无任何入口按钮）。
      const openPagePanel = function (st) {
        // #58 缓存优先：先同步补 cwd + 水合 per-cwd 缓存，实现切换面板秒开（无 loading 遮罩）
        if (!st.cwd) {
          const sync = getCwdSync(st.sessionId)
          if (sync) { st.cwd = sync; hydrateFromCache(st) }
        } else {
          hydrateFromCache(st)
        }
        const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
        const isReal = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
        st.open = true
        if (isReal && snapFresh(st)) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
        } else if (isReal || hasCache) {
          if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
          emit(st)
          loadSnapshot(st, false)
        } else {
          st.snapMode = 'loading'
          emit(st)
          loadSnapshot(st, false)
        }
      }
      // 打开面板：一律右侧停靠（details 列）；layout 服务不可用 → 页内兜底
      const openDockPanel = function (st) {
        const ls = ctx.get('layout')
        if (ls && typeof ls.openDetails === 'function') {
          ls.openDetails()
          if (!st.cwd) {
            const sync = getCwdSync(st.sessionId)
            if (sync) { st.cwd = sync; hydrateFromCache(st) }
          } else { hydrateFromCache(st) }
          const hasCache = !!(st.snapshot || getCachedSnapshot(st.cwd))
          const isReal = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
          if (isReal && snapFresh(st)) {
            if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
            emit(st)
          } else if (isReal || hasCache) {
            if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
            emit(st)
            loadSnapshot(st, false)
          } else {
            loadSnapshot(st, false)
          }
          return
        }
        openPagePanel(st)  // layout 服务不可用 → 退回悬浮
      }
      // v1.4：打开位置可选 —— cfg.openIn: 'dock'（details 列，默认）/ 'sidebar'（dsh-better-sidebar tab）
      //   better-sidebar 已装时可用；未装或服务不可用 → 回退 details 列
      // v1.4.1 修复「切侧边栏没反应」：
      //   ① ensureSidebarTab 幂等注册 —— better-sidebar 的 client 可能晚于本模块加载（未声明 inject 依赖），
      //      注册必须可重试；openTab 前 ensure 一次保证已注册（否则 openTab 静默 no-op）。
      //   ② openTab 带 path seed 走「内容型打开」→ 侧边栏面板折叠时自动展开
      //      （类型型打开不展开面板，侧边栏收着就「看不见 = 没反应」）。
      let sidebarTabDisposer = null
      let sidebarTabRetry = null
      const ensureSidebarTab = function () {
        if (sidebarTabDisposer) return true
        try {
          const bs = ctx.get('betterSidebar')
          if (!(bs && typeof bs.registerTab === 'function')) return false
          const WaystationSidebarTab = function (props) {
            const scope = props && props.scope
            const sessionId = scope ? scope.sessionId : undefined
            return h('div', { style: { height: '100%', overflow: 'hidden' } }, h(DetailsDock, { sessionId: sessionId }))
          }
          sidebarTabDisposer = bs.registerTab({
            id: 'waystation:map',
            title: function () { return tr('panel.title') },
            icon: function () { return Ic({ n: 'map', size: 14 }) },
            order: 60,
            single: true,
            component: WaystationSidebarTab,
          })
          return true
        } catch (e) { return false }
      }
      const openInSidebar = function (st) {
        const bs = ctx.get('betterSidebar')
        if (bs && typeof bs.openTab === 'function') {
          if (!ensureSidebarTab()) { openDockPanel(st); return }  // 注册失败 → 回退 details 列
          // #2-fix（2026-08-19 用户反馈「新会话点状态栏面板不开」）：必须传 scope={sessionId}。
          //   better-sidebar 的 openTab(seed, scope) 内部 `targetSessionId = scope?.sessionId ?? store.getSnapshot().sessionId`；
          //   新会话时宿主尚未 setSession(该 id) → store sessionId 为 undefined → openTab 静默 return，面板不开。
          //   显式传当前 store 的 sessionId 后走 reduceFor(scope.sessionId) 路径（按给定 id 初始化布局），面板正常展开。
          //   仅当 st.sessionId 有值时传 scope（无值时传 {sessionId:undefined} 会令 targetsInactiveSession=true 走错分支）。
          bs.openTab({ type: 'waystation:map', path: 'waystation:map' }, st.sessionId ? { sessionId: st.sessionId } : undefined)  // path seed → 内容型打开 → 自动展开面板
          // 打开 tab 即视为面板已开（数据新鲜直接展示）
          // #58 缓存优先：与 openPagePanel 同逻辑，含 per-cwd 水合
          if (!st.cwd) {
            const sync = getCwdSync(st.sessionId)
            if (sync) { st.cwd = sync; hydrateFromCache(st) }
          } else { hydrateFromCache(st) }
          const hasCache2 = !!(st.snapshot || getCachedSnapshot(st.cwd))
          const isReal2 = st.snapMode === 'real' || !!st.snapshot || !!getCachedSnapshot(st.cwd)
          if (isReal2 && snapFresh(st)) {
            if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
            emit(st); return
          }
          if (isReal2 || hasCache2) {
            if (!st.snapshot && getCachedSnapshot(st.cwd)) { st.snapshot = getCachedSnapshot(st.cwd); st.snapMode = 'real' }
            emit(st); loadSnapshot(st, false); return
          }
          loadSnapshot(st, false)
          return
        }
        openDockPanel(st)  // better-sidebar 不可用 → 回退 details 列
      }
      const openPanel = function (st) {
        // #2-fix（2026-08-19 用户反馈「新会话点状态栏按钮右侧面板不开」）：
        //   cfg.openIn 在 apply 时固化；装配竞态（better-sidebar 晚于本模块加载）会令 bsInstalled=false → openIn 误判为 'dock'，
        //   点击永远走 openDockPanel（宿主 details 列），better-sidebar 面板不展开 → 用户看不到列表（数据其实一直在渲染）。
        //   实时检测：better-sidebar 当前可用（openTab 存在）且用户未显式选过 dock → 走 sidebar 展开 better-sidebar。
        const bs = ctx.get('betterSidebar')
        const bsReady = !!(bs && typeof bs.openTab === 'function')
        const explicitDock = (function () {
          try {
            const raw = localStorage.getItem(CFG_KEY)
            if (!raw) return false
            return JSON.parse(raw).openIn === 'dock'
          } catch (e) { return false }
        })()
        if (cfg.openIn === 'sidebar' || (bsReady && cfg.openIn === 'dock' && !explicitDock)) openInSidebar(st)
        else openDockPanel(st)
      }
      const togglePanel = function (st) {
        if (st.open) { st.open = false; emit(st); return }
        openPanel(st)
      }

      const repoStr = (st) => (st.snapshot && st.snapshot.repo)
        ? st.snapshot.repo.owner + '/' + st.snapshot.repo.name
        : 'FeatherHunter/SKILLS'

      // v21：开始 prompt 精简 —— /wayfinder + URL + 统一引导句（技能内部细节自带，不再重复灌输）
      // v25 · T2b：execute 走模板渲染（templates.execute 或默认），前缀开关 = cfg.withWayfinder
      // v1.3.3 #10：前缀去重 —— 模板（含用户自定义旧模板）若已以 /wayfinder 开头则不再重复拼接
      const withWayfinderPrefix = function (body) {
        if (!cfg.withWayfinder) return body
        if (/^\/wayfinder\b/.test(String(body || '').trim())) return body
        return '/wayfinder\n' + body
      }
      const startText = (st, t) => {
        const url = 'https://github.com/' + repoStr(st) + '/issues/' + t.number
        // v1.4（T2 #443）：map 用推进式 prompt（加载技能→分析map→挑下一个issue→执行）；普通 issue 用 execute 模板
        const isMap = (t.labels || []).some(function (l) { return (typeof l === 'string') ? l === 'wayfinder:map' : l.name === 'wayfinder:map' })
        // v1.5 B2：map prompt 嵌入 map 标识（编号/标题/链接），新会话不再「找不到对应 ISSUE」
        // v1.5 B2 修订（用户拍板）：新会话/执行 prompt 跟随行状态 —— map 完成态 → 完成确认 prompt（与左「完成」按钮同语义）；
        //   未完成 → 推进式；统一带 map 标识（编号/标题/链接），新会话不再「找不到对应 ISSUE」
        if (isMap) {
          const stats = t.stats || (function () {
            const mo = ((st.snapshot && st.snapshot.maps) || []).find(function (m) { return m.number === t.number })
            return mo ? mo.stats : null
          })()
          const done = !!(stats && stats.total > 0 && stats.closed === stats.total)
          const head = '\n\n' + promptText('mapHead', { n: String(t.number || ''), title: (t.title || ''), url: url })
          if (done) {
            return completePrompt(st, t.number, stats.total, stats.closed) + head
          }
          // v1.5：技能 + 链接前置（用户规则：具体操作 prompt 开头 = /wayfinder + ISSUE 链接）
          // T13：map 推进同样挂阶段闸门（推进的票若带 needs-triage 必须先诊断）
          const gateText = promptText('stageGate')
        return '/wayfinder\n' + url + '\n\n' + MAP_EXECUTE_PROMPT() + (gateText ? '\n\n' + gateText : '') + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + head
        }
        const body = renderTemplate('execute', { number: String(t.number), url: url, title: t.title })
        return withWayfinderPrefix(body)
      }
      const SESSION_TITLE_PREFIX = '[MattSkills]'
      const newSessionTitle = (t) => SESSION_TITLE_PREFIX + ' ' + t.title + ' #' + t.number
      // v1.5 T6：新增 wayfinder prompt —— /wayfinder + 仓库信息 + 需求引导（用户拍板：prompt 带仓库信息）
      // T16 补强（#463 复核 F2）：建图入口同样挂正文格式契约（新建 map 正文从源头防字面 \\n / BOM）
      const newWayfinderText = (st) => promptText('newWayfinder', { repo: 'https://github.com/' + repoStr(st) }) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '')
      // issue #4：新增 BUG 单 —— 与「+ 新增需求」同构（新会话 + 预填 /wayfinder prompt + 正文格式契约）
      // v2（#1 BUG3 补强）：输入位挪到 BODY_FORMAT 之后，模板末尾（避免中途输入位）
      // v3（#14 决议 #13 [T7]）：字段集精简为 4 项 + 例行指引（v3.4：每字段「字段名：」行 + 下方「例：示例」行紧贴，zh/en 分离跟随语言）；EN locale 切换（NEW_BUG_FIELDS_BODY_EN）
      const newBugWayfinderText = (st) => promptText('newBugWayfinder', { repo: 'https://github.com/' + repoStr(st) }) + (BODY_FORMAT() ? '\n\n' + BODY_FORMAT() : '') + (promptLang() === 'en' ? NEW_BUG_FIELDS_BODY_EN() : NEW_BUG_FIELDS_BODY())

      // v10：沉淀 = 会话级动作 —— 注入「零丢失快照」prompt（默认文本见 §2.5 FIXATE_PROMPT，T2b 可编辑）
      const injectFixate = (st) => { inject(st, fixateText()) }

      // v24-48：交接 —— 第一击自动注入 /handoff 模板（带时间戳文件名 + 引导句）并记忆该时间戳；
      // 第二击优先读「第一击模板里的同一个文件」（模板写什么名就读什么名，不再查目录导致旧文件名）；
      // 仅当未点过第一击（如刷新后）才回退 host 查最新实际文档；+ 复制 + 开新空白会话
      // v25 · T2b（F1 修正）：交接两击走模板渲染；{ts} 第一击注入时生成并记忆；
      //   {file} = 第一击模板渲染后解析出的实际文件名（用户改文件名结构也一致），解析失败兜底 handoffTs + '.md'
      let handoffTs = null  // v24：第一击模板使用的时间戳（第二击优先复用同一文件名）
      let handoffFile = null  // v25 F1：第一击渲染后解析出的实际交接文件名（含用户自定义结构）
      const handoffPrompt = function (ts) {
        return renderTemplate('handoff1', { ts: ts })
      }
      // 从第一击注入文本解析 .scratch/handoff/<name>.md 的实际文件名（T1 规格 §2 发现 1）
      const extractHandoffFile = function (text) {
        const m = String(text || '').match(/\.scratch\/handoff\/([^\s"'`]+\.md)/)
        return m ? m[1] : null
      }
      const handoffReadText = function (file) {
        if (file) return renderTemplate('handoff2', { file: file })
        return promptText('handoffRead')
      }
      // 跨会话预填（issue #12 BUG4 r3 终极修复）：单变量保留，但消费侧彻底锁死 deps 为 [props.sessionId]，
        //   当前会话的 props 重渲染不会再触发 effect 重跑，从根本上消除「当前会话 effect 抢先消费」竞态。
        let pendingDraft = null
      // 需求1（2026-08-18）：交接按钮 = 第一击（注入 /handoff 模板，不再变字）；「新会话交接」小按钮 = 原第二击逻辑
      // 需求1·二阶段 rev（2026-08-18）：灰/亮双态的真实依据 = 磁盘上确实存在交接文档（handoffLatest 探测）。
      //   probeHandoffReady：探测 → 写 st.handoffReady + emit（右半亮蓝/灰 + 允许/禁止 的开关）；任何路径都不得在无文档时开新会话。
      // issue #12 BUG4 · 主路径（r2 终极形态）：用户刚点过第一击（handoffFile 已设）→ 直接用 handoffFile 作为 prompt
      //   文件名 + 亮蓝，**不查磁盘**。理由：prompt 必须与第一击注入的 `/handoff` 模板时间戳一致（用户视角的「两段文本应该对应同一份文档」），
      //   即便 AI 还没落盘，handoff-open 仍应预填 handoffFile（保证两段 prompt 一致）。若 AI 真没写，新会话 `/read` 会失败 —— 那是 AI 行为问题。
      //   未点过第一击（handoffFile=null，如刷新后 / 直接点右半）→ 调 handoffLatest 探磁盘取 mtime 最新。
      //   始终返回 Promise.resolve(done(...))，让调用方（doHandoffOpen / probe chain）能稳定 .then。
      const probeHandoffReady = function (st) {
        const cwdArg = st.cwd ? { cwd: st.cwd } : {}
        const done = function (file) { st.handoffReady = !!file; emit(st); return file }
        if (conn === undefined || conn.rpc === undefined) { done(null); return Promise.resolve(null) }
        // 主路径：handoffFile 已设 → 直接返回它（prompt 内容与第一击模板时间戳一致 · r2）
        if (handoffFile) return Promise.resolve(done(handoffFile))
        // 副路径：handoffFile=null（刷新后 / 从未点第一击）→ 走 handoffLatest 探磁盘
        return rpcCall('handoffLatest', cwdArg).then(function (res) {
          return done((res && res.ok && res.file) ? res.file : null)
        }).catch(function () { return done(null) })
      }
      const doHandoff = function (st) {
        handoffTs = timeStampStr()
        const text = handoffPrompt(handoffTs)
        handoffFile = extractHandoffFile(text) || (handoffTs + '.md')
        inject(st, text)
        flash(st, tr('toast.injectedHandoff'), 'ok')
        // r2：handoffFile 已设后 probeHandoffReady 直接亮蓝（不再等磁盘落盘）
        probeHandoffReady(st)
      }
      const doHandoffOpen = function (st) {
        const ws = ctx.get('workspaces')
        const finish = function (file, msg) {
          const text = handoffReadText(file)
          pendingDraft = text
          copyText(st, text, msg || tr('toast.copiedHandoff'))
          if (ws && typeof ws.startSession === 'function') {
            ws.startSession()
          } else {
            pendingDraft = null
          }
        }
        // 引导门 v3（2026-08-18 rev）：无论本会话是否点过第一击，一律先探测磁盘真实文档——
        //   有 latest → 置 ready + 放行开新会话；没有 → toast 引导「请先点「交接」生成交接文档」，绝不打开空会话
        probeHandoffReady(st).then(function (file) {
          if (file) finish(file, tr('toast.copiedHandoffFile', { file: file }))
          else flash(st, tr('toast.handoffGrey'), 'warn')
        })
      }

      // #361：在新会话中打开 —— 同 cwd + 自动命名 + 预填指令
      //   契约（dsh-client-runtime ISessions）：create({cwd}) → SessionId；scope(sid) → AgentContext；
      //   sessionOf(ctx) → SessionFace.rename(title)；open(sid) 切换。任一步失败降级为当前会话注入 + 提醒。
      const openTextInNewSession = function (st, text, title) {
        const sessions = ctx.get('sessions')
        const workspaces = ctx.get('workspaces')
        const doFallback = function () {
          inject(st, text)
          flash(st, tr('toast.newSessionManual', { title: title }), 'warn')
        }
        if (!sessions || typeof sessions.create !== 'function') { doFallback(); return }
        // v1.5：新会话默认继承「点击时所在会话」的工作区（st.cwd）；
        //   缺失时：1) 同步读 sessions.list（权威 cwd）2) 再向 host/conn 解析兜底
        const ensureCwd = function () {
          const sync = getCwdSync(st.sessionId)
          if (sync) {
            if (sync !== st.cwd) st.cwd = sync
            return Promise.resolve(sync)
          }
          if (st.cwd) return Promise.resolve(st.cwd)
          if (typeof conn !== 'undefined' && conn !== undefined && conn.rpc !== undefined && st.sessionId) {
            return rpcCall('cwd', { sessionId: st.sessionId }).then(function (res) {
              if (res && res.ok && res.cwd) { st.cwd = res.cwd; return res.cwd }
              return null
            }).catch(function () { return null })
          }
          if (typeof host !== 'undefined' && typeof host.call === 'function' && st.sessionId) {
            return host.call('wf.cwd', { sessionId: st.sessionId }).then(function (res) {
              if (res && res.ok && res.cwd) { st.cwd = res.cwd; return res.cwd }
              return null
            }).catch(function () { return null })
          }
          return Promise.resolve(null)
        }
        const ensureWorkspaceId = function (cwd) {
          if (!workspaces || !cwd) return Promise.resolve(null)
          try {
            let items = []
            if (workspaces.list) {
              let snap = null
              try {
                if (typeof workspaces.list.getSnapshot === 'function') snap = workspaces.list.getSnapshot()
                else if (typeof workspaces.list.getCurrent === 'function') snap = workspaces.list.getCurrent()
              } catch (e2) {}
              if (snap) {
                if (Array.isArray(snap.items)) items = snap.items
                else if (Array.isArray(snap)) items = snap
              }
            }
            const norm = function (p) {
              const s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
              const isWin = /\\/.test(String(p || '')) || /^[a-zA-Z]:\//.test(s)
              return isWin ? s.toLowerCase() : s
            }
            const targetNorm = norm(cwd)
            for (let i = 0; i < items.length; i++) {
              const w = items[i]
              const wPath = w.path || w.cwd
              if (wPath && norm(wPath) === targetNorm) {
                const wid = w.workspaceId || w.id
                if (wid) return Promise.resolve(wid)
              }
            }
            if (typeof workspaces.create === 'function') {
              return workspaces.create({ path: cwd }).then(function (ws) {
                const wid = ws && (ws.workspaceId || ws.id)
                return wid || null
              }).catch(function () { return null })
            }
          } catch (e) {}
          return Promise.resolve(null)
        }
        ensureCwd().then(function (cwd) {
          if (!cwd) { doFallback(); return }
          ensureWorkspaceId(cwd).then(function (workspaceId) {
            const createOpts = workspaceId ? { workspaceId: workspaceId } : { cwd: cwd }
            sessions.create(createOpts).then(function (sid) {
            // v1.5：新会话继承当前快照（同仓库同 cwd）—— 面板/状态栏秒显，避免冷缓存全量重建卡顿
            const ns = storeOf(sid)
            if (ns && st.snapshot) { ns.snapshot = st.snapshot; ns.snapMode = 'real'; ns.cwd = cwd }
            // 自动命名（失败不阻塞打开）
            try {
              const scopeCtx = sessions.scope(sid)
              const face = scopeCtx ? sessions.sessionOf(scopeCtx) : undefined
              if (face && typeof face.rename === 'function') face.rename(title).catch(function () { /* 命名失败忽略 */ })
            } catch (e) { /* 命名失败忽略 */ }
            // 预填：新会话 dock 挂载后经 StatusBar 消费 pendingDraft（与交接开新会话同机制）
            pendingDraft = text
            sessions.open(sid)
            flash(st, tr('toast.newSessionOpened'), 'ok')
          }).catch(function () { doFallback() })
          })
        })
      }
      // #361 原入口：行级「在新会话打开」保留（rowActionText 文本 + 票标题命名）
      const openInNewSession = function (st, x) {
        openTextInNewSession(st, rowActionText(st, x), newSessionTitle(x))
      }
      const inject = (st, text) => {
        if (st.injector) { st.injector(text); flash(st, tr('toast.injected'), 'ok') }
        else copyText(st, text, tr('toast.copiedFallback'))
        // v1.5 T10 R9（Q4 拍板）：关键动作（完成/执行/交接/认领）后延迟探测，面板尽快反映变化
        scheduleActionProbe()
      }
      // v1.6：技能安装引导已收编进 PROMPTS 注册表（installSkills 条目），见下方 promptText('installSkills') 引用
      // v1.5 引导链：打开外部 URL（gh 安装/登录文档）
      const openUrl = function (url) { try { if (typeof window !== 'undefined' && window.open) window.open(url, '_blank') } catch (e) { /* 忽略 */ } }
      const copyText = (st, text, okMsg) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { flash(st, okMsg || tr('toast.copied'), 'ok') }).catch(function () { flash(st, tr('toast.copyFailed'), 'warn') })
        } else flash(st, tr('toast.clipboardUnavailable'), 'warn')
      }

      // ============================================================
      // 5. 组件
      // ============================================================
      const Dot = ({ level }) => h('span', { className: 'dsws-dot', style: { background: level === 'ok' ? '#4ade80' : level === 'warn' ? '#f59e0b' : level === 'bad' ? '#f87171' : '#52525b' } })
      const TypeChip = ({ type }) => {
        const t = TYPE_LABEL[type] || [type, '', type]
        const cls = { research: 'dsws-chip-r', prototype: 'dsws-chip-p', grilling: 'dsws-chip-g', task: 'dsws-chip-t' }[type] || ''
        return h('span', { className: 'dsws-chip ' + cls }, [
          Ic({ n: TYPE_ICON[type] || 'dot', size: 11 }),
          h('span', null, tr('type.' + type)),
        ])
      }

      // ---- 5.2 输入区状态栏（定稿 1A 居中胶囊 · 反馈不进状态栏 · cwd 关联 · v14 数字区等宽 + 交接段）----
      const StatusBar = (props) => {
        const sid = props && props.sessionId
        const s = useStore(sid)
        // v15-27：宿主权威 cwd —— SessionSummary.cwd（会话列表工作区标题同源），替换字段名猜测链
        const summaryCwd = props.useSessions(function (x) {
          return (sid && x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined
        })
        // v14-20 → r3：跨会话预填（交接开新会话后，新 dock 挂载即消费）。
        // issue #12 BUG4 r3 终极修复（最简形式）：
        //   关键改动：effect deps 从 [props] 改为 [props.sessionId]。
        //   旧实现 [props] 依赖会因 ws.startSession 触发父级重渲染 → 当前会话的 props 引用变 → 当前会话 effect 重跑 → 抢先消费 pendingDraft。
        //   新实现 [props.sessionId] 只在 sid 变化时跑（即每个会话只在初次 mount 跑一次），
        //     · 当前会话：sid 长期不变 → effect 不重跑 → 不抢先消费
        //     · 新会话：sid 初次设置 → effect 跑一次 → 消费 pendingDraft
        //   consumedDraftRef 守卫保留作为 belt-and-suspenders：即使组件 remount（同 sid 字符串），
        //     ref 仍能防止 effect 重入。
        const consumedDraftRef = React.useRef(false)
        React.useEffect(function () {
          if (consumedDraftRef.current) return
          if (props && props.inputActions && typeof props.inputActions.setDraft === 'function') {
            s.injector = props.inputActions.setDraft
            if (pendingDraft) {
              consumedDraftRef.current = true
              const text = pendingDraft
              pendingDraft = null
              props.inputActions.setDraft(text)
            }
          }
        }, [props.sessionId])
        React.useEffect(function () {
          probeHandoffReady(s)  // 需求1·二阶段 rev：挂载即探测 .scratch/handoff/，以真实文档有无决定右半灰/亮
        }, [])
        // v13：会话工作目录探测 —— 依赖 sessionId 变化重跑（切换对话必触发）。
        // v15-27：优先 SessionSummary.cwd（宿主权威）；次选 props.session 直取；最后 host wf.cwd 兜底。
        // cwd 变化后主动重拉快照与检查（否则面板/状态栏仍显示旧仓库数据）。
        React.useEffect(function () {
          const apply = function (cwd) {
            if (cwd && cwd !== s.cwd) {
              s.cwd = cwd
              const hydrated = hydrateFromCache(s)
              emit(s)
              loadChecks(s, false)
              if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
            }
          }
          if (summaryCwd) { apply(summaryCwd); return }
          const cwd0 = detectCwd(props && props.session)
          if (cwd0) { apply(cwd0); return }
          if (sid && conn !== undefined && conn.rpc !== undefined) {
            rpcCall('cwd', { sessionId: sid }).then(function (res) {
              if (res && res.ok && res.cwd) apply(res.cwd)
            }).catch(function () { /* 保持现有 cwd */ })
          }
        }, [sid, summaryCwd])
        // v1.5：挂载时新鲜数据（≤60s，含新会话继承的快照）跳过重载，避免冷缓存全量重建卡顿
        React.useEffect(function () { loadChecks(s, false); if (!snapFresh(s)) loadSnapshot(s, false) }, [])
        // v18-30：可接/占用 = 列表 open issue 口径（与面板列表一致）
        const fr = frontierCount(s)
        const bugN = bugCount(s)
        const triageN = triageCount(s)
        const n = readyCount(s)
        const timeStr = timeOf(s.snapshot) || (s.checksUpdatedAt ? s.checksUpdatedAt.slice(5, 16) : '') || '-- --:--'
        const setup = setupCheck(s)
        const amber = s.checksMode === 'real' && setup && setup.level !== 'ok'
        // v1.5 T11：核心技能套件检测（检查 9）
        const skillsCheck = (s.checks || []).find(function (c) { return c.id === 9 })
        const skillsBad = s.checksMode === 'real' && skillsCheck && skillsCheck.level !== 'ok'
        // v1.5 引导依赖链（用户拍板 2026-08-17）：gh CLI → gh 登录 → setup → 技能 —— banner 显示依赖链上第一个缺失项
        const ghCliCheck = (s.checks || []).find(function (c) { return c.id === 4 })
        const ghAuthCheck = (s.checks || []).find(function (c) { return c.id === 5 })
        const ghCliBad = s.checksMode === 'real' && ghCliCheck && ghCliCheck.level !== 'ok'
        const ghAuthBad = s.checksMode === 'real' && ghAuthCheck && ghAuthCheck.level !== 'ok'
        const go = function (tab) { s.tab = tab; openPanel(s) }
        // v14-22：数字区固定两位数等宽（环境 5ch 容 '98/99'；可接/占用 2ch）
        const num = (txt, minW) => h('span', { className: 'dsws-num', style: minW ? { minWidth: minW } : null }, txt)
        const seg = (icon, label, color, onGo, title) => h('span', { className: 'dsws-seg', onClick: function (e) { e.stopPropagation(); onGo() }, title: title || '', style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: color } }, [
          Ic({ n: icon, size: 12 }),
          label,
        ])
        // #16 V2（2026-08-18 复现后重设计）：dn/dw 阈值体系废弃——dn 信号源 R5 起改为输入区（wrapper）宽，
        //   默认 1280 视口下输入区仅 812px，dn=0 永不出现 → 宽屏默认缺品牌字。
        //   改为内容自适应渐进收缩（仿 #15 tabs）：applyFold 全展开后按 data-fold-priority 升序
        //   逐个折叠文字 span（.dsws-folded → display:none），直到 scrollWidth ≤ clientWidth。
        //   优先级 = 信息价值：品牌(1) → 沉淀(2)/交接(3)/刷新字(4) → 可接(5)/BUG(6)/诊断(7)/环境(8) → 时间(9)。
        //   折叠由 React 外部 DOM class 驱动（React 重渲染时 className prop 不变 → classList 手动变化保留）。
        const inputRef = React.useRef(null)
        const foldRef = React.useRef(null)
        const bugAnchorRef = React.useRef(null)
        const skillAnchorRef = React.useRef(null)
        const bugCloseRef = React.useRef(null)
        const skillCloseRef = React.useRef(null)
        const [iw, setIw] = React.useState(780)
        // issue #22：布局 wrapper 保持裁剪职责；浮层位置以锚点 viewport rect 表示。
        const placeOverlay = function (el, align) {
          if (!el || typeof window === 'undefined') return null
          const r = el.getBoundingClientRect()
          if (!r || (!r.width && !r.height)) return null
          const p = { bottom: Math.max(0, Math.round(window.innerHeight - r.top)) }
          if (align === 'right') p.right = Math.max(0, Math.round(window.innerWidth - r.right))
          else p.left = Math.max(0, Math.round(r.left))
          return p
        }
        const placeBugMenu = function () {
          const p = placeOverlay(bugAnchorRef.current, 'left')
          if (!p) return false
          const old = s.bugMenuPos
          if (old && old.left === p.left && old.bottom === p.bottom) return false
          s.bugMenuPos = p
          return true
        }
        const placeSkillPop = function () {
          const p = placeOverlay(skillAnchorRef.current, 'right')
          if (!p) return false
          const old = s.skillPopPos
          if (old && old.right === p.right && old.bottom === p.bottom) return false
          s.skillPopPos = p
          return true
        }
        const clearClose = function (ref) {
          if (ref.current !== null) { clearTimeout(ref.current); ref.current = null }
        }
        const closeBugMenu = function () {
          clearClose(bugCloseRef)
          if (!s.bugMenuOpen && !s.bugMenuPos && !s.bugMenuHover) return
          s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; emit(s)
        }
        const closeSkillPop = function () {
          clearClose(skillCloseRef)
          if (!s.skillsOpen && !s.skillPopPos && !s.skillHover && !s.skillTip) return
          s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; emit(s)
        }
        const scheduleClose = function (ref, fn) {
          clearClose(ref)
          ref.current = setTimeout(function () { ref.current = null; fn() }, 160)
        }
        const showBugMenu = function () {
          clearClose(bugCloseRef); clearClose(skillCloseRef)
          let changed = false
          if (s.skillsOpen || s.skillPopPos || s.skillHover || s.skillTip) { s.skillsOpen = false; s.skillHover = null; s.skillTip = null; s.skillPopPos = null; changed = true }
          if (!s.bugMenuOpen) { s.bugMenuOpen = true; changed = true }
          if (placeBugMenu()) changed = true
          if (changed) emit(s)
        }
        const showSkillPop = function () {
          clearClose(skillCloseRef); clearClose(bugCloseRef)
          let changed = false
          if (s.bugMenuOpen || s.bugMenuPos || s.bugMenuHover) { s.bugMenuOpen = false; s.bugMenuHover = false; s.bugMenuPos = null; changed = true }
          if (!s.skillsOpen) { s.skillsOpen = true; changed = true }
          if (placeSkillPop()) changed = true
          if (changed) emit(s)
        }
        React.useEffect(function () {
          if (!s.bugMenuOpen && !s.skillsOpen) return undefined
          let raf = null
          let disposed = false
          const reposition = function () {
            if (disposed || raf !== null) return
            const run = function () {
              raf = null
              if (disposed) return
              let changed = false
              if (s.bugMenuOpen && placeBugMenu()) changed = true
              if (s.skillsOpen && placeSkillPop()) changed = true
              if (changed) emit(s)
            }
            if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(run)
            else raf = setTimeout(run, 0)
          }
          document.addEventListener('scroll', reposition, { capture: true, passive: true })
          window.addEventListener('resize', reposition)
          const ro = new ResizeObserver(reposition)
          if (bugAnchorRef.current) ro.observe(bugAnchorRef.current)
          if (skillAnchorRef.current) ro.observe(skillAnchorRef.current)
          reposition()
          return function () {
            disposed = true
            ro.disconnect()
            if (raf !== null) {
              if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
              else clearTimeout(raf)
            }
            document.removeEventListener('scroll', reposition, true)
            window.removeEventListener('resize', reposition)
            clearClose(bugCloseRef); clearClose(skillCloseRef)
          }
        }, [s.bugMenuOpen, s.skillsOpen])
        const applyFold = function () {
          const cap = foldRef.current
          if (!cap) return
          const targets = Array.from(cap.querySelectorAll('[data-fold-priority]'))
          if (!targets.length) return
          cap.classList.add('dsws-no-anim')
          targets.forEach(function (el) { el.classList.remove('dsws-folded') })
          void cap.offsetWidth
          const items = targets.map(function (el) {
            return { el: el, p: Number(el.getAttribute('data-fold-priority') || 99) }
          }).sort(function (a, b) { return a.p - b.p })
          for (const it of items) {
            if (cap.scrollWidth <= cap.clientWidth + 1) break
            it.el.classList.add('dsws-folded')
            void cap.offsetWidth
          }
          cap.dataset.fold = String(targets.filter(function (el) {
            return el.classList.contains('dsws-folded')
          }).length)
          cap.classList.remove('dsws-no-anim')
        }
        React.useEffect(function () {
          const ta = document.querySelector('textarea.uV2eYG_input')
          if (ta) inputRef.current = ta
          const applyInput = function () {
            if (!inputRef.current) return
            try { setIw(inputRef.current.getBoundingClientRect().width) } catch (e) { /* 忽略 */ }
          }
          applyInput()
          const roInput = new ResizeObserver(applyInput)
          if (inputRef.current) roInput.observe(inputRef.current)
          // 折叠重算：capsule 宽（=iw）变化 / 窗口 resize / 字体加载后（防字体宽差误判）
          const roFold = new ResizeObserver(function () { applyFold() })
          const applyAll = function () { applyInput(); applyFold() }
          applyFold()
          if (foldRef.current) roFold.observe(foldRef.current)
          window.addEventListener('resize', applyAll)
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyFold)
          // DSH shell 偶尔会在对话切换时重新挂载 textarea，轮询兜底重读
          const poll = setInterval(applyAll, 2000)
          return function () {
            try { roInput.disconnect() } catch (e) { /* 忽略 */ }
            try { roFold.disconnect() } catch (e) { /* 忽略 */ }
            window.removeEventListener('resize', applyAll)
            clearInterval(poll)
          }
        }, [])
        const capsule = h('div', { className: 'dsws-capsule', ref: foldRef, onClick: function () { openPanel(s) }, style: { position: 'relative', width: iw + 'px', maxWidth: iw + 'px' } }, [
          h('span', { className: 'dsws-capsule-word', onClick: function (e) { e.stopPropagation(); togglePanel(s) } }, [
            Icon({ scheme: s.ui.icon, size: 14 }),
            h('span', { 'data-fold-priority': 1 }, tr('panel.title')),
          ]),
          seg('target', [h('span', { 'data-fold-priority': 5 }, tr('nav.takeable')), num(String(fr), '2ch')], '#4ade80', function () { s.stateFilter = 'frontier'; go('list') }, tr('nav.takeableTitle')),
          // issue #4：BUG 计数段 —— 点击仍开 bug 过滤列表；悬停弹「新增」菜单（新会话预填 /wayfinder 新增 BUG 单 prompt）
          h('span', { ref: bugAnchorRef, style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: showBugMenu, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) } }, [
            seg('alert', [h('span', { 'data-fold-priority': 6 }, tr('nav.bug')), num(String(bugN), '2ch')], '#f87171', function () { s.stateFilter = 'open'; s.lblFilters = ['bug']; go('list') }, tr('nav.bugTitle')),
            s.bugMenuOpen ? PortalOverlay({ className: 'dsws-bugmenu', onMouseEnter: function () { clearClose(bugCloseRef) }, onMouseLeave: function () { scheduleClose(bugCloseRef, closeBugMenu) }, onClick: function (e) { e.stopPropagation() }, style: { position: 'fixed', left: s.bugMenuPos ? s.bugMenuPos.left : 0, bottom: s.bugMenuPos ? s.bugMenuPos.bottom : 0, padding: 4, zIndex: 2147483000, background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)' } }, [
              h('div', { onClick: function (e) { e.stopPropagation(); closeBugMenu(); openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, onMouseEnter: function () { if (!s.bugMenuHover) { s.bugMenuHover = true; emit(s) } }, onMouseLeave: function () { if (s.bugMenuHover) { s.bugMenuHover = false; emit(s) } }, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.bugMenuHover ? '#f87171' : 'var(--dsw-alias-label-primary,#e6edf3)', background: s.bugMenuHover ? 'rgba(248,113,113,.15)' : 'transparent', whiteSpace: 'nowrap' } }, [
                Ic({ n: 'bug', size: 12, color: '#f87171' }),
                h('span', null, tr('nav.bugNew')),
              ]),
            ]) : null,
          ]),
          seg('search', [h('span', { 'data-fold-priority': 7 }, tr('nav.triage')), num(String(triageN), '2ch')], '#f59e0b', function () { s.stateFilter = 'open'; s.lblFilters = ['needs-triage']; go('list') }, tr('nav.triageTitle')),
          // #16 V2：note 段（沉淀 / Consolidate）文字 span 打 data-fold-priority=2（无数字操作段，信息价值低，早收）
          seg('note', h('span', { 'data-fold-priority': 2 }, tr('nav.word')), '#c084fc', function () { injectFixate(s) }, tr('nav.fixateTitle')),
          // 需求1·二阶段（2026-08-18）：交接分割按钮 —— 共外框 + 细分隔线；左半「交接」= 第一击生成、
          //   右半「交接出去」= 原第二击（探测磁盘最新文档 → 预填 + 开新会话）。各自点击区/tooltip 保留，hover 沿用 seg 背景。
          //   右半灰/亮双态：handoffReady → 亮蓝 #58a6ff（tooltip nav.handoffReadyTitle）；未 ready → 半透明灰（tooltip nav.handoffGreyTitle）
          // #16 V2：split-part 左半「交接」文字 span 打 data-fold-priority=3（无数字操作段）
          h('span', { className: 'dsws-split' }, [
            h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoff(s) }, title: tr('nav.handoffTitle'), style: { color: '#58a6ff' } }, [
              Ic({ n: 'handoff', size: 12 }),
              h('span', { 'data-fold-priority': 3 }, tr('nav.handoff')),
            ]),
            h('span', { className: 'dsws-split-div' }),
            h('span', { className: 'dsws-split-part', onClick: function (e) { e.stopPropagation(); doHandoffOpen(s) }, title: s.handoffReady ? tr('nav.handoffReadyTitle') : tr('nav.handoffGreyTitle'), style: s.handoffReady ? { color: '#58a6ff' } : { color: '#8b8b95', opacity: 0.55, cursor: 'default' } }, [
              Ic({ n: s.handoffReady ? 'handoff-open' : 'handoff-off', size: 12 }),
            ]),
          ]),
          // v19-36：环境段移至末尾（更新左侧），用户少点
          seg('dot', [h('span', { 'data-fold-priority': 8 }, tr('nav.env')), num(envLabel(s))], n < 0 ? '#f87171' : n === envTotal(s) ? '#4ade80' : '#f59e0b', function () { go('checks') }, tr('nav.envTitle', { n: n < 0 ? '?' : String(n), t: String(envTotal(s)) })),
          // v1.5 T10：刷新反馈 = 图标转圈（文字恒定不换 · 控件宽度零变化）
          // #16 V2：timebtn 两段文字各打 priority（刷新字=4 无数字操作段 / 时间=9 纯参考时间戳最后收）
          h('span', { className: 'dsws-timebtn', onClick: function (e) { e.stopPropagation(); refreshAll(s) }, title: tr('nav.refreshTitle') }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', { 'data-fold-priority': 4 }, tr('nav.refresh')), h('span', { 'data-fold-priority': 9 }, ' ' + timeStr)]),
          // 需求2（2026-08-18）：状态栏末尾技能列表按钮 —— 向上展开技能名列表，点击技能名插入 /<技能名> 到当前会话
          // issue #3（D2）：对齐 BUG 段悬浮菜单 —— 悬停即展开、移出「按钮 + 列表」整体区域即关闭；
          //   按钮与列表之间的 4px 间隙由外层 paddingTop 桥接（不再用 marginBottom），鼠标穿越不误关。
          h('span', {
            style: { position: 'relative', display: 'inline-flex' },
            ref: skillAnchorRef, onMouseEnter: showSkillPop,
            onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) }
          }, [
            h('span', { className: 'dsws-skillbtn' + (s.skillsOpen ? ' on' : ''), onClick: function (e) { e.stopPropagation(); if (s.skillsOpen) closeSkillPop(); else showSkillPop() }, title: tr('nav.skillsTitle'), style: { display: 'inline-flex', alignItems: 'center', padding: '1px 4px', borderRadius: 4, cursor: 'pointer', color: s.skillsOpen ? '#c084fc' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [Ic({ n: 'skills', size: 12 })]),
            s.skillsOpen ? PortalOverlay({ className: 'dsws-skillpop-bridge', onMouseEnter: function () { clearClose(skillCloseRef) }, onMouseLeave: function () { scheduleClose(skillCloseRef, closeSkillPop) }, style: { position: 'fixed', right: s.skillPopPos ? s.skillPopPos.right : 0, bottom: s.skillPopPos ? s.skillPopPos.bottom : 0, paddingTop: 4, paddingBottom: 4, zIndex: 2147483000 }, onClick: function (e) { e.stopPropagation() } }, [
              h('div', { className: 'dsws-skillpop', style: { minWidth: 150, maxHeight: 'min(300px, calc(100vh - 24px))', overflowY: 'auto', background: 'var(--dsw-alias-bg-layer-2,#16181d)', border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,.45)', padding: 4 } }, [
                // 悬浮记忆：鼠标移到行上立即出现浮层（替代浏览器原生 title 的慢延迟）
                SKILLS.map(function (sk) {
                  return h('div', {
                    key: sk.name,
                    onClick: function (e) { e.stopPropagation(); inject(s, '/' + sk.name); closeSkillPop() },
                    onMouseEnter: function (e) {
                      const r = e.currentTarget.getBoundingClientRect()
                      // 浮层实宽 = maxWidth 220 + 左右内边距 16 + 边框 2 = 238（翻转阈值与实宽对齐，避免贴边）
                      let tip = { x: r.right + 8, y: r.top + r.height / 2, name: sk.name }
                      if (typeof window !== 'undefined' && tip.x + 238 > window.innerWidth) tip = { x: r.left - 8 - 238, y: r.top + r.height / 2, name: sk.name }
                      s.skillHover = sk.name
                      s.skillTip = tip
                      emit(s)
                    },
                    onMouseLeave: function () { if (s.skillHover !== null) { s.skillHover = null; s.skillTip = null; emit(s) } },
                    style: { padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: s.skillHover === sk.name ? 'var(--dsw-alias-label-primary,#e6edf3)' : 'var(--dsw-alias-label-secondary,#a1a1aa)', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace', background: s.skillHover === sk.name ? 'var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))' : 'transparent', borderLeft: s.skillHover === sk.name ? '2px solid #c084fc' : '2px solid transparent' }
                  }, sk.name)
                }),
                // 底部操作提示（替代被移除的列表标题位，保持顶部纯技能名）
                h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', padding: '5px 8px 2px', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', marginTop: 2, whiteSpace: 'nowrap' } }, tr('nav.skillHint')),
              ]),
            ]) : null,
          ]),
          // 快速悬浮提示：portal 到 document.body（issue #3·D1）——脱离状态栏子树，position:fixed 的
          //   视口坐标与 z-index 全局生效，不再被宿主输入区容器裁剪或压层
          s.skillTip && s.skillHover ? portalTop(h('div', { style: { position: 'fixed', left: s.skillTip.x, top: s.skillTip.y, transform: 'translateY(-50%)', maxWidth: 220, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)' } }, tr('skilldesc.' + s.skillTip.name))) : null,
        ])
        // 用户拍板 2026-08-16 + 2026-08-17：横幅移到状态栏上方；依赖链 gh → 登录 → setup → 技能，显示第一个缺失项
        const firstBlock = ghCliBad ? 'ghcli' : ghAuthBad ? 'ghauth' : amber ? 'setup' : skillsBad ? 'skills' : null
        // #16 v1.6.4 R4：wrapper 加 overflow:hidden 截掉 capsule 溢出 wrapper 部分（dn=0..3 中间状态时 children 居中后左右可能溢出 wrapper）
        // #16 R6b：去掉 alignItems:'stretch'（之前为了拉伸 capsule 撑满 wrapper 高度，反而让父级
//   composerHero 297px 高传给 wrapper 后，capsule 被拉成与 wrapper 同高 ≈9.5px，文字被截掉）
        // #16 R12（本次）：宿主 conversation.input.dock 插槽 = composerStack（column flex），wrapper 是 flex item，
//   默认 flex-shrink:1 → 输入区高度被压缩时 wrapper 被压扁（wrapper 11px → capsule 8px → overflow:hidden 裁文字）。
//   R6b 只防了「被拉高」，没防「被压矮」；故加 flex:'none'（flex:0 0 auto）双保险。
// #22：正常路径由 portal 脱离裁剪；若 ReactDOM 不可用，退化节点必须不再被本 wrapper 立即裁掉。
        if (!firstBlock) return h('div', { style: { display: 'flex', flex: 'none', justifyContent: 'center', width: '100%', boxSizing: 'border-box', padding: '3px 8px 0', overflow: RDOM ? 'hidden' : 'visible' } }, [capsule])
        const bann = function (text, btnLabel, onBtn) {
          return h('div', { className: 'dsws-banner warn', style: { margin: 0, maxWidth: 560, cursor: 'default' } }, [
            Ic({ n: 'alert', size: 13 }),
            h('span', { style: { flex: 1 } }, text),
            h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: onBtn }, btnLabel),
          ])
        }
        return h('div', { style: { display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '3px 8px 0' } }, [
          firstBlock === 'ghcli'
            ? bann(tr('banner.ghcli'), tr('banner.ghcliBtn'), function () { openUrl('https://cli.github.com/') })
            : firstBlock === 'ghauth'
              ? bann(tr('banner.ghauth'), tr('banner.ghauthBtn'), function () { openUrl('https://cli.github.com/manual/gh_auth_login') })
              : firstBlock === 'setup'
                ? bann(tr('banner.setup'), tr('banner.setupBtn'), function () { inject(s, promptText('setupRun')) })
                : bann(tr('banner.skills', { list: (skillsCheck && skillsCheck.detail) || '' }), tr('banner.skillsBtn'), function () { inject(s, promptText('installSkills')) }),
          capsule,
        ])
      }

      // ============================================================
    // T17：issue 正文 markdown 白名单渲染（mdToHtml）
    //   只认白名单语法，其余一律纯文本（不渲染原始 HTML，防 XSS）
    //   输出标准 HTML 标签 → opencode-palette 主题自动上色（markdownHeading/Link/Code/Emph/Strong）
    //   返回值：React 元素数组（可直接作为 h(...) children）
    // ============================================================
    const MD_LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/g
    const MD_TASK_RE = /^- \[([ xX])\]\s*(.*)$/
    const mdEsc = function (s) { return String(s == null ? '' : s) }
    const mdInline = function (text, keyBase) {
      const out = []
      let rest = mdEsc(text)
      let k = 0
      // 先提取链接（防内部 ** 混淆；URL 协议白名单防 javascript:/data: 等危险协议）
      const linkParts = []
      const mdSafeUrl = function (u) {
        const s = String(u == null ? '' : u).trim()
        if (!s) return null
        if (/^(https?:|mailto:)/i.test(s)) return s
        if (/^[#/]/.test(s) || /^\.\.?\//.test(s)) return s
        if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return s
        return null
      }
      rest = rest.replace(MD_LINK_RE, function (m, label, url) {
        const u = mdSafeUrl(url)
        if (u === null) return label
        linkParts.push(h('a', { key: 'l' + (k++), href: u, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, mdInline(label, 'll' + k)))
        return '\u0001L' + (linkParts.length - 1) + '\u0001'
      })
      // 再处理加粗 / 斜体 / 行内代码（先解析段内链接占位符——链接可嵌在文本任意位置）
      rest.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60)/g).forEach(function (seg, si) {
        if (!seg) return
        if (seg.indexOf('\u0001') >= 0) {
          const re = /\u0001L(\d+)\u0001/g
          let last = 0
          let m
          while ((m = re.exec(seg)) !== null) {
            if (m.index > last) out.push(seg.slice(last, m.index))
            const n = parseInt(m[1], 10)
            if (!isNaN(n) && linkParts[n]) out.push(linkParts[n])
            else out.push(m[0])
            last = m.index + m[0].length
          }
          if (last < seg.length) out.push(seg.slice(last))
          return
        }
        const em = /^\*\*([^*]+)\*\*$/.exec(seg)
        if (em) { out.push(h('strong', { key: (keyBase || '') + 's' + (si) }, em[1])); return }
        const it = /^\*([^*]+)\*$/.exec(seg)
        if (it) { out.push(h('em', { key: (keyBase || '') + 'i' + (si) }, it[1])); return }
        const cd = /^\x60([^\x60]+)\x60$/.exec(seg)
        if (cd) { out.push(h('code', { key: (keyBase || '') + 'c' + (si), style: { fontFamily: 'var(--ds-font-family-code,Consolas,Menlo,monospace)', fontSize: '0.92em', padding: '0 3px', borderRadius: 4, background: 'var(--dsw-alias-markdown-code-block,rgba(255,255,255,.07))' } }, cd[1])); return }
        out.push(seg)
      })
      return out
    }
    const mdToHtml = function (md, opts) {
      const o = opts || {}
      const nodes = []
      const lines = String(md == null ? '' : md).split(/\r?\n/)
      let i = 0
      let k = 0
      const pushList = function (items) {
        if (!items.length) return
        nodes.push(h('ul', { key: 'ul' + (k++), style: { margin: '2px 0', paddingLeft: 16 } }, items.map(function (it, ii) {
          if (it.task !== null) {
            return h('li', { key: 'li' + ii, style: { listStyle: 'none', marginLeft: -14 } }, [
              h('input', { type: 'checkbox', checked: it.task === 'x' || it.task === 'X', disabled: true, style: { marginRight: 5, verticalAlign: 'middle' } }),
              h('span', null, mdInline(it.text, 't' + ii)),
            ])
          }
          return h('li', { key: 'li' + ii }, mdInline(it.text, 't' + ii))
        })))
      }
      while (i < lines.length) {
        const line = lines[i]
        const trim = line.trim()
        const h2 = /^##\s+(.+)$/.exec(trim)
        if (h2) { nodes.push(h('div', { key: 'h' + (k++), style: { fontSize: 14, fontWeight: 700, margin: '6px 0 3px', color: 'var(--dsw-alias-markdown-heading,var(--dsw-alias-label-primary,#e6edf3))', fontFamily: 'var(--dsw-font-markdown-h2,var(--dsw-font-family))' } }, mdInline(h2[1], 'h' + k))); i++; continue }
        const hr = /^---+$/.test(trim) || /^\*\*\*+$/.test(trim)
        if (hr) { nodes.push(h('hr', { key: 'hr' + (k++), style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l1,#2a2d35)', margin: '4px 0' } })); i++; continue }
        const q = /^>\s?(.*)$/.exec(trim)
        if (q) { nodes.push(h('blockquote', { key: 'bq' + (k++), style: { margin: '2px 0', paddingLeft: 8, borderLeft: '3px solid var(--dsw-alias-border-l1,#2a2d35)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, mdInline(q[1], 'q' + k))); i++; continue }
        // 列表（连续行归组）
        const listItems = []
        let j = i
        while (j < lines.length) {
          const lt = lines[j].trim()
          const taskM = MD_TASK_RE.exec(lt)
          const bullet = /^-\s+(.+)$/.exec(lt) || /^\*\s+(.+)$/.exec(lt)
          if (taskM) { listItems.push({ task: taskM[1], text: taskM[2] }); j++; continue }
          if (bullet) { listItems.push({ task: null, text: bullet[1] }); j++; continue }
          break
        }
        if (listItems.length) { pushList(listItems); i = j; continue }
        // 空行 / 普通段落
        if (trim === '') { i++; continue }
        nodes.push(h('div', { key: 'p' + (k++), style: { margin: '1px 0' } }, mdInline(line, 'p' + k)))
        i++
      }
      if (o.single) return nodes[0] || null
      return nodes
    }
    // ============================================================
    // v1.5 T12：票进度渲染（状态徽章 + 进度条）—— open/close 原生 + 进度自评
      const tStatus = function (t) {
        if (t.state === 'CLOSED') return { key: 'done', color: '#3fb950', icon: 'check' }
        if (t.progress === null || t.progress === undefined || t.progress <= 0) return { key: 'todo', color: '#8b8b95', icon: 'dot' } // B4：0% = 未动工（契约），不进 doing
        if (t.progress >= 100) return { key: 'accept', color: '#f59e0b', icon: 'alert' }
        if (t.progress >= 95) return { key: 'confirm', color: '#f59e0b', icon: 'alert' }
        return { key: 'doing', color: '#58a6ff', icon: 'dot' }
      }
      const tStatusLabel = function (t) {
        const s = tStatus(t)
        if (s.key === 'done') return tr('progress.done')
        if (s.key === 'accept') return tr('progress.accept')
        if (s.key === 'confirm') return tr('progress.confirm')
        if (s.key === 'doing') return tr('progress.doing', { n: t.progress })
        return tr('progress.todo')
      }
      const tProgressBar = function (t) {
        const p = (t.state === 'CLOSED') ? 100 : (t.progress === null || t.progress === undefined ? 0 : t.progress)
        const color = (t.state === 'CLOSED') ? '#3fb950' : (t.progress === null || t.progress === undefined ? '#52525b' : '#58a6ff')
        const label = (t.state === 'CLOSED') ? '100%' : (t.progress === null || t.progress === undefined ? '—' : t.progress + '%')
        return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 } }, [
          h('div', { style: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' } }, [
            h('div', { style: { width: String(p) + '%', height: '100%', background: color, borderRadius: 2 } }),
          ]),
          h('span', { style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums', minWidth: 26, textAlign: 'right' } }, label),
        ])
      }
      const tStatusBadge = function (t) {
        if (t.state === 'CLOSED') return null
        const s = tStatus(t)
        return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 2, color: s.color, fontSize: 9, flex: 'none' } }, [
          Ic({ n: s.icon, size: 8 }),
          h('span', null, tStatusLabel(t)),
        ])
      }

      // ---- 5.3 票务行（地图详情内：标题/阻塞来源 ellipsis；v19：按标签给 诊断/修复/讨论/执行 动作，预填输入框）----
      const TicketRow = ({ st, g, t, indent, colorOf }) => {
        const openBlocker = function (b) { const bt = g.m.tickets.find(function (x) { return x.number === b }); return bt && bt.state === 'OPEN' }
        const blocked = t.state === 'OPEN' && t.blockedBy.some(openBlocker)
        const subItem = (icon, color, text) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, color: color, minWidth: 0 } }, [
          Ic({ n: icon, size: 11 }),
          h('span', { className: 'dsws-ellip', style: { maxWidth: 200 }, title: text }, text),
        ])
        return h('div', { className: 'dsws-trow', style: indent ? { paddingLeft: 18 } : null }, [
          h('div', { className: 'dsws-tt' }, [
            h('div', { className: 'dsws-tt-name' }, [
              // T2 #3：编号前置
              h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)', fontSize: 11, flex: 'none' } }, '#' + t.number),
              TypeChip({ type: t.type }),
              h('span', { className: 'dsws-tt-wrap', style: { flex: 1 }, title: t.title }, t.title),
            ]),
            h('div', { className: 'dsws-tt-sub', style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
              t.claimedBy ? subItem('person', '#58a6ff', tr('map.subClaimed', { who: t.claimedBy })) : null,
              // #370：被阻塞 chip 只显示仍 OPEN 的阻塞者（与 compute/主列表/按钮抑制口径一致）
              blocked ? subItem('lock', '#f0883e', tr('map.subBlocked', { who: blockerNames(t, g.m) })) : null,
              t.state === 'CLOSED' ? subItem('check', '#3fb950', tr('map.subClosed')) : null,
              tStatusBadge(t),
            ]),
            (t.state === 'OPEN') ? tProgressBar(t) : null,
          ]),
          t.state === 'OPEN' ? h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flex: 'none' } }, [
            blocked ? null : mkRowAction(st, t, false, colorOf),
            // #361 能力保留（同 cwd + 自动命名 + 预填指令）；#394：去 ghost/icon-only，与 nav.handoff 解耦
            //   marginLeft:4 与左侧 mkRowAction 形成隐式分组（动作组 vs 辅助组）
            h('button', { className: 'dsws-btn primary', onClick: function (e) { e.stopPropagation(); openInNewSession(st, t) }, title: tr('list.newSessionLabel'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: actionColorOf(t, colorOf), borderColor: 'transparent', color: isLightHex(actionColorOf(t, colorOf)) ? '#140a1e' : '#ffffff' } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))]),
            h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '3px 6px' } }, Ic({ n: 'link', size: 12 })),
          ]) : h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' } }, tr('act.view')),
        ])
      }

      // ---- 5.4 地图详情（定稿 3A 垂直走廊：可接/已认领/被阻塞常显，已关闭折叠；阻塞缩进；v19 顶部执行 + 任务按状态动作）----
      const MapDetail = ({ st, g }) => {
        const m = g.m
        const colorOf = buildColorOf(st)
        const tickets = m.tickets || []
        const levels = (m.stats && m.stats.levels) || []
        const totalLayers = levels.length
        // 当前层 = 第一个含 open 票的层（无 open 全 done → 最后一层）
        const curLevel = (function () {
          for (let i = 0; i < levels.length; i++) { if (levels[i].open > 0) return i }
          return Math.max(0, levels.length - 1)
        })()
        const passedLayers = levels.filter(function (l, i) { return i < curLevel }).length
        const byLevel = {}
        tickets.forEach(function (t) { const lv = (typeof t.level === 'number') ? t.level : 0; (byLevel[lv] = byLevel[lv] || []).push(t) })
        // 迷雾：fog 票（Not yet specified）+ 被阻塞且其阻塞者 open 的票（半雾）；D7 视觉遮蔽
        const isFog = function (t) {
          if (t.state !== 'OPEN') return false
          const blk = (t.blockedBy || []).map(function (b) { return tickets.find(function (x) { return x.number === b }) }).filter(Boolean)
          return blk.some(function (b) { return b.state === 'OPEN' })
        }
        const fogTitles = (m.fog || []).map(function (f) { return String(f).trim() })
        const isFogTitle = function (t) { return fogTitles.some(function (f) { return f && t.title && t.title.indexOf(f) >= 0 }) }
        // v1.4：同层内排序 —— 可执行（open 且非迷雾）最左 → open 被阻塞 → 已关闭靠右（一眼看到当前能做什么）
        Object.keys(byLevel).forEach(function (lv) {
          byLevel[lv].sort(function (a, b) {
            const rank = function (t) {
              if (t.state === 'OPEN') return isFog(t) || isFogTitle(t) ? 1 : 0
              return 2
            }
            return rank(a) - rank(b) || a.number - b.number
          })
        })
        // 迷雾点击去雾状态（st 上按 map 存）
        st.reveal = st.reveal || {}
        const nodeCls = function (t) {
          let cls = 'dsws-node'
          if (t.state === 'CLOSED') cls += ' done'
          else if (t.level === curLevel) cls += ' now'
          const fog = isFog(t) || isFogTitle(t)
          if (fog) { cls += ' fog'; if (st.reveal[m.number] && st.reveal[m.number][t.number]) cls += ' revealed' }
          // R5：子票级变化高亮（issueFlash）
          if (st.issueFlash && st.issueFlash[t.number]) cls += st.issueFlash[t.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed'
          return cls
        }
        const toggleReveal = function (t) {
          st.reveal[m.number] = st.reveal[m.number] || {}
          st.reveal[m.number][t.number] = !(st.reveal[m.number][t.number])
          emit(st)
        }
        const gateState = function (layerIndex) {
          // 闸门：该层全 closed → open(绿✓)；层含 open 且在其之前层全 closed → open；否则 lock
          const lv = levels[layerIndex]
          if (!lv) return 'open'
          if (lv.closed === lv.total && lv.total > 0) return 'open'
          const prevAllClosed = levels.slice(0, layerIndex).every(function (p) { return p.closed === p.total })
          return prevAllClosed ? 'open' : 'lock'
        }
        const node = function (t) {
          const blocked = isFog(t)
          // T15：acts 恒渲染容器（CLOSED/fog 空占位）→ 卡片高度恒定
          const acts = h('div', { className: 'acts' }, (t.state === 'OPEN' && !blocked) ? [
            mkRowAction(st, t, false, colorOf),
            h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: t.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + t.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' } }, Ic({ n: 'link', size: 11 })),
          ] : [])
          const ic = t.type === 'research' ? 'search' : t.type === 'prototype' ? 'hammer' : t.type === 'grilling' ? 'chat' : 'gear'
          return h('div', {
            key: t.number,
            className: nodeCls(t),
            onClick: (isFog(t) || isFogTitle(t)) ? function (e) { e.stopPropagation(); toggleReveal(t) } : undefined,
          }, [
            h('div', { className: 'row1' }, [
              h('span', { className: 'icbox' }, Ic({ n: ic, size: 12 })),
              h('div', { style: { flex: 1, minWidth: 0 } }, [
                h('div', { className: 'meta' }, [
                  h('span', { className: 'no' }, '#' + t.number),
                  TypeChip({ type: t.type }),
                ]),
                h('div', { className: 'tt', title: t.title }, t.title),
                h('div', { className: 'sub', style: { fontSize: 8, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 1, minHeight: 12, display: 'flex', gap: 5, flexWrap: 'wrap' } }, [
                  t.state === 'CLOSED' ? h('span', { style: { color: '#3fb950', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'check', size: 8 }), h('span', null, tr('map.subClosed'))]) : null,
                  t.claimedBy ? h('span', { style: { color: '#58a6ff', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'person', size: 8 }), h('span', null, t.claimedBy)]) : null,
                  blocked ? h('span', { style: { color: '#f0883e', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'lock', size: 8 }), h('span', null, tr('map.subBlocked', { who: blockerNames(t, m) }))]) : null,
                ]),
                // v1.5 T12：进度条 + 状态徽章（open 票显示真实进度 · 修 0/13）
                tProgressBar(t),
                h('div', { style: { marginTop: 2, minHeight: 14, display: 'flex', alignItems: 'center', gap: 2 } }, [tStatusBadge(t)]),
              ]),
            ]),
            acts,
            (isFog(t) || isFogTitle(t)) ? h('svg', { className: 'qmark', viewBox: '0 0 24 24' }, [h('path', { d: 'M9.5 9a2.5 2.5 0 1 1 3.7 2.2c-.9.4-1.2 1-1.2 1.8' }), h('circle', { cx: '12', cy: '18', r: '.6' })]) : null,
          ])
        }
        const layerBlock = function (layerIndex) {
          const lv = levels[layerIndex]
          if (!lv) return null
          const layerTickets = byLevel[layerIndex] || []
          const gate = gateState(layerIndex)
          const isCur = layerIndex === curLevel
          // T15：层容器 + 明显层号（当前层高亮）；层内网格自适应
          return [
            h('div', { className: 'dsws-layerbox' + (isCur ? ' cur' : '') }, [
              h('div', { className: 'dsws-layerTag' }, [
                h('span', { className: 'dsws-layerNo' }, String(layerIndex + 1)),
                h('span', { className: 'dsws-layerTitle' }, tr('map.layer', { n: layerIndex + 1 }) + ' · ' + lv.open + ' open'),
                h('span', { className: 'sp' }),
              ]),
              h('div', { className: 'dsws-layer' }, layerTickets.map(function (t) { return node(t) })),
            ]),
            h('div', { className: 'dsws-gate' }, [
              h('span', { className: 'g ' + gate }, Ic({ n: gate === 'open' ? 'check' : 'lock', size: 12 })),
            ]),
          ]
        }
        // 完成态：全 closed → 进度条全绿 + 环满圈
        const allClosed = m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total
        const ringPct = allClosed ? 1 : (totalLayers ? Math.min(1, (passedLayers + 1) / totalLayers) : 0)
        const C = 2 * Math.PI * 31
        const ringOff = C * (1 - ringPct)
        return h('div', null, [
          // 顶部操作行：返回 + map chip + 执行/完成
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, [
            h('button', { className: 'dsws-btn', onClick: function () { st.activeMap = null; emit(st) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
              Ic({ n: 'back', size: 12 }),
              h('span', null, tr('list.back')),
            ]),
            h('span', { className: 'dsws-chip dsws-chip-m' }, [Ic({ n: 'map', size: 11 }), h('span', null, 'wayfinder:map')]),
            h('span', { style: { flex: 1 } }),
            (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
              ? h('button', { className: 'dsws-btn primary', title: tr('map.doneTitle'), onClick: function () {
                  const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                  inject(st, text)
                }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [
                  Ic({ n: 'check', size: 10 }),
                  h('span', null, tr('act.done')),
                ])
              : h('button', { className: 'dsws-btn primary', title: tr('map.executeTitle'), onClick: function () {
                  // v1.4：map 推进式执行（startText 检测 wayfinder:map → MAP_EXECUTE_PROMPT）
                  inject(st, startText(st, m))
                }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11 } }, [
                  Ic({ n: 'play', size: 10 }),
                  h('span', null, tr('act.execute')),
                ]),
            // v1.5 B2（O5）：详情页「在新会话打开」—— 与 执行/完成 同语义，开新会话推进该 map
            h('button', { className: 'dsws-btn ghost', title: tr('map.newSessionTitle'), onClick: function () { openInNewSession(st, m) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', fontSize: 11, flex: 'none' } }, [
              Ic({ n: 'external-link', size: 10 }),
              h('span', null, tr('list.newSessionLabel')),
            ]),
          ]),
          // T14：map 编号徽章 —— 标题前方、紫色、与列表 map 行同款（dsws-idnum）
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: 2 } }, [
            h('span', { className: 'dsws-idnum', style: { color: '#c084fc', borderColor: '#c084fc', flex: 'none' } }, '#' + m.number),
            h('div', { className: 'dsws-mtitle dsws-tt-wrap', style: { flex: 1, minWidth: 0 }, title: m.title }, m.title),
          ]),
          m.error ? h('div', { style: { color: '#f87171', fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, String((m.error && m.error.error) || tr('list.loadFail')).slice(0, 160))]) : null,
          // D2：分段静态进度条 = 地图层缩略图（无动画，唯一真相源）
          (levels.length > 0) ? h('div', { className: 'dsws-layers' }, [
            h('div', { className: 'row1' }, [
              h('span', { className: 'cap' }, tr('map.progressCap')),
              h('div', { className: 'segs' }, levels.map(function (l, i) {
                const segCls = i < curLevel ? 'seg past' : (i === curLevel ? 'seg curr' : 'seg future')
                return h('div', { key: i, className: segCls, title: tr('map.layer', { n: i + 1 }) })
              })),
            ]),
            h('div', { className: 'row2' }, [
              h('span', { className: 'cur' }, [Ic({ n: 'play', size: 9 }), h('span', null, tr('map.curLayer', { n: curLevel + 1 }))]),
              h('span', { className: 'pos' }, tr('map.layersPassed', { n: passedLayers, t: totalLayers })),
            ]),
          ]) : null,
          // T17 修订：Destination 走 markdown 渲染（**加粗** 等不再裸露；去 ellip 允许换行）
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }, [Ic({ n: 'target', size: 12, style: { marginTop: 2, flex: 'none' } }), h('div', { style: { flex: 1, minWidth: 0 } }, m.destination ? mdToHtml(m.destination) : tr('list.noDest'))]),
          // T17 修订：正文详情（Notes）默认折叠 —— <details> 收起，点击展开
          h('details', { style: { margin: '2px 0 4px' } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
              Ic({ n: 'note', size: 11 }),
              h('span', null, tr('map.notesCap')),
            ]),
            m.notes ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } }, mdToHtml(m.notes)) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 4, paddingLeft: 8 } }, tr('list.noNotes')),
          ]),
          // 漏斗分层主体
          h('div', { style: { marginTop: 2 } }, [
            h('div', { className: 'dsws-start' }, [
              h('span', { className: 'cap' }, tr('map.startCap')),
            ]),
            levels.map(function (l, i) { return layerBlock(i) }),
            // D3：Destination 72px 仪式环（环心旗帜，无数字）
            h('div', { className: 'dsws-dest' }, [
              h('div', { className: 'ring' }, [
                h('svg', { width: 72, height: 72, viewBox: '0 0 72 72' }, [
                  h('circle', { className: 'track', cx: 36, cy: 36, r: 31 }),
                  h('circle', { className: 'prog', cx: 36, cy: 36, r: 31, strokeDasharray: String(C), strokeDashoffset: String(ringOff) }),
                ]),
                h('div', { className: 'core' }, h('svg', { viewBox: '0 0 24 24' }, [h('path', { d: 'M5 3v18' }), h('path', { d: 'M5 4c4-2 6 2 12 0v9c-6 2-8-2-12 0' })])),
              ]),
              h('div', { className: 'title' }, tr('map.destCap')),
              h('div', { className: 'acts' }, [
                // v1.4：底部按钮与顶部同语义 —— 完成态「完成」（COMPLETE_PROMPT 同列表）/ 未完成「执行」（execute 模板）
                (m.stats && m.stats.total > 0 && m.stats.closed === m.stats.total)
                  ? h('button', { className: 'dsws-btn primary', title: tr('map.doneTitle'), onClick: function () {
                      const text = completePrompt(st, m.number, m.stats.total, m.stats.closed)
                      inject(st, text)
                    }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 700 } }, [
                      Ic({ n: 'check', size: 11 }),
                      h('span', null, tr('act.done')),
                    ])
                  : h('button', { className: 'dsws-btn primary', title: tr('map.executeTitle'), onClick: function () {
                      // v1.4：map 推进式执行（startText 检测 wayfinder:map → MAP_EXECUTE_PROMPT）
                      inject(st, startText(st, m))
                    }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 11, background: '#4ade80', borderColor: 'transparent', color: '#04120a', fontWeight: 700 } }, [
                      Ic({ n: 'play', size: 11 }),
                      h('span', null, tr('act.execute')),
                    ]),
                h('a', { className: 'dsws-btn ghost', href: 'https://github.com/' + repoStr(st) + '/issues/' + m.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 11 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('map.archive'))]),
              ]),
            ]),
          ]),
          // 折叠块：Decisions / Fog / Out of scope（保留信息展示）
          h('details', { style: { marginTop: 10, marginBottom: 4 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.decisions', { n: m.decisions.length })),
            h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.decisions.map(function (d, i) {
              return h('div', { key: i, style: { margin: '2px 0' } }, [
                h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '· '),
                (d.url ? h('a', { href: d.url, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'underline' } }, d.title) : h('span', null, d.title)),
                d.gist ? h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, ' — ' + d.gist) : null,
              ])
            })),
          ]),
          h('details', { style: { marginBottom: 4 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.fog', { n: m.fog.length })),
            h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.fog.map(function (f, i) {
              return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + f))
            })),
          ]),
          h('details', { style: { marginBottom: 4 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.outOfScope', { n: m.outOfScope.length })),
            h('div', { style: { fontSize: 12, paddingLeft: 8 } }, m.outOfScope.map(function (o, i) {
              return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + o))
            })),
          ]),
        ])
      }

      // ---- 5.5 主列表（v14：三选一动作 / map 行突出 + 开始执行 / 已关闭折叠行 / chips 深边框 / 窄屏双栏）----
      // v1.3.3 UI：行2 标签贪心折叠 —— 渲染后测量可用宽度，逐个放标签，放不下的隐藏进 +N（单行不换行）
      const _tagsFpOf = (typeof WeakMap !== 'undefined') ? new WeakMap() : { get: function () { return undefined }, set: function () { } }
      const fitAllTags = function () {
        if (typeof document === 'undefined') return
        document.querySelectorAll('.dsws-tags').forEach(function (tags) {
          const more = tags.querySelector('.dsws-more')
          if (!more) return
          const chips = Array.prototype.slice.call(tags.querySelectorAll('.dsws-chip:not(.dsws-more):not(.dsws-blocked)'))
          chips.forEach(function (c) { c.style.display = 'inline-flex' })
          more.style.display = 'inline-flex'
          const avail = tags.clientWidth
          const moreW = more.offsetWidth
          const gap = 3
          const room = avail - moreW - gap
          let used = 0, shown = 0
          chips.forEach(function (c, i) {
            const w = c.offsetWidth
            if (used + w <= room || i === 0) { c.style.display = 'inline-flex'; used += w + gap; shown++ }
            else c.style.display = 'none'
          })
          const hidden = chips.length - shown
          more.textContent = '+' + hidden
          more.style.display = hidden > 0 ? 'inline-flex' : 'none'
        })
      }
      // v1.3.3 UI：+N 弹窗 —— fixed 定位，基准 = 面板容器 rect（左右 clamp 不越界，上下自动翻转避让）
      const showPop = function (trig, host, labels, title) {
        if (typeof document === 'undefined') return
        const old = document.getElementById('dsws-pop')
        if (old && old.parentNode) old.parentNode.removeChild(old)
        const pop = document.createElement('div')
        pop.id = 'dsws-pop'
        pop.className = 'dsws-pop'
        const pt = document.createElement('div'); pt.className = 'pt'
        pt.textContent = tr('list.tagsCount', { n: labels.length })
        const pl = document.createElement('div'); pl.className = 'pl'
        labels.forEach(function (l) {
          const s = document.createElement('span')
          s.className = 'dsws-chip'
          s.style.background = hexA(l.color, 0.18) || 'rgba(188,140,255,.16)'
          s.style.color = l.color ? '#' + l.color : '#bc8cff'
          s.style.border = '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)')
          s.textContent = l.name
          pl.appendChild(s)
        })
        const ptitle = document.createElement('div'); ptitle.className = 'ptitle'
        ptitle.innerHTML = '<b>' + tr('list.popTitle') + '：</b>' + String(title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        pop.appendChild(pt); pop.appendChild(pl); pop.appendChild(ptitle)
        document.body.appendChild(pop)
        const pr = host ? host.getBoundingClientRect() : { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 }
        const pad = 8
        const maxW = Math.max(120, pr.right - pr.left - pad * 2)
        pop.style.maxWidth = maxW + 'px'
        pop.style.display = 'block'
        const r = trig.getBoundingClientRect()
        const pw = pop.offsetWidth, ph = pop.offsetHeight
        let left = Math.max(pr.left + pad, Math.min(r.left, pr.right - pw - pad))
        let top = r.bottom + 10, flip = false
        if (top + ph > window.innerHeight - 8) { top = r.top - ph - 10; flip = true }
        if (top < 8) { top = r.bottom + 10; flip = false }
        if (top < pr.top + pad && !flip) { top = pr.top + pad }
        pop.style.left = left + 'px'
        pop.style.top = top + 'px'
        const caret = document.createElement('div'); caret.className = 'caret'
        const cx = r.left + r.width / 2 - left
        caret.style.left = Math.max(6, Math.min(cx - 5, pw - 16)) + 'px'
        caret.style.top = flip ? 'auto' : '-6px'
        caret.style.bottom = flip ? '-6px' : 'auto'
        if (flip) {
          caret.style.borderLeft = 'none'; caret.style.borderTop = 'none'
          caret.style.borderRight = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderBottom = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
          caret.style.transform = 'rotate(225deg)'
        } else {
          caret.style.borderLeft = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'; caret.style.borderTop = '1px solid var(--dsw-alias-border-l2,#3a3f4a)'
          caret.style.borderRight = 'none'; caret.style.borderBottom = 'none'
          caret.style.transform = 'rotate(45deg)'
        }
        pop.appendChild(caret)
        const close = function () { if (pop.parentNode) pop.parentNode.removeChild(pop); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('scroll', onScroll, true) }
        const onDoc = function (ev) { if (pop.contains(ev.target)) return; close() }
        const onScroll = function () { close() }
        document.addEventListener('mousedown', onDoc, true)
        document.addEventListener('scroll', onScroll, true)
        pop._close = close
      }
      // ============ T2 #35 · NoRepo 红卡 + 表单（ListTab 首屏最优先 · 触发= checkRepo:bad && !dismissed）============
      const NoRepoCard = function (props) {
        const st = props.st
        const card = ensureNoRepoCard(st)
        const cs = activeChecks(st)
        const checkRepo = cs.find(function (c) { return c.id === 1 })
        const repoBad = !!(checkRepo && checkRepo.level === 'bad')
        const dismissed = isNoRepoDismissed(st.cwd)
        const show = repoBad && !dismissed
        if (!show) return null
        const isValid = isNoRepoNameValid(card.name)
        const doDismiss = function () { setNoRepoDismissed(st.cwd, true); card.expanded = false; emit(st) }
        const doExpand = function () { if (!card.name) card.name = cwdBasename(st.cwd); card.expanded = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
        const doCollapse = function () { card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st) }
        const doSubmit = function () {
          if (!isNoRepoNameValid(card.name)) { card.errorKind = 'bad-name'; card.error = tr('panel.noRepoErr.bad-name'); card.errorRepoUrl = ''; emit(st); return }
          card.loading = true; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
          rpcCall('initPublish', { cwd: st.cwd, name: card.name, visibility: card.visibility }).then(function (res) {
            card.loading = false
            if (res && res.ok) {
              const repoStr2 = res.repo && res.repo.owner ? res.repo.owner + '/' + res.repo.name : (res.repo && res.repo.name ? res.repo.name : card.name)
              flash(st, tr('panel.noRepoCreateSuccess', { repo: repoStr2 }), 'ok')
              card.expanded = false; card.error = ''; card.errorKind = ''; card.errorRepoUrl = ''; emit(st)
              rpcCall('refresh', st.cwd ? { cwd: st.cwd } : {}).then(function(snap){ if(snap && snap.ok){ st.snapshot=snap; st.snapMode='real'; emit(st)} }).catch(function(){})
              rpcCall('status', Object.assign({}, st.cwd ? { cwd: st.cwd } : {}, { force: true, lang: (typeof promptLang==='function'?promptLang():'zh') })).then(function(r){ if(r && r.checks){ st.checks=r.checks; st.checksMode='real'; emit(st)} }).catch(function(){})
            } else {
              const kind = (res && res.errorKind) || 'unknown'
              const raw = (res && res.error) || ''
              card.errorKind = kind
              card.errorRepoUrl = (res && res.repoUrl) || ''
              const key = 'panel.noRepoErr.' + kind
              const mapped = tr(key)
              const base = (mapped !== key) ? mapped : (raw ? String(raw).slice(0, 160) : tr('panel.noRepoErr.unknown'))
              card.error = base + (raw && base !== String(raw).slice(0, 160) && mapped !== raw ? ' · ' + String(raw).slice(0, 120) : '')
              emit(st)
            }
          }).catch(function (e) {
            card.loading = false; card.errorKind = 'unknown'; card.error = String((e && e.message) || e).slice(0, 200); card.errorRepoUrl = ''; emit(st)
          })
        }
        return h('div', { className: 'dsws-no-repo-card' }, [
          h('div', { className: 'head' }, [
            Ic({ n: 'alert', size: 13, color: '#f87171' }),
            h('div', { style: { flex: 1, minWidth: 0 } }, [
              h('div', { className: 'ttl' }, tr('panel.noRepoCardTitle')),
              h('div', { className: 'desc' }, tr('panel.noRepoCardDesc')),
            ]),
            h('button', { className: 'dsws-btn ghost', title: tr('panel.noRepoCardDismiss'), onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { padding: '2px 6px', flex: 'none' } }, Ic({ n: 'x', size: 12 })),
          ]),
          h('div', { className: 'acts' }, !card.expanded ? [
            h('button', { className: 'dsws-btn primary', onClick: doExpand, style: { background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardAction')),
            h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); doDismiss() }, style: { fontSize: 11, padding: '3px 10px' } }, tr('panel.noRepoCardDismiss')),
          ] : null),
          card.expanded ? h('div', { className: 'dsws-no-repo-form' }, [
            h('div', { className: 'row' }, [
              h('label', null, tr('panel.noRepoFormName')),
              h('input', { type: 'text', value: card.name, placeholder: cwdBasename(st.cwd), onChange: function (e) { card.name = e.target.value; if (card.errorKind === 'bad-name') { card.error = ''; card.errorKind = '' } emit(st) } }),
            ]),
            h('div', { className: 'hint', style: (!isValid && card.name) ? { color: '#f87171' } : null }, tr('panel.noRepoFormNameHint')),
            h('div', { className: 'row' }, [
              h('label', null, tr('panel.noRepoFormVisibility')),
              h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' } }, [
                h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'private', onChange: function () { card.visibility = 'private'; emit(st) } }),
                h('span', null, tr('panel.noRepoFormPrivate')),
              ]),
              h('label', { className: 'radio', style: { display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginLeft: 12 } }, [
                h('input', { type: 'radio', name: 'noRepoVis-' + (st.cwd || 'x'), checked: card.visibility === 'public', onChange: function () { card.visibility = 'public'; emit(st) } }),
                h('span', null, tr('panel.noRepoFormPublic')),
              ]),
            ]),
            card.error ? (function () {
              const kind = card.errorKind || 'unknown'
              const isWarn = kind === 'no-git' || kind === 'no-gh' || kind === 'not-logged-in' || kind === 'network'
              const bg = isWarn ? 'rgba(245,158,11,.12)' : 'rgba(248,113,113,.12)'
              const bd = isWarn ? 'rgba(245,158,11,.45)' : 'rgba(248,113,113,.45)'
              const col = isWarn ? '#fbbf24' : '#f87171'
              return h('div', { className: 'err', style: { background: bg, border: '1px solid ' + bd, color: col, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } }, [
                Ic({ n: 'alert', size: 11, color: col }),
                h('span', { style: { marginLeft: 4, flex: '1 1 auto' } }, card.error),
                kind === 'no-git' ? h('a', { href: 'https://git-scm.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '下载') : null,
                kind === 'no-gh' ? h('a', { href: 'https://cli.github.com/', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '下载') : null,
                kind === 'not-logged-in' ? h('a', { href: 'https://cli.github.com/manual/gh_auth_login', target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去登录') : null,
                kind === 'already-exists' ? h('a', { href: card.errorRepoUrl || ('https://github.com/search?q=' + encodeURIComponent(card.name)), target: '_blank', rel: 'noreferrer', style: { marginLeft: 8, color: '#58a6ff', textDecoration: 'underline', fontSize: 11 } }, '去查看') : null,
                kind === 'network' ? h('button', { onClick: doSubmit, disabled: card.loading, style: { marginLeft: 8, background: 'transparent', color: col, border: '1px solid ' + col, borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 } }, '重试') : null,
              ])
            })() : null,
            h('div', { className: 'row', style: { marginTop: 8 } }, [
              h('button', { className: 'dsws-btn primary', disabled: card.loading || !isValid, onClick: doSubmit, style: { opacity: (!isValid || card.loading) ? 0.6 : 1, background: '#f87171', borderColor: 'transparent', color: '#fff', fontWeight: 600, fontSize: 11, padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
                card.loading ? h('span', { className: 'dsws-spinner', style: { width: 12, height: 12, borderWidth: 2, display: 'inline-block', verticalAlign: '-2px' } }) : null,
                h('span', null, card.loading ? tr('panel.noRepoFormSubmitting') : tr('panel.noRepoFormSubmit')),
              ]),
              h('button', { className: 'dsws-btn', onClick: doCollapse, disabled: card.loading, style: { marginLeft: 6, fontSize: 11, padding: '4px 10px' } }, tr('panel.noRepoFormCancel')),
            ]),
          ]) : null,
        ])
      }
      const ListTab = ({ st, narrow }) => {
        // v1.3.3 UI：每次渲染后执行贪心折叠（含窗口/列宽变化后的重渲染）
        // v1.5 T10 提速：按内容指纹跳过 —— 仅快照内容/tab/过滤变化才重排（refreshing 态等无关渲染不触发布局测量）
        React.useLayoutEffect(function () {
          const fp = String((st.snapshot && st.snapshot.generatedMs) || '') + '|' + st.tab + '|' + st.stateFilter + '|' + (st.lblFilters || []).join(',')
          if (_tagsFpOf.get(st) === fp) return
          _tagsFpOf.set(st, fp)
          fitAllTags()
        })
        const issues = (st.snapshot && Array.isArray(st.snapshot.issues)) ? st.snapshot.issues : []
        const openIssues = issues.filter(function (x) { return x.state !== 'CLOSED' })
        const closedIssues = issues.filter(function (x) { return x.state === 'CLOSED' })
        // #374：多维排序 —— map 行恒置顶，map 组与普通组各自按所选维度排序；默认 更新时间↓（与现状一致）
        const sortIssues = function (arr) {
          const dir = st.sortDir === 'asc' ? 1 : -1
          return arr.slice().sort(function (a, b) {
            let c
            if (st.sortKey === 'number') { c = a.number - b.number; if (c !== 0) return dir * c }
            else if (st.sortKey === 'title') {
              c = String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase())
              if (c !== 0) return dir * c
            } else {
              c = String(a[st.sortKey] || '').localeCompare(String(b[st.sortKey] || ''))
              if (c !== 0) return dir * c
            }
            return a.number - b.number  // 同键兜底：编号升序（稳定）
          })
        }
        const isMapIssue = function (x) { return (x.labels || []).some(function (l) { return l.name === 'wayfinder:map' }) }
        const sortedMaps = sortIssues(openIssues.filter(isMapIssue))
        const sortedOpen = sortIssues(openIssues.filter(function (x) { return !isMapIssue(x) }))
        const closedSorted = sortIssues(closedIssues)
        const groups = compute(st)
        const occ = groups.reduce(function (n, g) { return n + g.blocked.length + g.claimed.length }, 0)
        const cs = activeChecks(st)
        const nBad = cs.filter(function (c) { return c.level === 'bad' }).length
        // 标签统计（open + closed 全量）与配色
        const stat = {}
        const colorOf = {}
        issues.forEach(function (x) {
          (x.labels || []).forEach(function (l) {
            stat[l.name] = (stat[l.name] || 0) + 1
            if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color
          })
        })
        const tagNames = Object.keys(stat).sort(function (a, b) { return stat[b] - stat[a] })
        // #375：全量 label（快照 labels 字段优先；旧快照无该字段降级 issue 统计）；配色并入 label 列表色
        const snapLabels = (st.snapshot && Array.isArray(st.snapshot.labels)) ? st.snapshot.labels : null
        if (snapLabels) snapLabels.forEach(function (l) { if (l.color && !colorOf[l.name]) colorOf[l.name] = l.color })
        const labelNames = snapLabels ? snapLabels.map(function (l) { return l.name }) : tagNames.slice()
        // 点击记忆双键排序：次数降序 → 最近点击降序 → 出现频次降序 → 名称序
        const sortedLabels = labelNames.slice().sort(function (a, b) {
          const ca = labelClicks[a], cb = labelClicks[b]
          const na = ca ? ca.n : 0, nb = cb ? cb.n : 0
          if (na !== nb) return nb - na
          const ta = ca ? ca.ts : 0, tb = cb ? cb.ts : 0
          if (ta !== tb) return tb - ta
          const fa = stat[a] || 0, fb = stat[b] || 0
          if (fa !== fb) return fb - fa
          return String(a).localeCompare(String(b))
        })
        // v15-26：主列表关联 map 子票阻塞信息（open 阻塞者才算阻塞；数据来自快照 maps.tickets.blockedBy，无需额外请求）
        const blockOf = {}
        ;(st.snapshot && st.snapshot.maps || []).forEach(function (m) {
          const byNum = {}
          m.tickets.forEach(function (t) { byNum[t.number] = t })
          m.tickets.forEach(function (t) {
            if (!t.blockedBy || !t.blockedBy.length) return
            const openBlockers = t.blockedBy.filter(function (b) { const bt = byNum[b]; return bt && bt.state === 'OPEN' })
            if (openBlockers.length) blockOf[t.number] = { map: m.number, mapTitle: m.title, by: openBlockers }
          })
        })
        // #374：状态过滤（全部/Open/阻塞/已关闭）与 label 过滤叠加
        // v1.3.3 T3：blocked 过滤真正实现 —— open 且存在 open 阻塞者（blockOf 命中）
        const showOpen = st.stateFilter !== 'closed'
        const showClosedList = st.stateFilter === 'closed'
        // v1.5：多选标签过滤（OR 语义：命中任一选中标签即显示）
        const byLabel = function (x) {
          const ls = st.lblFilters || []
          if (!ls.length) return true
          return (x.labels || []).some(function (l) { return ls.indexOf(l.name) >= 0 })
        }
        const openRows = sortedMaps.concat(sortedOpen)
        const openFiltered = (st.lblFilters && st.lblFilters.length) ? openRows.filter(byLabel) : openRows
        // v1.3.3 #6：阻塞 = 被占用口径（isOccupied：有 assignee 或存在 open 阻塞者）——与 KPI「占用 N」一致
        const filteredOpen = showOpen ? (st.stateFilter === 'blocked' ? openFiltered.filter(function (x) { return isOccupied(st, x) })
          : (st.stateFilter === 'frontier' ? openFiltered.filter(function (x) { return !isOccupied(st, x) }) : openFiltered)) : []
        const filteredClosed = showClosedList ? ((st.lblFilters && st.lblFilters.length) ? closedSorted.filter(byLabel) : closedSorted) : []
        const has = function (x, nm) { return (x.labels || []).some(function (l) { return l.name === nm }) }
        const findMap = function (num) { return (st.snapshot && st.snapshot.maps || []).find(function (m) { return m.number === num }) }
        const openBlocked = function (blk) { st.activeMap = blk.map; emit(st) }
        // v14-18：chips 常显深一档边框（边框色 = label 色 HSL 亮度 -16%）
        const chip = (nm, withCount, on, isAll) => {
          const c = colorOf[nm]
          const borderColor = isAll ? 'rgba(255,255,255,.35)' : (darken(c, 0.16) || 'rgba(188,140,255,.6)')
          const selColor = isAll ? 'rgba(255,255,255,.65)' : (c ? '#' + c : '#bc8cff')
          return h('span', {
            key: nm,
            className: 'dsws-chip',
            // v14-1：「全部」恒清空过滤并保持选中，与普通标签 toggle 语义分离
            // #375：点选即记点击记忆（次数 + 最近点击时间，双键排序）
            onClick: function (e) {
              e.stopPropagation()
              // v1.5：多选 toggle —— 选中/取消单个标签，互不覆盖
              const cur = st.lblFilters || []
              st.lblFilters = isAll ? [] : (cur.indexOf(nm) >= 0 ? cur.filter(function (x) { return x !== nm }) : cur.concat([nm]))
              if (!isAll) {
                const c = labelClicks[nm] || { n: 0, ts: 0 }
                labelClicks[nm] = { n: c.n + 1, ts: Date.now() }
                saveLabelClicks()
              }
              emit(st)
            },
            style: {
              cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10,
              background: isAll ? 'rgba(255,255,255,.08)' : (hexA(c, 0.18) || 'rgba(188,140,255,.16)'),
              color: isAll ? 'var(--dsw-alias-label-secondary,#a1a1aa)' : (c ? '#' + c : '#bc8cff'),
              border: '1px solid ' + (on ? selColor : borderColor),
            },
          }, nm)
        }
        const copyUrl = function (x) { copyText(st, 'https://github.com/' + repoStr(st) + '/issues/' + x.number, tr('toast.copiedLink', { n: x.number })) }
        // v14-4：行级动作按 label 四选一（诊断/修复/讨论/执行），全部预填输入框；
        // v19：共享 mkRowAction（列表与 map 详情同逻辑，按钮色动态取 label 配置色）；v14-3 按钮 80%；v14-19 窄屏折叠为纯图标
        // v1.3.3 UI 定稿（用户逐版确认）：两行结构 · 卡片风（C）· 编号/map 竖排（idcol）·
        //   行1 = 编号(上)+map徽章(下) 竖排 + 标题(占满,限2行) + 迷你圆环进度(右上)；
        //   行2 = 标签单行贪心折叠（宽多窄少,最少1个,放不下进 +N 弹窗）+ 按钮组（执行/完成/新会话常显,复制/外链 hover）
        //   +N 弹窗：fixed 定位,基准=面板容器,clamp 左右不越界,内容完整可见（用户验收 A 方案）
        const ringOf = function (stats) {
          const total = stats.total || 0, closed = stats.closed || 0
          const pct = total ? Math.round(closed / total * 100) : 0
          const C = 2 * Math.PI * 7
          const off = C * (1 - pct / 100)
          const color = pct >= 100 ? '#4ade80' : '#bc8cff'
          return h('span', { className: 'dsws-ring' }, [
            h('svg', { width: 18, height: 18, viewBox: '0 0 18 18' }, [
              h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: 'rgba(255,255,255,.12)', strokeWidth: 2.4 }),
              h('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round', strokeDasharray: String(C), strokeDashoffset: String(off) }),
            ]),
            h('span', { className: 'dsws-ring-txt', style: { color: color } }, closed + '/' + total),
          ])
        }
        const issueRow = function (x, isOpen, narrow) {
          const isMap = has(x, 'wayfinder:map')
          const mapObj = isMap ? findMap(x.number) : null
          // v15-26：被阻塞判定（open 阻塞者）→ 隐藏动作按钮 + 红色「被阻塞」标签（点击跳所属 map 详情）
          const blk = blockOf[x.number]
          const blocked = !!(blk && blk.by && blk.by.length)
          // v1.3.3 #8：map 行完成态 —— 子票全关（total>0 且 closed===total）→ 主按钮切「完成」（绿），注入收尾确认 prompt
          const mapDone = !!(isMap && mapObj && mapObj.stats && mapObj.stats.total > 0 && mapObj.stats.closed === mapObj.stats.total)
          // v1.5：编号徽章颜色 = 右侧动作按钮同一逻辑（label 色；map 完成态绿）
          const numColor = mapDone ? '#3fb950' : actionColorOf(x, colorOf)
          // v1.3.3 UI：全部标签渲染（渲染后贪心折叠，放不下的隐藏进 +N；+N 弹窗显示全部）
          const labels = x.labels || []
          const allNames = labels.map(function (l) { return l.name }).join('、')
          const openPop = function (e) {
            e.stopPropagation()
            const trig = e.currentTarget
            const host = trig.closest('.dsws-panel') || trig.closest('[data-dsws-host]')
            showPop(trig, host, labels, x.title)
          }
          return h('div', {
            key: x.number,
            // R5：变化行视觉（变更琥珀渐隐 / 新增绿闪）
            className: 'dsws-aggrow' + ((st.rowFlash && st.rowFlash[x.number]) ? (st.rowFlash[x.number] === 'added' ? ' dsws-row-added' : ' dsws-row-changed') : ''),
            onClick: function () { if (isMap && mapObj) { st.activeMap = x.number; emit(st) } },
            title: (isMap && mapObj) ? tr('list.mapTitle') : undefined,
            style: isMap ? { cursor: 'pointer', borderLeft: '3px solid #c084fc', background: 'rgba(188,140,255,.07)' } : undefined,
          }, [
            // 行1：idcol 竖排（编号上 map 徽章下）+ 标题 + 圆环进度
            h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%' } }, [
              h('span', { className: 'dsws-idcol' }, [
                isMap ? h('span', { className: 'dsws-chip dsws-chip-m', style: { fontSize: 11, fontWeight: 600, lineHeight: 1.7, padding: '0 8px' } }, [Ic({ n: 'map', size: 11 }), h('span', null, tr('list.mapChip'))]) : null,
                h('span', { className: 'dsws-idnum', style: { color: numColor, borderColor: numColor } }, '#' + x.number),
              ]),
              h('span', { className: 'dsws-tt-wrap', style: { flex: 1, fontWeight: isMap ? 600 : undefined, color: isOpen ? undefined : 'var(--dsw-alias-label-secondary,#a1a1aa)' }, title: x.title }, x.title),
              (isMap && mapObj && mapObj.stats) ? ringOf(mapObj.stats) : null,
              !isOpen ? h('span', { className: 'dsws-chip', style: { fontSize: 10, marginRight: 0, flex: 'none', background: 'rgba(139,139,149,.12)', color: '#8b8b95', border: '1px solid rgba(139,139,149,.35)' } }, [Ic({ n: 'check', size: 9 }), h('span', null, tr('map.subClosed'))]) : null,
            ]),
            // 行2：标签贪心折叠（单行不换行）+ 按钮组（常显）
            h('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, width: '100%' } }, [
              h('div', { className: 'dsws-tags', 'data-dsws-labels': JSON.stringify(labels.map(function (l) { return l.name })) }, [
                labels.map(function (l, i) {
                  return h('span', { key: i, className: 'dsws-chip', style: { fontSize: 10, background: hexA(l.color, 0.18) || 'rgba(188,140,255,.16)', color: l.color ? '#' + l.color : '#bc8cff', border: '1px solid ' + (darken(l.color, 0.16) || 'rgba(188,140,255,.6)') } }, l.name)
                }),
                labels.length > 0 ? h('span', { key: 'more', className: 'dsws-chip dsws-more', onClick: openPop, title: tr('list.tagsTitle', { names: allNames }) }, '+0') : null,
                blocked ? h('span', { key: 'blk', className: 'dsws-chip dsws-blocked', onClick: function (e) { e.stopPropagation(); openBlocked(blk) }, title: tr('list.blockedTitle', { by: blk.by.map(function (b) { return '#' + b }).join('、') }), style: { fontSize: 10, background: 'rgba(248,113,113,.16)', color: '#f87171', border: '1px solid rgba(248,113,113,.55)', cursor: 'pointer' } }, [Ic({ n: 'lock', size: 10 }), h('span', null, tr('list.blocked'))]) : null,
              ]),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 3, flex: 'none', marginLeft: 'auto' } }, [
                isOpen && !blocked ? h('div', { style: { display: 'flex', gap: 3, alignItems: 'center', flex: 'none' } }, [
                  mapDone
                    ? h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''), title: tr('map.doneTitle'), onClick: function (e) {
                        e.stopPropagation()
                        const text = completePrompt(st, x.number, mapObj.stats.total, mapObj.stats.closed)
                        inject(st, text)
                      }, style: { display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', background: '#3fb950', borderColor: 'transparent', color: '#0c1a10', fontWeight: 600 } }, [Ic({ n: 'check', size: 10 }), narrow ? null : h('span', null, tr('act.done'))])
                    : mkRowAction(st, x, narrow, colorOf),
                  h('button', { className: 'dsws-btn primary' + (narrow ? ' narrow-icon' : ''), onClick: function (e) { e.stopPropagation(); openInNewSession(st, x) }, title: tr('list.newSessionLabel'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: mapDone ? '#3fb950' : actionColorOf(x, colorOf), borderColor: 'transparent', color: mapDone ? '#0c1a10' : (isLightHex(actionColorOf(x, colorOf)) ? '#140a1e' : '#ffffff') } }, [Ic({ n: 'external-link', size: 10 }), narrow ? null : h('span', null, tr('list.newSessionLabel'))]),
                ]) : null,
                isOpen ? h('div', { className: 'dsws-aux', style: { display: 'flex', gap: 2, alignItems: 'center', flex: 'none' } }, [
                  // v1.3.3：复制/外链图标增大 11 → 13
                  h('button', { className: 'dsws-btn ghost', onClick: function (e) { e.stopPropagation(); copyUrl(x) }, title: tr('list.copyLinkTitle'), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'clipboard', size: 13 })),
                  h('a', { className: 'dsws-btn ghost', title: tr('list.openInGithubTitle', { n: x.number }), href: 'https://github.com/' + repoStr(st) + '/issues/' + x.number, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, Ic({ n: 'link', size: 13 })),
                ]) : null,
              ]),
            ]),
          ])
        }
        const kpi = (num, lab, icon, color) => h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, [Ic({ n: icon, size: 11, color: color }), h('span', null, String(num) + ' ' + lab)])
        return h('div', null, [
          // v1.5：已选标签过滤条（仅标签 · 颜色 = 该标签配置色 · 点 ✕ 关闭）
          (st.lblFilters && st.lblFilters.length) ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 6 } }, [
            h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none' } }, tr('list.filterActive')),
            (st.lblFilters || []).map(function (nm) {
              const c = colorOf[nm]
              const hex = c ? '#' + c : '#bc8cff'
              return h('span', { key: 'f-label-' + nm, className: 'dsws-chip', style: { fontSize: 10, background: hexA(c, 0.18) || 'rgba(188,140,255,.16)', color: hex, border: '1px solid ' + (darken(c, 0.16) || 'rgba(188,140,255,.6)') } }, [
                nm,
                h('span', { onClick: function (e) { e.stopPropagation(); st.lblFilters = (st.lblFilters || []).filter(function (x) { return x !== nm }); emit(st) }, style: { cursor: 'pointer', marginLeft: 4, fontWeight: 700 } }, '✕'),
              ])
            }),
            h('span', { key: 'f-label-clear', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.lblFilters = []; emit(st) }, style: { fontSize: 10, cursor: 'pointer', background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid rgba(255,255,255,.15)' } }, tr('list.filterClear')),
          ]) : null,
          // T2 #35 · 首屏最优先红卡（ListTab 顶部 · KPI 之上 · 唯一闸门 checkRepo:bad && !dismissed）
          h(NoRepoCard, { st: st }),
          // KPI 行 + 环境提示（v18-30：可接/占用 = 列表 open issue 口径）
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap', position: 'relative' } }, [
            kpi(frontierCount(st), tr('list.kpi.takeable'), 'target', '#4ade80'),
            kpi(occCount(st), tr('list.kpi.occupied'), 'lock', '#f0883e'),
            kpi(closedIssues.length, tr('list.kpi.closed'), 'check', '#52525b'),
            h('span', { style: { flex: 1 } }),
            // T2 #2：刷新按钮已上移至 OverlayPanel tabs 行
          ]),
          (function () { const cr = cs.find(function (c) { return c.id === 1 }); if (cr && cr.level === 'bad' && !isNoRepoDismissed(st.cwd)) return null; return nBad > 0 ? h('div', { className: 'dsws-banner bad', onClick: function () { st.tab = 'checks'; emit(st) } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('list.envWarn', { n: nBad }))]) : null })(),
          // #374/#375：状态过滤 + 排序 + label 过滤 chips（全部小号紧凑同排，窄屏换行不增高；展开态点选 label 不收起）
          h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0, marginBottom: 6 } }, [
            ['all', 'open', 'closed', 'blocked', 'frontier'].map(function (k) {
              const on = st.stateFilter === k
              return h('span', { key: 'stf-' + k, className: 'dsws-chip', onClick: function (e) {
                e.stopPropagation(); st.stateFilter = k; listPrefs.stateFilter = k; saveListPrefs(); emit(st)
              }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(188,140,255,.18)' : 'rgba(255,255,255,.06)', color: on ? '#c084fc' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(188,140,255,.6)' : 'rgba(255,255,255,.15)') } }, tr('list.state.' + k))
            }),
            h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
            ['updatedAt', 'createdAt', 'number', 'title'].map(function (k) {
              const on = st.sortKey === k
              const arrow = on ? (st.sortDir === 'asc' ? '↑' : '↓') : ''
              return h('span', { key: 'srt-' + k, className: 'dsws-chip', onClick: function (e) {
                e.stopPropagation()
                if (st.sortKey === k) { st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc' }
                else { st.sortKey = k; st.sortDir = (k === 'title') ? 'asc' : 'desc' }
                listPrefs.sortKey = st.sortKey; listPrefs.sortDir = st.sortDir; saveListPrefs(); emit(st)
              }, style: { cursor: 'pointer', marginRight: 4, marginBottom: 3, fontSize: 10, background: on ? 'rgba(88,166,255,.16)' : 'rgba(255,255,255,.06)', color: on ? '#58a6ff' : 'var(--dsw-alias-label-secondary,#a1a1aa)', border: '1px solid ' + (on ? 'rgba(88,166,255,.55)' : 'rgba(255,255,255,.15)') } }, tr('list.sort.' + k) + arrow)
            }),
            h('span', { style: { width: 1, height: 12, background: 'var(--dsw-alias-border-l1,#2a2d35)', margin: '0 4px 3px', flex: 'none' } }),
            chip(tr('list.all'), false, !st.lblFilters || !st.lblFilters.length, true),
            // #405：filter row 默认可见数 9 → 4（与 per-row 一致）；+N 触发条件 + 数字同步
            (st.expLabels ? sortedLabels : sortedLabels.slice(0, 4)).map(function (nm) { return chip(nm, true, (st.lblFilters || []).indexOf(nm) >= 0, false) }),
            (!st.expLabels && sortedLabels.length > 4) ? h('span', { key: 'lbl-more', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = true; emit(st) }, title: tr('list.tagsTitle', { names: sortedLabels.join('、') }), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px dashed rgba(188,140,255,.55)', cursor: 'pointer' } }, '+' + (sortedLabels.length - 4)) : null,
            st.expLabels ? h('span', { key: 'lbl-less', className: 'dsws-chip', onClick: function (e) { e.stopPropagation(); st.expLabels = false; emit(st) }, title: tr('list.tagsCollapseTitle'), style: { fontSize: 10, marginRight: 4, marginBottom: 3, background: 'rgba(255,255,255,.06)', color: 'var(--dsw-alias-label-caption,#8b8b95)', border: '1px dashed rgba(255,255,255,.3)', cursor: 'pointer' } }, tr('list.collapse')) : null,
          ]),
          // T3 #5：加载遮罩（替代单行文本，全屏遮罩 + 转圈 + 禁点）
          // v1.3.3 修复：加载遮罩仅首开无数据时显示（手动刷新已走静默路径，不再叠加）
          // #58 缓存优先：已有快照（本 store 或 per-cwd 缓存）时不显示全屏 loading，秒开旧列表 + 后台静默刷新
        (st.snapMode === 'loading' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { className: 'dsws-loading-shade', style: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 5, pointerEvents: 'auto' } }, [
          h('div', { className: 'dsws-spinner' }),
          h('span', { style: { fontSize: 12, color: '#e6edf3' } }, tr('list.loading')),
        ]) : null,
          (st.snapMode === 'err' && !st.snapshot && !getCachedSnapshot(st.cwd)) ? h('div', { style: { color: '#f87171', fontSize: 12, padding: '14px 0', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 12 }), h('span', null, tr('list.errFull', { err: st.snapError }))]) : null,
          st.snapMode === 'real' && st.snapshot && st.snapshot.fallback === 'rest' ? h('div', { style: { color: '#f59e0b', fontSize: 11, padding: '6px 12px', border: '1px solid rgba(245,158,11,.4)', borderRadius: 6, background: 'rgba(245,158,11,.08)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('list.restFallback'))]) : null,
          // #374：状态过滤渲染 —— open 主体 / closed 列表 / 「全部」态保留已关闭折叠行
          showOpen ? (filteredOpen.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredOpen.map(function (x) { return issueRow(x, true, narrow) })) : null,
          showClosedList ? (filteredClosed.length === 0 ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', padding: '14px 0', textAlign: 'center' } }, tr('list.none')) : filteredClosed.map(function (x) { return issueRow(x, false, narrow) })) : null,
          // v14-4⑤：列表底部「已关闭 (N)」折叠行（仅「全部」状态显示；默认收起，只占一行，展开可见）
          (st.stateFilter === 'all' && closedIssues.length) ? h('details', { style: { marginTop: 8 } }, [
            h('summary', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 2px', userSelect: 'none' } }, [
              Ic({ n: 'check', size: 11 }),
              h('span', null, tr('list.closedN', { n: closedIssues.length })),
            ]),
            h('div', null, closedSorted.map(function (x) { return issueRow(x, false, narrow) })),
          ]) : null,
        ])
      }

      // ---- 5.6 技能雷达（定稿 4A 推荐+列表 · 4B 圆形技能环，A/B 切换）----
      const RingSkills = ({ st, rec, list }) => {
        const cx = 110, cy = 108, R2 = 88
        const center = rec[0] || 'ask-matt'
        const ring = list.filter(function (sk) { return sk.name !== center }).slice(0, 8)
        const nodes = ring.map(function (sk, i) {
          const a = (i / ring.length) * Math.PI * 2 - Math.PI / 2
          const x = cx + R2 * Math.cos(a), y = cy + R2 * Math.sin(a)
          const filled = sk.level === 'ok'
          return h('div', { key: sk.name, title: tr('skilldesc.' + sk.name), onClick: function () { inject(st, '/' + sk.name) }, style: { position: 'absolute', left: x - 15, top: y - 15, width: 30, height: 30, borderRadius: '50%', border: filled ? '2px solid #4ade80' : '2px solid #52525b', background: filled ? 'rgba(74,222,128,.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, cursor: 'pointer', color: filled ? '#4ade80' : '#8b8b95', lineHeight: 1.2, textAlign: 'center' } }, sk.name.length > 4 ? sk.name.slice(0, 4) + '…' : sk.name)
        })
        return h('div', null, [
          h('div', { style: { position: 'relative', width: 220, height: 220, margin: '0 auto 6px' } }, [
            h('div', { onClick: function () { inject(st, '/' + center) }, title: tr('skill.centerTitle', { skill: center }), style: { position: 'absolute', left: cx - 30, top: cy - 30, width: 60, height: 60, borderRadius: '50%', background: 'rgba(188,140,255,.18)', border: '2px solid #c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#c084fc', cursor: 'pointer', textAlign: 'center', lineHeight: 1.3 } }, '/' + center),
            nodes,
          ]),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', textAlign: 'center', marginBottom: 8 } }, tr('skill.centerRing')),
          h('div', { className: 'dsws-grp' }, [Ic({ n: 'compass', size: 12 }), h('span', null, tr('skill.all'))]),
          list.map(function (sk) {
            const on = rec.indexOf(sk.name) >= 0
            return h('div', { key: sk.name, className: 'dsws-skill', style: on ? { background: 'rgba(188,140,255,.12)', borderRadius: 6 } : null }, [
              Dot({ level: sk.level }),
              h('div', { className: 'dsws-tt' }, [
                h('div', { className: 'dsws-tt-name', style: on ? { color: '#c084fc' } : null }, [h('span', null, '/' + sk.name), on ? Ic({ n: 'star', size: 11, color: '#c084fc' }) : null]),
                h('div', { className: 'dsws-tt-sub dsws-ellip', title: tr('skilldesc.' + sk.name) }, tr('skilldesc.' + sk.name)),
              ]),
              h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + sk.name) } }, tr('act.load')),
            ])
          }),
        ])
      }

      const SkillsTab = ({ st }) => {
        const groups = compute(st)
        let rec = []
        let recTitle = tr('skill.generic')
        if (st.activeMap !== null) {
          const g = groups.find(function (x) { return x.m.number === st.activeMap })
          if (g && /research/.test(g.m.notes)) rec = ['research']
          if (g && /grill/.test(g.m.notes)) rec = ['grilling', 'domain-modeling']
          recTitle = tr('skill.notes', { m: g.m.title })
        }
        if (!rec.length) rec = ['ask-matt']
        const list = SKILLS.map(function (sk) {
          const on = rec.indexOf(sk.name) >= 0
          return h('div', { key: sk.name, className: 'dsws-skill', style: on ? { background: 'rgba(188,140,255,.12)', borderRadius: 6 } : null }, [
            Dot({ level: sk.level }),
            h('div', { className: 'dsws-tt' }, [
              h('div', { className: 'dsws-tt-name', style: on ? { color: '#c084fc' } : null }, [
                h('span', null, '/' + sk.name),
                on ? Ic({ n: 'star', size: 11, color: '#c084fc' }) : null,
              ]),
              h('div', { className: 'dsws-tt-sub dsws-ellip', title: sk.use }, sk.use),
            ]),
            h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + sk.name) } }, tr('act.load')),
          ])
        })
        const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } }, [
          h('div', { className: 'dsws-grp', style: { margin: 0 } }, [Ic({ n: 'compass', size: 12 }), h('span', null, recTitle)]),
          h('span', { style: { flex: 1 } }),
          h('span', { className: 'dsws-seg' + (st.skillView === 'list' ? ' on' : ''), onClick: function () { st.skillView = 'list'; emit(st) }, style: { fontSize: 11 } }, tr('skill.list')),
          h('span', { className: 'dsws-seg' + (st.skillView === 'ring' ? ' on' : ''), onClick: function () { st.skillView = 'ring'; emit(st) }, style: { fontSize: 11 } }, tr('skill.ring')),
        ])
        if (st.skillView === 'ring') return h('div', null, [head, h(RingSkills, { st: st, rec: rec, list: SKILLS })])
        return h('div', null, [
          head,
          h('div', { style: { marginBottom: 8 } }, rec.map(function (r, i) {
            return h('span', { key: i, className: 'dsws-chip dsws-chip-m' }, '/' + r)
          })),
          list,
        ])
      }

      // ---- 5.7 环境检查（定稿 5A：横幅 + 红/黄/绿分组卡；v12 失败不兜假数据）----
      const ChecksTab = ({ st }) => {
        React.useEffect(function () { loadChecks(st, false) }, [])
        const cs = activeChecks(st)
        const bad = cs.filter(function (c) { return c.level === 'bad' })
        const warn = cs.filter(function (c) { return c.level === 'warn' })
        const ok = cs.filter(function (c) { return c.level === 'ok' })
        // #373：hint 支持两种形态 —— URL（可打开/复制）或 /命令（「用 /xxx 处理」按钮，保留兼容）
        const actBtn = (c) => {
          const hint = c.hint || ''
          // v1.5：prompt: 协议 —— 复制/注入一段引导 prompt 让 AI 执行（如技能安装引导）
          if (hint.indexOf('prompt:') === 0) {
            const ptext = hint.slice(7)
            // v1.6：prompt: 键名协议 —— 优先从 PROMPTS 注册表取双语文本（跟随语言），未知键回退原文
            const resolved = promptText(ptext) || ptext
            return h('button', { className: 'dsws-btn', onClick: function () { inject(st, resolved) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('env.installBtn'))
          }
          if (/^https?:\/\//i.test(hint)) {
            return h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
              h('a', { href: hint, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('env.openUrl'))]),
              h('button', { className: 'dsws-btn', onClick: function () { copyText(st, hint, tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('env.copyUrl'))]),
            ])
          }
          const m = hint.match(/\/([a-z0-9-]+)/i)
          if (!m) return null
          return h('button', { className: 'dsws-btn', onClick: function () { inject(st, '/' + m[1]) } }, tr('skill.treat', { s: m[1] }))
        }
        const card = (c) => h('div', { key: c.id, className: 'dsws-ccard' }, [
          h('div', { className: 'nm' }, c.name),
          h('div', { className: 'dt dsws-ellip', title: c.detail }, c.detail),
          c.hint ? h('div', { className: 'act' }, [actBtn(c)]) : null,
        ])
        const grp = (title, color, items) => items.length ? h('div', null, [
          h('div', { className: 'dsws-cgroup' }, [h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' } }), h('span', null, title + ' ' + items.length)]),
          items.map(card),
        ]) : null
        // 环境检查页顶部横幅（用户拍板 2026-08-16：优先级链，不并存）
        //   技能未装全 → matte 横幅；技能已装但 setup 未执行 → setup 横幅；都 ok → 不显示
        const skillsCheck2 = activeChecks(st).find(function (c) { return c.id === 9 })
        const ghCli2 = activeChecks(st).find(function (c) { return c.id === 4 })
        const ghAuth2 = activeChecks(st).find(function (c) { return c.id === 5 })
        const setupCheck2 = activeChecks(st).find(function (c) { return c.id === 2 })
        const skillsOk = !skillsCheck2 || skillsCheck2.level === 'ok'
        const setupOk = !setupCheck2 || setupCheck2.level === 'ok'
        const ghCliOk2 = !ghCli2 || ghCli2.level === 'ok'
        const ghAuthOk2 = !ghAuth2 || ghAuth2.level === 'ok'
        // v1.5 引导依赖链（用户拍板 2026-08-17）：gh CLI → gh 登录 → setup → 技能，显示第一个缺失项
        const topBanner = (!ghCliOk2)
          ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
              Ic({ n: 'alert', size: 13 }),
              h('span', { style: { flex: 1 } }, tr('banner.ghcli')),
              h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { openUrl('https://cli.github.com/') } }, tr('banner.ghcliBtn')),
            ])
          : (!ghAuthOk2)
            ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                Ic({ n: 'alert', size: 13 }),
                h('span', { style: { flex: 1 } }, tr('banner.ghauth')),
                h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { openUrl('https://cli.github.com/manual/gh_auth_login') } }, tr('banner.ghauthBtn')),
              ])
            : (!setupOk)
              ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                  Ic({ n: 'alert', size: 13 }),
                  h('span', { style: { flex: 1 } }, tr('banner.setup')),
                  h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(245,158,11,.6)' }, onClick: function () { inject(st, promptText('setupRun')) } }, tr('banner.setupBtn')),
                ])
              : (!skillsOk)
                ? h('div', { className: 'dsws-banner warn', style: { cursor: 'default', marginBottom: 8 } }, [
                    Ic({ n: 'star', size: 13 }),
                    h('span', { style: { flex: 1 } }, tr('banner.skills', { list: (skillsCheck2 && skillsCheck2.detail) || '' })),
                    h('button', { className: 'dsws-btn', style: { borderColor: 'rgba(188,140,255,.55)' }, onClick: function () { inject(st, promptText('installSkills')) } }, tr('banner.skillsBtn')),
                  ])
                : null
        // v1.5 配置引导顺序区（用户拍板 2026-08-17）：依赖链 1-2-3-4，完成自动勾选
        const okOf = function (c) { return !c || c.level === 'ok' }
        const guideSteps = [
          { done: okOf(ghCli2), label: tr('env.g1'), act: function () { openUrl('https://cli.github.com/') }, btn: tr('banner.ghcliBtn') },
          { done: okOf(ghAuth2), label: tr('env.g2'), act: function () { openUrl('https://cli.github.com/manual/gh_auth_login') }, btn: tr('banner.ghauthBtn') },
          { done: okOf(setupCheck2), label: tr('env.g3'), act: function () { inject(st, promptText('setupRun')) }, btn: tr('banner.setupBtn') },
          { done: okOf(skillsCheck2), label: tr('env.g4'), act: function () { inject(st, promptText('installSkills')) }, btn: tr('banner.skillsBtn') },
        ]
        const guideAll = guideSteps.every(function (s) { return s.done })
        const guideBlock = guideAll ? null : h('div', { className: 'dsws-ccard', style: { marginBottom: 8 } }, [
          h('div', { className: 'dsws-cgroup' }, [h('span', { style: { fontWeight: 600 } }, tr('env.guide'))]),
          guideSteps.map(function (s, i) {
            return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px' } }, [
              h('span', { style: { width: 16, height: 16, borderRadius: '50%', border: '1px solid ' + (s.done ? '#4ade80' : '#8b8b95'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: s.done ? '#4ade80' : 'transparent', flex: 'none' } }, s.done ? '\u2713' : String(i + 1)),
              h('span', { style: { flex: 1 } }, s.label),
              s.done ? null : h('button', { className: 'dsws-btn', onClick: s.act, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, s.btn),
            ])
          }),
        ])
        return h('div', null, [
          topBanner,
          guideBlock,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 } }, [
            h('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'gear', size: 12 }), h('span', null, tr('env.title', { n: envLabel(st) }))]),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-btn', disabled: st.checking || st.refreshing, onClick: function () { refreshAll(st) }, style: { fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
              h('span', { className: 'dsws-rficon' + ((st.checking || st.refreshing) ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]),
              h('span', null, tr('env.recheck')),
            ]),
          ]),
          // T2 #35 · ChecksTab 弱化：红卡显示时 checkRepo:bad 行弱化为“已在首屏引导 · 切换到 ListTab 完成”；dismiss 后提供“重置忽略”入口
        (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); if (!showRed) return null; return h('div', { className: 'dsws-ccard', style: { opacity: 0.85, borderColor: 'rgba(139,139,149,.35)', background: 'rgba(139,139,149,.08)', marginBottom: 6 } }, [h('div', { className: 'nm', style: { color: '#8b8b95' } }, cr.name), h('div', { className: 'dt', style: { color: '#8b8b95' } }, tr('panel.noRepoCardDone')), h('div', { className: 'act' }, [h('button', { className: 'dsws-btn', onClick: function () { st.tab = 'list'; emit(st) }, style: { fontSize: 11, padding: '2px 8px' } }, tr('panel.tabList'))])]) })(),
        (function () { const dismissed = isNoRepoDismissed(st.cwd); if (!dismissed) return null; const cr = cs.find(function (c) { return c.id === 1 }); if (!cr || cr.level !== 'bad') return null; return h('div', { className: 'dsws-ccard', style: { borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.06)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 } }, [h('span', { style: { fontSize: 11, color: '#f87171', flex: 1 } }, tr('panel.noRepoCardDismiss') + ' · ' + (cr.detail || '')), h('button', { className: 'dsws-btn', onClick: function () { setNoRepoDismissed(st.cwd, false); emit(st) }, style: { fontSize: 11, padding: '2px 8px', flex: 'none' } }, tr('panel.noRepoReset'))]) })(),
                st.checksMode === 'err' ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.failFull', { err: st.checksError }))]) : null,
          st.checksMode === 'loading' ? h('div', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)', fontSize: 12, marginBottom: 6 } }, tr('env.detecting')) : null,
          (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; const cnt = displayBad.length; return cnt ? h('div', { className: 'dsws-banner bad', style: { cursor: 'default' } }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('env.missingBanner', { n: cnt }))]) : null })(),
          (function () { const cr = cs.find(function (c) { return c.id === 1 }); const dismissed = isNoRepoDismissed(st.cwd); const showRed = !!(cr && cr.level === 'bad' && !dismissed); const displayBad = showRed ? bad.filter(function (c) { return c.id !== 1 }) : bad; return grp(tr('env.missing'), '#f87171', displayBad) })(),
          grp(tr('env.partial'), '#f59e0b', warn),
          grp(tr('env.ready'), '#4ade80', ok),
        ])
      }

      // ---- 5.8b 右侧停靠（details 槽位 · 三视图完整内容；开合/拖拽/宽度记忆由壳管理）----
      // 契约：details 槽 = 壳右侧第三列（AppFrame grid），scope session；关闭 = ctx.layout.closeDetails()
      //   （占位者 props 亦注入 closeDetails）；宽度 300-520px 可拖拽；关闭时子树不卸载（状态保留）。
      // issue #15：tabs 行内容放不下时折叠为纯图标（内容自适应 + 滞回防抖）
      const TABS_FOLD_HYST = 4
      const TABS_LEVELS = 3
      const tabsLevelDecide = function (level, avail, nats) {
        if (!Array.isArray(nats) || !nats.length) return 0
        let cur = level < 0 ? 0 : level
        while (cur < nats.length - 1 && nats[cur] > avail + 1) cur++
        while (cur > 0 && avail >= nats[cur - 1] + TABS_FOLD_HYST) cur--
        return cur
      }
      // issue#15 修复：scrollWidth 会被容器宽度钳制（容器宽于内容时 scrollWidth===clientWidth），
      // 导致折叠后展开判定 avail>=nats[cur-1]+4 永不成立（死锁）。改测内容 children 的真实横跨宽。
      const measureContentWidth = function (t) {
        if (!t || !t.children || t.children.length === 0) return 0
        const tr = t.getBoundingClientRect()
        let minX = Infinity, maxX = -Infinity
        for (let i = 0; i < t.children.length; i++) {
          const c = t.children[i]
          const r = c.getBoundingClientRect()
          if (r.width > 0) { if (r.x < minX) minX = r.x; if (r.x + r.width > maxX) maxX = r.x + r.width }
        }
        if (minX === Infinity) return 0
        return maxX - tr.x
      }
      const DetailsDock = (props) => {
        // #45 回归（2026-08-20 续）：切绘画/工作区后右面板串台
        // 根因：原 DetailsDock 仅在挂载时跑一次副作用（deps []），且直接取 props.sessionId（details 槽位在宿主里常为空 → 退回 shared 单例），
        //   导致：① 切绘画（sessionId 变化）不重跑水合/加载，旧绘画的 polluted snapshot 常驻；② 非 current 工作区的 snapshot 经 shared 广播后，details 常显 shared.cwd（首工作区）快照。
        // 修复：① 用 props.useSessions 权威信号跟随当前会话（hookCurrent）与精确 cwd（summaryCwd），props.sessionId / scope.sessionId 优先；② 副作用 deps 改为 [sid]/[sid,summaryCwd]，切绘画即触发 cwd 同步 + 水合；③ 空 deps 根除。
        const hookCurrent = (props && typeof props.useSessions === 'function') ? props.useSessions(function (x) { return x.current }) : undefined
        const propSid = props && (props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id))
        const sid = propSid || hookCurrent
        const summaryCwd = (props && typeof props.useSessions === 'function' && sid) ? props.useSessions(function (x) { return (x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined }) : undefined
        const s = useStore(sid)
        const layoutSvc = ctx.get('layout')
        const dockRef = React.useRef(null)
        const [dw, setDw] = React.useState(460)
        // 列宽感知：details 列 300-520px；窄于 380 时动作按钮折叠为纯图标（与悬浮面板同阈值）
        React.useEffect(function () {
          if (!dockRef.current) return
          const el = dockRef.current
          const ro = new ResizeObserver(function (entries) {
            try { setDw(entries[0].contentRect.width) } catch (e) { /* 忽略 */ }
          })
          ro.observe(el)
          return function () { try { ro.disconnect() } catch (e) { /* 忽略 */ } }
        }, [])
        // 响应式工作区同步（对齐 StatusBar）：当 host 权威的 summaryCwd / session 变化，立即把 s.cwd 切到正确工作区并水合 per-cwd 缓存
        React.useEffect(function () {
          const apply = function (cwd) {
            if (cwd && cwd !== s.cwd) {
              s.cwd = cwd
              const hydrated = hydrateFromCache(s)
              emit(s)
              loadChecks(s, false)
              if (!hydrated || !snapFresh(s)) loadSnapshot(s, false)
            }
          }
          if (summaryCwd) { apply(summaryCwd); return }
          const cwd0 = detectCwd(props && props.session)
          if (cwd0) { apply(cwd0); return }
          if (sid && typeof host !== 'undefined' && typeof host.call === 'function') {
            host.call('wf.cwd', { sessionId: sid }).then(function (res) {
              if (res && res.ok && res.cwd) apply(res.cwd)
            }).catch(function () { /* 保持现有 cwd */ })
          }
        }, [sid, summaryCwd])
        // 初始数据：随 sid 变化重跑（修复空 deps 导致切绘画不刷新；含 per-cwd 水合秒开 + 污染残留自愈）
        React.useEffect(function () {
          if (!s.cwd) {
            const sync = getCwdSync(sid)
            if (sync) { s.cwd = sync; hydrateFromCache(s) }
          } else { hydrateFromCache(s) }
          // 污染自愈：若当前 store 的 snapshot 仍是之前工作区串台残留（repoRoot 与 cwd 前缀不匹配，或 repo 名与 cwd 尾段不一致），强制后台刷新
          const isPolluted = (function(){
            if (!s.snapshot || !s.cwd) return false
            const snap = s.snapshot
            if (snap.repoRoot) {
              const rr = String(snap.repoRoot).replace(/\\/g,'/').replace(/\/+$/,'')
              const cw = String(s.cwd).replace(/\\/g,'/').replace(/\/+$/,'')
              if (cw === rr) return false
              if (cw.startsWith(rr + '/')) return false
              if (rr.startsWith(cw + '/')) return false
              return true
            }
            if (snap.repo && snap.repo.name) {
              const base = cwdBasename(s.cwd)
              if (base && snap.repo.name !== base) {
                return true
              }
            }
            return false
          })()
          if (isPolluted) { loadSnapshot(s, false); loadChecks(s, false); return }
          if (!snapFresh(s)) loadSnapshot(s, false); loadChecks(s, false)
        }, [sid])
        const closeDock = function () {
          if (props && typeof props.closeDetails === 'function') props.closeDetails()
          else if (layoutSvc && typeof layoutSvc.closeDetails === 'function') layoutSvc.closeDetails()
        }
        const groups = compute(s)
        const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
        const narrow = dw < 380
        const tabsRef = React.useRef(null)
        const headRef = React.useRef(null)
        const [tabTip, setTabTip] = React.useState(null)
        React.useEffect(function () {
          const applyFold = function () {
            const t = tabsRef.current
            if (!t) return
            const btns = t.querySelectorAll('[data-priority]')
            const ver = t.querySelector('.dsws-ver')
            // 测量阶段临时禁用 transition（max-width 动画会污染 scrollWidth 测量 → 0/6 抖动）
            t.classList.add('dsws-no-anim')
            // 1) 全展开 + 强制 reflow（拿到"内容真实放得下"的基准）
            for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
            if (ver) ver.classList.remove('collapsed')
            void t.offsetWidth
            // 2) 从最不重要（priority 大）逐个折叠，直到放得下（scrollWidth 溢出判定）
            const items = Array.from(btns)
              .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
              .sort(function (a, b) { return b.p - a.p })
            for (const it of items) {
              if (t.scrollWidth <= t.clientWidth + 1) break
              it.el.classList.add('collapsed')
              void t.offsetWidth
            }
            // 3) 版本号跟随「刷新」(priority=3) 折叠；记录折叠数供 tooltip 门控
            if (ver) {
              const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
              ver.classList.toggle('collapsed', !!refreshCollapsed)
            }
            t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
            t.classList.remove('dsws-no-anim')
          }
          const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
          let observed = null
          const apply = function () {
            const t = tabsRef.current
            if (!t) return
            if (ro && observed !== t) {
              if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
              ro.observe(t)
              observed = t
            }
            applyFold()
          }
          apply()
          if (typeof window !== 'undefined') window.addEventListener('resize', apply)
          if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
          return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
        }, [])
        // 头部自适应：空间充足时完整，挤压时先隐藏 MATT skills 文字（保留图标），最后仅留 repo（#28）
        React.useEffect(function () {
          const applyHead = function () {
            const hd = headRef.current
            if (!hd) return
            const titleEl = hd.querySelector('[data-head-title]')
            const chip = hd.querySelector('[data-repo-chip]')
            const txt = chip && chip.querySelector('[data-repo-text]')
            if (!titleEl || !chip || !txt) return
            const repo = s.snapshot && s.snapshot.repo
            const full = repo ? repo.owner + '/' + repo.name : ''
            const short = repo ? repo.name : ''
            const naturalFits = function () {
              try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
              return hd.scrollWidth <= hd.clientWidth + 1
            }
            // 基准：标题可见 + 完整仓库名（固宽测自然宽）
            titleEl.style.display = ''
            if (full) txt.textContent = full
            chip.style.flex = 'none'
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            // 阶段1：隐藏标题，优先保仓库名
            titleEl.style.display = 'none'
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            // 阶段2：极窄时仅留 repo
            if (full && short) txt.textContent = short
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            // 仍放不下：允许 chip 弹性 ellipsis 收缩
            chip.style.flex = '0 1 auto'
          }
          applyHead()
          let ro2 = null
          try {
            ro2 = new ResizeObserver(function () { applyHead() })
            if (headRef.current) ro2.observe(headRef.current)
          } catch (e) {}
          const onWin = function () { applyHead() }
          if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
          if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
          return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
        }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), dw])
        const tabsTip = function (e, text, priority) {
          const t = tabsRef && tabsRef.current
          setTabTip(null)
          if (!t || !text || typeof e === 'undefined') return
          const btn = t.querySelector('[data-priority="' + priority + '"]')
          if (!btn || !btn.classList.contains('collapsed')) return
          if (typeof window === 'undefined') return
          const W = 238
          let x = e.clientX + 12, y = e.clientY + 12
          if (x + W > window.innerWidth) x = e.clientX - 12 - W
          setTabTip({ x: x, y: y, text: text })
        }
        const tabsTipOff = function () { setTabTip(null) }
        const tabBtn = (id, icon, label, priority) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
          Ic({ n: icon, size: 12 }),
          h('span', null, label),
        ])
        return h('div', { ref: dockRef, 'data-dsws-host': '1', className: narrow ? 'dsws-narrow' : undefined, style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--dsw-font-family)', fontSize: 12, color: 'var(--dsw-alias-label-primary,#e6edf3)', background: 'var(--dsw-alias-bg-layer-1,#10131a)' } }, [
          // 头部（标题 + 关闭）：横线不放在这行，下移到标签行下方与对话/轨迹对齐
          // #28 自适应：flex 容器 minWidth 0 + 芯片 flex 自适应，标题优先隐藏，极窄仅留 repo
          h('div', { ref: headRef, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px', flex: 'none', minWidth: 0 } }, [
            Icon({ scheme: 'compass', size: 15 }),
            h('span', { 'data-head-title': 1, style: { fontWeight: 600, fontSize: 13, flex: 'none', whiteSpace: 'nowrap' } }, tr('panel.title')),
            // v1.5 T7：仓库身份组件 —— 当前检测到的 git 仓库（owner/name），点击打开 GitHub
            (s.snapshot && s.snapshot.repo) ? h('a', { href: 'https://github.com/' + s.snapshot.repo.owner + '/' + s.snapshot.repo.name, target: '_blank', rel: 'noreferrer', title: tr('panel.repoTitle'), 'data-repo-chip': 1, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#58a6ff', background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.45)', borderRadius: 6, padding: '1px 8px', flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace' } }, [
              h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'currentColor', style: { flex: 'none' } }, [h('path', { d: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 8h8.5V1.5z' })]),
              h('span', { 'data-repo-text': 1, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapshot.repo.owner + '/' + s.snapshot.repo.name),
            ]) : h('span', { title: tr('panel.noRepoTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [
              Ic({ n: 'alert', size: 11 }),
              h('span', null, tr('panel.noRepo')),
            ]),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: closeDock, style: { display: 'inline-flex', alignItems: 'center', padding: '2px 6px', fontSize: 11 } }, Ic({ n: 'x', size: 12 })),
          ]),
          // 标签行下沿 = 与对话/轨迹一致的横线；右侧：刷新按钮 + 版本号（v1.3.3）
          h('div', { className: 'dsws-tabs', ref: tabsRef, style: { padding: '0 12px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', flex: 'none', display: 'flex', alignItems: 'center', gap: 4 } }, [
            tabBtn('list', 'list', tr('panel.tabList'), 4),
            tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
            tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
            h('span', { style: { flex: 1 } }),
            // v1.5 T6 修订（V2 描边紫 · 刷新左侧）：新增 wayfinder —— 注入 /wayfinder + 仓库信息 + 需求引导
            // issue #4：新增 BUG 单 —— 同构按钮（新会话预填 /wayfinder 新增 BUG 单 prompt）
            h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
              Ic({ n: 'map', size: 11 }),
              h('span', null, tr('panel.newWayfinder')),
            ]),
            h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
              Ic({ n: 'bug', size: 11 }),
              h('span', null, tr('panel.newBug')),
            ]),
            h('button', { className: 'dsws-btn', 'data-priority': 3, onMouseMove: function (e) { tabsTip(e, tr('list.refresh'), 3) }, onMouseLeave: tabsTipOff, onClick: function () { refreshAll(s) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' } }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', null, tr('list.refresh'))]),
            (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
            h('span', { className: 'dsws-ver', style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION),
          ]),
          h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '10px 12px' } }, [
            s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
            s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
            s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
          ]),
          // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
          s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
            Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
            h('span', null, s.notice.text),
          ]) : null,
        ])
      }

      // ---- 5.8 主面板（可拖动 · 8 向缩放 · 三视图 · v14 跟随当前会话 + 刷新遮罩）----
      const OverlayPanel = (props) => {
        const cur = props.useSessions((x) => x.current)
        const s = useStore(cur)
        const panelRef = React.useRef(null)
        const tabsRef = React.useRef(null)
        const headRef = React.useRef(null)
        const [tabTip, setTabTip] = React.useState(null)
        React.useEffect(function () {
          const applyFold = function () {
            const t = tabsRef.current
            if (!t) return
            const btns = t.querySelectorAll('[data-priority]')
            const ver = t.querySelector('.dsws-ver')
            // 测量阶段临时禁用 transition（max-width 动画会污染 scrollWidth 测量 → 0/6 抖动）
            t.classList.add('dsws-no-anim')
            // 1) 全展开 + 强制 reflow（拿到"内容真实放得下"的基准）
            for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
            if (ver) ver.classList.remove('collapsed')
            void t.offsetWidth
            // 2) 从最不重要（priority 大）逐个折叠，直到放得下（scrollWidth 溢出判定）
            const items = Array.from(btns)
              .map(function (b) { return { el: b, p: Number(b.dataset.priority || 99) } })
              .sort(function (a, b) { return b.p - a.p })
            for (const it of items) {
              if (t.scrollWidth <= t.clientWidth + 1) break
              it.el.classList.add('collapsed')
              void t.offsetWidth
            }
            // 3) 版本号跟随「刷新」(priority=3) 折叠；记录折叠数供 tooltip 门控
            if (ver) {
              const refreshCollapsed = t.querySelector('[data-priority="3"]')?.classList.contains('collapsed')
              ver.classList.toggle('collapsed', !!refreshCollapsed)
            }
            t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
            t.classList.remove('dsws-no-anim')
          }
          const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
          let observed = null
          const apply = function () {
            const t = tabsRef.current
            if (!t) return
            if (ro && observed !== t) {
              if (observed) { try { ro.unobserve(observed) } catch (e) { /* noop */ } }
              ro.observe(t)
              observed = t
            }
            applyFold()
          }
          apply()
          if (typeof window !== 'undefined') window.addEventListener('resize', apply)
          if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(apply)
          return function () { if (ro) ro.disconnect(); if (typeof window !== 'undefined') window.removeEventListener('resize', apply) }
        }, [s.open])
        // 头部自适应（Overlay）：同 Dock 逻辑，空间充足完整，挤压先藏标题文字，最后仅留 repo（#28）
        React.useEffect(function () {
          const applyHead = function () {
            const hd = headRef.current
            if (!hd) return
            const titleEl = hd.querySelector('[data-head-title]')
            const chip = hd.querySelector('[data-repo-chip]')
            const txt = chip && chip.querySelector('[data-repo-text]')
            if (!titleEl || !chip || !txt) return
            const repo = s.snapshot && s.snapshot.repo
            const full = repo ? repo.owner + '/' + repo.name : (s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : '')
            const short = repo ? repo.name : full
            const isRepo = !!(repo && repo.owner && repo.name)
            const naturalFits = function () {
              try { if (typeof measureContentWidth === 'function') return measureContentWidth(hd) <= hd.clientWidth + 1 } catch (e) {}
              return hd.scrollWidth <= hd.clientWidth + 1
            }
            titleEl.style.display = ''
            if (full) txt.textContent = full
            chip.style.flex = 'none'
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            titleEl.style.display = 'none'
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            if (isRepo) txt.textContent = short
            void hd.offsetWidth
            if (naturalFits()) { chip.style.flex = '0 1 auto'; return }
            chip.style.flex = '0 1 auto'
          }
          applyHead()
          let ro2 = null
          try { ro2 = new ResizeObserver(function () { applyHead() }); if (headRef.current) ro2.observe(headRef.current) } catch (e) {}
          const onWin = function () { applyHead() }
          if (typeof window !== 'undefined') window.addEventListener('resize', onWin)
          if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(applyHead)
          return function () { if (ro2) try { ro2.disconnect() } catch (e) {} ; if (typeof window !== 'undefined') window.removeEventListener('resize', onWin) }
        }, [s.snapshot && s.snapshot.repo && (s.snapshot.repo.owner + '/' + s.snapshot.repo.name), s.snapMode, s.size && s.size.w, s.open])
        // #376：加载由 openPanel 统一分派（未就绪/过期 force，新鲜直接展示）；此处不再重复加载
        if (!s.open) return null
        const groups = compute(s)
        const active = s.activeMap !== null ? groups.find(function (x) { return x.m.number === s.activeMap }) : null
        // v14-19：窄屏阈值（面板宽 <380px 时动作按钮折叠为纯图标）
        const narrow = s.size.w < 380
        const tabsTip = function (e, text, priority) {
          const t = tabsRef && tabsRef.current
          setTabTip(null)
          if (!t || !text || typeof e === 'undefined') return
          const btn = t.querySelector('[data-priority="' + priority + '"]')
          if (!btn || !btn.classList.contains('collapsed')) return
          if (typeof window === 'undefined') return
          const W = 238
          let x = e.clientX + 12, y = e.clientY + 12
          if (x + W > window.innerWidth) x = e.clientX - 12 - W
          setTabTip({ x: x, y: y, text: text })
        }
        const tabsTipOff = function () { setTabTip(null) }
        const tabBtn = (id, icon, label, priority) => h('button', { className: 'dsws-tab' + (s.tab === id ? ' on' : ''), 'data-priority': priority, onMouseMove: function (e) { tabsTip(e, label, priority) }, onMouseLeave: tabsTipOff, onClick: function () { s.tab = id; emit(s); if (!snapFresh(s)) loadSnapshot(s, false) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
          Ic({ n: icon, size: 12 }),
          h('span', null, label),
        ])

        const startDrag = function (e) {
          if (typeof document === 'undefined' || typeof window === 'undefined') return
          if (!panelRef.current) return
          e.preventDefault()
          const rect = panelRef.current.getBoundingClientRect()
          const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, sx: e.clientX, sy: e.clientY }
          const mm = function (ev) { s.pos = { x: r0.x + ev.clientX - r0.sx, y: r0.y + ev.clientY - r0.sy }; emit(s) }
          const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
          document.addEventListener('mousemove', mm)
          document.addEventListener('mouseup', mu)
        }
        const onBodyDown = function (e) {
          if (e.target === e.currentTarget) startDrag(e)
        }

        const onResizeDown = function (dir) {
          return function (e) {
            e.stopPropagation()
            e.preventDefault()
            if (typeof document === 'undefined' || typeof window === 'undefined' || !panelRef.current) return
            const rect = panelRef.current.getBoundingClientRect()
            const r0 = { x: s.pos ? s.pos.x : rect.left, y: s.pos ? s.pos.y : rect.top, w: s.size.w || rect.width, h: s.size.h || rect.height, sx: e.clientX, sy: e.clientY }
            const mm = function (ev) {
              const dx = ev.clientX - r0.sx, dy = ev.clientY - r0.sy
              let w = r0.w, h = r0.h
              if (dir.indexOf('e') >= 0) w = r0.w + dx
              if (dir.indexOf('s') >= 0) h = r0.h + dy
              if (dir.indexOf('w') >= 0) w = r0.w - dx
              if (dir.indexOf('n') >= 0) h = r0.h - dy
              w = Math.min(900, Math.max(340, w))
              h = Math.min(920, Math.max(240, h))
              let x = r0.x, y = r0.y
              if (dir.indexOf('w') >= 0) x = r0.x + (r0.w - w)
              if (dir.indexOf('n') >= 0) y = r0.y + (r0.h - h)
              s.pos = { x: x, y: y }
              s.size = { w: w, h: h }
              emit(s)
            }
            const mu = function () { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
            document.addEventListener('mousemove', mm)
            document.addEventListener('mouseup', mu)
          }
        }

        const panelStyle = { width: s.size.w, ...(s.size.h ? { height: s.size.h } : {}), ...(s.pos ? { left: s.pos.x, top: s.pos.y, right: 'auto' } : { left: 16, top: 76, right: 'auto' }) }
        return h('div', { ref: panelRef, className: 'dsws-panel', style: panelStyle }, [
          // #28 自适应头部：minWidth 0 允许收缩，先藏标题文字（留图标），最后仅留 repo
          h('div', { ref: headRef, className: 'dsws-head', onMouseDown: startDrag, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
            Icon({ scheme: s.ui.icon, size: 17 }),
            h('span', { 'data-head-title': 1, style: { fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' } }, tr('panel.title')),
            // v19-35：「真数据」→ 显示 repo 名（对未来用户更有意义；异常时红色提示）
            h('span', { 'data-repo-chip': 1, className: 'dsws-chip ' + (s.snapMode === 'err' ? 'dsws-chip-t' : 'dsws-chip-m'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 1 auto', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [
              Ic({ n: s.snapMode === 'err' ? 'alert' : 'info', size: 11 }),
              h('span', { 'data-repo-text': 1, className: 'dsws-ellip', title: repoStr(s), style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, s.snapMode === 'err' ? tr('panel.snapErr') : s.snapMode === 'loading' ? tr('panel.loading') : repoStr(s)),
            ]),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsws-btn ghost', title: tr('panel.closeTitle'), onClick: function () { s.open = false; emit(s) }, style: { display: 'inline-flex', alignItems: 'center' } }, Ic({ n: 'x', size: 12 })),
          ]),
                  h('div', { className: 'dsws-tabs', ref: tabsRef, style: { display: 'flex', alignItems: 'center', gap: 4 } }, [
          tabBtn('list', 'list', tr('panel.tabList'), 4),
          tabBtn('skills', 'compass', tr('panel.tabSkills'), 5),
          tabBtn('checks', 'gear', tr('panel.tabChecks'), 6),
          h('span', { style: { flex: 1 } }),
          // v1.5 T6 修订（V2 描边紫 · 刷新左侧）：新增 wayfinder
          // issue #4：新增 BUG 单 —— 同构按钮（新会话预填 /wayfinder 新增 BUG 单 prompt）
          h('button', { className: 'dsws-btn', 'data-priority': 2, onMouseMove: function (e) { tabsTip(e, tr('panel.newWayfinderTitle'), 2) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newWayfinder')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #c084fc', color: '#c084fc', fontWeight: 600 } }, [
            Ic({ n: 'map', size: 11 }),
            h('span', null, tr('panel.newWayfinder')),
          ]),
          h('button', { className: 'dsws-btn', 'data-priority': 1, onMouseMove: function (e) { tabsTip(e, tr('panel.newBugTitle'), 1) }, onMouseLeave: tabsTipOff, onClick: function () { openTextInNewSession(s, newBugWayfinderText(s), SESSION_TITLE_PREFIX + ' ' + tr('panel.newBug')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none', background: 'transparent', border: '1px solid #f87171', color: '#f87171', fontWeight: 600 } }, [
            Ic({ n: 'bug', size: 11 }),
            h('span', null, tr('panel.newBug')),
          ]),
          // T2 #2：刷新按钮上移至 tabs 末尾（紧贴环境检查右边 · 用户需求）
          h('button', { className: 'dsws-btn', 'data-priority': 3, onMouseMove: function (e) { tabsTip(e, tr('list.refresh'), 3) }, onMouseLeave: tabsTipOff, onClick: function () { refreshAll(s) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' } }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]), h('span', null, tr('list.refresh'))]),
          (tabTip && portalTop) ? portalTop(h('div', { style: { position: 'fixed', left: tabTip.x, top: tabTip.y, zIndex: 2147483000, padding: '4px 8px', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-3,#0c0e12)', border: '1px solid var(--dsw-alias-border-l2,#3a3f4a)', color: 'var(--dsw-alias-label-primary,#e6edf3)', fontSize: 11, lineHeight: 1.5, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.4)', maxWidth: 220 } }, tabTip.text)) : null,
          h('span', { className: 'dsws-ver', style: { fontSize: 9, color: 'var(--dsw-alias-label-caption,#8b8b95)', flex: 'none', fontVariantNumeric: 'tabular-nums' } }, DSW_VERSION),
        ]),
          h('div', { className: 'dsws-body', onMouseDown: onBodyDown }, [
            s.tab === 'list' ? (active ? h(MapDetail, { st: s, g: active }) : h(ListTab, { st: s, narrow: narrow })) : null,
            s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
            s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
          ]),
          h('div', { className: 'dsws-rz dsws-rz-n', onMouseDown: onResizeDown('n'), title: tr('rz.n') }),
          h('div', { className: 'dsws-rz dsws-rz-s', onMouseDown: onResizeDown('s'), title: tr('rz.s') }),
          h('div', { className: 'dsws-rz dsws-rz-e', onMouseDown: onResizeDown('e'), title: tr('rz.e') }),
          h('div', { className: 'dsws-rz dsws-rz-w', onMouseDown: onResizeDown('w'), title: tr('rz.w') }),
          h('div', { className: 'dsws-rz dsws-rz-ne', onMouseDown: onResizeDown('ne'), title: tr('rz.ne') }),
          h('div', { className: 'dsws-rz dsws-rz-nw', onMouseDown: onResizeDown('nw'), title: tr('rz.nw') }),
          h('div', { className: 'dsws-rz dsws-rz-se', onMouseDown: onResizeDown('se'), title: tr('rz.se') }),
          h('div', { className: 'dsws-rz dsws-rz-sw', onMouseDown: onResizeDown('sw'), title: tr('rz.sw') }),
          // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
          s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
            Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
            h('span', null, s.notice.text),
          ]) : null,
        ])
      }

      // ---- 5.9 配置页（v25 · settings.plugins.tab「Waystation」：功能配置 + 动作模板编辑器）----
      // 开始模板（前缀开关 + execute 模板）/ 动作模板编辑器（其余 6 动作）
      // T3：模板名/描述在渲染时 tr('tpl.name.*')/tr('tpl.desc.*')（此处保留中文静态表供默认文案参考）
      const TPL_NAMES = {
        diagnose: '诊断', fix: '修复', discuss: '讨论', handoff1: '交接第一击', handoff2: '交接第二击', fixate: '沉淀',
      }
      const TPL_DESC = {
        diagnose: 'needs-triage 票的行级动作',
        fix: 'bug 票的行级动作',
        discuss: 'wayfinder:grilling 票的行级动作',
        handoff1: '生成交接文档（含时间戳，两击文件名一致）',
        handoff2: '读取交接文档',
        fixate: '零丢失快照 prompt',
      }
      const TPL_EDIT_IDS = ['diagnose', 'fix', 'discuss', 'handoff1', 'handoff2', 'fixate']  // execute 在「开始模板」节
      const PREVIEW_VALUES = { url: 'https://github.com/FeatherHunter/SKILLS/issues/365', number: '365', title: tr('cfg.previewTitle'), ts: '20260814-172113', file: '20260814-172113.md' }
      const SettingsPage = (props) => {
        // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
        const sharedSt = useStore(props && props.sessionId)
        const [openIn, setOpenIn] = React.useState(cfg.openIn || 'dock')
        const [openInNote, setOpenInNote] = React.useState(false)
        const [wf, setWf] = React.useState(cfg.withWayfinder)
        const [tpls, setTpls] = React.useState(function () {
          const o = {}
          o.execute = templates.execute || ''
          TPL_EDIT_IDS.forEach(function (id) { o[id] = templates[id] || '' })
          return o
        })
        const [saved, setSaved] = React.useState(false)
        const [errs, setErrs] = React.useState([])
        const [resetNote, setResetNote] = React.useState(null)
        const taRefs = React.useRef({})
        // v1.4.1：打开位置即时生效 —— seg 点击即写入 cfg + localStorage + 广播（无需滚到底部点保存全部）
        const pickOpenIn = function (v) {
          setOpenIn(v)
          cfg.openIn = v
          saveCfg()
          broadcastCfg()
          setOpenInNote(true)
          if (timer !== undefined) timer.timeout(function () { setOpenInNote(false) }, 2600)
        }
        // v1.3.3 T1：模板 textarea 自适应高度（内容全展开 · 无内层滚动 · 最外层滑动）
        const autoGrowTa = function (el) {
          if (!el) return
          el.style.height = 'auto'
          el.style.height = (el.scrollHeight + 2) + 'px'
        }
        // 校验全部 7 个模板（生效文本 = 自定义 || 默认）
        const validateAll = function (executeText) {
          const errList = []
          const check = function (id, text) {
            const v = validateTemplate(id, text || (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''))
            if (!v.ok) {
              const bits = []
              if (v.missing.length) bits.push(tr('tpl.missing', { list: v.missing.map(function (n) { return '{' + n + '}' }).join('、') }))
              if (v.unknown.length) bits.push(tr('tpl.unknown', { list: v.unknown.map(function (n) { return '{' + n + '}' }).join('、') }))
              errList.push('「' + tr('tpl.name.' + id) + '」' + bits.join('；'))
            }
          }
          check('execute', executeText)
          TPL_EDIT_IDS.forEach(function (id) { check(id, tpls[id]) })
          return errList
        }
        const save = function () {
          const errList = validateAll(custom)
          if (errList.length) { setErrs(errList); return }
          setErrs([])
          cfg.openIn = openIn
          cfg.withWayfinder = wf
          templates.execute = custom
          TPL_EDIT_IDS.forEach(function (id) { templates[id] = tpls[id] })
          saveCfg(); saveTemplates(); broadcastCfg()
          setSaved(true)
          later(function () { setSaved(false) }, 2000)
        }
        const setTpl = function (id, val) { setTpls(function (p) { const o = Object.assign({}, p); o[id] = val; return o }) }
        const resetExecute = function () { setTpl('execute', ''); setErrs([]) }
        const resetTpl = function (id) { setTpl(id, ''); setErrs([]) }
        // 页面级恢复全部默认（T1 规格 §5：清空 = 注入时走内置默认文本）
        const resetAll = function () {
          const o = {}
          o.execute = ''
          TPL_EDIT_IDS.forEach(function (id) { o[id] = '' })
          setTpls(o)
          setWf(true)
          setErrs([])
        }
        // 点击占位符 chip 在光标处插入
        const insertPh = function (id, name) {
          const ta = taRefs.current[id]
          const cur = tpls[id] || ''
          if (!ta) { setTpl(id, cur + '{' + name + '}'); return }
          const start = (ta.selectionStart != null) ? ta.selectionStart : cur.length
          const end = (ta.selectionEnd != null) ? ta.selectionEnd : cur.length
          const next = cur.slice(0, start) + '{' + name + '}' + cur.slice(end)
          setTpl(id, next)
          const pos = start + name.length + 2
          setTimeout(function () { try { ta.focus(); ta.setSelectionRange(pos, pos) } catch (e) { /* 忽略 */ } }, 0)
        }
        const chip = function (id, n, req) {
          return h('span', { key: n, className: 'dsws-cfg-chip' + (req ? ' req' : ''), title: req ? tr('cfg.chipReq') : tr('cfg.chipInsert'), onClick: function () { insertPh(id, n) } }, [
            h('span', null, '{' + n + '}'),
            req ? h('span', { className: 'must' }, tr('cfg.must')) : null,
          ])
        }
        const tplCard = function (id) {
          const val = tpls[id] || ''
          const preview = renderTemplate(id, PREVIEW_VALUES)
          const req = (TPL_REQUIRED[id] || []).slice()
          return h('div', { key: id, className: 'dsws-cfg-card' }, [
            h('div', { className: 'dsws-cfg-card-head' }, [
              h('span', { className: 'dsws-cfg-card-name' }, tr('tpl.name.' + id)),
              h('span', { style: { flex: 1 } }),
              h('button', { className: 'dsws-cfg-btn', onClick: function () { resetTpl(id) } }, tr('cfg.reset')),
            ]),
            h('div', { className: 'dsws-cfg-card-desc' }, tr('tpl.desc.' + id)),
            h('div', { className: 'dsws-cfg-chips' }, (TPL_PH[id] || []).map(function (n) { return chip(id, n, req.indexOf(n) >= 0) })),
            h('textarea', { ref: function (el) { taRefs.current[id] = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT[id] ? TPL_DEFAULT[id]() : ''), value: val, onChange: function (e) { setTpl(id, e.target.value); autoGrowTa(e.target) } }),
            h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), preview]),
          ])
        }
        const custom = tpls.execute || ''
        // T5 修订：设置页内 toast（独立于面板 dock 的 notice 渲染）
        const cfgNotice = sharedSt.notice
        return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
          cfgNotice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
            Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
            h('span', null, cfgNotice.text),
          ]) : null,
          h('div', { className: 'dsws-cfg-head' }, [
            Icon({ scheme: 'compass', size: 20 }),
            h('span', { className: 't' }, tr('panel.title')),
            h('span', { className: 's', style: { color: saved ? 'var(--dsw-alias-state-success-primary,#4ade80)' : 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
              Ic({ n: saved ? 'check' : 'dot', size: 12 }),
              h('span', null, saved ? tr('cfg.saved') : tr('cfg.status')),
            ]),
          ]),
          h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
          // v1.5 T4：Matt 技能介绍卡（工程领域 + 通用领域 skills · GitHub 链接 + 安装 prompt 复制/注入）
          h('div', { className: 'dsws-cfg-group' }, [
            h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'star', size: 13 }), h('span', null, tr('matte.title'))]),
            h('div', { className: 'dsws-cfg-gdesc' }, tr('matte.desc')),
            h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6 } }, [
              h('a', { href: MATT_REPO, target: '_blank', rel: 'noreferrer', className: 'dsws-btn', style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'link', size: 11 }), h('span', null, tr('matte.openRepo'))]),
              h('button', { className: 'dsws-btn', onClick: function () { copyText(sharedSt, promptText('installSkills'), tr('toast.copied')) }, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'clipboard', size: 11 }), h('span', null, tr('matte.copyPrompt'))]),
            ]),
          ]),
          // v1.4：打开位置（details 列 / better-sidebar）—— better-sidebar 未装时仅显示 dock 选项
          h('div', { className: 'dsws-cfg-group' }, [
            h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'map', size: 13 }), h('span', null, tr('cfg.openIn'))]),
            h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.openInDesc')),
            h('div', { className: 'dsws-cfg-row' }, [
              h('span', { className: 'dsws-cfg-label' }, tr('cfg.openInLabel')),
              h('div', { className: 'dsws-cfg-seg' }, [
                h('button', { key: 'dock', className: openIn === 'dock' ? 'on' : '', onClick: function () { pickOpenIn('dock') } }, tr('cfg.openInDock')),
                (function () { try { return !!ctx.get('betterSidebar') } catch (e) { return false } })()
                  ? h('button', { key: 'sidebar', className: openIn === 'sidebar' ? 'on' : '', onClick: function () { pickOpenIn('sidebar') } }, tr('cfg.openInSidebar'))
                  : null,
              ]),
              openInNote ? h('div', { style: { fontSize: 11, color: '#4ade80', marginTop: 6 } }, tr('cfg.openInHint')) : null,
            ]),
          ]),
          // 1.5 面板宽度重置（#398 拆票 A · 与 #397 协调 · 等 layoutSvc.resetDetails API；缺失时友好提示不让 UI 崩溃）
          h('div', { className: 'dsws-cfg-group' }, [
            h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'refresh', size: 13 }), h('span', null, tr('cfg.panelWidth'))]),
            h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.resetPanelWidthDesc')),
            h('div', { className: 'dsws-cfg-row' }, [
              h('button', { className: 'dsws-cfg-btn', onClick: function () {
                const ls = ctx.get('layout')
                if (ls && typeof ls.resetDetails === 'function') {
                  try { ls.resetDetails(); setResetNote({ kind: 'ok', text: tr('toast.resetPanelWidthDone') }) }
                  catch (e) { setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') }) }
                } else {
                  setResetNote({ kind: 'warn', text: tr('toast.resetPanelWidthFail') })
                }
                if (timer !== undefined) timer.timeout(function () { setResetNote(null) }, 2800)
              } }, tr('cfg.resetPanelWidth')),
              resetNote ? h('span', { style: { marginLeft: 10, fontSize: 11, color: resetNote.kind === 'ok' ? '#4ade80' : '#fbbf24' } }, resetNote.text) : null,
            ]),
          ]),
          // 2. 开始模板（execute 唯一编辑点；id 供动作模板编辑器锚点跳转）
          h('div', { id: 'dsws-cfg-exec-group', className: 'dsws-cfg-group' }, [
            h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'play', size: 13 }), h('span', null, tr('cfg.startTpl'))]),
            h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.startTplDesc')),
            h('div', { className: 'dsws-cfg-row' }, [
              h('label', { className: 'dsws-cfg-sw' }, [
                h('input', { type: 'checkbox', checked: wf, onChange: function (e) { setWf(e.target.checked) } }),
                h('span', { className: 'tr' }),
                h('span', null, tr('cfg.withPrefix')),
              ]),
            ]),
            h('textarea', { ref: function (el) { taRefs.current.execute = el; autoGrowTa(el) }, className: 'dsws-cfg-ta', placeholder: (TPL_DEFAULT.execute ? TPL_DEFAULT.execute() : ''), value: custom, onChange: function (e) { setTpl('execute', e.target.value); autoGrowTa(e.target) } }),
            h('div', { className: 'dsws-cfg-chips' }, [
              (TPL_PH.execute || []).map(function (n) { return chip('execute', n, (TPL_REQUIRED.execute || []).indexOf(n) >= 0) }),
              h('button', { className: 'dsws-cfg-btn', style: { marginLeft: 'auto' }, onClick: resetExecute }, tr('cfg.reset')),
            ]),
            h('div', { className: 'dsws-cfg-preview' }, [h('span', { className: 'pv-label' }, tr('cfg.preview')), renderTemplate('execute', PREVIEW_VALUES)]),
          ]),
          // 3. 动作模板编辑器（其余 6 动作 · T1：默认展开可手动折叠）
          h('details', { open: true, className: 'dsws-cfg-group dsws-cfg-details' }, [
            h('summary', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 650, marginBottom: 4, cursor: 'pointer', listStyle: 'none' } }, [Ic({ n: 'note', size: 13 }), h('span', null, tr('cfg.tplEditor'))]),
            h('div', { className: 'dsws-cfg-gdesc' }, [
              h('span', null, tr('cfg.tplEditorDesc')),
              h('a', { href: 'javascript:void(0)', onClick: function () { const el = document.getElementById('dsws-cfg-exec-group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, style: { color: '#bc8cff', cursor: 'pointer', flex: 'none', textDecoration: 'none' } }, tr('cfg.execHint')),
            ]),
            TPL_EDIT_IDS.map(tplCard),
          ]),
          // 校验错误提示
          errs.length ? h('div', { className: 'dsws-cfg-err' }, [
            h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.saveRejected'))]),
            errs.map(function (e, i) { return h('div', { key: i }, '· ' + e) }),
          ]) : null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'flex-end' } }, [
            h('button', { className: 'dsws-cfg-btn', onClick: resetAll }, tr('cfg.resetAll')),
            h('button', { className: 'dsws-cfg-save', onClick: save }, [Ic({ n: 'check', size: 13 }), h('span', null, tr('cfg.saveAll'))]),
          ]),
        ])
      }

      // ---- 5.10 Run 卡控制面板（v25：状态展示 + 快捷打开配置页；外观切换已迁入设置页）----
      const RunPanel = (props) => {
        const cur = props.useSessions((x) => x.current)
        const s = useStore(cur)
        return h('div', { style: { border: '1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius: 8, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1,#10131a)', fontFamily: 'var(--dsw-font-family)', fontSize: 13, color: 'var(--dsw-alias-label-primary,#e6edf3)', lineHeight: 1.6 } }, [
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
            h('strong', null, tr('panel.title')),
            h('span', { style: { display: 'flex', alignItems: 'center', gap: 4, color: '#4ade80', fontSize: 12 } }, [Ic({ n: 'dot', size: 10 }), h('span', null, tr('run.loaded'))]),
          ]),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', margin: '6px 0' } }, tr('run.desc')),
          h('div', { className: 'dsws-uirow' }, [
            h('button', { className: 'dsws-btn', onClick: function () { openPanel(s) } }, tr('run.openPanel')),
            // v25：设置面板为 shell 组件本地状态、无公开打开 API（已查证）→ 按钮引导路径（偏离记录见 T2a resolution）
            h('button', { className: 'dsws-btn', onClick: function () { flash(s, tr('run.cfgGuide'), 'info') } }, tr('run.openCfg')),
          ]),
        ])
      }

      // ============================================================
      // 6. 插槽注册（收集 disposer，热卸载时统一清理；静态插件无 Run 卡，不注册 tool.view.cordis）
      // ============================================================
      const disposeSlots = [
        slots.inject('shell.overlay', function () {
          return slots.register({ name: 'shell.overlay', id: 'dsws-overlay-v5', order: 10 }, OverlayPanel)
        }),
        slots.inject('conversation.input.dock', function () {
          return slots.register({ name: 'conversation.input.dock', id: 'dsh-mattpocock-skills-deck', order: 40 }, StatusBar)
        }),
        // v25-50：配置页（设置 → 插件 → Waystation；与 opencode 主题同模式）
        slots.inject('settings.plugins.tab', function () {
          return slots.register({ name: 'settings.plugins.tab', id: 'dsws-settings', order: 40, label: function () { return tr('panel.title') } }, SettingsPage)
        }),
        // v1.5 T2：设置左侧直达 —— settings.section 左栏条目（与插件页 tab 双入口，复用同一 SettingsPage）
        //   order 18 = 紧跟 插件页15 之后（用户拍板 2026-08-16：15 < 18 < AgentPresets20 < better-sidebar100）
        slots.inject('settings.section', function () {
          return slots.register({ name: 'settings.section', id: 'dsws-settings-section', order: 18, label: function () { return tr('panel.title') } }, SettingsPage)
        }),
        // 原型：右侧停靠（details 槽位 · 替换内置工具详情面板）
        // priority: -1 低于内置详情面板默认 0 → 无冲突且「低者胜出」替换内置面板
        slots.inject('details', function () {
          return slots.register({ name: 'details', id: 'dsws-details', order: 10, priority: -1 }, DetailsDock)
        }),
        // v1.4.1：better-sidebar tab 注册上移为 ensureSidebarTab（幂等 + 定时重试 + openTab 前兜底），
        //   见 openInSidebar 定义处；disposer / 重试定时器清理见下方独立 ctx.effect。
        //   旧实现注册到 betterSidebar.tab 槽位是死代码 —— better-sidebar 从不消费该槽位，
        //   导致 npm 版 tab 永不注册（openTab 静默 no-op）→「切侧边栏没反应」根因之一。
      ]
      ctx.effect(function () {
        return function () {
          disposeSlots.forEach(function (d) { try { if (d) d() } catch (e) { /* 忽略清理期错误 */ } })
        }
      }, 'dsh-mattpocock-skills-deck: slots')

      // v1.4.1：apply 时尽力注册「Waystation」tab；better-sidebar 服务未就绪（加载晚于本模块）→ 定时重试（最多 10 次）
      //   卸载（HMR / 插件禁用）时清理 disposer + 重试定时器
      if (!ensureSidebarTab()) {
        let tries = 0
        sidebarTabRetry = setInterval(function () {
          tries++
          if (ensureSidebarTab() || tries >= 10) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
        }, 1000)
      }
      ctx.effect(function () {
        return function () {
          try { if (sidebarTabDisposer) sidebarTabDisposer() } catch (e) { /* 忽略 */ }
          sidebarTabDisposer = null
          if (sidebarTabRetry) { clearInterval(sidebarTabRetry); sidebarTabRetry = null }
        }
      }, 'dsh-mattpocock-skills-deck: better-sidebar tab')

      // 加载真数据快照（repo 链接 + 前置检测兜底），失败静默
      loadSnapshot(shared, false)
    }

    return module.exports
  },
})
