#!/usr/bin/env node
// tests/verify-1191-contract-op.ts —— 门禁：contract-op 新路径真的跑得通（票 #1191）
// 用法：在插件根目录执行 node --import ./scripts/ts-hook.mts tests/verify-1191-contract-op.ts
//
// 背景：GitLab 房发出 {type:'contract-op', op:'initProject'} 的建仓向导提交，房间形状已有
//   verify-1187 第⑤节盯着；本文件盯中间两环真的跑起来：
//   ① 分发器把 contract-op 翻成宿主电话 wf.contractOp（操作名 + 合并后的参数），失败翻译不丢上下文；
//   ② 宿主 handleContractOp 按操作名分发：initProject 透传建仓，未知操作名 / 缺操作名诚实回绝，不碰工作区。
// 门禁归属: src/client/kernel/actions.ts
// 门禁归属: src/host/publishFlow.ts
// 门禁归属: src/shared/tracker/chain-validate.ts
const nodePath = require('path')
const { pathToFileURL } = require('url')

const ROOT = nodePath.resolve(__dirname, '..')
const url = (rel) => pathToFileURL(nodePath.join(ROOT, rel)).href

let total = 0
const broken = []
function must(cond, invariant, detail) {
  total += 1
  if (cond) { console.log('  PASS ' + invariant); return }
  const line = '  FAIL 不变式破了 —— ' + invariant + (detail ? '【实测：' + detail + '】' : '')
  console.log(line)
  broken.push(line.replace(/^\s+/, ''))
}
function title(t) { console.log('\n' + t) }

async function main() {
  const actions = await import(url('src/client/kernel/actions.js'))
  const validator = await import(url('src/shared/tracker/chain-validate.js'))
  const flowMod = await import(url('src/host/publishFlow.js'))

  title('① 校验器：contract-op 有操作名才算有效')
  {
    const v1 = validator.validateAction({ type: 'contract-op', op: 'initProject' })
    must(v1 && v1.ok === true, '带操作名的 contract-op 校验通过', JSON.stringify(v1))
    const v2 = validator.validateAction({ type: 'contract-op', op: '' })
    must(v2 && v2.ok === false && v2.error && v2.error.kind === 'parse', '空操作名判形状错', JSON.stringify(v2))
    const v3 = validator.validateAction({ type: 'contract-op' })
    must(v3 && v3.ok === false, '缺操作名判形状错', JSON.stringify(v3))
  }

  title('② 分发器：contract-op 翻成宿主电话 wf.contractOp')
  {
    const seen = []
    const ctx = { hostCall: async (method, params) => { seen.push({ method: method, params: params }); return { ok: true, repo: { owner: 'boss', name: 'demo' } } } }
    const d = actions.createActionDispatcher(ctx)
    const r = await d.dispatch({ type: 'contract-op', op: 'initProject', params: { name: 'demo', visibility: 'private' } })
    must(seen.length === 1 && seen[0].method === 'wf.contractOp', '打的是 wf.contractOp 而不是 wf.initPublish', JSON.stringify(seen))
    must(seen[0].params && seen[0].params.op === 'initProject' && seen[0].params.name === 'demo', '操作名与参数一起透给宿主', JSON.stringify(seen[0].params))
    must(r.ok === true && r.data && r.data.repo && r.data.repo.name === 'demo', '成功结果透传给上层', JSON.stringify(r.data))
  }
  {
    const seen = []
    const d = actions.createActionDispatcher({ hostCall: async (m, p) => { seen.push(m); return { ok: true } } })
    const r = await d.dispatch({ type: 'contract-op', params: {} })
    must(r.ok === false && r.error.kind === 'parse', '缺操作名在客户端就拦住', JSON.stringify(r.error))
    must(seen.length === 0, '拦住之后没有打电话', String(seen.length))
  }
  {
    const d = actions.createActionDispatcher({ hostCall: async () => ({ ok: false, errorKind: 'already-exists', error: 'exists', repoUrl: 'https://github.com/o/r' }) })
    const r = await d.dispatch({ type: 'contract-op', op: 'initProject', args: { name: 'a' } })
    must(r.ok === false && r.error.kind === 'already-exists', '宿主业务失败翻成诚实失败', JSON.stringify(r.error))
    must(r.error.repoUrl === 'https://github.com/o/r', '失败上下文 repoUrl 不丢', String(r.error.repoUrl))
  }
  {
    const d = actions.createActionDispatcher({})
    const r = await d.dispatch({ type: 'contract-op', op: 'initProject', params: {} })
    must(r.ok === false && r.error.kind === 'unsupported', '没有 hostCall 时诚实 unsupported', JSON.stringify(r.error))
  }

  title('③ 向导提交：填的值并入参数，操作名原样保留')
  {
    const seen = []
    let capturedSubmit = null
    const ctx = {
      hostCall: async (method, params) => { seen.push({ method: method, params: params }); return { ok: true } },
      renderForm: async (payload, onSubmit) => { capturedSubmit = onSubmit },
    }
    const d = actions.createActionDispatcher(ctx)
    const open = await d.dispatch({ type: 'wizard', steps: [{ title: '仓库信息', schema: [] }], submitAction: { type: 'contract-op', op: 'initProject', params: {} } })
    must(open.ok === true && typeof capturedSubmit === 'function', '向导弹窗正常打开', JSON.stringify(open.ok))
    await capturedSubmit({ name: 'demo', visibility: 'private' })
    must(seen.length === 1 && seen[0].params.op === 'initProject', '提交后操作名还在', JSON.stringify(seen))
    must(seen[0].params.name === 'demo' && seen[0].params.visibility === 'private', '向导填的值并进了参数', JSON.stringify(seen[0].params))
  }

  title('④ 宿主：handleContractOp 按操作名分发')
  function makeDeps(over) {
    const calls = { exec: [] }
    const deps = Object.assign({
      DEFAULT_CWD: 'D:/demo',
      resolveGit: async () => null,
      execProc: async (argv, cwd, phase) => { calls.exec.push(argv); return { ok: true, text: 'true' } },
      canonicalKey: async (cwd) => 'k',
      repoKeys: {}, repoRoots: {},
      setCache: () => {},
      makeCreateErrorClassifier: () => () => 'unknown',
      KIND_UNKNOWN: 'unknown',
    }, over || {})
    return { deps: deps, calls: calls }
  }
  {
    const built = makeDeps()
    const flow = flowMod.createPublishFlow(built.deps)
    const r = await flow.handleContractOp({})
    must(r.ok === false && r.errorKind === 'bad-name', '缺操作名回 bad-name', JSON.stringify(r))
    must(built.calls.exec.length === 0, '回绝之前没碰过工作区', String(built.calls.exec.length))
  }
  {
    const built = makeDeps()
    const flow = flowMod.createPublishFlow(built.deps)
    const r = await flow.handleContractOp({ op: 'dropDatabase' })
    must(r.ok === false && r.errorKind === 'unsupported', '未知操作名诚实回绝', JSON.stringify(r))
    must(built.calls.exec.length === 0, '回绝之前没碰过工作区', String(built.calls.exec.length))
  }
  {
    // 操作名带空格也认（裁剪）：走到建仓流程里，git 缺失那档只有 initPublish 有，出现它即证明转交到了。
    const built = makeDeps()
    const flow = flowMod.createPublishFlow(built.deps)
    const r = await flow.handleContractOp({ op: '  initProject ', name: 'demo' })
    must(r.ok === false && r.errorKind === 'no-git', 'initProject 转交给了建仓流程', JSON.stringify(r))
  }
  {
    // 名字合法但会话没接上：停在会话关卡，目录一步没改。
    const built = makeDeps({ resolveGit: async () => 'MOCK_GIT' })
    const flow = flowMod.createPublishFlow(built.deps)
    const r = await flow.handleContractOp({ op: 'initProject', name: 'demo', visibility: 'private' })
    must(r.ok === false && r.errorKind === 'env', '会话没接上时回环境失败', JSON.stringify(r))
  }
  {
    // 端到端透传：会话里房间建仓成功，名字与可见性原样送到，GitLab 会话兜出 gitlab.com 地址。
    let got = null
    const openSession = async (cwd, opts) => ({
      ok: true, backendId: 'gitlab',
      call: async (fn) => fn({ initProject: async (a, input) => { got = input; return { ok: true, data: { refId: 'boss/demo' } } } }, {}),
    })
    const built = makeDeps({ resolveGit: async () => 'MOCK_GIT', openSession: openSession })
    const flow = flowMod.createPublishFlow(built.deps)
    const r = await flow.handleContractOp({ op: 'initProject', cwd: 'D:/demo', name: 'demo', visibility: 'public' })
    must(got && got.name === 'demo' && got.visibility === 'public', '名字与可见性送到了房间', JSON.stringify(got))
    must(r.ok === true && r.repo && r.repo.owner === 'boss', '建仓成功回仓库身份', JSON.stringify(r))
    must(r.repoUrl === 'https://gitlab.com/boss/demo', 'GitLab 会话兜出 gitlab.com 地址', String(r.repoUrl))
  }
  {
    // 重试成功回的地址优先用入参那份：GitLab 半成功后重试，不许回 github.com 的错域。
    const built = makeDeps({ resolveGit: async () => 'MOCK_GIT' })
    const flow = flowMod.createPublishFlow(built.deps)
    const r = await flow.handleRetryPush({ cwd: 'D:/demo', name: 'demo', owner: 'boss', repoUrl: 'https://gitlab.com/boss/demo' })
    must(r.ok === true, '重试推送成功', JSON.stringify(r))
    must(r.repoUrl === 'https://gitlab.com/boss/demo', '成功回的地址是入参的真域', String(r.repoUrl))
  }

  console.log('\n共 ' + total + ' 项，' + (broken.length ? ('破 ' + broken.length + ' 项') : '全绿'))
  if (broken.length) process.exit(1)
}

main().catch((e) => { console.error('门禁抛错：' + String((e && e.stack) || e)); process.exit(1) })
