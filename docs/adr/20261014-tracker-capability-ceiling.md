# ADR：Tracker 能力上限（26 条）

> 日期：2026-10-14
> 状态：已定版
> 关联：承接 `docs/adr/20261011-deck-ts-rewrite.md` §3.1；讨论见 #1051；真源见 `src/tracker/contract/operations-catalog.ts` 与 `src/tracker/contract/operations.ts`

---

## 1. 背景：以前“各家另有扩展”，上层要先问后端是谁

以前契约只管 19 条操作，剩下的能力散在三个地方：GitHub 的房内扩展、Markdown 的房内扩展、两房共用的实例旁路口。

这带来一个很具体的坏处：**凡是要用那些能力的地方，都得先判断后端是谁，再决定调哪个名字**。多写一次分支，就多一次漏掉某个后端的机会；新加一个后端时，所有分支都要重新检查一遍。

## 2. 决定：契约层定义能力的上限，后端只回答“实现”或“不支持”

从 2026-10-14 起，**全部能力都写在契约层**：

- **操作 23 条**：`preflight`、`list`、`get`、`getDependencies`、`create`、`close`、`reopen`、`comment`、`update`、`setLabels`、`setAssignees`、`setParent`、`setBlockedBy`、`getCurrentUser`、`initProject`、`listLabels`、`setLabelColors`、`counts`、`listPage`、`getRepoPermissions`、`listSubIssues`、`ensureLabelColorsFile`、`readBudget`。
- **定位口 3 条**：`getRepoKey`、`describe`、`issueAddress`。

> 2026-10-23 修订（规格 #1439）：第 26 条能力 `readBudget` 加入契约，回答“这个后端还剩多少额度”，三种诚实结果见 `src/tracker/contract/budget-model.ts`；其余 25 条不动。

规矩只有三条：

1. **后端不许有独有的对外方法**：实例上能叫到名字的东西，必须先在契约名录里出现。
2. **后端对每条只有两种回法**：操作回“我实现”或“我不支持”（`error.kind === 'unsupported'`）；定位口回名字或空值（空也是答案，不是失败）。
3. **缺操作由注册表补桩，定位口不补桩**：`describe` 是同步取值，补异步失败对象会把它用坏；所以定位口缺席就按空值走，调用方不抛、不拦。

## 3. 为什么分成“操作”和“定位口”两段

因为“没有答案”的含义不一样：操作没有实现是一种合法回答，可以补一个如实说“不支持”的桩；定位口没有答案就是空值，空值本身已经是答案，不需要也不应该再补一个失败对象。

## 4. 后果：加能力先改契约，再实现

以后要加一条能力，顺序固定为：先把名字写进 `operations-catalog.ts` 与 `Tracker`，再让后端去实现；实现不了就如实回 `unsupported`，不许换个名字偷偷提供。

三个扩展类型（`GitHubRoomExtension` / `MarkdownRoomExtension` / `RoomAuxiliaries`）随之删除，成员全部并进 `Tracker`。本地 Markdown 的 `normalize` / `parse` 从实例上摘掉：它们是房内模块的私有实现，别的文件直接 import，不经实例。
