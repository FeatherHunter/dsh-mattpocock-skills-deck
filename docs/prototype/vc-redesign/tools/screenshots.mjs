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
 *   embed   嵌入模式（只留产品面板，用于文档内引用）；
 *   viewport 浏览器窗口尺寸，按内容高度微调，保证面板本体截图不变形。
 */
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
  // 分组标题右侧的两颗动作（全部暂存 / 丢弃全部）作为一组靠右：补一张改动页，评审看对齐时不用自己点数。
  { name: '62-changes-460', query: 'view=changes' },
  { name: '63-changes-300', query: 'view=changes', width: 300 },
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
    const viewport = shot.embed === true
      ? { width: 620, height: 1250 }
      : { width: Math.max(760, width + 320), height: 940 }
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    page.on('pageerror', (error) => problems.push(shot.name + ' 页面异常：' + error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(shot.name + ' 控制台报错：' + message.text())
    })
    await page.goto(INDEX + '?' + params.toString())
    await page.waitForSelector('.panel')
    await page.waitForTimeout(120)
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