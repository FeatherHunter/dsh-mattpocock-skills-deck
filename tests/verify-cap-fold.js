#!/usr/bin/env node
/**
 * verify-cap-fold.js — 状态栏胶囊那条横条「随宽度一格一格变短」的门禁（#725，维护者 2026-09-24 定）
 *
 * 维护者这一轮的真意（2026-09-24 晚真机反馈后回改）：「有位置就显示，宽度不够时它第一个让位」。
 *   他上一轮的原话是「品牌字默认折叠；内容平铺在这一条里；变窄时字一个一个减少（先消失非核心的），
 *   直到只剩图标」。前半句「默认折叠」上一版被照字面落成了「起手就折叠、任何宽度都不显示」（真机上
 *   那串字一个宽度都看不见，只剩一枚罗盘图标），所以本文件这一轮按真意改口径：第 0 档（最宽那一档）
 *   品牌那串字是**可见**的，往下第一段台阶就是它少一个字，它收完了才轮到 2..9。
 *   落到代码上，这一票要四件事，本文件按四组量它们：
 *
 *   A 判据层（纯函数，不开浏览器）：statusbar/capFold.js 那条阶梯 —— 第 0 档九段字全在（品牌那串也
 *     看得见）、每往下一档只少一个单位（char 少一个字 / word 少一整段词）、收的第一段是品牌、
 *     所有词都空之后就再也没有台阶（计数器与图标是载荷，不许撤）、档号超界停在最后一档。
 *   B 源码与产物层：判据与机器都真的拼进两份产物；那条 2 秒轮询确实退役了；
 *     接线（状态栏把胶囊交给机器、每次提交后重算一次、两条 ResizeObserver + fonts.ready 还在）；
 *     平铺那两条 CSS（胶囊两端分布、品牌段吃余量且列间距有上限）真的落地了。
 *   C 真渲染层（真 Chromium + 真产物 + 真数据）：宽度 900 → 240 每 6 像素扫一档，逐档量
 *     「档号、每一段还在几个单位、胶囊溢不溢出、计数器数字还在不在」，核心断言是那句原话的可执行版：
 *     **每往下一档，版面上恰好多让掉一个单位**（档号涨几，可见单位就少几）。
 *   D 去掉 2 秒轮询之后的两条兜底证据（这是本票删掉那个轮询时必须补上的）：
 *     ① 宽度改完等 2200 毫秒再量一次，仍然正确（不是靠某一帧碰巧量对）；
 *     ② 外来的文字写入（真实场景里就是 React 重渲染把收短过的那串换回完整的一串）会被机器当成
 *        新的事实重新排一遍阶梯 —— 这正是当年那个轮询兜的事，现在由「每次提交后重算一次」接管。
 *
 * 为什么核心判据量的是「档」而不是「相邻两次宽度采样」：宽度每走 6 像素，机器可能一次走过两档
 *   （下一段要收的那点宽度比这 6 像素还窄的时候就是这样，不是缺陷）；「一档只让掉一点」这句话说的是
 *   档与档之间的关系，所以本文件按档号算：档号涨了几，可见单位就必须少几 —— 多让一点都不许。
 *
 * 依赖：playwright（含 chromium）与 esbuild，都在本仓 devDependencies。全程本机，不碰真仓库、不用登录令牌。
 * 运行：node tests/verify-cap-fold.js（先 node scripts/build.mjs 生成产物）
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'node:http'

let passed = 0, failed = 0
function ok(msg) { passed++; console.log('  PASS ' + msg) }
function bad(msg) { failed++; console.log('  FAIL ' + msg) }
function check(cond, msg) { if (cond) ok(msg); else bad(msg) }

const read = (rel) => readFileSync(resolve(rel), 'utf8')
const CAPFOLD = 'src/client/statusbar/capFold.js'
const CAPMACHINE = 'src/client/statusbar/capFoldMachine.js'
const STATUSBAR = 'src/client/statusbar/StatusBar.js'
const STYLES = 'src/client/kernel/styles.js'
const ARTIFACTS = ['client.js', 'package/lib/client.js']

console.log('=== #725 状态栏胶囊：随宽度一格一格变短（有位置就显示品牌 / 品牌第一个让位 / 每步只让一个单位）===')
console.log('')
console.log('A) 判据层：那一条阶梯本身（纯函数，不开浏览器）')

// 与 scripts/build.mjs 拼接时同一套做法：剥掉行首 export，丢进同一个作用域里跑。
const capFold = (function () {
  if (!existsSync(resolve(CAPFOLD))) return null
  try {
    return new Function(read(CAPFOLD).replace(/^[ \t]*export[ \t]+/gm, '') +
      '\nreturn { CAP_FOLD_POLICY, capFoldLadderOf, capFoldStateAt, capFoldStepCount }')()
  } catch (e) { return null }
})()
if (!capFold) {
  bad('A 读不到 ' + CAPFOLD + '，或者它跑不起来')
} else {
  const POLICY = capFold.CAP_FOLD_POLICY
  const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  // A1（2026-09-24 晚改口径）：这一段同时钉两件事 —— 让位单位与优先级照旧（品牌 char、小号先让位），
  //   并且「让位表里一段 pinned 都没有」。pinned 是「这段字不参与让位」那个开关，谁把它加回来，
  //   那一段就在最宽那一档也是空的 —— 也就是维护者真机反馈里的「这串字任何宽度都看不见」。
  const polOk = !!POLICY && ids.every((p) => !!POLICY[p]) &&
    POLICY['1'].cut === 'char' && POLICY['1'].pinned !== true &&
    POLICY['9'].cut === 'char' && POLICY['9'].pinned !== true &&
    ['2', '3', '4', '5', '6', '7', '8'].every((p) => POLICY[p].cut === 'word' && POLICY[p].pinned !== true) &&
    Object.keys(POLICY).length === 9
  check(polOk, 'A1 让位表就是维护者定的那张：1=品牌（char，优先级最高 = 第一个让位，不默认收起）· 2–8=七段词（word）· 9=时间串（char），全表没有一段是 pinned（实测 ' + JSON.stringify(POLICY) + '）')

  // 一份与真机同形的样本：号码与状态栏那九个挂点一一对应，字用中文那一套（一个字 12 像素，尺子分得清）。
  const SAMPLE = { items: [
    { priority: 1, word: 'MattSkills' },
    { priority: 2, word: '沉淀' }, { priority: 3, word: '交接' }, { priority: 4, word: '更新' },
    { priority: 5, word: '可接' }, { priority: 6, word: 'BUG' }, { priority: 7, word: '诊断' }, { priority: 8, word: '环境' },
    { priority: 9, word: ' 12:34:56' },
  ] }
  const unitsOf = function (text, cut) {
    const s = String(text === undefined || text === null ? '' : text)
    if (cut !== 'word') return s.length // char 口径：一个字符算一个单位（阶梯就是这么收的，收的是末尾那个字）
    return s.trim() === '' ? 0 : s.trim().split(/\s+/).length // word 口径：一整段词算一个单位
  }
  const ladderOf = function (sample) {
    const ladder = capFold.capFoldLadderOf(sample)
    const steps = ladder.steps || []
    const rungs = steps.map(function (s, i) { return { tier: i, words: capFold.capFoldStateAt(ladder, i).words } })
    return { ladder: ladder, rungs: rungs }
  }
  // 这一段字少掉一个单位之后剩什么（'char' 少末尾一个字，'word' 少末尾一整段词 —— 没有空格可分时整段就是一段词）。
  const cutOnceLocal = function (text, cut) {
    const s = String(text === undefined || text === null ? '' : text)
    if (s === '') return ''
    if (cut !== 'word') return s.slice(0, -1)
    const parts = s.split(/\s+/)
    if (parts.length <= 1) return ''
    parts.pop()
    return parts.join(' ')
  }
  // 这把尺子：逐档核对「相邻两档之间只有一个单位被让掉，而且方向只有一个 —— 只会少，不会多也不会换」。
  //   2026-09-24 晚加强：光比相邻两档看不出「谁先让位」—— 一台把品牌起手收掉（pinned）的阶梯，相邻两档
  //   之间照样是「只少一个单位」，它会一路绿到收底。所以这里再加一条同样属于「一格一格让」的判据：
  //   **把这一档每一段此刻的文本，按让位表自己往下让一遍，必须正好等于下一档** —— 也就是「下一档是
  //   从这一档少掉一个单位得来的」。pinned 那种第 0 档就空的阶梯会当场在对不上的位置被报出来。
  const violationsOf = function (run, sample) {
    const out = []
    const cutOf = {}
    ;(sample.items || []).forEach(function (it) { cutOf[String(it.priority)] = (POLICY[String(it.priority)] || {}).cut || 'word' })
    const expectedNext = function (words) {
      const order = Object.keys(words).map(Number).sort(function (a, b) { return a - b })
      for (let i = 0; i < order.length; i++) {
        const k = String(order[i])
        if (String(words[k] || '') === '') continue
        const nxt = Object.assign({}, words)
        nxt[k] = cutOnceLocal(words[k], cutOf[k])
        return nxt
      }
      return Object.assign({}, words)
    }
    for (let i = 1; i < run.rungs.length; i++) {
      const a = run.rungs[i - 1].words, b = run.rungs[i].words
      const changed = Object.keys(a).filter(function (k) { return a[k] !== b[k] })
      if (changed.length !== 1) { out.push('第' + i + '档一次动了 ' + changed.length + ' 段（' + changed.join(',') + '）'); continue }
      const k = changed[0]
      if (unitsOf(b[k], cutOf[k]) > unitsOf(a[k], cutOf[k])) out.push('第' + i + '档那一段变长了（' + k + '）')
      const drop = unitsOf(a[k], cutOf[k]) - unitsOf(b[k], cutOf[k])
      if (drop !== 1) out.push('第' + i + '档一次让掉 ' + drop + ' 个单位（' + k + '：' + JSON.stringify(a[k]) + ' → ' + JSON.stringify(b[k]) + '）')
      // 这一段必须正是「按让位表该让的那一段」：号码最小的还没空的那一段
      const order = Object.keys(a).map(Number).sort(function (x, y) { return x - y })
      const shouldBe = String(order.filter(function (n) { return String(a[String(n)] || '') !== '' })[0])
      if (shouldBe !== k) out.push('第' + i + '档让的不是该让的那一段（该让 ' + shouldBe + '，实际动了 ' + k + '）')
      // 下一档必须正好等于「这一档再让一个单位」
      const want = expectedNext(a)
      const diff = Object.keys(want).filter(function (x) { return String(want[x] || '') !== String(b[x] || '') })
      if (diff.length) out.push('第' + i + '档不是从上一档少一个单位来的（对不上的段 ' + diff.join(',') + '）')
    }
    return out
  }
  const zhRun = ladderOf(SAMPLE)
  const vZh = violationsOf(zhRun, SAMPLE)
  const first = zhRun.rungs[0].words
  const lastRung = zhRun.rungs[zhRun.rungs.length - 1]

  check(first['1'] === 'MattSkills' && first['2'] === '沉淀' && first['9'] === ' 12:34:56',
    'A2 第 0 档（最宽那一档）九段字全都在：品牌那串看得见（这是维护者的真意「有位置就显示」，上一版在这里是空的）、其余各段也都是完整的那串字（实测 ' + JSON.stringify(first) + '）')
  check(vZh.length === 0,
    'A3 每往下一档只让掉一个单位（一个字，或一整段词），别的段一个字都不动（实测 ' + zhRun.rungs.length + ' 档，违反 ' + vZh.length + ' 处' + (vZh.length ? '：' + vZh.join('；') : '') + '）')
  // A4/A5/A6 三条是「品牌第一个让位」这件事在判据上的样子：往下第一段台阶就是品牌那串字少一个字。
  //   为什么单独写三条而不是并进 A2/A3：维护者这一轮要的就是「宽度不够时它第一个让位」，
  //   而 A2 只证明「它在第 0 档看得见」、A3 只证明「每一步只少一个单位」—— 少了这三条，
  //   一台把品牌排在最后才收的阶梯照样能绿。
  const afterBrand = capFold.capFoldStateAt(zhRun.ladder, SAMPLE.items[0].word.length)
  const brandWhole = String(SAMPLE.items[0].word || '')
  check(brandWhole.length === 10 && first['2'] === SAMPLE.items[1].word && afterBrand.words['2'] === SAMPLE.items[1].word,
    'A4 品牌那串字收的是 10 步、这 10 步里别段一个字都不动（实测品牌字长 ' + brandWhole.length + '，第 ' + brandWhole.length + ' 档时第 2 段 ' + JSON.stringify(afterBrand.words['2']) + '）')
  const brandGone = capFold.capFoldStateAt(zhRun.ladder, brandWhole.length + 1)
  const brandEmpty = capFold.capFoldStateAt(zhRun.ladder, brandWhole.length)
  check(brandEmpty.words['1'] === '' && brandEmpty.words['2'] === SAMPLE.items[1].word && brandGone.words['2'] === '',
    'A5 品牌收完了才轮到第 2 段（品牌空掉那一档第 2 段还是完整那句，再下一档才开始收它；实测第 ' + brandWhole.length + ' 档 ' + JSON.stringify(brandEmpty.words['2']) + ' → 第 ' + (brandWhole.length + 1) + ' 档 ' + JSON.stringify(brandGone.words['2']) + '）')
  check(zhRun.rungs[1].words['1'] === brandWhole.slice(0, -1) && zhRun.rungs[1].words['9'] === SAMPLE.items[8].word,
    'A6 往下第一段台阶就是品牌掉一个字（别的段一个字都不少：时间串还是完整那串；实测品牌 ' + JSON.stringify(first['1']) + ' → ' + JSON.stringify(zhRun.rungs[1].words['1']) + '）')
  check(ids.every((p) => lastRung.words[p] === '') && capFold.capFoldStepCount(zhRun.ladder) === 1 + 10 + 7 + 9,
    'A7 收到底：最后一档所有段都空了，档数恰是「第 0 档 + 品牌十个字十步 + 七段词各一步 + 时间串九个字九步」= 27（实测 ' + capFold.capFoldStepCount(zhRun.ladder) + ' 档）')
  check(capFold.capFoldStepCount(zhRun.ladder) === zhRun.rungs.length,
    'A8 capFoldStepCount 说的档数与真排出来的档数一致（实测 ' + capFold.capFoldStepCount(zhRun.ladder) + '）')
  const below = capFold.capFoldStateAt(zhRun.ladder, -5)
  const above = capFold.capFoldStateAt(zhRun.ladder, 999)
  check(below.tier === 0 && below.words['2'] === '沉淀' && below.words['1'] === brandWhole,
    'A9 档号算小了（-5）停在最宽那一档（实测 tier ' + below.tier + '）')
  check(above.tier === zhRun.rungs.length - 1 && ids.every((p) => above.words[p] === ''),
    'A10 档号算大了（999）停在最后一档、不越界（收到底之后不再撤；实测 tier ' + above.tier + '）')
  const order = (zhRun.ladder.ids || []).join(',')
  check(order === ids.join(','), 'A11 让位次序就是号码升序（小号先让位，品牌 1 排在头一个；实测 ' + order + '）')
  // A12：九段谁都没有 pinned（这条守的是真意里「有位置就显示」那一半）。
  //   为什么要单写一条、而不靠 A1 那条整表断言：A1 判的是整张表，将来新加一段带着 pinned 进来，
  //   A1 里那几个号码的写法看不出是「新加那一段」犯的错；这一条按号码逐个点名，谁带的就报谁。
  const pinnedOn = ids.filter((p) => (POLICY[p] || {}).pinned === true)
  check(pinnedOn.length === 0 && ids.every((p) => first[p] !== ''),
    'A12 没有任何一段被 pinned（pinned = 这段字任何宽度都不显示）：第 0 档九段一段都不许是空的（实测带 pinned 的号码 ' + JSON.stringify(pinnedOn) + '、第 0 档空的段 ' + JSON.stringify(ids.filter((p) => first[p] === '')) + '）')

  // 英文那一套也跑一遍：多词的那几段按「一整段词」让位，所以一次少一整个词，不是少一个字母。
  const EN = { items: [
    { priority: 1, word: 'MattSkills' },
    { priority: 2, word: 'Handoff new session' }, { priority: 3, word: 'Handoff' },
    { priority: 4, word: 'Refresh' }, { priority: 5, word: 'Takeable' }, { priority: 6, word: 'BUG' },
    { priority: 7, word: 'Triage' }, { priority: 8, word: 'Env' },
    { priority: 9, word: ' 12:34:56' },
  ] }
  const enRun = ladderOf(EN)
  const vEn = violationsOf(enRun, EN)
  const enRung0 = enRun.rungs[0].words
  const enRung1 = enRun.rungs[1].words
  check(vEn.length === 0 && enRung0['2'] === 'Handoff new session' && enRung1['1'] === 'MattSkill' && enRung1['2'] === 'Handoff new session',
    'A13 英文那一套同样只让一个单位：第一段台阶同样是品牌掉一个字母（第 1 段一字未动），多词的那段到它自己让位时一次只少一整个词（实测品牌 ' + JSON.stringify(enRung0['1']) + ' → ' + JSON.stringify(enRung1['1']) + '、第 2 段第 1 档 ' + JSON.stringify(enRung1['2']) + '，违反 ' + vEn.length + ' 处）')

  // 自带反证：一把尺子抓不住坏阶梯就是假绿。造两条坏样子喂进去 ——
  //   ① 同一段一步掉三个字（时间串那一段本该一个字一个字地让）；
  //   ② 一步动了两段（两个号码同时被收掉，台阶上就少了一格）。
  const brokenChars = {
    ladder: { steps: [], ids: ids },
    rungs: [
      { tier: 0, words: { '1': '', '2': '沉淀', '9': ' 12:34:56' } },
      { tier: 1, words: { '1': '', '2': '沉淀', '9': ' 12:3' } },
      { tier: 2, words: { '1': '', '2': '沉淀', '9': '' } },
    ],
  }
  const brokenTwo = {
    ladder: { steps: [], ids: ids },
    rungs: [
      { tier: 0, words: { '1': '', '2': '沉淀', '3': '交接' } },
      { tier: 1, words: { '1': '', '2': '', '3': '' } },
    ],
  }
  const vBrokenChars = violationsOf(brokenChars, SAMPLE)
  const vBrokenTwo = violationsOf(brokenTwo, SAMPLE)
  check(vBrokenChars.length >= 1 && vBrokenTwo.length >= 1,
    'A14 自带反证：一步掉好几个字、一步动两段的坏阶梯都会被这把尺子抓住（实测 ' + vBrokenChars.length + ' / ' + vBrokenTwo.length + ' 处）')
  // ③ 第三条坏样子：品牌那段**每一档都是空的**（起手就空、一路空到底）。这正是「把品牌那一段排除在这条
  //    阶梯之外」（上一版在让位表里给 1 写 pinned: true，capFoldLadderOf 读到它就把这串字写成空串）
  //    会在真界面上排出来的样子：那串字任何宽度都不显示，而别的段照样一格一格让。
  //    这一条必须自己从头搭——不能拿 capFoldLadderOf 排出来的那条去改：让位表一带 pinned，
  //    它排出来的本来就已经是坏的那条，改也改不出东西来（2026-09-24 实测踩过这一脚，A15 当时空绿）。
  //    做法：只读让位表里的 cut（不读 pinned），按「号码小的先让、每次只让一个单位」自己排一条；
  //    再把它当期望，去比**真源排出来的那条** —— 真源一旦起手就把品牌收掉，第 0 档就对不上。
  const rungWordsOf = function (sample) {
    const cutOf2 = {}
    ;(sample.items || []).forEach(function (it) { cutOf2[String(it.priority)] = (POLICY[String(it.priority)] || {}).cut || 'word' })
    const items = (sample.items || []).slice().sort(function (a, b) { return (Number(a.priority) || 99) - (Number(b.priority) || 99) })
    const cur = {}
    items.forEach(function (it) { cur[String(it.priority)] = String(it.word === undefined || it.word === null ? '' : it.word) })
    const out = [Object.assign({}, cur)]
    items.forEach(function (it) {
      const p = String(it.priority)
      while (cur[p] !== '') { cur[p] = cutOnceLocal(cur[p], cutOf2[p]); out.push(Object.assign({}, cur)) }
    })
    return out
  }
  const wantRungs = rungWordsOf(SAMPLE)
  const tierDiffs = zhRun.rungs.map(function (r, i) {
    const want = wantRungs[i] || null
    if (!want) return '第' + i + '档多出来了'
    const diff = Object.keys(want).filter(function (k) { return String(want[k] || '') !== String(r.words[k] || '') })
    return diff.length ? '第' + i + '档对不上（' + diff.map(function (k) { return k + ' 期望 ' + JSON.stringify(want[k]) + ' 实际 ' + JSON.stringify(r.words[k]) }).join('；') + '）' : null
  }).filter(Boolean)
  check(wantRungs.length === zhRun.rungs.length && tierDiffs.length === 0,
    'A15 真源排出来的每一档都等于「照让位表自己排一遍」的那一档（真源那一侧只要把品牌起手收掉、或漏掉它任何一段台阶，这里就对不上；实测档数 期望 ' + wantRungs.length + ' / 实际 ' + zhRun.rungs.length + '，对不上的档 ' + JSON.stringify(tierDiffs.slice(0, 3)) + '）')
  // A15 自带的反证：把期望里所有档的第 1 段改成空串（＝上一版 pinned: true 的效果，也就是那串字任何
  //   宽度都不显示），同一条比对必须当场报出来 —— 抓不住就是假绿。
  const pinnedWant = wantRungs.map(function (w) { const c = Object.assign({}, w); c['1'] = ''; return c })
  const pinnedDiffs = zhRun.rungs.map(function (r, i) {
    const want = pinnedWant[i] || null
    if (!want) return '第' + i + '档多出来了'
    const diff = Object.keys(want).filter(function (k) { return String(want[k] || '') !== String(r.words[k] || '') })
    return diff.length ? '第' + i + '档对不上（' + diff.join(',') + '）' : null
  }).filter(Boolean)
  check(pinnedDiffs.length >= 1,
    'A16 自带反证：把期望改成「品牌起手就空、一路空到底」（上一版 pinned: true 的效果）时，同一条比对会当场报出来（实测 ' + pinnedDiffs.length + ' 档对不上，头三条：' + JSON.stringify(pinnedDiffs.slice(0, 3)) + '）')
  check(vZh.length === 0,
    'A17 这把尺子对真的那条阶梯一处都不报（不是「谁进来都报错」的假尺子；实测 ' + vZh.length + ' 处）')
}

console.log('')
console.log('B) 源码与产物层：判据与机器都拼进去了，那条 2 秒轮询确实退役了')

const missing = [CAPFOLD, CAPMACHINE, STATUSBAR, STYLES, ...ARTIFACTS].filter((rel) => !existsSync(resolve(rel)))
for (const rel of missing) bad(rel + ' 读不到' + (ARTIFACTS.indexOf(rel) >= 0 ? '（先跑 node scripts/build.mjs 重建产物）' : ''))
const artifacts = {}
for (const rel of ARTIFACTS) artifacts[rel] = existsSync(resolve(rel)) ? read(rel) : ''
for (const rel of ARTIFACTS) {
  const t = artifacts[rel]
  if (!t) continue
  check(t.indexOf('capFoldStateAt') >= 0 && t.indexOf('capFoldLadderOf') >= 0, rel + ' 里拼进了判据（capFoldLadderOf / capFoldStateAt）')
  check(t.indexOf('runCapFold') >= 0 && t.indexOf('dataset.foldTier') >= 0, rel + ' 里拼进了机器（runCapFold 与档号锚点）')
  check(!t.includes('setInterval(applyAll, 2000)'), rel + ' 里已经没有那条 2 秒轮询（#725 退役）')
  check(t.indexOf("'data-fold-priority': 1") >= 0 || t.indexOf("'data-fold-priority':1") >= 0, rel + ' 里九个挂点还在（品牌那段仍是优先级 1）')
}
const barSrc = existsSync(resolve(STATUSBAR)) ? read(STATUSBAR) : ''
check(/runCapFold\(cap, foldKeep\.current\)/.test(barSrc), '状态栏只留接线：把胶囊与两张跨调用带着走的表交给阶梯机（statusbar/capFoldMachine.js）')
check(/React\.useEffect\(function \(\) \{ applyFold\(\) \}\)/.test(barSrc), '每次提交之后重算一次（那条 2 秒轮询的位置由它接管）')
check(/new ResizeObserver\(function \(\) \{ applyFold\(\) \}\)[\s\S]{0,300}roFold\.observe\(foldRef\.current\)/.test(barSrc) && /roParent\.observe/.test(barSrc),
  '两条 ResizeObserver（胶囊自己 + 它的父容器）仍是宽度的第一信号源')
check(/document\.fonts\.ready\.then\(applyFold\)/.test(barSrc), '字体加载完再重算一次（防字体宽差误判）')
const stylesSrc = existsSync(resolve(STYLES)) ? read(STYLES) : ''
const flatRules = function (src) {
  return /\.dsws-capsule\s*\{[^}]*justify-content:\s*space-between/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*flex:1 1 auto/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*min-width:0/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*justify-content:flex-start/.test(src) &&
    /\.dsws-capsule\s+\.dsws-capsule-word[^{]*\{[^}]*column-gap:clamp\(/.test(src)
}
check(flatRules(stylesSrc), '平铺那几条 CSS 在 styles.js 里（胶囊两端分布；品牌段 flex:1 1 auto + min-width:0 + 左对齐 + 列间距 clamp 上限）')
check(ARTIFACTS.every((rel) => !artifacts[rel] || flatRules(artifacts[rel])), '两份产物里带着同一套平铺 CSS（改完 src 忘了重建产物就红在这里）')

// ---------- 真渲染层：真 Chromium + 真产物 ----------
const CLIENT = 'package/lib/client.js'
if (!existsSync(resolve(CLIENT))) {
  console.log('')
  console.log('产物缺失，C/D 两组跳过')
  console.log(passed + ' 条通过，' + failed + ' 条失败')
  process.exit(1)
}
const CWD = 'D:\\ilife\\packages\\skill-calorie'
const SNAP = {
  ok: true, version: 'verify-cap-fold', generatedMs: Date.now() - 3 * 60 * 1000,
  workspaceRoot: 'd:/ilife', maps: [], checks: null, isLocal: false, tickets: [], groups: {},
  repository: { name: 'FeatherHunter/dsh-mattpocock-skills-deck', url: 'https://github.com/FeatherHunter/dsh-mattpocock-skills-deck', backend: 'github' },
  selection: { backendId: 'github', source: 'explicit' },
}
const ENTRY = `
import React from 'react'
import * as ReactDOMClient from 'react-dom/client'
window.React = React
window.__RDOM__ = ReactDOMClient
const CWD = window.__CWD__
const SNAP = window.__SNAP__
let loaded = null
window.__ModuleLoader__ = { load(spec) { loaded = spec; return spec } }
window.eval(window.__CLIENT_SRC__)
const dict = {}
const trFn = (k, p) => {
  let s = dict[k] !== undefined ? dict[k] : k
  if (p) s = s.replace(/\\{(\\w+)\\}/g, (m, n) => (n in p ? String(p[n]) : m))
  return s
}
const regs = []
const reply = (method) => {
  if (method === 'cwd') return { ok: true, cwd: CWD }
  if (method === 'snapshot' || method === 'refresh') return SNAP
  if (method === 'chain') return { ok: true, snapshot: { steps: [] }, chain: [], fullChain: null, resolved: [] }
  if (method === 'registry') return { ok: true, modules: [{ id: 'github', label: 'GitHub' }, { id: 'markdown', label: 'Markdown' }] }
  return { ok: true }
}
const services = {
  slots: { register: (m, c) => { regs.push({ m, c }); return () => {} }, inject: (n, f) => { try { f() } catch (e) {} } },
  sidebarRightTabs: { register: () => () => {} },
  connection: { rpc: { call: async (channel, endpoint, body) => ({ ok: true, value: reply(body && body.method) }) } },
  // 只用中文那一半词条：这段阶梯按「一个字 / 一整段词」让位，中文那一套一个字至少 12 像素，尺子分得清。
  locale: { register: (ns, d) => { Object.assign(dict, (d && d.zh) || {}); return () => {} }, bind: () => trFn },
  workspaces: { list: async () => [] },
  sessions: { list: async () => [] },
  timer: { timeout: (f, ms) => setTimeout(f, ms) },
}
const ctx = { get: (k) => services[k], effect: (f) => { f(); return () => {} }, inject: (deps, cb) => { cb(ctx); return { dispose: () => {} } } }
loaded.factory((m) => (m === 'react' ? React : m === 'react-dom' ? ReactDOMClient : {})).apply(ctx)
const capsuleComp = regs.filter((r) => r.m && r.m.name === 'conversation.input.dock')[0]
window.__WAIT__ = (pred, ms) => new Promise((res) => {
  const t0 = Date.now()
  const tick = () => { if (pred() || Date.now() - t0 > ms) res(!!pred()); else setTimeout(tick, 25) }
  tick()
})
// 档位稳定 = 连续三次读到同一个档号（机器按真实可用宽度算，没有写死的阈值）。
window.__SETTLE__ = async function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return null
  let last = null, same = 0
  for (let i = 0; i < 90; i++) {
    await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 16) }) })
    const cur = cap.getAttribute('data-fold-tier')
    if (cur === last) { same++; if (same >= 3) return cur } else { last = cur; same = 0 }
  }
  return last
}
window.__MOUNT__ = async function (w) {
  const host = document.createElement('div')
  host.id = 'capHost'
  host.style.cssText = 'width:' + w + 'px'
  document.body.appendChild(host)
  window.__HOST__ = host
  if (!capsuleComp) return { error: 'no statusbar registration', names: regs.map((r) => r.m && r.m.name) }
  const props = Object.assign(
    capsuleComp.m.inject ? capsuleComp.m.inject('sess-1') : { sessionId: 'sess-1' },
    { session: { cwd: CWD }, useSessions: () => null, inputActions: null },
  )
  let thrown = null
  try {
    window.__RDOM__.createRoot(host).render(React.createElement(capsuleComp.c, props))
  } catch (e) { thrown = String((e && e.message) || e) }
  const arrived = await window.__WAIT__(() => !!host.querySelector('.dsws-capsule'), 8000)
  await window.__SETTLE__()
  return { ok: !!host.querySelector('.dsws-capsule'), arrived: arrived, thrown: thrown }
}
window.__SET_W__ = async function (w) {
  const host = window.__HOST__
  if (!host) return { error: 'not mounted' }
  host.style.width = w + 'px'
  const tier = await window.__SETTLE__()
  return { tier: tier }
}
window.__MEASURE__ = function () {
  const cap = document.querySelector('.dsws-capsule')
  if (!cap) return { error: 'no capsule' }
  const vis = function (el) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const items = Array.from(cap.querySelectorAll('[data-fold-priority]')).map(function (el) {
    const box = el.parentElement
    return {
      p: String(el.getAttribute('data-fold-priority') || ''),
      text: String(el.textContent || ''),
      visible: vis(el),
      folded: el.classList.contains('dsws-folded'),
      // 那一段旁边的图标（数字或字形）：它是载荷，任何宽度都该在。
      iconVisible: vis(box ? box.querySelector('svg') : null),
    }
  })
  const nums = Array.from(cap.querySelectorAll('.dsws-num')).map(function (el) {
    return { text: String(el.textContent || ''), visible: vis(el) }
  })
  const wordEl = cap.querySelector('.dsws-capsule-word')
  return {
    tier: Number(cap.getAttribute('data-fold-tier')),
    foldCount: Number(cap.getAttribute('data-fold')),
    width: Math.round(cap.getBoundingClientRect().width),
    clientW: cap.clientWidth, scrollW: cap.scrollWidth, overflow: cap.scrollWidth - cap.clientWidth,
    wordVisible: vis(wordEl), wordHasIcon: !!(wordEl && wordEl.querySelector('svg')),
    items: items, nums: nums,
  }
}
// D 组用：像 React 那样把一段字整串换掉（真实场景里就是时间串每秒在变），再叫醒机器一次。
window.__WRITE_TEXT__ = function (p, text) {
  const el = document.querySelector('.dsws-capsule [data-fold-priority="' + p + '"]')
  if (!el) return { error: 'no element ' + p }
  el.textContent = text
  window.dispatchEvent(new Event('resize'))
  return { ok: true, wrote: text }
}
window.__PROBE_READY__ = true
`
const { build } = await import('esbuild')
const bundled = await build({
  stdin: { contents: ENTRY, resolveDir: resolve('.'), sourcefile: 'verify-cap-fold-probe.js', loader: 'js' },
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, logLevel: 'error',
})
const probeJs = bundled.outputFiles[0].text
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#10131a}
#capHost{display:block}
</style></head>
<body>
<script>window.__CLIENT_SRC__ = ${JSON.stringify(artifacts[CLIENT] || read(CLIENT))};</script>
<script>window.__CWD__ = ${JSON.stringify(CWD)};window.__SNAP__ = ${JSON.stringify(SNAP)};</script>
<script>${probeJs}</script></body></html>`
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = 'http://127.0.0.1:' + server.address().port + '/'
const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + (e && e.message)))
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
  await page.goto(origin, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__PROBE_READY__ === true, null, { timeout: 15000 })

  console.log('')
  console.log('C) 真渲染层：宽度 900 → 240 每 6 像素扫一档（真产物 + 真词条）')
  const mounted = await page.evaluate(() => window.__MOUNT__(900))
  if (!mounted || !mounted.ok) {
    bad('C 状态胶囊栏没挂起来：' + JSON.stringify(mounted) + ' / 页面错误 ' + JSON.stringify(pageErrors.slice(0, 3)))
  } else {
    ok('C0 状态胶囊栏挂起来了（真产物 + 真 rpc 载体）')
    const unitsOf = function (text, cut) { const s = String(text || ''); return cut !== 'word' ? s.length : (s.trim() === '' ? 0 : s.trim().split(/\s+/).length) }
    const cutOf = (p) => ((capFold && capFold.CAP_FOLD_POLICY[p]) || {}).cut || 'word'
    const unitsOfSample = function (m) {
      let n = 0
      const per = {}
      m.items.forEach(function (it) { per[it.p] = unitsOf(it.folded ? '' : it.text, cutOf(it.p)); n += per[it.p] })
      return { total: n, per: per }
    }
    const samples = []
    let err = null
    for (let w = 900; w >= 240; w -= 6) {
      const set = await page.evaluate((x) => window.__SET_W__(x), w)
      if (!set || set.error) { err = set; break }
      const m = await page.evaluate(() => window.__MEASURE__())
      if (!m || m.error) { err = m; break }
      samples.push({ w: w, m: m, u: unitsOfSample(m) })
    }
    if (err) {
      bad('C 宽度扫描中断：' + JSON.stringify(err))
    } else {
      // 先把这个宽度扫出来的实况打印出来（报告里那张表就是它的出处）。
      const firstAt = {}
      samples.forEach((s) => { if (!(s.m.tier in firstAt)) firstAt[s.m.tier] = s })
      console.log('     （宽度 → 渲染成什么；每档第一次出现的那一处）')
      Object.keys(firstAt).map(Number).sort((a, b) => a - b).forEach((t) => {
        const s = firstAt[t]
        const parts = s.m.items.map((it) => it.p + ':' + (it.folded ? '（收）' : JSON.stringify(it.text))).join(' ')
        console.log('       第 ' + t + ' 档 @ ' + s.w + 'px：单位合计 ' + s.u.total + ' / 溢 ' + s.m.overflow + ' / ' + parts)
      })
      console.log('     （最窄那几档实况：宽度 档号 单位合计 溢出 clientWidth/scrollWidth 数字个数）')
      samples.slice(-8).forEach((s) => {
        console.log('       ' + s.w + 'px 第' + s.m.tier + '档 单位' + s.u.total + ' 溢' + s.m.overflow + ' cw' + s.m.clientW + ' sw' + s.m.scrollW + ' 数字' + s.m.nums.length)
      })

      const maxTier = samples.reduce((n, s) => Math.max(n, s.m.tier), 0)
      // 一、档号只升不降（同一个宽度上不来回跳）
      let monotone = true
      for (let i = 1; i < samples.length; i++) if (samples[i].m.tier < samples[i - 1].m.tier) monotone = false
      check(monotone, 'C1 面板越窄档号只升不降（实测档号 ' + samples.map((s) => s.m.tier).join(',') + '）')
      // 二、核心判据：档号涨几，可见单位就少几 —— 每往下一档恰好多让掉一个单位
      let worst = null
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i]
        const drop = a.u.total - b.u.total
        const rungs = b.m.tier - a.m.tier
        const bad1 = drop < 0 || drop !== rungs
        if (bad1 && (!worst || Math.abs(drop - rungs) > Math.abs(worst.d) )) worst = { w: b.w, drop: drop, rungs: rungs, d: drop - rungs }
      }
      check(!worst, 'C2 每往下一档恰好多让掉一个单位（档号涨几、可见单位就少几；实测最多对不上的地方 ' + (worst ? JSON.stringify(worst) : '一处都没有') + '）')
      // 三、每一档要么放得下，要么已经收到底（所有可让的字都让完了；剩下的图标与数字是载荷，不撤）
      const wrong = samples.filter((s) => s.m.overflow > 1 && s.m.tier < maxTier).map((s) => s.w + 'px(第' + s.m.tier + '档,溢' + s.m.overflow + ')')
      check(wrong.length === 0, 'C3 每一档要么放得下、要么已经收到底（实测先于最后一档就溢出的宽度：' + JSON.stringify(wrong) + '；最窄 240 像素实测第 ' + samples[samples.length - 1].m.tier + ' 档、溢出 ' + samples[samples.length - 1].m.overflow + '）')
      const widest = samples[0]
      check(widest.m.overflow <= 1, 'C4 最宽那一档（900 像素）放得下（实测溢 ' + widest.m.overflow + '）')
      // 四、计数器数字永不消失；品牌那一段的可见性是随宽度来的（这一轮改口径的地方）：
      //   最宽那一档它整串字都在，第一段台阶就是它少一个字，收到底之后它才不见；
      //   那枚品牌图标任何时候都在（它不是「一串字」，谁也收不走它）。
      const numBad = []
      samples.forEach((s) => s.m.nums.forEach((n, i) => { if (!n.visible) numBad.push(s.w + 'px#' + i) }))
      check(samples[0].m.nums.length >= 3 && numBad.length === 0,
        'C5 每一档的计数器数字都还在（实测共 ' + samples[0].m.nums.length + ' 枚；看不见的：' + JSON.stringify(numBad) + '）')
      const brandText = (s) => {
        const b = s.m.items.filter((it) => it.p === '1')[0]
        return b ? String(b.text || '') : ''
      }
      const brand0 = samples[0]
      check(brand0 && brandText(brand0) === 'MattSkills',
        'C6 最宽那一档（900 像素）品牌那串字是整串可见的（维护者的真意「有位置就显示」；实测 ' + JSON.stringify(brand0 ? brandText(brand0) : null) + '）')
      // C7 是这一轮最关键的一条：往下**第一段台阶**必须是品牌掉一个字 —— 品牌不是「到最后才收」的，
      //   它是第一个让位的（宽度再少一点就先收它）。这里按档号取第 0 档与第 1 档来比，
      //   不按相邻两个宽度采样来比：宽度每走 6 像素，机器可能一次走过两档。
      const atTier = (t) => samples.filter((s) => s.m.tier === t)[0]
      const t0 = atTier(0)
      const t1 = atTier(1)
      check(!!t0 && !!t1 && brandText(t1) === brandText(t0).slice(0, -1) && brandText(t1).length === brandText(t0).length - 1,
        'C7 第一段台阶就是品牌掉一个字（品牌是第一个让位的；实测第 0 档 ' + JSON.stringify(t0 ? brandText(t0) : null) + ' → 第 1 档 ' + JSON.stringify(t1 ? brandText(t1) : null) + '）')
      // C8：从第 0 档往下走，先是品牌一个一个掉字（它掉的是自己的字），走完它才轮到第 2 段。
      //   这一条按「品牌掉完字」那一刻取样：那一刻之前别的段一个字都不许动。
      //   先钉住「品牌在第 0 档是整串的」（不然下面那段 1..N 的范围会变成空的，这条断言就成了空话）。
      const brandWhole = brandText(samples[0])
      check(brandWhole === 'MattSkills',
        'C8 第 0 档品牌是整串的（这是下面 1..' + brandWhole.length + ' 档那一段的前提；实测 ' + JSON.stringify(brandWhole) + '）')
      const brandsMid = samples.filter((s) => s.m.tier >= 1 && s.m.tier <= brandWhole.length)
      const otherMoved = brandsMid.filter((s) => {
        const b = s.m.items.filter((it) => it.p === '1')[0]
        const seg2 = s.m.items.filter((it) => it.p === '2')[0]
        return !b || String(seg2 && seg2.text).trim() !== '沉淀'
      }).map((s) => s.w)
      check(brandWhole.length === 10 && brandsMid.length >= 1 && otherMoved.length === 0,
        'C9 品牌掉字的那 1..' + brandWhole.length + ' 档里，别的段一个字都不许动（实测扫到的档数 ' + brandsMid.length + '、动过的宽度：' + JSON.stringify(otherMoved) + '）')
      const iconBad = samples.filter((s) => !s.m.wordVisible || !s.m.wordHasIcon).map((s) => s.w)
      check(iconBad.length === 0, 'C10 品牌那一段的挂点与那枚图标在任何宽度都还在（实测丢掉的宽度 ' + JSON.stringify(iconBad) + '）')

      // 五、每档至少让掉一点：档号涨了，可见单位必须跟着少（没有空转的档）
      const stall = []
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].m.tier > samples[i - 1].m.tier && samples[i].u.total === samples[i - 1].u.total) stall.push(samples[i].w)
      }
      check(stall.length === 0, 'C10 没有空转的档：档号一涨，版面上确实少了东西（实测空转的宽度 ' + JSON.stringify(stall) + '）')
      // 六、收到底之后不再撤：最后一档之后，档号与可见单位都不再变
      const bottom = samples.filter((s) => s.m.tier === maxTier)
      const bottomUnits = bottom.map((s) => s.u.total)
      check(bottomUnits.every((n) => n === bottomUnits[0]),
        'C11 收到底之后不再撤：最后那一档的可见单位数恒定（实测 ' + JSON.stringify(bottomUnits) + '）')

      console.log('')
      console.log('D) 去掉 2 秒轮询之后的两条兜底证据')
      // ① 改完宽度等 2200 毫秒再量一次：那个轮询当年兜的就是「某一帧之后还有人来动它」，
      //    现在没有轮询了，这里就得证明「等两秒之后仍然正确」，而不是靠某一次测量碰巧量对。
      const picks = [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]]
      for (const s of picks) {
        await page.evaluate((x) => window.__SET_W__(x), s.w)
        await page.waitForTimeout(2200)
        const late = await page.evaluate(() => window.__MEASURE__())
        const lateU = unitsOfSample(late)
        check(late.tier === s.m.tier && lateU.total === s.u.total && (late.overflow <= 1 || late.tier === maxTier),
          'D1 改完宽度等 2200 毫秒仍然正确（' + s.w + 'px：刚量到第 ' + s.m.tier + ' 档 / 单位 ' + s.u.total + '，两秒后第 ' + late.tier + ' 档 / 单位 ' + lateU.total + '、溢 ' + late.overflow + '）')
      }
      // ② 外来的文字写入：真实场景里就是 React 重渲染把收短过的那串换回完整的一串（时间串一直在变）。
      //    这里模拟一次那笔写入，再叫醒机器 —— 它必须把这串当成**新的事实**重新排一遍阶梯，
      //    而不是拿手里那张旧表硬收（那样会越收越短、再也展不开）。这正是当年那个轮询兜的事。
      //    判据写成「重排之后版面上剩下的那串，是从**新写进去的那串**的前面截的」：
      //    写进去的是一串字母，旧的那张表里根本没有这些字，所以只要画面上出现它们，就说明机器换了事实。
      const WROTE = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      await page.evaluate((x) => window.__SET_W__(x), 900)
      const wrote = await page.evaluate((s) => window.__WRITE_TEXT__('9', s), WROTE)
      await page.evaluate(() => window.__SETTLE__())
      const after = await page.evaluate(() => window.__MEASURE__())
      const nine = after.items.filter((it) => it.p === '9')[0] || null
      const allGiven = after.items.every((it) => String(it.text).trim() === '')
      check(!!wrote && !!wrote.ok && (after.overflow <= 1 || allGiven),
        'D2 外来写入之后这一条横条照旧不溢出（要么放得下、要么所有可让的字都让完了；实测溢 ' + after.overflow + '、全让完 ' + allGiven + '）')
      check(!!nine && String(nine.text).indexOf(' ABC') === 0,
        'D3 那笔写入被当成新的事实重新排了一遍阶梯（版面上剩下的是新那串的前缀；实测 ' + JSON.stringify(nine && nine.text) + '）')
      // 页面里不许有未捕获的报错（这一条是硬断言）。控制台告警另算：状态栏自己那几个列表
      //   （品牌那一段的两个孩子等）本来就没有 key，React 会照例告警 —— 那是本票没碰的地方，
      //   照原样打印出来，但不判红；出现别的控制台报错才红。
      const thrown = pageErrors.filter((e) => e.indexOf('pageerror:') === 0)
      const consoleErrs = pageErrors.filter((e) => e.indexOf('console:') === 0)
      const known = consoleErrs.filter((e) => e.indexOf('unique "key" prop') < 0)
      check(thrown.length === 0, 'D4 整段扫描期间页面没有未捕获的报错（实测 ' + thrown.length + ' 条' + (thrown.length ? '：' + JSON.stringify(thrown.slice(0, 3)) : '') + '）')
      check(known.length === 0, 'D5 控制台里没有那条「key 缺失」之外的报错（实测 ' + known.length + ' 条' + (known.length ? '：' + JSON.stringify(known.slice(0, 3)) : '；本票没碰的 key 告警 ' + consoleErrs.length + ' 条，照原样留着') + '）')
    }
  }
} finally {
  await browser.close()
  server.close()
}
console.log('')
console.log(passed + ' 条通过，' + failed + ' 条失败')
process.exit(failed ? 1 : 0)
