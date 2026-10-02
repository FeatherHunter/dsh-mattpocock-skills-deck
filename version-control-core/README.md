# 版本控制核心（version-control-core）

插件内置的 TypeScript 能力：第一版只读状态视图的全部 git 知识——命令口径、输出解析、
状态组装、判定规则。形态照仓库里已有的三份先例（`update-core/`、`label-color-core/`、
`refresh-core/`）：源码放在仓库根这个独立目录里，编译产物逐文件落进
`src/shared/version-control/` 并提交进 git，**不发 npm 包**、不进 pnpm workspace、
不建 `packages/<名字>/`（决策记录见 `docs/adr/20260913-builtin-ts-shape.md`）。

地图票是 `#810`，实现票是 `#816`，权威输入是规格单 `#821`（只读视图）与 `#822`
（本核心），模块清单在讨论票 `#813` 结论区（文件级映射只在那一处，不在此重复）。

## 里面有什么

- `src/ports.ts`：插口形状（只放形状）+ 模块标识 `PORTS_SOURCE`。转译后是空壳，
  没有任何运行时代码引用它，门禁读它一次。
- `src/capabilities.ts`：版本能力判定。只用 2.11 与 2.31 两条有官方依据的版本线；
  低于 2.11 直说请升级；2.11–2.30 降级（锁标记未知）；2.31 及以上完整。
- `src/commands.ts`：固定前缀、六个命令描述子、采集项清单（`COLLECTION_KEYS`，
  新鲜度门禁从构建清单读，不手抄）、运行中标记五个路径名、第 0 步（确认是不是仓库，
  不进采集清单）。写命令的参数口径不在这一批，读写同表，将来加行即可。
- `src/parse-status.ts` / `parse-worktrees.ts` / `parse-refs.ts` / `parse-log.ts` /
  `src/parse-diff-files.ts` / `src/parse-patch.ts`：六组输出解析。记录行严格校验，
  对不上显式失败（返回值，不是抛异常）；只有 `#` 头部行按官方说法忽略；
  形状严格，顺序与重复宽容。`%(worktreepath)` 与 `branch --show-current`
  不用（查不到可靠出处）：当前工作树用分支名比对，不比较路径。
- `src/state.ts`：首屏组装 + 显示判据（最短唯一后缀、中段折叠、提交时间相对与绝对写法）
  + 第 0 步分类。首屏三块同一次读取、成败一起，不做每块各自降级。
- `src/rules.ts`：四个写操作（暂存/提交/拉取/推送）的能不能开始。单一入口
  `judge(状态, 操作)`，结果三态（能做/能做但要提醒/现在做会出错），理由是稳定标识符，
  话术在客户端词表；只判断能不能开始，不判断做成没做成。

## 三条结构纪律（照 ADR §2.2）

1. **先写形状再写实现**：先定 `ports.ts`，再写实现文件。
2. **纯逻辑不碰磁盘与网络**：核心里没有读文件、起进程、联网的代码；取数与落盘在宿主侧。
3. **按能力分目录、按能力命名文件**：十一个行为文件零运行时互相引用，
   跨文件类型全走 `import type`（转译后零相对引用，同层互引门禁天然能过）。

## 哪些东西不写进 TypeScript（照 ADR §2.7）

- **取数与落盘**：宿主 git 适配器（`subprocess` 服务）、`wf.*` 电话（归 `#817`）。
- **日志埋点**：核心是纯函数，自己不打任何日志（判定见下）。
- **视图渲染与词条文案**：`src/client/` 与词表（归 `#818`）。
- **换行符归一化**：`core.autocrlf` 的事实带进模型（宿主取），归一化不做。
- **逐词差异、二进制内容、分块折叠、远端分支列表**：明确不做（规格 `#822`）。

## 日志点

核心是纯函数，自己不打任何日志：没有跨模块边界的调用、没有缓存、没有定时活、
没有读写动作，照 `docs/design/335-logging-contract.md` 第 3 章的判定，
一条日志点都不落在这里。宿主侧每次外部命令落一行日志（`argv0`、`cwdHash`、
`latencyMs`、`exitCode`、`via`），那是 `#817` 的活；动手前先跑通
`tests/verify-log-*` 相关检查。

## 字符串假设（给 #817）

核心收到的输出是 UTF-8 解码后的文本（调研实测 git 在 Windows 上输出 UTF-8，
路径与错误信息皆是）。若 DSH 进程服务不是按 UTF-8 解码，端口必须改回字节、
核心自己解码——`ports.ts` 头注释已写明，这是 `#817` 开工前置调查。

## 样本与测试

- `fixtures/clean-repo.json`：本机实采（干净工作树，`live:true`，含版本号与采集日期）。
- `fixtures/dirty-rename-chinese.json`：手写（`live:false`，中文路径、空格、重命名双字段、
  冲突 `u` 记录、二进制 numstat、重命名顺序反转，形状按官方文档与调研实测）。
- `fixtures/edge-cases.json`：手写边界（游离头指针、零提交、上游被删、旧版无锁标记、
  新版锁标记、空历史、单文件补丁、截断半截）。
- 旧版本行为样本按官方文档手写并写死 `live:false` 声明，不冒充实采。
- 重录脚本保留手工跑（本 README 上面那条 `node --input-type=module` 实采命令），不进门禁链。
- 好测试只测外部行为：给定样本文本，断言数据模型或判定结果。每道门禁带一条反证
  （把被守的东西改坏，门禁必须当场变红）。

## 常用命令

- `node scripts/build.mjs`：日常只用这一条（先类型检查与转译本目录，再拼客户端、复制宿主）。
- `node version-control-core/build.mjs`：只做本目录的类型检查与转译。
- `node tests/verify-version-control-freshness.js` / `-parsers.js` / `-rules.js`：三道门禁。

## deck 侧落点

- 产物十一个：`src/shared/version-control/*.js`，全部提交进 git。
- 宿主侧与界面侧用普通相对 import 取用；本票**没有**把任何产物拼进客户端闭包，
  `SHARED_SPLICE` 一条不加，`verify-kernel.js` 的 `SOURCES` 不加，
  后端房间导入白名单不用动（还没人引用它，接线那一票加）。
