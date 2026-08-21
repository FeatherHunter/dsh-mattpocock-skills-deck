# DSH-Waystation · Prompt 审阅清单（v1.12 · 方案A 注册表 · #64 v5 清单式 tpl.execute · #65 v4 清单式 tpl.diagnose · #66 v3 清单式 tpl.fix · #67 v3 清单式 tpl.discuss · #68 v5 清单式 mapExecute（标识头自包含 + 单行前缀）· #70 v2 质量导向 tpl.handoff1 · #71 v2 清单式 tpl.handoff2（单模板，删 handoffRead）· #74 v2 双轨安装 installSkills · #75 v3 进度契约 progress（压缩 3 条 + 格式正例 + 未确认不得 close）· #76 v3 正文格式 bodyFormat（工具无关 + 格式正例）· #77 G16 五片段全删（guide/grill/newMap/mapHead/stageGate）+ complete v5 自包含标识头 + newWayfinder v8 去契约引用 + tpl.diagnose v5 澄清段）

> **单源新架构**：真源 `src/client/kernel/prompts.js`，改后必跑 `node scripts/build.mjs` 生成 `client.js / package/lib/client.js`，勿手改产物（见 `docs/architecture/kernel-contract.md`）。动手前必读：`src/client/kernel/prompts.js` 头 20 行 + `docs/architecture/kernel-contract.md` + 跑 `node scripts/build.mjs 及 tests/verify-*`。
> PROMPTS 注册表（15 条）为**单一真相源**；zh/en 双语跟随 DSH 语言；{x} 占位符必须声明于 placeholders。
> 校验：`node tests/verify-prompts.js`（含 #64 清单式校验：`- [ ]` + 四段标题 + 无表格；#65 tpl.diagnose 清单式校验：`- [ ]` + 七段标题 + 无表格 + 诊断≠修复；#66 tpl.fix 清单式校验：`- [ ]` + 五段标题 + 无表格 + 两行复现/定位；#67 tpl.discuss 清单式校验；#68 mapExecute 清单式校验：`- [ ]` + 六段标题 + 无表格 + 标识头三字段 + 占位符 n/title/url + T13 闸门引用 + 单行前缀；#74 installSkills 硬校验：版本 ≥ v2 + zh/en 必含 ~/.agents/skills 与全部 10 个所需技能名；#75 progress 硬校验：版本 ≥ v3 + 格式正例 + 未确认不得 close + 首触补写；#76 bodyFormat 硬校验：版本 ≥ v3 + 工具无关（不得点名 gh）+ 去 JSON 黑话 + 格式正例；#77 G16 硬校验：注册表 15 条 + 五片段不得复活（guide/grill/newMap/mapHead/stageGate）+ STAGE_GATED_IDS/去重守卫不得残留 + complete v5（标识头三字段 + 占位符 n/title/url + 无 guide 引导句）+ newWayfinder v8（无「按建图规划契约」引用）+ tpl.diagnose v5（无「与 grill 片段同义」悬空括注））+ `node tests/verify-kernel.js`（产物新鲜度门禁）+ `node tests/verify-build-artifacts.js`（AUTO-GENERATED 门禁）+ `node tests/verify-bug-entry.js` + `node tests/verify-b2-map-newsession.js` + `node tests/verify-progress.js`（BODY_FORMAT 追加点 ×2：newWayfinder + newBugWayfinder；mapExecute/complete 自包含内嵌正文格式）。

## mapExecute · v5 — #68 清单式（A★ · map 标识头自包含 · 单行前缀 · 闸门一句引用）

- 用途：map 执行 / 新会话（未完成态）· 推进式 · 清单式（A★）
- 占位符：{n} / {title} / {url}（router 拼装传入；首行 `/wayfinder {url}` 单行空格分隔）
- ZH：

<pre>## 目标 map
- 编号：#{n}
- 标题：{title}
- 链接：{url}

请使用 wayfinder 技能推进该 map（遵循其规则）：

## 分析
- [ ] 加载 wayfinder 技能（如未加载）
- [ ] 分析这个 map：Destination / Notes / 阻塞关系 / 当前 frontier

## 选票
- [ ] 按第一性原理，选 frontier 中最值得推进的下一个 issue（价值最高 / 风险最低 / 最解阻）

## 执行
- [ ] 认领该票 → 读 Description / Notes / 阻塞关系 → 制定方案 → 实施 → 验收
- [ ] 若该票带 needs-triage：先按阶段闸门完成诊断（读现状 / 判断进展：真实 / 虚假 / 未动工）再进入实施，不许跳过

## 收尾
- [ ] 结束前按进度契约更新该票正文（## 进度：N% + 下一步）；验收通过 → 100% + close
- [ ] 若本次推进关闭了票：同步 map 记录（Decisions so far 追加 gist / 迷雾毕业 / Out of scope）

## 正文格式（写/改 issue 正文时必须遵守）
- [ ] 用真实换行书写：`## 章节` 独占一行，段落间留空行
- [ ] 禁止字面 \n 转义（不要把换行写成 \n 两个字符）、禁止正文以 BOM（\ufeff）开头
- [ ] 写回 issue 正文时用文件承载正文（真实换行），不要用 JSON/转义字符串内联拼装</pre>

- EN：

<pre>## Target map
- No: #{n}
- Title: {title}
- Link: {url}

Please use the wayfinder skill to advance this map (follow its rules):

## Analyze
- [ ] Load the wayfinder skill (if not loaded)
- [ ] Analyze this map: Destination / Notes / blocking relationships / current frontier

## Pick the ticket
- [ ] From first principles, pick the next issue on the frontier most worth advancing (highest value / lowest risk / most unblocking)

## Execute
- [ ] Claim the ticket → read Description / Notes / blocking relationships → plan → implement → verify
- [ ] If the ticket carries needs-triage: first complete the stage-gate diagnosis (read current state / judge progress: real / fake / not started) before implementation — do not skip

## Wrap-up
- [ ] Before finishing, update the ticket body per the progress contract (## Progress: N% + next step); verified → 100% + close
- [ ] If this advance closes any ticket, sync the map records (Decisions so far gist / fog graduation / Out of scope)

## Body format (mandatory when writing/editing an issue body)
- [ ] Use real newlines: each `## section` on its own line, blank line between paragraphs
- [ ] No literal \n escapes, no BOM (\ufeff) at the start
- [ ] Write via file-based input (real newlines), never inline JSON-escaped strings</pre>

---

## complete · v5 — #77（mapHead 自包含化 · 标识头三字段内联顶部 · 去 guide 引导句 · 占位符扩为 n/title/url/closed/total）

- 用途：map 完成态 · 完成调查（100% 却未 close 时排查真实原因 · 人来定夺）
- 占位符：{n} / {title} / {url} / {closed} / {total}（completePrompt 拼装传入；首行 `/wayfinder {url}` 单行空格分隔）
- ZH：

<pre>## 目标 map
- 编号：#{n}
- 标题：{title}
- 链接：{url}

## MAP完成确认

当前 map 显示 100% 完成：{closed}/{total} 个 issue 已关闭，但 map 本身仍 open。请先调查「为什么 100% 却未 close」，不要轻信数字、不要擅自 close。

## 调查（弄清 100% 是否真实、以及未 close 的真实原因）
- [ ] 任务是否真的完成：sub-issue 是否真正解决了原 Destination（而非只把 ticket 关了）？
- [ ] 排查与该 map 相关、但未建立 sub-issue 关系的 issue（关联工作可能没计入 {closed}/{total}）——如搜索提及该 map 编号/标题的 issue、核对相关标签等；
- [ ] 逐个核对 sub-issue 的完成状态与关闭状态是否一致（漏关/误开）：实际已完成却漏标 CLOSED，或未完成却标 CLOSED；
- [ ] 检查是否还有 Not yet specified 中未毕业的事项；
- [ ] 其他可能情况（如已真实完成只是忘了 close、计数与实际不符等）——自行排查，不限于上述清单；

## 报告你来定夺（人来定夺）
- [ ] 把调查结论整理成「发现 + 建议」报告给用户；
- [ ] 由用户决定下一步（收尾 close / 补齐遗漏 / 调整 map 记录 / 其他），不擅自 close、不擅自改 map 记录；

## 收尾
- [ ] 用户确认后，按用户意见执行（如需 close → close map + 在 Decisions so far 追加总结，每个 closed ticket 一行 gist）；
- [ ] 结束前按进度契约更新相关 issue 正文（## 进度：N% + 下一步）；调查中发现的进度不符（漏关/误开/仅差确认）据实标注（95% · 待确认 / 100% + close），不得显示为未动工；
- [ ] 若涉及 map 记录调整（Not yet specified / Out of scope）→ 按 wayfinder 规则同步，不重复展开；

## 正文格式（写/改 issue 正文时必须遵守）
- [ ] 用真实换行书写：每个 `## 章节` 独占一行，段落间留空行
- [ ] 禁止字面 \n 转义（不要把换行写成 \n 两个字符）、禁止正文以 BOM（\ufeff）开头
- [ ] 写回 issue 正文时以文件方式提交（文件内为真实换行），不要内联转义字符串
- [ ] 正例：`## 进度：90%` 独占一行，空行后接 `下一步：xxx`（反例：`## 进度：90%\n下一步：xxx`）</pre>

- EN：

<pre>## Target map
- No: #{n}
- Title: {title}
- Link: {url}

## MAP completion check

The map shows 100% complete: {closed}/{total} issues closed, but the map itself is still open. Investigate first why it is 100% but not closed — do not trust the numbers, do not close on your own.

## Investigate (determine whether the 100% is real, and the real reason it is not closed)
- [ ] Is the task really done: did the sub-issues actually resolve the original Destination (not just close the tickets)?
- [ ] Hunt for issues related to this map but not wired as sub-issues (related work may not be counted in {closed}/{total}) — e.g. search issues mentioning this map by number or title, check related labels, etc.;
- [ ] Check each sub-issue completion state vs close state (missed/erroneous close): actually done but not marked CLOSED, or not done but marked CLOSED;
- [ ] Check whether any ungraduated items remain in Not yet specified;
- [ ] Other possibilities (e.g. really done but forgot to close, count mismatch with reality, etc.) — investigate on your own, not limited to the list above;

## Report to you — human in the loop
- [ ] Summarize the investigation into a findings + recommendation report for the user;
- [ ] Let the user decide next steps (wrap-up close / fill gaps / adjust map records / other) — do not close on your own, do not change map records on your own;

## Wrap-up
- [ ] After the user confirms, act per the user-confirmed decision (if close → close the map + append a summary to Decisions so far, one-line gist per closed ticket);
- [ ] Before finishing, update relevant issue bodies per the progress contract (## Progress: N% + next step); progress mismatches found during investigation (missed/erroneous close / awaiting confirmation) → mark accordingly (95% · awaiting confirmation / 100% + close), never show as not started;
- [ ] If map-record adjustments are involved (Not yet specified / Out of scope) → sync per the wayfinder rules, without re-expanding;

## Body format (mandatory when writing/editing an issue body)
- [ ] Use real newlines: each `## section` on its own line, with a blank line between paragraphs
- [ ] No literal \n escapes (do not write newlines as the two characters backslash-n), no BOM (\ufeff) at the start
- [ ] Write the body back via a file (real newlines in the file), never an inline escaped string
- [ ] Example: `## Progress: 90%` on its own line, blank line, then `Next step: ...` (not `## Progress: 90%\nNext step: ...`)</pre>

---

## fixate · v2

- 用途：沉淀 · 思维对齐 · 成果沉淀
- 占位符：无
- ZH：

<pre>告一段落。暂停推进，执行「思维对齐 · 成果沉淀」，从第一性原理出发：

## 沉淀
- [ ] 全量复述：把我从会话开始到现在、我问过你并得到明确回答的内容，按五类逐条列出（每条 = 我问的问题 → 你的回答）：目的地 / 约束与偏好 / 已确认的决定 / 待决问题 / 雾区（隐约可见但还不清晰）
- [ ] 不压缩、不合并——宁可啰嗦不可省略；一次全部列完，不分批
- [ ] 每条标注出处：我的问题（短句）+ 你的原话关键短句（≤50 字，超出以省略号截断）+ 上下文提示（如主题/轮次），让我知道它来自哪

## 可疑遗漏
- [ ] 单列一节「可疑遗漏」：
  - [ ] 我问过、你已回答、但我未纳入上面清单的（第一优先级——防我漏记你已答的内容）
  - [ ] 你提过、但我判断与主线无关 / 太模糊 / 属执行细节而未纳入的
  - [ ] 每条写明我当时的判断理由，由你裁决纳入或放弃

## 核对
- [ ] 列完（含「可疑遗漏」）后停下，等我逐条核对；我确认或修正后，你再执行落盘

## 落盘
- [ ] 有明确对应 ticket（票）→ 全部成果写入该 ticket 正文的「## 对齐成果」节（新增或并入，含日期）；不写 map（地图）正文——map 是索引，成果归 ticket
- [ ] 无对应 ticket、但属于某 map → 写入 alignment note（对齐记录）`.scratch/alignment/<ts>-<短标题>.md`（相对当前工作目录；短标题 ≤10 字，用连字符或下划线代替空格），并在该 map 的 Notes 追加一行指针（路径 + 日期）
- [ ] 无 ticket 也无 map → 写入对齐记录文件，并告诉我完整路径；建图/建票时由接手会话搬入对应 ticket
- [ ] 属 map 层面的条目（如目的地/雾区调整）→ 照写进所选位置，条目末尾标注「map 层面，随建图搬入」

## 正文格式（写/改 issue 正文时必须遵守）
- [ ] 用真实换行书写：`## 章节` 独占一行，段落间留空行
- [ ] 禁止字面 \n 转义（不要把换行写成 \n 两个字符）、禁止正文以 BOM（\ufeff）开头
- [ ] 写回 issue 正文时用文件承载正文（真实换行），不要用 JSON/转义字符串内联拼装</pre>

- EN：

<pre>This phase wraps up here. Pause progress and run the "alignment & consolidation" pass, from first principles:

## Consolidate
- [ ] Restate everything I have explicitly answered since this session started, in five categories (each item = my question → your answer): Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)
- [ ] No compression, no merging — rather verbose than omitted; list everything in one go, no batching
- [ ] Annotate each item with its source: my question (short) + a key quote of your original words (≤50 chars, truncate with ellipsis if longer) + a context hint (e.g. topic/turn) so I know where it came from

## Suspected omissions
- [ ] Add a separate "Suspected omissions" section:
  - [ ] Questions I asked, you answered, but I did not include above (first priority — guard against forgetting your answers)
  - [ ] Things you mentioned but I judged off-topic, too vague, or execution detail and did not include
  - [ ] State my judgment reason for each; you decide whether to keep or drop

## Review
- [ ] Stop after listing (including "Suspected omissions") and wait for my item-by-item review; once I confirm or correct, you persist the list

## Persist
- [ ] If a corresponding ticket exists → write all outcomes into that ticket body (a new or merged "## Alignment outcomes" section, with date); do not write into the map body — the map is an index, outcomes belong to the ticket
- [ ] If no corresponding ticket but within a map → write an alignment note to `.scratch/alignment/<ts>-<short>.md` (relative to the current working directory; short ≤20 chars, hyphen or underscore instead of spaces), and append a one-line pointer (path + date) to the map Notes
- [ ] If no ticket and no map → write the alignment note and tell me the full path; when a map/ticket is created, the taking-over session migrates it into the corresponding ticket
- [ ] Map-level items (e.g. Destination/Fog adjustments) → still write them in the chosen place, and mark the item "map-level, migrate when the map is built"

## Body format (mandatory when writing/editing an issue body)
- [ ] Use real newlines: each `## section` on its own line, blank line between paragraphs
- [ ] No literal \n escapes, no BOM (\ufeff) at the start
- [ ] Write via file-based input (real newlines), never inline JSON-escaped strings</pre>

---

## progress · v3 — #75 grill 定版（压缩 3 条 · 格式正例 · 未确认不得 close）

- 用途：进度契约（所有动作 prompt 引用）
- 占位符：无
- ZH：

<pre>进度表达（每次动作结束前必须更新 —— 这是动作的一部分，不是可选项）：
1. 格式与写法：issue 正文维护固定进度区 `## 进度：N%`（N 为 0-100 整数，如 `## 进度：90%`；禁止「大概 / 基本」等模糊词）；更新前先读正文当前进度，按最新状态写真实当前值（可上调也可下调）；
2. 语义阶梯：0% = 未动工；1-94% = 进行中；95% = 已完成待用户确认（下一步必须写明待确认什么；未确认不得 close）；确认后立即写 100% 并 close；
3. 兜底：100% = 确认完成（close 后进度区保留为历史）；首次接触无进度区的票，先按现状补写一个与实施记录相符的进度。</pre>

- EN：

<pre>Progress expression (must update before finishing every action — it is part of the action, not optional):
1. Format & writing: keep a fixed progress section in the issue body: `## Progress: N%` (N is an integer 0-100, e.g. `## Progress: 90%`; no vague words like "about / basically"); before updating, read the current progress in the body and write the true current value based on the latest state (may go up or down);
2. The ladder: 0% = not started; 1-94% = in progress; 95% = done, awaiting user confirmation (the next step must state what exactly awaits confirmation; do not close before confirmation); once confirmed, immediately write 100% and close;
3. Fallbacks: 100% = confirmed done (the section stays as history after close); on first contact with a ticket lacking the section, write a progress matching its implementation record.</pre>

---

## bodyFormat · v3 — #76 grill 定版（工具无关 + 去 AI 黑话 + 格式正例；8 处同文：注册表 1 + 内嵌 7）

- 用途：正文格式契约（T16 · 写/改 issue 正文的动作统一携带：2 处追加 + 7 处内嵌）
- 占位符：无
- ZH：

<pre>正文格式（写/改 issue 正文时必须遵守）：
1. 用真实换行书写：每个 `## 章节` 独占一行，段落间留空行；
2. 禁止字面 \n 转义（不要把换行写成 \n 两个字符）、禁止正文以 BOM（\ufeff）开头；
3. 写回 issue 正文时以文件方式提交（文件内为真实换行），不要内联转义字符串。

正例（写成这样，而不是 `## 进度：90%\n下一步：xxx`）：
## 进度：90%

下一步：xxx</pre>

- EN：

<pre>Body format (mandatory when writing/editing an issue body):
1. Use real newlines: each `## section` on its own line, with a blank line between paragraphs;
2. No literal \n escapes (do not write newlines as the two characters backslash-n), no BOM (\ufeff) at the start;
3. Write the body back via a file (real newlines in the file), never an inline escaped string.

Example (write this, not `## Progress: 90%\nNext step: ...`):
## Progress: 90%

Next step: ...</pre>

## tpl.diagnose · v5 — #65 清单式（A★ · 全勾选框 · 无表格 · 诊断≠修复显式）+ #77 澄清段去悬空括注

- 用途：动作按钮「诊断」（needs-triage ticket）· 清单式
- 占位符：{url}
- ZH：

<pre>/triage
{url}

诊断这个 issue（遵循 /triage 技能自身规则，诊断≠修复——只弄清问题与分流，不直接改代码）：

## 弄清现象
- [ ] 现象是什么
- [ ] 影响范围是什么
- [ ] 复现步骤是什么（可复现则给出最小复现）

## 根因候选
- [ ] 列出多个根因候选，标注各自可能性/置信度

## 分流建议
- [ ] 给分流建议：修复 / 关闭 / 重设计 / 等待 — 建议是你的判断，不是执行许可（不要在诊断阶段直接改代码或关闭 ticket）

## 澄清
- [ ] 动手前若有「我猜用户想要这样」的地方，先用 grilling 技能澄清（不猜）

## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）
- [ ] 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段
- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）
- [ ] 诊断时判断当前进展：
  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）
  - [ ] 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断
  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）
- [ ] 诊断完成摘 needs-triage 后才允许进入实施阶段

## 收尾
- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步）

## 正文格式（写/改 issue 正文时必须遵守）
- [ ] 用真实换行书写：`## 章节` 独占一行，段落间留空行
- [ ] 禁止字面 \n 转义（不要把换行写成 \n 两个字符）、禁止正文以 BOM（\ufeff）开头
- [ ] 写回 issue 正文时用文件承载正文（真实换行），不要用 JSON/转义字符串内联拼装</pre>

- EN：

<pre>/triage
{url}

Diagnose this issue (follow the /triage skill own rules; diagnosis ≠ fix — clarify the problem and propose triage, do not fix code directly):

## Symptoms
- [ ] What are the symptoms
- [ ] What is the impact
- [ ] What are the repro steps (give minimal repro if reproducible)

## Root causes
- [ ] List multiple root-cause candidates with confidence

## Triage
- [ ] Propose triage: fix / close / redesign / wait — a recommendation, not a license to execute (do not fix code or close the ticket in this diagnosis)

## Clarify
- [ ] Before acting, if any part rests on a guess about what the user wants, settle it with the grilling skill first (do not guess)

## Stage gate (must read before starting — part of the action, not optional)
- [ ] First read the issue current state: progress (## Progress: N%) / existing implementation record / comments / labels — determine stage
- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)
- [ ] During diagnosis, judge progress:
  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (→ ready-for-agent)
  - [ ] Existing impl but fake/partial → revise progress back to true value (e.g. 30%) and continue diagnosing
  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into the issue)
- [ ] Only after diagnosis and needs-triage removed may implementation begin

## Wrap-up
- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step)

## Body format (mandatory when writing/editing an issue body)
- [ ] Use real newlines: each `## section` on its own line, blank line between paragraphs
- [ ] No literal \n escapes, no BOM (\ufeff) at the start
- [ ] Write via file-based input (real newlines), never inline JSON-escaped strings</pre>

---

## tpl.fix · v3 — #66 清单式（A★ · 全勾选框 · 无表格 · 两行复现/定位）

- 用途：动作按钮「修复」（bug 票）· 清单式
- 占位符：{url}
- ZH：

<pre>/implement
{url}

修复这个 bug（遵循 wayfinder 技能规则）：

## 读现状
- [ ] 已认领？若未认领，先认领
- [ ] 读 Description / Notes / 阻塞关系 / 评论 / 标签 / 进度区（## 进度：N%），确认现象与验收标准

## 定位与修复
- [ ] 先复现（可复现则给出最小复现）
- [ ] 再定位根因（修错地方 = 白修）；若目标不清或有假设 → 用 grilling 技能澄清（不猜）
- [ ] 制定方案 → 实施修复 → 加测试并跑通
- [ ] 对抗式自查：边界 / 异常分支 / 回归影响 / 并发与旧数据（我会漏在哪里？逐项打勾）

## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）
- [ ] 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段
- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）
- [ ] 诊断时判断当前进展：
  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）
  - [ ] 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断
  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）
- [ ] 诊断完成摘 needs-triage 后才允许进入实施阶段

## 收尾
- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步）；修复完成但未验收 → 95% · 待确认，确认后 100% + close

## 正文格式（写/改 issue 正文时必须遵守）
- [ ] 用真实换行书写：`## 章节` 独占一行，段落间留空行
- [ ] 禁止字面 \n 转义（不要把换行写成 \n 两个字符）、禁止正文以 BOM（\ufeff）开头
- [ ] 写回 issue 正文时用文件承载正文（真实换行），不要用 JSON/转义字符串内联拼装</pre>

- EN：

<pre>/implement
{url}

Fix this bug (follow the wayfinder skill rules):

## Read current state
- [ ] Claimed? Claim first if unclaimed
- [ ] Read Description / Notes / blocking relationships / comments / labels / progress (## Progress: N%) — confirm symptoms & acceptance criteria

## Locate & fix
- [ ] Reproduce first (give minimal repro if reproducible)
- [ ] Then locate root cause (fixing the wrong spot is wasted work); if goal unclear or any assumption → clarify with grilling (do not guess)
- [ ] Plan → implement fix → add tests and get them green
- [ ] Adversarial self-check: boundaries / error branches / regression impact / concurrency & legacy data (where did I miss? check each)

## Stage gate (must read before starting — part of the action, not optional)
- [ ] First read the issue current state: progress (## Progress: N%) / existing implementation record / comments / labels — determine stage
- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)
- [ ] During diagnosis, judge progress:
  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (→ ready-for-agent)
  - [ ] Existing impl but fake/partial → revise progress back to true value (e.g. 30%) and continue diagnosing
  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into the issue)
- [ ] Only after diagnosis and needs-triage removed may implementation begin

## Wrap-up
- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step; fix done unverified → 95% awaiting confirmation)

## Body format (mandatory when writing/editing an issue body)
- [ ] Use real newlines: each `## section` on its own line, blank line between paragraphs
- [ ] No literal \n escapes, no BOM (\ufeff) at the start
- [ ] Write via file-based input (real newlines), never inline JSON-escaped strings</pre>

---

## tpl.discuss · v3 — #67 清单式（A★ · 全勾选框 · 无表格 · 人来定夺）

- 用途：动作按钮「讨论」（grilling 票）· 清单式
- 占位符：{url}
- ZH：

<pre>/grill-me
{url}

这个 issue 需要讨论定夺，用 grilling 技能和我对话（遵循 grilling 技能自身规则）：

## 讨论聚焦
- [ ] 围绕目标 / 边界 / 风险 / 选项权衡 / 决策 五要素展开（齐且不冗，不额外扩散）

## 人来定夺
- [ ] 不替我做决定，等我确认结论再落盘

## 结论落盘
- [ ] 有结论时写进 issue 正文；需长期留存则另建议落成新 tickets / 决策记录（正文为首，tickets 为辅，不散落）

## 澄清
- [ ] 有“我猜用户想要这样”的地方，先用 grilling 澄清，不猜

## 收尾
- [ ] 结束前按进度契约更新 issue 正文（## 进度：N% + 下一步）

## 正文格式（写/改 issue 正文时必须遵守）
- [ ] 用真实换行书写：\## 章节\ 独占一行，段落间留空行
- [ ] 禁止字面 \\\\n 转义（不要把换行写成 \\\\n 两个字符）、禁止正文以 BOM（\\ufeff）开头
- [ ] 写回 issue 正文时用文件承载正文（真实换行），不要用 JSON/转义字符串内联拼装</pre>

- EN：

<pre>/grill-me
{url}

This issue needs discussion before a decision — use the grilling skill to talk with me (follow the grilling skill own dialogue rules):

## Focus
- [ ] Cover goal / boundary / risks / options-tradeoffs / decision — all five, no more, no less (keep complete and concise, no extra expansion)

## Human in the loop
- [ ] Do not decide for me; wait for my confirmation before persisting conclusions

## Persist conclusion
- [ ] When a conclusion emerges, write it into the issue body; if it needs durable memory, additionally propose a new ticket / decision record (body is primary, ticket/record is auxiliary — no scattering)

## Clarify
- [ ] Before acting, if any part rests on a guess about what I want, settle it with grilling first (do not guess)

## Wrap-up
- [ ] Update the issue body per the progress contract before finishing (## Progress: N% + next step)

## Body format (mandatory when writing/editing an issue body)
- [ ] Use real newlines: each \## section\ on its own line, blank line between paragraphs
- [ ] No literal \\\\n escapes, no BOM (\\ufeff) at the start
- [ ] Write via file-based input (real newlines), never inline JSON-escaped strings</pre>

---

## tpl.execute · v5 — #64 清单式（A★ · 全勾选框 · 无表格）

- 用途：动作按钮「执行」（普通票）· 清单式
- 占位符：{url}
- ZH：

<pre>/wayfinder
{url}

执行这个 issue（遵循 wayfinder 技能规则）：

## 读现状
- [ ] 已认领？若未认领，先认领
- [ ] 读 Description / Notes / 阻塞关系 / 评论 / 标签 / 进度区（## 进度：N%），确认交付物与验收标准

## 执行
- [ ] 目标不清或需用户定夺 → 用 grilling 技能澄清（不猜）
- [ ] 制定方案 → 实施 → 按验收标准自查（对抗式）

## 阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）
- [ ] 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段
- [ ] 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）
- [ ] 诊断时判断当前进展：
  - [ ] 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）
  - [ ] 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断
  - [ ] 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）
- [ ] 诊断完成摘 needs-triage 后才允许进入实施阶段

## 收尾
- [ ] 完成且通过验收 → 100% + close；未完成 → 按进度契约如实更新（含下一步）
- [ ] 若执行后关闭了该票：在所属 map 的 Decisions so far 追加一行 gist（票名 + 链接 + 一句话结论）

## 正文格式（写/改 issue 正文时必须遵守）
- [ ] 用真实换行书写：`## 章节` 独占一行，段落间留空行
- [ ] 禁止字面 \n 转义（不要把换行写成 \n 两个字符）、禁止正文以 BOM（\ufeff）开头
- [ ] 写回 issue 正文时用文件承载正文（真实换行），不要用 JSON/转义字符串内联拼装</pre>

- EN：

<pre>/wayfinder
{url}

Execute this issue (follow the wayfinder skill rules):

## Read current state
- [ ] Claimed? Claim first if unclaimed
- [ ] Read Description / Notes / blocking relationships / comments / labels / progress (## Progress: N%) — confirm deliverable & acceptance criteria

## Execute
- [ ] If goal unclear or needs user call → clarify with grilling (do not guess)
- [ ] Plan → implement → self-check against acceptance criteria (adversarial)

## Stage gate (must read before starting — part of the action, not optional)
- [ ] First read the issue current state: progress (## Progress: N%) / existing implementation record / comments / labels — determine stage
- [ ] If it carries needs-triage: diagnosis MUST be done first (do not skip to implementation)
- [ ] During diagnosis, judge progress:
  - [ ] Existing impl and real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (→ ready-for-agent)
  - [ ] Existing impl but fake/partial → revise progress back to true value (e.g. 30%) and continue diagnosing
  - [ ] Not started → normal diagnosis (reproduce → root cause → plan → write into the issue)
- [ ] Only after diagnosis and needs-triage removed may implementation begin

## Wrap-up
- [ ] Done & verified → 100% + close; otherwise update honestly per progress contract (with next step)
- [ ] If this execution closes the ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion)

## Body format (mandatory when writing/editing an issue body)
- [ ] Use real newlines: each `## section` on its own line, blank line between paragraphs
- [ ] No literal \n escapes, no BOM (\ufeff) at the start
- [ ] Write via file-based input (real newlines), never inline JSON-escaped strings</pre>

---

## tpl.handoff1 · v3

- 用途：交接第一击（写交接文档）
- 占位符：{ts}
- ZH：

<pre>/handoff 把当前会话生成交接文档，写到 .scratch/handoff/{ts}-<短标题>.md（相对当前工作目录）。<短标题> 是你给这次交接起的一个简短标题（中文 ≤10 字 / 英文 ≤20 字符，跟随当前会话语言，用连字符或下划线代替空格），让人一眼认出这是哪件事的交接。

交接文档是给一个没有本次会话记忆的 agent 接手的——请站在它的视角，确保它能凭文档无缝继续，而不是靠猜或回翻本次会话。从第一性原理出发。</pre>

- EN：

<pre>/handoff Create a handoff doc from this session, written to .scratch/handoff/{ts}-<short>.md (relative to the current working directory). <short> is a brief title you give this handoff (zh ≤10 chars / en ≤20 chars, in the current session language, use hyphen or underscore instead of spaces) so a human can tell at a glance what it is about.

This doc is for an agent with no memory of this session — write from its perspective, so it can continue seamlessly without guessing or revisiting this session. Approach from first principles.</pre>

---

## tpl.handoff2 · v3

- 用途：交接第二击（读交接文档）
- 占位符：{path}（绝对路径，含 {file} 文件名）
- ZH：

<pre>请阅读 {path}（上一会话生成的交接文档），复述你的理解后再继续推进：

## 复述理解
- [ ] 结论：本会话已确认的决定与成果
- [ ] 未完成事项：下一步要继续的事
- [ ] 建议 skill：新会话接手时应加载的技能
- [ ] 把以上三点复述给我；若有遗漏或不确定 → 先问我确认，不猜

## 继续推进
- [ ] 从第一性原理出发，继续完成未完成事项</pre>

- EN：

<pre>Read the handoff doc {path} (from the previous session), restate your understanding, then continue:

## Restate understanding
- [ ] Conclusions: decisions and outcomes confirmed this session
- [ ] Unfinished: what to continue next
- [ ] Suggested skills: skills the new session should load
- [ ] Restate the three points to me; if anything is missing or uncertain → ask me first, do not guess

## Continue
- [ ] From first principles, continue with the unfinished work</pre>

---

## installSkills · v2 — #74 双轨安装（npx 官方安装器优先 + 克隆复制回退）· 幂等守卫 · 10 哨兵清单

- 用途：技能安装引导 · DSH 专用（横幅 / 引导 g4 / 设置页复制）
- 占位符：无
- ZH：

<pre>请为 DSH 安装 Matt Pocock 的 skills 技能套件（mattpocock/skills）：

1. 先检查：确认 ~/.agents/skills 下这 10 个技能已全部就位：wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills。已全部就位 → 直接汇报已装技能清单并结束，不要重复安装；
2. 有缺失则安装：优先用官方安装器 `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y`（安装器未列出 DSH，但 `-a cline` 的全局目录恰为 ~/.agents/skills，与 DSH 读取目录一致；`--copy` 用复制而非符号链接，防 npx 缓存清理后断链）；若无 npx 或安装失败，回退：克隆 https://github.com/mattpocock/skills，把 skills/engineering 与 skills/productivity 目录下的全部技能复制到 ~/.agents/skills；
3. 安装目标是 DSH 读取的用户级技能目录：~/.agents/skills —— 不要装进其他工具的技能目录（如 ~/.claude/skills）；
4. 安装后复验：第 1 步的 10 个技能已全部就位；
5. 完成后汇报安装结果与已装技能清单。</pre>

- EN：

<pre>Install the Matt Pocock skills collection (mattpocock/skills) for DSH:

1. Check first: confirm these 10 skills are all present under ~/.agents/skills: wayfinder / triage / grilling / grill-me / implement / ask-matt / research / prototype / handoff / setup-matt-pocock-skills. If all are present, report the installed skill list and stop — do not reinstall;
2. If any are missing, install: prefer the official installer `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y` (the installer does not list DSH, but `-a cline` installs globally into ~/.agents/skills — the same directory DSH reads; `--copy` copies instead of symlinking so npx cache cleanup cannot break the links); if npx is unavailable or fails, fall back: clone https://github.com/mattpocock/skills and copy all skills from skills/engineering and skills/productivity into ~/.agents/skills;
3. Install into the user-level skill directory DSH reads: ~/.agents/skills — do not install into the skill directories of other tools (e.g. ~/.claude/skills);
4. After install, re-verify: all 10 skills from step 1 are in place;
5. When done, report the result and the installed skill list.</pre>

---

## setupRun · v7

- 用途：环境检查横幅 · setup 未执行按钮（仅初始化记录配置，不安装/克隆技能）
- 占位符：无
- ZH：

<pre>/setup-matt-pocock-skills

初始化本仓库配置（技能套件已安装；本命令仅记录 issue tracker / 标签词汇 / 文档路径，不安装、不克隆任何技能）：
1. 按技能流程选择 issue tracker：本仓库为 GitHub → 提议 GitHub Issues，由用户确认；
2. 初始化时按 setup-matt-pocock-skills 技能自身流程执行（issue tracker 选择 GitHub Issues；triage 标签保留默认五角色），并确保仓库中技能所需标签齐全（triage 五角色 + wayfinder 标签 wayfinder:map / research / prototype / grilling / task），不要只建少数几个；后续打标签严格遵循技能规则，不额外强制任何标签；
3. 完成后核对技能真实产物：docs/agents/issue-tracker.md + triage-labels.md + domain.md 及 AGENTS.md 的 ## Agent skills 块；再复查环境检查（setup 变绿）。</pre>

- EN：

<pre>/setup-matt-pocock-skills

Bootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths — it does not install or clone any skills):
1. Follow the skill flow to pick the issue tracker: this repo is on GitHub → propose GitHub Issues, confirm with the user;
2. During init, follow the setup-matt-pocock-skills skill own flow (choose GitHub Issues as the tracker; keep the default triage-role labels), and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) — not just a few; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;
3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green).</pre>

---

## newWayfinder · v8 — #77（去「按建图规划契约」名称引用 · 改直述新建 map · 建图结构交由 wayfinder 技能本体）

- 用途：「+ 新建需求」按钮
- 占位符：{repo}
- ZH：

<pre>/wayfinder
请帮我处理一个需求（严格遵循 wayfinder 技能规则）。
仓库（已自动填入当前工作区）：{repo}

收到需求后按以下流程：
1. 先澄清：对目标 / 范围 / 偏好有假设时，先用 grilling 技能澄清，不默认；
2. 判断分类（按需求粒度 / 建图粒度）——先查仓库已有 wayfinder:map 和 issue，确认是否做过：
   - 新增：全新需求，之前没做过 → 新建 map（Destination + Notes + plan + tickets；tickets 须以 sub-issue 关联到 map，blocking 用 Blocked by: #<n> 行表示）；
   - 复用：这个需求之前已做过（已有 map / issue）→ 打开复用它，不重复建；
   - 直接实现：需求很小 → 建一个 issue 直接实现，不建大 map；
3. 执行后按进度契约更新。</pre>

- EN：

<pre>/wayfinder
Please handle a requirement (strictly follow the wayfinder skill rules).
Repo (auto-filled from current workspace): {repo}

After receiving the requirement, follow this flow:
1. Clarify first: if you hold assumptions about the goal / scope / preferences, settle them with the grilling skill, never assume;
2. Decide the case (by requirement / map granularity) — first check existing wayfinder:map and issues in the repo to confirm whether it has been done:
   - Add: a brand-new requirement never done before → build a new map (Destination + Notes + plan + tickets; wire tickets as sub-issues of the map, blocking as `Blocked by: #<n>`);
   - Reuse: this requirement has been done before (existing map / issue) → open and reuse it, do not build a new one;
   - Directly implement: the requirement is small → create a single issue and implement it directly, no big map;
3. Update per the progress contract after execution.</pre>

---

## newBugWayfinder · v4 — #63 grilling 定版（去内部规则+实际→期望+括号单行）

- 用途：「+ 新增BUG单」按钮 / 状态栏 BUG 悬停菜单「新增」（issue #4 · v2 修 #1 BUG3：输入位移到末尾 · v3 #14：精简为 4 字段 · v4 #63：去内部规则+实际→期望+括号单行）
- 占位符：{repo}
- ZH：

<pre>/wayfinder
请帮我新增一个 BUG 单（按 wayfinder 技能规则处理）。
仓库：{repo}</pre>

- EN：

<pre>/wayfinder
Please help me file a new BUG ticket (follow the wayfinder skill rules).
Repo: {repo}</pre>

- 追加字段（NEW_BUG_FIELDS_BODY · 跟随 promptLang，一次只出一种）：
  - ZH：`实际（看到什么；可含影响范围）：\n期望（应发生什么 / 预期结果）：\n复现步骤（[前置 / 场景] + 编号步骤）：\n环境信息（OS + 浏览器 + 插件版本）：`
  - EN：`Actual (what happened; may include impact):\nExpected (what should happen / expected result):\nReproduction ([Preamble / Scenario] + numbered steps):\nEnvironment (OS + browser + plugin version):`
  - 拼接：`promptText('newBugWayfinder') + BODY_FORMAT + (en?EN:ZH)`，字段在末尾，顺序实际→期望

---

---

> 共 15 条 · 键：mapExecute / complete / fixate / progress / bodyFormat / tpl.diagnose / tpl.fix / tpl.discuss / tpl.execute / tpl.handoff1 / tpl.handoff2 / installSkills / setupRun / newWayfinder / newBugWayfinder
