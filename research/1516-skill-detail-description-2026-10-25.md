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
  - 另有一处只是目录挪动：grill-me 从 engineering 挪到 productivity（engineering 下的旧路径已 404）。
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

## 7. 来源链接

- https://api.github.com/repos/mattpocock/skills/tags
- https://api.github.com/repos/mattpocock/skills/commits?sha=main&per_page=30
- https://github.com/mattpocock/skills/tree/main/skills/engineering
- https://github.com/mattpocock/skills/tree/main/skills/productivity
- https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md
- https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md
- https://github.com/mattpocock/skills/blob/v1.3.1/skills/productivity/grilling/SKILL.md
