// smoke.ts —— 阶段 B1c：最小两实例冒烟。
//
// 这一条场景不关心插件界面，只证明场景机制自己能驱动两个相互隔离的实例：
// - 两次 launch 各自拿到独立的 instance 目录、home、端口和进程；
// - 两个实例各自能打开浏览器页，并且页面连到的是自己的端口；
// - 不带 id 的 stop() 一次停掉全部实例，停完后没有活动实例、进程也不再存活。
//
// 这是旧真机脚本 verify-parallel 那类「同时起两个实例」覆盖的通用版本；
// 它完全不依赖 verify/hooks.ts 的种子逻辑，因此可以作为最便宜的冒烟入口
// （npm run verify:smoke），先于任何插件特有场景运行。

import path from 'node:path'
import { defineScenario } from 'dsh-featherhunter-plugin-base/real-machine-verification'
import type { InstanceHandle, PageHandle, ScenarioContext, ScenarioObservation } from 'dsh-featherhunter-plugin-base/real-machine-verification'

interface RawBrowserPage {
  readonly goto?: (url: string) => Promise<{ readonly ok: boolean; readonly error?: { readonly message?: string } }>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 路径比较口径和宿主一致：Windows 不区分大小写，斜杠方向也不参与。 */
function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function instanceLabel(handle: InstanceHandle): string {
  return handle.record.instanceId ?? String(handle.pid)
}

function portOf(originUrl: string): number | null {
  try {
    const parsed = new URL(originUrl)
    if (parsed.port.length > 0) return Number(parsed.port)
    return parsed.protocol === 'https:' ? 443 : 80
  } catch {
    return null
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default defineScenario<ScenarioContext>({
  id: 'smoke',
  title: 'two isolated instances run side by side and can be torn down together',
  description:
    'Launches two instances through the scenario primitives, checks that home/dir/port/pid are pairwise distinct, opens one page per instance and confirms each page reaches its own origin, then stops both without naming an id.',
  steps: [
    {
      id: 'launch-first',
      kind: 'launch',
      title: 'start the first instance',
    },
    {
      id: 'launch-second',
      kind: 'launch',
      title: 'start the second instance next to the first',
    },
    {
      id: 'two-instances',
      kind: 'custom',
      title: 'the two instances are isolated and stop without an id stops both',
      run: async (context) => {
        const observations: ScenarioObservation[] = []
        const instances = context.primitives.instances()
        const first = instances[0]
        const second = instances[1]

        observations.push({
          checkId: 'smoke-two-instances',
          title: 'the scenario reports exactly two active instances',
          ok: instances.length === 2,
          detail: 'active instances: ' + instances.map((handle) => instanceLabel(handle) + ' (pid ' + String(handle.pid) + ')').join(', '),
          expected: 'two active instances after two launch steps',
          actual: String(instances.length),
          hint: 'a launch step must not stop or replace the instance launched before it; read the launch step observations',
        })

        if (first === undefined || second === undefined) {
          observations.push({
            checkId: 'smoke-isolation',
            title: 'the two instances are pairwise distinct',
            ok: false,
            status: 'blocked',
            detail: 'the isolation checks need two instances; one of the launch steps did not produce a handle',
            expected: 'two instance handles',
            actual: String(instances.length),
            hint: 'read the failing launch step; the remaining checks are blocked, not failed',
          })
          return observations
        }

        const homesDiffer = !samePath(first.record.home, second.record.home)
        const dirsDiffer =
          first.record.dir !== undefined && second.record.dir !== undefined && !samePath(first.record.dir, second.record.dir)
        const portsDiffer = first.record.port !== second.record.port
        const originsDiffer = first.record.originUrl !== second.record.originUrl
        observations.push({
          checkId: 'smoke-isolated-homes',
          title: 'each instance gets its own home and instance directory',
          ok: homesDiffer && dirsDiffer,
          detail: 'home(first)=' + first.record.home + ' home(second)=' + second.record.home,
          expected: 'two different isolated home directories and instance directories',
          actual: 'home differs: ' + String(homesDiffer) + ', dir differs: ' + String(dirsDiffer),
          hint: 'the planner derives each instance directory from the work root and instance id; a shared home means the isolation plan is not per launch',
        })
        observations.push({
          checkId: 'smoke-isolated-ports',
          title: 'each instance listens on its own port',
          ok: portsDiffer && originsDiffer,
          detail: 'port(first)=' + String(first.record.port) + ' port(second)=' + String(second.record.port),
          expected: 'two different ports and origin URLs',
          actual: 'origin(first)=' + first.record.originUrl + ' origin(second)=' + second.record.originUrl,
          hint: 'the second launch should pick a free port because the first one is bound; a collision means the planner probes the wrong state',
        })
        observations.push({
          checkId: 'smoke-isolated-pids',
          title: 'each instance is a live process of its own',
          ok: first.pid !== second.pid && first.isAlive() && second.isAlive(),
          detail: 'pid(first)=' + String(first.pid) + ' alive=' + String(first.isAlive()) + ' pid(second)=' + String(second.pid) + ' alive=' + String(second.isAlive()),
          expected: 'two different pids, both alive while the scenario runs',
          actual: String(first.pid) + ' / ' + String(second.pid),
          hint: 'read the instance logs; a dead process means the second launch interfered with the first',
        })

        // 每个实例各开一张页面：这同时验证浏览器适配器能对多个实例工作。
        async function openPage(handle: InstanceHandle): Promise<{ readonly page: PageHandle | null; readonly problem: string | null; readonly origin: string | null }> {
          const opened = await handle.page()
          if (!opened.ok) return { page: null, problem: opened.error.message, origin: null }
          const page = opened.value
          const raw = page.page as unknown as RawBrowserPage
          if (raw.goto !== undefined) {
            const navigated = await raw.goto(handle.record.tokenUrl)
            if (!navigated.ok) return { page, problem: 'goto failed: ' + String(navigated.error === undefined ? 'unknown error' : navigated.error.message), origin: null }
          }
          const origin = await page.evaluate<string>('location.origin')
          if (!origin.ok) return { page, problem: 'location.origin could not be read: ' + origin.error.message, origin: null }
          return { page, problem: null, origin: origin.value }
        }

        const firstPage = await openPage(first)
        const secondPage = await openPage(second)
        const pagesOk = firstPage.page !== null && secondPage.page !== null
        observations.push({
          checkId: 'smoke-pages-open',
          title: 'each instance can open a browser page',
          ok: pagesOk && firstPage.problem === null && secondPage.problem === null,
          detail:
            'first: ' + (firstPage.problem === null ? 'page opened' : firstPage.problem) +
            '; second: ' + (secondPage.problem === null ? 'page opened' : secondPage.problem),
          expected: 'page() succeeds for both instances and the page loads',
          actual: String(firstPage.problem === null && secondPage.problem === null),
          hint: 'verify/browser.mjs must be able to launch more than one browser session; check the instance logs if a page cannot open',
        })
        const firstOriginOk = firstPage.origin !== null && firstPage.origin === first.record.originUrl
        const secondOriginOk = secondPage.origin !== null && secondPage.origin === second.record.originUrl
        observations.push({
          checkId: 'smoke-pages-isolated',
          title: 'each page is connected to its own instance origin',
          ok: pagesOk && firstOriginOk && secondOriginOk,
          detail:
            'first origin: ' + String(firstPage.origin) + ' (wanted ' + first.record.originUrl + '); ' +
            'second origin: ' + String(secondPage.origin) + ' (wanted ' + second.record.originUrl + ')',
          expected: 'location.origin equals the origin URL of the instance whose page was opened',
          actual: String(firstOriginOk) + ' / ' + String(secondOriginOk),
          hint: 'the browser adapter may reuse one session across instances; each page must still be navigated with its own token URL',
        })
        for (const handle of [firstPage.page, secondPage.page]) {
          if (handle !== null) {
            try {
              await handle.close()
            } catch {
              // closing a page is best effort; the stop below releases the process anyway
            }
          }
        }

        // 不带 id 的 stop()：一次停掉全部活动实例。
        const stopped = await context.primitives.stop()
        const stoppedCount = stopped.ok ? stopped.value.length : 0
        observations.push({
          checkId: 'smoke-stop-all',
          title: 'stop without an id stops every active instance',
          ok: stopped.ok && stoppedCount === 2,
          detail: stopped.ok
            ? 'stop() reported ' + String(stoppedCount) + ' stopped instance(s)'
            : 'stop() failed: ' + stopped.error.message,
          expected: 'two kill outcomes from one stop() call without an id',
          actual: stopped.ok ? String(stoppedCount) : stopped.error.message,
          hint: 'read the stop primitive; a partial stop leaves a live process behind',
        })

        await sleep(300)
        const remaining = context.primitives.instances()
        const firstAlive = first.isAlive()
        const secondAlive = second.isAlive()
        observations.push({
          checkId: 'smoke-stopped-cleanly',
          title: 'no instance is left alive after the stop',
          ok: remaining.length === 0 && !firstAlive && !secondAlive,
          detail: 'remaining instances: ' + String(remaining.length) + ', first alive: ' + String(firstAlive) + ', second alive: ' + String(secondAlive),
          expected: 'an empty instance registry and two dead processes',
          actual: JSON.stringify({ remaining: remaining.length, firstAlive, secondAlive }),
          hint: 'inspect the instance logs and the launcher records; a still-alive pid means teardown did not finish',
        })

        return observations
      },
    },
  ],
})
