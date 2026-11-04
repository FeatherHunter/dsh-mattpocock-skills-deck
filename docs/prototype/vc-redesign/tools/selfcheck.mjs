/**
 * tools/selfcheck.mjs —— 用无头浏览器把 #1876 补画的 16 条入口逐条点一遍。
 *
 * 为什么要有它：截图只说明「画成什么样」，说明不了「点下去会不会变」。
 * 这张票补的入口大多是状态变化（暂存一块、改路径、建分支、收储藏），只有真的点一遍才验得出来。
 *
 * 运行（仓库根目录，先构建一次）：
 *   node docs/prototype/vc-redesign/scripts/build.ts
 *   node docs/prototype/vc-redesign/tools/selfcheck.mjs
 *
 * 它不是门禁：原型在 docs/ 下，不参与 npm run verify:parallel；改了原型之后手动跑一次即可。
 * 断言按页签分组，失败会打印「哪一条、实际是什么」，退出码非零。
 */
import { chromium } from 'playwright'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const INDEX = pathToFileURL(resolve(ROOT, 'index.html')).href

/** 改动页里一个已跟踪的未暂存文件：改名、停止跟踪、删除三条都拿它当样本。 */
const ROW_PATH = 'src/client/views/shared/workRouteTable.ts'
/** 逐块暂存的样本文件：示例补丁给它排了两个块。 */
const HUNK_PATH = 'src/client/views/shared/workRouteTable.ts'
/** 代码搜的样本词：采集到的提交里有 17 条改过 tests/gate-map.json。 */
const CODE_QUERY = 'gate-map'
/** 单文件历史的样本：最近 50 条里有 4 条改过它。 */
const HISTORY_FILE = 'src/client/views/IssueDetail.ts'
/** 列表里最新一条提交的完整提交号：打开详情要用它。 */
const HEAD_OID = 'e489673f240ed18a2e71bb6de5bfc635b2fed73c'

const failures = []
function check(label, ok, detail) {
  if (ok) {
    console.log('PASS  ' + label)
    return
  }
  failures.push(label + (detail === undefined ? '' : ' — ' + detail))
  console.log('FAIL  ' + label + (detail === undefined ? '' : ' — ' + detail))
}

async function open(page, query) {
  await page.goto(INDEX + query)
  await page.waitForSelector('.panel')
  await page.waitForTimeout(150)
}

/** 一、改动页行级三条（1.9 删除已跟踪、1.10 停止跟踪、1.11 改名）。 */
async function changesRowActions(page) {
  console.log('\n== 改动页行级动作（1.9 / 1.10 / 1.11）==')

  await open(page, '?view=changes&menu=' + ROW_PATH)
  const menuItems = await page.locator('.row-menu-item').allTextContents()
  check('行菜单里有改名的入口', menuItems.some((t) => t.includes('重命名或移动')), JSON.stringify(menuItems))
  check('行菜单里有停止跟踪的入口', menuItems.some((t) => t.includes('停止跟踪')), JSON.stringify(menuItems))
  check('行菜单里有删除已跟踪文件的入口', menuItems.some((t) => t.includes('删除已跟踪的文件')), JSON.stringify(menuItems))

  // 改名：表单预填当前路径，保存后这一行按新路径出现在「已暂存」里。
  await page.locator('.row-menu-item').filter({ hasText: '重命名或移动' }).click()
  await page.waitForSelector('.rename-form')
  check('改名表单预填当前路径', (await page.locator('[data-field="rename"]').inputValue()) === ROW_PATH)
  const renamed = 'src/client/views/shared/_renamed-demo.ts'
  await page.locator('[data-field="rename"]').fill(renamed)
  await page.locator('[data-action="rename-apply"]').click()
  await page.waitForTimeout(250)
  const stagedNames = await page.locator('.group-staged .file-name').allTextContents()
  check('改名后按新路径出现在已暂存', stagedNames.includes('_renamed-demo.ts'), JSON.stringify(stagedNames))
  check('改名结果条写清楚', ((await page.locator('.result-text').textContent()) ?? '').includes('改名'))

  // 停止跟踪：先贴行确认，确认后这一行从列表消失，文件仍在磁盘上。
  await open(page, '?view=changes&menu=' + ROW_PATH)
  await page.locator('.row-menu-item').filter({ hasText: '停止跟踪' }).click()
  await page.waitForSelector('.changes-confirm')
  check('停止跟踪先贴行确认', ((await page.locator('.changes-confirm-title').textContent()) ?? '').includes('停止跟踪'))
  await page.locator('[data-action="changes-apply"]').click()
  await page.waitForTimeout(250)
  check('停止跟踪后这一行不再出现', await page.locator('[data-action="toggle-file"][data-path="' + ROW_PATH + '"]').count() === 0)
  check('停止跟踪结果写明文件还在', ((await page.locator('.result-text').textContent()) ?? '').includes('文件还在磁盘上'))

  // 删除已跟踪：确认后这次删除本身变成一条已暂存的改动。
  await open(page, '?view=changes&menu=' + ROW_PATH)
  await page.locator('.row-menu-item').filter({ hasText: '删除已跟踪的文件' }).click()
  await page.waitForSelector('.changes-confirm')
  check('删除已跟踪文件先贴行确认', await page.locator('.changes-confirm-meta').count() === 1)
  await page.locator('[data-action="changes-apply"]').click()
  await page.waitForTimeout(250)
  check('删除这次已进「已暂存」', await page.locator('.group-staged [data-action="toggle-file"][data-path="' + ROW_PATH + '"]').count() === 1)
  check('删除结果写明已暂存', ((await page.locator('.result-text').textContent()) ?? '').includes('已经暂存'))
}

/** 二、逐块暂存（1.2）。 */
async function hunkStaging(page) {
  console.log('\n== 逐块暂存（1.2）==')
  const rowIn = (group) => page.locator('.group-' + group + ' [data-action="toggle-file"][data-path="' + HUNK_PATH + '"]').count()
  const badges = async () => page.locator('.file-row-wrap:has([data-path="' + HUNK_PATH + '"]) .file-extras .chip').allTextContents()

  await open(page, '?width=460&expand=' + HUNK_PATH)
  check('展开后有两块', await page.locator('.hunk').count() === 2, String(await page.locator('.hunk').count()))
  check('两块都写着「暂存这一块」', (await page.locator('.hunk-act').allTextContents()).join('|') === '暂存这一块|暂存这一块')
  check('还没暂存时行上没有块数标签', !(await badges()).some((t) => t.includes('/2 块')), JSON.stringify(await badges()))

  await page.locator('.hunk').nth(0).locator('.hunk-act').click()
  await page.waitForTimeout(200)
  check('暂存一块后结果条写还剩几块', ((await page.locator('.result-text').textContent()) ?? '').includes('还剩 1 块'))
  check('行上出现「已暂存 1/2 块」', (await badges()).includes('已暂存 1/2 块'), JSON.stringify(await badges()))
  check('第一块压暗并换成取消暂存', (await page.locator('.hunk').nth(0).getAttribute('class')) === 'hunk is-staged')
  check('部分暂存后这一行仍在未暂存', (await rowIn('unstaged')) === 1 && (await rowIn('staged')) === 0)
  check('提交区还没有已暂存文件', (await page.locator('.composer-count .count').textContent()) === '0')

  await page.locator('.hunk').nth(1).locator('.hunk-act').click()
  await page.waitForTimeout(200)
  check('最后一块暂完后整份进已暂存', (await rowIn('staged')) === 1 && (await rowIn('unstaged')) === 0)
  check('提交区跟着变成 1 个文件', (await page.locator('.composer-count .count').textContent()) === '1')

  await open(page, '?width=460&stageall=1&expand=' + HUNK_PATH)
  await page.waitForSelector('.hunk')
  await page.locator('.hunk').nth(0).locator('.hunk-act').click()
  await page.waitForTimeout(200)
  check('从整份已暂存里退回一块：行回到未暂存', (await rowIn('unstaged')) === 1 && (await rowIn('staged')) === 0)
  check('退回后行上写「已暂存 1/2 块」', (await badges()).includes('已暂存 1/2 块'))

  await open(page, '?width=300&expand=' + HUNK_PATH)
  const overflow = await page.evaluate(() => {
    const bar = document.querySelector('.hunk-bar')
    return bar === null ? -1 : bar.scrollWidth - bar.clientWidth
  })
  check('300 宽下块头不横向溢出', overflow === 0, String(overflow))
}

/** 三、提交历史四条（3.4 / 3.7 / 3.8 / 3.12）。 */
async function historyCapabilities(page) {
  console.log('\n== 提交历史四条（3.4 / 3.7 / 3.8 / 3.12）==')

  // 3.7 按代码变化搜
  await open(page, '?view=commits&hscope=code&q=' + CODE_QUERY)
  const codeRows = await page.locator('.commit-row').count()
  check('代码范围内搜到至少一条', codeRows > 0 && codeRows < 50, String(codeRows))
  const hitChips = await page.locator('.commit-marks').allTextContents()
  check('每条命中行都标出命中文件', hitChips.length === codeRows && hitChips.every((t) => t.includes('命中')), JSON.stringify(hitChips.slice(0, 3)))
  check('范围按钮停在代码变化', (await page.locator('.scope-btn.is-on').textContent()) === '代码变化')
  await page.locator('.scope-btn').filter({ hasText: '说明' }).click()
  await page.waitForTimeout(150)
  check('切回说明范围后结果不同', (await page.locator('.commit-row').count()) !== codeRows)

  // 3.4 单文件历史
  await open(page, '?view=commits&hfile=' + HISTORY_FILE)
  check('「只看」标签写出文件', (await page.locator('.history-file-only .file-only-path').textContent()) === HISTORY_FILE)
  const fileRows = await page.locator('.commit-row').count()
  check('只看文件时列表有内容且少于全部', fileRows > 0 && fileRows < 50, String(fileRows))
  await page.locator('.file-only-clear').click()
  await page.waitForTimeout(150)
  check('点叉之后标签消失', await page.locator('.history-file-only').count() === 0)

  await open(page, '?view=commits')
  await page.locator('.commit-row').first().click()
  await page.waitForSelector('.commit-file')
  await page.locator('.commit-file-more').first().click()
  await page.waitForTimeout(150)
  check('文件行菜单里有「看这个文件的历史」', (await page.locator('.commit-file-wrap .row-menu-item').first().textContent()) === '看这个文件的历史')
  await page.locator('.commit-file-wrap .row-menu-item').first().click()
  await page.waitForTimeout(200)
  check('点完之后回到列表并带上只看标签', await page.locator('.history-file-only').count() === 1)

  // 3.8 比较两个引用
  await open(page, '?view=commits&hcompare=1')
  check('比较表单预填 HEAD~1 与 HEAD',
    (await page.locator('[data-field="compare-from"]').inputValue()) === 'HEAD~1'
    && (await page.locator('[data-field="compare-to"]').inputValue()) === 'HEAD')
  await page.locator('[data-action="compare-apply"]').click()
  await page.waitForTimeout(200)
  check('比较结果头出现', await page.locator('.compare-head').count() === 1)
  check('结果头写清两端与文件数', ((await page.locator('.compare-head').textContent()) ?? '').includes('个文件'))
  check('比较时不显示提交行', await page.locator('.commit-row').count() === 0)
  await page.locator('.compare-head .link-btn').click()
  await page.waitForTimeout(200)
  check('退出比较后回到提交列表', await page.locator('.compare-head').count() === 0 && await page.locator('.commit-row').count() > 0)

  await page.locator('[data-action="compare-open"]').click()
  await page.waitForTimeout(120)
  await page.locator('[data-field="compare-from"]').fill('nope')
  await page.locator('[data-action="compare-apply"]').click()
  await page.waitForTimeout(200)
  check('认不出的引用给出明确提示', ((await page.locator('.result-text').textContent()) ?? '').includes('找不到「nope」'))

  // 3.12 提交备注
  await open(page, '?view=commits')
  await page.locator('.commit-row').first().click()
  await page.waitForSelector('.detail-notes')
  await page.locator('[data-field="note"]').fill('这一版为了兼容旧数据，先不动索引格式。')
  await page.waitForTimeout(120)
  await page.locator('[data-action="note-save"]').click()
  await page.waitForTimeout(200)
  check('保存后结果条写已保存', ((await page.locator('.result-text').textContent()) ?? '').includes('已保存'))
  check('详情里出现「已有备注」', await page.locator('.detail-notes-head .chip').count() === 1)
  await page.locator('.back-btn').click()
  await page.waitForTimeout(200)
  const tags = await page.locator('.commit-marks').allTextContents()
  check('列表首行带上「备注」标签', tags.length > 0 && tags[0].includes('备注'), JSON.stringify(tags.slice(0, 3)))

  await page.setViewportSize({ width: 700, height: 1100 })
  await open(page, '?width=300&view=commits&hcompare=1')
  const overflow = await page.evaluate(() => {
    const row = document.querySelector('.history-scope-row')
    return row === null ? -1 : row.scrollWidth - row.clientWidth
  })
  check('300 宽工具条不横向溢出', overflow === 0, String(overflow))
  await page.setViewportSize({ width: 820, height: 1100 })
}

/** 四、工作区四条（9.2 / 9.3 / 9.7 / 9.8）。 */
async function worktreeCapabilities(page) {
  console.log('\n== 工作区四条（9.2 / 9.3 / 9.7 / 9.8）==')
  const NEW_PATH = 'D:/repo/.worktrees/1876-demo'

  await open(page, '?view=worktrees')
  await page.waitForSelector('.wt-row')
  await page.locator('[data-action="wt-create-open"]').click()
  await page.waitForSelector('.wt-create')
  await page.locator('[data-action="wt-create-submit"]').click()
  await page.waitForTimeout(150)
  check('空目录时报错留在表单里', ((await page.locator('.wt-form-error').textContent()) ?? '').includes('先填一个目录'))

  await page.locator('[data-field="wt-create-path"]').fill(NEW_PATH)
  await page.locator('[data-field="wt-create-branch"]').fill('ticket/1876-demo')
  await page.locator('[data-action="wt-create-submit"]').click()
  await page.waitForTimeout(250)
  check('提交后表单收起', await page.locator('.wt-create').count() === 0)
  check('结果条写出新建的名字与分支', ((await page.locator('.result-text').textContent()) ?? '').includes('ticket/1876-demo'))
  check('新工作区排在清单最前', (await page.locator('.wt-row .wt-name').first().textContent()) === '1876-demo')

  await page.locator('[data-action="wt-create-open"]').click()
  await page.waitForTimeout(120)
  await page.locator('[data-field="wt-create-path"]').fill(NEW_PATH)
  await page.locator('[data-field="wt-create-branch"]').fill('ticket/another')
  await page.locator('[data-action="wt-create-submit"]').click()
  await page.waitForTimeout(150)
  check('同一个目录不能登记两次', ((await page.locator('.wt-form-error').textContent()) ?? '').includes('已经登记成工作区'))
  await page.locator('[data-action="wt-create-mode"][data-mode="existing"]').click()
  await page.waitForTimeout(150)
  check('已有分支给出最近用过的候选', (await page.locator('.wt-recent-chip').count()) > 0)
  const firstChip = (await page.locator('.wt-recent-chip').first().textContent()) ?? ''
  await page.locator('.wt-recent-chip').first().click()
  await page.waitForTimeout(120)
  check('点候选就把分支名填进输入框', (await page.locator('[data-field="wt-create-branch"]').inputValue()) === firstChip)
  await page.locator('[data-field="wt-create-branch"]').fill('no-such-branch')
  await page.locator('[data-action="wt-create-submit"]').click()
  await page.waitForTimeout(150)
  check('本地没有这条分支时给出提示', ((await page.locator('.wt-form-error').textContent()) ?? '').includes('本地没有这条分支'))
  await page.locator('[data-action="wt-create-close"]').click()
  await page.waitForTimeout(120)

  await page.locator('.wt-row [data-action="wt-expand"]').first().click()
  await page.waitForTimeout(150)
  await page.locator('[data-action="wt-move-open"]').first().click()
  await page.waitForTimeout(150)
  const moveInput = page.locator('[data-field="wt-move"]')
  check('移动输入框预填当前路径', ((await moveInput.inputValue()) ?? '').endsWith('1876-demo'), await moveInput.inputValue())
  await moveInput.fill('D:/repo/.worktrees/1876-moved')
  await page.locator('[data-action="wt-move-apply"]').first().click()
  await page.waitForTimeout(250)
  check('移动后清单里换成新目录名', (await page.locator('.wt-row .wt-name').allTextContents()).includes('1876-moved'))

  await page.locator('.wt-row [data-action="wt-expand"]').first().click()
  await page.waitForTimeout(150)
  await page.locator('[data-action="wt-sparse-open"]').first().click()
  await page.waitForSelector('.wt-dirs')
  const dirCount = await page.locator('.wt-dir').count()
  check('稀疏检出列出顶层目录', dirCount > 0, String(dirCount))
  check('没有旧规则时默认全都保留', (await page.locator('.wt-dir.is-on').count()) === dirCount)
  await page.locator('.wt-dir').filter({ hasText: 'docs' }).first().click()
  await page.waitForTimeout(120)
  await page.locator('[data-action="wt-sparse-save"]').click()
  await page.waitForTimeout(250)
  const sparseResult = (await page.locator('.result-text').textContent()) ?? ''
  check('保存后结果条写保留哪些目录', sparseResult.includes('只保留') && !sparseResult.includes('docs'), sparseResult)
  check('展开行里常驻一句当前规则', await page.locator('.wt-fact-v').filter({ hasText: '当前规则' }).count() === 1)

  await page.setViewportSize({ width: 700, height: 1100 })
  await open(page, '?width=300&view=worktrees&wtnew=1&wtnewpath=D:/repo/.worktrees/1800-new&wtnewbranch=ticket/1800')
  await page.waitForSelector('.wt-create')
  const overflow = await page.evaluate(() => {
    const form = document.querySelector('.wt-create')
    return form === null ? -1 : form.scrollWidth - form.clientWidth
  })
  check('300 宽下新建表单不横向溢出', overflow === 0, String(overflow))
  await page.setViewportSize({ width: 820, height: 1100 })
}

/** 五、储藏四条（7.2 / 7.3 / 7.8 / 7.10）。 */
async function stashCapabilities(page) {
  console.log('\n== 储藏四条（7.2 / 7.3 / 7.8 / 7.10）==')

  await open(page, '?view=changes')
  await page.waitForSelector('.file-row')
  const untrackedBefore = await page.locator('.file-extras .chip').filter({ hasText: '未跟踪' }).count()
  check('工作区里有未跟踪的新文件', untrackedBefore > 0, String(untrackedBefore))
  await page.locator('[data-action="stash-create"]').first().click()
  await page.waitForTimeout(250)
  check('默认储藏写「已跟踪改动」', ((await page.locator('.result-text').textContent()) ?? '').includes('已跟踪改动'))
  check('未跟踪的新文件留在工作区',
    (await page.locator('.file-extras .chip').filter({ hasText: '未跟踪' }).count()) === untrackedBefore)

  await page.locator('[data-action="stash-menu-toggle"]').click()
  await page.waitForTimeout(150)
  check('箭头打开储藏方式菜单', await page.locator('.stash-menu').count() === 1)
  check('菜单里有三种收法', await page.locator('.stash-opt').count() === 3)
  await page.locator('.stash-opt').filter({ hasText: '连未跟踪' }).click()
  await page.waitForTimeout(250)
  check('连未跟踪一起储藏写清个数', ((await page.locator('.result-text').textContent()) ?? '').includes('未跟踪'))
  check('工作区此后是干净的', await page.locator('.file-row').count() === 0)

  await open(page, '?view=changes')
  await page.waitForSelector('.file-row')
  await page.locator('[data-action="stage"]').first().click()
  await page.waitForTimeout(150)
  const stagedName = (await page.locator('.group-staged .file-name').first().textContent()) ?? ''
  await page.locator('[data-action="stash-menu-toggle"]').click()
  await page.waitForTimeout(120)
  await page.locator('.stash-opt').filter({ hasText: '只储藏已暂存' }).click()
  await page.waitForTimeout(250)
  check('只储藏已暂存写清收的是索引', ((await page.locator('.result-text').textContent()) ?? '').includes('已暂存内容'))
  check('那个文件仍留在工作区（变成未暂存）', (await page.locator('.group-unstaged').innerText()).includes(stagedName), stagedName)
  check('索引已经空了', (await page.locator('.composer-count .count').textContent()) === '0')

  await open(page, '?view=stash&stashdemo=1')
  await page.waitForSelector('.stash-row')
  check('储藏页有一条记录', await page.locator('.stash-row').count() === 1)
  await page.locator('.stash-more').first().click()
  await page.waitForTimeout(150)
  check('记录行菜单里有「从这条记录建分支」', ((await page.locator('.row-menu-item').first().textContent()) ?? '').includes('建分支'))
  await page.locator('.row-menu-item').first().click()
  await page.waitForSelector('[data-field="stash-branch"]')
  check('建分支表单预填分支名', (await page.locator('[data-field="stash-branch"]').inputValue()) === 'stash-branch')
  await page.locator('[data-field="stash-branch"]').fill('stash/demo')
  await page.locator('[data-action="stash-branch-apply"]').click()
  await page.waitForTimeout(250)
  const branchResult = (await page.locator('.result-text').textContent()) ?? ''
  check('结果条写清建了哪条分支', branchResult.includes('stash/demo') && branchResult.includes('回到工作区'), branchResult)
  check('记录已经用掉', await page.locator('.stash-row').count() === 0)

  await open(page, '?view=stash&stashdemo=1')
  await page.waitForSelector('.stash-row')
  await page.locator('[data-action="stash-clear-open"]').click()
  await page.waitForSelector('.stash-clear-card')
  check('清空先问一句', ((await page.locator('.stash-clear-card .stash-confirm-title').textContent()) ?? '').includes('清空'))
  await page.locator('[data-action="stash-clear-apply"]').click()
  await page.waitForTimeout(250)
  check('清空后结果条写条数', ((await page.locator('.result-text').textContent()) ?? '').includes('已清空'))
  check('记录清空后回到空态', await page.locator('.stash-row').count() === 0)

  await page.setViewportSize({ width: 700, height: 1100 })
  await open(page, '?width=300&view=changes&stashmenu=1')
  await page.waitForSelector('.stash-menu')
  const overflow = await page.evaluate(() => {
    const menu = document.querySelector('.stash-menu')
    return menu === null ? -1 : menu.scrollWidth - menu.clientWidth
  })
  check('300 宽下储藏方式菜单不横向溢出', overflow === 0, String(overflow))
  await page.setViewportSize({ width: 820, height: 1100 })
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 820, height: 1100 } })
  const errors = []
  page.on('pageerror', (error) => errors.push('页面异常：' + error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('控制台：' + message.text())
  })

  await changesRowActions(page)
  await hunkStaging(page)
  await historyCapabilities(page)
  await worktreeCapabilities(page)
  await stashCapabilities(page)

  check('页面没有报错', errors.length === 0, errors.join(' / '))
  await browser.close()

  console.log('\n' + (failures.length === 0 ? '全部通过' : failures.length + ' 条失败'))
  if (failures.length > 0) {
    console.log('\n失败清单：')
    for (const item of failures) console.log(' - ' + item)
    process.exitCode = 1
  }
}

await main()
