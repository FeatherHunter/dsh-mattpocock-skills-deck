// tests/verify-1596-md-eff-filter.ts —— 门禁：#1596 md目录签单选与断行显示全。
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1596-md-eff-filter.ts
//
// 背景：主列表顶部那排按工作单元过滤的选项（已定名 md目录签）之前是多选数组叠加，
// 每颗单行显示，最宽 160 像素，超出用省略号裁掉、不换行。
// 本门禁锁住修完之后的样子：一次只能选中一个，再点同一颗回到全部；
// 每颗不用省略号，长名字从字中间断开换到下一行，两截读全；术语表有 md目录签。
// 手法：读源码文本断言加纯逻辑模拟，无落盘、可并发。
//
// 门禁归属: src/client/views/ListTab.ts
// 门禁归属: GLOSSARY.md
const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '..')
let failed = false
let total = 0
const check = (ok: any, msg: string) => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const listTab = fs.readFileSync(path.join(ROOT, 'src/client/views/ListTab.ts'), 'utf8')
const gloss = fs.readFileSync(path.join(ROOT, 'GLOSSARY.md'), 'utf8')
// 1. 定名已写进术语表，且与工单标签、顶部页签区分。
check(gloss.indexOf('md目录签') >= 0, '术语表收录 md目录签')
check(gloss.indexOf('工单标签') >= 0 && gloss.indexOf('顶部页签') >= 0, '术语表区分工单标签与顶部页签')
// 2. 代码注释换成新叫法，不再用旧俚语。
check(listTab.indexOf('md目录签') >= 0, 'ListTab 注释使用 md目录签')
check(listTab.indexOf('effort 药丸') < 0, 'ListTab 不再出现 effort 药丸')
check(listTab.indexOf('effort 筛选行') < 0, 'ListTab 不再出现 effort 筛选行旧称')
// 3. 显示：断行不断丢，截取 md目录签那一段再判，避免误伤其它 chips 的省略号。
const segStart = listTab.indexOf('md目录签（仅多 effort')
const segEnd = listTab.indexOf('listFilterRowNode(h, st, colorOf', segStart)
const seg = (segStart >= 0 && segEnd > segStart) ? listTab.slice(segStart, segEnd) : ''
check(seg.length > 0, '能定位到 md目录签渲染段')
check(seg.indexOf('break-all') >= 0, '渲染段允许从字中间断开')
check(seg.indexOf('whiteSpace') >= 0 && seg.indexOf("'normal'") >= 0, '渲染段正常换行')
check(seg.indexOf('textOverflow') < 0, '渲染段不用省略号')
check(seg.indexOf('maxWidth: 160') < 0, '渲染段去掉 160 像素上限')
// 4. 选中：单选语义。
check(listTab.indexOf('st.effFilters = on ? [] : [nm]') >= 0, '切换逻辑为单选：选中一颗或回到全部')
check(listTab.indexOf('[0] === nm') >= 0, '选中判断只看第一颗，旧多选残留不显示多亮')
// 5. 纯逻辑模拟：单选行为。
function toggle(cur: any[], nm: string, on: boolean): any[] { return on ? [] : [nm] }
let cur: any[] = []
cur = toggle(cur, 'demo-章-7', false)
check(cur.length === 1 && cur[0] === 'demo-章-7', '空态点一颗选中该颗')
cur = toggle(cur, 'spec-调色板', false)
check(cur.length === 1 && cur[0] === 'spec-调色板', '已选一颗再点另一颗只剩新颗，不叠加')
cur = toggle(cur, 'spec-调色板', true)
check(cur.length === 0, '再点同一颗回到全部')
// 6. 过滤语义与下游单选寻址一致：数组最多一颗时，下游按单颗带寻址范围。
const ip = fs.readFileSync(path.join(ROOT, 'src/client/kernel/issue-pages.ts'), 'utf8')
check(ip.indexOf('effs.length === 1 ? String(effs[0])') >= 0, '下游单颗时带寻址范围，多选不带')
console.log('done ' + total + ' checks, failed=' + (failed ? 'yes' : 'no'))
if (failed) process.exit(1)
