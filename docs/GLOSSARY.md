# Matt Pocock Skills Glossary

> 本词汇表记录你已掌握并能在练习中正确使用的术语。新增一条的前提是你已能用它选型或写对。

## 过程
**Skill**: 一小段锋利的指令，交给 Agent 让它按资深工程师的方式工作；可组合，前一个的输出是后一个的输入。 _Avoid_: prompt, template
**Grilling**: 沿设计树拷问直到每个分支都关上的访谈动作。 _Avoid_: 随便问问
**Spec**: 由拷问后的对话综合而成的规格，含 seams 确认与六段模板。 _Avoid_: 需求文档
**Tracer-bullet / 垂直切片**: 窄但穿透全层的可演示票，声明 Blocked by 边。 _Avoid_: 水平切片
**Frontier**: 所有 blockers 全关且未被认领的开放票集合。 _Avoid_: 待办列表
**Map (Wayfinder)**: wayfinder:map 票与其子 decision tickets 构成的迷雾导航结构。

## 设计
**Module**: 有 interface 与 implementation 的任何东西。 _Avoid_: component, service
**Interface**: 调用者必须知道的一切（签名+不变量+顺序+错误+性能）。 _Avoid_: API, signature
**Seam**: 能不改此处而改行为的位置；interface 所在之处。 _Avoid_: boundary
**Depth**: 小 interface 背后藏大量行为的程度。 _Avoid_: 复杂度
**Adapter**: 在 seam 上满足 interface 的具体实现（按角色命名）。
**Leverage / Locality**: 深模块给调用者的杠杆、给维护者的局部性。

## 语言
**CONTEXT.md**: 项目的通用语言词汇表，只含定义不含实现。
**ADR**: 难逆×意外×有权衡的决策记录。
**Ubiquitous Language**: 团队与代码中共用的那套词。
