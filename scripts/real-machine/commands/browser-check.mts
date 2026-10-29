// browser-check —— 用无头浏览器打开一个实例，做一组可复核的界面断言并截图。
//
// 用法：
//   node --import ./scripts/ts-hook.mts scripts/real-machine/commands/browser-check.mts
//         --instance <启动目录> [--name 批次内名字] [--screenshot <png路径>]
//         [--expect-workspace <标题片段>] [--expect-cwd <cwd 片段>]
//         [--text-contains <文字> ...] [--json-out <文件>]
//
// 做的事：打开带 token 的地址、关掉首开登录弹窗、读工作区菜单与会话列表、
// 用 elementFromPoint 与 boundingClientRect 检查「选择工作区」按钮、截图、收集控制台错误。
// 输出一段 JSON：checks 全部为 true 时退出码 0，否则退出码 1。

import path from 'node:path'
import fs from 'node:fs'
import { ensureDir, parseArgs, printJson, runCli, stamp } from '../lib/util.mts'
import { loadInstance } from '../lib/launch.mts'
import { openInstance, readDomText, screenshot, sessionList, workspaceMenuTitles } from '../lib/browser.mts'

runCli(async () => {
  const args = parseArgs(process.argv.slice(2))
  const instance = loadInstance(args.require('instance', '启动目录，或其中的 instance.json'))
  const name = args.get('name') || path.basename(instance.dir)
  const checks: { name: string; ok: boolean; detail: string }[] = []
  const check = (checkName: string, ok: boolean, detail: string): void => {
    checks.push({ name: checkName, ok, detail })
  }

  const opened = await openInstance(instance.tokenUrl, { page: { width: 1600, height: 1000 } })
  try {
    check('页面已打开且工作区按钮可见', true, instance.tokenUrl)

    const domText = await readDomText(opened.page)
    check('页面有可见文本', domText.trim().length > 20, '读到的文字长度 ' + domText.trim().length)
    for (const needle of args.getAll('text-contains')) {
      check('页面文字包含「' + needle + '」', domText.indexOf(needle) >= 0, domText.indexOf(needle) >= 0 ? '找到了' : '没找到')
    }

    const titles = await workspaceMenuTitles(opened.page)
    check('工作区菜单有菜单项', titles.length > 0, '菜单项：' + titles.join('、'))
    const expectWorkspace = args.get('expect-workspace')
    if (expectWorkspace) {
      check(
        '工作区菜单包含「' + expectWorkspace + '」',
        titles.some((title) => title.indexOf(expectWorkspace) >= 0),
        '实际菜单：' + titles.join('、'),
      )
    }

    const listResponse = await sessionList(opened.page)
    const items = listResponse && listResponse.body && listResponse.body.result && listResponse.body.result.value && listResponse.body.result.value.items
    const cwd = items && items[0] ? String(items[0].cwd || '') : ''
    check('会话列表能读到 cwd', Boolean(cwd), cwd || '没读到 cwd；响应：' + JSON.stringify(listResponse).slice(0, 300))
    const expectCwd = args.get('expect-cwd')
    if (expectCwd) check('会话 cwd 指向预期目录', cwd.toLowerCase().indexOf(expectCwd.toLowerCase()) >= 0, '实际 cwd：' + cwd)

    const buttonSelector = 'button[aria-label="选择工作区"]'
    const geometry = await opened.page.evaluate((selector: string) => {
      const button = document.querySelector(selector) as HTMLElement | null
      if (!button) return { ok: false, rect: null as any, viewport: { width: innerWidth, height: innerHeight }, point: null as any }
      const rect = button.getBoundingClientRect()
      const centerX = rect.x + rect.width / 2
      const centerY = rect.y + rect.height / 2
      const hit = document.elementFromPoint(centerX, centerY) as HTMLElement | null
      return {
        ok: true,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight },
        point: {
          found: Boolean(hit),
          withinButton: Boolean(hit && button.contains(hit)),
          tag: hit ? hit.tagName.toLowerCase() : '',
          text: hit ? (hit.innerText || hit.textContent || '').trim().slice(0, 80) : '',
        },
      }
    }, buttonSelector)
    check('拿得到「选择工作区」按钮的矩形', Boolean(geometry.ok && geometry.rect), JSON.stringify(geometry.rect))
    if (geometry.ok && geometry.rect) {
      const rect = geometry.rect
      const inside =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= geometry.viewport.width + 1 &&
        rect.y + rect.height <= geometry.viewport.height + 1
      check('按钮矩形在视口范围内（boundingClientRect）', inside, JSON.stringify({ rect, viewport: geometry.viewport }))
      check('按钮中心的 elementFromPoint 落在按钮内', Boolean(geometry.point && geometry.point.withinButton), JSON.stringify(geometry.point))
    }

    const dialogMask = await opened.page.evaluate(() => document.querySelectorAll('[class*="_mask_"]').length)
    check('首开登录弹窗已关闭', dialogMask === 0, '剩余遮罩元素数：' + dialogMask)
    check('页面没有脚本异常', opened.pageErrors.length === 0, opened.pageErrors.slice(0, 3).join('\n') || '没有')

    const screenshotArg = args.get('screenshot')
    let screenshotPath: string
    if (screenshotArg) {
      screenshotPath = screenshotArg
    } else {
      ensureDir(path.join(instance.dir, 'screenshots'))
      screenshotPath = path.join(instance.dir, 'screenshots', stamp() + '-' + name + '.png')
    }
    await screenshot(opened.page, screenshotPath, { fullPage: args.has('full-page') })
    check('截图已生成', fs.existsSync(screenshotPath), screenshotPath)

    const result = {
      instance: { dir: instance.dir, port: instance.port, pid: instance.pid },
      name,
      ok: checks.every((entry) => entry.ok),
      checks,
      workspaceTitles: titles,
      sessionCwd: cwd,
      screenshotPath,
      domTextHead: domText.trim().slice(0, 1500),
      consoleLines: opened.consoleLines.slice(0, 20),
      pageErrors: opened.pageErrors.slice(0, 10),
      checkedAt: new Date().toISOString(),
    }
    const jsonOut = args.get('json-out')
    if (jsonOut) {
      ensureDir(path.dirname(path.resolve(jsonOut)))
      fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(result, null, 2) + '\n', 'utf8')
    }
    printJson(result)
    if (!result.ok) process.exitCode = 1
  } finally {
    await opened.close()
  }
})
