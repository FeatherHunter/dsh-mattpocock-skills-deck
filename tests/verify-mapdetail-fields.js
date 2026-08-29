// verify-mapdetail-fields.js — MapDetail 正文区块字段防守回归（点击 Map 行进详情页）
// 背景：GitHub 后端切到编排器（composeSnapshot）后，map 正文五区块
// （Destination / Notes / Decisions so far / Not yet specified / Out of scope）不再解析，
// MapDetail 直接读 m.decisions.length 等抛 Cannot read properties of undefined (reading 'length')。
// 双防守：①组装层（tracker/snapshot.js）恒填 EMPTY 数组/字符串；②客户端（MapDetail.js）按缺失兜底。
// 运行：node tests/verify-mapdetail-fields.js
const fs = require('fs')
let failed = false
const check = (ok, msg) => { console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed = true }
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch (e) { return '' } }

const detailSrc = read('src/client/views/MapDetail.js')
const detailCli = read('client.js')
const detailPkg = read('package/lib/client.js')
const snapSrc = read('src/host/tracker/snapshot.js')
const snapPkg = read('package/lib/tracker/snapshot.js')
const parserShared = read('package/shared/parser.js')

// —— 客户端：缺失字段按空数组兜底，绝不直读 undefined.length ——
check(detailSrc.includes('Array.isArray(m.decisions) ? m.decisions : []'), 'src/MapDetail decisions 兜底')
check(detailSrc.includes('Array.isArray(m.fog) ? m.fog : []'), 'src/MapDetail fog 兜底')
check(detailSrc.includes('Array.isArray(m.outOfScope) ? m.outOfScope : []'), 'src/MapDetail outOfScope 兜底')
check(!/m\.decisions\.length/.test(detailSrc) && !/m\.fog\.length/.test(detailSrc) && !/m\.outOfScope\.length/.test(detailSrc), 'src/MapDetail 无 m.xxx.length 直读')
check(!/m\.decisions\.map/.test(detailSrc) && !/m\.fog\.map/.test(detailSrc) && !/m\.outOfScope\.map/.test(detailSrc), 'src/MapDetail 无 m.xxx.map 直读')

// —— 组装层：快照组装恒填五区块（所有后端统一）——
check(snapSrc.includes("import { parseMapBody } from '../../shared/parser.js'"), 'src/tracker/snapshot import parseMapBody')
check(snapSrc.includes('decisions: bp.decisions') && snapSrc.includes('fog: bp.fog') && snapSrc.includes('outOfScope: bp.outOfScope') && snapSrc.includes('destination: bp.destination'), 'src/tracker/snapshot map 五区块补齐')

// —— 双产物同步（一源两物）——
check(detailCli.includes('Array.isArray(m.decisions)'), '构建产物 client.js 含防守')
check(detailPkg.includes('Array.isArray(m.decisions)'), '构建产物 package/lib/client.js 含防守')
check(!/m\.decisions\.length/.test(detailCli) && !/m\.decisions\.length/.test(detailPkg), '构建产物无 m.decisions.length 直读')
check(snapPkg.includes('decisions: bp.decisions') && snapPkg.includes('parseMapBody'), '构建产物 package/lib/tracker/snapshot.js 含补齐')
check(parserShared.includes('export function parseMapBody'), '构建产物 package/shared/parser.js 提供 parseMapBody')
const hostSrc = read('src/host/index.js')
check(hostSrc.includes('cacheFormat === 3') && hostSrc.includes('cacheFormat: 3'), 'src/host 磁盘缓存格式已升至 3（旧快照视为陈旧）')
const hostPkg = read('package/lib/index.js')
check(hostPkg.includes('cacheFormat === 3') && hostPkg.includes('cacheFormat: 3'), '构建产物 package/lib/index.js 缓存格式已升至 3')

if (failed) { console.log('\n存在失败'); process.exit(1) }
console.log('\n全部通过')
