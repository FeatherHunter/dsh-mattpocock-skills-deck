// tests/fixtures/real-machine/seed/fake-glab-seed.mts —— 有种状态的假 glab：给 #1708 种子数据门禁用。
//
// 和共享的 tests/fixtures/real-machine/fake-glab.mts 不同：那份是无状态的「按计划回话」，
// 只够验证单次调用；种 101 张票要让「第一次建、第二次不建」这种跨进程的幂等性说话，
// 假 glab 必须记得上一次建出了什么。所以本夹具把 GitLab 的一组对象存在一个 JSON 文件里：
//   GLAB_FAKE_STATE  状态文件路径（必填）。里面是项目、票、标签、指派、阻塞边与「规则尝试次数」。
//   GLAB_FAKE_PLAN   失败注入计划（可选，形状与共享假 glab 的 GlabPlan 相同，另加 failTimes）：
//                    命中的规则可以只失败前 N 次（failTimes），用来验「重试 3 次带退避」。
//   GLAB_FAKE_LOG    调用记录 JSONL（与共享假 glab 同一口径，门禁可以用 harness.readGlabCalls() 读）。
//   GLAB_FAKE_PROJECT_PATH  这个假项目在 GitLab 上的路径（默认 seed-group/seed-pool）。
//
// 它只实现 seed-gitlab 命令会用到的接口：user、项目读回、标签、票的增改查、阻塞边；
// 每次调用都记 argv 与 cwd，不访问网络、不写宿主环境。
//
// 为什么单独一份、不扩共享 fake-glab.mts：共享那份是 #1705 的门禁契约，属于别人的交付面；
// 本票要的是「按调用序号/已有状态返回递增 id」的动态行为，放在本票自己的夹具目录里最稳妥。

import fs from 'node:fs'
import path from 'node:path'

interface FakeLabel {
  id: number
  name: string
  color: string
  textColor: string
}

interface FakeUser {
  id: number
  username: string
  name: string
}

interface FakeLink {
  id: number
  issueLinkId: number
  linkType: string
  /** 对方票的 iid（GitLab 的 issue link 回包里，iid 指向另一端）。 */
  iid: number
}

interface FakeIssue {
  id: number
  iid: number
  title: string
  description: string
  state: string
  labels: FakeLabel[]
  assignees: FakeUser[]
  links: FakeLink[]
}

interface FakeProject {
  id: number
  name: string
  path: string
  pathWithNamespace: string
  webUrl: string
}

interface FakeState {
  project: FakeProject
  nextIssueId: number
  nextIid: number
  nextLabelId: number
  nextLinkId: number
  /** 计划里每条规则命中过几次：failTimes 用它算「只失败前 N 次」。 */
  attempts: Record<string, number>
  users: FakeUser[]
  labels: FakeLabel[]
  issues: FakeIssue[]
}

interface GlabResponse {
  exitCode?: number
  stdout?: string
  stderr?: string
}

interface GlabRule extends GlabResponse {
  argvPrefix?: string[]
  argvIncludes?: string[]
  failTimes?: number
}

interface GlabPlan {
  default?: GlabResponse
  rules?: GlabRule[]
}

const argv = process.argv.slice(2)
const cwd = process.cwd()
const logPath = process.env.GLAB_FAKE_LOG || ''
const planPath = process.env.GLAB_FAKE_PLAN || ''
const statePath = process.env.GLAB_FAKE_STATE || ''
const projectPathEnv = process.env.GLAB_FAKE_PROJECT_PATH || 'seed-group/seed-pool'

/** 第一次被调用时造一份空项目状态：项目、当前用户、空标签与空票池。 */
function defaultState(): FakeState {
  const projectPath = projectPathEnv
  return {
    project: {
      id: 9000,
      name: projectPath.split('/').pop() || projectPath,
      path: projectPath,
      pathWithNamespace: projectPath,
      webUrl: 'https://gitlab.example.com/' + projectPath,
    },
    nextIssueId: 5101,
    nextIid: 1,
    nextLabelId: 901,
    nextLinkId: 401,
    attempts: {},
    users: [{ id: 7001, username: 'seed-bot', name: '种子机器人' }],
    labels: [],
    issues: [],
  }
}

function readState(): FakeState {
  if (!statePath) throw new Error('假 glab（种子）需要环境变量 GLAB_FAKE_STATE 指向状态文件。')
  if (!fs.existsSync(statePath)) {
    const fresh = defaultState()
    writeState(fresh)
    return fresh
  }
  const text = fs.readFileSync(statePath, 'utf8')
  try {
    return JSON.parse(text) as FakeState
  } catch (error) {
    throw new Error('假 glab（种子）的状态文件读不懂：' + statePath + '（' + (error instanceof Error ? error.message : String(error)) + '）')
  }
}

function writeState(state: FakeState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

/** 读计划文件；没有就当成「没有任何注入规则」。 */
function readPlan(): GlabPlan {
  if (!planPath || !fs.existsSync(planPath)) return {}
  const text = fs.readFileSync(planPath, 'utf8')
  try {
    return JSON.parse(text) as GlabPlan
  } catch (error) {
    throw new Error('假 glab（种子）的计划文件读不懂：' + planPath + '（' + (error instanceof Error ? error.message : String(error)) + '）')
  }
}

function matchesRule(args: string[], rule: GlabRule): boolean {
  if (Array.isArray(rule.argvPrefix)) {
    for (let index = 0; index < rule.argvPrefix.length; index += 1) {
      if (args[index] !== rule.argvPrefix[index]) return false
    }
  }
  if (Array.isArray(rule.argvIncludes)) {
    for (const item of rule.argvIncludes) {
      if (!args.includes(item)) return false
    }
  }
  return true
}

/** 记一条调用：字段与共享假 glab 完全一致，门禁的 readGlabCalls() 才认得。 */
function logCall(matchedRule: number | 'default', exitCode: number): void {
  if (!logPath) return
  const record = { argv, cwd, matchedRule, exitCode }
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8')
}

function response(exitCode: number, stdout: string, stderr: string): void {
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  process.exitCode = exitCode
}

function fail(message: string, exitCode = 1): void {
  response(exitCode, '', message + '\n')
}

function serializeLabel(label: FakeLabel): Record<string, unknown> {
  return { id: label.id, name: label.name, color: label.color, text_color: label.textColor }
}

function serializeIssue(state: FakeState, issue: FakeIssue): Record<string, unknown> {
  return {
    id: issue.id,
    iid: issue.iid,
    project_id: state.project.id,
    title: issue.title,
    description: issue.description,
    state: issue.state,
    labels: issue.labels.map((label) => ({ id: label.id, name: label.name, color: label.color })),
    assignees: issue.assignees.map((user) => ({ id: user.id, username: user.username, name: user.name })),
    web_url: state.project.webUrl + '/-/issues/' + issue.iid,
    links: issue.links,
  }
}

function parseMethod(): string {
  const index = argv.indexOf('--method')
  if (index < 0 || argv[index + 1] === undefined) return 'GET'
  return String(argv[index + 1]).toUpperCase()
}

/** 把 -f key=value 读成映射；value 里再出现等号不算分隔符。 */
function parseFields(): Record<string, string> {
  const fields: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '-f') continue
    const pair = argv[index + 1]
    if (pair === undefined) continue
    const eq = pair.indexOf('=')
    if (eq < 0) fields[pair] = ''
    else fields[pair.slice(0, eq)] = pair.slice(eq + 1)
    index += 1
  }
  return fields
}

function parseQuery(apiPath: string): Record<string, string> {
  const query: Record<string, string> = {}
  const mark = apiPath.indexOf('?')
  if (mark < 0) return query
  for (const part of apiPath.slice(mark + 1).split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq < 0) query[part] = ''
    else query[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1))
  }
  return query
}

function decodeProjectRef(ref: string): string {
  try {
    return decodeURIComponent(ref)
  } catch {
    return ref
  }
}

function findIssueByIid(state: FakeState, iid: number): FakeIssue | null {
  for (const issue of state.issues) if (issue.iid === iid) return issue
  return null
}

function labelsByNames(state: FakeState, names: string[]): FakeLabel[] {
  const result: FakeLabel[] = []
  for (const name of names) {
    const found = state.labels.find((label) => label.name === name)
    if (!found) throw new Error('假 glab（种子）：项目里没有标签「' + name + '」')
    result.push(found)
  }
  return result
}

function main(): void {
  const state = readState()
  const plan = readPlan()
  const rules = Array.isArray(plan.rules) ? plan.rules : []
  let injected: GlabResponse | null = null
  let matchedRule: number | 'default' = 'default'
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]
    if (!matchesRule(argv, rule)) continue
    if (typeof rule.failTimes === 'number') {
      const count = (state.attempts[String(index)] || 0) + 1
      state.attempts[String(index)] = count
      writeState(state)
      if (count > rule.failTimes) continue
    }
    injected = rule
    matchedRule = index
    break
  }
  if (injected) {
    const exitCode = injected.exitCode === undefined ? 1 : injected.exitCode
    logCall(matchedRule, exitCode)
    response(exitCode, injected.stdout || '', injected.stderr || '')
    return
  }
  if (plan.default && plan.default.exitCode !== undefined) {
    logCall('default', plan.default.exitCode)
    response(plan.default.exitCode, plan.default.stdout || '', plan.default.stderr || '')
    return
  }

  const method = parseMethod()
  const apiPath = argv[1] || ''
  const bare = apiPath.split('?')[0]
  const query = parseQuery(apiPath)
  const fields = parseFields()
  const ok = (value: unknown): void => {
    logCall('default', 0)
    response(0, JSON.stringify(value), '')
  }
  const notFound = (): void => {
    logCall('default', 1)
    fail('glab: 404 Not Found：' + bare)
  }

  try {
    if (bare === 'user' && method === 'GET') {
      ok(state.users[0])
      return
    }

    const projectOnly = /^projects\/([^/]+)$/.exec(bare)
    if (projectOnly) {
      const ref = decodeProjectRef(projectOnly[1])
      if (ref !== String(state.project.id) && ref !== state.project.path && ref !== state.project.pathWithNamespace) {
        notFound()
        return
      }
      ok({
        id: state.project.id,
        name: state.project.name,
        path: state.project.path,
        path_with_namespace: state.project.pathWithNamespace,
        web_url: state.project.webUrl,
      })
      return
    }

    const labelsRoute = /^projects\/([^/]+)\/labels$/.exec(bare)
    if (labelsRoute) {
      if (method === 'GET') {
        ok(state.labels.map(serializeLabel))
        return
      }
      if (method === 'POST') {
        const name = String(fields.name || '').trim()
        if (!name) {
          fail('glab: POST /labels 400：name 不能为空')
          return
        }
        const existing = state.labels.find((label) => label.name === name)
        if (existing) {
          ok(serializeLabel(existing))
          return
        }
        const label: FakeLabel = {
          id: state.nextLabelId++,
          name,
          color: String(fields.color || '#000000'),
          textColor: '#FFFFFF',
        }
        state.labels.push(label)
        writeState(state)
        ok(serializeLabel(label))
        return
      }
      notFound()
      return
    }

    const issuesRoute = /^projects\/([^/]+)\/issues$/.exec(bare)
    if (issuesRoute) {
      if (method === 'GET') {
        const wanted = query.state === 'all' ? 'all' : query.state || 'opened'
        const perPageRaw = Number(query.per_page || '20')
        const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? perPageRaw : 20
        const pageRaw = Number(query.page || '1')
        const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
        const filtered = state.issues.filter((issue) => wanted === 'all' || issue.state === wanted)
        const start = (page - 1) * perPage
        ok(filtered.slice(start, start + perPage).map((issue) => serializeIssue(state, issue)))
        return
      }
      if (method === 'POST') {
        const title = String(fields.title || '').trim()
        if (!title) {
          fail('glab: POST /issues 400：title 不能为空')
          return
        }
        const issue: FakeIssue = {
          id: state.nextIssueId++,
          iid: state.nextIid++,
          title,
          description: String(fields.description || ''),
          state: 'opened',
          labels: [],
          assignees: [],
          links: [],
        }
        if (fields.labels) {
          issue.labels = labelsByNames(state, fields.labels.split(',').map((item) => item.trim()).filter(Boolean))
        }
        if (fields.assignee_ids) {
          for (const raw of fields.assignee_ids.split(',').map((item) => item.trim()).filter(Boolean)) {
            const id = Number(raw)
            const user = state.users.find((item) => item.id === id)
            if (!user) throw new Error('假 glab（种子）：没有 id 为 ' + raw + ' 的指派用户')
            issue.assignees.push(user)
          }
        }
        state.issues.push(issue)
        writeState(state)
        ok(serializeIssue(state, issue))
        return
      }
      notFound()
      return
    }

    const issueRoute = /^projects\/([^/]+)\/issues\/(\d+)$/.exec(bare)
    if (issueRoute) {
      const iid = Number(issueRoute[2])
      const issue = findIssueByIid(state, iid)
      if (!issue) {
        notFound()
        return
      }
      if (method === 'GET') {
        ok(serializeIssue(state, issue))
        return
      }
      if (method === 'PUT') {
        if (fields.title !== undefined) issue.title = String(fields.title)
        if (fields.description !== undefined) issue.description = String(fields.description)
        if (fields.state_event !== undefined) {
          const event = String(fields.state_event)
          if (event === 'close') issue.state = 'closed'
          else if (event === 'reopen') issue.state = 'opened'
          else throw new Error('假 glab（种子）：不认识的 state_event「' + event + '」')
        }
        if (fields.labels !== undefined) {
          issue.labels = labelsByNames(state, fields.labels.split(',').map((item) => item.trim()).filter(Boolean))
        }
        if (fields.assignee_ids !== undefined) {
          const next: FakeUser[] = []
          for (const raw of fields.assignee_ids.split(',').map((item) => item.trim()).filter(Boolean)) {
            const id = Number(raw)
            const user = state.users.find((item) => item.id === id)
            if (!user) throw new Error('假 glab（种子）：没有 id 为 ' + raw + ' 的指派用户')
            next.push(user)
          }
          issue.assignees = next
        }
        writeState(state)
        ok(serializeIssue(state, issue))
        return
      }
      notFound()
      return
    }

    const linksRoute = /^projects\/([^/]+)\/issues\/(\d+)\/links$/.exec(bare)
    if (linksRoute) {
      const sourceIid = Number(linksRoute[2])
      const source = findIssueByIid(state, sourceIid)
      if (!source) {
        notFound()
        return
      }
      if (method === 'GET') {
        ok(
          source.links.map((link) => ({
            id: link.id,
            issue_link_id: link.issueLinkId,
            link_type: link.linkType,
            iid: link.iid,
            project_id: state.project.id,
          })),
        )
        return
      }
      if (method === 'POST') {
        const targetIid = Number(fields.target_issue_iid || '0')
        const target = findIssueByIid(state, targetIid)
        if (!target) {
          notFound()
          return
        }
        const linkType = String(fields.link_type || 'relates_to')
        const link: FakeLink = { id: state.nextLinkId++, issueLinkId: state.nextLinkId, linkType, iid: target.iid }
        state.nextLinkId += 1
        source.links.push(link)
        writeState(state)
        ok({ id: link.id, issue_link_id: link.issueLinkId, link_type: link.linkType, iid: target.iid })
        return
      }
      notFound()
      return
    }

    notFound()
  } catch (error) {
    logCall('default', 1)
    fail('glab: 假 glab（种子）内部错误：' + (error instanceof Error ? error.message : String(error)))
  }
}

try {
  main()
} catch (error) {
  fail('假 glab（种子）起不来：' + (error instanceof Error ? error.message : String(error)), 2)
}
