# 不在范围内的知识库

仓库里的 `.out-of-scope/` 目录存放被否决的功能请求的长期记录。它有两个用处：

1. **组织记忆**：记录一个功能为什么被否决，这样议题关闭时背后的理由不会丢
2. **去重**：当来了一个与先前否决记录相符的新议题时，技能可以把之前的决定摆出来，而不必重新争论一遍

## 目录结构

```
.out-of-scope/
├── dark-mode.md
├── plugin-system.md
└── graphql-api.md
```

一个**概念**一个文件，而不是一个议题一个文件。多个请求同一件事的议题归到同一个文件下。

## 文件格式

文件应当写得轻松、好读，更像一份简短的设计文档，而不是一条数据库记录。用段落、代码示例和例子把理由讲清楚，让第一次碰到它的人也能看懂、用得上。

````markdown
# Dark Mode

This project does not support dark mode or user-facing theming.

## Why this is out of scope

The rendering pipeline assumes a single color palette defined in
`ThemeConfig`. Supporting multiple themes would require:

- A theme context provider wrapping the entire component tree
- Per-component theme-aware style resolution
- A persistence layer for user theme preferences

This is a significant architectural change that doesn't align with the
project's focus on content authoring. Theming is a concern for downstream
consumers who embed or redistribute the output.

```ts
// The current ThemeConfig interface is not designed for runtime switching:
interface ThemeConfig {
  colors: ColorPalette; // single palette, resolved at build time
  fonts: FontStack;
}
```

## Prior requests

- #42: "Add dark mode support"
- #87: "Night theme for accessibility"
- #134: "Dark theme option"
````

### 给文件命名

给概念起一个简短的、能说明意思的 kebab-case 文件名：`dark-mode.md`、`plugin-system.md`、`graphql-api.md`。名字要足够好认，让人浏览目录时不打开文件也能知道被否决的是什么。

### 写理由

理由要有实质内容：不是「我们不想要这个」，而是要说明为什么。好的理由会引用：

- 项目的范围或理念（「这个项目专注于 X；主题化是下游的事」）
- 技术约束（「要支持它就需要 Y，而 Y 与我们的 Z 架构冲突」）
- 战略决策（「我们选择用 A 而不选 B，因为……」）

理由应当经得起时间。避免引用临时性的处境（「我们现在太忙」）；那不算真正的否决，只是推迟。

## 什么时候查 `.out-of-scope/`

分诊期间（第 1 步：收集上下文），读完 `.out-of-scope/` 里的所有文件。评估一个新议题时：

- 检查这个请求是否与某条已有的「不在范围内」概念相符
- 匹配看的是概念相似，而不是关键词：「夜间主题」会匹配到 `dark-mode.md`
- 如果有匹配，就把它摆到维护者面前：「这和 `.out-of-scope/dark-mode.md` 相似。我们之前否决过它，理由是 [reason]。你的看法还是这样吗？」

维护者可以：

- **确认**：把新议题追加到已有文件的「Prior requests」清单里，然后关闭它
- **重新考虑**：删掉或更新那份不在范围内的文件，议题走正常分诊流程
- **不同意**：两个议题相关但不是一回事，走正常分诊流程

## 什么时候写 `.out-of-scope/`

只有在**一个 enhancement**（不是 bug）被当作 `wontfix` *否决*时，才写这里。这条对 enhancement 的 PR 与对议题完全一样：被否决的 PR 也记在这里，免得同一个请求换一身新代码再回来。

如果某个东西是因为**已经实现**而被打上 `wontfix` 关闭的，**不要**写到这里。那是已经做出来的功能，不是被否决的；记下来会让去重检查被假否决污染。这种情况应当在关闭评论里指出这个功能已经在哪里。

流程是：

1. 维护者判定一个功能请求不在范围内
2. 检查是否已有对应的 `.out-of-scope/` 文件
3. 有：把新议题追加到「Prior requests」清单里
4. 没有：新建一个文件，写上概念名、决定、理由和第一条先前请求
5. 在议题上发一条评论，解释这个决定并提到那份 `.out-of-scope/` 文件
6. 用 `wontfix` 标签关闭议题

## 更新或删除不在范围内的文件

如果维护者对先前否决过的某个概念改了主意：

- 删掉那份 `.out-of-scope/` 文件
- 技能不必重开旧议题；它们只是历史记录
- 触发重新考虑的那个新议题走正常分诊流程
