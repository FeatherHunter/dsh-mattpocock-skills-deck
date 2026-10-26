# 技能详情弹窗正文里的技能名为什么没变成「技能形式」（普通文字里的 /技能名 不被识别）

- 调查性质：只读调查（没有改业务代码，没有提交）
- 现象来源：`.scratch/issue-report/image-copy.png`（技能列表页「通用建议」下面那颗 `/ask-matt` 是可点的技能形式；点开 `/implement` 的详情弹窗后，正文里的 `/tdd`、`/code-review` 只是普通文字）
- 查证基线：当前工作区 `D:\dsh-plugin\dsh-mattpocock-skills-deck`，Node 24.19.0
- 配套实证：用仓内真渲染器（`src/client/views/skillDetail/PixelMarkdown.ts`）跑过一组最小样例，脚本放在仓库外的 `D:\Temp\probe-skillref.ts`（不入仓）

一句话结论：**识别逻辑是有的，但它只认两种写法——反引号里的行内代码、和直双引号里的名字；普通文字里写的 `/tdd`、`/code-review` 根本没有被任何规则扫到。而且 `tdd`、`code-review` 这两个技能在仓内是有原文文件、也在技能名单里的，所以这不是「技能缺失」，是「写法不被识别」。**

## 1. 技能详情弹窗的渲染代码与正文渲染链路

正文**不是**原样文本，也不是通用 Markdown 渲染器，而是自带的像素风 Markdown 渲染器。

- 页面装配：`src/client/views/SkillsTab.ts:67-74` —— 详情打开时画 `PixelSkillDetailModal`，并把两样东西传进去：`onOpenSkill`（正文里点技能名时的回调，`SkillsTab.ts:72`）与 `skillNames`（本次可点的技能名单，`SkillsTab.ts:73`）。
- 弹窗本体：`src/client/views/skillDetail/PixelSkillDetailModal.ts:71` 起。语言与正文在 `:122-123` 选定（中文译文存在时默认英文原文），正文交给渲染器的那一段是 `:143-154` 的 `mdBody()`：

  - `:144` `h(PixelMarkdown, {...})`
  - `:149` `onSkill: p.onOpenSkill || null` —— 正文里技能名的点击出口
  - `:150` `skillNames: p.skillNames || null` —— 技能名单
  - `:151` `mdRefs: d.refs || null` —— 正文里随包 md 文件名的可点名单（#1522）

- 渲染器：`src/client/views/skillDetail/PixelMarkdown.ts:27` 起。逐行解析 Markdown（标题、列表、代码块、引用、段落）在 `:312-350`；行内解析在 `:124-261`。对照物 `src/client/views/shared/md.ts`（通用渲染器）里**没有任何**技能名处理（全文 grep 技能相关字样无命中），所以这条链路是技能详情独有的。
- 取数链（正文从哪来）：客户端 `src/client/views/skillDetail/PixelSkillOps.ts:104-105` `pixelLoad` → `:73-100` `pixelFetch` → `:84` `host.call('skill.readDoc', args)`；宿主侧电话注册在 `src/host/index.ts:214`，实现在 `src/host/skillDoc.ts:361-393` `readDoc`：`:93-98` 的 `stripFrontmatter` 把开头的 `---` 段整段剥掉，`:375` 得到剥完的正文，`:391` 回包字段是 `md/path/mdZh/pathZh/refs`。客户端 `PixelSkillOps.ts:175-179` 把回包写进 `d.mdEn` / `d.mdZh`。

## 2. 「通用建议」那排 chip 怎么渲染的

- 标题与内容：`src/client/views/SkillsTab.ts:27` `const rec: string[] = ['ask-matt']`（固定推荐 `/ask-matt`）；`:28` `recTitle = tr('skill.generic')`；头行画在 `:46-48`（类名 `dsws-grp`）。词条真源：`config/copy/word.yaml:18`（中文「通用建议」）、`:228`（英文 "General suggestion"）。
- chip 本体：`src/client/views/SkillsTab.ts:53-65`

  - `:58` 类名 `dsws-chip dsws-chip-m pixel-chipref dsws-hov`
  - `:59-60` `role="button"`、`tabIndex: 0`
  - `:61-62` 按压形状 `data-press="chip"`、定位串 `data-log="skill.chip." + i`
  - `:63` 点击 → `openSkill(r)`；`:64` 显示文字是 `'/' + r`
  - 点击行为：`SkillsTab.ts:50-52` `openSkill` → `pixelOpenDetail(st, name, itemOf(name))`（`itemOf` 在 `:38-41`），即压一层新的详情。

- 样式（为什么它长成截图里那个代码徽章的样子）：`src/client/views/skillDetail/PixelStyles.ts:164` `.pixel-tab .dsws-chip{...}` 把药丸在技能页里改成像素代码徽章外观（等宽字体、方角、描边、硬阴影）；`:105-107` 给 `.pixel-chipref` 补指针、悬停与深色下的焦点反馈。药丸的基础样式在 `src/client/kernel/styles.ts:63`（`.dsws-chip`）、`:68`（`.dsws-chip-m` 紫色）。

## 3. 正文里出现 /xxx 时，现在有没有识别逻辑

**有识别逻辑，但只覆盖两种写法；普通文字里的 `/技能名` 完全不被识别。**

名字判定（唯一的判定函数）：`src/client/views/skillDetail/PixelMarkdown.ts:41-47` `skillRefOf`

- `:42` 没给技能名单（`p.skillNames`）或没给 `onSkill` → 一律不做入口
- `:44` 去掉开头的 `/`
- `:45` 名字必须整体对上 `^[A-Za-z0-9][A-Za-z0-9_-]*$`
- `:46` 名字必须出现在本次渲染拿到的名单里（名单由 `:40` `nameSet` 建成集合）

名单来源与覆盖范围：`src/client/views/SkillsTab.ts:73` → `items.map(it => it.name)` → `src/shared/matt-skills.ts:33-61` 的 `SKILLS_DATA`，共 27 个随包技能（`tdd` 在 `:54`，`code-review` 在 `:47`）。

两种被认的写法：

1. **反引号行内代码**：`PixelMarkdown.ts:201-205`，其中 `:203` `const ref = skillRefOf(code); if (ref) return mark(skillEntry(ref, code))`。
2. **直双引号里的名字**（#1520 落地）：`PixelMarkdown.ts:255-259`，引号本身原样留在正文里，只把引号里的名字做成入口。

入口的画法：`PixelMarkdown.ts:97-110` `skillEntry` → `<code class="pixel-skillref" role="button" tabIndex=0 data-press="button" data-log="sd.md.skill.N">`；样式 `PixelStyles.ts:101-104`（平时跟普通代码一模一样，悬停才亮出边框）。

普通文字这条路上**没有**任何斜杠规则：普通文字只经过「随包 md 文件名识别」`:76-89`（`mdRefNodes`，认 `*.md`）与强调解析 `:169-198`，`/` 开头的技能名一律当普通字符。全仓再没有第二处认「斜杠 + 名字」的地方（`src/client` 里 `charAt(0) === '/'` 只出现在 `PixelMarkdown.ts:44` 这一处判定里）。

### 为什么 /tdd、/code-review 没有变成技能形式

**因为写法不被识别，不是因为这两个技能不存在。**

- 这两个技能在仓内是有原文文件的：`package/bundled-skills/tdd/SKILL.md`、`package/bundled-skills/code-review/SKILL.md`；也在技能名单里（`src/shared/matt-skills.ts:47`、`:54`）。把它们改成反引号写法，今天就能点。
- 问题是原文写的是普通文字：

  - `package/bundled-skills/implement/SKILL.md:9` → `Use /tdd where possible, at pre-agreed seams.`
  - `package/bundled-skills/implement/SKILL.md:13` → `Once done, use /code-review to review the work.`
  - 中文译文同样：`package/bundled-skills-zh/implement/SKILL.md:9`、`:13`
  - 装在机器上的那份（`…\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck`，1.9.0-beta.24）正文一字不差，所以截图里的现象与仓内一致。

- 随包正文里「普通文字 + `/技能名`」一共 4 处（英文 2、中文 2），全在 `implement`；另有 2 处写在 frontmatter 的 description 里（`package/bundled-skills/implement-spec/SKILL.md:3` 与中文那份的 `:3`，提到 `/to-spec`、`/to-tickets`），但 description 在取原文时就被 `stripFrontmatter` 剥掉了（`src/host/skillDoc.ts:93-98`、`:375`），根本到不了界面。
- 反过来，其余 27 篇正文里绝大多数技能引用是「用反引号包住的行内代码」写法（随包 `SKILL.md` 里共 103 处，分布在 11 篇，例如 `ask-matt` 正文里用行内代码写的 `/grill-with-docs`），所以那些都能点——这也解释了为什么「有的能点、有的不能点」。

### 实证（本次用真渲染器跑过）

用仓内 `PixelMarkdown.ts`（经 `tests/lib/source-text.ts` 的 `spliceableJs` 取源）＋ jsdom 渲染，技能名单给 `['tdd','code-review','implement','grilling','domain-modeling']`：

| 正文写法 | 做出的技能入口 |
| --- | --- |
| 纯文字 `Use /tdd where possible.` | 无（0 个） |
| 纯文字 `use /code-review to review the work.` | 无（0 个） |
| 行内代码写法（反引号包住 `/tdd`） | 1 个（`/tdd`） |
| 行内代码写法（反引号包住 `/code-review`） | 1 个（`/code-review`） |
| 双引号 `Use "tdd" where possible.` | 1 个（`tdd`） |
| 纯文字 `Use /nope where possible.`（不在名单） | 无（0 个） |

最后一行说明「名单这一层是有效的」，缺的正是纯文字斜杠写法的识别。

## 4. 仓内已有笔记/文档有没有写过这件事

- `research/1516-skill-detail-description-2026-10-25.md` —— **最相关的一份**。`:3` 一句话结论「详情页只把反引号里的技能名做成可点入口」；`:24`、`:26` 记录了当时只有反引号写法被认；`:29-31` 盘点 27 篇正文里 13 处双引号引用「全部点不动」；`:44` 记了可选改动「把双引号技能名也做成可点入口」（后来作为 #1520 落地）；`:47-73` 是 #1522「正文里同名 md 文件名可点」的调查。**注意 `:26` 那句在今天已经过时**：双引号写法自 #1520（提交 `04e2118d`）起已经能点。这份笔记**没有**提到普通文字里写 `/技能名` 这一种形式。
- `research/884-skill-source.md` —— 记技能原文文件位置与读取链路（`:11` 原文住在 `package/bundled-skills/<技能名>/SKILL.md`；`:76-86` 记从文件到界面的三条链与缺口），不涉及「正文里的技能引用怎么渲染」。
- `research/766-skill-defs.md` —— 查过了：这是分诊标签（`ready-for-human` / `needs-info`）的结论索引，与本问题无关。
- `research/642-parts/06-reference.md:158`、`:226` 与 `research/642-parts/matrix-local.md:137` —— 只记录「`/tdd` 的正文引用了 `/codebase-design`、`code-review`」这个**谁引用谁**的事实，不涉及渲染。
- `research/885-md-popup.md:95` —— 记「通用建议」这个词条（`skill.generic`）；`:98-104` 记技能列表现状与原文取数缺口。
- `docs/research/484-screenshot-plan.md:121` —— 提到技能页顶部有一行「通用建议」，推荐项默认是 `ask-matt`。
- `docs/architecture/kernel-contract.md:146` —— 记 `config/copy/skilldetail.yaml` 是技能详情界面词条来源。
- 结论：**没有任何一份笔记或文档写过「普通文字里的 `/技能名` 也应该做成技能形式」这件事**；已有笔记覆盖的是反引号写法（2026-10-10 人拍板）与双引号写法（#1520）。

## 5. 现状、可能的修复点、既有测试覆盖

### 现状

- 识别逻辑存在，判定函数是 `PixelMarkdown.ts:41-47` 的 `skillRefOf`；名单覆盖随包 27 个技能（`src/shared/matt-skills.ts:33-61`）。
- 只认两种写法：反引号行内代码（`:201-205`）与直双引号（`:255-259`）。普通文字里的 `/技能名` 不认。
- 因此 `/implement` 正文里的 `/tdd`、`/code-review`（普通文字）是死文本；技能本身不缺（原文文件与名单里都有）。

### 可能的修复点（只给方向，不动手）

1. **在渲染器里加第三条规则**（最贴现状）：在普通文字这一层认 `/技能名`。落点可以放在 `pushText`（`PixelMarkdown.ts:150-152`）那一层，与随包 md 文件名的识别 `mdRefNodes`（`:76-89`）并列；命中名单就复用现成的 `skillEntry`（`:97-110`），定位串沿用 `sd.md.skill.N`。
   - 必须挡住的误伤：URL 里的路径（`https://…`）、相对路径（`src/foo`、`docs/agents/x.md`）、日期与分数（`2026/10/26`、`1/2`）、中文句子里的斜杠、以及已经落在代码跨度与链接地址里的内容。`mdRefNodes` 那套「前后词边界」判据（`:82-84`）可以照抄一份。
   - 还要拍板：入口文字保不保留开头的 `/`（`skillRefOf` 两种都认，现在反引号写法保留、双引号写法不保留）；以及当前这一篇自己的名字要不要做成入口（现在不做，`tests/verify-skill-detail-stack.ts:97` 钉着）。
2. **改随包正文**（不可行）：把 `/tdd` 改成反引号写法。英文原文是上游内容，`scripts/sync-matt-skills.mts` 每次同步会整目录重建 `package/bundled-skills`（见 `research/1516-skill-detail-description-2026-10-25.md:53`），改了下次同步就被抹掉；中文译文在 `package/bundled-skills-zh`（本地维护）也不宜跟上游写法分叉。
3. **在宿主取数时改写**（不推荐）：在 `src/host/skillDoc.ts` 读原文后把纯文字 `/名字` 改写成反引号再回给界面。这会改原文，而且名单得从客户端传回宿主，跨进程边界，不划算。
4. 改动落点都在 `src/client/views/skillDetail/` 下，这些叶子由 `scripts/build.mts` 拼进产物（仓根 `client.js` 里已含 `pixel-skillref`），改完要重新构建；按 `AGENTS.md` 的门禁纪律，动到 `tests/**` 与 `*.md` 要跑全链 `npm run verify:parallel`（Node ≥ 24.15）。

### 既有测试覆盖

- `tests/verify-skill-detail-stack.ts` —— 详情栈与技能名入口的主门禁：
  - `:95-97` 反引号写法做成入口、当前这一篇自己的名字不做入口
  - `:105-126` 双引号写法（#1520）：做成入口、引号原样保留、点开压一层
  - `:159-165` 反证：没接 `onOpenSkill` 时一个假入口都不做
  - `:167-200+` 用随包 27 篇真实语料扫「双引号技能名」逐行断言（名单从 `package/bundled-skills` 目录现读，不手抄）
- `tests/verify-1522-skill-md-refs.ts` —— 正文里随包 md 文件名入口（#1522）：`:198` 参考名单、`:207` 传 `skillNames`、`:231` 用 `code.pixel-skillref` 查询。
- `tests/verify-ui-feedback.ts` —— 界面反馈接线：`:98` 技能页药丸的定位串前缀 `skill.chip.`；`:110-112` 详情页三片的定位串前缀（`sd.toc.row.` / `sd.md.` / `sd.detail.`）；`:342-347` 焦点规则扫描同时覆盖 `.pixel-skillref` 与 `.pixel-chipref`。
- **没有任何门禁覆盖「纯文字里的 `/技能名`」**（`tests/` 全量 grep `/tdd`、`/code-review` 无命中）。真要修这一处，应照 #1520 的做法在 `tests/verify-skill-detail-stack.ts` 里加一段「随包真实语料里的纯文字斜杠写法逐行断言」，否则改完没有回归保护。

## 结论一句话

正文里的技能名入口规则只认反引号写法与双引号写法，`/implement` 正文里的 `/tdd`、`/code-review` 是普通文字所以没被识别（这两个技能在仓内是有原文、也在名单里的），修的话在 `src/client/views/skillDetail/PixelMarkdown.ts` 的普通文字解析里补一条「斜杠 + 名单内技能名」的规则，并在 `tests/verify-skill-detail-stack.ts` 里补上对应门禁。
