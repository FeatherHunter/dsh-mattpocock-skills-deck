/**
 * src/client/kernel/locale-skilldesc.js — 内核模块（#879 验收：27 个技能描述的中英词条；
 *   locale-word.js 贴着「单文件不超 350 行」这条门禁，照 #621/#690/#842 的做法自成一个片段）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 *
 * 为什么单独一份：locale-word.js 已经贴着 350 行上限（#880 收尾时 363 行超标，留给验收票清），
 *   技能描述这一组中英各 27 条、只讲「每个技能是干什么的」，整组搬过来，键名与文案一字未改。
 * 片段真源：locale-panel.js / locale-flow.js / locale-word.js / locale-labels.js / locale-pages.js /
 *   locale-vcwrite.js / 本文件，由 locale.js 的合并器一起并进 L。
 * 条数与技能注册表 src/shared/matt-skills.js 对齐（增减技能时两边同改，见 verify-skill-tooltip.js）。
 */
    export const L_SKILLDESC = {
      zh: {
        'skilldesc.ask-matt': '技能路由器：不知道该用哪个 skill 时问它',
        'skilldesc.setup-matt-pocock-skills': '仓库初始化：issue tracker / 标签 / 文档路径',
        'skilldesc.wayfinder': '为多议题项目建决策地图与子票拆解',
        'skilldesc.triage': 'issue 分流：归类→验证→追问，直至 ready-for-agent',
        'skilldesc.grilling': '在你拍板前反复追问澄清，直到设计落地',
        'skilldesc.grill-with-docs': '对照仓库文档追问，直到说法与文档一致',
        'skilldesc.grill-me': '不读写仓库，纯对话里反复追问',
        'skilldesc.domain-modeling': '梳理领域术语，让代码 / 文档 / 对话用同一套词',
        'skilldesc.research': '后台调研，写进 repo 内 markdown 并引源',
        'skilldesc.prototype': '一次性原型回答设计问题',
        'skilldesc.implement': '把规格文档拆成代码任务，逐项实现',
        'skilldesc.implement-spec': '把整份规格在集成分支上一次跑完',
        'skilldesc.pr': '按固定三段形状写 PR 正文',
        'skilldesc.retro': '复盘编码会话，只提环境改进',
        'skilldesc.code-review': '按仓库规范 + 原规格，双轴审查你的改动',
        'skilldesc.codebase-design': '为代码找清晰的模块边界与接口',
        'skilldesc.diagnosing-bugs': '硬 bug / 性能回归：定位→假设→验证，循环往复',
        'skilldesc.improve-codebase-architecture': '扫出代码库的深化机会，输出 HTML 报告',
        'skilldesc.tdd': '测试驱动开发：先写失败测试，再写最小实现',
        'skilldesc.wizard': '生成一步一步带人操作的人工步骤向导',
        'skilldesc.handoff': '把当前对话压缩成交接文档',
        'skilldesc.teach': '跨 session 教你新技能',
        'skilldesc.to-spec': '把零散讨论固化成可执行的规格文档',
        'skilldesc.to-tickets': '把规格拆成 tickets',
        'skilldesc.to-questionnaire': '把答不上来的决定整理成问卷请人填',
        'skilldesc.wait-what': '用大白话重讲上一段没听懂的内容',
        'skilldesc.writing-for-agents': '写给 agent 看的文档写法',
      },
      en: {
        'skilldesc.ask-matt': 'Skill router: ask it when unsure which skill to use',
        'skilldesc.setup-matt-pocock-skills': 'Repo bootstrap: issue tracker / labels / doc paths',
        'skilldesc.wayfinder': 'Build decision maps + sub-ticket breakdowns for big projects',
        'skilldesc.triage': 'Route issues: classify → verify → grill, until ready-for-agent',
        'skilldesc.grilling': 'Relentlessly question you until the design is locked down',
        'skilldesc.grill-with-docs': 'Interview against repo docs until claims match the docs',
        'skilldesc.grill-me': 'Pure conversation interview without reading or writing the repo',
        'skilldesc.domain-modeling': 'Lock down domain terms so code, docs and chat use one language',
        'skilldesc.research': 'Background research written into repo markdown with sources',
        'skilldesc.prototype': 'One-off prototype answering a design question',
        'skilldesc.implement': 'Break a spec into code tasks and implement them one by one',
        'skilldesc.implement-spec': 'Run the whole spec on one integration branch in one go',
        'skilldesc.pr': 'Write a PR body in the fixed three-section shape',
        'skilldesc.retro': 'Review a coding session for environment improvements only',
        'skilldesc.code-review': 'Review your diff on both repo standards and the originating spec',
        'skilldesc.codebase-design': 'Find clean module boundaries and interfaces for your code',
        'skilldesc.diagnosing-bugs': 'Hard bugs / perf regressions: locate → hypothesize → verify, loop',
        'skilldesc.improve-codebase-architecture': 'Scan the codebase for deepening opportunities, output an HTML report',
        'skilldesc.tdd': 'Test-driven dev: failing test first, then minimal implementation',
        'skilldesc.wizard': 'Generate a step-by-step wizard for human-only steps',
        'skilldesc.handoff': 'Compress this conversation into a handoff doc',
        'skilldesc.teach': 'Teach you new skills across sessions',
        'skilldesc.to-spec': 'Turn scattered discussions into an executable spec',
        'skilldesc.to-tickets': 'Split specs into tickets',
        'skilldesc.to-questionnaire': 'Turn an unanswerable decision into a fill-in questionnaire',
        'skilldesc.wait-what': 'Rephrase the last message in plain language',
        'skilldesc.writing-for-agents': 'How to write docs that agents read',
      },
    }
