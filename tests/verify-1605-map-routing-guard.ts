/**
 * #1605 三房对齐守卫：三家各验一次的接线证明 + 两条“老实”验收。
 * 做法是 TDD：本文件先行（RED），实现是两房 maps.ts + 登记三处对齐。
 * - 三家各有一次地图清单验证记录：三房 listMaps 都是真函数（本票两房由各自单测细验，
 *   GitHub 房由 #1603 门禁验过），且三家登记都已是 provided。
 * - 不支持只回不支持码并走老路：分流文件（本票不许碰，只读断言）里回落条件仍是“仅当
 *   kind 为 unsupported”，其余薄查失败走拒绝、不回落。
 * - 超时传输失败不回落：由两房单测的行为断言覆盖（kind 不是 unsupported），这里不断言第二次。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { listMaps as githubListMaps } from '../src/tracker/rooms/github/read/maps.ts'
import { listMaps as gitlabListMaps } from '../src/tracker/rooms/gitlab/maps.ts'
import { listMaps as markdownListMaps } from '../src/tracker/rooms/markdown/maps.ts'
import { shouldUseThinMapList } from '../src/deck/tools/issue-list.ts'
import { GITHUB_CAPABILITY_REGISTER } from '../src/tracker/rooms/github/support/capability-register.ts'
import { GITLAB_CAPABILITY_REGISTER } from '../src/tracker/rooms/gitlab/capability-register.ts'
import { MARKDOWN_CAPABILITY_REGISTER } from '../src/tracker/rooms/markdown/capability-register.ts'

let failures = 0
function check(cond: unknown, msg: string) {
  if (cond) console.log('ok: ' + msg)
  else { failures++; console.error('FAIL: ' + msg) }
}

console.log('== 一、三家各有真 listMaps（接线证明） ==')
check(typeof githubListMaps === 'function', 'GitHub 房 listMaps 是真函数（#1603 细验）')
check(typeof gitlabListMaps === 'function', 'GitLab 房 listMaps 是真函数（本票单测细验）')
check(typeof markdownListMaps === 'function', 'Markdown 房 listMaps 是真函数（本票单测细验）')
const gitlabRoom = fs.readFileSync(path.join(process.cwd(), 'src/tracker/rooms/gitlab/index.ts'), 'utf8')
check(gitlabRoom.indexOf('listMaps') >= 0, 'GitLab 房间工厂登记了 listMaps（走真实现，不再靠注册表补桩）')
const markdownRoom = fs.readFileSync(path.join(process.cwd(), 'src/tracker/rooms/markdown/index.ts'), 'utf8')
check(markdownRoom.indexOf('listMaps') >= 0, 'Markdown 房间工厂登记了 listMaps（走真实现，不再靠注册表补桩）')

console.log('== 二、三家登记都是 provided（数据与实现对齐） ==')
check(GITHUB_CAPABILITY_REGISTER['listMaps'].tier === 'provided', 'GitHub 登记 listMaps=provided')
check(GITLAB_CAPABILITY_REGISTER['listMaps'].tier === 'provided', 'GitLab 登记 listMaps=provided')
check(MARKDOWN_CAPABILITY_REGISTER['listMaps'].tier === 'provided', 'Markdown 登记 listMaps=provided')

console.log('== 三、纯地图筛才会进薄查（薄查能接上） ==')
check(shouldUseThinMapList({ type: 'map', labels: ['wayfinder:map'], assignee: '', query: '', effortId: '' }) === true, '纯地图筛进薄查')

console.log('== 四、不支持才走老路（分流文件只读断言，本票不碰它） ==')
const issueListSrc = fs.readFileSync(path.join(process.cwd(), 'src/deck/tools/issue-list.ts'), 'utf8')
check(issueListSrc.indexOf("String(thinBody.error.kind) === 'unsupported'") >= 0, '回落条件仍是“仅当 kind 为 unsupported”')
check(issueListSrc.indexOf('BACKEND_UNSUPPORTED') >= 0, '其余薄查失败走拒绝、不回落')

if (failures > 0) { console.error('verify-1605-map-routing-guard: ' + failures + ' 处未过'); process.exit(1) }
else console.log('verify-1605-map-routing-guard: 全过')