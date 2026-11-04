/**
 * tools/screenshots.mjs —— 用无头浏览器把原型的关键状态逐张截下来，产出 docs/prototype/vc-redesign/screenshots/*.png。
 *
 * 为什么要有这个脚本：「这一版长什么样」只能靠图说清，而手点截图既不可复现，也无法在评审里核对同一状态。
 * 每一张图都由查询串唯一指定（与 app.ts 的深链参数同一套名字），所以重跑得到的是同一批状态。
 *
 * 运行方式（仓库根目录，需先跑一次构建）：
 *   node docs/prototype/vc-redesign/tools/screenshots.mjs
 *
 * 截图只截 .panel 本身：面板是产品本体，外面那层纸面外框属于演示页，不属于设计评审对象。
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = resolve(ROOT, 'screenshots')
const INDEX = pathToFileURL(resolve(ROOT, 'index.html')).href

/**
 * 一张图 = 一个查询串。字段说明：
 *   query   深链参数（与 app.ts 的 applyDeepLink 对应，例如 manage=1、page=maintenance）；
 *   width   面板宽度，取值 300 / 380 / 460 / 520，默认 460；
 *   scrollTo 截图前先滚到某个位置：'bottom' 表示页面内容区滚到底，选择器表示把它滚进可视区；
 *   clicks  截图前依次点开的选择器：菜单、确认卡这类状态只能用点击造出来，光靠查询串复现不了；
 *   embed   嵌入模式（只留产品面板，用于文档内引用）；
 *   viewport 浏览器窗口尺寸，按内容高度微调，保证面板本体截图不变形；
 *            默认按宽度与 embed 推出来，展开区比列表高时（逐块暂存那三张）单独给一个高窗口。
 */
const HUNK_ROW = '[data-action="toggle-file"][data-path="src/client/views/shared/workRouteTable.ts"]'
// 列表里最新一条提交的完整提交号：打开详情截图要用它（深链按完整号匹配）。
const HEAD_OID = 'e489673f240ed18a2e71bb6de5bfc635b2fed73c'
const TALL = { width: 820, height: 1200 }

const SHOTS = [
  { name: '37-manage-460', query: 'manage=1' },
  { name: '38-branch-tags-460', query: 'page=branch-tags' },
  { name: '39-remote-460', query: 'page=remote' },
  { name: '40-submodules-460', query: 'page=submodules' },
  { name: '41-maintenance-460', query: 'page=maintenance' },
  { name: '42-maintenance-danger-460', query: 'page=maintenance', scrollTo: '#danger-zone' },
  { name: '43-migrate-460', query: 'page=migrate' },
  { name: '44-config-460', query: 'page=config' },
  { name: '45-hooks-460', query: 'page=hooks' },
  { name: '46-diagnostics-460', query: 'page=diagnostics' },
  { name: '47-platform-460', query: 'page=platform' },
  { name: '48-rebase-460', query: 'flow=rebase&rebasestep=2' },
  { name: '49-conflicts-460', query: 'flow=conflicts&conflicts=1' },
  { name: '50-task-460', query: 'flow=task&task=1&taskp=85' },
  { name: '51-search-460', query: 'page=search&pq=css' },
  { name: '52-palette-460', query: 'palette=1' },
  { name: '53-palette-query-460', query: 'palette=1&pquery=11.6' },
  { name: '54-danger-confirm-460', query: 'page=maintenance&danger=11.6' },
  { name: '55-cap-demo-460', query: 'page=maintenance&capopen=11.5', scrollTo: '[data-cap-id="11.5"]' },
  { name: '56-manage-300', query: 'manage=1', width: 300 },
  { name: '57-palette-300', query: 'palette=1', width: 300 },
  { name: '58-manage-light-460', query: 'manage=1', theme: 'light' },
  { name: '59-rebase-light-460', query: 'flow=rebase&rebasestep=1', theme: 'light' },
  { name: '60-embed-manage-520', query: 'manage=1', embed: true },
  { name: '61-embed-danger-520', query: 'page=maintenance&danger=11.6', embed: true },
  // 分组标题右侧的两颗动作（全部加入 / 丢弃全部）作为一组靠右：补一张改动页，评审看对齐时不用自己点数。
  { name: '62-changes-460', query: 'view=changes' },
  { name: '63-changes-300', query: 'view=changes', width: 300 },
  // 第四个页签按官方术语叫「储藏」：补一张当前布局下的记录列表，评审不用翻到旧布局那批图。
  { name: '64-stash-460', query: 'view=stash&stashdemo=1' },
  // 八条界面意见改完后的状态：统计卡、拉取确认、两处更多菜单与浅色改动页。
  { name: '65-changes-light-460', query: 'view=changes', theme: 'light' },
  { name: '66-pull-confirm-460', query: 'confirm=1' },
  { name: '67-row-menu-460', query: '', clicks: ['.row-act.row-more'] },
  { name: '68-commit-menu-460', query: '', clicks: ['#tab-commits', '[data-action="commit-menu"]'] },
  // 提交选项：形态、内容来源、说明模板、钩子与签名。三档宽 × 两套皮肤各一张，
  // 展开区浮在提交区上方，文件列表保持原高。
  { name: '69-commit-options-300', query: 'commitoptions=1', width: 300 },
  { name: '70-commit-options-380', query: 'commitoptions=1', width: 380 },
  { name: '71-commit-options-460', query: 'commitoptions=1' },
  { name: '72-commit-options-light-300', query: 'commitoptions=1', width: 300, theme: 'light' },
  { name: '73-commit-options-light-380', query: 'commitoptions=1', width: 380, theme: 'light' },
  { name: '74-commit-options-light-460', query: 'commitoptions=1', theme: 'light' },
  // 修订：说明预填上一条、作用对象写在形态下面，按钮字跟着变成「修订上一条提交」。
  { name: '75-commit-amend-460', query: 'stageall=1&commitoptions=1&commitform=amend' },
  // 修订执行完：结果条贴在提交区，页签条数不变（一条换一条）。
  { name: '76-commit-amend-result-460', query: 'stageall=1&commitoptions=1&commitform=amend', clicks: [{ click: '[data-action="commit"]', wait: 1000 }] },
  // fixup：说明由面板写成 fixup! …，输入框换成一行只读说明。
  { name: '77-commit-fixup-460', query: 'stageall=1&commitoptions=1&commitform=fixup' },
  // fixup 执行后：历史最前面多一条带 fixup 标记的提交。
  { name: '78-commit-fixup-history-460', query: 'stageall=1&commitoptions=1&commitform=fixup', clicks: [{ click: '[data-action="commit"]', wait: 1000 }, '#tab-commits'] },
  // 记录方式开着、展开区收起：跳过钩子与签名行以标签形式贴在提交按钮左边，
  // 不用打开浮层就知道这一次提交会跳检查、带签名行。
  { name: '79-commit-flags-460', query: 'noverify=1&signoff=1' },
  { name: '80-commit-flags-light-300', query: 'noverify=1&signoff=1', width: 300, theme: 'light' },
  // 已跟踪文件的行级动作：改名（贴行表单）、停止跟踪与删除（贴行确认卡）。
  // 路径直接写原文：脚本用 URLSearchParams 拼查询串，会替我们正确转义；预先编码会被二次编码成 %252F。
  { name: '81-rename-form-460', query: 'menu=src/client/views/shared/workRouteTable.ts', clicks: ['[data-action="rename-open"]'], scrollTo: '.rename-form' },
  { name: '82-untrack-confirm-460', query: 'cpending=untrack&cpath=src/client/views/shared/workRouteTable.ts' },
  { name: '83-delete-tracked-confirm-460', query: 'cpending=delete-tracked&cpath=src/client/views/shared/workRouteTable.ts' },
  // 逐块暂存：展开一行后每一块右侧一颗按钮；暂存其中一块之后，这一行留在「未暂存」，
  // 行上写出「已暂存 1/2 块」，已暂的那块压暗、按钮换成「取消暂存这一块」。
  // 展开的一行比默认列表可视区高，这三张用高一点的窗口，把行头与两块一起截进来。
  { name: '84-hunk-stage-460', query: 'expand=src/client/views/shared/workRouteTable.ts', scrollTo: HUNK_ROW, viewport: TALL },
  { name: '85-hunk-partial-460', query: 'expand=src/client/views/shared/workRouteTable.ts', clicks: ['.hunk-act'], scrollTo: HUNK_ROW, viewport: TALL },
  { name: '86-hunk-partial-light-380', query: 'expand=src/client/views/shared/workRouteTable.ts', clicks: ['.hunk-act'], width: 380, theme: 'light', scrollTo: HUNK_ROW, viewport: TALL },
  // 历史页四条：按代码变化搜、只看某个文件、比较两个引用（表单与结果）、
  // 提交详情里的文件行菜单（单文件历史的入口）与底部备注段。
  { name: '87-commit-code-search-460', query: 'view=commits&hscope=code&q=gate-map' },
  { name: '88-commit-file-only-460', query: 'view=commits&hfile=src/client/views/IssueDetail.ts' },
  { name: '89-compare-form-460', query: 'view=commits&hcompare=1' },
  { name: '90-compare-result-460', query: 'view=commits&hcompared=1' },
  // 提交详情整页比默认列表高：这两张也用高窗口，从标题到备注一次截全，不截半截。
  { name: '91-commit-file-menu-460', query: 'view=commits&open=' + HEAD_OID, clicks: ['.commit-file-more'], viewport: TALL },
  { name: '92-commit-note-380-light', query: 'view=commits&open=' + HEAD_OID, width: 380, theme: 'light', viewport: { width: 760, height: 1200 } },
]

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const problems = []
  for (const shot of SHOTS) {
    const width = shot.width ?? 460
    const params = new URLSearchParams({ width: String(width), theme: shot.theme ?? 'dark' })
    for (const pair of shot.query.split('&')) {
      const index = pair.indexOf('=')
      params.set(pair.slice(0, index), pair.slice(index + 1))
    }
    if (shot.embed === true) params.set('embed', '1')
    const viewport = shot.viewport ?? (shot.embed === true
      ? { width: 620, height: 1250 }
      : { width: Math.max(760, width + 320), height: 940 })
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => problems.push(shot.name + ' 页面异常：' + error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(shot.name + ' 控制台报错：' + message.text())
    })
    await page.goto(INDEX + '?' + params.toString())
    await page.waitForSelector('.panel')
    await page.waitForTimeout(120)
    for (const step of shot.clicks ?? []) {
      // 一步要么是选择器（点一下，等 150ms 让重画落定），要么是 { click, wait }：
      // 提交这类动作有模拟往返，必须等结果条出来再截，否则截到的是「提交中…」。
      const selector = typeof step === 'string' ? step : step.click
      await page.click(selector)
      await page.waitForTimeout(typeof step === 'string' ? 150 : step.wait)
    }
    if (typeof shot.scrollTo === 'string') {
      await page.evaluate((target) => {
        if (target === 'bottom') {
          const scroller = document.querySelector('.page-scroll')
          if (scroller !== null) scroller.scrollTop = scroller.scrollHeight
          return
        }
        const node = document.querySelector(target)
        if (node !== null) node.scrollIntoView({ block: 'start' })
      }, shot.scrollTo)
      await page.waitForTimeout(80)
    }
    await page.locator('.panel').screenshot({ path: resolve(OUT, shot.name + '.png') })
    await page.close()
    console.log('已截图 ' + shot.name)
  }
  await browser.close()
  if (problems.length > 0) {
    console.error('\n页面在截图过程中报错，先修掉再看图：')
    for (const problem of problems) console.error(' - ' + problem)
    process.exitCode = 1
    return
  }
  console.log('\n共 ' + SHOTS.length + ' 张，全部成功。')
}

void main()