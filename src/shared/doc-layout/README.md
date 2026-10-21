# 域文档布局取值（src/shared/doc-layout）

这个域只放一件东西：**域文档布局取值的唯一真源**——两种取值 `single`（单上下文，根目录一份
GLOSSARY.md）与 `multi`（多上下文，子项目各一份 GLOSSARY.md，根目录一份 GLOSSARY-MAP.md 指过去）
的名单与类型（#1342）。

## 为什么单独立一个域

同一份名单原来在三个地方各写了一遍：宿主侧选择记忆的文件校验、工作区配置文件核的读取校验、
界面侧初始化卡与状态栏的取值校验。三处里任意一处单独改动，另外两处就会静默拒收合法取值、
或者写出第三种取值；它们之间既不会在编译期连起来，也没有一处能当场报错。所以名单收到这里，
三处都从这里读（或接收调用方传进来的这一份）。

## 文件怎么摆、谁在读

- 手写真源：`src/layouts.ts`（本目录下 `src/` 子目录里），导出 `DocLayoutValue` 与
  `DOC_LAYOUT_VALUES`。
- 构建产物：`.build/shared/doc-layout/layouts.js`，由 `node scripts/build.mts` 逐文件转译生成，
  **不进版本库、不要手改**。构建按「目录里有 `tsconfig.json`」自动认域，不需要在别处登记。
- 消费方三处：
  - 宿主选择记忆 `src/host/choiceStore.ts`：普通相对 import，导出自己的 `LAYOUT_VALUES` 供读写校验；
  - 工作区配置文件核 `src/shared/config-store/src/workspace.ts`：核不 import 本域（同层互引禁令），
    由调用方（`src/host/configStore.ts`、`src/deck/shell/workspace-anchor.ts`）把
    `DOC_LAYOUT_VALUES` 作为参数传进 `parseWorkspace` / `parseWorkspaceText` / `stringifyWorkspace`；
  - 界面侧 `src/client/statusbar/StatusBackend.ts`：客户端闭包不能运行时 import `src/shared`，
    由构建按 `scripts/build.mts` 的 `SHARED_SPLICE`（`shared:docLayout`）拼进闭包，
    状态栏那份声明用 `declare const DOC_LAYOUT_VALUES` 取用。
- 加第三种布局时：只改 `src/layouts.ts` 的联合类型与名单，再把三处消费方各自的校验/文案跟着补上；
  名单顺序同时决定「默认选第一项」是哪一个，改顺序前先确认初始化卡的行为要一起改。

## 门禁

- `tests/verify-683-choice-store.ts` 末尾钉住选择记忆导出的 `LAYOUT_VALUES` 仍是这两种取值，
  本域被改坏时这扇门禁会红（文件头的「门禁归属」注释指向本目录）。
