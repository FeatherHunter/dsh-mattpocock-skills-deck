# 研究：宿主本地化服务的公开契约与插件词表形态（#1284）

> 对应票：#1284（界面文案这一半边要不要走数据化机制）。本文件只写从一手来源读到的事实：宿主运行时包里的本地化服务、三个第三方插件的词表源码。每条结论后面紧跟来源文件与行号。全文使用完整中文句子，只使用术语表里已有的词，或者大白话，不造新的简称。

## 1. 问题重述

这张票要定的是界面文案这一半边怎么改：词表要不要变成数据、放在哪种文件里、加一门语言要改多少代码、完整性由谁判。仓内已经有的结论来自提示词那一半边（#1278：语言清单放 config/languages.yaml，加一门语言不用改代码），但界面词表与宿主（DeepSeek Harness 桌面版）的本地化服务到底怎么打交道，仓里没有笔记记过。

这次要回答四个具体问题：

1. 宿主给插件的本地化服务是什么公开契约，插件注册词表时宿主要求什么。
2. 插件想加一门语言，在宿主侧必须做什么。
3. 词表放在哪种文件里（继续用 .ts 词典、改用 JSON、还是改用 YAML 加生成器），宿主契约是否对文件形态有要求。
4. 词表变成数据之后，漏翻的键会怎样、完整性该由哪道门禁判。

## 2. 一手来源怎么拿到的

宿主是一个打包成 asar 的应用包，路径是 `D:\DeepseekHarness\resources\app.asar`。这个格式没有现成解包工具可用，本次用文件头自己解开：文件第 12 字节起是一个 uint32，写的是文件头 JSON 字符串的长度；JSON 从偏移 16 开始；文件数据区从「16 + 这个长度」处开始。解出来的文件清单在临时目录里，一共 18309 个文件，每个记着路径、字节数与在数据区里的偏移。

宿主自己的代码住在 asar 里的 `dsh/node_modules/@deepseek-ai/**`，本次用到的是其中一个包：`dsh-client-locale`。它自带两个词表文件（`locale/en.json`、`locale/zh.json`）、一份说明（`README.md`）、一份本地化说明（`README.i18n.yaml`）、以及实现文件（`lib/index.js` 29 行、`lib/client.js` 1573 行）。

## 3. 宿主本地化服务的公开契约

以下六条都出自这个包自己公开的说明文件 `README.md`。

1. 宿主内置两种语言：中文和英文。用户的选择立刻生效，并作为 `locale.preference` 持久化在 `$DSH_HOME/cordis.patch.yml` 里（由宿主设置服务写入）；新开的浏览器先用浏览器请求的语言，等宿主读回已存的选择再替换。来源是 `README.md:12`、`README.md:34`、`README.md:88`。
2. 插件用 `ctx.locale.register(ns, { zh, en })` 注册一个命名空间的词表，命名空间要并进 `LocaleNamespaceMap`；编译器按这个命名空间的键联合类型逐键检查，并要求两种内置语言都齐全。消费者通过 `ctx.locale.bind(ns)` 或框架注入的 `t` 拿翻译函数。页面挂载之后再注册也能被认到，不用重新挂载。来源是 `README.md:38`。
3. 包清单里的文案（已装插件的标题与说明这类）用 `ctx.locale.resolveText(text)`；普通字符串原样返回，翻译表用小写语言 id，必须有 en 回退，且不查命名空间词表。来源是 `README.md:42`。
4. 插件加一门语言的做法是两步：先用 `ctx.locale.addLanguage({ id, label, fallback })` 把它加进可选语言清单，再用按语言注册的形式 `ctx.locale.register(ns, 'ja', {...})` 交上那份语言的词表；按语言注册的形式让每个语言包各自独立地注册自己的命名空间。来源是 `README.md:53`、`README.md:57`、`README.md:94`。
5. 外部语言 id 必须是非空的 ASCII BCP 47 风格标签；它的回退语言必须已经注册过，整条回退链必须终止在 en；未知目标、重复 id、循环都会在注册时失败。查一个键时，先沿当前语言的回退链在请求的命名空间里找，再沿同一条链在 common 命名空间里找，都找不到就把键名本身显示出来。来源是 `README.md:66`、`README.md:94`。
6. 宿主对产品自有的客户端文案有要求：文案必须通过这些带类型的词表进来，或者通过已经是本地化过的属性进来；宿主有一道叫 `verify-client-ui-i18n` 的门禁管这件事。这道门禁只对宿主自己的产品代码生效，插件代码不在它的管辖范围内，而且门禁本体没有随运行时一起发布（本次在 asar 里搜这个名字，0 命中）。来源是 `README.md:84`。

## 4. 实现里的硬约束与报错原文

以下来自宿主包的实现文件，用来确认上面那些说明在代码里确实成立。

1. 宿主自带的语言 id 就是两个：`const LOCALE_IDS = ["zh", "en"]`。语言 id 的合法形状是 `/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u`。持久化偏好用的字段是 `locale.preference`，放在名为 `locale` 的设置命名空间里。来源是 `lib/index.js:11`、`lib/index.js:9`、`lib/index.js:28`、`lib/index.js:13`。
2. 客户端这一侧里，缺省语言是 `const FALLBACK_LOCALE = "en"`，共享文案命名空间是 `const COMMON_NS = "common"`，设置项所在命名空间是 `const SETTINGS_NS = "settings.locale"`。来源是 `lib/client.js:1135`、`lib/client.js:1137`、`lib/client.js:1139`。
3. 同一个命名空间里同一种语言注册两次会抛错，原文是 `locale namespace "${ns}" already has locale "${locale}"`；`addLanguage` 里语言 id 重复会抛 `locale "${candidate.id}" is already registered`；回退语言没注册会抛 `locale fallback "${candidate.fallback}" is not registered`；回退链走不到 en 会抛 `locale "${current.id}" fallback chain does not reach "en"`；回退链成环会抛 `locale fallback cycle includes "${current.id}"`。来源是 `lib/client.js:1395`、`lib/client.js:1300`、`lib/client.js:1302`、`lib/client.js:1362`、`lib/client.js:1357`。
4. `addLanguage` 的入参要过一遍检查：id 要符合 BCP 47 风格，标签不能为空（`locale label must not be empty`），回退 id 要符合同样形状（`locale fallback "${input.fallback}" is not a BCP 47-style tag`）。来源是 `lib/client.js:1159`、`lib/client.js:1160`。
5. 宿主自己的做法是：先把 common 命名空间的中英两份注册上，再把设置项命名空间的中文注册上。来源是 `lib/client.js:1518`、`lib/client.js:1522`。
6. 查键顺序在实现里也是这样：当前语言的回退链 → common 命名空间 → 直接显示键名。来源是 `lib/client.js:1178-1180`、`lib/client.js:1368-1379`。

## 5. 三个第三方插件的词表形态（样本）

样本来自本机插件目录 `C:\Users\辰辰洋洋\.dsh\profiles\desktop\node_modules\`，都是别人写的代码，可以当作「别人实际怎么用宿主契约」的证据。

1. `@linxin666/dsh-client-ui-git-graph`：词表写在一个 TypeScript 文件 `src/client/locales.ts`（139 行）。中文那一份是键集真源，末尾写 `satisfies Record<string, string>`；接着 `export type GitGraphKey = keyof typeof zh`；英文那一份写成 `satisfies Record<GitGraphKey, string>`，所以英文必须覆盖中文的每一个键，少一个键编译就过不去。注册用的是对象形式 `ctx.locale.register(NS, { zh, en })`。来源是 `src/client/locales.ts:4`、`:68`、`:71`、`:74`、`:138`，以及 `src/client/index.ts:130`。
2. `dshmarket`：同样是 TypeScript 词典，键集真源是中文那一份，`export type MarketKey = keyof typeof zh`，英文那一份显式写成 `Record<MarketKey, string>`；注册用对象形式 `ctx.locale.register(NS, { zh, en })`。来源是 `src/client/locales.ts:3`、`:765`、`:767`，以及 `src/client/index.ts:157`。
3. `dsh-usage-statistics-panel`：**有三门语言**（中文、英文、繁体中文）。三份词表都在 `src/client/locales.tsx` 里，中文那一份的类型是手写的键联合 `export type UsageStatsKey = ...`；注册用的是按语言注册的形式，三行分别是 `ctx.locale.register(LOCALE_NS, 'zh', zh)`、`'en'`、`'zh-TW'`。来源是 `src/client/locales.tsx:12`、`:77`、`:143`、`:209`，以及 `src/client/index.tsx:154-156`。
4. 需要说明的边界：第三个插件的代码里没有找到 `addLanguage` 的调用。也就是说，它把第三门语言的词表注册进去了，但那门语言会不会出现在设置页的语言选择器里，从这三个样本看不出来——宿主说明里明确说「把语言加进可选项」用的是 `addLanguage`（`README.md:53`）。这一点不要当成结论，只当成样本的一个缺口。

## 6. 结论清单（对本票的影响）

1. **宿主契约对「词表存在哪种文件里」没有要求，它要求的是注册时的形状。** 宿主只关心插件注册时交上来的是「命名空间 + 键值对」，以及带类型的对象形式能不能给出键联合类型（`README.md:38`）。所以 YAML、JSON、.ts 词典在宿主这一层都合法；差别在插件自己的代码里：宿主那套逐键的编译期检查，靠的是注册时那个带类型的对象（`lib/client.js` 里由命名空间的键联合类型决定），不是靠文件后缀。
2. **「加一门语言不用改代码」在宿主侧要成立，插件必须由自己的语言清单驱动注册。** 宿主要求插件显式做两件事：把新语言加进可选清单（`addLanguage`），再交上那门语言的词表（按语言注册的形式）（`README.md:53`、`:57`、`:66`）。如果插件像今天这样把「中文、英文」写死在代码里，宿主这一侧就没有「第三门」的位置——第三门语言要先在插件的语言清单里出现，才谈得上「只改数据」。样本里第三门语言确实是按语言注册的形式交上去的（第 5 节第 3 条）。
3. **漏翻的键不会静默，会直接把键名显示在界面上。** 查键顺序的最后一步就是显示键名（`README.md:66`、`lib/client.js:1368-1379`）。所以完整性门禁仍然必要：门禁要挡的是「某门语言少一个键，界面上突然露出一串英文键名」。
4. **词表变数据之后，完整性门禁该按语言清单逐门核对。** 判据是「语言清单里有几门语言，每个键就有几份译文」，而不是数 .ts 文件里键名出现了几次。这一条与 #1278 给提示词侧定的「门禁改读 YAML」是同一条口径；本仓今天的门禁 `tests/verify-locale-completeness.ts:26` 是手写文件清单加数出现次数，键一多就数不准，而且已经漂了（少查 3 份片段、65 个键，见 #1289）。
5. **若走生成器，生成物要保住「键联合类型」。** 宿主那套逐键检查的价值来自带类型的对象形式（`README.md:38`、`README.md:94`）；生成器如果只吐出两份裸对象、不吐键联合类型，就把这层检查丢了。样本里两个插件都是手写这个类型（`GitGraphKey`、`MarketKey`），第三个插件连键联合都是手写枚举式的。
6. **宿主自己的那道门禁指望不上。** `verify-client-ui-i18n` 只管宿主产品代码，且没有随运行时发布（第 3 节第 6 条）。插件侧的完整性只能自己设门禁。
7. **运行时语言来源今天就是单一来源，这一点宿主契约进一步支持。** 宿主那边的偏好、回退、选择器只有一套（`README.md:88`、`lib/client.js:1517-1522`）；本仓界面侧也已经只问 DSH 的 locale 服务（`src/client/index.ts:122-135`）。所以「界面语言与提示词语言是同一份清单还是两份」这个问题，在宿主这一层没有分歧点。

## 7. 这次没有查到的

1. 宿主设置页里那个语言选择器的界面实现没有逐行读，只读到它写偏好、写的是 `locale.preference`（`README.md:12`、`:34`）。
2. 宿主自己的产品词表是怎么组织的没有查（宿主有 `verify-client-ui-i18n` 门禁，但门禁本体没有发布，词表组织方式也无从逐条看）。
3. 偏好写进 `$DSH_HOME/cordis.patch.yml` 的写入路径没有逐行跟，只读到说明里的这句描述。
4. 三个样本插件有没有在别处调用 `addLanguage` 只在各自包里搜过一遍，宿主设置页或别的插件替它加语言的可能性没有排除。
