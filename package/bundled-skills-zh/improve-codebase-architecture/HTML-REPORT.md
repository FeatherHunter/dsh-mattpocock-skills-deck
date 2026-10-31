# HTML 报告格式

架构评审渲染成一个自包含的 HTML 文件，放在操作系统的临时目录里。Tailwind 和 Mermaid 都来自 CDN。Mermaid 能可靠地画出图状示意图；手工搭建的 div 与内联 SVG 负责更偏杂志编辑感的视觉（体量图、剖面图）。两者混着用：不要什么都依赖 Mermaid，否则整体会开始显得千篇一律。

## 骨架

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review for {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      /* small custom layer for things Tailwind doesn't cover cleanly:
         dashed seam lines, hand-drawn-feeling arrow heads, etc. */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## 页头

仓库名、日期，以及一段紧凑的图例：实线框 = 模块，虚线 = 接缝，红色箭头 = 泄漏，粗深色框 = 深模块。不要引言段落，直接进入候选方案。

## 候选卡片

示意图挑大梁。文字要少、要平实，并且不加铺垫地直接使用 `/codebase-design` 技能里的词汇表术语。

每个候选方案是一个 `<article>`：

- **标题**：简短，点出这次要加深什么（例如「把 Order 录入流水线折叠起来」）。
- **徽标行**：推荐强度（`Strong` = 翠绿，`Worth exploring` = 琥珀，`Speculative` = 石板灰），再加上一个依赖分类的标签（`in-process`、`local-substitutable`、`ports & adapters`、`mock`）。
- **文件**：等宽字体列表，`font-mono text-sm`。
- **前／后示意图**：整张卡片的重头戏。两栏并排。模式见下文。
- **问题**：一句话。疼在哪里。
- **方案**：一句话。改什么。
- **收益点**：几条要点，每条不超过 6 个词。例如「测试只打一个接口」「定价逻辑不再往外漏」「删掉 4 个浅包装层」。
- **ADR 提示框**（如适用）：一行字，放在琥珀色底色的框里。

不要成段的解释。如果一张示意图必须配一段话才看得懂，就重画这张图。

## 示意图模式

给每个候选方案挑一种合适的模式。混着用。不要让每张示意图都长得一样，多样性本身就是目的的一部分。

### Mermaid 图（依赖与调用流的主力）

当要说明的点是「X 调用 Y，Y 调用 Z，看看这一团乱」时，用 Mermaid 的 `flowchart` 或 `graph`。把它包进一张 Tailwind 样式的卡片里，免得它看起来像是硬塞进来的。用 classDef 把泄漏边染成红色、把深模块染成深色。时序图很适合表达「改造前：6 次往返；改造后：1 次」。

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### 手工搭建的方框与箭头（当 Mermaid 的布局与你作对时）

模块用带边框和标签的 `<div>` 表示。箭头用内联 SVG 的 `<line>` 或 `<path>` 元素，绝对定位在一个相对定位的容器上。当你希望「改造后」的示意图看起来像一个边框粗厚、内部灰显的深模块时，就用这一招，因为 Mermaid 画不出这种恰当的分量感。

### 剖面图（适合层层浅模块的场面）

把横向色带叠起来（`h-12 border-l-4`），展示一次调用穿过哪些层。改造前：6 条薄层，每条都不干实事。改造后：1 条厚带，标上合并后的职责。

### 体量图（适合「接口和实现一样宽」的场面）

每个模块画两个矩形：一个表示接口的表面积，一个表示实现。改造前：接口矩形几乎和实现矩形一样高（浅）。改造后：接口矩形很矮，实现矩形很高（深）。

### 调用图折叠

改造前：一座函数调用树，画成层层嵌套的方框。改造后：同一棵树折叠成一个方框，如今变成内部调用的那些调用在框里淡显。

## 样式指引

- 偏杂志编辑风格，不要企业仪表盘。留白要足。标题可选衬线体（`font-serif` 配 stone/slate 色系效果不错）。
- 用色要省：一个强调色（翠绿或靛蓝），加上红色表示泄漏、琥珀色表示警告。
- 示意图高度保持约 320px，好让「前／后」并排时不用滚动就能舒服地看完。
- 示意图里的模块标签用 `text-xs uppercase tracking-wider`，让它们读起来像示意图，而不是界面。
- 全篇唯一的脚本是 Tailwind CDN 和 Mermaid 的 ESM 导入。除此之外报告是静态的：没有应用代码，除了 Mermaid 自身的渲染之外没有任何交互。

## 首选推荐一节

一张更大的卡片。候选方案的名字、一句说明为什么选它的话、指向它那张卡片的锚点链接。就这样。

## 语气

平实、简洁，但架构名词和动词直接来自 `/codebase-design` 技能。简洁不是跑偏的借口。

**严格使用：**模块、接口、实现、深度、深、浅、接缝、适配器、杠杆、局部性。

**绝不替换成：**组件、服务、单元（代替模块）· API、签名（代替接口）· 边界（代替接缝）· 层、包装层（说的是模块的时候，不要用它们代替模块）。

**符合这种文风的说法：**

- 「Order 录入模块是浅的：接口几乎和实现一样大。」
- 「定价逻辑越过接缝往外漏。」
- 「加深：一个接口，一处可测的地方。」
- 「两个适配器让这条接缝站得住脚：生产用 HTTP，测试用内存实现。」

**收益点**用词汇表的术语点明收益：*「局部性：缺陷集中在一个模块里」*、*「杠杆：一个接口，N 个调用点」*、*「接口变窄；实现吸收掉包装层」*。不要写*「更容易维护」*或*「代码更干净」*，因为这些词不在词汇表里，也站不住脚。

不要模棱两可，不要写铺垫开场，不要「值得注意的是……」。一句话能写成要点，就写成要点。一个要点可以删，就删掉。如果一个词不在 `/codebase-design` 的词汇表里，先去找一个在表里的词，不要自己发明。
