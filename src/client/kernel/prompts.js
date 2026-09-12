/**
 * src/client/kernel/prompts.js — 内核模块（阶段 2 内核迁移 · #96 T3）
 *
 * 契约：本文件为模块真源（ESM 导出）；scripts/build.mjs 在构建时去掉每行行首
 * export 关键字，把声明体文本拼回 src/client/index.js 的拼接标记处（apply 闭包内
 * 原位），与 ctx.js/seam 同模式，一源两物，src 零复制。
 * 接口冻结清单见 docs/architecture/kernel-contract.md（G3 · #91 拍板）。
 * 单源新架构：真源 src/client/kernel/*.js，改后必跑 node scripts/build.mjs 生成
 * client.js / package/lib/client.js，勿手改产物（见 docs/architecture/kernel-contract.md）。
 * 动工前必读：本文件头 20 行 + docs/architecture/kernel-contract.md + 跑 node scripts/build.mjs 及 tests/verify-*。
 */
    export const PROMPTS = {
      "mapExecute": { version: 9, placeholders: ['n', 'title', 'url', 'bodyFormat'], use: 'map 执行 / 新会话（未完成态）· 推进式 · 清单式（A★）', zh: '## 目标 map\n- 编号：#{n}\n- 标题：{title}\n- 链接：{url}\n\n请使用 wayfinder 技能推进该 map（遵循其规则）：\n\n## 分析\n- [ ] 加载 wayfinder 技能（如未加载）\n- [ ] 分析这个 map：Destination / Notes / 阻塞关系 / 当前 frontier\n\n## 选票\n- [ ] 按第一性原理，选 frontier 中最值得推进的下一个 issue（价值最高 / 风险最低 / 最解阻）\n\n## 执行\n- [ ] 认领该票 → 读 Description / Notes / 阻塞关系 → 制定方案 → 实施 → 验收\n- [ ] 若该票带 needs-triage：先按阶段闸门完成诊断（读现状 / 判断进展：真实 / 虚假 / 未动工）再进入实施，不许跳过\n\n## 收尾\n- [ ] 结束前按进度契约更新该票正文（## 进度：N% + 下一步；95% 须写明待确认什么，未确认不得 close）；验收通过 → 100% + close\n- [ ] 若本次推进关闭了票：同步 map 记录（Decisions so far 追加 gist / 迷雾毕业 / Out of scope）\n\n{bodyFormat}', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}\n\nPlease use the wayfinder skill to advance this map (follow its rules):\n\n## Analyze\n- [ ] Load the wayfinder skill (if not loaded)\n- [ ] Analyze this map: Destination / Notes / blocking relationships / current frontier\n\n## Pick the ticket\n- [ ] From first principles, pick the next issue on the frontier most worth advancing (highest value / lowest risk / most unblocking)\n\n## Execute\n- [ ] Claim the ticket → read Description / Notes / blocking relationships → plan → implement → verify\n- [ ] If the ticket carries needs-triage: first complete the stage-gate diagnosis (read current state / judge progress: real / fake / not started) before implementation — do not skip\n\n## Wrap-up\n- [ ] Before finishing, update the ticket body per the progress contract (## Progress: N% + next step; at 95% state what awaits confirmation and do not close before confirmation); verified → 100% + close\n- [ ] If this advance closes any ticket, sync the map records (Decisions so far gist / fog graduation / Out of scope)\n\n{bodyFormat}' },
                  "complete": { version: 9, placeholders: ['n', 'title', 'url', 'closed', 'total', 'bodyFormat'], use: 'map 完成态 · 完成调查（100% 却未 close 时排查真实原因 · 人来定夺）', zh: '## 目标 map\n- 编号：#{n}\n- 标题：{title}\n- 链接：{url}\n\n## MAP完成确认\n\n当前 map 显示 100% 完成：{closed}/{total} 个 issue 已关闭，但 map 本身仍 open。请先调查「为什么 100% 却未 close」，不要轻信数字、不要擅自 close。\n\n## 调查（弄清 100% 是否真实、以及未 close 的真实原因）\n- [ ] 任务是否真的完成：sub-issue 是否真正解决了原 Destination（而非只把 ticket 关了）？\n- [ ] 排查与该 map 相关、但未建立 sub-issue 关系的 issue（关联工作可能没计入 {closed}/{total}）——如搜索提及该 map 编号/标题的 issue、核对相关标签等；\n- [ ] 逐个核对 sub-issue 的完成状态与关闭状态是否一致（漏关/误开）：实际已完成却漏标 CLOSED，或未完成却标 CLOSED；\n- [ ] 检查是否还有 Not yet specified 中未毕业的事项；\n- [ ] 其他可能情况（如已真实完成只是忘了 close、计数与实际不符等）——自行排查，不限于上述清单；\n\n## 报告你来定夺（人来定夺）\n- [ ] 把调查结论整理成「发现 + 建议」报告给用户；\n- [ ] 由用户决定下一步（收尾 close / 补齐遗漏 / 调整 map 记录 / 其他），不擅自 close、不擅自改 map 记录；\n\n## 收尾\n- [ ] 用户确认后，按用户意见执行（如需 close → close map + 在 Decisions so far 追加总结，每个 closed ticket 一行 gist）；\n- [ ] 结束前按进度契约更新相关 issue 正文（## 进度：N% + 下一步）；调查中发现的进度不符（漏关/误开/仅差确认）据实标注（95% · 待确认 / 100% + close），不得显示为未动工；\n- [ ] 若涉及 map 记录调整（Not yet specified / Out of scope）→ 按 wayfinder 规则同步，不重复展开；\n\n{bodyFormat}', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}\n\n## MAP completion check\n\nThe map shows 100% complete: {closed}/{total} issues closed, but the map itself is still open. Investigate first why it is 100% but not closed — do not trust the numbers, do not close on your own.\n\n## Investigate (determine whether the 100% is real, and the real reason it is not closed)\n- [ ] Is the task really done: did the sub-issues actually resolve the original Destination (not just close the tickets)?\n- [ ] Hunt for issues related to this map but not wired as sub-issues (related work may not be counted in {closed}/{total}) — e.g. search issues mentioning this map by number or title, check related labels, etc.;\n- [ ] Check each sub-issue completion state vs close state (missed/erroneous close): actually done but not marked CLOSED, or not done but marked CLOSED;\n- [ ] Check whether any ungraduated items remain in Not yet specified;\n- [ ] Other possibilities (e.g. really done but forgot to close, count mismatch with reality, etc.) — investigate on your own, not limited to the list above;\n\n## Report to you — human in the loop\n- [ ] Summarize the investigation into a findings + recommendation report for the user;\n- [ ] Let the user decide next steps (wrap-up close / fill gaps / adjust map records / other) — do not close on your own, do not change map records on your own;\n\n## Wrap-up\n- [ ] After the user confirms, act per the user-confirmed decision (if close → close the map + append a summary to Decisions so far, one-line gist per closed ticket);\n- [ ] Before finishing, update relevant issue bodies per the progress contract (## Progress: N% + next step); progress mismatches found during investigation (missed/erroneous close / awaiting confirmation) → mark accordingly (95% · awaiting confirmation / 100% + close), never show as not started;\n- [ ] If map-record adjustments are involved (Not yet specified / Out of scope) → sync per the wayfinder rules, without re-expanding;\n\n{bodyFormat}' },
      "fixate": { version: 6, placeholders: ['bodyFormat'], use: '沉淀 · 思维对齐 · 成果沉淀', zh: '告一段落。暂停推进，执行「思维对齐 · 成果沉淀」，从第一性原理出发：\n\n## 沉淀\n- [ ] 全量复述：把我从会话开始到现在、我问过你并得到明确回答的内容，按五类逐条列出（每条 = 我问的问题 → 你的回答）：目的地 / 约束与偏好 / 已确认的决定 / 待决问题 / 雾区（隐约可见但还不清晰）\n- [ ] 不压缩、不合并——宁可啰嗦不可省略；一次全部列完，不分批\n- [ ] 每条标注出处：我的问题（短句）+ 你的原话关键短句（≤50 字，超出以省略号截断）+ 上下文提示（如主题/轮次），让我知道它来自哪\n\n## 可疑遗漏\n- [ ] 单列一节「可疑遗漏」：\n  - [ ] 我问过、你已回答、但我未纳入上面清单的（第一优先级——防我漏记你已答的内容）\n  - [ ] 你提过、但我判断与主线无关 / 太模糊 / 属执行细节而未纳入的\n  - [ ] 每条写明我当时的判断理由，由你裁决纳入或放弃\n\n## 核对\n- [ ] 列完（含「可疑遗漏」）后停下，等我逐条核对；我确认或修正后，你再执行落盘\n\n## 落盘\n- [ ] 有明确对应 ticket（票）→ 全部成果写入该 ticket 正文的「## 对齐成果」节（新增或并入，含日期）；不写 map（地图）正文——map 是索引，成果归 ticket\n- [ ] 无对应 ticket、但属于某 map → 写入 alignment note（对齐记录）`.scratch/alignment/<ts>-<短标题>.md`（相对当前工作目录；短标题 ≤10 字，用连字符或下划线代替空格），并在该 map 的 Notes 追加一行指针（路径 + 日期）\n- [ ] 无 ticket 也无 map → 写入对齐记录文件，并告诉我完整路径；建图/建票时由接手会话搬入对应 ticket\n- [ ] 属 map 层面的条目（如目的地/雾区调整）→ 照写进所选位置，条目末尾标注「map 层面，随建图搬入」\n\n{bodyFormat}', en: 'This phase wraps up here. Pause progress and run the "alignment & consolidation" pass, from first principles:\n\n## Consolidate\n- [ ] Restate everything I have explicitly answered since this session started, in five categories (each item = my question → your answer): Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)\n- [ ] No compression, no merging — rather verbose than omitted; list everything in one go, no batching\n- [ ] Annotate each item with its source: my question (short) + a key quote of your original words (≤50 chars, truncate with ellipsis if longer) + a context hint (e.g. topic/turn) so I know where it came from\n\n## Suspected omissions\n- [ ] Add a separate "Suspected omissions" section:\n  - [ ] Questions I asked, you answered, but I did not include above (first priority — guard against forgetting your answers)\n  - [ ] Things you mentioned but I judged off-topic, too vague, or execution detail and did not include\n  - [ ] State my judgment reason for each; you decide whether to keep or drop\n\n## Review\n- [ ] Stop after listing (including "Suspected omissions") and wait for my item-by-item review; once I confirm or correct, you persist the list\n\n## Persist\n- [ ] If a corresponding ticket exists → write all outcomes into that ticket body (a new or merged "## Alignment outcomes" section, with date); do not write into the map body — the map is an index, outcomes belong to the ticket\n- [ ] If no corresponding ticket but within a map → write an alignment note to `.scratch/alignment/<ts>-<short>.md` (relative to the current working directory; short ≤20 chars, hyphen or underscore instead of spaces), and append a one-line pointer (path + date) to the map Notes\n- [ ] If no ticket and no map → write the alignment note and tell me the full path; when a map/ticket is created, the taking-over session migrates it into the corresponding ticket\n- [ ] Map-level items (e.g. Destination/Fog adjustments) → still write them in the chosen place, and mark the item "map-level, migrate when the map is built"\n\n{bodyFormat}' },
      "progress": { version: 3, placeholders: [], use: '进度契约（所有动作 prompt 引用）', zh: '进度表达（每次动作结束前必须更新 —— 这是动作的一部分，不是可选项）：\n1. 格式与写法：issue 正文维护固定进度区 `## 进度：N%`（N 为 0-100 整数，如 `## 进度：90%`；禁止「大概 / 基本」等模糊词）；更新前先读正文当前进度，按最新状态写真实当前值（可上调也可下调）；\n2. 语义阶梯：0% = 未动工；1-94% = 进行中；95% = 已完成待用户确认（下一步必须写明待确认什么；未确认不得 close）；确认后立即写 100% 并 close；\n3. 兜底：100% = 确认完成（close 后进度区保留为历史）；首次接触无进度区的票，先按现状补写一个与实施记录相符的进度。', en: 'Progress expression (must update before finishing every action — it is part of the action, not optional):\n1. Format & writing: keep a fixed progress section in the issue body: `## Progress: N%` (N is an integer 0-100, e.g. `## Progress: 90%`; no vague words like "about / basically"); before updating, read the current progress in the body and write the true current value based on the latest state (may go up or down);\n2. The ladder: 0% = not started; 1-94% = in progress; 95% = done, awaiting user confirmation (the next step must state what exactly awaits confirmation; do not close before confirmation); once confirmed, immediately write 100% and close;\n3. Fallbacks: 100% = confirmed done (the section stays as history after close); on first contact with a ticket lacking the section, write a progress matching its implementation record.' },
      "bodyFormat": { version: 7, placeholders: [], use: '正文格式契约的通用兜底（后端声明了 bodyFormat 就用后端的：GitHub/GitLab/Markdown 各自声明在 src/host/tracker/backends/<id>/index.js 的 prompts.bodyFormat，模板里只留 {bodyFormat} 标记）', zh: '## 正文格式（写/改 issue 正文时必须遵守）\n- [ ] 正文先写成文件（文件里是真实换行：每个 `## 章节` 独占一行、段落间留空行），不要把正文拼进命令行\n- [ ] 按当前跟踪器自己的方式把文件内容写回该单据正文；写完读回来核对一遍\n- [ ] 换行不要写成反斜杠加 n 两个字符', en: '## Body format (mandatory when writing/editing an issue body)\n- [ ] Write the body to a file first (real newlines in the file: each `## section` on its own line, a blank line between paragraphs); never inline the body into the command line\n- [ ] Write the file content back into the ticket body the way the current tracker does; read it back to confirm\n- [ ] Never write a newline as the two characters backslash-n.' },
      "tpl.diagnose": { version: 10, placeholders: ['url', 'bodyFormat'], use: '动作按钮「诊断」（needs-triage ticket）· 清单式（A★）', zh: '/triage\n{url}\n\n诊断这个 issue（遵循 /triage 技能自身规则，诊断≠修复——只弄清问题与分流，不直接改代码）：\n\n## 弄清现象\n- [ ] 现象是什么\n- [ ] 影响范围是什么\n- [ ] 复现步骤是什么（可复现则给出最小复现）\n\n## 根因候选\n- [ ] 列出多个根因候选，标注各自可能性/置信度\n\n## 分流建议（判断要落到标签，这一步必须做）\n- [ ] 给分流建议并切标签到唯一终态：修复→ready-for-agent（有小疑问可附待确认事项一起转，不阻塞），需人动手→ready-for-human，缺关键信息→needs-info，不做→wontfix；无理由不许停在 needs-triage\n- [ ] 标签流转是诊断的一部分，按当前后端方式执行；禁止的是改业务代码、关闭单子、开始修复实施，这三件诊断阶段不做\n\n## 澄清\n- [ ] 动手前若有「我猜用户想要这样」的地方，先用 grilling 技能澄清（不猜）\n\n## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）\n- [ ] 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段\n- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）\n- [ ] 诊断时判断当前进展：\n  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）\n  - [ ] 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断\n  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）\n- [ ] 诊断完成必须摘 needs-triage（落到上述四终态之一）后才允许进入实施阶段；暂留 needs-triage 仅当缺信息到无法分流，且必须写明缺什么\n\n## 收尾\n- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步；95% 须写明待确认什么，未确认不得 close）\n- [ ] 结尾必须用提问格式收尾：有待维护者拍板的事，写成❓ Q1、Q2并逐个给推荐答案（➡️），说明回了就执行什么标签动作，等回复，不猜着转；无待拍板则写明已转到哪个终态\n\n{bodyFormat}', en: '/triage\n{url}\n\nDiagnose this issue (follow the /triage skill own rules; diagnosis ≠ fix — clarify the problem and propose triage, do not fix code directly):\n\n## Symptoms\n- [ ] What are the symptoms\n- [ ] What is the impact\n- [ ] What are the repro steps (give minimal repro if reproducible)\n\n## Root causes\n- [ ] List multiple root-cause candidates with confidence\n\n## Triage (the call must land on a label — this is required)\n- [ ] Propose triage and move the label to exactly one terminal state: fix → ready-for-agent (minor open points ride along as confirmation items, no blocking), needs human → ready-for-human, missing key info → needs-info, will not do → wontfix; do not stay on needs-triage without a reason\n- [ ] Moving labels is part of diagnosis, via the current backend; forbidden in diagnosis: changing product code, closing the ticket, starting the fix\n\n## Clarify\n- [ ] Before acting, if any part rests on a guess about what the user wants, settle it with the grilling skill first (do not guess)\n\n## Stage gate (must read before starting — part of the action, not optional)\n- [ ] First read the issue current state: progress (## Progress: N%) / existing implementation record / comments / labels — determine stage\n- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)\n- [ ] During diagnosis, judge progress:\n  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (→ ready-for-agent)\n  - [ ] Existing impl but fake/partial → revise progress back to true value (e.g. 30%) and continue diagnosing\n  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into the issue)\n- [ ] Implementation may begin only after diagnosis removes needs-triage (landed on one of the four terminal states above); keeping needs-triage is allowed only when info is too thin to triage, and you must state what is missing\n\n## Wrap-up\n- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step; at 95% state what awaits confirmation and do not close before confirmation)\n- [ ] End with explicit questions: any maintainer call goes as ❓ Q1, Q2 with a recommended answer each (➡️), stating which label move follows each reply; wait for replies instead of guessing; with no open calls, state which terminal state was applied\n\n{bodyFormat}' },
      "tpl.fix": { version: 7, placeholders: ['url', 'bodyFormat'], use: '动作按钮「修复」（bug 票）· 清单式（A★）', zh: '/implement\n{url}\n\n修复这个 bug（遵循 wayfinder 技能规则）：\n\n## 读现状\n- [ ] 已认领？若未认领，先认领\n- [ ] 读 Description / Notes / 阻塞关系 / 评论 / 标签 / 进度区（## 进度：N%），确认现象与验收标准\n\n## 定位与修复\n- [ ] 先复现（可复现则给出最小复现）\n- [ ] 再定位根因（修错地方 = 白修）；若目标不清或有假设 → 用 grilling 技能澄清（不猜）\n- [ ] 制定方案 → 实施修复 → 加测试并跑通\n- [ ] 对抗式自查：边界 / 异常分支 / 回归影响 / 并发与旧数据（我会漏在哪里？逐项打勾）\n\n## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）\n- [ ] 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段\n- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）\n- [ ] 诊断时判断当前进展：\n  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）\n  - [ ] 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断\n  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）\n- [ ] 诊断完成摘 needs-triage 后才允许进入实施阶段\n\n## 收尾\n- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步；95% 须写明待确认什么，未确认不得 close）；修复完成但未验收 → 95% · 待确认（未确认不得 close），确认后 100% + close\n\n{bodyFormat}', en: '/implement\n{url}\n\nFix this bug (follow the wayfinder skill rules):\n\n## Read current state\n- [ ] Claimed? Claim first if unclaimed\n- [ ] Read Description / Notes / blocking relationships / comments / labels / progress (## Progress: N%) — confirm symptoms & acceptance criteria\n\n## Locate & fix\n- [ ] Reproduce first (give minimal repro if reproducible)\n- [ ] Then locate root cause (fixing the wrong spot is wasted work); if goal unclear or any assumption → clarify with grilling (do not guess)\n- [ ] Plan → implement fix → add tests and get them green\n- [ ] Adversarial self-check: boundaries / error branches / regression impact / concurrency & legacy data (where did I miss? check each)\n\n## Stage gate (must read before starting — part of the action, not optional)\n- [ ] First read the issue current state: progress (## Progress: N%) / existing implementation record / comments / labels — determine stage\n- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)\n- [ ] During diagnosis, judge progress:\n  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (→ ready-for-agent)\n  - [ ] Existing impl but fake/partial → revise progress back to true value (e.g. 30%) and continue diagnosing\n  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into the issue)\n- [ ] Only after diagnosis and needs-triage removed may implementation begin\n\n## Wrap-up\n- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step; fix done unverified → 95% awaiting confirmation, do not close before confirmation)\n\n{bodyFormat}' },
      "tpl.discuss": { version: 8, placeholders: ['url', 'bodyFormat'], use: '动作按钮「讨论」（grilling 票）· 清单式（A★）', zh: '/grill-with-docs\n{url}\n\n这个 issue 需要讨论定夺，和我对话（遵循技能自身规则）：\n\n## 讨论聚焦\n- [ ] 围绕目标 / 边界 / 风险 / 选项权衡 / 决策 五要素展开（齐且不冗，不额外扩散）\n\n## 人来定夺\n- [ ] 不替我做决定，等我确认结论再落盘\n\n## 结论落盘\n- [ ] 有结论时写进 issue 正文；需长期留存则另建议落成新 tickets / 决策记录（正文为首，tickets 为辅，不散落）\n\n## 澄清\n- [ ] 有“我猜用户想要这样”的地方，先用 grilling 澄清，不猜\n\n## 收尾\n- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步；95% 须写明待确认什么，未确认不得 close）\n- [ ] 全部讨论完毕、意图对齐时，主动提醒用户执行一次 /to-spec，把讨论结论固化为规格文档\n- [ ] /to-spec 产出的规格单，挂到同一张 map 上成为 subissue；无 map 时不写\n\n{bodyFormat}', en: '/grill-with-docs\n{url}\n\nThis issue needs discussion before a decision — talk with me (follow the skill’s own dialogue rules):\n\n## Focus\n- [ ] Cover goal / boundary / risks / options-tradeoffs / decision — all five, no more, no less (keep complete and concise, no extra expansion)\n\n## Human in the loop\n- [ ] Do not decide for me; wait for my confirmation before persisting conclusions\n\n## Persist conclusion\n- [ ] When a conclusion emerges, write it into the issue body; if it needs durable memory, additionally propose a new ticket / decision record (body is primary, ticket/record is auxiliary — no scattering)\n\n## Clarify\n- [ ] Before acting, if any part rests on a guess about what I want, settle it with grilling first (do not guess)\n\n## Wrap-up\n- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step; at 95% state what awaits confirmation and do not close before confirmation)\n- [ ] Once all discussion is done and intent is aligned, proactively remind the user to run /to-spec to solidify the conclusions into a spec document\n- [ ] Attach the spec issue that /to-spec produces to the same map, as a sub-issue; skip this if the issue has no map.\n\n{bodyFormat}' },
            "tpl.research": { version: 5, placeholders: ['url', 'bodyFormat'], use: '动作按钮「研究」（research 票）· 清单式', zh: '/research\n{url}\n\n研究这个 issue（遵循 /research 技能规则）：\n\n## 研究目标\n- [ ] 明确研究问题与决策依赖\n- [ ] 收集相关资料、文档与上下文\n- [ ] 引用可信来源并记录发现\n\n## 澄清\n- [ ] 有“我猜用户想要这样”的地方，先用 grilling 技能澄清，不猜\n\n## 收尾\n- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步；95% 须写明待确认什么，未确认不得 close）\n\n{bodyFormat}', en: '/research\n{url}\n\nResearch this issue (follow the /research skill rules):\n\n## Goals\n- [ ] Clarify the research question and decision it blocks\n- [ ] Gather relevant docs, context, and primary sources\n- [ ] Cite sources and capture findings\n\n## Clarify\n- [ ] Before acting, if any part rests on a guess about what the user wants, settle it with grilling first (do not guess)\n\n## Wrap-up\n- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step; at 95% state what awaits confirmation and do not close before confirmation)\n\n{bodyFormat}' },
"tpl.prototype": { version: 5, placeholders: ['url', 'bodyFormat'], use: '动作按钮“原型”（prototype 票）· 清单式', zh: '/prototype\n{url}\n\n做这个原型（遵循 /prototype 技能自身规则）：\n\n## 原型目标\n- [ ] 明确要回答的设计问题并判定分支（逻辑/状态模型是否顺畅 → 单文件可分享 HTML；界面应该长什么样 → 同路由多变体+底部悬浮切换）\n- [ ] 按分支产出抛弃式原型并外显状态\n\n## 澄清\n- [ ] 有“我猜用户想要这样”的地方，先用 grilling 澄清，不猜\n\n## 收尾\n- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步；95% 须写明待确认什么，未确认不得 close）\n\n{bodyFormat}', en: '/prototype\n{url}\n\nBuild this prototype (follow the /prototype skill rules):\n\n## Goals\n- [ ] State the design question and pick the branch (does the logic/state model feel right? → single shareable HTML; what should this look like? → variants on the same route + floating switcher)\n- [ ] Produce the throwaway prototype and surface the state\n\n## Clarify\n- [ ] If any part rests on a guess about what the user wants, settle it with grilling first (do not guess)\n\n## Wrap-up\n- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step; at 95% state what awaits confirmation and do not close before confirmation)\n\n{bodyFormat}' },
            "tpl.execute": { version: 9, placeholders: ['url', 'bodyFormat'], use: '动作按钮「执行」（普通票）· 清单式（A★）', zh: '/wayfinder\n{url}\n\n执行这个 issue（遵循 wayfinder 技能规则）：\n\n## 读现状\n- [ ] 已认领？若未认领，先认领\n- [ ] 读 Description / Notes / 阻塞关系 / 评论 / 标签 / 进度区（## 进度：N%），确认交付物与验收标准\n\n## 执行\n- [ ] 目标不清或需用户定夺 → 用 grilling 技能澄清（不猜）\n- [ ] 制定方案 → 实施 → 按验收标准自查（对抗式）\n\n## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）\n- [ ] 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段\n- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）\n- [ ] 诊断时判断当前进展：\n  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）\n  - [ ] 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断\n  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）\n- [ ] 诊断完成摘 needs-triage 后才允许进入实施阶段\n\n## 收尾\n- [ ] 完成且通过验收 → 100% + close；未完成 → 按进度契约如实更新（含下一步；95% 须写明待确认什么，未确认不得 close）\n- [ ] 若执行后关闭了该票：在所属 map 的 Decisions so far 追加一行 gist（票名 + 链接 + 一句话结论）\n\n{bodyFormat}', en: '/wayfinder\n{url}\n\nExecute this issue (follow the wayfinder skill rules):\n\n## Read current state\n- [ ] Claimed? Claim first if unclaimed\n- [ ] Read Description / Notes / blocking relationships / comments / labels / progress (## Progress: N%) — confirm deliverable & acceptance criteria\n\n## Execute\n- [ ] If goal unclear or needs user call → clarify with grilling (do not guess)\n- [ ] Plan → implement → self-check against acceptance criteria (adversarial)\n\n## Stage gate (must read before starting — part of the action, not optional)\n- [ ] First read the issue current state: progress (## Progress: N%) / existing implementation record / comments / labels — determine stage\n- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)\n- [ ] During diagnosis, judge progress:\n  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (→ ready-for-agent)\n  - [ ] Existing impl but fake/partial → revise progress back to true value (e.g. 30%) and continue diagnosing\n  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into issue)\n- [ ] Only after diagnosis and needs-triage removed may implementation begin\n\n## Wrap-up\n- [ ] Done & verified → 100% + close; otherwise update honestly per progress contract (with next step; at 95% state what awaits confirmation and do not close before confirmation)\n- [ ] If this execution closes the ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion)\n\n{bodyFormat}' },
      "tpl.handoff1": { version: 3, placeholders: ['ts'], use: '交接第一击（写交接文档）', zh: '/handoff 把当前会话生成交接文档，写到 .scratch/handoff/{ts}-<短标题>.md（相对当前工作目录）。<短标题> 是你给这次交接起的一个简短标题（中文 ≤10 字 / 英文 ≤20 字符，跟随当前会话语言，用连字符或下划线代替空格），让人一眼认出这是哪件事的交接。\n\n交接文档是给一个没有本次会话记忆的 agent 接手的——请站在它的视角，确保它能凭文档无缝继续，而不是靠猜或回翻本次会话。从第一性原理出发。', en: '/handoff Create a handoff doc from this session, written to .scratch/handoff/{ts}-<short>.md (relative to the current working directory). <short> is a brief title you give this handoff (zh ≤10 chars / en ≤20 chars, in the current session language, use hyphen or underscore instead of spaces) so a human can tell at a glance what it is about.\n\nThis doc is for an agent with no memory of this session — write from its perspective, so it can continue seamlessly without guessing or revisiting this session. Approach from first principles.' },
      "tpl.handoff2": { version: 3, placeholders: ['path'], use: '交接第二击（读交接文档）', zh: '请阅读 {path}（上一会话生成的交接文档），复述你的理解后再继续推进：\n\n## 复述理解\n- [ ] 结论：本会话已确认的决定与成果\n- [ ] 未完成事项：下一步要继续的事\n- [ ] 建议 skill：新会话接手时应加载的技能\n- [ ] 把以上三点复述给我；若有遗漏或不确定 → 先问我确认，不猜\n\n## 继续推进\n- [ ] 从第一性原理出发，继续完成未完成事项', en: 'Read the handoff doc {path} (from the previous session), restate your understanding, then continue:\n\n## Restate understanding\n- [ ] Conclusions: decisions and outcomes confirmed this session\n- [ ] Unfinished: what to continue next\n- [ ] Suggested skills: skills the new session should load\n- [ ] Restate the three points to me; if anything is missing or uncertain → ask me first, do not guess\n\n## Continue\n- [ ] From first principles, continue with the unfinished work' },
      "installSkillsFix": { version: 2, placeholders: [], use: '环境检查技能行提示（短句，避免长文刷屏；2026-08-29 审查 S1：去用户目录黑话、去"点「X」"重复指挥）', zh: '技能缺失会阻断后续流程。点「帮我安装」让 AI 按步骤操作。', en: 'Missing skills block the flow. Click "Install for me" and let AI run the steps.' },
      "installSkills": { version: 3, placeholders: ['probeList', 'probeCount'], use: '技能安装引导 · DSH 专用（横幅 / 引导 g4 / 设置页复制）· v3 #fix-banner：probeList 动态从 shared/matt-skills.js 注入（25 项）', zh: '请为 DSH 安装 Matt Pocock 的 skills 技能套件（mattpocock/skills）：\n\n1. 先检查：确认 ~/.agents/skills 下这 {probeCount} 个技能已全部就位：{probeList}。已全部就位 → 直接汇报已装技能清单并结束，不要重复安装；\n2. 有缺失则安装：优先用官方安装器 `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y`（安装器未列出 DSH，但 `-a cline` 的全局目录恰为 ~/.agents/skills，与 DSH 读取目录一致；`--copy` 用复制而非符号链接，防 npx 缓存清理后断链）；若无 npx 或安装失败，回退：克隆 https://github.com/mattpocock/skills，把 skills/engineering 与 skills/productivity 目录下的全部技能复制到 ~/.agents/skills；\n3. 安装目标是 DSH 读取的用户级技能目录：~/.agents/skills —— 不要装进其他工具的技能目录（如 ~/.claude/skills）；\n4. 安装后复验：第 1 步的 {probeCount} 个技能已全部就位；\n5. 完成后汇报安装结果与已装技能清单（用第 1 步的完整清单，不要只列 10 项）。', en: 'Install the Matt Pocock skills collection (mattpocock/skills) for DSH:\n\n1. Check first: confirm these {probeCount} skills are all present under ~/.agents/skills: {probeList}. If all are present, report the installed skill list and stop — do not reinstall;\n2. If any are missing, install: prefer the official installer `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y` (the installer does not list DSH, but `-a cline` installs globally into ~/.agents/skills — the same directory DSH reads; `--copy` copies instead of symlinking so npx cache cleanup cannot break the links); if npx is unavailable or fails, fall back: clone https://github.com/mattpocock/skills and copy all skills from skills/engineering and skills/productivity into ~/.agents/skills;\n3. Install into the user-level skill directory DSH reads: ~/.agents/skills — do not install into the skill directories of other tools (e.g. ~/.claude/skills);\n4. After install, re-verify: all {probeCount} skills from step 1 are in place;\n5. When done, report the result and the installed skill list (use the full list from step 1, not just the first 10).' },
      "setupRun": { version: 10, placeholders: ['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs', 'paletteNote'], use: '环境检查横幅 · setup 未执行按钮（仅初始化记录配置，不安装/克隆技能；v10 #323 注入通道扩展：新增 paletteNote 占位符，Markdown 后端经它注入「标签调色盘」建表一节（样例表 + 预填色值 + 改色/警示），置于注入末尾独立成节；labelReqs=按后端的标签要求条款，Markdown 为空即不要求标签齐全）', zh: '/setup-matt-pocock-skills\n\n初始化本仓库配置（技能套件已安装；本命令仅记录 issue tracker / 标签词汇 / 文档路径，不安装、不克隆任何技能）：\n1. 按技能流程选择 issue tracker：{trackerLine}，由用户确认；\n2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 {trackerChoice}；triage 标签保留默认五角色）{labelReqs}；后续打标签严格遵循技能规则，不额外强制任何标签；\n3. 完成后核对技能真实产物：docs/agents/issue-tracker.md + triage-labels.md + domain.md 及 AGENTS.md 的 ## Agent skills 块；再复查环境检查（setup 变绿）。{backendNote}{paletteNote}', en: '/setup-matt-pocock-skills\n\nBootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths — it does not install or clone any skills):\n1. Follow the skill flow to pick the issue tracker: {trackerLine}, confirm with the user;\n2. During init, follow the setup-matt-pocock-skills skill own flow (choose {trackerChoice} as the tracker; keep the default triage-role labels){labelReqs}; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;\n3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green).{backendNote}{paletteNote}' },
      "newWayfinder": { version: 14, placeholders: ['repo','subIssue'], use: '「+ 新建需求」按钮 · 清单式（A★）', zh: '/wayfinder\n请帮我处理一个需求（严格遵循 wayfinder 技能规则）。\n仓库（已自动填入当前工作区）：{repo}\n\n## 澄清\n- [ ] 对目标 / 范围 / 偏好有假设时，先用 grilling 技能澄清，不默认\n\n## 判断分类（先查仓库已有 wayfinder:map 和 issue，确认是否做过）\n- [ ] 新增：全新需求 → 新建 map\n  - [ ] 写出 map：Destination + Notes + plan\n  - [ ] 先把该 map 的现有正文取下来存成文件（文件里必须保留 `## Destination` 一节），改好任务清单后再调 {subIssue}\n  - [ ] 关联到该 map 的每个 ticket 都由脚本建原生边并自己校验数量；仅当后端明确不支持原生边时才回退到任务清单 + Part of\n  - [ ] 阻塞关系以脚本建的原生依赖边为准；正文里的 `Blocked by: #<n>` 行只作降级兜底\n- [ ] 复用：这个需求之前已做过（已有 map / issue）→ 打开复用它，不重复建\n- [ ] 直接实现：需求很小 → 建一个 issue 直接实现，不建大 map\n\n## 自查（对检查清单做检查）\n- [ ] 逐项核对上面每个 `- [ ]`：是否已落实、无遗漏；漏项补上，不跳过\n- [ ] 校验：看关联脚本回包的 expected 与 actual 是否一致（对不上脚本会非零退出，不要当成成功），且面板列表的 `closed/total` 不为 0/0（有子票时）\n- [ ] 结束前按进度契约更新（## 进度：N% + 下一步；95% 须写明待确认什么，未确认不得 close）\n', en: '/wayfinder\nPlease handle a requirement (strictly follow the wayfinder skill rules).\nRepo (auto-filled from current workspace): {repo}\n\n## Clarify\n- [ ] If you hold assumptions about the goal / scope / preferences, settle them with the grilling skill — never assume\n\n## Decide the case (check existing wayfinder:map and issues first)\n- [ ] Add: a brand-new requirement → build a new map\n  - [ ] Write the map: Destination + Notes + plan\n  - [ ] First fetch the map current body into a file (the file must keep the `## Destination` section), edit the task list, then call {subIssue}\n  - [ ] The script creates the native edges for every ticket under this map and verifies the count itself; only fall back to task list + Part of when the backend explicitly has no native edge\n  - [ ] Blocking comes from the native dependency edges the script creates; a `Blocked by: #<n>` line in the body is only the fallback\n- [ ] Reuse: this requirement has been done before (existing map / issue) → open and reuse it, do not build a new one\n- [ ] Directly implement: the requirement is small → create a single issue and implement it directly, no big map\n\n## Self-check (verify the checklist)\n- [ ] Go through every `- [ ]` above: confirmed done, no gaps; fill anything missed, do not skip\n- [ ] Verify: the wiring script return shows expected equals actual (a mismatch exits non-zero — never treat it as success) and the panel list `closed/total` is not 0/0 when tickets exist\n- [ ] Before finishing, update per the progress contract (## Progress: N% + next step)\n' },
      "newBugWayfinder": { version: 5, placeholders: ['repo'], use: '「+ 新增BUG单」按钮 / 状态栏 BUG 悬停菜单「新增」（issue #4 · v2 修 #1 BUG3：输入位移到末尾 · v3 #14：精简为 4 字段 · v4 #63：去内部规则+实际→期望+括号单行 · v5 #475：补标签要求 bug 必带+未诊断带 needs-triage，分远端原生/本地标签行）', zh: '/wayfinder\n请帮我新增一个 BUG 单（按 wayfinder 技能规则处理）。\n仓库：{repo}\n新建的单子必须带上 bug 标签；如果还没有经过诊断，同时带上 needs-triage 标签。远端后端按原生标签方式打标签，本地 Markdown 后端在正文加标签行（例如 Labels: bug, needs-triage）。', en: '/wayfinder\nPlease help me file a new BUG ticket (follow the wayfinder skill rules).\nRepo: {repo}\nNew tickets must carry the bug label; if not yet triaged, also carry needs-triage. On remote backends use native labels; on the local Markdown backend add a Labels line (e.g. Labels: bug, needs-triage).' },
      "ghAuthLogin": { version: 1, placeholders: [], use: 'gh 登录引导 · 链失败态 inject-prompt（#228 替换 openUrl 硬编码，动作不承诺修复，检查才判定）', zh: '请为本机完成 GitHub CLI 登录（gh auth login）：\n\n1. 终端执行 gh auth login \n2. 按向导选择 GitHub.com → HTTPS → Yes → 浏览器授权（OAuth）\n3. 完成后执行 gh auth status 验证已登录\n4. 回到面板点「重新检查」或等待自动重查，链条将自动推进\n5. 若遇网络/代理问题，请检查 gh config 与网络后重试', en: 'Please complete GitHub CLI login (gh auth login):\n\n1. Run gh auth login in terminal\n2. Choose GitHub.com → HTTPS → Yes → browser OAuth\n3. Verify with gh auth status\n4. Click "Re-check" at the top of the panel, or wait for auto re-check; the chain will advance via re-evaluation\n5. If network/proxy issues, check gh config and retry' },
            "mapInspect": { version: 6, placeholders: ['n', 'title', 'url', 'bodyFormat', 'subIssue'], use: 'map 空态 0/0 检查 · 诊断关联缺失', zh: '## 目标 map\n- 编号：#{n}\n- 标题：{title}\n- 链接：{url}\n\n该 map 在面板中显示为 0/0（无子议题），这不正常——按 wayfinder 规则，有规划的 map 应通过子议题推进，0/0 通常意味着创建时子议题没有以本后端的原生父子关系正确关联到该 map。\n\n请按 wayfinder 技能排查并修复关联（遵循其规则）：\n\n## 排查\n- [ ] 加载 wayfinder 技能（如未加载），结合该 map 的 Destination / Notes 回顾本应有哪些子议题\n- [ ] 在当前后端中核对这些子议题是否已存在但未成为该 map 的真正子议题（面板计数仍 0/0、详情未展示）\n\n## 修复\n- [ ] 先把该 map 的现有正文取下来存成绝对路径文件（文件里必须保留 `## Destination` 一节），再按本后端声明的关联方式把子议题建成该 map 的子议题：{subIssue}\n- [ ] 若子议题尚未创建，按原规划创建后，用同一种关联方式补建\n- [ ] 修复后按上面的校验方式核对子议题数量与预期一致，并确认面板中该 map 的计数不再是 0/0，详情页能看到完整子议题列表且阻塞关系正确\n\n## 收尾\n- [ ] 结束前按进度契约更新相关 issue 正文（## 进度：N% + 下一步）\n- [ ] 校验子议题数与面板计数一致，且不再为 0/0\n\n{bodyFormat}', en: '## Target map\n- No: #{n}\n- Title: {title}\n- Link: {url}\n\nThis map shows 0/0 (no sub-issues) in the panel, which is abnormal — a planned map is expected to advance via sub-issues. 0/0 typically means the sub-issues were not wired as native sub-issues of this map when it was created.\n\nPlease investigate and fix the wiring per the wayfinder skill (follow its rules):\n\n## Investigate\n- [ ] Load the wayfinder skill (if not loaded) and review Destination / Notes to recall what sub-issues were intended\n- [ ] Check whether those sub-issues already exist but are not showing as true sub-issues of this map (count still 0/0, not listed in detail)\n\n## Fix\n- [ ] First fetch the map current body into an absolute-path file (keep the `## Destination` section), then wire the sub-issues to this map the way this backend declares: {subIssue}\n- [ ] If the sub-issues do not exist yet, create them per the original plan, then wire them the same way\n- [ ] After fixing, verify the sub-issue count matches the way stated above, and that the panel count is no longer 0/0 and the detail page lists all sub-issues with correct blocking\n\n## Wrap-up\n- [ ] Update related issue bodies per the progress contract (## Progress: N% + next step) before finishing\n- [ ] Verify sub-issue count matches the panel count and is no longer 0/0\n\n{bodyFormat}' },
    }
    // 当前语言（跟随 DSH locale 快照 active；缺省 zh）
    export const promptLang = function () {
      try {
        const l = (localeSvc && typeof localeSvc.getSnapshot === 'function') ? localeSvc.getSnapshot().active : null
        return (l === 'en' || String(l || '').indexOf('en') === 0) ? 'en' : 'zh'
      } catch (e) { return 'zh' }
    }
    // 取 prompt：promptText(id) 或 promptText(id, { 占位符: 值 })
    // v9（#230 · D10）：setupRun 的 client 内置缺省分支已删 —— 占位符一律由后端描述数据（BackendModule.setupPrompt 键入 locale）经 setupRunParamsFrom 填充
    // #595：{bodyFormat} 是「按当前后端填空」的占位符，正常情况下由 promptTextFor / backendParamsFor 填好；
    //   这里再兜一次底（后端上下文缺失时填通用版），保证任何路径都不会把标记原文注入会话。
    export const promptText = function (id, params) {
      const p = PROMPTS[id]
      if (!p) return ''
      let s = (promptLang() === 'en' && p.en) ? p.en : (p.zh || '')
      const vals = Object.assign({}, params || {})
      if (s.indexOf('{bodyFormat}') >= 0 && !Object.prototype.hasOwnProperty.call(vals, 'bodyFormat')) {
        vals.bodyFormat = (typeof bodyFormatText === 'function') ? bodyFormatText(null) : ''
      }
      s = s.replace(/\{(\w+)\}/g, function (m, name) { return Object.prototype.hasOwnProperty.call(vals, name) ? String(vals[name]) : m })
      return s
    }
    // #230（D10 · 2026-08-28 生效）setupRun 后端描述数据（键入 locale 方案定版）：
    // 旧 setupTrackerLine/setupTrackerChoice/setupBackendNote 三函数（client 内 backendId 分支硬编码双语值）删除；
    // 后端模块经 BackendModule.setupPrompt 声明「locale 键名」，wf.registry 转发到 st.backendModules，此处只做 键→值 解析与占位符填充 —— client 零 backendId 分支。
    // 数据缺失/未声明后端的兜底 = SETUP_DEFAULT_PROMPT_KEYS（与旧「缺省 GitHub」行为等价：未知 id 同样落到该缺省键组）。
    // #323（2026-08-29 生效）：新增 paletteNote 占位符 —— 仅本地 Markdown 后端经 setupPrompt.paletteNote 声明 locale 键；
    //   其余后端/缺省组不声明该键 → 按空串解析（模板渲染为空，非本地后端口径零影响）。
    export const SETUP_DEFAULT_PROMPT_KEYS = {
      trackerLine: 'setup.default.trackerLine',
      trackerChoice: 'setup.default.trackerChoice',
      backendNote: 'setup.default.backendNote',
      labelReqs: 'setup.default.labelReqs',
    }
    // 纯函数：modules = wf.registry modules 数组（元素可带 setupPrompt 键表）；dictOverride 供单测直喂 locale 字典（单测不依赖闭包 L）
    export const setupRunParamsFrom = function (modules, backendId, dictOverride) {
      const list = Array.isArray(modules) ? modules : []
      let m = null
      for (let i = 0; i < list.length; i++) { if (list[i] && String(list[i].id) === String(backendId)) { m = list[i]; break } }
      const declared = (m && m.setupPrompt) || SETUP_DEFAULT_PROMPT_KEYS
      let dict = dictOverride || null
      if (!dict) { try { dict = (typeof L !== 'undefined' && L && L[promptLang()]) ? L[promptLang()] : null } catch (e) {} }
      const out = {}
      ;['trackerLine', 'trackerChoice', 'backendNote', 'labelReqs', 'paletteNote'].forEach(function (k) {
        try { out[k] = (dict && dict[declared[k]] != null) ? String(dict[declared[k]]) : '' } catch (e) { out[k] = '' }
      })
      return out
    }
    // UI 统一入口：显式 backendId 优先（绑定/切换流程）；否则当前 selection；再无 → 缺省键组。所有注入路径一律走这里。
    // 2026-08-28 修复“未指定”回退：显式选择已落在 host + localStorage selectionByCwd，但 prompt 之前只读 s.selection（单会话乐观），
    // 新会话/快照未水合时为 null 导致永远 default。现按权威链 s.selection → snapshot.selection → getCachedSelection(cwd) 取 id，保持 UI 零硬编码。
    export const setupRunPrompt = function (st, backendId) {
      let sel = null
      try {
        if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
        else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
        else if (st && st.cwd && typeof getCachedSelection === 'function') { const cs = getCachedSelection(st.cwd); if (cs && cs.backendId != null) sel = cs.backendId }
      } catch {}
      const id = backendId != null ? backendId : sel
      return promptText('setupRun', setupRunParamsFrom(st && st.backendModules, id))
    }
    // Q2 #496：绑定成功后的注入决策（数据驱动，UI 零品牌分支）。
    //   前置答案（仓库是谁）缺失时不发完整初始化全文，改发该后端声明的缺仓指引；
    //   判据只读两样：仓库引用（会话/快照）与后端模块能力位（capabilities.repoCreateChain，有创仓链能力的后端才需先有仓库；无此能力位原样直注）。
    //   返回 { kind: 'setup' | 'repo', text }；失败一律回落旧行为。日志只记分支不记隐私。
    export const setupOrRepoPrompt = function (st, backendId) {
      const setupText = function () { try { return (typeof setupRunPrompt === 'function') ? setupRunPrompt(st, backendId) : '' } catch (e) { return '' } }
      try {
        let sel = backendId
        try {
          if (sel == null) {
            if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
            else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
          }
        } catch (e) {}
        let needsRepo = false
        try {
          const meta = (typeof moduleMetaOf === 'function' && sel != null) ? moduleMetaOf(st, sel) : null
          needsRepo = !!(meta && meta.capabilities && meta.capabilities.repoCreateChain)
        } catch (e) { needsRepo = false }
        let repo = null
        try { repo = (st && st.repository) || (st && st.snapshot && st.snapshot.repository) || null } catch (e) { repo = null }
        const hasRepo = !!(repo && (repo.owner || repo.name))
        try { console.log('[MattSkillsDeck] setup-inject decision needsRepo=' + needsRepo + ' hasRepo=' + hasRepo) } catch (e) {}
        if (needsRepo && !hasRepo) {
          let fix = ''
          try {
            const meta2 = (typeof moduleMetaOf === 'function' && sel != null) ? moduleMetaOf(st, sel) : null
            const pr = meta2 && meta2.prompts && meta2.prompts.repoRemoteFix
            if (pr) { const lg = (typeof promptLang === 'function') ? promptLang() : 'zh'; fix = String((lg === 'en' && pr.en) ? pr.en : (pr.zh || '')) }
          } catch (e) { fix = '' }
          if (fix) return { kind: 'repo', text: fix }
        }
      } catch (e) {
        try { console.warn('[MattSkillsDeck] setup-inject decision fallback: ' + String((e && e.message) || e).slice(0, 120)) } catch (_) {}
      }
      return { kind: 'setup', text: setupText() }
    }
    // Q2 #496：注入执行 + 待补标记（按工作区键隔离，建成后凭标记补发一次，仅一次）。
    export const injectSetupDecision = function (st, backendId) {
      let dec = null
      try { dec = (typeof setupOrRepoPrompt === 'function') ? setupOrRepoPrompt(st, backendId) : null } catch (e) { dec = null }
      if (!dec) { try { dec = { kind: 'setup', text: ((typeof setupRunPrompt === 'function') ? setupRunPrompt(st, backendId) : '') } } catch (e) { dec = { kind: 'setup', text: '' } } }
      try { st.pendingSetupAfterPublish = !!(dec && dec.kind === 'repo'); st.pendingSetupCwd = ((dec && dec.kind === 'repo' && st && st.cwd) ? st.cwd : '') } catch (e) {}
      try { console.log('[MattSkillsDeck] setup-inject applied kind=' + ((dec && dec.kind) || 'setup')) } catch (e) {}
      if (dec && dec.text) { try { inject(st, dec.text) } catch (e) {} }
      return (dec && dec.kind) || 'setup'
    }
    // Q2 #496：建仓成功处消费标记，补发一次初始化全文（标记按工作区键核对，不跨区）。
    export const consumePendingSetup = function (st) {
      try {
        if (st && st.pendingSetupAfterPublish && (!st.pendingSetupCwd || st.pendingSetupCwd === st.cwd)) {
          st.pendingSetupAfterPublish = false; st.pendingSetupCwd = ''
          const txt = (typeof setupRunPrompt === 'function') ? setupRunPrompt(st) : ''
          if (txt) { try { inject(st, txt) } catch (e) {} }
          try { console.log('[MattSkillsDeck] setup-inject reissued after repo ready (once)') } catch (e) {}
          return true
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
    // #595：正文格式契约后端单源 —— 后端在 src/host/tracker/backends/<id>/index.js 的 prompts.bodyFormat 里
    //   声明自己那套「正文怎么写、怎么写回」（{zh,en} 双语全文）；client 只按当前后端查表填空，零 backendId 字面量分支。
    //   查不到声明（未知/自定义后端）落注册表 bodyFormat 那一条（通用兜底版：只讲正文文件的写法，不点名任何跟踪器命令）。
    // 兜底：与注册表 bodyFormat 条目同一份文本，client 里不另留第二份字面量
    export const bodyFormatDefault = function () {
      const p = PROMPTS['bodyFormat'] || {}
      return String((promptLang() === 'en' && p.en) ? p.en : (p.zh || ''))
    }
    // 当前后端 id：st.selection → snapshot.selection → 按工作区缓存，三档都取不到就 null（无分支硬编码）
    export const currentBackendId = function (st) {
      let sel = null
      try {
        if (st && st.selection && st.selection.backendId != null) sel = st.selection.backendId
        else if (st && st.snapshot && st.snapshot.selection && st.snapshot.selection.backendId != null) sel = st.snapshot.selection.backendId
        else if (st && st.cwd && typeof getCachedSelection === 'function') { const cs = getCachedSelection(st.cwd); if (cs && cs.backendId != null) sel = cs.backendId }
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
    // #595 不静默：当前后端拿不到「正文格式」声明时，落通用兜底版之外还要给一条用户看得见的提示。
    //   只提示真正「拿不到」的两种情况：① 快照没把后端模块带过来（含 backendModules 为 null / 空数组 / 旧会话快照）；
    //   ② 该后端模块在快照里，却没有声明 prompts.bodyFormat。用户自选的其他后端（快照里没有这个 id）按设计走兜底，不提示。
    //   按后端 id 只提示一次，避免每次拼提示词都刷屏。
    const bodyFormatWarned = {}
    const notifyBodyFormatFallback = function (st, backendId) {
      const key = String(backendId)
      if (bodyFormatWarned[key]) return
      bodyFormatWarned[key] = true
      const msg = '当前后端「' + key + '」没带来「正文格式」声明，本次注入落到通用兜底版，可能缺少这个后端的写回步骤——请刷新面板重试；若仍然如此，说明该后端模块没有声明 prompts.bodyFormat'
      try { console.warn('[MattSkillsDeck] bodyFormat 降级：' + msg) } catch (e) {}
      try { if (st && typeof flash === 'function') flash(st, msg, 'warn') } catch (e) {}
    }
    // 正文格式契约全文（按当前后端 + 当前语言解析）
    export const bodyFormatText = function (st) {
      const backendId = currentBackendId(st)
      const dict = backendPromptFrom(st && st.backendModules, backendId, 'bodyFormat')
      const text = declaredLangPick(dict, promptLang())
      if (text) return text
      if (backendId != null && String(backendId) !== '') {
        const list = (st && Array.isArray(st.backendModules)) ? st.backendModules : null
        const known = list ? list.some(function (m) { return m && String(m.id) === String(backendId) }) : false
        if (!list || list.length === 0 || known) notifyBodyFormatFallback(st, backendId)
      }
      return bodyFormatDefault()
    }
    // 渲染参数：模板里声明的 {bodyFormat} / {subIssue} 都按当前后端解析（模板只留占位符名，不留字面副本）
    export const backendParamsFor = function (st, params) {
      const p = Object.assign({}, params || {})
      if (!Object.prototype.hasOwnProperty.call(p, 'bodyFormat')) p.bodyFormat = bodyFormatText(st)
      if (!Object.prototype.hasOwnProperty.call(p, 'subIssue')) p.subIssue = newWayfinderParamsFrom(st && st.backendModules, currentBackendId(st)).subIssue
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
    // T16：正文格式契约（写/改 issue 正文的动作统一追加；#595 起按当前后端取正文，不再全局一份 GitHub 文本）
    export const BODY_FORMAT = function (st) { return bodyFormatText(st) }
    // v4（#63 grilling 定版 2026-08-20）：去 wayfinder 内部规则复述（#63 想法1：prompt 不含已知规则，gh 硬编码解耦由 bodyFormat #62 承担）+ 字段集 4 项顺序实际→期望→复现→环境 + 形态括号单行（想法2：字段名（说明）：冒号即填，无悬行例行）
    //   字段集（第一性原理：Bug = 实际 vs 期望偏差，实际先于期望）：实际（吸收现象+影响范围）/ 期望 / 复现步骤（吸收背景+场景 preamble）/ 环境信息；zh 只中文、en 只英文，跟随 DSH 语言一次只出一种
    export const NEW_BUG_FIELDS_BODY = function () { return '\n\n实际（看到什么；可含影响范围）：\n期望（应发生什么 / 预期结果）：\n复现步骤（[前置 / 场景] + 编号步骤）：\n环境信息（OS + 浏览器 + 插件版本）：' }
    // v4（#63）：EN locale 版 —— 括号说明单行，跟随 v4 zh 实际→期望顺序
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

