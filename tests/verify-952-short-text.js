// tests/verify-952-short-text.js —— #952 短等待文字与轻效果门禁（948 图第三批）
// 用法：在插件根目录执行 node tests/verify-952-short-text.js，可独立运行。
//
// 只留行为断言：把共享映射 src/shared/feedback-map.js 加载起来，按「短等待 / 中等代价 /
// 宽按钮」问一次，看它给出的备用过程是不是圆点与呼吸这两条。
//
// 原来那一整批「读源码文本、断言某个字符串在不在」的检查已删：断言对象是手写源码文件的
// 文本，等价重构（换写法、搬文件、改注释）就会误报，留不住真问题。
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok, msg, detail) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg + (ok ? '' : (detail ? ' — ' + String(detail).slice(0, 300) : ''))); if (!ok) failed = true }

async function main() {
  console.log('948 第三批门禁：短等待文字与轻效果（#952，只留行为断言）')
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/shared/feedback-map.js')).href)

  const altOf = mod.feedbackComboOf({ wait: 'short', cost: 'medium', shape: 'wide-button' })
  check(Array.isArray(altOf.alt) && altOf.alt.indexOf('dots') !== -1 && altOf.alt.indexOf('breath') !== -1, '映射给出短等待的备用过程（dots/breath）')

  if (failed) { console.log('\n存在失败（共 ' + total + ' 项）'); process.exit(1) }
  console.log('\n全部通过 · 948 第三批门禁（#952，共 ' + total + ' 项）')
}

main().catch((e) => { console.error('门禁执行失败', e); process.exit(1) })
