// 门禁归属: src/shared/version-control/src/commit-plan.ts
// verify-1586-commit-page.ts —— 提交页能力（规格 #1586 域 2 八条，T08 #1743）。
//
// 这一扇守的是「八条提交能力各自唯一主入口，git 参数独立拼装」这一组外部行为：
//   A 组：2.1–2.8 每条能力的 argv 逐元素断言（数组、不经 shell、次序固定）。
//   B 组：计划校验（2.4 缺目标 / 坏目标）、危险动作识别（2.3 / 2.4）、追加签名行原文。
//   B5/B6 是两条反证：把真源文本改坏之后，同一套断言必须判红——证明这扇门禁会咬，不是永远绿。
//
// 做法：不 import 真源模块，而是读真源原文、按构建同一份转译口径当场求值（与 verify-818 同一套装置）。
//   这样反证才落在「真源原文」上：改坏一份真源文本，就能看同一套断言在改坏的实现上判红。
//   后续 C–F 组（宿主读电话 / 预检 / 执行 / 客户端面板）在同一份文件上按同样方式追加。
//
// 用法：node --import ./scripts/ts-hook.mts tests/verify-1586-commit-page.ts
const path = require('path')
const { printGateResult } = require('./lib/gate-result.ts')
const { sourceText } = require('./lib/source-text.ts')
const { compileFn } = require('./lib/eval-probe.ts')

const ROOT = path.resolve(__dirname, '..')
const GATE = 'verify-1586-commit-page'
let total = 0
let failed = 0
const check = (ok, msg) => {
  total += 1
  if (!ok) failed += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
}

const PLAN_SOURCE = 'src/shared/version-control/src/commit-plan.ts'
const PLAN_EXPORTS = [
  'VC_COMMIT_MODES', 'VC_COMMIT_MODE_KEYS', 'VC_COMMIT_MODE_CAPS', 'COMMIT_TARGET_PATTERN',
  'commitPlanDefault', 'commitPlanOf', 'commitPlanProblem', 'commitPlanDangerous', 'commitArgvOf', 'commitTrailerOf',
  'COMMIT_PLAN_SOURCE',
]

/** 去掉行首 export：与 verify-818 的拼闭包装置同一写法（求值用的是真源原文，不是产物）。 */
function stripExports(text) { return text.replace(/^(\s*)export\s+/gm, '$1') }

/** 按构建同一份转译参数把这段源码转成 JavaScript（不在这里另写一套参数）。 */
function toEvalJs(code) {
  const { TRANSPILE_OPTIONS } = require('../scripts/lib/transpile-unit.mts')
  return require('esbuild').transformSync(code, TRANSPILE_OPTIONS).code
}

/** 把 commit-plan 真源原文（可先按 patch 改坏）求值成一组函数：反证装置就靠这个入口。 */
function evalPlan(patch) {
  let src = stripExports(sourceText(PLAN_SOURCE))
  if (patch) src = patch(src)
  src = toEvalJs(src)
  const body = src + '\nreturn { ' + PLAN_EXPORTS.join(', ') + ' }\n'
  return compileFn(['unused'], body)(null)
}

const P = evalPlan(null)

/** A5 的断言本体：单独抽出来，B5 的反证要对同一个函数用改坏实现再判一次。 */
const skipHooksOk = (M) => M.commitArgvOf({ mode: 'staged', skipHooks: true }, '标题').join('|') === 'commit|--no-verify|-m|标题'
/** A7 的断言本体：多行说明必须整段保留在同一个参数元素里。 */
const multiLineOk = (M) => {
  const msg = '标题\n\n正文第一段\n第二段'
  const argv = M.commitArgvOf({ mode: 'staged' }, msg)
  return argv.length === 3 && argv[2] === msg && argv[2].split('\n').length === 4
}

// ---------- A 组：八条能力各自的 argv（数组元素逐个断言，不拼整行比对） ----------
const av = (plan, msg) => P.commitArgvOf(plan, msg).join('|')

check(av({ mode: 'staged' }, '标题') === 'commit|-m|标题', 'A1 2.1 提交已暂存内容：argv 为 commit / -m / 说明三个独立元素')
check(av({ mode: 'all' }, '标题') === 'commit|-a|-m|标题', 'A2 2.2 提交全部已跟踪改动：-a 是独立元素，排在说明之前')
check(av({ mode: 'amend' }, '') === 'commit|--amend|--no-edit', 'A3a 2.3 修订上一条提交且不写新说明：用 --amend 与 --no-edit')
check(av({ mode: 'amend' }, '改说明') === 'commit|--amend|-m|改说明', 'A3b 2.3 修订并改说明：--amend 与 -m 说明各自独立')
check(av({ mode: 'fixup', target: 'HEAD~1' }, '随便') === 'commit|--fixup=HEAD~1', 'A4a 2.4 fixup：目标以 --fixup=<目标> 一个元素传入，不拼 -m')
check(av({ mode: 'squash', target: 'abc123' }, '随便') === 'commit|--squash=abc123', 'A4b 2.4 squash：目标以 --squash=<目标> 一个元素传入，不拼 -m')
check(skipHooksOk(P), 'A5 2.5 跳过钩子：--no-verify 是独立元素，且恰好一次')
check(av({ mode: 'staged', sign: true }, '标题') === 'commit|-S|-m|标题' && av({ mode: 'staged', signoff: true }, '标题') === 'commit|-s|-m|标题', 'A6a 2.6 签名提交（-S）与追加签名行（-s）各是各的元素')
check(av({ mode: 'staged', sign: true, signoff: true }, '标题') === 'commit|-S|-s|-m|标题', 'A6b 2.6 两者同时勾选：-S 与 -s 分别是独立元素，不是一个合并开关')
check(!P.commitArgvOf({ mode: 'staged', sign: true }, '标题').includes('-s') && !P.commitArgvOf({ mode: 'staged', signoff: true }, '标题').includes('-S'), 'A6c 2.6 只勾签名时没有 -s、只勾追加签名行时没有 -S（两件事不互相冒充）')
check(multiLineOk(P), 'A7 2.7 多行提交说明：换行原样保留，整段说明只占 -m 后面的一个元素')
check(JSON.stringify(P.commitArgvOf({ mode: 'staged' }, '标题\n\n模板第一段\n模板第二段')) === JSON.stringify(['commit', '-m', '标题\n\n模板第一段\n模板第二段']), 'A8 2.8 套用模板后的原文：整份模板文本作为同一个 -m 元素传入')
check(av({ mode: 'staged', sign: true, signoff: true, skipHooks: true }, '标题') === 'commit|-S|-s|--no-verify|-m|标题', 'A9 全部开关一起勾：选项次序固定为 -S / -s / --no-verify / -m')
const argvAll = P.commitArgvOf({ mode: 'all', sign: true, signoff: true, skipHooks: true }, '标题')
check(argvAll.every((x) => typeof x === 'string' && x.indexOf('commit ') !== 0 && x.trim() === x), 'A10 argv 每个元素都是独立字符串（没有把多个选项拼成一整行，也没有首尾空白）')

// ---------- B 组：计划归一、校验、危险动作、追加签名行原文 ----------
const norm = P.commitPlanOf({ mode: 'nonsense', target: '  HEAD~1  ', skipHooks: 1, sign: 'true', signoff: true })
check(norm.mode === 'staged' && norm.target === 'HEAD~1' && norm.skipHooks === false && norm.sign === false && norm.signoff === true, 'B1 外部输入归一：名单外形态回落 staged，目标去空白，布尔只认 true')
check(P.commitPlanProblem({ mode: 'fixup' }) === 'need-commit-target', 'B2a 2.4 fixup 没选目标：理由为 need-commit-target')
check(P.commitPlanProblem({ mode: 'squash', target: '-x' }) === 'bad-commit-target', 'B2b 目标以短横线开头（像开关）：理由为 bad-commit-target')
check(P.commitPlanProblem({ mode: 'staged', target: 'a b' }) === 'bad-commit-target', 'B2c 目标里有空格：理由为 bad-commit-target')
check(P.commitPlanProblem({ mode: 'fixup', target: 'HEAD~1' }) === null && P.commitPlanProblem(P.commitPlanDefault()) === null, 'B2d 合法目标与默认计划都通过校验')
check(P.commitPlanDangerous({ mode: 'amend' }) && P.commitPlanDangerous({ mode: 'fixup', target: 'HEAD~1' }) && P.commitPlanDangerous({ mode: 'squash', target: 'HEAD~1' }), 'B3a 2.3 / 2.4 都被认成危险动作（界面必须给确认卡）')
check(!P.commitPlanDangerous({ mode: 'staged' }) && !P.commitPlanDangerous({ mode: 'all' }), 'B3b 2.1 / 2.2 不是危险动作')
check(P.commitTrailerOf({ name: '张三', email: 'z@y' }) === 'Signed-off-by: 张三 <z@y>', 'B4a 追加签名行原文按 git 的 Signed-off-by 格式生成')
check(P.commitTrailerOf({ name: '张三' }) === '' && P.commitTrailerOf(null) === '', 'B4b 身份缺名字或邮箱时回空串（界面据此说写不出来，不编造一行假签名）')

// ---------- 反证：篡改真源文本之后，同一套断言必须判红 ----------
const rawPlanSrc = sourceText(PLAN_SOURCE)
const mutant1Src = rawPlanSrc.replace("argv.push('--no-verify')", "argv.push('--no-verify-x')")
check(mutant1Src !== rawPlanSrc, 'B5-pre 反证一改动命中真源原文（改了 --no-verify 那一行）')
const mut1 = evalPlan((s) => s.replace("argv.push('--no-verify')", "argv.push('--no-verify-x')"))
check(skipHooksOk(P) === true && skipHooksOk(mut1) === false, 'B5 反证一：把 --no-verify 改坏后，A5 的同一断言必须判红')

const mutant2Patch = (s) => s.replace('argv.push(\'-m\', msg)', "argv.push('-m', msg.split('\\n')[0])")
const mutant2Src = mutant2Patch(rawPlanSrc)
check(mutant2Src !== rawPlanSrc, 'B6-pre 反证二改动命中真源原文（把 -m 的值改成只取第一行）')
const mut2 = evalPlan(mutant2Patch)
check(multiLineOk(P) === true && multiLineOk(mut2) === false, 'B6 反证二：把多行说明改成只取第一行后，A7 的同一断言必须判红')
check(skipHooksOk(mut1) === false && multiLineOk(mut2) === false, 'B7 反证装置自检：两条反证各自改中的那一半判红（不是所有断言一起红）')

console.log('')
console.log('汇总：' + total + ' 条断言，' + failed + ' 条失败')
printGateResult(GATE, total, failed)
process.exit(failed > 0 ? 1 : 0)
