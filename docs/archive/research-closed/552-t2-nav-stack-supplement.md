# T2 补充报告：行为抽查固化为门禁（#552，不关闭）

前一份实现报告之后，按要求把临时行为抽查固化为可提交用例。本次只加测试与一行注册接线，没有动已实现的 3 个源文件。

## 新增与改动（2 个文件）

1. `tests/verify-nav-stack.js`（新建）：39 项断言，分四组——形状声明（`navStack: []` 与镜像字段保留）、操作函数导出（7 个新函数存在、5 个旧入口保留、栈元素只记种类）、行为级 18 项（空栈看顶为 null、空栈弹栈不崩、单层等价旧互斥、多层压栈不断返回路、栈顶指向后进者、重复进入去重、逐级弹出回上一级且镜像同步、弹空栈双镜像为 null、clearActiveDetail 等于清空栈、非法输入直接返回不污染栈、setActiveMap(null) 等于清除、旧对象从镜像回推/压栈前补层/弹栈回镜像层/清除能清掉、弹栈保留展开收起、弹栈保留详情缓存、弹空栈不写回旧镜像）、接线与双产物（Dock 读栈顶且保留三分支、双产物含 navStack/pushNav/popNav/peekNav）。
2. `package.json`：`scripts.verify` 串里 `verify-mapdetail-fields.js` 后面加 `node tests/verify-nav-stack.js`（仓库约定就是显式串联，加进去即接入，不用留给 T5）。

行为加载手法：测试把 `store-prefs.js` 行首 `export` 去掉后求值，注入一个只加 tick 的 `emit` 桩；该文件顶层对 `window`/`localStorage` 都有 try/catch 兜底，在 node 下可直接跑。

## 验证结果

- `node scripts/build.mjs`：通过，双产物已重生成。
- `node tests/verify-nav-stack.js`：39 项全过。
- 相关既有门禁：`verify-active-issue`、`verify-kernel`、`verify-leaves`、`verify-issue-detail`、`verify-mapdetail-fields` 全过。
- 全量 `npm run verify` 仍太重未跑（`verify-panel.js` 已知在干净树上失败，架子自身 `h.wf.refresh` 未定义，与本票无关）；新用例已进串联，跑全量的人会自动带上它。

## 遗留与裁决

无新增遗留风险，无需领导裁决的事项。前份报告的 T3/T4 交接事项不变。
