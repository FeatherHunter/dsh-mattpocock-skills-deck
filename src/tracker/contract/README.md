# 契约层（src/tracker/contract）

这一目录是 deck 工具与面板**共用的那一份书面承诺**。它回答两个问题：

1. **一个后端要能做哪些事，每件事收什么、回什么** —— 见 `operations.ts`。
2. **票、仓库、失败这些东西长什么样** —— 见 `ports.ts`。

外加一份注册表真正读的「模块对象」形状（`backend-module.ts`）：进程刚启动、还没有工作区、
还没有登录的时候，界面靠它画出「有哪些后端可选」。

## 为什么契约要单独成一层

九个 deck 工具调 `tracker.preflight`、`tracker.list` 的时候，从不问「你是 GitHub 还是
本地 Markdown」。它们敢这么写，唯一的原因是有一份承诺摆在这里：不管哪个房间接手，
都回答同样的方法、收同样的参数、回同样的形状。没有这份承诺，每加一个后端，
上层就要多一堆「如果这个后端就……」的分支。

这份承诺写成 TypeScript 的 `interface` 之后，「有没有对上」由编译器回答：
GitHub 房与本地 Markdown 房用 `implements Tracker` 去实现，少一个参数、错一个返回类型，
编译当场报错，不必等运行时才发现。

## 谁实现、谁消费

- **实现方（房间）**：`src/host/tracker/backends/github/`、`src/host/tracker/backends/markdown/`。
  GitLab 房本轮不在改造范围内（房间目录留着，将来按同一份契约接进来）。
- **消费方**：deck 九个工具（经共享壳选好后端后直接调）、注册表（`registryCore.js`）、
  宿主电话与面板。

## 三条不变量（改了就是破坏承诺）

1. **失败是返回值，不是异常**：任何操作失败都回 `{ ok: false, error }`，
   `error.kind` 取 `ports.ts` 里那八个值。房间抛异常会让上层两条写路径同时开火。
2. **字段要么永远在、要么按能力省略**：核心字段永远存在（缺了用 `''`/`null` 补），
   能力字段能实现就给值或给空数组（EMPTY），不能实现就整个字段省略（MISSING）。
   「空数组」与「没有这个能力」是两件事，界面靠这个区别说话。
3. **没有能力清单**：没有一个 `supportedOps` 之类的表。能力是**运行时调用结果** ——
   能做的返回数据，不能做的当场返回 `unsupported`。这条叫 G5，是红线不是偏好。

## 三个房内扩展的定位（这一轮定的）

有三个方法不在 19 条契约操作里，但确实有房外的读者，所以要写清楚它们各自是什么身份：

| 名字 | 身份 | 为什么这么定 |
| --- | --- | --- |
| `getRepoPermissions` | **本轮升为契约操作**（进 `Tracker`） | 「这个仓库能不能写」deck 与面板两边都要用；只挂在 GitHub 房上会让本地 Markdown 那一侧没有答案 |
| `listSubIssues` | GitHub 房扩展（`GitHubRoomExtension`，**不进契约**） | 它是读路径的实现细节，唯一调用者是宿主电话；没实现它的后端由那条电话按「做不到」退化 |
| `ensureLabelColorsFile` | 本地 Markdown 房扩展（`MarkdownRoomExtension`，**不进契约**） | 宿主在「用户选定后端」那一步要放一份默认配色文件，但**不许问后端是谁**；做成「实现了就放、没实现就跳过」的口子，只有本地 Markdown 房实现它 |

另外两个名字也住在 GitHub 房与本地 Markdown 房的实例上，但**不建模**，理由写在这里免得
以后被当成漏掉：本地 Markdown 房的 `normalize` 与 `parse` 是房内自用的解析函数
（房外的读者是它自己的别的文件），它们不是给上层用的口子，等房间自己迁成 TypeScript 时
按房内模块处理即可。

## 与今天的运行时真源的关系（迁移期必读）

今天运行时的真源仍然是 `src/host/tracker/contract.js` 与它的三份续篇
（`contract-label-colors.js`、`contract-page.js`、`contract-idempotency.js`），用的是 JSDoc。
本目录是它的 TypeScript 版本，**语义一个字都没改，只换了写法**。两个版本暂时并存：

- 改形状或改操作签名 = **两处一起改**（这一条是迁移期的硬要求，漏一处就是两套承诺）。
- 运行时那份什么时候退休，由迁移批次定；本目录不产出任何 `.js`，所以现在没有任何东西会
  自动引用它 —— 这也意味着**它出错不会当场炸，只会让将来迁移时对不上**，所以更要靠审查。

## 怎么自检

```bash
npx tsc -p tsconfig.contract.json
```

零错误才算通过。这一层没有构建步骤、没有派生产物、也不进 `scripts/build.mjs`。

## 文件清单

- `ports.ts` —— 形状层：身份、实体（票/标签/评论/参与人）、调用上下文、返回值、各操作的入参、
  标签配色专用形状、房内扩展要用的数据形状。
- `operations.ts` —— 操作层：19 条契约操作的名字（`OpName`）、`Tracker` 接口（含本轮新升的
  `getRepoPermissions`，共 20 个成员）、房间能拿出来的那份（`RoomOperations`）、
  两个房内扩展（`GitHubRoomExtension`、`MarkdownRoomExtension`）。
- `backend-module.ts` —— 模块对象形状：`id` / `label` / `create` / `matches` 四件套，
  加品牌色板、设置页文案键、链接模板、界面能力位、检查目录、修复知识、默认调色盘。
