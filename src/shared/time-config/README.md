# time-config 域（票 #1215 立）

全仓时间参数的落点：超时、节拍间隔、一次性延时、有效期、退避序列。
（第一轮只收 TypeScript，第二轮按用户要求把存量 JavaScript 与界面半边一并收了进来。）

## 三个东西的关系

1. `config/` 下的三份 YAML——人改的唯一地方。想调时间只改这里：
   - `config/timeouts.yaml`：单次等待的上限，到点没回来就按失败或放弃处理；
   - `config/intervals.yaml`：节拍间隔、一次性延时，末尾还有退避序列（`chainBackoffMs`）；
   - `config/ttl.yaml`：有效期，一份数据或一次判断过多久算过期。
2. `scripts/generate-time-config.mjs`——生成器。它按 KEYS 表第三列的分组决定每个键住哪份
   YAML：校验（未知键报错、拼错提示、缺键告警、同名键只能出现在一份文件里）后写出
   `src/shared/time-config/src/values.ts`。
3. `src/shared/time-config/src/values.ts`——生成的源码，签入版本库。调用方 import 它的命名常量；
   `TIME_YAML` 记录 YAML 里写了哪些，`TIME_FALLBACKS` 是缺键时的回落底座。

## 约束（违反就判红）

- 人手不改 `src/shared/time-config/src/values.ts`，改了会被 `generate-time-config.mjs --check`
与 `tests/verify-time-config.ts` 两处同时发现。
- 本域是纯数据，没有运行时逻辑：YAML 缺键时调用方拿到的就是生成时落盘的值，
`timeValue` 只是按同样的规则读一遍，不做网络、不读文件、不记日志。
- 谁可以 import 本域：只允许同层计算核之间的引用（房间禁令的例外见
`src/tracker/rooms/README.md`）。同层共享域之间不许互相 import——共享域内部
（例如 `src/shared/refresh/budget.ts`）的时间常量保留在自己文件里，门禁只断言
它们的值与 YAML 一致，不搬家。
- 界面半边（`src/client/**`）与两个被整份拼进界面闭包的共享文件
（`src/shared/tracker/sync.js`、`src/shared/naming-tracking.js`）**不能 import 本域**：
闭包里出现 import 语句就是语法错误。它们的数字留在原处，由 `tests/verify-time-config.ts`
锁在 YAML 值上；界面真正要用的中央常量走构建拼接，名单见 `scripts/build.mjs` 的
`CLIENT_TIME_NAMES`，门禁的 CLIENT 表与那份名单双向对账。
