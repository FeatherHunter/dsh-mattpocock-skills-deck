/**
 * src/client/kernel/locale-pages.js — 内核模块（#690 历史票按需翻页的中英词条；#698 又收了布局那一问的几条）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 *
 * 为什么单独一份：locale-flow.js 与 locale-panel.js 都已经贴着「单文件不超 350 行」这条门禁
 * （#621 给标签配色加词条时就是这么做的，见 locale-labels.js），放不下更多文案，于是照同一做法自成一片。
 * 片段真源：locale-panel.js / locale-flow.js / locale-word.js / locale-labels.js / 本文件，
 * 由 locale.js 的合并器一起并进 L。
 *
 * #690 那五条说的是同一件事的不同情形（规格第 7.4、9、10 节）：翻页翻到多少了、后端不支持时去哪看、
 * 翻页位置失效了怎么办、没取到怎么办、内存里腾了旧页怎么办。
 * #698 那四条说的是「域文档布局」那一问的卡面：问的是什么、两个选项各叫什么（这一对既当选项标签、
 *   也当「从 X 改成 Y」那条对齐指令里的两个词）、以及切换后端那条路上工作区已经初始化过时多说的那一句。
 * 中英各一份，键名与占位符两边一致。
 */
    export const L_PAGES = {
      zh: {
        'list.pageLoaded': '已加载 {x} / 共 {n}',
        'list.pageAllOnWeb': '这个后端不能在这里翻页，去它的网页上看全部',
        'list.pageStale': '翻页位置已失效，已从最近的一页重新开始',
        'list.pageFail': '历史票没取到，稍后再试',
        'list.pageTrimmed': '更早的页已从内存腾出，再往上滚会重新加载',
        // #698（域文档布局那一问的卡面）
        'setup.layoutQuestion': '这个仓库的各部分共用一套用语，还是各有各的用语？',
        'setup.layoutSingle': '根目录一份 CONTEXT.md',
        'setup.layoutMulti': '子项目各一份 CONTEXT.md，根目录 CONTEXT-MAP.md',
        'setup.layout.single': '本仓库的域文档布局已在初始化时与用户确认为 single-context（一个仓库共用一份根目录的 CONTEXT.md，架构决定放 docs/adr/）：请把 single-context 这一句结论写进 docs/agents/domain.md，并让 AGENTS.md 的 ## Agent skills 块里 Domain docs 那一行也用这同一个词（技能要求的写法是「一行布局摘要 ＋ See docs/agents/domain.md」）；本次初始化不创建 CONTEXT-MAP.md 与各子项目的 CONTEXT.md，留到第一次真正写下词条时再建',
        'setup.layout.multi': '本仓库的域文档布局已在初始化时与用户确认为 multi-context（子项目各一份 CONTEXT.md，根目录一份 CONTEXT-MAP.md）：请把 multi-context 这一句结论写进 docs/agents/domain.md，并让 AGENTS.md 的 ## Agent skills 块里 Domain docs 那一行也用这同一个词（技能要求的写法是「一行布局摘要 ＋ See docs/agents/domain.md」）；本次初始化不创建 CONTEXT-MAP.md 与各子项目的 CONTEXT.md，留到第一次真正写下词条时再建，届时由仓库根目录的 CONTEXT-MAP.md 指向它们',
        'setup.layoutSwitchNote': '这个工作区已经初始化过。这里改的是记在仓库里的域文档布局结论；点确认之后，除「把记录后端的那几处对齐到新后端」之外，还会请 AI 把 docs/agents/domain.md 与 AGENTS.md 里记布局的那两行也改成新结论（不会重跑初始化、也不会重建已有产物）。',
        // #715（诚实显示）：面板头部那几句话说清「这份数据多新、上次刷新成不成、现在是不是降级」。
        //   两种失败是两句不同的话：「插件自己的取数失败」与「配额已被其他使用者耗尽」。
        //   键名与占位符中英一致；渲染点在 views/shared/truthLines.js（判据）与 views/ListTab.js（画）。
        'truth.updatedAt': '上次更新：{time}',
        'truth.failRetry': '刷新失败，正在重试',
        'truth.failPaused': '刷新失败，已暂停（配额紧张）',
        'truth.failQuota': '刷新失败：配额已被其他使用者耗尽，等整点恢复',
        'truth.deferred': '有更新，已推后',
        'truth.paused': '自动刷新已暂停',
        'truth.notRefreshing': '未在刷新（同时活跃上限 2）',
        'truth.lag': '数据可能落后 {min} 分钟',
        'truth.writing': '更新中',
        // #721（处理链展示面）：面板顶部那一条「每个会话在处理哪些票」用的词条。
        //   判据与画法在 views/shared/sessionChainView.js；数据只有宿主写下的一份读数一个来源。
        //   action.* 这八个键与链的闭集合（chain.ts 的 CHAIN_ACTIONS）逐个对应，门禁每次核对。
        'chainView.title': '每个会话在处理哪些票',
        'chainView.readAt': '宿主读数 {time}',
        'chainView.session': '会话 {id}',
        'chainView.unreadable': '处理链读不到：宿主这次没有给出这份读数（空白不等于没有人正在处理票）',
        'chainView.unreadableTip': '宿主给的代号：{reason}',
        'chainView.openTip': '打开宿主记下的这张票',
        'chainView.action.create': '建票',
        'chainView.action.plan': '写计划',
        'chainView.action.comment': '评论',
        'chainView.action.edit': '改内容',
        'chainView.action.state': '改状态',
        'chainView.action.link': '建立关联',
        'chainView.action.file-write': '改票文件',
        'chainView.action.other-write': '其他写操作',
      },
      en: {
        'list.pageLoaded': '{x} loaded / {n} total',
        'list.pageAllOnWeb': 'This backend cannot page here — see everything on its web page',
        'list.pageStale': 'The page position expired; restarted from the most recent page',
        'list.pageFail': 'Could not load more history; try again shortly',
        'list.pageTrimmed': 'Older pages were dropped from memory; scrolling back up reloads them',
        // #698 (the domain-doc layout question)
        'setup.layoutQuestion': 'Do the parts of this repo share one glossary, or does each keep its own?',
        'setup.layoutSingle': 'One CONTEXT.md at the repo root',
        'setup.layoutMulti': 'One CONTEXT.md per subproject, plus a root CONTEXT-MAP.md',
        'setup.layout.single': 'The domain-doc layout for this repo was confirmed with the user at setup time as single-context (one CONTEXT.md at the repo root, with architecture decisions in docs/adr/): write that single-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither CONTEXT-MAP.md nor per-subproject CONTEXT.md files — they wait until the first real glossary entry is written',
        'setup.layout.multi': 'The domain-doc layout for this repo was confirmed with the user at setup time as multi-context (one CONTEXT.md per subproject, plus a CONTEXT-MAP.md at the repo root): write that multi-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither CONTEXT-MAP.md nor the per-subproject CONTEXT.md files — they wait until the first real glossary entry is written, and the CONTEXT-MAP.md at the repo root will then point at them',
        'setup.layoutSwitchNote': 'This workspace is already set up. What you change here is the domain-doc layout conclusion recorded in the repo; after you confirm, the plugin will additionally ask the AI to rewrite the two lines that record the layout in docs/agents/domain.md and AGENTS.md (it will not re-run setup and will not rebuild existing artifacts).',
        // #715 (honest display): the panel-header lines that say how old this data is, whether the
        //   last refresh worked, and whether the plugin is degraded. The two failures are two
        //   different sentences: "our own fetch failed" versus "the quota was used up by others".
        'truth.updatedAt': 'Last updated: {time}',
        'truth.failRetry': 'Refresh failed; retrying',
        'truth.failPaused': 'Refresh failed; paused (quota is tight)',
        'truth.failQuota': 'Refresh failed: the hourly quota was used up by others; it recovers on the hour',
        'truth.deferred': 'Updates found; postponed',
        'truth.paused': 'Auto refresh paused',
        'truth.notRefreshing': 'Not refreshing (concurrent active limit 2)',
        'truth.lag': 'Data may lag up to {min} min',
        'truth.writing': 'Updating',
        // #721 (the processing-chain strip): the words used by "which tickets each session is working on".
        //   The judgement and the drawing live in views/shared/sessionChainView.js; the only data source
        //   is the one reading the host writes. The eight action.* keys line up one for one with the
        //   chain's closed set (CHAIN_ACTIONS in chain.ts), and a gate re-checks that every run.
        'chainView.title': 'Which tickets each session is working on',
        'chainView.readAt': 'host reading {time}',
        'chainView.session': 'session {id}',
        'chainView.unreadable': 'The processing chain cannot be read: the host did not hand over this reading this time (a blank list does not mean nobody is working on a ticket)',
        'chainView.unreadableTip': 'Code from the host: {reason}',
        'chainView.openTip': 'Open this ticket as the host recorded it',
        'chainView.action.create': 'opened a ticket',
        'chainView.action.plan': 'wrote a plan',
        'chainView.action.comment': 'commented',
        'chainView.action.edit': 'edited',
        'chainView.action.state': 'changed state',
        'chainView.action.link': 'linked',
        'chainView.action.file-write': 'wrote a ticket file',
        'chainView.action.other-write': 'other write',
      },
    }

