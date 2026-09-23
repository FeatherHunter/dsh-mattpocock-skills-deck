// 合规样本（#706 T2 第二批 · tests/verify-gh-gateway.js 的绿侧夹具）：
// 同一个出口，但每一笔真实出站都先报给闸（noteOutbound），闸的账因此与真发数一致、漏网数为 0。
// 它配套 tests/fixtures/gh-gateway/compliant.registry.json 里那一行登记。
export function goodGated(subprocess, gate, cwd) {
  gate.noteOutbound({ requests: 1, points: 0 })
  return subprocess.spawn({ argv: ['gh', 'api', 'rate_limit'], cwd: cwd })
}
