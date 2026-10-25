<!-- DSH-IDEMPOTENCY-KEY: legacy-fixture-spec-06 -->
<!-- DSH-ISSUE-KIND: spec -->
<!-- created: 2026-10-23T13:12:49.424Z -->
# 旧布局规格：调色板 README 基础使用演示

## Problem Statement

调色板仓首页只有静态截图与三步文字指令，没有可折叠的视频演示。

## Solution

在首页新增独立章节，默认折叠收纳 7 段操作视频，中英文各写一份。

## User Stories

1. As a 新读者， I want a 默认折叠的演示章， so that 首屏不被撑长。

## Implementation Decisions

- 演示章落在安装章之后、功能章之前，视频地址中英文复用同一批。

## Testing Decisions

- 只读两页文档的纯文本，断言字符串与数量，不渲染、不联网。

## Out of Scope

- 不重录英文视频，不改主题系统实现。

## Further Notes

- 资产来源是调色板仓 #155。

## 进度

Status: resolved
Blocked by:
Labels: ready-for-agent

## Comments


### local — 2026-10-23T14:47:26.445Z
规格收口核对通过，关闭。


## Answer
