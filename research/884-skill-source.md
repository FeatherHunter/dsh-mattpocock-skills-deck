# 884 调研：技能原文文件位置与读取链路

- 对应票：#884（地图 #883：技能列表加详情入口与原文漂亮展示）
- 查证基线：main 分支 ec5067c，插件版本 1.7.44，随包技能同步 pin 为 v1.3.1
- 查证方式：直接读仓库源码与包内文件，不依赖二手说法
- 本文件只记录事实，不做选型决定（用哪种详情容器、用哪几项动效由 886 讨论票拍板）

## 核心结论（先看这四条）

1. 实际是 27 个技能，不是 28 个。真源目录、随包目录、原文文件、中英文描述词条四处都是 27 且互相一致，票面写的 28 与实测不符，下游票需要先把数量纠正过来。
2. 原文文件住在 `package/bundled-skills/<技能名>/SKILL.md`，每个技能各一份，共 27 份；版本号只记在一个地方（`package/bundled-skills/VERSION`，内容为 v1.3.1），与同步脚本的 pin 一致。
3. 现在没有“从文件读全文到界面展示”的链路。读文件的链只管注册和探测（宿主进程），界面展示的链只用构建时拼进去的短描述，从不碰文件。详情页要新增一条“宿主读文件、界面来展示”的通道。
4. 缺原文时各环节都是“跳过加提醒”，不会崩：构建只报警告、注册时跳过坏项、探测报红并给出安装引导、技能列表照常显示短描述。

## 1. 原文文件位置清单

随包根目录是 `package/bundled-skills/`。发布时会原样装进 `package/package.json` 的 files 白名单（lib、shared、cordis.patch.yml、bundled-skills、scripts/、CHANGELOG.md），装机后路径形如 `…/node_modules/dsh-mattpocock-skills-deck/bundled-skills/`（来源：package/package.json、research/642-parts/01b-ask-matt.md 实测路径）。

27 个技能目录，每个目录必含 `SKILL.md`（frontmatter 首节里的 name 与目录名一致），27 份全在，无缺失（逐目录数过，见下表；校验口径与 scripts/build.mjs:722-734 同口径）。

| 技能目录 | 除 SKILL.md 之外的附带文件 |
| --- | --- |
| ask-matt | PHASE-BOUNDARIES.md、agents/openai.yaml |
| code-review | agents/openai.yaml |
| codebase-design | DEEPENING.md、DESIGN-IT-TWICE.md、agents/openai.yaml |
| diagnosing-bugs | scripts/hitl-loop.template.sh、agents/openai.yaml |
| domain-modeling | ADR-FORMAT.md、GLOSSARY-FORMAT.md、agents/openai.yaml |
| grill-me | agents/openai.yaml |
| grill-with-docs | agents/openai.yaml |
| grilling | agents/openai.yaml |
| handoff | agents/openai.yaml |
| implement | agents/openai.yaml |
| implement-spec | agents/openai.yaml |
| improve-codebase-architecture | HTML-REPORT.md、agents/openai.yaml |
| pr | CREDITS.md、agents/openai.yaml |
| prototype | LOGIC.md、UI.md、agents/openai.yaml |
| research | agents/openai.yaml |
| retro | agents/openai.yaml |
| setup-matt-pocock-skills | domain.md、issue-tracker-github.md、issue-tracker-gitlab.md、issue-tracker-local.md、triage-labels.md、agents/openai.yaml |
| tdd | mocking.md、tests.md、agents/openai.yaml |
| teach | GLOSSARY-FORMAT.md、LEARNING-RECORD-FORMAT.md、MISSION-FORMAT.md、RESOURCES-FORMAT.md、agents/openai.yaml |
| to-questionnaire | agents/openai.yaml |
| to-spec | agents/openai.yaml |
| to-tickets | agents/openai.yaml |
| triage | AGENT-BRIEF.md、OUT-OF-SCOPE.md、agents/openai.yaml |
| wait-what | agents/openai.yaml |
| wayfinder | agents/openai.yaml |
| wizard | template.sh、agents/openai.yaml |
| writing-for-agents | SKILL-MECHANICS.md、agents/openai.yaml |

根目录另有三个顶层文件：VERSION（内容 v1.3.1）、LICENSE（上游 MIT 声明）、README.md（写明 27 个：engineering 20 加 productivity 7）。

真源目录是 `src/shared/matt-skills.js`：MATT_SKILL_PROBE_NAMES 27 个名字（第 21-49 行），SKILLS_DATA 27 项（第 51-79 行，每项只有 name、level、use 三个字段，没有正文），两者实测长度都是 27（node 导入数过：PROBE=27、CATALOG=27）。27 个名字与 27 个随包目录逐个对得上，双向差集为 0（来源：package/bundled-skills/README.md 的单源声明；scripts/sync-matt-skills.mjs:18、110-114 的 --verify 校验就是比这件事）。

中英文短描述在 `src/client/kernel/locale-skilldesc.js`，中英各 27 条 skilldesc.<名字> 词条（第 17-43、46-72 行），注释写明条数与真源目录对齐（第 2、13 行）。

## 2. 版本号如何对齐

- 唯一版本记录：`package/bundled-skills/VERSION`，内容 `v1.3.1`。
- 同步脚本 `scripts/sync-matt-skills.mjs` 默认 pin 就是 v1.3.1（第 29 行），用法是 `node scripts/sync-matt-skills.mjs --pin v1.3.1 --verify`；纯手动同步，不挂构建钩子（第 16-19 行）。
- 同步动作是整目录复制上游 mattpocock/skills 的 skills/engineering 与 skills/productivity，加写 VERSION、拷贝 LICENSE（第 5-9 行）。
- 构建检查 `scripts/build.mjs` 的 ensureBundledSkills（第 712-740 行）认的也是 27：目录数不是 27 就警告，缺 SKILL.md、name 与目录名不一致、缺 VERSION/缺 LICENSE 都只警告，不阻断构建。
- 注意：883 地图正文与 884 票面都写“28 项”，但上面四处实测全是 27（真源 27、目录 27、SKILL.md 27、描述词条 27）。数字以实测为准，建议 886 讨论前先把票面数字改成 27，或查清多出来的一项指什么再补。

## 3. 缺原文时的兜底现状

按“文件从包里消失或损坏”时各环节的表现列：

- 构建时（scripts/build.mjs:714-739）：四种情况都只打印警告，不让构建失败——目录数不是 27、某技能缺 SKILL.md、frontmatter 的 name 与目录名对不上、缺 VERSION/缺 LICENSE。
- 注册时（src/host/bootstrap.js:112-150 的 list）：读不到 SKILL.md、解析不出 name/description、name 与目录名不一致的，一律静默跳过（continue），返回剩下的；全部失败就返回空数组。get（第 151-177 行）读失败或 name 对不上就返回 undefined。
- 探测时（src/host/skillProbe.js）：注册表查不到就走文件轻探（第 191-246 行）。目录在但 SKILL.md 读不出记“SKILL.md unreadable”，目录在但文件缺失记“SKILL.md missing”（第 148-151 行），frontmatter 对不上记“frontmatter invalid”；任一通道命中合法名片才算已安装，否则报红并附安装引导 installSkills（含 27 项完整清单，src/client/kernel/prompts.js:31）。
- 界面展示：技能列表（src/client/views/SkillsTab.js:38-51）只读构建时拼入的 SKILLS 短描述，文件缺失不影响列表渲染；描述文字来自 locale 词条，缺词条时退化为显示键名本身（src/client/index.js:101-108 的 tr 回退）。

一句话：缺原文只影响“装没装”的判断和安装引导，不影响列表打开。

## 4. 从文件到技能页签的读取链路

现在有两条链，互不相交，详情页需要第三条（见末尾）。

链 A——注册与探测（宿主 Node 进程读盘）：安装包里的 bundled-skills → src/host/bootstrap.js 启动时用 node:fs 逐个候选路径找随包目录（第 14-67 行，找到 wayfinder/SKILL.md 或目录数不少于 20 即认），以 bundled-mattpocock 为名、rank 350 向 DSH 技能服务注册 provider（第 106-188 行，盖过家目录旧副本）→ 探测时 src/host/skillProbe.js 经 skills.get 查注册表（第 258-317 行），查不到再走用户目录与项目目录的文件轻探（fs 服务通道加只读直读通道，第 191-246 行）。list/get 会读 SKILL.md 全文并解析 frontmatter，但只取 name/description 做注册，不送界面。

链 B——列表展示（界面进程，不碰盘）：src/shared/matt-skills.js 的 SKILLS_DATA → 构建时 scripts/build.mjs 的 SHARED_SPLICE 原样拼入 src/client/index.js（第 359、372、499-501 行）→ src/client/views/SkillsTab.js 逐行渲染“/名字加短描述加加载按钮”（第 38-51 行，点加载是 inject 往会话插入 /名字），另有 RingSkills 环形视图与 SkillFloatList 悬浮列表，描述都走 tr('skilldesc.<名字>') 读 locale 词条。界面进程从不读 SKILL.md 文件。

经过的进程与模块边界：构建机（build.mjs 拼接）→ 宿主 Node 进程（bootstrap、skillProbe、platformChannel、index.js，经 ctx.get('skills') 调 DSH 技能服务）→ 界面渲染进程（client/index.js、SkillsTab、locale 词条）。跨前两步的是文件系统，跨后一步的是构建产物与宿主接口，没有界面直读文件的路。

现状缺口（给 883 落地的事实依据）：SKILL.md 全文（含各技能附带 md）今天只到宿主为止，没有进界面的通道；SkillsTab 每行只有一个调注入的加载按钮，没有详情入口（883 地图 Notes 已取证）。要实现“点开看原文全文”，必须新增一条宿主读文件、界面做 Markdown 展示的调用（跨边界调用，按仓库日志纪律要加日志点；界面文案走中英文词条；单文件 350 行上限）。

## 来源索引

- 27 项真源：src/shared/matt-skills.js:21-81
- 随包目录与文件：package/bundled-skills/（27 目录各 1 份 SKILL.md；VERSION；LICENSE；README.md）
- 发布白名单：package/package.json（files 含 bundled-skills）
- 同步与版本：scripts/sync-matt-skills.mjs:5-32、103-114；package/bundled-skills/README.md
- 构建校验：scripts/build.mjs:359-372、499-501、711-740
- 注册：src/host/bootstrap.js:9-191；探测：src/host/skillProbe.js:60-74、136-165、191-246、258-336
- 展示：src/client/index.js:110-119；src/client/views/SkillsTab.js:6-66；src/client/kernel/locale-skilldesc.js:15-74；安装引导：src/client/kernel/prompts.js:30-31
- 地图与本票：#883（技能列表加详情入口与原文漂亮展示）、#884（本调研票）
