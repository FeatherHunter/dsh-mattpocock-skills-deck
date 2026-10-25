# 何时使用模拟

只在**系统边界**上使用模拟：

- 外部 API（支付、邮件等）
- 数据库（有时需要——优先用测试数据库）
- 时间／随机数
- 文件系统（有时需要）

不要模拟：

- 你自己的类／模块
- 内部的协作者
- 任何你能控制的东西

## 为可模拟性而设计

在系统边界上，把接口设计成容易模拟的样子：

**1. 使用依赖注入**

把外部依赖传进来，而不是在内部创建它们：

```typescript
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. 优先使用 SDK 风格的接口，而不是通用的取数函数**

给每个外部操作写一个具体函数，而不是写一个带条件分支的通用函数：

```typescript
// GOOD: Each function is independently mockable
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: Mocking requires conditional logic inside the mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

SDK 这种做法意味着：
- 每个模拟只返回一种具体的形状
- 测试的准备代码里没有条件分支
- 更容易看出一个测试覆盖了哪些端点
- 每个端点都有类型安全
