# 随包技能中文译文

本目录是 `package/bundled-skills/` 的中文镜像：同一批技能、同样的相对路径、一一对应的 Markdown 文件。英文原文仍是唯一被程序读取的版本——代理执行技能时读的是 `package/bundled-skills/<技能>/SKILL.md`，这里的中文只供人阅读。

## 为什么放在这里

`package/bundled-skills/` 由 `scripts/sync-matt-skills.mts` 从上游 mattpocock/skills 整目录重建；上游没有中文文件，所以中文如果放在原文目录里，下一次同步就会被整个删掉。放到这个兄弟目录后，同步脚本不碰这里，译文可以长期保留。

## 内容

- 27 个技能目录，共 50 篇中文文件：每篇英文 `SKILL.md` 与附加 Markdown 都有一份同名中文版。
- `GLOSSARY.md`：所有译文共用的译名表与格式硬规则；改译文前先读它。
- 本 `README.md`：这份说明。

中文版与英文版的结构一一对应：frontmatter、标题层级、列表、代码块、行内代码、链接目标、数字都与原文对齐，只有叙述文字译成中文。代码块里的内容保持英文原样，因为它们是命令、模板或示例，改了就不能照用。

## 怎么校验

一条命令对照英文原文检查全部 50 篇：

```bash
node --import ./scripts/ts-hook.mts tests/verify-bundled-skills-zh.ts
```

只检查已经写好的篇目、缺的篇目只列出来不算失败（翻译过程中自查用）：

```bash
node --import ./scripts/ts-hook.mts tests/verify-bundled-skills-zh.ts --partial
```

门禁会检查完整性、frontmatter、标题层级、代码块、行内代码、链接与锚点、数字、中英比例、术语表里的固定译法，以及宿主读取译文的那条路径。

## 上游同步之后

同步脚本更新 `package/bundled-skills/` 后，如果上游新增、删除或改动了文件：

1. 跑一次上面的全量门禁，它会列出缺的、多的、结构不一致的篇目。
2. 新增的英文文件补一份中文版；英文内容改动过的文件，按改动逐段重译，不要让中文停留在旧版本。
3. 术语表里没有的新说法，先按 `GLOSSARY.md` 的规则处理，再补进表里。

## 维护约定

- 不翻译使用者自己仓库里的文件（`GLOSSARY.md`、`AGENTS.md` 等），只翻译随包文件。
- 不改 `package/bundled-skills/` 里的英文原文，也不改同步脚本的输入。
- 术语、格式规则与新增译法，统一记在 `GLOSSARY.md`，由维护者确认后生效。

---

这份目录随议题 [#1521](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck/issues/1521) 建立。
