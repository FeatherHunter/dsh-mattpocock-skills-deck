/**
 * panel/Dock.ts — 右侧停靠容器（DetailsDock，5.8b；tabs 行改用共享 Tabs.js）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:... (spliced by build) ====` 标记处（源码树里只有这一份真源）。
  * （#1251：本文件由同名 .js 转成 .ts，只补类型标注（形参一律 any）与环境声明，运行时行为一字不动。约束：不许加运行时 import（跨文件名字一律 ambient declare，构建拼闭包时拒收残留 import）；不许 export default；只写可剥离类型。）
 */
/**
 * 闭包环境声明（#1251 转 TS 时补的）：下面这些名字在源码树里没有定义，
 * 它们是别的叶子拼进同一个浏览器闭包时带进来的；类型检查靠这里声明形状。
 * 构建转译时会把 declare 整段抹掉，所以运行时一字不差。
 * 约束：以后新增跨文件引用只许在这里加 declare，不要加运行时 import
 * （构建侧 toSpliceableFragment 会拒收残留的 import，整个片段拼不进去）；
 * 也不要写 export default（构建侧 inlineExportDeclarations 不收 as 改名）。
 */
// 调用的动作函数（后端、快照、选择、日志时钟、折叠阶梯、store 钩子）。
declare function adoptBoundRev(...args: any[]): any;
declare function backendBgOf(...args: any[]): any;
declare function backendBorderOf(...args: any[]): any;
declare function backendColorOf(...args: any[]): any;
declare function compute(...args: any[]): any;
declare function findGroupByIdentity(...args: any[]): any;
declare function firstBackendIdOf(...args: any[]): any;
declare function flash(...args: any[]): any;
declare function freshnessToneColor(...args: any[]): any;
declare function headFoldLadderOf(...args: any[]): any;
declare function headFoldStateAt(...args: any[]): any;
declare function Ic(props?: any): any;
declare function isBackendUnavailable(...args: any[]): any;
declare function isEnabled(...args: any[]): any;
declare function labelOf(...args: any[]): any;
declare function lcPanelSavedColors(...args: any[]): any;
declare function loadSnapshot(...args: any[]): any;
declare function noticeIcon(...args: any[]): any;
// #1582：打开文件夹的共用函数（实现住在 views/shared/openFolder.ts，由构建拼进同一个闭包）。
declare function openFolderAt(...args: any[]): any;
declare function openSwitchConfirm(...args: any[]): any;
declare function otherFiltered(...args: any[]): any;
// panelClock 在这里只被读写 renderT0/commitMs 两个字段（调用发生在别处），
// 声明成 any（可调用也可取属性）；换成函数形声明反而把属性访问卡死。
declare const panelClock: any;
declare function panelNow(...args: any[]): any;
declare function peekNav(...args: any[]): any;
declare function prTabVisible(...args: any[]): any;
declare function refreshAll(...args: any[]): any;
declare function repoShortName(...args: any[]): any;
declare function repositoryActionOf(...args: any[]): any;
declare function setCachedSelection(...args: any[]): any;
declare function setPresentationMap(...args: any[]): any;
declare function truthFreshnessBox(...args: any[]): any;
declare function useDockSync(...args: any[]): any;
declare function userPickSelection(...args: any[]): any;
declare function useStore(...args: any[]): any;
declare function useTabsRow(...args: any[]): any;
// 值引用的组件与常量（传给 h 当组件用，或按名索引，不调用）。
declare const ChecksTab: any;
declare const IssueDetail: any;
declare const LabelColorEntry: any;
declare const ListTab: any;
declare const MapDetailV2Page: any; // #1402：地图详情页入口已切到 V2；老页 MapDetail 的源码与门禁都留着，出问题可以一行切回
declare const NamingFailBanner: any;
declare const NOTICE_COLOR: any;
declare const PrTab: any;
declare const RepoChipSkeleton: any;
declare const SkillsTab: any;
declare const SubworkspaceMark: any;
declare const SwitchConfirmModal: any;
declare const Tip: any;
declare const VersionControlTab: any;
declare const WorkRouteTrigger: any; // #1285：头部那一行右端的「跨会话在办表」图标（点开浮层看表）

    // ---- 5.8b 右侧停靠（details 槽位 · 三视图完整内容；开合/拖拽/宽度记忆由壳管理）----
    // 契约：details 槽 = 壳右侧第三列（AppFrame grid），scope session；关闭 = ctx.layout.closeDetails()
    //   （占位者 props 亦注入 closeDetails）；宽度 300-520px 可拖拽；关闭时子树不卸载（状态保留）。
    // issue #15：tabs 行内容放不下时折叠为纯图标（内容自适应 + 滞回防抖）
    // #606 常规测点（面板打开各阶段耗时）：本文件只把两个时刻记进 panelClock，日志由 panel/DockSync.js 打。
    //   为什么日志不写在这里：渲染目录（views/panel/statusbar/floating）里只有点名文件允许写日志，
    //   本文件不在那份名单里（判定依据见 tests/verify-log-truncate.js 第 4 组的 allowFiles）。
    //   记「进入渲染」与「提交完成」两个时刻，就能把「点开面板到画面出来」切成
    //   渲染期（建整棵子树并提交）与提交后到被动副作用跑完两段，看清是哪一段贵。
export     const DetailsDock = (props: any) => {
      if (isEnabled('debug')) panelClock.renderT0 = panelNow()
      // 提交边界：整棵子树的 DOM 都建好、子组件的布局副作用也跑完之后、浏览器开始绘制之前。
      React.useLayoutEffect(function () {
        try { if (isEnabled('debug')) panelClock.commitMs = Math.round(panelNow() - panelClock.renderT0) } catch (eCM) {}
      })
      // #45 回归：切绘画/工作区后右面板串台——原实现挂载仅跑一次副作用（deps []）且直接取 props.sessionId（宿主 details 槽常空 → 退回 shared 单例），
      //   切会话不重跑水合、非 current 快照经 shared 广播串台；修复 = 跟随 useSessions 权威信号（hookCurrent）+ 精确 cwd（summaryCwd），副作用 deps 随 [sid]/[sid,summaryCwd] 重跑。
      const hookCurrent = (props && typeof props.useSessions === 'function') ? props.useSessions(function (x: any) { return x.current }) : undefined
      const propSid = props && (props.sessionId || (props.scope && props.scope.sessionId) || (props.session && props.session.id))
      const sid = propSid || hookCurrent
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const summaryCwd = (props && typeof props.useSessions === 'function' && sid) ? props.useSessions(function (x: any) { return (x.byId && x.byId[sid]) ? x.byId[sid].cwd : undefined }) : undefined
      const s = cx ? cx.storeSvc.useStore(sid) : useStore(sid)
      // 2026-09-22：原先这一行取的是壳的 layout 服务，它只服务于头部那颗 ×；那颗 × 已按维护者要求整块删掉
      //   （提示写着「关闭面板」、动作却是关详情），没有调用点的 closeDock 一并删了。面板开合仍由壳自己管。
      const dockRef = React.useRef(null)
      const [dw, setDw] = React.useState(460)
      // 头部第一行右侧那两个控件（以及它们让完之后才动的仓库名）收到第几档：阶梯表见下面那台头部折叠机，档号由它算。
      const [headFold, setHeadFold] = React.useState(0)
      // 列宽感知：details 列 300-520px；窄于 380 时动作按钮折叠为纯图标（与悬浮面板同阈值）
      React.useEffect(function () {
        if (!dockRef.current) return
        const el = dockRef.current
        const ro = new ResizeObserver(function (entries: any) {
          try { setDw(entries[0].contentRect.width) } catch (e) { /* 忽略 */ }
        })
        ro.observe(el)
        return function () { try { ro.disconnect() } catch (e) { /* 忽略 */ } }
      }, [])
      // #179 加固与污染自愈已搬 DockSync.js（useDockSync），此处单调供装配（同闭包拼回）
      useDockSync(s, sid, summaryCwd, props)
      const groups = compute(s)
      // #552 导航栈：渲染优先级读栈顶（镜像兜底，保证旧状态不崩）；空栈回列表
      const navTop = (typeof peekNav === 'function') ? peekNav(s) : null
      const topMap = navTop && navTop.kind === 'map' ? navTop.n : s.activeMap
      const topIssue = navTop && navTop.kind === 'issue' ? navTop.n : s.activeIssue
      // effort 维度：当前地图按 (effort, 编号) 找，同号的不同 effort 地图不再互相顶替
      const topEffort = navTop ? ((navTop.effortId !== undefined && navTop.effortId !== null) ? String(navTop.effortId) : '') : (s.activeEffortId ? String(s.activeEffortId) : '')
      const active = topMap !== null && topMap !== undefined ? findGroupByIdentity(groups, topMap, topEffort) : null
      const hasIssueDetail = topIssue !== null && topIssue !== undefined
      const narrow = dw < 380
      // #506 无能力回列表：正停在拉取请求页时切到无能力后端，自动回到列表页（只读能力位）。
      const showPrTab = (typeof prTabVisible === 'function') ? prTabVisible(s) : false
      React.useEffect(function () {
        if (s.tab === 'pr' && !showPrTab) { s.tab = 'list'; emit(s) }
      }, [s.tab, showPrTab])
      // #187 Banner→Modal 门控（承接 #184 定版：Banner 点→Modal 动态三选，不含 Other，取消/确认 + 整条隐藏+容器不挂载 + pending/isOther 两态 + 动态多态）
      const _sel = s.selection || (s.snapshot && s.snapshot.selection) || null
      const _isPending = !!(_sel && _sel.pending && !!s.cwd && s.snapMode==='real' && !!s.snapshot)
      const _isOtherRaw = !!(_sel && _sel.backendId===null && !_sel.pending)
      const _isOther = _isOtherRaw && !!s.cwd && s.snapMode==='real' && !!s.snapshot
      const _showBackendFullscreen = _isPending || _isOther
      // #664：门控这个窗只把后端定下来 —— 绑定成功后不再往会话里注入任何文字（原先这里会顺手注入初始化全文）。
      const _gateOpen=!!s.gateModalOpen && (s.gateModalSource==='dock' || !s.gateModalSource);const _gateModules=otherFiltered(s.backendModules);const _openGateModal=function(){s.gateModalOpen=true;s.gateModalSource='dock';if(!s.gateSelected)s.gateSelected=firstBackendIdOf(_gateModules);s.gateError='';emit(s);if(typeof host!=='undefined'&&host.call){s.gateLoading=true;emit(s);host.call('wf.registry',{cwd:s.cwd||''}).then(function(r: any){s.gateLoading=false;let m=null;if(r&&r.ok&&Array.isArray(r.modules))m=r.modules;else if(r&&Array.isArray(r.modules))m=r.modules;else if(r&&r.value&&Array.isArray(r.value.modules))m=r.value.modules;if(Array.isArray(m)&&m.length){const f=m.filter((x: any)=>String(x.id).toLowerCase()!=='other');const fin=f.length?f:m.filter((x: any)=>String(x.id).toLowerCase()!=='other');if(fin.length){s.backendModules=m;try{if(typeof setPresentationMap==='function')setPresentationMap(m)}catch(e){}const ids=fin.map((x: any)=>x.id);if(!s.gateSelected||ids.indexOf(s.gateSelected)<0)s.gateSelected=fin[0].id}}emit(s)}).catch(function(){s.gateLoading=false;emit(s)})}};const _closeGateModal=function(){s.gateModalOpen=false;s.gateModalSource=null;s.gateError='';emit(s)};const _confirmGate=function(){const id=s.gateSelected||firstBackendIdOf(_gateModules);if(String(id).toLowerCase()==='other'){s.gateError=tr('switch.gateOtherErr');emit(s);return}const prev=s.selection;const repoRef=s.repository||(s.snapshot&&s.snapshot.repository)||null;const nxt=(typeof userPickSelection==='function')?userPickSelection(id,repoRef,prev):{backendId:id,source:'explicit',ref:repoRef,userPicked:true};s.selection=nxt;try{if(s.cwd)setCachedSelection(s.cwd,nxt)}catch(e){}s.gateModalOpen=false;s.gateModalSource=null;emit(s);if(typeof host!=='undefined'&&host.call){host.call('wf.bind',{cwd:s.cwd||'',backendId:id,sessionId:sid||''}).then(function(res: any){const ok=res&&(res.ok===true||(res.value&&res.value.ok===true)||res.ok);if(ok){try{if(typeof adoptBoundRev==='function')adoptBoundRev(s,res)}catch(eRev){};try{var _np=res&&(res.persisted===false||(res.value&&res.value.persisted===false));if(_np)flash(s,tr('switch.bindNotPersisted'),'info')}catch(eP){};s.tab='list';emit(s);try{flash(s,tr('switch.bindOkFresh',{label:(typeof labelOf==='function'?labelOf(id):String(id))}),'ok')}catch(e){}
loadSnapshot(s,true,true)}else{s.selection=prev;try{if(s.cwd)setCachedSelection(s.cwd,prev)}catch(e){};emit(s);try{flash(s,tr('switch.bindFail',{err:String((res&&(res.error||res.message))||'unknown').slice(0,120)}),'warn')}catch(e){}}}).catch(function(e: any){s.selection=prev;try{if(s.cwd)setCachedSelection(s.cwd,prev)}catch(e2){};emit(s);try{flash(s,tr('switch.bindFail',{err:String(e&&e.message||e).slice(0,120)}),'warn')}catch(e3){}})}};const pickBackend=function(id: any){s.gateSelected=id;emit(s);_confirmGate()}
      const tabsRef = React.useRef(null)
      const tabs = useTabsRow(s, tabsRef)
      const headRef = React.useRef(null)
      React.useEffect(function () {
        const applyFold = function () {
          const t = tabsRef.current
          if (!t) return
          const btns = t.querySelectorAll('[data-priority]')
          // 测量阶段临时禁用 transition（max-width 动画会污染 scrollWidth 测量 → 0/6 抖动）
          t.classList.add('dsws-no-anim')
          // 1) 全展开 + 强制 reflow（拿到"内容真实放得下"的基准）
          for (let i = 0; i < btns.length; i++) btns[i].classList.remove('collapsed')
          void t.offsetWidth
          // 2) 从最不重要（priority 大）逐个折叠，直到放得下（scrollWidth 溢出判定）
          const items = Array.from(btns)
            .map(function (b: any) { return { el: b, p: Number(b.dataset.priority || 99) } })
            .sort(function (a: any, b: any) { return b.p - a.p })
          for (const it of items) {
            if (t.scrollWidth <= t.clientWidth + 1) break
            it.el.classList.add('collapsed')
            void t.offsetWidth
          }
          // 3) 记录折叠数供 tooltip 门控。#1285：原先这里还有「版本号让位」那一步 —— 版本号已从这一行撤走，
          //   在办表图标（接在最右端）永远不折叠，让位这件事由第 2 步的按优先级折叠负责。
          t.dataset.tabsLevel = String(t.querySelectorAll('[data-priority].collapsed').length)
          t.classList.remove('dsws-no-anim')
        }
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { applyFold() }) : null
        let observed: any = null
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
      // 头部第一行那一排随宽度逐字变短的判据在 panel/headFold.js（纯函数，只有一条阶梯）；
      //   这里把「现在该画什么」的数据凑齐，再算出当前档位下每个元素画什么 —— 渲染与折叠机读的都是它。
      const headBox = (typeof truthFreshnessBox === 'function') ? truthFreshnessBox(s, Date.now()) : null
      const headRepo = s.repository || (s.snapshot && s.snapshot.repository) || null
      const headAgo = headBox ? tr(headBox.agoKey, headBox.agoParams) : ''
      const headTip = headBox ? tr('truth.updatedTip', { ago: headAgo, time: headBox.time }) : ''
      // 仓库名按版面上显示的那一串（就是芯片里那串字）逐字变短；完整的那一串留在悬停提示里，一个字都不丢。
      const headLadder = (typeof headFoldLadderOf === 'function') ? headFoldLadderOf({ name: headRepo ? String(headRepo.name || '') : '', refresh: tr('list.refresh'), time: headAgo, icons: ['palette', 'switch', 'mark'] }) : null
      const headNow = headLadder ? headFoldStateAt(headLadder, headFold) : null
      const headIconCls = function (id: any) { return (headNow && headNow.icons[id] === false) ? 'dsws-folded' : undefined }
      // 头部自适应（#28 那条收缩链的第三代，维护者 2026-09-22 定）：空间不够时照 panel/headFold.js 那条阶梯
      //   一档一档往下走，每一步最多少一个字符 —— 先动右侧那两个控件（刷新的字 → 时间标签），再让仓库名尾部
      //   逐字变短，最后才是那几颗单字形小图标一颗一颗撤；刷新那颗齿轮图标永不让位。档号 = 已经走了几步。
      React.useEffect(function () {
        const applyHead = function () {
          const hd = headRef.current
          if (!hd || !headLadder) return
          const nameEl = hd.querySelector('[data-repo-text]')
          if (!nameEl) return
          const rfEl = hd.querySelector('[data-head-refresh-text]')
          const tmEl = hd.querySelector('[data-updated-ago]')
          const iconEls: any = Array.from(hd.querySelectorAll('[data-head-icon]'))
          // 放不下怎么判：用这一行自己的 scrollWidth —— 它量的是内容的真实横跨宽（含内边距），与面板宽度线性对应，
          //   于是「窄 6 像素 = 多让位一格（一格一个字）」这件事成立。measureContentWidth 只取「最后一个还有宽度的
          //   孩子」的右缘，末尾那个空了的元素一挡就少算十几像素（真机实测：内容已溢出还说放得下，下一档掉好几个字）。
          const naturalFits = function () { return hd.scrollWidth <= hd.clientWidth + 1 }
          // 把这一行推到第 tier 档（每一步只少一个字符，按 headFoldStateAt 说的画），推完立刻量一次放不放得下。
          const applyTier = function (tier: any) {
            const st = headFoldStateAt(headLadder, tier)
            nameEl.textContent = st.name
            if (rfEl) rfEl.textContent = st.refresh
            if (tmEl) tmEl.textContent = st.time
            for (const el of iconEls) el.classList.toggle('dsws-folded', st.icons[el.getAttribute('data-head-icon')] === false)
            void hd.offsetWidth
          }
          const settle = function (n: any) { setHeadFold(function (p: any) { return p === n ? p : n }) }
          applyTier(0)
          if (naturalFits()) return settle(0)
          for (let t = 1; t <= headLadder.steps.length; t++) { applyTier(t); if (naturalFits()) return settle(t) }
          settle(headLadder.steps.length)
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
      }, [headLadder ? headLadder.name : '', headAgo, headTip, dw])
      // #670（2026-09-20 第三轮定）：面板底色取 --dsw-alias-bg-base，与它所在的那一层同档。
      //   面板自 #646 起住在 DSH 原生右侧边栏里，那一格是宿主右栏面板容器画的底（同样取 bg-base）。
      //   本插件在此之前用的是 --dsw-alias-bg-layer-1（页面那一档，深色主题 #232324），比右栏的底亮一档：
      //   宿主画好那一格、本插件还没画出第一笔的那一瞬，露出来的是更黑的宿主底，用户看到的就是「突然黑一下」。
      //   取同一档之后，那一格从出现到有内容全程一个颜色，只剩「内容出现」这一下。
      //   浅色主题下两个令牌都是 #ffffff，这一条在浅色主题下不改变任何东西。
      return h('div', { ref: dockRef, 'data-dsws-host': '1', className: narrow ? 'dsws-narrow' : undefined, style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--dsw-font-family)', fontSize: 12, color: 'var(--dsw-alias-label-primary,#e6edf3)', background: 'var(--dsw-alias-bg-base,#10131a)' } }, [
        // 头部（仓库芯片 + 归属标志 + 三颗按钮 + 刷新 / 时间）：横线不放在这行，下移到标签行下方与对话/轨迹对齐。
        //   这一行的第一个元素就是仓库芯片 —— 品牌那一段（罗盘图标 + 「MattSkills」字样）已按 #667 去掉。
        // #28 自适应：这一行整排随宽度逐字变短（阶梯表在 panel/headFold.js）；上面那台折叠机算出的档号在这行上。
        h('div', { ref: headRef, 'data-head-tier': headFold, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px 6px', flex: 'none', minWidth: 0 } }, [
          // 2026-09-19 维护者定：这一行不再放罗盘图标与「MattSkills」字样，从仓库芯片开始。
          //   品牌字样留在设置页与右栏标题那两处（那两处说的是「这个面板叫什么」，头部这一行说的是
          //   「这份数据是谁的」，两件事不该挤在同一行）。
          // #155 Q5：仓库身份泛化 — RepositoryRef.name/url + 按 backend 着色；未知原串灰色；空 url 不链；pending/multiHit 黄条由下行承载
          (function(){
            let repoRef = (s.repository || (s.snapshot && s.snapshot.repository) || null)
            const sel = s.selection || (s.snapshot && s.snapshot.selection) || null
            // 2026-08-28 契约修正（用户复核）：仓库名一律由 host 后端 describe 经契约层产出，UI 零派生——
            //   markdown 本地形态（目录即仓库）同理由 describe 给出 name=目录名；前端不再有派生分支，
            //   剩余 null 只可能是异常态 → 诚实警示「未识别仓库」。
            // 快照还没回来时画的是一条灰色占位骨架（它为什么长这样、为什么不许带 data-repo-text，都写在 panel/RepoChipSkeleton.js 的文件头）。
            if (!repoRef && !s.snapshot) return h(RepoChipSkeleton, { key: 'repoSkeleton', label: tr('panel.repoLoading') })
            if (!repoRef && sel && sel.backendId) {
              // 远程型后端（github/gitlab）已选但仓库引用缺失：诚实警示，不冒充仓库名；诊断交由环境检查 gh:remote 红牌
              return h(Tip, { content: tr('panel.repoUnidentifiedTitle') }, h('span', { 'aria-label': tr('panel.repoUnidentifiedTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('panel.repoUnidentified'))]))
            }
            if (!repoRef) return h(Tip, { content: tr('panel.noRepoTitle') }, h('span', { 'aria-label': tr('panel.noRepoTitle'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.5)', borderRadius: 6, padding: '1px 8px', flex: 'none', whiteSpace: 'nowrap' } }, [Ic({ n: 'alert', size: 11 }), h('span', null, tr('panel.noRepo'))]))
            const bid = sel ? sel.backendId : (repoRef.backend || firstBackendIdOf(null))
            // #191：品牌色纯机制派生（后端 presentation 单源，无硬编码兜底——函数在 store 已内置中性兜底）
            const col = (typeof backendColorOf==='function'? backendColorOf(bid) : '')
            const bg = (typeof backendBgOf==='function'? backendBgOf(bid) : '')
            const bdc = (typeof backendBorderOf==='function'? backendBorderOf(bid) : '')
            const short = (typeof repoShortName==='function'? repoShortName(repoRef) : String(repoRef.name||'').split('/').pop())
            const href = repoRef.url || ''
            const inner = [h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'currentColor', style: { flex: 'none' } }, [h('path', { d: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 8h8.5V1.5z' })]), h('span', { 'data-repo-text': 1, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, headNow ? headNow.name : repoRef.name)]
            // #667 第三轮：这枚芯片不再靠 flex 收缩 + 省略号截断（那样一次掉好几个字），长度全由 panel/headFold.js
            //   那条阶梯一格一格地减。boxSizing 必须是 border-box —— minWidth 40 是照「外框 40 像素」写的，默认的
            //   content-box 会把它垫成外框 58（真机实测：名字收到只剩省略号时芯片卡在 58，后面几格一格也省不出宽度）。
            const chipStyle = { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: col, backgroundColor: bg, border: '1px solid transparent', borderRadius: 6, padding: '1px 8px', flex: 'none', boxSizing: 'border-box', minWidth: 40, maxWidth: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Consolas,Menlo,monospace', borderColor: bdc, colorScheme: 'light dark' }
            // #231（契约动作）：开仓行为由后端 openRepository 声明驱动 —— folder 型走共用打开函数（#1582），url 型浏览器原生新窗；无声明且无 url 即无动作（诚实渲染）
            const act = repositoryActionOf(s, bid)
            if (act === 'folder') {
              // #1582：目录还没同步到手时不再把空串发给宿主，改成当场说一句「目录还没准备好」；
              //   宿主回 {ok:false,error} 也把原因弹出来（这两条以前都是静默的）。
              const openRepoFolder = function (e: any) {
                try { if (e && e.preventDefault) e.preventDefault() } catch (_) {}
                openFolderAt(host, s.cwd, function (outcome: any, detail: any) {
                  if (outcome === 'missing') {
                    try { flash(s, tr('logtoast.openNoDir'), 'warn') } catch (__) {}
                    return
                  }
                  if (outcome === 'open-failed') {
                    try {
                      const why = (typeof detail === 'string' && detail) ? detail.slice(0, 120) : ''
                      flash(s, why ? tr('logtoast.openFailed', { err: why }) : tr('logtoast.openFailedNoReason'), 'warn')
                    } catch (__) {}
                  }
                })
              }
              return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, repoRef.name), h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px', marginTop: 2 } }, tr('tip.header.repoAction'))]) }, h('a', { href: 'javascript:void(0)', 'aria-label': repoRef.name, 'data-repo-chip': 1, className: 'dsws-hov', 'data-press': 'button', 'data-log': 'head.repochip', style: Object.assign({}, chipStyle, { cursor:'pointer' }), onClick: openRepoFolder }, inner))
            }
            if (!href) return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, repoRef.name)]) }, h('span', { 'aria-label': repoRef.name, 'data-repo-chip': 1, style: Object.assign({}, chipStyle, { cursor:'default' }) }, inner))
            // #191（用户反馈）：GitHub/GitLab 路径只 target='_blank'（浏览器原生新窗口），
            //   之前的 onClick openUrl 导致点一次开两个浏览器。Markdown 路径见上方分支（那一支已改走共用打开函数 openFolderAt）
            // 悬停提示里始终摆着**完整**的仓库名（维护者 2026-09-22 定：版面上那一串会随宽度逐字变短，
            //   一个字都不许丢，完整的那串必须能在悬停时读到），再加一句这颗芯片点下去做什么。
            return h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullRepo')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, repoRef.name), h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px', marginTop: 2 } }, tr('panel.repoTitle'))]) }, h('a', { href: href, target: '_blank', rel: 'noreferrer', 'aria-label': repoRef.name, 'data-repo-chip': 1, className: 'dsws-hov', 'data-press': 'button', 'data-log': 'head.repochip', style: chipStyle }, inner))
          })(),
          // #653：这枚归属标志只在「会话所选目录 ≠ 工作区根」时出现（根会话、嵌套仓库、无仓库目录都不出现），
          //   放在仓库芯片右侧、与「未识别仓库」琥珀芯片和「该工作区尚未初始化」提示并存，不替代任何一条既有提示。
          // #667 第三轮：它是一颗单字形小图标，宽度不够时一颗一颗撤（撤的是外面这层 span：它身上不写 display，
          //   所以 kernel/styles.js 那条 .dsws-folded 规则盖得住；里面那颗按钮自己写着 display，标记不能落在它身上）。
          h('span', { 'data-head-fold': 'icon', 'data-head-icon': 'mark', className: headIconCls('mark'), style: { lineHeight: 0 } }, h(SubworkspaceMark, { key: 'subws', st: s })),
          // #191 · 仓库名右侧切换按钮（已选态常驻 · pending 灰置 · _isOther 隐藏）
          h('span', { 'data-head-fold': 'icon', 'data-head-icon': 'switch', className: headIconCls('switch'), style: { lineHeight: 0 } }, (function(){ if(_isOther) return null; var _sel=s.selection||(s.snapshot&&s.snapshot.selection)||null, _bid=_sel?_sel.backendId:null; if(_bid==null) return null; var _pend=!!(_sel&&_sel.pending), _col=(typeof backendColorOf==='function'?backendColorOf(_bid):'#6e7681'); return h(Tip, { content: _pend ? '切换后端 · 探测中不可用' : '切换后端' }, h('button',{'data-repo-switch':1,className:'dsws-hov','data-press':'icon','data-log':'head.switchbackend',type:'button','aria-label':'切换后端','aria-disabled':_pend?'true':'false',disabled:_pend,onClick:function(e: any){try{if(e&&e.preventDefault)e.preventDefault();if(e&&e.stopPropagation)e.stopPropagation()}catch(_){};if(_pend)return;try{openSwitchConfirm(s,null)}catch(_){}},style:{display:'inline-flex',alignItems:'center',justifyContent:'center',boxSizing:'border-box',width:16,height:16,borderRadius:4,flex:'none',border:'1px solid '+_col,color:_col,background:'transparent',cursor:_pend?'not-allowed':'pointer',opacity:_pend?0.45:1,fontSize:10,lineHeight:1,padding:0,colorScheme:'light dark'}},Ic({n:'swap',size:10}))) })()),
          // #621 标签配色入口：16 像素见方的小图标（与左边那颗切换后端按钮同规格），点开改色弹窗；
          //   它和左右两颗单字形图标一样，宽度不够时一颗一颗撤（撤的是外面那层 span，见上面 #667 第三轮那句）。
          //   会话号一起传进去：宿主靠它算「写这个工作区」要用的沙箱政策（#624 的研究结论）。
          h('span', { 'data-head-fold': 'icon', 'data-head-icon': 'palette', className: headIconCls('palette'), style: { lineHeight: 0 } }, h(LabelColorEntry, {
            key: 'labelcolors', cwd: s.cwd, sessionId: sid, narrow: narrow,
            // #635：保存成功这一刻就把后端确认过的颜色写进面板这份快照并重画，不再等下面那次全量重拉——
            // 那次在 GitHub 工作区上要二十多秒，等它等于让用户看着旧颜色以为没刷新。
            onSaved: function (applied: any) {
              try { if (lcPanelSavedColors(s, applied, Date.now())) emit(s) } catch (e) { /* 当场改色失败不影响这次保存的结果 */ }
              try { loadSnapshot(s, true, true) } catch (e2) { /* 后台那次全量重拉失败也不影响已经改好的颜色 */ }
            },
          })),
          h('span', { style: { flex: 1 } }),
          // 这一行右侧两个各自独立的控件（维护者 2026-09-22 定）：左＝刷新按钮，右＝小时间标签，两者只用这一行的 gap 分开，
          //   不许用分隔符粘成一句（verify-667 的 A14 / B8 盯着）。宽度不够时它们最先瘦身：刷新的字逐字变少、只剩齿轮图标，
          //   再轮到时间标签那句相对时间逐字变少；时间标签一个字都不剩时，完整说法与精确时刻挪进刷新按钮的悬停提示。
          h(Tip, { content: (headNow && headNow.time === '' && headTip) ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', null, tr('list.refresh')), h('div', null, headTip)]) : tr('list.refresh') }, h('button', {
            className: 'dsws-btn dsws-hov', 'data-press': 'button', 'data-log': 'head.refresh', 'data-head-refresh': 1, type: 'button', 'aria-label': tr('list.refresh'),
            onClick: function () { refreshAll(s) },
            style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, flex: 'none' },
          }, [h('span', { className: 'dsws-rficon' + (s.refreshing ? ' dsws-spin' : '') }, [Ic({ n: 'refresh', size: 11 })]),
            h('span', { 'data-head-refresh-text': 1, style: { whiteSpace: 'nowrap' } }, headNow ? headNow.refresh : tr('list.refresh'))])),
          // 时间标签：版面上那句相对时间按阶梯逐字变短（3 分钟前 → 3 分钟 → 3 分 → …，一个字都不许整块消失），
          //   上色沿用原来那条状态行的口径（灰 / 黄 / 红）。
          headBox ? h(Tip, { content: headTip }, h('span', { 'data-head-updated': 1, style: { flex: 'none', fontSize: 11, whiteSpace: 'nowrap', color: freshnessToneColor(headBox.tone) } },
            h('span', { 'data-updated-ago': 1, style: { fontVariantNumeric: 'tabular-nums' } }, headNow ? headNow.time : headAgo))) : null,
        ]),
        // #155 Q5：Pending / MultiHit 黄条（提示不阻断）
        (function(){
          const sel = s.selection || (s.snapshot && s.snapshot.selection) || null
          if (!sel) return null
          const isPending = !!sel.pending
          const isMulti = Array.isArray(sel.multiHit) && sel.multiHit.length>1
          if (!isPending && !isMulti) return null
          const bg = 'rgba(245,158,11,.12)', bd='rgba(245,158,11,.45)', col='#f59e0b'
          if (isPending) return h('div', { style:{ margin:'0 12px 6px', padding:'4px 8px', background:bg, border:'1px solid '+bd, color:col, fontSize:11, borderRadius:6, display:'flex', alignItems:'center', gap:6 } }, [
            h('span', { className:'dsws-spinner', style:{ width:11, height:11, borderWidth:2, display:'inline-block' } }),
            h('span', { style:{ flex:1 } }, tr('switch.probeRunningHint')),
            // 接线（#1335 界面反馈）：黄条上这颗「重试」是用户真的会点的按钮，按压反馈与点击日志都接上。
            //   日志名只写固定枚举（不写按钮上的字），看日志时凭 panel.pending.retry 认出就是这一颗。
            h('button', { className:'dsws-btn dsws-hov', 'data-press':'button', 'data-log':'panel.pending.retry', onClick:function(){ if(typeof host!=='undefined'&&host.call) host.call('wf.registry',{cwd:s.cwd||''}).then(function(){ loadSnapshot(s,true,true)}) }, style:{ fontSize:10, padding:'1px 6px', flex:'none' } }, tr('pr.retry')),
          ])
          if (isMulti) return h('div', { style:{ margin:'0 12px 6px', padding:'4px 8px', background:bg, border:'1px solid '+bd, color:col, fontSize:11, borderRadius:6, display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' } }, [
            Ic({n:'alert',size:11, color:col}),
            h('span', { style:{ flex:1 } }, tr('switch.multiHitLine', { list: sel.multiHit.join(', ') })),
            h('button', { className:'dsws-btn dsws-hov', 'data-press':'button', 'data-log':'panel.pending.bind', onClick:function(){ s.tab='list'; emit(s) }, style:{ fontSize:10, padding:'1px 6px', flex:'none', background:'#f59e0b', borderColor:'transparent', color:'#fff' } }, tr('switch.goSettingsBind')),
          ])
          return null
        })(),
        // #267：命名链路定败面板级常驻提醒 —— 组件自订阅共享 store（NamingFailBanner 叶子，G4 单职责）；
        //   值比对比两路化解（手改锁定 / 值一致收敛）后下一轮拉询自动撤下
        h(NamingFailBanner),
        // 标签行下沿 = 与对话/轨迹一致的横线；右侧：刷新按钮 + 在办表图标（#1285：版本号撤走，版本号进了图标悬停提示）— 门控时隐藏（容器不挂载语义：业务 tabs 不渲染，仅 Banner/Modal 可见）
        // 液态墨块要拿这一行当定位容器，折叠机读的仍是 tabsRef：同一个节点挂两个 ref，回调 ref 一次写两处。
        (_isPending || _isOther) ? null : h('div', { className: 'dsws-tabs dsws-ink-host', ref: function (el: any) { tabsRef.current = el; tabs.inkHostRef.current = el }, style: { padding: '0 12px 7px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2a2d35)', flex: 'none', display: 'flex', alignItems: 'center', gap: 4 } }, [tabs.inkEl].concat(tabs.items, [h(WorkRouteTrigger, { key: 'work-route-trigger', st: s })])),
        _isPending ? h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '12px', display:'flex', alignItems:'center', justifyContent:'center' } }, [
          h('div', { style:{ width:'92%', maxWidth:420, background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.35)', borderRadius:12, padding:'14px 16px', display:'flex', flexDirection:'column', gap:10 } }, [
            h('div', { style:{ display:'flex', alignItems:'center', gap:8 } }, [
              h('span', { className:'dsws-spinner', style:{ width:16, height:16, borderWidth:2, display:'inline-block' } }),
              h('div', { style:{ flex:1 } }, [
                h('div', { style:{ fontSize:13, fontWeight:700, color:'#f59e0b' } }, tr('switch.probeRunning')),
                h('div', { style:{ fontSize:11, color:'#f59e0b', marginTop:2 } }, tr('switch.probePendingHint')),
              ]),
            ]),
            h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 } }, [
              h('button', { className:'dsws-btn dsws-hov', 'data-press':'button', 'data-log':'panel.pending.pick', onClick:function(){ s.tab='list'; emit(s); _openGateModal() }, style:{ fontSize:11, padding:'4px 10px' } }, tr('switch.goSettingsPick')),
              h('button', { className:'dsws-btn primary dsws-hov', 'data-press':'button', 'data-log':'panel.pending.reprobe', onClick:function(){ loadSnapshot(s,true,true) }, style:{ background:'#f59e0b', borderColor:'transparent', color:'#fff', fontSize:11, padding:'4px 10px' } }, tr('switch.retryProbe')),
            ]),
          ])
        ]) : _isOther ? h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '12px', position:'relative', display:'flex', flexDirection:'column', alignItems:'stretch', gap:10 } }, [
          // 接线（#1335 界面反馈）：这整条提示卡本身就是入口（点它去选后端），按「整卡可点」接 row 形状。
          //   卡里那颗「去选择」只是行内的一枚字，不是另一颗按钮，点击仍由这张卡接住。
          h('div', { className:'dsws-hov', 'data-press':'row', 'data-log':'panel.norepo.row', onClick: _openGateModal, style:{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:'rgba(56,139,253,.10)', border:'1px solid rgba(56,139,253,.35)', borderRadius:10, cursor:'pointer', color:'#58a6ff', fontSize:12, fontWeight:600 } }, [
            Ic({ n: 'compass', size:14, color:'#58a6ff' }),
            h('span', { style:{ flex:1 } }, '该工作区还没有设置 — 点击选择后端'),
            h('span', { style:{ fontSize:11, color:'#58a6ff', border:'1px solid rgba(56,139,253,.4)', borderRadius:6, padding:'1px 6px', background:'rgba(56,139,253,.12)' } }, '去选择'),
          ]),
          h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'0 2px' } }, '选择后将回到主线流程（列表/状态栏正常可用），仅设置页可见引导已隐藏主线'),
          // 接线（#1335 界面反馈）：点遮罩空白处会关窗 —— 遮罩是用户真的会点的地方，接 other 形状。
          //   弹窗盒自己不是控件（它的点击只是不让遮罩那条判定生效），但日志要能把「点空白关窗」与
          //   「点弹窗里的字」分开，所以盒上单独挂一个 data-log；不挂 data-press，免得一按整块弹窗都变暗。
          _gateOpen ? h('div', { 'data-press':'other', 'data-log':'panel.gate.overlay', onClick:function(e: any){ if(e.target===e.currentTarget) _closeGateModal() }, style:{ position:'absolute', inset:0, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'12px 16px', paddingTop:'12px', zIndex:5 } }, [
            h('div', { 'data-log':'panel.gate.dialog', style:{ background:'var(--dsw-alias-bg-layer-2,#16181d)', border:'1px solid var(--dsw-alias-border-l1,#2a2d35)', borderRadius:12, padding:'16px', width:'92%', maxWidth:380, boxShadow:'0 8px 24px rgba(0,0,0,.5)' } }, [
              h('div', { style:{ fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6, marginBottom:6 } }, [Ic({n:'compass',size:14}), h('span', null, '请选择 Tracker 后端以继续')]),
              h('div', { style:{ fontSize:11, color:'#8b8b95', marginBottom:10, lineHeight:1.5 } }, '不同后端的初始化与前置检查不同，选择后将回到主线流程（列表/状态栏正常可用）'),
              // #1600：筹备中黄条摘掉——GitLab 已可用，不再提示。
              s.gateLoading ? h('div', { style:{ fontSize:11, color:'#8b8b95', padding:'6px 0' } }, '加载中…') : h('div', { style:{ display:'flex', flexDirection:'column', gap:6 } }, _gateModules.map(function(m: any){
                const isSel = s.gateSelected===m.id
                const col = (typeof backendColorOf==='function'? backendColorOf(m.id) : '')
                const isRec = _gateModules[0] && _gateModules[0].id===m.id
                // #1600：三后端全可选，不再置灰（名单已清空，这里不再问锁）。
                // 接线（#1335 界面反馈）：整行都是可点的（点行等于点那颗 radio），接 row 形状；
                //   日志名用后端标识 m.id（固定枚举，不是行上那行展示文字）拼出来，同屏两颗后端行不会撞名。
                const row = h('label', { key:m.id, className:'dsws-hov', 'data-press':'row', 'data-log':'panel.gate.pick.' + m.id, 'data-target-id':m.id, style:{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, border: isSel ? '1px solid '+col : '1px solid var(--dsw-alias-border-l1,#2a2d35)', background: isSel ? 'rgba(88,166,255,.08)' : 'transparent', cursor: 'pointer' } }, [
                  h('input', { type:'radio', name:'dsws-gate-pick', checked:isSel, onChange:function(){ s.gateSelected=m.id; emit(s) } }),
                  h('span', { style:{ width:8, height:8, borderRadius:'50%', background:col, flex:'none' } }),
                  h('span', { style:{ fontSize:12, fontWeight:600 } }, m.label),
                  h('span', { style:{ fontSize:10, color:'#8b8b95' } }, m.id),
                  h('span', { style:{ flex:1 } }),
                  isRec ? h('span', { style:{ fontSize:10, color:'#4ade80', border:'1px solid #4ade80', borderRadius:4, padding:'0 4px', lineHeight:1.6 } }, '推荐') : null,
                ])
                return row
              })),
              s.gateError ? h('div', { style:{ fontSize:11, color:'#f87171', marginTop:8 } }, s.gateError) : null,
              h('div', { style:{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 } }, [
                h('button', { className:'dsws-btn ghost dsws-hov', 'data-press':'button', 'data-log':'panel.gate.cancel', onClick: _closeGateModal, style:{ fontSize:12 } }, '取消'),
                h('button', { className:'dsws-btn primary dsws-hov', 'data-press':'button', 'data-log':'panel.gate.confirm', onClick: _confirmGate, style:{ background:'#58a6ff', borderColor:'#58a6ff', color:'#0b1220', fontWeight:700, fontSize:12 } }, '确认并继续'),
              ]),
            ])
          ]) : null,
        ]) : h('div', { className: 'dsws-body', style: { flex: 1, overflowY: 'auto', padding: '10px 12px' } }, [
          // #1285：跨会话在办表已从列表页正文撤下（那张表占掉一大块，把票列表往下推）——
          //   改由头部那一行右端的图标点开一个浮层显示（views/shared/workRouteTable.ts 的 WorkRouteTrigger）。
          s.tab === 'list' ? (active ? h(MapDetailV2Page, { st: s, g: active }) : hasIssueDetail ? h(IssueDetail, { st: s }) : h(ListTab, { st: s, narrow: narrow })) : null, s.tab === 'versionControl' ? h(VersionControlTab, { st: s, narrow: narrow }) : null, // #818 版本管理页签的内容分发：与上一条同排，Dock.js 正贴着 350 行上限（单独起一行会变 351，撞文件粒度门禁）
          s.tab === 'pr' ? (showPrTab ? (hasIssueDetail ? h(IssueDetail, { st: s }) : h(PrTab, { st: s, narrow: narrow })) : h(ListTab, { st: s, narrow: narrow })) : null,
          s.tab === 'skills' ? h(SkillsTab, { st: s }) : null,
          s.tab === 'checks' ? h(ChecksTab, { st: s }) : null,
        ]),
        // #189 · 切换三选一 Modal（全局 per-store）
        (s.switchConfirm && s.switchConfirm.open && typeof SwitchConfirmModal === 'function' ? h(SwitchConfirmModal, { sessionId: sid }) : null),
        // v1.5 T10 R7：刷新遮罩已废除（手动刷新走静默路径，无「刷新中」）
        s.notice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
          Ic({ n: noticeIcon(s.notice.kind), size: 13, color: NOTICE_COLOR[s.notice.kind] || '#4ade80' }),
          h('span', null, s.notice.text),
        ]) : null,
      ])
    }
