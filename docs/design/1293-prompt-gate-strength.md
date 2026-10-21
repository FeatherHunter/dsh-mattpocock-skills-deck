# 提示词门禁判定强度对照表（#1293）

> **2026-10-21 修订**：`ghAuthLogin` 那条旧模板已从 `config/prompts/repository-alignment.yaml` 删除 —— 用户可见的登录指引只由 GitHub 后端自己声明，YAML 那份在全部路径上被遮蔽（详见 `docs/architecture/kernel-contract.md` 的「提示词文本」一节）。本表随之改数：注册表 27 条、受保护 id 44 条、`MUST_JUDGE` 6 条、豁免表 7 条、`TOOL_SECTION_ABSENT_IDS` 7 条；豁免表与门禁自身的自锁摘要已重算（payload 夹具没动）。

## 这张表是干什么的

提示词的真源从「TypeScript 源码里的字面量」搬到 `config/prompts/` 下的 YAML 之后（#1292），
门禁里有一批规则是专门盯源码排版的（一条一行、六个字段顺序、引号写法、`ENTRY_RE` 单行正则……）。
这些规则在 YAML 世界里没有对应物，本票把它们退场；但「判定强度不许降」——旧门禁抓得到的每一类
违规，新门禁都得有判据抓住，抓不住的就算强度降了。

这张表逐类列出：旧门禁靠什么抓 → 现在靠什么抓 → 结论。表里出现的判据都在
`tests/verify-prompts.ts`，除了两处明确标注的（`scripts/generate-prompt-config.mts --check` 与
`tests/verify-prompt-config.ts`）。

## 一、旧门禁抓得到的违规类型 → 现在的判据

### 1. 真源本身坏掉（读不出来 / 少条目 / 多条目）

| # | 人会怎么改坏 | 旧判据（#1292 之前） | 现在的判据 | 强度结论 |
|---|---|---|---|---|
| 1 | 真源语法坏掉，求值/解析失败 | `evalRegistrySource` 当场求值，抛错判红 | YAML 解析失败判红（`parseRegistryYamlText`）；字段坏掉由生成器 `validatePromptData` 判红，且 `--check` 挂在 `npm run typecheck` 最前面，比门禁更早红 | 不降（更早） |
| 2 | 条目被藏起来 / 少一条 | 运行时审计 `auditRegistryShape` + 条目数 28 | 条目数硬编码 27（`EXPECT_REGISTRY_ENTRIES`）+ YAML 文本顶层键与解析 id 双向一致（多一条少一条都红） | 不降 |
| 3 | 条目多一条 | 条目数 28 + 受保护清单逐条比 | 同上（双向一致会把多出来的点名）+ 受保护 id 清单 44 条原样保留 | 不降 |
| 4 | 用 JS 写法藏东西（`defineProperty` / `setPrototypeOf` / `__proto__` / 污染 `Object.prototype` / getter / 不可枚举属性 / Symbol 键） | `auditRegistryShape` 的源码正则 + 运行时检查 | **不再适用**：注册表现在是 YAML 解析出来的普通对象，没有 JS 求值面，这些写法构造不出来。条目数 + 双向一致兜住「藏」 | 不再适用（不是强度降） |
| 5 | 用 YAML 锚点 / 别名把内容藏起来再别处引用 | `yamlHidingShape`（把五份 YAML 拼成一段交给 `parseDocument`，遇到多文档会抛错、被 `catch` 吞掉 —— 完整模式下这条判据其实一直空转） | `promptYamlHidingHits` **逐份** YAML 走语法树判；语法树读不出来也判红，不许因为「读不出」就静默跳过 | 更强（旧判据在完整模式失效） |
| 6 | 条目被拆行 / 改字段顺序 / 混用引号 / 一行一条的排版被改 | `ENTRY_RE` 单行正则 + `parseRegistryByRegex`，再用「正则解析条数 = 求值解析条数」跨门禁比对 | **退场**：这是源码排版规则，YAML 没有对应物。它原本要防的「正则静默少扫」在 YAML 侧换成更直接的两条：生成器 `validatePromptData` 的字段形状校验 + 门禁「YAML 文本顶层键 / 解析 id / 产物条目数」三处对账 | 不再适用（不是强度降） |
| 7 | 字段缺一个（version / placeholders / use / zh / en） | 逐条断言 | 原样保留（`contractChecksInner` 判 version 与 use；zh/en 与其他语言改由第 4c 节逐语言判） | 不降 |
| 8 | 正文与声明的占位符对不上 | 结构契约只判 **zh** 一条正文（en 的占位符对不上看不到） | 第 4c 节按语言清单**逐语言**双向判：正文用了没声明的、声明了正文没用的，都红 | 更强 |

### 2. 换行契约（旧 `tests/verify-prompt-newlines.ts` 整条退场，判据搬进第 4c 节）

| # | 人会怎么改坏 | 旧判据 | 现在的判据（`checkNoLiteralBackslashN`） | 强度结论 |
|---|---|---|---|---|
| 9 | 五份 YAML 的正文里出现字面 `\n`（反斜杠 + n 两个字符） | 扫真源正文（#1292 后已读 YAML） | 扫 YAML 解析后的**每种语言**模板正文 + 三处片段正文；扫到的段数不足（少于 27 × 语言数 + 8）判红 | 不降 |
| 10 | 两份客户端产物（`client.js` / `package/lib/client.js`）正文出现字面 `\n` | 扫产物模板与片段 | 同左；产物比真源旧（条数不是 27）或认不出数据区都判红 | 不降 |
| 11 | `src/host/**` 的 `*_PROMPT` 常量出现字面 `\n` | 旧门禁自己的正则扫 | 扫 `collectHost(EXEMPT).consts`（与 S4 同一取源，少一份正则） | 不降 |
| 12 | `src/tracker/rooms/**` 的 zh/en 字面量出现字面 `\n` | 旧门禁同名正则 | 同口径：只判本来就要换行的 zh/en 字面量 | 不降 |
| 13 | 想加白名单放行几条 | 空清单 + 条数与内容指纹钉死 | `ALLOWED_LITERAL_BSN=[]`、`EXPECT_ALLOWED_COUNT=0`、指纹 `e3b0c44298fc1c14` 原样接过来 | 不降 |
| 14 | 产物缺失 / 认不出，静默当通过 | 「取不到数据不许当通过」 | 门禁里产物缺失、数据区认不出、片段表取不到，全部判红（不是 `OK 跳过`） | 更强 |

### 3. 保留不变（本票一条没减）

- R1–R8 判定（裸跟踪器命令、间接写法、脚本引用、`tracker` 宽口径等）与 `judge` / `judgeRendered` 原样。
- 硬编码契约常量原样：注册表 27 条、三后端键数 8 / 6 / 4 与字面量数 50 / 12 / 7、host 常量数 1、
  豁免表 7 条、`PROTECTED` 44 条、`MUST_JUDGE` 6 条、`RULE_EXEMPT_EXPECTED`、`V_MIN` 版本底线、
  已删条目复活判红、`RETRO_REMIND_IDS` 17 条、`TOOL_SECTION_IDS` 20 条 / `TOOL_SECTION_ABSENT_IDS` 7 条、
  `BODY_IDS` 12 条。
- 八个扫描面（S1–S8）原样；豁免表 `tests/prompt-gate-exempt.json` 仍是唯一一张，`kind=rule` / `kind=scope` 语义不变。
- L1 夹具自证（绕过 67 条全红 / 误报 26 条全绿）、L3 扫描面完整性、自注册断言原样。
- 自锁表三份摘要（豁免表 / payload 夹具 / 门禁自身）原样保留，本票改了门禁自身，摘要同步重算。

### 4. 新增（票面 #1293 的四条断言）

| # | 断言 | 判据要点 |
|---|---|---|
| 15 | use 不进客户端产物（`checkUseNotInProduct`） | 生成物 `src/client/kernel/prompt-data.ts` 与两份产物：提示词数据区里没有 `use` 成员；整份文本里找不到任何一条 use 原文；条目数必须是 27（解析面不许静默少扫）。`use` 是给读 YAML 的人看的「这条模板什么时候用」，不进客户端闭包 |
| 16 | 正文不许有字面 `\n`（`checkNoLiteralBackslashN`） | 见上面第 2 组：五份 YAML、两份产物、host、rooms 四个面，扫描段数与白名单指纹双钉 |
| 17 | 每种语言都必须有正文（`checkEveryLanguageHasBody`） | 语言清单从 `config/languages.yaml` 读（今天 zh / en），逐语言判 27 条模板 + 三处片段；不再写死 zh/en，加第三门语言时这条自动要求它也有正文 |
| 18 | 占位符与正文逐语言一一对应（`checkPlaceholderParityPerLanguage`） | 每条模板 × 每门语言：正文用了没声明的、声明了正文没用的，都红 |

后两条（17、18）在单文件模式（L2 机械注入的探针）里也跑；前两条（15、16）只在完整模式跑。

### 5. 夹具、自锁与归属

- `tests/prompt-gate-payloads.json`（14 条机械注入样本）与 `tests/prompt-gate-exempt.json` 真实存在，
  仍是自锁表登记的两份，摘要没变：`c661ccd0…`（豁免表）/ `0d5a71da…`（payload 夹具）。
- 门禁自身摘要重算为 `4503e349c062fd62b6d58322e75535b376ec2eadb6bf33cca27039f7142835d8`。
- L2 机械注入仍是「改内存里的注册表对象 → 写临时探针 YAML 文件」；#1293 加了一条自检：
  跑完前后对五份 YAML + `config/languages.yaml` 取摘要，必须一字不差（注入只许改内存、写临时目录）。
- `tests/gate-map.json` 已重跑：`tests/verify-prompts.ts` 的归属里含 `config/prompts` 与
  `config/languages.yaml`，链上 296 步；`src/` 覆盖率 524/524。

## 二、本票实际验收过的坏样本

四个样本都在本地造过、确认变红、再从备份还原（还原后 `generate --check` 与门禁都恢复全绿）。

1. **缺一门语言**：把一份 YAML 里某条模板的 `en` 正文改名。
   `node scripts/generate-prompt-config.mts --check` 立刻红：
   `FAIL YAML 校验失败（生成前必须修好）：map-advancement/mapExecute.en 必须是非空字符串 …`
   —— 这条挂在 `npm run typecheck` 第一步，属于「typecheck 早期报红」。
2. **占位符对不上**：把正文里的 `{url}` 改成 `{uri}`。
   同一条命令红：`map-advancement/complete 在 zh 里占位符 {url} 声明了但未用`
   / `{uri} 用了但未声明`。
3. **use 漏进客户端产物**：往生成物 `src/client/kernel/prompt-data.ts` 追加一条 use 原文。
   `node --import ./scripts/ts-hook.mts tests/verify-prompts.ts` 红：
   `#1293 src/client/kernel/prompt-data.ts 里不含 YAML 里 use 的原文（漏出去的有：mapExecute）`。
4. **正文里塞裸 `\n`**：在一份 YAML 正文里写进字面 `\n`（反斜杠 + n）。
   同一道门禁红（共 3 条），其中：
   `#1293 config/prompts/（五份模板族 YAML） complete.zh 含字面 \n 1 处（换行必须写单层转义…）`。

## 三、怎么跑

```bash
# 提示词契约门禁（本表所有判据都在这里）
node --import ./scripts/ts-hook.mts tests/verify-prompts.ts

# 生成物与 YAML 的一致性门禁（use 不进产物、占位符、语言正文也在这里各有一道）
node --import ./scripts/ts-hook.mts tests/verify-prompt-config.ts

# 改过 config/ 之后：先看生成器怎么说，再重跑归属表
node scripts/generate-prompt-config.mts --check
node scripts/gate-map.mts
```

整链（含本门禁）：`npm run verify`。

## 四、一句话总结

退场的只有两类规则：**源码排版**（`ENTRY_RE` 等）与**JS 求值面形状**（`auditRegistryShape`）；
它们原本抓的「少扫、藏条目、坏字段」改由更直接的对账判据接住。换行契约整条搬进第 4c 节，
扫描面一处不少、白名单仍然钉死为空。新增四条直接针对 YAML 化产物的断言。
**没有一条质量判据消失，其中换行契约与语言完备性比旧门禁更严。**
