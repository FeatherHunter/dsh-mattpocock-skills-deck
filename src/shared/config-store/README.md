# 配置读写核（src/shared/config-store）

插件内置的 TypeScript 能力：三份配置文件只有一份读写实现。源码与它的转译产物并排放在
同一个目录 `src/shared/config-store/` 里：源码在 `src/` 子目录，转译出的 `.js` 落在本目录
（构建产出，不入版本库）。整个目录**不发 npm 包**、不进 pnpm workspace、不按 `packages/<名字>/` 那种
工作区包来建（决策记录见 `docs/adr/20260913-builtin-ts-shape.md`）。2026-10-13 按 #1023
的决定，从仓库根平铺的 `config-store-core/` 搬到这里。

## 管哪三份文件

- 工作区后端配置：`docs/agents/workspace.yaml`（版本 2；兼容读老 `workspace.json` 版本 1，
  JSON 是 YAML 的子集，直接可读）。
- 本机全局设置：`<用户主目录>/.dsh/mattskillsdeck/settings.yaml`（版本 1）。
- 标签配色数据：`docs/agents/label-colors.yaml`（版本 1；兼容读老 `label-colors.json`，
  老文件没有版本，当 1 读）。

字段清单与注释原文以 #1012 票里维护者定案的骨架为准，注释文字就住在
`src/config-store.ts` 的常量里：写入 = 模板 + 值，注释与字段定义同一个源，永远同步。
手写的注释不保留，文件头第一句就把这条说明白。

## 里面有什么

- `src/ports.ts`：插口形状（三种文件的标识、解析与拼装的成功失败形状，
  最后一行是模块标识 `PORTS_SOURCE`）。核心只管做决定，插口由核心定，跑腿的活全在外面。
- `src/workspace.ts` / `src/settings.ts` / `src/labels.ts`：三份文件各自的校验与拼装
  （字段定义、类型、注释文字、键顺序都在各文件一处）。严格校验：白名单键、精确类型、
  未知键策略、版本号高于认识时只读不写。
  三个文件各自独立、共用小工具只抄不引——产物之间零相对引用（文件粒度门禁要求
  每个文件 ≤350 行，单体会超标；与 src/shared/label-color 把同一段打印在两个文件各写一遍同理）。
- 文本出入口 `parseConfig(text, schema)` / `stringifyConfig(value, schema)` 住在宿主适配器
  （`src/host/configStore.js`，冻结名）：超大与别名两道守卫在此做一次、YAML 解析一次，
  再交对应单元校验。上限数字（64K 字 / 50 别名）的唯一出处就是这里。
- `tsconfig.json`：类型检查配置（严格模式，不产出）。
- 本目录里的 `.js` 全部是 `src/` 下源码转译出来的产物（`.ts` 与 `.js` 同名并排，由仓库根的
  构建 `node scripts/build.mjs` 生成）。构建每次都会核对这棵目录：产物追溯不到源码、
  或者源码没有产物，都会当场报错。

## 给第二家的三条保证（与其它核同一套）

1. 输出目标定死保守版本（ES2020），Node 宿主与浏览器闭包两边都跑得动。
2. 核心里不碰任何 Node 或浏览器专属能力，跑腿全在适配器。
3. 类型只用标准写法，不依赖特殊编译选项。

第二家用自己的工具链直接吃 TS 源码，我们的编译只服务 deck。

## YAML 解析库

- 读用 `yaml` 包（仓库 `package.json` 与发布包 `package/package.json` 的生产依赖，
  版本对齐），解析时钉死 `core` 模式（YAML 1.2 核心规则）与别名上限。
- 写不依赖解析库：按模板逐行拼，纯量保守转义（拿不准的一律双引号），
  所以写出来的注释位置与键顺序永远稳定。
- 为什么读与写不对称：读要包容（老 JSON、手工改过的空白与顺序），写要稳定
  （同一份值每次写出来逐字一致，注释永远在字段前面）。

## 常用命令

- `node scripts/build.mjs`：日常只用这一条。它先给每个域跑类型检查与转译，再拼客户端、复制宿主。
  单跑这一条就够，不需要再单独跑某个域的脚本——域脚本已经收成构建内部的一步（#1023）。
- `node tests/verify-config-store-core.js`：纯函数行为的单元门禁（往返、严格类型、
  未知键、超大文件、别名炸弹、版本只读不写、老格式兼容）。
- `node tests/verify-config-store-comments.js`：写出来的每个字段前面都有定义的注释。
- `node tests/verify-config-store-migration.js`：新老并存时以新为准、老文件迁移与删除。
- `node tests/verify-config-store-package.js`：发布包里能真正解析 YAML。
- 产物不再提交进 git（`.gitignore` 精确到各域目录），所以克隆下来先跑一次构建，产物才会出现。

## deck 侧落点

- 产物四个：`src/shared/config-store/ports.js`（空壳，只有模块标识）、
  `workspace.js` / `settings.js` / `labels.js`（三份 schema 各自的校验与拼装）。
  
- 宿主侧直接相对 import 产物，例如
  `import { parseWorkspace } from '../shared/config-store/workspace.js'`。
  这是宿主调共享的跨层方向，同层互引门禁不管这一方向。
  文本出入口（`parseConfig` / `stringifyConfig`）住宿主适配器，
  `yaml` 包也只在适配器里用，产物里没有任何引用（连裸包都没有）。
- 共享层自己不调核：`src/shared` 内部文件之间不许互相引用（同层互引门禁），
  所以 `workspace-file.js` 那份老实现保持原样不动，等 #1003 把调用方切到
  宿主适配器（`src/host/configStore.js`，调核的唯一入口）之后再退役。
- 客户端半边不直接调核：客户端经宿主电话读写设置，不拼进闭包。
- 后端房间（标签配色那间）要换格式时同样调核，不各写一份解析。

## 日志点

核心是纯函数，自己不打任何日志：没有跨模块边界的调用、没有缓存、没有定时活、
没有读写的动作，照 `docs/design/335-logging-contract.md` 第 3 章的判定，一条日志点
都不落在这里。迁移遗留（新老并存时以新为准）那一条由调用方用已有事件记，
事实经适配器的回执字段（`from` / `legacyPresent` / `warnings`）带出来，
不新增日志事件（日志附录与日志门禁是单写者文件，本票不动）。
