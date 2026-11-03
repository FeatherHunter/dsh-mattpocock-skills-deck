// verify/scenarios/1833-probe.ts —— 一次性探针（第四版）：真鼠标点开 MattSkills 面板。
//
// 前三版的教训（照着改，不要回退）：
//   1) 场景 id 必须以小写字母开头（SCENARIO_ID_RE = /^[a-z][a-z0-9-]{1,63}$/）；
//   2) browser.mjs 用 viewport:null 建上下文，适配器没有 setViewportSize —— 这里的视口恒为 headless
//      的 800x600；「真全屏」只能走 verify/windows.mjs 那条有头路线；
//   3) 第三版用 page.evaluate 里的 el.click() 点「MattSkills」与状态栏横幅，右侧边栏确实展开了
//      （工具列表出现），但面板没挂出来 —— 合成 click 可能被组件里的 pointerdown 处理跳过。
//      这一版先记下元素，再用适配器的 click(selector) 走真鼠标（Playwright locator.click）。
import path from 'node:path'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { PageHandle, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import { hooks } from '../hooks.ts'

/** 本仓库根：已初始化过的真实工作区，列表页能挂出来。 */
const REPO_ROOT = 'D:/dsh-plugin/dsh-mattpocock-skills-deck'
const WORKSPACE_BUTTON = 'button[aria-label="选择工作区"]'
const CLOSE_BUTTON = 'button[aria-label="关闭"]'
const OPEN_RIGHTBAR = 'button[aria-label="打开右侧边栏"]'
const MASK_COUNT_SCRIPT = 'document.querySelectorAll(' + JSON.stringify('[class*="_mask_"]') + ').length'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

async function evaluateThrough<T>(page: PageHandle, script: string): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  const result = await page.evaluate<T>(script)
  return result.ok ? { ok: true, value: result.value } : { ok: false, message: result.error.message }
}

function rpcScript(method: string, argsExpression: string): string {
  return [
    '(async function () {',
    '  var rpcId = globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now());',
    '  var body = { type: "client-request", rpcId: rpcId, method: ' + JSON.stringify(method) + ', payload: { args: ' + argsExpression + ' } };',
    '  var response = await fetch("/api/" + ' + JSON.stringify(method) + ', {',
    '    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),',
    '  });',
    '  var text = await response.text();',
    '  var parsed = null;',
    '  try { parsed = JSON.parse(text); } catch (error) { parsed = null; }',
    '  return { status: response.status, body: parsed, text: text.slice(0, 2000) };',
    '})()',
  ].join('\n')
}

/** 给页面上文字正好等于 label 的元素打 data-probe-mark，返回是否找到。真点击交给适配器。 */
function markByTextScript(label: string): string {
  return [
    '(function () {',
    '  var label = ' + JSON.stringify(label) + ';',
    '  var all = Array.prototype.slice.call(document.querySelectorAll("button,[role=button],[role=menuitem],[role=tab],a,div,span"));',
    '  for (var i = 0; i < all.length; i += 1) {',
    '    var el = all[i];',
    '    var t = (el.textContent || "").replace(/\\s+/g, " ").trim();',
    '    if (t !== label) continue;',
    '    var target = el.closest("button,[role=button],[role=menuitem],[role=tab],a") || el;',
    '    target.setAttribute("data-probe-mark", "1");',
    '    var r = target.getBoundingClientRect();',
    '    return { ok: true, tag: target.tagName.toLowerCase(), cls: String(target.className || "").slice(0, 120), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };',
    '  }',
    '  return { ok: false };',
    '})()',
  ].join('\n')
}

const INSPECT_SCRIPT = [
  '(function () {',
  '  function textOf(el) { return (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160); }',
  '  function box(el) { var r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }',
  '  function each(list) { return Array.prototype.slice.call(list); }',
  '  var body = document.querySelector(".dsws-body");',
  '  var sticky = document.querySelector("[data-list-sticky]");',
  '  var kpi = document.querySelector("[data-list-head=\\"kpi\\"]");',
  '  var fail = document.querySelector("[data-head-fail]");',
  '  var notice = document.querySelector("[data-notice-budget]");',
  '  var tabs = each(document.querySelectorAll("[class*=\\"_tab_\\"]")).filter(function (el) {',
  '    return el.children.length <= 3 && (el.textContent || "").trim().length > 0;',
  '  }).slice(0, 30).map(function (el) { return { cls: String(el.className || "").slice(0, 80), text: textOf(el).slice(0, 30), box: box(el) }; });',
  '  return {',
  '    url: location.href,',
  '    viewport: { w: window.innerWidth, h: window.innerHeight },',
  '    bodyTextTail: (document.body.innerText || "").slice(-1800),',
  '    hasBody: !!body,',
  '    bodyBox: body ? box(body) : null,',
  '    bodyScroll: body ? { scrollTop: Math.round(body.scrollTop), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null,',
  '    stickyBox: sticky ? box(sticky) : null,',
  '    stickyText: sticky ? textOf(sticky).slice(0, 300) : null,',
  '    kpiBox: kpi ? box(kpi) : null,',
  '    failBox: fail ? box(fail) : null,',
  '    failText: fail ? textOf(fail).slice(0, 60) : null,',
  '    noticeBox: notice ? box(notice) : null,',
  '    noticeText: notice ? textOf(notice).slice(0, 120) : null,',
  '    tabs: tabs,',
  '    dswsCount: document.querySelectorAll("[class*=\\"dsws-\\"]").length,',
  '  };',
  '})()',
].join('\n')

/** 把面板滚动容器推到底，再量一次吸顶块的位置 —— 吸顶了就该停在容器顶边，没吸顶就跟着滚走。 */
const SCROLL_SCRIPT = [
  '(function () {',
  '  function box(el) { var r = el.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height) }; }',
  '  var body = document.querySelector(".dsws-body");',
  '  var sticky = document.querySelector("[data-list-sticky]");',
  '  if (!body || !sticky) return { ok: false, reason: !body ? "no .dsws-body" : "no [data-list-sticky]" };',
  '  var before = { scrollTop: Math.round(body.scrollTop), sticky: box(sticky), body: box(body) };',
  '  body.scrollTop = Math.round(body.scrollHeight * 0.5);',
  '  var mid = { scrollTop: Math.round(body.scrollTop), sticky: box(sticky), body: box(body) };',
  '  body.scrollTop = body.scrollHeight;',
  '  var end = { scrollTop: Math.round(body.scrollTop), sticky: box(sticky), body: box(body) };',
  '  body.scrollTop = 0;',
  '  return { ok: true, before: before, mid: mid, end: end };',
  '})()',
].join('\n')

/** 点开通知中心：先给面板头部那枚铃铛打标记，返回它的位置与 data-log，真点击交给适配器。 */
const MARK_NOTICE_SCRIPT = [
  '(function () {',
  '  function textOf(el) { return (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim(); }',
  '  var all = Array.prototype.slice.call(document.querySelectorAll("button,[data-log],[data-press]"));',
  '  for (var i = 0; i < all.length; i += 1) {',
  '    var el = all[i];',
  '    var log = String(el.getAttribute("data-log") || "");',
  '    var aria = String(el.getAttribute("aria-label") || "");',
  '    var cls = String(el.className || "");',
  '    if (log.indexOf("notice") === 0 || aria.indexOf("通知") >= 0 || cls.indexOf("dsws-bell") >= 0) {',
  '      el.setAttribute("data-probe-notice", "1");',
  '      var r = el.getBoundingClientRect();',
  '      return { ok: true, log: log, aria: aria, cls: cls.slice(0, 120), text: textOf(el).slice(0, 40), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };',
  '    }',
  '  }',
  '  return { ok: false };',
  '})()',
].join('\n')

export default defineScenario({
  id: 'listhead-probe',
  title: 'probe the real panel: open it with real mouse clicks and measure the sticky list header',
  description: 'Fourth probe: real-mouse click the status banner and the right sidebar entries, dump the panel DOM and measure the sticky header before/after scrolling. Not a verdict.',
  hooks,
  steps: [
    { id: 'launch', kind: 'launch', title: 'start the installed candidate' },
    {
      id: 'probe',
      kind: 'custom',
      title: 'open the panel with real mouse clicks and measure the list header',
      run: async (context) => {
        const observations: ScenarioObservation[] = []
        const page = await context.primitives.page()
        if (!page.ok || context.instance === null) {
          return [{ checkId: 'probe-page', title: 'a page can be opened', ok: false, status: 'blocked', detail: page.ok ? 'no instance' : page.error.message, expected: 'page handle', actual: page.ok ? 'instance null' : page.error.message }]
        }
        const instance = context.instance
        const facts: Record<string, unknown> = { tokenUrl: '<omitted>' }
        const record = async (name: string, value: unknown, note: string): Promise<void> => {
          const saved = await context.evidence.recordJson(name, value, { note })
          if (!saved.ok) facts['evidenceProblem:' + name] = saved.error.message
          else facts['evidence:' + name] = saved.value.path
        }
        const inspect = async (label: string): Promise<any> => {
          const got = await evaluateThrough<Record<string, unknown>>(page.value, INSPECT_SCRIPT)
          facts[label] = got.ok ? got.value : { error: got.message }
          return got.ok ? got.value : null
        }
        const mark = async (label: string): Promise<any> => {
          const got = await evaluateThrough<Record<string, unknown>>(page.value, markByTextScript(label))
          return got.ok ? got.value : { ok: false, error: got.message }
        }
        // 适配器只保证 BrowserPageHandle；goto/click/press 是插件侧适配器额外给的（同 verify/scenarios/ui.ts），
        // 挂在 page.value.page 上，不在 page.value 本身上。
        const raw = page.value.page as {
          goto?: (url: string) => Promise<unknown>
          click?: (selector: string) => Promise<{ ok: boolean; error?: { message?: string } }>
          press?: (key: string) => Promise<unknown>
        }
        const realClick = async (selector: string): Promise<Record<string, unknown>> => {
          if (raw.click === undefined) return { ok: false, error: 'the browser adapter exposes no click()' }
          const clicked = await raw.click(selector)
          return clicked.ok ? { ok: true } : { ok: false, error: clicked.error === undefined ? 'unknown error' : clicked.error.message }
        }
        const clearMark = 'document.querySelectorAll("[data-probe-mark]").forEach(function (el) { el.removeAttribute("data-probe-mark") })'

        if (instance === null) return observations
        if (raw.goto !== undefined) await raw.goto(instance.record.tokenUrl)
        await sleep(2500)
        let maskCount = -1
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const masks = await evaluateThrough<number>(page.value, MASK_COUNT_SCRIPT)
          maskCount = masks.ok ? masks.value : -1
          if (maskCount > 0) {
            if (raw.press !== undefined) await raw.press('Escape')
            await realClick(CLOSE_BUTTON)
            await sleep(300)
            continue
          }
          const text = await page.value.text(WORKSPACE_BUTTON)
          if (text.ok && text.value !== null) break
          await sleep(250)
        }
        facts.maskCount = maskCount

        const createProbe = await evaluateThrough<Record<string, unknown>>(page.value, rpcScript('workspace/create', '{ request: { path: ' + JSON.stringify(REPO_ROOT) + ' } }'))
        let workspaceId: string | null = null
        if (createProbe.ok) {
          const body = createProbe.value.body as Record<string, unknown> | null
          const result = body && typeof body === 'object' ? (body['result'] as Record<string, unknown> | undefined) : undefined
          const value = result && typeof result === 'object' ? (result['value'] as Record<string, unknown> | undefined) : undefined
          const ws = value && typeof value === 'object' ? (value['workspace'] as Record<string, unknown> | undefined) : undefined
          if (ws && typeof ws['workspaceId'] === 'string') workspaceId = ws['workspaceId']
        }
        facts.workspaceId = workspaceId
        if (workspaceId !== null) {
          const sessionProbe = await evaluateThrough<Record<string, unknown>>(page.value, rpcScript('session/create', '{ request: { workspaceId: ' + JSON.stringify(workspaceId) + ' } }'))
          let sessionId: string | null = null
          if (sessionProbe.ok) {
            const body = sessionProbe.value.body as Record<string, unknown> | null
            const result = body && typeof body === 'object' ? (body['result'] as Record<string, unknown> | undefined) : undefined
            const value = result && typeof result === 'object' ? (result['value'] as Record<string, unknown> | undefined) : undefined
            if (value && typeof value['sessionId'] === 'string') sessionId = value['sessionId']
          }
          facts.sessionId = sessionId
        }
        await sleep(3000)
        await inspect('afterSession')

        const steps: Record<string, unknown>[] = []

        // ① 状态栏横幅上的「展开MattSkillsDeck」—— 上一版合成 click 无效，这次真鼠标。
        const banner = await mark('展开MattSkillsDeck')
        steps.push({ action: 'mark-banner', result: banner })
        if (banner !== null && banner['ok'] === true) {
          steps.push({ action: 'realclick-banner', result: await realClick('[data-probe-mark="1"]') })
          await sleep(3500)
          await inspect('afterBannerClick')
          await evaluateThrough(page.value, clearMark)
        }

        // ② 右侧边栏：先点「工作区文件」当对照，确认工具列表里的项点得开页签。
        const openedRightbar = await realClick(OPEN_RIGHTBAR)
        steps.push({ action: 'open-rightbar', result: openedRightbar })
        await sleep(1500)
        await inspect('rightbarOpen')
        const filesEntry = await mark('工作区文件')
        steps.push({ action: 'mark-files-entry', result: filesEntry })
        if (filesEntry !== null && filesEntry['ok'] === true) {
          steps.push({ action: 'realclick-files-entry', result: await realClick('[data-probe-mark="1"]') })
          await sleep(2500)
          await inspect('afterFilesEntryClick')
          await evaluateThrough(page.value, clearMark)
        }

        // ③ 再点「MattSkills」——这才是本任务的入口。
        const deckEntry = await mark('MattSkills')
        steps.push({ action: 'mark-deck-entry', result: deckEntry })
        if (deckEntry !== null && deckEntry['ok'] === true) {
          steps.push({ action: 'realclick-deck-entry', result: await realClick('[data-probe-mark="1"]') })
          await sleep(4000)
          await inspect('afterDeckEntryClick')
          await evaluateThrough(page.value, clearMark)
        }
        facts.steps = steps

        const panel = facts['afterDeckEntryClick'] as Record<string, unknown> | undefined
        facts.panelOpen = { hasBody: panel !== undefined && panel['hasBody'] === true, sticky: panel !== undefined && panel['stickyBox'] !== null, fail: panel !== undefined && panel['failBox'] !== null, notice: panel !== undefined && panel['noticeBox'] !== null }

        if (panel !== undefined && panel['hasBody'] === true) {
          const scrolled = await evaluateThrough<Record<string, unknown>>(page.value, SCROLL_SCRIPT)
          facts.scroll = scrolled.ok ? scrolled.value : { error: scrolled.message }
          await sleep(500)
          await inspect('afterScroll')

          const noticeMark = await evaluateThrough<Record<string, unknown>>(page.value, MARK_NOTICE_SCRIPT)
          facts['noticeMark'] = noticeMark.ok ? noticeMark.value : noticeMark.message
          if (noticeMark.ok && (noticeMark.value as Record<string, unknown>)['ok'] === true) {
            facts['noticeClick'] = await realClick('[data-probe-notice="1"]')
            await sleep(1500)
            await inspect('afterNoticeClick')
          }
        }

        facts.pageErrors = page.value.pageErrors().slice(0, 10)
        const shotPath = path.join(context.evidence.root, 'probe-1833-v4.png')
        const shot = await page.value.screenshot(shotPath)
        facts['screenshot'] = shot.ok ? shot.value : { error: shot.error.message }
        await record('probe-1833-v4.json', facts, '探针第四版：真鼠标点开 MattSkills 面板后的列表吸顶几何、滚动前后读数与通知中心额度行')

        observations.push({
          checkId: 'probe-recorded',
          title: 'the probe recorded page facts',
          ok: true,
          detail: 'facts written to probe-1833-v4.json; screenshot ' + (shot.ok ? String(shot.value.bytes) + ' bytes' : 'failed'),
          expected: 'DOM facts are recorded for the next iteration',
          actual: 'recorded',
          evidence: shot.ok && shot.value.bytes > 0 ? [shotPath] : [],
        })
        return observations
      },
    },
    { id: 'stop', kind: 'stop', title: 'stop the instance' },
  ],
})
