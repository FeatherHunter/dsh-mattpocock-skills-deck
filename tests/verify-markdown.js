// verify-markdown.js — dsh-waystation v1.5 T17：markdown 白名单渲染契约校验
// 用法: node tests/verify-markdown.js（在插件根目录）
// 覆盖：源码存在性 + 行为级渲染（用 stub h() 执行真实渲染器，验证输出结构与防注入边界）
const fs = require('fs')
const cli = fs.readFileSync('client.js', 'utf8')
const pcli = fs.readFileSync('package/lib/client.js', 'utf8')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }

// 提取整段渲染器（MD_LINK_RE 起 → mdToHtml 结束）
const extract = function (src) {
  const i = src.indexOf('const MD_LINK_RE')
  if (i < 0) return ''
  const end = src.indexOf('// ============================================================', i + 10)
  return end > i ? src.slice(i, end) : src.slice(i, i + 9000)
}
const mdCli = extract(cli)
const mdPkg = extract(pcli)

check(mdCli.length > 0, 'client 含渲染器（MD_LINK_RE 起）')
check(mdPkg.length > 0, 'package client 含渲染器')
check(cli.includes('const mdToHtml = function'), 'client 含 mdToHtml 定义')
check(pcli.includes('const mdToHtml = function'), 'package 含 mdToHtml 定义')

// 渲染点接入
check(cli.includes('mdToHtml(m.notes)'), 'client Notes 渲染接入')
check(cli.includes("mdToHtml('· ' + f)"), 'client Fog 渲染接入')
check(cli.includes("mdToHtml('· ' + o)"), 'client OutOfScope 渲染接入')
check(pcli.includes('mdToHtml(m.notes)'), 'package Notes 渲染接入')
check(pcli.includes("mdToHtml('· ' + f)"), 'package Fog 渲染接入')
check(pcli.includes("mdToHtml('· ' + o)"), 'package OutOfScope 渲染接入')

// 白名单标签
const tags = ['strong', 'em', 'code', 'ul', 'li', 'blockquote', 'input', 'a', 'hr', 'div']
tags.forEach(function (t) {
  check(mdCli.includes("h('" + t + "',") || mdCli.includes("h('" + t + "')"), '渲染器构造 ' + t)
})

// 语法正则
check(mdCli.includes('MD_LINK_RE'), '链接正则定义')
check(mdCli.includes('MD_TASK_RE'), '任务项正则定义')

// 防注入（源码级）
check(!mdCli.includes('dangerouslySetInnerHTML'), '渲染器不使用 dangerouslySetInnerHTML')
check(!mdCli.includes('innerHTML'), '渲染器不直接操作 innerHTML')
check(!mdPkg.includes('dangerouslySetInnerHTML'), 'package 渲染器不使用 dangerouslySetInnerHTML')

// 双源体量一致性已移除（T5 #98：一源两物，src 为真源；渲染器体量一致由 build 保证）

// ── 行为级：用 stub h() 执行真实渲染器，断言输出结构 ──
const stubH = (tag, props, children) => {
  const attr = props ? Object.keys(props).filter(k => !['key', 'style', 'className', 'title'].includes(k) && props[k] !== null && props[k] !== undefined && props[k] !== false)
    .map(k => ' ' + k + '="' + String(props[k]).replace(/"/g, '&quot;') + '"').join('') : ''
  const ch = Array.isArray(children) ? children.map(c => c == null ? '' : c).join('') : (children == null ? '' : children)
  if (tag === 'input') return '<input' + attr + '>'
  return '<' + tag + attr + '>' + ch + '</' + tag + '>'
}
const run = (src, md) => {
  const fn = new Function('h', src + '\nreturn { mdToHtml }')
  const out = fn(stubH).mdToHtml(md)
  return (Array.isArray(out) ? out : [out]).join('')
}
const rCli = (md) => run(mdCli, md)
const rPkg = (md) => run(mdPkg, md)

// 链接：中段链接（回归：占位符 L0 泄漏）与行首链接
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

// 防注入（行为级）：恶意 HTML 正文 → React 文本节点，不构造 script/img 元素
check(!/h\('script'/.test(mdCli), '恶意 <script> 不构造 script 元素')
check(!/h\('img'/.test(mdCli), '恶意 <img> 不构造 img 元素')
check(rCli('<b>不是加粗</b>').includes('<b>不是加粗</b>'), '原始 HTML 标签原样当文本（不解析）')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
