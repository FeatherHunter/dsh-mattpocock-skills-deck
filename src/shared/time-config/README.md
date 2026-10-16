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

## 生效时机与构建产物（2026-10-16 对抗式审查补）

- 这三份 YAML 只活在仓库里，**不进安装包**（`package/package.json` 的 files 白名单里没有 `config`），
  也不做运行期读取：运行期没有任何代码读它们，唯一的读者是构建期的生成器。所以调一个时间的完整动作是
  「改 YAML → 跑生成器 → 重新构建 → 重新发版」，装好插件的人在本机改不到。维护者已明确决定**不做**
  运行期可调（2026-10-16）；后来的人不要顺手加这一层，那会把「值从哪来」变成运行期问题，而本域的门禁
  全都建立在「值在构建期就定死」之上。
- 宿主与共享层 import 的 `src/shared/time-config/values.js`，以及本门禁导入的
  `src/shared/time-config/src/values.js`，都是构建产物、不入库。新克隆或刚清理过产物时，
  先跑一次 `node scripts/build.mjs` 再单跑门禁；门禁遇到缺产物会直说「生成物不在」，
  不再抛看不懂的 `Cannot find module`。
- 某个值越过 JavaScript 定时器能表达的上限（`2147483647` 毫秒，约 24.8 天）时，生成器会发一句
  告警：只有做大小比较（有效期、窗口）才安全，直接当延时会变成 1 毫秒。
