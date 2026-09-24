/**
 * src/client/kernel/prompts.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首 export 关键字，
 * 把声明体拼回 src/client/index.js 的拼接标记处（apply 闭包内原位），与 ctx.js/seam 同模式，
 * 一源两物、src 零复制；接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 * 改 src 后必跑 node scripts/build.mjs，生成 client.js / package/lib/client.js，勿手改产物。
 */
    export const PROMPTS = {
      "mapExecute": { version: 9, placeholders: ['n', 'title', 'url'], use: 'map 执行 / 新会话（未完成态）· 推进式 · 清单式（A★）', zh: '## 目标 map\n- 编号：#{n}\n- 标题：{title}\n- 链接：{url}\n\n请使用 wayfinder 技能推进该 map（遵循其规则）：\n\n## 分析\n- [ ] 加载 wayfinder 技能（如未加载）\n- [ ] 分析这个 map：Destination / Notes / 阻塞关系 / 当前 frontier\n\n## 选票\n- [ ] 按第一性原理，选 frontier 中最值得推进的下一个 issue（价值最高 / 风险最低 / 最解阻）\n\n## 执行\n- [ ] 认领该票 → 读 Description / Notes / 阻塞关系 → 制定方案 → 实施 → 验收\n- [ ] 若该票带 needs-triage：先按阶段闸门完成诊断（读现状 / 判断进展：真实 / 虚假 / 未动工）再进入实施，不许跳过\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行；下一步一并写上）\n- [ ] 做完了就 close 这张票，没做完就留着\n- [ ] 若本次推进关闭了票：同步 map 记录（Decisions so far 追加 gist / 迷雾毕业 / Out of scope）', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}\n\nPlease use the wayfinder skill to advance this map (follow its rules):\n\n## Analyze\n- [ ] Load the wayfinder skill (if not loaded)\n- [ ] Analyze this map: Destination / Notes / blocking relationships / current frontier\n\n## Pick the ticket\n- [ ] From first principles, pick the next issue on the frontier most worth advancing (highest value / lowest risk / most unblocking)\n\n## Execute\n- [ ] Claim the ticket → read Description / Notes / blocking relationships → plan → implement → verify\n- [ ] If the ticket carries needs-triage: first complete the stage-gate diagnosis (read current state / judge progress: real / fake / not started) before implementation — do not skip\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours; add the next step)\n- [ ] Close this ticket when it is done; leave it open when it is not\n- [ ] If this advance closes any ticket, sync the map records (Decisions so far gist / fog graduation / Out of scope)' },
                  "complete": { version: 9, placeholders: ['n', 'title', 'url', 'closed', 'total'], use: 'map 完成态 · 完成调查（100% 却未 close 时排查真实原因 · 人来定夺）', zh: '## 目标 map\n- 编号：#{n}\n- 标题：{title}\n- 链接：{url}\n\n## MAP完成确认\n\n当前 map 显示 100% 完成：{closed}/{total} 个 issue 已关闭，但 map 本身仍 open。请先调查「为什么 100% 却未 close」，不要轻信数字、不要擅自 close。\n\n## 调查（弄清 100% 是否真实、以及未 close 的真实原因）\n- [ ] 任务是否真的完成：sub-issue 是否真正解决了原 Destination（而非只把 ticket 关了）？\n- [ ] 排查与该 map 相关、但未建立 sub-issue 关系的 issue（关联工作可能没计入 {closed}/{total}）——如搜索提及该 map 编号/标题的 issue、核对相关标签等；\n- [ ] 逐个核对 sub-issue 的完成状态与关闭状态是否一致（漏关/误开）：实际已完成却漏标 CLOSED，或未完成却标 CLOSED；\n- [ ] 检查是否还有 Not yet specified 中未毕业的事项；\n- [ ] 其他可能情况（如已真实完成只是忘了 close、计数与实际不符等）——自行排查，不限于上述清单；\n\n## 报告你来定夺（人来定夺）\n- [ ] 把调查结论整理成「发现 + 建议」报告给用户；\n- [ ] 由用户决定下一步（收尾 close / 补齐遗漏 / 调整 map 记录 / 其他），不擅自 close、不擅自改 map 记录；\n\n## 收尾\n- [ ] 用户确认后，按用户意见执行（如需 close → close map + 在 Decisions so far 追加总结，每个 closed ticket 一行 gist）；\n- [ ] 结束前把调查结论写进相关 issue 正文；发现状态与实际不符（漏关 / 误开）就据实写清楚；\n- [ ] 若涉及 map 记录调整（Not yet specified / Out of scope）→ 按 wayfinder 规则同步，不重复展开；', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}\n\n## MAP completion check\n\nThe map shows 100% complete: {closed}/{total} issues closed, but the map itself is still open. Investigate first why it is 100% but not closed — do not trust the numbers, do not close on your own.\n\n## Investigate (determine whether the 100% is real, and the real reason it is not closed)\n- [ ] Is the task really done: did the sub-issues actually resolve the original Destination (not just close the tickets)?\n- [ ] Hunt for issues related to this map but not wired as sub-issues (related work may not be counted in {closed}/{total}) — e.g. search issues mentioning this map by number or title, check related labels, etc.;\n- [ ] Check each sub-issue completion state vs close state (missed/erroneous close): actually done but not marked CLOSED, or not done but marked CLOSED;\n- [ ] Check whether any ungraduated items remain in Not yet specified;\n- [ ] Other possibilities (e.g. really done but forgot to close, count mismatch with reality, etc.) — investigate on your own, not limited to the list above;\n\n## Report to you — human in the loop\n- [ ] Summarize the investigation into a findings + recommendation report for the user;\n- [ ] Let the user decide next steps (wrap-up close / fill gaps / adjust map records / other) — do not close on your own, do not change map records on your own;\n\n## Wrap-up\n- [ ] After the user confirms, act per the user-confirmed decision (if close → close the map + append a summary to Decisions so far, one-line gist per closed ticket);\n- [ ] Before finishing, write the findings into the relevant issue bodies; where the recorded state does not match reality (missed close / erroneous close), say so plainly\n- [ ] If map-record adjustments are involved (Not yet specified / Out of scope) → sync per the wayfinder rules, without re-expanding;' },
      "fixate": { version: 6, placeholders: [], use: '沉淀 · 思维对齐 · 成果沉淀', zh: '告一段落。暂停推进，执行「思维对齐 · 成果沉淀」，从第一性原理出发：\n\n## 沉淀\n- [ ] 全量复述：把我从会话开始到现在、我问过你并得到明确回答的内容，按五类逐条列出（每条 = 我问的问题 → 你的回答）：目的地 / 约束与偏好 / 已确认的决定 / 待决问题 / 雾区（隐约可见但还不清晰）\n- [ ] 不压缩、不合并——宁可啰嗦不可省略；一次全部列完，不分批\n- [ ] 每条标注出处：我的问题（短句）+ 你的原话关键短句（≤50 字，超出以省略号截断）+ 上下文提示（如主题/轮次），让我知道它来自哪\n\n## 可疑遗漏\n- [ ] 单列一节「可疑遗漏」：\n  - [ ] 我问过、你已回答、但我未纳入上面清单的（第一优先级——防我漏记你已答的内容）\n  - [ ] 你提过、但我判断与主线无关 / 太模糊 / 属执行细节而未纳入的\n  - [ ] 每条写明我当时的判断理由，由你裁决纳入或放弃\n\n## 核对\n- [ ] 列完（含「可疑遗漏」）后停下，等我逐条核对；我确认或修正后，你再执行落盘\n\n## 落盘\n- [ ] 有明确对应 ticket（票）→ 全部成果写入该 ticket 正文的「## 对齐成果」节（新增或并入，含日期）；不写 map（地图）正文——map 是索引，成果归 ticket\n- [ ] 无对应 ticket、但属于某 map → 写入 alignment note（对齐记录）`.scratch/alignment/<ts>-<短标题>.md`（相对当前工作目录；短标题 ≤10 字，用连字符或下划线代替空格），并在该 map 的 Notes 追加一行指针（路径 + 日期）\n- [ ] 无 ticket 也无 map → 写入对齐记录文件，并告诉我完整路径；建图/建票时由接手会话搬入对应 ticket\n- [ ] 属 map 层面的条目（如目的地/雾区调整）→ 照写进所选位置，条目末尾标注「map 层面，随建图搬入」', en: 'This phase wraps up here. Pause progress and run the "alignment & consolidation" pass, from first principles:\n\n## Consolidate\n- [ ] Restate everything I have explicitly answered since this session started, in five categories (each item = my question → your answer): Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)\n- [ ] No compression, no merging — rather verbose than omitted; list everything in one go, no batching\n- [ ] Annotate each item with its source: my question (short) + a key quote of your original words (≤50 chars, truncate with ellipsis if longer) + a context hint (e.g. topic/turn) so I know where it came from\n\n## Suspected omissions\n- [ ] Add a separate "Suspected omissions" section:\n  - [ ] Questions I asked, you answered, but I did not include above (first priority — guard against forgetting your answers)\n  - [ ] Things you mentioned but I judged off-topic, too vague, or execution detail and did not include\n  - [ ] State my judgment reason for each; you decide whether to keep or drop\n\n## Review\n- [ ] Stop after listing (including "Suspected omissions") and wait for my item-by-item review; once I confirm or correct, you persist the list\n\n## Persist\n- [ ] If a corresponding ticket exists → write all outcomes into that ticket body (a new or merged "## Alignment outcomes" section, with date); do not write into the map body — the map is an index, outcomes belong to the ticket\n- [ ] If no corresponding ticket but within a map → write an alignment note to `.scratch/alignment/<ts>-<short>.md` (relative to the current working directory; short ≤20 chars, hyphen or underscore instead of spaces), and append a one-line pointer (path + date) to the map Notes\n- [ ] If no ticket and no map → write the alignment note and tell me the full path; when a map/ticket is created, the taking-over session migrates it into the corresponding ticket\n- [ ] Map-level items (e.g. Destination/Fog adjustments) → still write them in the chosen place, and mark the item "map-level, migrate when the map is built"' },
      "tpl.diagnose": { version: 10, placeholders: ['url'], use: '动作按钮「诊断」（needs-triage ticket）· 清单式（A★）', zh: '/triage\n{url}\n\n诊断这个 issue（遵循 /triage 技能自身规则，诊断≠修复——只弄清问题与分流，不直接改代码）：\n\n## 弄清现象\n- [ ] 现象是什么\n- [ ] 影响范围是什么\n- [ ] 复现步骤是什么（可复现则给出最小复现）\n\n## 根因候选\n- [ ] 列出多个根因候选，标注各自可能性/置信度\n\n## 分流建议（判断要落到标签，这一步必须做）\n- [ ] 给分流建议并切标签到唯一终态：修复→ready-for-agent（有小疑问可附待确认事项一起转，不阻塞），需人动手→ready-for-human，缺关键信息→needs-info，不做→wontfix；无理由不许停在 needs-triage\n- [ ] 标签流转是诊断的一部分，按当前后端方式执行；禁止的是改业务代码、关闭单子、开始修复实施，这三件诊断阶段不做\n\n## 澄清\n- [ ] 动手前若有「我猜用户想要这样」的地方，先用 grilling 技能澄清（不猜）\n\n## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）\n- [ ] 先读该 issue 现状：正文 / 评论 / 标签 / 已有的实施记录，判断它处于哪个阶段\n- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）\n- [ ] 诊断时判断当前进展：\n  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实就摘 needs-triage（转 ready-for-agent）\n  - [ ] 已有实施但站不住（虚假或半成品）→ 把缺在哪写进正文，继续诊断\n  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）\n- [ ] 诊断完成必须摘 needs-triage（落到上述四终态之一）后才允许进入实施阶段；暂留 needs-triage 仅当缺信息到无法分流，且必须写明缺什么\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行）\n- [ ] 结尾必须用提问格式收尾：有待维护者拍板的事，写成❓ Q1、Q2并逐个给推荐答案（➡️），说明回了就执行什么标签动作，等回复，不猜着转；无待拍板则写明已转到哪个终态', en: '/triage\n{url}\n\nDiagnose this issue (follow the /triage skill own rules; diagnosis ≠ fix — clarify the problem and propose triage, do not fix code directly):\n\n## Symptoms\n- [ ] What are the symptoms\n- [ ] What is the impact\n- [ ] What are the repro steps (give minimal repro if reproducible)\n\n## Root causes\n- [ ] List multiple root-cause candidates with confidence\n\n## Triage (the call must land on a label — this is required)\n- [ ] Propose triage and move the label to exactly one terminal state: fix → ready-for-agent (minor open points ride along as confirmation items, no blocking), needs human → ready-for-human, missing key info → needs-info, will not do → wontfix; do not stay on needs-triage without a reason\n- [ ] Moving labels is part of diagnosis, via the current backend; forbidden in diagnosis: changing product code, closing the ticket, starting the fix\n\n## Clarify\n- [ ] Before acting, if any part rests on a guess about what the user wants, settle it with the grilling skill first (do not guess)\n\n## Stage gate (must read before starting — part of the action, not optional)\n- [ ] First read the issue current state: body / comments / labels / existing implementation record — determine stage\n- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)\n- [ ] During diagnosis, judge progress:\n  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, remove needs-triage (→ ready-for-agent)\n  - [ ] Existing impl but not sound (fake or half-finished) → write down what is missing, keep diagnosing\n  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into the issue)\n- [ ] Implementation may begin only after diagnosis removes needs-triage (landed on one of the four terminal states above); keeping needs-triage is allowed only when info is too thin to triage, and you must state what is missing\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours, as long as a human can read it)\n- [ ] End with explicit questions: any maintainer call goes as ❓ Q1, Q2 with a recommended answer each (➡️), stating which label move follows each reply; wait for replies instead of guessing; with no open calls, state which terminal state was applied' },
      "tpl.fix": { version: 7, placeholders: ['url'], use: '动作按钮「修复」（bug 票）· 清单式（A★）', zh: '/implement\n{url}\n\n修复这个 bug（遵循 wayfinder 技能规则）：\n\n## 读现状\n- [ ] 已认领？若未认领，先认领\n- [ ] 先把这张票读全（正文 / 评论 / 标签 / 认领 / 父子与阻塞边），确认现象与验收标准\n\n## 定位与修复\n- [ ] 先复现（可复现则给出最小复现）\n- [ ] 再定位根因（修错地方 = 白修）；若目标不清或有假设 → 用 grilling 技能澄清（不猜）\n- [ ] 制定方案 → 实施修复 → 加测试并跑通\n- [ ] 对抗式自查：边界 / 异常分支 / 回归影响 / 并发与旧数据（我会漏在哪里？逐项打勾）\n\n## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）\n- [ ] 先读该 issue 现状：正文 / 评论 / 标签 / 已有的实施记录，判断它处于哪个阶段\n- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）\n- [ ] 诊断时判断当前进展：\n  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实就摘 needs-triage（转 ready-for-agent）\n  - [ ] 已有实施但站不住（虚假或半成品）→ 把缺在哪写进正文，继续诊断\n  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）\n- [ ] 诊断完成摘 needs-triage 后才允许进入实施阶段\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行）', en: '/implement\n{url}\n\nFix this bug (follow the wayfinder skill rules):\n\n## Read current state\n- [ ] Claimed? Claim first if unclaimed\n- [ ] Read the whole ticket (body / comments / labels / claim / parent & blocking edges) — confirm symptoms & acceptance criteria\n\n## Locate & fix\n- [ ] Reproduce first (give minimal repro if reproducible)\n- [ ] Then locate root cause (fixing the wrong spot is wasted work); if goal unclear or any assumption → clarify with grilling (do not guess)\n- [ ] Plan → implement fix → add tests and get them green\n- [ ] Adversarial self-check: boundaries / error branches / regression impact / concurrency & legacy data (where did I miss? check each)\n\n## Stage gate (must read before starting — part of the action, not optional)\n- [ ] First read the issue current state: body / comments / labels / existing implementation record — determine stage\n- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)\n- [ ] During diagnosis, judge progress:\n  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, remove needs-triage (→ ready-for-agent)\n  - [ ] Existing impl but not sound (fake or half-finished) → write down what is missing, keep diagnosing\n  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into the issue)\n- [ ] Only after diagnosis and needs-triage removed may implementation begin\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours, as long as a human can read it)' },
      "tpl.discuss": { version: 8, placeholders: ['url'], use: '动作按钮「讨论」（grilling 票）· 清单式（A★）', zh: '/grill-with-docs\n{url}\n\n这个 issue 需要讨论定夺，和我对话（遵循技能自身规则）：\n\n## 讨论聚焦\n- [ ] 围绕目标 / 边界 / 风险 / 选项权衡 / 决策 五要素展开（齐且不冗，不额外扩散）\n\n## 人来定夺\n- [ ] 不替我做决定，等我确认结论再落盘\n\n## 结论落盘\n- [ ] 有结论时写进 issue 正文；需长期留存则另建议落成新 tickets / 决策记录（正文为首，tickets 为辅，不散落）\n\n## 澄清\n- [ ] 有“我猜用户想要这样”的地方，先用 grilling 澄清，不猜\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行）\n- [ ] 全部讨论完毕、意图对齐时，主动提醒用户执行一次 /to-spec，把讨论结论固化为规格文档\n- [ ] /to-spec 产出的规格单，挂到同一张 map 上成为 subissue；无 map 时不写', en: '/grill-with-docs\n{url}\n\nThis issue needs discussion before a decision — talk with me (follow the skill’s own dialogue rules):\n\n## Focus\n- [ ] Cover goal / boundary / risks / options-tradeoffs / decision — all five, no more, no less (keep complete and concise, no extra expansion)\n\n## Human in the loop\n- [ ] Do not decide for me; wait for my confirmation before persisting conclusions\n\n## Persist conclusion\n- [ ] When a conclusion emerges, write it into the issue body; if it needs durable memory, additionally propose a new ticket / decision record (body is primary, ticket/record is auxiliary — no scattering)\n\n## Clarify\n- [ ] Before acting, if any part rests on a guess about what I want, settle it with grilling first (do not guess)\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours, as long as a human can read it)\n- [ ] Once all discussion is done and intent is aligned, proactively remind the user to run /to-spec to solidify the conclusions into a spec document\n- [ ] Attach the spec issue that /to-spec produces to the same map, as a sub-issue; skip this if the issue has no map.' },
            "tpl.research": { version: 5, placeholders: ['url'], use: '动作按钮「研究」（research 票）· 清单式', zh: '/research\n{url}\n\n研究这个 issue（遵循 /research 技能规则）：\n\n## 研究目标\n- [ ] 明确研究问题与决策依赖\n- [ ] 收集相关资料、文档与上下文\n- [ ] 引用可信来源并记录发现\n\n## 澄清\n- [ ] 有“我猜用户想要这样”的地方，先用 grilling 技能澄清，不猜\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行）', en: '/research\n{url}\n\nResearch this issue (follow the /research skill rules):\n\n## Goals\n- [ ] Clarify the research question and decision it blocks\n- [ ] Gather relevant docs, context, and primary sources\n- [ ] Cite sources and capture findings\n\n## Clarify\n- [ ] Before acting, if any part rests on a guess about what the user wants, settle it with grilling first (do not guess)\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours, as long as a human can read it)' },
"tpl.prototype": { version: 5, placeholders: ['url'], use: '动作按钮“原型”（prototype 票）· 清单式', zh: '/prototype\n{url}\n\n做这个原型（遵循 /prototype 技能自身规则）：\n\n## 原型目标\n- [ ] 明确要回答的设计问题并判定分支（逻辑/状态模型是否顺畅 → 单文件可分享 HTML；界面应该长什么样 → 同路由多变体+底部悬浮切换）\n- [ ] 按分支产出抛弃式原型并外显状态\n\n## 澄清\n- [ ] 有“我猜用户想要这样”的地方，先用 grilling 澄清，不猜\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行）', en: '/prototype\n{url}\n\nBuild this prototype (follow the /prototype skill rules):\n\n## Goals\n- [ ] State the design question and pick the branch (does the logic/state model feel right? → single shareable HTML; what should this look like? → variants on the same route + floating switcher)\n- [ ] Produce the throwaway prototype and surface the state\n\n## Clarify\n- [ ] If any part rests on a guess about what the user wants, settle it with grilling first (do not guess)\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours, as long as a human can read it)' },
            "tpl.execute": { version: 9, placeholders: ['url'], use: '动作按钮「执行」（普通票）· 清单式（A★）', zh: '/wayfinder\n{url}\n\n执行这个 issue（遵循 wayfinder 技能规则）：\n\n## 读现状\n- [ ] 已认领？若未认领，先认领\n- [ ] 先把这张票读全（正文 / 评论 / 标签 / 认领 / 父子与阻塞边），确认交付物与验收标准\n\n## 执行\n- [ ] 目标不清或需用户定夺 → 用 grilling 技能澄清（不猜）\n- [ ] 制定方案 → 实施 → 按验收标准自查（对抗式）\n\n## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）\n- [ ] 先读该 issue 现状：正文 / 评论 / 标签 / 已有的实施记录，判断它处于哪个阶段\n- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）\n- [ ] 诊断时判断当前进展：\n  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实就摘 needs-triage（转 ready-for-agent）\n  - [ ] 已有实施但站不住（虚假或半成品）→ 把缺在哪写进正文，继续诊断\n  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）\n- [ ] 诊断完成摘 needs-triage 后才允许进入实施阶段\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定；下一步一并写上）；做完了就 close，没做完就留着\n- [ ] 若执行后关闭了该票：在所属 map 的 Decisions so far 追加一行 gist（票名 + 链接 + 一句话结论）', en: '/wayfinder\n{url}\n\nExecute this issue (follow the wayfinder skill rules):\n\n## Read current state\n- [ ] Claimed? Claim first if unclaimed\n- [ ] Read the whole ticket (body / comments / labels / claim / parent & blocking edges) — confirm deliverable & acceptance criteria\n\n## Execute\n- [ ] If goal unclear or needs user call → clarify with grilling (do not guess)\n- [ ] Plan → implement → self-check against acceptance criteria (adversarial)\n\n## Stage gate (must read before starting — part of the action, not optional)\n- [ ] First read the issue current state: body / comments / labels / existing implementation record — determine stage\n- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)\n- [ ] During diagnosis, judge progress:\n  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, remove needs-triage (→ ready-for-agent)\n  - [ ] Existing impl but not sound (fake or half-finished) → write down what is missing, keep diagnosing\n  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into issue)\n- [ ] Only after diagnosis and needs-triage removed may implementation begin\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours; add the next step); close it when it is done, leave it open when it is not\n- [ ] If this execution closes the ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion)' },
      "tpl.handoff1": { version: 3, placeholders: ['ts'], use: '交接第一击（写交接文档）', zh: '/handoff 把当前会话生成交接文档，写到 .scratch/handoff/{ts}-<短标题>.md（相对当前工作目录）。<短标题> 是你给这次交接起的一个简短标题（中文 ≤10 字 / 英文 ≤20 字符，跟随当前会话语言，用连字符或下划线代替空格），让人一眼认出这是哪件事的交接。\n\n交接文档是给一个没有本次会话记忆的 agent 接手的——请站在它的视角，确保它能凭文档无缝继续，而不是靠猜或回翻本次会话。从第一性原理出发。', en: '/handoff Create a handoff doc from this session, written to .scratch/handoff/{ts}-<short>.md (relative to the current working directory). <short> is a brief title you give this handoff (zh ≤10 chars / en ≤20 chars, in the current session language, use hyphen or underscore instead of spaces) so a human can tell at a glance what it is about.\n\nThis doc is for an agent with no memory of this session — write from its perspective, so it can continue seamlessly without guessing or revisiting this session. Approach from first principles.' },
      "tpl.handoff2": { version: 3, placeholders: ['path'], use: '交接第二击（读交接文档）', zh: '请阅读 {path}（上一会话生成的交接文档），复述你的理解后再继续推进：\n\n## 复述理解\n- [ ] 结论：本会话已确认的决定与成果\n- [ ] 未完成事项：下一步要继续的事\n- [ ] 建议 skill：新会话接手时应加载的技能\n- [ ] 把以上三点复述给我；若有遗漏或不确定 → 先问我确认，不猜\n\n## 继续推进\n- [ ] 从第一性原理出发，继续完成未完成事项', en: 'Read the handoff doc {path} (from the previous session), restate your understanding, then continue:\n\n## Restate understanding\n- [ ] Conclusions: decisions and outcomes confirmed this session\n- [ ] Unfinished: what to continue next\n- [ ] Suggested skills: skills the new session should load\n- [ ] Restate the three points to me; if anything is missing or uncertain → ask me first, do not guess\n\n## Continue\n- [ ] From first principles, continue with the unfinished work' },
      "installSkillsFix": { version: 2, placeholders: [], use: '环境检查技能行提示（短句，避免长文刷屏；2026-08-29 审查 S1：去用户目录黑话、去"点「X」"重复指挥）', zh: '技能缺失会阻断后续流程。点「帮我安装」让 AI 按步骤操作。', en: 'Missing skills block the flow. Click "Install for me" and let AI run the steps.' },
      "installSkills": { version: 3, placeholders: ['probeList', 'probeCount'], use: '技能安装引导 · DSH 专用（横幅 / 引导 g4 / 设置页复制）· v3 #fix-banner：probeList 动态从 shared/matt-skills.js 注入（25 项）', zh: '请为 DSH 安装 Matt Pocock 的 skills 技能套件（mattpocock/skills）：\n\n1. 先检查：确认 ~/.agents/skills 下这 {probeCount} 个技能已全部就位：{probeList}。已全部就位 → 直接汇报已装技能清单并结束，不要重复安装；\n2. 有缺失则安装：优先用官方安装器 `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y`（安装器未列出 DSH，但 `-a cline` 的全局目录恰为 ~/.agents/skills，与 DSH 读取目录一致；`--copy` 用复制而非符号链接，防 npx 缓存清理后断链）；若无 npx 或安装失败，回退：克隆 https://github.com/mattpocock/skills，把 skills/engineering 与 skills/productivity 目录下的全部技能复制到 ~/.agents/skills；\n3. 安装目标是 DSH 读取的用户级技能目录：~/.agents/skills —— 不要装进其他工具的技能目录（如 ~/.claude/skills）；\n4. 安装后复验：第 1 步的 {probeCount} 个技能已全部就位；\n5. 完成后汇报安装结果与已装技能清单（用第 1 步的完整清单，不要只列 10 项）。', en: 'Install the Matt Pocock skills collection (mattpocock/skills) for DSH:\n\n1. Check first: confirm these {probeCount} skills are all present under ~/.agents/skills: {probeList}. If all are present, report the installed skill list and stop — do not reinstall;\n2. If any are missing, install: prefer the official installer `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y` (the installer does not list DSH, but `-a cline` installs globally into ~/.agents/skills — the same directory DSH reads; `--copy` copies instead of symlinking so npx cache cleanup cannot break the links); if npx is unavailable or fails, fall back: clone https://github.com/mattpocock/skills and copy all skills from skills/engineering and skills/productivity into ~/.agents/skills;\n3. Install into the user-level skill directory DSH reads: ~/.agents/skills — do not install into the skill directories of other tools (e.g. ~/.claude/skills);\n4. After install, re-verify: all {probeCount} skills from step 1 are in place;\n5. When done, report the result and the installed skill list (use the full list from step 1, not just the first 10).' },
      // #655（2026-09-19）：v12 新增布局占位符 {contextLayout} —— 用户在初始化小卡上选的域文档布局（single-context：根目录一份 CONTEXT.md / multi-context：子项目各一份 CONTEXT.md，根目录一份 CONTEXT-MAP.md）由它填空。取值来自用户选择，与后端无关，所以不放进后端 setupPrompt 键表，单独一条来源（见 setupRunParamsFrom 的 SETUP_LAYOUT_TEXT_KEYS）。两句话在 locale-panel.js 里各写中英一份。
      // #664：v13 删掉初始化全文末尾那段「仓库还没就绪就先停下」的告诫（#661 第⑧条：界面已保证过），按 #662 定的做法改中英两份词表，不在注入时截断 —— 注入的全文与声明的文本始终是同一份。
      "setupRun": { version: 13, placeholders: ['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs', 'contextLayout'], use: '环境检查横幅 · setup 未执行按钮（仅初始化记录配置，不安装/克隆技能；v13 #664 删掉初始化全文末尾那段「仓库还没就绪就先停下」的告诫（界面已保证过），GitHub 那份 backendNote 只留「本次已选后端：GitHub。」；v12 #655 新增 {contextLayout}：用户选的域文档布局，写进 docs/agents/domain.md 与用户仓库 AGENTS.md 的 ## Agent skills 块；v11 #619 删掉 v10 加的那条「标签调色盘」注入通道：标签颜色改由插件自己放置的配色文件与面板改色弹窗负责，初始化注入不再教人去建那张已经没人读的表；labelReqs=按后端的标签要求条款，Markdown 为空即不要求标签齐全）', zh: '/setup-matt-pocock-skills\n\n初始化本仓库配置（技能套件已安装；本命令仅记录 issue tracker / 标签词汇 / 文档路径，不安装、不克隆任何技能）：\n1. 按技能流程选择 issue tracker：{trackerLine}，由用户确认；\n2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 {trackerChoice}；triage 标签保留默认五角色）{labelReqs}；后续打标签严格遵循技能规则，不额外强制任何标签；\n3. 完成后核对技能真实产物：docs/agents/issue-tracker.md + triage-labels.md + domain.md 及 AGENTS.md 的 ## Agent skills 块；再复查环境检查（setup 变绿）。{contextLayout}。{backendNote}', en: '/setup-matt-pocock-skills\n\nBootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths — it does not install or clone any skills):\n1. Follow the skill flow to pick the issue tracker: {trackerLine}, confirm with the user;\n2. During init, follow the setup-matt-pocock-skills skill own flow (choose {trackerChoice} as the tracker; keep the default triage-role labels){labelReqs}; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;\n3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green). {contextLayout}.{backendNote}' },
      "switchAlign": { version: 1, placeholders: ['from', 'to'], use: '切换后端（工作区已经初始化过）· 注入一条「把仓库里记录后端的那几处对齐到新后端」的指令（#669 第 6 件 / ADR 20260921）。与 setupRun 是两件事：setupRun 说「还没初始化，去初始化」，这一条说「已经初始化了，只是换了后端，把记录对齐」。历史上 #191～#511 切换注入的是 setupRun 本身（等于切一次就把初始化重跑一遍，#664 因此整段撤掉）；2026-09-21 按场景拆开：未初始化走 setupRun（与黄条同一条），已初始化走这一条。{from}/{to} = 切换前/后的后端标签。', zh: '/setup-matt-pocock-skills\n\n本工作区的 issue tracker 后端已由用户在面板上从 {from} 切换为 {to}（切换方式：保留 —— 原有数据仍留在 {from}，切回可见）。\n请按 setup-matt-pocock-skills 技能的规则，把这个仓库里记录后端的那几处对齐到 {to}：\n1. docs/agents/issue-tracker.md 里记录 issue tracker 的那一行（或那一段），改成 {to}；\n2. docs/agents/domain.md 与 AGENTS.md 的 ## Agent skills 块里与 issue tracker 相关的行，一并对齐到 {to}；\n3. 改完回读 docs/agents/issue-tracker.md，确认记录后端那一处确实是 {to}，把那一行原文抄给我；并列出这次改了哪几个文件、每个文件改了哪几行。\n不要重跑初始化，不要重建已有的产物（CONTEXT.md、triage-labels 等），也不要在 {to} 这边新建任何目录或骨架。', en: '/setup-matt-pocock-skills\n\nThe issue-tracker backend for this workspace was just switched by the user in the panel from {from} to {to} (mode: keep — existing data stays in {from} and becomes visible again if you switch back).\nFollowing the setup-matt-pocock-skills skill rules, align the places in this repo that record the backend to {to}:\n1. In docs/agents/issue-tracker.md, change the line (or section) that records the issue tracker to {to};\n2. Align the issue-tracker-related lines in docs/agents/domain.md and in the ## Agent skills block of AGENTS.md to {to};\n3. When done, read docs/agents/issue-tracker.md back, confirm that the recorded backend really is {to}, quote that line to me, and list which files you changed and which lines in each.\nDo not re-run the setup, do not rebuild existing artifacts (CONTEXT.md, triage-labels, ...), and do not create any directory or skeleton on the {to} side.' },
      "newWayfinder": { version: 14, placeholders: ['repo','subIssue'], use: '「+ 新建需求」按钮 · 清单式（A★）', zh: '/wayfinder\n请帮我处理一个需求（严格遵循 wayfinder 技能规则）。\n仓库（已自动填入当前工作区）：{repo}\n\n## 澄清\n- [ ] 对目标 / 范围 / 偏好有假设时，先用 grilling 技能澄清，不默认\n\n## 判断分类（先查仓库已有 wayfinder:map 和 issue，确认是否做过）\n- [ ] 新增：全新需求 → 新建 map\n  - [ ] 写出 map：Destination + Notes + plan\n  - [ ] 先读回该 map 的正文（里面必须保留 `## Destination` 一节），改好任务清单后再调 {subIssue}\n  - [ ] 关联到该 map 的每个 ticket 都由建边工具落原生边并自己校验数量；仅当后端明确不支持原生边时才回退到任务清单 + Part of\n  - [ ] 阻塞关系以建边工具落的原生依赖边为准；正文里的 `Blocked by: #<n>` 行只作降级兜底\n- [ ] 复用：这个需求之前已做过（已有 map / issue）→ 打开复用它，不重复建\n- [ ] 直接实现：需求很小 → 建一个 issue 直接实现，不建大 map\n\n## 自查（对检查清单做检查）\n- [ ] 逐项核对上面每个 `- [ ]`：是否已落实、无遗漏；漏项补上，不跳过\n- [ ] 校验：看建边工具与地图快照的返回值里「建了几条、读回来几条」是否对得上（对不上工具会如实说，不要当成成功），且面板列表的 `closed/total` 不为 0/0（有子票时）\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行）\n', en: '/wayfinder\nPlease handle a requirement (strictly follow the wayfinder skill rules).\nRepo (auto-filled from current workspace): {repo}\n\n## Clarify\n- [ ] If you hold assumptions about the goal / scope / preferences, settle them with the grilling skill — never assume\n\n## Decide the case (check existing wayfinder:map and issues first)\n- [ ] Add: a brand-new requirement → build a new map\n  - [ ] Write the map: Destination + Notes + plan\n  - [ ] First fetch the map current body into a file (the file must keep the `## Destination` section), edit the task list, then call {subIssue}\n  - [ ] The edge-wiring tool creates the native edges for every ticket under this map and checks the count itself; only fall back to task list + Part of when the backend explicitly has no native edge\n  - [ ] Blocking comes from the native dependency edges the edge-wiring tool creates; a `Blocked by: #<n>` line in the body is only the fallback\n- [ ] Reuse: this requirement has been done before (existing map / issue) → open and reuse it, do not build a new one\n- [ ] Directly implement: the requirement is small → create a single issue and implement it directly, no big map\n\n## Self-check (verify the checklist)\n- [ ] Go through every `- [ ]` above: confirmed done, no gaps; fill anything missed, do not skip\n- [ ] Verify: the edge-wiring tool and the map snapshot return values agree on how many edges were wired and how many read back (a mismatch is reported plainly — never treat it as success) and the panel list `closed/total` is not 0/0 when tickets exist\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours, as long as a human can read it)\n' },
      "newBugWayfinder": { version: 5, placeholders: ['repo'], use: '「+ 新增BUG单」按钮 / 状态栏 BUG 悬停菜单「新增」（issue #4 · v2 修 #1 BUG3：输入位移到末尾 · v3 #14：精简为 4 字段 · v4 #63：去内部规则+实际→期望+括号单行 · v5 #475：补标签要求 bug 必带+未诊断带 needs-triage，分远端原生/本地标签行）', zh: '/wayfinder\n请帮我新增一个 BUG 单（按 wayfinder 技能规则处理）。\n仓库：{repo}\n新建的单子必须带上 bug 标签；如果还没有经过诊断，同时带上 needs-triage 标签。远端后端按原生标签方式打标签，本地 Markdown 后端在正文加标签行（例如 Labels: bug, needs-triage）。', en: '/wayfinder\nPlease help me file a new BUG ticket (follow the wayfinder skill rules).\nRepo: {repo}\nNew tickets must carry the bug label; if not yet triaged, also carry needs-triage. On remote backends use native labels; on the local Markdown backend add a Labels line (e.g. Labels: bug, needs-triage).' },
      "ghAuthLogin": { version: 2, placeholders: ['cli', 'cliBrand'], use: '登录引导 · 链失败态 inject-prompt（#228 替换 openUrl 硬编码，动作不承诺修复，检查才判定；#716：文案里不留任何具体命令 —— {cli} = 当前后端自己的命令行名，{cliBrand} = 当前后端报的站点名，两个值都由后端声明注入）', zh: '请为本机完成 {cliBrand} 登录（{cli} auth login）：\n\n1. 终端执行 {cli} auth login\n2. 按向导选择 {cliBrand} → HTTPS → Yes → 浏览器授权（OAuth）\n3. 完成后执行 {cli} auth status 验证已登录\n4. 回到面板点「重新检查」或等待自动重查，链条将自动推进\n5. 若遇网络/代理问题，请检查 {cli} 自己的配置与网络后重试', en: 'Please complete the {cliBrand} login ({cli} auth login):\n\n1. Run {cli} auth login in terminal\n2. Choose {cliBrand} → HTTPS → Yes → browser OAuth\n3. Verify with {cli} auth status\n4. Click "Re-check" at the top of the panel, or wait for auto re-check; the chain will advance via re-evaluation\n5. If network/proxy issues, check the {cli} configuration and retry' },
            "mapInspect": { version: 6, placeholders: ['n', 'title', 'url', 'subIssue'], use: 'map 空态 0/0 检查 · 诊断关联缺失', zh: '## 目标 map\n- 编号：#{n}\n- 标题：{title}\n- 链接：{url}\n\n该 map 在面板中显示为 0/0（无子议题），这不正常——按 wayfinder 规则，有规划的 map 应通过子议题推进，0/0 通常意味着创建时子议题没有以本后端的原生父子关系正确关联到该 map。\n\n请按 wayfinder 技能排查并修复关联（遵循其规则）：\n\n## 排查\n- [ ] 加载 wayfinder 技能（如未加载），结合该 map 的 Destination / Notes 回顾本应有哪些子议题\n- [ ] 在当前后端中核对这些子议题是否已存在但未成为该 map 的真正子议题（面板计数仍 0/0、详情未展示）\n\n## 修复\n- [ ] 先读回该 map 的正文（里面必须保留 `## Destination` 一节），再按本后端声明的关联方式把子议题建成该 map 的子议题：{subIssue}\n- [ ] 若子议题尚未创建，按原规划创建后，用同一种关联方式补建\n- [ ] 修复后按上面的校验方式核对子议题数量与预期一致，并确认面板中该 map 的计数不再是 0/0，详情页能看到完整子议题列表且阻塞关系正确\n\n## 收尾\n- [ ] 结束前把这张票的真实状态写进正文（写法你定，人能看懂就行）\n- [ ] 校验子议题数与面板计数一致，且不再为 0/0', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}\n\nThis map shows 0/0 (no sub-issues) in the panel, which is abnormal — a planned map is expected to advance via sub-issues. 0/0 typically means the sub-issues were not wired as native sub-issues of this map when it was created.\n\nPlease investigate and fix the wiring per the wayfinder skill (follow its rules):\n\n## Investigate\n- [ ] Load the wayfinder skill (if not loaded) and review Destination / Notes to recall what sub-issues were intended\n- [ ] Check whether those sub-issues already exist but are not showing as true sub-issues of this map (count still 0/0, not listed in detail)\n\n## Fix\n- [ ] First fetch the map current body into an absolute-path file (keep the `## Destination` section), then wire the sub-issues to this map the way this backend declares: {subIssue}\n- [ ] If the sub-issues do not exist yet, create them per the original plan, then wire them the same way\n- [ ] After fixing, verify the sub-issue count matches the way stated above, and that the panel count is no longer 0/0 and the detail page lists all sub-issues with correct blocking\n\n## Wrap-up\n- [ ] Before finishing, write the true state of this ticket into its body (wording is yours, as long as a human can read it)\n- [ ] Verify sub-issue count matches the panel count and is no longer 0/0' },
                  "healthCheck": { version: 1, placeholders: ['subject'], use: '「体检」按钮 · 所有后端共用的总纲（游离票归位：先出建议清单、人点头才动手）；后端自己的科目由后端声明、经 {subject} 填空', zh: '## 体检（把游离的开放票归位）\n\n这次体检的范围是**整个仓库的开放票**（不跟随面板当前的筛选）：把游离的票找出来，给你一份建议清单，你点头之后才动手。\n\n### 一、什么算游离\n\n三条结构事实同时成立才算：**票未关闭**、**票自己不是地图**、**票没有父票**（不在任何地图的子票里——与列表里「独立票」的显示同一个口径）。\n\n**不按标签排除**：写着等人动手、写着不做打算的票同样算游离。标签只在报告里用来分区。\n\n在此之上再对每张游离票判一句「这张是不是明确可以单张票处理掉的」：是的话也可以不管它——不挂图、留在原地，只在报告里登记一行并写明理由。\n\n### 二、只做两件结构动作\n\n1. 建原生子议题边：把票挂到合适的地图下。\n2. 为人点过头的票开一张新地图。\n\n**一律不碰**：已关闭的票、任何票的标题与正文、标签与认领状态、别的仓库；不关闭任何票、不删评论、不改源码、不发版、不提交。清单里凡是要动其中任何一项的，都不做，改成写进建议里等人处理。\n\n### 三、交付形态：先出建议清单，等人点头才动手\n\n清单必须写清每条结论：\n\n- 这张票 → 挂到哪张地图下 + 一句话理由；\n- 这张票 → 建议自立成一张新地图 + 一句话理由；\n- 这张票 → 建议留在原地不动 + 一句话理由。\n\n写完之后停下来等点头。**不要自动往票上写评论**：动手本身留下的原生边就是留痕。\n\n### 四、挑地图的判据\n\n由你读每张地图的 Destination 与 Notes 做语义归类，给出「挂到哪张 + 一句话理由」。**挑不出唯一一张就列 2 到 3 个候选让人选，不硬选**；一张地图都装不下，就按第三节建议自立成地图（只写最小的 Destination 草稿，正文由维护者或负责人补，不设数量门槛）；连自立成图也不成立，就建议留在原地并写明理由。\n\n### 五、当前后端自己的科目\n\n{subject}', en: '## Health check (put orphaned open tickets where they belong)\n\nThis health check covers **every open ticket in the whole repository** (it does not follow the current panel filters): find the orphaned ones, and hand me a suggestion list — act only after I nod.\n\n### 1. What counts as orphaned\n\nAll three structural facts must hold: **the ticket is not closed**, **the ticket is not itself a map**, and **the ticket has no parent** (it is not a sub-ticket of any map — the same rule the list uses for the "standalone ticket" display).\n\n**Do not exclude by label**: tickets marked as waiting for a human, or marked as not planned, still count as orphaned. Labels are only used to group the report.\n\nOn top of that, judge each orphaned ticket with one sentence — "is this clearly something a single ticket can finish?" If yes, you may also leave it alone: do not attach it to a map, keep it where it is, and just log one line with the reason in the report.\n\n### 2. Only two structural actions\n\n1. Create a native sub-ticket edge: attach the ticket under a suitable map.\n2. Open a new map, for a ticket the human has nodded on.\n\n**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close any ticket, delete comments, change source code, publish a release, or commit. Anything in the list that would touch one of those is not done — it goes into the suggestions for a human instead.\n\n### 3. Deliverable: a suggestion list first — act only after the human nods\n\nThe list must state each conclusion:\n\n- this ticket → attach under which map + a one-sentence reason;\n- this ticket → suggest a new map of its own + a one-sentence reason;\n- this ticket → suggest leaving it where it is + a one-sentence reason.\n\nThen stop and wait for the nod. **Do not automatically write comments on tickets**: the native edges left by the structural actions are the record.\n\n### 4. How to pick the map\n\nRead each map Destination and Notes yourself and group by meaning, giving "attach under this one + a one-sentence reason". **If no single map is clearly right, list 2 to 3 candidates for the human to choose — do not force one**; if no map can hold it, suggest a new map per section 3 (write only the minimal Destination draft, let the maintainer or owner fill in the body, no count threshold); if even that does not hold up, suggest leaving it where it is and state why.\n\n### 5. The subject of this backend\n\n{subject}' },
      "switchLayout": { version: 1, placeholders: ['from', 'to'], use: '切换后端时用户在布局小卡上改了域文档布局 · 注入一条「把仓库里记录布局的那一处对齐到新结论」的指令（#698）。为什么要有它：布局那份答案改过之后，此前没有任何人照它改文件 —— 仓库里 docs/agents/domain.md 与 AGENTS.md 里那句结论会与插件记住的答案悄悄分成两半，下一轮读到的还是旧布局。与 switchAlign 是配套的两条：那一条管后端、这一条管布局，各改各的那一句，都不重跑初始化。{from}/{to} = 改之前/之后那一项的人话说法（根目录一份 CONTEXT.md / 子项目各一份 CONTEXT.md，根目录 CONTEXT-MAP.md）。', zh: '/setup-matt-pocock-skills\n\n本工作区的域文档布局已由用户在面板上从「{from}」改为「{to}」。\n请按 setup-matt-pocock-skills 技能的规则，把这个仓库里记录布局的那几处对齐到新结论：\n1. docs/agents/domain.md 里写布局的那一句，改成「{to}」这一结论（技能要求的写法是「一行布局摘要 ＋ See docs/agents/domain.md」）；\n2. AGENTS.md 的 ## Agent skills 块里 Domain docs 那一行，用同一个词对齐过去；\n3. 改完回读这两处，把改完的那两行原文抄给我，并列出这次改了哪几个文件、每个文件改了哪几行。\n不要重跑初始化，不要重建任何已有的产物（CONTEXT.md、CONTEXT-MAP.md、triage-labels 等），也不要为了这次改动新建目录或骨架 —— 布局结论变了不等于要立刻把新布局下的文件都建出来。', en: '/setup-matt-pocock-skills\n\nThe domain-doc layout for this workspace was just changed by the user in the panel from "{from}" to "{to}".\nFollowing the setup-matt-pocock-skills skill rules, align the places in this repo that record the layout to the new conclusion:\n1. In docs/agents/domain.md, change the line that records the layout to the "{to}" conclusion (the skill’s required form is "a one-line layout summary + See docs/agents/domain.md");\n2. In the ## Agent skills block of AGENTS.md, align the Domain docs line to the same wording;\n3. When done, read both places back, quote those two lines to me, and list which files you changed and which lines in each.\nDo not re-run the setup, do not rebuild any existing artifacts (CONTEXT.md, CONTEXT-MAP.md, triage-labels, ...), and do not create directories or skeletons for this change — a changed layout conclusion does not mean every file under the new layout must be created right now.' },
    }
    // 当前语言（跟随 DSH locale 快照 active；缺省 zh）
    export const promptLang = function () {
      try {
        const l = (localeSvc && typeof localeSvc.getSnapshot === 'function') ? localeSvc.getSnapshot().active : null
        return (l === 'en' || String(l || '').indexOf('en') === 0) ? 'en' : 'zh'
      } catch (e) { return 'zh' }
    }
    // #716：命令行名字与站点名字（模板里的 {cli} / {cliBrand}）不该写死在提示词里 —— 它们跟具体后端绑在一起。
    //   唯一的来源是后端的 prompts.commandVocabulary 声明（GitHub 上是 gh / GitHub，GitLab 上是 glab / GitLab）；
    //   后端没声明时用中性说法兜底，所以模板里的 {cli} 永远不会被原样注入会话。
    export const VOCABULARY_DEFAULT = { cli: '当前后端的命令行', cliBrand: '当前跟踪器' }
    // 取当前后端的词表（模块数组 + 后端 id）；缺声明或声明不完整时逐格回落中性说法。
    export const vocabularyParamsFrom = function (modules, backendId) {
      const out = Object.assign({}, VOCABULARY_DEFAULT)
      try {
        const v = backendPromptFrom(modules, backendId, 'commandVocabulary')
        if (v && typeof v === 'object') {
          if (typeof v.cli === 'string' && v.cli) out.cli = v.cli
          if (typeof v.cliBrand === 'string' && v.cliBrand) out.cliBrand = v.cliBrand
        }
      } catch (e) {}
      return out
    }
    // 取 prompt：promptText(id) 或 promptText(id, { 占位符: 值 })
    // #716：词表那几个名字即使没人传值，也落中性说法，绝不把 {cli} 这样的占位符原样注入会话。
    export const promptText = function (id, params) {
      const p = PROMPTS[id]
      if (!p) return ''
      let s = (promptLang() === 'en' && p.en) ? p.en : (p.zh || '')
      const vals = Object.assign({}, params || {})
      Object.keys(VOCABULARY_DEFAULT).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(vals, k)) vals[k] = VOCABULARY_DEFAULT[k]
      })
      s = s.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : m })
      return s
    }
    // #230（D10 · 2026-08-28 生效）setupRun 后端描述数据（键入 locale 方案定版）：
    // 旧 setupTrackerLine/setupTrackerChoice/setupBackendNote 三函数（client 内 backendId 分支硬编码双语值）删除；
    // 后端模块经 BackendModule.setupPrompt 声明「locale 键名」，wf.registry 转发到 st.backendModules，此处只做 键→值 解析与占位符填充 —— client 零 backendId 分支。 #619（2026-09-13 生效）：v10 的 paletteNote 占位符连同「标签调色盘」那节注入文案一并删除 ——
    //   标签颜色改由插件自己放的配色文件（工作区里的 docs/agents/label-colors.json）与面板改色弹窗负责， 初始化注入不再引导任何人去建那张已经没人读的表；四个占位符一律由后端声明数据填充。
    export const SETUP_DEFAULT_PROMPT_KEYS = {
      trackerLine: 'setup.default.trackerLine',
      trackerChoice: 'setup.default.trackerChoice',
      backendNote: 'setup.default.backendNote',
      labelReqs: 'setup.default.labelReqs',
    }
    // #655：域文档布局的取值与后端无关，单独一条来源（不塞进上面的后端键表）。
    //   两个取值与卡片上那两个选项一一对应；缺省取 single —— 等值于卡片默认选中的那一项。
    export const SETUP_LAYOUT_TEXT_KEYS = { single: 'setup.layout.single', multi: 'setup.layout.multi' }
    export const SETUP_LAYOUT_DEFAULT = 'single'
    // 会话状态里读这次选的布局；没选过（或值不认识）→ null，由调用处决定是「先问」还是「按缺省走」。
    export const normalizeSetupLayout = function (v) {
      const t = String(v == null ? '' : v).toLowerCase()
      return (t === 'single' || t === 'multi') ? t : null
    }
    export const readSetupLayout = function (st) { try { return normalizeSetupLayout(st && st.setupLayout) || normalizeSetupLayout((typeof getCachedSetupLayout === 'function') ? getCachedSetupLayout(st && st.cwd) : null) } catch (e) { return null } } // 2026-09-21：会话里没答过就沿用这个工作区记住过的那一份（按工作区持久化，见 store-prefs.js；两份都过一遍取值校验，不认识的取值一律当没答过）
    // 纯函数：modules = wf.registry modules 数组（元素可带 setupPrompt 键表）；dictOverride 供单测直喂 locale 字典（单测不依赖闭包 L）
    // layout 是用户这次选的布局（'single' / 'multi'）；没选过一律按缺省 single 填 —— 这条是兜底，
    //   正常路径由注入决策函数先把用户拦在卡上（见 setupOrRepoPrompt 的 'setup-card' 那一档）。
    export const setupRunParamsFrom = function (modules, backendId, dictOverride, layout) {
      const list = Array.isArray(modules) ? modules : []
      let m = null
      for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(backendId)) { m = list[i]; break } }
      const declared = (m && m.setupPrompt) || SETUP_DEFAULT_PROMPT_KEYS
      let dict = dictOverride || null
      if (!dict) { try { dict = (typeof L !== 'undefined' && L && L[promptLang()]) ? L[promptLang()] : null } catch (e) {} }
      const out = {}
      ;['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs'].forEach(function (k) {
        try { out[k] = (dict && dict[declared[k]] != null) ? String(dict[declared[k]]) : '' } catch (e) { out[k] = '' }
      })
      const lk = SETUP_LAYOUT_TEXT_KEYS[normalizeSetupLayout(layout) || SETUP_LAYOUT_DEFAULT]
      try { out.contextLayout = (dict && dict[lk] != null) ? String(dict[lk]) : '' } catch (e) { out.contextLayout = '' }
      return out
    }
    // UI 统一入口：显式 backendId 优先（绑定/切换流程）；否则当前 selection；再无 → 缺省键组。所有注入路径一律走这里。
    // 2026-08-28 修复“未指定”回退：显式选择已落在 host + localStorage selectionByCwd，但 prompt 之前只读 s.selection（单会话乐观），
    // 新会话/快照未水合时为 null 导致永远 default。现按权威链 s.selection → snapshot.selection → getCachedSelection(cwd) 取 id，保持 UI 零硬编码。
    // #655：layout 由调用处显式传入（会话状态里的用户选择），不在这里自己读 —— 决策函数与注入路径已把「选没选」判过了。
    export const setupRunPrompt = function (st, backendId, layout) {
      let sel = null
      try {
        if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
        else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
        else if (st && st.cwd && typeof getCachedSelection === 'function') { const cs = getCachedSelection(st.cwd); if (cs && cs.backendId != null) sel = cs.backendId }
      } catch {}
      const id = backendId != null ? backendId : sel
      return promptText('setupRun', setupRunParamsFrom(st && st.backendModules, id, null, layout))
    }
    // 绑定成功后的注入决策（数据驱动，UI 零品牌分支）。
    // #661（首开引导链定版）与 #662（规格「定版二」第 3 条）把这一档改成「仓库没就绪就一个字都不注入」：
    //   判据不再看后端的能力位，改看共享清单 src/shared/tracker/guide-steps.js 里当前后端有没有一步标着
    //   blocksSetup 而它没过（读链快照，与状态栏那条横幅同一个口径）。「缺仓库时改发一段建仓长文」
    //   那条 #496 的老行为到此结束 —— 缺仓库这件事由界面上那一段负责（状态栏「还没有远端仓库」那条横幅
    //   与检查页那一行的两步建仓弹窗），注入这条路不再多给一份说明。
    //   返回 { kind: 'setup' | 'blocked', text, layout }；blocked 时 text 是空串（调用处一个字都不注入）。
    //   失败一律回落旧行为。日志只记分支不记隐私。
    // 链快照里的步骤：与状态栏那条横幅同一口径（界面只读宿主发下来的快照，不自己算状态）。
    const setupChainSteps = function (st) {
      try { if (typeof chainSteps === 'function') return chainSteps(st) } catch (e) {}
      try { return (st && st.chainSnapshot && Array.isArray(st.chainSnapshot.steps)) ? st.chainSnapshot.steps : [] } catch (e2) { return [] }
    }
    // 清单里这个后端有没有一步标着 blocksSetup 而它没过（没过 = 那一步的检查项在链快照里不全是 done）。
    export const setupBlockedByGuide = function (st, backendId) {
      try {
        if (typeof guideStepsFor !== 'function' || typeof guideStepDone !== 'function') return false
        let sel = backendId
        if (sel == null && typeof currentBackendId === 'function') sel = currentBackendId(st)
        const steps = guideStepsFor(sel)
        const snapshot = setupChainSteps(st)
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]
          if (!step || step.blocksSetup !== true) continue
          if (!guideStepDone(step, snapshot)) return true
        }
        return false
      } catch (e) { return false }
    }
    export const setupOrRepoPrompt = function (st, backendId) {
      const decLayout = readSetupLayout(st) || SETUP_LAYOUT_DEFAULT
      const setupText = function () {
        try { return (typeof setupRunPrompt === 'function') ? setupRunPrompt(st, backendId, decLayout) : '' } catch (e) { return '' }
      }
      try {
        let sel = backendId
        try {
          if (sel == null) {
            if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
            else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
          }
        } catch (e) {}
        const blocked = setupBlockedByGuide(st, sel)
        try { console.log('[MattSkillsDeck] setup-inject decision blocked=' + (blocked ? '1' : '0') + ' layout=' + (readSetupLayout(st) || 'unset')) } catch (e) {}
        if (blocked) return { kind: 'blocked', text: '', layout: decLayout }
      } catch (e) {
        try { console.warn('[MattSkillsDeck] setup-inject decision fallback: ' + String((e && e.message) || e).slice(0, 120)) } catch (_) {}
      }
      return { kind: 'setup', text: setupText(), layout: decLayout }
    }
    // 注入这条路只有一份判据：kernel/prompts-setup.js 的 injectSetupDecision。
    //   几条入口（状态栏黄条那颗按钮、检查页红牌那颗「执行初始化」按钮、面板「切换后端」那条路）都汇聚在它上面，
    //   本文件里没有第二份。#698 把它连同 opts 各选项的含义（allowCard / askLayout / injectNow / source）
    //   与「该不该先弹那张布局小卡」的判据一起搬去了那个文件 —— 本文件贴着 350 行上限。
    // #664：检查页那颗「执行初始化」按钮点下去该注入什么：给文字 = 初始化全文；null = 这次确实什么都不该注入
    //   （仓库那一步还没过、或者该先弹那张布局小卡）。null 与空串是两件事 —— 空串是「解析不出来」，那条路上
    //   分发器会按 action.prompt 原样注入（现场实测：不给文字却走那条兜底，会把键名 setupRun 当文案塞进会话）。
    export const setupRunTextForClick = function (st) {
      try {
        if (typeof injectSetupDecision !== 'function') return (typeof setupRunPrompt === 'function') ? setupRunPrompt(st) : null
        const kind = injectSetupDecision(st, undefined, { injectNow: false, allowCard: true })
        if (kind !== 'setup') return null
        return (typeof setupRunPrompt === 'function') ? setupRunPrompt(st) : ''
      } catch (e) { return null }
    }
    // Q2 #496：建仓成功处消费标记，补发一次初始化全文（标记按工作区键核对，不跨区）。
    // #655：这条路径没有界面可弹卡，所以不传 allowCard —— 沿用会话里已选的布局，没选过就按缺省布局填（用户故事 13）。
    // #664：会置真那个标记的缺仓档已按新流程退役（见 injectSetupDecision 里的说明），今天没有任何一处把它置真，
    //   这条补发路径因此走不到；本票不动它，理由与那里同一条。
    export const consumePendingSetup = function (st) {
      try {
        if (st && st.pendingSetupAfterPublish && (!st.pendingSetupCwd || st.pendingSetupCwd === st.cwd)) {
          st.pendingSetupAfterPublish = false; st.pendingSetupCwd = ''
          const kind = (typeof injectSetupDecision === 'function') ? injectSetupDecision(st, undefined, undefined) : ''
          if (kind === 'setup') {
            try { console.log('[MattSkillsDeck] setup-inject reissued after repo ready (once)') } catch (e) {}
            return true
          }
        }
      } catch (e) {}
      return false
    }
    // v13 新增：newWayfinder 后端无关片段注入（与 setupRun 同构，UI 零分支）
    export const NEW_WAYFINDER_DEFAULT_WIRING = {
      zh: '通过 Tracker 原生的父子关系关联（create 时带 parentKey 或创后 setParent）',
      en: 'via Tracker native parent relation (create with parentKey or setParent after creation)'
    }
    export const newWayfinderParamsFrom = function (modules, backendId, dictOverride) {
      const list = Array.isArray(modules) ? modules : []
      let m = null
      for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(backendId)) { m = list[i]; break } }
      const wiringObj = (m && m.prompts && m.prompts.subIssue) || NEW_WAYFINDER_DEFAULT_WIRING
      let dict = dictOverride || null
      if (!dict) { try { dict = wiringObj } catch (e) {} } else dict = wiringObj
      const lang = promptLang()
      // #595：先按当前语言取；只声明了另一种语言时就回落另一种语言，最后才落通用默认（整节不许静默消失）
      const subIssue = declaredLangPick(dict, lang) || declaredLangPick(NEW_WAYFINDER_DEFAULT_WIRING, lang)
      return { subIssue }
    }
    // 当前后端 id：st.selection → snapshot.selection → 按工作区缓存（**只在宿主还没回过任何一次之前**），三档都取不到就 null。#683（F1 · ADR 的 R6b）：第三档读的是本地那份镜像，而本次裁决把它降级成「本壳的临时镜像」（权威在宿主侧那份记录里），所以这道前提必须留着 —— 只有一份快照都还没有（宿主一次都没回过话）时才拿它垫一下（免得刷新页面先闪「还没有设置」）；宿主一旦回过话（哪怕回的是「这个工作区没有后端」）就以宿主的答复为准。
    export const currentBackendId = function (st) {
      let sel = null
      try {
        if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
        else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
        else if (!(st && st.snapshot) && st && st.cwd && typeof getCachedSelection === 'function') { const cs = getCachedSelection(st.cwd); if (cs && cs.backendId != null) sel = cs.backendId }
      } catch (e) {}
      return sel
    }
    // 按后端查一条声明文本（{zh,en}）；后端没声明该键返回 null
    export const backendPromptFrom = function (modules, backendId, key) {
      try {
        const list = Array.isArray(modules) ? modules : []
        for (let i = 0; i < list.length; i++) {
          const m = list[i]
          if (m && String(m.id) === String(backendId) && m.prompts && m.prompts[key]) return m.prompts[key]
        }
      } catch (e) {}
      return null
    }
    // 按语言取一条后端声明文本：先取当前语言；当前语言没写就回落到另一种语言
    //   （后端只声明一种语言时，整节不许静默消失成空串）
    export const declaredLangPick = function (dict, lang) {
      try {
        if (!dict || typeof dict !== 'object') return ''
        const want = (lang === 'en') ? dict.en : dict.zh
        const other = (lang === 'en') ? dict.zh : dict.en
        const t = (want != null && want !== '') ? want : other
        return (t == null) ? '' : String(t)
      } catch (e) { return '' }
    }
    // #684：渲染参数 —— 注册表里的 {subIssue} / {subject} 都按当前后端解析填入，模板只留占位符名。
    //   {subject} 取后端在 prompts.healthCheck 里声明的体检科目；后端没声明该键时是空串（总纲照旧完整）。
    //   取这三行值都用本文件里的查表函数、不跨文件调用：本文件这一段会被门禁单独求值校验（门禁的渲染面）。
    export const backendParamsFor = function (st, params) {
      const p = Object.assign({}, params || {})
      if (!Object.prototype.hasOwnProperty.call(p, 'subIssue')) p.subIssue = newWayfinderParamsFrom(st && st.backendModules, currentBackendId(st)).subIssue
      if (!Object.prototype.hasOwnProperty.call(p, 'subject')) p.subject = declaredLangPick(backendPromptFrom(st && st.backendModules, currentBackendId(st), 'healthCheck'), promptLang())
      // #716：{cli} / {cliBrand} 由当前后端的词表声明填 —— 模板里一个命令行名字都不写死。
      const vocab = vocabularyParamsFrom(st && st.backendModules, currentBackendId(st))
      Object.keys(vocab).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(p, k)) p[k] = vocab[k] })
      // #684：只替换一遍不够 —— 后端那条科目文本（{subject} 的值）里还会引用别的占位符（GitHub 用它引出
      //   {subIssue} 那段原生关联文本），不补这一遍就会把嵌套占位符原样注入会话。只补 {subject} 这一个值就够。
      p.subject = String(p.subject).replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m })
      return p
    }
    // 按当前后端渲染一条 prompt（正文格式/子议题关联方式由后端声明注入口）
    export const promptTextFor = function (st, id, params) { return promptText(id, backendParamsFor(st, params)) }
    export const newWayfinderPrompt = function (st, backendId) {
      const id = backendId != null ? backendId : currentBackendId(st)
      const params = Object.assign({ repo: (typeof repoUrlFor === 'function' ? repoUrlFor(st) : (st && st.repo ? String(st.repo) : '')) }, newWayfinderParamsFrom(st && st.backendModules, id))
      return promptText('newWayfinder', params)
    }
    // v1.5 T4/T5：Matt 技能仓库（介绍卡 GitHub 链接）
    export const MATT_REPO = 'https://github.com/mattpocock/skills'
    export const MAP_EXECUTE_PROMPT = function (st) { return promptTextFor(st, 'mapExecute') }
    export const COMPLETE_PROMPT = function (st) { return promptTextFor(st, 'complete') }
    // v4（#63 grilling 定版 2026-08-20）：去 wayfinder 内部规则复述（#63 想法1：prompt 不含已知规则；当时靠一条「按后端填空的正文格式契约」承担与命令行的解耦，那条契约已在 #725 整节删除）+ 字段集 4 项顺序实际→期望→复现→环境 + 形态括号单行（想法2：字段名（说明）：冒号即填，无悬行例行）
    //   字段集（第一性原理：Bug = 实际 vs 期望偏差，实际先于期望）：实际（吸收现象+影响范围）/ 期望 / 复现步骤（吸收背景+场景 preamble）/ 环境信息；zh 只中文、en 只英文，跟随 DSH 语言一次只出一种
    export const NEW_BUG_FIELDS_BODY = function () { return '\n\n实际（看到什么；可含影响范围）：\n期望（应发生什么 / 预期结果）：\n复现步骤（[前置 / 场景] + 编号步骤）：\n环境信息（OS + 浏览器 + 插件版本）：' }
    export const NEW_BUG_FIELDS_BODY_EN = function () { return '\n\nActual (what happened; may include impact):\nExpected (what should happen / expected result):\nReproduction ([Preamble / Scenario] + numbered steps):\nEnvironment (OS + browser + plugin version):' }
    // v5（#77 grilling 定版 2026-08-21）：mapHead 自包含化 —— 标识头三字段内联 complete 顶部，completePrompt 补 title 参数并填 {n}/{title}/{url}
    export const completePrompt = function (st, num, title, total, closed) {
      const url = issueUrlFor(st, String(num || '')) // #231：后端声明模板单源；元数据未达即空（诚实缺形态）
      return '/wayfinder ' + url + '\n\n' +
        COMPLETE_PROMPT(st).split('{n}').join(String(num || '')).split('{title}').join(String(title || '')).split('{url}').join(url).split('{total}').join(String(total)).split('{closed}').join(String(closed))
    }
    export const inspectPrompt = function (st, num, title) {
      const url = issueUrlFor(st, String(num || ''))
      return '/wayfinder ' + url + '\n\n' + promptTextFor(st, 'mapInspect', { n: String(num || ''), title: String(title || ''), url: url })
    }
    export const FIXATE_PROMPT = function (st) { return promptTextFor(st, 'fixate') }

