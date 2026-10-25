# 1516 调研：技能详情页为什么看不到 grilling / domain-modeling 的描述（2026-10-25）

一句话结论：**不是随包技能旧了，也不是上游少了内容** —— grill-me 与 grill-with-docs 在上游原文里本来就只有一句「去调用 grilling / domain-modeling」；详情页只展示 SKILL.md 正文、且只把反引号里的技能名做成可点入口，所以写在 frontmatter 里的描述看不到，双引号里的技能名也跳不过去。

## 1. 问题拆成两件事

1. 「更新一下 mattpocock 的 skill」：期望通过升级随包技能解决问题。
2. 「看不到 grilling、domain-modeling skill 描述」：在 /grill-me、/grill-with-docs 的详情页里，看不到它们引用的那两个技能是什么样。

## 2. 上游现状（2026-10-25 核对）

- 最新 tag 仍是 v1.3.1（commit 24fe0ef7，2026-10-04 发布），之后没有新 tag。来源：`GET https://api.github.com/repos/mattpocock/skills/tags`。
- main 最新提交到 2026-10-19（5beb35b0 chief-of-staff #1304）。来源：`GET https://api.github.com/repos/mattpocock/skills/commits?sha=main&per_page=30`。
- 随包只需关注上游的两个目录（engineering 与 productivity）。按 blob 逐个比对 v1.3.1 与 main：两边同为 81 个文件，0 增 0 删，15 个改了内容，分别是：
  - engineering：ask-matt/SKILL.md、code-review/SKILL.md、diagnosing-bugs/SKILL.md、implement/SKILL.md、setup-matt-pocock-skills/SKILL.md 与同目录的 issue-tracker-github.md / issue-tracker-gitlab.md / triage-labels.md、tdd/SKILL.md、to-tickets/SKILL.md、wayfinder/SKILL.md、wizard/template.sh；
  - productivity：grilling/SKILL.md、handoff/SKILL.md、teach/SKILL.md。
  - 目录没有挪动：grill-me 在 v1.3.1 与 main 都放在 productivity 下；两版 engineering 都是 20 个技能目录、productivity 都是 7 个。
- grill-me / grill-with-docs 的 SKILL.md 不在上面 15 个文件里，main 上两篇正文仍是 `Call the Skill tool with "grilling".` 与 `Call the Skill tool twice, for "grilling" and "domain-modeling".`，frontmatter 的 description 也与 v1.3.1 一字不差。来源（main）：https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md 与 https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md 。
- 结论：把随包技能升到 v1.3.1 或升到 main，都不会改变这两页的观感。上游真正改过的是 grilling 的措辞之类别的内容。

## 3. 仓内代码事实（当前工作区 main，2026-10-25 逐行核对）

- 详情页取原文走 `src/host/skillDoc.ts` 的 `createSkillDoc`：`stripFrontmatter()`（:41-46）把开头的 `---` 到 `---` 整段剥掉，`readDoc` 在 :99 用剥过的正文回包，回包字段只有 `md` / `path` / `mdZh` / `pathZh`（:109），没有 description —— 所以详情页根本拿不到描述。
- 详情页正常态只画正文：`src/client/views/skillDetail/PixelSkillDetailModal.ts:138` 是 `PixelMarkdown`；短描述 `shortDesc` 只在「读不到正文」的错误态才出现（:143）。
- 技能列表每行其实带描述：`src/client/views/skillDetail/PixelSkillRow.ts:29` 行内渲染 `use`（取自界面词表 `skilldesc.<name>`），`config/copy/skilldesc.yaml` 里 27 篇的中英描述都有；详情页的 `shortDesc` 也是同一个词表值（`src/client/views/skillDetail/PixelSkillOps.ts` 建状态处）。
- 正文里能点的技能名只认反引号：`src/client/views/skillDetail/PixelMarkdown.ts:37-43` 的 `skillRefOf` 只接收代码跨度里的名字，:143-160 只把反引号代码替换成可点入口；双引号是普通文字，不参与这条规则。
- 详情页叠层最多 3 层（`PixelSkillOps.ts` 的 `PIXEL_STACK_MAX`），所以「点进去看引用」本来是设计里有的能力，只是这两篇的引用写法没被识别。

## 4. 27 篇正文里的双引号技能引用（全部点不动）

grill-me → grilling；grill-with-docs → grilling、domain-modeling；improve-codebase-architecture → codebase-design、domain-modeling、grilling；tdd → codebase-design；triage → domain-modeling、grilling；wayfinder → domain-modeling、grilling、prototype、research。共 13 处，分布在 6 篇正文里。

## 5. 与既有笔记的关系（先复用，后补查）

- `research/642-aihero-workflows.md:121,125-128,157`：已记录 grill-me 正文就是一句跳 grilling、grill-with-docs = grilling + domain-modeling，grilling 是基元。
- `research/885-md-popup.md:100-103`：记录了详情页当初的定位——列表行只有短描述，详情页用来读原文全量文本；原文里没有「描述」这个位置。
- `research/867-v13-diff.md`：上次从 v1.2.3 升到 v1.3 的做法与清单（本次不适用：没有新版本可升）。
- `research/884-skill-source.md`：随包技能的来源与落点。
- 本次唯一补查的是「今天上游有没有更新、这两篇正文变没变」——这四份笔记都回答不了只与时间有关的事实。

## 6. 待定

- 现象是「设计如此」，但用户的实际需求（想知道 grilling / domain-modeling 是什么、并跳过去）没有满足。
- 可选改动：①详情页头行加一行描述（复用界面词表，中英跟随语言）；②把双引号技能名也做成可点入口（13 处，规则与现有反引号入口同一套）。
- 做不做、描述取哪份，见票面「待拍板的问题」。

## 7. 附：维护者新需求「随包 md 都配中文译文、正文里同名文件可点」（2026-10-25 核对）

本轮维护者追加两条要求：①随包提供的每个 md 都配一份中文译文（给人看，AI 不用）；②技能详情页正文里，凡是出现与随包 md 相同的文件名，都能点开看该文件原文，并支持中英文切换，体验与现在的技能详情一致。

- 现状清点：随包 md 共 78 个 = 27 个 `SKILL.md` + 27 个 `SKILL.zh.md`（27 篇技能都已有中文译文）+ `README.md` + 23 个附加 md（清单见 `package/bundled-skills/`，如 `triage/AGENT-BRIEF.md`、`tdd/mocking.md`、`domain-modeling/ADR-FORMAT.md`）。缺译文的是这 23 个附加文件；其中 `pr/CREDITS.md` 与 `teach/GLOSSARY-FORMAT.md` 在正文里根本没被点名。
- 正文点名情况按写法分开算（2026-10-25 晚全量核对）：反引号写成行内代码的名字共 33 种，其中与随包文件同名的只有 4 种（`SKILL.md`、`SKILL-MECHANICS.md`、`docs/agents/domain.md`、`docs/agents/triage-labels.md`）；写成相对链接的名字共 26 种，其中 23 种指向随包真实文件，3 种是示例路径。上一版把两类混在一起数成「33 个、约 20 个随包」，不准确，详见第 8 节。重名一个：`GLOSSARY-FORMAT.md` 在 `domain-modeling` 与 `teach` 各一份，只写文件名时分不清指向哪份。
- 关键风险（先解决再翻译）：同步脚本 `scripts/sync-matt-skills.mts:178-182` 先 `rmSync` 整个 `package/bundled-skills`，再按上游逐目录复制（`:194`）；上游没有 `SKILL.zh.md`，所以下一次 `pnpm run sync:matt` 会把 27 份译文全删。门禁 `tests/verify-bundled-skills-upstream.ts:85-87` 已写明这一点（「允许存在；但下次同步整目录重建会抹掉它们」）。做新功能前要把译文搬到重建目录之外，或改同步脚本保留/合并译文。
- 宿主取原文只认 `SKILL.md`：`src/host/skillDoc.ts:89-111` 用 `<name>/SKILL.md` 拼路径，译文按 `SKILL.zh.md` 同目录取。要读任意 md，得给读原文接口加一个文件参数、白名单（只允许随包目录内的 md）并保留越界防护。
- 翻译量与取舍：23 个附加 md 里有 20 个被正文点名、2 个没被点名；翻译全部 23 个即可让「所有随包 md 都有译文」成立，不翻那 2 个也不影响可点入口。

## 8. 补正（2026-10-25 晚）：正文里 md 文件名的两种写法与十二个非随包名字

上一节把「正文里出现的 md 文件名」混在一起数，结论不准确。按写法分开核对（`package/bundled-skills` 全部英文正文，2026-10-25）：

- **反引号写成行内代码的名字**：共 33 种写法。其中与随包文件同名、能直接找到原文的只有 4 种：`SKILL.md`（27 篇都有）、`SKILL-MECHANICS.md`（writing-for-agents）、`docs/agents/domain.md`（对应 setup-matt-pocock-skills/domain.md）、`docs/agents/triage-labels.md`（对应 setup-matt-pocock-skills/triage-labels.md）。其余 27 种是占位符（`<NN>-<slug>.md`、`*.md`）、示例（`dark-mode.md`、`graphql-api.md`、`plugin-system.md`）和实际项目里的文件（`GLOSSARY.md`、`AGENTS.md` 等）。
- **写成相对链接的名字**：共 26 种，其中 23 种指向随包真实文件（`ADR-FORMAT.md`、`GLOSSARY-FORMAT.md`、`LEARNING-RECORD-FORMAT.md`、`MISSION-FORMAT.md`、`RESOURCES-FORMAT.md`、`domain.md`、`issue-tracker-github.md`、`issue-tracker-gitlab.md`、`issue-tracker-local.md`、`triage-labels.md`、`AGENT-BRIEF.md`、`DEEPENING.md`、`DESIGN-IT-TWICE.md`、`HTML-REPORT.md`、`LOGIC.md`、`OUT-OF-SCOPE.md`、`PHASE-BOUNDARIES.md`、`SKILL-MECHANICS.md`、`SKILL.md`、`UI.md`、`mocking.md`、`tests.md`），3 种是示例路径（`./src/billing/GLOSSARY.md` 等）。`src/client/views/skillDetail/PixelMarkdown.ts:182-183` 对非 http(s) 链接只显示标签文字，所以这批随包文件现在「正文里看得到、点不了」。
- **十二个非随包名字**（`GLOSSARY.md`、`AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`CODING_STANDARDS.md`、`MISSION.md`、`RESOURCES.md`、`NOTES.md`、`GLOSSARY-MAP.md`、`issue-tracker.md`、`0001-event-sourced-orders.md`、`0002-postgres-for-write-model.md`）逐文件核实（2026-10-25）：
  - 上游 v1.3.1 的 `skills/` 目录共 81 个文件（engineering 20 个技能目录 + productivity 7 个技能目录），没有任何同名文件；随包的同类文件只有 `*-FORMAT.md`、`issue-tracker-*.md` 这类格式说明。
  - 上游仓库根目录有 `AGENTS.md`、`CLAUDE.md`、`GLOSSARY.md`，但它们是上游项目自己的文件，不在 `skills/` 里，也没有随技能同步进插件。
  - 本机安装的插件（`C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck`，版本 1.9.0-beta.18）全部 487 个文件里没有这 12 个名字。
  - 正文里的用法是让 AI 在实际项目里创建或维护这些文件：`setup-matt-pocock-skills/SKILL.md:24` 问目标仓库根目录有没有 `AGENTS.md`/`CLAUDE.md`；`teach/MISSION-FORMAT.md:1-3` 写明 `MISSION.md` 放在工作区根目录；`code-review/SKILL.md:36` 说 `CONTRIBUTING.md`/`CODING_STANDARDS.md` 是仓库里记录代码规范的文档；`domain-modeling/SKILL.md:74` 的 ADR 示例里 `0001`/`0002` 只是目录树里的文件名。
  - 结论：这 12 个不是「随包给 AI 参考的文件」，插件包里没有它们的原文；能随包提供的是它们的格式模板。它们要不要做可点、点击后显示什么，见 #1522 的待拍板。
## 9. 再补正（2026-10-25 晚）：六个名字里只有 `issue-tracker.md` 有模板可参照

维护者追问「这六个名字随技能确定都没有吗」。复核范围比上次更宽：`package/bundled-skills`、整个 `package` 目录、本机安装的 1.9.0-beta.18 插件包、上游 v1.3.1 与 main 的 `skills/` 目录，都查过文件级同名匹配。结论：`AGENTS.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`CODING_STANDARDS.md`、`NOTES.md`、`issue-tracker.md` 这六个名字在任何随包位置都没有同名文件。

唯一要补正的是 `issue-tracker.md`：它不是完全没有可参照的随包内容。`setup-matt-pocock-skills` 用 `issue-tracker-github.md`、`issue-tracker-gitlab.md`、`issue-tracker-local.md` 三份模板之一，去目标仓库写 `docs/agents/issue-tracker.md`。所以 #1522 按方案 C 处理时，点开 `issue-tracker.md` 先让使用者从三份模板里选一份；其余五个没有模板，点开显示一句说明。

## 10. 来源链接

- https://api.github.com/repos/mattpocock/skills/tags
- https://api.github.com/repos/mattpocock/skills/commits?sha=main&per_page=30
- https://github.com/mattpocock/skills/tree/main/skills/engineering
- https://github.com/mattpocock/skills/tree/main/skills/productivity
- https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md
- https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md
- https://github.com/mattpocock/skills/blob/v1.3.1/skills/productivity/grilling/SKILL.md
