// verify-panel-workspace-isolation.ts — #45 多工作区隔离回归
// 量什么：客户端探查链路（src/client/kernel/probe-auto.js）在多工作区下不许串台 ——
//   按工作区键分组、组内共用一次重建、组间零污染；兜底路径按 sessionId→cwd 精确映射，不许把首个 cwd 错绑给所有空 store。
// 用法: node --import ./scripts/ts-hook.mts tests/verify-panel-workspace-isolation.ts
//
// 2026-10-17 重写（先修后转的第一笔）：原来读的是构建产物 client.js / package/lib/client.js，
//   两份产物都不在 git 里，别人改完源码不重建时这里量的还是旧行为；其中一条断言还写成了
//   「或含 keyOf(...) 字样」，把判据放宽到恒真（把 `===` 反向改坏它也照样绿）。
//   现在读真源，每条判据都配一个「把源码改坏必须判红」的变异自检：跑不红就说明判据没牙，门禁自己判红。
// 只看文本形状，不执行产品代码；整行注释先剥掉，免得注释里的旧写法把判据带偏。
// 第二笔改名成 TypeScript（2026-10-17）：只加类型标注、把 process.exit 换成 process.exitCode
//   （装载钩子下加载的 .ts 里硬退出会撞 libuv 断言崩溃），判据与文案一个字没动。
// 第三笔（#1251）：probe-auto 转成 TypeScript 后，同名 .js 变成 esbuild 构建产物，
//   直接读它会读到大改过形态的文本（`function(cwd)`、类型被剥掉）。这里要的是「源码里有这个函数、
//   有这个分支」，所以走 sourcePath 优先拿同名 .ts 真源；判据与变异片段跟着 .ts 的类型标注同步，
//   仍然要求「改坏源码必须判红」，没有放松任何一条。
const fs = require('fs')
const path = require('path')
const { sourcePath } = require('./lib/source-text.ts')

/**
 * 一条判据：名字给人和日志看，bad 判断「这段源码不合规」。
 * 写成函数而不是正则字面量，是因为有几条判据要多处合看（例如 sidToCwd 既要建表、也要真的拿来赋值）。
 */
type IsolationRule = { name: string; bad: (src: string) => boolean }
/** 变异：把源码里 from 换成 to，对应判据必须因此报红。 */
type RuleMutation = { rule: string; from: string; to: string }

const SRC_REL = sourcePath('src/client/kernel/probe-auto.js')
const ROOT = path.join(__dirname, '..')

// 剥掉整行注释（源码里诸如「从前这一行下面一律 loadSnapshot(primary, true, true)」这类说明，
// 是历史记录，不该被当成今天的调用点）。
function stripLineComments(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, '')
}

const RULES: IsolationRule[] = [
  {
    name: '存在 refreshGroup(cwd) 按组刷新辅助',
    // .ts 真源在参数上带类型标注（cwd: any），所以参数名与右括号之间允许出现 `: 类型`；
    // 仍然要求函数就是 `function (cwd ...)` 这个形状，不接受换成别的参数名或加参数。
    bad: src => !/const\s+refreshGroup\s*=\s*function\s*\(\s*cwd\s*(?::[^)]*)?\)/.test(src),
  },
  {
    name: '分组前先把 cwd 归一成工作区键（normWanted = wsKeyOf(cwd)）',
    // 同理，`const normWanted: any = wsKeyOf(cwd)` 是转写后的真源形态。
    bad: src => !/const\s+normWanted\s*(?::[^=]*)?=\s*wsKeyOf\(cwd\)/.test(src),
  },
  {
    name: 'shared 只在与探查工作区同键时入组',
    bad: src => !/wsKeyOf\(shared\.cwd\)\s*===\s*normWanted/.test(src),
  },
  {
    name: 'stores 只在与探查工作区同键时入组',
    bad: src => !/st\.cwd\s*&&\s*wsKeyOf\(st\.cwd\)\s*===\s*normWanted/.test(src),
  },
  {
    name: '已移除旧缺陷指纹：if (cwd && !st2.cwd) st2.cwd = cwd 之后无条件全量广播',
    bad: src => /if\s*\(\s*cwd\s*&&\s*!st2\.cwd\s*\)\s*st2\.cwd\s*=\s*cwd/.test(src),
  },
  {
    name: '空组时不发全量重建（#232 R3：无人观看的工作区静默放行）',
    bad: src => {
      const m = src.match(/if\s*\(\s*!group\.length\s*\)\s*\{([\s\S]*?)\n\s*\}/)
      if (!m) return true
      return /host\.call\(\s*'wf\.refresh'|rpcCall\(\s*'refresh'/.test(m[1])
    },
  },
  {
    name: '兜底路径按 sessionId→cwd 精确映射（sidToCwd 表要真的被用来赋值）',
    bad: src => !(/sidToCwd\[st\.sessionId\]/.test(src) && /st\.cwd\s*=\s*sidToCwd\[/.test(src)),
  },
  {
    name: '已移除首绑缺陷指纹：shared.cwd !== foundCwds[0] 时无条件改写',
    bad: src => /if\s*\(\s*shared\.cwd\s*!==\s*foundCwds\[0\]\s*\)\s*shared\.cwd\s*=\s*foundCwds\[0\]/.test(src),
  },
  {
    name: '组内首个 primary 负责 loadSnapshot（带正确 cwd）',
    bad: src => !/loadSnapshot\(primary/.test(src),
  },
]

// 每个判据配一个变异：改坏之后这条判据必须报红。
// 片段都取自 .ts 真源：源码里带类型标注的地方（`const x: any = ...`）就不再把这些标注抄进 from，
// 只从等号或函数体这些两侧都稳定的位置切，避免下一次类型微调又让变异落空。
const MUTATIONS: RuleMutation[] = [
  { rule: '存在 refreshGroup(cwd) 按组刷新辅助', from: 'refreshGroup = function (cwd', to: 'refreshGroupX = function (cwd' },
  { rule: '分组前先把 cwd 归一成工作区键（normWanted = wsKeyOf(cwd)）', from: '= wsKeyOf(cwd)', to: '= cwd' },
  { rule: 'shared 只在与探查工作区同键时入组', from: 'wsKeyOf(shared.cwd) === normWanted', to: 'true' },
  { rule: 'stores 只在与探查工作区同键时入组', from: 'st.cwd && wsKeyOf(st.cwd) === normWanted', to: 'true' },
  { rule: '已移除旧缺陷指纹：if (cwd && !st2.cwd) st2.cwd = cwd 之后无条件全量广播', from: '= group[0]', to: '= group[0]\n      if (cwd && !st2.cwd) st2.cwd = cwd' },
  { rule: '空组时不发全量重建（#232 R3：无人观看的工作区静默放行）', from: 'if (!group.length) {', to: "if (!group.length) { host.call('wf.refresh', { cwd: cwd });" },
  { rule: '兜底路径按 sessionId→cwd 精确映射（sidToCwd 表要真的被用来赋值）', from: 'st.cwd = sidToCwd[st.sessionId]', to: 'st.cwd = foundCwds[0]' },
  { rule: '已移除首绑缺陷指纹：shared.cwd !== foundCwds[0] 时无条件改写', from: '= Array.from(foundCwdsByNorm.values())', to: '= Array.from(foundCwdsByNorm.values())\n      if (shared.cwd !== foundCwds[0]) shared.cwd = foundCwds[0]' },
  { rule: '组内首个 primary 负责 loadSnapshot（带正确 cwd）', from: 'loadSnapshot(primary, true, true)', to: 'loadSnapshot(rest[0], true, true)' },
]

let failed = 0
const ok = (cond: unknown, msg: string): void => { console.log((cond ? '  PASS ' : '  FAIL ') + msg); if (!cond) { failed++; console.error('    ✗', msg) } }

const abs = path.join(ROOT, SRC_REL)
if (!fs.existsSync(abs)) {
  console.error('找不到真源 ' + SRC_REL + '：先确认它没被改名或搬家')
  // 退出码只给 0/1；这里用 exitCode 而不是 process.exit()：在装载钩子下加载的 .ts 里，
  // 处理函数还在场时硬退出会撞上 libuv 断言（Windows 上实测 0xC0000409 崩溃，输出已打完才崩）。
  process.exitCode = 1
} else {
  const raw = fs.readFileSync(abs, 'utf8')
  const src = stripLineComments(raw)

  console.log('=== #45 工作区隔离（读真源 ' + SRC_REL + '）===')
  for (const rule of RULES) ok(!rule.bad(src), rule.name)

  console.log('\n=== 变异自检：把源码改坏一处，对应判据必须报红 ===')
  for (const mut of MUTATIONS) {
    const rule = RULES.find(r => r.name === mut.rule)
    // 在剥掉注释后的文本上做变异：否则第一处命中可能落在注释里的历史写法上，
    // 真正跑的那行没被动到，自检就会假装判据没牙（或反过来假装变异没落地）。
    const mutated = src.split(mut.from).join(mut.to)
    if (mutated === src) {
      ok(false, '变异没落地（源码里找不到片段：' + mut.from + '）——判据锚点已过期，请同步')
      continue
    }
    ok(rule.bad(mutated) === true, '改坏后判红：' + mut.rule)
  }

  console.log('\n=== 汇总 ===')
  if (failed === 0) { console.log('全部通过 ✅ — #45 隔离判据在真源上成立，且每条判据都改得红'); process.exitCode = 0 }
  else { console.log('存在失败 ❌ — 共 ' + failed + ' 项'); process.exitCode = 1 }
}
