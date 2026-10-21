/**
 * views/MapDetail.ts — 地图详情（漏斗分层/迷雾/仪式环，5.4）
 * 契约：模块真源（ESM 导出）；scripts/build.mts 构建时剥行首 export 拼回
 * src/client/index.ts 的 `// ==== leaf:... (spliced by build) ====` 标记处（源码树里只有这一份真源）。
 * 本文件从 .js 改名而来（#1237 修复制按钮时动到它，按仓库纪律先修后转，转时只加类型标注与环境声明，行为一字不动）。
 *
 * #1286：这页现在同时服务两类容器 —— 探索地图与规格（实施地图）。骨架共用，差的是身份色、角标、
 *   计数句、三态按钮（文字/底色/注入的提示词）与正文内容段。身份判定与三态取自
 *   kernel/container-view.ts（列表页同一份），别处不再各判一次。
 *   底部三态动作组拆到 DetailActionBar.ts、规格正文段拆到 MapDetailSpecBody.ts
 *   （与 #807 拆 MapDetailTop、#691 拆 MapDetailHead 同一理由：本文件贴着 350 有效行上限）。
 */
declare function idOf(...args: any[]): any;
declare function effortOf(...args: any[]): any;
declare function effortNamesOf(...args: any[]): any;
declare function findMapByIdentity(...args: any[]): any;
declare function pushNav(...args: any[]): any;
declare function popNav(...args: any[]): any;
declare function buildColorOf(...args: any[]): any;
declare function mkRowAction(...args: any[]): any;
declare function openInNewSession(...args: any[]): any;
declare function copyText(...args: any[]): any;
declare function issueUrlFor(...args: any[]): any;
declare function inject(...args: any[]): any;
declare function mdToHtml(...args: any[]): any;
declare function mdImgOverlay(...args: any[]): any;
declare function inspectPrompt(...args: any[]): any;
declare function promptTextFor(...args: any[]): any;
declare function startText(...args: any[]): any;
declare function completePrompt(...args: any[]): any;
declare function fetchMapTickets(...args: any[]): any;
declare function blockerNames(...args: any[]): any;
declare function actionColorOf(...args: any[]): any;
declare function isLightHex(...args: any[]): any;
declare function tProgressBar(...args: any[]): any;
declare function tStatusBadge(...args: any[]): any;
declare function TypeChip(...args: any[]): any;
declare function MapDetailTop(...args: any[]): any;
declare function MapDetailHead(...args: any[]): any;
// #1286：底部三态动作组与规格正文段（从本文件拆出，理由见文件头）
declare function DetailActionBar(...args: any[]): any;
declare function MapDetailSpecBody(...args: any[]): any;
// #1286：容器身份与三态的真源在 kernel/container-view.ts，构建时拼进同一闭包。
//   这里只声明形状；真源不在时（门禁单独求值本文件）代码退回头的老口径。
declare function containerKindOf(...args: any[]): any;
declare function containerStateOf(...args: any[]): any;
declare function containerTriState(...args: any[]): any;
declare const CONTAINER_ACCENT: any;
declare function Ic(props?: any): any;
declare const Tip: any;
// 复制成功提示的停留时间（毫秒）。数值写在 config/ttl.yaml 的 copyFlashMs，
// 构建时由生成器变成常量拼进界面闭包；这里的 declare 只是让 TypeScript 知道这个名字存在。
declare const COPY_FLASH_MS: number;
    // ---- 5.4 地图详情（v1.4 · T2 #443：漏斗分层 + 战争迷雾 + 72px 仪式环 + 四态动作，D1-D8 规格）----
    //   层 = blockedBy DAG 最长路径深度（T1 #442 已算 stats.levels + 每票 t.level）
export     const MapDetail = ({ st, g, drill }: any) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      const m = g.m
      // effort 维度：地图的身份是 (effortId, key)，不是裸编号；本 effort 内的子票编号才唯一。
      const mId = idOf(m)
      const multiEffort = effortNamesOf(st).length > 1
      // #691（阶段 3）：子票按需取 —— 打开一张地图时现去后端把它**全部**子票拉回来（含已关闭）。
      //   为什么要有这一步：已关闭地图的子票不进快照首屏（宿主侧 tracker/snapshot.js），而开放地图
      //   在首屏那份行数据里也可能被列表的 500 条上限截断。取回来的那份按需数据放在 st.mapTickets 里，
      //   按「工作单元 + 地图编号」分桶（与 api-io.js 的 fetchMapTickets 同键）。
      //   后端明确回 unsupported 时界面一个字都不加、照旧画快照那份（规格第 5.4 节：按真实返回退化）。
      const mt = (st.mapTickets && st.mapTickets[mId]) || null
      React.useEffect(function () {
        if (typeof fetchMapTickets !== 'function') return
        fetchMapTickets(st, (m.key != null ? m.key : m.number), { effortId: effortOf(m) })
      }, [mId, st.cwd])
      // T4 整改 #554：只有停靠栏允许点行下钻（T2 定案：只支持停靠栏下钻）。
      // 悬浮面板里同一个组件只做去雾与展示，不写导航栈（悬浮面板调用方传 drill:false，
      // 否则点行会污染停靠栏共用的栈）。调用方不传时默认允许（停靠栏），旧状态不崩。
      const canDrill = drill !== false
      const colorOf = buildColorOf(st)
      // #1286：规格（实施地图）是第七种容器类型，子票的类型角标要认它
      const wayfinderTypeOf = function(t: any){ const ls=(t.labels||[]); for(let i=0;i<ls.length;i++){ const n=typeof ls[i]==='string'?ls[i]:ls[i].name; if(n==='wayfinder:map') return 'map'; if(n==='wayfinder:research') return 'research'; if(n==='wayfinder:prototype') return 'prototype'; if(n==='wayfinder:grilling') return 'grilling'; if(n==='wayfinder:task') return 'task'; } const tt=t.type||''; if(['research','prototype','grilling','task','map','spec'].indexOf(tt)>=0) return tt; return 'issue'; };
      const tickets = (mt && mt.mode === 'real' && Array.isArray(mt.items)) ? mt.items : (m.tickets || [])
      // 统计（层数、open/closed 张数）优先用在途取回的那一份 —— 它与 tickets 同源，不能让层号与行数据打架。
      const effStats = (mt && mt.mode === 'real' && mt.stats) ? mt.stats : m.stats
      // #1286：这页画的是「容器」。探索地图 = type 是 map 或带 wayfinder:map 标签；规格 = type 是 spec。
      //   身份判定与三态一律取内核 container-view.ts 那一份（列表页同源），别处不再各判一次。
      //   真源不在时（门禁单独求值本文件）退回今天的老口径：只可能是地图，三态与今天一字不差。
      const cKind = (typeof containerKindOf === 'function' ? containerKindOf(m) : null) || 'map'
      const isSpec = cKind === 'spec'
      // 三态判据用容器自带的 stats：没有子票 empty，还有未关子票 open，全关 done。
      //   宿主那边只有 GitHub 通路会补 stats，别的通路 stats 可能整个不存在 —— 那时按空态走。
      const cState = (typeof containerStateOf === 'function')
        ? containerStateOf({ stats: effStats })
        : (effStats && effStats.total === 0 ? 'empty' : (effStats && effStats.total > 0 && effStats.closed === effStats.total ? 'done' : 'open'))
      // 三态配置（底色/文字/图标）：真源同在 container-view.ts。真源不在时退回同口径的老表。
      const tri = (typeof containerTriState === 'function')
        ? containerTriState(cKind, cState)
        : (cKind === 'spec'
          ? (cState === 'empty' ? { labelKey: 'act.split', color: '#f59e0b', icon: 'branch', titleKey: 'spec.splitTitle' }
            : (cState === 'done' ? { labelKey: 'act.done', color: '#3fb950', icon: 'check', titleKey: 'spec.doneTitle' }
              : { labelKey: 'act.execute', color: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.spec : '', icon: 'play', titleKey: 'spec.executeTitle' }))
          : (cState === 'empty' ? { labelKey: 'act.inspect', color: '#f59e0b', icon: 'search', titleKey: 'map.inspectTitle' }
            : (cState === 'done' ? { labelKey: 'act.done', color: '#3fb950', icon: 'check', titleKey: 'map.doneTitle' }
              : { labelKey: 'act.execute', color: (typeof CONTAINER_ACCENT === 'object' && CONTAINER_ACCENT) ? CONTAINER_ACCENT.map : '', icon: 'play', titleKey: 'map.executeTitle' })))
      // 区块字段防御性兜底：快照组装层已恒填 EMPTY（[] / ''），旧磁盘缓存/异常数据仍可能缺失，
      // 缺失时按空区块渲染（曾因 m.decisions 等 undefined 直接读 .length 抛 Cannot read properties of undefined）
      const decisions = Array.isArray(m.decisions) ? m.decisions : []
      const fogList = Array.isArray(m.fog) ? m.fog : []
      const outOfScope = Array.isArray(m.outOfScope) ? m.outOfScope : []
      const levels = (effStats && effStats.levels) || []
      const totalLayers = levels.length
      // 当前层 = 第一个含 open 票的层（无 open 全 done → 最后一层）
      const curLevel = (function () {
        for (let i = 0; i < levels.length; i++) { if (levels[i].open > 0) return i }
        return Math.max(0, levels.length - 1)
      })()
      const passedLayers = levels.filter(function (l: any, i: any) { return i < curLevel }).length
      const byLevel: any = {}
      tickets.forEach(function (t: any) { const lv = (typeof t.level === 'number') ? t.level : 0; (byLevel[lv] = byLevel[lv] || []).push(t) })
      // 迷雾：fog 票（Not yet specified）+ 被阻塞且其阻塞者 open 的票（半雾）；D7 视觉遮蔽
      const isFog = function (t: any) {
        if (t.state !== 'OPEN') return false
        const blk = (t.blockedBy || []).map(function (b: any) { return tickets.find(function (x: any) { return x.number === b }) }).filter(Boolean)
        return blk.some(function (b: any) { return b.state === 'OPEN' })
      }
      const fogTitles = fogList.map(function (f: any) { return String(f).trim() })
      const isFogTitle = function (t: any) { return fogTitles.some(function (f: any) { return f && t.title && t.title.indexOf(f) >= 0 }) }
      // v1.4：同层内排序 —— 可执行（open 且非迷雾）最左 → open 被阻塞 → 已关闭靠右（一眼看到当前能做什么）
      Object.keys(byLevel).forEach(function (lv: any) {
        byLevel[lv].sort(function (a: any, b: any) {
          const rank = function (t: any) {
            if (t.state === 'OPEN') return isFog(t) || isFogTitle(t) ? 1 : 0
            return 2
          }
          return rank(a) - rank(b) || a.number - b.number
        })
      })
      // 迷雾点击去雾状态（st 上按 map 存）
      st.reveal = st.reveal || {}
      const nodeCls = function (t: any) {
        let cls = 'dsws-node'
        if (t.state === 'CLOSED') cls += ' done'
        else if (t.level === curLevel) cls += ' now'
        const fog = isFog(t) || isFogTitle(t)
        if (fog) { cls += ' fog'; if (st.reveal[mId] && st.reveal[mId][idOf(t)]) cls += ' revealed' }
        // R5：子票级变化高亮（issueFlash）
        if (st.issueFlash && st.issueFlash[idOf(t)]) cls += st.issueFlash[idOf(t)] === 'added' ? ' dsws-row-added' : ' dsws-row-changed'
        return cls
      }
      const toggleReveal = function (t: any) {
        st.reveal[mId] = st.reveal[mId] || {}
        st.reveal[mId][idOf(t)] = !(st.reveal[mId][idOf(t)])
        emit(st)
      }
      const gateState = function (layerIndex: any) {
        // 闸门：该层全 closed → open(绿✓)；层含 open 且在其之前层全 closed → open；否则 lock
        const lv = levels[layerIndex]
        if (!lv) return 'open'
        if (lv.closed === lv.total && lv.total > 0) return 'open'
        const prevAllClosed = levels.slice(0, layerIndex).every(function (p: any) { return p.closed === p.total })
        return prevAllClosed ? 'open' : 'lock'
      }
      // T3 #553：行点击分流与去雾共存 —— 被雾盖住的行第一次点击只做去雾（展开看清标题），
      // 已经去雾的行第二次点击才进详情（去雾后点行即下钻，不再盖回去，见本票报告）；没有雾的
      // 行按标签分流：有地图标签的进下一级地图详情，其余进普通工单详情，已关闭的行同样按标签
      // 分流（与主列表一致，真正的只读统一由 T4/T5 两边一起做）。分流直接调 T2 的压栈函数，
      // 种类由本文件判好再传（压栈函数只拦非法种类与编号，不纠正种类，传错种类会原样压栈）。
      // 顶部的返回按钮直接调弹栈（只弹一层，上一级是工单的混合栈也回到该工单），见 goBack。
      // 行点进详情只在停靠栏生效，悬浮面板内禁压栈（见 canDrill，只去雾与展示）。
      // 雾态样式与层排序见 nodeCls 与 byLevel，均不动。
      // 标签口径实话：本文件认字符串与对象两种标签写法，外加类型字段为 map 的也算；主列表
      // 只认对象写法的标签加类型字段，比本票窄。两边统一留给后续票，本票不改主列表。
      const hasMapTag = function (t: any) {
        const ls = t.labels || []
        for (let i = 0; i < ls.length; i++) { const n = (typeof ls[i] === 'string') ? ls[i] : ls[i].name; if (n === 'wayfinder:map') return true }
        return t.type === 'map'
      }
      const isRevealed = function (t: any) {
        try { return !!(st.reveal && st.reveal[mId] && st.reveal[mId][idOf(t)]) } catch (e) { return false }
      }
      const enterDetail = function (t: any) {
        // #1286 收口：规格与探索地图都进容器详情。原来只认 wayfinder:map 标签，挂在探索地图下的
        //   规格子票会被当成普通票进票详情，而票详情按标签会把规格当实施票（注入 /implement），
        //   与规格自己的按钮口径（拆票 / 执行→/implement-spec / 完成）相反。
        const asContainer = (function (): any {
          try {
            if (typeof containerKindOf !== 'function' || typeof findMapByIdentity !== 'function') return null
            const c: any = findMapByIdentity(st.snapshot && st.snapshot.maps, t.number, effortOf(t))
            return (c && containerKindOf(c)) ? c : null
          } catch (e) { return null }
        })()
        if (asContainer) pushNav(st, 'map', t.number, effortOf(t))
        else if (hasMapTag(t) && findMapByIdentity(st.snapshot && st.snapshot.maps, t.number, effortOf(t))) pushNav(st, 'map', t.number, effortOf(t))
        else pushNav(st, 'issue', t.number, effortOf(t))
      }
      const onNodeClick = function (t: any) {
        if ((isFog(t) || isFogTitle(t)) && !isRevealed(t)) { toggleReveal(t); return }
        // 悬浮面板内到此为止（只去雾与展示）；停靠栏内才进详情压栈。
        if (canDrill) enterDetail(t)
      }
      const node = function (t: any) {
        const blocked = isFog(t)
        // #1237：复制是瞬间动作，不套转圈；按剪贴板真实结果换对勾叉号加闪光，
        //   成功 1.3 秒自退，失败留到下一次操作（下一次点复制先清掉）。逻辑与列表页 ListTabRow.js 的复制按钮同一份。
        const copyUrl = function (x: any) {
          const key = idOf(x)
          st.copyFlash = null
          emit(st)
          const done = function (ok: any) {
            st.copyFlash = { key: key, kind: ok === true ? 'ok' : 'fail', at: Date.now() }
            emit(st)
            // 复制成功提示的停留时间：对勾闪光亮这么久就自己退掉（失败不设时限，留到下一次操作才换）。
            // 数值写在 config/ttl.yaml 的 copyFlashMs，构建时由生成器变成常量拼进界面闭包。
            if (ok === true) { try { setTimeout(function () { if (st.copyFlash && st.copyFlash.key === key && st.copyFlash.kind === 'ok') { st.copyFlash = null; try { emit(st) } catch (eR) {} } }, COPY_FLASH_MS) } catch (eT) {} }
          }
          try {
            const r = copyText(st, issueUrlFor(st, x.number, effortOf(x)), tr('toast.copiedLink', { n: x.number }))
            if (r && typeof r.then === 'function') r.then(done, function () { done(false) })
            else done(!!r)
          } catch (eC) { done(false) }
        }
        const copyRes = (st.copyFlash && st.copyFlash.key === idOf(t)) ? st.copyFlash.kind : ''
        // T15：acts 恒渲染容器（CLOSED/fog 空占位）→ 卡片高度恒定
        // 补齐「新会话」按钮（与列表页 issueRow 一致）：primary 色随 actionColorOf，浅色自动深字，marginLeft 4 与 mkRowAction 成组
        const acts = h('div', { className: 'acts' }, (t.state === 'OPEN' && !blocked) ? [
          mkRowAction(st, t, false, colorOf),
          h(Tip, { content: tr('tip.newSession', { n: t.number }) }, h('button', { className: 'dsws-btn primary', 'data-press': 'button', 'data-log': 'map.card.newsession.' + (t.key != null ? t.key : t.number), onClick: function (e: any) { e.stopPropagation(); openInNewSession(st, t) }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', fontSize: 11, flex: 'none', marginLeft: 4, background: actionColorOf(t, colorOf), borderColor: 'transparent', color: isLightHex(actionColorOf(t, colorOf)) ? '#140a1e' : '#ffffff' } }, [Ic({ n: 'external-link', size: 10 }), h('span', null, tr('list.newSessionLabel'))])),
          // #1237：补上复制链接按钮（与列表页 ListTabRow.js:130 同一样式与同反馈；图标取 11，与本行外链按钮对齐）
          h(Tip, { content: tr('tip.copyLink') }, h('button', { className: 'dsws-btn ghost' + (copyRes === 'ok' ? ' dsws-fb-okflash dsws-fb-success-ring dsws-fb-pop' : '') + (copyRes === 'fail' ? ' dsws-fb-errflash dsws-fb-shake' : ''), 'data-press': 'icon', 'data-log': 'map.card.copy.' + (t.key != null ? t.key : t.number), onClick: function (e: any) { e.stopPropagation(); copyUrl(t) }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px', flex: 'none' } }, copyRes === 'ok' ? Ic({ n: 'check', size: 11 }) : (copyRes === 'fail' ? Ic({ n: 'x', size: 11 }) : Ic({ n: 'clipboard', size: 11 })))),
          (function(){ const _u=issueUrlFor(st, t.number, effortOf(t)); const _isHttp=/^https?:\/\//i.test(String(_u||'')); const _open=function(e: any){ e.stopPropagation(); const u=issueUrlFor(st, t.number, effortOf(t)); if(!u) return; if(/^https?:\/\//i.test(String(u))) { try{ window.open(u,'_blank','noreferrer') }catch{} } else { try{ if(typeof host!=='undefined'&&host.call) host.call('wf.openPath',{path:u}) }catch{} } }; return _isHttp ? h(Tip, {content: tr('list.openInTrackerTitle', { n: t.number })}, h('a', { className: 'dsws-btn ghost', href: _u, target: '_blank', rel: 'noreferrer', 'data-press': 'icon', 'data-log': 'map.card.link.' + (t.key != null ? t.key : t.number), onClick: function (e: any) { e.stopPropagation() }, style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' }, 'aria-label': tr('list.openInTrackerTitle', { n: t.number }) }, Ic({ n: 'link', size: 11 }))) : h(Tip, {content: tr('list.openInTrackerTitle', { n: t.number })}, h('button', { className: 'dsws-btn ghost', onClick: _open, 'data-press': 'icon', 'data-log': 'map.card.link.' + (t.key != null ? t.key : t.number), style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center', padding: '2px 4px' }, 'aria-label': tr('list.openInTrackerTitle', { n: t.number }) }, Ic({ n: 'link', size: 11 }))); })(),
        ] : [])
        // v1.4 修复：图标名必须用 Ic 支持的（search/hammer/chat/gear），原 mag/bolt/wrench 不存在 → 节点图标空白
        // #626：末位兜底改成中性灰点 —— 原来兜到 gear，与任务票的齿轮撞脸，普通票看不出自己是普通票
        const _wt = wayfinderTypeOf(t); const ic = _wt === 'research' ? 'search' : _wt === 'prototype' ? 'hammer' : _wt === 'grilling' ? 'chat' : _wt === 'map' ? 'map' : _wt === 'task' ? 'gear' : 'dot'
        return h('div', {
          key: idOf(t),
          className: nodeCls(t), 'data-press': 'row', 'data-log': 'map.card.' + (t.key != null ? t.key : t.number),
          style: { cursor: 'pointer' },
          onClick: function (e: any) { e.stopPropagation(); onNodeClick(t) },
        }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'icbox' }, Ic({ n: ic, size: 12 })),
            h('div', { style: { flex: 1, minWidth: 0 } }, [
              h('div', { className: 'meta' }, [
                h('span', { className: 'no' }, '#' + (t.key != null ? t.key : t.number)),
                TypeChip({ type: wayfinderTypeOf(t) }),
              ]),
              h(Tip, { content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [h('div', { style: { fontSize: 10, color: '#8b8b95', lineHeight: '14px' } }, tr('tip.header.fullTitle')), h('div', { style: { fontSize: 11, color: '#e6edf3', lineHeight: '16px', wordBreak: 'break-word', whiteSpace: 'normal' } }, t.title)]) }, h('div', { className: 'tt' }, t.title)),
              h('div', { className: 'sub', style: { fontSize: 8, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 1, minHeight: 12, display: 'flex', gap: 5, flexWrap: 'wrap' } }, [
                t.state === 'CLOSED' ? h('span', { style: { color: '#3fb950', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'check', size: 8 }), h('span', null, tr('map.subClosed'))]) : null,
                t.claimedBy ? h('span', { style: { color: '#58a6ff', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'person', size: 8 }), h('span', null, t.claimedBy)]) : null,
                // #1286：被阻塞统一红 #f87171（与列表行同一个红）。这个红在本仓原本是「出错/失败」色，
                //   这里重载成「被阻塞」——两处含义不冲突，但读代码时别当成同一个语义。
                blocked ? h('span', { style: { color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: 2 } }, [Ic({ n: 'lock', size: 8 }), h('span', null, tr('map.subBlocked', { who: blockerNames(t, m) }))]) : null,
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
      const layerBlock = function (layerIndex: any) {
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
            h('div', { className: 'dsws-layer' }, layerTickets.map(function (t: any) { return node(t) })),
          ]),
          h('div', { className: 'dsws-gate' }, [
            h('span', { className: 'g ' + gate }, Ic({ n: gate === 'open' ? 'check' : 'lock', size: 12 })),
          ]),
        ]
      }
      // 完成态：全 closed → 进度条全绿 + 环满圈
      const allClosed = effStats && effStats.total > 0 && effStats.closed === effStats.total
      const ringPct = allClosed ? 1 : (totalLayers ? Math.min(1, (passedLayers + 1) / totalLayers) : 0)
      const C = 2 * Math.PI * 31
      const ringOff = C * (1 - ringPct)
      // T4 #554 面包屑：只看直接上一级与当前地图。栈里有上一级时显示“上一级编号 / 当前地图编号”，
      // 上一级是工单（混合栈）就显示该工单编号；栈深超过两级时更早的层折成一行省略号；
      // 只有一级（从列表进来）时显示“列表 / 当前地图编号”，返回弹空栈后回列表与原来一致；
      // 先后经过同一编号（例如 A→B→A）不合并，返回时逐级经过，面包屑照常显示直接上一级。
      const navCrumb = (function () {
        let arr = null
        try { arr = (st && Array.isArray(st.navStack)) ? st.navStack : null } catch (e) { arr = null }
        if (arr && arr.length >= 2) {
          const parent = arr[arr.length - 2]
          const head = arr.length > 2 ? '… / ' : ''
          return head + '#' + parent.n + ' / #' + m.number
        }
        return tr('panel.tabList') + ' / #' + m.number
      })()
      // T4 #554：顶部返回只弹一层（上一级是地图就回到上一级地图，是工单就回到该工单，
      // 栈空才回列表）。直接调弹栈，不经过按种类守卫的旧入口，混合栈也只退一级。
      const goBack = function () { popNav(st) }
      return h('div', null, [
        // 顶部操作行拆到 MapDetailTop.js（#807：本文件贴着 350 行上限；不换行/逐字折叠/新会话实心/补图标都在那一份）。
        h(MapDetailTop, { st: st, m: m, navCrumb: navCrumb, effStats: effStats, goBack: goBack, kind: cKind, tri: tri }),
        // #691：编号 + 标题 + 「本图 N 张子票（已关闭 M 张）」那一行，整块拆到 MapDetailHead.js
        //   （本文件贴着 350 行上限；头部那一块连同它的取数状态一起搬走，形态一字未改）。
        h(MapDetailHead, { st: st, m: m, mt: mt, multiEffort: multiEffort, kind: cKind }),
        m.error ? h('div', { style: { color: '#f87171', fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 } }, [Ic({ n: 'alert', size: 11 }), h('span', null, String((m.error && m.error.error) || tr('list.loadFail')).slice(0, 160))]) : null,
        // D2：分段静态进度条 = 地图层缩略图（无动画，唯一真相源）
        (levels.length > 0) ? h('div', { className: 'dsws-layers' }, [
          h('div', { className: 'row1' }, [
            h('span', { className: 'cap' }, tr('map.progressCap')),
            h('div', { className: 'segs' }, levels.map(function (l: any, i: any) {
              const segCls = i < curLevel ? 'seg past' : (i === curLevel ? 'seg curr' : 'seg future')
              return h(Tip, { content: tr('map.layer', { n: i + 1 }) }, h('div', { key: i, className: segCls }))
            })),
          ]),
          h('div', { className: 'row2' }, [
            h('span', { className: 'cur' }, [Ic({ n: 'play', size: 9 }), h('span', null, tr('map.curLayer', { n: curLevel + 1 }))]),
            h('span', { className: 'pos' }, tr('map.layersPassed', { n: passedLayers, t: totalLayers })),
          ]),
        ]) : null,
        // #1286：正文内容段。探索地图是 Destination + Notes 两段；规格是它自己的七段
        //   （问题陈述 / 解决方案 / 用户故事 / 实现决策 / 测试决策 / 不在范围内 / 补充说明），
        //   渲染在 MapDetailSpecBody.ts 里。骨架其余部分两类容器完全一样。
        (isSpec && typeof MapDetailSpecBody === 'function') ? h(MapDetailSpecBody, { st: st, m: m }) : null,
        // T17 修订：Destination 走 markdown 渲染（**加粗** 等不再裸露；去 ellip 允许换行）
        isSpec ? null : h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 4, fontSize: 12, color: '#4ade80', margin: '4px 0 2px' } }, [Ic({ n: 'target', size: 12, style: { marginTop: 2, flex: 'none' } }), h('div', { style: { flex: 1, minWidth: 0 } }, m.destination ? mdToHtml(m.destination, { st: st }) : tr('list.noDest'))]),
        // T17 修订：正文详情（Notes）默认折叠 —— <details> 收起，点击展开
        isSpec ? null : h('details', { style: { margin: '2px 0 4px' } }, [
          h('summary', { className: 'dsws-hov', 'data-press': 'row', 'data-log': 'map.notes.toggle', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } }, [
            Ic({ n: 'note', size: 11 }),
            h('span', null, tr('map.notesCap')),
          ]),
          m.notes ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--dsw-alias-border-l1,#2a2d35)' } }, mdToHtml(m.notes, { st: st })) : h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', marginTop: 4, paddingLeft: 8 } }, tr('list.noNotes')),
        ]),
        // 漏斗分层主体
        h('div', { style: { marginTop: 2 } }, [
          h('div', { className: 'dsws-start' }, [
            h('span', { className: 'cap' }, tr('map.startCap')),
          ]),
          levels.map(function (l: any, i: any) { return layerBlock(i) }),
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
            // #1286：底部三态动作组拆到 DetailActionBar.ts（与 #807 拆 MapDetailTop 同一理由：
            //   本文件贴着 350 有效行上限）。搬过去的只有代码，行为一字未改；
            //   按钮的底色/文字/注入的提示词与顶栏同源（都取 container-view.ts 那一份）。
            (typeof DetailActionBar === 'function')
              ? h(DetailActionBar, { st: st, m: m, kind: cKind, cState: cState, effStats: effStats, tri: tri })
              : null,
          ]),
        ]),
        // 折叠块：Decisions / Fog / Out of scope（保留信息展示）
        isSpec ? null : h('details', { style: { marginTop: 10, marginBottom: 4 } }, [
          h('summary', { className: 'dsws-hov', 'data-press': 'row', 'data-log': 'map.decisions.toggle', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.decisions', { n: decisions.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, decisions.map(function (d: any, i: any) {
            return h('div', { key: i, style: { margin: '2px 0' } }, [
              h('span', { style: { color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, '· '),
              // 本次界面反馈需求：决定条目里的外链能点，给它按压态、悬停反馈与自己的点击日志；
              //   定位串只带序号，标题不进定位串（标题是自由文本，门禁按字符集逐条查）。
              (d.url ? h('a', { href: d.url, target: '_blank', rel: 'noreferrer', className: 'dsws-hov', 'data-press': 'link', 'data-log': 'map.decision.link.' + i, style: { textDecoration: 'underline' } }, d.title) : h('span', null, d.title)),
              d.gist ? h('span', { style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, ' — ' + d.gist) : null,
            ])
          })),
        ]),
        isSpec ? null : h('details', { style: { marginBottom: 4 } }, [
          h('summary', { className: 'dsws-hov', 'data-press': 'row', 'data-log': 'map.fog.toggle', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.fog', { n: fogList.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, fogList.map(function (f: any, i: any) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + f, { st: st }))
          })),
        ]),
        isSpec ? null : h('details', { style: { marginBottom: 4 } }, [
          h('summary', { className: 'dsws-hov', 'data-press': 'row', 'data-log': 'map.outofscope.toggle', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#a1a1aa)', cursor: 'pointer' } }, tr('map.outOfScope', { n: outOfScope.length })),
          h('div', { style: { fontSize: 12, paddingLeft: 8 } }, outOfScope.map(function (o: any, i: any) {
            return h('div', { key: i, style: { margin: '2px 0' } }, mdToHtml('· ' + o, { st: st }))
          })),
        ]),
        // 图片放大浮层（与议题详情共用同一渲染函数与同一共享状态）
        (typeof mdImgOverlay === 'function' ? mdImgOverlay(st) : null),
      ])
    }
