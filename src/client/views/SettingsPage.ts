/**
 * views/SettingsPage.ts — 配置页（TPL 表 + 设置，5.9）真源 ESM，build 拼回 src/client/index.ts leaf。
 * （原来是 .js：调试分组搬进 views/diagnosticLog/ 之后按「动到哪里转到哪里」转成 TypeScript。
 * 本页现在只剩标题（右侧更新入口与 base 包渲染的页头静默簇）、总览、调试那一组一行挂载，以及最底部由 base
 * 包统一渲染的作者插件卡。）
 *
 * 跨叶子的值引用按仓里规矩写模块级 declare（实现只在闭包里有一份，类型检查各看各的）：
 * 全局已声明的（React、DswsCtx、tr）直接用；下面这几行是本文件自己声明的，只写本页实际用的形状。
 */
declare function useStore(sessionId?: unknown): { notice?: { kind: string; text: string } | null };
declare function useWsOverview(cx: unknown, sharedSt: unknown): { wsOverview: unknown; loadRef: unknown };
declare function renderWsOverview(
  h: unknown,
  sharedSt: unknown,
  wsOverview: unknown,
  loadRef: unknown,
  foldVer: number,
  setFoldVer: (v: number) => void,
): unknown;
declare const UpdateEntryHost: unknown;
declare const Icon: (props: { scheme: string; size: number }) => unknown;
declare const Ic: (props: { n: string; size: number; color?: string }) => unknown;
declare const NOTICE_COLOR: Record<string, string>;
declare function noticeIcon(kind: unknown): string;
declare const DSW_REPO_URL: string;
declare const DSW_VERSION: unknown;
declare const DiagnosticLogSection: (props: { sessionId?: unknown }) => unknown;
// base 包接入：客户端内联产物（scripts/generated/baseClient.derived.js，由 derive-base 脚本从已安装包生成）
// 只 surfacing 这两个名字，实现每份在客户端闭包里各有一份；这里按本页用到的形状声明。
declare const __baseCreateUI: (react: unknown, options: { lang?: string; selfId?: string; repoUrl?: string; issuesUrl?: string }) => any;
declare const __baseEnsureStyles: (doc: unknown) => void;

// base 包接入：作者插件卡的数据与文案都由包内清单提供，本页不再写死插件行与推荐文案。
// 工厂按 (React, 语言) 缓存一份：每次渲染都新建会丢弹窗状态；切语言才重建（uiLang 只有 zh/en 两档）。
// 旧实现（MORE_PLUGINS 四条写死行 + more.title/more.desc.* 文案）已删，避免出现第二套联系信息真源。
let __deckBaseUIReact: any = null
let __deckBaseUILang: string = ''
let __deckBaseUICache: any = null
function deckBaseUI(): any {
  // 未拼接 base 产物时（例如门禁直接 import 这个叶子、或用源码树做冒烟渲染）返回 null，
  // 组件退化成不渲染而不是抛 ReferenceError；正式产物里 build 一定会把 kernel:baseClient 拼进来。
  if (typeof __baseCreateUI !== 'function') return null
  const lang: string = uiLang() === 'en' ? 'en' : 'zh'
  if (!__deckBaseUICache || __deckBaseUIReact !== React || __deckBaseUILang !== lang) {
    __deckBaseUIReact = React
    __deckBaseUILang = lang
    // base 0.1.3 页头静默簇（联系 / Star / Issue）用的仓库与工单地址由工厂带下去：Star 跳仓库首页，
    // Issue 跳工单列表页（0.1.3 的 ActionCluster 缺省按 <repo>/issues 拼，这里显式给出同一落点），以后换仓只改这两行。
    __deckBaseUICache = __baseCreateUI(React, {
      lang: lang,
      selfId: 'deck',
      repoUrl: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck',
      issuesUrl: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues',
    })
  }
  return __deckBaseUICache
}
// 基础样式只注入一次（base 内部按 #dsh-base-ui-style 去重，重复调用幂等）；无 document 的测试环境跳过。
function deckEnsureBaseStylesOnce(): void {
  if (typeof document !== 'undefined' && typeof __baseEnsureStyles === 'function') __baseEnsureStyles(document)
}
function DeckAuthorPlugins(props: any): unknown {
  const ui: any = deckBaseUI()
  if (!ui) return null
  deckEnsureBaseStylesOnce()
  return React.createElement(ui.AuthorPlugins, props || {})
}
// base 0.1.3 页头静默簇（ActionCluster）：联系（点开包内统一联系面板）+ Star（仓库外链）+ Issue（工单列表）；
// 无外框、彩色图标、悬停柔光、键盘聚焦与尺寸都由包提供，本页只决定排在标题行哪里、给多大。
function DeckHeaderActions(props: any): unknown {
  const ui: any = deckBaseUI()
  if (!ui) return null
  deckEnsureBaseStylesOnce()
  return React.createElement(ui.ActionCluster, props || {})
}
export     const SettingsPage = (props: { sessionId?: unknown }): unknown => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
      const sharedSt = cx ? cx.storeSvc.useStore(props && props.sessionId) : useStore(props && props.sessionId)
      // T2 悬停提示迁移：设置提示框的挂顶显示已统一交给 HoverTip 负责，显示悬停提示、移动悬停提示、隐藏悬停提示三个旧函数（showCfgTip/moveCfgTip/hideCfgTip）已经下线，移除了全局显示时序，方位与样式走统一配置表，页面行为没有变化
      const [foldVer, setFoldVer] = React.useState(0)
      // #492 调试分组已搬进 views/diagnosticLog/DiagnosticLogSection.ts（状态、跑腿、画法全在里面，
      //   本页只剩一行挂载）；拨开关写本机设置文件 debug 节、导出四键走宿主电话，口径一点没变。
      // #876 更新入口全权委托：标题行按钮与更新面板 dialog 形态都由更新包的入口件挂上
      // （views/UpdateEntryHost.js），本文件不再自带按钮状态机与浮层弹窗；
      // 调用只走包的电话名与轮询间隔，关闭与轮询收尾按包的约定来。
      // 2026-09-21：这里原来有一项「打开位置」（点一下就写 cfg + 存档 + 全组广播，并落一行 settings.save）。
      //   面板现在只有 DSH 原生右侧边栏一条路，没有可选的入口，所以整项删除：
      //   两个状态、pickOpenIn、那一行 settings.save 日志与页面上的那一栏一并去掉。
      // #155 Q1 改：只读全局总览（wf.bindings + workspaces.list + wf.registry 色值，不可改；不调 wf.bind）
      // 数据装载与跳转收进 views/SettingsWorkspaces.js 的 useWsOverview（纯结构搬移，行为零变化）
      const overview = useWsOverview(cx, sharedSt)
      // T5 修订：设置页内 toast（独立于面板 dock 的 notice 渲染）
      const cfgNotice = sharedSt.notice
      return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
        cfgNotice ? h('div', { className: 'dsws-note', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
          Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
          h('span', null, cfgNotice.text),
        ]) : null,
        // 增-1（#520）改-2（#521）改-3（base 0.1.3）：标题同一行右侧是更新入口与页头静默簇（联系 / Star / Issue 三枚静默图标；
        //   悬停介绍、跳转网址、键盘聚焦都由包统一提供，窄窗口换行到标题下方；状态小字旁显示构建注入的版本号去 v 前缀数字，点跳仓库首页）
        h('div', { className: 'dsws-cfg-head', style: { flexWrap: 'wrap' } }, [
          Icon({ scheme: 'compass', size: 20 }),
          h('span', { className: 't' }, tr('panel.title')),
          h('span', { className: 's', style: { color: 'var(--dsw-alias-label-caption,#8b8b95)' } }, [
            Ic({ n: 'dot', size: 12 }),
            h('span', null, tr('cfg.status')),
            // 版本号这一颗也是可点控件（点了跳仓库首页）：这次需求要求「每个可点控件」都有悬停、按压与点击日志，
            //   原清单没点名它，按同一意图补齐，日志名与同屏其它页面导航保持同一套英文枚举。
            h('a', { className: 'dsws-hov', 'data-press': 'icon', 'data-log': 'settings.version', href: DSW_REPO_URL, target: '_blank', rel: 'noreferrer', style: { fontSize: 11, color: 'var(--dsw-alias-label-caption,#8b8b95)', textDecoration: 'none' } }, (typeof DSW_VERSION === 'string' ? DSW_VERSION.replace(/^v/, '') : '')),
          ]),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            h(UpdateEntryHost, { key: 'update' }),
            // 原两枚表情按钮（🌟 star / 💬 feedback）升级成 base 0.1.3 的页头静默簇（ActionCluster）：
            //   三枚彩色图标按 28×28 排（size 16 加包内 12 内边距），排法与悬停提示交给包；本页不再各写一套图标、网址与提示文案。
            h(DeckHeaderActions, { key: 'actions', size: 16 }),
          ]),
        ]),
        h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
        // #876：待重启横幅与更新面板 dialog 都收在入口件打开的面板里，本页不再另画。
        // 2026-09-21：这里原来是「打开位置」那一栏（DSH 右侧边栏 / BetterSidebar 二选一），整栏已删。
        //   面板只有 DSH 原生右侧边栏一条路，没有什么可选的，所以这一栏连着它的文案键一起撤掉。
        // #155 Q1 改：只读全局总览（wf.bindings + workspaces.list + wf.registry 色值，不可改；不调 wf.bind）
        // 分组渲染收进 views/SettingsWorkspaces.js 的 renderWsOverview（纯结构搬移，行为零变化）
        renderWsOverview(h, sharedSt, overview.wsOverview, overview.loadRef, foldVer, setFoldVer),

        // #492 沉底调试分组（布局文案沿 #334 原型：主开关默认关，写经 settingsDebugToggle（真源是本机设置文件的
        //   debug 节，宿主开机直接读它，见 #1012 第 8 条与 #1432），保存即广播；四键调宿主三电话加复用目录电话）
        h(DiagnosticLogSection, { sessionId: props && props.sessionId }),
        // base 包接入：底部「作者插件卡」由 base 包统一渲染（联系入口已经收进标题行的页头静默簇，底部不再重复一份）。
        //   推荐插件与文案都来自包的数据真源，本页不再写死。
        //   卡片自带外框（.dsh-base-plugins），外面不再包 .dsws-cfg-group：base 包真机验收抓到的正是这层双层边框。
        h(DeckAuthorPlugins, { key: 'base-footer' }),
        // T2 HoverTip 迁移：移除 sharedSt.cfgTip 全局 portal，改由 HoverTip 统一（行为零变化，翻转/样式走契约）
        null,
      ])
    }
