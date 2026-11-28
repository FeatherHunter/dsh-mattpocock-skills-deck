# Gitea（tea CLI）后端房间行为文档

这一份写给想弄清楚「Gitea / Forgejo 后端在插件里到底怎么干活」的人：两个平台上的 issue 工作流有哪些约定、命令行怎么用、有哪些平台事实需要先知道。能力逐条登记（哪条真提供、哪条由注册表补桩）在 `docs/tracker/capability-gitea.md`，这里不重复那份账。

## 适用范围

Gitea 与 Forgejo 共用同一个房间：官方命令行工具 `tea` 本来就是两个平台共用的客户端，所以在锚文件里写 `# Issue tracker: Gitea (tea CLI)` 或 `# Issue tracker: Forgejo`，走的是同一套工作流，没有第二套实现。

## 命令面（与房间的命令词汇表一致）

这一房的操作全部经 `tea` 命令行完成，命令映射如下，与 `src/tracker/rooms/gitea/room/prompts.ts` 里注入提示词的命令词汇表逐条一致：

| 要做什么 | 用哪条命令 |
|---|---|
| 建票 | `tea issues create` |
| 列票 | `tea issues ls`（即 `tea issues list`） |
| 看单张票 | `tea issues <编号>` |
| 看一张票的评论 | `tea issues <编号> comments` |
| 关票 | `tea issues close <编号>` |
| 给票加标签或认领人 | `tea issues edit <编号> --add-labels` / `tea issues edit <编号> --add-assignees` |
| 标签管理 | `tea labels create` / `tea labels ls`（即 `tea labels list`） |

`tea` 没有拆分父子、设置阻塞这类命令，房间也不编造写法。命令失败时按三档归类（未登录 / 仓库不可达 / 网络失败），每档给可操作的修复指引，分类规则在 `src/tracker/rooms/gitea/errors.ts`。

## wayfinder 文本约定：父子与阻塞走正文文本，不做结构化依赖

Gitea 与 Forgejo 平台没有原生的 sub-issue（层级子票）接口，也没有原生的依赖边（阻塞）接口。所以这一房不实现任何结构化依赖，父子关系与阻塞关系一律按 wayfinder 的文本约定落在票正文里：

- **阻塞关系**：写在票正文的「## Blocked by」小节里，一行一条，写明阻塞本票的票号。人能直接读懂，程序也按这个约定读。
- **父子关系**：用正文里的父子引用表达——子票正文写明自己属于哪张地图（父票），父票据此聚合子票。

读这一侧与 GitLab 后端同款，走两条路：正文文件头里隐藏的机器标记（`<!-- DSH-PARENT: ... -->` 与 `<!-- DSH-BLOCKED-BY: ... -->`，HTML 注释，渲染后看不见）优先；文件头里没有标记时，退回认上面的可见文本行（父子引用与「## Blocked by」列表）。写这一侧由房间成对维护：新写的票把隐藏标记写进文件头（归属标记是子票归属的唯一真相，旧可见行只在过渡期回退认、不再写；阻塞是可见行给人读、隐藏表给程序读，一次写齐）。Gitea 与 Forgejo 仍然没有原生的结构化依赖接口，房间不做、也不承诺原生边；人写票时按上面的可见文本约定落笔即可，隐藏标记交给房间自己维护。

## issue 与 PR 共用序号空间

Gitea 与 Forgejo 上，issue 与 pull request 共用同一套编号：一个仓库里的编号是连续的一列，票号与 PR 号不会重复。好处是引用不会歧义——写 `#12` 就是指仓库里编号为 12 的那一条，无论它是票还是 PR；也不用区分「票地址」与「PR 地址」两套编号规则。

## 接入方式

在仓库的锚文件（issue tracker 声明文件）标题写 `# Issue tracker: Gitea (tea CLI)`（Forgejo 用户写 `# Issue tracker: Forgejo`）即可命中这一房；锚文件正文提到 gitea、forgejo 或 tea 时也有关键词兜底识别。前置条件是本机装好 `tea` 并已登录（`tea login add`），房间的 preflight 会在识别后校验这三步（找得到 tea、有登录项、能列票），哪一步失败都会给指向下一步的提示。

## 相关文件

- 房间实现真源：`src/tracker/rooms/gitea/`（入口 `index.ts`，命令词汇表与修复指引在 `room/prompts.ts`）。
- 注册与判定：`src/tracker/registry/builtins.ts`（内置房间名单）与 `src/tracker/detection/backendDecision.ts`（多后端命中时的裁剪顺序）。
- 能力逐条登记：`docs/tracker/capability-gitea.md`。
