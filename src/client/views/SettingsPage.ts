/**
 * views/SettingsPage.ts — 配置页（TPL 表 + 设置，5.9）真源 ESM，build 拼回 src/client/index.ts leaf。
 * （原来是 .js：调试分组搬进 views/diagnosticLog/ 之后按「动到哪里转到哪里」转成 TypeScript。
 * 本页现在只剩标题、总览、更多插件三样，调试那一组只剩一行挂载，行为零变化。）
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
declare const HoverTip: unknown;
declare const Icon: (props: { scheme: string; size: number }) => unknown;
declare const Ic: (props: { n: string; size: number; color?: string }) => unknown;
declare const NOTICE_COLOR: Record<string, string>;
declare function noticeIcon(kind: unknown): string;
declare const DSW_REPO_URL: string;
declare const DSW_VERSION: unknown;
declare const DiagnosticLogSection: (props: { sessionId?: unknown }) => unknown;

// 增-2（#520）：底部作者其他插件清单（4 个，2026-09-06 已验真；写死网址，不拉取不新增网络请求）
const MORE_PLUGINS: Array<{ slug: string; url: string; descKey: string }> = [
  { slug: 'dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', descKey: 'more.desc.deck' },
  { slug: 'dsh-opencode-palette', url: 'https://github.com/FeatherHunter/dsh-opencode-palette', descKey: 'more.desc.palette' },
  { slug: 'dsh-prompt', url: 'https://github.com/FeatherHunter/dsh-prompt', descKey: 'more.desc.prompt' },
  { slug: 'dsh-im-companion', url: 'https://github.com/FeatherHunter/dsh-im-companion', descKey: 'more.desc.companion' },
]
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
        // 增-1（#520）改-2（#521）：标题同一行右侧两个表情按钮（星星只留 🌟、反馈只留 💬，一家一颗常显；悬停介绍、跳转网址、键盘聚焦不动；窄窗口换行到标题下方；状态小字旁显示构建注入的版本号去 v 前缀数字，点跳仓库首页）
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
            h(HoverTip, { key: 'star', content: tr('cfg.starTip'), maxWidth: 220 },
              h('a', { className: 'dsws-hov', 'data-press': 'icon', 'data-log': 'settings.star', href: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', target: '_blank', rel: 'noreferrer', style: { display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, color: 'inherit', textDecoration: 'none' } }, [h('span', { 'aria-hidden': 'true', style: { fontSize: 14, lineHeight: 1 } }, '🌟')])),
            h(HoverTip, { key: 'feedback', content: tr('cfg.feedbackTip'), maxWidth: 220 },
              h('a', { className: 'dsws-hov', 'data-press': 'icon', 'data-log': 'settings.issue', href: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/new', target: '_blank', rel: 'noreferrer', style: { display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, color: 'inherit', textDecoration: 'none' } }, [h('span', { 'aria-hidden': 'true', style: { fontSize: 14, lineHeight: 1 } }, '💬')])),
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
        // 增-2（#520）：底部作者其他插件独立区域（默认展开，每行点开跳对应仓库首页；不新增本地存档键）
        h('div', { className: 'dsws-cfg-group' }, [
          h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'skills', size: 13 }), h('span', null, tr('more.title'))]),
        ].concat(MORE_PLUGINS.map(function (p, i) {
          // 点击日志要能唯一定位到同屏的哪一行插件：仓库名本身就是稳定标识，洗成只留小写字母、数字与横线的枚举；
          //   万一以后某个名字洗成空串，退回下标，保证每一行仍然唯一。
          const slugKey = String(p.slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
          return h('a', { key: p.slug, className: 'dsws-hov', 'data-press': 'row', 'data-log': 'settings.plugin.' + (slugKey || ('i' + i)), href: p.url, target: '_blank', rel: 'noreferrer', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', textDecoration: 'none', color: 'inherit' } }, [
            h('span', { style: { fontFamily: 'Consolas,Menlo,monospace', fontSize: 12, fontWeight: 650, flex: 'none' } }, p.slug),
            h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary,#a1a1aa)' } }, tr(p.descKey)),
            Ic({ n: 'external-link', size: 12 }),
          ])
        }))),
        // T2 HoverTip 迁移：移除 sharedSt.cfgTip 全局 portal，改由 HoverTip 统一（行为零变化，翻转/样式走契约）
        null,
      ])
    }
