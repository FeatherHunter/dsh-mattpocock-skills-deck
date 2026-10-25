# 议题跟踪器：本地 Markdown

这个仓库的议题与规格说明都以 Markdown 文件的形式放在 `.scratch/` 里。

## 约定

- 每个功能一个目录：`.scratch/<feature-slug>/`
- 规格说明放在 `.scratch/<feature-slug>/spec.md`
- 实施议题按工单一份文件，放在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号，绝不写成一份合并的工单文件
- 分诊状态记录在每个议题文件靠近顶部的一行 `Status:` 里（角色字符串见 `triage-labels.md`）
- 评论与会话历史追加到文件末尾的 `## Comments` 标题下

## 当技能说「发布到议题跟踪器」

在 `.scratch/<feature-slug>/` 下创建一个新文件（需要的话先建目录）。

## 当技能说「取出相关工单」

读所引用路径上的文件。用户通常会直接给出路径或议题编号。

## 寻路操作

供 `/wayfinder` 使用。**地图**是一个文件，每张工单对应一个**子**文件。

- **地图**：`.scratch/<effort>/map.md`（正文里放 Notes、Decisions so far 和战争迷雾这些内容）。
- **子工单**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文里写问题。一行 `Type:` 记录工单类型（`research`/`prototype`/`grilling`/`task`）；一行 `Status:` 记录 `claimed`/`resolved`。
- **阻塞**：靠近顶部的一行 `Blocked by: NN, NN`。列出的每个文件都 `resolved` 时，工单才算解除阻塞。
- **前沿**：扫描 `.scratch/<effort>/issues/`，找出处于打开、未被阻塞、未被认领状态的文件；编号最先的胜出。
- **认领**：把 `Status: claimed` 设好并保存，然后再动任何工作。
- **解决**：在 `## Answer` 标题下追加答案，把 `Status: resolved` 设好，再把一条上下文指针（要点 + 链接）追加到 `map.md` 里地图的 Decisions so far 段。
