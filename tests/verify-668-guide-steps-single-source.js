// verify-668-guide-steps-single-source.js — #668 首开引导链的「顺序只有一份真源」门禁
// 验收（#662「定版一／定版四」）：检查页从上到下就是链快照的行序，链快照的行序由清单决定；
// 清单里的 id 全部能在检查目录里找到（不新造名字）；宿主真的按清单排；界面不自己再排一份；
// 清单顺序就是维护者定下来的那一条（改顺序必须改清单，改别处一律红）。
// 用法: node tests/verify-668-guide-steps-single-source.js
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let passed = 0
const ok = (name) => { passed++; console.log('  PASS', name) }

async function main() {
  const guide = await import(require('url').pathToFileURL(path.join(ROOT, 'src', 'shared', 'tracker', 'guide-steps.js')).href)
  const catalog = await import(require('url').pathToFileURL(path.join(ROOT, 'src', 'shared', 'tracker', 'check-catalog-dirs.js')).href)

  const ORDER = ['selection:backendSelected', 'gh:installed', 'gh:authed', 'gh:remote', 'tracker:initialized', 'skill:wayfinder']
  const idOf = (arr) => arr.map((s) => String(s.id))

  // —— 场景 1：清单本身 = 维护者 2026-09-19 定的那一条顺序 ——
  assert(Array.isArray(guide.GUIDE_STEPS), 'GUIDE_STEPS 是有序数组')
  assert(Object.isFrozen(guide.GUIDE_STEPS), 'GUIDE_STEPS 已冻结（顺序不许被就地改）')
  assert.deepStrictEqual(idOf(guide.GUIDE_STEPS), ORDER, 'GUIDE_STEPS 的顺序就是定版那一条：' + ORDER.join(' → '))
  ok('清单顺序 = 定版那一条（后端 → gh 装 → gh 登录 → 远端仓库 → 初始化 → 技能）')

  // 每一步的形状：字段齐、取值合法
  const FIELDS = ['id', 'checks', 'backends', 'ready', 'banner', 'missing', 'blocksSetup']
  for (const step of guide.GUIDE_STEPS) {
    assert.deepStrictEqual(Object.keys(step).sort(), FIELDS.slice().sort(), `步骤 ${step.id} 的字段与规格一致`)
    assert(step.checks.indexOf(step.id) >= 0, `步骤 ${step.id} 的 checks 含自己的 id`)
    assert(['chain', 'gate'].indexOf(step.ready) >= 0, `步骤 ${step.id} 的 ready 取值合法`)
    assert(Array.isArray(step.backends) && step.backends.length > 0, `步骤 ${step.id} 声明了适用后端`)
    assert(step.banner === null || (step.banner.text && step.banner.btn && step.banner.tone), `步骤 ${step.id} 的 banner 形状合法`)
    const m = step.missing
    assert(m && (m.type === 'inject' || m.type === 'fixes-action' || m.type === 'open-backend-picker'), `步骤 ${step.id} 的 missing 是三种写法之一`)
    if (m.type === 'inject') {
      assert((typeof m.text === 'string' && m.text.length > 0) || (typeof m.prompt === 'string' && m.prompt.length > 0), `步骤 ${step.id} 的注入要么是原话、要么是提示词 id`)
    }
    assert(typeof step.blocksSetup === 'boolean', `步骤 ${step.id} 的 blocksSetup 是布尔`)
  }
  ok('六步的字段与规格「定版一」逐项一致（字段齐、取值合法）')

  // gate 那一步只能有一步，且它是唯一不读链快照的（#662 定版一的注）
  const gateSteps = guide.GUIDE_STEPS.filter((s) => s.ready === 'gate')
  assert.deepStrictEqual(idOf(gateSteps), ['selection:backendSelected'], '只有「已选择后端」那一步读本地门控状态')
  ok('唯一的 gate 步骤是「已选择后端」（后端没定时不照链快照判）')

  // —— 场景 2：清单里的 id 全部在检查目录里找得到（不新造名字） ——
  const known = new Set(Object.values(catalog.ALL_CATALOGS).flat().map((c) => String(c.id)))
  for (const step of guide.GUIDE_STEPS) {
    if (step.ready === 'gate') continue
    for (const id of step.checks) {
      assert(known.has(String(id)), `清单里的检查项 id「${id}」在检查目录里存在（不新造名字）`)
    }
  }
  ok(`清单引用的检查项 id 全部来自检查目录（目录共 ${known.size} 项，清单只挑不造）`)

  // —— 场景 3：两个纯函数的取值 ——
  assert.deepStrictEqual(idOf(guide.guideStepsFor('github')), ORDER, 'github 拿到全六步、顺序不变')
  assert.deepStrictEqual(idOf(guide.guideStepsFor('markdown')), ['selection:backendSelected', 'tracker:initialized', 'skill:wayfinder'], 'markdown 只拿到通用那三步（不插仓库段）')
  assert.deepStrictEqual(idOf(guide.guideStepsFor('gitlab')), ['selection:backendSelected', 'tracker:initialized', 'skill:wayfinder'], 'gitlab 本轮与 markdown 同形（不插仓库段）')
  assert.deepStrictEqual(guide.guideStepsFor(null), [], '后端没定时返回空数组')
  assert.deepStrictEqual(guide.guideStepsFor(''), [], '后端为空串时返回空数组')
  assert.deepStrictEqual(guide.guideStepsFor('其它'), [], '未知后端返回空数组')
  for (const b of ['github', 'markdown', 'gitlab']) {
    const orig = guide.GUIDE_STEPS.filter((s) => s.backends.indexOf(b) >= 0)
    assert.deepStrictEqual(idOf(guide.guideStepsFor(b)), idOf(orig), `${b}：过滤结果就是清单里适用它的那几步，顺序不变`)
  }
  ok('guideStepsFor 按后端过滤、顺序不变（含空后端与未知后端不崩）')

  const skillStep = guide.GUIDE_STEPS.find((s) => s.id === 'skill:wayfinder')
  const threeDone = [
    { id: 'skill:wayfinder', status: 'done' },
    { id: 'skill:setup-matt-pocock-skills', status: 'done' },
    { id: 'skill:ask-matt', status: 'done' },
  ]
  assert.strictEqual(guide.guideStepDone(skillStep, threeDone), true, '技能三项全 done 才算过')
  assert.strictEqual(guide.guideStepDone(skillStep, threeDone.filter((s) => s.id !== 'skill:ask-matt')), false, '少一项就不算过（缺项按未过）')
  assert.strictEqual(guide.guideStepDone(skillStep, threeDone.map((s) => (s.id === 'skill:ask-matt' ? { id: s.id, status: 'fail' } : s))), false, '有一项 fail 就不算过')
  assert.strictEqual(guide.guideStepDone(skillStep, threeDone.map((s) => (s.id === 'skill:ask-matt' ? { id: s.id, status: 'pending' } : s))), false, '有一项 pending 就不算过（诚实未知不当成过了）')
  assert.strictEqual(guide.guideStepDone(skillStep, null), false, '链快照为空时不算过')
  assert.strictEqual(guide.guideStepDone(null, threeDone), false, '步骤为空时不崩且不算过')
  assert.strictEqual(guide.guideStepDone(guide.GUIDE_STEPS[1], [{ id: 'gh:installed', status: 'done' }]), true, '单检查项步骤按那一项判')
  ok('guideStepDone 三项全绿才算过（少一项、fail、pending、缺快照都不算过）')

  // —— 场景 4：宿主按清单排链快照（对真目录、真函数） ——
  const chainStepsOf = (backendId, allDone) => {
    const items = catalog.catalogFor(backendId).filter((c) => c.id !== 'gh:labels')
    return items.map((c) => ({ id: String(c.id), status: allDone ? 'done' : 'fail', show: null, actions: [] }))
  }
  const ghOrdered = guide.orderStepsByGuide(guide.guideStepsFor('github'), chainStepsOf('github'))
  assert.deepStrictEqual(idOf(ghOrdered), [
    'gh:installed', 'gh:authed', 'gh:remote', 'tracker:initialized',
    'skill:wayfinder', 'skill:setup-matt-pocock-skills', 'skill:ask-matt',
    'env:home', 'gh:repoAccess',
  ], 'GitHub 排出来就是定版四那张「新流程」表：gh 三行上移、初始化与技能那四行下移；清单没覆盖的两项按各自那一段的先后接在后面')
  assert.strictEqual(ghOrdered.length, catalog.catalogFor('github').filter((c) => c.id !== 'gh:labels').length, 'GitHub：一行不多、一行不少')

  const mdOrdered = guide.orderStepsByGuide(guide.guideStepsFor('markdown'), chainStepsOf('markdown'))
  assert.deepStrictEqual(idOf(mdOrdered), [
    'tracker:initialized', 'skill:wayfinder', 'skill:setup-matt-pocock-skills', 'skill:ask-matt',
    'env:home', 'md:scratchWritable', 'md:parseOk',
  ], '本地 Markdown 是同一件事：清单上的通用步骤上移，其余照旧（目录里那两项后端项按各自那一段的先后接在后面）')
  assert.strictEqual(mdOrdered.length, catalog.catalogFor('markdown').length, 'Markdown：一行不多、一行不少')

  const glOrdered = guide.orderStepsByGuide(guide.guideStepsFor('gitlab'), chainStepsOf('gitlab'))
  assert.deepStrictEqual(idOf(glOrdered), ['tracker:initialized', 'skill:wayfinder', 'skill:setup-matt-pocock-skills', 'skill:ask-matt', 'env:home', 'glab:installed', 'glab:authed', 'glab:repoAccess'], 'GitLab 本轮不插仓库段，只让通用步骤上移')
  assert.strictEqual(glOrdered.length, catalog.catalogFor('gitlab').length, 'GitLab：一行不多、一行不少')

  // 后端没定时（清单为空）：原样返回，不崩
  const raw = chainStepsOf('github')
  assert.deepStrictEqual(idOf(guide.orderStepsByGuide(guide.guideStepsFor(null), raw)), idOf(raw), '后端没定时原样返回（不排也不丢）')
  assert.deepStrictEqual(idOf(guide.orderStepsByGuide(null, raw)), idOf(raw), '清单为空时原样返回')
  assert.deepStrictEqual(guide.orderStepsByGuide(guide.guideStepsFor('github'), null), [], '链快照为空时返回空数组')
  // 清单上有一项链快照里没有（该后端不适用）：跳过它，剩下的照排
  const partial = guide.orderStepsByGuide(guide.guideStepsFor('github'), raw.filter((s) => s.id !== 'gh:authed'))
  assert.deepStrictEqual(idOf(partial), ['gh:installed', 'gh:remote', 'tracker:initialized', 'skill:wayfinder', 'skill:setup-matt-pocock-skills', 'skill:ask-matt', 'env:home', 'gh:repoAccess'], '清单上有、快照里没有的项跳过（其余顺序不变）')
  // 不改动入参（宿主后续还要用同一批步骤对象）
  const before = raw.map((s) => s.id).join(',')
  guide.orderStepsByGuide(guide.guideStepsFor('github'), raw)
  assert.strictEqual(raw.map((s) => s.id).join(','), before, '排序不改动入参数组')
  ok('orderStepsByGuide：三个后端都排成定版那条链（行数不变、缺项跳过、清单里没有的项原样保留在尾部、空输入不崩、不改入参）')

  // —— 场景 5：宿主真的用了它（不是只写了个没人调的模块） ——
  const host = read('src/host/detectChain.js')
  assert(host.indexOf("import('../shared/tracker/guide-steps.js')") >= 0, '宿主加载清单模块')
  assert(/orderStepsByGuide\s*\(/.test(host) && /guideStepsFor\s*\(/.test(host), '宿主按清单给链快照排序')
  const hostOrderPos = host.indexOf('orderStepsByGuide(')
  const firstNotDonePos = host.indexOf('const firstNotDone = allSteps.findIndex')
  assert(hostOrderPos > 0 && firstNotDonePos > hostOrderPos, '排序发生在算 currentIndex 之前（currentIndex 与横幅那一步天然一致）')
  assert(host.indexOf('allSteps = genSteps.concat(backSteps)') < 0, '宿主不再用旧的「通用段 + 后端段」直拼顺序')
  ok('宿主按清单排链快照，且排完才算第一个没过的下标')

  // —— 场景 6：界面不自己再排一份（检查页只照快照渲染） ——
  const checksTab = read('src/client/views/ChecksTab.js')
  assert(checksTab.indexOf('chainSteps(st)') >= 0, '检查页照旧渲染链快照')
  assert(!/steps\.sort\(|\.slice\(\)\.sort\(|sort\(function|sort\(\(/.test(checksTab), '检查页没有第二处排序')
  assert(checksTab.indexOf('gh:installed') < 0 && checksTab.indexOf('tracker:initialized') < 0, '检查页不写死任何步骤顺序')
  // #663 起，状态栏那条横幅也改读清单（src/client/statusbar/bannerChain.js 用 guideStepsFor + guideStepDone
  //   逐步判「第一个没过的那一步」，不再按字面 id 自己认领检查项），所以读源加上那个模块；
  //   「按字面 id 读链步骤」那一路照旧收 —— 谁再写死一个清单外的 id（例如 gh:labels）仍然红。
  const statusBar = read('src/client/statusbar/StatusBar.js') + read('src/client/statusbar/checksums.js') + read('src/client/statusbar/bannerChain.js')
  const readIds = new Set()
  let mRead
  const readRe = /chainStep\(\s*[A-Za-z_$][\w$]*\s*,\s*'([^']+)'\s*\)/g
  while ((mRead = readRe.exec(statusBar)) !== null) readIds.add(mRead[1])
  const readsByGuide = statusBar.indexOf('guideStepsFor(') >= 0 && statusBar.indexOf('guideStepDone(') >= 0
  assert(readIds.size > 0 || readsByGuide, '状态栏确实在读链步骤（按字面 id 读，或照清单逐步判；不是没接上）')
  for (const id of readIds) {
    assert(guide.GUIDE_STEPS.some((s) => s.checks.indexOf(id) >= 0), `状态栏读的「${id}」是清单里声明过的检查项（它不能自己认领清单外的项）`)
  }
  assert(statusBar.indexOf('gh:labels') < 0, '状态栏不认领清单外的检查项（gh:labels 不在链上）')
  ok('检查页与状态栏都不再自己排一份顺序，状态栏读的每个 id 都在清单里')

  // —— 场景 7：清单零依赖，且已经拼进客户端产物 ——
  const src = read('src/shared/tracker/guide-steps.js')
  assert(!/^\s*import\s/m.test(src) && !/require\(/.test(src), '清单模块零依赖（不 import / 不 require）')
  const build = read('scripts/build.mjs')
  assert(build.indexOf('// ==== shared:guideSteps (spliced by build) ====') >= 0, '构建脚本登记了拼接标记')
  assert(build.indexOf("src/shared/tracker/guide-steps.js") >= 0, '构建脚本登记了清单文件')
  const clientIndex = read('src/client/index.js')
  assert(clientIndex.indexOf('// ==== shared:guideSteps (spliced by build) ====') >= 0, '客户端入口留了拼接标记')
  const clientBundle = fs.existsSync(path.join(ROOT, 'client.js')) ? read('client.js') : ''
  assert(clientBundle.indexOf('const GUIDE_STEPS') >= 0 && clientBundle.indexOf('function guideStepsFor') >= 0, '客户端产物里带着这份清单（界面半边读得到）')
  assert(clientBundle.indexOf('export const GUIDE_STEPS') < 0, '拼接进闭包时已去掉行首 export（不在产物里留第二份声明）')
  ok('清单零依赖，且已随构建拼进客户端产物')

  // —— 场景 8：那道「定版的原话」真的有去处，且清单不抄载荷（逐字文本本身按 #716 的口径住在后端声明里） ——
  // #716 起的现状：装 CLI 的地址与名字跟具体后端有关，那句话搬回了 GitHub 模块的 prompts.cliInstall；
  //   共享清单（三个后端共用的一份文件）只声明「按哪条提示词键注入」。所以这一条量的是清单声明的那条键，
  //   文本逐字对不对由后端声明那份文件守着（tests/verify-663-gh-install-inject.js 与 verify-665 最后一段）。
  const ghStep = guide.GUIDE_STEPS.find((s) => s.id === 'gh:installed')
  assert.strictEqual(ghStep.missing.prompt, 'cliInstall', 'gh cli 那一步声明的是「按后端声明的 cliInstall 提示词注入」')
  assert.strictEqual(ghStep.missing.type, 'inject', 'gh cli 那一步的给法是「注入一段文案」')
  const repoStep = guide.GUIDE_STEPS.find((s) => s.id === 'gh:remote')
  assert.strictEqual(repoStep.missing.type, 'fixes-action', '远端仓库那一步用后端声明的修复动作，清单不抄弹窗载荷')
  assert.strictEqual(repoStep.blocksSetup, true, '远端仓库那一步没过之前不注入初始化全文')
  assert.strictEqual(guide.GUIDE_STEPS.filter((s) => s.blocksSetup).length, 1, '只有远端仓库那一步挡初始化全文')
  assert.strictEqual(ghStep.blocksSetup, false, 'gh 没装不挡初始化全文（挡住的是仓库那一步）')
  ok('清单里的注入原话逐字一致，且只有「远端仓库」那一步挡初始化全文')

  // —— 场景 9：门禁已接入 npm run verify 链 ——
  const pkgJson = JSON.parse(read('package.json'))
  assert((pkgJson.scripts.verify || '').indexOf('verify-668-guide-steps-single-source.js') >= 0, 'npm run verify 链已纳入本门禁')
  ok('门禁已接入 verify 链')

  console.log(`\n全部通过：${passed} 组检查，9 组场景`)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
