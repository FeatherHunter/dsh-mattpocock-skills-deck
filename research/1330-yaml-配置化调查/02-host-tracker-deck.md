# 第二片调查：宿主端与核里还能搬进 YAML 的取值

> 范围：`src/host`、`src/tracker`、`src/deck`、`src/shared`（跳过已经 YAML 化的 `src/shared/time-config` 与 `src/shared/config-store`）、`src/seam`。
> 口径：四份报告共用同一套「适合 YAML 化」判据（强候选 / 中候选 / 不适合），判据原文见任务书，这里不再复述。
> 人话说明：YAML 配置管理的意思是，把现在写死在代码里的字面量（名单、数字、文案）搬到 `config/` 下的 YAML 文件里，代码在构建时生成常量或在运行时读盘。好处是以后改这些取值不用改代码。

## 0. 本片结论一句话

时间类取值已经住进了中央 YAML（`config/timeouts.yaml`、`config/intervals.yaml`、`config/ttl.yaml`，生成器见 `scripts/generate-time-config.mts`），这一片剩下的主要是**名单与数字**：标签颜色、对象类型、分页上限、并发上限、命令清单、命名词表、文件位置约定。分级在第 2 章，重复字面量清单在第 3 章，明确不搬的在第 4 章。

## 1. 已经 YAML 化、不要重复报告的（本片只列，不算候选）

- 超时四档（读 / 写 / 探活 / 默认）住 `config/timeouts.yaml` 的 `outbound*` 四键，`src/tracker/kernel/outbound-tiers.ts:17-26` 只留同名别名，门禁 `tests/verify-time-config.ts` 看守一致。
- 出站分档的动词表（`WRITE_VERBS`、`isProbeGhArgs` 的探活动词）是判定逻辑，住 `src/tracker/kernel/outbound-tiers.ts:37-81`，不算纯取值（见第 4 章）。
- 界面文案住 `config/copy/*.yaml`，语言清单住 `config/languages.yaml`，提示词住 `config/prompts/*.yaml`，生成器是 `scripts/generate-prompt-config.mts` 与 `scripts/generate-locale-config.mts`。
- 工作区记忆文件的位置与形状（`WORKSPACE_YAML_REL` 等）已经是配置存储层 `src/shared/config-store` 的职责，不在本片候选里。

## 2. 值得搬的候选项（按值得程度排序）

### 候选 1：标签颜色名单（CANONICAL_LABELS，含颜色码）

- 现在值：10 个标签名与颜色码，住 `src/tracker/contract/canonical-labels.ts:7-18`（例如 `bug → d73a4a`、`needs-triage → fbca04` 等 10 项）。
- 住哪：`src/tracker/contract/canonical-labels.ts:7-18`；派生查询住 `src/tracker/label-names.ts:1-43`。
- 谁在消费：三个房间的标签读写（GitHub 房 `src/tracker/rooms/github/label-colors-ops.ts`、GitLab 房 `src/tracker/rooms/gitlab/labels-ops.ts`、Markdown 房 `src/tracker/rooms/markdown/label-colors-ops.ts`）、快照组装时回填颜色、面板调色盘；日志事件 `labelColors.write` / `labelColors.read` 记录读写。
- 第二份真源：有。`docs/agents/triage-labels.md` 有同一套标签的人话说明（旧调色盘表已声明不再读，见 `src/tracker/rooms/markdown/index.ts:305` 注释），属于文档与代码各存一份。
- YAML 形状示例：
  ```yaml
  labels:
    - name: bug
      color: d73a4a
    - name: needs-triage
      color: fbca04
  ```
- 迁移代价：小。改动约 5–8 个文件，加一个生成器（仿 `scripts/generate-time-config.mts` 由 YAML 生成颜色常量），门禁仿 `tests/verify-time-config.ts` 看守一致。
- 风险：低。颜色码是纯数据，没有逻辑；运行期读盘或构建期生成常量都可以，类型安全不受影响。
- 机制：构建期生成常量（推荐）。颜色在启动与快照组装时高频读取，生成常量最省；运维改颜色走发布即可。

### 候选 2：对象类型名单（OBJECT_KINDS，九种票面对象类型）

- 现在值：9 个对象类型，住 `src/shared/issue-file/src/marker.ts:17-19`（`map、spec、ticket、research、prototype、grilling、task、bug、issue`），顺序与 ADR 2.1 的表一致；另有 `HEADER_ONLY_KINDS = ['spec', 'ticket']`（`src/shared/issue-file/src/marker.ts:33`）。
- 谁在消费：本地 Markdown 房（读票认规格、建票写入）、宿主快照组装层（类型兜底归一）、deck 工具建票写标记（`src/deck/tools/issue-create.ts:17-19`）。
- 第二份真源：有。ADR（#1275 的 ADR 2.1/2.5）里的对象类型表与代码里的名单是同一套意思的两份写法。
- YAML 形状示例：
  ```yaml
  objectKinds: [map, spec, ticket, research, prototype, grilling, task, bug, issue]
  headerOnlyKinds: [spec, ticket]
  markerName: DSH-ISSUE-KIND
  ```
- 迁移代价：小。改动约 3–5 个文件，加生成器与门禁；标记拼写规则（正则）留在代码里，只把名单搬出去。
- 风险：低。名单是纯枚举；校验函数（`isObjectKind`）继续由生成的常量驱动，类型安全不丢。
- 机制：构建期生成常量（推荐）。标记读写是纯函数，不读盘，生成常量即可。

### 候选 3：分页与配额数字（三个房间各写一份，形态同构）

- 现在值（分散在三处，含义相同）：
  - GitHub 房：`page.ts:48-49`（`DEFAULT_LIMIT 50`、`MAX_LIMIT 200`）、`sub-issues.ts:46-47`（`PAGE_SIZE 100`、`MAX_SUB_ISSUES 1000`）、`pulls.ts:32-33` 与 `issues.ts:105-106`（`PAGE 100`、`MAX_PAGES 10`）、`label-colors-ops.ts:52`（`LABEL_LIST_LIMIT 1000`）、`idempotency.ts:65`（`MAX_BODY_FETCHES 40`）、`idempotency.ts:125`（`LIST_LIMIT 100`）、`queries.ts:57`（`DEPS_MAX 50`）。
  - GitLab 房：`pages.ts:61-67`（`DEFAULT_LIMIT 50`、`MAX_LIMIT 200`、`MAX_PER_PAGE 100`）、`labels-ops.ts:90-104`（`LABEL_LIST_PER_PAGE 100`、`LABEL_LIST_MAX_PAGES 100`、`WRITE_CONCURRENCY_MAX 4`、`WRITE_CONCURRENCY_DEFAULT 4`）、`sub-issues.ts:53-55`（`MAX_SUB_ISSUES 1000`、`PAGE_SIZE 100`）、`idempotency.ts:38`（`SCAN_LIMIT 100`）。
  - Markdown 房：`page.ts:36-37`（`DEFAULT_LIMIT 50`、`MAX_LIMIT 200`）。
- 谁在消费：各房的列表、翻页、子票、标签列举、幂等扫描。
- 第二份真源：有（见第 3 章重复清单）。`50 / 200` 这组上下限在三个房间各写一份；`PAGE_SIZE 100` 与 `MAX_SUB_ISSUES 1000` 在 GitHub 与 GitLab 各写一份；`per_page=100` 字面量散落在 REST 调用里。
- YAML 形状示例：
  ```yaml
  paging:
    defaultLimit: 50
    maxLimit: 200
    pageSize: 100
    maxPages: 10
    maxSubIssues: 1000
    labelListLimit: 1000
    maxBodyFetches: 40
    scanLimit: 100
  concurrency:
    labelColorWrites: 4
  ```
- 迁移代价：中。改动约 10–15 个文件，加生成器与门禁；三房各自的特殊上限（如 GitLab 的 `MAX_PER_PAGE 100` 是远端硬上限）要保留注释说明。
- 风险：低。都是纯数字；远端硬上限类数字搬进 YAML 时要在注释里写清“改大也不管用”，避免运维误调。
- 机制：构建期生成常量（推荐）。分页数字是请求参数，不需要运行时改。

### 候选 4：版本控制命令清单（允许的命令、参数模板、分支规则）

- 现在值：命令口径住 `src/shared/version-control/src/commands.ts:21-173`（`COLLECTION_KEYS`、`FIRST_SCREEN_KEYS`、`RUNNING_MARKER_PATHS` 5 项、`fixedPrefix`、`stepZeroArgs`、`commandFor` 六采集项、`REV_PATTERN`、`WRITE_SUBCOMMANDS` 8 项、`REMOTE_PATTERN`、`BRANCH_PATTERN`、stage/unstage/commit/pull/push/fetch/lsFilesStage/remoteList/checkRef/autocrlf 的参数模板）；宿主侧消费见 `src/host/versionControl.ts:35`。
- 谁在消费：宿主版本控制页签（读状态、读差异、读历史、写操作五电话 `wf.gitStage` 等，见附录 `research/489-appendix.md` 第 46 段）、门禁 `tests/verify-version-control-rules.ts` 等三份。
- 第二份真源：暂未发现第二份硬拷贝（命令清单只住这一份）。但它是“策略清单”（允许哪些子命令、参数怎么写），符合强候选的“策略 / 参数 / 清单”定义。
- YAML 形状示例：
  ```yaml
  versionControl:
    writeSubcommands: [stage, unstage, commit, pull, push, fetch]
    revPattern: "^[0-9a-f]{...}$"
    branchPattern: "..."
    runningMarkerPaths: [...]
  ```
- 迁移代价：中。改动约 5–8 个文件，加生成器与门禁；正则表达式进 YAML 要转义，生成器负责还原。
- 风险：中低。命令清单是安全边界（allowlist），搬进 YAML 后要门禁保证“YAML 改了、生成的 allowlist 同步变了”，否则会出现放行了不该放行的命令。
- 机制：构建期生成常量（推荐，安全边界不建议运行时读盘）。

### 候选 5：命名词表（占位词、动作词、草稿词、长度预算）

- 现在值：
  - 占位前缀 `SESSION_TITLE_PREFIX = '[New]'`（`src/shared/naming-titles.ts:43`）。
  - 占位三词 `PLACEHOLDER_TITLES`（`src/shared/naming-titles.ts:45-48`，中英各三：新建需求 / 新建 Bug / 实施地图）。
  - 八动作词 `ACTION_WORDS`（`src/shared/naming-titles.ts:53-62`：诊断 / 修复 / 讨论 / 研究 / 原型 / 接手 / 补充 / 体检）。
  - 草稿词 `DRAFT_WORDS = { zh: '草稿', en: 'Draft' }`（`src/shared/naming-titles.ts:254`）与 `DRAFT_TITLE_RE`（同文件 `:256`）。
  - 长度预算 `SESSION_TITLE_MAX_BYTES = 120`（同文件 `:185`）。
- 谁在消费：宿主命名守护（首轮命名、草稿合成、编号档合成）、界面闭包（构建脚本 `scripts/build.mts` 以 `SHARED_SPLICE` 把三文件拼回界面）、门禁 `tests/verify-naming-title-fact.ts` 等。
- 第二份真源：有。三文件墙式隔离导致清洗函数与档位常量各存两份（`naming-attribution.ts:23-34` 注释写明“与另两文件同源，改动时一起改”），属于已知的人肉同步。
- YAML 形状示例：
  ```yaml
  naming:
    prefix: "[New]"
    maxBytes: 120
    placeholders:
      zh: { requirement: 新建需求, bug: 新建 Bug, spec: 实施地图 }
      en: { requirement: New Requirement, bug: New Bug, spec: Impl map }
    actions: { diagnose: { zh: 诊断, en: Diagnose }, ... }
    draft: { zh: 草稿, en: Draft }
  ```
- 迁移代价：中。改动约 5–8 个文件，加生成器与门禁；界面闭包拼接（`SHARED_SPLICE`）要同步改，门禁要覆盖两半。
- 风险：中。词表进 YAML 后，中英两列的缺失回退逻辑（`wordFor` 缺列退中文）要在生成器或校验器里保留，否则缺一列会导致界面显示回退行为变化。
- 机制：构建期生成常量（推荐）。词表要进界面闭包，运行时读盘够不到界面侧。

### 候选 6：文件位置约定（目录名、文件名、标记串、锚点路径）

- 现在值：
  - 选择记忆文件位置三段 `CHOICES_HOME_SEGMENT = '.dsh'`、`CHOICES_DIR_NAME = 'mattskillsdeck'`、`CHOICES_FILE_NAME = 'choices.json'` 与 `CHOICES_VERSION = 1`（`src/host/choiceStore.ts:144-148`）。
  - 上限三数 `DEFAULT_MAX_WORKSPACES = 200`、`DEFAULT_MAX_LAYOUTS = 200`、`DEFAULT_MAX_FILE_BYTES = 512*1024`（同文件 `:152-154`）。
  - 工作区锚点 `WORKSPACE_ANCHOR_REL = 'docs/agents/issue-tracker.md'`（`src/host/workspaceKey.ts:68`）。
  - Markdown 房路径约定：`.scratch/<effort>/map.md`、`issues/`、`spec.md`（`src/tracker/rooms/markdown/path.ts:48-85`）、票文件名规则（同文件 `:31-38`）。
  - 票面标记名 `MARKER_NAME = 'DSH-ISSUE-KIND'`（`src/shared/issue-file/src/marker.ts:26`，未导出）。
- 谁在消费：宿主工作区判定、选择记忆读写、Markdown 房全部读写路径、快照组装、门禁多份。
- 第二份真源：部分有。`.scratch/map.md` 等路径字面量在 `src/host/remotePredicates.ts:76-92`、`src/tracker/rooms/markdown/*` 多处重复出现（见第 3 章）。
- YAML 形状示例：
  ```yaml
  paths:
    choices: { homeSegment: .dsh, dirName: mattskillsdeck, fileName: choices.json, version: 1 }
    workspaceAnchor: docs/agents/issue-tracker.md
    markdown: { mapFile: map.md, issuesDir: issues, specFile: spec.md, scratchDir: .scratch }
  limits:
    maxWorkspaces: 200
    maxLayouts: 200
    maxFileBytes: 524288
  ```
- 迁移代价：中。改动约 8–12 个文件，加生成器与门禁；路径是跨层契约，改一处要三处同步。
- 风险：中。路径改错会导致“找不到地图 / 找不到记忆”，门禁必须覆盖“生成值与现状逐字一致”。
- 机制：构建期生成常量（推荐）。路径是编译期契约，运行时读盘反而多一层失败面。

### 候选 7：房间注册表与能力顺序（房间名单、工具装配顺序、操作目录顺序）

- 现在值：
  - 九个工具的装配顺序 `DECK_TOOL_ORDER`（`src/deck/rules/tool-order.ts:12-14`），旧路径 `src/deck/tools/tool-order.ts:6` 只做转发。
  - 契约操作目录顺序 `OPERATIONS` 22 条 + `LOCATORS` 3 条（`src/tracker/contract/operations-catalog.ts:62-114`），注释写明“顺序即上层读到顺序”。
  - 房间三分（`src/tracker/rooms/github`、`gitlab`、`markdown`）目前是目录结构，没有一份集中的房间注册表（这是个缺口，不是现成名单）。
- 谁在消费：工具装表、注册行、帮助文本按序渲染（`tool-order.ts:7-8` 注释）；操作目录的上层读取方。
- 第二份真源：暂未发现硬拷贝重复。候选理由是“条目同构、可枚举”，适合 YAML 化后由生成器产出顺序常量，消除“顺序漂移”类故障。
- YAML 形状示例：
  ```yaml
  rooms: [github, gitlab, markdown]
  toolOrder: [deck_context, deck_issue_get, deck_map_snapshot, ...]
  ```
- 迁移代价：小中。改动约 3–5 个文件，加生成器与小门禁（断言顺序一致）。
- 风险：低。顺序是纯数据；但要注意“顺序即语义”（操作目录的顺序是上层读取顺序），YAML 里要保留顺序语义（数组有序）。
- 机制：构建期生成常量（推荐）。

### 候选 8：日志事件名台账（事件名字符串，代码里是硬编码字面量）

- 现在值：事件名以字符串字面量形式散落在各发射点，例如房间侧 `roomLogEvent(ctx, 'warn', 'gh.timeout', ...)`（`src/tracker/rooms/github/client.ts:266`）、`'gh.exec'`（同文件 `:259`）、`'gh.resolve.fail'`（同文件 `:214`）。台账（对照表）在 `research/489-appendix.md` 第 1 章维护，现行总数 105 条（常驻 49 / 按需 51 / 自监控 5，见附录第 68 段口径）。
- 对齐方式：门禁（`tests/verify-log-fields.ts`、`tests/verify-log-count.ts` 等）核对“代码发射点 ↔ 台账 ↔ 白名单”三处一致。
- 谁在消费：宿主与房间的全部埋点、日志导读（`docs/log-reading-guide.md`）、门禁。
- 第二份真源：有（见第 3 章）。事件名在代码字面量与附录台账里各存一份，靠门禁人肉对齐。
- YAML 形状示例：
  ```yaml
  logEvents:
    - name: gh.exec
      level: info
      residence: resident
    - name: gh.timeout
      level: warn
      residence: resident
  ```
- 迁移代价：大。改动文件数十个（全部发射点），要生成器（由 YAML 生成事件名常量）与门禁（台账即 YAML 本身，消除一处重复）。
- 风险：中。事件名是跨包契约（宿主包、客户端包、已安装包三处名单），改动要三处同步；好处是把“台账 ↔ 代码”从人肉对齐变成单源生成。
- 机制：构建期生成常量（推荐）。事件名是编译期契约；台账文档可由同一份 YAML 渲染，从根本上消除重复。
- 说明：这是一个判断，不是已经落地的方案。是否把附录台账本身 YAML 化，需要日志负责人（#502 总纲）点头。

### 候选 9：判定表的可枚举部分（后端种类、状态、错误档、证据优先级）

- 现在值：
  - 证据优先级 `EVIDENCE_PRIORITY = ['workspace-file', 'declaration', 'autodetect']`（`src/tracker/detection/backendDecision.ts`，见基线摘要块 b2）。
  - 多认领顺序 `MULTI_CLAIM_ORDER = ['github', 'markdown', 'gitlab']`（同上）。
  - 判定缺口 13 档 `DECISION_GAPS`（同上）。
  - 词汇表 `BACKEND_KIND、STATE、ISSUE_TYPE、SPEC_BODY_MARKER、SNAP_MODE、CLOSED_REASON、ACTOR_KIND、FIELD_TYPE、ERROR_KIND、CONTRACT_VERSION`（`src/tracker/contract/vocabulary.ts:20-114`）。
  - 网络码名 `NETWORK_CODES` 10 个、`RULE_LAYERS`、`RAW_HEAD 600`、`RAW_TAIL 200`（`src/tracker/kernel/error-rules.ts`，见块 b2）。
- 谁在消费：判定链、检测服务、错误归一、契约校验、门禁多份。
- 第二份真源：部分有。ADR `docs/adr/20261014-error-classification-single-source.md` 说的“单一真源”就是 `error-rules.ts` 的 `COMMON_RULES`（代码注释自称唯一真源）；ADR 文本与代码是同一套规则的两份写法。
- YAML 形状示例：
  ```yaml
  detection:
    evidencePriority: [workspace-file, declaration, autodetect]
    multiClaimOrder: [github, markdown, gitlab]
    gaps: [no-evidence, conflict, ...]
  ```
- 迁移代价：中大。改动约 8–12 个文件，加生成器与门禁；但判定分支逻辑本身必须留在代码里，只能搬“名单部分”。
- 风险：中。这是典型的**中候选**：名单形态同构，但消费处有类型敏感的分支判断（`switch (gap)` 这类），搬进 YAML 会丢编译期穷尽检查。替代办法是字符串枚举 + 校验器 + 单一真源函数（生成器产出联合类型，门禁断言分支覆盖）。
- 机制：构建期生成常量（必须）。判定是纯函数，不读盘；运行时读盘会拖慢每次判定。

### 候选 10：GraphQL 查询文本与字段映射（GitHub 房查询，GitLab 房路径表）

- 现在值：GitHub 房查询全套住 `src/tracker/rooms/github/queries.ts:17-272`（`ISSUE_FRAGMENT`、`LIST_QUERY`、`GET_QUERY`、`DEPS_QUERY`、`COUNTS_QUERY`、`PAGE_ISSUE_FRAGMENT`、`LIST_PAGE_QUERY`、`SUB_ISSUE_FRAGMENT`、`SUB_ISSUES_QUERY`、`PULL_REQUEST_FRAGMENT`、`LIST_PR_QUERY`、两个阻塞边 mutation、`issueNodeIdsQuery`）；GitLab 房路径表住 `src/tracker/rooms/gitlab/queries.ts:8-39`。
- 谁在消费：各房的读路径（列表、详情、计数、翻页、子票、关系边）。
- 第二份真源：暂未发现硬拷贝重复（查询只住这一份）。候选理由是“策略 / 参数”属性：字段列表是“问远端要哪些列”的声明， outing 运维可调。
- YAML 形状示例：
  ```yaml
  github:
    depsMax: 50
    labelFirst: 20
    queries:
      list: "query($owner:String!,...) {...}"
  ```
- 迁移代价：中。改动约 5–8 个文件，加生成器；多行 GraphQL 文本进 YAML 要注意缩进与转义。
- 风险：中低。查询文本是纯数据，但改错一个字段会导致整路查询失败；门禁要有“生成文本与现状逐字一致”断言，发布前最好有合成回包实跑（现有 `verify-github-*` 门禁已有此模式）。
- 机制：构建期生成常量（推荐）。查询文本是编译期契约；运行时读盘多一层失败面，收益不明显。
- 说明：字段映射（`with_labels_details=true` 这类）比查询文本更值得先搬；整段查询文本是否搬，可以分两步走。

### 候选 11：deck 工具的参数声明（默认值、取值范围、枚举选项）

- 现在值：九个工具各自的 `definition.parameters`，例如 `deck_issue_create` 的 `definition`（`src/deck/tools/issue-create.ts:77-80`，参数表从该处开始）；数字参数有统一收口 `numOpt`（同文件 `:26`，正的有限数才要）。
- 谁在消费：宿主工具装表、AI 参数校验、帮助文本。
- 第二份真源：推测有（还缺一手证据）。参数描述的人话版本可能同时出现在帮助文本与 `definition.description` 里；需要别人确认帮助文本是否另存一份（见第 5 章）。
- YAML 形状示例：
  ```yaml
  tools:
    deck_issue_create:
      params:
        limit: { default: 50, min: 1, max: 200 }
        state: { enum: [open, closed, all], default: open }
  ```
- 迁移代价：中大。改动约 10 个文件，加生成器（生成参数表）与门禁；参数校验逻辑（`numOpt` 这类）必须留在代码里。
- 风险：中。这是**中候选**：参数声明里混着类型敏感的校验（整数、正数、枚举），全搬会丢类型安全。建议只搬“数据部分”（默认值、上下限、枚举选项），校验函数继续手写并由门禁断言覆盖。
- 机制：构建期生成常量（推荐）。工具定义要进系统提示，运行时读盘够不到注册时序。

### 候选 12：选择记忆的上限与文件形状版本号

- 现在值：`DEFAULT_MAX_WORKSPACES = 200`、`DEFAULT_MAX_LAYOUTS = 200`、`DEFAULT_MAX_FILE_BYTES = 512*1024`（`src/host/choiceStore.ts:152-154`）；文件形状版本 `CHOICES_VERSION = 1`（同文件 `:148`）；布局取值 `LAYOUT_VALUES = ['single', 'multi']`（同文件 `:150`）。
- 谁在消费：宿主选择记忆读写（`choiceStore.ts` 全文件）、日志事件 `choiceStore.file.bad` 等 5 条。
- 第二份真源：暂未发现硬拷贝。
- YAML 形状示例：
  ```yaml
  choiceStore:
    version: 1
    maxWorkspaces: 200
    maxLayouts: 200
    maxFileBytes: 524288
    layouts: [single, multi]
  ```
- 迁移代价：小。改动约 2–4 个文件，加生成器与小门禁。
- 风险：低。纯数字与纯名单；版本号是文件形状契约，改动时要同步迁移逻辑。
- 机制：构建期生成常量（推荐）。上限是启动即用的常量。

## 3. 已经有第二份真源的具体清单（重复字面量在哪里出现）

| 重复内容 | 出现位置 |
|---|---|
| 分页上下限 `50 / 200` | `src/tracker/rooms/github/page.ts:48-49`、`src/tracker/rooms/gitlab/pages.ts:61-62`、`src/tracker/rooms/markdown/page.ts:36-37` 三处各写一份 |
| 子票页大小 `100` 与上限 `1000` | `src/tracker/rooms/github/sub-issues.ts:46-47`、`src/tracker/rooms/gitlab/sub-issues.ts:53-55` 两处各写一份 |
| `per_page=100` 字面量 | `src/tracker/rooms/github/graph.ts:124`、`parent-repair.ts:54`、`pulls.ts:33-36`、`issues.ts:111`、`src/host/issueList.ts:299` 等；GitLab 侧 `graph-blocking.ts:237`（`per_page=100`） |
| 标签列举上限 `1000` | GitHub `label-colors-ops.ts:52`（`LABEL_LIST_LIMIT 1000`）；GitLab 是 `100 × 100 = 10000`（`labels-ops.ts:90-100`），口径不同但意思相近 |
| 评论翻页 `per_page=50` | `src/host/issueDetail.ts:102`、`commentThreads.ts:77`、`issueList.ts` 等宿主旧路 |
| 命名清洗与档位常量两份 | `src/shared/naming-titles.ts` 与 `src/shared/naming-tracking.ts`、`src/shared/naming-attribution.ts:23-34`（注释自认同源，改动要三处同改） |
| 日志事件名两份 | 代码发射点字面量（如 `client.ts:214/259/266`）与 `research/489-appendix.md` 第 1 章台账 |
| 标签名单两份 | `canonical-labels.ts:7-18` 与 `docs/agents/triage-labels.md` 的人话说明 |
| 错误规则两份 | `error-rules.ts` 的 `COMMON_RULES` 与 ADR `docs/adr/20261014-error-classification-single-source.md` 的规则描述 |
| 路径字面量多份 | `.scratch/map.md` 等在 `remotePredicates.ts:76-92` 与 `markdown/path.ts`、`markdown/issues-locate.ts` 等处重复拼写 |

## 4. 明确不该搬的（6 项）

1. **出站分档的动词判定**（`isWriteGhArgs`、`isProbeGhArgs`、`tierForGhArgs`，`outbound-tiers.ts:36-81）：承载分支逻辑（“这条命令算读还是算写”），搬进 YAML 会把判断变成数据查表，丢掉代码的可读性与可测试性。超时数字已经 YAML 化了，判定留代码。
2. **编号归属的语义相关性算法**（`isHintRelatedToTitle`，`naming-attribution.ts:85-108`）：长度阈值 `4`、大小写归一、前缀剥离是算法调参，不是独立取值；阈值与循环逻辑耦合，搬出去只剩一个裸数字，收益小于多一层间接。
3. **标题清洗的正则与截断算法**（`cleanTitleText`、`truncateTitleUtf8`，`naming-titles.ts:205-236`）：正则表达式与逐字符累加是逻辑，YAML 存正则只会让转义更难读；预算数字 `120` 可以搬（见候选 5），算法本身不搬。
4. **seam 绑定层**（`src/seam/index.ts:23-30` 的 `bindings` 六项）：绑定是模块接线声明（哪块代码叫什么名字），改它等于改架构，不是改参数；而且只有 6 行，搬出去多一层间接。
5. **命令执行的结果分类与重试决策**（各房 `client.ts` 里按退出码 / 超时 / 401 分档的代码）：这是错误处理流程判断，调用方要按档位做不同重试（写操作不自动重试），数据（档位名）已经在 `error-rules.ts` 里，流程本身必须留代码。
6. **单处消费的短字面量**（例如 `HASH_RE = /^[0-9a-f]{24}$`，`choiceStore.ts:157`；`MARKER_LINE_RE`，`marker.ts:29`）：只有一处消费、字面量很短，搬进 YAML 反而让人要跨文件找定义。名单（`OBJECT_KINDS`）可以搬（见候选 2），拼写规则不搬。

## 5. 没查清的（需要别人确认）

1. deck 九工具的参数描述是否有第二份（帮助文本是否另存一份与 `definition.description` 重复）。还缺的证据：帮助文本的渲染来源文件是哪一份。
2. 日志事件台账 YAML 化是否在日志总纲（#502）的接受范围内。附录台账是总纲的附属物，动它之前要日志负责人点头。
3. `src/host` 旧路（`issueList.ts`、`issueDetail.ts`、`commentThreads.ts`）里的 `per_page=50/100` 是否还走得到，还是已经退役的老代码。还缺的证据：这三份宿主旧路是否仍被路由引用。
4. GitLab 标签上限口径（`100 × 100 = 10000`）与 GitHub（`1000`）不一致是有意为之还是历史巧合。需要房间负责人确认统一值。
5. `config/` 下是否已有房间相关的 YAML（例如第一片或其他片是否已经覆盖了房间名单），避免两片报告推荐同一个文件位置。需要与第一片作者对一下文件名。

## 6. 取值来源一览（本报告引用的全部一手来源）

- `src/tracker/contract/canonical-labels.ts:7-18`、`src/tracker/label-names.ts:1-43`
- `src/shared/issue-file/src/marker.ts:17-33`
- `src/tracker/rooms/github/page.ts:48-49`、`sub-issues.ts:46-47`、`pulls.ts:32-33`、`issues.ts:105-106`、`label-colors-ops.ts:52`、`idempotency.ts:65/125`、`queries.ts:57`
- `src/tracker/rooms/gitlab/pages.ts:61-67`、`labels-ops.ts:90-104`、`sub-issues.ts:53-55`、`idempotency.ts:38`
- `src/tracker/rooms/markdown/page.ts:36-37`、`path.ts:31-85`
- `src/shared/version-control/src/commands.ts:21-173`、`src/host/versionControl.ts:35`
- `src/shared/naming-titles.ts:43-62/185/254-256`、`src/shared/naming-attribution.ts:23-34/85-108`
- `src/host/choiceStore.ts:144-154`、`src/host/workspaceKey.ts:68`
- `src/deck/rules/tool-order.ts:12-14`、`src/deck/tools/tool-order.ts:6`、`src/deck/tools/issue-create.ts:26/77-80`
- `src/tracker/kernel/outbound-tiers.ts:17-87`、`src/tracker/contract/vocabulary.ts:20-114`、`src/tracker/contract/operations-catalog.ts:62-114`
- `src/tracker/rooms/github/client.ts:214/259/266`、`src/tracker/rooms/github/queries.ts:17-272`、`src/tracker/rooms/gitlab/queries.ts:8-39`
- `src/seam/index.ts:23-30`
- `research/489-appendix.md` 第 1 章（事件台账）与第 30/46 段（工具落点、版本控制电话）
- `scripts/generate-time-config.mts`、`scripts/generate-prompt-config.mts`、`scripts/generate-locale-config.mts`
