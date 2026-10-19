# 研究：一张票是什么类型，九种票类怎么认（#1275）

> 本文件只写从一手来源读到的事实：平台官方文档、平台官方仓库里的实现源码、官方 changelog，以及用公开只读 API 跑出来的实测数字。社区文章只在必要处作补充并标明是补充。拿不到一手证据的地方直接写「未取证」，不靠印象补。调查期间没有修改仓库里任何业务代码。

## 结论先行

**跨后端唯一能通用的「类型」表达是标签。六个平台里有四个（GitHub、GitLab、Jira、Plane）有原生的类型字段，但它们的取值范围、作用域和能定制到哪一步都不同，搬不到一起；Linear 与 Gitea/Forgejo 干脆没有类型字段。隐藏 HTML 注释这条「机器读、人看不见」的通道在 GitHub 上确实成立（渲染层剥掉、API 原样带回），搬到 Jira 上就不成立（描述字段只吃 wiki markup 或纯文本，注释会被人看见）。**

三条直接证据：

1. 类型机制的分布（第二节逐个平台取证）：GitHub 的 issue type 是组织级、最多 25 个、默认 task/bug/feature，官方文档原文「You can create up to 25 issue types that your organization members can apply to issues… The default types are task, bug, and feature.」；GitLab 的工作项类型是组级、最多 40 个、Premium 档，官方文档原文「You can have a maximum of 40 work item types in a top-level group or organization, including types provided by GitLab.」；Jira 有自建类型加层级（接口体 `IssueTypeHierarchyPayload`）；Plane 的类型模型源码里有 `is_epic`、`is_default`、`level` 三个字段；Linear 的公开 GraphQL schema 里没有 `IssueType` 这个类型、`Issue` 也没有 `type` 字段；Gitea 与 Forgejo 的 `models/issues/` 目录里没有任何类型模型文件。
2. 隐藏注释通道在 GitHub 上成立，但会漏进搜索：实测一句只存在于 HTML 注释里的文字能被站内搜索按词命中（同一句在 `github/docs` 仓库命中 3047 条），而按标记符号搜（`in:body "<!--"`）的结果是 0 条——索引认词不认符号。
3. 同一段标记搬到 Jira 就露馅：Atlassian 官方知识库写明描述字段只接受 wiki markup 或纯文本，HTML 代码放进去「appears to be not rendered properly」（不按 HTML 渲染）。

## 一、这次要回答的问题与判定口径

本仓（`dsh-mattpocock-skills-deck`）要把「面前这张票是什么对象」扩成九种：map（地图）/ spec（规格）/ ticket（实施票）/ research（调研票）/ prototype（原型票）/ grilling（讨论票）/ task（任务票）/ bug（缺陷票）/ issue（普通票）。

已经定死、本次不再讨论的部分：不新增 GitHub 标签（`wayfinder:map`、`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task` 沿用）。识别顺序在调研开始时的样子是「正文首行的隐藏标记（形如 `<!-- DSH-ISSUE-KIND: spec -->` 的 HTML 注释）→ 中英文正文形状（地图五节、规格七节、实施票四节、讨论票只有 `## Question`）→ 判不出来就不猜」——**这是讨论前的初始假设，已被 #1275 的结论取代**：现行顺序是「隐藏标记 → 表达对象类型的标签 → 正文形状兜底」，判定结果永远是九值之一。取代后的口径见 `docs/adr/20261020-object-kind-identification.md` 第 2.2 节。本文件其余部分写的是事实与建议，不因这条取代而失效。

本次要查的是三件事：

1. 六个平台各自用什么机制表达「这张票是什么类型」和「这张票属于哪个容器或父对象」，原生字段能取哪些值、能不能自定义，父子关系是不是原生能力，跨后端移植时缺什么。
2. 把隐藏 HTML 注释放进票正文，当成机器读、人看不见的元数据通道，有没有工具或实践在用，有哪些坑：渲染时会不会露出来、API 往返会不会被清洗、人手改正文会不会顺手删掉、全文搜索与通知邮件与 webhook 负载会不会把它带出去。
3. 靠二级标题清单判断一张票是规格还是实施票，有没有已知反例与前人踩过的坑。

## 二、证据链

### 2.1 GitHub：原生 type 有了，子票与父票也是原生的

- 官方文档 [Managing issue types in your organization](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization)：类型是组织级的，「You can create up to 25 issue types that your organization members can apply to issues, making it easier for you and your members to find issues and plan work. Default issue types are included in every organization, but these can edited, disabled, or deleted. The default types are task, bug, and feature.」；文档同段还写明可以按类型过滤与搜索、在项目里用类型建过滤器与视图。
- 官方 REST 规范（[api.github.com.json](https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json)，[REST Issues 文档](https://docs.github.com/en/rest/issues/issues)）实测到的接口与字段：`/orgs/{org}/issue-types`（GET、POST）、`/orgs/{org}/issue-types/{issue_type_id}`（PUT、DELETE）、`/repos/{owner}/{repo}/issue-types`（GET）；类型对象的字段是 `id`、`node_id`、`name`、`description`、`color`（可选 gray/blue/green/yellow/orange/red/pink/purple）、`created_at`、`updated_at`、`is_enabled`；创建时必填 `name` 与 `is_enabled`；票对象读回时带 `type` 字段，PATCH 票时也能写 `type`。
- 官方 changelog [GitHub Issues and Projects REST API support for issue types](https://github.blog/changelog/2025-03-18-github-issues-projects-rest-api-support-for-issue-types/)：2025-03-18 起 issue types 可以用 REST API 管理。
- 官方文档 [Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)：「You can add up to 100 sub-issues per parent issue and create up to eight levels of nested sub-issues.」；`gh` CLI 有 `--parent`、`--add-sub-issue`、`--remove-sub-issue`、`--remove-parent`。REST 侧实测到的接口：`/repos/{owner}/{repo}/issues/{issue_number}/sub_issues`（GET、POST）、`/sub_issue`（DELETE）、`/parent`（GET），以及依赖边 `/dependencies/blocked_by`、`/dependencies/blocking`。票对象上还有 `parent_issue_url`、`sub_issues_summary`、`issue_dependencies_summary` 三个汇总字段。
- **父票与容器在 GitHub 上是原生能力**（子票最多 100 个、嵌套 8 层），这一层不用自己造。

### 2.2 GitLab：类型从「工单类型」演进成「工作项类型」，子项是原生的

- 官方文档 [Configurable work item types](https://docs.gitlab.com/user/work_items/configurable_work_item_types/index.md)：Premium 与 Ultimate 档；「Introduced in GitLab 19.0 with a feature flag」，19.1 转正；「You can have a maximum of 40 work item types in a top-level group or organization, including types provided by GitLab. Type names must be unique in a namespace or organization and no more than 48 characters.」；类型可以改名（文档举例把 `Feature` 改名成 `Enhancement`），也可以被禁用或归档；类型还能挂自定义字段与状态流转。
- 官方文档 [Child items](https://docs.gitlab.com/user/work_items/child_items/index.md)：Free、Premium、Ultimate 三档都有；子项是嵌套在父工作项下面的工作项（子 epic、作为工单子项的 task）。
- 官方开发文档 [doc/development/issue_types.md](https://gitlab.com/gitlab-org/gitlab/-/raw/master/doc/development/issue_types.md)：GitLab 自己讨论「什么时候该用 issue type、什么时候该把对象做成独立的一等资源」，能看出类型体系是不断改的。
- **这一节有一条对本仓特别重要的证据**：GitLab 官方工单 [Render invisible text (HTML comments, template tags, hidden Unicode) visibly in Markdown output](https://gitlab.com/gitlab-org/gitlab/-/work_items/599535)（state=opened，2026-07-05 创建，6 条讨论）里写明 HTML 注释「completely stripped from rendered output」，同时列出 `<template>` 标签、Markdown 引用式链接定义、以及不可见 Unicode（U+2061-2064、BiDi 控制符、零宽字符、Unicode Tag 区 U+E0000-E007F）全都是「源码里有、渲染里看不见」。工单给出的理由原句是「a malicious actor can embed hidden instructions that are invisible to the human reviewer but fully visible to any agent reading the raw Markdown. This is a straightforward path for prompt injection」，提议默认把不可见文本显式渲染出来，以「ensure parity between what humans see and what agents see」。
- 顺带一提，这条工单自己的标签里有 `type::feature`——**连有原生类型的平台，团队日常也还在用标签表达类别**。

### 2.3 Linear：没有原生类型字段，父子票是原生的

- 官方公开的 GraphQL schema（[linear/packages/sdk/src/schema.graphql](https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql)）实测：全文没有 `IssueType` 这个类型或枚举；`type Issue implements Node` 的字段表里没有 `type`、`typeId`、`issueType`，只有 `children`、`parent`、`project`、`team`、`labels` 等。
- 官方文档 [Issue properties](https://linear.app/docs/issue-properties)（页面导航就是全部属性）：status、priority、labels、relations、due dates、estimate、SLA——没有 type。
- 官方文档 [Creating issues](https://linear.app/docs/creating-issues.md)：建票预置参数是 Title/description、Status、Team、Priority、Assignee、Estimate、Cycle、Label；描述是 markdown 文档。
- 官方文档 [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues.md)：父子票原生（Add sub-issues、Set Parent、Remove parent、Convert to project、父票自动关闭）；子票继承 team、priority、project，**不继承 labels**。
- 官方文档 [Issue templates](https://linear.app/docs/issue-templates.md)：「Use workspace templates for issue types that are likely to appear across different teams.」——Linear 语境里的 issue type 指的是模板类别，不是原生字段。

### 2.4 Jira：类型可以自建、可以分层，票级键值元数据是原生能力

- 官方 REST v3 规范（[swagger-v3.v3.json](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json)）实测到的接口：`/rest/api/3/issuetype`、`/issuetype/{id}`、`/issuetype/{id}/alternatives`、`/issuetype/project`、`/issuetypescheme`、`/issuetypescheme/{id}`、`/issuetypescheme/{id}/issuetype`、`/issuetypescheme/mapping`、`/issuetypescheme/project`、以及 `/issuetypescreenscheme/*`。类型对象 `IssueTypeDetails` 的字段是 `avatarId`、`description`、`entityId`、`hierarchyLevel`（整数）、`iconUrl`、`id`、`name`、`scope`、`self`、`subtask`（布尔）。自建类型的接口体 `IssueTypeHierarchyPayload` 支持给新类型设 `hierarchyLevel`（文档写「0, 1, 2, 3 .. n; Negative values for subtasks」），冲突策略可选 FAIL / USE / NEW。
- **Jira 有一个真正的「票级键值元数据」原生通道**：`/rest/api/3/issue/{issueIdOrKey}/properties` 与 `/properties/{propertyKey}`（见 [Issue properties 文档](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-properties/)）。想要机器读、人看不见的元数据，Jira 上的正解是它，不是正文里的注释。
- 父子：建票与改票的请求体里有 `parent`（示例值 `PROJ-123`）；另外还有 issue link 类型的父子语义。
- **Jira 的文本字段默认不解析 HTML**，这是隐藏注释在 Jira 上不成立的原因，两条官方依据：
  - Atlassian 官方知识库 [Enable HTML tag usage in Jira Data Center text fields](https://support.atlassian.com/jira/kb/enable-html-tag-usage-in-jira-data-center-text-fields/)：原句「HTML is disabled by default because it is a potential security risk, as it can contain arbitrary HTML which could potentially make your JIRA system vulnerable to Cross-site scripting (XSS) attacks.」；要用 HTML 得开 Wiki Renderer Macros Plugin 的 html 模块并用 `{html}` 包起来。
  - Atlassian 官方知识库 [HTML Code Appears in Description Fields](https://support.atlassian.com/jira/kb/html-code-appears-in-description-fields/)（2025-04-08）：「Symptoms: If you add any HTML code in the description fields, the code appears to be not rendered properly. … Workaround: The description field accepts only either wiki markup or text format. Convert the HTML markup to one of them.」

### 2.5 Plane：类型是工作区里的实体，项目侧能各设默认

- 官方 API 文档 [Work Item Types overview](https://developers.plane.so/api-reference/v2/work-item-types/overview)：API v2 里有两套——项目级与工作区级——都提供 List / Create / Update / Delete，还有 schema、Enable / Mark default、Properties、Property Options、Type Properties（类型上挂属性）、Work Item Type Modes。
- 官方仓库源码 [apps/api/plane/db/models/issue_type.py](https://raw.githubusercontent.com/makeplane/plane/preview/apps/api/plane/db/models/issue_type.py)：`IssueType` 模型的字段是 `workspace`、`name`、`description`、`logo_props`、`is_epic`、`is_default`、`is_active`、`level`、`external_source`、`external_id`；`ProjectIssueType` 把类型绑到项目上，带 `level` 与 `is_default`。也就是说 Plane 的类型自带层级（level）、epic 标记与「默认类型」概念。
- 容器概念（来自同一套 API 文档的目录）：States、Labels、Cycles、Modules、Milestones、Estimates、Work Items、Comments、Attachments、Links、Pages、Activities、Worklogs、Votes、Intake、Properties。

### 2.6 Forgejo 与 Gitea：没有类型模型，子票还是开放需求

- Gitea 官方仓库目录 [models/issues](https://api.github.com/repos/go-gitea/gitea/contents/models/issues)：里面没有任何 issue type 模型文件；`models/issues/issue.go` 全文检索不到 IssueType 或 Type 字段。与之并存的是 `dependency.go`（阻塞与被阻塞依赖）、`issue_project.go`（项目看板）、`milestone.go`（里程碑）。
- Forgejo 官方仓库目录 [models/issues](https://codeberg.org/api/v1/repos/forgejo/forgejo/contents/models/issues)：与 Gitea 同构，同样没有类型模型。
- Gitea 官方工单 [Add sub-issue support #36696](https://github.com/go-gitea/gitea/issues/36696)：state=open，2026-02-21 创建，2026-08-02 最后更新；正文说 GitHub 已经有 sub issues，希望 Gitea 也照 GitHub 的做法实现。**也就是说在 Gitea/Forgejo 上，「父票」这件事今天还是空的。**

### 2.7 隐藏 HTML 注释当元数据通道：GitHub 上成立，Jira 上不成立，GitLab 正在拆

GitHub 侧实测（探针用公开只读 API，无需登录；样本是 `github/docs` 仓库的公开 PR）：

- 读回时 `body` 保留原文里的 `<!--`，渲染出来的 HTML 里没有：默认 Accept 头下某条 PR 的 `body` 原文长 1909 字符且含 `<!--`；改用 `Accept: application/vnd.github.html+json` 后 `body_html` 长 1524 字符且不含 `<!--`。官方 REST 文档也写明这一层关系：`application/vnd.github.html+json` 返回「raw, text, and HTML representations. Response will include body, body_text, and body_html.」——**渲染层剥注释、API 层原样保留，这是平台行为，不是巧合。**
- 注释里的文字会被全文搜索按词命中：搜索 `repo:github/docs in:body "We cannot accept changes to our translated content right now"`（这句只存在于 HTML 注释里）命中 3047 条；`repo:github/docs in:body "Description of the writer impact here"` 命中 2683 条；抽查命中样本 `github/docs#15253`，确认该短语确实位于 `<!-- … -->` 之内、且不出现在 `body_html` 里。而 `in:body "<!--"`（全站 type:issue）命中 0 条——**索引按词匹配，不按 `<!--` 这个符号匹配。**
- GitHub 官方自己就在用「注释当隐藏提示」：官方 issue form 语法文档 [syntax-for-issue-forms.md](https://raw.githubusercontent.com/github/docs/main/content/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms.md) 给的 Markdown 模板示例长这样：`### Current Behavior:` 后面跟 `<!-- A concise description of what you're experiencing. -->`，`，段落结构是「三级标题 + 隐藏注释占位」。
- 人手改正文会改形状：同一份官方文档写明「When a contributor fills out an issue form, their responses for each input are converted to markdown and added to the body of an issue. Contributors can edit their issues that were created with issue forms and other people can interact with the issues like an issue created through other methods.」——表单生成的正文是标准形状，但**贡献者之后还能随便改**。
- webhook 负载带的是原文：官方 Octokit 包 [@octokit/webhooks-schemas](https://github.com/octokit/webhooks) 的 `schema.json` 里，`definitions.issue.properties.body` 的说明是「Contents of the issue」（同一份 `issue` 定义被 issue 事件负载引用），也就是说**隐藏标记会随 webhook 负载原样流到第三方**。
- 通知邮件里的正文是渲染后的那一版（HTML 表示里注释已被剥掉）——**邮件里不会露出来，但 webhook 会**。（邮件渲染细节未单独取证，这是从「平台提供 raw/text/html 三种表示」推出来的，标为推断。）

GitLab 侧：官方工单 599535 明说 HTML 注释在渲染输出里被完全剥掉，并主张把不可见文本显式渲染出来，理由是防止「人看不见、agent 看得见」的提示注入。**换句话说，GitLab 方向上正在把这条通道判为不可依赖。**

Jira 侧：2.4 的两条官方知识库说明，描述字段里放 HTML 不会按 HTML 处理。

Linear 侧：**未取证**。官方文档只说描述是 markdown 文档（[Creating issues](https://linear.app/docs/creating-issues.md)），没有关于富文本编辑器如何处理 HTML 的说明，因此 Linear 上「注释会不会被人看见、会不会被编辑器清掉」目前没有一手结论。

### 2.8 靠正文形状判类型的已知反例

- **标题层级不统一**：GitHub 官方模板示例用三级标题（`### Current Behavior:`），不是二级标题。判据只认 `##` 会漏。
- **表单生成的正文之后还能被改**：官方文档原句如上（见 2.7）。形状会随人手编辑漂移。
- **模板本身会演化**：同一份官方文档有「Converting a Markdown issue template to a YAML issue form template」一节，说明 Markdown 模板与 YAML 表单可以并存、互转时还会撞名（文件名相同要删旧的）。模板换写法，章节清单就换写法。
- **平台的类型体系本身在改**：GitLab 从 issue type 演进成 work item type（19.0 引入、19.1 转正，类型还分 Enabled / Disabled / Archived / Locked 状态）；Jira 的类型有 `hierarchyLevel` 与 `subtask` 布尔。**指望「某个平台某年某版的章节清单」是脆的。**
- **章节顺序没有官方保证**：GitHub 官方示例里 `### Steps To Reproduce:` 排在 `### Environment:` 前面，但这只是示例的写法，平台不承诺顺序。判据应做成「子集匹配、顺序无关、允许附加章节」。
- **中英文混写**：官方模板全是英文（GitHub 示例、GitLab、Jira、Plane 文档都是英文），中文票多是手写或自建模板。本仓自己已经在做双语（`MAP_BLOCK_TITLES` 是英文，`hasProgressHeading` 兼容「进度」与「Progress」），继续双语是必要的，不是额外负担。
- **「只有某节」型判据最脆**：讨论票「只有 `## Question`」这条判据，一旦有人在票里补一节「## 回答」或「## 结论」就破了。改成「必须含 `## Question`，且不含其它特征章节」更稳。

## 三、跨后端对照

| 平台 | 「类型」怎么表达 | 值的来源与可定制 | 父票 / 容器 | 正文首行 HTML 注释会不会露出来 |
| --- | --- | --- | --- | --- |
| GitHub | 原生 issue type 字段 + 标签 | 组织级，最多 25 个，默认 task/bug/feature，可改名、禁用、删除 | 子票原生（≤100 个/父、嵌套 ≤8 层），另有 Projects、Milestone | 不会（实测：渲染剥掉、API 原样带回） |
| GitLab | 工作项类型（Premium/Ultimate）+ 标签 | 组级，最多 40 个、名字 ≤48 字符，可改名/禁用/归档 | child items 原生；Epic、Milestone、Iteration 作容器 | 不会渲染（官方工单 599535），但平台正在改为主动渲染出来 |
| Linear | **只有标签** | 公开 GraphQL schema 无 IssueType，Issue 无 type 字段 | 父子原生（parent / children），Project、Cycle、Initiative 作容器 | 未取证 |
| Jira | issuetype + 每项目的 issue type scheme | 可自建类型并设 `hierarchyLevel`、`subtask` | parent 字段、issue link；Project、Epic、Sprint 作容器 | **会**（描述字段只吃 wiki markup 或纯文本） |
| Plane | 工作项类型（工作区级 + 项目级） | 类型带 `is_epic`、`is_default`、`level`；项目侧可各设默认 | work item 父子；Project、Module、Cycle、Milestone、State 作容器 | 未取证 |
| Forgejo / Gitea | **只有标签** | `models/issues/` 无类型模型 | 无父子（工单 #36696 仍开着）；有依赖、项目、里程碑 | 未取证（未找到该平台对该做法的说明） |

跨后端移植时真正缺的东西：

1. **类型字段本身不可移植**：GitHub 的组织级类型、GitLab 的组级类型、Jira 的项目级方案、Plane 的工作区级类型，作用域与生命周期都不一样；Linear 与 Gitea/Forgejo 干脆没有。九种票类在任何一个平台上都没有现成对应物。
2. **父票语义也不统一**：GitHub 的 sub-issue、GitLab 的 child item、Linear 的 parent、Jira 的 parent + issue link、Plane 的 work item 父子，各是一套；Gitea/Forgejo 是空的。
3. **标签是唯一贯穿全部六个平台的槽位**，而本仓已经定死不新增标签——所以跨后端落点只能是「正文里的标记 + 既有标签」。

## 四、值得抄 / 明确别抄

**值得抄**

1. **首行隐藏 HTML 注释当类型标记**——在 GitHub 房间与本地 Markdown 房间成立。依据：2.7 的实测（渲染剥掉、API 原样带回）与 GitHub 官方模板自己的「注释占位」写法（[syntax-for-issue-forms.md](https://raw.githubusercontent.com/github/docs/main/content/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms.md)）。这也是本仓幂等锚 `<!-- DSH-IDEMPOTENCY-KEY: … -->` 已经在用的做法，属同一条路上已被本仓验证过的先例。
2. **类型与父票优先读平台原生字段**。依据：GitHub 票对象有 `type`、`parent_issue_url`、`sub_issues_summary`（[REST 规范](https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json)）；GitLab work item 事件的 `object_attributes.type`（[webhook 文档](https://docs.gitlab.com/user/project/integrations/webhook_events/)）；Jira 的 `issuetype` 与 `parent`（[REST 规范](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json)）；Plane 的工作项类型与父子。这些比正文形状可靠得多。
3. **判不出就不猜**。依据：本仓既有纪律（`src/deck/rules/minimal-spec.ts:119-126` 的 `isWholeIssueBody` 是四条里任一条命中即算整份；`src/shared/refresh/src/idempotency.ts:93-94` 明确不做模糊匹配，理由是正文是人会手改的东西）。外部世界的对照也支持这条：六个平台没有一个承诺正文形状稳定（2.8）。
4. **改票整段替换正文时，锚从盘上那份取**。本仓既有纪律（`src/tracker/rooms/markdown/patch-body.ts:66-70` 是搬回动作本体，`:49-50` 是「锚变多了／锚丢了」的检查），与 2.7 实测的「API 原样带回」互相印证。

**明确别抄**

1. **别把 GitHub 原生 issue type 字段当类型的唯一真相**。它是组织级设置、最多 25 个、值域由组织决定，与本仓九种票类不同构；本仓已定死不新增标签、也不该把识别能力绑在组织设置上。依据：[GitHub 官方文档](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization)、[changelog 2025-03-18](https://github.blog/changelog/2025-03-18-github-issues-projects-rest-api-support-for-issue-types/)。
2. **别以为同一段隐藏标记在所有后端都隐身**。Jira 描述字段不解析 HTML（[官方知识库](https://support.atlassian.com/jira/kb/html-code-appears-in-description-fields/)）；GitLab 正在把不可见文本显式渲染出来（[工单 599535](https://gitlab.com/gitlab-org/gitlab/-/work_items/599535)）。依据这两条，隐藏标记只能是「GitHub 与本地 Markdown 房间」的机制，别的后端要各用各的原生通道（Jira 用 issue properties，Linear 与 Gitea/Forgejo 用标签）。
3. **别把正文形状当唯一判据，也别把章节清单写死**。依据 2.8 的六条反例（标题层级、用户可编辑、模板演化、平台体系改版、顺序无保证、中英混写、「只有某节」判据最脆）。
4. **别把隐藏标记当私密通道**。注释里的文字会被站内搜索按词命中（实测 3047 条、2683 条两例），注释内容会随 GitHub webhook 负载原文流出（[@octokit/webhooks-schemas](https://github.com/octokit/webhooks) 里 `issue.body` 即原文），GitLab 的 webhook 负载也带 `object_attributes.description` 原文。**结论：标记里只放类型名这类短词，不放秘密、不放长文。**
5. **别为「让类型可见」而去改 GitHub 标签集**（本仓已定死），也**别在 Jira 上照抄同一套正文标记**（Jira 的正解是 `/rest/api/3/issue/{issueIdOrKey}/properties`）。

## 五、未取证与残余风险

- **Linear 描述里放 HTML 注释会怎样**：未找到一手证据。官方文档只说描述是 markdown 文档，没有富文本编辑器对 HTML 的处理说明。
- **GitLab API 里 `issue_types` 与 `work_item_types` 的参数改名面**：未取证。`docs.gitlab.com/api/work_items.md` 抓取返回 403。
- **Plane 默认工作项类型清单**：未取到官方清单（用户文档页是 JS 应用，正文在静态资源里，未解析成功）；但官方 API 文档与官方源码的 `IssueType` 模型已足以说明机制（可建类型、可设默认、带层级与 epic 标记）。
- **GitHub 通知邮件里的正文是否剥掉注释**：未直接取证，本文件按「平台提供 raw / text / html 三种表示、html 表示里没有注释」推断邮件用渲染版。
- **Forgejo / Gitea 上正文注释是否隐身**：未找到该平台的说明。
- **Conventional Commits 规范**：抓取失败，未取证。（它与「类型该放哪里」有关，但本仓的九种票类不是提交类型，本票不需要它。）
- **残余风险一**：隐藏标记依赖「渲染层会剥掉注释」这一平台行为。GitLab 正在改这个行为（工单 599535），说明这个行为并非永久契约。
- **残余风险二**：人手动改票（尤其是「整理正文」型改票）会顺手删掉首行标记。本仓幂等锚已有应对纪律（整段替换正文时以盘上那份为准保住），新加的类型标记应当沿用同一纪律，否则类型会静默退化成「判不出」。
- **残余风险三**：形状判据与「判不出不猜」是连着的。若形状清单写得比实际松，误判会把普通票说成规格票；若写得比实际紧，则大量票会落到 issue。两种错法的代价不对称——误判成规格票会让下游按规格去评审一张普通票，比落到 issue 更糟。

## 六、与本仓现状和既有笔记的关系

本仓当前的对象类型只有一个三值枚举 `DeckKind = 'map' | 'task' | 'bug'`（`src/deck/rules/minimal-spec.ts:17`），配套的必备标签是 `MINIMAL_LABELS`（`:25-29`：map→`wayfinder:map`、task→`wayfinder:task`、bug→`bug`+`needs-triage`），地图的章节清单是 `MAP_BLOCK_TITLES`（`:32-34`：Destination、Notes、Decisions so far、Not yet specified、Out of scope），进度标题的正则兼容「进度」与「Progress」（`:81-83`）。幂等锚的隐藏注释做法与锚纪律在 `src/shared/refresh/src/idempotency.ts:14-18`、`:38` 与 `src/tracker/rooms/markdown/patch-body.ts:49-50`、`:68-83`。

本文件是外部资料调研，不改这些代码，也不与既有笔记冲突：既有笔记（如 `research/1273-patch-receipt-duplicate-ticket.md`）讲的是回执里同一张票被送两份，与「怎么认出票的种类」是两件事。仓里既有的 `docs/agents/triage-labels.md` 与 `docs/agents/issue-tracker.md` 描述的仍是现有标签与 GitHub 工单流程，本文件不改动它们。

## 七、分流结论

> 本节是调研当时给出的分流建议。#1275 讨论收口后的最终口径以票面「已定」十五条与 `docs/adr/20261020-object-kind-identification.md` 为准；下面三条里第 2、3 条本票**未采纳**，理由写在各条括注里。

本票是**调研票**，不是缺陷修复：外部一手证据已足够支撑识别机制的选择，剩下的是本仓内的实现决策（枚举形状、落点文件、形状清单内容、误判代价取舍），应在实现票里做。调研结论可直接支撑三条决定：

1. 类型识别的主通道定在「正文首行隐藏标记」。（「作用范围限定 GitHub 与本地 Markdown 房间」这一条本票未采纳：GitLab 房也要写，剥不掉就退回标签与形状两步。）
2. 原生平台字段（GitHub `type`、GitLab 工作项类型、Jira `issuetype`、Plane 工作项类型）作为可选增强，不作为跨后端真相。**本票未采纳**：已定「不接 GitHub 原生 issue type 字段」，本地 Markdown 房那行 `Type:` 也降级为派生显示。
3. 正文形状只作兜底，且判据必须写成「子集匹配 + 顺序无关 + 允许附加章节 + 双语清单」——前半条本票采纳；「判不出就落到 issue」这一句本票改成了「判定结果永远是九值之一，没有『没认出来』这一档」，没有专属形状完整命中的票按普通票算。

## 八、给实现票的建议形状（建议，非本票决定）

建议的识别顺序（每一步都带明确的失败去向）：

1. **首行隐藏标记**：正文第一行形如 `<!-- DSH-ISSUE-KIND: spec -->`，取 `spec|ticket|research|prototype|grilling|task|bug|map|issue` 之一，命中即定。不接受其它写法，不做模糊匹配（与幂等锚的纪律一致：`src/shared/refresh/src/idempotency.ts:93-94`）。
2. **原生平台字段映射（可选增强）**：把平台的类型字段映射到九种之一，映射不上就跳过本步而不是硬套。**本票不采纳这一步**：已定不接 GitHub 原生 issue type 字段。
3. **既有标签**：`wayfinder:map`、`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task` 已经在仓库里成立，可作第二证据源。
4. **正文形状兜底**：子集匹配、顺序无关、允许附加章节、中英文各一份清单；地图五节、规格七节、实施票四节来自本仓既有约定（`minimal-spec.ts:32-34` 与规格规则），讨论票改成「含 `## Question` 且不含其它特征章节」。
5. **判不出 → issue**，并且不猜。

建议同时定下的三件事：

- **标记的写入与保留纪律**：与幂等锚同一套（整段替换正文时以盘上那份为准保住首行标记），否则类型会静默退化。
- **标记的可见性边界**：标记里只放类型名，不放其它内容；并在仓库文档里写明「正文里的隐藏注释会进搜索与 webhook 负载」。
- **跨后端差异写进文档**：Jira 上标记不隐身、GitLab 方向在变、Linear 与 Forgejo/Gitea 无原生类型——这三条要在使用说明里写明，避免以后有人把同一套标记当成通用做法。
