# GLOSSARY.md 格式

## 结构

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## 规则

- **要有明确立场。** 同一个概念有多个词可用时，挑出最好的那一个，把其余的都列在 `_Avoid_` 下面。
- **定义要紧凑。** 最多一两句话。定义它*是什么*，而不是它*做什么*。
- **只收这个项目上下文特有的术语。** 通用编程概念（超时、错误类型、工具类模式）不属于这里，哪怕项目大量在用。加一个词之前先问：这是这个上下文独有的概念，还是通用编程概念？只有前者该进词汇表。
- **术语自然成组时，就把它们归到小标题下。** 如果所有术语都属于同一块连贯的领域，平铺一个列表也可以。

## 单上下文仓库与多上下文仓库

**单上下文（大多数仓库）：** 仓库根目录放一个 `GLOSSARY.md`。

**多上下文：** 仓库根目录放一个 `GLOSSARY-MAP.md`，列出各个上下文、它们放在哪里，以及它们之间如何关联：

```md
# Glossary Map

## Contexts

- [Ordering](./src/ordering/GLOSSARY.md): receives and tracks customer orders
- [Billing](./src/billing/GLOSSARY.md): generates invoices and processes payments
- [Fulfillment](./src/fulfillment/GLOSSARY.md): manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

技能会推断该用哪种结构：

- 如果存在 `GLOSSARY-MAP.md`，读它找出各个上下文
- 如果只有根目录一个 `GLOSSARY.md`，就是单上下文
- 如果两个都不存在，就在第一个术语定下来时按需创建根目录的 `GLOSSARY.md`

存在多个上下文时，推断当前话题与哪一个相关。如果拿不准，就问。
