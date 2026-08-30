# Agent Instructions

This file gives an agent working in this repo the context it needs to operate well.

## Agent skills

### Issue tracker

Issues live as GitHub issues, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`) plus five wayfinder labels (`wayfinder:map` / `research` / `prototype` / `grilling` / `task`). The **mandatory label set** is `bug` / `needs-triage` / `wayfinder:grilling`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Human-first wording

执行任务中写下的所有文字——对话回复、issue 标题与正文、markdown 文档、代码注释、任何文件——都以「人类第一次阅读就能准确理解」为第一标准：只使用 CONTEXT.md 词典或此前交流中已确立含义的词语；确需表达新概念时，写成完整、平实的描述，而不是造一个需要另行解释的简称或比喻。先满足人的可读性，再谈机器的便利——AI 能读懂平实的完整句，却会替读者造出只有当次会话才明白的速记。

**发出去之前，都停一秒问自己：**
1. 没看过前文的人，能直接看懂这句话在说什么吗？
2. 有没有用了只有我们这次对话才懂的叫法？有就改成大白话。
3. 新东西是不是用一整句话说清楚了，而不是只扔一个词让别人去猜？

### 提交信息规范

所有 `git commit` 信息必须用中文，用通顺的完整句子说清“这次改了什么、为什么改”。标题至少 10 个字，不要只写 `fix` / `update`。详见 `docs/agents/commit-convention.md`。