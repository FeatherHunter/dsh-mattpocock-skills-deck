# time-config 域（票 #1215 立）

全仓 TypeScript 时间参数的落点：超时、节拍间隔、有效期、退避序列。

## 三个东西的关系

1. `config/timeouts.yaml`——人改的唯一地方。想调时间只改这里。
2. `scripts/generate-time-config.mjs`——生成器。校验 YAML（未知键报错、
拼错提示、缺键告警），写出下面的 values.ts。
3. `src/values.ts`——生成的源码，签入版本库。调用方 import 它的命名常量；
`TIME_YAML` 记录 YAML 里写了哪些，`TIME_FALLBACKS` 是缺键时的回落底座。

## 约束（违反就判红）

- 人手不改 `src/values.ts`，改了会被 `generate-time-config.mjs --check`
与 `tests/verify-time-config.ts` 两处同时发现。
- 本域是纯数据，没有运行时逻辑：YAML 缺键时调用方拿到的就是生成时落盘的值，
`timeValue` 只是按同样的规则读一遍，不做网络、不读文件、不记日志。
- 谁可以 import 本域：只允许同层计算核之间的引用（房间禁令的例外见
`src/tracker/rooms/README.md`）。同层共享域之间不许互相 import——共享域内部
（例如 `src/shared/refresh/budget.ts`）的时间常量保留在自己文件里，门禁只断言
它们的值与 YAML 一致，不搬家。
