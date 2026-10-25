# #1530 构建缓存写回过期输入指纹：核实笔记

- 调查对象：GitHub 票 #1530「构建缓存会记下生成器改写输入之前的过期指纹，导致 verify-1327 在改过配置源后的第一次构建判红」。
- 代码基线：HEAD `fc16fb28`（2026-10-26 02:28:40）。文中行号以此份源码为准。
- 范围：只读源码、缓存文件与只读探针（`.tmp-triage-1530/`，不入库）；主工作区当时有别的会话在改文件，因此**没有**跑真实构建与验证链。仓库里搜过 10-25 当时的会话记录与指纹（无命中），所以票面 16:46:58 那次的触发源无法从仓内还原。

## 三句话结论

1. **票面的机制属实**：构建开头判缓存命中时会算一次输入指纹并记忆（`scripts/build.mts:118` → `scripts/lib/build-cache.mts:148-168` 的 `memoInputFingerprint`），真构建末尾写回缓存时又直接用这份记忆值（`scripts/build.mts:155`），中间没有调用 `resetBuildCacheMemo()`；于是「构建期间输入内容变了」时，缓存里留下的是变化之前的指纹。
2. **票面举的触发例子站不住**：四个生成器写出的五份文件里，只有 `src/shared/time-config/values.d.ts` 在输入清单内（另外四份在文件头 300 字符内有派生文件标记，被 `looksDerived` 排除）；而它的内容只随 `scripts/generate-time-config.mts` 的 `KEYS` 变（键增删、数字/数组类型），不随时间参数的具体数值变。改 `config/copy/*.yaml` 只会重写清单外的 `locale-data.ts`，输入指纹不动。
3. **缺陷仍要修，但修的位置有讲究**：若照票面建议只在 `writeBuildCache` 里重算，会把「生成器之后、打包期间」别的会话写进输入目录的改动也算进指纹，可能让没吃到改动的产物被判新鲜（假绿）。宜在四个生成器跑完之后（`scripts/build.mts:1776` 之后）、域构建与打包之前，立刻 `resetBuildCacheMemo()` 并重算一次，缓存写回时用这份值。另有一个更根上的修法：给 `values.d.ts` 补上派生文件标记，让生成物一律不进输入清单（依据 `scripts/lib/build-cache.mts:71` 的注释）。

## 1. 缺陷链条（代码现状）

- `scripts/build.mts:110-141` `tryBuildCacheHit()`：只有缓存文件存在且能读出条目时才走到 `:118` 的 `inputFingerprint(ROOT, mode)`；这一调同时把指纹写进进程内记忆。缓存缺失（`:117`）时不填入记忆，所以全新检出第一次构建反而不会犯这个错。
- 判命中的两条失败路径（指纹不等、产物判据不合格）都在填入记忆之后才返回 `false`，接着走整趟真构建；`scripts/build.mts:1751-1776` 依次 spawn 四个生成器，`:1777` 起才做域构建与打包，`:2163` 调用 `writeBuildCache()`。
- `scripts/build.mts:144-161` `writeBuildCache()`：`:152-153` 特意用 `readCacheFileUncached` 重读缓存文件（注释说清楚：几十秒里别的会话可能写过缓存），但 `:155` 的输入指纹仍是开头那份记忆值。
- `scripts/lib/build-cache.mts:143-147` 的注释已经写出了同一层道理（「构建进程例外——它在开头读一次判命中，真构建几十秒后再写回，中间可能被别的会话写过缓存」），但只落到了缓存文件，没有落到输入指纹；这是本票缺陷有设计依据、却漏了一半的直接证据。
- 附注：`--force` 也会进 `buildModeKey()`（`scripts/lib/build-cache.mts:137-141`），所以强制重建写的是 `--force` 条目，不会刷新 `full` 条目；写回归门禁时要用不带参数的普通构建。

## 2. 哪些生成物是输入（只读探针实测）

只读探针统计：当前输入清单共 1237 份文件。四个生成器写出的五份文件里：

| 文件 | 在输入清单内 | 原因 |
| --- | --- | --- |
| `src/shared/time-config/values.d.ts` | **是** | 文件里没有「人手不改 / AUTO-GENERATED / DO NOT EDIT」标记 |
| `src/shared/time-config/src/values.ts` | 否 | 文件头有派生文件标记 |
| `src/client/kernel/locale-data.ts` | 否 | 同上 |
| `src/client/kernel/prompt-data.ts` | 否 | 同上 |
| `src/tracker/rooms/markdown/format/generated.ts` | 否 | 同上 |

`scripts/generate-time-config.mts:369-390` 的 `renderDts()` 函数体第一行是 `void values`：声明只按 `KEYS` 逐条生成，值类型只分「数字 / 数字数组」（`ARRAY_GROUP = 'backoff'`）。所以 `values.d.ts` 只在两种情况下变内容：键增删，或某个键从数字改成数组（或反过来）。

复制树里实测（只读核查）：改 `KEYS` 后跑生成器，生成前输入指纹 `41a06b8f…`，生成后不失效记忆仍读到 `41a06b8f…`，调过 `resetBuildCacheMemo()` 才看到 `ddc48a70…`；而纯改 `config/copy` 注释或 `config/timeouts.yaml` 的数值时，生成器改写的输入数为 0、指纹不变。

## 3. 票面例子为什么不成立，以及 16:46 那次的可能来源

- 10-25 那次合并改的是 `config/copy/skilldetail.yaml`：`config/copy` 下的改动由 `generate-locale-config.mts` 吸收，只重写 `locale-data.ts`，而它被派生标记排除在输入清单外；其余两个生成器（prompt、time）不读 `config/copy`。所以这条路径不会让输入指纹在构建中途变化。
- 当天生成器源码自 10-22 起没变过（`git log` 查过），若 `values.d.ts` 当时也在盘上且内容未变，生成器这一路就解释不了指纹差。
- 剩下两个可能：①当时 `values.d.ts` 内容确实变了（例如另一处未提交改动动了键表）；②构建进行中有别的进程/会话改了输入目录里的文件。仓内没有 10-25 16:46 的会话记录，也没有缓存历史，**无法二选一**。今天主工作区就有并发会话在改文件（写笔记时 `git status` 有十几处未提交改动，其中一个会话正在给 `scripts/generate-time-config.mts` 加键），说明②在今天不是空谈。
- 因此触发条件应表述为「**构建期间输入内容发生变化**」，不要写死成「改 `config/copy/*.yaml` 后第一次构建」；已知的典型触发至少有三类：新建/删除 time-config 键使 `values.d.ts` 在构建中途被重写、`values.d.ts` 缺失后由构建现场生成、另一会话在构建期间改输入目录。

写笔记时主工作区另一次构建（02:29–02:32）之后又有会话改了 `src/`，单跑 verify-1327 即红、症状与票面 INFO 同形——这类环境因素与缺陷红从表现上分不开。

## 4. 修复形状建议与代价

1. **根因修法：让生成物不进输入清单。** 给 `renderDts()` 的输出加一行「人手不改」标记，与另外四份生成物一致；`values.d.ts` 的内容完全由 `KEYS`（输入）与时间参数文件（输入）决定，排除它不丢信息，反而与 `looksDerived` 的设计意图一致。它随后会进入产物清单（`listOutputs` 收 `src` 下带标记的文件），由产物新鲜度判据看着。
2. **兜底修法：构建中段失效记忆。** 在四个生成器跑完之后、域构建之前 `resetBuildCacheMemo()` 并重算一次指纹（`scripts/build.mts:1776` 之后），写回时用这份值。理由：若照票面只在 `writeBuildCache` 里重算，指纹会把「生成器之后、打包期间」并发写进输入的改动也算进去，而那些改动未必进了本次产物，缓存却会把它标成新鲜（假绿）；在生成器之后重算，则之后发生的并发改动能被下一次构建识别出来，最多多构建一次，不会假绿。
3. **回归判据**：票面「改配置源 → 构建一次 → 比对缓存指纹」在今天的树上**不会红**（改配置源不改变输入），不能当回归判据。建议临时目录单测：造一棵最小输入树与缓存条目，先算一次指纹（模拟构建开头），再改写其中一个输入（模拟生成器/并发写），然后按「构建末尾写回」的路径写缓存，断写回指纹等于改写后的输入指纹；另加一条断言「产物清单与输入清单不相交」，把「生成物漏了派生标记」这类根因也锁住。

## 5. 与既有笔记的关系

`research/1312-freshness-gates-content-digest.md` 讲清了输入指纹怎么算、派生文件靠文件头 300 字符标记排除，但没讲**谁在什么时候把指纹写回缓存**——本票的缺口正是这一段；其余沾边的 `research/1311-client-bundle-reload-signal.md`（面板重载）与 `research/1014-q11-cache-qa.html`（旧 `.js` 时代的总指纹）都不回答写回时机。

## 6. 本次核实的一手来源

- `scripts/build.mts:110-141`（判命中、填记忆）、`:144-161`（写回）、`:1751-1776`（四个生成器）、`:2163`（写回调用点）。
- `scripts/lib/build-cache.mts:58-123`（输入清单与派生标记）、`:137-141`（构建档位键）、`:143-168`（记忆与失效）。
- `scripts/generate-time-config.mts:58-70`（KEYS）、`:369-390`（renderDts）。
- `tests/verify-1327-freshness-content.ts:222-239`（真树段的判定：有缓存时 `notices` 必须为空）。
- 只读探针：`.tmp-triage-1530/probe-inputs.mts`（未入库，记录输入清单与当前缓存指纹）。
