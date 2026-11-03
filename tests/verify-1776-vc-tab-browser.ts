#!/usr/bin/env node
/**
 * verify-1776-vc-tab-browser.ts —— 真实版本管理页签的真浏览器门禁（#1776 M3）
 *
 * 为什么要真浏览器：M1/M2 把版本管理页签换成了真实页面壳，但那些门禁都跑在 jsdom 或
 *   react-dom/server 里，量不出「300 宽会不会横向溢出」「按钮挤成一团还能不能点」这类布局结论。
 *   这一扇把真实入口 VersionControlTab 挂进真 Chromium，外面套假宿主（每次 host.call 都记录），
 *   按档宽与皮肤量像素、按点击路径走完十六个页面。
 *
 * 四组判据：
 *   A. 四档宽（300/380/460/520）× 深/浅两皮肤：可见 data-vc-live，其中含 data-vc-shell；
 *      根宽与 data-vc-width 档位一致；文档与全部可见后代都不横向溢出；进入时恰好一次首屏聚合读。
 *   B. 导航：四个固定页签点击切换（aria-selected 跟着变）、齿轮九个管理分区逐项进入再返回、
 *      搜索/变基/冲突三个顶栏入口可达；命令面板总命中 162 条、输入过滤行数与 vcPaletteRowsOf 一致、
 *      选中一条落到目标页并高亮。
 *   C. 300 宽下从根 ≤2 次点击到达每个固定页签/管理分区/侧页/搜索页；每页能力主入口滚进视口后可点、不报错。
 *   D. 反证：给根强加 min-width:640px 之后，同一把量尺在 300 宽必须量出横向溢出 ——
 *      量尺测不出「真的坏了」就说明它没有证据力。
 *
 * 跑法：node --import ./scripts/ts-hook.mts tests/verify-1776-vc-tab-browser.ts
 * 依赖：playwright（本机已装 headless shell）+ esbuild；截图写 .scratch/1776-tab-browser/（只给人看）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const { createServer } = require('http')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '..')
const { sourcePath } = require('./lib/source-text.ts')
const { printGateResult } = require('./lib/gate-result.ts')
const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
const SHOT_DIR = path.join(ROOT, '.scratch', '1776-tab-browser')
let total = 0
let failed = 0
const check = (ok: any, msg: string): void => { total += 1; console.log((ok ? '  PASS ' : '  FAIL ') + msg); if (!ok) failed += 1 }
// 原型在页面打开时用「当前时刻」组装演示数据；夹具也以运行时刻为基准，
// 身份行的「读取于 / 远端更新于」和提交历史的相对时间才能和原型对上（刚刚 / 12 分钟前）。
const NOW = Date.now()
const CWD = 'D:\\dsh-plugin\\dsh-mattpocock-skills-deck'
const WIDTHS = [300, 380, 460, 520]
const SKINS = ['dark', 'light']
const TAB_PAGES = ['changes', 'commits', 'worktrees', 'stash']

// ---------------- 闭包：与 scripts/build.mts / verify-818 同一份清单 ----------------
const stripExports = (s: string): string => s.replace(/^(\s*)export\s+/gm, '$1')
const stripTimeImport = (s: string): string => s.split('\n').filter((l: string) => !/^\s*import\s.*time-config\/values\.js/.test(l)).join('\n')
const sourceOf = (rel: string): string => { const js = path.join(ROOT, rel); const ts = js.replace(/\.js$/, '.ts'); return fs.readFileSync(fs.existsSync(ts) ? ts : js, 'utf8') }
const CLOSURE_FILES = (function (): string[] {
  const text = fs.readFileSync(path.join(ROOT, 'tests/verify-818-version-control-view.ts'), 'utf8')
  const block = /const VC_FILES = \[([\s\S]*?)\n\]/.exec(text)
  if (!block) throw new Error('从 verify-818 里找不到 VC_FILES 清单，闭包拼不起来')
  const list = Array.from(block[1].matchAll(/'([^']+)'/g)).map((m: any) => m[1] as string)
  ;['vcRealModel.js', 'vcRealManage.js', 'vcRealManageReads.js', 'vcRealManageActions.js', 'vcRealManageActions2.js', 'vcRealManageActions3.js', 'vcRealManageSide.js', 'vcRealShell.js', 'vcRealDelegate.js', 'vcRealActions.js', 'vcRealTab.js', 'VersionControlTab.js'].forEach((name: string) => {
    if (!list.some((p: string) => p.endsWith('/' + name))) throw new Error('verify-818 的闭包清单里缺 ' + name + '，本门禁挂不到真实入口')
  })
  return list
})()
// esbuild 0.28.2 在 Windows 上会把超过 1MB 的 transform 输入先写进系统临时目录，子进程读完再删；
// 本机删这个临时文件一律被拒（Access is denied），于是整段转译闭包会直接崩在第一条断言之前。
// 这里改成按文件逐份转译再按原顺序拼接：每份都远小于 1MB，产出的代码与整段转译相同（同样是 esm 写法、不加外壳）。
const CLOSURE_JS = CLOSURE_FILES.map((rel: string) => require('esbuild').transformSync(stripExports(stripTimeImport(sourceOf(rel))), TRANSPILE_OPTIONS).code).join('\n')

// ---------------- 首屏快照与假宿主回包 ----------------
const okSlice = (data: any): any => ({ state: 'ok', data: data, error: null })
// #1860 C 门禁夹具：与原型演示数据同一份来源。
// 50 条提交、60 棵工作树来自 docs/prototype/vc-redesign/src/data/repo.generated.ts 的真实采集（capturedCommits /
// capturedWorktrees，采集时间 2026-10-30）；11 个改动文件来自 docs/prototype/vc-redesign/src/data/screen.ts 的固定样本。
// 数据按宿主首屏七片的真实形状打包（identity/repo/branches、staged/unstaged/counts、commits/hasMore、others/bare/nul、
// stash entries、sync、version），身份行与各组计数由客户端自己从片里算；夹具只给输入，不写死任何界面文案。
const HISTORY_COMMITS: any[] = [
  { oid: "e489673f240ed18a2e71bb6de5bfc635b2fed73c", short: "e489673f", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793384302000, commitDateMs: 1793384302000, subject: "地图执行入口提示词升到 v23：补开工、推进、关 issue、收尾四节操作约束", parents: ["1901ff9b39746ad1ef143e2595425333363f8735"] },
  { oid: "1901ff9b39746ad1ef143e2595425333363f8735", short: "1901ff9b", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793377576000, commitDateMs: 1793377576000, subject: "回填规格票 #1681 到两份 ADR 与迁移计划，修正预算、探针与通知口径", parents: ["694c955ca1ec363721e8e8ea1fae551c6b519096"] },
  { oid: "694c955ca1ec363721e8e8ea1fae551c6b519096", short: "694c955c", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793377220000, commitDateMs: 1793377220000, subject: "新增 #1680 探针笔记：GitLab 工作区夹具与真机工具台缺口", parents: ["69e8ba637c12f6bc1fb8dbea2b7bb08295d70f62"] },
  { oid: "69e8ba637c12f6bc1fb8dbea2b7bb08295d70f62", short: "69e8ba63", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793374917000, commitDateMs: 1793374917000, subject: "定稿面板快照单一数据源与 GitHub 房间分层：新增两份 ADR、迁移计划与术语，并补两份调研笔记", parents: ["efb092abe0a797c821d077aba9e7d27f7b18b66e"] },
  { oid: "efb092abe0a797c821d077aba9e7d27f7b18b66e", short: "efb092ab", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793374886000, commitDateMs: 1793374886000, subject: "补记第二轮 git 边界实测：待办清单覆盖、合并说明与工作树移除", parents: ["637957e6b94aa42e391f8e6b9f50026ddbf2b480"] },
  { oid: "637957e6b94aa42e391f8e6b9f50026ddbf2b480", short: "637957e6", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793374192000, commitDateMs: 1793374192000, subject: "加入 GitLab 与 GitHub 真机差异研究笔记（#1679）", parents: ["ad540ebdff821cebab90629bee31ba3d22044dcb"] },
  { oid: "ad540ebdff821cebab90629bee31ba3d22044dcb", short: "ad540ebd", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793373923000, commitDateMs: 1793373923000, subject: "加入 GitLab 模式用户可见路径研究笔记（#1674）", parents: ["3c18b76a76d6fbfba04230f726c1755efa19210a"] },
  { oid: "3c18b76a76d6fbfba04230f726c1755efa19210a", short: "3c18b76a", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793373488000, commitDateMs: 1793373488000, subject: "补 #1593 研究笔记：九组 git 边界行为本机实测", parents: ["3ac57926414397374d86e8018d82b1501a0e6f3d"] },
  { oid: "3ac57926414397374d86e8018d82b1501a0e6f3d", short: "3ac57926", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793369634000, commitDateMs: 1793369634000, subject: "合并远端主线的最新提交，解决与 #1665、#1671 等改动的交叉（#1667）", parents: ["4bdb7aa3f808c674c32e243b7d726b110f06def7", "3a464062fb6af7d007de618c265ba6702866c2fe"] },
  { oid: "3a464062fb6af7d007de618c265ba6702866c2fe", short: "3a464062", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793357640000, commitDateMs: 1793357640000, subject: "补 #1671 分诊笔记：查明中文模板首行与第三方后端 id 读不出，给出修法与门禁方案", parents: ["b1d23bcdeaf27176ea812eb32fb9d059754e1334"] },
  { oid: "b1d23bcdeaf27176ea812eb32fb9d059754e1334", short: "b1d23bcd", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793357607000, commitDateMs: 1793357607000, subject: "重新生成发布目录里的 README：跟随上游 Star History 日期参数", parents: ["494b2526f1f798d2240d4f1ce7351de8915a3ea5"] },
  { oid: "494b2526f1f798d2240d4f1ce7351de8915a3ea5", short: "494b2526", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793357426000, commitDateMs: 1793357426000, subject: "Merge branch 'main' of https://github.com/FeatherHunter/dsh-mattpocock-skills-deck", parents: ["7eb99086706a605cf25d00993b2e267ae6a76d89", "1a87f6dce6cfb5d2c21cf5d1eaef454b7561b735"] },
  { oid: "7eb99086706a605cf25d00993b2e267ae6a76d89", short: "7eb99086", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793357386000, commitDateMs: 1793357386000, subject: "修复建议气泡在输入框撑高时脱钩状态栏、折叠态飞出屏幕（#1665）", parents: ["04e61320a1015795a8c3305da778a345f67259b5"] },
  { oid: "4bdb7aa3f808c674c32e243b7d726b110f06def7", short: "4bdb7aa3", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793355862000, commitDateMs: 1793355862000, subject: "详情页顶栏动作按钮的可点性判据补正注释并把门禁模板接到词表真源（#1667）", parents: ["989a6f074580b0b73fa0b6a4b21d74e021e23ea6"] },
  { oid: "1a87f6dce6cfb5d2c21cf5d1eaef454b7561b735", short: "1a87f6dc", author: "github-actions[bot]", email: "github-actions[bot]@users.noreply.github.com", authorDateMs: 1793350587000, commitDateMs: 1793350587000, subject: "致谢表自动更新：把新编号贡献并进来，中英两表按花数与最后活跃重排", parents: ["a79ed9cd952f72e2c1e3b426cf131622af5952bd"] },
  { oid: "a79ed9cd952f72e2c1e3b426cf131622af5952bd", short: "a79ed9cd", author: "github-actions[bot]", email: "github-actions[bot]@users.noreply.github.com", authorDateMs: 1793349513000, commitDateMs: 1793349513000, subject: "每日更新 Star History：追加拉取到的星标数据并重新生成手绘双主题图表", parents: ["04e61320a1015795a8c3305da778a345f67259b5"] },
  { oid: "989a6f074580b0b73fa0b6a4b21d74e021e23ea6", short: "989a6f07", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793345170000, commitDateMs: 1793345170000, subject: "详情页顶栏两颗按钮压灰时不再挂点击日志定位串（#1667）", parents: ["a48c4017f5afbd18fe20ade889ae9d20d4b97e0b"] },
  { oid: "a48c4017f5afbd18fe20ade889ae9d20d4b97e0b", short: "a48c4017", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793343300000, commitDateMs: 1793343300000, subject: "补一条详情加载中只剩打开快照的接线门禁用例（#1667）", parents: ["0ca0f86b104262af20322e13cab675ca43b652e8"] },
  { oid: "0ca0f86b104262af20322e13cab675ca43b652e8", short: "0ca0f86b", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793343156000, commitDateMs: 1793343156000, subject: "合并远端主线的最新提交（#1670 建议工具理由说明改为写具体依据），并重生成门禁归属表", parents: ["0de70a4a48e86cc467d11ff4ecd84a78c4ece3c3", "04e61320a1015795a8c3305da778a345f67259b5"] },
  { oid: "0de70a4a48e86cc467d11ff4ecd84a78c4ece3c3", short: "0de70a4a", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793342858000, commitDateMs: 1793342858000, subject: "详情页顶栏在票被未完成票阻塞时也置灰动作按钮（#1669）", parents: ["fd0bcc907c12a89af8bae880b7a030897dd50341"] },
  { oid: "04e61320a1015795a8c3305da778a345f67259b5", short: "04e61320", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793341965000, commitDateMs: 1793341965000, subject: "把建议工具的理由说明从两种模板改成写具体依据（#1670）", parents: ["2ddf7d24ba1fe366fc974baff9c0510c519734a4"] },
  { oid: "fd0bcc907c12a89af8bae880b7a030897dd50341", short: "fd0bcc90", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793341486000, commitDateMs: 1793341486000, subject: "合并远端主线带入 md 目录签修复（#1664），并重生成门禁归属表", parents: ["2d873580502fb3c150a49684780c98ba605186a5", "2ddf7d24ba1fe366fc974baff9c0510c519734a4"] },
  { oid: "2d873580502fb3c150a49684780c98ba605186a5", short: "2d873580", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793341085000, commitDateMs: 1793341085000, subject: "详情页顶栏在票已关闭或已合并时置灰动作按钮（#1668）", parents: ["064a4de02746e6ff8fb41a22c570c418f8f0da65"] },
  { oid: "2ddf7d24ba1fe366fc974baff9c0510c519734a4", short: "2ddf7d24", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793340701000, commitDateMs: 1793340701000, subject: "修好主列表第一排 md目录签：超 10 个折叠，全关的工作单元不再出现（#1664）", parents: ["064a4de02746e6ff8fb41a22c570c418f8f0da65"] },
  { oid: "064a4de02746e6ff8fb41a22c570c418f8f0da65", short: "064a4de0", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793339767000, commitDateMs: 1793339767000, subject: "把探索地图提示词里的 subissue 改成官方写法 sub-issue", parents: ["a03c05d1c623ac89573c4492b8fe85c73841baa7"] },
  { oid: "a03c05d1c623ac89573c4492b8fe85c73841baa7", short: "a03c05d1", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793339312000, commitDateMs: 1793339312000, subject: "给新建探索地图提示词讲清并行串行分工与收尾复查顺序", parents: ["95a5025556206db3533c8e337eba4ad8c2c4516c"] },
  { oid: "95a5025556206db3533c8e337eba4ad8c2c4516c", short: "95a50255", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793338451000, commitDateMs: 1793338451000, subject: "建议工具说明补上「等用户补充」的半句话模板分支（#1666）", parents: ["d9d1e9a99e7eba578c2ad56e50907d84997f409e"] },
  { oid: "d9d1e9a99e7eba578c2ad56e50907d84997f409e", short: "d9d1e9a9", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793338395000, commitDateMs: 1793338395000, subject: "修复 suggest 气泡层级与锚点：气泡与胶囊同层、锚点跟胶囊走（#1665）", parents: ["2684d11d827619984e5ae2ea5162c3a0f66c0195"] },
  { oid: "2684d11d827619984e5ae2ea5162c3a0f66c0195", short: "2684d11d", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793336779000, commitDateMs: 1793336779000, subject: "给新建探索地图提示词的并行串行节做措辞微调", parents: ["d480e6cb66783d8605e0aca8872709ec650c0bfa"] },
  { oid: "d480e6cb66783d8605e0aca8872709ec650c0bfa", short: "d480e6cb", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793336172000, commitDateMs: 1793336172000, subject: "给新建探索地图提示词加上并行串行设计与收尾复查要求", parents: ["b5422c40d1dabd253abde7e5dcb60cfa67adfe23"] },
  { oid: "b5422c40d1dabd253abde7e5dcb60cfa67adfe23", short: "b5422c40", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793330832000, commitDateMs: 1793330832000, subject: "把中英文 README 的锁版号从 beta.22 推进到 beta.32 并重生成发布目录说明", parents: ["2348e29b8e47ed9beed35a254f7111ffa2e32172"] },
  { oid: "2348e29b8e47ed9beed35a254f7111ffa2e32172", short: "2348e29b", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793329402000, commitDateMs: 1793329402000, subject: "写清发布失败后不重跑与证据不可变两条规则", parents: ["72db476ef9e938f1df6291f715c80b70997739c0"] },
  { oid: "72db476ef9e938f1df6291f715c80b70997739c0", short: "72db476e", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793328987000, commitDateMs: 1793328987000, subject: "补齐读票写票的三条省时规则并标记过期工作流文档（retro 落地 1/2/5）", parents: ["fac909c1aeffec3dd6907f433e4e3756c1f6087c"] },
  { oid: "fac909c1aeffec3dd6907f433e4e3756c1f6087c", short: "fac909c1", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793296886000, commitDateMs: 1793296886000, subject: "补齐 1.9.0-beta.32 发行说明，写进黄条单行与悬停提示宽度两处修复", parents: ["45f73643279963fb49b11c8abf71321f49f28991"] },
  { oid: "45f73643279963fb49b11c8abf71321f49f28991", short: "45f73643", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793291541000, commitDateMs: 1793291541000, subject: "合并 1662 门禁反证修复到主分支：D1 反证跟着黄条新形状走，门禁归属表重生成", parents: ["781001116abe55a45ba0e80d290bdf5e79df3f46", "84d7bb24a60cef15792817531f49271d0b36f8ae"] },
  { oid: "781001116abe55a45ba0e80d290bdf5e79df3f46", short: "78100111", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793291504000, commitDateMs: 1793291504000, subject: "合并 1660 悬停提示宽度口径修复到主分支：限宽与排位统一按渲染外框宽计算，门禁与 ADR 同步", parents: ["c9f64f0992bc6a1d73604882638b2c31098a2d56", "ae8f23b581dbd9927f5579f3838aa6e9c8285d47"] },
  { oid: "84d7bb24a60cef15792817531f49271d0b36f8ae", short: "84d7bb24", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793291141000, commitDateMs: 1793291141000, subject: "按黄条新形状修复 669 门禁的 D1 反证（#1662）", parents: ["c9f64f0992bc6a1d73604882638b2c31098a2d56"] },
  { oid: "ae8f23b581dbd9927f5579f3838aa6e9c8285d47", short: "ae8f23b5", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793288680000, commitDateMs: 1793288680000, subject: "修复悬停提示的宽度口径：限宽与排位统一按渲染外框宽计算（#1660）", parents: ["c9f64f0992bc6a1d73604882638b2c31098a2d56"] },
  { oid: "c9f64f0992bc6a1d73604882638b2c31098a2d56", short: "c9f64f09", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793283868000, commitDateMs: 1793283868000, subject: "新增黄条单行自适应的门禁：短句与单行不断言行为，只守形状", parents: ["d6c8adecd09e1fc3449f7a3d77d57086b8bd00a4"] },
  { oid: "d6c8adecd09e1fc3449f7a3d77d57086b8bd00a4", short: "d6c8adec", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793283484000, commitDateMs: 1793283484000, subject: "黄条改成短句单行自适应：文案压短并不换行，宽度跟着内容走", parents: ["77eae7800e0a62ae1bfa70cc6976f3627c22dbec"] },
  { oid: "77eae7800e0a62ae1bfa70cc6976f3627c22dbec", short: "77eae780", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793282451000, commitDateMs: 1793282451000, subject: "真机验证工具预置三款窗口尺寸，设完还要核对插件真的进了那一支布局（#1637）", parents: ["031712d4f54fea227089987a3ccea7ade7b24e63"] },
  { oid: "031712d4f54fea227089987a3ccea7ade7b24e63", short: "031712d4", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793275865000, commitDateMs: 1793275865000, subject: "真机验证工具：有头窗口必须真全屏，切不成就判失败", parents: ["2ce91a13495c657f12b05836070b375245e82404"] },
  { oid: "2ce91a13495c657f12b05836070b375245e82404", short: "2ce91a13", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793268948000, commitDateMs: 1793268948000, subject: "发布 1.9.0-beta.32 的发行说明：补上 beta.31 之后的界面修复与真机验证工具链", parents: ["2d78912f94b509b3ffe4cb5e4f863d761029e2d0"] },
  { oid: "2d78912f94b509b3ffe4cb5e4f863d761029e2d0", short: "2d78912f", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793268948000, commitDateMs: 1793268948000, subject: "修掉 #1649 门禁在 Windows 上通过后仍被判红的退出竞态", parents: ["e24a4d3f8f2d0dd265d6b624cedf69bf1bc45fc1"] },
  { oid: "e24a4d3f8f2d0dd265d6b624cedf69bf1bc45fc1", short: "e24a4d3f", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793266005000, commitDateMs: 1793266005000, subject: "每日更新 Star History：README 里图表日期参数推进到 2026-10-29", parents: ["1c488a192d1e8bccdcd649e04a86698cb2acad85"] },
  { oid: "1c488a192d1e8bccdcd649e04a86698cb2acad85", short: "1c488a19", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793266005000, commitDateMs: 1793266005000, subject: "补全界面词条：状态栏、面板顶栏、列表、环境检查、拉取请求、技能、地图详情、票详情、设置等页面元素都补上中文叫法与避免叫法", parents: ["ebc2d86e7d40daacbf887a7938b7044a5bea7953"] },
  { oid: "ebc2d86e7d40daacbf887a7938b7044a5bea7953", short: "ebc2d86e", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793265261000, commitDateMs: 1793265261000, subject: "词典新增悬停提示方位一条：方向四种、统一规则定、调用方不得指定（#1651 第11条）", parents: ["b86b5c3cb711ded80a78de3ea8712c02a337f44d"] },
  { oid: "b86b5c3cb711ded80a78de3ea8712c02a337f44d", short: "b86b5c3c", author: "github-actions[bot]", email: "github-actions[bot]@users.noreply.github.com", authorDateMs: 1793263955000, commitDateMs: 1793263955000, subject: "致谢表自动更新：把新编号贡献并进来，中英两表按花数与最后活跃重排", parents: ["488f7d98f7f80272df299948c940459090bfe62f"] },
  { oid: "488f7d98f7f80272df299948c940459090bfe62f", short: "488f7d98", author: "FeatherHunter", email: "975559549@qq.com", authorDateMs: 1793263703000, commitDateMs: 1793263703000, subject: "关闭与展开改走跟随确认：红色叉与展开键先冒浮层，确认才改三处，老全屏框下线（#1655，实施 #1657 #1658）", parents: ["8bb6a4ce04bf3dd1469d053cf52548953d7abc35"] },
  { oid: "8bb6a4ce04bf3dd1469d053cf52548953d7abc35", short: "8bb6a4ce", author: "github-actions[bot]", email: "github-actions[bot]@users.noreply.github.com", authorDateMs: 1793262490000, commitDateMs: 1793262490000, subject: "每日更新 Star History：追加拉取到的星标数据并重新生成手绘双主题图表", parents: ["01866dc3cae184dc9aecfbf7c22aa2b678555f9c"] },
]
const OTHER_WORKTREES: any[] = [
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/github/workspaces/list", display: "list", head: "55345eb2e26cc8004f17e28c5ac74301dd983668", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/github/workspaces/map", display: "map", head: "55345eb2e26cc8004f17e28c5ac74301dd983668", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/github/workspaces/offline", display: "offline", head: "55345eb2e26cc8004f17e28c5ac74301dd983668", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/harness-smoke/workspaces/ws-github", display: "harness-smoke/workspaces/ws-github", head: "55345eb2e26cc8004f17e28c5ac74301dd983668", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.scratch/verify-run/batches/quota/workspace", display: "workspace", head: "55345eb2e26cc8004f17e28c5ac74301dd983668", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1006-quota-cooldown", display: "1006-quota-cooldown", head: "d8f8e2d223a56bac48fa5a921b4609c25dd3e2db", branch: "ticket/1006-quota-cooldown", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1008-failure-streak", display: "1008-failure-streak", head: "6ccd0bfeda4798e3bee6c054610ea9d83d26f776", branch: "fix/1008-failure-streak", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1114-timer-cleanup", display: "1114-timer-cleanup", head: "7a21f12d82342bf572efdd301f8dc548bfdbc569", branch: "ticket/1114-timer-cleanup", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1162-live-doc-drift", display: "1162-live-doc-drift", head: "fc16fb28dee796b93100aa58607b5f1e791dff27", branch: "ticket/1162-live-doc-drift", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1171-anchor-fallback", display: "1171-anchor-fallback", head: "4f89823692a3d677ab0fc8026faf961adcdfea65", branch: "fix/1171-anchor-lookup-retry", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1218-wayfinder-closeout", display: "1218-wayfinder-closeout", head: "2a5d625a06d721b7819e05b0f57be5e871f8df23", branch: "ticket/1218-wayfinder-closeout", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1240-time-config-missed-literals", display: "1240-time-config-missed-literals", head: "b4b8adc2f1314bd833c55596e9c3badf2e1a5002", branch: "ticket/1240-time-config-missed-literals", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1243-naming-isolation", display: "1243-naming-isolation", head: "9ae5cbfc4ec29bb2acd10bd98e6918481b415a99", branch: "ticket/1243-naming-isolation", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1474-accept-main", display: "1474-accept-main", head: "c2af8858257144c1b1122e8019a39e7382ace5fc", branch: "ticket/1474-accept-main", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1474-auto-retry", display: "1474-auto-retry", head: "85591337dcec96e0f94715cfe74f003086005995", branch: "ticket/1474-auto-retry", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1474-force-sequel", display: "1474-force-sequel", head: "b2dd90fba64f66eef1b77cd68bc08f88fc90434e", branch: "ticket/1474-force-sequel", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1475-timeout-budget", display: "1475-timeout-budget", head: "617df28a49f6d9050b158eaa170a6ca135cb6815", branch: "ticket/1475-predicate-budget", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1498-unc-case", display: "1498-unc-case", head: "dce516d6b235130a7f92c9575f789687d20768fb", branch: "ticket/1498-unc-case", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1520-quoted-skill-refs", display: "1520-quoted-skill-refs", head: "5d1f76864c6dc0a600a4e8a88583ac651e02cf90", branch: "ticket/1520-quoted-skill-refs", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1521-zh-translations", display: "1521-zh-translations", head: "0f849d1b97dfdf6393f26f3ae096e2d560ca52aa", branch: "feat/1521-bundled-skills-zh", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1524-md-table", display: "1524-md-table", head: "2aabd1c010d91c243292f15634cc47e70473e76e", branch: "ticket/1524-md-table", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1526-suggest-replay-restore", display: "1526-suggest-replay-restore", head: "51590957f21c130ff17772f31ee62fb3e29402c7", branch: "ticket/1526-suggest-replay-restore", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1526-triage", display: "1526-triage", head: "459a02de266c66f8a6d4ddd27b8e2514b8d6f40a", branch: "ticket/1526-triage-note-push1", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1526-walkthrough", display: "1526-walkthrough", head: "88c22f0dbcaf3bba9353ec563d99da655f06121f", branch: "ticket/1526-walkthrough-note", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1527-quota-floor", display: "1527-quota-floor", head: "ae4d5046449d66cd7a6e5c32b2b64def133a4b3f", branch: "ticket/1527-quota-floor", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1528-scratch-list-once", display: "1528-scratch-list-once", head: "702a0797732d21c86a68dad2d298774abd933817", branch: "ticket/1528-scratch-list-once", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1533-gitlab-remote-claim", display: "1533-gitlab-remote-claim", head: "634b0fe85e6cb2858f594fa4c15a8f431ee4e8b2", branch: "fix/update-failure-settlement", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1555-session-decision", display: "1555-session-decision", head: "d153c80949bfddb7900cb59b9d4c3267226ac91b", branch: "ticket/1555-session-decision", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1567-old-map-gate", display: "1567-old-map-gate", head: "92a72fde15b5ff7c6789c0a2e691c58ba2da551b", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1603-map-thin", display: "1603-map-thin", head: "623d3341a20ccf974a8fee190bec313fed2d3ea1", branch: "ticket/1603-map-thin", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1604-pure-map-routing", display: "1604-pure-map-routing", head: "50e5e02a278cad0a084d6d430ecabe4e3bc63e76", branch: "ticket/1604-pure-map-routing", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1605-multi-backend", display: "1605-multi-backend", head: "3893edc282d5459f7b87888b3b4af26648d135bf", branch: "ticket/1605-multi-backend", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1607-gh-unc-cwd", display: "1607-gh-unc-cwd", head: "c879f999c14f7b43039a6e11ca269daf7473fb3e", branch: "ticket/1607-unc-gh-cwd", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1608-appendix-landing", display: "1608-appendix-landing", head: "59052395867102e8148078e71b48b6ae5d208df9", branch: "ticket/1608-appendix-landing", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1609-log-field-guard", display: "1609-log-field-guard", head: "19b3ca471a2e9286fe227ae6806099122cbe15c3", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1610-parallel-read", display: "1610-parallel-read", head: "af7b2eaa28aab8818cbb723315ec271115406918", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1611-fix-main-three-gates", display: "1611-fix-main-three-gates", head: "72c51418e121ce02d1024e57a70ce0e90156f51f", branch: "fix/1611-main-three-gates", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1612-cleanup", display: "1612-cleanup", head: "828bffc4848641ea42f2c74b6405896d66b66df2", branch: "ticket/1612-cleanup", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1612-deck-switches", display: "1612-deck-switches", head: "7d214665251b919b7d0ba56a95a7dbba48a804d9", branch: "ticket/1612-deck-switches", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1617-log-fields-dynamic", display: "1617-log-fields-dynamic", head: "b4bd06351b0a346fbe6d6c7fad61c8c7b6cc3b42", branch: "ticket/1617-log-field-runtime", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1620-host-log-slot", display: "1620-host-log-slot", head: "35848d1b116e56526825a954fb0a485dc45daa39", branch: "ticket/1620-host-log-slot", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1627-quota-log", display: "1627-quota-log", head: "bbe5168d552203863e2216689bdd8ffd0a856eaf", branch: "ticket/1627-quota-log", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1637-beta32-candidate", display: "1637-beta32-candidate", head: "99fb0860ebf627b59f626444f6f780bc2af122e8", branch: "verify/1637-beta32", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1637-beta32-final", display: "1637-beta32-final", head: "2ce91a13495c657f12b05836070b375245e82404", branch: "verify/1637-beta32-final", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1639-md-eff-split", display: "1639-md-eff-split", head: "7217670c046292f4e92be7601033b19111586947", branch: "ticket/1639-md-eff-split", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1643-smoke-into-parallel", display: "1643-smoke-into-parallel", head: "5deecd833ec780583439829f299e23da57604f0e", branch: "ticket/1643-smoke-into-parallel", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1646-publish-token", display: "1646-publish-token", head: "f9eb4ff00bb8f36c75dae808f148a846e2dab738", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1647-preflight-consistency", display: "1647-preflight-consistency", head: "57b5cbbdd3233bed6fd73e3570418dfd05f0691d", branch: "deliver/1647-preflight-consistency", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1648-release-integrity", display: "1648-release-integrity", head: "d94282994e198bda7a0dddfd97f492ac8fe2b836", branch: "ticket/1648-release-integrity", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1660-tip-width", display: "1660-tip-width", head: "ae8f23b581dbd9927f5579f3838aa6e9c8285d47", branch: "fix/1660-tip-width", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1662-669-d1", display: "1662-669-d1", head: "84d7bb24a60cef15792817531f49271d0b36f8ae", branch: "fix/1662-669-d1", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/1681-integ", display: "1681-integ", head: "e489673f240ed18a2e71bb6de5bfc635b2fed73c", branch: "integ/1681-panel-snapshot", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/fix-main-granularity", display: "fix-main-granularity", head: "08af050b126cef62b5a979528a70e9fe9660fcb9", branch: "fix/main-granularity", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/dsh-plugin/dsh-mattpocock-skills-deck/.worktrees/integ-final", display: "integ-final", head: "80eaa35cda6804e21a0aad91423462880e328b1e", branch: "integ/1602-map-thin-list", bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/temp/1420-main", display: "1420-main", head: "fa2a6bb15ccb40e3e43fa05ba1f3f2f4e1e64d94", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/temp/1611-main-verify", display: "1611-main-verify", head: "c02ea69568e5c742ae16a9e156d959e6ab5b8dfb", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/temp/verify-fresh-1645/batches/smoke-20261029-130911/workspaces/ws-github", display: "smoke-20261029-130911/workspaces/ws-github", head: "1428e305a00e73473ba822550ded59f94fd735f4", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/temp/verify-fresh2-1645/batches/smoke-20261029-131010/workspaces/ws-github", display: "smoke-20261029-131010/workspaces/ws-github", head: "1428e305a00e73473ba822550ded59f94fd735f4", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
  { path: "D:/temp/verify-fresh3-1645/batches/smoke-20261029-131044/workspaces/ws-github", display: "smoke-20261029-131044/workspaces/ws-github", head: "1428e305a00e73473ba822550ded59f94fd735f4", branch: null, bare: false, current: false, locked: false, lockReason: null, lockUnknown: false, prunable: false, prunableUnknown: false },
]
// 原型 ?stashdemo 演示的那一条：说明为空时叫 WIP on main，时刻就是页面打开的时刻。
const STASH_ENTRY = { selector: "stash@{0}", oid: "69e8ba637c12f6bc1fb8dbea2b7bb08295d70f62", atMs: NOW, subject: "WIP on main" }
const SNAPSHOT = {
  contract: 'version-control.first-screen', version: 2, readAtMs: NOW,
  slices: {
    workspace: okSlice({ identity: { worktreeDisplay: "dsh-mattpocock-skills-deck", worktreePath: "D:/dsh-plugin/dsh-mattpocock-skills-deck", branch: "main", detached: false, oid: "e489673f240ed18a2e71bb6de5bfc635b2fed73c", sync: "tracked-known", ahead: 2, behind: 0, basisMs: NOW - 12 * 60 * 1000 }, repo: { merging: false, rebasing: false, cherryPicking: false, reverting: false, hasCommits: true, bare: false, tier: "full", autocrlf: null }, branches: [{ short: "main", oid: "e489673f240ed18a2e71bb6de5bfc635b2fed73c", upstream: "origin/main", upstreamGone: false, ahead: 2, behind: 0, current: true }] }),
    changes: okSlice({ staged: [], unstaged: [
      { path: ".scratch/issue1518-body.md", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: ".scratch/issue1518-original-body.md", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: ".scratch/probe-spec-capsule.mjs", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: ".scratch/probe2.mjs", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: ".scratch/temp/pr-1475-body.md", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: "docs/design/md-env-check-chain.png", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: "docs/design/md-env-check-chain.svg", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: "docs/review/20261025-spec-complete-prompt-review.html", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
      { path: "src/client/views/shared/workRouteTable.ts", origPath: null, staged: false, unstaged: true, change: "modified", conflict: false, addedLines: 2, deletedLines: 2 },
      { path: "src/refresh/rooms/host/outbound-admission.ts", origPath: null, staged: false, unstaged: true, change: "modified", conflict: false, addedLines: 23, deletedLines: 1 },
      { path: "tests/verify-1545-workroute-row-nav.ts", origPath: null, staged: false, unstaged: true, change: "untracked", conflict: false, addedLines: null, deletedLines: null },
    ], stagedCount: 0, unstagedCount: 11, conflictCount: 0, lineCountsKnown: true }),
    // 原型演示数据是采集到的全部 50 条已读，没有下一批，所以 hasMore 为假。
    history: okSlice({ commits: HISTORY_COMMITS, hasMore: false }),
    worktrees: okSlice({ others: OTHER_WORKTREES, bare: false, nul: true }),
    stashes: okSlice({ entries: [STASH_ENTRY] }),
    sync: okSlice({ sync: "tracked-known", ahead: 2, behind: 0, basisMs: NOW - 12 * 60 * 1000, upstream: "origin/main", remote: "origin", branch: "main" }),
    version: okSlice({ gitVersion: "git version 2.49.0.windows.1", tier: 'full', floor: '2.11', fullCount: 162, hiddenCount: 0, degradedCount: 0, switches: [] }),
  },
}

const FIXTURES = {
  cwd: CWD,
  snapshot: SNAPSHOT,
  rebaseState: { ok: true, state: null, branch: 'main', headOid: 'abcdef1', updateRefs: false, readAtMs: NOW },
  rebaseWindow: { ok: true, base: 'main', commits: [], commitCount: 0, readAtMs: NOW },
  byPhone: {
    'wf.gitCommitForm': { ok: true, form: { branch: 'main', stagedCount: 0, hooks: [], amend: { available: true, message: '上一条提交的说明' } } },
    'wf.gitStash': { ok: true, op: 'list', atMs: NOW, entries: [STASH_ENTRY], recent: [], stderr: '' },
    'wf.gitChangesCheck': { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: {}, confirmRequired: false, ticket: { id: 'ch-ticket', checkedAtMs: NOW, expiresAtMs: NOW }, readAtMs: NOW },
    'wf.gitWorktreeCheck': { ok: true, decision: { verdict: 'allow', reasons: ['ok'] }, plan: { cmd: 'git worktree prune' }, ticket: { id: 'wt-ticket', checkedAtMs: NOW, expiresAtMs: NOW } },
    'wf.gitBranches': { ok: true, contract: 'version-control.branch-board', version: 1, readAtMs: NOW, current: { name: 'main', oid: 'abcdef1' }, branches: [{ name: 'main', current: true, remote: 'origin', upstream: 'origin/main', oid: 'abcdef1', subject: '首条提交' }, { name: 'feat/x', current: false, oid: 'abc1234' }], tags: [{ name: 'v1.0', oid: 'aaaa111', subject: '首版' }], descriptions: {} },
    'wf.gitRemoteList': { ok: true, source: 'local', readAtMs: NOW, remotes: [{ name: 'origin', fetchUrl: 'git@example.com:repo.git', pushUrl: 'git@example.com:repo.git' }] },
    'wf.gitSubmodules': { ok: true, contract: 'version-control.submodule-board', version: 1, readAtMs: NOW, rows: [{ path: 'vendor/lib', state: 'clean', initialized: true, urlDisplay: 'https://example.com/lib.git', headBranch: 'main', oid: 'abc1234' }] },
    'wf.gitConfigRead': { ok: true, readAtMs: NOW, repoRoot: CWD, gitVersion: '2.45.0', hookRunVersion: null, configPath: CWD + '/.git/config', groups: [], identity: { name: { local: '某甲', global: null }, email: { local: 'a@b.c', global: null } }, hooks: { dir: CWD + '/.git/hooks', configured: null, readable: true, entries: [], known: [] }, attr: { state: 'ok', entries: [] }, mailmap: { state: 'ok', entries: [] }, entries: [] },
    'wf.gitDiagnosticsRead': { ok: true, readAtMs: NOW, kind: 'ls-files', rows: [], files: [], text: '', truncated: false },
    'wf.gitPlatformRead': { ok: true, readAtMs: NOW, credential: { state: 'ok', helpers: [], store: '', risk: 'ok', advice: 'ok' }, updateRefs: { state: 'ok', value: 'false', enabled: false } },
    'wf.gitConflicts': { ok: true, state: 'merge', headOid: 'abcdef1', gitVersion: '2.45.0', conflicts: [], conflictCount: 0, clean: true, readAtMs: NOW },
    'wf.gitMigrateCheck': { ok: true, action: 'init', decision: { verdict: 'allow', reasons: [] }, confirmRequired: false, readAtMs: NOW },
    'wf.gitSyncCheck': { ok: true, readAtMs: NOW, capabilityId: '8.5', action: 'fetch', decision: { verdict: 'warn', reasons: [] }, confirmRequired: true, confirm: { verb: '抓取', target: 'origin' }, ticket: { id: 'sy-ticket', op: 'fetch', checkedAtMs: NOW, expiresAtMs: NOW + 120000 } },
    'wf.gitTaskQuery': { ok: true, tasks: [], running: 0 },
    'wf.gitLog': { ok: true, commits: [], hasMore: false },
    'wf.gitDiff': { ok: true, files: [], lines: [], text: '', truncated: false },
  },
}

// ---------------- 页面脚本：真 React + 真入口 + 假宿主 ----------------
function entryOf(): string {
  return [
    "import React from 'react';",
    "import * as ReactDOMClient from 'react-dom/client';",
    'window.React = React;',
    'const CLOSURE = window.__CLOSURE_JS__;',
    'const F = window.__FIXTURES__;',
    'for (const k in window.__TIME__) window[k] = window.__TIME__[k];',
    'const DICT = window.__DICT__;',
    'const tr = (k, p) => { const s = DICT[k] === undefined ? String(k) : DICT[k]; if (!p) return s; return String(s).replace(/\\{(\\w+)\\}/g, (m, name) => (p[name] === undefined || p[name] === null ? m : String(p[name]))); };',
    'const C = React.createContext(null);',
    'const Tip = (p) => (p && p.children !== undefined ? p.children : null);',
    'const Ic = () => null;',
    'const CALLS = [];',
    'const replyOf = (phone, args) => { if (phone === "wf.gitFirstScreen") return { ok: true, firstScreen: F.snapshot, readAtMs: F.snapshot.readAtMs }; if (phone === "wf.gitRebaseRead") return String((args || {}).op || "") === "rebase-window" ? F.rebaseWindow : F.rebaseState; return F.byPhone[phone] === undefined ? { ok: true } : F.byPhone[phone]; };',
    'const host = { call: (phone, args) => { CALLS.push(phone); return Promise.resolve(replyOf(phone, args)); } };',
    'const fn = new Function("React", "log", "dswsLogHash", "dswsLogTrunc", "tr", "host", "DswsCtx", "Tip", "Ic", "seedReads", CLOSURE + "\\nreturn { VersionControlTab: VersionControlTab, vcPaletteMatchOf: vcPaletteMatchOf, vcPaletteRowsOf: vcPaletteRowsOf, vcPaletteTargetOf: vcPaletteTargetOf, VC_TAB_PAGES: VC_TAB_PAGES, VC_MANAGE_PAGES: VC_MANAGE_PAGES };");',
    'const VC = fn(React, () => {}, () => "h8", (s) => String(s), tr, host, C, Tip, Ic, null);',
    'window.__VC = VC;',
    'window.__countPhone = (phone) => CALLS.filter((p) => p === phone).length;',
    'window.__errors = [];',
    'window.addEventListener("error", (e) => window.__errors.push(String(e.message)));',
    'window.__mount = function (opts) {',
    '  const pane = document.getElementById("pane");',
    '  if (window.__root) { window.__root.unmount(); window.__root = null; }',
    '  pane.innerHTML = ""; CALLS.length = 0; window.__errors.length = 0;',
    '  window.__root = ReactDOMClient.createRoot(pane);',
    '  window.__root.render(React.createElement(VC.VersionControlTab, { st: { cwd: opts.cwd === undefined ? F.cwd : opts.cwd }, narrow: false }));',
    '};',
    'window.__measureLive = function () {',
    '  const live = document.querySelector("[data-vc-live]");',
    '  if (!live) return null;',
    '  const shell = live.querySelector("[data-vc-shell]");',
    '  const rr = live.getBoundingClientRect();',
    '  let maxRight = -1e9, minLeft = 1e9;',
    '  live.querySelectorAll("*").forEach((el) => { const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return; const r = el.getBoundingClientRect(); if (r.width <= 0 && r.height <= 0) return; if (r.right > maxRight) maxRight = r.right; if (r.left < minLeft) minLeft = r.left; });',
    '  const attrAll = (sel, attr) => Array.from(live.querySelectorAll(sel)).map((el) => el.getAttribute(attr));',
    '  const tabs = Array.from(live.querySelectorAll("[data-vc-tab]"));',
    '  return {',
    '    live: true, liveDisplay: getComputedStyle(live).display, emptyCwd: !!live.querySelector("[data-vc-live-empty]") || live.hasAttribute("data-vc-live-empty"), emptyId: live.id || "", emptyRootAttr: live.getAttribute("data-vc-live-empty"),',
    '    shell: !!shell, page: shell ? shell.getAttribute("data-vc-page") : null, width: shell ? shell.getAttribute("data-vc-width") : null,',
    '    skin: shell ? shell.getAttribute("data-vc-skin") : null, depth: shell ? shell.getAttribute("data-vc-depth") : null,',
    '    rootWidth: rr.width, rootLeft: rr.left, rootRight: rr.right, maxRight: maxRight, minLeft: minLeft,',
    '    docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,',
    '    tabs: tabs.map((el) => el.getAttribute("data-vc-tab")), selected: tabs.filter((el) => el.getAttribute("aria-selected") === "true").map((el) => el.getAttribute("data-vc-tab")),',
    '    gear: attrAll("[data-vc-gear-item]", "data-vc-gear-item"), gearOpen: !!live.querySelector("[data-vc-gear-index]"),',
    '    palette: attrAll("[data-vc-palette-row]", "data-vc-palette-row"), paletteText: (live.querySelector("[data-vc-palette]") || { textContent: "" }).textContent,',
    '    capHit: !!live.querySelector("[data-cap-hit]"), back: !!live.querySelector("[data-vc-back]"), primaries: live.querySelectorAll("[data-cap-primary]").length,',
    '    syncFacts: !!live.querySelector("[data-vc-sync-facts]"),',
    '    firstScreenCalls: window.__countPhone("wf.gitFirstScreen"),',
    '  };',
    '};',
    'window.__ready = true;',
  ].join('\n')
}

// ---------------- 起页面：HTML 里注入闭包、词典、假宿主回包 ----------------
async function pageFor(browser: any, dict: any, closureJs: string, fixtures: any, timeVals: any, css: string) {
  const built = await require('esbuild').build({ stdin: { contents: entryOf(), resolveDir: ROOT, sourcefile: 'probe-1776.js', loader: 'js' }, bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error' })
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body><div id="pane"></div>' +
    '<script>window.__CLOSURE_JS__=' + JSON.stringify(closureJs) + ';window.__DICT__=' + JSON.stringify(dict) + ';window.__FIXTURES__=' + JSON.stringify(fixtures) + ';window.__TIME__=' + JSON.stringify(timeVals) + ';</script>' +
    '<script>' + String(built.outputFiles[0].text) + '</script></body></html>'
  const server = createServer((req: any, res: any) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html) })
  await new Promise((resolve: any) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const context = await browser.newContext({ viewport: { width: 520, height: 1400 } })
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (e: any) => { pageErrors.push(String((e && e.message) || e)); console.error('[pageerror] ' + String((e && e.message) || e)) })
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', null, { timeout: 20000 })
  return { page, pageErrors, close: async () => { await context.close().catch(() => undefined); await new Promise((resolve: any) => server.close(resolve)) } }
}

// ---------------- 挂载与量尺的小工具 ----------------
async function mount(page: any, opts?: any) {
  await page.evaluate((o: any) => window.__mount(o || {}), opts || {})
  await page.waitForFunction("!!document.querySelector('[data-vc-live]')")
  await page.waitForTimeout(280)
}
async function click(page: any, sel: string) { await page.click(sel, { timeout: 6000 }); await page.waitForTimeout(170) }
async function setSkin(page: any, skin: string) { await page.evaluate((s: string) => { if (s === 'dark') document.body.setAttribute('data-ds-dark-theme', ''); else document.body.removeAttribute('data-ds-dark-theme') }, skin) }
const measure = (page: any) => page.evaluate(() => window.__measureLive())
const overflowOf = (m: any) => m.docScrollWidth > m.innerWidth + 1 || m.maxRight > m.rootRight + 1 || m.minLeft < m.rootLeft - 1
async function shoot(page: any, name: string) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') }) }
// 成对截图按「只截页面壳」出图：原型侧（screenshots.mjs）截的也是 .panel 元素本身，
//   两张图同一裁切口径，并排对照时高度和留白才对得上。
// #1860：原型侧截图（docs/prototype/vc-redesign/tools/screenshots.mjs）在 1200 高视口下截 .panel 元素，
//   四 view × 两皮肤 × 四档宽那 32 张原型图都是 873 高；真机宿主也给版本管理页一个确定高度的内容区
//   （Dock.ts 的 .dsws-body 是 flex 项）。夹具里的 #pane 平时只有内容高度，所以成对截图临时给 873 高，
//   出图才和原型同口径；截完立即复位，不影响其它组按视口量尺。
const PANE_SHELL_H = 873
async function withPaneHeight(page: any, h: number, fn: any) {
  await page.evaluate((v: number) => { const pane = document.getElementById('pane'); if (pane) (pane as any).style.height = v + 'px' }, h)
  await page.waitForTimeout(60)
  try { return await fn() } finally {
    await page.evaluate(() => { const pane = document.getElementById('pane'); if (pane) (pane as any).style.height = '' })
  }
}
async function shootShell(page: any, name: string) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  // 截图前把指针挪出面板：点击页签会把真实指针留在上一个布局的位置上，页面重排后它可能正好压在
  //   统计卡之类的可悬停元素上，截出来的图里就有一张卡带着「悬停高亮」，跟原型并排看像是状态不同。
  await page.mouse.move(519, 1399)
  await withPaneHeight(page, PANE_SHELL_H, () => page.locator('[data-vc-shell]').screenshot({ path: path.join(SHOT_DIR, name + '.png') }))
}

// ---------------- A 组：四档宽 × 两皮肤 ----------------
async function groupLayout(page: any) {
  for (const skin of SKINS) for (const width of WIDTHS) {
    await page.setViewportSize({ width: width, height: 1400 }); await setSkin(page, skin); await mount(page)
    const m = await measure(page); const tag = '页签 ' + skin + ' / ' + width + ' 宽'
    check(!!m && m.live && m.liveDisplay !== 'none', tag + '：data-vc-live 真画出来且可见')
    check(!!m && m.shell === true, tag + '：页面壳 data-vc-shell 长在 data-vc-live 里面')
    check(!!m && m.page === 'changes' && m.depth === '1', tag + '：默认落在改动页、层级 1（实得 ' + (m && m.page) + '）')
    check(!!m && Math.abs(Number(m.width) - m.rootWidth) <= 2, tag + '：根宽 ' + (m && m.rootWidth.toFixed(1)) + ' 与 data-vc-width=' + (m && m.width) + ' 一致')
    check(!!m && m.rootWidth <= m.innerWidth + 1, tag + '：根宽不超过视口（' + (m && m.rootWidth.toFixed(1)) + ' ≤ ' + (m && m.innerWidth) + '）')
    check(!!m && !overflowOf(m), tag + '：没有横向溢出（文档 ' + (m && m.docScrollWidth) + ' ≤ 视口 ' + (m && m.innerWidth) + '，后代右边界 ' + (m && m.maxRight.toFixed(1)) + ' ≤ 根右边界 ' + (m && m.rootRight.toFixed(1)) + '）')
    check(!!m && m.skin === skin, tag + '：皮肤读数是 ' + skin + '（实得 ' + (m && m.skin) + '）')
    check(!!m && m.tabs.length === 4 && m.selected.join(',') === 'changes', tag + '：四个页签都在、改动页签是选中态')
    check(!!m && m.firstScreenCalls === 1, tag + '：进入时恰好发一次首屏聚合读（实得 ' + (m && m.firstScreenCalls) + ' 次）')
    if (width === 300 || width === 520) await shoot(page, 'tab-' + skin + '-' + width)
    // #1860 验收要的成对截图：四档宽 × 两皮肤下四个页签各来一张，供和原型同宽同皮肤并排对照
    //   （原型侧用 docs/prototype/vc-redesign/tools/screenshots.mjs 的同 URL 参数出图）。
    for (const tab of TAB_PAGES) {
      if (tab !== 'changes') await click(page, '[data-vc-tab="' + tab + '"]')
      await shootShell(page, 'shell-' + tab + '-' + skin + '-' + width)
    }
  }
}

// ---------------- F 组：四个页签首层铺满宿主可用高度（#1860） ----------------
// 定稿原型里 .panel 撑满一屏：身份行与页签条固定、正文列表自己滚、提交区贴底。真机宿主也给了确定高度的内容区，
// 所以这里锁三件可观察的事实：根节点撑满 pane、页面壳底边贴根底边、改动页的提交区贴正文底边；
// 同时反向锁住二级页没有被误拉成满屏（二级页的滚动仍归宿主，和原型 37/39 一致）。
async function groupFill(page: any) {
  await page.setViewportSize({ width: 460, height: 1000 }); await setSkin(page, 'dark')
  await mount(page)
  for (const tab of TAB_PAGES) {
    if (tab !== 'changes') await click(page, '[data-vc-tab="' + tab + '"]')
    const m = await withPaneHeight(page, PANE_SHELL_H, () => page.evaluate(() => {
      const q = (s: string) => document.querySelector(s) as any
      const box = (s: string) => { const el = q(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height } }
      const root = q('[data-vc-live]')
      return {
        rootClass: root ? String(root.className) : '',
        pane: box('#pane'), root: box('[data-vc-live]'), shell: box('[data-vc-shell]'),
        body: box('.vcs-page-body'), view: box('.vcs-page-body>.view'), composer: box('[data-vc-commit-panel]'),
      }
    }))
    const tag = 'F 铺满：' + tab
    check(!!m && m.rootClass.indexOf('is-tabpage') >= 0, tag + ' 首层根节点带 is-tabpage（实得「' + (m && m.rootClass) + '」）')
    check(!!m && m.root && Math.abs(m.root.height - PANE_SHELL_H) <= 2, tag + ' 根节点撑满宿主可用高度 ' + PANE_SHELL_H + '（实得 ' + (m && m.root ? m.root.height.toFixed(1) : 'null') + '）')
    check(!!m && m.shell && m.root && Math.abs(m.shell.bottom - m.root.bottom) <= 2 && Math.abs(m.shell.top - m.root.top) <= 2, tag + ' 页面壳上下都贴到根节点（壳 ' + (m && m.shell ? m.shell.top.toFixed(1) + '…' + m.shell.bottom.toFixed(1) : 'null') + '，根 ' + (m && m.root ? m.root.top.toFixed(1) + '…' + m.root.bottom.toFixed(1) : 'null') + '）')
    check(!!m && m.view && m.body && Math.abs(m.view.bottom - m.body.bottom) <= 2, tag + ' 正文撑满页面体、没有按内容高度提前结束（正文底 ' + (m && m.view ? m.view.bottom.toFixed(1) : 'null') + '，页面体底 ' + (m && m.body ? m.body.bottom.toFixed(1) : 'null') + '）')
    if (tab === 'changes') {
      check(!!m && m.composer && m.body && Math.abs(m.composer.bottom - m.body.bottom) <= 2, tag + ' 提交区贴住页面体底边（提交区底 ' + (m && m.composer ? m.composer.bottom.toFixed(1) : 'null') + '，页面体底 ' + (m && m.body ? m.body.bottom.toFixed(1) : 'null') + '）')
      check(!!m && m.body && m.composer && m.body.height > m.composer.height + 120, tag + ' 列表区留有可滚动的余量（页面体 ' + (m && m.body ? m.body.height.toFixed(1) : 'null') + ' > 提交区 ' + (m && m.composer ? m.composer.height.toFixed(1) : 'null') + ' + 120）')
    }
  }
  // 反向：二级页不铺满、不挂 is-tabpage（返回链与页头仍按内容高度排，滚动交给宿主）。
  await mount(page)
  await click(page, '[data-vc-gear-btn]')
  await click(page, '[data-vc-gear-item="remote"]')
  const depth2 = await withPaneHeight(page, PANE_SHELL_H, () => page.evaluate(() => ({ rootClass: String((document.querySelector('[data-vc-live]') || { className: '' }).className), page: String((document.querySelector('[data-vc-live]') || { getAttribute: () => '' }).getAttribute('data-vc-live-page')) })))
  check(depth2.page === 'remote' && depth2.rootClass.indexOf('is-tabpage') < 0, 'F 铺满：二级页（' + depth2.page + '）不挂 is-tabpage，仍按内容高度由宿主滚动（实得「' + depth2.rootClass + '」）')
}

// ---------------- B 组：页签、齿轮、顶栏入口、命令面板 ----------------
async function groupNav(page: any) {
  await page.setViewportSize({ width: 520, height: 1400 }); await setSkin(page, 'dark'); await mount(page)
  for (const tab of TAB_PAGES) {
    if (tab !== 'changes') await click(page, '[data-vc-tab="' + tab + '"]')
    const m = await measure(page)
    check(!!m && m.page === tab && m.selected.join(',') === tab, 'B 页签：点「' + tab + '」切到该页，且只有它是 aria-selected（实得 ' + (m && m.page) + '）')
    check(!!m && m.back === false, 'B 页签：' + tab + ' 与改动页同一层，不该出现返回入口')
  }
  // 齿轮与顶栏入口都从改动页出发，返回后必须回到改动页（退回来源页是导航契约的一部分）。
  await click(page, '[data-vc-tab="changes"]')
  const manage = await page.evaluate(() => window.__VC.VC_MANAGE_PAGES.slice())
  check(manage.length === 9, 'B 齿轮：管理分区是九个（实得 ' + manage.length + '）')
  for (const id of manage) {
    if (!(await page.evaluate(() => !!document.querySelector('[data-vc-gear-index]')))) await click(page, '[data-vc-gear-btn]')
    const opened = await measure(page)
    // #1840：齿轮与身份行「管理」都打开一屏独立的管理索引（page=manage），不再是叠在页面上的浮层。
    check(!!opened && opened.page === 'manage' && opened.gearOpen && opened.gear.length === 9, 'B 齿轮：打开管理索引独立一屏、看到九项（' + id + ' 这一轮实测 ' + (opened && opened.gear.length) + ' 项）')
    await click(page, '[data-vc-gear-item="' + id + '"]')
    const m = await measure(page)
    check(!!m && m.page === id && m.depth === '2', 'B 齿轮：点「' + id + '」进入该分区页、层级 2（实得 ' + (m && m.page) + '）')
    // #1860：能力主入口搬到命令面板后，二级页正文只要求「有返回入口、真的换了页」；
    //   能力可达性统一由下面的命令面板与 C 组判据验，不再要求页面体里出现 data-cap-primary。
    check(!!m && m.back === true, 'B 齿轮：' + id + ' 页有返回入口（实得 ' + (m && m.back) + '）')
    // #1829 阶段 4：二级页按原型 37/39 收成「页头 + 正文」——四个固定页签与身份行的同步带都让位。
    check(!!m && m.tabs.length === 0, 'B 齿轮：' + id + ' 二级页不铺四个固定页签（实得 ' + (m && m.tabs.length) + ' 个）')
    check(!!m && m.syncFacts === false, 'B 齿轮：' + id + ' 二级页不铺同步事实与同步动作行')
    // #1840：返回只留页头一颗（顶部条那颗已删除），且一次退一层：分区 → 索引 → 改动页。
    await click(page, '[data-vc-page-head] [data-vc-back]')
    const backIndex = await measure(page)
    check(!!backIndex && backIndex.page === 'manage' && backIndex.back === true, 'B 齿轮：从 ' + id + ' 返回先回管理索引（实得 ' + (backIndex && backIndex.page) + '）')
    await click(page, '[data-vc-page-head] [data-vc-back]')
    const back = await measure(page)
    check(!!back && back.page === 'changes', 'B 齿轮：从索引再返回改动页（实得 ' + (back && back.page) + '，返回按钮 ' + (back && back.back) + '）')
  }
  // #1860：定稿原型的一屏里没有额外顶栏，搜索/变基/冲突三页改从命令面板进入（能力入口只有一处）。
  for (const key of ['search', 'rebase', 'conflicts']) {
    await mount(page)
    const capId = await page.evaluate((p: string) => {
      const list = (window.__VC.vcPaletteRowsOf('') || []).filter((r: any) => String(r.page || '') === p)
      return list.length > 0 ? String(list[0].id) : ''
    }, key)
    check(capId !== '', 'B 命令面板入口：账本里 ' + key + ' 页有可定位的能力（' + capId + '）')
    if (capId === '') continue
    await click(page, '[data-vc-search-entry]')
    await page.fill('[data-vc-palette-input]', capId)
    await page.waitForTimeout(200)
    const has = await page.evaluate((id: string) => !!document.querySelector('[data-vc-palette-row="' + id + '"]'), capId)
    check(has, 'B 命令面板入口：搜「' + capId + '」能搜到该页能力')
    if (has) { await click(page, '[data-vc-palette-row="' + capId + '"]'); await page.waitForTimeout(180) }
    const m = await measure(page)
    check(!!m && m.page === key, 'B 命令面板入口：选中能力后落到 ' + key + ' 页（实得 ' + (m && m.page) + '）')
    check(!!m && m.tabs.length === 0, 'B 命令面板入口：' + key + ' 二级页不铺四个固定页签（实得 ' + (m && m.tabs.length) + ' 个）')
    await click(page, '[data-vc-page-head] [data-vc-back]')
    const back = await measure(page)
    check(!!back && back.page === 'changes', 'B 命令面板入口：从 ' + key + ' 返回改动页（实得 ' + (back && back.page) + '，返回按钮 ' + (back && back.back) + '）')
  }
  await mount(page)
  await click(page, '[data-vc-search-entry]')
  let m = await measure(page)
  const allHits = await page.evaluate(() => window.__VC.vcPaletteMatchOf('').length)
  const rowsAll = await page.evaluate(() => window.__VC.vcPaletteRowsOf('').map((r: any) => r.id))
  check(allHits === 162, 'B 命令面板：空词命中能力账本 162 条（实得 ' + allHits + ' 条）')
  check(!!m && m.palette.join(',') === rowsAll.join(','), 'B 命令面板：浮层行与 vcPaletteRowsOf 一致（' + (m && m.palette.length) + ' 行）')
  check(!!m && m.paletteText.indexOf('162') >= 0, 'B 命令面板：提示行写出总命中 162')
  await page.fill('[data-vc-palette-input]', '暂存')
  await page.waitForTimeout(220)
  m = await measure(page)
  const rowsFiltered = await page.evaluate(() => window.__VC.vcPaletteRowsOf('暂存').map((r: any) => r.id))
  check(!!m && m.palette.join(',') === rowsFiltered.join(','), 'B 命令面板：输入「暂存」后行数与 vcPaletteRowsOf 一致（' + (m && m.palette.length) + ' 行）')
  check(!!m && m.palette.length > 0 && m.palette.length <= rowsAll.length, 'B 命令面板：过滤之后仍有命中，且不多于不过滤时（' + (m && m.palette.length) + ' ≤ ' + rowsAll.length + '）')
  const pickId = m.palette[0]
  const target = await page.evaluate((id: string) => window.__VC.vcPaletteTargetOf(id), pickId)
  await click(page, '[data-vc-palette-row="' + pickId + '"]')
  m = await measure(page)
  check(!!m && m.page === target.page, 'B 命令面板：选中「' + pickId + '」落到目标页 ' + target.page + '（实得 ' + (m && m.page) + '）')
  // #1860：页面体里不再铺能力行，data-cap-hit 只剩页面内能力清单会用；这里改为判「落到目标页、浮层收起」。
  check(!!m && m.page === target.page, 'B 命令面板：选中后停在目标页 ' + target.page + '（实得 ' + (m && m.page) + '）')
  check(!!m && m.palette.length === 0, 'B 命令面板：选中之后浮层面板关掉')
}

// ---------------- C 组：300 宽下逐页可达、页面体不再出现能力清单、能力从命令面板可达 ----------------
// #1860 改判据（不是放宽）：能力清单从页面体退役，162 条能力的唯一主入口落在命令面板里。
//   所以这一组问的不再是「页面体里有没有可点的主入口」，而是两件事：
//   ①页面体里看不到能力清单（data-vc-cap-list）与「本页负责 N 条能力」；
//   ②这一页的能力在命令面板里搜得到、点得进该页、不报错。
async function primaryCheck(page: any, pageErrors: string[], tag: string, opts?: any) {
  const body = await page.evaluate(() => {
    const el: any = document.querySelector('[data-vc-page-body]')
    const pageId: string = el ? String(el.getAttribute('data-vc-page-body') || '') : ''
    const cap: any = (window.__VC.vcPaletteRowsOf('') || []).filter((r: any) => String(r.page || '') === pageId)[0]
    return {
      page: pageId,
      list: !!document.querySelector('[data-vc-cap-list]'),
      lede: el ? String(el.textContent || '').indexOf('本页负责') >= 0 : false,
      primary: document.querySelectorAll('[data-cap-primary]').length,
      capId: cap ? String(cap.id) : '',
    }
  })
  check(!body.list, tag + '：页面体里没有能力清单（data-vc-cap-list）')
  check(!body.lede, tag + '：页面体里没有「本页负责 N 条能力」说明块')
  check(body.primary === 0, tag + '：页面体里没有能力主入口标记（实得 ' + body.primary + ' 条，唯一主入口在命令面板）')
  check(body.capId !== '', tag + '：账本里 ' + body.page + ' 页有可定位的能力（' + body.capId + '）')
  const before = pageErrors.length
  // 搜索页（13.x）的身份行那颗按钮是「聚焦本页搜索框」，不打开命令面板；
  //   从命令面板跳过来的路径已经在上一步验过「搜得到、点得进」，这里不重复开面板。
  if (body.capId !== '' && !(opts && opts.skipPalette)) {
    await click(page, '[data-vc-search-entry]')
    await page.fill('[data-vc-palette-input]', body.capId)
    await page.waitForTimeout(200)
    const has = await page.evaluate((id: string) => !!document.querySelector('[data-vc-palette-row="' + id + '"]'), body.capId)
    check(has, tag + '：命令面板里搜得到该页能力 ' + body.capId)
    if (has) { await click(page, '[data-vc-palette-row="' + body.capId + '"]'); await page.waitForTimeout(200) }
    const m = await measure(page)
    check(!!m && m.page === body.page, tag + '：命令面板落到该页（实得 ' + (m && m.page) + '）')
  }
  check(pageErrors.length === before, tag + '：走一遍命令面板不报错（新增页面错误 ' + (pageErrors.length - before) + ' 条）')
}
async function groupReach(page: any, pageErrors: string[]) {
  await page.setViewportSize({ width: 300, height: 1400 }); await setSkin(page, 'dark')
  for (const tab of TAB_PAGES) {
    await mount(page)
    if (tab !== 'changes') await click(page, '[data-vc-tab="' + tab + '"]')
    const m = await measure(page)
    check(!!m && m.page === tab, 'C 300 宽：1 次点击到页签 ' + tab + '（实得 ' + (m && m.page) + '）')
    await primaryCheck(page, pageErrors, 'C 页签 ' + tab)
  }
  const manage = await page.evaluate(() => window.__VC.VC_MANAGE_PAGES.slice())
  for (const id of manage) {
    await mount(page)
    await click(page, '[data-vc-gear-btn]')
    await click(page, '[data-vc-gear-item="' + id + '"]')
    const m = await measure(page)
    check(!!m && m.page === id && m.depth === '2', 'C 300 宽：2 次点击到管理分区 ' + id)
    check(!!m && !overflowOf(m), 'C 300 宽：管理分区 ' + id + ' 没有横向溢出（后代右边界 ' + (m && m.maxRight.toFixed(1)) + ' ≤ 根右边界 ' + (m && m.rootRight.toFixed(1)) + '）')
    await primaryCheck(page, pageErrors, 'C 分区 ' + id)
  }
  // #1860：没有额外顶栏之后，搜索/变基/冲突三页从命令面板进入；到页后仍然验「页面体无能力清单 + 能力可达」。
  for (const key of ['search', 'rebase', 'conflicts']) {
    await mount(page)
    const capId = await page.evaluate((p: string) => {
      const list = (window.__VC.vcPaletteRowsOf('') || []).filter((r: any) => String(r.page || '') === p)
      return list.length > 0 ? String(list[0].id) : ''
    }, key)
    check(capId !== '', 'C 300 宽：账本里 ' + key + ' 页有可定位的能力（' + capId + '）')
    if (capId === '') continue
    await click(page, '[data-vc-search-entry]')
    await page.fill('[data-vc-palette-input]', capId)
    await page.waitForTimeout(200)
    const has = await page.evaluate((id: string) => !!document.querySelector('[data-vc-palette-row="' + id + '"]'), capId)
    check(has, 'C 300 宽：命令面板搜得到 ' + key + ' 页能力 ' + capId)
    if (has) { await click(page, '[data-vc-palette-row="' + capId + '"]'); await page.waitForTimeout(200) }
    const m = await measure(page)
    check(!!m && m.page === key, 'C 300 宽：命令面板 2 次点击到 ' + key + ' 页（实得 ' + (m && m.page) + '）')
    check(!!m && !overflowOf(m), 'C 300 宽：命令面板入口 ' + key + ' 没有横向溢出（后代右边界 ' + (m && m.maxRight.toFixed(1)) + ' ≤ 根右边界 ' + (m && m.rootRight.toFixed(1)) + '）')
    await primaryCheck(page, pageErrors, 'C 入口 ' + key, { skipPalette: true })
  }
}

// ---------------- D 组：反证 ----------------
async function groupReverse(page: any) {
  await page.setViewportSize({ width: 300, height: 1400 }); await setSkin(page, 'dark'); await mount(page)
  const before = await measure(page)
  check(!!before && !overflowOf(before), 'D 反证前置：没动手脚时同一把量尺在 300 宽量不出溢出')
  await page.evaluate(() => { (document.querySelector('[data-vc-live]') as any).style.minWidth = '640px' })
  await page.waitForTimeout(220)
  const m = await measure(page)
  const minWidth = await page.evaluate(() => getComputedStyle(document.querySelector('[data-vc-live]') as any).minWidth)
  check(minWidth === '640px', 'D 反证自证：改法真的落到根节点上（computed min-width=' + minWidth + '）')
  check(!!m && m.docScrollWidth > m.innerWidth + 1, 'D 反证：根被强制加宽后 300 宽必须量出横向溢出（scrollWidth ' + (m && m.docScrollWidth) + ' > ' + (m && m.innerWidth) + '）')
}

// ---------------- E 组：空工作区不挂壳、不发电话 ----------------
async function groupEmpty(page: any) {
  await page.setViewportSize({ width: 460, height: 1000 }); await setSkin(page, 'dark'); await mount(page, { cwd: '' })
  const m = await measure(page)
  check(!!m && m.live === true && m.emptyCwd === true, 'E 空工作区：画 data-vc-live-empty 空态（id=' + (m && (m as any).emptyId) + '，根属性=' + (m && (m as any).emptyRootAttr) + '）')
  check(!!m && m.shell === false, 'E 空工作区：不挂页面壳')
  check(!!m && m.firstScreenCalls === 0, 'E 空工作区：一条宿主电话都不发（实得 ' + (m && m.firstScreenCalls) + ' 条）')
}

// ---------------- main ----------------
;(async () => {
  const locMod = await import(pathToFileURL(path.join(ROOT, 'src/client/kernel/locale-data.ts')).href)
  const dict = locMod.LOCALE_COPY.zh
  const valuesMod = await import(pathToFileURL(path.join(ROOT, sourcePath('src/shared/time-config/values.js'))).href)
  const timeVals: any = {}
  for (const k of Object.keys(valuesMod)) if (typeof valuesMod[k] === 'number') timeVals[k] = valuesMod[k]
  // 真机里样式按 src/client/index.ts 的顺序一次注入：壳样式 → #1829/#1840 新样式 → #1860 原型样式。
  // 这里必须同序拼全，否则截出来的形状是没上色的裸文本，看不出还原得对不对。
  const stylesMod = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/vcShellStyles.ts')).href)
  // vcPageStyles 是拼接型叶子（引用了同一闭包里的 MOTION 常量），单独 import 会 ReferenceError；
  // 它只服务二级页，本门禁的四页签首屏用不到，这里不拼它。
  // #1860 主屏原型样式按真源拆成八份叶子，这里按 src/client/index.ts 与 scripts/build.mts 的同序拼全。
  const protoStyleNames: string[] = ['vcProtoTokens', 'vcProtoChrome', 'vcProtoControls', 'vcProtoChanges', 'vcProtoComposer', 'vcProtoHistory', 'vcProtoWorktrees', 'vcProtoMenus']
  const protoCssParts: string[] = []
  for (const name of protoStyleNames) {
    const mod: any = await import(pathToFileURL(path.join(ROOT, 'src/client/views/versionControl/' + name + '.ts')).href)
    protoCssParts.push(...(mod['VC_PROTO_STYLE_' + name.slice('vcProto'.length).toUpperCase()] || []))
  }
  const css = 'html,body{margin:0;padding:0}#pane{width:100%}'
    + String(stylesMod.VC_SHELL_STYLE_TEXT || '')
    + protoCssParts.join('\n')
  const { getBrowser, closeBrowser } = require('./lib/browser-pool.js')
  const browser = await getBrowser({ headless: true })
  try {
    const env = await pageFor(browser, dict, CLOSURE_JS, FIXTURES, timeVals, css)
    try {
      await groupLayout(env.page)
      await groupFill(env.page)
      await groupNav(env.page)
      await groupReach(env.page, env.pageErrors)
      await groupReverse(env.page)
      await groupEmpty(env.page)
    } finally { await env.close() }
  } finally { await closeBrowser() }
  printGateResult('verify-1776-vc-tab-browser', total, failed)
  console.log('')
  if (failed) { console.log('存在失败 — 真实版本管理页签的真浏览器门禁未通过（' + total + ' 项断言）'); process.exit(1) }
  console.log('全部通过 — 真实页签在真浏览器里的布局、导航与可达性都成立（' + total + ' 项断言）')
})().catch((e: any) => {
  console.log('  FAIL 门禁自身抛错：' + String((e && e.stack) || e))
  process.exit(1)
})
