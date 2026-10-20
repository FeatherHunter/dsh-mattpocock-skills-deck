<!-- DSH-IDEMPOTENCY-KEY: T8-SPEC-SAMPLE-OK -->
<!-- DSH-ISSUE-KIND: spec -->
<!-- parentKey: 00 -->
<!-- created: 2026-10-20T00:00:00.000Z -->
# 规格样本：合规（#1299 T8）

## 问题陈述

双轨链路要求规格票在本地 Markdown 与 GitHub 两条后端车道上都能被认出来，而不是被当成普通票。

## 解决方案

用 deck_issue_create（kind=spec）建票：工具把对象类型标记写进文件头（本地 Markdown 是文件头注释，GitHub 是正文里的标记行），把父边挂到探索地图上。

## 用户故事

- 作为维护者，我希望规格票一眼能被认出来，不用猜标签和正文形状。
- 作为执行的人，我希望实施票的父边清清楚楚指向规格票。

## 实现决策

- 对象类型标记是唯一真源，按 ADR 2.5 写在幂等锚之后、一级标题之前。
- 规格票不再单独写一行类型字段。
- 父边在本地 Markdown 后端落成 `<!-- parentKey: 00 -->` 注释。

## 测试决策

- 门禁读这份样本，断言规格样本判据返回空数组，并把它当容器收进快照。

## 不在范围内

- 不覆盖 GitHub 契约层「只认正文首行」的已知差异（见 #1277 第 7 节）。

## 补充说明

- 违规样本见同目录 spec-违规.md。

Status: open
Blocked by:
Labels: ready-for-agent

## Comments


## Answer
