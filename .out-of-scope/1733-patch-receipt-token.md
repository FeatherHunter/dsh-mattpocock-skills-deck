# deck_issue_patch 写操作回执精简（#1733）

本文件记录 [#1733](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1733) 为什么没有进入实施。结论是**不跟进**：不是分诊判定超出范围或技术上行不通，而是开票人自行撤回了建议，维护者按撤回处理。

## 请求内容

2026-10-31，报告人建议：`deck_issue_patch` 在 comment / progress / close 之后，回执里仍然带整张票（正文 + 最多 50 条评论），charting 时 10 张票就要几万 token；希望默认回精简回执，或提供 `detail` 一类粒度开关，或至少别让 `workRouteDetail:'core'` 无效。

## 为什么不跟进

- 问题本身仍然存在：分诊复核当前 beta.33，写操作回执仍把整张票放进 `data.ticket`；「3.0K 正文 + 4 条评论」的票实测约 3.1K tokens，相对 beta.8 的约 6.3K 已由 #1273（去掉重复份）与 #1561（移走在办表）减半，但默认精简回执没有实现。
- 2026-10-31 15:06（+08:00），开票人 Ba7nice 自己把票以「不计划处理」关闭：0 条评论、0 个标签、票面没有说明原因。维护者同日决定「就这样」，按撤回处理，不再跟进。
- 所以这是「发起人撤回」，不是「判定不值得修」；本票的问题描述与分诊笔记保留，供以后重启时复用。

## 如果以后重启

按分诊笔记 `research/1733-triage-2026-10-31.md` 的路线 A 重开本票或新开一张票：写操作默认回「逐条结果 + 状态三格 + notes」，要整票时显式传 `detail:"full"`；改动面在 `src/deck/tools/issue-patch.ts` 的回执组装、参数表与几条直接读 `data.ticket` 的用例。笔记里有六张票的实测体积与兼容面，不需要重新调查。

## 历史请求

- [#1733](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1733)（2026-10-31）：报告人提出三条改进方向（默认精简回执、`detail` 粒度开关、用 `workRouteDetail:'core'` 压缩）。分诊复核：③ 已因 #1561 作废、② 的 `detail:"minimal"` 不存在、① 未实现。同日 15:06 报告人自行关闭（NOT_PLANNED）；维护者按撤回处理，补 `wontfix` 标签并记入本文件。
