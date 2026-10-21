# 现有 YAML 体系与落地机制（报告一：现状摸底）

> 范围：本仓库已经落地的 YAML 真源体系是怎么构成的、怎么从 YAML 走到运行代码、由哪些门禁看守、有哪些已知代价与边界。
> 只读调查：结论逐条指回一手来源（文件路径加行号、issue 编号、ADR 编号），推测处会明确标出。
> 用词按根目录 `GLOSSARY.md` 的词条（真源、门禁、生成物、界面词表、语言清单、回退链、词族、键名联合类型）。

## 一句话地图

本仓库的 YAML 真源分成两大类。第一类是构建期生成常量：改 YAML、跑生成器、构建时把数值或文案拼进产物，用户机器上读不到 YAML。第二类是运行期读盘的用户数据文件：插件在用户机器上按需读写 YAML，核单元负责校验。三份真源加两套机制的具体内容是：时间参数（三份 YAML，140 个键，构建期定死）、界面文案与语言（十份词族 YAML 加一份语言清单，构建期生成带键名联合类型的词表）、提示词（五份族 YAML 加同一份语言清单，构建期生成模板数据），以及三份用户数据文件（工作区配置、本机设置、标签配色，运行期读盘）。

## 1. 已 YAML 化清单

### 1.1 构建期生成常量（三条生成链）

| 真源 | 用途 | 键结构 | 生成器 | 生成物（不入库） | 消费方 | 门禁 |
| --- | --- | --- | --- | --- | --- | --- |
| `config/timeouts.yaml`（169 行，约 69 键）、`config/intervals.yaml`（33 键）、`config/ttl.yaml`（38 键），合计 140 键 | 全仓时间参数的唯一书写处：超时上限、节拍间隔与退避、有效期 | 分组对象，键是时间名、值是毫秒整数，退避组是数组（`scripts/generate-time-config.mts:46-50`） | `scripts/generate-time-config.mts`（用法与纪律见该文件第 1-23 行） | `src/shared/time-config/src/values.ts`（命名常量）与表层的 `values.d.ts`（只有类型声明、没有值，该文件第 32-36 行） | 宿主与共享层真导入（`import { X } from '…time-config/values.js'`），界面半边由构建按 `CLIENT_TIME_NAMES` 名单摘常量拼进闭包 | `tests/verify-time-config.ts`（六节：链位置、生成新鲜度、真引用、界面拼接名单双向对账、无字面量、覆盖率，该文件第 1-36 行） |
| `config/languages.yaml`（31 行） | 客户端支持哪些语言、每种语言的回退链、缺省语言；提示词与界面共用的唯一一份语言表 | 顶层 `default`（今天是 `zh`）加 `languages` 映射，每门语言有 `label`（中英两份）与 `fallback`（只认第一项，见该文件第 1-18 行） | 不直接生成代码，由提示词与词表两条生成器的共享读取核 `scripts/lib/prompt-config.mts` 读入并校验 | 无独立生成物，随两份生成物一起生效 | 提示词生成器、词表生成器、客户端注册逻辑（按清单逐门调用宿主的加语言与注册词表接口） | `tests/verify-prompt-config.ts` 与 `tests/verify-locale-config.ts` 的语言清单段；校验层对多写回退项直接判红（`config/languages.yaml:12-14`） |
| `config/copy/` 下十份词族 YAML（`panel` 275 键、`flow` 235、`word` 189、`vcwrite` 102、`pages` 70、`labels` 51、`cards` 34、`skilldesc` 27、`skilldetail` 26、`spec` 21） | 界面词表的真源：一族一份文件，文件名就是族名 | 每份顶层是语言 id（今天 `zh` 与 `en`），语言段下面是词条键到文案的平铺映射，值一律是字符串，占位符写作 `{name}`（`config/copy/panel.yaml:1-12`） | `scripts/generate-locale-config.mts`（先重算时间参数生成器再烘字面量，该文件第 15-19 行；排序见 `scripts/build.mts:1773-1774`） | `src/client/kernel/locale-data.ts`（语言清单 `LANG_CONFIG`、语言 id 列表、完整词表 `LOCALE_COPY`、十族常量与键名联合类型，见 `docs/adr/20261020-ui-copy-data-driven.md:110`） | 构建登记为内核模块 `localeData`，在 `src/client/index.ts` 的 `kernel:localeData` 标记处拼进客户端闭包（`scripts/build.mts:498-502`，排在 `kernel:locale` 之前） | `tests/verify-locale-config.ts`（九件事：新鲜度、自校验、校验器坏数据演练、逐键相等、结构契约、目录自动发现、清单驱动注册、写死清零、旧片段不并存，该文件第 18-42 行）；`tests/verify-locale-completeness.ts`（完整性与双语覆盖，保留 #231 起的老判据，该文件第 17-29 行）；每门语言键数下限 1030 只许增不许减（`docs/adr/20261020-ui-copy-data-driven.md:114`） |
| `config/prompts/` 下五份族 YAML（工作区初始化、仓库对齐、地图推进、票面动作模板、建票入口；三处片段按注入时机住在对应族里） | 提示词模板的真源：23 条注册表模板加三处片段（`newBugFields`、`newWayfinderWiring`、`vocabularyDefaults`），见 #1282 正文 | 每条模板有 `placeholders`、`use`（只给人看的说明）、`zh` 与 `en` 正文（`config/prompts/workspace-initialization.yaml:1-10`）；语言段与片段键名由 `PROMPT_TEMPLATE_IDS` 与 `PROMPT_FRAGMENT_IDS` 两张硬编码清单校验（`tests/verify-prompt-config.ts:10-14`） | `scripts/generate-prompt-config.mts`（行为与时间参数生成器同款，见该文件第 8-11 行） | `src/client/kernel/prompt-data.ts`（只含模板数据，不含 `use`，见该文件第 18-20 行） | 构建登记为内核模块 `promptData`，在 `kernel:prompts` 之前拼进闭包（`scripts/build.mts:513-516`）；运行期只经 `promptText` 等函数取用 | `tests/verify-prompt-config.ts`（六件事：新鲜度、自校验、注册表键名不变、`use` 不进产物、占位符声明与使用一一对应、逐字相等，该文件第 16-26 行）；`tests/verify-prompts.ts`（质量门禁，数据源已从解析源码改成读 YAML，#1293；退役排版规则，`scripts/verify-stages.json:114`） |

真实片段示例（时间参数的写法约定）：

```yaml
# config/timeouts.yaml:1-13
# 单位一律是毫秒，文件里不写单位后缀。想改一个时间，先改这里，再跑一次生成器
# 缺键是构建错误，不是合法状态：生成器遇到 YAML 里没有的键直接报错，
# 调用方不许自己写数字顶上（单源头纪律，见 #1215）。未知键同样报错，不静默忽略。
version: 1
timeouts:
  toolTimeoutMs: 300000
```

真实片段示例（语言清单）：

```yaml
# config/languages.yaml:18-31
default: zh
languages:
  zh:
    label:
      zh: 简体中文
      en: Simplified Chinese
    fallback: []
  en:
    label:
      zh: English
      en: English
    fallback:
      - zh
```

真实片段示例（词族 YAML 的顶层形状）：

```yaml
# config/copy/panel.yaml:13-18
zh:
  nav.word: 沉淀
  nav.takeable: 可接
  ...
```

### 1.2 运行期读盘（三份用户数据文件）

| 文件 | 用途 | 读写入口 | 校验住在哪 | 版本与兼容 |
| --- | --- | --- | --- | --- |
| 工作区配置文件（新 `workspace.yaml`，老 `workspace.json` 只做兼容读） | 记录人选的后端、工作区布局等（调用方照旧从 `src/deck/shell/workspace-anchor.ts` 读常量，见该文件第 34-38 行） | `src/host/configStore.ts` 的 `readWorkspaceConfig` 与 `writeWorkspaceConfig`（冻结接口，见该文件第 11-18 行） | 核单元 `src/shared/config-store/src/workspace.ts`（文本入口与校验，见该文件第 86-123 行）；纯规则翻译在 `src/deck/rules/workspace-file.ts`，门面只做转发（`src/deck/shell/workspace-anchor.ts:1-18`） | 老 JSON 的 v1 四字段与新 YAML 的 v2 都认；版本高于认识的按只读回（`src/deck/shell/workspace-anchor.ts:53-56`）；写一律出 v2，注释由程序生成（该文件第 62-70 行） |
| 本机设置文件（`settings.yaml`，老 JSON 只做兼容读） | 不按工作区分的本机设置 | `src/host/configStore.ts` 的 `readLocalSettings` 与 `writeLocalSettings` | 核单元 `src/shared/config-store/src/settings.ts` | 与工作区文件同款的新老并存、写成功后删老文件（`src/host/configStore.ts:16-18`） |
| 标签配色文件（`label-colors.yaml`，老 JSON 只做兼容读） | 本地 Markdown 房的标签配色（该房的唯一真源，见任务书；消费方是 `src/tracker/rooms/markdown/label-colors*.ts` 共六份：`label-colors.ts`、`label-colors-codec.ts`、`label-colors-ops.ts`、`label-colors-paint.ts`、`label-colors-palette.ts`、`label-colors-errors.ts`） | `src/host/configStore.ts` 的 `readLabelColors` 与 `writeLabelColors` | 核单元 `src/shared/config-store/src/labels.ts`（超大与别名两道守卫见该文件第 78-106 行） | 同上 |

文本出入口的统一守卫：字符数上限 65536（按字数不按字节）、别名数量上限 50，YAML 解析钉死 `core` 模式（`src/host/configStore.ts:71-80`；核侧同数字同行为，`src/shared/config-store/src/workspace.ts:27-29` 与 `src/shared/config-store/src/labels.ts:19-21`）。

## 2. 机制边界：什么走构建期生成，什么走运行期读盘

判据一句话：调用方能不能在运行期读到仓库里的 `config/` 目录，决定了这个取值只能走哪一条路。

- 只能走构建期生成：客户端界面闭包。客户端拼进界面的代码不经过 Node 运行期读文件，它吃的值是构建时拼进去的（`scripts/generate-time-config.mts:7-12`）。如果服务器侧运行时读 YAML、客户端侧吃构建期快照，两边会悄悄分叉。统一走生成器之后，两边吃的是同一份数字。界面词表同理：插件安装后拿不到仓库里的 `config/` 目录，文案必须跟构建产物一起发出去，YAML 只作开发期真源（`scripts/lib/copy-config.mts:20-22`）。
- 必须走运行期读盘：宿主经文件服务读写用户数据。工作区配置、本机设置、标签配色是用户在自己机器上产生的数据，构建期根本不存在，只能在运行期由宿主经递进来的文件读写口读写（`src/host/configStore.ts:56-60`，桌面端走平台文件服务、测试给假实现）。新老并存、写成功后删老文件的迁移逻辑也只能在运行期做（该文件第 16-18 行）。
- 两条路都不许留第二份拷贝。时间参数侧，缺键不回落、未知键报错，回落表本身就是第二份数字拷贝（`config/timeouts.yaml:10-11`；`scripts/generate-time-config.mts:21-23`）。界面词表侧，手写语言清单、手写族清单都不许存在，族清单按目录自动发现（`scripts/lib/copy-config.mts:8-15`；`tests/verify-locale-config.ts` 第⑥条）。这一条是 #1289 的教训：手写清单漏掉了三份片段、65 条键没人管（`docs/adr/20261020-ui-copy-data-driven.md:16`）。

## 3. 既有代价与限制（逐条给证据）

1. 改了 YAML 忘了跑生成器，产物会静默过期：三条生成器都用 `--check` 挂在 `npm run typecheck` 最前面挡这一手（`package.json:14` 的串行顺序是词表、提示词、时间参数三道 `--check` 再加类型检查；`scripts/generate-locale-config.mts:26-29`）。代价是每次类型检查都要先跑三遍生成器。
2. 生成物被手改没有意义：下一次生成会覆盖，`--check` 会判红（`GLOSSARY.md:201` 的界面词表生成物词条；时间参数侧见 `docs/adr/20261016-time-config-yaml.md:36-40` 的第一条纪律）。
3. YAML 子集限制真实存在：解析钉死 `core` 模式，没加引号的 `yes`、`no`、`on` 会被读成文字，`1.10` 会被读成数字，类型对不上按坏形状回（`src/shared/config-store/src/workspace.ts:144-146`）。这是运行期读盘侧的证据；构建期三条生成器是否做同样的类型收口，需要读 `scripts/lib/prompt-config.mts` 与生成器的校验段才能定（本次未读全，见第 7 节）。
4. 类型信息丢失要靠生成器补回来：界面词表生成物带键名联合类型，漏译在编译期就红（`GLOSSARY.md:202`；`docs/adr/20261020-ui-copy-data-driven.md:56-58`）；提示词生成物的键联合类型等于清单 id，增删模板遗漏编译期就红（`scripts/generate-prompt-config.mts:42-48`）。代价是清单要在生成器里再硬编码一份（`PROMPT_TEMPLATE_IDS`），加模板要改两处：YAML 与清单。
5. 别名与超大有两道守卫：正常配置文件里一个别名都不会有，上限 50 是宽松的哨兵；超 65536 字说明拿错了文件（`src/host/configStore.ts:76-80`；核侧 `src/shared/config-store/src/workspace.ts:96-109`）。代价是恶意或误放的大文件在解析前就被拒绝，调用方只能收到 `oversize` 或 `aliases` 原因。
6. 时间参数是编译期配置，不做运行期可调：三份 YAML 只活在仓库里，发布包的文件白名单里没有 `config`，运行期没有任何代码读它们。调一个时间的完整动作是改 YAML、跑生成器、重新构建、重新发版（`docs/adr/20261016-time-config-yaml.md:70-74`）。代价是线上调参必须走发版。
7. 界面时间参数要过二手烘焙：词表里的 `{{时间参数}}` 或 `{{时间参数/1000}}` 由词表生成器按时间参数生成物烘成字面量，不做通用表达式求值（`scripts/lib/copy-config.mts:43-48`）。写错名字当场判红，不静默留占位符（该文件第 17-18 行）。代价是文案里只能用这一种引用形状。
8. 门禁正在隔离期的有一扇：`tests/verify-time-config.ts` 当前在 `scripts/verify-stages.json:93-97` 的隔离表里（3 处覆盖告警未定性），CI 全链跑的是 `node scripts/verify-all.mts`（`.github/workflows/verify.yml:64`），这扇门禁何时归队取决于 #1215 的收口。这是现状，不是机制缺陷。

## 4. 仓库里已有的判据

- #1278（提示词库 YAML 化讨论票，结论已定）：第一性原理是提示词是人写的字、真源就该用人能直接读改的格式；一份数据只该有一处出处；加一门语言不该改代码；运行期用不到的 `use`、`version`、`placeholders` 不进客户端产物；门禁从依赖源码排版改成读 YAML 断言，盯排版的规则整条退休（#1278 正文第一、二节；`scripts/verify-stages.json:114` 记了 `verify-prompt-newlines.ts` 的退役去向）。
- #1215（时间参数 ADR，`docs/adr/20261016-time-config-yaml.md`）：三份 YAML 按用途分家共 140 键（该文件第 18-28 行）；明确不入 YAML 的清单（非时间数字、单位换算、哨兵、透传与计算值、样式时长另立 #1236，该文件第 103-113 行）；新参数必须先登记、理由写不清的不豁免（该文件第 36-40 行）。
- #1284（界面文案 ADR，`docs/adr/20261020-ui-copy-data-driven.md`）：界面词表与提示词用同一套机制、共用同一份语言清单（该文件第 22-35 行）；完整性门禁改成对着语言清单逐门核对、查哪些文件按目录自动发现（该文件第 42-47 行）；门禁改写判定强度不许降，要交新旧对照表（该文件第 47 行；两份对照表是 `docs/design/1294-locale-gate-strength.md` 与 #1283 要求的提示词对照表）。
- #1282 与 #1283（施工票）：#1282 定了提示词五份族 YAML 的拆分、`use` 只留一句用途、生成器与门禁共用 `scripts/lib/prompt-config.mts`、产物 `prompt-data.ts` 不入库；#1283 定了提示词质量门禁改读 YAML、判定强度一条不减、门禁归属表要把 `config` 加进 `scripts/gate-map.mts` 的路径前缀（今天 `config/` 零命中）。两张票正文的进度节都还写着尚未动工或被阻塞（#1282 正文进度节；#1283 正文进度节），但 `verify-stages.json:114` 又记了 #1293 已删 `verify-prompt-newlines.ts`，票面进度与链上记录对不上，见第 7 节。
- 日志侧：界面语言注册新增的两条事件（`locale.registration` 与 `locale.registration.fail`）已记进 `research/489-appendix.md` 第 1 章的 #112 与 #113，`verify-log-count` 与 `verify-log-fields` 已同步（`docs/adr/20261020-ui-copy-data-driven.md:113`）。日志契约本文是 `docs/design/335-logging-contract.md`（现行条数以附录为准，该文件第 10 行）。

## 5. 可复用性判断：加一类配置时哪里能照抄、哪里必须先改

能直接照抄的三处（机制已经收敛）：

- 生成器骨架：读 YAML、校验、渲染源码文本、`--check` 只比对不写盘、全新检出先现场生成再判过。时间参数生成器是原型（`scripts/generate-time-config.mts:14-23`），提示词与词表生成器是同款复刻（`scripts/generate-prompt-config.mts:8-11`；`scripts/generate-locale-config.mts:12-14`）。
- 生成器与门禁共用读取核：`scripts/lib/prompt-config.mts`（提示词与语言清单）与 `scripts/lib/copy-config.mts`（词族目录发现、语言完备、占位符、时间参数引用）各只有一份，不各写两份规则（`scripts/lib/copy-config.mts:1-7`；`tests/verify-prompt-config.ts:32-35` 还记了一笔两份产物读取小工具尚未收拢的欠账）。
- `--check` 挂进 `npm run typecheck` 最前面：改了 YAML 忘了生成当场判红并提示跑一次生成器（`package.json:14`；`scripts/build.mts:1768-1790` 还在构建拼装前再跑一遍三条生成器，构建输入指纹也含 YAML，见该文件第 105 行）。

必须先改的三处（照抄会踩坑）：

- 门禁的挑选规则：提示词门禁在门禁归属表里今天对 `config/` 零命中，要先把 `config` 加进 `scripts/gate-map.mts` 的路径前缀（#1283 正文范围节）。新配置类别落地时归属表必须同步，否则改 `config/` 的提交选不到对应的门禁。
- 数组型配置的支持：时间参数的退避组是今天唯一的数组值，分组校验只认 `backoff` 这一个数组组（`scripts/generate-time-config.mts:46-50`）。新类别里再出现数组，要先给分组表加新组并补校验规则，不能默认数组都能过。
- 错误信息风格：时间参数生成器对未知键按编辑距离提示最像的键（`scripts/generate-time-config.mts` 第 312 行附近）；运行期核的错误信息是给人看的完整句子（`src/shared/config-store/src/workspace.ts:144-156`）。新类别要沿用同一风格：拼错要指路、类型错要说清 YAML 子集那一层的原因。

## 6. 两类机制一句话对照

- 构建期生成常量：YAML 只活在仓库里，生成器在构建或类型检查时现场算出源码，产物不入库；调用方读到的是生成出来的值，源码里不许再写第二份（时间参数、界面词表、提示词三条链都是这个形状）。
- 运行期读盘：文件活在用户机器上，宿主经文件读写口读写，核单元只做文本到字段表的编解码与校验；老 JSON 当 YAML 子集直接读，写一律出新版 YAML（工作区配置、本机设置、标签配色三份都是这个形状）。

## 7. 没查清的（需要别人确认）

1. #1282 正文说提示词 YAML 不保留 `version` 字段，但盘上的 `config/prompts/workspace-initialization.yaml:2` 写着 `version: 15`，且 `use` 里还在记 v16 的沿革。这是票面进度节过时（施工时改了主意），还是文件尚未按票面收口，需要看 #1282 的后续评论或问维护者。
2. #1282 与 #1283 正文进度节写着尚未动工，但 `scripts/verify-stages.json:114` 记了 #1293 已删 `tests/verify-prompt-newlines.ts` 且判据并入 `tests/verify-prompts.ts`。两处记录打架，完成度以哪一处为准，需要对账。
3. 构建期三条生成器对 YAML 子集（`yes`、`no`、`on`、浮点、`1.10` 这类）的收口是否与运行期核一致，本次只读了 `scripts/lib/copy-config.mts` 的注释（占位符与时间参数引用两段），没有读完 `scripts/lib/prompt-config.mts` 的校验函数。给新类别定统一的 YAML 子集口径之前，要把那份文件的校验段读完。
4. `research/489-appendix.md` 第 1 章的现行事件条数，以及 `verify-log-count` 与 `verify-log-fields` 是否还与附录一致，本次没有核对。报告里引的 #112 与 #113 两条事件来自 ADR 落地记录节，不是附录原文。
