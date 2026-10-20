# 界面词表门禁判定强度对照表（#1294）

## 这张表是干什么的

界面词表的真源从「`src/client/kernel/locale-*.ts` 里手写的十份字典」搬到
`config/copy/` 下的 YAML（一个词族一份），再由 `scripts/generate-locale-config.mts`
生成 `src/client/kernel/locale-data.ts` 这条派生文件之后，旧门禁
`tests/verify-locale-completeness.ts` 里有一批规则是专门盯旧源码排版的：手写的十份文件
清单、每个键在源码里出现两次的字符串计数、`import` 片段模块再查字典结构……
这些规则在 YAML 世界里没有对应物，本票把它们退场。但「判定强度不许降」——旧门禁抓得到的
每一类违规，新门禁都得有判据抓住，抓不住的就算强度降了。

这张表逐类列出：旧门禁靠什么抓 → 现在靠什么抓 → 结论。表里出现的判据都在
`tests/verify-locale-completeness.ts`（下称「完整性门禁」）与
`tests/verify-locale-config.ts`（下称「配置门禁」）里，另有两处明确标注的：
`scripts/generate-locale-config.mts --check`（挂在 `npm run typecheck` 第一步）
与 `config/languages.yaml` 的语言清单对账。

今天词表规模：`config/copy/` 下 10 个词族、每门语言 1030 条词条。语言清单里是 zh / en
两门；门禁里所有「逐语言」的判据都从 `config/languages.yaml` 读语言 id，不写死 zh / en——
加第三门语言时这些判据自动要求它也有词条。

## 一、旧门禁抓得到的违规类型 → 现在的判据

### 1. 真源本身坏掉（读不出 / 少词族 / 漏键 / 漏译）

| # | 人会怎么改坏 | 旧判据（#1294 之前） | 现在的判据 | 强度结论 |
|---|---|---|---|---|
| 1 | 词族少一份（或被藏起来） | `LOCALE_SRC_FILES` 手写清单，共九项；清单外的文件根本不看 | `readCopyConfig` 按 `config/copy/` 目录**自动发现**（完整性门禁 G 段、配置门禁 ⑥）：族数 = 目录里 YAML 份数 = 生成物里的族分段数，少一份立刻红 | 更强（#1289 的根因就是手写清单漏文件） |
| 2 | 某门语言漏一段 / 某条键漏译 | 旧清单只覆盖 panel / flow / word / labels / pages / vcwrite / skilldesc / spec 八族；**cards 与 skilldetail 两族从未进过任何清单**（旧门禁注释里记着这是历史遗漏） | `validateCopyConfig` 判语言段齐 / 越界 / 每族各语言键集合两两相等（完整性门禁 A、配置门禁 ②）；每门语言词条数 ≥ 1030 的棘轮（A 段） | 更强（覆盖从 8/10 族补到 10/10 族；旧的「>600 条」模糊规模下限一并换成 1030 棘轮） |
| 3 | 键还在但文案被清空（漏译） | 不判：旧门禁只数 `'键': '值'` 的字符串形状 | 完整性门禁 A2：同一条键在各门语言里「空 / 非空」必须一致（某门语言空、另一门有内容就红） | 更强（新增） |
| 4 | 值放错层（多包一层、写进语言段外面、写成对象/数字） | 旧 A2 段：`import` 片段模块，查字典顶层只许 `zh` / `en`、两边键集合相等（#818 值放错层的教训） | YAML 顶层语言段必须恰好是语言清单里的 id（A2、配置门禁 ②）；每条值必须是字符串（`validateCopyConfig`） | 不降（同一类「放错层」在 YAML 模型下变成「语言段不对 / 值类型不对」，都判红） |
| 5 | 同一条键的中英文占位符不一致（一条写 `{name}`、另一条写 `{名称}`） | 不判 | `validateCopyConfig` 的占位符一致性判据 + 完整性门禁 A2 段逐键比对 | 更强（新增） |
| 6 | 跨词族重复键（合并词表时后族静默覆盖前族） | 不判（旧合并器 `Object.assign` 静默覆盖） | `validateCopyConfig` 的跨族重复键判据 | 更强（新增） |
| 7 | 时间参数名写错（`{{FOO}}` 里根本没有这个参数） | 不判 | `validateCopyConfig` 的未知时间参数判据；完整性门禁 I 段再判生成物取值与 YAML 烘值后逐字相等 | 更强（新增） |
| 8 | YAML 语法坏掉、目录读不出 | 旧真源是 TS 源码，语法坏由 `tsc` / import 报错 | 读目录失败、解析失败直接判红（不静默跳过）；`--check` 会在 `npm run typecheck` 第一步红 | 不降 |

### 2. 真源搬家后的新链条：YAML → 生成物

| # | 人会怎么改坏 | 旧判据 | 现在的判据 | 强度结论 |
|---|---|---|---|---|
| 9 | 改了 YAML 忘了跑生成器 | 没有这条判据（旧真源就是源文件本身，不存在「生成」） | `node scripts/generate-locale-config.mts --check` 红；它挂在 `npm run typecheck` 第一步，比门禁更早红。配置门禁 ① 与完整性门禁 I 段再各判一次 | 新增判据（更强，不是强度降） |
| 10 | 手改生成物 / 生成物过期 | 没有这条判据 | 配置门禁 ④：生成物与「内存里按 YAML 重新渲染」的结果逐字相等；完整性门禁 I 段：生成物载入后逐语言逐键与 YAML 解析值相等（相等，不是包含） | 新增判据（更强） |
| 11 | 生成物少一段 / 分段头被改 / 键联合类型漏键 | 没有这条判据（旧片段就是独立源文件） | 配置门禁 ⑤：语言清单段、每族段头 `// ===== family: <族> (config/copy/<族>.yaml) =====`、`LocaleKey<族>` 键联合、`L_<族大写>` 常量、合并段 `LocaleKey` / `LOCALE_COPY` 逐项在位；每族段内每个键以 `'键': '值'` 文本形状出现「语言数」次 | 新增判据（更强；键联合漏一条键就是漏译的编译期红灯） |
| 12 | 生成物里某条文案值写错（错字 / 少生成一条） | 旧门禁只数出现次数，**从不比对值** | 完整性门禁 I 段 + 配置门禁 ④：逐语言逐键与 YAML 逐字相等 | 更强（旧门禁抓不到，现在抓得到） |

### 3. 保留不变（旧门禁的核心质量判据一条没减）

- **B 段 REQUIRED 键**：三十个关键键全部保留，且从「合并后的中英双语源里有一份即可」升级为
  「每门语言段都必须有」；#619 已删键 `setup.markdown.paletteNote` 复活仍判红。
- **C 段类型徽章覆盖**：取源不变（`src/tracker/contract/vocabulary.ts` 的 `ISSUE_TYPE` 与
  `src/tracker/contract/canonical-labels.ts` 的 `wayfinder:*` 值），改为逐语言判；`type.*`
  词条一个都不许少。
- **D 段双产物**：`client.js` 与 `package/lib/client.js` 里 REQUIRED 键单双引号都认，产物缺失判红——
  原样保留。
- **F 段技能描述评审**：名单仍从 `src/shared/matt-skills.ts` 的 `SKILLS` 取（不硬编码）、
  缺词条 / 孤儿键 / 各语言键集合相等 / 11 条黑名单 / 每条 ≥8 字符——全部保留；取源从旧片段
  改为 `config/copy/skilldesc.yaml`（跟着真源走，判据没动）。
- **旧 A 段「每键在源码里出现 2 次」**：按语言清单推广成「生成物里每个键出现次数 = 语言数」
  （完整性门禁 I 段），并把「键集合两两相等」放在 A 段——同一类「漏了某门语言」的错误仍会红，
  且覆盖面从八族补到十族。

### 4. 退场的判据（逐条写清为什么可接受）

- **手写 `LOCALE_SRC_FILES` 清单**：退场是因为它就是 #1289 的根因（清单漏了文件，漏检的键
  没人管）。由「按目录自动发现」取代，更强。
- **A 段「取 zh 半区再切 `act.view` 之后」的自检**：这是对旧文件排版中间产物做的自检，不判任何
  产品行为；YAML 按语言段平铺之后没有「切半区」这一步，它原本防的「zh 段被截断」由 A 段逐语言
  键集合对账 + I 段逐键取值相等取代。
- **旧合并器 `locale.js` 参与键计数**：合并器文件已经删除（合并逻辑搬进生成器的「合并词表」段）；
  它原本要防的「漏并一族 / 合并覆盖」由「跨族重复键判红 + `LOCALE_COPY` 逐语言逐键等于 YAML」
  取代，两条都红才算问题，比数出现次数更直接。
- **旧 A2 只 `import` 八份片段看结构**：不是退场，是补齐——新 A 段覆盖全部十族。
- **旧 A 段 `zhCount > 600` 的规模下限**：换成每门语言 ≥ 1030 条的棘轮（只升不降），
  比「比 600 大就行」严格；数量写在完整性门禁里，加词条时只许往上调。

### 5. 新增的判据（票面 #1294 的验收项，旧门禁没有）

| # | 断言 | 在哪 |
|---|---|---|
| 13 | 语言清单驱动注册：生成物 `LANG_CONFIG` 与 `config/languages.yaml` 逐字段相等；`src/client/index.ts` 用 `localeAdopt` 注册、`locale.ts` 按 `languageIds()` / `languageLabelOf()` 从清单算，注册处不写死 `'zh'` / `'en'`；`addLanguage` 的入参来自清单 | 配置门禁 ⑦ |
| 14 | 写死清零：`src/` 下手写 TypeScript 里 0 处 `promptLang() === 'en'` 这类语言字面量比较（#1294 之前散在 9 处；只拦这一种字面形状，不扩大到通用二元判断，`.d.ts` 与三份生成物除外） | 配置门禁 ⑧ |
| 15 | 旧片段不并存：`src/client/kernel/` 下不再有 `locale-<族>.ts`，真源只有 `config/copy/*.yaml` 一处 | 配置门禁 ⑨、完整性门禁 H 段 |
| 16 | 生成物导出契约：`LocaleLanguageEntry` / `LocaleLanguageConfig` / `LocaleLang` / `LOCALE_LANGS` / `LANG_CONFIG` / 每族 `LocaleKey<族>` 与 `L_<族>` / 合并 `LocaleKey` / `LOCALE_COPY` 都在，且形状正确 | 配置门禁 ⑤⑦ |
| 17 | 校验器自己「有牙」：在内存里造十一类坏配置（语言段缺 / 越界 / 缺键 / 多键 / 值非字符串 / 占位符不一致 / 跨族重复键 / 时间参数名错 / 空词族 / 族名不合法 / 清单 default 指向不存在的语言），断言 `validateCopyConfig` 每类都报出对应的错——校验器变哑了 ② 的绿就没有意义 | 配置门禁 ③ |
| 18 | 加一门语言的正向演练（AC ⑧ 的另一半）：在内存里加一门 `ja`（语言清单加一项 + 每族词表补一段），断言校验放行、渲染出 ja 词表；正反对照漏写某族 ja 段必须报红。证明「加语言只改 YAML，不改 .ts」 | 配置门禁 ③b |

## 二、本票实际验收过的坏样本

下面三个样本都在本地造过、确认变红、再从备份还原（还原后 `--check` 与两扇门禁都恢复全绿）。
跑法是本轮实测贴出来的原文。

1. **改了 YAML 忘跑生成器**：把 `config/copy/panel.yaml` 里 `setup.markdown.labelReqs`
   的值改掉，不跑生成器。
   `node scripts/generate-locale-config.mts --check` 立刻红：
   `FAIL 生成源码与 config/ 下的 YAML 对不上：请先跑生成器 —— node scripts/generate-locale-config.mts（重算后再提交）`；
   `npm run typecheck` 第一条同样红（退出码 1）——属于「typecheck 早期报红」。
   还原 YAML 后 `--check` 恢复 `PASS 生成源码与 config/ 下的 YAML 一致`。

2. **生成物里少一条词条**：删掉生成物 flow 族英文段的一行 `    'type.issue': 'Issue',`
   （模拟「少生成一条」）。配置门禁红五条，含：
   `FAIL 生成物与内存渲染逐字相等（同一份真源、同一份渲染；对不上说明盘上的生成物不是现在这份 YAML 的产物）`；
   完整性门禁 62/65 红：
   `FAIL 每条词条在生成物里按「语言数量」各出现一次（旧 A 判据按语言清单推广）：flow/type.issue 出现 1 次（应为 2 次）`；
   `FAIL 生成物里每条文案的取值都与 YAML 逐字相等（含 {{时间参数}} 烘值）：L_FLOW['en']['type.issue'] 与 YAML 不等`。
   从备份还原生成物后 `--check` PASS、两扇门禁恢复全绿（配置 35/35、完整性 65/65）。

3. **旧片段复活**：重新建一个 `src/client/kernel/locale-panel.ts`（哪怕只有一行占位导出）。
   完整性门禁 64/65 红：
   `FAIL 旧片段还留在树上：src/client/kernel/locale-panel.ts（真源已搬去 config/copy/，这些文件留着会让人改错地方）`。
   删掉后 65/65 全绿。

4. **加一门语言（正向演练，全程只在内存里做，不写盘）**：把真配置深拷贝一份，在
   `config/languages.yaml` 的语言清单末尾加一门 `ja`（label `{ zh: '日本語', en: 'Japanese' }`、
   fallback `['en']`），十份词族 YAML 各补一段 `ja`（内容直接复用中文，只验形状），
   调同一个 `validateCopyConfig` 与 `renderLocaleData`。结果全部按预期：
   - 校验器放行：`PASS 演练「内存里加第三门语言 ja」：校验器放行（加语言只改语言清单与词表 YAML，校验逻辑不用动）`；
   - 生成物的 `LocaleLang` 联合自动变成 `export type LocaleLang = 'zh' | 'en' | 'ja'`，`LOCALE_LANGS`
     含 `ja`，`LANG_CONFIG` 里 ja 的 label / fallback 逐字来自语言清单；
   - 每族常量和 `LOCALE_COPY` 都自动多出一份 ja，每个键的出现次数从 2 变成 3；
   - 正反对照：深拷贝后删掉某族的 ja 段，校验器按预期报 `缺语言段「ja」` —— 说明上面那些绿是真被
     校验过的，不是把判据写空了。
   整个演练跑完，盘上的 YAML 与生成物一个字都没改（配置门禁 44/44 全绿）。

   结论：**加一门语言 = 在 `config/languages.yaml` 加一行 + 十份 copy YAML 各补一段，
   生成器即产出 ja 词表，无需改任何 `.ts`。**

5. **真实写盘 E2E 演练（AC ⑧ 的端到端那半，本轮在盘上真跑过一遍、跑完还原）**：
   前面 1–4 是「坏数据 / 内存演练」，这一条是把 YAML → 生成 → 构建 → 产物串起来看真结果。
   改动前先把 `config/copy/` 十份 YAML、`config/languages.yaml` 与生成物
   `src/client/kernel/locale-data.ts` 备份到仓库外，跑完逐字还原；日志原文留在本轮执行记录里。

   - **演练 A（改一条文案，不动 `.ts`）**：把 `config/copy/panel.yaml` 里 `panel.title` 的
     中英两条值各改一处 → `node scripts/generate-locale-config.mts` → `node scripts/build.mts` →
     构建出的 `client.js` 里两条新文案都在。结论：改 YAML、重跑生成器与构建，界面文案就变。
   - **演练 B（加一门语言，不动 `.ts`）**：`config/languages.yaml` 末尾加
     `ja: { label: { zh: 日本語, en: Japanese }, fallback: [en] }`，十份 copy YAML 各补一段 `ja`
     → `node scripts/generate-locale-config.mts` 产出 `export type LocaleLang = 'zh' | 'en' | 'ja'`、
     `LOCALE_LANGS` / `LANG_CONFIG` 含 ja、十族 ja 段齐；`node scripts/build.mts` 后
     `client.js` 里出现 ja 的语言名「日本語」。结论：加一门语言只改两份 YAML，零 `.ts` 改动。
   - **还原**：从备份恢复 YAML → 重新生成 → `--check` PASS → 重新构建 → `client.js` 里没有演练痕迹，
     还原后的 `locale-data.ts` 与备份逐字一致。**仓库没有留下演练改动。**

   `--check` 的早期报红与还原后转绿，与样本 1 同一条判据（生成新鲜度），这里只是把
   「生成 + 构建 + 产物」这一段真跑通，证明演练不是纸上说明。

## 三、怎么跑

```bash
# 界面词表完整性门禁（旧判据的继承者）
node --import ./scripts/ts-hook.mts tests/verify-locale-completeness.ts

# 配置/生成物/语言清单驱动的门禁
node --import ./scripts/ts-hook.mts tests/verify-locale-config.ts

# 改过 config/copy/ 或 config/languages.yaml 之后：先看生成器怎么说
node scripts/generate-locale-config.mts --check

# 改了门禁的归属/新增门禁之后：刷新归属表
node scripts/gate-map.mts
```

整链（含本票两扇门禁）：`npm run verify`；改一个模块想先跑受影响的门禁：`npm run verify:changed`。

## 四、一句话总结

退场的只有与旧真源位置绑死的三类规则：**手写文件清单、旧源码排版形状、`import` 片段查结构**；
它们原本抓的「漏词族、漏译、值放错层」改由目录自动发现 + YAML 自校验 + 生成物逐键取值对账接住，
REQUIRED 键、类型覆盖、双产物、技能描述评审全部保留并升级为按语言清单逐门判。
**没有一条质量判据消失；覆盖率从旧门禁实际覆盖的 8/10 族补到 10/10 族，
逐键取值比对与生成新鲜度（`--check` 挂在 typecheck 最前）是本票新增的更强判据。**
