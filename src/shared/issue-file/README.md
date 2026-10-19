# issue-file：票面文件里的对象类型标记

这个共享模块只有一件事：读和写票面文件头里那行「这张票是哪一种对象」的隐藏注释。口径来自
`docs/adr/20261020-object-kind-identification.md`（#1275 定版），本地 Markdown 后端怎么用它见
`docs/design/1277-md-spec-container.md`。

标记长这样，独占一行，写在文件头——幂等锚之后、一级标题之前：

```
<!-- DSH-ISSUE-KIND: spec -->
```

九个合法值：`map`、`spec`、`ticket`、`research`、`prototype`、`grilling`、`task`、`bug`、`issue`。
为什么要靠一行注释而不是标签：规格（spec）与实施票（ticket）约定不带 wayfinder 标签，标签分不出它们；
正文形状只作兜底，判不出时不猜。这行注释在 Markdown 后端与 GitHub 后端的正文里都能原样带回，是唯一
够用的槽位。

谁在读同一份实现：

- `src/tracker/rooms/markdown/parse.ts`：读票时认出规格；
- `src/tracker/rooms/markdown/issues-create.ts` 与 `patch-body.ts`：建票写入、整份替换时搬回；
- `src/host/tracker/snapshotAssemble.ts`：快照组装层的视图兜底（类型没标对、但票面有标记的行）；
- `src/deck/tools/issue-create.ts` 与 `issue-list.ts`：工具写标记与按类型过滤。

约定三条，改代码时不要破：

1. **只认整行**：去首尾空白后精确等于 `<!-- DSH-ISSUE-KIND: <合法值> -->` 才算；正文里引用了同样的
   写法（比如是在讲解标记长什么样）不算。
2. **文件头**：只认第一个一级标题之前（没有一级标题时只看前 10 行），和本地房读 `parentKey`、`created`
   的口径一致；正文里出现的同样一行不算。
3. **纯计算**：不读盘、不读钟、不联网；合法值表只在这里写一份。
4. **判定也只有一份**：`countMarkerLines`（数整行标记）、`isHeaderOnlyKind`（是不是 spec/ticket）、
   `isSpecHeaderMarked`（文件头是不是 spec）都从这里出去。房间、宿主组装层、deck 工具遇到同类判断时
   先看这里有没有现成函数，不要各写一遍 `kind === 'spec' || kind === 'ticket'` 或者再拼一条标记正则。

目录约定与其它共享域一致：源码在 `src/` 下、构建时按 `scripts/lib/transpile-domains.mts` 转译，
目录本身不发 npm 包。
