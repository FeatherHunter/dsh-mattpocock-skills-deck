# Markdown 后端能力登记表

`#1147` 决策 9 的交付物（2026-10-14）。登记口径同 GitHub 那份（三类定义见规格票），一条一条审过实现才落笔，不估。

实现真源：`src/tracker/rooms/markdown/index.ts`（工厂 18 个真实现 + 4 个显式“不支持”桩）。注意本后端的一个特殊形状：**两条定位口（`describe`、`issueAddress`）不在工厂实例上，住在模块对象上**（`markdownModule`），注册表走模块路径取用——能力是提供的，只是位置不在实例里，下表逐条写明位置。

## 操作（22 条中提供 18 条、不支持 4 条）

| 能力 | 登记 | 依据 |
|---|---|---|
| preflight | 明确提供功能 | 工厂内联实现（查 `.scratch/map.md` 或文档声明），识别链在用 |
| list | 明确提供功能 | `issues.ts`，读票文件列票 |
| get | 明确提供功能 | `issues.ts` |
| getDependencies | 明确提供功能 | `graph.ts`，读票文件里的阻塞行 |
| create | 明确提供功能 | `issues.ts`，写票文件 |
| close | 明确提供功能 | `issues.ts` |
| reopen | 明确提供功能 | `issues.ts` |
| comment | 明确提供功能 | `comments.ts` |
| update | 明确提供功能 | `issues.ts` |
| setLabels | 明确提供功能 | `issues.ts` |
| setAssignees | 明确提供功能 | `issues.ts` |
| setParent | 明确提供功能 | `issues.ts`，地图清单引用 |
| setBlockedBy | 明确提供功能 | `issues.ts`，正文首行降级写法 |
| listLabels | 明确提供功能 | `label-colors-ops.ts`，文件缺失时顺手补默认配色文件 |
| setLabelColors | 明确提供功能 | `label-colors-ops.ts` |
| counts | 明确提供功能 | `counts.ts`，数列举会返回的票行 |
| listPage | 明确提供功能 | `page.ts`，游标是排序后下标 |
| ensureLabelColorsFile | 明确提供功能 | `label-colors.ts`，建仓选后端那一步宿主会问它 |
| getCurrentUser | 明确不支持 | 工厂显式桩：本地票仓没有“当前登录人”这个概念 |
| initProject | 明确不支持 | 工厂显式桩：本地没有远端可初始化 |
| getRepoPermissions | 明确不支持 | 工厂显式桩：写入能力由目录权限与沙箱决定，没有“仓库权限”可问 |
| listSubIssues | 明确不支持 | 工厂显式桩：子票就在票文件里，宿主直接读文件，不经这里 |

## 定位口（提供 2 条、不支持 1 条）

| 能力 | 登记 | 依据 |
|---|---|---|
| describe | 明确提供功能 | **位置在模块对象**（`markdownModule.describe`，`index.ts` 的 `describe` 函数）：从工作区目录产出身份，注册表识别链在用 |
| issueAddress | 明确提供功能 | **位置在模块对象**：算不出票地址时诚实回空串（#1144；文件名里的标题后缀要读文件才知道），票的地址随票走（票的 `url` 字段） |
| getRepoKey | 明确不支持 | 实例与模块都没有：本地票仓没有远端 owner/name 可解析；调用方（工具壳）缺席即跳过，不拦路 |

## 交接

随地图 09 交付（Markdown 房开发票）。本表由 `#1147` 预交付，开发票不再重审，只需在实现偏离本表时回来改表。
