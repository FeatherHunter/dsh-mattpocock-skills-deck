# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's tracker.

Label colours are **not** kept in this file. On the **local Markdown backend** the colours live in the workspace file `docs/agents/label-colors.json`, which the plugin places there and you can edit by hand or through the deck's re-colour dialog in the panel; on GitHub the colours are the repository's own label colours. This file only answers "which label string does a role map to".

## Label set

| Label | Meaning |
| --- | --- |
| wayfinder:map | The map issue of a wayfinder effort |
| wayfinder:research | Research ticket (AFK) |
| wayfinder:prototype | Prototype ticket (HITL) |
| wayfinder:grilling | Grilling / discussion ticket (HITL) |
| wayfinder:task | Task ticket (HITL or AFK) |
| bug | Something is broken (fix action / BUG filter) |
| enhancement | A feature request (category role; pairs with a state role) |
| needs-triage | Unexamined issue awaiting diagnosis |
| needs-info | Waiting on reporter for more information |
| ready-for-agent | Fully specified, ready for an AFK agent |
| ready-for-human | Requires human implementation |
| wontfix | Will not be actioned |

Add any custom label you use as a new row here. A row added here only records the label's name and meaning — it does not give the label a colour; colours come from `docs/agents/label-colors.json` (local Markdown backend) or from the repository's own labels (GitHub).

When a skill mentions a role (for example "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Mandatory label set

这个仓库建票时**按位置补标签**，不要求每张新票都带 triage 标签。六种位置各补什么（与代码里的位置表 `src/deck/rules/object-kind.ts` 的 `OBJECT_KIND_RULES` 逐条对应）：

| 位置 | 建票时补的标签 |
| --- | --- |
| 探索地图（`kind: map`） | `wayfinder:map` |
| 地图工单（`kind: map-ticket`） | 调用时 `label` 给的那一枚 `wayfinder:<类型>`（`research` / `prototype` / `grilling` / `task` 四选一） |
| 规格（`kind: spec`）与实施票（`kind: spec-ticket`） | `ready-for-agent` |
| 缺陷票（`kind: bug`） | `bug` 与 `needs-triage` |
| 普通票（`kind: issue`） | 一枚都不补 |

`deck_issue_create` 按这张表把缺的补上。**wayfinder 的地图与地图子票只带 wayfinder 标签，不叠 `ready-for-agent` 这类 triage 标签**：它们是决策，不是实施工作。同一张表也写在 `docs/agents/issue-tracker.md` 的「Mandatory label set」一节。

`bug` / `needs-triage` / `wayfinder:grilling` 这三枚标签仍然保留：它们是面板上「修复」「诊断」「讨论」三个动作的入口，不是每张新票的必备项。

## Wayfinder label set

The `/wayfinder` skill requires all five wayfinder labels to exist. Every wayfinder child ticket carries exactly one of them:

- `wayfinder:map` — the parent map issue (Notes / Decisions-so-far / Fog)
- `wayfinder:research` — research ticket
- `wayfinder:prototype` — prototype ticket
- `wayfinder:grilling` — grilling/discussion ticket
- `wayfinder:task` — implementation task ticket

Edit the `Label` column to match whatever label strings you actually use.

## Checklist issue exception

每个要发布的版本有一张 `[真机验证] <版本号>` 清单票（规则见 `docs/agents/real-machine-verification.md`）。它按普通票建（`kind: 'issue'`），靠标题前缀识别，**不打任何标签**：按上面那张表，普通票本来就一枚都不补；打了标签反而会混进 bug / triage 的筛选里。建票时不要给它补标签。

