# 交接：dsh-log 包里写死的事件名单，把「常驻信息」事件在真机上丢掉了

**写这份文档的日期**：2026-10-14
**写的人**：在 `FeatherHunter/dsh-plugin-dsh-mattpocock-skills-deck`（下面简称「插件仓」）里做 #1052 那一票的 agent
**要交给谁**：dsh-log 的开发者（仓库地址 https://github.com/FeatherHunter/dsh-log）
**一句话**：dsh-log 包里有一张**写死的 43 条事件名单**，它决定「信息级事件要不要落盘」。插件仓最近新增的四个「常驻信息」事件不在那张名单里，于是它们在真机上**根本不落盘**，而插件仓自己的三道日志门禁全绿、谁也没发现。

---

## 一、现象：四个「常驻信息」事件在真机上一条都看不到

插件仓有一份事件总账 `research/489-appendix.md`（第 1.4 节是「常驻」表，第 1.5 节是「按需」表）。按这份总账，下面四个事件属于**常驻、信息级**，意思是「平时就落盘，不用打开调试开关」：

| 事件名 | 插件仓总账里的编号与来历 | 实现里发射的级别 | 真机上会怎样 |
| --- | --- | --- | --- |
| `edge.write` | #100，2026-10-14 #1054 关系与边新增 | `info` | **被丢掉**，只有开调试开关才落盘 |
| `issue.write` | #104，2026-10-14 #1053 写路径新增 | `info` | **被丢掉** |
| `labelDefs.write` | #106，2026-10-14 #1053 增补 | `info` | **被丢掉** |
| `repo.init` | #107，2026-10-14 #1053 增补 | `info` | **被丢掉** |

这四个事件是插件仓「写路径」与「关系与边」两条链路的结论行——一趟写操作成没成、走了哪条路、改了几条，全靠它们交代。它们不落盘，等于这两条链路在真机导出包里没有结论。

## 二、根因：包内的名单表 + 判定顺序

在 `dsh-log@0.2.2` 的 `dist/store.js` 里：

- **第 148-192 行**：一张写死的名单 `const RESIDENT_EVENTS = new Set([...])`，共 **43 条**事件名（例如 `snapshot.request`、`gh.exec`、`host.call`、`git.exec`……）。
- **第 193-197 行**：判定函数

```js
function isEnabled(level, event) {
  if (level === "error" || level === "warn") return true;                  // 告警与错误：无条件放行
  if (typeof event === "string" && RESIDENT_EVENTS.has(event)) return true; // 信息级：必须在上面那张名单里
  return switchEnabled === true;                                            // 否则只认调试开关
}
```

于是规则是：**告警与错误级永远落盘；信息级只有名字在包内那 43 条名单里才落盘，否则要打开调试开关。** 插件仓自己的「常驻」定义（写在它的总账里）跟这张名单不是同一份东西——插件仓没有把它的清单传给包，包也没有从外面读清单。

## 三、怎么复现（两步，一分钟）

在插件仓根目录跑下面这段（Node 22 以上；`dsh-log` 已作为依赖装好）：

```js
// 存成 scripts/probe.mjs，然后 node scripts/probe.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostLog } from 'dsh-log/host'

const cacheDir = mkdtempSync(join(tmpdir(), 'dshlog-probe-'))
const deps = {
  fs: { mkdir: async () => {}, readText: async () => null, writeText: async () => {},
        resolve: async (rel, opts) => join((opts && opts.cwd) || cacheDir, rel) },
  timer: { timeout: (fn, ms) => setTimeout(fn, ms) },
  getCacheDir: async () => cacheDir,
  DEFAULT_CWD: cacheDir,
}
const store = createHostLog(deps, { pluginId: 'wf' }).store
for (const [level, event] of [['info','gh.exec'], ['info','issue.write'],
                              ['info','edge.write'], ['warn','read.degraded']]) {
  console.log(level, event, '→', store.isEnabled(level, event))
}
for (const [level, event] of [['info','issue.write'], ['info','edge.write']]) store.log(level, event, {})
console.log('被丢掉的条数:', store.getDroppedCount())
```

实测输出（2026-10-14，`dsh-log@0.2.2`）：

```
info gh.exec       → true     ← 在包名单里
info issue.write   → false    ← 不在名单里
info edge.write    → false    ← 不在名单里
warn read.degraded → true     ← 告警级无条件放行
被丢掉的条数: 2
```

## 四、为什么这看起来不像是有意的

三条旁证：

1. **包里的名单像是旧快照。** 那 43 条名字，在插件仓的总账里全部查得到（没有一条是插件仓不认识的），但插件仓总账里**另有 62 条**事件名不在包里——其中既有「按需（只在调试开关打开时记）」的，也有上面那四个「常驻信息」的。
2. **同一个事件名换个级别就落盘。** 实测 `warn issue.write` 判定为 `true`。也就是说这不是「事件没接线」，而是级别与名单的搭配问题。
3. **两边的文档口径不一致。** 包自己的 `INTEGRATION.md` 第 167 行讲的是「把 `event-list.template.json` 复制一份、按实际事件填 `events` 与三类计数」，第 205 行讲「每条事件四样东西：事件名、级别、允许字段、脱敏引用；增删事件必须同步改清单的 `counts`」。这读起来像是「清单是调用方提供、给检查器用的」；但**真正决定落不落盘的那张名单在 `dist/store.js` 里写死**。

   这一条我们实测过两遍，把话说准：`createHostLog(deps, { pluginId: 'wf', eventList })` **收得下** `eventList`（`resolveHostLogConfig` 在 `dist/config.js` 第 34-37 行收下它并做形状校验），但落盘判定**完全不受它影响**——传一份只含 `my.custom.event` 的清单进去建库，`store.isEnabled('info', 'my.custom.event')` 仍然是 `false`，而包内名单里的 `gh.exec` 仍然是 `true`。也就是说：**今天没有任何办法从外面让一个信息级事件落盘**，除非改包、或者把级别写成告警。

## 五、可能的处置方向（我们这边的看法，供参考，不是要求）

| 方向 | 做法 | 代价 |
| --- | --- | --- |
| A. 名单交给配置 | 落盘判定改成读调用方传进来的事件清单（`resolveHostLogConfig` 已经收 `eventList`，**但今天只做形状校验、不参与判定**，所以这一步是改判定逻辑，不是改配置项） | 要改包并发新版；调用方要把自己的清单传进来 |
| B. 只加名字 | 把插件仓那四个事件名加进包内名单 | 要改包并发新版；每加一个常驻事件都要动包，长期靠人工同步 |
| C. 我们这边改级别 | 插件仓把四个事件改成 `warn` 级 | 不用动包；但「告警」这个词会被拿来装普通信息，以后没人再信告警 |
| D. 我们这边改归类 | 插件仓承认这四个本来就该是「按需」档，改总账与计数门禁 | 不用动包；代价是这几条结论线平时不落盘，排查时要先让人打开调试开关 |

我们倾向 **A**（如果包愿意把闸门交给配置）或 **D**（如果包认为「信息级默认不落盘」才是对的）。**不建议 C**：把信息级内容挂到告警级下面，等于用掉告警的可信度。

## 六、需要 dsh-log 那边回答的三件

1. **那张 43 条名单是有意的设计，还是历史遗留？** 换句话说：包是否本来就打算「信息级只认包内名单」？
2. **如果是有意的，调用方新增一个常驻信息事件，正规做法是什么？** 是必须发新版加名字，还是应该把清单传给 `createHostLog`？如果是后者，接口怎么用（`eventList` 传进去之后，落盘判定会跟着变吗）？
3. **`event-list.template.json` 与 `dist/store.js` 里那张名单是什么关系？** 我们这边读文档得出的印象是「清单是调用方提供、给检查器用的」，与实测不符，想确认哪一份才是权威。

## 七、插件仓这边的现场信息（供排查）

- 插件仓：`FeatherHunter/dsh-plugin-dsh-mattpocock-skills-deck`（工作目录 `D:\dsh-plugin\dsh-mattpocock-skills-deck`）
- 依赖声明：根 `package.json` 写 `"dsh-log": "^0.2.2"`；`package/package.json`（随插件发布的那份壳）**钉死** `"dsh-log": "0.2.2"`；`scripts/build.mjs` 第 1398 行起有一条「宿主那一半与客户端那一半必须来自同一个 dsh-log 版本」的构建断言
- 实际安装版本：`0.2.2`，`node_modules/dsh-log/dist/store.js` 文件时间 2026-10-08
- 插件仓建库的调用点：`src/host/logFromPackage.js` 第 14-23 行，`createHostLog(deps, { pluginId: 'wf' })`（**没有传 `eventList`**）
- 插件仓自己的事件总账与三道门禁：`research/489-appendix.md`、`tests/verify-log-fields.js`（218 项断言）、`tests/verify-log-count.js`（136 项断言）。这三道门禁查的是「源码里发的事件与总账对不对得上」，**没有一道会去问包里的 `isEnabled`**，所以这次是「门禁全绿、真机没有」
- 相关票：插件仓 #1053（写路径）、#1054（关系与边）交付了那四个事件；#1052（读路径）在复核时发现这件事，本票自己的两条事件（`read.degraded`、`preflight.gate`）写的是 `warn` 级，所以不受影响
