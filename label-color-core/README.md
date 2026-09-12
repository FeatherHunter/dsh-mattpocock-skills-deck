# 配色核心（label-color-core）

插件内置的 TypeScript 能力，第一批只做标签配色这件事的两段纯计算：色值的归一化与比较、
调色盘提示词的拼装。形态照仓库里既有的 `update-core/`：源码放在仓库根这个独立目录里，
编译产物逐文件落进 `src/shared/label-color/` 并提交进 git，**不发 npm 包**、
不进 pnpm workspace、不建 `packages/<名字>/`（决策记录见
`docs/adr/20260913-builtin-ts-shape.md`）。

## 里面有什么

- `src/ports.ts`：插口形状（标签清单里的一行、一项改动、逐条记账结果、两条方法的签名，
  最后一行是模块标识 `PORTS_SOURCE`）。核心只管做决定，插口由核心定，跑腿的活全在外面。
  里面没有操作名与错误分档——那两样归 tracker 契约层（`src/host/tracker/contract.js`，
  规格见 #627），两处各管一段，不要在这里再抄一份。
- `src/colors.ts`：色值的归一化（`normalizeColor`）、合法性判断（`isColor`）、
  比较两个颜色有没有变（`colorsDiffer`）、从清单与草稿里挑出真正变了的行（`pickChangedRows`）。
  零相对引用；用到的类型走 `import type`，转译后不留引用。
- `src/prompt.ts`：调色盘提示词的两段拼装（`buildPaletteTable` 出表格、`buildPalettePrompt`
  出整段）。零相对引用，同样只走 `import type`。这里不含任何用户能看到的文案：
  开头一句、两个表头、结尾一句都由调用方从词表里传进来，中英两份都住在词表里。
- `build.mjs`：编译脚本。esbuild 只转译不打包，一对一生成 `src/shared/label-color/` 下的
  同名 JS；另跑 `tsc --noEmit` 只做类型检查。导出 `transpileUnit`、`runTypeCheck`、`buildAll`
  三个函数，`scripts/build.mjs` 会在派生步骤之前调用一次 `buildAll`。
- `tsconfig.json`：类型检查配置（严格模式，不产出）。

## 给第二家的三条保证

1. 输出目标定死保守版本（ES2020），Node 宿主与浏览器闭包两边都跑得动。
2. 核心里不碰任何 Node 或浏览器专属能力，跑腿全在适配器。
3. 类型只用标准写法，不依赖特殊编译选项。

第二家用自己的工具链直接吃 TS 源码，我们的编译只服务 deck。

## 常用命令

- `node scripts/build.mjs`：日常只用这一条。它先转译本目录、跑类型检查，再拼客户端、复制宿主。
- `node label-color-core/build.mjs`：只做本目录的转译与类型检查。单独跑完之后要再跑一次
  `node scripts/build.mjs`，否则 `tests/verify-kernel.js` 会因为「客户端产物比源码旧」变红
  （这是有意设的，为的是让「只重建核心、忘了重建客户端」更早被发现）。
- `node tests/verify-label-color-freshness.js`：改了 TypeScript 没重新生成就变红。
- `node tests/verify-label-color-core.js`：纯函数行为的单元门禁（色值归一、合法性、
  空值语义、挑出真正变了的行、提示词表格口径）。

## deck 侧落点

- 产物三个：`src/shared/label-color/ports.js`（空壳，只有一行模块标识，没有运行时代码
  引用它，门禁读它一次）、`colors.js`、`prompt.js`。三个都提交进 git。
- 宿主侧直接相对 import 产物，例如 `import { normalizeColor } from '../shared/label-color/colors.js'`。
- 客户端侧：`colors.js` 与 `prompt.js` 由 `scripts/build.mjs` 的 `SHARED_SPLICE` 清单拼进
  客户端闭包，标记是 `// ==== shared:labelColors (spliced by build) ====` 与
  `// ==== shared:labelColorPrompt (spliced by build) ====`，两行写在 `src/client/index.js` 里。
  界面代码拿到的是同一份函数，只是走闭包；文案由界面从词条传进去。
  拼进闭包这件事有两条边界条件，改这两个文件时要知道：产物必须是 ESM 且要用的东西都带
  行首 `export`（拼接的做法就是去掉行首那七个字符），产物里不能出现 `__DSW_VERSION__`
  与 `__DSW_REPO_URL__` 两个占位符（拼接发生在版本注入之后，拼进来的文本不会再过一遍注入）。
  这两条由 `tests/verify-label-color-freshness.js` 与 `tests/verify-generated-no-shadow.js` 看着。
- 后端适配器（GitHub 房间、本地 Markdown 房间）要按同一套色值口径比较颜色时，
  引这两个产物；房间导入白名单那条允许记在 `docs/adr/20260913-builtin-ts-shape.md` 第 2.9 节。
- 两处已知的形态细节，改的时候要知道：
  1. `ports.ts` 里的 `ColorChangeFailure` 用的是 `{ name, reason: { kind, message } }`，
     与 tracker 契约层逐条记账里的失败条目逐字一致（总工裁决：核心是后来者，向已定版的契约对齐，
     不另造 `code` 这种字段名）。`kind` 的取值表在契约层，这里不抄。
  2. `prompt.ts` 里把颜色打印成「不带井号的小写六位」时，自己写了一遍那三步。
     原因是 `src/shared` 下的文件之间不许互相引用（同层互引门禁），两个文件又都要被拼进
     客户端闭包，所以不能调 `colors.ts` 里的函数。这一段只管打印成什么样，不判合法性、
     不做任何跳过的决定；真要改色值口径，两个文件都要改。

## 日志点

核心是纯函数，自己不打任何日志：这里没有跨模块边界的调用、没有缓存、没有定时活、
没有读写的动作，照 `docs/design/335-logging-contract.md` 第 3 章的判定，一条日志点都不落在这里。
两条标签配色电话（`wf.listLabels` 与 `wf.setLabelColors`）的日志点归宿主侧那条链
（`src/host/workspaceCwd.js`，沿用既有的常驻事件），调色盘提示词的展示链归界面票。
