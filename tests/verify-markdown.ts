// verify-markdown.ts — dsh-waystation v1.5 T17：markdown 白名单渲染契约校验
// 用法: node --import ./scripts/ts-hook.mjs tests/verify-markdown.ts（在插件根目录；2026-10-17 从 .js 转成 TypeScript：只改名与加类型标注，27 条断言一条没动，读 client.js 的相对路径与 eval-probe 的 .js 说明符都保持原样。）
// 覆盖：行为级渲染（从两份产物里原文切出渲染器，用 stub h() 执行它，验证输出结构与防注入边界）。
// 原来还有一批「源码里出现了哪些字」的存在性检查，已按维护者口径删掉。
const fs = require('fs')
// 按文本求值走共用入口，理由与用法见 tests/lib/eval-probe.js 文件头。
const { compileFn } = require('./lib/eval-probe.js')
const cli = fs.readFileSync('client.js', 'utf8')
const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
// cli / pcli 只用来给 extract() 供料：从两份产物里各切出渲染器那一段，下面按行为跑它。
let failed = false
const check = (ok: unknown, msg: string): void => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 提取整段渲染器（MD_LINK_RE 起 → mdToHtml 函数体结束）
// 终点原来靠模块之间的 `// ====` 横幅注释：横幅住在手写源码里，这些视图转成 TypeScript 之后
// （#1253）由 esbuild 产出，普通注释被剥掉，横幅没了，切片就一路吞到下游模块（TicketRow 等引用
// React 的代码），求值当场报 React is not defined。现在改成「认清 mdToHtml 的函数体到哪结束」，
// 与注释在不在无关。
const rendererEnd = function (src: string): number {
  const at = src.indexOf('const mdToHtml')
  if (at < 0) return -1
  const open = src.indexOf('{', at)
  if (open < 0) return -1
  let depth = 0
  let instr: string | null = null
  let esc = false
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (instr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === instr) instr = null
      continue
    }
    if (c === '"' || c === "'" || c === '\u0060') { instr = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return i + 1 }
  }
  return -1
}
const extract = function (src: string): string {
  const i = src.indexOf('const MD_LINK_RE')
  if (i < 0) return ''
  const end = rendererEnd(src)
  return end > i ? src.slice(i, end) : src.slice(i, i + 9000)
}
const mdCli = extract(cli)
const mdPkg = extract(pcli)

check(mdCli.length > 0, 'client 含渲染器（MD_LINK_RE 起）')
check(mdPkg.length > 0, 'package client 含渲染器')
// 切出来的这一段必须正好停在渲染器末尾：吞过头会把下游代码的标识符带进来，求值时报
// ReferenceError 却看着像渲染器坏了；这也顺手钉住了上面的终点判定没失效。
check(mdCli.length > 1000 && mdCli.length < 20000, 'client 切出的渲染器片段长度正常（' + mdCli.length + '）')
check(mdPkg.length > 1000 && mdPkg.length < 20000, 'package client 切出的渲染器片段长度正常（' + mdPkg.length + '）')

// 原来这里还有一批「读源码文本、断言里面出现了哪些字」的检查（mdToHtml 定义、三处渲染点接入、
//   白名单标签构造、四个正则与白名单函数名、源码里没有 dangerouslySetInnerHTML / innerHTML）。
//   它们断的是代码长成什么样，改写法、改注释、搬文件就变红，已按维护者口径删掉。
//   真正的关切——渲染出来的东西对不对、危险协议会不会漏——由下面行为级断言逐条跑真渲染器来管。

// 双源体量一致性已移除（T5 #98：一源两物，src 为真源；渲染器体量一致由 build 保证）

// ── 行为级：用 stub h() 执行真实渲染器，断言输出结构 ──
const stubH = (tag: string, props: any, children: any): string => {
  const attr = props ? Object.keys(props).filter(k => !['key', 'style', 'className', 'title', 'onClick'].includes(k) && props[k] !== null && props[k] !== undefined && props[k] !== false && typeof props[k] !== 'function')
    .map(k => ' ' + k + '="' + String(props[k]).replace(/"/g, '&quot;') + '"').join('') : ''
  const ch = Array.isArray(children) ? children.map(c => c == null ? '' : c).join('') : (children == null ? '' : children)
  if (tag === 'input') return '<input' + attr + '>'
  return '<' + tag + attr + '>' + ch + '</' + tag + '>'
}
const run = (src: string, md: unknown) => {
  // Tip 是图片标题跟随式悬浮用的那个提示组件，在插件里由模块闭包提供。这里按源码截出来的渲染器
  //   没有闭包环境，得跟着 h 一起当参数喂进去；缺了它，一渲染带 title/alt 的图片就 ReferenceError，
  //   下面那几条图片断言全跑不到（2026-10-12 补的桩，只补环境，不改被测代码）。
  const stubTip = (props, children) => stubH('span', { 'data-tip': (props && props.content) || '' }, children)
  const fn = compileFn(['h', 'Tip'], src + '\nreturn { mdToHtml }')
  const out = fn(stubH, stubTip).mdToHtml(md)
  return (Array.isArray(out) ? out : [out]).join('')
}
const rCli = (md) => run(mdCli, md)
const rPkg = (md) => run(mdPkg, md)

// 链接：中段链接（回归：占位符 \u0001L0\u0001 泄漏）与行首链接
check(rCli('见 [GitHub](https://github.com) 与 *斜体*').includes('<a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>'), 'client 中段链接渲染为 <a>')
check(!rCli('见 [GitHub](https://github.com) 与 *斜体*').includes('\u0001'), 'client 中段链接无占位符泄漏')
check(rPkg('见 [GitHub](https://github.com) 与 *斜体*').includes('<a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>'), 'package 中段链接渲染为 <a>')
check(!rPkg('见 [GitHub](https://github.com) 与 *斜体*').includes('\u0001'), 'package 中段链接无占位符泄漏')
check(rCli('[行首](https://a.com) 链接').includes('href="https://a.com"'), '行首链接仍正常')
check(rCli('见 [A](https://a.com) 和 [B](https://b.com) 尾部').includes('href="https://b.com"'), '一行双链接均渲染')
check(rCli('- 详见 [issue-tracker](docs/agents/issue-tracker.md)').includes('<a href="docs/agents/issue-tracker.md"'), '列表项内相对路径链接渲染')

// 危险协议白名单（javascript:/data: 等 → 降级为纯文本，不产 href）
check(!rCli('[点我](javascript:alert(1))').includes('href="javascript:'), 'client javascript: 协议不产 href')
check(!rPkg('[点我](javascript:alert(1))').includes('href="javascript:'), 'package javascript: 协议不产 href')
check(!rCli('[data](data:text/html;base64,PHNjcmlwdD4=)').includes('href="data:'), 'client data: 协议不产 href')
check(rCli('[联系](mailto:a@b.com)').includes('href="mailto:a@b.com"'), 'mailto 白名单放行')

// 加粗 / 斜体 / 行内代码 / 标题 / 列表 / 任务项 / 引用 / 分隔线
check(rCli('**加粗** *斜* `code`').includes('<strong>加粗</strong>') && rCli('**加粗** *斜* `code`').includes('<em>斜</em>') && rCli('**加粗** *斜* `code`').includes('<code>code</code>'), '加粗/斜体/行内代码')
check(rCli('## 标题').includes('标题') && rCli('## 标题').includes('<div>'), '二级标题渲染为 div 节点')
check(rCli('- 甲\n- 乙').includes('<ul><li>甲</li><li>乙</li></ul>'), '无序列表')
check(rCli('- [x] 完成\n- [ ] 未完成').includes('<input type="checkbox" checked="true" disabled="true">'), '任务项勾选态')
check(rCli('> 引用').includes('<blockquote>引用</blockquote>'), '引用块')
check(rCli('---').includes('<hr>'), '分隔线')

// 防注入（行为级）：脚本标签永不构造；图片只认安全协议，危险地址降级为文字
check(rCli('<b>不是加粗</b>').includes('<b>不是加粗</b>'), '原始 HTML 标签原样当文本（不解析）')
// 图片三写法：Markdown 写法、图片标签写法、包在链接里的写法保持跳转
check(rCli('看图 ![说明](https://github.com/user-attachments/assets/abc.png) 尾').includes('<img src="https://github.com/user-attachments/assets/abc.png"'), 'Markdown 图片写法渲染为 img')
check(rCli('<img width="90" height="70" alt="Image" src="https://github.com/user-attachments/assets/abc.png" />').includes('<img src="https://github.com/user-attachments/assets/abc.png"'), '图片标签写法渲染为 img')
check(!rCli('看图 ![说明](javascript:alert(1)) 尾').includes('<img'), '图片危险协议不产 img')
check(!rCli('<img src="javascript:alert(1)" alt="x" />').includes('<img'), '图片标签危险地址不产 img')
check(!rCli('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x" />').includes('<img'), '图片标签 data 地址不产 img')
check(rCli('[![说明](https://github.com/user-attachments/assets/a.png)](https://github.com/a)').includes('<a href="https://github.com/a"'), '包在链接里的图片保持外层跳转')
check(!rCli('看图 ![说明](https://a.png) 尾').includes('\u0001'), '图片占位符无泄漏')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
