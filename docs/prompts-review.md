# DSH-Waystation · Prompt 审阅清单（v1.5 · 方案A 注册表）

> PROMPTS 注册表（client.js §prompts · 20 条）为**单一真相源**；zh/en 双语跟随 DSH 语言；{x} 占位符必须声明于 placeholders。
> 校验：`node tests/verify-prompts.js`（占位符契约 + 双源键一致 + T13 阶段闸门契约：stageGate 条目 / 版本号 bump / 诊断·修复·执行与 map 推进接线）。

## guide · v1

- 用途：统一引导句（追加于各动作 prompt 末尾）
- 占位符：无
- ZH：

<pre>从第一性原理出发完成任务，并对抗式审查。</pre>

- EN：

<pre>Approach tasks from first principles, and review adversarially.</pre>

---

## mapExecute · v4

- 用途：map 执行 / 新会话（未完成态）· 推进式
- 占位符：无
- ZH：

<pre>请按以下流程推进该 map（遵循 wayfinder 技能规则）：
1. 加载 wayfinder 技能（如未加载）；
2. 分析这个 map（Destination / Notes / 阻塞关系 / 当前 frontier）；
3. 按第一性原理分析当前最适合推进的下一个 issue（frontier 中价值最高、风险最低、最解阻的）；
4. 去执行它：先认领 → 读该 issue 的 Description / Notes / 阻塞关系 → 制定方案 → 实施 → 验收；
5. 结束前按进度契约更新该 issue 正文（## 进度：N% + 下一步）；本次推进完成且验收通过 → 100% + close。
若本次推进有关闭的票：按 wayfinder 规则同步 map 记录（Decisions so far 追加 gist / 迷雾毕业 / Out of scope）。</pre>

- EN：

<pre>Please advance this map:
1. Load the wayfinder skill (if not loaded);
2. Analyze this map (Destination / Notes / blocking relationships / current frontier);
3. From first principles, pick the most valuable next issue on the frontier (highest value, lowest risk, most unblocking);
4. Go execute it: read the issue Description / Notes / blocking relationships → plan → implement → verify.

Approach tasks from first principles, and review adversarially.
If this advance closes any ticket, sync the map records per wayfinder rules (Decisions so far gist / fog graduation / Out of scope).</pre>

---

## complete · v3

- 用途：map 完成态 · 完成确认（收尾 close / 列遗漏）
- 占位符：{n} / {closed} / {total}
- ZH：

<pre>## 完成确认 · MAP #{n}

当前地图显示 100% 完成：{closed}/{total} 个 issue 已关闭，但 map 本身仍 open。

请按以下流程处理：

1. 检查完成状态是否真实：{closed}/{total} 已 CLOSED —— 但 map 本身仍 OPEN。请检查：
   - 子票是否真的解决了原 Destination？
   - 是否还有 Not yet specified 中未毕业的事项？
   - 实际已完成却漏标 CLOSED 的 issue（漏关/误开）—— 逐个核对 ticket 的完成状态与关闭状态是否一致；
   - 是否有 issue 属于该 map 但未建立 sub-issue 关系；
2. 确认后处理：
   - 确实全部完成 → 调用 close + 在 Decisions so far 追加总结（每个 closed ticket 一行 gist）；
   - 发现遗漏 → 列出未完成项，先解决再重新判断；
   - 不确定 → 询问用户「该地图的全部工作是否已完成，需要做收尾吗？」不要擅自 close；
3. 最终目标：要么 close map + 写 Decisions so far 总结，要么明确指出未完成项。

从第一性原理出发完成任务，并对抗式审查。
收尾规则：已实施完成、测试绿、仅差用户确认的票 —— 已确认则 close，未确认则标注「进度 100% · 待验收」，不得显示为未动工。
维护地图记录（wayfinder 规则）：
- 关闭一张票时，在所属 map 的 Decisions so far 追加一行 gist（票名 + 链接 + 一句话结论）；
- 检查 map 的 Not yet specified：可明确的事项毕业为新票（create-then-wire），并从迷雾节清除；
- 越出目的地范围的票 → 移入 Out of scope（写明原因），不留在 frontier。</pre>

- EN：

<pre>## Completion check · MAP #{n}

The map shows 100% complete: {closed}/{total} issues closed, but the map itself is still open.

Handle it as follows:

1. Verify the completion is real: {closed}/{total} are CLOSED — but the map is still OPEN. Check:
   - Did the sub-issues really resolve the original Destination?
   - Are there ungraduated items left in Not yet specified?
   - Any issue actually completed but missing CLOSED (missed/erroneous) — verify each ticket completion vs close state;
   - Any issue belonging to this map without a sub-issue relationship;
2. Then act:
   - All truly done → close the map + append a summary to Decisions so far (one-line gist per closed ticket);
   - Gaps found → list the unfinished items, resolve them first, then re-judge;
   - Unsure → ask the user \\"Has all the work on this map been completed? Should we wrap up?\\" — do not close on your own;
3. Goal: either close the map + write the Decisions-so-far summary, or clearly list the unfinished items.

Approach tasks from first principles, and review adversarially.
Maintain map records (wayfinder rules):
- When closing a ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion);
- Check the map Not yet specified: graduate specifiable items into new tickets (create-then-wire) and clear them from the fog section;
- Tickets beyond the destination scope → move to Out of scope (with reason), never left on the frontier.</pre>

---

## fixate · v1

- 用途：沉淀 · 零丢失快照
- 占位符：无
- ZH：

<pre>里程碑固化点。暂停推进，执行「零丢失快照」，从第一性原理出发：

1. 全量复述：把我从会话开始到现在说过的全部信息，按「目的地 / 约束与偏好 / 已确认的决定 / 待决问题 / 雾区（隐约可见但还不清晰）」五类，逐条列出——不压缩、不合并，宁可啰嗦不可省略。
2. 每条后面标注出处：用我的原话引用，让我知道它来自我哪句话。
3. 单独列一节「可疑遗漏」：凡是我提过、但你觉得与主线无关、太模糊或像执行细节而没纳入的，全部摆出来，写明你当初不纳入的理由，由我裁决。
4. 列完后停下等我逐条核对。我确认或修正完毕后，你再把清单落盘：已有地图就写进 map 正文和对应 ISSUE；只有ISSUE就写进对应ISSUE；都没有就先生成一份快照笔记并告诉我存哪，等建图时搬入。</pre>

- EN：

<pre>Milestone checkpoint. Pause progress and take a "zero-loss snapshot", from first principles:

1. Restate everything I have said since the session started, in five categories: "Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)" — list every item, no compression, no merging, rather verbose than omitted.
2. Annotate each item with its source: quote my original words so I know which sentence it came from.
3. Add a separate "Suspected omissions" section: everything I mentioned but you deemed off-topic, too vague, or execution detail and did not include — list them all with your reason, and let me decide.
4. Stop and wait for my item-by-item review after listing. Once I confirm or correct, persist the list: if a map exists, write into the map body and the corresponding ISSUEs; if only ISSUEs, write into those ISSUEs; if neither, create a snapshot note and tell me where it is, to migrate when a map is created.</pre>

---

## progress · v1

- 用途：进度契约（所有动作 prompt 引用）
- 占位符：无
- ZH：

<pre>进度表达（每次动作结束前必须更新 —— 这是动作的一部分，不是可选项）：
1. issue 正文维护固定进度区：`## 进度：N%`（N 为 0-100 整数，禁止「大概 / 基本」等模糊词）；
2. 更新前先读正文当前进度，基于最新状态写真实当前值（可上调也可下调）；
3. 未动工 = 0%；进行中 = 1-94%；95% = 已完成待用户确认（下一步注明「待确认什么」）；确认后立即写 100% 并 close；
4. 100% = 确认完成（close 后进度区保留为历史）；
5. 首次接触无进度区的票：先按现状补写一个与实施记录相符的进度。</pre>

- EN：

<pre>Progress expression (must update before finishing every action — it is part of the action, not optional):
1. Keep a fixed progress section in the issue body: `## 进度：N%` (N is an integer 0-100; no vague words like "about / basically");
2. Before updating, read the body current progress and write the true current value based on the latest state (can go up or down);
3. Not started = 0%; in progress = 1-94%; 95% = done, awaiting user confirmation (note "what is pending" in the next step); once confirmed, immediately write 100% and close;
4. 100% = confirmed done (the section stays as history after close);
5. On first contact with a ticket lacking the section, write a progress matching its implementation record.</pre>

---

## bodyFormat · v1

- 用途：正文格式契约（T16 · 统一追加于 map/ticket 写正文的动作）
- 占位符：无
- ZH：

<pre>正文格式（写/改 issue 正文时必须遵守）：
1. 用真实换行书写：`## 章节` 独占一行，段落间留空行；
2. 禁止字面 \
 转义（不要把换行写成 \
 两个字符）、禁止正文以 BOM（\\ufeff）开头；
3. 写回 issue 正文用 gh issue edit --body-file <文件>（文件内为真实换行），不要用 JSON 转义字符串拼进命令。</pre>

- EN：

<pre>Body format (mandatory when writing/editing an issue body):
1. Use real newlines: each `## section` on its own line, blank line between paragraphs;
2. No literal \
 escapes (do not write newlines as the two characters backslash-n), no BOM (\\ufeff) at the start;
3. Write issue bodies with gh issue edit --body-file <file> (real newlines in the file), never a JSON-escaped string inline in a command.</pre>

---

## grill · v1

- 用途：澄清规则（grilling 技能）
- 占位符：无
- ZH：

<pre>动手前先想一下：我要做的事里，有没有哪部分是「我猜用户想要这样」的？如果有，别猜 —— 用 grilling 技能把猜的地方问清楚再动手。</pre>

- EN：

<pre>Before you start, check: is any part of what you are about to do based on a guess about what the user wants? If so, do not guess — use the grilling skill to settle those guesses before acting.</pre>

---

## newMap · v1

- 用途：建图规划契约
- 占位符：无
- ZH：

<pre>建图前先完成（写入 map body 既有章节，遵循 wayfinder 技能规则）：
0. 先用 grilling 澄清目的地与范围，不自己定 scope；
1. 并行 / 串行：在 Notes 用一句话概括「哪些票串行（被阻塞）、哪些可并行」；
2. 已知 / 待调查 / 迷雾：已确认 → Decisions so far；待调查 → 建票；模糊待定 → Not yet specified（迷雾区，后续毕业为新票）；
3. 归属：每张票声明建议 owner（agent 或人 · HITL），grilling 类必须标 HITL；
4. 每张新建票写入 `## 进度：0%` 基准。</pre>

- EN：

<pre>Complete before building a map (write into the map body existing sections, follow the wayfinder skill rules):
0. Clarify the destination and scope with grilling first; do not set scope yourself;
1. Parallel / serial: summarize in Notes in one sentence "which tickets are serial (blocked) and which run in parallel";
2. Known / to-investigate / fog: confirmed → Decisions so far; to investigate → create tickets; vague pending → Not yet specified (the fog zone, later graduating into new tickets);
3. Ownership: declare a suggested owner per ticket (agent or human · HITL); grilling tickets must be marked HITL;
4. Write a `## 进度：0%` baseline into every new ticket.</pre>

---

## tpl.diagnose · v3

- 用途：动作按钮「诊断」（needs-triage 票）
- 占位符：{url}
- ZH：

<pre>/triage
{url}

诊断这个 issue（诊断流程遵循 /triage 技能自身规则）：
1. 先弄清它到底出了什么问题（现象 / 影响范围 / 复现步骤）；
2. 列出可能的根因（多个候选，标注各自可能性）；
3. 给分流建议（修复 / 关闭 / 重设计 / 等待）—— 建议是你的判断，不是让你直接执行；
4. 动手前若有「我猜用户想要这样」的地方，先用 grilling 技能澄清；
5. 结束前按进度契约更新 issue 正文。</pre>

- EN：

<pre>/triage
{url}

Diagnose this issue (follow the /triage skill own rules):
1. Pin down what is actually wrong (symptoms / impact / repro steps);
2. List possible root causes (multiple candidates, with confidence);
3. Propose triage (fix / close / redesign / wait) — a recommendation for the user, not a license to execute;
4. Before acting, if any part rests on a guess about what the user wants, settle it with the grilling skill first;
5. Update the issue body per the progress contract before finishing.</pre>

---

## tpl.fix · v2

- 用途：动作按钮「修复」（bug 票）
- 占位符：{url}
- ZH：

<pre>/implement
{url}

修复这个 bug（遵循 wayfinder 技能规则）：
1. 先复现，再定位根因（修错地方 = 白修）；
2. 实施修复；
3. 加测试并跑通；
4. 对抗式审查自己的改动（我会漏在哪里？）；
5. 有假设先用 grilling 技能澄清，不默认；
6. 结束前按进度契约更新（修复完成但未验收 → 95% · 待确认）。</pre>

- EN：

<pre>/implement
{url}

Fix this bug (follow the wayfinder skill rules):
1. Reproduce it first, then find the root cause (fixing the wrong spot is wasted work);
2. Implement the fix;
3. Add tests and get them green;
4. Adversarially review your own change (where did I miss?);
5. Settle assumptions with the grilling skill first, never assume;
6. Update per the progress contract before finishing (fix done, unverified → 95% · awaiting confirmation).</pre>

---

## tpl.discuss · v2

- 用途：动作按钮「讨论」（grilling 票）
- 占位符：{url}
- ZH：

<pre>/grill-me
{url}

这个 issue 需要讨论定夺，用 grilling 技能和我对话（对话方式遵循 grilling 技能自身规则）：
1. 讨论围绕目标 / 边界 / 风险 / 选项权衡 / 决策；
2. 不替我做决定，等我确认结论；
3. 讨论有结论时，把结论写进 issue 正文（或建议落成票 / 决策记录）；
4. 结束前按进度契约更新。</pre>

- EN：

<pre>/grill-me
{url}

This issue needs discussion before a decision — use the grilling skill to talk with me (follow the grilling skill own dialogue rules):
1. Keep the discussion on goal / boundary / risks / options-tradeoffs / decision;
2. Do not decide for me; wait for my confirmation of conclusions;
3. When a conclusion emerges, write it into the issue body (or propose it as a ticket / decision record);
4. Update per the progress contract before finishing.</pre>

---

## tpl.execute · v4

- 用途：动作按钮「执行」（普通票）
- 占位符：{url}
- ZH：

<pre>/wayfinder
{url}

执行这个 issue（遵循 wayfinder 技能规则）：
1. 先认领（若未认领）；读 Description / Notes / 阻塞关系，确认它到底要交付什么；
2. 若目标不清或需要用户定夺 → 先用 grilling 技能澄清；
3. 制定方案 → 实施 → 按验收标准自查；
4. 完成且通过验收 → 100% + close；未完成 → 按进度契约如实更新（含下一步）。
若执行后关闭了该票：在所属 map 的 Decisions so far 追加一行 gist（票名 + 链接 + 一句话结论）。</pre>

- EN：

<pre>/wayfinder
{url}

Execute this issue (follow the wayfinder skill rules):
1. Claim it first (if unclaimed); read Description / Notes / blocking relationships; confirm what it must deliver;
2. If the goal is unclear or needs the user call, settle it with the grilling skill first;
3. Plan → implement → self-check against acceptance criteria;
4. Done and verified → 100% + close; otherwise update honestly per the progress contract (with next step).
If this execution closes the ticket, append a one-line gist to its map Decisions so far (ticket name + link + one-line conclusion).</pre>

---

## tpl.handoff1 · v1

- 用途：交接第一击（写交接文档）
- 占位符：{ts}
- ZH：

<pre>/handoff

请把当前会话生成交接文档，写到 .scratch/handoff/{ts}.md（相对当前工作目录），包含三部分：
1. 结论：本次会话已确认的决定与成果；
2. 未完成事项：下一步要继续的事；
3. 建议 skill：新会话接手时建议加载的技能。

从第一性原理出发完成任务，并对抗式审查。</pre>

- EN：

<pre>/handoff

Create a handoff doc from this session, written to .scratch/handoff/{ts}.md (relative to the current working directory), with three parts:
1. Conclusion: decisions and outcomes confirmed this session;
2. Unfinished: what to continue next;
3. Suggested skills: skills the next session should load.

Approach tasks from first principles, and review adversarially.</pre>

---

## tpl.handoff2 · v1

- 用途：交接第二击（读交接文档）
- 占位符：{file}
- ZH：

<pre>/read .scratch/handoff/{file}

请先阅读这份交接文档并复述确认理解（结论 / 未完成事项 / 建议 skill），然后从第一性原理出发完成任务，并对抗式审查。</pre>

- EN：

<pre>/read .scratch/handoff/{file}

Read this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.</pre>

---

## handoffRead · v1

- 用途：交接第二击兜底（无文件时）
- 占位符：无
- ZH：

<pre>/read .scratch/handoff/latest.md

请先阅读这份交接文档并复述确认理解（结论 / 未完成事项 / 建议 skill），然后从第一性原理出发完成任务，并对抗式审查。</pre>

- EN：

<pre>/read .scratch/handoff/latest.md

Read this handoff doc and restate your understanding (conclusions / unfinished / suggested skills), then approach tasks from first principles, and review adversarially.</pre>

---

## setup · v2

- 用途：环境检查横幅 · 技能缺失按钮（装全套件）
- 占位符：无
- ZH：

<pre>请帮我安装 Matt Pocock 的 AI 技能套件：
1. 克隆 https://github.com/mattpocock/skills；
2. 按 README 安装工程领域与通用领域的全部 skills 到 ~/.agents/skills；
3. 安装完成后运行 /setup-matt-pocock-skills 初始化仓库（issue tracker 选择 GitHub Issues）；
4. 初始化时按「强制标签体系」建立标签清单（bug / needs-triage / wayfinder:grilling）。</pre>

- EN：

<pre>Please install Matt Pocock AI skill collection:
1. Clone https://github.com/mattpocock/skills;
2. Install all engineering and general-purpose skills per the README into ~/.agents/skills;
3. After install, run /setup-matt-pocock-skills to bootstrap the repo (choose GitHub Issues as the issue tracker);
4. During init, establish the mandatory label set (bug / needs-triage / wayfinder:grilling).</pre>

---

## setupRun · v2

- 用途：环境检查横幅 · setup 未执行按钮（仅初始化，不重装技能）
- 占位符：无
- ZH：

<pre>/setup-matt-pocock-skills

初始化本仓库（技能套件已安装，无需克隆重装）：
1. issue tracker 选择 GitHub Issues；
2. 初始化时按「强制标签体系」建立标签清单（bug / needs-triage / wayfinder:grilling）；
3. 初始化完成后复查环境检查（setup 变绿即完成）。</pre>

- EN：

<pre>/setup-matt-pocock-skills

Bootstrap this repo (the skill suite is already installed — no need to clone or reinstall):
1. Choose GitHub Issues as the issue tracker;
2. During init, establish the mandatory label set (bug / needs-triage / wayfinder:grilling);
3. After init, re-run the environment check (setup turns green when done).</pre>

---

## newWayfinder · v5

- 用途：「+ 新建需求」按钮
- 占位符：{repo}
- ZH：

<pre>/wayfinder
请帮我处理一个需求（严格遵循 wayfinder 技能规则）。
仓库：{repo}
需求描述：

收到需求后按以下流程：
1. 先澄清：对目标 / 范围 / 偏好有假设时，先用 grilling 技能澄清，不默认；
2. 判断分类（需求 / map 维度）——先查仓库已有 wayfinder:map 和 issue，确认是否做过：
   - 新增：全新需求，之前没做过 → 按建图规划契约新建 map（Destination + Notes + 规划表 + 票）；
   - 复用：这个需求之前已做过（已有 map / issue）→ 打开复用它，不重复建；
   - 直接实现：需求很小 → 建一个 issue 直接实现，不建大 map；
3. 执行后按进度契约更新。</pre>

- EN：

<pre>/wayfinder
Please handle a requirement (strictly follow the wayfinder skill rules).
Repo: {repo}
Requirement: 

After receiving the requirement, follow this flow:
1. Clarify first: if you hold assumptions about the goal / scope / preferences, settle them with the grilling skill, never assume;
2. Decide the case (at the requirement / map level) — first check existing wayfinder:map and issues in the repo to confirm whether it has been done:
   - Add: a brand-new requirement never done before → build a new map per the planning contract (Destination + Notes + plan + tickets);
   - Reuse: this requirement has been done before (existing map / issue) → open and reuse it, do not build a new one;
   - Directly implement: the requirement is small → create a single issue and implement it directly, no big map;
3. Update per the progress contract after execution.</pre>

---

## mapHead · v1

- 用途：新会话/执行 · map 标识头（B2）
- 占位符：{n} / {title} / {url}
- ZH：

<pre>## 目标 map
- 编号：#{n}
- 标题：{title}
- 链接：{url}</pre>

- EN：

<pre>## Target map
- No: #{n}
- Title: {title}
- Link: {url}</pre>

---

## stageGate · v1

- 用途：阶段闸门条款（T13 · 统一追加于 诊断/修复/执行/map推进 动作：needs-triage 必须先诊断并判断现状）
- 占位符：无
- ZH：

<pre>阶段闸门（动作开始前必读，这是动作的一部分，不是可选项）：
1. 先读该 issue 现状：进度区（## 进度：N%）/ 已有实施记录 / 评论 / 标签，判断它处于哪个阶段；
2. 若带 needs-triage 标签：必须先完成诊断（这是前置步骤，不许跳过直接实施）；
3. 诊断时判断当前进展：
   - 已有实施且真实 → 核验是否符合验收标准，属实则维持 95% 待确认 + 摘 needs-triage（转 ready-for-agent）；
   - 已有实施但虚假/半成品 → 进度据实回调到真实值（如 30%），继续诊断；
   - 未动工 → 正常诊断（复现 → 根因 → 方案 → 写入 issue）；
4. 诊断完成摘 needs-triage 后才允许进入实施阶段。</pre>

- EN：

<pre>Stage gate (must read before starting the action — it is part of the action, not optional):
1. First read the issue current state: progress section (## 进度：N%) / existing implementation record / comments / labels — determine which stage it is in;
2. If it carries the needs-triage label: diagnosis MUST be completed first (a prerequisite step — do not skip straight to implementation);
3. During diagnosis, judge current progress:
   - Existing implementation and it is real → verify against acceptance criteria; if genuine, keep 95% awaiting confirmation + remove needs-triage (move to ready-for-agent);
   - Existing implementation but fake/partial → revise progress back to the true value (e.g. 30%) and continue diagnosing;
   - Not started → normal diagnosis (reproduce → root cause → plan → write into the issue);
4. Only after diagnosis is done and needs-triage removed may implementation begin.</pre>

---

> 共 20 条 · 键：guide / mapExecute / complete / fixate / progress / bodyFormat / grill / newMap / tpl.diagnose / tpl.fix / tpl.discuss / tpl.execute / tpl.handoff1 / tpl.handoff2 / handoffRead / setup / setupRun / newWayfinder / mapHead / stageGate
